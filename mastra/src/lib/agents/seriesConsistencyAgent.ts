import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SERIES_CONSISTENCY_MODEL } from "../modelConfig";
import {
  seriesCharacterSchema,
  seriesContinuitySchema,
  seriesEpisodeBlueprintSchema,
} from "../../schemas/series";

export const seriesConsistencyAgentInputSchema = z.object({
  title: z.string(),
  overview: z.string(),
  premise: z.string(),
  season_goal: z.string(),
  ai_rule_points: z.array(z.string()).min(3).max(12),
  characters: z.array(seriesCharacterSchema).min(3).max(8),
  episode_blueprints: z.array(seriesEpisodeBlueprintSchema).min(3).max(24),
});

export const seriesConsistencyAgentOutputSchema = z.object({
  overview_refined: z.string(),
  ai_rule_points: z.array(z.string()).min(4).max(12),
  continuity: seriesContinuitySchema,
  warnings: z.array(z.string()).max(10).optional(),
});

export type SeriesConsistencyAgentInput = z.infer<typeof seriesConsistencyAgentInputSchema>;
export type SeriesConsistencyAgentOutput = z.infer<typeof seriesConsistencyAgentOutputSchema>;

const SERIES_CONSISTENCY_AGENT_INSTRUCTIONS = `
あなたはシリーズ構成の整合監督です。
出力済みのシリーズ設計をチェックし、後続エピソード生成で破綻しない運用規則へ整えてください。

## 重点チェック
- キャラクターの弧（arc_start -> arc_end）がエピソード計画に反映されているか
- 各話の required_setups / payoff_targets が連結しているか
- シーズン目標への収束導線があるか

## 出力方針
- overview_refined は 2〜4文で全体像を短く再定義
- ai_rule_points は運用で使える命令文にする
- continuity.invariant_rules は最低3つ
- continuity.episode_link_policy は最低3つ
`;

export const seriesConsistencyAgent = new Agent({
  id: "series-consistency-agent",
  name: "series-consistency-agent",
  model: MASTRA_SERIES_CONSISTENCY_MODEL,
  instructions: SERIES_CONSISTENCY_AGENT_INSTRUCTIONS,
});

const clean = (value?: string) => (value || "").replace(/\s+/g, " ").trim();

const hasModelApiKey = () =>
  Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );

const dedupe = (values: string[]) => {
  const seen = new Set<string>();
  return values
    .map((value) => clean(value))
    .filter((value) => {
      if (!value) return false;
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
};

const buildFallbackContinuity = (input: SeriesConsistencyAgentInput) => {
  const lastEpisode = input.episode_blueprints[input.episode_blueprints.length - 1];
  const midEpisode = input.episode_blueprints[Math.floor((input.episode_blueprints.length - 1) / 2)];
  const lead = input.characters[0];
  return {
    global_mystery: `${input.season_goal}を阻む真因は何か。`,
    mid_season_twist: midEpisode
      ? `${midEpisode.title}で、前提が覆る新事実を提示する。`
      : "中盤で同盟関係が崩れる。",
    finale_payoff: lastEpisode
      ? `${lastEpisode.title}で主要伏線を回収し、${lead?.name || "主人公"}の選択を結論にする。`
      : "最終話で主要伏線を回収する。",
    invariant_rules: [
      "各話の冒頭で前話の結果を最低1つ継承する。",
      "キャラクターの口調と価値観の急変は理由付きでのみ許可する。",
      "伏線は未回収のまま3話以上放置しない。",
    ],
    episode_link_policy: [
      "required_setups の要素を次話本文で明示的に参照する。",
      "payoff_targets は回収話を脚本内に注記する。",
      "最終話へ向けて対立軸を段階的に絞り込む。",
    ],
  };
};

const buildFallbackOutput = (input: SeriesConsistencyAgentInput): SeriesConsistencyAgentOutput => {
  const continuity = buildFallbackContinuity(input);
  return {
    overview_refined: `${input.overview} ${input.premise} を軸に、各話の連鎖で${input.season_goal}へ収束する。`,
    ai_rule_points: dedupe([
      ...input.ai_rule_points,
      "各話で新規情報を1つ追加し、既存情報を1つ更新する。",
      "主要人物の感情変化は行動で示し、説明のみで済ませない。",
      "エピソード末尾は次話の行動目標を明文化して終える。",
    ]).slice(0, 12),
    continuity,
    warnings: [],
  };
};

const normalizeOutput = (
  input: SeriesConsistencyAgentInput,
  raw: unknown
): SeriesConsistencyAgentOutput | null => {
  const parsed = seriesConsistencyAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const fallback = buildFallbackOutput(input);
  const output = parsed.data;

  const aiRulePoints = dedupe(output.ai_rule_points || []);
  const invariantRules = dedupe(output.continuity.invariant_rules || []);
  const episodeLinkPolicy = dedupe(output.continuity.episode_link_policy || []);
  const warnings = dedupe(output.warnings || []);

  return {
    overview_refined: clean(output.overview_refined) || fallback.overview_refined,
    ai_rule_points: aiRulePoints.length > 0 ? aiRulePoints : fallback.ai_rule_points,
    continuity: {
      global_mystery: clean(output.continuity.global_mystery) || fallback.continuity.global_mystery,
      mid_season_twist: clean(output.continuity.mid_season_twist) || fallback.continuity.mid_season_twist,
      finale_payoff: clean(output.continuity.finale_payoff) || fallback.continuity.finale_payoff,
      invariant_rules: invariantRules.length > 0 ? invariantRules : fallback.continuity.invariant_rules,
      episode_link_policy:
        episodeLinkPolicy.length > 0 ? episodeLinkPolicy : fallback.continuity.episode_link_policy,
    },
    warnings,
  };
};

export const generateSeriesConsistency = async (
  input: SeriesConsistencyAgentInput
): Promise<SeriesConsistencyAgentOutput> => {
  if (!hasModelApiKey()) {
    console.warn("[series-consistency-agent] API key not found, fallback consistency used");
    return buildFallbackOutput(input);
  }

  const prompt = `
## シリーズ概要
- タイトル: ${input.title}
- 概要: ${input.overview}
- 前提: ${input.premise}
- シーズン目標: ${input.season_goal}

## 既存運用ルール
${input.ai_rule_points.map((rule) => `- ${rule}`).join("\n")}

## キャラクター
${input.characters
  .map((character) => `- ${character.name}: ${character.arc_start} -> ${character.arc_end}`)
  .join("\n")}

## エピソード
${input.episode_blueprints
  .map(
    (episode) =>
      `- #${episode.episode_no} ${episode.title} / setup=${episode.required_setups.join(" | ")} / payoff=${episode.payoff_targets.join(" | ")}`
  )
  .join("\n")}

seriesConsistencyAgentOutputSchema を満たす JSON を返してください。
`;

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await seriesConsistencyAgent.generate(prompt, {
        structuredOutput: { schema: seriesConsistencyAgentOutputSchema },
      });
      const normalized = normalizeOutput(input, response.object);
      if (normalized) return normalized;
    } catch (error) {
      console.warn("[series-consistency-agent] generation failed", { attempt, error });
    }
  }

  console.warn("[series-consistency-agent] fallback consistency used");
  return buildFallbackOutput(input);
};
