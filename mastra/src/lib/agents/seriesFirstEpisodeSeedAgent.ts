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
  characters: z.array(seriesCharacterSchema).min(3).max(8),
  checkpoints: z.array(seriesCheckpointSchema).min(4).max(8),
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

const hashText = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
};

const buildFallbackSeed = (input: SeriesFirstEpisodeSeedAgentInput): z.infer<typeof seriesEpisodeSeedSchema> => {
  const firstCheckpoint = input.checkpoints[0];
  const trigger = clean(input.continuation_trigger) || input.preference_sheet.continuation_needs[0] || "次回で答え合わせしたくなる余韻";
  const emotion = input.preference_sheet.emotional_rewards[0] || "余韻";
  const relation = input.preference_sheet.desired_relationship_dynamics[0] || "相棒との信頼形成";
  const atmosphere = input.preference_sheet.atmosphere_keywords[0] || clean(input.world.setting) || "街区";
  const checkpointTitle = clean(firstCheckpoint?.title) || "導入";
  const signature = [
    input.title,
    input.genre,
    input.tone,
    input.premise,
    input.season_goal,
    checkpointTitle,
    trigger,
    relation,
  ]
    .map((row) => clean(row))
    .filter(Boolean)
    .join("|");
  const toneHash = hashText(signature);
  const pacing = input.preference_sheet.pacing_preference;
  const expectedDuration =
    pacing === "slow_burn" ? 24 : pacing === "fast_hook" ? 16 : 20;
  const routeStyle =
    pacing === "slow_burn"
      ? "徒歩中心で寄り道を許容する観察周遊"
      : pacing === "fast_hook"
        ? "徒歩中心で短距離テンポ周遊"
        : "徒歩中心の周遊";
  const seedTag = (toneHash % 71) + 10;
  const requirementCount = toneHash % 3 === 0 ? 4 : 3;
  const spotSeedRoles = [
    `${atmosphere}の空気を掴む導入スポット`,
    `${relation}が揺れ始める対話スポット`,
    `${emotion}を回収しつつ問いを残す余韻スポット`,
    `${trigger}の実在を示す決定打スポット`,
  ];
  const tourismValues = ["地域導入", "文化体験", "景観", "物語回収"];

  return {
    title: `第1話: ${checkpointTitle}の端緒${seedTag}`,
    objective:
      clean(firstCheckpoint?.purpose) ||
      `${relation}を動かす最初の選択を行い、${trigger}の手前まで到達する。`,
    opening_scene: `${clean(input.world.setting) || "街区"}を歩き始め、${emotion}に繋がる違和感を1つ発見する。`,
    expected_duration_minutes: expectedDuration,
    route_style: routeStyle,
    completion_condition: `${requirementCount}スポットを巡り、${trigger}を次話へ持ち越す明確な問いを残す。`,
    carry_over_hint: trigger,
    spot_requirements: Array.from({ length: requirementCount }, (_, index) => ({
      requirement_id: `req_${index + 1}`,
      scene_role:
        index === 0
          ? "起"
          : index === requirementCount - 1
            ? "結"
            : "承",
      spot_role: spotSeedRoles[index] || `${trigger}の手がかりが残るスポット`,
      required_attributes:
        index === 0
          ? ["徒歩導線の起点", "地域らしさが見える"]
          : index === requirementCount - 1
            ? ["締めに向く景観", "安全にアクセス可能"]
            : ["滞在余地", "会話しやすさ"],
      visit_constraints:
        index === 0
          ? ["日中訪問を基本", "単一屋内完結を避ける"]
          : index === requirementCount - 1
            ? ["徒歩で戻れる範囲", "夜間の安全導線を確保"]
            : ["徒歩20分以内", "公共アクセス可能"],
      tourism_value_type: tourismValues[index] || "地域体験",
    })),
  };
};

const normalizeSeedOutput = (
  input: SeriesFirstEpisodeSeedAgentInput,
  raw: unknown
): SeriesFirstEpisodeSeedAgentOutput | null => {
  const parsed = seriesFirstEpisodeSeedAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const fallback = buildFallbackSeed(input);
  const seed = parsed.data.first_episode_seed;

  const safeDuration = Math.max(
    10,
    Math.min(45, Number.parseInt(String(seed.expected_duration_minutes), 10) || fallback.expected_duration_minutes)
  );

  const requirements = (Array.isArray(seed.spot_requirements) ? seed.spot_requirements : [])
    .slice(0, 4)
    .map((row, index) => {
      const fallbackRow = fallback.spot_requirements[Math.min(index, fallback.spot_requirements.length - 1)];
      return {
        requirement_id: clean(row.requirement_id) || `req_${index + 1}`,
        scene_role: row.scene_role,
        spot_role: clean(row.spot_role) || fallbackRow.spot_role,
        required_attributes: dedupe(row.required_attributes || []).slice(0, 8),
        visit_constraints: dedupe(row.visit_constraints || []).slice(0, 8),
        tourism_value_type: clean(row.tourism_value_type) || fallbackRow.tourism_value_type,
      };
    })
    .filter((row) => clean(row.spot_role).length > 0);

  return {
    first_episode_seed: {
      title: clean(seed.title) || fallback.title,
      objective: clean(seed.objective) || fallback.objective,
      opening_scene: clean(seed.opening_scene) || fallback.opening_scene,
      expected_duration_minutes: safeDuration,
      route_style: /徒歩|街歩き|周遊|散策/.test(clean(seed.route_style))
        ? clean(seed.route_style)
        : fallback.route_style,
      completion_condition: clean(seed.completion_condition) || fallback.completion_condition,
      carry_over_hint: clean(seed.carry_over_hint) || fallback.carry_over_hint,
      spot_requirements: requirements.length >= 2 ? requirements : fallback.spot_requirements,
    },
  };
};

const fallbackEvaluation = (input: SeriesFirstEpisodeSeedJudgeInput) => {
  const seed = input.first_episode_seed;
  const walkability = /徒歩|街歩き|周遊|散策/.test(clean(seed.route_style)) ? 0.9 : 0.55;
  const continuation = clean(seed.carry_over_hint).length >= 10 ? 0.8 : 0.55;
  const intent = input.preference_sheet.emotional_rewards.some((reward) =>
    clean(seed.objective + seed.opening_scene + seed.completion_condition).includes(clean(reward))
  )
    ? 0.82
    : 0.66;
  const unique = seed.spot_requirements.length >= 3 ? 0.72 : 0.62;
  const pass = walkability >= 0.7 && continuation >= 0.65 && intent >= 0.65;

  return {
    evaluation: {
      intent_fit: intent,
      walkability_fit: walkability,
      continuation_hook_fit: continuation,
      uniqueness_fit: unique,
      pass,
      reasons: pass
        ? ["導入seedとして成立"]
        : [
            walkability < 0.7 ? "walkability不足" : "",
            continuation < 0.65 ? "continuation hook不足" : "",
            intent < 0.65 ? "intent fit不足" : "",
          ].filter(Boolean),
    },
  } as SeriesFirstEpisodeSeedJudgeOutput;
};

export const generateFirstEpisodeSeed = async (
  input: SeriesFirstEpisodeSeedAgentInput
): Promise<SeriesFirstEpisodeSeedAgentOutput> => {
  if (!hasModelApiKey()) {
    console.warn("[series-first-episode-seed-agent] API key not found, fallback first episode seed used");
    return { first_episode_seed: buildFallbackSeed(input) };
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

  const maxAttempts = 2;
  const timeoutMs = 60_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await Promise.race([
        seriesFirstEpisodeSeedAgent.generate(prompt, {
          structuredOutput: { schema: seriesFirstEpisodeSeedAgentOutputSchema },
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

  console.warn("[series-first-episode-seed-agent] 全試行失敗 — fallback first episode seed使用");
  return { first_episode_seed: buildFallbackSeed(input) };
};

export const evaluateFirstEpisodeSeed = async (
  input: SeriesFirstEpisodeSeedJudgeInput
): Promise<SeriesFirstEpisodeSeedJudgeOutput> => {
  if (!hasModelApiKey()) {
    console.warn("[series-first-episode-seed-agent] API key not found, fallback first episode seed eval used");
    return fallbackEvaluation(input);
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
  try {
    const result = await Promise.race([
      seriesFirstEpisodeSeedJudgeAgent.generate(prompt, {
        structuredOutput: { schema: seriesFirstEpisodeSeedJudgeOutputSchema },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${timeoutMs / 1000}秒タイムアウト`)), timeoutMs)
      ),
    ]);

    const parsed = seriesFirstEpisodeSeedJudgeOutputSchema.safeParse(result.object);
    if (parsed.success) return parsed.data;
  } catch {
    // fallback below
  }

  return fallbackEvaluation(input);
};
