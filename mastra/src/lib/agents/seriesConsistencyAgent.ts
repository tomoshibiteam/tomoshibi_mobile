import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SERIES_CONSISTENCY_MODEL } from "../modelConfig";
import {
  seriesCharacterSchema,
  seriesCheckpointSchema,
  seriesContinuitySchema,
  seriesEpisodeSeedSchema,
} from "../../schemas/series";

export const seriesConsistencyAgentInputSchema = z.object({
  title: z.string(),
  overview: z.string(),
  premise: z.string(),
  season_goal: z.string(),
  ai_rule_points: z.array(z.string()).min(3).max(12),
  characters: z.array(seriesCharacterSchema).min(3).max(8),
  checkpoints: z.array(seriesCheckpointSchema).min(4).max(8),
  first_episode_seed: seriesEpisodeSeedSchema,
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
- キャラクターの弧（arc_start -> arc_end）が checkpoints に反映されているか
- 各 checkpoint.carry_over が連結しているか
- シーズン目標への収束導線があるか
- first_episode_seed がシリーズ導入として機能するか
- first_episode_seed.spot_requirements が「具体地名ではなく役割仕様」になっているか
- 街歩き（徒歩で複数スポットを巡る）前提が継続的に守られているか
- 単一屋内完結や街歩き不能な舞台へ逸脱していないか

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

const MANDATORY_WALK_AI_RULES = [
  "各エピソードは徒歩で2〜4スポットを巡る地上の街歩き導線を維持する。",
  "単一屋内拠点だけで完結させず、街路や公共空間を含む移動を必ず入れる。",
  "空中都市・宇宙・海底・閉鎖施設内のみなど街歩き不能な舞台へ逸脱しない。",
];

const MANDATORY_WALK_INVARIANT_RULES = [
  "舞台は地上で歩行可能な都市・街区に限定する。",
  "各話で最低2スポット以上の徒歩移動を行う。",
  "屋内のみで完結する構成を採用しない。",
];

const MANDATORY_WALK_EPISODE_LINK_POLICY = [
  "次回冒頭で前話の移動経路または到達地点を参照する。",
  "各話の終わりに次回で向かう街区・スポットを明示する。",
  "シリーズ進行に合わせて徒歩ルートを段階的に拡張する。",
];

const withMandatory = (base: string[], mandatory: string[], limit = 12) =>
  dedupe([...mandatory, ...base]).slice(0, limit);

const buildFallbackContinuity = (input: SeriesConsistencyAgentInput) => {
  const lastCheckpoint = input.checkpoints[input.checkpoints.length - 1];
  const midCheckpoint = input.checkpoints[Math.floor((input.checkpoints.length - 1) / 2)];
  const lead = input.characters[0];
  return {
    global_mystery: `${input.season_goal}を阻む真因は何か。`,
    mid_season_twist: midCheckpoint
      ? `${midCheckpoint.title}で、前提が覆る新事実を提示する。`
      : "中盤で同盟関係が崩れる。",
    finale_payoff: lastCheckpoint
      ? `${lastCheckpoint.title}で主要伏線を回収し、${lead?.name || "主人公"}の選択を結論にする。`
      : "最終話で主要伏線を回収する。",
    invariant_rules: [
      "各話の冒頭で前話の結果を最低1つ継承する。",
      "キャラクターの口調と価値観の急変は理由付きでのみ許可する。",
      "伏線は未回収のまま3話以上放置しない。",
    ],
    episode_link_policy: [
      "carry_over の要素を次回エピソード冒頭で明示的に参照する。",
      "チェックポイントで示した目的の達成条件を各回で1つずつ更新する。",
      "最終チェックポイントへ向けて対立軸を段階的に絞り込む。",
    ],
  };
};

const buildFallbackOutput = (input: SeriesConsistencyAgentInput): SeriesConsistencyAgentOutput => {
  const continuity = buildFallbackContinuity(input);
  return {
    overview_refined: `${input.overview} ${input.premise} を軸に、各回の街歩き体験を積み重ねて${input.season_goal}へ収束する。`,
    ai_rule_points: withMandatory(
      [
      ...input.ai_rule_points,
      "各エピソードで新規情報を1つ追加し、既存情報を1つ更新する。",
      "主要人物の感情変化は行動で示し、説明のみで済ませない。",
      "エピソード末尾は次回の行動目標を明文化して終える。",
      "1回の体験は15〜30分で完結する粒度を維持する。",
      ],
      MANDATORY_WALK_AI_RULES,
      12
    ),
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

  const aiRulePoints = withMandatory(output.ai_rule_points || [], MANDATORY_WALK_AI_RULES, 12);
  const invariantRules = withMandatory(output.continuity.invariant_rules || [], MANDATORY_WALK_INVARIANT_RULES, 12);
  const episodeLinkPolicy = withMandatory(
    output.continuity.episode_link_policy || [],
    MANDATORY_WALK_EPISODE_LINK_POLICY,
    12
  );
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

## チェックポイント
${input.checkpoints
  .map(
    (checkpoint) =>
      `- #${checkpoint.checkpoint_no} ${checkpoint.title} / unlock=${checkpoint.unlock_hint} / carry=${checkpoint.carry_over}`
  )
  .join("\n")}

## 初回エピソード seed
- タイトル: ${input.first_episode_seed.title}
- 目的: ${input.first_episode_seed.objective}
- 所要時間: ${input.first_episode_seed.expected_duration_minutes}分
- 次回への余韻: ${input.first_episode_seed.carry_over_hint}
- 要求スポット数: ${input.first_episode_seed.spot_requirements.length}

## TOMOSHIBI 制約（最優先）
- 街歩き（徒歩で2〜4スポット移動）前提を運用ルールに必ず明記する。
- first_episode_seed は具体スポット名ではなく role 仕様（spot_requirements）である前提を維持する。
- 単一屋内完結・非歩行舞台への逸脱を抑止する invariant/policy を含める。

seriesConsistencyAgentOutputSchema を満たす JSON を返してください。
`;

  const maxAttempts = 2;
  const timeoutMs = 60_000;
  const logPrefix = "[series-consistency-agent]";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.log(`${logPrefix} attempt ${attempt}/${maxAttempts} — LLM呼び出し中`);
      const result = await Promise.race([
        seriesConsistencyAgent.generate(prompt, {
          structuredOutput: { schema: seriesConsistencyAgentOutputSchema },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${timeoutMs / 1000}秒タイムアウト`)), timeoutMs)),
      ]);
      console.log(`${logPrefix} attempt ${attempt} — LLM応答受信`);
      const normalized = normalizeOutput(input, result.object);
      if (normalized) return normalized;
      console.warn(`${logPrefix} attempt ${attempt} — パース失敗`);
    } catch (error: any) {
      console.warn(`${logPrefix} attempt ${attempt} 失敗:`, error?.message ?? error);
    }
  }

  console.error(`${logPrefix} 全試行失敗`);
  throw new Error("一貫性チェックに失敗しました。AIモデルからの応答が得られませんでした。再度お試しください。");
};
