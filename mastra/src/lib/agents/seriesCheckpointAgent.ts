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
  characters: z.array(seriesCharacterSchema).min(2).max(8),
  desired_episode_count: z.number().int().min(3).max(24),
  preference_sheet: seriesPreferenceSheetSchema,
  continuation_trigger: z.string().optional(),
});

export const seriesCheckpointAgentOutputSchema = z.object({
  checkpoints: z.array(seriesCheckpointSchema).length(3),
});

export type SeriesCheckpointAgentInput = z.infer<typeof seriesCheckpointAgentInputSchema>;
export type SeriesCheckpointAgentOutput = z.infer<typeof seriesCheckpointAgentOutputSchema>;

const SERIES_CHECKPOINT_AGENT_INSTRUCTIONS = `
あなたは連載シリーズの中長期構造設計者です。
checkpoint だけを設計してください（first episode seed は設計しない）。

## 必須
- checkpoint は 3 件固定（導入・展開・結末）
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

const normalizeOutput = (
  input: SeriesCheckpointAgentInput,
  raw: unknown
): SeriesCheckpointAgentOutput | null => {
  void input;
  const parsed = seriesCheckpointAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const normalized = parsed.data.checkpoints.map((row, index) => {
    const title = clean(row.title);
    const purpose = clean(row.purpose);
    const unlockHint = clean(row.unlock_hint);
    const expectedEmotion = clean(row.expected_emotion);
    const carryOver = clean(row.carry_over);
    if (!title || !purpose || !unlockHint || !expectedEmotion || !carryOver) {
      return null;
    }
    return {
      checkpoint_no: index + 1,
      title,
      purpose,
      unlock_hint: unlockHint,
      expected_emotion: expectedEmotion,
      carry_over: carryOver,
    };
  });
  if (normalized.some((row) => !row)) return null;
  return { checkpoints: normalized as z.infer<typeof seriesCheckpointSchema>[] };
};

export const generateSeriesCheckpoints = async (
  input: SeriesCheckpointAgentInput
): Promise<SeriesCheckpointAgentOutput> => {
  if (!hasModelApiKey()) {
    throw new Error("チェックポイント生成に失敗しました。利用可能なAIモデルがありません。");
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

  const maxAttempts = 1;
  const timeoutMs = Math.max(
    30_000,
    Number.parseInt(clean(process.env.SERIES_CHECKPOINT_TIMEOUT_MS) || "75000", 10) || 75_000
  );
  const maxTokens = Math.max(
    300,
    Math.min(1200, Number.parseInt(clean(process.env.SERIES_CHECKPOINT_MAX_TOKENS) || "700", 10) || 700)
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await Promise.race([
        seriesCheckpointAgent.generate(prompt, {
          structuredOutput: { schema: seriesCheckpointAgentOutputSchema },
          modelSettings: {
            maxRetries: 0,
            maxOutputTokens: maxTokens,
          },
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

  throw new Error("チェックポイント生成に失敗しました。外部AIの生成結果を取得できませんでした。");
};
