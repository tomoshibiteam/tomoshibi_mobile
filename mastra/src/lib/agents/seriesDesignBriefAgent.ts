import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import {
  isMastraTextModelAvailable,
  MASTRA_SERIES_DESIGN_BRIEF_MODEL,
} from "../modelConfig";
import {
  seriesDeviceServiceDesignBriefSchema,
  seriesInterviewSchema,
} from "../../schemas/series";

export const seriesDesignBriefAgentInputSchema = z.object({
  interview: seriesInterviewSchema.optional(),
  prompt: z.string().optional(),
  language: z.string().default("ja"),
});

export const seriesDesignBriefAgentOutputSchema = seriesDeviceServiceDesignBriefSchema;
const seriesDesignBriefStrictFieldsSchema = z.object({
  experience_objective: z.string().min(1),
  service_value_hypothesis: z.string().min(1),
  target_user_context: z.string().min(1),
  usage_scene: z.string().min(1),
  emotional_outcome: z.string().min(1),
  tone_guardrail: z.string().min(1),
  role_design_direction: z.string().min(1),
  spatial_behavior_policy: z.string().min(1),
  ux_guidance_style: z.string().min(1),
});

export type SeriesDesignBriefAgentInput = z.infer<typeof seriesDesignBriefAgentInputSchema>;
export type SeriesDesignBriefAgentOutput = z.infer<typeof seriesDesignBriefAgentOutputSchema>;

const SERIES_DESIGN_BRIEF_AGENT_INSTRUCTIONS = `
あなたは TOMOSHIBI のシリーズ生成における
「デバイスサービスデザインブリーフ」専用エージェントです。

## 目的
- 後続ステップの自由度を残しながら、シリーズの生成方向を揃える
- 「事件ミステリーの面白さ」を体験主軸に据える
- 学習・導線理解・行動開始などの実用価値は、楽しさの過程で獲得される形にする

## 重要方針
- 固定テンプレ文を避ける
- emotional_outcome は、入力文脈に応じた感情表現を自分で組み立てる
- 「面白さ / ワクワク / ハラハラ」を毎回固定出力しない
- ただし、事件ミステリー体験としての感情推移は明確に書く
- 新入生向け/観光向け等の固有文脈がある場合は、その文脈を主役にして書く

## 分離ルール（必須）
- experience_objective: 体験後にユーザーがどういう状態・感情になるかを書く（目的）
- service_value_hypothesis: どの設計要素が、なぜ目的を生むかを因果で書く（仕組み）
- 両者の同文・類似文を禁止し、service_value_hypothesis には必ず「〜することで / により」等の因果表現を含める

## 10項目の意味定義（必須）
- brief_version: 固定値 "device-service-design-brief-v1" を返す
- experience_objective: 体験の主目的（ユーザーが最終的にどうなっていたいか）
- service_value_hypothesis: 目的を生む仕組み（設計要素と因果）
- target_user_context: 想定ユーザー像と利用文脈
- usage_scene: いつ/どこで/どのように使うかの場面
- emotional_outcome: 体験中〜体験後に得たい感情変化
- tone_guardrail: トーンの維持条件と逸脱禁止
- role_design_direction: 固定キャラ/案内役の役割設計方針
- spatial_behavior_policy: 現地行動と理解獲得の接続方針
- ux_guidance_style: 案内文体・進行スタイル・情報提示方針

## 出力制約
- 必ず JSON のみを返す
- seriesDeviceServiceDesignBriefSchema に完全準拠する
- 10項目すべて埋める
- 箇条書きではなく、各フィールドは自然文で簡潔に記述する
`;

export const seriesDesignBriefAgent = new Agent({
  id: "series-design-brief-agent",
  name: "series-design-brief-agent",
  model: MASTRA_SERIES_DESIGN_BRIEF_MODEL,
  instructions: SERIES_DESIGN_BRIEF_AGENT_INSTRUCTIONS,
});

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();
const BRIEF_VERSION = "device-service-design-brief-v1" as const;
type UnknownRecord = Record<string, unknown>;

const normalizeForComparison = (value: string) =>
  clean(value)
    .toLowerCase()
    .replace(/[\s　、。，．,.!！?？「」『』（）()【】\[\]・:：;；"'`´~〜\-ー]/g, "");

const toBigrams = (value: string) => {
  const normalized = normalizeForComparison(value);
  if (normalized.length <= 1) return new Set([normalized]);
  const grams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i += 1) {
    grams.add(normalized.slice(i, i + 2));
  }
  return grams;
};

const jaccardSimilarity = (a: Set<string>, b: Set<string>) => {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const v of a) {
    if (b.has(v)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
};

const buildSeparatedHypothesis = (targetUserContext: string) => {
  const context = /新入生|オンボーディング|入学|キャンパス|履修/.test(targetUserContext)
    ? "新生活導線の理解"
    : /観光|旅行|地域|史跡|文化|歴史/.test(targetUserContext)
      ? "地域理解の深化"
      : "行動文脈の理解";
  return `手掛かり提示・現地観察・仮説更新・伏線回収を段階配置することで、事件ミステリーとしての没入感を維持したまま${context}を副次獲得できる体験価値を生み出す。`;
};

const enforceObjectiveHypothesisSeparation = (
  brief: SeriesDesignBriefAgentOutput
): SeriesDesignBriefAgentOutput => {
  const objective = clean(brief.experience_objective);
  let hypothesis = clean(brief.service_value_hypothesis);

  const objectiveNorm = normalizeForComparison(objective);
  const hypothesisNorm = normalizeForComparison(hypothesis);
  const prefix = objectiveNorm.slice(0, 12);
  const prefixConflict = prefix.length >= 12 && hypothesisNorm.startsWith(prefix);
  const directConflict =
    objectiveNorm === hypothesisNorm ||
    objectiveNorm.includes(hypothesisNorm) ||
    hypothesisNorm.includes(objectiveNorm);
  const semanticConflict =
    jaccardSimilarity(toBigrams(objective), toBigrams(hypothesis)) >= 0.86;
  const hasCausality = /(ことで|により|によって|結果として|ため|ので)/.test(hypothesis);
  const hasMechanism = /(設計|導線|配置|構造|仕組み|段階|提示|観察|回収|更新)/.test(hypothesis);

  if (prefixConflict || directConflict || semanticConflict || !hasCausality || !hasMechanism) {
    hypothesis = buildSeparatedHypothesis(brief.target_user_context);
  }

  return {
    ...brief,
    experience_objective: objective,
    service_value_hypothesis: hypothesis,
  };
};

const tryParseJsonText = (text?: string | null): unknown => {
  const src = clean(text);
  if (!src) return null;

  try {
    return JSON.parse(src);
  } catch {
    // continue
  }

  const fenced = src.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // continue
    }
  }

  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = src.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  return null;
};

const toRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" ? (value as UnknownRecord) : null;

const pickString = (record: UnknownRecord, keys: string[]): string => {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string") {
      const normalized = clean(raw);
      if (normalized) return normalized;
    }
  }
  return "";
};

const normalize = (raw: unknown): SeriesDesignBriefAgentOutput | null => {
  const record = toRecord(raw);
  if (!record) return null;

  const fields = {
    experience_objective: pickString(record, [
      "experience_objective",
      "experienceObjective",
      "objective",
      "primary_objective",
    ]),
    service_value_hypothesis: pickString(record, [
      "service_value_hypothesis",
      "serviceValueHypothesis",
      "value_hypothesis",
      "service_hypothesis",
      "core_value",
    ]),
    target_user_context: pickString(record, [
      "target_user_context",
      "targetUserContext",
      "user_context",
      "target_audience",
      "user_segment_context",
    ]),
    usage_scene: pickString(record, [
      "usage_scene",
      "usageScene",
      "scenario",
      "usage_context",
    ]),
    emotional_outcome: pickString(record, [
      "emotional_outcome",
      "emotionalOutcome",
      "emotional_arc",
      "emotion_outcome",
    ]),
    tone_guardrail: pickString(record, [
      "tone_guardrail",
      "toneGuardrail",
      "tone_policy",
      "style_guardrail",
    ]),
    role_design_direction: pickString(record, [
      "role_design_direction",
      "roleDesignDirection",
      "character_role_direction",
      "guide_role_direction",
    ]),
    spatial_behavior_policy: pickString(record, [
      "spatial_behavior_policy",
      "spatialBehaviorPolicy",
      "spatial_policy",
      "movement_policy",
    ]),
    ux_guidance_style: pickString(record, [
      "ux_guidance_style",
      "uxGuidanceStyle",
      "guidance_style",
      "ux_style",
    ]),
  };

  const parsed = seriesDesignBriefStrictFieldsSchema.safeParse(fields);
  if (!parsed.success) return null;

  const normalized: SeriesDesignBriefAgentOutput = {
    brief_version: BRIEF_VERSION,
    experience_objective: clean(parsed.data.experience_objective),
    service_value_hypothesis: clean(parsed.data.service_value_hypothesis),
    target_user_context: clean(parsed.data.target_user_context),
    usage_scene: clean(parsed.data.usage_scene),
    emotional_outcome: clean(parsed.data.emotional_outcome),
    tone_guardrail: clean(parsed.data.tone_guardrail),
    role_design_direction: clean(parsed.data.role_design_direction),
    spatial_behavior_policy: clean(parsed.data.spatial_behavior_policy),
    ux_guidance_style: clean(parsed.data.ux_guidance_style),
  };
  return enforceObjectiveHypothesisSeparation(normalized);
};

export const generateSeriesDesignBrief = async (
  input: SeriesDesignBriefAgentInput
): Promise<SeriesDesignBriefAgentOutput> => {
  if (!isMastraTextModelAvailable()) {
    throw new Error("デザインブリーフ生成に失敗しました。利用可能なAIモデルがありません。");
  }

  const interview = input.interview;
  const interviewBlock = interview
    ? [
      `- ジャンル/世界観: ${clean(interview.genre_world) || "なし"}`,
      `- なりたい気持ち: ${clean(interview.desired_emotion) || "なし"}`,
      `- 相棒/関係性: ${clean(interview.companion_preference) || "なし"}`,
      `- 続きが気になる条件: ${clean(interview.continuation_trigger) || "なし"}`,
      `- 避けたい表現: ${clean(interview.avoidance_preferences) || "なし"}`,
      `- 補足: ${clean(interview.additional_notes) || "なし"}`,
    ].join("\n")
    : "- interview: 未使用（promptから文脈を解釈）";

  const prompt = `
## ユーザー入力
- prompt: ${input.prompt || "なし"}
${interviewBlock}

## 反映ルール
- 事件ミステリー体験を主軸にする
- 実用理解（例: オンボーディング/観光理解）は体験の副次獲得として設計する
- 感情表現は入力文脈に合わせて自前生成し、固定句にしない
- experience_objective と service_value_hypothesis は同文にしない
- service_value_hypothesis には必ず「〜することで / により」等の因果表現を入れる
- 10項目はすべて空文字禁止。内容が薄い場合は具体化して埋める

## 生成する10項目（項目定義）
- brief_version: 固定値 "device-service-design-brief-v1"
- experience_objective: 体験の主目的（ユーザーが最終的にどうなっていたいか）
- service_value_hypothesis: 目的を生む仕組み（設計要素と因果）
- target_user_context: 想定ユーザー像と利用文脈
- usage_scene: いつ/どこで/どのように使うかの場面
- emotional_outcome: 体験中〜体験後に得たい感情変化
- tone_guardrail: トーンの維持条件と逸脱禁止
- role_design_direction: 固定キャラ/案内役の役割設計方針
- spatial_behavior_policy: 現地行動と理解獲得の接続方針
- ux_guidance_style: 案内文体・進行スタイル・情報提示方針

## 出力フォーマット（このキーを必ずすべて埋める）
{
  "brief_version": "device-service-design-brief-v1",
  "experience_objective": "...",
  "service_value_hypothesis": "...",
  "target_user_context": "...",
  "usage_scene": "...",
  "emotional_outcome": "...",
  "tone_guardrail": "...",
  "role_design_direction": "...",
  "spatial_behavior_policy": "...",
  "ux_guidance_style": "..."
}

seriesDeviceServiceDesignBriefSchema を満たす JSON のみを返してください。
`;

  const maxAttempts = 2;
  const timeoutMs = 45_000;
  const logPrefix = "[series-design-brief-agent]";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.log(`${logPrefix} attempt ${attempt}/${maxAttempts} — LLM呼び出し中`);
      const result = await Promise.race([
        seriesDesignBriefAgent.generate(prompt, {
          modelSettings: {
            maxRetries: 0,
            maxOutputTokens: 900,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${timeoutMs / 1000}秒タイムアウト`)), timeoutMs)
        ),
      ]);

      const normalizedFromObject = normalize(result.object);
      if (normalizedFromObject) return normalizedFromObject;

      const parsedFromText = tryParseJsonText(result.text);
      const normalizedFromText = normalize(parsedFromText);
      if (normalizedFromText) return normalizedFromText;

      console.warn(`${logPrefix} attempt ${attempt} — パース失敗`);
    } catch (error: any) {
      console.warn(`${logPrefix} attempt ${attempt} 失敗:`, error?.message ?? error);
    }
  }

  console.warn(`${logPrefix} 全試行失敗`);
  throw new Error("デザインブリーフ生成に失敗しました。外部AIの生成結果を取得できませんでした。");
};
