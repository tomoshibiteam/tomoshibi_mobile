import { createHash, randomUUID } from "node:crypto";
import { generateSeriesRuntimeEpisode, type SeriesRuntimeEpisodeProgressEvent } from "../agents/seriesRuntimeEpisodeAgent";
import { resolveEpisodeSpotSheetCandidates } from "../episodeSpotGroundingContext";
import {
  buildCharacterPortraitPrompt,
  buildCoverImagePrompt,
  buildSeriesImageUrl,
  buildSeriesVisualStyleGuide,
} from "../seriesVisuals";
import {
  type ContinuityPatch,
  continuityPatchSchema,
  type DialoguePlan,
  dialoguePlanSchema,
  type EpisodeCastUsagePlan,
  episodeCastUsagePlanSchema,
  type EpisodeGenerationContract,
  type EpisodeLocalMaterialBundle,
  episodeLocalMaterialBundleSchema,
  type EpisodeOutline,
  episodeOutlineSchema,
  type EpisodeOutput,
  episodeOutputSchema,
  type EpisodeRequestBrief,
  episodeRequestBriefSchema,
  type EpisodeRoutePlan,
  episodeRoutePlanSchema,
  type GenerateEpisodeRuntimeInput,
  generateEpisodeRuntimeInputSchema,
  type GenerateEpisodeRuntimeResult,
  generateEpisodeRuntimeResultSchema,
  type NarrationPlan,
  narrationPlanSchema,
  type RawSeriesGenerationRequest,
  rawSeriesGenerationRequestSchema,
  type SceneTextBlock,
  sceneTextBlockSchema,
  type SeriesBlueprint,
  type SeriesGenerationResult,
  seriesGenerationResultSchema,
  type SpotMysteryStructure,
  spotMysteryStructureSchema,
  type UserSeriesState,
  userSeriesStateSchema,
} from "../../schemas/series-runtime-v2";
import { generateSeriesGenerationResultV2 } from "../../workflows/series-workflow-v2";

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
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const toId = (prefix: string, seed: string) => `${prefix}_${createHash("sha1").update(seed).digest("hex").slice(0, 12)}`;
const deriveKeywordList = (value: string, fallbacks: string[] = []) =>
  dedupe([...(clean(value).match(/[A-Za-z0-9一-龥ぁ-んァ-ヶー]{2,24}/g) || []), ...fallbacks]).slice(0, 8);
const pickTop = (values: string[], fallback: string) => values.find(Boolean) || fallback;

type ProgressReporter = (event: { phase: string; detail?: string; at?: string }) => void | Promise<void>;

type InternalContinuityContext = {
  episodeIndex: number;
  callbacksToUse: string[];
  callbacksToSeed: string[];
  relationshipTargets: Array<{ characterId: string; targetMovement: string }>;
};

const emitProgress = async (onProgress: ProgressReporter | undefined, phase: string, detail?: string) => {
  await onProgress?.({ phase, detail: clean(detail) || undefined, at: new Date().toISOString() });
};

export const generateSeriesGenerationResultVNext = async (
  rawInput: RawSeriesGenerationRequest,
  options: { onProgress?: ProgressReporter } = {}
): Promise<SeriesGenerationResult> => {
  const parsed = rawSeriesGenerationRequestSchema.parse(rawInput);
  return generateSeriesGenerationResultV2(parsed, options);
};

const deriveEpisodeRequestBrief = (input: GenerateEpisodeRuntimeInput): EpisodeRequestBrief => {
  const request = input.request.episodeRequest;
  return episodeRequestBriefSchema.parse({
    locationContext: request.locationContext,
    tourismGoal: clean(request.tourismGoal),
    desiredMoodToday: dedupe(request.desiredMoodToday || []),
    physicalConstraints: dedupe(request.physicalConstraints || []),
    avoidThemes: dedupe(request.avoidThemes || []),
    requestDigest: dedupe([
      clean(request.locationContext.cityOrArea),
      clean(request.tourismGoal),
      ...dedupe(request.desiredMoodToday || []),
    ]).slice(0, 6),
  });
};

const selectLocalKnowledgeAndCandidates = async (
  input: GenerateEpisodeRuntimeInput,
  brief: EpisodeRequestBrief
): Promise<EpisodeLocalMaterialBundle> => {
  const sheetRows = await resolveEpisodeSpotSheetCandidates({
    stageLocation: brief.locationContext.cityOrArea,
    purpose: brief.tourismGoal,
    requirementHint: brief.requestDigest.join(" / "),
    limit: 8,
    scope: "episode_runtime_v2",
  });

  if (sheetRows.length < 3) {
    throw new Error("episode_local_material_insufficient");
  }

  const selectedKnowledgeItems = sheetRows.slice(0, 5).map((row, index) => ({
    id: `knowledge_${index + 1}`,
    text: clean(row.summary || row.raw_text || row.name),
    tags: row.tags || [],
    relevanceReason: `${brief.tourismGoal} に接続する現地素材`,
  }));

  const candidateSpotSet = sheetRows.slice(0, 5).map((row, index) => ({
    spotId: toId("spot", `${brief.locationContext.cityOrArea}:${row.name}:${index}`),
    spotName: clean(row.name),
    tourismFocus: clean(row.summary) || clean(brief.tourismGoal),
    estimatedWalkMinutes: row.estimated_walk_minutes ?? (index === 0 ? 0 : 8 + index * 2),
    publicAccessible: row.public_accessible,
    supportingKnowledgeIds: selectedKnowledgeItems.slice(0, 2).map((item) => item.id),
  }));

  const bundle = episodeLocalMaterialBundleSchema.parse({
    selectedKnowledgeItems,
    candidateSpotSet,
  });
  return bundle;
};

const buildContinuityContext = (input: GenerateEpisodeRuntimeInput): InternalContinuityContext => ({
  episodeIndex: input.userSeriesState.progressSummary.episodeCountCompleted + 1,
  callbacksToUse: dedupe(input.userSeriesState.continuityState.callbackCandidates).slice(0, 2),
  callbacksToSeed: dedupe(input.seriesBlueprint.identityPack.continuityAnchors.callbackPatterns).slice(0, 2),
  relationshipTargets: input.seriesBlueprint.continuityAxes.axes
    .filter((axis) => axis.kind === "relationship")
    .flatMap(() =>
      input.userSeriesState.relationshipState.slice(0, 2).map((row) => ({
        characterId: row.characterId,
        targetMovement: row.trustLevel < 60 ? "trust_up" : "memory_deepen",
      }))
    )
    .slice(0, 2),
});

const designEpisodeCastUsage = (
  input: GenerateEpisodeRuntimeInput,
  brief: EpisodeRequestBrief,
  continuityContext: InternalContinuityContext
): EpisodeCastUsagePlan => {
  const cast = input.seriesBlueprint.persistentCharacters;
  return episodeCastUsagePlanSchema.parse({
    fixedCastUsage: [
      {
        characterId: cast.partner.id,
        whyThisEpisode: `${brief.tourismGoal} を推理体験へ変換する主軸。`,
        roleInEpisode: "現地観察と推理伴走",
        emotionalMovementTarget: "trust_up",
        requiredConversationFunctions: ["問い返し", "仮説整理", "行動促進"],
      },
      {
        characterId: cast.anchorNpc.id,
        whyThisEpisode: "土地の背景と継続文脈を接続するため。",
        roleInEpisode: "背景整理と認識反転の提供",
        emotionalMovementTarget: continuityContext.relationshipTargets.find((row) => row.characterId === cast.anchorNpc.id)?.targetMovement || "memory_deepen",
        requiredConversationFunctions: ["視点差提示", "背景補強"],
      },
    ],
    localCharacters: [
      {
        localCharacterId: "local_witness_1",
        displayName: `${brief.locationContext.cityOrArea}で出会う証言者`,
        narrativeNeed: "現地ならではの違和感を一言で提示する。",
        callbackEligible: false,
      },
    ],
  });
};

const resolveSpotCount = (input: GenerateEpisodeRuntimeInput) => {
  const contract = input.seriesBlueprint.episodeGenerationContract.spotCountPolicy;
  const requestedMax = input.request.runtimeOptions?.maxSpots ?? contract.max;
  const requestedMin = input.request.runtimeOptions?.minSpots ?? contract.min;
  const budget = input.request.episodeRequest.locationContext.availableMinutes || 90;
  if (budget <= 60) return clamp(3, requestedMin, requestedMax);
  if (budget <= 90) return clamp(4, requestedMin, requestedMax);
  return clamp(5, requestedMin, requestedMax);
};

const designSpotMysteryStructure = (
  input: GenerateEpisodeRuntimeInput,
  brief: EpisodeRequestBrief,
  localMaterial: EpisodeLocalMaterialBundle,
  continuityContext: InternalContinuityContext
): SpotMysteryStructure => {
  const desiredSpotCount = resolveSpotCount(input);
  const selectedSpots = localMaterial.candidateSpotSet.slice(0, desiredSpotCount);
  const roles: Array<"hook" | "exploration" | "pivot" | "resolution"> =
    selectedSpots.length >= 5
      ? ["hook", "exploration", "exploration", "pivot", "resolution"]
      : selectedSpots.length === 4
        ? ["hook", "exploration", "pivot", "resolution"]
        : ["hook", "exploration", "resolution"];

  const nodes = selectedSpots.map((spot, index) => {
    const knowledge = localMaterial.selectedKnowledgeItems[index % localMaterial.selectedKnowledgeItems.length];
    const sceneRole = roles[index] || "exploration";
    return {
      sceneRole,
      spotName: spot.spotName,
      spotPurpose: `${brief.tourismGoal} と事件の手掛かりを接続する。`,
      observedClue: `${spot.spotName} で ${knowledge.text} に関わる違和感を観察する。`,
      hiddenMeaning: `${knowledge.text} が事件の因果と土地理解の両方に接続している。`,
      ...(sceneRole === "pivot" ? { falseLead: "一見すると別件に見えるが、手掛かりの並びを見直すと主因へ戻る。" } : {}),
      requiredAction: sceneRole === "hook" ? "最初の違和感を記録する" : sceneRole === "resolution" ? "証拠をつないで結論を出す" : "現地観察と聞き込みを重ねる",
      inferenceQuestion: `${spot.spotName} で得た情報は、今回の出来事のどの部分を説明するか？`,
      answerLogic: `${knowledge.text} を手掛かりに、前のスポットで得た情報と矛盾なく結びつける。`,
      emotionalBeat: sceneRole === "hook" ? "好奇心が立ち上がる" : sceneRole === "pivot" ? "見方が反転する" : sceneRole === "resolution" ? "納得と達成感が生まれる" : "理解が一段深まる",
      learningOutcome: `${spot.spotName} の役割や背景を、事件解明の一部として理解する。`,
    };
  });

  return spotMysteryStructureSchema.parse({
    nodes,
    finalInference: {
      question: `今回の出来事は、どの手掛かりがつながることで説明できるか？`,
      acceptableAnswerShape: "複数スポットで得た手掛かりを一つの因果に束ねる説明",
      reveal: `${brief.tourismGoal} に関わる背景理解が、事件の真相説明と同時に成立する。`,
    },
  });
};

const designNarrationPlan = (spotMystery: SpotMysteryStructure): NarrationPlan =>
  narrationPlanSchema.parse({
    openingNarrationPurpose: "今回の事件の入口と、現地で動く理由を明確にする。",
    perSceneNarrationRules: spotMystery.nodes.map((node, index) => ({
      sceneIndex: index,
      mustExplain: [node.spotPurpose, node.learningOutcome],
      mustNotOverExplain: [node.answerLogic],
      emotionalColor: node.emotionalBeat,
    })),
    closingNarrationPurpose: "今回の解決と、次回へ残る余韻を短く明示する。",
  });

const designDialoguePlan = (
  input: GenerateEpisodeRuntimeInput,
  castUsage: EpisodeCastUsagePlan,
  spotMystery: SpotMysteryStructure
): DialoguePlan =>
  dialoguePlanSchema.parse({
    perSceneDialogueGoals: spotMystery.nodes.map((node, index) => ({
      sceneIndex: index,
      speakerOrderHints: [
        input.seriesBlueprint.persistentCharacters.partner.id,
        ...(index >= 2 ? [input.seriesBlueprint.persistentCharacters.anchorNpc.id] : []),
      ],
      partnerFunction: castUsage.fixedCastUsage[0]?.requiredConversationFunctions.join(" / ") || "問い返し",
      ...(index >= 2 ? { anchorFunction: castUsage.fixedCastUsage[1]?.requiredConversationFunctions.join(" / ") || "背景補強" } : {}),
      ...(index === 1 ? { localCharacterFunction: castUsage.localCharacters[0]?.narrativeNeed || "現地証言" } : {}),
      relationshipShiftHint: castUsage.fixedCastUsage[0]?.emotionalMovementTarget || "trust_up",
      forbiddenDialogueDrifts: ["説明の丸投げ", "講義口調"],
    })),
  });

const designEpisodeOutline = (
  input: GenerateEpisodeRuntimeInput,
  brief: EpisodeRequestBrief,
  spotMystery: SpotMysteryStructure,
  continuityContext: InternalContinuityContext
): EpisodeOutline => {
  const location = clean(brief.locationContext.cityOrArea);
  const tourismGoal = clean(brief.tourismGoal);
  const title = `${location} ${tourismGoal}の事件簿`;
  return episodeOutlineSchema.parse({
    title,
    summaryHook: `${location}で起きた小さな違和感を追ううちに、${tourismGoal}の背景が一つの真相へつながる。`,
    episodePurpose: `${tourismGoal} に関わる出来事を、一回完結の事件ミステリーとして解く。`,
    incidentCore: input.seriesBlueprint.concept.mysteryProfile?.case_core || `${tourismGoal} に紐づく局所事件`,
    beatSequence: ["hook", "exploration", "pivot", "resolution", "carryover_hint"],
    selectedSpots: spotMystery.nodes.map((node) => node.spotName),
    finalInferenceQuestion: spotMystery.finalInference.question,
    completionCondition: `${tourismGoal} に関する違和感の因果を、最終推理で説明できる状態になる。`,
    carryoverHint: continuityContext.callbacksToSeed[0] || "今回の発見は次回の見方を少し変える。",
    callbacksToUse: continuityContext.callbacksToUse,
    callbacksToSeed: continuityContext.callbacksToSeed,
    relationshipMoves: continuityContext.relationshipTargets,
  });
};

const buildRoutePlan = (
  outline: EpisodeOutline,
  localMaterial: EpisodeLocalMaterialBundle,
  availableMinutes?: number
): EpisodeRoutePlan => {
  const ordered = outline.selectedSpots.map((spotName, index) => {
    const matched = localMaterial.candidateSpotSet.find((spot) => spot.spotName === spotName);
    const role = index === 0 ? "hook" : index === outline.selectedSpots.length - 1 ? "resolution" : index === outline.selectedSpots.length - 2 ? "pivot" : "exploration";
    return {
      spotName,
      sceneRole: role as "hook" | "exploration" | "pivot" | "resolution",
      estimatedWalkMinutes: matched?.estimatedWalkMinutes ?? (index === 0 ? 0 : 10),
    };
  });
  const totalEstimatedWalkMinutes = ordered.reduce((sum, row) => sum + row.estimatedWalkMinutes, 0);
  const transferMinutes = Math.max(0, ordered.length - 1) * 3;
  const feasible = availableMinutes ? totalEstimatedWalkMinutes + transferMinutes <= availableMinutes + 20 : true;
  return episodeRoutePlanSchema.parse({
    feasible,
    selectedSpotsInOrder: ordered,
    routeMetrics: {
      totalEstimatedWalkMinutes,
      transferMinutes,
      maxLegMinutes: ordered.reduce((max, row) => Math.max(max, row.estimatedWalkMinutes), 0),
    },
    failureReasons: feasible ? [] : ["available_minutes_exceeded"],
  });
};

const sceneRoleToLegacy = (sceneRole: "hook" | "exploration" | "pivot" | "resolution"): "起" | "承" | "転" | "結" => {
  if (sceneRole === "hook") return "起";
  if (sceneRole === "pivot") return "転";
  if (sceneRole === "resolution") return "結";
  return "承";
};

const buildLegacyRuntimeInput = (params: {
  input: GenerateEpisodeRuntimeInput;
  brief: EpisodeRequestBrief;
  outline: EpisodeOutline;
  routePlan: EpisodeRoutePlan;
  spotMystery: SpotMysteryStructure;
}): Parameters<typeof generateSeriesRuntimeEpisode>[0] => {
  const { input, brief, outline, routePlan, spotMystery } = params;
  const cast = input.seriesBlueprint.persistentCharacters;
  return {
    series: {
      title: input.seriesBlueprint.concept.title,
      overview: input.seriesBlueprint.concept.oneLineHook,
      premise: input.seriesBlueprint.concept.premise,
      season_goal: input.seriesBlueprint.frameworkBrief.seriesDesign.returnReason,
      ai_rules: [
        ...input.seriesBlueprint.frameworkBrief.worldRules.realityRules,
        ...input.seriesBlueprint.frameworkBrief.continuityDesign.forbiddenContinuityBreaks,
      ].join("\n"),
      world_setting: input.seriesBlueprint.concept.worldviewCore,
      continuity: {
        global_mystery: input.seriesBlueprint.concept.mysteryProfile?.case_core || outline.incidentCore,
        mid_season_twist: outline.carryoverHint,
        finale_payoff: input.seriesBlueprint.frameworkBrief.seriesDesign.returnReason,
        invariant_rules: input.seriesBlueprint.frameworkBrief.worldRules.realityRules,
        episode_link_policy: input.seriesBlueprint.identityPack.continuityAnchors.episodeCarryOverRules,
      },
      progress_state: {
        last_completed_episode_no: input.userSeriesState.progressSummary.episodeCountCompleted,
        unresolved_threads: input.userSeriesState.progressSummary.activeThreads,
        revealed_facts: input.userSeriesState.progressSummary.resolvedThreads,
        relationship_state_summary: input.userSeriesState.relationshipState.map((row) => `${row.characterId}:${row.closenessLabel}`).join(" / "),
        relationship_flags: dedupe(input.userSeriesState.relationshipState.flatMap((row) => row.specialFlags)),
        recent_relation_shift: input.userSeriesState.rememberedExperience.relationshipTurningPoints.slice(-5),
        companion_trust_level: input.userSeriesState.relationshipState[0]?.trustLevel || 40,
        next_hook: input.userSeriesState.continuityState.promisedPayoffs[0] || outline.carryoverHint,
      },
      first_episode_seed: {
        title: outline.title,
        objective: outline.episodePurpose,
        opening_scene: outline.summaryHook,
        expected_duration_minutes: clamp(input.request.episodeRequest.locationContext.availableMinutes || 45, 10, 45),
        route_style: "mixed",
        completion_condition: outline.completionCondition,
        carry_over_hint: outline.carryoverHint,
        spot_requirements: spotMystery.nodes.map((node, index) => ({
          requirement_id: `req_${index + 1}`,
          scene_role: sceneRoleToLegacy(node.sceneRole),
          spot_role: node.spotPurpose,
          required_attributes: [],
          visit_constraints: [],
          tourism_value_type: node.learningOutcome,
        })),
        suggested_spots: routePlan.selectedSpotsInOrder.map((row) => row.spotName),
      },
      characters: [cast.partner, cast.anchorNpc].map((character) => ({
        id: character.id,
        name: character.displayName,
        role: character.coreFunctionInSeries,
        must_appear: character.usageRules.mustAppearFrequency === "every_episode",
        personality: character.identity.immutableTraits.join(" / "),
        appearance: character.recurringHooks.placeAffinity.join(" / "),
        portrait_prompt: character.visual?.portraitPrompt,
        portrait_image_url: character.visual?.portraitImageUrl,
        arc_start: character.relationshipDesign.initialDistanceToUser,
        arc_end: character.relationshipDesign.expectedArcWithUser,
      })),
      recent_episodes: input.userSeriesState.progressSummary.recentEpisodeIds.slice(-3).map((episodeId, index) => ({
        episode_no: Math.max(1, input.userSeriesState.progressSummary.episodeCountCompleted - 2 + index),
        title: episodeId,
        summary: "過去の体験記録",
      })),
    },
    episode_request: {
      stage_location: brief.locationContext.cityOrArea,
      purpose: brief.tourismGoal,
      user_wishes: dedupe([...brief.desiredMoodToday, ...brief.physicalConstraints]).join(" / ") || undefined,
      desired_spot_count: clamp(routePlan.selectedSpotsInOrder.length, 5, 7),
      desired_duration_minutes: clamp(brief.locationContext.availableMinutes || 35, 10, 45),
      language: "ja",
    },
  };
};

const mergeEpisodePhase = (legacyPhase: SeriesRuntimeEpisodeProgressEvent["phase"]): string | undefined => {
  if (legacyPhase === "episode_plan_start") return "scene_generation_start";
  if (legacyPhase === "episode_plan_done") return "scene_generation_start";
  if (legacyPhase === "spot_resolution_start") return "scene_generation_start";
  if (legacyPhase === "spot_resolution_done") return "scene_generation_start";
  if (legacyPhase === "spot_chapter_start") return "scene_generation_start";
  if (legacyPhase === "spot_puzzle_done") return "scene_generation_done";
  if (legacyPhase === "episode_assemble_done") return "episode_assemble_done";
  return undefined;
};

const buildEpisodeVisualStyle = (input: GenerateEpisodeRuntimeInput, legacyEpisode: any) =>
  buildSeriesVisualStyleGuide({
    seriesTitle: `${input.seriesBlueprint.concept.title} ${clean(legacyEpisode?.title)}`.trim(),
    genre: pickTop(input.seriesBlueprint.concept.genreAxes, "事件ミステリー"),
    tone: pickTop(input.seriesBlueprint.concept.toneKeywords, "知的で親しみやすい"),
    setting: clean(input.request.episodeRequest.locationContext.cityOrArea) || input.seriesBlueprint.concept.worldviewCore,
    dominantColors: input.seriesBlueprint.concept.aestheticKeywords,
    recurringMotifs: input.seriesBlueprint.identityPack.continuityAnchors.callbackPatterns.slice(0, 2),
  });

const mapLocalCharacters = (input: GenerateEpisodeRuntimeInput, legacyEpisode: any, styleGuide: string) => {
  const list = Array.isArray(legacyEpisode?.episode_unique_characters) ? legacyEpisode.episode_unique_characters : [];
  return list.map((row: any, index: number) => {
    const displayName = clean(row?.name) || `ローカル人物${index + 1}`;
    const role = clean(row?.role) || "現地人物";
    const portraitPrompt = clean(row?.portrait_prompt) || buildCharacterPortraitPrompt({
      seriesTitle: input.seriesBlueprint.concept.title,
      genre: pickTop(input.seriesBlueprint.concept.genreAxes, "事件ミステリー"),
      tone: pickTop(input.seriesBlueprint.concept.toneKeywords, "知的で親しみやすい"),
      name: displayName,
      role,
      personality: clean(row?.personality) || "現地視点を持つ。",
      appearance: clean(row?.relation_to_series) || "土地に馴染む装い。",
      setting: clean(input.request.episodeRequest.locationContext.cityOrArea) || input.seriesBlueprint.concept.worldviewCore,
      caseCore: input.seriesBlueprint.concept.mysteryProfile?.case_core,
      environmentLayer: input.seriesBlueprint.concept.mysteryProfile?.environment_layer || input.seriesBlueprint.concept.worldviewCore,
      investigationFunction: role,
      styleGuide,
    });
    return {
      localCharacterId: clean(row?.id) || `local_${index + 1}`,
      displayName,
      callbackEligible: true,
      portraitPrompt,
      portraitImageUrl: clean(row?.portrait_image_url) || buildSeriesImageUrl({
        prompt: portraitPrompt,
        seedKey: `${input.seriesBlueprint.id}:episode:${displayName}`,
        width: 768,
        height: 1024,
        purpose: "character_portrait",
      }),
    };
  });
};

const buildCoverVisual = (input: GenerateEpisodeRuntimeInput, legacyEpisode: any, styleGuide: string) => {
  const prompt = clean(legacyEpisode?.cover_image_prompt) || buildCoverImagePrompt({
    title: clean(legacyEpisode?.title) || `${input.seriesBlueprint.concept.title} エピソード`,
    genre: pickTop(input.seriesBlueprint.concept.genreAxes, "事件ミステリー"),
    tone: pickTop(input.seriesBlueprint.concept.toneKeywords, "知的で親しみやすい"),
    premise: clean(legacyEpisode?.premise) || input.seriesBlueprint.concept.premise,
    setting: clean(input.request.episodeRequest.locationContext.cityOrArea) || input.seriesBlueprint.concept.worldviewCore,
    styleGuide,
    caseCore: input.seriesBlueprint.concept.mysteryProfile?.case_core,
    truthNature: input.seriesBlueprint.concept.mysteryProfile?.truth_nature,
    environmentLayer: input.seriesBlueprint.concept.mysteryProfile?.environment_layer,
    additionalDirection: "episode key art with direct incident onset and clear real-world place cues",
  });
  return {
    coverImagePrompt: prompt,
    coverImageUrl: clean(legacyEpisode?.cover_image_url) || buildSeriesImageUrl({
      prompt,
      seedKey: `${input.seriesBlueprint.id}:episode:${clean(legacyEpisode?.title)}`,
      width: 1024,
      height: 1536,
      purpose: "cover",
    }),
  };
};

const buildSceneTextBlocks = (legacyEpisode: any): SceneTextBlock[] => {
  const spots = Array.isArray(legacyEpisode?.spots) ? legacyEpisode.spots : [];
  return spots.map((spot: any, index: number) =>
    sceneTextBlockSchema.parse({
      sceneIndex: index,
      spotName: clean(spot?.spot_name) || `スポット${index + 1}`,
      sceneRole: index === 0 ? "hook" : index === spots.length - 1 ? "resolution" : index === spots.length - 2 ? "pivot" : "exploration",
      narration: clean(spot?.scene_narration) || `${clean(spot?.spot_name) || `スポット${index + 1}`}で新たな違和感に出会う。`,
      dialogueBlocks: (Array.isArray(spot?.blocks) ? spot.blocks : [])
        .filter((block: any) => clean(block?.type) === "dialogue")
        .map((block: any) => ({
          speakerId: clean(block?.speaker_id || block?.character_id) || "narrator",
          text: clean(block?.text),
          intent: clean(block?.expression) || "dialogue",
        }))
        .filter((block: { text: string }) => block.text),
      missionPrompt: clean(spot?.question_text) || clean(spot?.scene_objective) || "この場所で違和感を確かめる。",
      inferenceQuestion: clean(spot?.question_text) || "この手掛かりは何を示すか？",
      answerGuidance: clean(spot?.hint_text) || "直前までの情報と見比べる。",
      explanationText: clean(spot?.explanation_text) || clean(spot?.answer_text) || "ここで得た理解が次の行動につながる。",
    })
  );
};

const assembleEpisodeOutput = (params: {
  input: GenerateEpisodeRuntimeInput;
  outline: EpisodeOutline;
  routePlan: EpisodeRoutePlan;
  castUsage: EpisodeCastUsagePlan;
  legacyEpisode: any;
  sceneBlocks: SceneTextBlock[];
}): EpisodeOutput => {
  const { input, outline, routePlan, castUsage, legacyEpisode, sceneBlocks } = params;
  const styleGuide = buildEpisodeVisualStyle(input, legacyEpisode);
  const localCharacters = mapLocalCharacters(input, legacyEpisode, styleGuide);
  const coverVisual = buildCoverVisual(input, legacyEpisode, styleGuide);
  const fixedCharacters = input.seriesBlueprint.persistentCharacters;
  const relationshipMap = new Map(input.userSeriesState.relationshipState.map((row) => [row.characterId, row]));

  return episodeOutputSchema.parse({
    workflowVersion: "series-runtime-episode-v2",
    episodeId: toId("ep", `${input.seriesBlueprint.id}:${outline.title}:${Date.now()}`),
    seriesBlueprintId: input.seriesBlueprint.id,
    userSeriesStateId: input.userSeriesState.id,
    ...coverVisual,
    episodeIndex: input.userSeriesState.progressSummary.episodeCountCompleted + 1,
    title: clean(legacyEpisode?.title) || outline.title,
    summary: clean(legacyEpisode?.summary) || outline.summaryHook,
    oneLiner: clean(legacyEpisode?.one_liner) || outline.summaryHook,
    mainPlot: {
      premise: clean(legacyEpisode?.premise) || outline.incidentCore,
      goal: clean(legacyEpisode?.goal) || outline.episodePurpose,
    },
    fixedCharactersAppeared: [fixedCharacters.partner.id, fixedCharacters.anchorNpc.id],
    localCharactersIntroduced: localCharacters,
    selectedSpots: routePlan.selectedSpotsInOrder.map((spot) => ({
      spotName: spot.spotName,
      sceneRole: spot.sceneRole,
      tourismFocus:
        input.request.episodeRequest.tourismGoal,
      estimatedWalkMinutes: spot.estimatedWalkMinutes,
    })),
    scenes: sceneBlocks.map((scene, index) => ({
      sceneIndex: scene.sceneIndex,
      spotName: scene.spotName,
      fixedCharacters: castUsage.fixedCastUsage.map((usage) => {
        const character = usage.characterId === fixedCharacters.partner.id ? fixedCharacters.partner : fixedCharacters.anchorNpc;
        const relationship = relationshipMap.get(character.id);
        return {
          characterId: character.id,
          displayName: character.displayName,
          roleInScene: usage.roleInEpisode,
          emotionalState: usage.emotionalMovementTarget,
          relationshipToUserNow: relationship?.closenessLabel || "未定義",
          linesStyleGuard: character.identity.speechStyle,
        };
      }),
      narration: scene.narration,
      dialogueBlocks: scene.dialogueBlocks,
      missionPrompt: scene.missionPrompt,
      inferenceQuestion: scene.inferenceQuestion,
      answerGuidance: scene.answerGuidance,
      explanationText: scene.explanationText,
    })),
    completionCondition: outline.completionCondition,
    carryOverHook: clean(legacyEpisode?.carry_over_hook) || outline.carryoverHint,
    estimatedDurationMinutes: clamp(input.request.episodeRequest.locationContext.availableMinutes || 75, 20, 180),
  });
};

const deriveContinuityPatch = (params: {
  input: GenerateEpisodeRuntimeInput;
  episodeOutput: EpisodeOutput;
  continuityContext: InternalContinuityContext;
  castUsage: EpisodeCastUsagePlan;
  outline: EpisodeOutline;
}): ContinuityPatch => {
  const { input, episodeOutput, continuityContext, castUsage, outline } = params;
  const relationshipPatch = castUsage.fixedCastUsage.map((usage) => ({
    characterId: usage.characterId,
    closenessDelta: usage.characterId === input.seriesBlueprint.persistentCharacters.partner.id ? 1 : 0.5,
    trustDelta: usage.characterId === input.seriesBlueprint.persistentCharacters.partner.id ? 6 : 3,
    tensionDelta: usage.characterId === input.seriesBlueprint.persistentCharacters.partner.id ? -2 : -1,
    affectionDelta: 0,
    newRelationshipState: usage.emotionalMovementTarget,
    keyMomentSummary: `${episodeOutput.title}で${usage.roleInEpisode}を共有した。`,
  }));

  return continuityPatchSchema.parse({
    memoryPatch: {
      addedEvents: [episodeOutput.title, episodeOutput.mainPlot.goal],
      addedSharedMemories: relationshipPatch.map((row) => row.keyMomentSummary),
      addedLocationMemories: episodeOutput.selectedSpots.map((spot) => spot.spotName),
      addedConversations: episodeOutput.scenes.flatMap((scene) => scene.dialogueBlocks.slice(0, 1).map((block) => block.text)).slice(0, 4),
    },
    relationshipPatch,
    achievementPatch: {
      addedTitles: [],
      addedAchievements: [],
      addedDiscoveryTags: deriveKeywordList(input.request.episodeRequest.tourismGoal, [input.request.episodeRequest.locationContext.cityOrArea]).slice(0, 4),
    },
    payoffPatch: {
      resolvedForeshadowing: continuityContext.callbacksToUse.slice(0, 1),
      newlySeededForeshadowing: outline.callbacksToSeed.slice(0, 1),
      activeThreads: [outline.carryoverHint],
      closedThreads: [],
    },
    continuityAxisPatch: input.seriesBlueprint.continuityAxes.axes.slice(0, 2).map((axis) => ({
      axisId: axis.axisId,
      previousLabel: input.userSeriesState.progressSummary.continuityAxisProgress.find((row) => row.axisId === axis.axisId)?.currentLabel || axis.initialStateLabel,
      nextLabel: axis.kind === "relationship" ? "前進" : "更新",
      movementReason: axis.kind === "relationship" ? "固定キャラとの共同推理が進んだ。" : "新しい土地理解が追加された。",
    })),
    localCharacterPatch: {
      introduced: episodeOutput.localCharactersIntroduced.map((character) => ({
        localCharacterId: character.localCharacterId,
        displayName: character.displayName,
        callbackEligible: character.callbackEligible,
      })),
      callbackEligible: episodeOutput.localCharactersIntroduced
        .filter((character) => character.callbackEligible)
        .map((character) => ({ localCharacterId: character.localCharacterId, reason: "地域再訪時の文脈再接続に使える。" })),
    },
  });
};

export const generateEpisodeRuntimeVNext = async (
  rawInput: GenerateEpisodeRuntimeInput,
  options: { onProgress?: ProgressReporter } = {}
): Promise<GenerateEpisodeRuntimeResult> => {
  const input = generateEpisodeRuntimeInputSchema.parse(rawInput);
  await emitProgress(options.onProgress, "request_received", "episode runtime request accepted");

  if (input.request.userId !== input.userSeriesState.userId) throw new Error("user_id_mismatch_between_request_and_state");
  if (input.request.seriesBlueprintId !== input.seriesBlueprint.id) throw new Error("series_blueprint_id_mismatch");
  if (input.request.userSeriesStateId !== input.userSeriesState.id) throw new Error("user_series_state_id_mismatch");
  await emitProgress(options.onProgress, "input_validated", "runtime input validated");

  await emitProgress(options.onProgress, "series_context_loaded", "series blueprint loaded");
  const continuityContext = buildContinuityContext(input);

  await emitProgress(options.onProgress, "episode_request_brief_start", "episode request brief を構成しています");
  const requestBrief = deriveEpisodeRequestBrief(input);
  await emitProgress(options.onProgress, "episode_request_brief_done", "episode request brief を確定しました");

  await emitProgress(options.onProgress, "local_material_selection_start", "現地素材を選定しています");
  const localMaterial = await selectLocalKnowledgeAndCandidates(input, requestBrief);
  await emitProgress(options.onProgress, "local_material_selection_done", "現地素材の選定が完了しました");

  await emitProgress(options.onProgress, "episode_cast_usage_start", "今回のキャラ配置を設計しています");
  const castUsage = designEpisodeCastUsage(input, requestBrief, continuityContext);
  await emitProgress(options.onProgress, "episode_cast_usage_done", "今回のキャラ配置を確定しました");

  await emitProgress(options.onProgress, "spot_mystery_structure_start", "スポットごとの謎構造を設計しています");
  const spotMystery = designSpotMysteryStructure(input, requestBrief, localMaterial, continuityContext);
  await emitProgress(options.onProgress, "spot_mystery_structure_done", "スポットごとの謎構造を確定しました");

  await emitProgress(options.onProgress, "narration_plan_start", "ナレーション計画を構成しています");
  const narrationPlan = designNarrationPlan(spotMystery);
  await emitProgress(options.onProgress, "narration_plan_done", "ナレーション計画を確定しました");

  await emitProgress(options.onProgress, "dialogue_plan_start", "会話計画を構成しています");
  const dialoguePlan = designDialoguePlan(input, castUsage, spotMystery);
  await emitProgress(options.onProgress, "dialogue_plan_done", "会話計画を確定しました");

  await emitProgress(options.onProgress, "episode_outline_start", "エピソードアウトラインを構成しています");
  const outline = designEpisodeOutline(input, requestBrief, spotMystery, continuityContext);
  await emitProgress(options.onProgress, "episode_outline_done", "エピソードアウトラインを確定しました");

  await emitProgress(options.onProgress, "route_dry_run_start", "導線を検証しています");
  const routePlan = buildRoutePlan(outline, localMaterial, requestBrief.locationContext.availableMinutes);
  if (!routePlan.feasible) {
    throw new Error(`episode_route_dry_run_failed:${routePlan.failureReasons.join(",")}`);
  }
  await emitProgress(options.onProgress, "route_dry_run_done", "導線検証が完了しました");

  await emitProgress(options.onProgress, "scene_generation_start", "本文生成を開始します");
  const legacyInput = buildLegacyRuntimeInput({ input, brief: requestBrief, outline, routePlan, spotMystery });
  const legacyEpisode = await generateSeriesRuntimeEpisode(legacyInput, {
    onProgress: async (event) => {
      const phase = mergeEpisodePhase(event.phase);
      if (!phase) return;
      await emitProgress(options.onProgress, phase, event.detail);
    },
  });
  await emitProgress(options.onProgress, "scene_generation_done", "本文生成が完了しました");

  await emitProgress(options.onProgress, "episode_assemble_start", "エピソード出力を統合しています");
  const sceneBlocks = buildSceneTextBlocks(legacyEpisode);
  const episodeOutput = assembleEpisodeOutput({
    input,
    outline,
    routePlan,
    castUsage,
    legacyEpisode,
    sceneBlocks,
  });
  await emitProgress(options.onProgress, "episode_assemble_done", "エピソード出力を統合しました");

  await emitProgress(options.onProgress, "continuity_patch_build_start", "継続状態差分を構築しています");
  const continuityPatch = deriveContinuityPatch({ input, episodeOutput, continuityContext, castUsage, outline });
  await emitProgress(options.onProgress, "continuity_patch_build_done", "継続状態差分を構築しました");

  await emitProgress(options.onProgress, "response_preparing", "レスポンスを整形しています");
  await emitProgress(options.onProgress, "completed", "episode runtime generation completed");
  return generateEpisodeRuntimeResultSchema.parse({
    workflowVersion: "series-runtime-episode-v2",
    episodeOutput,
    continuityPatch,
  });
};

const deriveClosenessLabel = (trustLevel: number, tensionLevel: number) => {
  if (trustLevel >= 75 && tensionLevel <= 25) return "close";
  if (trustLevel >= 55 && tensionLevel <= 40) return "warm";
  if (trustLevel >= 40) return "neutral";
  return "distant";
};

export const applyEpisodeContinuityPatch = (currentState: UserSeriesState, patch: ContinuityPatch): UserSeriesState => {
  const base = userSeriesStateSchema.parse(currentState);
  const nextEpisodeIndex = base.progressSummary.episodeCountCompleted + 1;
  const relationshipById = new Map(base.relationshipState.map((row) => [row.characterId, row]));

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
    const trustLevel = clamp(current.trustLevel + update.trustDelta, 0, 100);
    const tensionLevel = clamp(current.tensionLevel + update.tensionDelta, 0, 100);
    const affectionLevel = clamp((current.affectionLevel || 0) + (update.affectionDelta || 0), 0, 100);
    relationshipById.set(update.characterId, {
      ...current,
      trustLevel,
      tensionLevel,
      affectionLevel,
      closenessLabel: clean(update.newRelationshipState) || deriveClosenessLabel(trustLevel, tensionLevel),
      specialFlags: dedupe([...current.specialFlags, clean(update.newRelationshipState)]),
      sharedMemories: dedupe([...current.sharedMemories, ...patch.memoryPatch.addedSharedMemories, update.keyMomentSummary]),
      unresolvedEmotions: current.unresolvedEmotions,
    });
  }

  const continuityAxisProgress = base.progressSummary.continuityAxisProgress.map((row) => {
    const update = patch.continuityAxisPatch.find((item) => item.axisId === row.axisId);
    return update
      ? { axisId: row.axisId, currentLabel: update.nextLabel, recentShift: update.movementReason }
      : row;
  });

  return userSeriesStateSchema.parse({
    ...base,
    stateVersion: base.stateVersion + 1,
    progressSummary: {
      episodeCountCompleted: nextEpisodeIndex,
      activeThreads: dedupe([...base.progressSummary.activeThreads, ...patch.payoffPatch.activeThreads]).filter(
        (thread) => !patch.payoffPatch.closedThreads.some((closed) => closed.toLowerCase() === thread.toLowerCase())
      ),
      resolvedThreads: dedupe([...base.progressSummary.resolvedThreads, ...patch.payoffPatch.closedThreads]),
      recentEpisodeIds: dedupe([...base.progressSummary.recentEpisodeIds, `episode_${nextEpisodeIndex}`]).slice(-10),
      continuityAxisProgress,
    },
    rememberedExperience: {
      visitedLocations: dedupe([...base.rememberedExperience.visitedLocations, ...patch.memoryPatch.addedLocationMemories]),
      keyEvents: dedupe([...base.rememberedExperience.keyEvents, ...patch.memoryPatch.addedEvents]).slice(-20),
      importantConversations: dedupe([...base.rememberedExperience.importantConversations, ...patch.memoryPatch.addedConversations]).slice(-20),
      playerChoices: base.rememberedExperience.playerChoices,
      emotionalMoments: dedupe([...base.rememberedExperience.emotionalMoments, ...patch.memoryPatch.addedSharedMemories]).slice(-20),
      relationshipTurningPoints: dedupe([...base.rememberedExperience.relationshipTurningPoints, ...patch.relationshipPatch.map((row) => row.keyMomentSummary)]).slice(-20),
    },
    relationshipState: Array.from(relationshipById.values()),
    achievementState: {
      titles: dedupe([...base.achievementState.titles, ...patch.achievementPatch.addedTitles]),
      achievements: dedupe([...base.achievementState.achievements, ...patch.achievementPatch.addedAchievements]),
      discoveryTags: dedupe([...base.achievementState.discoveryTags, ...patch.achievementPatch.addedDiscoveryTags]),
    },
    continuityState: {
      callbackCandidates: dedupe([...base.continuityState.callbackCandidates, ...patch.payoffPatch.newlySeededForeshadowing]),
      motifsInUse: dedupe(base.continuityState.motifsInUse),
      blockedLines: base.continuityState.blockedLines,
      promisedPayoffs: dedupe([...base.continuityState.promisedPayoffs, ...patch.payoffPatch.activeThreads]),
    },
  });
};
