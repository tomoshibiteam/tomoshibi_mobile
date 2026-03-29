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

export const seriesRecentGenerationContextSchema = z.object({
  recent_titles: z.array(z.string()).max(12),
  recent_case_motifs: z.array(z.string()).max(12),
  recent_character_archetypes: z.array(z.string()).max(12),
  recent_relationship_patterns: z.array(z.string()).max(12),
  recent_visual_motifs: z.array(z.string()).max(12),
  recent_truth_patterns: z.array(z.string()).max(12),
  recent_checkpoint_patterns: z.array(z.string()).max(12),
  recent_first_episode_patterns: z.array(z.string()).max(12),
  recent_environment_patterns: z.array(z.string()).max(12),
  recent_appearance_patterns: z.array(z.string()).max(12),
});

export const seriesMysteryProfileSchema = z.object({
  case_core: z.string(),
  investigation_style: z.string(),
  emotional_tone: z.string(),
  duo_dynamic: z.string(),
  truth_nature: z.string(),
  visual_language: z.string(),
  environment_layer: z.string(),
  differentiation_axes: z.array(z.string()).max(7).default([]),
  banned_templates_avoided: z.array(z.string()).max(8).default([]),
});

export const seriesDeviceServiceDesignBriefSchema = z.object({
  brief_version: z.literal("device-service-design-brief-v1"),
  experience_objective: z.string(),
  service_value_hypothesis: z.string(),
  target_user_context: z.string(),
  usage_scene: z.string(),
  emotional_outcome: z.string(),
  tone_guardrail: z.string(),
  role_design_direction: z.string(),
  spatial_behavior_policy: z.string(),
  ux_guidance_style: z.string(),
});

export const seriesConceptGroundingItemSchema = z.object({
  anchor: z.string(),
  detail: z.string(),
  tags: z.array(z.string()).max(6).default([]),
  source_ref: z.string().optional(),
  relevance_reason: z.string().optional(),
});

export const seriesConceptGroundingContextSchema = z.object({
  source_type: z.literal("spreadsheet"),
  source_url: z.string().url(),
  source_label: z.string().optional(),
  retrieval_note: z.string().optional(),
  matched_items: z.array(seriesConceptGroundingItemSchema).max(8).default([]),
});

export const seriesPreferenceSheetSchema = z.object({
  emotional_rewards: z.array(z.string()).min(1).max(8),
  desired_relationship_dynamics: z.array(z.string()).min(1).max(8),
  atmosphere_keywords: z.array(z.string()).min(1).max(10),
  novelty_level: z.enum(["safe", "balanced", "bold"]).default("balanced"),
  pacing_preference: z.enum(["slow_burn", "balanced", "fast_hook"]).default("balanced"),
  ending_preference: z.enum(["resolved", "bittersweet", "open"]).default("bittersweet"),
  continuation_needs: z.array(z.string()).min(1).max(8),
  anti_preferences: z.array(z.string()).max(12).default([]),
  originality_targets: z.array(z.string()).min(1).max(8),
  interpreted_intent_summary: z.string(),
});

export const seriesAntiBriefSchema = z.object({
  banned_cliches: z.array(z.string()).max(16).default([]),
  banned_world_shapes: z.array(z.string()).max(12).default([]),
  banned_relationship_modes: z.array(z.string()).max(12).default([]),
  banned_tone_drifts: z.array(z.string()).max(12).default([]),
  banned_generic_patterns: z.array(z.string()).max(16).default([]),
});

export const userSeriesRubricSchema = z.object({
  intent_fit_weights: z.object({
    intent_fit: z.number().min(0).max(1),
    emotional_reward_fit: z.number().min(0).max(1),
    relationship_fit: z.number().min(0).max(1),
    world_originality: z.number().min(0).max(1),
    character_vividness: z.number().min(0).max(1),
    return_desire: z.number().min(0).max(1),
    clone_penalty: z.number().min(0).max(1),
  }),
  must_haves: z.array(z.string()).min(1).max(12),
  nice_to_haves: z.array(z.string()).max(12).default([]),
  must_avoid: z.array(z.string()).max(16).default([]),
});

export const seriesFingerprintSchema = z.object({
  worldview_archetype: z.string(),
  emotional_promise: z.string(),
  fixed_character_dynamic: z.string(),
  continuation_mode: z.string(),
  motif_cluster: z.array(z.string()).max(6).default([]),
  ending_type: z.string(),
});

export const seriesConceptSeedSchema = z.object({
  seed_id: z.string(),
  generation_angle: z.enum([
    "emotion-first",
    "relationship-first",
    "world-first",
    "originality-first",
    "ending-first",
    "continuation-trigger-first",
    "place-portability-first",
    "bittersweet-first",
  ]),
  title: z.string(),
  one_line_hook: z.string(),
  premise: z.string(),
  worldview_core: z.string(),
  emotional_core: z.string(),
  central_relationship_dynamic: z.string(),
  return_reason: z.string(),
  ending_flavor: z.string(),
  uniqueness_claims: z.array(z.string()).min(1).max(6),
  fingerprint: seriesFingerprintSchema,
});

export const seriesConceptSeedBatchSchema = z.object({
  seeds: z.array(seriesConceptSeedSchema).min(6).max(10),
});

export const seriesTextJudgeScoreSchema = z.object({
  intent_fit: z.number().min(0).max(1),
  emotional_reward_fit: z.number().min(0).max(1),
  relationship_fit: z.number().min(0).max(1),
  world_originality: z.number().min(0).max(1),
  character_vividness: z.number().min(0).max(1),
  return_desire: z.number().min(0).max(1),
  clone_penalty: z.number().min(0).max(1),
  rationale: z.string(),
});

export const seriesFirstEpisodeSeedEvalSchema = z.object({
  intent_fit: z.number().min(0).max(1),
  walkability_fit: z.number().min(0).max(1),
  continuation_hook_fit: z.number().min(0).max(1),
  uniqueness_fit: z.number().min(0).max(1),
  pass: z.boolean(),
  reasons: z.array(z.string()).max(8).default([]),
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

export const seriesCharacterRelationshipHookSchema = z.object({
  target_id: z.string(),
  target_name: z.string(),
  relation: z.string(),
});

export const seriesCharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  must_appear: z.boolean().default(false),
  is_protagonist: z.boolean().optional(),
  is_partner: z.boolean().optional(),
  goal: z.string(),
  arc_start: z.string(),
  arc_end: z.string(),
  personality: z.string(),
  appearance: z.string(),
  portrait_prompt: z.string(),
  portrait_image_url: z.string(),
  relationship_hooks: z.array(seriesCharacterRelationshipHookSchema).default([]),
  investigation_function: z.string().optional(),
  emotional_temperature: z.string().optional(),
  relationship_temperature: z.string().optional(),
  signature_prop: z.string().optional(),
  environment_residue: z.string().optional(),
  posture_grammar: z.string().optional(),
  truth_proximity: z.string().optional(),
  hypothesis_pressure: z.string().optional(),
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
  knowledge_gain: z.string().optional(),
  remaining_unknown: z.string().optional(),
  next_move_reason: z.string().optional(),
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
  movement_style: z.string().optional(),
  completion_condition: z.string(),
  carry_over_hint: z.string(),
  inciting_incident: z.string().optional(),
  first_false_assumption: z.string().optional(),
  first_reversal: z.string().optional(),
  unresolved_hook: z.string().optional(),
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
  characters: z.array(seriesIdentityPackCharacterSchema).min(2).max(8),
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
  mode: z.enum(["quality_first", "single_pass"]),
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
  characters: z.array(seriesCharacterSchema).min(2).max(8),
  cover_focus_characters: z.array(seriesCoverFocusCharacterSchema).min(1).max(3),
  identity_pack: seriesIdentityPackSchema,
  cover_consistency_report: seriesCoverConsistencyReportSchema,
  checkpoints: z.array(seriesCheckpointSchema).length(3),
  first_episode_seed: seriesEpisodeSeedSchema,
  mystery_profile: seriesMysteryProfileSchema,
  progress_state: seriesProgressStateSchema,
  // Keep legacy field for compatibility with older clients.
  episode_blueprints: z.array(seriesEpisodeBlueprintSchema).min(0).max(24).default([]),
  continuity: seriesContinuitySchema,
});

export type SeriesDeviceServiceDesignBrief = z.infer<typeof seriesDeviceServiceDesignBriefSchema>;
export type SeriesPreferenceSheet = z.infer<typeof seriesPreferenceSheetSchema>;
export type SeriesAntiBrief = z.infer<typeof seriesAntiBriefSchema>;
export type UserSeriesRubric = z.infer<typeof userSeriesRubricSchema>;
export type SeriesFingerprint = z.infer<typeof seriesFingerprintSchema>;
export type SeriesConceptSeed = z.infer<typeof seriesConceptSeedSchema>;
export type SeriesTextJudgeScore = z.infer<typeof seriesTextJudgeScoreSchema>;
export type SeriesFirstEpisodeSeedEval = z.infer<typeof seriesFirstEpisodeSeedEvalSchema>;
export type SeriesOutput = z.infer<typeof seriesOutputSchema>;
export type SeriesCharacter = z.infer<typeof seriesCharacterSchema>;
export type SeriesEpisodeBlueprint = z.infer<typeof seriesEpisodeBlueprintSchema>;
