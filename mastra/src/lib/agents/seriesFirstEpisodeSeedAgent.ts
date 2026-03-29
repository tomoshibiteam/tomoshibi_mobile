import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_MODEL_BALANCED, MASTRA_MODEL_FAST } from "../modelConfig";
import {
  seriesCheckpointSchema,
  seriesCharacterSchema,
  seriesEpisodeSeedSchema,
  seriesFirstEpisodeSeedEvalSchema,
  seriesPreferenceSheetSchema,
  seriesWorldSchema,
  userSeriesRubricSchema,
} from "../../schemas/series";

export const seriesFirstEpisodeSeedAgentInputSchema = z.object({
  title: z.string(),
  genre: z.string(),
  tone: z.string(),
  premise: z.string(),
  season_goal: z.string(),
  world: seriesWorldSchema,
  characters: z.array(seriesCharacterSchema).min(2).max(8),
  checkpoints: z.array(seriesCheckpointSchema).length(3),
  preference_sheet: seriesPreferenceSheetSchema,
  continuation_trigger: z.string().optional(),
});

export const seriesFirstEpisodeSeedAgentOutputSchema = z.object({
  first_episode_seed: seriesEpisodeSeedSchema,
});

export const seriesFirstEpisodeSeedJudgeInputSchema = z.object({
  first_episode_seed: seriesEpisodeSeedSchema,
  preference_sheet: seriesPreferenceSheetSchema,
  user_rubric: userSeriesRubricSchema,
  continuation_trigger: z.string().optional(),
});

export const seriesFirstEpisodeSeedJudgeOutputSchema = z.object({
  evaluation: seriesFirstEpisodeSeedEvalSchema,
});

export type SeriesFirstEpisodeSeedAgentInput = z.infer<typeof seriesFirstEpisodeSeedAgentInputSchema>;
export type SeriesFirstEpisodeSeedAgentOutput = z.infer<typeof seriesFirstEpisodeSeedAgentOutputSchema>;
export type SeriesFirstEpisodeSeedJudgeInput = z.infer<typeof seriesFirstEpisodeSeedJudgeInputSchema>;
export type SeriesFirstEpisodeSeedJudgeOutput = z.infer<typeof seriesFirstEpisodeSeedJudgeOutputSchema>;

const SERIES_FIRST_EPISODE_SEED_AGENT_INSTRUCTIONS = `
あなたはシリーズ第1話導入設計エージェントです。
checkpoint を踏まえつつ、局所構造としての first_episode_seed を設計してください。

## 必須
- 第1話だけに集中する
- 歩きたくなる理由を opening_scene / completion_condition に明記する
- 続きが気になる理由を carry_over_hint に明記する
- spot_requirements は 2〜4件、具体スポット名は書かない
- route_style は徒歩中心にする
`;

const SERIES_FIRST_EPISODE_SEED_JUDGE_INSTRUCTIONS = `
あなたは第1話seedの品質審査員です。
意図適合・歩行可能性・続話フック・独自性を0〜1で採点し、passを判定してください。
`;

export const seriesFirstEpisodeSeedAgent = new Agent({
  id: "series-first-episode-seed-agent",
  name: "series-first-episode-seed-agent",
  model: MASTRA_MODEL_BALANCED,
  instructions: SERIES_FIRST_EPISODE_SEED_AGENT_INSTRUCTIONS,
});

export const seriesFirstEpisodeSeedJudgeAgent = new Agent({
  id: "series-first-episode-seed-judge-agent",
  name: "series-first-episode-seed-judge-agent",
  model: MASTRA_MODEL_FAST,
  instructions: SERIES_FIRST_EPISODE_SEED_JUDGE_INSTRUCTIONS,
});

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();

const dedupe = (values: Array<string | undefined | null>) => {
  const seen = new Set<string>();
  return values
    .map((value) => clean(value))
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const hasModelApiKey = () =>
  Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );

const normalizeSeedOutput = (
  input: SeriesFirstEpisodeSeedAgentInput,
  raw: unknown
): SeriesFirstEpisodeSeedAgentOutput | null => {
  void input;
  const parsed = seriesFirstEpisodeSeedAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const seed = parsed.data.first_episode_seed;
  const title = clean(seed.title);
  const objective = clean(seed.objective);
  const openingScene = clean(seed.opening_scene);
  const routeStyle = clean(seed.route_style);
  const completionCondition = clean(seed.completion_condition);
  const carryOverHint = clean(seed.carry_over_hint);
  if (!title || !objective || !openingScene || !routeStyle || !completionCondition || !carryOverHint) {
    return null;
  }

  const parsedDuration = Number.parseInt(String(seed.expected_duration_minutes), 10);
  if (!Number.isFinite(parsedDuration)) return null;
  const safeDuration = Math.max(10, Math.min(45, parsedDuration));

  const requirements = (Array.isArray(seed.spot_requirements) ? seed.spot_requirements : [])
    .slice(0, 4)
    .map((row, index) => {
      const spotRole = clean(row.spot_role);
      const tourismValueType = clean(row.tourism_value_type);
      if (!spotRole || !tourismValueType) return null;
      return {
        requirement_id: clean(row.requirement_id) || `req_${index + 1}`,
        scene_role: row.scene_role,
        spot_role: spotRole,
        required_attributes: dedupe(row.required_attributes || []).slice(0, 8),
        visit_constraints: dedupe(row.visit_constraints || []).slice(0, 8),
        tourism_value_type: tourismValueType,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (requirements.length < 2) return null;

  return {
    first_episode_seed: {
      title,
      objective,
      opening_scene: openingScene,
      expected_duration_minutes: safeDuration,
      route_style: routeStyle,
      completion_condition: completionCondition,
      carry_over_hint: carryOverHint,
      spot_requirements: requirements,
    },
  };
};

export const generateFirstEpisodeSeed = async (
  input: SeriesFirstEpisodeSeedAgentInput
): Promise<SeriesFirstEpisodeSeedAgentOutput> => {
  if (!hasModelApiKey()) {
    throw new Error("第1話seed生成に失敗しました。利用可能なAIモデルがありません。");
  }

  const prompt = `
## シリーズ情報
- title: ${input.title}
- genre/tone: ${input.genre} / ${input.tone}
- premise: ${input.premise}
- season_goal: ${input.season_goal}
- continuation_trigger: ${input.continuation_trigger || input.preference_sheet.continuation_needs.join(" / ")}

## checkpoint抜粋
${input.checkpoints
  .map((row) => `- #${row.checkpoint_no} ${row.title} | purpose=${row.purpose} | carry_over=${row.carry_over}`)
  .join("\n")}

## ユーザー意図
- emotional_rewards: ${input.preference_sheet.emotional_rewards.join(" / ")}
- desired_relationship_dynamics: ${input.preference_sheet.desired_relationship_dynamics.join(" / ")}

## TOMOSHIBI 制約
- 徒歩2〜4スポットの導入導線
- 具体スポット名は禁止、spot_roleで定義

seriesFirstEpisodeSeedAgentOutputSchema を満たす JSON のみ返してください。
`;

  const maxAttempts = 1;
  const timeoutMs = 60_000;
  const maxTokens = Math.max(
    400,
    Math.min(1500, Number.parseInt(clean(process.env.SERIES_FIRST_EPISODE_SEED_MAX_TOKENS) || "900", 10) || 900)
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await Promise.race([
        seriesFirstEpisodeSeedAgent.generate(prompt, {
          structuredOutput: { schema: seriesFirstEpisodeSeedAgentOutputSchema },
          modelSettings: {
            maxRetries: 0,
            maxOutputTokens: maxTokens,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${timeoutMs / 1000}秒タイムアウト`)), timeoutMs)
        ),
      ]);
      const normalized = normalizeSeedOutput(input, result.object);
      if (normalized) return normalized;
    } catch (error: any) {
      console.warn("[series-first-episode-seed-agent] attempt失敗:", error?.message ?? error);
    }
  }

  throw new Error("第1話seed生成に失敗しました。外部AIの生成結果を取得できませんでした。");
};

export const evaluateFirstEpisodeSeed = async (
  input: SeriesFirstEpisodeSeedJudgeInput
): Promise<SeriesFirstEpisodeSeedJudgeOutput> => {
  if (!hasModelApiKey()) {
    throw new Error("第1話seed評価に失敗しました。利用可能なAIモデルがありません。");
  }

  const prompt = `
## first_episode_seed
- title: ${input.first_episode_seed.title}
- objective: ${input.first_episode_seed.objective}
- opening_scene: ${input.first_episode_seed.opening_scene}
- route_style: ${input.first_episode_seed.route_style}
- completion_condition: ${input.first_episode_seed.completion_condition}
- carry_over_hint: ${input.first_episode_seed.carry_over_hint}
- spot_requirements_count: ${input.first_episode_seed.spot_requirements.length}

## 評価基準
- emotional rewards: ${input.preference_sheet.emotional_rewards.join(" / ")}
- desired relationship dynamics: ${input.preference_sheet.desired_relationship_dynamics.join(" / ")}
- continuation needs: ${input.preference_sheet.continuation_needs.join(" / ")}
- continuation trigger: ${input.continuation_trigger || "未指定"}

seriesFirstEpisodeSeedJudgeOutputSchema を満たす JSON のみ返してください。
`;

  const timeoutMs = 35_000;
  const maxTokens = Math.max(
    200,
    Math.min(900, Number.parseInt(clean(process.env.SERIES_FIRST_EPISODE_SEED_JUDGE_MAX_TOKENS) || "500", 10) || 500)
  );
  try {
    const result = await Promise.race([
      seriesFirstEpisodeSeedJudgeAgent.generate(prompt, {
        structuredOutput: { schema: seriesFirstEpisodeSeedJudgeOutputSchema },
        modelSettings: {
          maxRetries: 0,
          maxOutputTokens: maxTokens,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${timeoutMs / 1000}秒タイムアウト`)), timeoutMs)
      ),
    ]);

    const parsed = seriesFirstEpisodeSeedJudgeOutputSchema.safeParse(result.object);
    if (parsed.success) return parsed.data;
    throw new Error("第1話seed評価の構造化出力が不正です。");
  } catch {
    throw new Error("第1話seed評価に失敗しました。外部AIの生成結果を取得できませんでした。");
  }
};
