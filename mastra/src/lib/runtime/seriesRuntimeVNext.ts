import { createHash, randomUUID } from "node:crypto";
import type { SeriesRuntimeEpisodeProgressEvent } from "../agents/seriesRuntimeEpisodeAgent";
import { generateSeriesRuntimeEpisode } from "../agents/seriesRuntimeEpisodeAgent";
import { generateSeriesWorkflowWithProgress, type SeriesGenerationProgressEvent } from "../../workflows/series-workflow";
import {
  buildCharacterPortraitPrompt,
  buildCoverImagePrompt,
  buildSeriesImageUrl,
  buildSeriesVisualStyleGuide,
} from "../seriesVisuals";
import {
  episodeContinuityContextSchema,
  generateEpisodeRuntimeInputSchema,
  generateEpisodeRuntimeResultSchema,
  type EpisodeContinuityContext,
  type EpisodeContinuityPatch,
  type EpisodeOutput,
  type EpisodeRuntimeRequest,
  type GenerateEpisodeRuntimeInput,
  type GenerateEpisodeRuntimeResult,
  type InitialUserSeriesStateTemplate,
  type RawSeriesGenerationRequest,
  type SeriesBlueprint,
  type SeriesCharacter,
  type SeriesGenerationResult,
  type UserSeriesState,
  rawSeriesGenerationRequestSchema,
  userSeriesStateSchema,
} from "../../schemas/series-runtime-vnext";

const clean = (value?: unknown) =>
  (typeof value === "string" ? value : String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

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

const toId = (prefix: string, seed: string) =>
  `${prefix}_${createHash("sha1").update(seed).digest("hex").slice(0, 12)}`;

const parseBulletLines = (raw?: string | null) =>
  dedupe(
    clean(raw)
      .split(/\n+/)
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
  );

const roleToVNext = (roleRaw?: string | null): SeriesCharacter["role"] => {
  const role = clean(roleRaw);
  if (/(主人公|主役|lead|メイン)/i.test(role)) return "lead";
  if (/(相棒|partner|助手|同行)/i.test(role)) return "partner";
  if (/(案内|guide|ガイド)/i.test(role)) return "guide";
  if (/(ライバル|rival|敵|対抗)/i.test(role)) return "rival";
  if (/(観測|observer|監視|記録)/i.test(role)) return "observer";
  return "other";
};

const mapLegacyCharacter = (character: any, index: number): SeriesCharacter => {
  const name = clean(character?.name) || `キャラクター${index + 1}`;
  const role = clean(character?.role) || "同行者";
  const personality = clean(character?.personality) || "静かで観察力が高い";
  const arcStart = clean(character?.arc_start || character?.arcStart);
  const arcEnd = clean(character?.arc_end || character?.arcEnd);
  const hooks = Array.isArray(character?.relationship_hooks) ? character.relationship_hooks : [];

  return {
    id: clean(character?.id) || toId("char", `${name}:${role}:${index}`),
    role: roleToVNext(role),
    displayName: name,
    archetype: clean(character?.archetype) || role,
    coreFunctionInSeries: clean(character?.goal) || `${role}として物語導線を担う`,
    identity: {
      immutableTraits: dedupe([personality]),
      mutableTraits: dedupe([arcStart, arcEnd]),
      speechStyle: dedupe([clean(character?.speech_pattern), clean(character?.catchphrase)]),
      worldview: clean(character?.drive) || "現地の見え方の差から事実を読み解く視点を持つ",
      motivationCore: clean(character?.core_desire) || clean(character?.goal) || "ユーザーとの旅で真相に近づく",
      fearOrWound: clean(character?.core_fear) || undefined,
      attractionOrAffinityToUser: clean(character?.arc_trigger) || undefined,
    },
    relationshipDesign: {
      initialDistanceToUser: arcStart || "初対面でやや距離がある",
      expectedArcWithUser: arcEnd || "話数を重ねると相互理解が深まる",
      trustProgressionHints: dedupe([arcStart, arcEnd, clean(character?.dilemma)]),
      tabooLines: [],
    },
    usageRules: {
      mustAppearFrequency: character?.must_appear ? "every_episode" : "often",
      cannotContradict: dedupe([clean(character?.backstory)]),
      reactionStyleToPlaces: dedupe([clean(character?.role), clean(character?.personality)]),
    },
    recurringHooks: {
      motifs: dedupe((character?.quirks || []) as string[]),
      conversationalHooks: dedupe(hooks),
      emotionalTriggers: dedupe([clean(character?.core_fear), clean(character?.core_desire)]),
      placeAffinity: dedupe([clean(character?.role), clean(character?.appearance)]),
    },
  };
};

const mapEndingType = (legacyContinuity: any): SeriesBlueprint["narrative"]["endingType"] => {
  const ending = clean(legacyContinuity?.finale_payoff || legacyContinuity?.finalePayoff);
  if (!ending) return "open_for_extension";
  if (/(余韻|喪失|苦味|切ない|代償)/.test(ending)) return "bittersweet";
  if (/(続く|未解決|拡張|拡散)/.test(ending)) return "open_for_extension";
  return "resolved";
};

const mapProgressionMode = (
  genreRaw?: string | null,
  desiredEmotionRaw?: string | null
): SeriesBlueprint["narrative"]["progressionMode"] => {
  const genre = clean(genreRaw);
  const desiredEmotion = clean(desiredEmotionRaw);
  if (/(恋愛|関係|絆|romance)/i.test(`${genre} ${desiredEmotion}`)) return "relationship";
  if (/(癒|回復|healing)/i.test(`${genre} ${desiredEmotion}`)) return "healing";
  if (/(任務|mission|事件|捜査)/i.test(`${genre} ${desiredEmotion}`)) return "mission";
  if (/(謎|mystery|探索|discover)/i.test(`${genre} ${desiredEmotion}`)) return "discovery";
  return "hybrid";
};

const buildSeriesBlueprint = (params: {
  raw: RawSeriesGenerationRequest;
  legacyOutput: any;
}): SeriesBlueprint => {
  const raw = params.raw;
  const output = params.legacyOutput || {};
  const series = output.series || output;
  const meta = output.meta || {};

  const title = clean(series?.title) || "灯火シリーズ";
  const overview = clean(series?.overview) || clean(series?.premise) || "現実世界を巡りながら真相へ近づく物語";
  const premise = clean(series?.premise) || overview;
  const aiRules = parseBulletLines(series?.ai_rules);
  const continuity = series?.continuity || {};
  const world = series?.world || {};
  const mysteryProfile =
    series?.mystery_profile && typeof series.mystery_profile === "object"
      ? (series.mystery_profile as Record<string, unknown>)
      : undefined;

  const characters: SeriesCharacter[] = (Array.isArray(series?.characters) ? series.characters : [])
    .slice(0, 8)
    .map((character: any, index: number) => mapLegacyCharacter(character, index));

  const checkpoints = (Array.isArray(series?.checkpoints) ? series.checkpoints : [])
    .slice(0, 12)
    .map((checkpoint: any, index: number) => ({
      index,
      label: clean(checkpoint?.title) || `Checkpoint ${index + 1}`,
      roleInArc:
        index === 0
          ? "opening"
          : index >= Math.max(1, (Array.isArray(series?.checkpoints) ? series.checkpoints.length : 0) - 1)
            ? "ending"
            : index >= Math.max(2, (Array.isArray(series?.checkpoints) ? series.checkpoints.length : 0) - 2)
              ? "pre-ending"
              : index === Math.floor(((Array.isArray(series?.checkpoints) ? series.checkpoints.length : 1) - 1) / 2)
                ? "turning_point"
                : "development",
      narrativePurpose: clean(checkpoint?.purpose) || "物語進行の節目を作る",
      expectedUserEmotion: dedupe([clean(checkpoint?.expected_emotion), clean(checkpoint?.unlock_hint)]),
      requiredProgressConditions: dedupe([clean(checkpoint?.unlock_hint)]),
      requiredCallbackKinds: [],
      mustRememberAfterPassing: dedupe([clean(checkpoint?.carry_over)]),
      expectedRelationshipMoves: dedupe([clean(checkpoint?.purpose)]),
    }));

  const firstSeedRaw = series?.first_episode_seed || {};
  const seedSpotRequirements = Array.isArray(firstSeedRaw?.spot_requirements)
    ? firstSeedRaw.spot_requirements
    : [];

  const firstEpisodeSeed: SeriesBlueprint["firstEpisodeSeed"] = {
    seedVersion: 1,
    episodeIndex: 1,
    purpose: clean(firstSeedRaw?.objective) || "シリーズ導入",
    openingSituation: clean(firstSeedRaw?.opening_scene) || "旅の入口で違和感と出会う",
    whyGoThereLogic: clean(firstSeedRaw?.completion_condition) || "導入で必要な手がかりを得るため",
    suggestedPlaceTypes: dedupe(seedSpotRequirements.map((item: any) => clean(item?.spot_role))),
    requiredSeriesCallbacks: dedupe(parseBulletLines(continuity?.global_mystery)),
    requiredCharacterAppearances: characters.slice(0, 2).map((character: SeriesCharacter) => character.id),
    relationshipMovementTarget: dedupe(["初期信頼の形成", "共通体験の獲得"]),
    foreshadowingPlan: {
      resolve: [],
      seed: dedupe([clean(firstSeedRaw?.carry_over_hint), clean(continuity?.global_mystery)]),
    },
    handoffNotesForEpisodeRuntime: dedupe([
      clean(firstSeedRaw?.route_style),
      clean(firstSeedRaw?.carry_over_hint),
    ]),
  };

  const identityPack: SeriesBlueprint["identityPack"] = {
    seriesCoreAnchors: {
      nonNegotiableTheme: dedupe([clean(series?.genre), clean(series?.tone)]),
      nonNegotiableMood: dedupe([clean(series?.tone), clean(world?.setting)]),
      nonNegotiableRelationshipDynamics: dedupe([
        clean(continuity?.global_mystery),
        clean(continuity?.mid_season_twist),
      ]),
      nonNegotiableNarrativePromises: dedupe([
        clean(continuity?.finale_payoff),
        clean(series?.season_goal),
      ]),
    },
    characterAnchors: characters.map((character: SeriesCharacter) => ({
      characterId: character.id,
      anchorSummary: `${character.displayName}は${character.coreFunctionInSeries}を担う`,
      neverBreak: dedupe([
        character.identity.worldview,
        ...character.identity.immutableTraits,
      ]),
      mayEvolve: dedupe([
        ...character.identity.mutableTraits,
        character.relationshipDesign.expectedArcWithUser,
      ]),
    })),
    continuityAnchors: {
      rememberedKindsOfEvents: dedupe([
        "keyEvents",
        "importantConversations",
        "emotionalMoments",
        ...(parseBulletLines(continuity?.episode_link_policy) || []),
      ]),
      relationshipVariables: dedupe(["trustLevel", "tensionLevel", "affectionLevel", "closenessLabel"]),
      episodeCarryOverRules: dedupe(aiRules),
      callbackPatterns: dedupe([
        "過去会話の再参照",
        "未回収伏線の進行",
        ...(parseBulletLines(continuity?.episode_link_policy) || []),
      ]),
    },
  };

  const generatedAt = new Date().toISOString();
  const desiredEpisodeLimit = clamp(
    Number.parseInt(String(raw.desiredEpisodeLimit ?? meta?.desired_episode_count ?? 8), 10) || 8,
    1,
    24
  );

  const warnings = Array.isArray(meta?.warnings) ? meta.warnings.map((item: unknown) => clean(String(item))) : [];
  const dryRun = meta?.first_episode_seed_dry_run || {};

  const continuityScore = typeof dryRun?.continuity_score === "number" ? clamp(dryRun.continuity_score, 0, 1) : 0.7;
  const readinessScore = typeof dryRun?.route_score === "number" ? clamp(dryRun.route_score, 0, 1) : 0.7;

  return {
    id: toId("series", `${title}:${generatedAt}:${randomUUID()}`),
    version: 1,
    status: "active",
    origin: {
      creationMode: "generated",
      sourcePromptSummary: clean(raw.prompt) || clean(raw.interview) || title,
      sourceInterviewDigest: dedupe([
        clean(raw.interview),
        ...(raw.explicitGenreHints || []),
        ...(raw.safetyPreferences || []),
      ]),
      generatedAt,
      modelInfo: {
        provider: "mastra",
        model: clean(meta?.workflow_version) || "series-workflow-v8-quality-pipeline",
        promptVersion: "vnext-adapter-1",
      },
    },
    concept: {
      title,
      oneLineHook: clean(series?.season_goal) || overview,
      premise,
      worldviewCore: clean(world?.setting) || clean(series?.genre) || "現実世界を巡る継続ミステリー",
      mysteryProfile: mysteryProfile
        ? {
            case_core: clean(mysteryProfile.case_core),
            investigation_style: clean(mysteryProfile.investigation_style),
            emotional_tone: clean(mysteryProfile.emotional_tone),
            duo_dynamic: clean(mysteryProfile.duo_dynamic),
            truth_nature: clean(mysteryProfile.truth_nature),
            visual_language: clean(mysteryProfile.visual_language),
            environment_layer: clean(mysteryProfile.environment_layer),
            differentiation_axes: dedupe(Array.isArray(mysteryProfile.differentiation_axes) ? mysteryProfile.differentiation_axes : []),
            banned_templates_avoided: dedupe(
              Array.isArray(mysteryProfile.banned_templates_avoided)
                ? mysteryProfile.banned_templates_avoided
                : []
            ),
          }
        : undefined,
      emotionalPromise: dedupe([
        clean(series?.tone),
        clean(raw.interview),
        clean(series?.overview),
      ]),
      toneKeywords: dedupe([clean(series?.tone), ...(world?.recurring_motifs || [])]),
      genreAxes: dedupe([clean(series?.genre), ...(raw.explicitGenreHints || [])]),
      aestheticKeywords: dedupe([
        ...(world?.recurring_motifs || []),
        clean(world?.era),
        clean(world?.social_structure),
      ]),
      returnReason:
        clean(series?.season_goal) || "固定キャラクターとの関係進展と未解決要素の回収を見届けたくなるため",
    },
    narrative: {
      longArcGoal: clean(series?.season_goal) || "各話の体験を積み重ねて結末へ収束する",
      plannedEnding: clean(continuity?.finale_payoff) || "主要な未解決要素が収束する",
      endingType: mapEndingType(continuity),
      coreMysteryOrDrive:
        clean(continuity?.global_mystery) || clean(series?.premise) || "複数地点に散らばる手掛かりをつなぐ",
      progressionMode: mapProgressionMode(series?.genre, raw.interview),
      freePlanDefaultEpisodeLimit: desiredEpisodeLimit,
    },
    worldRules: {
      hardRules: dedupe([
        "固定キャラクター同一性を維持する",
        "過去話の出来事を参照する",
        ...parseBulletLines(series?.ai_rules),
      ]),
      softRules: dedupe([clean(series?.tone), clean(series?.genre), clean(world?.core_conflict)]),
      forbiddenBreaks: dedupe([
        ...(world?.taboo_rules || []),
        ...(raw.excludedDirections || []),
      ]),
      locationAdaptationPrinciples: dedupe([
        "場所適応時も世界観コアを維持する",
        "土地性をエピソード固有キャラクターで補強する",
      ]),
    },
    characters,
    identityPack,
    checkpoints:
      checkpoints.length > 0
        ? checkpoints
        : [
            {
              index: 0,
              label: "Opening",
              roleInArc: "opening",
              narrativePurpose: "導入",
              expectedUserEmotion: ["期待"],
              requiredProgressConditions: [],
              requiredCallbackKinds: [],
              mustRememberAfterPassing: [],
              expectedRelationshipMoves: ["初期関係形成"],
            },
            {
              index: 1,
              label: "Ending",
              roleInArc: "ending",
              narrativePurpose: "収束",
              expectedUserEmotion: ["余韻"],
              requiredProgressConditions: [],
              requiredCallbackKinds: [],
              mustRememberAfterPassing: [],
              expectedRelationshipMoves: ["関係深化"],
            },
          ],
    continuityContract: {
      mandatoryMemoryKinds: dedupe([
        "keyEvents",
        "importantConversations",
        "emotionalMoments",
        ...(parseBulletLines(continuity?.episode_link_policy) || []),
      ]),
      mandatoryRelationshipVariables: dedupe(["trustLevel", "tensionLevel", "closenessLabel", "sharedMemories"]),
      mandatoryCallbackTypes: dedupe(["past_reference", "foreshadowing_progress", "relationship_callback"]),
      forbiddenContinuityBreaks: dedupe([
        "SeriesBlueprint immutable traits overwrite",
        "ending rewrite from runtime",
      ]),
      handoffFieldsToEpisodeRuntime: dedupe([
        "concept",
        "worldRules",
        "characters",
        "identityPack",
        "checkpoints",
        "continuityContract",
        "userState.currentProgress",
        "userState.rememberedExperience",
        "userState.relationshipState",
        "userState.continuityState",
      ]),
    },
    firstEpisodeSeed: firstEpisodeSeed,
    generationQuality: {
      attachmentScore: clamp(0.72 - warnings.length * 0.05, 0, 1),
      continuityScore: continuityScore,
      characterDistinctnessScore: clamp(0.75 - Math.max(0, characters.length < 2 ? 0.2 : 0), 0, 1),
      firstEpisodeReadinessScore: readinessScore,
      issues: dedupe(warnings),
      accepted: warnings.length === 0 || readinessScore >= 0.65,
    },
  };
};

const buildInitialUserSeriesStateTemplate = (
  blueprint: SeriesBlueprint
): InitialUserSeriesStateTemplate => ({
  currentProgress: {
    episodeCountCompleted: 0,
    currentCheckpointIndex: 0,
    currentArcSummary: `導入前: ${blueprint.narrative.longArcGoal}`,
    unresolvedThreads: dedupe([
      blueprint.narrative.coreMysteryOrDrive,
      ...blueprint.firstEpisodeSeed.foreshadowingPlan.seed,
    ]),
    resolvedThreads: [],
    activeForeshadowing: dedupe([
      ...blueprint.firstEpisodeSeed.foreshadowingPlan.seed,
    ]),
    completedEpisodeIds: [],
  },
  relationshipState: blueprint.characters.map((character) => ({
    characterId: character.id,
    closenessLabel: "distant",
    trustLevel: 35,
    tensionLevel: 20,
    affectionLevel: 0,
    specialFlags: [],
    sharedMemories: [],
    unresolvedEmotions: [],
  })),
  rememberedExperience: {
    visitedLocations: [],
    keyEvents: [],
    importantConversations: [],
    playerChoices: [],
    emotionalMoments: [],
    relationshipTurningPoints: [],
  },
  continuityState: {
    callbackCandidates: dedupe([
      ...blueprint.firstEpisodeSeed.requiredSeriesCallbacks,
      ...blueprint.continuityContract.mandatoryCallbackTypes,
    ]),
    motifsInUse: dedupe([
      ...blueprint.concept.aestheticKeywords,
      ...blueprint.characters.flatMap((character) => character.recurringHooks.motifs),
    ]).slice(0, 12),
    blockedLines: [],
    promisedPayoffs: dedupe([
      blueprint.narrative.plannedEnding,
      ...blueprint.firstEpisodeSeed.foreshadowingPlan.seed,
    ]),
    episodeLocalCharacterCarryovers: [],
  },
});

const buildEpisodeRuntimeBootstrapPayload = (blueprint: SeriesBlueprint) => ({
  seriesBlueprintId: blueprint.id,
  conceptDigest: [
    blueprint.concept.title,
    blueprint.concept.oneLineHook,
    blueprint.concept.premise,
  ]
    .map((part) => clean(part))
    .filter(Boolean)
    .join(" | "),
  identityPackDigest: dedupe([
    ...blueprint.identityPack.seriesCoreAnchors.nonNegotiableTheme,
    ...blueprint.identityPack.seriesCoreAnchors.nonNegotiableNarrativePromises,
    ...blueprint.identityPack.continuityAnchors.callbackPatterns,
  ]).slice(0, 16),
  checkpointDigest: blueprint.checkpoints.map(
    (checkpoint) => `${checkpoint.index + 1}. ${checkpoint.label}: ${checkpoint.narrativePurpose}`
  ),
  firstEpisodeSeed: blueprint.firstEpisodeSeed,
  mandatoryCharacters: blueprint.characters
    .filter((character) => character.usageRules.mustAppearFrequency === "every_episode")
    .map((character) => character.id),
  continuityContract: dedupe([
    ...blueprint.continuityContract.mandatoryMemoryKinds,
    ...blueprint.continuityContract.mandatoryRelationshipVariables,
    ...blueprint.continuityContract.mandatoryCallbackTypes,
  ]),
});

const buildSeriesVisualBundle = (
  legacyOutput: any
): NonNullable<SeriesGenerationResult["visualBundle"]> | undefined => {
  const output = legacyOutput || {};
  const series = output.series || output || {};
  const world = series.world || {};

  const coverImagePrompt =
    clean(series.cover_image_prompt || series.coverImagePrompt) || undefined;
  const coverImageUrl =
    clean(series.cover_image_url || series.coverImageUrl) || undefined;

  const characters = (Array.isArray(series.characters) ? series.characters : [])
    .map((character: any, index: number) => {
      const displayName = clean(character?.name || character?.displayName);
      const characterId =
        clean(character?.id) ||
        toId("char_visual", `${displayName || "char"}:${index}`);
      const portraitPrompt =
        clean(character?.portrait_prompt || character?.portraitPrompt) || undefined;
      const portraitImageUrl =
        clean(character?.portrait_image_url || character?.portraitImageUrl) || undefined;
      if (!displayName && !portraitPrompt && !portraitImageUrl) return null;
      return {
        characterId,
        displayName: displayName || `キャラクター${index + 1}`,
        portraitPrompt,
        portraitImageUrl,
      };
    })
    .filter((item: unknown): item is NonNullable<typeof item> => Boolean(item));

  const worldVisualAssets = (
    Array.isArray(world.visual_assets)
      ? world.visual_assets
      : Array.isArray(world.visualAssets)
        ? world.visualAssets
        : []
  )
    .map((asset: any, index: number) => {
      const id = clean(asset?.id) || `world_${index + 1}`;
      const title = clean(asset?.title) || `世界観ビジュアル ${index + 1}`;
      const description =
        clean(asset?.description) || "世界観の雰囲気を示すビジュアル。";
      const prompt = clean(asset?.prompt) || undefined;
      const imageUrl =
        clean(asset?.image_url || asset?.imageUrl) || undefined;
      if (!prompt && !imageUrl && !description) return null;
      return {
        id,
        title,
        description,
        prompt,
        imageUrl,
      };
    })
    .filter((item: unknown): item is NonNullable<typeof item> => Boolean(item));

  const coverConsistencyRaw =
    series.cover_consistency_report &&
    typeof series.cover_consistency_report === "object"
      ? (series.cover_consistency_report as Record<string, unknown>)
      : undefined;

  if (
    !coverImagePrompt &&
    !coverImageUrl &&
    characters.length === 0 &&
    worldVisualAssets.length === 0 &&
    !coverConsistencyRaw
  ) {
    return undefined;
  }

  return {
    coverImagePrompt,
    coverImageUrl,
    characters: characters.length > 0 ? characters : undefined,
    worldVisualAssets: worldVisualAssets.length > 0 ? worldVisualAssets : undefined,
    coverConsistencyReport: coverConsistencyRaw,
  };
};

const toLegacySeriesGenerationInput = (raw: RawSeriesGenerationRequest) => {
  const prompt = clean(raw.prompt);
  const interview = clean(raw.interview);
  const genreHint = dedupe(raw.explicitGenreHints || []).join(" / ");

  return {
    interview: {
      genre_world: genreHint || prompt || interview || "現代日本の現実拡張型・外出周遊ミステリー",
      desired_emotion: interview || "余韻と発見",
      companion_preference: "固定キャラクターと継続対話したい",
      continuation_trigger: "前話の伏線が次話で進むこと",
      avoidance_preferences: dedupe([...(raw.excludedDirections || []), ...(raw.safetyPreferences || [])]).join(" / "),
      additional_notes: dedupe([interview, prompt]).join(" / "),
      visual_style_preset: "cinematic-anime",
      visual_style_notes: "土地性と情緒を両立",
    },
    desired_episode_count: clamp(
      Number.parseInt(String(raw.desiredEpisodeLimit ?? 8), 10) || 8,
      3,
      24
    ),
    prompt: prompt || undefined,
    language: "ja",
    generation_mode: "full" as const,
    recent_generation_context: {
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
    },
  };
};

export const generateSeriesGenerationResultVNext = async (
  rawInput: RawSeriesGenerationRequest,
  options: {
    onProgress?: (event: SeriesGenerationProgressEvent) => void | Promise<void>;
  } = {}
): Promise<SeriesGenerationResult> => {
  const parsed = rawSeriesGenerationRequestSchema.parse(rawInput);
  const legacyInput = toLegacySeriesGenerationInput(parsed);
  const legacyOutput = await generateSeriesWorkflowWithProgress(legacyInput, {
    onProgress: options.onProgress,
  });

  return buildSeriesGenerationResultVNextFromLegacyOutput(parsed, legacyOutput);
};

export const buildSeriesGenerationResultVNextFromLegacyOutput = (
  rawInput: RawSeriesGenerationRequest,
  legacyOutput: any
): SeriesGenerationResult => {
  const parsed = rawSeriesGenerationRequestSchema.parse(rawInput);
  const seriesBlueprint = buildSeriesBlueprint({
    raw: parsed,
    legacyOutput,
  });

  const initialUserSeriesStateTemplate = buildInitialUserSeriesStateTemplate(seriesBlueprint);
  const episodeRuntimeBootstrapPayload = buildEpisodeRuntimeBootstrapPayload(seriesBlueprint);
  const visualBundle = buildSeriesVisualBundle(legacyOutput);

  return {
    workflowVersion: "series-generation-vnext-adapter-1",
    seriesBlueprint,
    initialUserSeriesStateTemplate,
    episodeRuntimeBootstrapPayload,
    ...(visualBundle ? { visualBundle } : {}),
  };
};

const arcRoleFromCheckpoint = (
  blueprint: SeriesBlueprint,
  checkpointIndex: number
): "opening" | "development" | "turning_point" | "pre-ending" | "ending" => {
  if (blueprint.checkpoints.length === 0) return "development";
  const safeIndex = clamp(checkpointIndex, 0, blueprint.checkpoints.length - 1);
  return blueprint.checkpoints[safeIndex].roleInArc;
};

const buildEpisodeContinuityContext = (input: GenerateEpisodeRuntimeInput): EpisodeContinuityContext => {
  const { userSeriesState, seriesBlueprint } = input;
  const episodeIndex = userSeriesState.currentProgress.episodeCountCompleted + 1;
  const memoriesToSurface = dedupe([
    ...userSeriesState.rememberedExperience.keyEvents.slice(-2),
    ...userSeriesState.rememberedExperience.importantConversations.slice(-2),
    ...userSeriesState.rememberedExperience.emotionalMoments.slice(-1),
  ]).slice(0, 5);

  const totalCheckpointCount = Math.max(1, seriesBlueprint.checkpoints.length);
  const nearingEnding =
    userSeriesState.currentProgress.currentCheckpointIndex >= Math.max(0, totalCheckpointCount - 2);

  const foreshadowingToResolve = dedupe(
    userSeriesState.currentProgress.activeForeshadowing.slice(0, nearingEnding ? 3 : 1)
  );

  const foreshadowingToSeed = dedupe([
    ...seriesBlueprint.firstEpisodeSeed.foreshadowingPlan.seed,
    ...seriesBlueprint.continuityContract.mandatoryCallbackTypes,
  ])
    .filter((item) => !foreshadowingToResolve.includes(item))
    .slice(0, 2);

  const callbacksToUse = dedupe([
    ...userSeriesState.continuityState.callbackCandidates,
    ...seriesBlueprint.identityPack.continuityAnchors.callbackPatterns,
  ]).slice(0, 4);

  const relationshipTargets = userSeriesState.relationshipState.slice(0, 3).map((relationship) => ({
    characterId: relationship.characterId,
    currentStateSummary: `${relationship.closenessLabel} / trust=${relationship.trustLevel.toFixed(0)} / tension=${relationship.tensionLevel.toFixed(0)}`,
    targetMovement:
      relationship.trustLevel < 55
        ? "trust_up"
        : relationship.tensionLevel > 45
          ? "tension_down"
          : "affection_up",
  }));

  return episodeContinuityContextSchema.parse({
    episodeIndex,
    currentCheckpointIndex: userSeriesState.currentProgress.currentCheckpointIndex,
    memoriesToSurface,
    callbacksToUse,
    foreshadowingToResolve,
    foreshadowingToSeed,
    activeThreadsToAdvance: userSeriesState.currentProgress.unresolvedThreads.slice(0, 3),
    relationshipTargets,
    forbiddenBreaks: seriesBlueprint.continuityContract.forbiddenContinuityBreaks,
  });
};

const toLegacyRuntimeInput = (
  input: GenerateEpisodeRuntimeInput,
  continuityContext: EpisodeContinuityContext
) => {
  const { request, seriesBlueprint, userSeriesState } = input;
  const idToCharacter = new Map(seriesBlueprint.characters.map((character) => [character.id, character]));

  const relationshipSummary = userSeriesState.relationshipState
    .slice(0, 3)
    .map((relationship) => {
      const character = idToCharacter.get(relationship.characterId);
      return `${character?.displayName || relationship.characterId}:${relationship.closenessLabel}(trust ${relationship.trustLevel.toFixed(0)})`;
    })
    .join(" / ");

  const userWishes = dedupe([
    ...(request.episodeRequest.desiredMoodToday || []),
    ...(request.episodeRequest.physicalConstraints || []),
    ...(request.episodeRequest.avoidThemes || []).map((theme) => `avoid:${theme}`),
    ...continuityContext.memoriesToSurface.map((memory) => `memory:${memory}`),
  ]).join(" / ");

  const desiredSpotsRaw =
    request.runtimeOptions?.maxSpots ||
    request.runtimeOptions?.minSpots ||
    request.episodeRequest.locationContext.candidateSpots?.length ||
    5;

  const desiredDurationRaw =
    request.episodeRequest.locationContext.availableMinutes || Math.max(20, desiredSpotsRaw * 20);

  const legacyCheckpointRows = seriesBlueprint.checkpoints.map((checkpoint, index) => ({
    checkpoint_no: index + 1,
    title: checkpoint.label,
    purpose: checkpoint.narrativePurpose,
    unlock_hint: checkpoint.requiredProgressConditions.join(" / "),
    carry_over: checkpoint.mustRememberAfterPassing.join(" / "),
  }));

  const mandatoryIds = new Set(
    seriesBlueprint.characters
      .filter((character) => character.usageRules.mustAppearFrequency === "every_episode")
      .map((character) => character.id)
  );

  return {
    series: {
      title: seriesBlueprint.concept.title,
      overview: seriesBlueprint.concept.oneLineHook,
      premise: seriesBlueprint.concept.premise,
      season_goal: seriesBlueprint.narrative.longArcGoal,
      ai_rules: dedupe([
        ...seriesBlueprint.worldRules.hardRules,
        ...seriesBlueprint.continuityContract.mandatoryCallbackTypes,
      ]).join("\n"),
      world_setting: seriesBlueprint.concept.worldviewCore,
      continuity: {
        global_mystery: seriesBlueprint.narrative.coreMysteryOrDrive,
        mid_season_twist: seriesBlueprint.checkpoints
          .find((checkpoint) => checkpoint.roleInArc === "turning_point")
          ?.narrativePurpose,
        finale_payoff: seriesBlueprint.narrative.plannedEnding,
        invariant_rules: seriesBlueprint.worldRules.hardRules,
        episode_link_policy: seriesBlueprint.identityPack.continuityAnchors.episodeCarryOverRules,
      },
      progress_state: {
        last_completed_episode_no: userSeriesState.currentProgress.episodeCountCompleted,
        unresolved_threads: userSeriesState.currentProgress.unresolvedThreads,
        revealed_facts: userSeriesState.currentProgress.resolvedThreads,
        relationship_state_summary: relationshipSummary || "関係性は導入段階",
        relationship_flags: dedupe(userSeriesState.relationshipState.flatMap((relationship) => relationship.specialFlags)),
        recent_relation_shift: userSeriesState.rememberedExperience.relationshipTurningPoints.slice(-5),
        companion_trust_level:
          userSeriesState.relationshipState.length > 0
            ? Math.round(
                userSeriesState.relationshipState.reduce((sum, relationship) => sum + relationship.trustLevel, 0) /
                  userSeriesState.relationshipState.length
              )
            : 40,
        next_hook:
          userSeriesState.currentProgress.activeForeshadowing[0] ||
          seriesBlueprint.firstEpisodeSeed.foreshadowingPlan.seed[0] ||
          "次話へ続く問い",
      },
      first_episode_seed: {
        title: `${seriesBlueprint.concept.title} 第1話`,
        objective: seriesBlueprint.firstEpisodeSeed.purpose,
        opening_scene: seriesBlueprint.firstEpisodeSeed.openingSituation,
        expected_duration_minutes: clamp(request.episodeRequest.locationContext.availableMinutes || 30, 10, 45),
        route_style: "mixed",
        movement_style: "現地の自然な移動手段を含む周遊",
        completion_condition: seriesBlueprint.firstEpisodeSeed.whyGoThereLogic,
        carry_over_hint:
          seriesBlueprint.firstEpisodeSeed.foreshadowingPlan.seed[0] ||
          seriesBlueprint.narrative.coreMysteryOrDrive,
        spot_requirements: seriesBlueprint.firstEpisodeSeed.suggestedPlaceTypes.slice(0, 4).map((spotRole, index) => {
          const sceneRole: "起" | "承" | "転" | "結" =
            index === 0 ? "起" : index >= 3 ? "結" : index === 1 ? "承" : "転";
          return {
            requirement_id: `seed_req_${index + 1}`,
            scene_role: sceneRole,
            spot_role: spotRole,
            required_attributes: [] as string[],
            visit_constraints: [] as string[],
            tourism_value_type: "地域体験",
          };
        }),
        suggested_spots: request.episodeRequest.locationContext.candidateSpots || [],
      },
      checkpoints: legacyCheckpointRows,
      characters: seriesBlueprint.characters.map((character) => ({
        name: character.displayName,
        role: character.coreFunctionInSeries,
        tier: mandatoryIds.has(character.id) ? ("primary" as const) : ("secondary" as const),
        must_appear: mandatoryIds.has(character.id),
        personality: dedupe([
          ...character.identity.immutableTraits,
          ...character.identity.mutableTraits,
        ]).join(" / "),
        arc_start: character.relationshipDesign.initialDistanceToUser,
        arc_end: character.relationshipDesign.expectedArcWithUser,
      })),
      recent_episodes: userSeriesState.currentProgress.completedEpisodeIds.slice(-3).map((episodeId, index) => ({
        episode_no: Math.max(1, userSeriesState.currentProgress.episodeCountCompleted - 2 + index),
        title: episodeId,
        summary: "過去話のサマリー",
      })),
    },
    episode_request: {
      stage_location: request.episodeRequest.locationContext.cityOrArea,
      purpose: request.episodeRequest.tourismGoal,
      user_wishes: userWishes || undefined,
      desired_spot_count: clamp(desiredSpotsRaw, 5, 7),
      desired_duration_minutes: clamp(desiredDurationRaw, 10, 45),
      language: "ja",
    },
  };
};

const sceneRoleMap = (legacyRole: string, index: number, total: number) => {
  const role = clean(legacyRole);
  if (role === "起") return "opening" as const;
  if (role === "結") return "ending" as const;
  if (role === "転") return "turn" as const;
  if (role === "承") return index < total / 2 ? ("discovery" as const) : ("encounter" as const);
  return index === 0 ? ("opening" as const) : index === total - 1 ? ("ending" as const) : ("reveal" as const);
};

const resolveEpisodeVisualGenre = (blueprint: SeriesBlueprint) =>
  clean(blueprint.concept.genreAxes[0]) || clean(blueprint.concept.oneLineHook) || "serial travel mystery";

const resolveEpisodeVisualTone = (blueprint: SeriesBlueprint) =>
  clean(blueprint.concept.toneKeywords[0]) || clean(blueprint.concept.emotionalPromise[0]) || "cinematic emotional";

const buildEpisodeVisualStyleGuide = (params: {
  input: GenerateEpisodeRuntimeInput;
  legacyEpisode: any;
}) => {
  const { input, legacyEpisode } = params;
  return buildSeriesVisualStyleGuide({
    seriesTitle: `${input.seriesBlueprint.concept.title} ${clean(legacyEpisode?.title)}`.trim(),
    genre: resolveEpisodeVisualGenre(input.seriesBlueprint),
    tone: resolveEpisodeVisualTone(input.seriesBlueprint),
    setting:
      clean(input.request.episodeRequest.locationContext.cityOrArea) ||
      clean(input.seriesBlueprint.concept.worldviewCore) ||
      "city district",
    dominantColors: input.seriesBlueprint.concept.aestheticKeywords.slice(0, 3),
    recurringMotifs: input.seriesBlueprint.identityPack.continuityAnchors.callbackPatterns.slice(0, 2),
  });
};

const ensureEpisodeLocalCharacterPortraits = (params: {
  input: GenerateEpisodeRuntimeInput;
  legacyEpisode: any;
  localCharacters: EpisodeOutput["localCharactersIntroduced"];
  styleGuide: string;
}): EpisodeOutput["localCharactersIntroduced"] => {
  const { input, legacyEpisode, localCharacters, styleGuide } = params;
  const genre = resolveEpisodeVisualGenre(input.seriesBlueprint);
  const tone = resolveEpisodeVisualTone(input.seriesBlueprint);
  const setting =
    clean(input.request.episodeRequest.locationContext.cityOrArea) ||
    clean(input.seriesBlueprint.concept.worldviewCore) ||
    "city district";
  const episodeIndex = input.userSeriesState.currentProgress.episodeCountCompleted + 1;

  return localCharacters.map((character, index) => {
    const seedKeyBase = [
      input.seriesBlueprint.id,
      "episode",
      episodeIndex,
      clean(legacyEpisode?.title) || `episode_${episodeIndex}`,
      "local",
      character.localCharacterId || `char_${index + 1}`,
    ]
      .map((item) => clean(String(item)))
      .filter(Boolean)
      .join(":");

    const portraitPrompt =
      clean(character.portraitPrompt) ||
      buildCharacterPortraitPrompt({
        seriesTitle: input.seriesBlueprint.concept.title,
        genre,
        tone,
        name: character.displayName,
        role: character.roleInEpisode,
        personality: character.personalityTraits.join(" / "),
        appearance: dedupe([character.archetype, character.relationToSpot]).join(" / "),
        setting,
        distinguishingFeature: character.relationToSeriesTheme,
        styleGuide,
      });

    const portraitImageUrl =
      clean(character.portraitImageUrl) ||
      buildSeriesImageUrl({
        prompt: portraitPrompt,
        seedKey: `${seedKeyBase}:portrait`,
        width: 768,
        height: 1024,
        purpose: "character_portrait",
      });

    return {
      ...character,
      portraitPrompt: portraitPrompt || undefined,
      portraitImageUrl: portraitImageUrl || undefined,
    };
  });
};

const buildEpisodeCoverVisual = (params: {
  input: GenerateEpisodeRuntimeInput;
  legacyEpisode: any;
  localCharacters: EpisodeOutput["localCharactersIntroduced"];
  fixedCharactersAppeared: string[];
  selectedSpots: EpisodeOutput["selectedSpots"];
  styleGuide: string;
}) => {
  const {
    input,
    legacyEpisode,
    localCharacters,
    fixedCharactersAppeared,
    selectedSpots,
    styleGuide,
  } = params;
  const episodeIndex = input.userSeriesState.currentProgress.episodeCountCompleted + 1;
  const episodeTitle = clean(legacyEpisode?.title) || `第${episodeIndex}話`;
  const stageLocation =
    clean(input.request.episodeRequest.locationContext.cityOrArea) ||
    clean(input.seriesBlueprint.concept.worldviewCore) ||
    "city district";
  const genre = resolveEpisodeVisualGenre(input.seriesBlueprint);
  const tone = resolveEpisodeVisualTone(input.seriesBlueprint);

  const seriesCharacterById = new Map(
    input.seriesBlueprint.characters.map((character) => [character.id, character])
  );

  const focusFixed = fixedCharactersAppeared.slice(0, 2).map((characterId) => {
    const character = seriesCharacterById.get(characterId);
    return {
      name: character?.displayName || characterId,
      role: character?.coreFunctionInSeries || "series companion",
      focusReason: "series continuity anchor",
      visualAnchor: dedupe([
        ...(character?.identity.immutableTraits || []),
        ...(character?.recurringHooks.motifs || []),
      ])
        .slice(0, 2)
        .join(" / "),
    };
  });

  const focusLocal = localCharacters.slice(0, 2).map((character) => ({
    name: character.displayName,
    role: character.roleInEpisode,
    focusReason: "episode-local freshness anchor",
    visualAnchor: dedupe([character.archetype, ...character.personalityTraits]).slice(0, 2).join(" / "),
  }));

  const focusCharacters = dedupe([
    ...focusFixed.map((row) => `${row.name}::${row.role}::${row.focusReason}::${row.visualAnchor}`),
    ...focusLocal.map((row) => `${row.name}::${row.role}::${row.focusReason}::${row.visualAnchor}`),
  ])
    .slice(0, 3)
    .map((packed) => {
      const [name, role, focusReason, visualAnchor] = packed.split("::");
      return {
        name: clean(name),
        role: clean(role),
        focusReason: clean(focusReason),
        visualAnchor: clean(visualAnchor),
      };
    });

  const coverImagePrompt =
    clean(legacyEpisode?.cover_image_prompt || legacyEpisode?.coverImagePrompt) ||
    buildCoverImagePrompt({
      title: `${input.seriesBlueprint.concept.title} ${episodeTitle}`,
      genre,
      tone,
      premise:
        clean(legacyEpisode?.one_liner) ||
        clean(legacyEpisode?.summary) ||
        clean(input.request.episodeRequest.tourismGoal) ||
        "episode journey",
      setting: stageLocation,
      styleGuide,
      dominantColors: input.seriesBlueprint.concept.aestheticKeywords.slice(0, 3),
      recurringMotifs: input.seriesBlueprint.identityPack.continuityAnchors.callbackPatterns.slice(0, 2),
      focusCharacters,
      additionalDirection: dedupe([
        clean(input.request.episodeRequest.tourismGoal),
        ...selectedSpots.slice(0, 3).map((spot) => spot.spotName),
        clean(legacyEpisode?.carry_over_hook),
      ]).join(" / "),
    });

  const coverImageUrl =
    clean(legacyEpisode?.cover_image_url || legacyEpisode?.coverImageUrl) ||
    buildSeriesImageUrl({
      prompt: coverImagePrompt,
      seedKey: [
        input.seriesBlueprint.id,
        "episode",
        episodeIndex,
        episodeTitle,
        stageLocation,
      ]
        .map((item) => clean(String(item)))
        .filter(Boolean)
        .join(":"),
      width: 1280,
      height: 720,
      purpose: "cover",
      styleReference: styleGuide,
    });

  return {
    coverImagePrompt: coverImagePrompt || undefined,
    coverImageUrl: coverImageUrl || undefined,
  };
};

const computeCheckpointIndexAfterEpisode = (input: GenerateEpisodeRuntimeInput) => {
  const { userSeriesState, seriesBlueprint } = input;
  if (seriesBlueprint.checkpoints.length === 0) return 0;
  const nextEpisodeCount = userSeriesState.currentProgress.episodeCountCompleted + 1;
  const total = Math.max(1, seriesBlueprint.narrative.freePlanDefaultEpisodeLimit);
  const ratio = clamp(nextEpisodeCount / total, 0, 1);
  const computed = Math.floor(ratio * (seriesBlueprint.checkpoints.length - 1));
  return Math.max(userSeriesState.currentProgress.currentCheckpointIndex, computed);
};

const buildContinuityPatch = (params: {
  input: GenerateEpisodeRuntimeInput;
  continuityContext: EpisodeContinuityContext;
  legacyEpisode: any;
  localCharacters: EpisodeOutput["localCharactersIntroduced"];
  selectedSpots: EpisodeOutput["selectedSpots"];
}): EpisodeContinuityPatch => {
  const { input, continuityContext, legacyEpisode, localCharacters, selectedSpots } = params;
  const progressPatch = legacyEpisode?.progress_patch || {};
  const trustDelta = Number(progressPatch?.companion_trust_delta || 0);

  const relationshipPatch = continuityContext.relationshipTargets.map((target, index) => ({
    characterId: target.characterId,
    closenessDelta: target.targetMovement === "trust_up" ? 1 : target.targetMovement === "tension_down" ? 0 : 1,
    trustDelta: target.targetMovement === "trust_up" ? (trustDelta || 2) : trustDelta || 1,
    tensionDelta: target.targetMovement === "tension_down" ? -2 : -1,
    affectionDelta: target.targetMovement === "affection_up" ? 1 : undefined,
    newRelationshipState: target.targetMovement,
    keyMomentSummary: `${target.characterId}との関係が${target.targetMovement}方向に変化`,
  }));

  const resolvedForeshadowing = dedupe([
    ...continuityContext.foreshadowingToResolve.slice(0, 1),
  ]);

  const newlySeeded = dedupe([
    ...continuityContext.foreshadowingToSeed,
    clean(legacyEpisode?.carry_over_hook),
  ]).slice(0, 3);

  return {
    memoryPatch: {
      addedEvents: dedupe([
        clean(legacyEpisode?.title),
        ...selectedSpots.map((spot) => `${spot.spotName}での進展`),
      ]),
      addedSharedMemories: dedupe([
        ...continuityContext.memoriesToSurface,
        clean(legacyEpisode?.one_liner),
      ]).slice(0, 5),
      addedLocationMemories: selectedSpots.map((spot) => spot.spotName),
      addedConversations: dedupe([
        clean(progressPatch?.relationship_state_summary),
      ]).slice(0, 4),
    },
    relationshipPatch,
    payoffPatch: {
      resolvedForeshadowing,
      newlySeededForeshadowing: newlySeeded,
      activeThreads: dedupe([
        ...input.userSeriesState.currentProgress.unresolvedThreads,
        ...continuityContext.activeThreadsToAdvance,
        ...newlySeeded,
      ]),
      closedThreads: dedupe(resolvedForeshadowing),
    },
    arcPatch: {
      checkpointProgress: `${computeCheckpointIndexAfterEpisode(input) + 1}/${Math.max(1, input.seriesBlueprint.checkpoints.length)}`,
      currentCheckpointIndexAfterEpisode: computeCheckpointIndexAfterEpisode(input),
      approachToEnding:
        computeCheckpointIndexAfterEpisode(input) >= Math.max(0, input.seriesBlueprint.checkpoints.length - 2)
          ? "ending_near"
          : undefined,
      arcSummaryAfterEpisode:
        clean(legacyEpisode?.summary) ||
        `${input.request.episodeRequest.locationContext.cityOrArea}で関係性と未回収要素が進んだ`,
    },
    localCharacterPatch: {
      introduced: localCharacters,
      callbackEligible: localCharacters
        .filter((character) => character.callbackEligible)
        .map((character) => ({
          localCharacterId: character.localCharacterId,
          reason: "土地性と物語接続の両面で再登場余地がある",
        })),
    },
  };
};

type EpisodeOutputValidationResult = {
  episodeOutput: EpisodeOutput;
  warnings: string[];
  issues: string[];
};

const validateFixedCharacterIdentity = (params: {
  input: GenerateEpisodeRuntimeInput;
  episodeOutput: EpisodeOutput;
}): EpisodeOutputValidationResult => {
  const { input } = params;
  let episodeOutput = params.episodeOutput;
  const warnings: string[] = [];
  const issues: string[] = [];

  const seriesCharacterById = new Map(
    input.seriesBlueprint.characters.map((character) => [character.id, character])
  );
  const relationshipById = new Map(
    input.userSeriesState.relationshipState.map((relationship) => [relationship.characterId, relationship])
  );

  const mandatoryEveryEpisode = input.seriesBlueprint.characters
    .filter((character) => character.usageRules.mustAppearFrequency === "every_episode")
    .map((character) => character.id);
  const requiredCharacterIds =
    mandatoryEveryEpisode.length > 0
      ? mandatoryEveryEpisode
      : input.seriesBlueprint.characters.slice(0, 1).map((character) => character.id);

  const buildSceneFixedCharacter = (
    characterId: string,
    roleInScene: string
  ): EpisodeOutput["scenes"][number]["fixedCharacters"][number] => {
    const character = seriesCharacterById.get(characterId);
    const relationship = relationshipById.get(characterId);
    return {
      characterId,
      displayName: character?.displayName || characterId,
      roleInScene: clean(roleInScene) || "同行と対話",
      emotionalState: relationship?.closenessLabel || "stable",
      relationshipToUserNow: relationship
        ? `trust=${relationship.trustLevel.toFixed(0)} / tension=${relationship.tensionLevel.toFixed(0)}`
        : "初期状態",
      linesStyleGuard: dedupe(character?.identity.speechStyle || []),
    };
  };

  let appearedFixedCharacterIds = dedupe([
    ...episodeOutput.fixedCharactersAppeared,
    ...episodeOutput.scenes.flatMap((scene) =>
      scene.fixedCharacters.map((character) => character.characterId)
    ),
  ]).filter((characterId) => seriesCharacterById.has(characterId));

  for (const requiredCharacterId of requiredCharacterIds) {
    if (appearedFixedCharacterIds.includes(requiredCharacterId)) continue;
    appearedFixedCharacterIds = dedupe([...appearedFixedCharacterIds, requiredCharacterId]);
    warnings.push(`required_fixed_character_added:${requiredCharacterId}`);
  }

  const fallbackCharacterId = appearedFixedCharacterIds[0] || requiredCharacterIds[0] || "";
  if (!fallbackCharacterId && input.seriesBlueprint.characters.length > 0) {
    issues.push("fixed_character_fallback_not_found");
  }

  const normalizedScenes = episodeOutput.scenes.map((scene, index) => {
    const normalizedFixedCharacters = dedupe(
      scene.fixedCharacters.map((character) => character.characterId)
    )
      .filter((characterId) => seriesCharacterById.has(characterId))
      .map((characterId) => {
        const existing = scene.fixedCharacters.find(
          (character) => character.characterId === characterId
        );
        const fallback = buildSceneFixedCharacter(
          characterId,
          clean(existing?.roleInScene) || "同行と対話"
        );
        return {
          ...fallback,
          displayName: clean(existing?.displayName) || fallback.displayName,
          roleInScene: clean(existing?.roleInScene) || fallback.roleInScene,
          emotionalState: clean(existing?.emotionalState) || fallback.emotionalState,
          relationshipToUserNow:
            clean(existing?.relationshipToUserNow) || fallback.relationshipToUserNow,
          linesStyleGuard:
            Array.isArray(existing?.linesStyleGuard) && existing.linesStyleGuard.length > 0
              ? dedupe(existing.linesStyleGuard)
              : fallback.linesStyleGuard,
        };
      });

    if (normalizedFixedCharacters.length > 0 || !fallbackCharacterId) {
      return {
        ...scene,
        fixedCharacters: normalizedFixedCharacters,
      };
    }

    warnings.push(`scene_fixed_character_injected:${index + 1}`);
    return {
      ...scene,
      fixedCharacters: [
        buildSceneFixedCharacter(
          fallbackCharacterId,
          index === 0 ? "導入で同行" : "同行と対話"
        ),
      ],
    };
  });

  const normalizedAppearedFixedCharacterIds = dedupe([
    ...appearedFixedCharacterIds,
    ...normalizedScenes.flatMap((scene) =>
      scene.fixedCharacters.map((character) => character.characterId)
    ),
  ]).filter((characterId) => seriesCharacterById.has(characterId));

  if (
    input.seriesBlueprint.characters.length > 0 &&
    normalizedAppearedFixedCharacterIds.length === 0
  ) {
    issues.push("fixed_characters_absent");
  }

  if (normalizedScenes.some((scene) => scene.fixedCharacters.length === 0)) {
    issues.push("scene_without_fixed_character");
  }

  episodeOutput = {
    ...episodeOutput,
    fixedCharactersAppeared: normalizedAppearedFixedCharacterIds,
    scenes: normalizedScenes,
  };

  return {
    episodeOutput,
    warnings,
    issues,
  };
};

const validateCallbackAndPayoff = (params: {
  input: GenerateEpisodeRuntimeInput;
  continuityContext: EpisodeContinuityContext;
  episodeOutput: EpisodeOutput;
}): EpisodeOutputValidationResult => {
  const { input, continuityContext } = params;
  let episodeOutput = params.episodeOutput;
  const warnings: string[] = [];
  const issues: string[] = [];

  let scenes = episodeOutput.scenes.map((scene, index) => {
    const nextSpotReason =
      clean(scene.progression.nextSpotReason) ||
      clean(scene.narration.outro) ||
      (index < episodeOutput.scenes.length - 1
        ? `${episodeOutput.scenes[index + 1].spotName}へ向かう理由が生まれる。`
        : "次話へ接続する余韻が生まれる。");

    if (!clean(scene.progression.nextSpotReason)) {
      warnings.push(`scene_next_spot_reason_filled:${index + 1}`);
    }

    return {
      ...scene,
      progression: {
        ...scene.progression,
        nextSpotReason,
      },
    };
  });

  const hasPastReferences = scenes.some(
    (scene) =>
      scene.continuity.callbacksToPastEpisodes.length > 0 ||
      scene.continuity.memoryReferences.length > 0
  );

  if (!hasPastReferences && scenes.length > 0) {
    const fallbackCallback =
      continuityContext.callbacksToUse[0] ||
      input.userSeriesState.continuityState.callbackCandidates[0] ||
      input.userSeriesState.rememberedExperience.keyEvents[0] ||
      "";
    const fallbackMemory =
      continuityContext.memoriesToSurface[0] ||
      input.userSeriesState.rememberedExperience.importantConversations[0] ||
      "";

    scenes = scenes.map((scene, index) =>
      index !== 0
        ? scene
        : {
            ...scene,
            continuity: {
              ...scene.continuity,
              callbacksToPastEpisodes: dedupe([
                ...scene.continuity.callbacksToPastEpisodes,
                fallbackCallback,
              ]),
              memoryReferences: dedupe([
                ...scene.continuity.memoryReferences,
                fallbackMemory,
              ]),
            },
          }
    );
    warnings.push("past_reference_injected");
  }

  const payoffPatch = episodeOutput.continuityPatch.payoffPatch;
  let resolvedForeshadowing = dedupe(payoffPatch.resolvedForeshadowing);
  let newlySeededForeshadowing = dedupe(payoffPatch.newlySeededForeshadowing);

  if (resolvedForeshadowing.length === 0) {
    const fallbackResolved = continuityContext.foreshadowingToResolve[0] || "";
    if (fallbackResolved) {
      resolvedForeshadowing = [fallbackResolved];
      warnings.push("resolved_foreshadowing_injected");
    }
  }

  if (newlySeededForeshadowing.length === 0) {
    const fallbackSeeded =
      continuityContext.foreshadowingToSeed[0] ||
      clean(episodeOutput.ending.nextEpisodeHook) ||
      "";
    if (fallbackSeeded) {
      newlySeededForeshadowing = [fallbackSeeded];
      warnings.push("seeded_foreshadowing_injected");
    }
  }

  newlySeededForeshadowing = newlySeededForeshadowing.filter(
    (item) =>
      !resolvedForeshadowing.some(
        (resolved) => resolved.toLowerCase() === item.toLowerCase()
      )
  );

  const closedThreads = dedupe([
    ...payoffPatch.closedThreads,
    ...resolvedForeshadowing,
  ]);
  const activeThreads = dedupe([
    ...payoffPatch.activeThreads,
    ...newlySeededForeshadowing,
  ]).filter(
    (item) =>
      !closedThreads.some((closed) => closed.toLowerCase() === item.toLowerCase())
  );

  const nextEpisodeHook =
    clean(episodeOutput.ending.nextEpisodeHook) ||
    newlySeededForeshadowing[0] ||
    continuityContext.foreshadowingToSeed[0] ||
    "次話で確かめるべき問いが残る。";
  if (!clean(episodeOutput.ending.nextEpisodeHook)) {
    warnings.push("next_episode_hook_filled");
  }

  if (scenes.length > 0) {
    const firstSeed = newlySeededForeshadowing[0];
    const firstResolved = resolvedForeshadowing[0];
    const lastIndex = scenes.length - 1;
    scenes = scenes.map((scene, index) => {
      if (index !== lastIndex) return scene;
      return {
        ...scene,
        continuity: {
          ...scene.continuity,
          foreshadowingAdded: dedupe([
            ...scene.continuity.foreshadowingAdded,
            firstSeed,
          ]),
          foreshadowingResolved: dedupe([
            ...scene.continuity.foreshadowingResolved,
            firstResolved,
          ]),
        },
      };
    });
  }

  const hasForeshadowingMotion =
    resolvedForeshadowing.length > 0 || newlySeededForeshadowing.length > 0;
  if (!hasForeshadowingMotion) {
    issues.push("foreshadowing_motion_absent");
  }

  const hasSceneLinks = scenes.every(
    (scene) => clean(scene.progression.nextSpotReason).length > 0
  );
  if (!hasSceneLinks) {
    issues.push("next_spot_reason_absent");
  }

  const hasCallbacksAfterPatch = scenes.some(
    (scene) =>
      scene.continuity.callbacksToPastEpisodes.length > 0 ||
      scene.continuity.memoryReferences.length > 0
  );
  if (
    input.userSeriesState.currentProgress.episodeCountCompleted > 0 &&
    !hasCallbacksAfterPatch
  ) {
    issues.push("past_callback_absent");
  }

  if (!clean(nextEpisodeHook)) {
    issues.push("next_episode_hook_absent");
  }

  episodeOutput = {
    ...episodeOutput,
    scenes,
    ending: {
      ...episodeOutput.ending,
      nextEpisodeHook: nextEpisodeHook,
    },
    continuityPatch: {
      ...episodeOutput.continuityPatch,
      payoffPatch: {
        ...episodeOutput.continuityPatch.payoffPatch,
        resolvedForeshadowing,
        newlySeededForeshadowing,
        activeThreads,
        closedThreads,
      },
    },
  };

  return {
    episodeOutput,
    warnings,
    issues,
  };
};

const validateEpisodeOutput = (params: {
  input: GenerateEpisodeRuntimeInput;
  continuityContext: EpisodeContinuityContext;
  episodeOutput: EpisodeOutput;
}): EpisodeOutputValidationResult => {
  const fixedCharacterValidation = validateFixedCharacterIdentity({
    input: params.input,
    episodeOutput: params.episodeOutput,
  });

  const callbackAndPayoffValidation = validateCallbackAndPayoff({
    input: params.input,
    continuityContext: params.continuityContext,
    episodeOutput: fixedCharacterValidation.episodeOutput,
  });

  const warnings = dedupe([
    ...fixedCharacterValidation.warnings,
    ...callbackAndPayoffValidation.warnings,
  ]);
  const issues = dedupe([
    ...fixedCharacterValidation.issues,
    ...callbackAndPayoffValidation.issues,
  ]);

  const episodeOutput = {
    ...callbackAndPayoffValidation.episodeOutput,
    generationTrace: dedupe([
      ...callbackAndPayoffValidation.episodeOutput.generationTrace,
      ...warnings.map((warning) => `validator_warning:${warning}`),
      ...issues.map((issue) => `validator_issue:${issue}`),
      `validator_summary:warnings=${warnings.length},issues=${issues.length}`,
    ]),
  };

  return {
    episodeOutput,
    warnings,
    issues,
  };
};

const mapLegacyEpisodeToVNext = (params: {
  input: GenerateEpisodeRuntimeInput;
  continuityContext: EpisodeContinuityContext;
  legacyEpisode: any;
}): EpisodeOutput => {
  const { input, continuityContext, legacyEpisode } = params;
  const episodeId = toId(
    "ep",
    `${input.seriesBlueprint.id}:${input.userSeriesState.id}:${legacyEpisode?.title}:${Date.now()}`
  );

  const spots = Array.isArray(legacyEpisode?.spots) ? legacyEpisode.spots : [];
  const spotTrace = legacyEpisode?.generation_trace?.selected_spots || [];
  const selectedSpots = spots.map((spot: any, index: number) => {
    const trace = spotTrace[index] || {};
    return {
      spotId: toId("spot", `${spot?.spot_name || "spot"}:${index}`),
      spotName: clean(spot?.spot_name) || `スポット${index + 1}`,
      order: index + 1,
      estimatedTravelMinutesFromPrev: Number.isFinite(trace?.estimated_walk_minutes)
        ? clamp(Number(trace.estimated_walk_minutes), 0, 180)
        : undefined,
    };
  });

  const localCharacters = (Array.isArray(legacyEpisode?.episode_unique_characters)
    ? legacyEpisode.episode_unique_characters
    : []
  ).map((character: any, index: number) => ({
    localCharacterId: clean(character?.id) || `local_${index + 1}`,
    displayName: clean(character?.name) || `ローカル人物${index + 1}`,
    archetype: clean(character?.role) || "地域の案内人",
    roleInEpisode: clean(character?.role) || "地域の情報提供",
    personalityTraits: dedupe([clean(character?.personality)]),
    motivation: clean(character?.motivation) || "土地の背景を伝える",
    relationToSpot: clean(character?.introduction_scene) || "中盤スポットで登場",
    relationToSeriesTheme: clean(character?.relation_to_series) || "シリーズの継続要素へ接続",
    speechStyle: dedupe([clean(character?.personality)]),
    portraitPrompt:
      clean(character?.portrait_prompt || character?.portraitPrompt) || undefined,
    portraitImageUrl:
      clean(character?.portrait_image_url || character?.portraitImageUrl) || undefined,
    callbackEligible: true,
  }));

  const seriesCharacterByName = new Map(
    input.seriesBlueprint.characters.map((character) => [character.displayName.toLowerCase(), character])
  );

  const fixedCharactersAppeared = dedupe(
    (Array.isArray(legacyEpisode?.characters) ? legacyEpisode.characters : [])
      .filter((character: any) => clean(character?.origin) !== "episode")
      .map((character: any) => {
        const match = seriesCharacterByName.get(clean(character?.name).toLowerCase());
        return match?.id || "";
      })
  );

  const styleGuide = buildEpisodeVisualStyleGuide({
    input,
    legacyEpisode,
  });
  const localCharactersWithPortraits = ensureEpisodeLocalCharacterPortraits({
    input,
    legacyEpisode,
    localCharacters,
    styleGuide,
  });
  const coverVisual = buildEpisodeCoverVisual({
    input,
    legacyEpisode,
    localCharacters: localCharactersWithPortraits,
    fixedCharactersAppeared,
    selectedSpots,
    styleGuide,
  });

  const speakerNameById = new Map<string, string>();
  (Array.isArray(legacyEpisode?.characters) ? legacyEpisode.characters : []).forEach((character: any) => {
    const id = clean(character?.id);
    if (!id) return;
    speakerNameById.set(id, clean(character?.name) || id);
  });

  const scenes = spots.map((spot: any, index: number) => {
    const sceneRole = sceneRoleMap(clean(spot?.scene_role), index, spots.length);
    const selectedSpot = selectedSpots[index];
    const dialogueBlocks = Array.isArray(spot?.blocks)
      ? spot.blocks.filter((block: any) => clean(block?.type) === "dialogue")
      : [];

    const toDialogueTurn = (row: any, kind: "dialogue" | "narration-lite" | "aside") => ({
      speakerId: clean(row?.character_id || row?.speaker_id) || "narrator",
      speakerName:
        speakerNameById.get(clean(row?.character_id || row?.speaker_id)) ||
        clean(row?.speaker_name) ||
        "語り手",
      kind,
      text: clean(row?.text) || "",
      emotion: clean(row?.expression) || undefined,
    });

    const pre = Array.isArray(spot?.pre_mission_dialogue) ? spot.pre_mission_dialogue : [];
    const post = Array.isArray(spot?.post_mission_dialogue) ? spot.post_mission_dialogue : [];

    return {
      sceneId: `${episodeId}_scene_${index + 1}`,
      spotId: selectedSpot?.spotId || `spot_${index + 1}`,
      spotName: selectedSpot?.spotName || `スポット${index + 1}`,
      spotMeta: {
        whySelected: clean(spot?.scene_objective) || "エピソード要件に適合",
      },
      sceneRole,
      sceneGoal: clean(spot?.scene_objective) || "次の展開に必要な進展を得る",
      whyThisSpotNow:
        clean(spot?.scene_objective) || clean(spot?.scene_narration) || "物語導線に必要なため",
      narration: {
        intro: clean(spot?.scene_narration).slice(0, 120) || "シーン開始",
        arrival: `${selectedSpot?.spotName || "この場所"}に到着する。`,
        emotionalClimax: clean(spot?.explanation_text) || undefined,
        outro: clean(spot?.hint_text) || "次の場所へ向かう。",
      },
      fixedCharacters: fixedCharactersAppeared
        .slice(0, 3)
        .map((characterId) => {
          const state = input.userSeriesState.relationshipState.find(
            (relationship) => relationship.characterId === characterId
          );
          const character = input.seriesBlueprint.characters.find((row) => row.id === characterId);
          return {
            characterId,
            displayName: character?.displayName || characterId,
            roleInScene: "同行と対話",
            emotionalState: state?.closenessLabel || "stable",
            relationshipToUserNow:
              state ? `trust=${state.trustLevel.toFixed(0)} / tension=${state.tensionLevel.toFixed(0)}` : "初期状態",
            linesStyleGuard: character?.identity.speechStyle || [],
          };
        }),
      localCharacters: localCharactersWithPortraits.slice(
        index % Math.max(1, localCharactersWithPortraits.length),
        index % Math.max(1, localCharactersWithPortraits.length) + 1
      ),
      dialogue: {
        opening: pre
          .map((row: any) => toDialogueTurn(row, "dialogue"))
          .filter((turn: { text: string }) => turn.text),
        exploration: dialogueBlocks
          .map((row: any) => toDialogueTurn(row, "dialogue"))
          .filter((turn: { text: string }) => turn.text)
          .slice(0, 6),
        emotionalBeat: post
          .map((row: any) => toDialogueTurn(row, "dialogue"))
          .filter((turn: { text: string }) => turn.text),
        reveal: clean(spot?.explanation_text)
          ? [
              {
                speakerId: "narrator",
                speakerName: "語り手",
                kind: "narration-lite" as const,
                text: clean(spot?.explanation_text),
              },
            ]
          : undefined,
        transition: [
          {
            speakerId: "narrator",
            speakerName: "語り手",
            kind: "narration-lite" as const,
            text: clean(spot?.hint_text) || "次の場所へ向かう理由が生まれる。",
          },
        ],
      },
      continuity: {
        callbacksToPastEpisodes: continuityContext.callbacksToUse.slice(0, 2),
        memoryReferences: continuityContext.memoriesToSurface.slice(0, 2),
        relationshipProgressions: continuityContext.relationshipTargets
          .map((target) => `${target.characterId}:${target.targetMovement}`)
          .slice(0, 3),
        foreshadowingAdded: continuityContext.foreshadowingToSeed.slice(0, 1),
        foreshadowingResolved: continuityContext.foreshadowingToResolve.slice(0, 1),
        endingApproachSignals:
          continuityContext.currentCheckpointIndex >= Math.max(0, input.seriesBlueprint.checkpoints.length - 2)
            ? ["ending_near"]
            : [],
      },
      progression: {
        clueOrRealization: clean(spot?.answer_text) || clean(spot?.explanation_text) || "手がかりを得た",
        emotionalOutcome: clean(spot?.scene_objective) || "関係と理解が進んだ",
        nextSpotReason: clean(spot?.hint_text) || "次地点で仮説を確かめるため",
      },
    };
  });

  const continuityPatch = buildContinuityPatch({
    input,
    continuityContext,
    legacyEpisode,
    localCharacters: localCharactersWithPortraits,
    selectedSpots,
  });

  return {
    workflowVersion: "series-runtime-episode-vNext-continuity",
    episodeId,
    seriesBlueprintId: input.seriesBlueprint.id,
    userSeriesStateId: input.userSeriesState.id,
    coverImagePrompt: coverVisual.coverImagePrompt,
    coverImageUrl: coverVisual.coverImageUrl,
    episodeMeta: {
      episodeIndex: continuityContext.episodeIndex,
      title: clean(legacyEpisode?.title) || `第${continuityContext.episodeIndex}話`,
      summaryHook: clean(legacyEpisode?.one_liner) || clean(legacyEpisode?.summary) || "新たな外出周遊ミステリー体験",
      episodePurpose:
        clean(legacyEpisode?.main_plot?.goal) || clean(input.request.episodeRequest.tourismGoal) || "継続物語を進める",
      arcRole: arcRoleFromCheckpoint(input.seriesBlueprint, input.userSeriesState.currentProgress.currentCheckpointIndex),
      generatedAt: new Date().toISOString(),
    },
    selectedSpots,
    fixedCharactersAppeared,
    localCharactersIntroduced: localCharactersWithPortraits,
    scenes,
    ending: {
      closingNarration: clean(legacyEpisode?.summary) || "今回の旅路は次話へ静かに接続した。",
      emotionalAftertaste: dedupe([
        clean(legacyEpisode?.episode_world?.mood),
        clean(legacyEpisode?.carry_over_hook),
      ]),
      nextEpisodeHook: clean(legacyEpisode?.carry_over_hook) || "次の土地で確かめるべき問いが残る。",
    },
    continuityPatch,
    generationTrace: dedupe([
      `legacy_episode_title:${clean(legacyEpisode?.title)}`,
      `selected_spots:${selectedSpots.length}`,
      `callbacks:${continuityContext.callbacksToUse.length}`,
    ]),
  };
};

const mergePhase = (legacyPhase: SeriesRuntimeEpisodeProgressEvent["phase"]) => {
  if (legacyPhase === "episode_plan_start") return "episode_plan_start";
  if (legacyPhase === "episode_plan_done") return "episode_plan_done";
  if (legacyPhase === "spot_resolution_start") return "spot_resolution_start";
  if (legacyPhase === "spot_resolution_done") return "spot_resolution_done";
  if (legacyPhase === "spot_chapter_start") return "scene_generation_start";
  if (legacyPhase === "spot_puzzle_done") return "scene_generation_done";
  if (legacyPhase === "episode_character_images_start") return "episode_character_images_start";
  if (legacyPhase === "episode_character_images_done") return "episode_character_images_done";
  if (legacyPhase === "episode_cover_image_start") return "episode_cover_image_start";
  if (legacyPhase === "episode_cover_image_done") return "episode_cover_image_done";
  if (legacyPhase === "episode_assemble_start") return "episode_assemble_start";
  if (legacyPhase === "episode_assemble_done") return "episode_assemble_done";
  return undefined;
};

export const generateEpisodeRuntimeVNext = async (
  rawInput: GenerateEpisodeRuntimeInput,
  options: {
    onProgress?: (event: { phase: string; detail?: string; at?: string }) => void | Promise<void>;
  } = {}
): Promise<GenerateEpisodeRuntimeResult> => {
  const input = generateEpisodeRuntimeInputSchema.parse(rawInput);
  await options.onProgress?.({ phase: "request_received", detail: "episode runtime request accepted" });

  if (input.request.userId !== input.userSeriesState.userId) {
    throw new Error("user_id_mismatch_between_request_and_state");
  }
  if (input.request.seriesBlueprintId !== input.seriesBlueprint.id) {
    throw new Error("series_blueprint_id_mismatch");
  }
  if (input.request.userSeriesStateId !== input.userSeriesState.id) {
    throw new Error("user_series_state_id_mismatch");
  }

  await options.onProgress?.({ phase: "input_validated", detail: "runtime input validated" });
  await options.onProgress?.({ phase: "series_context_loaded", detail: "series blueprint loaded" });

  const continuityContext = buildEpisodeContinuityContext(input);
  await options.onProgress?.({ phase: "continuity_context_built", detail: "continuity context prepared" });

  const legacyInput = toLegacyRuntimeInput(input, continuityContext);

  await options.onProgress?.({ phase: "episode_plan_start", detail: "episode planner started" });
  let sceneStartEmitted = false;
  const legacyEpisode = await generateSeriesRuntimeEpisode(legacyInput, {
    onProgress: async (event) => {
      const phase = mergePhase(event.phase);
      if (!phase) return;
      if (phase === "scene_generation_start") {
        if (sceneStartEmitted) return;
        sceneStartEmitted = true;
      }
      await options.onProgress?.({
        phase,
        detail: clean(event.detail),
        at: event.at,
      });
    },
  });

  if (!sceneStartEmitted) {
    await options.onProgress?.({ phase: "scene_generation_start", detail: "scene generation started" });
  }
  await options.onProgress?.({ phase: "scene_generation_done", detail: "scene generation finished" });

  await options.onProgress?.({ phase: "episode_cast_design_start", detail: "cast design assembled" });
  await options.onProgress?.({ phase: "episode_cast_design_done", detail: "cast design completed" });

  await options.onProgress?.({ phase: "episode_assemble_start", detail: "assembling episode output" });
  let episodeOutput = mapLegacyEpisodeToVNext({
    input,
    continuityContext,
    legacyEpisode,
  });
  await options.onProgress?.({ phase: "episode_assemble_done", detail: "episode output assembled" });

  await options.onProgress?.({ phase: "continuity_patch_build_start", detail: "building continuity patch" });
  const validation = validateEpisodeOutput({
    input,
    continuityContext,
    episodeOutput,
  });
  episodeOutput = validation.episodeOutput;
  if (validation.warnings.length > 0) {
    await options.onProgress?.({
      phase: "continuity_patch_build_start",
      detail: `validator warnings: ${validation.warnings.length}`,
    });
  }
  if (validation.issues.length > 0) {
    throw new Error(
      `episode_output_validation_failed:${validation.issues.join(",")}`
    );
  }
  await options.onProgress?.({ phase: "continuity_patch_build_done", detail: "continuity patch ready" });

  await options.onProgress?.({ phase: "response_preparing", detail: "preparing response payload" });
  await options.onProgress?.({ phase: "completed", detail: "runtime generation completed" });

  return generateEpisodeRuntimeResultSchema.parse({
    workflowVersion: "series-runtime-episode-vNext-continuity",
    episodeOutput,
  });
};

const deriveClosenessLabel = (trustLevel: number, tensionLevel: number) => {
  if (trustLevel >= 75 && tensionLevel <= 25) return "close";
  if (trustLevel >= 55 && tensionLevel <= 40) return "warm";
  if (trustLevel >= 40) return "neutral";
  return "distant";
};

export const applyEpisodeContinuityPatch = (
  currentState: UserSeriesState,
  patch: EpisodeContinuityPatch
): UserSeriesState => {
  const base = userSeriesStateSchema.parse(currentState);

  const nextCompletedEpisodeCount = base.currentProgress.episodeCountCompleted + 1;
  const nextEpisodeId = `episode_${nextCompletedEpisodeCount}`;

  const unresolved = dedupe([
    ...patch.payoffPatch.activeThreads,
    ...base.currentProgress.unresolvedThreads,
  ]).filter((item) => !patch.payoffPatch.closedThreads.some((closed) => closed.toLowerCase() === item.toLowerCase()));

  const resolved = dedupe([
    ...base.currentProgress.resolvedThreads,
    ...patch.payoffPatch.closedThreads,
    ...patch.payoffPatch.resolvedForeshadowing,
  ]);

  const activeForeshadowing = dedupe([
    ...base.currentProgress.activeForeshadowing,
    ...patch.payoffPatch.newlySeededForeshadowing,
  ]).filter(
    (item) => !patch.payoffPatch.resolvedForeshadowing.some((resolvedItem) => resolvedItem.toLowerCase() === item.toLowerCase())
  );

  const relationshipById = new Map(base.relationshipState.map((relationship) => [relationship.characterId, relationship]));

  for (const update of patch.relationshipPatch) {
    const current = relationshipById.get(update.characterId) || {
      characterId: update.characterId,
      closenessLabel: "distant",
      trustLevel: 35,
      tensionLevel: 20,
      affectionLevel: 0,
      specialFlags: [],
      sharedMemories: [],
      unresolvedEmotions: [],
    };

    const trustLevel = clamp(current.trustLevel + (update.trustDelta || 0), 0, 100);
    const tensionLevel = clamp(current.tensionLevel + (update.tensionDelta || 0), 0, 100);
    const affectionLevel = clamp((current.affectionLevel || 0) + (update.affectionDelta || 0), 0, 100);

    relationshipById.set(update.characterId, {
      ...current,
      trustLevel,
      tensionLevel,
      affectionLevel,
      closenessLabel:
        clean(update.newRelationshipState) || deriveClosenessLabel(trustLevel, tensionLevel),
      specialFlags: dedupe([...current.specialFlags, clean(update.newRelationshipState)]),
      sharedMemories: dedupe([
        ...current.sharedMemories,
        ...patch.memoryPatch.addedSharedMemories,
        update.keyMomentSummary,
      ]),
      unresolvedEmotions:
        tensionLevel > 55
          ? dedupe([...current.unresolvedEmotions, update.keyMomentSummary])
          : current.unresolvedEmotions,
    });
  }

  const callbackEligibleSet = new Set(
    patch.localCharacterPatch.callbackEligible.map((row) => clean(row.localCharacterId).toLowerCase())
  );

  const episodeLocalCharacterCarryovers = dedupe([
    ...(base.continuityState.episodeLocalCharacterCarryovers || []).map(
      (item) => `${item.localCharacterId}::${item.displayName}::${item.callbackEligibility}`
    ),
    ...patch.localCharacterPatch.introduced
      .filter((character) => callbackEligibleSet.has(clean(character.localCharacterId).toLowerCase()))
      .map(
        (character) =>
          `${character.localCharacterId}::${character.displayName}::${
            patch.localCharacterPatch.callbackEligible.find(
              (item) => clean(item.localCharacterId).toLowerCase() === clean(character.localCharacterId).toLowerCase()
            )?.reason || "callback_eligible"
          }`
      ),
  ]).map((packed) => {
    const [localCharacterId, displayName, callbackEligibility] = packed.split("::");
    return {
      localCharacterId: clean(localCharacterId),
      displayName: clean(displayName),
      callbackEligibility: clean(callbackEligibility),
    };
  });

  return userSeriesStateSchema.parse({
    ...base,
    stateVersion: base.stateVersion + 1,
    currentProgress: {
      episodeCountCompleted: nextCompletedEpisodeCount,
      currentCheckpointIndex: patch.arcPatch.currentCheckpointIndexAfterEpisode,
      currentArcSummary: patch.arcPatch.arcSummaryAfterEpisode,
      unresolvedThreads: unresolved,
      resolvedThreads: resolved,
      activeForeshadowing,
      completedEpisodeIds: dedupe([...base.currentProgress.completedEpisodeIds, nextEpisodeId]),
    },
    rememberedExperience: {
      visitedLocations: dedupe([
        ...base.rememberedExperience.visitedLocations,
        ...patch.memoryPatch.addedLocationMemories,
      ]),
      keyEvents: dedupe([
        ...base.rememberedExperience.keyEvents,
        ...patch.memoryPatch.addedEvents,
      ]),
      importantConversations: dedupe([
        ...base.rememberedExperience.importantConversations,
        ...patch.memoryPatch.addedConversations,
      ]),
      playerChoices: base.rememberedExperience.playerChoices,
      emotionalMoments: dedupe([
        ...base.rememberedExperience.emotionalMoments,
        ...patch.relationshipPatch.map((item) => item.keyMomentSummary),
      ]),
      relationshipTurningPoints: dedupe([
        ...base.rememberedExperience.relationshipTurningPoints,
        ...patch.relationshipPatch.map((item) => item.keyMomentSummary),
      ]),
    },
    relationshipState: Array.from(relationshipById.values()),
    continuityState: {
      callbackCandidates: dedupe([
        ...base.continuityState.callbackCandidates,
        ...patch.memoryPatch.addedEvents,
        ...patch.memoryPatch.addedConversations,
      ]),
      motifsInUse: base.continuityState.motifsInUse,
      blockedLines: base.continuityState.blockedLines,
      promisedPayoffs: dedupe([
        ...base.continuityState.promisedPayoffs,
        ...patch.payoffPatch.newlySeededForeshadowing,
      ]),
      episodeLocalCharacterCarryovers,
    },
  });
};
