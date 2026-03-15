import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SERIES_EPISODE_MODEL } from "../modelConfig";
import {
  seriesCharacterSchema,
  seriesCheckpointSchema,
  seriesPreferenceSheetSchema,
  seriesWorldSchema,
} from "../../schemas/series";

export const seriesCheckpointAgentInputSchema = z.object({
  title: z.string(),
  premise: z.string(),
  season_goal: z.string(),
  genre: z.string(),
  tone: z.string(),
  world: seriesWorldSchema,
  characters: z.array(seriesCharacterSchema).min(3).max(8),
  desired_episode_count: z.number().int().min(3).max(24),
  preference_sheet: seriesPreferenceSheetSchema,
  continuation_trigger: z.string().optional(),
});

export const seriesCheckpointAgentOutputSchema = z.object({
  checkpoints: z.array(seriesCheckpointSchema).min(4).max(8),
});

export type SeriesCheckpointAgentInput = z.infer<typeof seriesCheckpointAgentInputSchema>;
export type SeriesCheckpointAgentOutput = z.infer<typeof seriesCheckpointAgentOutputSchema>;

const SERIES_CHECKPOINT_AGENT_INSTRUCTIONS = `
あなたは連載シリーズの中長期構造設計者です。
checkpoint だけを設計してください（first episode seed は設計しない）。

## 必須
- checkpoint は 4〜8 件
- checkpoint_no は 1 から連番
- 各 checkpoint は carry_over を持ち、次checkpointに状態を渡す
- continuation_trigger を全体設計に反映する
- 感情曲線（高まり・反転・収束）をcheckpointに埋め込む
- 固定キャラクター関係の進展が分かるようにする
`;

export const seriesCheckpointAgent = new Agent({
  id: "series-checkpoint-agent",
  name: "series-checkpoint-agent",
  model: MASTRA_SERIES_EPISODE_MODEL,
  instructions: SERIES_CHECKPOINT_AGENT_INSTRUCTIONS,
});

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();

const hasModelApiKey = () =>
  Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );

const resolveCheckpointCount = (desiredEpisodeCount: number) =>
  Math.max(4, Math.min(8, Math.round(desiredEpisodeCount / 2)));

const checkpointPhaseLabel = (checkpointNo: number, checkpointCount: number) => {
  if (checkpointNo === 1) return "起動";
  if (checkpointNo === checkpointCount) return "収束";
  if (checkpointNo === Math.ceil(checkpointCount / 2)) return "反転";
  return checkpointNo < Math.ceil(checkpointCount / 2) ? "増幅" : "臨界";
};

const buildFallbackCheckpoint = (
  input: SeriesCheckpointAgentInput,
  checkpointNo: number,
  checkpointCount: number
) => {
  const pivotCharacter = input.characters[(checkpointNo - 1) % input.characters.length];
  const trigger = clean(input.continuation_trigger) || input.preference_sheet.continuation_needs[0] || "次話フック";
  const phase = checkpointPhaseLabel(checkpointNo, checkpointCount);
  const emotion =
    input.preference_sheet.emotional_rewards[(checkpointNo - 1) % input.preference_sheet.emotional_rewards.length] ||
    input.preference_sheet.emotional_rewards[0] ||
    "余韻";
  const dynamic =
    input.preference_sheet.desired_relationship_dynamics[
      (checkpointNo - 1) % input.preference_sheet.desired_relationship_dynamics.length
    ] || "固定キャラクター関係";
  const motif =
    input.world.recurring_motifs[(checkpointNo - 1) % input.world.recurring_motifs.length] ||
    clean(input.world.setting) ||
    "街区";
  const nextCharacter = input.characters[checkpointNo % input.characters.length];
  const noText = `CP${checkpointNo}`;

  return {
    checkpoint_no: checkpointNo,
    title: `${noText}: ${phase} - ${motif}`,
    purpose:
      checkpointNo === checkpointCount
        ? `${clean(input.season_goal) || "シーズン目標"}へ収束し、${dynamic}の到達点を提示する。`
        : `${pivotCharacter.name}の選択で${trigger}を一段進め、${emotion}の獲得条件を更新する。`,
    unlock_hint:
      checkpointNo === 1
        ? `${trigger}の初回提示と、${dynamic}の初期ズレを明示する。`
        : `CP${checkpointNo - 1}のcarry_overを受け、${pivotCharacter.name}の立場変化を開示する。`,
    expected_emotion:
      checkpointNo === checkpointCount
        ? `${emotion}と余韻`
        : checkpointNo >= Math.ceil(checkpointCount / 2)
          ? `${emotion}と反転`
          : `${emotion}と高まり`,
    carry_over:
      checkpointNo === checkpointCount
        ? `回収済み要素と未回収要素を仕分け、次シーズン導線の可否を判定する。`
        : `${nextCharacter.name}が参照する未解決条件を1つ残し、${trigger}を次checkpointへ持ち越す。`,
  };
};

const buildFallbackOutput = (input: SeriesCheckpointAgentInput): SeriesCheckpointAgentOutput => {
  const checkpointCount = resolveCheckpointCount(input.desired_episode_count);
  return {
    checkpoints: Array.from({ length: checkpointCount }, (_, index) =>
      buildFallbackCheckpoint(input, index + 1, checkpointCount)
    ),
  };
};

const normalizeOutput = (
  input: SeriesCheckpointAgentInput,
  raw: unknown
): SeriesCheckpointAgentOutput | null => {
  const parsed = seriesCheckpointAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;

  const checkpointCount = resolveCheckpointCount(input.desired_episode_count);
  const byNo = new Map<number, z.infer<typeof seriesCheckpointSchema>>();
  parsed.data.checkpoints.forEach((checkpoint, index) => {
    const no = Number.isFinite(checkpoint.checkpoint_no) ? checkpoint.checkpoint_no : index + 1;
    if (!byNo.has(no)) byNo.set(no, checkpoint);
  });

  return {
    checkpoints: Array.from({ length: checkpointCount }, (_, index) => {
      const no = index + 1;
      const fallback = buildFallbackCheckpoint(input, no, checkpointCount);
      const row = byNo.get(no) || fallback;
      return {
        checkpoint_no: no,
        title: clean(row.title) || fallback.title,
        purpose: clean(row.purpose) || fallback.purpose,
        unlock_hint: clean(row.unlock_hint) || fallback.unlock_hint,
        expected_emotion: clean(row.expected_emotion) || fallback.expected_emotion,
        carry_over: clean(row.carry_over) || fallback.carry_over,
      };
    }),
  };
};

export const generateSeriesCheckpoints = async (
  input: SeriesCheckpointAgentInput
): Promise<SeriesCheckpointAgentOutput> => {
  if (!hasModelApiKey()) {
    console.warn("[series-checkpoint-agent] API key not found, fallback checkpoints used");
    return buildFallbackOutput(input);
  }

  const prompt = `
## シリーズ情報
- タイトル: ${input.title}
- ジャンル: ${input.genre}
- トーン: ${input.tone}
- premise: ${input.premise}
- season_goal: ${input.season_goal}
- continuation_trigger: ${input.continuation_trigger || input.preference_sheet.continuation_needs.join(" / ")}
- desired_episode_count: ${input.desired_episode_count}

## ユーザー意図
- emotional_rewards: ${input.preference_sheet.emotional_rewards.join(" / ")}
- desired_relationship_dynamics: ${input.preference_sheet.desired_relationship_dynamics.join(" / ")}

## キャラクター
${input.characters.map((row) => `- ${row.id} ${row.name} (${row.role}) goal=${row.goal}`).join("\n")}

## TOMOSHIBI 制約
- 街歩き連載として継続可能な carry_over を設計する
- checkpoint 間の因果連結を明示する

seriesCheckpointAgentOutputSchema を満たす JSON のみを返してください。
`;

  const maxAttempts = Math.max(
    1,
    Number.parseInt(clean(process.env.SERIES_CHECKPOINT_MAX_ATTEMPTS) || "2", 10) || 2
  );
  const timeoutMs = Math.max(
    30_000,
    Number.parseInt(clean(process.env.SERIES_CHECKPOINT_TIMEOUT_MS) || "75000", 10) || 75_000
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await Promise.race([
        seriesCheckpointAgent.generate(prompt, {
          structuredOutput: { schema: seriesCheckpointAgentOutputSchema },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`checkpoint生成が${Math.round(timeoutMs / 1000)}秒でタイムアウトしました。`)),
            timeoutMs
          )
        ),
      ]);

      const normalized = normalizeOutput(input, result.object);
      if (normalized) return normalized;
    } catch (error: any) {
      console.warn("[series-checkpoint-agent] attempt失敗:", error?.message ?? error);
    }
  }

  console.warn("[series-checkpoint-agent] 全試行失敗 — fallback checkpoints使用");
  return buildFallbackOutput(input);
};
