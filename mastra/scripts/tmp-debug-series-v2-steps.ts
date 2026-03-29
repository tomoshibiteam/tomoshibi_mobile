import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import {
  deriveSeriesDeviceServiceDesignBrief,
  type SeriesDeviceServiceDesignBrief,
} from "../src/lib/serviceDesignBrief";
import { generateSeriesConcept } from "../src/lib/agents/seriesConceptAgent";
import { generateSeriesCharacters } from "../src/lib/agents/seriesCharacterAgent";
import { resolveSeriesConceptGroundingContext } from "../src/lib/seriesConceptGroundingContext";
import { buildSeriesVisualStyleGuide } from "../src/lib/seriesVisuals";
import {
  rawSeriesGenerationRequestSchema,
  seriesCoreSchema,
  seriesFrameworkBriefSchema,
  userRoleFrameSchema,
} from "../src/schemas/series-runtime-v2";
import {
  seriesConceptGroundingContextSchema,
  seriesMysteryProfileSchema,
} from "../src/schemas/series";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

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

const normalizeRecentGenerationContext = (raw: z.infer<typeof rawSeriesGenerationRequestSchema>) => ({
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
};

const sanitizeSeriesRequest = (raw: z.infer<typeof rawSeriesGenerationRequestSchema>): SanitizedSeriesRequest => {
  const sourcePrompt = clean(raw.prompt) || clean(raw.interview);
  if (!sourcePrompt) {
    throw new Error("series_source_prompt_missing");
  }

  const promptSummary = sourcePrompt.length > 200 ? `${sourcePrompt.slice(0, 200).trimEnd()}…` : sourcePrompt;
  return {
    sourcePrompt,
    normalizedInterview: {
      desiredEmotion: clean(raw.interview) || undefined,
      companionPreference: "固定キャラクターとの継続対話",
      continuationPreference: "関係性と発見の積み上がり",
      avoidancePreferences: dedupe([...(raw.excludedDirections || []), ...(raw.safetyPreferences || [])]),
      stylePreference: "cinematic-anime",
    },
    creatorContext: {
      creatorId: clean(raw.userId) || undefined,
      creatorName: undefined,
      language: "ja",
    },
    groundingRefs: {},
    requestDigest: {
      promptSummary,
      constraintDigest: dedupe([...(raw.explicitGenreHints || []), ...(raw.excludedDirections || []), ...(raw.safetyPreferences || [])]),
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

const buildFrameworkBriefFromLegacy = async (params: {
  promptSummary: string;
  sourcePrompt: string;
  constraintDigest: string[];
  legacyBrief: SeriesDeviceServiceDesignBrief;
}) => {
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

const toLegacyServiceBrief = (framework: z.infer<typeof seriesFrameworkBriefSchema>): SeriesDeviceServiceDesignBrief => ({
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

const normalizeSeriesMysteryProfile = (value: unknown) =>
  value ? seriesMysteryProfileSchema.parse(value) : undefined;

const buildUserRoleFrame = (
  framework: z.infer<typeof seriesFrameworkBriefSchema>,
  core: z.infer<typeof seriesCoreSchema>
) => {
  const rolePolicy = inferUserRolePolicy(framework.sourceDigest.promptSummary, toLegacyServiceBrief(framework));
  return userRoleFrameSchema.parse({
    roleLabel: rolePolicy.roleLabel,
    roleSummary: framework.seriesDesign.userRolePolicy || rolePolicy.roleSummary,
    selfProjectionMode: "name-editable-self",
    defaultDisplayNameSource: "user_profile",
    relationToWorld: rolePolicy.relationToWorld,
    relationToPartner: "相棒とは、推理と現地行動を共に進めるバディとして関わる。",
    relationToAnchorNpc: "主要固定キャラとは、世界観や継続する問いに接続する窓口として関わる。",
    narrativeFunction: `${core.title}の中で、ユーザーは観察・判断・解釈を担う中心当事者として機能する。`,
  });
};

const main = async () => {
  const rawInput = rawSeriesGenerationRequestSchema.parse({
    userId: "dev-user-manual-run",
    prompt:
      process.argv[2] ||
      "九州大学の新入生向けに、伊都キャンパスで体験する事件ミステリー型シリーズを作ってください。",
    interview: "事件ミステリーとして面白く、ワクワクしながら学べる体験がよい。",
    explicitGenreHints: ["事件ミステリー", "現実的", "新入生オンボーディング"],
    excludedDirections: ["超常解決", "SF化", "異世界転移"],
    safetyPreferences: ["現実因果", "非暴力"],
    desiredEpisodeLimit: 3,
  });

  const steps: Array<{
    step: string;
    status: "passed" | "failed";
    input: unknown;
    output?: unknown;
    error?: string;
    at: string;
  }> = [];

  try {
    const sanitized = sanitizeSeriesRequest(rawInput);
    steps.push({
      step: "step0_sanitize_series_request",
      status: "passed",
      input: rawInput,
      output: sanitized,
      at: new Date().toISOString(),
    });

    const legacyBrief = await deriveSeriesDeviceServiceDesignBrief({
      prompt: sanitized.sourcePrompt,
    });
    const framework = await buildFrameworkBriefFromLegacy({
      promptSummary: sanitized.requestDigest.promptSummary,
      sourcePrompt: sanitized.sourcePrompt,
      constraintDigest: sanitized.requestDigest.constraintDigest,
      legacyBrief,
    });
    steps.push({
      step: "step1_derive_series_framework_brief",
      status: "passed",
      input: {
        sanitized,
        seriesLevelGrounding: null,
      },
      output: framework,
      at: new Date().toISOString(),
    });

    const concept = await generateSeriesConcept({
      design_brief: toLegacyServiceBrief(framework),
      desiredEpisodeCount: 3,
      language: "ja",
      recent_generation_context: normalizeRecentGenerationContext(rawInput),
      grounding_context: framework.groundingContext,
    });
    const core = seriesCoreSchema.parse({
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
    });
    steps.push({
      step: "step2_generate_series_core",
      status: "passed",
      input: {
        frameworkBrief: framework,
      },
      output: core,
      at: new Date().toISOString(),
    });

    const userRoleFrame = buildUserRoleFrame(framework, core);
    steps.push({
      step: "step3_generate_user_role_frame",
      status: "passed",
      input: {
        frameworkBrief: framework,
        seriesCore: core,
      },
      output: userRoleFrame,
      at: new Date().toISOString(),
    });

    const styleGuide = buildSeriesVisualStyleGuide({
      seriesTitle: core.title,
      genre: pickTop(core.genreAxes, "事件ミステリー"),
      tone: pickTop(core.toneKeywords, "知的で親しみやすい"),
      setting: core.worldviewCore,
      dominantColors: core.aestheticKeywords,
      recurringMotifs: core.mysteryProfile?.differentiation_axes || [],
      styleDirection: framework.experienceDesign.toneGuardrail,
    });

    try {
      const generatedCharacters = await generateSeriesCharacters({
        title: core.title,
        genre: pickTop(core.genreAxes, "事件ミステリー"),
        tone: pickTop(core.toneKeywords, "知的"),
        premise: core.premise,
        world_setting: core.worldviewCore,
        season_goal: framework.seriesDesign.returnReason,
        design_brief: toLegacyServiceBrief(framework),
        protagonist_name: "あなた",
        protagonist_position: userRoleFrame.roleSummary,
        partner_description: framework.seriesDesign.fixedCastPolicy,
        style_guide: styleGuide,
        target_count: 2,
        mystery_profile: core.mysteryProfile,
        recent_generation_context: normalizeRecentGenerationContext(rawInput),
      });
      steps.push({
        step: "step4_generate_persistent_cast",
        status: "passed",
        input: {
          frameworkBrief: framework,
          seriesCore: core,
          userRoleFrame,
        },
        output: generatedCharacters,
        at: new Date().toISOString(),
      });
    } catch (error) {
      steps.push({
        step: "step4_generate_persistent_cast",
        status: "failed",
        input: {
          frameworkBrief: framework,
          seriesCore: core,
          userRoleFrame,
        },
        error: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
      });
    }
  } catch (error) {
    steps.push({
      step: "run",
      status: "failed",
      input: {},
      error: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString(),
    });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    prompt: rawInput.prompt,
    stepCount: steps.length,
    steps,
  };

  const outPath = "/tmp/series_v2_debug_steps_output.json";
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ outPath, lastStep: steps[steps.length - 1] }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
