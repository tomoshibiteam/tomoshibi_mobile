import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SERIES_CONSISTENCY_MODEL } from "../modelConfig";
import {
  seriesCharacterSchema,
  seriesCheckpointSchema,
  seriesContinuitySchema,
  seriesEpisodeSeedSchema,
  seriesMysteryProfileSchema,
  seriesRecentGenerationContextSchema,
} from "../../schemas/series";

export const seriesConsistencyAgentInputSchema = z.object({
  title: z.string(),
  overview: z.string(),
  premise: z.string(),
  season_goal: z.string(),
  ai_rule_points: z.array(z.string()).min(3).max(12),
  characters: z.array(seriesCharacterSchema).min(2).max(8),
  checkpoints: z.array(seriesCheckpointSchema).length(3),
  first_episode_seed: seriesEpisodeSeedSchema,
  mystery_profile: seriesMysteryProfileSchema.optional(),
  recent_generation_context: seriesRecentGenerationContextSchema.optional(),
});

export const seriesConsistencyAgentOutputSchema = z.object({
  overview_refined: z.string(),
  ai_rule_points: z.array(z.string()).min(4).max(12),
  continuity: seriesContinuitySchema,
  warnings: z.array(z.string()).max(10).optional(),
});

const lightSeriesContinuitySchema = z.object({
  global_mystery: z.string().optional(),
  mid_season_twist: z.string().optional(),
  finale_payoff: z.string().optional(),
  invariant_rules: z.array(z.string()).optional(),
  episode_link_policy: z.array(z.string()).optional(),
});

const lightSeriesConsistencyAgentOutputSchema = z.object({
  overview_refined: z.string().optional(),
  ai_rule_points: z.array(z.string()).optional(),
  continuity: lightSeriesContinuitySchema.optional(),
  warnings: z.array(z.string()).optional(),
});

export type SeriesConsistencyAgentInput = z.infer<typeof seriesConsistencyAgentInputSchema>;
export type SeriesConsistencyAgentOutput = z.infer<typeof seriesConsistencyAgentOutputSchema>;

const SERIES_CONSISTENCY_AGENT_INSTRUCTIONS = `
あなたはシリーズ構成の整合監督です。
出力済みのシリーズ設計をチェックし、後続エピソード生成で破綻しない運用規則へ整えてください。
単なる整合性監督ではなく、ジャンル契約監督・ミステリー構造監督・類型重複監督として振る舞ってください。

## 重点チェック
- キャラクターの弧（arc_start -> arc_end）が checkpoints に反映されているか
- 各 checkpoint.carry_over が連結しているか
- シーズン目標への収束導線があるか
- first_episode_seed がシリーズ導入として機能するか
- first_episode_seed.spot_requirements が「具体地名ではなく役割仕様」になっているか
- 全体が現実因果で回収可能か
- 超常依存・偶然依存・説明不足依存・ご都合主義依存がないか
- checkpoints が観光イベント列ではなく事件理解更新列になっているか
- 固定キャラが推理を奪いすぎていないか
- first_episode_seed が「何も起きない導入」で終わっていないか
- シリーズ大謎と各話局所事件が接続しているか
- 少なくとも3軸以上で直近生成との差分があるか
- 現実の外出周遊として成立するか
- 単一屋内完結や非現実的な移動に逸脱していないか

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
const SERIES_META_OUTPUT_PATTERN =
  /(現実拡張型|外出周遊|周遊ミステリー|シリーズ型ミステリー|スポット|2〜4|移動手段|徒歩|公共交通|自転車|ロープウェイ|フェリー|その土地|その地域|各島|島々|離島ごと|島ごと|15〜45分|15〜30分)/;
const LOCATION_LOCK_OUTPUT_PATTERN = /(各島|島々|離島ごと|島ごと)/;

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

const formatRecentContext = (
  recent?: z.infer<typeof seriesRecentGenerationContextSchema>
) => {
  const value = recent || undefined;
  if (!value) return "なし";
  const sections = [
    ["recent_titles", value.recent_titles],
    ["recent_case_motifs", value.recent_case_motifs],
    ["recent_character_archetypes", value.recent_character_archetypes],
    ["recent_visual_motifs", value.recent_visual_motifs],
    ["recent_first_episode_patterns", value.recent_first_episode_patterns],
    ["recent_environment_patterns", value.recent_environment_patterns],
  ] as const;
  const lines = sections
    .map(([label, items]) => {
      const joined = dedupe(items || []).join(" / ");
      return joined ? `- ${label}: ${joined}` : "";
    })
    .filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : "なし";
};

const MANDATORY_SERIES_AI_RULES = [
  "真相は現実因果で回収し、超常を解決の主因にしない。",
  "各話の局所事件は人間サイズに保ち、シリーズ大謎へ少しずつ接続する。",
  "固定キャラクターが推理を代行しすぎず、観察と判断の余白を残す。",
  "各話で新しい手掛かりか認識更新を最低1つ追加する。",
];

const MANDATORY_REALWORLD_INVARIANT_RULES = [
  "舞台は現実の外出先として成立する環境に限定する。",
  "各話で最低2スポット以上の現実的な移動を行う。",
  "屋内のみで完結する構成を採用しない。",
];

const MANDATORY_REALWORLD_EPISODE_LINK_POLICY = [
  "次回冒頭で前話の未解決情報か到達地点を参照する。",
  "各話の終わりに次回で確認すべき相手・場所・記録のいずれかを明示する。",
  "シリーズ進行に合わせて外出周遊の行き先と検証対象を段階的に更新する。",
];

const withMandatory = (base: string[], mandatory: string[], limit = 12) =>
  dedupe([...mandatory, ...base]).slice(0, limit);

const shouldReplaceSeriesText = (value?: string) => {
  const normalized = clean(value);
  if (!normalized) return true;
  return SERIES_META_OUTPUT_PATTERN.test(normalized) || LOCATION_LOCK_OUTPUT_PATTERN.test(normalized);
};

const cleanBounded = (value: string | undefined, maxChars: number) => {
  const normalized = clean(value);
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trimEnd()}…`;
};

const pickFirstSafeText = (...candidates: Array<string | undefined>) => {
  for (const candidate of candidates) {
    const normalized = clean(candidate);
    if (!normalized) continue;
    if (shouldReplaceSeriesText(normalized)) continue;
    return normalized;
  }
  return "";
};

const buildFallbackOutput = (input: SeriesConsistencyAgentInput): SeriesConsistencyAgentOutput => {
  const phase2 = input.checkpoints.find((checkpoint) => checkpoint.checkpoint_no === 2);
  const phase3 = input.checkpoints.find((checkpoint) => checkpoint.checkpoint_no === 3);

  const globalMystery = pickFirstSafeText(
    input.mystery_profile?.case_core,
    phase2?.remaining_unknown,
    input.season_goal,
    input.premise
  );
  const midSeasonTwist = pickFirstSafeText(
    phase2?.knowledge_gain,
    phase2?.carry_over,
    input.mystery_profile?.truth_nature,
    input.overview
  );
  const finalePayoff = pickFirstSafeText(
    phase3?.purpose,
    phase3?.unlock_hint,
    input.season_goal,
    input.first_episode_seed.carry_over_hint
  );

  const fallbackOverviewBase = pickFirstSafeText(input.overview, input.premise);
  const fallbackGoal = pickFirstSafeText(input.season_goal);
  const overviewRefined = cleanBounded(
    [
      fallbackOverviewBase || "断片的な事件の再検証を重ねるほど、最初の説明が崩れていく構造を保つ。",
      fallbackGoal
        ? `終盤では「${fallbackGoal}」へ自然に収束する導線を明示する。`
        : "終盤では未解決要素の因果を一本化し、納得感のある収束を作る。",
    ].join(" "),
    320
  );

  return {
    overview_refined: overviewRefined,
    ai_rule_points: withMandatory(
      (input.ai_rule_points || []).filter((rule) => !shouldReplaceSeriesText(rule)),
      MANDATORY_SERIES_AI_RULES,
      12
    ),
    continuity: {
      global_mystery: cleanBounded(globalMystery, 220) || "複数の出来事を同時に説明できる単一因果を追跡する。",
      mid_season_twist:
        cleanBounded(midSeasonTwist, 220) || "中盤で主要仮説を反転させる証拠を提示し、再解釈を強制する。",
      finale_payoff:
        cleanBounded(finalePayoff, 220) || "結末で主要矛盾を回収し、シリーズ目標の到達条件を満たす。",
      invariant_rules: withMandatory([], MANDATORY_REALWORLD_INVARIANT_RULES, 12),
      episode_link_policy: withMandatory([], MANDATORY_REALWORLD_EPISODE_LINK_POLICY, 12),
    },
    warnings: [],
  };
};

const normalizeOutput = (
  input: SeriesConsistencyAgentInput,
  raw: unknown
): SeriesConsistencyAgentOutput | null => {
  const fallback = buildFallbackOutput(input);
  const parsed = lightSeriesConsistencyAgentOutputSchema.safeParse(raw);
  const output = parsed.success ? parsed.data : {};
  const continuity = output.continuity || {};
  const fallbackWarnings: string[] = [];
  if (!parsed.success) fallbackWarnings.push("series_consistency_light_parse_failed");
  if (parsed.success && (!output.continuity || !output.ai_rule_points || !output.overview_refined)) {
    fallbackWarnings.push("series_consistency_partial_output_fallback_applied");
  }

  const aiRulePoints = withMandatory(
    (output.ai_rule_points || []).filter((rule) => !shouldReplaceSeriesText(rule)),
    MANDATORY_SERIES_AI_RULES,
    12
  );
  const invariantRules = withMandatory(
    (continuity.invariant_rules || []).filter((rule) => !shouldReplaceSeriesText(rule)),
    MANDATORY_REALWORLD_INVARIANT_RULES,
    12
  );
  const episodeLinkPolicy = withMandatory(
    (continuity.episode_link_policy || []).filter((rule) => !shouldReplaceSeriesText(rule)),
    MANDATORY_REALWORLD_EPISODE_LINK_POLICY,
    12
  );

  const overviewRefinedCandidate = cleanBounded(output.overview_refined, 320);
  const overviewRefined =
    overviewRefinedCandidate && !shouldReplaceSeriesText(overviewRefinedCandidate)
      ? overviewRefinedCandidate
      : fallback.overview_refined;

  const globalMysteryCandidate = cleanBounded(continuity.global_mystery, 220);
  const globalMystery =
    globalMysteryCandidate && !shouldReplaceSeriesText(globalMysteryCandidate)
      ? globalMysteryCandidate
      : fallback.continuity.global_mystery;

  const midSeasonTwistCandidate = cleanBounded(continuity.mid_season_twist, 220);
  const midSeasonTwist =
    midSeasonTwistCandidate && !shouldReplaceSeriesText(midSeasonTwistCandidate)
      ? midSeasonTwistCandidate
      : fallback.continuity.mid_season_twist;

  const finalePayoffCandidate = cleanBounded(continuity.finale_payoff, 220);
  const finalePayoff =
    finalePayoffCandidate && !shouldReplaceSeriesText(finalePayoffCandidate)
      ? finalePayoffCandidate
      : fallback.continuity.finale_payoff;

  const warnings = dedupe([...(output.warnings || []), ...fallbackWarnings]).slice(0, 10);

  return {
    overview_refined: overviewRefined,
    ai_rule_points: aiRulePoints.length > 0 ? aiRulePoints : fallback.ai_rule_points,
    continuity: {
      global_mystery: globalMystery,
      mid_season_twist: midSeasonTwist,
      finale_payoff: finalePayoff,
      invariant_rules:
        invariantRules.length > 0 ? invariantRules : fallback.continuity.invariant_rules,
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
    throw new Error("整合性チェックに失敗しました。利用可能なAIモデルがありません。");
  }

  const prompt = `
## シリーズ概要
- タイトル: ${input.title}
- 概要: ${input.overview}
- 前提: ${input.premise}
- シーズン目標: ${input.season_goal}

## Mystery profile
- case_core: ${clean(input.mystery_profile?.case_core) || "未指定"}
- investigation_style: ${clean(input.mystery_profile?.investigation_style) || "未指定"}
- emotional_tone: ${clean(input.mystery_profile?.emotional_tone) || "未指定"}
- duo_dynamic: ${clean(input.mystery_profile?.duo_dynamic) || "未指定"}
- truth_nature: ${clean(input.mystery_profile?.truth_nature) || "未指定"}
- visual_language: ${clean(input.mystery_profile?.visual_language) || "未指定"}
- environment_layer: ${clean(input.mystery_profile?.environment_layer) || "未指定"}
- differentiation_axes: ${dedupe(input.mystery_profile?.differentiation_axes || []).join(" / ") || "未指定"}
- banned_templates_avoided: ${dedupe(input.mystery_profile?.banned_templates_avoided || []).join(" / ") || "未指定"}

## Variation reference
${formatRecentContext(input.recent_generation_context)}

## 既存運用ルール
${input.ai_rule_points.map((rule) => `- ${rule}`).join("\n")}

## キャラクター
${input.characters
  .map(
    (character) =>
      `- ${character.name}: ${character.arc_start} -> ${character.arc_end} / investigation_function=${character.investigation_function || "未指定"} / truth_proximity=${character.truth_proximity || "未指定"} / hypothesis_pressure=${character.hypothesis_pressure || "未指定"}`
  )
  .join("\n")}

## チェックポイント
${input.checkpoints
  .map(
    (checkpoint) =>
      `- #${checkpoint.checkpoint_no} ${checkpoint.title} / unlock=${checkpoint.unlock_hint} / carry=${checkpoint.carry_over} / gain=${checkpoint.knowledge_gain || "未指定"} / unknown=${checkpoint.remaining_unknown || "未指定"} / next_move_reason=${checkpoint.next_move_reason || "未指定"}`
  )
  .join("\n")}

## 初回エピソード seed
- タイトル: ${input.first_episode_seed.title}
- 目的: ${input.first_episode_seed.objective}
- 所要時間: ${input.first_episode_seed.expected_duration_minutes}分
- movement_style: ${clean(input.first_episode_seed.movement_style) || clean(input.first_episode_seed.route_style) || "未指定"}
- 次回への余韻: ${input.first_episode_seed.carry_over_hint}
- 要求スポット数: ${input.first_episode_seed.spot_requirements.length}
- inciting_incident: ${clean(input.first_episode_seed.inciting_incident) || "未指定"}
- first_false_assumption: ${clean(input.first_episode_seed.first_false_assumption) || "未指定"}
- first_reversal: ${clean(input.first_episode_seed.first_reversal) || "未指定"}
- unresolved_hook: ${clean(input.first_episode_seed.unresolved_hook) || "未指定"}

## TOMOSHIBI 制約（最優先）
- 本シリーズは現実拡張型・外出周遊ミステリーに限定する。
- 真相は現実因果で回収し、超常は雰囲気演出までに留める。
- 単一屋内完結は禁止し、各話を複数スポットの現実的な周遊として成立させる。
- 移動手段は徒歩固定にせず、その地域で自然な移動手段を許容する。
- checkpoint は観光イベント列ではなく、事件理解が更新される認識更新列として扱う。
- first_episode_seed は「何も起きない導入」を禁止し、inciting_incident / first_false_assumption / first_reversal / unresolved_hook を維持する。
- recent outputs と比較して、case_core / duo_dynamic / truth_nature / environment_layer / visual_language / first_episode_pattern のうち少なくとも3軸で差分を確保する。
- banned template に寄りそうなら、ai_rule_points / invariant_rules / episode_link_policy に差分強制ルールを補ってよい。
- ただし上記は内部設計制約であり、overview_refined と ai_rule_points にそのまま書いてはいけない。
- overview_refined / ai_rule_points に、現実拡張型、外出周遊、周遊ミステリー、スポット数、2〜4、移動手段、徒歩、公共交通、その土地、各島などの語を出してはいけない。
- overview_refined はシリーズ紹介として読める抽象度を保ち、特定地形や導線に固定しない。

## 出力フォーマット（必須）
- 可能なら次の3キーを返す:
  - overview_refined
  - ai_rule_points
  - continuity
- continuity は次の3キーを優先して返す:
  - global_mystery
  - mid_season_twist
  - finale_payoff
- 余力があれば continuity.invariant_rules / continuity.episode_link_policy / warnings を追加してよい。
- 各文字列は短文1つで、同文反復や過剰な列挙を禁止する。

seriesConsistencyAgentOutputSchema を満たす JSON を返してください。
`;

  const maxAttempts = 1;
  const timeoutMs = Math.max(
    120_000,
    Number.parseInt(clean(process.env.SERIES_CONSISTENCY_TIMEOUT_MS) || "120000", 10) || 120_000
  );
  const timeoutGrowth = Math.max(
    1,
    Number.parseFloat(clean(process.env.SERIES_CONSISTENCY_TIMEOUT_GROWTH) || "1.15") || 1.15
  );
  const maxTokens = Math.max(
    700,
    Math.min(1800, Number.parseInt(clean(process.env.SERIES_CONSISTENCY_MAX_TOKENS) || "1100", 10) || 1100)
  );
  const logPrefix = "[series-consistency-agent]";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const abortController = new AbortController();
    let activeTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const attemptTimeoutMs = Math.round(timeoutMs * Math.pow(timeoutGrowth, Math.max(0, attempt - 1)));
    try {
      activeTimeoutHandle = setTimeout(() => abortController.abort("series_consistency_timeout"), attemptTimeoutMs);
      console.log(
        `${logPrefix} attempt ${attempt}/${maxAttempts} — LLM呼び出し中 (${Math.round(
          attemptTimeoutMs / 1000
        )}秒でタイムアウト)`
      );
      const result = await seriesConsistencyAgent.generate(prompt, {
        structuredOutput: { schema: lightSeriesConsistencyAgentOutputSchema },
        modelSettings: {
          maxRetries: 0,
          maxOutputTokens: maxTokens,
        },
        abortSignal: abortController.signal,
      });
      console.log(`${logPrefix} attempt ${attempt} — LLM応答受信`);
      const normalized = normalizeOutput(input, result.object);
      if (normalized) return normalized;
      console.warn(`${logPrefix} attempt ${attempt} — パース失敗`);
    } catch (error: any) {
      if (abortController.signal.aborted) {
        console.warn(
          `${logPrefix} attempt ${attempt} 失敗: 整合性チェックがタイムアウトしました（${attemptTimeoutMs}ms）`
        );
        console.warn(`${logPrefix} タイムアウト後の追加課金を避けるため、追加リトライしません`);
        break;
      }
      console.warn(`${logPrefix} attempt ${attempt} 失敗:`, error?.message ?? error);
    } finally {
      if (activeTimeoutHandle) clearTimeout(activeTimeoutHandle);
    }
  }

  console.error(`${logPrefix} 全試行失敗`);
  throw new Error("整合性チェックに失敗しました。外部AIの生成結果を取得できませんでした。");
};
