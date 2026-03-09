import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SERIES_RUNTIME_EPISODE_MODEL } from "../modelConfig";
import { generateChapter, type ChapterAgentInput } from "./chapterAgent";
import { generatePuzzle, type PuzzleAgentInput } from "./puzzleAgent";
import {
  buildDefaultObjectiveMissionLink,
  normalizeObjectiveMissionLink,
} from "../objectiveMissionLink";

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
      companion_trust_level: z.number().min(0).max(100).default(40),
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
        name: z.string(),
        role: z.string(),
        personality: z.string().optional(),
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

const episodePlanOutputSchema = z.object({
  title: z.string(),
  one_liner: z.string(),
  premise: z.string(),
  goal: z.string(),
  narrative_voice: z.enum(["past", "present"]).default("past"),
  characters: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      personality: z.string(),
      voice_profile: voiceProfileSchema,
    })
  ),
  chapters: z.array(
    z.object({
      spot_name: z.string(),
      scene_role: z.enum(["起", "承", "転", "結"]),
      objective: z.string(),
      purpose: z.string(),
      chapter_hook: z.string(),
      tourism_focus: z.string(),
      key_clue: z.string(),
      tension_level: z.number().int().min(1).max(10),
      mission: z.string(),
      objective_mission_link: z.object({
        objective_result: z.string(),
        mission_question: z.string(),
        expected_answer: z.string(),
        success_outcome: z.string(),
      }),
    })
  ),
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

export const seriesRuntimeEpisodeOutputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  one_liner: z.string(),
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
    companion_trust_delta: z.number().int().min(-10).max(10),
    next_hook: z.string(),
  }),
});

export type SeriesRuntimeEpisodeOutput = z.infer<typeof seriesRuntimeEpisodeOutputSchema>;

export type SeriesRuntimeEpisodeProgressPhase =
  | "pipeline_start"
  | "fallback_plan_start"
  | "fallback_plan_done"
  | "episode_plan_start"
  | "episode_plan_done"
  | "spot_chapter_start"
  | "spot_chapter_done"
  | "spot_puzzle_start"
  | "spot_puzzle_done"
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
指定されたエリア内で徒歩で巡る2〜4箇所のスポットを設定し、
各スポットの物語構造（起承転結）を設計してください。

## 基本方針
- 各スポットは指定エリア内の実在する（または実在感のある）具体的な地点名にする
- 小説として成立する骨格（起承転結、伏線、回収）を必ず作る
- 1話完結の達成感を持たせつつ、次回へのフックを残す
- 前回までの進行状態を最低1つ参照する

## characters 生成制約
- シリーズのキャラクターを使い、voice_profile を付与する
- 主人公（プレイヤー）は characters に含めない
- 3〜6人の登場人物を出力する
- id は char_1 から連番

## chapters 生成制約
- 各 chapter は1つの spot_name を持つ
- scene_role は起→承→転→結の順
- objective は「ミッション成功後に達成される成果（完了状態）」
- objective_mission_link を必ず付ける:
  - mission_question: ユーザーへ出す問い
  - expected_answer: 正答（1語〜12文字の名詞句）
  - success_outcome: 正答により達成される結果
- tourism_focus にはそのスポットの観光的な魅力・特徴を書く
- key_clue には物語上の伏線・手がかりを書く
`;

const episodePlannerAgent = new Agent({
  id: "episode-planner-agent",
  name: "episode-planner-agent",
  model: MASTRA_SERIES_RUNTIME_EPISODE_MODEL,
  instructions: EPISODE_PLANNER_INSTRUCTIONS,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const hasModelApiKey = () =>
  Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );

const sceneRoleForIndex = (
  index: number,
  spotCount: number
): "起" | "承" | "転" | "結" => {
  if (spotCount <= 2) return index === 0 ? "起" : "結";
  if (index === 0) return "起";
  if (index === spotCount - 1) return "結";
  const middleCount = spotCount - 2;
  const relative = index - 1;
  return relative < Math.ceil(middleCount / 2) ? "承" : "転";
};

const DEFAULT_VOICE_PROFILE: z.infer<typeof voiceProfileSchema> = {
  vocabulary: "formal",
  emotional_range: "reserved",
  style: "direct",
  catchphrases: ["確認しよう"],
};

const TIMEOUT_MS = 60_000;

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
- 相棒信頼度: ${series.progress_state?.companion_trust_level ?? 40}
- 現在hook: ${series.progress_state?.next_hook || "なし"}

## チェックポイント
${checkpoints.map((cp) => `- #${cp.checkpoint_no} ${cp.title} / purpose=${cp.purpose || ""}`).join("\n") || "なし"}

## シリーズキャラクター（これらを使って characters を生成すること）
${characters.map((c) => `- ${c.name} (${c.role}) / 性格: ${c.personality || "未設定"}`).join("\n") || "なし"}

## 最近のエピソード
${recentEpisodes.map((ep) => `- #${ep.episode_no ?? "?"} ${ep.title}: ${ep.summary || ""}`).join("\n") || "なし"}

## 今回のリクエスト
- エリア: ${episode_request.stage_location}
- 旅の目的: ${episode_request.purpose}
- 所要時間: ${episode_request.desired_duration_minutes}分
${episode_request.user_wishes ? `\n## ユーザーの思い（最大限尊重）\n${episode_request.user_wishes}` : ""}

## TOMOSHIBI 制約（最優先）
- エリア「${episode_request.stage_location}」内の具体的な地点名（通り、公園、橋、商店街、寺社、カフェなど）を2〜4箇所選ぶ
- 徒歩で巡れる順序で chapters を並べる
- 各スポットの tourism_focus には実際の観光的魅力を書く
- 単一屋内完結は禁止

episodePlanOutputSchema を満たす JSON のみを返してください。
`;
};

const buildFallbackPlan = (input: SeriesRuntimeEpisodeRequest): EpisodePlan => {
  const location = clean(input.episode_request.stage_location) || "街";
  const characters = (input.series.characters || []).slice(0, 4);
  const planCharacters = characters.length > 0
    ? characters.map((c, i) => ({
        id: `char_${i + 1}`,
        name: c.name,
        role: c.role,
        personality: clean(c.personality) || "落ち着いている",
        voice_profile: DEFAULT_VOICE_PROFILE,
      }))
    : [
        {
          id: "char_1",
          name: "案内人",
          role: "現地を導くガイド",
          personality: "慎重で観察力が高い",
          voice_profile: DEFAULT_VOICE_PROFILE,
        },
      ];

  const spots = [
    { name: `${location}・入口付近`, role: "起" as const },
    { name: `${location}・中心部`, role: "承" as const },
    { name: `${location}・奥地`, role: "結" as const },
  ];

  return {
    title: `${location}の${clean(input.episode_request.purpose)}`,
    one_liner: `${location}を歩き、新たな手がかりを探す。`,
    premise: `${input.series.title}の一章。${location}で物語が動く。`,
    goal: "新しい手がかりを1つ得て、次の展開への布石を打つ。",
    narrative_voice: "past",
    characters: planCharacters,
    chapters: spots.map((spot, idx) => ({
      spot_name: spot.name,
      scene_role: spot.role,
      objective: `${spot.name}で状況を把握できた`,
      purpose: "物語を段階的に進める",
      chapter_hook: idx < spots.length - 1 ? "次の地点に続く手がかりが示される。" : "全体像が見え始める。",
      tourism_focus: `${spot.name}の地域的背景`,
      key_clue: `${spot.name}で得た断片`,
      tension_level: Math.max(1, Math.min(10, 3 + idx * 2)),
      mission: `${spot.name}を観察し、気になるものを見つける`,
      objective_mission_link: {
        objective_result: `${spot.name}で状況を把握できた`,
        mission_question: `${spot.name}で最も注目すべきものは何ですか？`,
        expected_answer: "手がかり",
        success_outcome: `${spot.name}の調査が完了し、次へ進む糸口を得た`,
      },
    })),
    completion_condition: "主要スポットで新しい手がかりを1つ得る。",
    carry_over_hook: "最後に残された問いが、次回の行動を促す。",
    estimated_duration_minutes: Math.max(10, Math.min(45, input.episode_request.desired_duration_minutes || 20)),
  };
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
  console.log(`${logPrefix}   場所: ${input.episode_request.stage_location}, 目的: ${input.episode_request.purpose}`);

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
      if (parsed.success && parsed.data.chapters.length >= 2) {
        const plan = parsed.data;
        console.log(`${logPrefix} 成功 — title: ${plan.title}`);
        console.log(`${logPrefix}   one_liner: ${plan.one_liner}`);
        console.log(`${logPrefix}   premise: ${plan.premise.slice(0, 100)}`);
        console.log(`${logPrefix}   キャラクター(${plan.characters.length}人): ${plan.characters.map((c) => `${c.name}(${c.role})`).join(", ")}`);
        plan.chapters.forEach((ch, i) => {
          console.log(`${logPrefix}   spot[${i}] ${ch.scene_role} ${ch.spot_name} — obj: ${ch.objective.slice(0, 50)}`);
        });
        return plan;
      }
      console.warn(`${logPrefix} attempt ${attempt} — パース失敗`);
    } catch (error: any) {
      console.warn(`${logPrefix} attempt ${attempt} 失敗:`, error?.message ?? error);
    }
  }

  console.warn(`${logPrefix} フォールバック使用`);
  return buildFallbackPlan(input);
};

// ---------------------------------------------------------------------------
// Step 2–3: Chapter + Puzzle Generation (per spot, sequential)
// ---------------------------------------------------------------------------

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

const generateSpotsContent = async (
  plan: EpisodePlan,
  input: SeriesRuntimeEpisodeRequest,
  onProgress?: SeriesRuntimeEpisodeProgressReporter
): Promise<SpotResult[]> => {
  const logPrefix = "[episode-spots]";
  const results: SpotResult[] = [];
  let previousSummary: string | undefined;
  let previousClue: string | undefined;

  for (let idx = 0; idx < plan.chapters.length; idx += 1) {
    const ch = plan.chapters[idx];
    const spotLabel = `[spot ${idx + 1}/${plan.chapters.length}: ${ch.spot_name}]`;
    await emitSeriesRuntimeEpisodeProgress(onProgress, {
      phase: "spot_chapter_start",
      detail: `${ch.spot_name}の情景を生成`,
      spot_index: idx + 1,
      spot_count: plan.chapters.length,
      spot_name: ch.spot_name,
    });

    // --- Chapter ---
    console.log(`${logPrefix} ${spotLabel} chapter生成中`);
    const chapterInput: ChapterAgentInput = {
      spotIndex: idx,
      spotCount: plan.chapters.length,
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
      spot_count: plan.chapters.length,
      spot_name: ch.spot_name,
    });

    previousSummary = chapter.summary;
    previousClue = chapter.newClue || ch.key_clue || previousClue;
    await emitSeriesRuntimeEpisodeProgress(onProgress, {
      phase: "spot_puzzle_start",
      detail: `${ch.spot_name}の謎解きを生成`,
      spot_index: idx + 1,
      spot_count: plan.chapters.length,
      spot_name: ch.spot_name,
    });

    // --- Puzzle ---
    console.log(`${logPrefix} ${spotLabel} puzzle生成中`);
    const oml = normalizeObjectiveMissionLink({
      spotName: ch.spot_name,
      objectiveResult: ch.objective,
      link: {
        objective_result: ch.objective_mission_link.objective_result,
        mission_question: ch.objective_mission_link.mission_question,
        expected_answer: ch.objective_mission_link.expected_answer,
        success_outcome: ch.objective_mission_link.success_outcome,
      },
      keyClue: ch.key_clue,
      tourismAnchor: ch.tourism_focus,
    });

    const puzzleInput: PuzzleAgentInput = {
      spotName: ch.spot_name,
      tourismAnchor: ch.tourism_focus,
      sceneObjective: ch.objective,
      mission: ch.mission,
      sceneRole: ch.scene_role,
      keyClue: ch.key_clue,
      objective_mission_link: oml,
    };

    const puzzle = await generatePuzzle(puzzleInput);
    console.log(`${logPrefix} ${spotLabel} puzzle完了 — Q: ${puzzle.question_text.slice(0, 40)}...`);
    await emitSeriesRuntimeEpisodeProgress(onProgress, {
      phase: "spot_puzzle_done",
      detail: `${ch.spot_name}の謎解き生成が完了`,
      spot_index: idx + 1,
      spot_count: plan.chapters.length,
      spot_name: ch.spot_name,
    });

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

const assembleEpisode = (
  plan: EpisodePlan,
  spots: SpotResult[],
  input: SeriesRuntimeEpisodeRequest
): SeriesRuntimeEpisodeOutput => {
  const unresolved = input.series.progress_state?.unresolved_threads || [];

  return {
    title: plan.title,
    summary:
      spots.map((s) => s.scene_narration.slice(0, 60)).join("→") ||
      `${input.episode_request.stage_location}での街歩きエピソード`,
    one_liner: plan.one_liner,
    main_plot: {
      premise: plan.premise,
      goal: plan.goal,
    },
    characters: plan.characters.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      personality: c.personality,
    })),
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
      companion_trust_delta: 2,
      next_hook: plan.carry_over_hook,
    },
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
    `${logPrefix} 開始 — series: ${input.series.title}, location: ${input.episode_request.stage_location}, purpose: ${input.episode_request.purpose}${input.episode_request.user_wishes ? `, wishes: ${input.episode_request.user_wishes.slice(0, 60)}` : ""}`
  );
  await emitSeriesRuntimeEpisodeProgress(onProgress, {
    phase: "pipeline_start",
    detail: "シリーズ実行パイプラインを開始",
  });

  if (!hasModelApiKey()) {
    console.warn(`${logPrefix} APIキー未設定 — フォールバック使用`);
    await emitSeriesRuntimeEpisodeProgress(onProgress, {
      phase: "fallback_plan_start",
      detail: "フォールバック構成を準備",
    });
    const fallbackPlan = buildFallbackPlan(input);
    const fallbackSpots = fallbackPlan.chapters.map((ch) => ({
      spot_name: ch.spot_name,
      scene_role: ch.scene_role,
      scene_objective: ch.objective,
      scene_narration: `${ch.spot_name}に到着する。${ch.tourism_focus}`,
      blocks: [
        { type: "narration" as const, text: `${ch.spot_name}に到着する。${ch.tourism_focus}` },
        {
          type: "dialogue" as const,
          text: "ここで何か見つかるかもしれない。",
          speaker_id: "char_1",
          expression: "serious" as const,
        },
        { type: "mission" as const, text: ch.mission },
      ],
      question_text: ch.objective_mission_link.mission_question,
      answer_text: ch.objective_mission_link.expected_answer,
      hint_text: `${ch.tourism_focus}に注目する。`,
      explanation_text: `${ch.tourism_focus}が手がかりになる。だからこの答えに到達する。`,
      pre_mission_dialogue: [],
      post_mission_dialogue: [],
    }));
    await emitSeriesRuntimeEpisodeProgress(onProgress, {
      phase: "fallback_plan_done",
      detail: "フォールバック構成の準備が完了",
    });
    await emitSeriesRuntimeEpisodeProgress(onProgress, {
      phase: "episode_assemble_start",
      detail: "フォールバック出力を組み立て",
    });
    const fallbackEpisode = assembleEpisode(fallbackPlan, fallbackSpots, input);
    await emitSeriesRuntimeEpisodeProgress(onProgress, {
      phase: "episode_assemble_done",
      detail: "フォールバック出力の組み立てが完了",
    });
    return fallbackEpisode;
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

  // Step 2–3: Chapter + Puzzle per spot
  console.log(
    `${logPrefix} Step 2-3/3: ${plan.chapters.length}スポットのchapter・puzzle生成`
  );
  const spots = await generateSpotsContent(plan, input, onProgress);

  // Step 4: Assemble
  await emitSeriesRuntimeEpisodeProgress(onProgress, {
    phase: "episode_assemble_start",
    detail: "最終エピソードを組み立て",
  });
  const episode = assembleEpisode(plan, spots, input);
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
