import { z } from "zod";

export const seriesInterviewSchema = z.object({
  genre_world: z.string().min(1),
  desired_emotion: z.string().min(1),
  companion_preference: z.string().min(1),
  continuation_trigger: z.string().min(1),
  avoidance_preferences: z.string().default(""),
  additional_notes: z.string().optional(),
  visual_style_preset: z.string().optional(),
  visual_style_notes: z.string().optional(),
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
  generation_mode: z.enum(["proposal", "full"]).optional(),
  existing_identity_pack: z.unknown().optional(),
  identity_retcon: z.boolean().optional(),
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

export const seriesCharacterIdentityAnchorTokensSchema = z.object({
  hair: z.string().default(""),
  silhouette: z.string().default(""),
  dominant_color: z.string().default(""),
  outfit_key_item: z.string().default(""),
  distinguishing_feature: z.string().default(""),
});

export const seriesCharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  tier: z.enum(["primary", "secondary"]).default("secondary"),
  must_appear: z.boolean().default(false),
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
  is_key_person: z.boolean().optional(),
  identity_anchor_tokens: seriesCharacterIdentityAnchorTokensSchema.optional(),
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

export const seriesEpisodeSeedSpotRequirementSchema = z.object({
  requirement_id: z.string(),
  scene_role: z.enum(["起", "承", "転", "結"]),
  spot_role: z.string(),
  required_attributes: z.array(z.string()).max(8).default([]),
  visit_constraints: z.array(z.string()).max(8).default([]),
  tourism_value_type: z.string(),
});

export const seriesEpisodeSeedSchema = z.object({
  title: z.string(),
  objective: z.string(),
  opening_scene: z.string(),
  expected_duration_minutes: z.number().int().min(10).max(45),
  route_style: z.string(),
  completion_condition: z.string(),
  carry_over_hint: z.string(),
  spot_requirements: z.array(seriesEpisodeSeedSpotRequirementSchema).min(2).max(4),
  // Legacy compatibility field. New planner no longer decides concrete spot names.
  suggested_spots: z.array(z.string()).max(6).optional(),
});

export const seriesProgressStateSchema = z.object({
  last_completed_episode_no: z.number().int().min(0),
  unresolved_threads: z.array(z.string()),
  revealed_facts: z.array(z.string()),
  relationship_state_summary: z.string().default("関係性は初期状態。"),
  relationship_flags: z.array(z.string()).default([]),
  recent_relation_shift: z.array(z.string()).default([]),
  // Legacy compatibility field. Keep as derived metric input only.
  companion_trust_level: z.number().min(0).max(100).optional(),
  next_hook: z.string(),
});

export const seriesContinuitySchema = z.object({
  global_mystery: z.string(),
  mid_season_twist: z.string(),
  finale_payoff: z.string(),
  invariant_rules: z.array(z.string()),
  episode_link_policy: z.array(z.string()),
});

export const seriesCoverFocusCharacterSchema = z.object({
  character_id: z.string(),
  name: z.string(),
  role: z.string(),
  focus_reason: z.string(),
  visual_anchor: z.string(),
});

export const seriesIdentityPackCharacterSchema = z.object({
  character_id: z.string(),
  name: z.string(),
  role: z.string(),
  is_key_person: z.boolean(),
  identity_anchor_tokens: seriesCharacterIdentityAnchorTokensSchema,
  portrait_prompt: z.string().optional(),
  portrait_image_url: z.string().optional(),
});

export const seriesIdentityPackSchema = z.object({
  version: z.number().int().min(1),
  source: z.enum(["generated", "reused"]),
  style_bible: z.string(),
  key_person_character_ids: z.array(z.string()).min(1).max(3),
  characters: z.array(seriesIdentityPackCharacterSchema).min(3).max(8),
  locked_at: z.string(),
});

export const seriesCoverConsistencyCharacterScoreSchema = z.object({
  character_id: z.string(),
  name: z.string(),
  role: z.string(),
  arcface_similarity: z.number().min(0).max(1),
  clip_similarity: z.number().min(0).max(1),
  vision_anchor_match: z.number().min(0).max(1),
  passed_axes: z.number().int().min(0).max(3),
  passed: z.boolean(),
});

export const seriesCoverCandidateReportSchema = z.object({
  candidate_index: z.number().int().min(1),
  round_index: z.number().int().min(1),
  image_url: z.string(),
  provider: z.string().optional(),
  prompt: z.string(),
  arcface_avg: z.number().min(0).max(1),
  clip_avg: z.number().min(0).max(1),
  vision_anchor_avg: z.number().min(0).max(1),
  style_similarity: z.number().min(0).max(1),
  pass_rate: z.number().min(0).max(1),
  passed: z.boolean(),
  character_scores: z.array(seriesCoverConsistencyCharacterScoreSchema).min(0).max(3),
});

export const seriesCoverConsistencyReportSchema = z.object({
  mode: z.enum(["quality_first"]),
  thresholds: z.object({
    required_axes_per_character: z.number().int().min(1).max(3),
    min_average_pass_rate: z.number().min(0).max(1),
    min_style_similarity: z.number().min(0).max(1),
  }),
  validation_rounds: z.number().int().min(1).max(3),
  selected_candidate_index: z.number().int().min(1).max(12),
  selected_cover_image_url: z.string(),
  selected_cover_image_prompt: z.string(),
  selected_provider: z.string().optional(),
  passed: z.boolean(),
  summary: z.string(),
  candidate_reports: z.array(seriesCoverCandidateReportSchema).min(1).max(12),
});

export const seriesOutputSchema = z.object({
  title: z.string(),
  overview: z.string(),
  ai_rules: z.string(),
  genre: z.string(),
  tone: z.string(),
  premise: z.string(),
  season_goal: z.string(),
  visual_style_preset: z.string().optional(),
  visual_style_notes: z.string().optional(),
  cover_image_prompt: z.string(),
  cover_image_url: z.string(),
  world: seriesWorldSchema,
  characters: z.array(seriesCharacterSchema).min(3).max(8),
  cover_focus_characters: z.array(seriesCoverFocusCharacterSchema).min(1).max(3),
  identity_pack: seriesIdentityPackSchema,
  cover_consistency_report: seriesCoverConsistencyReportSchema,
  checkpoints: z.array(seriesCheckpointSchema).min(4).max(8),
  first_episode_seed: seriesEpisodeSeedSchema,
  progress_state: seriesProgressStateSchema,
  // Keep legacy field for compatibility with older clients.
  episode_blueprints: z.array(seriesEpisodeBlueprintSchema).min(0).max(24).default([]),
  continuity: seriesContinuitySchema,
});

const seriesSeedRouteDryRunMetricsSchema = z.object({
  optimizer: z.string(),
  total_estimated_walk_minutes: z.number().int().min(0),
  transfer_minutes: z.number().int().min(0),
  max_leg_minutes: z.number().int().min(0),
  max_total_walk_minutes: z.number().int().min(0),
  feasible: z.boolean(),
  failure_reasons: z.array(z.string()).max(20),
  optimized_order_indices: z.array(z.number().int().min(0)).max(6),
  optimized_order_spot_names: z.array(z.string()).max(6),
});

const seriesSeedRouteDryRunSchema = z.object({
  feasible: z.boolean(),
  selected_spots: z.array(z.string()).max(4),
  failure_reasons: z.array(z.string()).max(20),
  route_metrics: seriesSeedRouteDryRunMetricsSchema,
  route_score: z.number().min(0).max(1),
  continuity_score: z.number().min(0).max(1),
});

export const seriesWorkflowOutputSchema = z.object({
  series: seriesOutputSchema,
  meta: z.object({
    desired_episode_count: z.number().int().min(3).max(24),
    generated_checkpoint_count: z.number().int().min(4).max(8),
    workflow_version: z.string(),
    warnings: z.array(z.string()),
    first_episode_seed_dry_run: seriesSeedRouteDryRunSchema.optional(),
  }),
});

export type SeriesGenerationRequest = z.infer<typeof seriesGenerationRequestSchema>;
export type SeriesOutput = z.infer<typeof seriesOutputSchema>;
export type SeriesCharacter = z.infer<typeof seriesCharacterSchema>;
export type SeriesEpisodeBlueprint = z.infer<typeof seriesEpisodeBlueprintSchema>;
