import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  seriesCheckpointSchema,
  seriesCharacterSchema,
  seriesEpisodeSeedSchema,
  seriesGenerationRequestSchema,
  seriesInterviewSchema,
  seriesWorkflowOutputSchema,
} from "../schemas/series";
import {
  generateSeriesConcept,
  seriesConceptAgentOutputSchema,
} from "../lib/agents/seriesConceptAgent";
import { generateSeriesCharacters } from "../lib/agents/seriesCharacterAgent";
import { generateSeriesEpisodePlan } from "../lib/agents/seriesEpisodePlannerAgent";
import { generateSeriesConsistency } from "../lib/agents/seriesConsistencyAgent";
import { buildCoverImagePrompt, buildSeriesImageUrl, buildWorldVisualPrompt } from "../lib/seriesVisuals";

const clean = (value?: string) => (value || "").replace(/\s+/g, " ").trim();

const resolvedSeriesRequestSchema = z.object({
  interview: seriesInterviewSchema,
  desired_episode_count: z.number().int().min(3).max(24),
  prompt: z.string().optional(),
  creator_id: z.string().uuid().optional(),
  language: z.string(),
});

const LOG_PREFIX = "[series-workflow]";

const sanitizeRequestStep = createStep({
  id: "sanitize-series-request",
  inputSchema: seriesGenerationRequestSchema,
  outputSchema: resolvedSeriesRequestSchema,
  execute: async ({ inputData }) => {
    console.log(`${LOG_PREFIX} step 1/5: sanitize-series-request 開始`);
    try {
      const resolved: z.infer<typeof resolvedSeriesRequestSchema> = {
      desired_episode_count: inputData.desired_episode_count ?? 8,
      prompt: clean(inputData.prompt),
      language: clean(inputData.language) || "ja",
      creator_id: inputData.creator_id,
      interview: {
        genre_world: clean(inputData.interview.genre_world),
        desired_emotion: clean(inputData.interview.desired_emotion),
        companion_preference: clean(inputData.interview.companion_preference),
        continuation_trigger: clean(inputData.interview.continuation_trigger),
        avoidance_preferences: clean(inputData.interview.avoidance_preferences),
        additional_notes: clean(inputData.interview.additional_notes),
        main_objective: clean(inputData.interview.main_objective),
        protagonist_position: clean(inputData.interview.protagonist_position),
        partner_description: clean(inputData.interview.partner_description),
      },
    };
      console.log(`${LOG_PREFIX} step 1/5: sanitize-series-request 完了`);
      return resolved;
    } catch (e: any) {
      console.error(`${LOG_PREFIX} step 1/5: sanitize-series-request 失敗`, e?.message ?? e);
      throw e;
    }
  },
});

const conceptStepOutputSchema = z.object({
  request: resolvedSeriesRequestSchema,
  concept: seriesConceptAgentOutputSchema,
});

const generateConceptStep = createStep({
  id: "generate-series-concept",
  inputSchema: resolvedSeriesRequestSchema,
  outputSchema: conceptStepOutputSchema,
  execute: async ({ inputData }) => {
    console.log(`${LOG_PREFIX} step 2/5: generate-series-concept 開始`);
    try {
      const concept = await generateSeriesConcept({
        interview: inputData.interview,
        prompt: inputData.prompt,
        desiredEpisodeCount: inputData.desired_episode_count,
        language: inputData.language,
      });
      console.log(`${LOG_PREFIX} step 2/5: generate-series-concept 完了 (title: ${concept?.title ?? "—"})`);
      return {
        request: inputData,
        concept,
      };
    } catch (e: any) {
      console.error(`${LOG_PREFIX} step 2/5: generate-series-concept 失敗`, e?.message ?? e);
      throw e;
    }
  },
});

const charactersStepOutputSchema = conceptStepOutputSchema.extend({
  characters: z.array(seriesCharacterSchema).min(3).max(8),
});

const generateCharactersStep = createStep({
  id: "generate-series-characters",
  inputSchema: conceptStepOutputSchema,
  outputSchema: charactersStepOutputSchema,
  execute: async ({ inputData }) => {
    console.log(`${LOG_PREFIX} step 3/5: generate-series-characters 開始`);
    try {
      const targetCount = Math.max(3, Math.min(8, Math.ceil(inputData.request.desired_episode_count / 2)));
      const characterResult = await generateSeriesCharacters({
        title: inputData.concept.title,
        genre: inputData.concept.genre,
        tone: inputData.concept.tone,
        premise: inputData.concept.premise,
        season_goal: inputData.concept.season_goal,
        protagonist_position: "プレイヤー本人（旅を続ける視点人物）",
        partner_description:
          clean(inputData.request.interview.companion_preference) ||
          clean(inputData.request.interview.partner_description) ||
          "信頼できる相棒",
        target_count: targetCount,
      });
      const count = characterResult?.characters?.length ?? 0;
      console.log(`${LOG_PREFIX} step 3/5: generate-series-characters 完了 (${count}人)`);
      return {
        ...inputData,
        characters: characterResult.characters,
      };
    } catch (e: any) {
      console.error(`${LOG_PREFIX} step 3/5: generate-series-characters 失敗`, e?.message ?? e);
      throw e;
    }
  },
});

const episodeStepOutputSchema = charactersStepOutputSchema.extend({
  checkpoints: z.array(seriesCheckpointSchema).min(4).max(8),
  first_episode_seed: seriesEpisodeSeedSchema,
});

const generateEpisodesStep = createStep({
  id: "generate-series-checkpoints",
  inputSchema: charactersStepOutputSchema,
  outputSchema: episodeStepOutputSchema,
  execute: async ({ inputData }) => {
    console.log(`${LOG_PREFIX} step 4/5: generate-series-checkpoints 開始`);
    try {
      const plan = await generateSeriesEpisodePlan({
        title: inputData.concept.title,
        premise: inputData.concept.premise,
        season_goal: inputData.concept.season_goal,
        genre: inputData.concept.genre,
        tone: inputData.concept.tone,
        world: inputData.concept.world,
        characters: inputData.characters,
        desired_episode_count: inputData.request.desired_episode_count,
      });
      const cpCount = plan?.checkpoints?.length ?? 0;
      console.log(`${LOG_PREFIX} step 4/5: generate-series-checkpoints 完了 (checkpoints: ${cpCount})`);
      return {
        ...inputData,
        checkpoints: plan.checkpoints,
        first_episode_seed: plan.first_episode_seed,
      };
    } catch (e: any) {
      console.error(`${LOG_PREFIX} step 4/5: generate-series-checkpoints 失敗`, e?.message ?? e);
      throw e;
    }
  },
});

const finalizeSeriesStep = createStep({
  id: "finalize-series-blueprint",
  inputSchema: episodeStepOutputSchema,
  outputSchema: seriesWorkflowOutputSchema,
  execute: async ({ inputData }) => {
    console.log(`${LOG_PREFIX} step 5/5: finalize-series-blueprint 開始`);
    try {
      const consistency = await generateSeriesConsistency({
      title: inputData.concept.title,
      overview: inputData.concept.overview,
      premise: inputData.concept.premise,
      season_goal: inputData.concept.season_goal,
      ai_rule_points: inputData.concept.ai_rule_points,
      characters: inputData.characters,
      checkpoints: inputData.checkpoints,
      first_episode_seed: inputData.first_episode_seed,
    });

    const aiRulePoints = consistency.ai_rule_points.slice(0, 12);
    const warnings: string[] = [];
    if (consistency.warnings && consistency.warnings.length > 0) {
      warnings.push(...consistency.warnings);
    }

    const coverImagePrompt =
      clean(inputData.concept.cover_image_prompt) ||
      buildCoverImagePrompt({
        title: inputData.concept.title,
        genre: inputData.concept.genre,
        tone: inputData.concept.tone,
        premise: inputData.concept.premise,
        setting: inputData.concept.world.setting,
      });

    const worldVisualSeeds = [
      {
        id: "upper_area",
        title: "上層エリア",
        description:
          clean(inputData.concept.world.social_structure) || "光と秩序に包まれた都市中枢。徒歩で巡れる主要動線が整う。",
        atmosphere: clean(inputData.concept.tone) || "高密度で緊張感のある空気",
      },
      {
        id: "lower_area",
        title: "下層エリア",
        description:
          clean(inputData.concept.world.core_conflict) ||
          clean(consistency.continuity.global_mystery) ||
          "生活圏と秘密が交差する街路。歩くほど手がかりが増える。",
        atmosphere: clean(consistency.continuity.mid_season_twist) || "少し不穏な余韻",
      },
    ] as const;

    const worldVisualAssets = worldVisualSeeds.map((seed, index) => {
      const prompt = buildWorldVisualPrompt({
        seriesTitle: inputData.concept.title,
        genre: inputData.concept.genre,
        tone: inputData.concept.tone,
        setting: inputData.concept.world.setting,
        focusTitle: seed.title,
        focusDescription: seed.description,
        atmosphere: seed.atmosphere,
      });

      return {
        id: seed.id,
        title: seed.title,
        description: seed.description,
        prompt,
        image_url: buildSeriesImageUrl({
          prompt,
          seedKey: `${inputData.concept.title}:world:${seed.id}:${index + 1}`,
          width: 960,
          height: 640,
        }),
      };
    });

    const output = {
      series: {
        title: inputData.concept.title,
        overview: consistency.overview_refined || inputData.concept.overview,
        ai_rules: aiRulePoints.map((rule) => `- ${rule}`).join("\n"),
        genre: inputData.concept.genre,
        tone: inputData.concept.tone,
        premise: inputData.concept.premise,
        season_goal: inputData.concept.season_goal,
        cover_image_prompt: coverImagePrompt,
        cover_image_url: buildSeriesImageUrl({
          prompt: coverImagePrompt,
          seedKey: `${inputData.concept.title}:cover`,
          width: 1024,
          height: 1365,
        }),
        world: {
          ...inputData.concept.world,
          visual_assets: worldVisualAssets,
        },
        characters: inputData.characters,
        checkpoints: inputData.checkpoints,
        first_episode_seed: inputData.first_episode_seed,
        progress_state: {
          last_completed_episode_no: 0,
          unresolved_threads: [consistency.continuity.global_mystery].filter((item) => clean(item).length > 0),
          revealed_facts: [],
          companion_trust_level: 40,
          next_hook: clean(inputData.first_episode_seed.carry_over_hint) || "次回につながる問いが残る。",
        },
        // Keep legacy field for backward compatibility with old clients.
        episode_blueprints: [],
        continuity: consistency.continuity,
      },
      meta: {
        desired_episode_count: inputData.request.desired_episode_count,
        generated_checkpoint_count: inputData.checkpoints.length,
        workflow_version: "series-workflow-v3",
        warnings,
      },
    };
      console.log(`${LOG_PREFIX} step 5/5: finalize-series-blueprint 完了`);
      return output;
    } catch (e: any) {
      console.error(`${LOG_PREFIX} step 5/5: finalize-series-blueprint 失敗`, e?.message ?? e);
      throw e;
    }
  },
});

export const seriesWorkflow = createWorkflow({
  id: "series-workflow",
  inputSchema: seriesGenerationRequestSchema,
  outputSchema: seriesWorkflowOutputSchema,
})
  .then(sanitizeRequestStep)
  .then(generateConceptStep)
  .then(generateCharactersStep)
  .then(generateEpisodesStep)
  .then(finalizeSeriesStep)
  .commit();

export type SeriesGenerationProgressPhase =
  | "sanitize_series_request_start"
  | "sanitize_series_request_done"
  | "generate_series_concept_start"
  | "generate_series_concept_done"
  | "generate_series_characters_start"
  | "generate_series_characters_done"
  | "generate_series_checkpoints_start"
  | "generate_series_checkpoints_done"
  | "finalize_series_blueprint_start"
  | "finalize_series_blueprint_done";

export type SeriesGenerationProgressEvent = {
  phase: SeriesGenerationProgressPhase;
  at: string;
  detail?: string;
};

type SeriesGenerationProgressReporter = (
  event: SeriesGenerationProgressEvent
) => void | Promise<void>;

const emitSeriesGenerationProgress = async (
  reporter: SeriesGenerationProgressReporter | undefined,
  event: Omit<SeriesGenerationProgressEvent, "at">
) => {
  if (!reporter) return;
  await reporter({
    ...event,
    at: new Date().toISOString(),
  });
};

export const generateSeriesWorkflowWithProgress = async (
  rawInput: z.infer<typeof seriesGenerationRequestSchema>,
  options: {
    onProgress?: SeriesGenerationProgressReporter;
  } = {}
): Promise<z.infer<typeof seriesWorkflowOutputSchema>> => {
  const onProgress = options.onProgress;

  await emitSeriesGenerationProgress(onProgress, {
    phase: "sanitize_series_request_start",
    detail: "入力情報を正規化しています",
  });
  const request: z.infer<typeof resolvedSeriesRequestSchema> = {
    desired_episode_count: rawInput.desired_episode_count ?? 8,
    prompt: clean(rawInput.prompt),
    language: clean(rawInput.language) || "ja",
    creator_id: rawInput.creator_id,
    interview: {
      genre_world: clean(rawInput.interview.genre_world),
      desired_emotion: clean(rawInput.interview.desired_emotion),
      companion_preference: clean(rawInput.interview.companion_preference),
      continuation_trigger: clean(rawInput.interview.continuation_trigger),
      avoidance_preferences: clean(rawInput.interview.avoidance_preferences),
      additional_notes: clean(rawInput.interview.additional_notes),
      main_objective: clean(rawInput.interview.main_objective),
      protagonist_position: clean(rawInput.interview.protagonist_position),
      partner_description: clean(rawInput.interview.partner_description),
    },
  };
  await emitSeriesGenerationProgress(onProgress, {
    phase: "sanitize_series_request_done",
    detail: "入力情報の正規化が完了しました",
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "generate_series_concept_start",
    detail: "世界観と物語コンセプトを生成しています",
  });
  const concept = await generateSeriesConcept({
    interview: request.interview,
    prompt: request.prompt,
    desiredEpisodeCount: request.desired_episode_count,
    language: request.language,
  });
  await emitSeriesGenerationProgress(onProgress, {
    phase: "generate_series_concept_done",
    detail: `コンセプト生成が完了しました（${concept?.title || "タイトル未確定"}）`,
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "generate_series_characters_start",
    detail: "主要キャラクターを設計しています",
  });
  const targetCount = Math.max(3, Math.min(8, Math.ceil(request.desired_episode_count / 2)));
  const characterResult = await generateSeriesCharacters({
    title: concept.title,
    genre: concept.genre,
    tone: concept.tone,
    premise: concept.premise,
    season_goal: concept.season_goal,
    protagonist_position: "プレイヤー本人（旅を続ける視点人物）",
    partner_description:
      clean(request.interview.companion_preference) ||
      clean(request.interview.partner_description) ||
      "信頼できる相棒",
    target_count: targetCount,
  });
  const characters = characterResult.characters;
  await emitSeriesGenerationProgress(onProgress, {
    phase: "generate_series_characters_done",
    detail: `キャラクター生成が完了しました（${characters.length}人）`,
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "generate_series_checkpoints_start",
    detail: "エピソード進行チェックポイントを設計しています",
  });
  const plan = await generateSeriesEpisodePlan({
    title: concept.title,
    premise: concept.premise,
    season_goal: concept.season_goal,
    genre: concept.genre,
    tone: concept.tone,
    world: concept.world,
    characters,
    desired_episode_count: request.desired_episode_count,
  });
  const checkpoints = plan.checkpoints;
  const firstEpisodeSeed = plan.first_episode_seed;
  await emitSeriesGenerationProgress(onProgress, {
    phase: "generate_series_checkpoints_done",
    detail: `チェックポイント生成が完了しました（${checkpoints.length}件）`,
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "finalize_series_blueprint_start",
    detail: "整合性チェックと最終統合を実施しています",
  });
  const consistency = await generateSeriesConsistency({
    title: concept.title,
    overview: concept.overview,
    premise: concept.premise,
    season_goal: concept.season_goal,
    ai_rule_points: concept.ai_rule_points,
    characters,
    checkpoints,
    first_episode_seed: firstEpisodeSeed,
  });

  const aiRulePoints = consistency.ai_rule_points.slice(0, 12);
  const warnings: string[] = [];
  if (consistency.warnings && consistency.warnings.length > 0) {
    warnings.push(...consistency.warnings);
  }

  const coverImagePrompt =
    clean(concept.cover_image_prompt) ||
    buildCoverImagePrompt({
      title: concept.title,
      genre: concept.genre,
      tone: concept.tone,
      premise: concept.premise,
      setting: concept.world.setting,
    });

  const worldVisualSeeds = [
    {
      id: "upper_area",
      title: "上層エリア",
      description:
        clean(concept.world.social_structure) || "光と秩序に包まれた都市中枢。徒歩で巡れる主要動線が整う。",
      atmosphere: clean(concept.tone) || "高密度で緊張感のある空気",
    },
    {
      id: "lower_area",
      title: "下層エリア",
      description:
        clean(concept.world.core_conflict) ||
        clean(consistency.continuity.global_mystery) ||
        "生活圏と秘密が交差する街路。歩くほど手がかりが増える。",
      atmosphere: clean(consistency.continuity.mid_season_twist) || "少し不穏な余韻",
    },
  ] as const;

  const worldVisualAssets = worldVisualSeeds.map((seed, index) => {
    const prompt = buildWorldVisualPrompt({
      seriesTitle: concept.title,
      genre: concept.genre,
      tone: concept.tone,
      setting: concept.world.setting,
      focusTitle: seed.title,
      focusDescription: seed.description,
      atmosphere: seed.atmosphere,
    });

    return {
      id: seed.id,
      title: seed.title,
      description: seed.description,
      prompt,
      image_url: buildSeriesImageUrl({
        prompt,
        seedKey: `${concept.title}:world:${seed.id}:${index + 1}`,
        width: 960,
        height: 640,
      }),
    };
  });

  const output = {
    series: {
      title: concept.title,
      overview: consistency.overview_refined || concept.overview,
      ai_rules: aiRulePoints.map((rule) => `- ${rule}`).join("\n"),
      genre: concept.genre,
      tone: concept.tone,
      premise: concept.premise,
      season_goal: concept.season_goal,
      cover_image_prompt: coverImagePrompt,
      cover_image_url: buildSeriesImageUrl({
        prompt: coverImagePrompt,
        seedKey: `${concept.title}:cover`,
        width: 1024,
        height: 1365,
      }),
      world: {
        ...concept.world,
        visual_assets: worldVisualAssets,
      },
      characters,
      checkpoints,
      first_episode_seed: firstEpisodeSeed,
      progress_state: {
        last_completed_episode_no: 0,
        unresolved_threads: [consistency.continuity.global_mystery].filter((item) => clean(item).length > 0),
        revealed_facts: [],
        companion_trust_level: 40,
        next_hook: clean(firstEpisodeSeed.carry_over_hint) || "次回につながる問いが残る。",
      },
      episode_blueprints: [],
      continuity: consistency.continuity,
    },
    meta: {
      desired_episode_count: request.desired_episode_count,
      generated_checkpoint_count: checkpoints.length,
      workflow_version: "series-workflow-v3",
      warnings,
    },
  } satisfies z.infer<typeof seriesWorkflowOutputSchema>;

  await emitSeriesGenerationProgress(onProgress, {
    phase: "finalize_series_blueprint_done",
    detail: "シリーズ設計の最終統合が完了しました",
  });
  return output;
};

export type SeriesWorkflowInput = z.infer<typeof seriesGenerationRequestSchema>;
export type SeriesWorkflowOutput = z.infer<typeof seriesWorkflowOutputSchema>;
