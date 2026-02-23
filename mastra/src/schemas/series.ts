import { z } from "zod";

export const seriesInterviewSchema = z.object({
  genre_world: z.string().min(1),
  main_objective: z.string().min(1),
  protagonist_position: z.string().min(1),
  partner_description: z.string().min(1),
  additional_notes: z.string().optional(),
});

export const seriesGenerationRequestSchema = z.object({
  interview: seriesInterviewSchema,
  desired_episode_count: z.number().int().min(3).max(24).optional(),
  prompt: z.string().optional(),
  creator_id: z.string().uuid().optional(),
  language: z.string().optional(),
});

export const seriesWorldSchema = z.object({
  era: z.string(),
  setting: z.string(),
  social_structure: z.string(),
  core_conflict: z.string(),
  taboo_rules: z.array(z.string()),
  recurring_motifs: z.array(z.string()),
});

export const seriesCharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  goal: z.string(),
  arc_start: z.string(),
  arc_end: z.string(),
  personality: z.string(),
  appearance: z.string(),
  portrait_prompt: z.string(),
  portrait_image_url: z.string(),
  secrets: z.array(z.string()),
  relationship_hooks: z.array(z.string()),
});

export const seriesEpisodeBlueprintSchema = z.object({
  episode_no: z.number().int().min(1),
  title: z.string(),
  objective: z.string(),
  synopsis: z.string(),
  key_location: z.string(),
  emotional_beat: z.string(),
  required_setups: z.array(z.string()),
  payoff_targets: z.array(z.string()),
  cliffhanger: z.string(),
  continuity_notes: z.string(),
  suggested_mission: z.string(),
});

export const seriesContinuitySchema = z.object({
  global_mystery: z.string(),
  mid_season_twist: z.string(),
  finale_payoff: z.string(),
  invariant_rules: z.array(z.string()),
  episode_link_policy: z.array(z.string()),
});

export const seriesOutputSchema = z.object({
  title: z.string(),
  overview: z.string(),
  ai_rules: z.string(),
  genre: z.string(),
  tone: z.string(),
  premise: z.string(),
  season_goal: z.string(),
  cover_image_prompt: z.string(),
  cover_image_url: z.string(),
  world: seriesWorldSchema,
  characters: z.array(seriesCharacterSchema).min(3).max(8),
  episode_blueprints: z.array(seriesEpisodeBlueprintSchema).min(3).max(24),
  continuity: seriesContinuitySchema,
});

export const seriesWorkflowOutputSchema = z.object({
  series: seriesOutputSchema,
  meta: z.object({
    desired_episode_count: z.number().int().min(3).max(24),
    generated_episode_count: z.number().int().min(3).max(24),
    workflow_version: z.string(),
    warnings: z.array(z.string()),
  }),
});

export type SeriesGenerationRequest = z.infer<typeof seriesGenerationRequestSchema>;
export type SeriesOutput = z.infer<typeof seriesOutputSchema>;
export type SeriesCharacter = z.infer<typeof seriesCharacterSchema>;
export type SeriesEpisodeBlueprint = z.infer<typeof seriesEpisodeBlueprintSchema>;
