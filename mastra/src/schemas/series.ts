import { z } from "zod";

export const seriesInterviewSchema = z.object({
  genre_world: z.string().min(1),
  desired_emotion: z.string().min(1),
  companion_preference: z.string().min(1),
  continuation_trigger: z.string().min(1),
  avoidance_preferences: z.string().default(""),
  additional_notes: z.string().optional(),
  // Legacy keys kept optional for backward compatibility.
  main_objective: z.string().optional(),
  protagonist_position: z.string().optional(),
  partner_description: z.string().optional(),
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
  visual_assets: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string(),
        prompt: z.string(),
        image_url: z.string(),
      })
    )
    .max(6)
    .default([]),
});

export const seriesCharacterBigFiveSchema = z.object({
  openness: z.number().min(0).max(100),
  conscientiousness: z.number().min(0).max(100),
  extraversion: z.number().min(0).max(100),
  agreeableness: z.number().min(0).max(100),
  neuroticism: z.number().min(0).max(100),
});

export const seriesCharacterPersonalitySchema = z.object({
  summary: z.string(),
  big_five: seriesCharacterBigFiveSchema.optional(),
  enneagram_type: z.number().int().min(1).max(9).optional(),
  core_fear: z.string().optional(),
  core_desire: z.string().optional(),
  speech_pattern: z.string().optional(),
  catchphrase: z.string().optional(),
  quirks: z.array(z.string()).max(4).optional(),
});

export const seriesCharacterRelationshipSchema = z.object({
  target_id: z.string(),
  type: z.enum(["trust", "rivalry", "mentor", "debt", "secret", "family", "romance"]),
  description: z.string(),
  tension_level: z.number().min(0).max(100).optional(),
});

export const seriesCharacterVisualDesignSchema = z.object({
  dominant_color: z.string().default(""),
  body_type: z.string().default(""),
  silhouette_keyword: z.string().default(""),
  distinguishing_feature: z.string().default(""),
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
  // Extended fields (optional for backward compatibility)
  archetype: z.string().optional(),
  drive: z.string().optional(),
  dilemma: z.string().optional(),
  arc_midpoint: z.string().optional(),
  arc_trigger: z.string().optional(),
  backstory: z.string().optional(),
  // Flattened personality extensions
  big_five: seriesCharacterBigFiveSchema.optional(),
  enneagram_type: z.number().int().min(1).max(9).optional(),
  core_fear: z.string().optional(),
  core_desire: z.string().optional(),
  speech_pattern: z.string().optional(),
  catchphrase: z.string().optional(),
  quirks: z.array(z.string()).max(4).optional(),
  // Relationships and visual
  relationships: z.array(seriesCharacterRelationshipSchema).optional(),
  visual_design: seriesCharacterVisualDesignSchema.optional(),
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

export const seriesCheckpointSchema = z.object({
  checkpoint_no: z.number().int().min(1),
  title: z.string(),
  purpose: z.string(),
  unlock_hint: z.string(),
  expected_emotion: z.string(),
  carry_over: z.string(),
});

export const seriesEpisodeSeedSchema = z.object({
  title: z.string(),
  objective: z.string(),
  opening_scene: z.string(),
  expected_duration_minutes: z.number().int().min(10).max(45),
  route_style: z.string(),
  completion_condition: z.string(),
  carry_over_hint: z.string(),
  suggested_spots: z.array(z.string()).min(1).max(6),
});

export const seriesProgressStateSchema = z.object({
  last_completed_episode_no: z.number().int().min(0),
  unresolved_threads: z.array(z.string()),
  revealed_facts: z.array(z.string()),
  companion_trust_level: z.number().min(0).max(100),
  next_hook: z.string(),
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
  checkpoints: z.array(seriesCheckpointSchema).min(4).max(8),
  first_episode_seed: seriesEpisodeSeedSchema,
  progress_state: seriesProgressStateSchema,
  // Keep legacy field for compatibility with older clients.
  episode_blueprints: z.array(seriesEpisodeBlueprintSchema).min(0).max(24).default([]),
  continuity: seriesContinuitySchema,
});

export const seriesWorkflowOutputSchema = z.object({
  series: seriesOutputSchema,
  meta: z.object({
    desired_episode_count: z.number().int().min(3).max(24),
    generated_checkpoint_count: z.number().int().min(4).max(8),
    workflow_version: z.string(),
    warnings: z.array(z.string()),
  }),
});

export type SeriesGenerationRequest = z.infer<typeof seriesGenerationRequestSchema>;
export type SeriesOutput = z.infer<typeof seriesOutputSchema>;
export type SeriesCharacter = z.infer<typeof seriesCharacterSchema>;
export type SeriesEpisodeBlueprint = z.infer<typeof seriesEpisodeBlueprintSchema>;
