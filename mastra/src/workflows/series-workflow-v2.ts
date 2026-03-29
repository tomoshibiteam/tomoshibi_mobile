import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  deriveSeriesDeviceServiceDesignBrief,
  type SeriesDeviceServiceDesignBrief,
} from "../lib/serviceDesignBrief";
import {
  seriesConceptGroundingContextSchema,
  seriesInterviewSchema,
  seriesMysteryProfileSchema,
} from "../schemas/series";
import { generateSeriesConcept } from "../lib/agents/seriesConceptAgent";
import { generateSeriesCharacters } from "../lib/agents/seriesCharacterAgent";
import { resolveSeriesConceptGroundingContext } from "../lib/seriesConceptGroundingContext";
import {
  buildCharacterPortraitPrompt,
  buildCoverImagePrompt,
  buildSeriesImageUrl,
  buildSeriesVisualStyleGuide,
} from "../lib/seriesVisuals";
import { loadSeriesGenerationUserContext } from "../lib/seriesGenerationContextStore";
import {
  type ContinuityAxes,
  continuityAxesSchema,
  type EpisodeGenerationContract,
  episodeGenerationContractSchema,
  type EpisodeRuntimeBootstrapPayload,
  episodeRuntimeBootstrapPayloadSchema,
  type InitialUserSeriesStateTemplate,
  initialUserSeriesStateTemplateSchema,
  type PersistentCast,
  persistentCastSchema,
  type RawSeriesGenerationRequest,
  rawSeriesGenerationRequestSchema,
  type SeriesBlueprint,
  seriesBlueprintSchema,
  type SeriesCore,
  seriesCoreSchema,
  type SeriesFrameworkBrief,
  seriesFrameworkBriefSchema,
  type SeriesGenerationResult,
  seriesGenerationResultSchema,
  type SeriesIdentityPack,
  seriesIdentityPackSchema,
  type SeriesVisualBundle,
  seriesVisualBundleSchema,
  stepValidatorResultSchema,
  type StepValidatorResult,
  type UserRoleFrame,
  userRoleFrameSchema,
} from "../schemas/series-runtime-v2";

const clean = (value?: unknown) => (typeof value === "string" ? value : String(value ?? "")).replace(/\s+/g, " ").trim();
const dedupe = (values: Array<string | undefined | null>) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = clean(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
};
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const averageScore = (scores?: Record<string, number>) => {
  if (!scores) return 0;
  const values = Object.values(scores).filter((value) => Number.isFinite(value));
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};
const toId = (prefix: string, seed: string) => `${prefix}_${createHash("sha1").update(seed).digest("hex").slice(0, 12)}`;
const tokenize = (value: string) =>
  clean(value)
    .split(/[\n/|、，。・,:：;；]+/)
    .map((token) => clean(token))
    .filter(Boolean);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const deriveKeywordList = (value: string, fallbacks: string[] = []) =>
  dedupe([
    ...fallbacks,
    ...(clean(value).match(/[A-Za-z0-9一-龥ぁ-んァ-ヶー]{2,24}/g) || []),
  ]).slice(0, 8);
const pickTop = (values: string[], fallback: string) => values.find(Boolean) || fallback;
const containsAny = (source: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(source));
const makePromptPatterns = (value: string) =>
  tokenize(value)
    .slice(0, 8)
    .map((token) => new RegExp(escapeRegExp(token), "i"));
const isCampusLike = (value: string) => /(大学|キャンパス|新入生|オリエンテーション|ガイダンス|講義|履修)/.test(value);
const isTourismLike = (value: string) => /(観光|旅行|旅|史跡|文化|歴史|街歩き|散策|来訪)/.test(value);
const isMarineLike = (value: string) => /(海洋ゴミ|海洋プラスチック|海ごみ|海ゴミ|漂着|海岸|ビーチ|海域)/.test(value);

export type V2SeriesGenerationProgressEvent = {
  phase: string;
  at: string;
  detail?: string;
};

type SanitizedSeriesRequest = {
  sourcePrompt: string;
  normalizedInterview: {
    desiredEmotion?: string;
    companionPreference?: string;
    continuationPreference?: string;
    avoidancePreferences?: string[];
    stylePreference?: string;
  };
  creatorContext?: {
    creatorId?: string;
    creatorName?: string;
    language?: string;
  };
  groundingRefs: {
    seriesLevel?: {
      sourceType: "spreadsheet";
      sourceUrl: string;
      matchedItems: Array<{
        anchor: string;
        detail: string;
        tags: string[];
        sourceRef?: string;
      }>;
    };
    episodeLevel?: {
      sourceType: "spreadsheet";
      sourceUrl: string;
      sheetTab?: string;
      routingHint?: string;
    };
  };
  requestDigest: {
    promptSummary: string;
    constraintDigest: string[];
  };
  serviceDesignInput: {
    prompt: string;
    interview: z.infer<typeof seriesInterviewSchema>;
  };
};

type StepRunResult<T> = {
  artifact?: T;
  validator: StepValidatorResult;
  repairCount: number;
  accepted: boolean;
};

type ProgressReporter = (event: V2SeriesGenerationProgressEvent) => void | Promise<void>;

const emitProgress = async (onProgress: ProgressReporter | undefined, phase: string, detail?: string) => {
  await onProgress?.({ phase, detail: clean(detail) || undefined, at: new Date().toISOString() });
};

const buildStepResult = <T>(artifact: T | undefined, validator: StepValidatorResult, repairCount: number): StepRunResult<T> => ({
  artifact,
  validator,
  repairCount,
  accepted: Boolean(artifact && validator.passed),
});

const ensureSchema = <S extends z.ZodTypeAny>(schema: S, candidate: unknown) => {
  const parsed = schema.safeParse(candidate);
  if (parsed.success) {
    return { parsed: parsed.data as z.output<S>, issues: [] as string[] };
  }
  return {
    parsed: undefined as z.output<S> | undefined,
    issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}:${issue.message}`),
  };
};

const normalizeRecentGenerationContext = (raw: RawSeriesGenerationRequest) => ({
  recent_titles: dedupe(raw.recentTitles || []),
  recent_case_motifs: dedupe(raw.recentCaseMotifs || []),
  recent_character_archetypes: dedupe(raw.recentCharacterArchetypes || []),
  recent_relationship_patterns: dedupe(raw.recentRelationshipPatterns || []),
  recent_visual_motifs: dedupe(raw.recentVisualMotifs || []),
  recent_truth_patterns: dedupe(raw.recentTruthPatterns || []),
  recent_checkpoint_patterns: dedupe(raw.recentCheckpointPatterns || []),
  recent_first_episode_patterns: dedupe(raw.recentFirstEpisodePatterns || []),
  recent_environment_patterns: dedupe(raw.recentEnvironmentPatterns || []),
  recent_appearance_patterns: dedupe(raw.recentAppearancePatterns || []),
});

const mergeRecentGenerationContext = (
  raw: RawSeriesGenerationRequest,
  persisted?: Partial<RawSeriesGenerationRequest>
): RawSeriesGenerationRequest => ({
  ...raw,
  recentTitles: dedupe([...(raw.recentTitles || []), ...(persisted?.recentTitles || [])]),
  recentCaseMotifs: dedupe([...(raw.recentCaseMotifs || []), ...(persisted?.recentCaseMotifs || [])]),
  recentCharacterArchetypes: dedupe([
    ...(raw.recentCharacterArchetypes || []),
    ...(persisted?.recentCharacterArchetypes || []),
  ]),
  recentRelationshipPatterns: dedupe([
    ...(raw.recentRelationshipPatterns || []),
    ...(persisted?.recentRelationshipPatterns || []),
  ]),
  recentVisualMotifs: dedupe([...(raw.recentVisualMotifs || []), ...(persisted?.recentVisualMotifs || [])]),
  recentTruthPatterns: dedupe([...(raw.recentTruthPatterns || []), ...(persisted?.recentTruthPatterns || [])]),
  recentCheckpointPatterns: dedupe([
    ...(raw.recentCheckpointPatterns || []),
    ...(persisted?.recentCheckpointPatterns || []),
  ]),
  recentFirstEpisodePatterns: dedupe([
    ...(raw.recentFirstEpisodePatterns || []),
    ...(persisted?.recentFirstEpisodePatterns || []),
  ]),
  recentEnvironmentPatterns: dedupe([
    ...(raw.recentEnvironmentPatterns || []),
    ...(persisted?.recentEnvironmentPatterns || []),
  ]),
  recentAppearancePatterns: dedupe([
    ...(raw.recentAppearancePatterns || []),
    ...(persisted?.recentAppearancePatterns || []),
  ]),
});

const sanitizeSeriesRequest = (raw: RawSeriesGenerationRequest): SanitizedSeriesRequest => {
  const sourcePrompt = clean(raw.prompt) || clean(raw.interview);
  if (!sourcePrompt) {
    throw new Error("series_source_prompt_missing");
  }

  const promptSummary = sourcePrompt.length > 200 ? `${sourcePrompt.slice(0, 200).trimEnd()}…` : sourcePrompt;
  const avoidancePreferences = dedupe([...(raw.excludedDirections || []), ...(raw.safetyPreferences || [])]);
  const constraintDigest = dedupe([...(raw.explicitGenreHints || []), ...(raw.excludedDirections || []), ...(raw.safetyPreferences || [])]);
  const normalizedInterview = {
    desiredEmotion: clean(raw.interview) || undefined,
    companionPreference: "固定キャラクターとの継続対話",
    continuationPreference: "関係性と発見の積み上がり",
    avoidancePreferences,
    stylePreference: "cinematic-anime",
  };
  const serviceDesignInterview = seriesInterviewSchema.parse({
    genre_world: sourcePrompt,
    desired_emotion: normalizedInterview.desiredEmotion || "プロンプト文面から抽出",
    companion_preference: normalizedInterview.companionPreference,
    continuation_trigger: normalizedInterview.continuationPreference,
    avoidance_preferences: avoidancePreferences.join(" / "),
    additional_notes: constraintDigest.join(" / ") || undefined,
    visual_style_preset: normalizedInterview.stylePreference,
    visual_style_notes: undefined,
    main_objective: undefined,
    protagonist_position: "ユーザー本人が主人公",
    partner_description: normalizedInterview.companionPreference,
  });

  return {
    sourcePrompt,
    normalizedInterview,
    creatorContext: {
      creatorId: clean(raw.userId) || undefined,
      creatorName: undefined,
      language: "ja",
    },
    groundingRefs: {},
    requestDigest: {
      promptSummary,
      constraintDigest,
    },
    serviceDesignInput: {
      prompt: sourcePrompt,
      interview: serviceDesignInterview,
    },
  };
};

const inferUserRolePolicy = (promptSummary: string, brief: SeriesDeviceServiceDesignBrief) => {
  const source = clean(`${promptSummary} ${brief.target_user_context} ${brief.usage_scene}`);
  if (isCampusLike(source)) {
    return {
      roleLabel: "新入生調査者",
      roleSummary: "ユーザーは新生活に入ったばかりの当事者として、現地で得た違和感や証言を自分の判断でつなぎ、行動導線の理解を深めていく。",
      relationToWorld: "初めて触れる場所を学びながら、自分で確かめて前に進む立場。",
    };
  }
  if (isMarineLike(source)) {
    return {
      roleLabel: "現地参加者",
      roleSummary: "ユーザーは現地課題に自分の意思で関わる参加者として、事件ミステリーを通じて地域理解と行動の意味を掴んでいく。",
      relationToWorld: "地域課題の現場に自分の足で入って理解を更新する立場。",
    };
  }
  if (isTourismLike(source)) {
    return {
      roleLabel: "来訪調査者",
      roleSummary: "ユーザーは土地を初めて訪れる来訪者として、現地を巡りながら出来事の真相と地域文脈を発見していく。",
      relationToWorld: "外から来た視点で土地の文脈を読み解く立場。",
    };
  }
  return {
    roleLabel: "当事者調査者",
    roleSummary: "ユーザーは事件ミステリーの当事者として、各地で観察と解釈を重ねながら自分なりの答えに近づいていく。",
    relationToWorld: "現実の場所に入り込み、自分の行動で理解を得る立場。",
  };
};

const deriveEmotionalPromise = (brief: SeriesDeviceServiceDesignBrief, promptSummary: string) => {
  const source = clean(`${brief.emotional_outcome} ${brief.experience_objective} ${promptSummary}`);
  const buckets = [
    [/(面白|楽し|没入)/, "面白さ"],
    [/(ワクワク|高揚|冒険)/, "ワクワク"],
    [/(ハラハラ|緊張|不穏)/, "ハラハラ"],
    [/(安心|迷いが減る|納得)/, "安心"],
    [/(達成感|解ける快感|回収)/, "達成感"],
  ] as const;
  const picked = buckets.filter(([pattern]) => pattern.test(source)).map(([, label]) => label);
  return dedupe([...picked, "面白さ", "達成感"]).slice(0, 4);
};

const normalizeGroundingContext = (
  value: Awaited<ReturnType<typeof resolveSeriesConceptGroundingContext>> | undefined
) => {
  if (!value) return undefined;
  return seriesConceptGroundingContextSchema.parse({
    ...value,
    matched_items: (value.matched_items || []).map((item) => ({
      ...item,
      tags: item.tags || [],
    })),
  });
};

const normalizeSeriesMysteryProfile = (value: SeriesCore["mysteryProfile"]): SeriesCore["mysteryProfile"] =>
  value ? seriesMysteryProfileSchema.parse(value) : undefined;

const buildFrameworkBriefFromLegacy = async (params: {
  promptSummary: string;
  sourcePrompt: string;
  constraintDigest: string[];
  legacyBrief: SeriesDeviceServiceDesignBrief;
}): Promise<SeriesFrameworkBrief> => {
  const { promptSummary, sourcePrompt, constraintDigest, legacyBrief } = params;
  const rolePolicy = inferUserRolePolicy(promptSummary, legacyBrief);
  const groundingContext = normalizeGroundingContext(await resolveSeriesConceptGroundingContext({
    design_brief: legacyBrief,
    prompt: sourcePrompt,
    scope: "series_framework_brief",
  }));
  return seriesFrameworkBriefSchema.parse({
    version: "series-framework-brief-v1",
    sourceDigest: {
      promptSummary,
      interviewDigest: dedupe([legacyBrief.target_user_context, legacyBrief.usage_scene]),
      explicitConstraints: constraintDigest,
      groundingSummary: groundingContext?.matched_items.map((item) => clean(`${item.anchor}:${item.detail}`)).slice(0, 4) || [],
    },
    experienceDesign: {
      objective: clean(legacyBrief.experience_objective),
      valueHypothesis: clean(legacyBrief.service_value_hypothesis),
      targetUserContext: clean(legacyBrief.target_user_context),
      usageScene: clean(legacyBrief.usage_scene),
      emotionalPromise: deriveEmotionalPromise(legacyBrief, promptSummary),
      toneGuardrail: clean(legacyBrief.tone_guardrail),
      uxGuidanceStyle: clean(legacyBrief.ux_guidance_style),
    },
    seriesDesign: {
      userRolePolicy: rolePolicy.roleSummary,
      fixedCastPolicy: clean(legacyBrief.role_design_direction),
      relationshipPromise: "固定キャラクターはユーザーの推理参加を促し、各話完結の達成感の中で信頼と共有記憶を積み上げる。",
      returnReason: "各話で小さな事件が解ける満足感を得つつ、固定キャラクターとの関係や発見ログが続くことで次回も戻りたくなる状態を作る。",
      portabilityPolicy: "シリーズ母体は地域をまたいでも継続でき、各エピソードは土地ごとの事件や発見へ適応する。",
    },
    episodeDesign: {
      completionRule: "every_episode_must_self_contain",
      incidentScalePolicy: "各話は一件の局所事件または一つの発見に絞り、複雑すぎる多重陰謀へ広げない。",
      learningIntegrationPolicy: "学習価値や現地理解は説明として押し込まず、手掛かり・観察・推理の過程で自然に獲得させる。",
      narrationDialogueBalance: "narration-heavy",
      spotUsePolicy: clean(legacyBrief.spatial_behavior_policy),
      localCharacterPolicy: "エピソード固有キャラは土地性と一回性を補うが、固定キャラの役割を侵食しない。",
    },
    continuityDesign: {
      carryOverMemoryKinds: ["keyEvents", "importantConversations", "emotionalMoments"],
      carryOverRelationshipVariables: ["trustLevel", "tensionLevel", "closenessLabel"],
      carryOverProgressKinds: ["discoveryTags", "titles", "achievements"],
      callbackPolicy: [
        "各話で少なくとも1つ、後続話で再利用可能な記憶・伏線・話題を残す。",
        "callback は大謎一本ではなく、関係性や発見の積み上がりとして扱う。",
      ],
      forbiddenContinuityBreaks: [
        "固定キャラクターの口調・立場・既知情報を無断で反転させない。",
        "前話で獲得した関係性や記憶を消去しない。",
      ],
    },
    worldRules: {
      realityRules: [
        "真相は現実世界の因果で説明可能にする。",
        "現実の外出体験として無理のない行動単位に収める。",
      ],
      forbiddenGenreDrifts: ["超常解決", "SF化", "異世界化"],
      spatialBehaviorPolicy: clean(legacyBrief.spatial_behavior_policy),
      locationAdaptationPrinciples: [
        "シリーズ母体は地域横断可能に保ち、土地ごとの文脈はエピソードで具体化する。",
        "場所固有の魅力や知識は、事件の手掛かりとして統合する。",
      ],
    },
    ...(groundingContext ? { groundingContext } : {}),
  });
};

const validateSeriesFrameworkBrief = (artifact: SeriesFrameworkBrief, promptSummary: string): StepValidatorResult => {
  const promptPatterns = makePromptPatterns(promptSummary);
  const issues: string[] = [];
  const warnings: string[] = [];
  const scores: Record<string, number> = {
    experience_specificity: clamp01(clean(artifact.experienceDesign.objective).length / 120),
    series_episode_boundary_clarity: artifact.episodeDesign.completionRule === "every_episode_must_self_contain" ? 1 : 0,
    continuity_completeness:
      artifact.continuityDesign.carryOverMemoryKinds.length >= 2 &&
      artifact.continuityDesign.carryOverRelationshipVariables.length >= 1 &&
      artifact.continuityDesign.callbackPolicy.length >= 1
        ? 1
        : 0.4,
    prompt_alignment: containsAny(
      `${artifact.experienceDesign.objective} ${artifact.experienceDesign.targetUserContext} ${artifact.seriesDesign.returnReason}`,
      promptPatterns
    )
      ? 0.9
      : 0.76,
  };

  if (artifact.experienceDesign.emotionalPromise.length < 2) issues.push("emotionalPromise_insufficient");
  if (artifact.continuityDesign.carryOverMemoryKinds.length < 2) issues.push("carryOverMemoryKinds_insufficient");
  if (artifact.continuityDesign.carryOverRelationshipVariables.length < 1) issues.push("carryOverRelationshipVariables_missing");
  if (artifact.worldRules.forbiddenGenreDrifts.length < 1) issues.push("forbiddenGenreDrifts_missing");
  if (!/また|次/.test(artifact.seriesDesign.returnReason)) warnings.push("returnReason_should_hint_repeat_usage");
  if (averageScore(scores) < 0.8) issues.push("framework_quality_below_threshold");
  for (const [label, score] of Object.entries(scores)) {
    if (score < 0.75) issues.push(`${label}_below_threshold`);
  }

  return stepValidatorResultSchema.parse({ passed: issues.length === 0, scores, issues, warnings });
};

const runFrameworkBriefStep = async (
  sanitized: SanitizedSeriesRequest,
  onProgress?: ProgressReporter
): Promise<StepRunResult<SeriesFrameworkBrief>> => {
  let legacyBrief = await deriveSeriesDeviceServiceDesignBrief(sanitized.serviceDesignInput);
  const framework = await buildFrameworkBriefFromLegacy({
    promptSummary: sanitized.requestDigest.promptSummary,
    sourcePrompt: sanitized.sourcePrompt,
    constraintDigest: sanitized.requestDigest.constraintDigest,
    legacyBrief,
  });
  const parsed = ensureSchema(seriesFrameworkBriefSchema, framework);
  const validator = parsed.parsed
    ? validateSeriesFrameworkBrief(parsed.parsed, sanitized.requestDigest.promptSummary)
    : stepValidatorResultSchema.parse({ passed: false, issues: parsed.issues, warnings: [] });
  if (parsed.parsed && validator.passed) {
    return buildStepResult<SeriesFrameworkBrief>(parsed.parsed, validator, 0);
  }
  return buildStepResult<SeriesFrameworkBrief>(
    undefined,
    validator.passed
      ? stepValidatorResultSchema.parse({ passed: false, issues: ["series_framework_brief_failed"], warnings: [] })
      : validator,
    0
  );
};

const toLegacyServiceBrief = (framework: SeriesFrameworkBrief): SeriesDeviceServiceDesignBrief => ({
  brief_version: "device-service-design-brief-v1",
  experience_objective: framework.experienceDesign.objective,
  service_value_hypothesis: framework.experienceDesign.valueHypothesis,
  target_user_context: framework.experienceDesign.targetUserContext,
  usage_scene: framework.experienceDesign.usageScene,
  emotional_outcome: framework.experienceDesign.emotionalPromise.join(" / "),
  tone_guardrail: framework.experienceDesign.toneGuardrail,
  role_design_direction: framework.seriesDesign.fixedCastPolicy,
  spatial_behavior_policy: framework.worldRules.spatialBehaviorPolicy,
  ux_guidance_style: framework.experienceDesign.uxGuidanceStyle,
});

const validateSeriesCore = (artifact: SeriesCore, framework: SeriesFrameworkBrief): StepValidatorResult => {
  const promptPatterns = makePromptPatterns(framework.sourceDigest.promptSummary);
  const issues: string[] = [];
  const warnings: string[] = [];
  const scores: Record<string, number> = {
    title_relevance: containsAny(artifact.title, promptPatterns) ? 0.95 : 0.65,
    title_distinctness: artifact.title.length >= 6 ? 0.9 : 0.7,
    premise_clarity: clamp01(clean(artifact.premise).length / 100),
    worldview_specificity: clamp01(clean(artifact.worldviewCore).length / 80),
    series_mother_fitness: !/第1話|第2話|第3話|導入・展開・結末/.test(clean(artifact.premise)) ? 0.95 : 0.4,
  };
  if (scores.title_relevance < 0.85) issues.push("title_relevance_below_threshold");
  if (scores.premise_clarity < 0.8) issues.push("premise_clarity_below_threshold");
  if (averageScore(scores) < 0.82) issues.push("series_core_quality_below_threshold");
  if (/アルゴリズム|プロトコル|パラダイム|シンギュラ/i.test(artifact.title)) issues.push("title_jargon_detected");
  if (/第1話|第2話|第3話/.test(artifact.oneLineHook)) warnings.push("oneLineHook_should_not_be_episode_specific");
  return stepValidatorResultSchema.parse({ passed: issues.length === 0, scores, issues, warnings });
};

const runSeriesCoreStep = async (
  framework: SeriesFrameworkBrief,
  raw: RawSeriesGenerationRequest,
  onProgress?: ProgressReporter
): Promise<StepRunResult<SeriesCore>> => {
  const legacyBrief = toLegacyServiceBrief(framework);
  const recent = normalizeRecentGenerationContext(raw);
  const concept = await generateSeriesConcept({
    design_brief: legacyBrief,
    desiredEpisodeCount: 3,
    language: "ja",
    recent_generation_context: recent,
    grounding_context: framework.groundingContext,
  });
  const candidate: SeriesCore = {
    title: clean(concept.title),
    oneLineHook: clean(concept.overview) || clean(concept.premise),
    premise: clean(concept.premise),
    worldviewCore: clean(concept.world?.setting) || clean(concept.overview),
    mysteryProfile: normalizeSeriesMysteryProfile(concept.mystery_profile),
    emotionalPromise: framework.experienceDesign.emotionalPromise,
    toneKeywords: deriveKeywordList(`${concept.tone} ${concept.mystery_profile?.emotional_tone || ""}`, framework.experienceDesign.emotionalPromise),
    genreAxes: deriveKeywordList(concept.genre, [clean(concept.genre) || "事件ミステリー"]),
    aestheticKeywords: deriveKeywordList(`${concept.mystery_profile?.visual_language || ""} ${(concept.world?.recurring_motifs || []).join(" ")}`, ["知的", "現実感", "情緒"]),
    returnReason: framework.seriesDesign.returnReason,
  };

  const parsed = ensureSchema(seriesCoreSchema, candidate);
  const validator = parsed.parsed
    ? validateSeriesCore(parsed.parsed, framework)
    : stepValidatorResultSchema.parse({ passed: false, issues: parsed.issues, warnings: [] });
  if (parsed.parsed && validator.passed) {
    return buildStepResult<SeriesCore>(parsed.parsed, validator, 0);
  }
  return buildStepResult<SeriesCore>(
    undefined,
    validator.passed
      ? stepValidatorResultSchema.parse({ passed: false, issues: ["series_core_failed"], warnings: [] })
      : validator,
    0
  );
};

const buildUserRoleFrame = (framework: SeriesFrameworkBrief, core: SeriesCore): UserRoleFrame => {
  const rolePolicy = inferUserRolePolicy(framework.sourceDigest.promptSummary, toLegacyServiceBrief(framework));
  return {
    roleLabel: rolePolicy.roleLabel,
    roleSummary: framework.seriesDesign.userRolePolicy || rolePolicy.roleSummary,
    selfProjectionMode: "name-editable-self",
    defaultDisplayNameSource: "user_profile",
    relationToWorld: rolePolicy.relationToWorld,
    relationToPartner: "相棒とは、推理と現地行動を共に進めるバディとして関わる。",
    relationToAnchorNpc: "主要固定キャラとは、世界観や継続する問いに接続する窓口として関わる。",
    narrativeFunction: `${core.title}の中で、ユーザーは観察・判断・解釈を担う中心当事者として機能する。`,
  };
};

const validateUserRoleFrame = (artifact: UserRoleFrame, framework: SeriesFrameworkBrief): StepValidatorResult => {
  const issues: string[] = [];
  const warnings: string[] = [];
  const scores: Record<string, number> = {
    role_fit: containsAny(artifact.roleSummary, makePromptPatterns(framework.sourceDigest.promptSummary)) ? 0.9 : 0.7,
    relation_clarity: artifact.relationToPartner !== artifact.relationToAnchorNpc ? 0.9 : 0.4,
    participation_strength: /観察|判断|解釈|行動|推理/.test(artifact.narrativeFunction) ? 0.9 : 0.6,
  };
  if (averageScore(scores) < 0.8) issues.push("user_role_frame_quality_below_threshold");
  if (scores.relation_clarity < 0.8) issues.push("relation_clarity_below_threshold");
  return stepValidatorResultSchema.parse({ passed: issues.length === 0, scores, issues, warnings });
};

const normalizeHookRelations = (value: unknown) => {
  if (!Array.isArray(value)) return [] as Array<{ targetId?: string; targetName?: string; relation: string }>;
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const relation = clean(row.relation);
      if (!relation) return null;
      return {
        targetId: clean(row.target_id) || undefined,
        targetName: clean(row.target_name) || undefined,
        relation,
      };
    })
    .filter(Boolean) as Array<{ targetId?: string; targetName?: string; relation: string }>;
};

const selectPersistentCharacters = (rawCharacters: Array<Record<string, unknown>>) => {
  const protagonists = rawCharacters.filter((row) => row.is_protagonist === true || /(主人公|主役|プレイヤー|ユーザー本人)/.test(clean(row.role)));
  const nonProtagonists = rawCharacters.filter((row) => !protagonists.includes(row));
  const partner = nonProtagonists.find((row) => row.is_partner === true) || nonProtagonists[0];
  const anchorNpc = nonProtagonists.find((row) => row !== partner) || nonProtagonists[1];
  if (!partner || !anchorNpc) {
    throw new Error("persistent_cast_selection_failed");
  }
  return { partner, anchorNpc };
};

const mapPersistentCharacter = (
  slot: "partner" | "anchor",
  row: Record<string, unknown>,
  core: SeriesCore,
  framework: SeriesFrameworkBrief
) => {
  const displayName = clean(row.name) || `${slot === "partner" ? "相棒" : "案内役"}${randomUUID().slice(0, 4)}`;
  const role = clean(row.role) || (slot === "partner" ? "同行する相棒" : "継続する主要人物");
  const goal = clean(row.goal) || role;
  const personality = clean(row.personality) || "観察に強く、自分の視点を持つ。";
  const appearance = clean(row.appearance) || "現実の場に馴染む装い。";
  const relationshipHooks = normalizeHookRelations(row.relationship_hooks);
  const visualDesign = typeof row.visual_design === "object" && row.visual_design ? (row.visual_design as Record<string, unknown>) : undefined;
  const speechStyle = dedupe([
    clean((row as Record<string, unknown>).speech_pattern),
    clean((row as Record<string, unknown>).catchphrase),
    slot === "partner" ? "問い返し中心" : "要点を絞って示す",
  ]).slice(0, 3);
  return {
    id: clean(row.id) || toId(slot === "partner" ? "partner" : "anchor", `${core.title}:${displayName}`),
    slot,
    displayName,
    archetype: clean((row as Record<string, unknown>).archetype) || role,
    coreFunctionInSeries:
      clean((row as Record<string, unknown>).investigation_function) ||
      clean((row as Record<string, unknown>).goal) ||
      role,
    identity: {
      immutableTraits: dedupe([personality, goal]).slice(0, 3),
      mutableTraits: dedupe([clean((row as Record<string, unknown>).arc_start), clean((row as Record<string, unknown>).arc_end)]),
      speechStyle: speechStyle.length > 0 ? speechStyle : [slot === "partner" ? "ユーザーの仮説を促す" : "事実を整理して示す"],
      worldview: clean((row as Record<string, unknown>).drive) || clean((row as Record<string, unknown>).dilemma) || framework.seriesDesign.relationshipPromise,
      motivationCore: goal,
      ...(clean((row as Record<string, unknown>).core_fear) ? { fearOrWound: clean((row as Record<string, unknown>).core_fear) } : {}),
    },
    relationshipDesign: {
      initialDistanceToUser: clean((row as Record<string, unknown>).arc_start) || (slot === "partner" ? "初回から同行できる距離感" : "やや距離があるが継続的に関わる"),
      expectedArcWithUser: clean((row as Record<string, unknown>).arc_end) || "話数を重ねるごとに相互理解が深まる。",
      tabooLines: dedupe(relationshipHooks.map((hook) => hook.relation).filter((relation) => /秘密|禁則|触れない/.test(relation))).slice(0, 3),
    },
    usageRules: {
      mustAppearFrequency: row.must_appear === true || slot === "partner" ? "every_episode" : "often",
      cannotContradict: dedupe([clean((row as Record<string, unknown>).backstory), clean((row as Record<string, unknown>).goal)]).slice(0, 3),
      reactionStyleToPlaces: dedupe([clean((row as Record<string, unknown>).investigation_function), role, clean((row as Record<string, unknown>).environment_residue)]).slice(0, 3),
    },
    recurringHooks: {
      motifs: dedupe([clean((row as Record<string, unknown>).signature_prop), clean((row as Record<string, unknown>).environment_residue)]).slice(0, 3),
      conversationalHooks: dedupe(relationshipHooks.map((hook) => hook.relation)).slice(0, 4),
      emotionalTriggers: dedupe([goal, clean((row as Record<string, unknown>).arc_start), clean((row as Record<string, unknown>).arc_end)]).slice(0, 4),
      placeAffinity: dedupe([clean((row as Record<string, unknown>).role), clean((row as Record<string, unknown>).appearance)]).slice(0, 4),
    },
    visual: {
      portraitPrompt: clean((row as Record<string, unknown>).portrait_prompt) || undefined,
      portraitImageUrl: clean((row as Record<string, unknown>).portrait_image_url) || undefined,
      ...(visualDesign ? {
        dominantColor: clean(visualDesign.dominant_color) || undefined,
      } : {}),
    },
    sourceAppearance: appearance,
    sourcePersonality: personality,
    sourceInvestigationFunction: clean((row as Record<string, unknown>).investigation_function) || undefined,
    sourceRelationshipTemperature: clean((row as Record<string, unknown>).relationship_temperature) || clean((row as Record<string, unknown>).emotional_temperature) || undefined,
    sourceSignatureProp: clean((row as Record<string, unknown>).signature_prop) || undefined,
    sourceEnvironmentResidue: clean((row as Record<string, unknown>).environment_residue) || undefined,
    sourceVisualDesign: visualDesign,
  } as any;
};

const validatePersistentCast = (artifact: PersistentCast): StepValidatorResult => {
  const issues: string[] = [];
  const warnings: string[] = [];
  const distinctName = artifact.partner.displayName.toLowerCase() !== artifact.anchorNpc.displayName.toLowerCase();
  const distinctRole = artifact.partner.coreFunctionInSeries.toLowerCase() !== artifact.anchorNpc.coreFunctionInSeries.toLowerCase();
  const distinctVoice = artifact.partner.identity.speechStyle.join("|") !== artifact.anchorNpc.identity.speechStyle.join("|");
  const scores: Record<string, number> = {
    role_distinctness: distinctRole ? 0.95 : 0.4,
    voice_distinctness: distinctVoice ? 0.9 : 0.5,
    relationship_non_overlap:
      artifact.partner.relationshipDesign.initialDistanceToUser !== artifact.anchorNpc.relationshipDesign.initialDistanceToUser ? 0.85 : 0.6,
    series_fit: 0.85,
    memorability: distinctName ? 0.9 : 0.5,
  };
  if (!distinctName) issues.push("display_name_similarity_detected");
  if (scores.role_distinctness < 0.9) issues.push("role_distinctness_below_threshold");
  for (const [key, score] of Object.entries(scores)) {
    if (score < 0.8) issues.push(`${key}_below_threshold`);
  }
  return stepValidatorResultSchema.parse({ passed: issues.length === 0, scores, issues, warnings });
};

const runPersistentCastStep = async (
  framework: SeriesFrameworkBrief,
  core: SeriesCore,
  userRoleFrame: UserRoleFrame,
  raw: RawSeriesGenerationRequest
): Promise<StepRunResult<PersistentCast>> => {
  const legacyBrief = toLegacyServiceBrief(framework);
  const styleGuide = buildSeriesVisualStyleGuide({
    seriesTitle: core.title,
    genre: pickTop(core.genreAxes, "事件ミステリー"),
    tone: pickTop(core.toneKeywords, "知的で親しみやすい"),
    setting: core.worldviewCore,
    dominantColors: core.aestheticKeywords,
    recurringMotifs: core.mysteryProfile?.differentiation_axes || [],
    styleDirection: framework.experienceDesign.toneGuardrail,
  });

  let repairCount = 0;
  let lastValidator = stepValidatorResultSchema.parse({ passed: false, issues: ["persistent_cast_not_started"], warnings: [] });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const generated = await generateSeriesCharacters({
      title: core.title,
      genre: pickTop(core.genreAxes, "事件ミステリー"),
      tone: pickTop(core.toneKeywords, "知的"),
      premise: core.premise,
      world_setting: core.worldviewCore,
      season_goal: framework.seriesDesign.returnReason,
      design_brief: legacyBrief,
      protagonist_name: "あなた",
      protagonist_position: userRoleFrame.roleSummary,
      partner_description: framework.seriesDesign.fixedCastPolicy,
      style_guide: styleGuide,
      target_count: 2,
      mystery_profile: core.mysteryProfile,
      recent_generation_context: normalizeRecentGenerationContext(raw),
    });

    const sourceCharacters = generated.characters as unknown as Array<Record<string, unknown>>;
    const selected = selectPersistentCharacters(sourceCharacters);
    const candidate = persistentCastSchema.parse({
      partner: mapPersistentCharacter("partner", selected.partner, core, framework),
      anchorNpc: mapPersistentCharacter("anchor", selected.anchorNpc, core, framework),
    });
    const validator = validatePersistentCast(candidate);
    lastValidator = validator;
    if (validator.passed) {
      return buildStepResult<PersistentCast>(candidate, validator, repairCount);
    }
    repairCount += 1;
  }

  return buildStepResult<PersistentCast>(undefined, lastValidator, repairCount);
};

const buildSeriesIdentityPack = (
  framework: SeriesFrameworkBrief,
  core: SeriesCore,
  userRoleFrame: UserRoleFrame,
  cast: PersistentCast
): SeriesIdentityPack => {
  return seriesIdentityPackSchema.parse({
    seriesCoreAnchors: {
      nonNegotiableTheme: dedupe([pickTop(core.genreAxes, "事件ミステリー"), framework.experienceDesign.objective]).slice(0, 3),
      nonNegotiableMood: dedupe([pickTop(core.toneKeywords, "知的"), framework.experienceDesign.toneGuardrail]).slice(0, 3),
      nonNegotiableRelationshipDynamics: dedupe([framework.seriesDesign.relationshipPromise, cast.partner.relationshipDesign.expectedArcWithUser]).slice(0, 3),
      nonNegotiableNarrativePromises: dedupe([core.premise, core.returnReason, framework.seriesDesign.returnReason]).slice(0, 4),
      nonNegotiableUserRolePromises: dedupe([userRoleFrame.roleSummary, userRoleFrame.narrativeFunction]).slice(0, 3),
    },
    characterAnchors: [cast.partner, cast.anchorNpc].map((character) => ({
      characterId: character.id,
      anchorSummary: `${character.displayName}は${character.coreFunctionInSeries}を担う。`,
      neverBreak: dedupe([character.identity.worldview, ...character.identity.immutableTraits]).slice(0, 4),
      mayEvolve: dedupe([...character.identity.mutableTraits, character.relationshipDesign.expectedArcWithUser]).slice(0, 4),
    })),
    continuityAnchors: {
      rememberedKindsOfEvents: framework.continuityDesign.carryOverMemoryKinds,
      relationshipVariables: framework.continuityDesign.carryOverRelationshipVariables,
      achievementKinds: framework.continuityDesign.carryOverProgressKinds,
      episodeCarryOverRules: framework.continuityDesign.callbackPolicy,
      callbackPatterns: framework.continuityDesign.callbackPolicy,
    },
  });
};

const validateIdentityPack = (artifact: SeriesIdentityPack): StepValidatorResult => {
  const issues: string[] = [];
  if (artifact.characterAnchors.some((anchor) => anchor.neverBreak.length < 2)) issues.push("character_anchor_never_break_insufficient");
  if (artifact.continuityAnchors.callbackPatterns.length < 1) issues.push("callback_patterns_missing");
  return stepValidatorResultSchema.parse({
    passed: issues.length === 0,
    scores: { anchor_completeness: issues.length === 0 ? 0.95 : 0.6 },
    issues,
    warnings: [],
  });
};

const buildContinuityAxes = (framework: SeriesFrameworkBrief, cast: PersistentCast): ContinuityAxes => {
  return continuityAxesSchema.parse({
    axes: [
      {
        axisId: toId("axis", `${cast.partner.id}:relationship`),
        label: `${cast.partner.displayName}との信頼`,
        kind: "relationship",
        description: "相棒との信頼と共同推理の深まり。",
        initialStateLabel: "手探り",
        growthSignals: ["共同推理が噛み合う", "感情の共有が増える", "役割分担が自然になる"],
        carryOverRule: "episode 終了時に trust/tension と sharedMemories を更新する。",
      },
      {
        axisId: toId("axis", `${framework.sourceDigest.promptSummary}:discovery`),
        label: "発見ログの厚み",
        kind: "discovery",
        description: "土地・施設・出来事に対する理解と発見の蓄積。",
        initialStateLabel: "入口",
        growthSignals: ["土地理解が増える", "事件構造が見える", "次回の問いが増える"],
        carryOverRule: "episode 終了時に discoveryTags と rememberedExperience を追加する。",
      },
    ],
  });
};

const validateContinuityAxes = (artifact: ContinuityAxes): StepValidatorResult => {
  const issues: string[] = [];
  const kinds = new Set(artifact.axes.map((axis) => axis.kind));
  if (!kinds.has("relationship")) issues.push("relationship_axis_missing");
  if (!kinds.has("discovery")) issues.push("discovery_axis_missing");
  return stepValidatorResultSchema.parse({
    passed: issues.length === 0,
    scores: { continuity_axis_completeness: issues.length === 0 ? 0.95 : 0.5 },
    issues,
    warnings: [],
  });
};

const buildEpisodeGenerationContract = (framework: SeriesFrameworkBrief): EpisodeGenerationContract => {
  return episodeGenerationContractSchema.parse({
    episodeMustSelfContain: true,
    requiredBeatSequence: ["hook", "exploration", "pivot", "resolution", "carryover_hint"],
    allowedIncidentScale: framework.episodeDesign.incidentScalePolicy,
    mandatoryOutputs: ["completionCondition", "carryoverHint", "sceneBlocks", "continuityPatch"],
    mandatoryCarryOverCategories: ["memories", "relationships", "discoveries"],
    narrationDialogueBalance: framework.episodeDesign.narrationDialogueBalance,
    spotCountPolicy: { min: 3, max: 6 },
    localKnowledgeUsagePolicy: framework.episodeDesign.learningIntegrationPolicy,
    locationAdaptationRules: framework.worldRules.locationAdaptationPrinciples,
    fixedCastUsagePolicy: "partner は毎話必須、anchorNpc は often。固定キャラは説明係ではなく推理構造の担い手として使う。",
    localCharacterUsagePolicy: framework.episodeDesign.localCharacterPolicy,
    puzzlePolicy: {
      perSpotPuzzleRequired: false,
      finalInferenceRequired: true,
      punishmentForWrongAnswer: "soft",
    },
  });
};

const validateEpisodeGenerationContract = (artifact: EpisodeGenerationContract): StepValidatorResult => {
  const issues: string[] = [];
  if (artifact.requiredBeatSequence.join(",") !== "hook,exploration,pivot,resolution,carryover_hint") {
    issues.push("required_beat_sequence_invalid");
  }
  if (!artifact.mandatoryOutputs.includes("completionCondition")) issues.push("completionCondition_missing");
  if (!artifact.mandatoryOutputs.includes("carryoverHint")) issues.push("carryoverHint_missing");
  if (artifact.spotCountPolicy.min < 3 || artifact.spotCountPolicy.max > 6) issues.push("spot_count_policy_out_of_range");
  return stepValidatorResultSchema.parse({
    passed: issues.length === 0,
    scores: { contract_completeness: issues.length === 0 ? 0.95 : 0.5 },
    issues,
    warnings: [],
  });
};

const buildSeriesVisualBundle = (
  framework: SeriesFrameworkBrief,
  core: SeriesCore,
  cast: PersistentCast,
  identityPack: SeriesIdentityPack
): SeriesVisualBundle => {
  const styleGuide = buildSeriesVisualStyleGuide({
    seriesTitle: core.title,
    genre: pickTop(core.genreAxes, "事件ミステリー"),
    tone: pickTop(core.toneKeywords, "知的で親しみやすい"),
    setting: core.worldviewCore,
    dominantColors: core.aestheticKeywords,
    recurringMotifs: identityPack.continuityAnchors.callbackPatterns.slice(0, 2),
    styleDirection: framework.experienceDesign.toneGuardrail,
  });

  const coverPrompt = buildCoverImagePrompt({
    title: core.title,
    genre: pickTop(core.genreAxes, "事件ミステリー"),
    tone: pickTop(core.toneKeywords, "知的で親しみやすい"),
    premise: core.premise,
    setting: core.worldviewCore,
    styleGuide,
    caseCore: core.mysteryProfile?.case_core,
    truthNature: core.mysteryProfile?.truth_nature,
    environmentLayer: core.mysteryProfile?.environment_layer,
    recurringMotifs: identityPack.continuityAnchors.callbackPatterns.slice(0, 2),
    focusCharacters: [cast.partner, cast.anchorNpc].map((character) => ({
      name: character.displayName,
      role: character.coreFunctionInSeries,
      visualAnchor: character.recurringHooks.motifs[0] || character.identity.immutableTraits[0] || "",
      focusReason: character.slot === "partner" ? "viewer entry point" : "series anchor",
    })),
    additionalDirection: "show the mystery beginning directly, with the real-world setting and fixed cast readable at a glance",
  });

  const characters = [cast.partner, cast.anchorNpc].map((character) => {
    const anyCharacter = character as any;
    const portraitPrompt =
      clean(anyCharacter.visual?.portraitPrompt) ||
      buildCharacterPortraitPrompt({
        seriesTitle: core.title,
        genre: pickTop(core.genreAxes, "事件ミステリー"),
        tone: pickTop(core.toneKeywords, "知的で親しみやすい"),
        name: character.displayName,
        role: character.coreFunctionInSeries,
        personality: anyCharacter.sourcePersonality || character.identity.immutableTraits.join(" / "),
        appearance: anyCharacter.sourceAppearance || character.recurringHooks.placeAffinity.join(" / ") || "現実の場に馴染む装い。",
        setting: core.worldviewCore,
        caseCore: core.mysteryProfile?.case_core,
        environmentLayer: core.mysteryProfile?.environment_layer || core.worldviewCore,
        investigationFunction: anyCharacter.sourceInvestigationFunction || character.coreFunctionInSeries,
        relationshipTemperature: anyCharacter.sourceRelationshipTemperature || character.relationshipDesign.initialDistanceToUser,
        signatureProp: anyCharacter.sourceSignatureProp || character.recurringHooks.motifs[0],
        environmentResidue: anyCharacter.sourceEnvironmentResidue || character.recurringHooks.placeAffinity[0],
        dominantColor: clean(anyCharacter.sourceVisualDesign?.dominant_color),
        bodyType: clean(anyCharacter.sourceVisualDesign?.body_type),
        distinguishingFeature: clean(anyCharacter.sourceVisualDesign?.distinguishing_feature),
        styleGuide,
      });

    return {
      characterId: character.id,
      displayName: character.displayName,
      portraitPrompt,
      portraitImageUrl:
        clean(anyCharacter.visual?.portraitImageUrl) ||
        buildSeriesImageUrl({
          prompt: portraitPrompt,
          seedKey: `${core.title}:${character.id}:portrait`,
          width: 768,
          height: 1024,
          purpose: "character_portrait",
        }),
    };
  });

  return seriesVisualBundleSchema.parse({
    cover: {
      prompt: coverPrompt,
      imageUrl: buildSeriesImageUrl({
        prompt: coverPrompt,
        seedKey: `${core.title}:cover`,
        width: 1024,
        height: 1536,
        purpose: "cover",
      }),
    },
    characters,
  });
};

const validateSeriesVisualBundle = (artifact: SeriesVisualBundle): StepValidatorResult => {
  const issues: string[] = [];
  if (artifact.characters.length !== 2) issues.push("series_visual_bundle_character_count_invalid");
  if (!clean(artifact.cover.prompt)) issues.push("cover_prompt_missing");
  if (artifact.characters.some((character) => !clean(character.portraitPrompt))) issues.push("portrait_prompt_missing");
  return stepValidatorResultSchema.parse({
    passed: issues.length === 0,
    scores: { visual_bundle_completeness: issues.length === 0 ? 0.95 : 0.5 },
    issues,
    warnings: [],
  });
};

const buildInitialUserSeriesStateTemplate = (
  blueprint: SeriesBlueprint,
  continuityAxes: ContinuityAxes,
  cast: PersistentCast
): InitialUserSeriesStateTemplate => {
  return initialUserSeriesStateTemplateSchema.parse({
    progressSummary: {
      episodeCountCompleted: 0,
      activeThreads: [],
      resolvedThreads: [],
      recentEpisodeIds: [],
      continuityAxisProgress: continuityAxes.axes.map((axis) => ({
        axisId: axis.axisId,
        currentLabel: axis.initialStateLabel,
        recentShift: "未開始",
      })),
    },
    rememberedExperience: {
      visitedLocations: [],
      keyEvents: [],
      importantConversations: [],
      playerChoices: [],
      emotionalMoments: [],
      relationshipTurningPoints: [],
    },
    relationshipState: [cast.partner, cast.anchorNpc].map((character) => ({
      characterId: character.id,
      closenessLabel: character.slot === "partner" ? "手探り" : "距離あり",
      trustLevel: character.slot === "partner" ? 40 : 35,
      tensionLevel: character.slot === "partner" ? 20 : 25,
      affectionLevel: 0,
      specialFlags: [],
      sharedMemories: [],
      unresolvedEmotions: [],
    })),
    achievementState: {
      titles: [],
      achievements: [],
      discoveryTags: [],
    },
    continuityState: {
      callbackCandidates: blueprint.identityPack.continuityAnchors.callbackPatterns.slice(0, 2),
      motifsInUse: blueprint.identityPack.seriesCoreAnchors.nonNegotiableTheme.slice(0, 2),
      blockedLines: [],
      promisedPayoffs: [],
    },
  });
};

const buildEpisodeRuntimeBootstrapPayload = (
  blueprint: SeriesBlueprint,
  identityPack: SeriesIdentityPack,
  cast: PersistentCast,
  contract: EpisodeGenerationContract,
  continuityAxes: ContinuityAxes
): EpisodeRuntimeBootstrapPayload => {
  return episodeRuntimeBootstrapPayloadSchema.parse({
    seriesBlueprintId: blueprint.id,
    conceptDigest: clean(`${blueprint.concept.title} / ${blueprint.concept.oneLineHook}`),
    identityPackDigest: dedupe([
      ...identityPack.seriesCoreAnchors.nonNegotiableTheme,
      ...identityPack.seriesCoreAnchors.nonNegotiableMood,
      ...identityPack.seriesCoreAnchors.nonNegotiableUserRolePromises,
    ]).slice(0, 8),
    userRoleDigest: clean(`${blueprint.userRoleFrame.roleLabel} / ${blueprint.userRoleFrame.roleSummary}`),
    mandatoryCharacters: [cast.partner.id, cast.anchorNpc.id],
    continuityAxesDigest: continuityAxes.axes.map((axis) => `${axis.label}:${axis.initialStateLabel}`),
    continuityContract: dedupe([
      ...blueprint.continuityContract.mandatoryMemoryKinds,
      ...blueprint.continuityContract.mandatoryRelationshipVariables,
      ...blueprint.continuityContract.mandatoryCallbackTypes,
    ]).slice(0, 10),
    episodeGenerationContract: contract,
  });
};

const summarizeGenerationQuality = (steps: Array<StepRunResult<unknown>>) => {
  const issues = dedupe(steps.flatMap((step) => step.validator.issues));
  const attachmentScore = averageScore(steps[1]?.validator.scores);
  const continuityScore = averageScore(steps[5]?.validator.scores);
  const characterDistinctnessScore = averageScore(steps[3]?.validator.scores);
  return {
    attachmentScore: attachmentScore || undefined,
    continuityScore: continuityScore || undefined,
    characterDistinctnessScore: characterDistinctnessScore || undefined,
    issues,
    accepted: steps.every((step) => step.accepted),
  };
};

export const generateSeriesGenerationResultV2 = async (
  rawInput: RawSeriesGenerationRequest,
  options: { onProgress?: ProgressReporter } = {}
): Promise<SeriesGenerationResult> => {
  const raw = rawSeriesGenerationRequestSchema.parse(rawInput);

  await emitProgress(options.onProgress, "sanitize_series_request_start", "入力情報を正規化しています");
  const sanitized = sanitizeSeriesRequest(raw);
  await emitProgress(options.onProgress, "sanitize_series_request_done", "入力情報の正規化が完了しました");

  await emitProgress(options.onProgress, "load_series_generation_context_start", "既存シリーズ文脈を取得しています");
  const seriesContext = await loadSeriesGenerationUserContext({
    userId: sanitized.creatorContext?.creatorId,
    sourcePrompt: sanitized.sourcePrompt,
  });
  await emitProgress(
    options.onProgress,
    "load_series_generation_context_done",
    seriesContext.decision.action === "allow"
      ? `既存シリーズ文脈を取得しました（draft=${seriesContext.draftCount}）`
      : "既存シリーズ状況を取得しました"
  );

  await emitProgress(options.onProgress, "evaluate_series_generation_eligibility_start", "新規シリーズ生成可否を判定しています");
  if (seriesContext.decision.action === "reject") {
    if (seriesContext.decision.reason === "existing_draft_conflict") {
      throw new Error(
        `series_generation_blocked_existing_draft:${seriesContext.decision.title || "既存ドラフト"}`
      );
    }
    throw new Error("series_generation_blocked_too_many_drafts");
  }
  await emitProgress(options.onProgress, "evaluate_series_generation_eligibility_done", "新規シリーズ生成が可能です");

  const rawWithUserContext = mergeRecentGenerationContext(raw, seriesContext.recentContext);

  await emitProgress(options.onProgress, "derive_series_framework_brief_start", "シリーズ母体の上位契約を整理しています");
  const frameworkStep = await runFrameworkBriefStep(sanitized, options.onProgress);
  if (!frameworkStep.accepted || !frameworkStep.artifact) {
    throw new Error(`series_framework_brief_failed:${frameworkStep.validator.issues.join(",")}`);
  }
  await emitProgress(options.onProgress, "derive_series_framework_brief_done", "シリーズ母体の上位契約を確定しました");

  await emitProgress(options.onProgress, "generate_series_core_start", "シリーズ母体の核を生成しています");
  const coreStep = await runSeriesCoreStep(frameworkStep.artifact, rawWithUserContext, options.onProgress);
  if (!coreStep.accepted || !coreStep.artifact) {
    throw new Error(`series_core_failed:${coreStep.validator.issues.join(",")}`);
  }
  await emitProgress(options.onProgress, "generate_series_core_done", "シリーズ母体の核が確定しました");

  await emitProgress(options.onProgress, "generate_user_role_frame_start", "ユーザーの立場を定義しています");
  const userRoleFrame = buildUserRoleFrame(frameworkStep.artifact, coreStep.artifact);
  const userRoleParsed = userRoleFrameSchema.parse(userRoleFrame);
  const userRoleStep = buildStepResult(userRoleParsed, validateUserRoleFrame(userRoleParsed, frameworkStep.artifact), 0);
  if (!userRoleStep.accepted || !userRoleStep.artifact) {
    throw new Error(`user_role_frame_failed:${userRoleStep.validator.issues.join(",")}`);
  }
  await emitProgress(options.onProgress, "generate_user_role_frame_done", "ユーザーの立場が確定しました");

  await emitProgress(options.onProgress, "generate_persistent_cast_start", "固定キャラクターを生成しています");
  const castStep = await runPersistentCastStep(
    frameworkStep.artifact,
    coreStep.artifact,
    userRoleStep.artifact,
    rawWithUserContext
  );
  if (!castStep.accepted || !castStep.artifact) {
    throw new Error(`persistent_cast_failed:${castStep.validator.issues.join(",")}`);
  }
  await emitProgress(options.onProgress, "generate_persistent_cast_done", "固定キャラクターが確定しました");

  await emitProgress(options.onProgress, "build_series_identity_pack_start", "シリーズの一貫性アンカーを固定しています");
  const identityPack = buildSeriesIdentityPack(frameworkStep.artifact, coreStep.artifact, userRoleStep.artifact, castStep.artifact);
  const identityStep = buildStepResult(identityPack, validateIdentityPack(identityPack), 0);
  if (!identityStep.accepted || !identityStep.artifact) {
    throw new Error(`series_identity_pack_failed:${identityStep.validator.issues.join(",")}`);
  }
  await emitProgress(options.onProgress, "build_series_identity_pack_done", "シリーズの一貫性アンカーを固定しました");

  await emitProgress(options.onProgress, "build_series_continuity_axes_start", "継続軸を定義しています");
  const continuityAxes = buildContinuityAxes(frameworkStep.artifact, castStep.artifact);
  const continuityAxesStep = buildStepResult(continuityAxes, validateContinuityAxes(continuityAxes), 0);
  if (!continuityAxesStep.accepted || !continuityAxesStep.artifact) {
    throw new Error(`series_continuity_axes_failed:${continuityAxesStep.validator.issues.join(",")}`);
  }
  await emitProgress(options.onProgress, "build_series_continuity_axes_done", "継続軸を定義しました");

  await emitProgress(options.onProgress, "build_episode_generation_contract_start", "エピソード生成契約を定義しています");
  const episodeGenerationContract = buildEpisodeGenerationContract(frameworkStep.artifact);
  const episodeContractStep = buildStepResult(
    episodeGenerationContract,
    validateEpisodeGenerationContract(episodeGenerationContract),
    0
  );
  if (!episodeContractStep.accepted || !episodeContractStep.artifact) {
    throw new Error(`episode_generation_contract_failed:${episodeContractStep.validator.issues.join(",")}`);
  }
  await emitProgress(options.onProgress, "build_episode_generation_contract_done", "エピソード生成契約を定義しました");

  await emitProgress(options.onProgress, "generate_series_visual_bundle_start", "シリーズ画像を生成しています");
  const visualBundle = buildSeriesVisualBundle(frameworkStep.artifact, coreStep.artifact, castStep.artifact, identityStep.artifact);
  const visualStep = buildStepResult(visualBundle, validateSeriesVisualBundle(visualBundle), 0);
  if (!visualStep.accepted || !visualStep.artifact) {
    throw new Error(`series_visual_bundle_failed:${visualStep.validator.issues.join(",")}`);
  }
  await emitProgress(options.onProgress, "generate_series_visual_bundle_done", "シリーズ画像の準備が完了しました");

  await emitProgress(options.onProgress, "finalize_series_blueprint_start", "シリーズ母体を最終統合しています");
  const blueprint = seriesBlueprintSchema.parse({
    id: randomUUID(),
    version: 2,
    status: "draft",
    origin: {
      creationMode: "generated",
      sourcePromptSummary: frameworkStep.artifact.sourceDigest.promptSummary,
      sourceInterviewDigest: frameworkStep.artifact.sourceDigest.interviewDigest,
      generatedAt: new Date().toISOString(),
      modelInfo: {
        provider: clean(process.env.MASTRA_TEXT_MODEL_PROVIDER || "unknown"),
        model: clean(process.env.MASTRA_SERIES_CONCEPT_MODEL || process.env.MASTRA_MODEL_FAST || "unknown"),
        promptVersion: "series-runtime-v2",
      },
    },
    frameworkBrief: frameworkStep.artifact,
    concept: coreStep.artifact,
    userRoleFrame: userRoleStep.artifact,
    persistentCharacters: castStep.artifact,
    identityPack: identityStep.artifact,
    continuityAxes: continuityAxesStep.artifact,
    continuityContract: {
      mandatoryMemoryKinds: frameworkStep.artifact.continuityDesign.carryOverMemoryKinds,
      mandatoryRelationshipVariables: frameworkStep.artifact.continuityDesign.carryOverRelationshipVariables,
      mandatoryProgressKinds: frameworkStep.artifact.continuityDesign.carryOverProgressKinds,
      mandatoryCallbackTypes: frameworkStep.artifact.continuityDesign.callbackPolicy,
      forbiddenContinuityBreaks: frameworkStep.artifact.continuityDesign.forbiddenContinuityBreaks,
      handoffFieldsToEpisodeRuntime: [
        "frameworkBrief",
        "concept",
        "userRoleFrame",
        "persistentCharacters",
        "identityPack",
        "continuityAxes",
        "episodeGenerationContract",
      ],
    },
    episodeGenerationContract: episodeContractStep.artifact,
    generationQuality: summarizeGenerationQuality([
      frameworkStep,
      coreStep,
      userRoleStep,
      castStep,
      identityStep,
      continuityAxesStep,
      episodeContractStep,
      visualStep,
    ]),
  });

  const initialUserSeriesStateTemplate = buildInitialUserSeriesStateTemplate(
    blueprint,
    continuityAxesStep.artifact,
    castStep.artifact
  );
  const episodeRuntimeBootstrapPayload = buildEpisodeRuntimeBootstrapPayload(
    blueprint,
    identityStep.artifact,
    castStep.artifact,
    episodeContractStep.artifact,
    continuityAxesStep.artifact
  );

  const result = seriesGenerationResultSchema.parse({
    workflowVersion: "series-generation-v2",
    seriesBlueprint: blueprint,
    initialUserSeriesStateTemplate,
    episodeRuntimeBootstrapPayload,
    visualBundle: visualStep.artifact,
  });
  await emitProgress(options.onProgress, "finalize_series_blueprint_done", "シリーズ母体の最終統合が完了しました");
  return result;
};
