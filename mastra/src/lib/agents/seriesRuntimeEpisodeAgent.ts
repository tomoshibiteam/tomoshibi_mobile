import { Agent } from "@mastra/core/agent";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MASTRA_SERIES_RUNTIME_EPISODE_MODEL } from "../modelConfig";
import { generateChapter, type ChapterAgentInput } from "./chapterAgent";
import {
  buildDefaultObjectiveMissionLink,
  normalizeObjectiveMissionLink,
} from "../objectiveMissionLink";
import {
  buildCharacterPortraitPrompt,
  buildCoverImagePrompt,
  buildSeriesImageUrl,
  buildSeriesVisualStyleGuide,
} from "../seriesVisuals";
import {
  resolveEpisodeSpotSheetCandidates,
  type EpisodeSpotGroundingRow,
} from "../episodeSpotGroundingContext";

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();

const dedupeStrings = (value: string[]) => {
  const seen = new Set<string>();
  return value
    .map((item) => clean(item))
    .filter((item) => {
      if (!item) return false;
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
};

const EPISODE_SPOT_MIN = 5;
const EPISODE_SPOT_MAX = 7;
const EPISODE_DEFAULT_SPOT_COUNT = 5;
const EPISODE_UNIQUE_CHARACTER_MIN = 2;
const EPISODE_UNIQUE_CHARACTER_MAX = 3;
const EPISODE_DEFAULT_UNIQUE_CHARACTER_COUNT = 2;

// ---------------------------------------------------------------------------
// Request schema (unchanged)
// ---------------------------------------------------------------------------

const runtimeSeriesContextSchema = z.object({
  title: z.string(),
  overview: z.string().optional(),
  premise: z.string().optional(),
  season_goal: z.string().optional(),
  ai_rules: z.string().optional(),
  world_setting: z.string().optional(),
  continuity: z
    .object({
      global_mystery: z.string().optional(),
      mid_season_twist: z.string().optional(),
      finale_payoff: z.string().optional(),
      invariant_rules: z.array(z.string()).optional(),
      episode_link_policy: z.array(z.string()).optional(),
    })
    .optional(),
  progress_state: z
    .object({
      last_completed_episode_no: z.number().int().min(0).default(0),
      unresolved_threads: z.array(z.string()).default([]),
      revealed_facts: z.array(z.string()).default([]),
      relationship_state_summary: z.string().optional(),
      relationship_flags: z.array(z.string()).default([]),
      recent_relation_shift: z.array(z.string()).default([]),
      companion_trust_level: z.number().min(0).max(100).optional(),
      next_hook: z.string().optional(),
    })
    .optional(),
  first_episode_seed: z
    .object({
      title: z.string().optional(),
      objective: z.string().optional(),
      opening_scene: z.string().optional(),
      expected_duration_minutes: z.number().int().min(10).max(45).optional(),
      route_style: z.string().optional(),
      completion_condition: z.string().optional(),
      carry_over_hint: z.string().optional(),
      spot_requirements: z
        .array(
          z.object({
            requirement_id: z.string().optional(),
            scene_role: z.enum(["起", "承", "転", "結"]),
            spot_role: z.string(),
            required_attributes: z.array(z.string()).default([]),
            visit_constraints: z.array(z.string()).default([]),
            tourism_value_type: z.string(),
          })
        )
        .max(EPISODE_SPOT_MAX)
        .optional(),
      suggested_spots: z.array(z.string()).optional(),
    })
    .optional(),
  checkpoints: z
    .array(
      z.object({
        checkpoint_no: z.number().int().min(1),
        title: z.string(),
        purpose: z.string().optional(),
        unlock_hint: z.string().optional(),
        carry_over: z.string().optional(),
      })
    )
    .max(8)
    .optional(),
  characters: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        role: z.string(),
        must_appear: z.boolean().optional(),
        personality: z.string().optional(),
        appearance: z.string().optional(),
        portrait_prompt: z.string().optional(),
        portrait_image_url: z.string().optional(),
        arc_start: z.string().optional(),
        arc_end: z.string().optional(),
      })
    )
    .max(8)
    .optional(),
  recent_episodes: z
    .array(
      z.object({
        episode_no: z.number().int().min(1).optional(),
        title: z.string(),
        summary: z.string().optional(),
      })
    )
    .max(5)
    .optional(),
});

export const seriesRuntimeEpisodeRequestSchema = z.object({
  series: runtimeSeriesContextSchema,
  episode_request: z.object({
    stage_location: z.string().min(1),
    purpose: z.string().min(1),
    user_wishes: z.string().optional(),
    desired_spot_count: z
      .number()
      .int()
      .min(EPISODE_SPOT_MIN)
      .max(EPISODE_SPOT_MAX)
      .default(EPISODE_DEFAULT_SPOT_COUNT),
    desired_duration_minutes: z.number().int().min(10).max(45).default(20),
    language: z.string().default("ja"),
  }),
});

export type SeriesRuntimeEpisodeRequest = z.infer<typeof seriesRuntimeEpisodeRequestSchema>;

// ---------------------------------------------------------------------------
// Episode Plan schema (Step 1: Planner output)
// ---------------------------------------------------------------------------

const voiceProfileSchema = z.object({
  vocabulary: z.enum(["formal", "casual", "street", "archaic"]),
  emotional_range: z.enum(["reserved", "expressive", "volatile", "stoic"]),
  style: z.enum(["direct", "indirect", "verbose", "terse", "poetic"]),
  catchphrases: z.array(z.string()),
});

const episodeWorldSchema = z.object({
  title: z.string(),
  mood: z.string(),
  atmosphere: z.string(),
  sensory_keywords: z.array(z.string()).max(8),
  story_axis: z.string(),
  emotional_arc: z.string(),
  local_theme: z.string(),
});

const episodeUniqueCharacterSchema = z.object({
  name: z.string(),
  role: z.string(),
  personality: z.string(),
  motivation: z.string(),
  relation_to_series: z.string(),
  introduction_scene: z.string(),
});

const spotRequirementSchema = z.object({
  requirement_id: z.string(),
  scene_role: z.enum(["起", "承", "転", "結"]),
  spot_role: z.string(),
  required_attributes: z.array(z.string()).default([]),
  visit_constraints: z.array(z.string()).default([]),
  tourism_value_type: z.string(),
  objective: z.string(),
  purpose: z.string(),
  chapter_hook: z.string(),
  key_clue: z.string(),
  tension_level: z.number().int().min(1).max(10),
  mission: z.string(),
});

const episodePlanOutputSchema = z.object({
  title: z.string(),
  one_liner: z.string(),
  premise: z.string(),
  goal: z.string(),
  narrative_voice: z.enum(["past", "present"]).default("past"),
  episode_world: episodeWorldSchema,
  episode_unique_characters: z
    .array(episodeUniqueCharacterSchema)
    .min(EPISODE_UNIQUE_CHARACTER_MIN)
    .max(EPISODE_UNIQUE_CHARACTER_MAX),
  characters: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      must_appear: z.boolean().default(false),
      personality: z.string(),
      voice_profile: voiceProfileSchema,
    })
  ),
  spot_requirements: z
    .array(spotRequirementSchema)
    .min(EPISODE_SPOT_MIN)
    .max(EPISODE_SPOT_MAX),
  completion_condition: z.string(),
  carry_over_hook: z.string(),
  estimated_duration_minutes: z.number().int().min(10).max(45),
});

type EpisodePlan = z.infer<typeof episodePlanOutputSchema>;

// ---------------------------------------------------------------------------
// Final rich output schema (matches old quest creator_payload structure)
// ---------------------------------------------------------------------------

const dialogueLineSchema = z.object({
  character_id: z.string(),
  text: z.string(),
  expression: z
    .enum(["neutral", "smile", "serious", "surprise", "excited"])
    .optional(),
});

const chapterBlockSchema = z.object({
  type: z.enum(["narration", "dialogue", "mission"]),
  text: z.string(),
  speaker_id: z.string().optional(),
  expression: z
    .enum(["neutral", "smile", "serious", "surprise", "excited"])
    .optional(),
});

const episodeSpotSchema = z.object({
  spot_name: z.string(),
  scene_role: z.enum(["起", "承", "転", "結"]),
  scene_objective: z.string(),
  scene_narration: z.string(),
  blocks: z.array(chapterBlockSchema),
  question_text: z.string(),
  answer_text: z.string(),
  hint_text: z.string(),
  explanation_text: z.string(),
  pre_mission_dialogue: z.array(dialogueLineSchema),
  post_mission_dialogue: z.array(dialogueLineSchema),
});

const spotTraceCandidateSchema = z.object({
  spot_name: z.string(),
  tourism_focus: z.string(),
  estimated_walk_minutes: z.number().int().min(1),
  public_accessible: z.boolean(),
  role_match_score: z.number().min(0).max(1),
  tourism_match_score: z.number().min(0).max(1),
  locality_score: z.number().min(0).max(1),
});

const spotTraceRequirementSchema = z.object({
  requirement_id: z.string(),
  scene_role: z.enum(["起", "承", "転", "結"]),
  spot_role: z.string(),
  candidates: z.array(spotTraceCandidateSchema).max(12),
});

const spotTraceMmrScoreSchema = z.object({
  requirement_id: z.string(),
  spot_name: z.string(),
  relevance_score: z.number().min(0),
  redundancy_penalty: z.number().min(0),
  mmr_score: z.number(),
});

const spotTraceRouteMetricsSchema = z.object({
  optimizer: z.string(),
  total_estimated_walk_minutes: z.number().int().min(0),
  transfer_minutes: z.number().int().min(0),
  max_leg_minutes: z.number().int().min(0),
  max_total_walk_minutes: z.number().int().min(0),
  feasible: z.boolean(),
  failure_reasons: z.array(z.string()).max(20),
  optimized_order_indices: z.array(z.number().int().min(0)).max(EPISODE_SPOT_MAX + 1),
  optimized_order_spot_names: z.array(z.string()).max(EPISODE_SPOT_MAX + 1),
});

export const episodeGenerationTraceSchema = z.object({
  stage_location: z.string(),
  candidate_spots: z.array(spotTraceRequirementSchema).max(EPISODE_SPOT_MAX),
  selected_spots: z
    .array(
      z.object({
        requirement_id: z.string(),
        scene_role: z.enum(["起", "承", "転", "結"]),
        spot_name: z.string(),
        tourism_focus: z.string(),
        estimated_walk_minutes: z.number().int().min(1),
      })
    )
    .max(EPISODE_SPOT_MAX),
  eligibility_reject_reasons: z.array(z.string()).max(80),
  mmr_scores: z.array(spotTraceMmrScoreSchema).max(80),
  route_metrics: spotTraceRouteMetricsSchema,
  route_score: z.number().min(0).max(1),
  continuity_score: z.number().min(0).max(1),
});

export const seriesRuntimeEpisodeOutputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  one_liner: z.string(),
  cover_image_prompt: z.string().optional(),
  cover_image_url: z.string().optional(),
  episode_cover_image_prompt: z.string().optional(),
  episode_cover_image_url: z.string().optional(),
  main_plot: z.object({
    premise: z.string(),
    goal: z.string(),
  }),
  characters: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      personality: z.string(),
      origin: z.enum(["series", "episode"]).optional(),
      avatar_prompt: z.string().optional(),
      avatar_image_url: z.string().optional(),
    })
  ),
  episode_world: episodeWorldSchema,
  episode_unique_characters: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      personality: z.string(),
      motivation: z.string(),
      relation_to_series: z.string(),
      introduction_scene: z.string(),
      portrait_prompt: z.string().optional(),
      portrait_image_url: z.string().optional(),
    })
  ),
  spots: z.array(episodeSpotSchema),
  completion_condition: z.string(),
  carry_over_hook: z.string(),
  estimated_duration_minutes: z.number().int().min(10).max(45),
  progress_patch: z.object({
    unresolved_threads_to_add: z.array(z.string()).max(6),
    unresolved_threads_to_remove: z.array(z.string()).max(6),
    revealed_facts_to_add: z.array(z.string()).max(6),
    relationship_state_summary: z.string(),
    relationship_flags_to_add: z.array(z.string()).max(8),
    relationship_flags_to_remove: z.array(z.string()).max(8),
    recent_relation_shift: z.array(z.string()).max(6),
    companion_trust_delta: z.number().int().min(-10).max(10).optional(),
    next_hook: z.string(),
  }),
  generation_trace: episodeGenerationTraceSchema.optional(),
});

export type SeriesRuntimeEpisodeOutput = z.infer<typeof seriesRuntimeEpisodeOutputSchema>;
export type EpisodeGenerationTrace = z.infer<typeof episodeGenerationTraceSchema>;
type EpisodeOutputCharacter = SeriesRuntimeEpisodeOutput["characters"][number];
type EpisodeOutputUniqueCharacter = SeriesRuntimeEpisodeOutput["episode_unique_characters"][number];

export type SeriesRuntimeEpisodeProgressPhase =
  | "pipeline_start"
  | "episode_plan_start"
  | "episode_plan_done"
  | "spot_resolution_start"
  | "spot_resolution_done"
  | "spot_chapter_start"
  | "spot_chapter_done"
  | "spot_puzzle_start"
  | "spot_puzzle_done"
  | "episode_character_images_start"
  | "episode_character_images_done"
  | "episode_cover_image_start"
  | "episode_cover_image_done"
  | "episode_assemble_start"
  | "episode_assemble_done";

export type SeriesRuntimeEpisodeProgressEvent = {
  phase: SeriesRuntimeEpisodeProgressPhase;
  at: string;
  detail?: string;
  spot_index?: number;
  spot_count?: number;
  spot_name?: string;
};

type SeriesRuntimeEpisodeProgressReporter = (
  event: SeriesRuntimeEpisodeProgressEvent
) => void | Promise<void>;

const emitSeriesRuntimeEpisodeProgress = async (
  reporter: SeriesRuntimeEpisodeProgressReporter | undefined,
  event: Omit<SeriesRuntimeEpisodeProgressEvent, "at">
) => {
  if (!reporter) return;
  await reporter({
    ...event,
    at: new Date().toISOString(),
  });
};

// ---------------------------------------------------------------------------
// Episode Planner Agent (Step 1)
// ---------------------------------------------------------------------------

const EPISODE_PLANNER_INSTRUCTIONS = `
あなたはTOMOSHIBIの「街歩きエピソード」の設計者です。
シリーズの世界観・キャラクター・進行状態を踏まえ、
指定されたエリア内で徒歩で巡る5〜7箇所の「要求スポット仕様」を設計してください。

## 基本方針
- ここでは具体的スポット名を決めない（spot_roleまで）
- 小説として成立する骨格（起承転結、伏線、回収）を必ず作る
- 1話完結の達成感を持たせつつ、次回へのフックを残す
- 前回までの進行状態を最低1つ参照する
- 先に episode_world（今回話の空気・感情軸）を定義してから人物と導線を作る

## characters 生成制約
- シリーズ固定キャラクターを characters に含め、voice_profile を付与する
- episode_unique_characters を2〜3人出力する
- 主人公（プレイヤー）は characters に含めない
- must_appear=true の固定キャラを必ず含める
- 合計5〜6人程度の登場人物密度を維持する
- id は char_1 から連番

## spot_requirements 生成制約
- 各 requirement は requirement_id / scene_role / spot_role / required_attributes / visit_constraints / tourism_value_type を持つ
- scene_role は起→承→転→結の順
- requirement件数は5〜7件
- objective は「ミッション成功後に達成される成果（完了状態）」
- mission は現地で実行可能な観察・探索アクションにする
- tourism_value_type には観光価値の種別（地域導入/歴史/文化/景観など）を書く
- key_clue には物語上の伏線・手がかりを書く
`;

const episodePlannerAgent = new Agent({
  id: "episode-planner-agent",
  name: "episode-planner-agent",
  model: MASTRA_SERIES_RUNTIME_EPISODE_MODEL,
  instructions: EPISODE_PLANNER_INSTRUCTIONS,
});

// Backward-compatible export used by aggregated agent index.
export const seriesRuntimeEpisodeAgent = episodePlannerAgent;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const hasModelApiKey = () =>
  Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );

const DEFAULT_VOICE_PROFILE: z.infer<typeof voiceProfileSchema> = {
  vocabulary: "formal",
  emotional_range: "reserved",
  style: "direct",
  catchphrases: ["確認しよう"],
};

const TIMEOUT_MS = 60_000;
const ROUTE_MAX_LEG_MINUTES = 30;
const ROUTE_DEFAULT_TOTAL_MINUTES = 140;
const ROUTE_OPTIMIZER_MODE = clean(process.env.TOMOSHIBI_ROUTE_OPTIMIZER_MODE).toLowerCase() || "auto";
const ROUTE_ORTOOLS_PYTHON = clean(process.env.TOMOSHIBI_ROUTE_ORTOOLS_PYTHON) || "python3";
const ROUTE_ORTOOLS_TIMEOUT_MS = Math.max(
  200,
  Number.parseInt(clean(process.env.TOMOSHIBI_ROUTE_ORTOOLS_TIMEOUT_MS) || "1800", 10) || 1800
);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROUTE_ORTOOLS_SCRIPT = (() => {
  const fromCwd = path.resolve(process.cwd(), "scripts/optimize_episode_route.py");
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(__dirname, "../../../scripts/optimize_episode_route.py");
})();

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
let ortoolsAvailabilityState: "unknown" | "available" | "unavailable" = "unknown";

const withTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} が ${ms / 1000}秒でタイムアウト`)),
        ms
      )
    ),
  ]);

// ---------------------------------------------------------------------------
// Step 1: Generate Episode Plan
// ---------------------------------------------------------------------------

type RuntimeSeriesCharacter = NonNullable<z.infer<typeof runtimeSeriesContextSchema>["characters"]>[number];
type EpisodeSpotRequirement = z.infer<typeof spotRequirementSchema>;
type EpisodeWorld = z.infer<typeof episodeWorldSchema>;
type EpisodeUniqueCharacter = z.infer<typeof episodeUniqueCharacterSchema>;

const resolveDesiredSpotCount = (input: SeriesRuntimeEpisodeRequest) =>
  Math.max(
    EPISODE_SPOT_MIN,
    Math.min(
      EPISODE_SPOT_MAX,
      input.episode_request.desired_spot_count || EPISODE_DEFAULT_SPOT_COUNT
    )
  );

const normalizeEpisodeWorld = (
  raw: EpisodeWorld | undefined
): EpisodeWorld | null => {
  if (!raw) return null;
  const candidate = {
    title: clean(raw.title),
    mood: clean(raw.mood),
    atmosphere: clean(raw.atmosphere),
    sensory_keywords: dedupeStrings(raw.sensory_keywords || []).slice(0, 8),
    story_axis: clean(raw.story_axis),
    emotional_arc: clean(raw.emotional_arc),
    local_theme: clean(raw.local_theme),
  };
  if (
    !candidate.title ||
    !candidate.mood ||
    !candidate.atmosphere ||
    candidate.sensory_keywords.length < 2 ||
    !candidate.story_axis ||
    !candidate.emotional_arc ||
    !candidate.local_theme
  ) {
    return null;
  }
  return candidate;
};

const selectSeriesCastForEpisode = (
  seriesCharacters: RuntimeSeriesCharacter[] = []
): EpisodePlan["characters"] => {
  const normalized = seriesCharacters
    .map((character) => ({
      name: clean(character.name) || "案内人",
      role: clean(character.role) || "同行者",
      personality: clean(character.personality) || "落ち着いている",
      must_appear: Boolean(character.must_appear),
    }))
    .filter((character) => clean(character.name).length > 0);

  const ordered = normalized
    .slice()
    .sort((left, right) => {
      if (left.must_appear !== right.must_appear) return left.must_appear ? -1 : 1;
      return 0;
    });

  const deduped: typeof ordered = [];
  const seen = new Set<string>();
  ordered.forEach((character) => {
    const key = clean(character.name).toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(character);
  });

  const selected = deduped.slice(0, 3);
  if (selected.length === 0) {
    throw new Error("episode_series_cast_missing");
  }

  return selected.map((character, index) => ({
    id: `series_char_${index + 1}`,
    name: clean(character.name) || "案内人",
    role: clean(character.role) || "同行者",
    personality: clean(character.personality) || "落ち着いている",
    must_appear: Boolean(character.must_appear) || index === 0,
    voice_profile: DEFAULT_VOICE_PROFILE,
  }));
};

const normalizeEpisodeUniqueCharacters = (
  raw: EpisodeUniqueCharacter[] | undefined,
  desiredCount = EPISODE_DEFAULT_UNIQUE_CHARACTER_COUNT
): EpisodeUniqueCharacter[] | null => {
  const targetCount = Math.max(
    EPISODE_UNIQUE_CHARACTER_MIN,
    Math.min(EPISODE_UNIQUE_CHARACTER_MAX, desiredCount)
  );
  const source = Array.isArray(raw) ? raw : [];
  const normalized = source
    .map((character) => ({
      name: clean(character.name),
      role: clean(character.role),
      personality: clean(character.personality),
      motivation: clean(character.motivation),
      relation_to_series: clean(character.relation_to_series),
      introduction_scene: clean(character.introduction_scene),
    }))
    .filter(
      (character) =>
        character.name &&
        character.role &&
        character.personality &&
        character.motivation &&
        character.relation_to_series &&
        character.introduction_scene
    );
  if (normalized.length !== targetCount) return null;
  return normalized.slice(0, targetCount);
};


const normalizePlanSpotRequirements = (
  planRequirements: EpisodePlan["spot_requirements"] | undefined,
  desiredSpotCount: number
): EpisodeSpotRequirement[] | null => {
  const count = Math.max(
    EPISODE_SPOT_MIN,
    Math.min(EPISODE_SPOT_MAX, desiredSpotCount)
  );
  const source = Array.isArray(planRequirements) ? planRequirements : [];
  if (source.length !== count) return null;
  const normalized = source.map((requirement, index) => ({
    requirement_id: clean(requirement.requirement_id) || `req_${index + 1}`,
    scene_role: requirement.scene_role,
    spot_role: clean(requirement.spot_role),
    required_attributes: dedupeStrings(requirement.required_attributes || []),
    visit_constraints: dedupeStrings(requirement.visit_constraints || []),
    tourism_value_type: clean(requirement.tourism_value_type),
    objective: clean(requirement.objective),
    purpose: clean(requirement.purpose),
    chapter_hook: clean(requirement.chapter_hook),
    key_clue: clean(requirement.key_clue),
    tension_level: Math.max(1, Math.min(10, requirement.tension_level || 0)),
    mission: clean(requirement.mission),
  }));
  if (
    normalized.some((requirement) =>
      !requirement.requirement_id ||
      !requirement.scene_role ||
      !requirement.spot_role ||
      requirement.required_attributes.length === 0 ||
      !requirement.tourism_value_type ||
      !requirement.objective ||
      !requirement.purpose ||
      !requirement.chapter_hook ||
      !requirement.key_clue ||
      !requirement.mission
    )
  ) {
    return null;
  }
  return normalized;
};

const normalizeEpisodePlan = (
  plan: EpisodePlan,
  input: SeriesRuntimeEpisodeRequest
): EpisodePlan => {
  const desiredSpotCount = resolveDesiredSpotCount(input);
  const normalizedRequirements = normalizePlanSpotRequirements(
    plan.spot_requirements,
    desiredSpotCount
  );
  if (!normalizedRequirements) {
    throw new Error("episode_plan_spot_requirements_invalid");
  }
  const normalizedEpisodeWorld = normalizeEpisodeWorld(plan.episode_world);
  if (!normalizedEpisodeWorld) {
    throw new Error("episode_plan_world_invalid");
  }
  const baseSeriesCharacters = selectSeriesCastForEpisode(input.series.characters || []);
  const plannedCharacters = plan.characters || [];
  const normalizedSeriesCharacters = baseSeriesCharacters.map((character) => {
    const match = plannedCharacters.find(
      (row) => clean(row.name).toLowerCase() === clean(character.name).toLowerCase()
    );
    return {
      ...character,
      personality: clean(match?.personality) || character.personality,
      voice_profile: match?.voice_profile || character.voice_profile,
    };
  });

  const normalizedUniqueCharacters = normalizeEpisodeUniqueCharacters(
    plan.episode_unique_characters,
    EPISODE_DEFAULT_UNIQUE_CHARACTER_COUNT
  );
  if (!normalizedUniqueCharacters) {
    throw new Error("episode_plan_unique_characters_invalid");
  }
  const uniqueCharactersAsCast = normalizedUniqueCharacters.map((character) => {
    const match = plannedCharacters.find(
      (row) => clean(row.name).toLowerCase() === clean(character.name).toLowerCase()
    );
    return {
      id: "ep_char",
      name: character.name,
      role: character.role,
      must_appear: false,
      personality: clean(match?.personality) || character.personality,
      voice_profile: match?.voice_profile || DEFAULT_VOICE_PROFILE,
    };
  });

  const mergedCharacters = [...normalizedSeriesCharacters, ...uniqueCharactersAsCast].map(
    (character, index) => ({
      ...character,
      id: `char_${index + 1}`,
    })
  );

  return {
    ...plan,
    episode_world: normalizedEpisodeWorld,
    episode_unique_characters: normalizedUniqueCharacters,
    characters: mergedCharacters,
    spot_requirements: normalizedRequirements,
  };
};

const buildPlannerPrompt = (input: SeriesRuntimeEpisodeRequest): string => {
  const { series, episode_request } = input;
  const checkpoints = series.checkpoints || [];
  const characters = series.characters || [];
  const recentEpisodes = series.recent_episodes || [];

  const lastEpisodeNo = series.progress_state?.last_completed_episode_no || 0;
  const currentEpisodeNo = lastEpisodeNo + 1;

  return `
## シリーズ情報
- タイトル: ${series.title}
- 概要: ${series.overview || "なし"}
- 前提: ${series.premise || "なし"}
- シーズン目標: ${series.season_goal || "なし"}
- 舞台: ${series.world_setting || "未指定"}

## 運用ルール
${clean(series.ai_rules) || "キャラクター一貫性・因果整合・次回フックを維持する。"}

## 今回生成するエピソード
★★★ 今回のエピソードは【第${currentEpisodeNo}話】です。タイトルに「第${currentEpisodeNo}話」を含めてください。 ★★★
${currentEpisodeNo === 1 ? "- これはシリーズの最初のエピソードです。導入として世界観と登場人物を自然に紹介してください。" : `- 前回（第${lastEpisodeNo}話）までの展開を踏まえた続きを作ってください。`}

## 現在の進行状態
- 完了話数: ${lastEpisodeNo}
- 未解決: ${(series.progress_state?.unresolved_threads || []).join(" / ") || "なし"}
- 開示済み事実: ${(series.progress_state?.revealed_facts || []).join(" / ") || "なし"}
- 関係性要約: ${series.progress_state?.relationship_state_summary || "未設定"}
- 関係性フラグ: ${(series.progress_state?.relationship_flags || []).join(" / ") || "なし"}
- 現在hook: ${series.progress_state?.next_hook || "なし"}

## チェックポイント
${checkpoints.map((cp) => `- #${cp.checkpoint_no} ${cp.title} / purpose=${cp.purpose || ""}`).join("\n") || "なし"}

## シリーズキャラクター（これらを使って characters を生成すること）
${characters
  .map(
    (c) =>
      `- ${c.name} (${c.role}) / must_appear=${Boolean(c.must_appear)} / 性格: ${
        c.personality || "未設定"
      }`
  )
  .join("\n") || "なし"}

## 最近のエピソード
${recentEpisodes.map((ep) => `- #${ep.episode_no ?? "?"} ${ep.title}: ${ep.summary || ""}`).join("\n") || "なし"}

## 今回のリクエスト
- エリア: ${episode_request.stage_location}
- 旅の目的: ${episode_request.purpose}
- スポット希望数: ${episode_request.desired_spot_count}件
- 所要時間: ${episode_request.desired_duration_minutes}分
${episode_request.user_wishes ? `\n## ユーザーの思い（最大限尊重）\n${episode_request.user_wishes}` : ""}

## TOMOSHIBI 制約（最優先）
- planner段階では具体スポット名を決めず、spot_requirements の role仕様を5〜7件出力する
- spot_requirements は scene_role=起承転結の順で設計する
- required_attributes / visit_constraints / tourism_value_type を必ず埋める
- must_appear=true の固定キャラは必ず今回の characters に含める
- series characters はシリーズ固定キャラ枠として出力し、episode_unique_characters を2〜3人出力する
- episode_world を最初に設計し、そこで定義した空気感・感情軸に沿って人物と要件を作る
- 単一屋内完結は禁止

episodePlanOutputSchema を満たす JSON のみを返してください。
`;
};

const generateEpisodePlan = async (
  input: SeriesRuntimeEpisodeRequest
): Promise<EpisodePlan> => {
  const logPrefix = "[episode-planner]";

  const seriesChars = input.series.characters || [];
  const lastEpNo = input.series.progress_state?.last_completed_episode_no || 0;
  console.log(`${logPrefix} 入力データ確認:`);
  console.log(`${logPrefix}   シリーズ: ${input.series.title}`);
  console.log(`${logPrefix}   概要: ${(input.series.overview || "なし").slice(0, 80)}`);
  console.log(`${logPrefix}   世界観: ${(input.series.world_setting || "なし").slice(0, 80)}`);
  console.log(`${logPrefix}   前提: ${(input.series.premise || "なし").slice(0, 80)}`);
  console.log(`${logPrefix}   シーズン目標: ${(input.series.season_goal || "なし").slice(0, 80)}`);
  console.log(`${logPrefix}   キャラクター(${seriesChars.length}人): ${seriesChars.map((c) => `${c.name}(${c.role})`).join(", ") || "なし"}`);
  console.log(`${logPrefix}   完了話数: ${lastEpNo} → 今回は第${lastEpNo + 1}話`);
  console.log(
    `${logPrefix}   場所: ${input.episode_request.stage_location}, 目的: ${input.episode_request.purpose}, スポット希望: ${input.episode_request.desired_spot_count}`
  );

  const prompt = buildPlannerPrompt(input);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      console.log(`${logPrefix} attempt ${attempt}/2 — LLM呼び出し中`);
      const response = await withTimeout(
        episodePlannerAgent.generate(prompt, {
          structuredOutput: { schema: episodePlanOutputSchema },
        }),
        TIMEOUT_MS,
        logPrefix
      );
      const parsed = episodePlanOutputSchema.safeParse(response.object);
      if (parsed.success && parsed.data.spot_requirements.length >= EPISODE_SPOT_MIN) {
        const plan = normalizeEpisodePlan(parsed.data, input);
        console.log(`${logPrefix} 成功 — title: ${plan.title}`);
        console.log(`${logPrefix}   one_liner: ${plan.one_liner}`);
        console.log(`${logPrefix}   premise: ${plan.premise.slice(0, 100)}`);
        console.log(
          `${logPrefix}   episode_world: ${plan.episode_world.title} / ${plan.episode_world.mood}`
        );
        console.log(`${logPrefix}   キャラクター(${plan.characters.length}人): ${plan.characters.map((c) => `${c.name}(${c.role})`).join(", ")}`);
        plan.spot_requirements.forEach((requirement, i) => {
          console.log(
            `${logPrefix}   req[${i}] ${requirement.scene_role} ${requirement.spot_role} — obj: ${requirement.objective.slice(0, 50)}`
          );
        });
        return plan;
      }
      console.warn(`${logPrefix} attempt ${attempt} — パース失敗`);
    } catch (error: any) {
      console.warn(`${logPrefix} attempt ${attempt} 失敗:`, error?.message ?? error);
    }
  }

  throw new Error("episode_plan_generation_failed");
};

// ---------------------------------------------------------------------------
// Step 2: Retrieval / Eligibility / MMR / Routing
// Step 3: Chapter + Puzzle Generation (per resolved spot, sequential)
// ---------------------------------------------------------------------------

type SpotCandidate = {
  requirement_id: string;
  spot_name: string;
  tourism_focus: string;
  estimated_walk_minutes: number;
  public_accessible: boolean;
  role_match_score: number;
  tourism_match_score: number;
  locality_score: number;
};

type MmrRankedCandidate = {
  candidate: SpotCandidate;
  relevance_score: number;
  redundancy_penalty: number;
  mmr_score: number;
};

type ResolvedSpotRequirement = EpisodeSpotRequirement & {
  spot_name: string;
  tourism_focus: string;
  estimated_walk_minutes: number;
  eligibility_notes: string[];
};

type SpotResolutionContext = {
  stageLocation: string;
  purpose: string;
  worldSetting?: string;
  legacySuggestedSpots?: string[];
  maxLegMinutes?: number;
  maxTotalWalkMinutes?: number;
};

type FirstEpisodeSeedSpotRequirement = {
  requirement_id?: string;
  scene_role: "起" | "承" | "転" | "結";
  spot_role: string;
  required_attributes?: string[];
  visit_constraints?: string[];
  tourism_value_type: string;
};

type OrToolsRouteResult =
  | {
      order: number[];
      total_cost: number;
      optimizer: string;
    }
  | {
      error: string;
    };

type SpotResult = {
  spot_name: string;
  scene_role: "起" | "承" | "転" | "結";
  scene_objective: string;
  scene_narration: string;
  blocks: Array<{
    type: "narration" | "dialogue" | "mission";
    text: string;
    speaker_id?: string;
    expression?: "neutral" | "smile" | "serious" | "surprise" | "excited";
  }>;
  question_text: string;
  answer_text: string;
  hint_text: string;
  explanation_text: string;
  pre_mission_dialogue: Array<{
    character_id: string;
    text: string;
    expression?: "neutral" | "smile" | "serious" | "surprise" | "excited";
  }>;
  post_mission_dialogue: Array<{
    character_id: string;
    text: string;
    expression?: "neutral" | "smile" | "serious" | "surprise" | "excited";
  }>;
};

const FORBIDDEN_REAL_WORLD_PATTERN =
  /(閉鎖|関係者以外立入|私有地|会議室|オフィス(?:内)?|社内|宇宙|海底|空中都市|天空都市)/i;

const tokenize = (value: string) =>
  clean(value)
    .toLowerCase()
    .replace(/[。、,.!！?？/／・（）()「」『』【】]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const jaccardSimilarity = (left: string, right: string) => {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 && rightTokens.size === 0) return 0;
  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });
  const union = leftTokens.size + rightTokens.size - intersection;
  return union > 0 ? intersection / union : 0;
};

const relevanceScore = (candidate: SpotCandidate) =>
  candidate.role_match_score * 0.4 +
  candidate.tourism_match_score * 0.35 +
  candidate.locality_score * 0.25;

const mmrRerankCandidates = (candidates: SpotCandidate[], maxCount = 3, lambda = 0.72): MmrRankedCandidate[] => {
  const pool = candidates.slice();
  const selected: MmrRankedCandidate[] = [];
  while (pool.length > 0 && selected.length < maxCount) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestRelevance = 0;
    let bestPenalty = 0;
    pool.forEach((candidate, index) => {
      const maxSimilarity =
        selected.length === 0
          ? 0
          : Math.max(...selected.map((picked) => jaccardSimilarity(candidate.spot_name, picked.candidate.spot_name)));
      const relevance = relevanceScore(candidate);
      const penalty = maxSimilarity;
      const score = lambda * relevance - (1 - lambda) * penalty;
      if (score > bestScore) {
        bestScore = score;
        bestRelevance = relevance;
        bestPenalty = penalty;
        bestIndex = index;
      }
    });
    const picked = pool.splice(bestIndex, 1)[0];
    selected.push({
      candidate: picked,
      relevance_score: bestRelevance,
      redundancy_penalty: bestPenalty,
      mmr_score: bestScore,
    });
  }
  return selected;
};

const buildRequirementKeywords = (requirement: EpisodeSpotRequirement) => {
  const tokens = [
    requirement.spot_role,
    requirement.tourism_value_type,
    ...(requirement.required_attributes || []),
    ...(requirement.visit_constraints || []),
  ].flatMap((text) => tokenize(text));
  return dedupeStrings(tokens).slice(0, 12);
};

const buildSheetDrivenCandidates = (
  requirement: EpisodeSpotRequirement,
  context: SpotResolutionContext,
  index: number,
  sheetRows: EpisodeSpotGroundingRow[]
): SpotCandidate[] => {
  if (!sheetRows.length) return [];
  const location = clean(context.stageLocation);
  const roleKeywords = buildRequirementKeywords(requirement);
  const tourismKeywords = dedupeStrings(
    [requirement.tourism_value_type, requirement.purpose || "", requirement.objective || ""].flatMap((text) =>
      clean(text)
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
    )
  );
  const defaultWalk = Math.max(3, Math.min(20, 5 + index * 2));
  const maxCandidates = Math.max(
    3,
    Math.min(20, Number.parseInt(clean(process.env.EPISODE_SPOT_GROUNDING_PER_REQUIREMENT) || "8", 10) || 8)
  );

  const scored = sheetRows
    .map((row) => {
      const haystack = `${clean(row.name)} ${clean(row.area)} ${clean(row.summary)} ${(row.tags || []).join(" ")}`.toLowerCase();
      const roleHits = roleKeywords.filter((keyword) => haystack.includes(keyword.toLowerCase())).length;
      const tourismHits = tourismKeywords.filter((keyword) => haystack.includes(keyword.toLowerCase())).length;
      const localityHit =
        !!location &&
        (clean(row.name).includes(location) || clean(row.area).includes(location) || row.raw_text.includes(location));

      const roleMatch = Math.min(1, 0.2 + roleHits * 0.15);
      const tourismMatch = Math.min(1, 0.2 + tourismHits * 0.2);
      const localityScore = localityHit ? 0.95 : 0.55;

      return {
        requirement_id: requirement.requirement_id,
        spot_name: clean(row.name),
        tourism_focus: clean(row.summary) || `${requirement.tourism_value_type}に触れられる地点`,
        estimated_walk_minutes: row.estimated_walk_minutes || defaultWalk,
        public_accessible: row.public_accessible !== false,
        role_match_score: roleMatch,
        tourism_match_score: tourismMatch,
        locality_score: localityScore,
      } as SpotCandidate;
    })
    .filter((candidate) => !!candidate.spot_name)
    .sort((left, right) => relevanceScore(right) - relevanceScore(left));

  const unique: SpotCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of scored) {
    const key = clean(candidate.spot_name).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
    if (unique.length >= maxCandidates) break;
  }
  return unique;
};

const buildCandidateSpots = (
  requirement: EpisodeSpotRequirement,
  context: SpotResolutionContext,
  index: number,
  sheetRows: EpisodeSpotGroundingRow[]
): SpotCandidate[] => {
  const location = clean(context.stageLocation) || "街";
  const keywordString = [requirement.spot_role, requirement.tourism_value_type, ...requirement.required_attributes].join(" ");
  const specializedSuffixes: string[] = [];
  const genericSuffixes = ["駅前広場", "商店街", "公共広場"];
  const positionalSuffixes = [
    "石畳路地",
    "運河テラス",
    "文化案内所前",
    "橋詰広場",
    "歴史掲示板前",
    "展望歩道",
    "川沿いベンチ",
  ];
  specializedSuffixes.push(positionalSuffixes[index % positionalSuffixes.length]);
  if (/(水辺|川|港|運河|橋|海)/.test(keywordString)) {
    specializedSuffixes.push("川沿い遊歩道", "水辺プロムナード");
  }
  if (/(歴史|史跡|寺|神社|古|城|文化財)/.test(keywordString)) {
    specializedSuffixes.push("歴史資料館前", "神社参道");
  }
  if (/(景観|見晴らし|余韻|展望)/.test(keywordString)) {
    specializedSuffixes.push("展望デッキ", "高台公園");
  }
  if (/(文化|体験|市場|食)/.test(keywordString)) {
    specializedSuffixes.push("市場通り", "文化交流広場");
  }

  const legacySeedSpots = dedupeStrings((context.legacySuggestedSpots || []).map((name) => clean(name)));
  const orderedSuffixes = dedupeStrings([...specializedSuffixes, ...genericSuffixes]);
  const candidatesRaw = dedupeStrings([
    ...orderedSuffixes.map((suffix) => `${location} ${suffix}`),
    ...legacySeedSpots.map((name) => (name.includes(location) ? name : `${location} ${name}`)),
  ]).slice(0, 8);

  const keywords = buildRequirementKeywords(requirement);
  const synthetic = candidatesRaw.map((spotName, candidateIndex) => {
    const haystack = `${spotName} ${requirement.tourism_value_type}`.toLowerCase();
    const hits = keywords.filter((keyword) => haystack.includes(keyword.toLowerCase())).length;
    const roleMatch = Math.min(1, 0.2 + hits * 0.15);
    const tourismMatch = Math.min(
      1,
      0.35 +
        (/(歴史|史跡|神社|寺|資料館)/.test(haystack) && /(歴史|文化)/.test(requirement.tourism_value_type) ? 0.35 : 0) +
        (/(景観|展望|高台|水辺)/.test(haystack) && /(景観|余韻)/.test(requirement.tourism_value_type) ? 0.35 : 0)
    );
    const locality = spotName.includes(location) ? 0.95 : 0.6;
    const walk = Math.max(3, Math.min(20, 5 + index * 2 + candidateIndex * 2));
    return {
      requirement_id: requirement.requirement_id,
      spot_name: spotName,
      tourism_focus: `${requirement.tourism_value_type}を感じられる地点`,
      estimated_walk_minutes: walk,
      public_accessible: !FORBIDDEN_REAL_WORLD_PATTERN.test(spotName),
      role_match_score: roleMatch,
      tourism_match_score: tourismMatch,
      locality_score: locality,
    };
  });

  const sheetDriven = buildSheetDrivenCandidates(requirement, context, index, sheetRows);
  if (sheetDriven.length === 0) return synthetic;

  const merged = [...sheetDriven, ...synthetic];
  const deduped: SpotCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of merged) {
    const key = clean(candidate.spot_name).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
    if (deduped.length >= 12) break;
  }
  return deduped;
};

const filterEligibleCandidates = (
  candidates: SpotCandidate[],
  requirement: EpisodeSpotRequirement,
  context: SpotResolutionContext
) => {
  const eligible: SpotCandidate[] = [];
  const rejectedReasons: string[] = [];
  const maxLeg = Math.max(10, context.maxLegMinutes ?? ROUTE_MAX_LEG_MINUTES);

  candidates.forEach((candidate) => {
    const reasons: string[] = [];
    if (!candidate.public_accessible || FORBIDDEN_REAL_WORLD_PATTERN.test(candidate.spot_name)) {
      reasons.push("public_accessibility");
    }
    if (candidate.estimated_walk_minutes > maxLeg) {
      reasons.push("walk_route_overload");
    }
    if (candidate.locality_score < 0.5) {
      reasons.push("locality_explainability");
    }
    if (candidate.role_match_score < 0.2 && candidate.tourism_match_score < 0.2) {
      reasons.push("tourism_purpose_connection");
    }
    const worldSetting = clean(context.worldSetting || "");
    if (!worldSetting && /(宇宙|海底|空中)/.test(candidate.spot_name)) {
      reasons.push("worldview_conflict");
    }
    if (
      context.purpose &&
      /(歴史|文化|街歩き|景観|体験)/.test(context.purpose) &&
      candidate.tourism_match_score < 0.25
    ) {
      reasons.push("tourism_purpose_connection");
    }

    if (reasons.length === 0) {
      eligible.push(candidate);
    } else {
      rejectedReasons.push(`${candidate.spot_name}:${reasons.join(",")}`);
    }
  });

  return {
    eligible,
    rejectedReasons: [
      ...rejectedReasons,
      `requirement:${requirement.requirement_id}:no_fully_eligible_candidate`,
    ],
  };
};

const estimateTransferMinutes = (from: SpotCandidate, to: SpotCandidate) => {
  const similarity = jaccardSimilarity(from.spot_name, to.spot_name);
  const duplicatePenalty = clean(from.spot_name).toLowerCase() === clean(to.spot_name).toLowerCase() ? 12 : 0;
  const base = (from.estimated_walk_minutes + to.estimated_walk_minutes) / 2;
  return Math.max(3, Math.round(base * (0.35 + (1 - similarity) * 0.2) + duplicatePenalty));
};

const transitionPenalty = (from: SpotCandidate, to: SpotCandidate) => {
  const transfer = estimateTransferMinutes(from, to);
  const similarity = jaccardSimilarity(from.spot_name, to.spot_name);
  const duplicatePenalty = clean(from.spot_name).toLowerCase() === clean(to.spot_name).toLowerCase() ? 8 : 0;
  return transfer * 0.22 + similarity * 2.2 + duplicatePenalty;
};

const buildDistanceMatrix = (selected: SpotCandidate[]) => {
  const size = selected.length;
  const matrix: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      if (i === j) continue;
      matrix[i][j] = estimateTransferMinutes(selected[i], selected[j]);
    }
  }
  return matrix;
};

const shouldAttemptOrToolsRoute = () => ROUTE_OPTIMIZER_MODE === "auto" || ROUTE_OPTIMIZER_MODE === "ortools";

const runOrToolsRoute = async (distanceMatrix: number[][]): Promise<OrToolsRouteResult | null> => {
  if (!shouldAttemptOrToolsRoute()) return null;
  if (ROUTE_OPTIMIZER_MODE === "auto" && ortoolsAvailabilityState === "unavailable") return null;
  if (distanceMatrix.length < 2) return null;

  const payload = JSON.stringify({
    distance_matrix: distanceMatrix,
    start_index: 0,
    end_index: distanceMatrix.length - 1,
  });

  return new Promise<OrToolsRouteResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(ROUTE_ORTOOLS_PYTHON, [ROUTE_ORTOOLS_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const settle = (result: OrToolsRouteResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      settle({ error: "ortools_timeout" });
    }, ROUTE_ORTOOLS_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      if (ROUTE_OPTIMIZER_MODE === "auto") {
        ortoolsAvailabilityState = "unavailable";
      }
      settle({ error: clean(error.message) || "ortools_process_error" });
    });
    child.on("close", () => {
      clearTimeout(timer);
      const text = clean(stdout);
      if (!text) {
        settle({ error: clean(stderr) || "ortools_empty_output" });
        return;
      }
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const ok = Boolean(parsed.ok);
        if (!ok) {
          const error = clean(typeof parsed.error === "string" ? parsed.error : "ortools_no_solution");
          if (error === "ortools_not_installed") ortoolsAvailabilityState = "unavailable";
          settle({ error });
          return;
        }
        const orderRaw = Array.isArray(parsed.order) ? parsed.order : [];
        const order = orderRaw
          .map((value) => Number.parseInt(String(value), 10))
          .filter((value) => Number.isFinite(value) && value >= 0);
        const totalCost = Number.parseFloat(String(parsed.total_cost ?? 0));
        ortoolsAvailabilityState = "available";
        settle({
          order,
          total_cost: Number.isFinite(totalCost) ? totalCost : 0,
          optimizer: clean(typeof parsed.optimizer === "string" ? parsed.optimizer : "ortools_vrptw"),
        });
      } catch {
        settle({ error: "ortools_output_parse_error" });
      }
    });

    try {
      child.stdin.write(payload);
      child.stdin.end();
    } catch {
      clearTimeout(timer);
      settle({ error: "ortools_stdin_write_failed" });
    }
  });
};

const selectCandidateSequence = (optionsPerRequirement: SpotCandidate[][]): SpotCandidate[] => {
  if (optionsPerRequirement.length === 0) return [];
  if (optionsPerRequirement.some((options) => options.length === 0)) {
    return [];
  }

  type Cell = {
    score: number;
    prev: number;
  };

  const dp: Cell[][] = optionsPerRequirement.map((options) =>
    options.map(() => ({ score: Number.NEGATIVE_INFINITY, prev: -1 }))
  );

  optionsPerRequirement[0].forEach((candidate, index) => {
    dp[0][index] = {
      score: relevanceScore(candidate) * 10,
      prev: -1,
    };
  });

  for (let reqIndex = 1; reqIndex < optionsPerRequirement.length; reqIndex += 1) {
    optionsPerRequirement[reqIndex].forEach((candidate, optionIndex) => {
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestPrev = -1;
      optionsPerRequirement[reqIndex - 1].forEach((prevCandidate, prevIndex) => {
        const candidateScore =
          dp[reqIndex - 1][prevIndex].score +
          relevanceScore(candidate) * 10 -
          transitionPenalty(prevCandidate, candidate);
        if (candidateScore > bestScore) {
          bestScore = candidateScore;
          bestPrev = prevIndex;
        }
      });
      dp[reqIndex][optionIndex] = {
        score: bestScore,
        prev: bestPrev,
      };
    });
  }

  const lastRow = dp[dp.length - 1];
  let bestLast = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  lastRow.forEach((cell, index) => {
    if (cell.score > bestScore) {
      bestScore = cell.score;
      bestLast = index;
    }
  });

  const selected = Array.from({ length: optionsPerRequirement.length }, () => optionsPerRequirement[0][0]);
  let current = bestLast;
  for (let reqIndex = optionsPerRequirement.length - 1; reqIndex >= 0; reqIndex -= 1) {
    selected[reqIndex] = optionsPerRequirement[reqIndex][current];
    current = dp[reqIndex][current].prev;
    if (current < 0 && reqIndex > 0) {
      current = 0;
    }
  }

  return selected;
};

const resolveSpotRequirements = async (
  requirements: EpisodeSpotRequirement[],
  context: SpotResolutionContext
): Promise<{ resolved: ResolvedSpotRequirement[]; trace: EpisodeGenerationTrace }> => {
  const normalizedRequirements = requirements.slice(0, EPISODE_SPOT_MAX);
  const sceneOrder: Record<ResolvedSpotRequirement["scene_role"], number> = {
    起: 0,
    承: 1,
    転: 2,
    結: 3,
  };
  const sheetCandidates = await resolveEpisodeSpotSheetCandidates({
    stageLocation: clean(context.stageLocation) || "街",
    purpose: clean(context.purpose),
    requirementHint: normalizedRequirements
      .map((requirement) => `${clean(requirement.spot_role)} ${clean(requirement.tourism_value_type)}`)
      .join(" / "),
    limit: 40,
    scope: "resolveSpotRequirements",
  });

  const traces = normalizedRequirements.map((requirement, index) => {
    const candidates = buildCandidateSpots(requirement, context, index, sheetCandidates);
    const { eligible, rejectedReasons } = filterEligibleCandidates(candidates, requirement, context);
    const reranked = mmrRerankCandidates(eligible, 3);
    const options = reranked.map((row) => row.candidate);
    return {
      requirement,
      candidates,
      rejectedReasons,
      reranked,
      options,
    };
  });
  if (traces.some((trace) => trace.options.length === 0)) {
    throw new Error("episode_spot_resolution_no_eligible_candidate");
  }

  const selectedByRequirement = selectCandidateSequence(traces.map((trace) => trace.options));
  if (selectedByRequirement.length !== traces.length) {
    throw new Error("episode_spot_resolution_sequence_failed");
  }
  const rawSelected = traces.map(
    (trace, index) => trace.options.find((candidate) => candidate === selectedByRequirement[index]) || trace.options[0]
  );
  const usedSpotNames = new Set<string>();
  const selected = rawSelected.map((candidate, index) => {
    const trace = traces[index];
    const normalizeName = (value: string) => clean(value).toLowerCase();
    let chosen = candidate || trace.options[0];
    const chosenKey = normalizeName(chosen.spot_name);
    if (chosenKey && usedSpotNames.has(chosenKey)) {
      const alternative = trace.options.find((option) => {
        const key = normalizeName(option.spot_name);
        return key.length > 0 && !usedSpotNames.has(key);
      });
      if (alternative) chosen = alternative;
    }
    const finalKey = normalizeName(chosen.spot_name);
    if (finalKey) usedSpotNames.add(finalKey);
    return chosen;
  });
  const filteredSelected = selected.filter(Boolean);
  const distanceMatrix = buildDistanceMatrix(filteredSelected);

  const ortoolsResult = await runOrToolsRoute(distanceMatrix);
  const defaultOrder = filteredSelected.map((_, index) => index);
  const optimizedOrder =
    ortoolsResult && "order" in ortoolsResult
      ? ortoolsResult.order.filter((index) => index >= 0 && index < filteredSelected.length)
      : defaultOrder;
  const validOrder =
    optimizedOrder.length === filteredSelected.length &&
    new Set(optimizedOrder).size === filteredSelected.length &&
    optimizedOrder[0] === 0 &&
    optimizedOrder[optimizedOrder.length - 1] === filteredSelected.length - 1
      ? optimizedOrder
      : defaultOrder;

  let transferMinutes = 0;
  let maxLegMinutes = 0;
  for (let index = 1; index < validOrder.length; index += 1) {
    const from = validOrder[index - 1];
    const to = validOrder[index];
    const leg = distanceMatrix[from]?.[to] ?? 0;
    transferMinutes += leg;
    maxLegMinutes = Math.max(maxLegMinutes, leg);
  }

  const totalWalkMinutes = filteredSelected.reduce(
    (sum, candidate) => sum + candidate.estimated_walk_minutes,
    0
  );
  const totalEstimatedWalkMinutes = Math.round(totalWalkMinutes + transferMinutes);
  const maxLeg = Math.max(10, context.maxLegMinutes ?? ROUTE_MAX_LEG_MINUTES);
  const maxTotal = Math.max(30, context.maxTotalWalkMinutes ?? ROUTE_DEFAULT_TOTAL_MINUTES);
  const minSelectedRequired = Math.max(2, normalizedRequirements.length);
  const duplicateSelected = new Set(filteredSelected.map((candidate) => clean(candidate.spot_name).toLowerCase())).size !== filteredSelected.length;
  const failureReasons = dedupeStrings([
    filteredSelected.length < minSelectedRequired ? "insufficient_selected_spots" : "",
    duplicateSelected ? "duplicate_spots_selected" : "",
    maxLegMinutes > maxLeg ? "max_leg_minutes_exceeded" : "",
    totalEstimatedWalkMinutes > maxTotal ? "total_walk_minutes_exceeded" : "",
    ortoolsResult && "error" in ortoolsResult && ROUTE_OPTIMIZER_MODE === "ortools" ? ortoolsResult.error : "",
  ]);

  const avgRole = filteredSelected.length
    ? filteredSelected.reduce((sum, candidate) => sum + candidate.role_match_score, 0) / filteredSelected.length
    : 0;
  const avgTourism = filteredSelected.length
    ? filteredSelected.reduce((sum, candidate) => sum + candidate.tourism_match_score, 0) / filteredSelected.length
    : 0;
  const avgLocality = filteredSelected.length
    ? filteredSelected.reduce((sum, candidate) => sum + candidate.locality_score, 0) / filteredSelected.length
    : 0;

  const continuityScore = clamp01(avgRole * 0.45 + avgTourism * 0.35 + avgLocality * 0.2);
  const walkScore = clamp01(1 - totalEstimatedWalkMinutes / maxTotal);
  const legScore = clamp01(1 - maxLegMinutes / maxLeg);
  const routeScore = clamp01(walkScore * 0.55 + legScore * 0.25 + continuityScore * 0.2);

  const resolved = normalizedRequirements.map((requirement, index) => {
    const picked = filteredSelected[index];
    if (!picked) {
      throw new Error(`episode_spot_resolution_missing_pick:${requirement.requirement_id}`);
    }
    const trace = traces[index];
    return {
      ...requirement,
      spot_name: picked.spot_name,
      tourism_focus: picked.tourism_focus,
      estimated_walk_minutes: picked.estimated_walk_minutes,
      eligibility_notes: trace.rejectedReasons.slice(0, 6),
    };
  });

  const trace: EpisodeGenerationTrace = {
    stage_location: clean(context.stageLocation) || "街",
    candidate_spots: traces.map((row) => ({
      requirement_id: row.requirement.requirement_id,
      scene_role: row.requirement.scene_role,
      spot_role: row.requirement.spot_role,
      candidates: row.candidates.slice(0, 12),
    })),
    selected_spots: resolved.map((spot) => ({
      requirement_id: spot.requirement_id,
      scene_role: spot.scene_role,
      spot_name: spot.spot_name,
      tourism_focus: spot.tourism_focus,
      estimated_walk_minutes: spot.estimated_walk_minutes,
    })),
    eligibility_reject_reasons: dedupeStrings(traces.flatMap((row) => row.rejectedReasons)).slice(0, 80),
    mmr_scores: traces
      .flatMap((row) =>
        row.reranked.map((rank) => ({
          requirement_id: row.requirement.requirement_id,
          spot_name: rank.candidate.spot_name,
          relevance_score: rank.relevance_score,
          redundancy_penalty: rank.redundancy_penalty,
          mmr_score: rank.mmr_score,
        }))
      )
      .slice(0, 80),
    route_metrics: {
      optimizer:
        ortoolsResult && "order" in ortoolsResult
          ? ortoolsResult.optimizer
          : "heuristic_dp_v1",
      total_estimated_walk_minutes: Math.max(0, totalEstimatedWalkMinutes),
      transfer_minutes: Math.max(0, Math.round(transferMinutes)),
      max_leg_minutes: Math.max(0, Math.round(maxLegMinutes)),
      max_total_walk_minutes: maxTotal,
      feasible: failureReasons.length === 0,
      failure_reasons: failureReasons.slice(0, 20),
      optimized_order_indices: validOrder,
      optimized_order_spot_names: validOrder.map((orderIndex) => filteredSelected[orderIndex]?.spot_name || "").filter(Boolean),
    },
    route_score: Number(routeScore.toFixed(3)),
    continuity_score: Number(continuityScore.toFixed(3)),
  };

  return {
    resolved: resolved
      .slice()
      .sort((left, right) => sceneOrder[left.scene_role] - sceneOrder[right.scene_role])
      .slice(0, EPISODE_SPOT_MAX),
    trace,
  };
};

export const dryRunFirstEpisodeSeedRoute = async (params: {
  stage_location: string;
  world_setting?: string;
  purpose?: string;
  expected_duration_minutes?: number;
  suggested_spots?: string[];
  spot_requirements: FirstEpisodeSeedSpotRequirement[];
}) => {
  const requirements: EpisodeSpotRequirement[] = params.spot_requirements
    .slice(0, EPISODE_SPOT_MAX)
    .map((requirement, index) => ({
    requirement_id: clean(requirement.requirement_id) || `seed_req_${index + 1}`,
    scene_role: requirement.scene_role,
    spot_role: clean(requirement.spot_role) || "回遊スポット",
    required_attributes: dedupeStrings(requirement.required_attributes || []),
    visit_constraints: dedupeStrings(requirement.visit_constraints || []),
    tourism_value_type: clean(requirement.tourism_value_type) || "地域体験",
    objective: `${clean(requirement.spot_role) || "この地点"}で導線検証の要素を確認する`,
    purpose: clean(params.purpose) || "シリーズ導入検証",
    chapter_hook: "次地点への移動理由を作る。",
    key_clue: `${clean(requirement.spot_role) || "地点"}に関する導入手がかり`,
    tension_level: Math.max(2, Math.min(8, 3 + index * 2)),
    mission: `${clean(requirement.spot_role) || "地点"}で観察可能な特徴を確認する`,
  }));

  const resolved = await resolveSpotRequirements(requirements, {
    stageLocation: clean(params.stage_location) || "街",
    purpose: clean(params.purpose) || "シリーズ導入検証",
    worldSetting: clean(params.world_setting),
    legacySuggestedSpots: params.suggested_spots || [],
    maxTotalWalkMinutes: Math.max(
      45,
      Math.min(180, (params.expected_duration_minutes || 20) * requirements.length + 35)
    ),
    maxLegMinutes: ROUTE_MAX_LEG_MINUTES,
  });

  return {
    feasible: resolved.trace.route_metrics.feasible,
    selected_spots: resolved.resolved.map((spot) => spot.spot_name),
    failure_reasons: resolved.trace.route_metrics.failure_reasons,
    route_metrics: resolved.trace.route_metrics,
    route_score: resolved.trace.route_score,
    continuity_score: resolved.trace.continuity_score,
    trace: resolved.trace,
  };
};

const generateSpotsContent = async (
  plan: EpisodePlan,
  resolvedRequirements: ResolvedSpotRequirement[],
  input: SeriesRuntimeEpisodeRequest,
  onProgress?: SeriesRuntimeEpisodeProgressReporter
): Promise<SpotResult[]> => {
  const logPrefix = "[episode-spots]";
  const results: SpotResult[] = [];
  let previousSummary: string | undefined;
  let previousClue: string | undefined;

  for (let idx = 0; idx < resolvedRequirements.length; idx += 1) {
    const ch = resolvedRequirements[idx];
    const spotLabel = `[spot ${idx + 1}/${resolvedRequirements.length}: ${ch.spot_name}]`;
    await emitSeriesRuntimeEpisodeProgress(onProgress, {
      phase: "spot_chapter_start",
      detail: `${ch.spot_name}の情景を生成`,
      spot_index: idx + 1,
      spot_count: resolvedRequirements.length,
      spot_name: ch.spot_name,
    });

    // --- Chapter ---
    console.log(`${logPrefix} ${spotLabel} chapter生成中`);
    const chapterInput: ChapterAgentInput = {
      spotIndex: idx,
      spotCount: resolvedRequirements.length,
      spotName: ch.spot_name,
      tourismAnchor: ch.tourism_focus,
      tourismFocus: ch.tourism_focus,
      sceneRole: ch.scene_role,
      sceneObjective: ch.objective,
      scenePurpose: ch.purpose,
      chapterHook: ch.chapter_hook,
      keyClue: ch.key_clue,
      tensionLevel: ch.tension_level,
      mission: ch.mission,
      narrativeVoice: plan.narrative_voice,
      playerName: "旅人",
      previousSummary,
      previousClue,
      characters: plan.characters.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        personality: c.personality,
        voice_profile: {
          vocabulary: c.voice_profile.vocabulary,
          emotional_range: c.voice_profile.emotional_range,
          style: c.voice_profile.style,
          catchphrases: c.voice_profile.catchphrases,
        },
      })),
    };

    const chapter = await generateChapter(chapterInput);
    console.log(
      `${logPrefix} ${spotLabel} chapter完了 — blocks: ${chapter.blocks.length}, text: ${chapter.chapter_text.length}文字`
    );
    await emitSeriesRuntimeEpisodeProgress(onProgress, {
      phase: "spot_chapter_done",
      detail: `${ch.spot_name}の情景生成が完了`,
      spot_index: idx + 1,
      spot_count: resolvedRequirements.length,
      spot_name: ch.spot_name,
    });

    previousSummary = chapter.summary;
    previousClue = chapter.newClue || ch.key_clue || previousClue;

    // Puzzle generation is disabled.
    // Keep deterministic compatibility fields so existing clients/schemas still work.
    const defaultOml = buildDefaultObjectiveMissionLink({
      spotName: ch.spot_name,
      objectiveResult: ch.objective,
      keyClue: ch.key_clue,
      tourismAnchor: ch.tourism_focus,
    });
    const oml = normalizeObjectiveMissionLink({
      spotName: ch.spot_name,
      objectiveResult: ch.objective,
      link: defaultOml,
      keyClue: ch.key_clue,
      tourismAnchor: ch.tourism_focus,
    });
    const puzzle = {
      question_text: clean(oml.mission_question) || `${ch.objective}を成立させる要点は何か？`,
      answer_text:
        clean(chapter.newClue) || clean(oml.expected_answer) || clean(ch.key_clue) || "次へ進む鍵",
      hint_text: clean(`${ch.tourism_focus}に注目し、${ch.objective}の成立条件を確認する。`),
      explanation_text:
        clean(oml.success_outcome) ||
        clean(`${ch.tourism_focus}が判断材料となり、${ch.objective}の前進につながる。`),
    };

    // --- Split dialogue into pre/post mission ---
    const blocks = chapter.blocks;
    const missionIdx = blocks.findIndex((b) => b.type === "mission");
    const preMission: SpotResult["pre_mission_dialogue"] = [];
    const postMission: SpotResult["post_mission_dialogue"] = [];

    blocks.forEach((block, bIdx) => {
      if (block.type !== "dialogue" || !block.speaker_id) return;
      const line = {
        character_id: block.speaker_id,
        text: block.text,
        expression: block.expression,
      };
      if (missionIdx < 0 || bIdx < missionIdx) {
        preMission.push(line);
      } else {
        postMission.push(line);
      }
    });

    results.push({
      spot_name: ch.spot_name,
      scene_role: ch.scene_role,
      scene_objective: ch.objective,
      scene_narration: chapter.chapter_text,
      blocks: chapter.blocks,
      question_text: puzzle.question_text,
      answer_text: puzzle.answer_text,
      hint_text: puzzle.hint_text,
      explanation_text: puzzle.explanation_text,
      pre_mission_dialogue: preMission,
      post_mission_dialogue: postMission,
    });
  }

  return results;
};

// ---------------------------------------------------------------------------
// Step 4: Assemble final output
// ---------------------------------------------------------------------------

const toNameKey = (value?: string | null) => clean(value).toLowerCase();

const buildSeriesCharacterSourceMap = (input: SeriesRuntimeEpisodeRequest) => {
  const byName = new Map<string, RuntimeSeriesCharacter>();
  (input.series.characters || []).forEach((character) => {
    const key = toNameKey(character.name);
    if (!key || byName.has(key)) return;
    byName.set(key, character);
  });
  return byName;
};

const buildLegacyEpisodeVisualStyleGuide = (input: SeriesRuntimeEpisodeRequest, plan: EpisodePlan) => {
  const seriesTitle = clean(input.series.title) || "TOMOSHIBI";
  const stageLocation =
    clean(input.episode_request.stage_location) || clean(input.series.world_setting) || "city district";
  const genre =
    clean(input.series.overview) || clean(input.series.premise) || "story-driven city exploration";
  const tone =
    clean(plan.episode_world?.mood) || clean(input.series.season_goal) || "emotional mystery journey";
  const recurringMotifs = dedupeStrings([
    clean(input.series.continuity?.global_mystery),
    clean(input.series.continuity?.mid_season_twist),
    clean(input.series.progress_state?.next_hook),
  ]).slice(0, 2);
  return buildSeriesVisualStyleGuide({
    seriesTitle,
    genre,
    tone,
    setting: stageLocation,
    recurringMotifs,
  });
};

const buildEpisodeVisualPackage = async (params: {
  plan: EpisodePlan;
  input: SeriesRuntimeEpisodeRequest;
  episodeUniqueCharacters: EpisodeOutputUniqueCharacter[];
  onProgress?: SeriesRuntimeEpisodeProgressReporter;
}): Promise<{
  coverImagePrompt: string;
  coverImageUrl: string;
  characters: EpisodeOutputCharacter[];
  episodeUniqueCharacters: EpisodeOutputUniqueCharacter[];
}> => {
  const { plan, input, onProgress } = params;
  const episodeNo = (input.series.progress_state?.last_completed_episode_no || 0) + 1;
  const seriesTitle = clean(input.series.title) || "TOMOSHIBI";
  const stageLocation =
    clean(input.episode_request.stage_location) || clean(input.series.world_setting) || "city district";
  const genre =
    clean(input.series.overview) || clean(input.series.premise) || "story-driven city exploration";
  const tone =
    clean(plan.episode_world?.mood) || clean(input.series.season_goal) || "emotional mystery journey";
  const styleGuide = buildLegacyEpisodeVisualStyleGuide(input, plan);
  const seriesSourceByName = buildSeriesCharacterSourceMap(input);
  const uniqueByName = new Map<string, EpisodeOutputUniqueCharacter>();

  await emitSeriesRuntimeEpisodeProgress(onProgress, {
    phase: "episode_character_images_start",
    detail: "登場人物画像を生成しています",
  });

  const uniqueCharactersWithPortraits = params.episodeUniqueCharacters.map((character, index) => {
    const portraitPrompt =
      clean(character.portrait_prompt) ||
      buildCharacterPortraitPrompt({
        seriesTitle,
        genre,
        tone,
        name: character.name,
        role: character.role,
        personality: character.personality,
        appearance: `${clean(character.role)} / ${clean(character.relation_to_series)}`,
        setting: stageLocation,
        distinguishingFeature: clean(character.relation_to_series),
        styleGuide,
      });
    const portraitImageUrl =
      clean(character.portrait_image_url) ||
      buildSeriesImageUrl({
        prompt: portraitPrompt,
        seedKey: `${seriesTitle}:ep:${episodeNo}:local:${index + 1}:${character.id}:${character.name}`,
        width: 768,
        height: 1024,
        purpose: "character_portrait",
        styleReference: styleGuide,
      });
    const next: EpisodeOutputUniqueCharacter = {
      ...character,
      portrait_prompt: portraitPrompt || undefined,
      portrait_image_url: portraitImageUrl || undefined,
    };
    uniqueByName.set(toNameKey(next.name), next);
    return next;
  });

  const characters: EpisodeOutputCharacter[] = plan.characters.map((character, index) => {
    const key = toNameKey(character.name);
    const local = uniqueByName.get(key);
    if (local) {
      return {
        id: character.id,
        name: character.name,
        role: character.role,
        personality: character.personality,
        origin: "episode",
        avatar_prompt: local.portrait_prompt,
        avatar_image_url: local.portrait_image_url,
      };
    }
    const source = seriesSourceByName.get(key);
    const avatarPrompt =
      clean(source?.portrait_prompt) ||
      buildCharacterPortraitPrompt({
        seriesTitle,
        genre,
        tone,
        name: character.name,
        role: character.role,
        personality: character.personality,
        appearance: clean(source?.appearance) || `${clean(character.role)} / ${clean(character.personality)}`,
        setting: stageLocation,
        styleGuide,
      });
    const avatarImageUrl =
      clean(source?.portrait_image_url) ||
      buildSeriesImageUrl({
        prompt: avatarPrompt,
        seedKey: `${seriesTitle}:series:${clean(source?.id) || character.id}:${character.name}:${character.role}`,
        width: 768,
        height: 1024,
        purpose: "character_portrait",
        styleReference: styleGuide,
      });
    return {
      id: character.id,
      name: character.name,
      role: character.role,
      personality: character.personality,
      origin: "series",
      avatar_prompt: avatarPrompt || undefined,
      avatar_image_url: avatarImageUrl || undefined,
    };
  });

  await emitSeriesRuntimeEpisodeProgress(onProgress, {
    phase: "episode_character_images_done",
    detail: `登場人物画像の準備が完了（${characters.length}人）`,
  });

  const planById = new Map(plan.characters.map((character) => [character.id, character]));
  const focusCharacters = characters
    .slice()
    .sort((left, right) => {
      if (left.origin !== right.origin) return left.origin === "series" ? -1 : 1;
      const leftRequired = Boolean(planById.get(left.id)?.must_appear);
      const rightRequired = Boolean(planById.get(right.id)?.must_appear);
      if (leftRequired !== rightRequired) return leftRequired ? -1 : 1;
      return 0;
    })
    .slice(0, 3)
    .map((character) => {
      const local = uniqueByName.get(toNameKey(character.name));
      return {
        name: clean(character.name),
        role: clean(character.role),
        focusReason:
          character.origin === "series" ? "series continuity anchor" : "episode-local freshness anchor",
        visualAnchor: dedupeStrings([
          clean(character.personality),
          clean(local?.relation_to_series),
        ])
          .slice(0, 2)
          .join(" / "),
      };
    });

  await emitSeriesRuntimeEpisodeProgress(onProgress, {
    phase: "episode_cover_image_start",
    detail: "エピソードカバー画像を生成しています",
  });

  const coverImagePrompt = buildCoverImagePrompt({
    title: `${seriesTitle} ${clean(plan.title)}`.trim(),
    genre,
    tone,
    premise:
      clean(plan.one_liner) ||
      clean(plan.premise) ||
      clean(input.episode_request.purpose) ||
      "episode journey",
    setting: stageLocation,
    styleGuide,
    recurringMotifs: dedupeStrings([
      clean(input.series.continuity?.global_mystery),
      clean(input.series.progress_state?.next_hook),
      clean(plan.carry_over_hook),
    ]).slice(0, 2),
    focusCharacters,
    additionalDirection: dedupeStrings([
      clean(input.episode_request.purpose),
      clean(input.episode_request.user_wishes),
      ...plan.spot_requirements.slice(0, 3).map((requirement) => clean(requirement.spot_role)),
    ]).join(" / "),
  });

  const coverImageUrl = buildSeriesImageUrl({
    prompt: coverImagePrompt,
    seedKey: `${seriesTitle}:episode:${episodeNo}:cover:${clean(plan.title)}:${stageLocation}`,
    width: 1280,
    height: 720,
    purpose: "cover",
    styleReference: styleGuide,
  });

  await emitSeriesRuntimeEpisodeProgress(onProgress, {
    phase: "episode_cover_image_done",
    detail: "エピソードカバー画像の準備が完了",
  });

  return {
    coverImagePrompt,
    coverImageUrl,
    characters,
    episodeUniqueCharacters: uniqueCharactersWithPortraits,
  };
};

const assembleEpisode = async (
  plan: EpisodePlan,
  spots: SpotResult[],
  input: SeriesRuntimeEpisodeRequest,
  generationTrace?: EpisodeGenerationTrace,
  onProgress?: SeriesRuntimeEpisodeProgressReporter
): Promise<SeriesRuntimeEpisodeOutput> => {
  const unresolved = input.series.progress_state?.unresolved_threads || [];
  const previousFlags = input.series.progress_state?.relationship_flags || [];
  const relationSummaryBefore = clean(input.series.progress_state?.relationship_state_summary || "");
  const relationShift = dedupeStrings([
    "became_more_open",
    "shared_new_context",
    input.episode_request.user_wishes ? "responded_to_user_wish" : "",
  ]);
  const relationFlagsToAdd = dedupeStrings([
    ...relationShift,
    plan.characters.some((character) => character.must_appear)
      ? "primary_companion_engaged"
      : "",
  ]);
  const relationFlagsToRemove = previousFlags.includes("still_keeping_distance")
    ? ["still_keeping_distance"]
    : [];
  const relationshipStateSummary = clean(
    `${relationSummaryBefore || "関係性は継続中。"} 今回は${plan.characters
      .filter((character) => character.must_appear)
      .map((character) => character.name)
      .join("・")}との相互理解が進んだ。`
  );
  const episodeUniqueCharacters = (plan.episode_unique_characters || []).map(
    (character, index) => ({
      id: `ep_char_${index + 1}`,
      name: clean(character.name) || `エピソード人物${index + 1}`,
      role: clean(character.role) || "地域人物",
      personality: clean(character.personality) || "観察力が高い",
      motivation: clean(character.motivation) || "現地の情報を伝える",
      relation_to_series:
        clean(character.relation_to_series) || "シリーズ進行に関わる情報を持つ",
      introduction_scene: clean(character.introduction_scene) || "中盤で登場",
    })
  );
  const visualPackage = await buildEpisodeVisualPackage({
    plan,
    input,
    episodeUniqueCharacters,
    onProgress,
  });

  return {
    title: plan.title,
    summary:
      spots.map((s) => s.scene_narration.slice(0, 60)).join("→") ||
      `${input.episode_request.stage_location}での街歩きエピソード`,
    one_liner: plan.one_liner,
    cover_image_prompt: visualPackage.coverImagePrompt,
    cover_image_url: visualPackage.coverImageUrl,
    episode_cover_image_prompt: visualPackage.coverImagePrompt,
    episode_cover_image_url: visualPackage.coverImageUrl,
    main_plot: {
      premise: plan.premise,
      goal: plan.goal,
    },
    characters: visualPackage.characters,
    episode_world: plan.episode_world,
    episode_unique_characters: visualPackage.episodeUniqueCharacters,
    spots,
    completion_condition: plan.completion_condition,
    carry_over_hook: plan.carry_over_hook,
    estimated_duration_minutes: plan.estimated_duration_minutes,
    progress_patch: {
      unresolved_threads_to_add:
        unresolved.length > 0 ? [] : [`${input.episode_request.purpose}に関わる未解決点`],
      unresolved_threads_to_remove: [],
      revealed_facts_to_add: [
        `${input.episode_request.stage_location}で得た新情報`,
      ],
      relationship_state_summary: relationshipStateSummary,
      relationship_flags_to_add: relationFlagsToAdd,
      relationship_flags_to_remove: relationFlagsToRemove,
      recent_relation_shift: relationShift,
      companion_trust_delta: 2,
      next_hook: plan.carry_over_hook,
    },
    generation_trace: generationTrace,
  };
};

// ---------------------------------------------------------------------------
// Public: Full pipeline
// ---------------------------------------------------------------------------

export const generateSeriesRuntimeEpisode = async (
  input: SeriesRuntimeEpisodeRequest,
  options: {
    onProgress?: SeriesRuntimeEpisodeProgressReporter;
  } = {}
): Promise<SeriesRuntimeEpisodeOutput> => {
  const logPrefix = "[series-episode-pipeline]";
  const startMs = Date.now();
  const onProgress = options.onProgress;
  console.log(
    `${logPrefix} 開始 — series: ${input.series.title}, location: ${input.episode_request.stage_location}, purpose: ${input.episode_request.purpose}, spots: ${input.episode_request.desired_spot_count}${input.episode_request.user_wishes ? `, wishes: ${input.episode_request.user_wishes.slice(0, 60)}` : ""}`
  );
  await emitSeriesRuntimeEpisodeProgress(onProgress, {
    phase: "pipeline_start",
    detail: "シリーズ実行パイプラインを開始",
  });

  if (!hasModelApiKey()) {
    throw new Error("エピソード生成に失敗しました。利用可能なAIモデルがありません。");
  }

  // Step 1: Plan
  console.log(`${logPrefix} Step 1/3: エピソード設計`);
  await emitSeriesRuntimeEpisodeProgress(onProgress, {
    phase: "episode_plan_start",
    detail: "エピソード設計を開始",
  });
  const plan = await generateEpisodePlan(input);
  await emitSeriesRuntimeEpisodeProgress(onProgress, {
    phase: "episode_plan_done",
    detail: "エピソード設計が完了",
  });

  // Step 2–3: Chapter per spot (puzzle generation disabled)
  console.log(
    `${logPrefix} Step 2-3/3: ${plan.spot_requirements.length}件の要件を解決してchapter生成`
  );
  await emitSeriesRuntimeEpisodeProgress(onProgress, {
    phase: "spot_resolution_start",
    detail: `${plan.spot_requirements.length}件のスポット要件を解決`,
  });
  const resolution = await resolveSpotRequirements(plan.spot_requirements, {
    stageLocation: input.episode_request.stage_location,
    purpose: input.episode_request.purpose,
    worldSetting: input.series.world_setting,
    legacySuggestedSpots: input.series.first_episode_seed?.suggested_spots || [],
    maxLegMinutes: ROUTE_MAX_LEG_MINUTES,
    maxTotalWalkMinutes: Math.max(
      75,
      Math.min(
        180,
        (input.episode_request.desired_duration_minutes || 20) *
          plan.spot_requirements.length +
          35
      )
    ),
  });
  await emitSeriesRuntimeEpisodeProgress(onProgress, {
    phase: "spot_resolution_done",
    detail: `スポット要件の解決が完了（${resolution.resolved.length}件）`,
  });
  const resolvedRequirements = resolution.resolved;
  const spots = await generateSpotsContent(plan, resolvedRequirements, input, onProgress);

  // Step 4: Assemble
  await emitSeriesRuntimeEpisodeProgress(onProgress, {
    phase: "episode_assemble_start",
    detail: "最終エピソードを組み立て",
  });
  const episode = await assembleEpisode(plan, spots, input, resolution.trace, onProgress);
  await emitSeriesRuntimeEpisodeProgress(onProgress, {
    phase: "episode_assemble_done",
    detail: "最終エピソードの組み立てが完了",
  });

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(
    `${logPrefix} 完了 (${elapsedSec}秒) — title: ${episode.title}, spots: ${episode.spots.length}, blocks合計: ${episode.spots.reduce((sum, s) => sum + s.blocks.length, 0)}`
  );

  return episode;
};
