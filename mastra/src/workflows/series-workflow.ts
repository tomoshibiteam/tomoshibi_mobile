import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  seriesCharacterSchema,
  seriesEpisodeBlueprintSchema,
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
import { buildCoverImagePrompt, buildSeriesImageUrl } from "../lib/seriesVisuals";

const clean = (value?: string) => (value || "").replace(/\s+/g, " ").trim();

const resolvedSeriesRequestSchema = z.object({
  interview: seriesInterviewSchema,
  desired_episode_count: z.number().int().min(3).max(24),
  prompt: z.string().optional(),
  creator_id: z.string().uuid().optional(),
  language: z.string(),
});

const sanitizeRequestStep = createStep({
  id: "sanitize-series-request",
  inputSchema: seriesGenerationRequestSchema,
  outputSchema: resolvedSeriesRequestSchema,
  execute: async ({ inputData }) => {
    const resolved: z.infer<typeof resolvedSeriesRequestSchema> = {
      desired_episode_count: inputData.desired_episode_count ?? 8,
      prompt: clean(inputData.prompt),
      language: clean(inputData.language) || "ja",
      creator_id: inputData.creator_id,
      interview: {
        genre_world: clean(inputData.interview.genre_world),
        main_objective: clean(inputData.interview.main_objective),
        protagonist_position: clean(inputData.interview.protagonist_position),
        partner_description: clean(inputData.interview.partner_description),
        additional_notes: clean(inputData.interview.additional_notes),
      },
    };
    return resolved;
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
    const concept = await generateSeriesConcept({
      interview: inputData.interview,
      prompt: inputData.prompt,
      desiredEpisodeCount: inputData.desired_episode_count,
      language: inputData.language,
    });

    return {
      request: inputData,
      concept,
    };
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
    const targetCount = Math.max(3, Math.min(8, Math.ceil(inputData.request.desired_episode_count / 2)));
    const characterResult = await generateSeriesCharacters({
      title: inputData.concept.title,
      genre: inputData.concept.genre,
      tone: inputData.concept.tone,
      premise: inputData.concept.premise,
      season_goal: inputData.concept.season_goal,
      protagonist_position: inputData.request.interview.protagonist_position,
      partner_description: inputData.request.interview.partner_description,
      target_count: targetCount,
    });

    return {
      ...inputData,
      characters: characterResult.characters,
    };
  },
});

const episodeStepOutputSchema = charactersStepOutputSchema.extend({
  episode_blueprints: z.array(seriesEpisodeBlueprintSchema).min(3).max(24),
});

const generateEpisodesStep = createStep({
  id: "generate-series-episodes",
  inputSchema: charactersStepOutputSchema,
  outputSchema: episodeStepOutputSchema,
  execute: async ({ inputData }) => {
    const episodes = await generateSeriesEpisodePlan({
      title: inputData.concept.title,
      premise: inputData.concept.premise,
      season_goal: inputData.concept.season_goal,
      genre: inputData.concept.genre,
      tone: inputData.concept.tone,
      world: inputData.concept.world,
      characters: inputData.characters,
      desired_episode_count: inputData.request.desired_episode_count,
    });

    return {
      ...inputData,
      episode_blueprints: episodes.episode_blueprints,
    };
  },
});

const finalizeSeriesStep = createStep({
  id: "finalize-series-blueprint",
  inputSchema: episodeStepOutputSchema,
  outputSchema: seriesWorkflowOutputSchema,
  execute: async ({ inputData }) => {
    const consistency = await generateSeriesConsistency({
      title: inputData.concept.title,
      overview: inputData.concept.overview,
      premise: inputData.concept.premise,
      season_goal: inputData.concept.season_goal,
      ai_rule_points: inputData.concept.ai_rule_points,
      characters: inputData.characters,
      episode_blueprints: inputData.episode_blueprints,
    });

    const aiRulePoints = consistency.ai_rule_points.slice(0, 12);
    const warnings: string[] = [];
    if (consistency.warnings && consistency.warnings.length > 0) {
      warnings.push(...consistency.warnings);
    }
    if (inputData.episode_blueprints.length !== inputData.request.desired_episode_count) {
      warnings.push("episode_count_adjusted");
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

    return {
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
        world: inputData.concept.world,
        characters: inputData.characters,
        episode_blueprints: inputData.episode_blueprints,
        continuity: consistency.continuity,
      },
      meta: {
        desired_episode_count: inputData.request.desired_episode_count,
        generated_episode_count: inputData.episode_blueprints.length,
        workflow_version: "series-workflow-v2",
        warnings,
      },
    };
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

export type SeriesWorkflowInput = z.infer<typeof seriesGenerationRequestSchema>;
export type SeriesWorkflowOutput = z.infer<typeof seriesWorkflowOutputSchema>;
