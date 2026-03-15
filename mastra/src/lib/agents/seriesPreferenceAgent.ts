import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_MODEL_FAST } from "../modelConfig";
import {
  seriesAntiBriefSchema,
  seriesInterviewSchema,
  seriesPreferenceSheetSchema,
  userSeriesRubricSchema,
} from "../../schemas/series";

export const seriesPreferenceAgentInputSchema = z.object({
  interview: seriesInterviewSchema,
  prompt: z.string().optional(),
  desired_episode_count: z.number().int().min(3).max(24).default(8),
  language: z.string().default("ja"),
});

export const seriesPreferenceAgentOutputSchema = z.object({
  preference_sheet: seriesPreferenceSheetSchema,
  anti_brief: seriesAntiBriefSchema,
  user_rubric: userSeriesRubricSchema,
});

export type SeriesPreferenceAgentInput = z.infer<typeof seriesPreferenceAgentInputSchema>;
export type SeriesPreferenceAgentOutput = z.infer<typeof seriesPreferenceAgentOutputSchema>;

const SERIES_PREFERENCE_AGENT_INSTRUCTIONS = `
あなたはシリーズ生成の意図解釈エージェントです。
Q1〜Q5相当の入力から、シリーズ設計に必要な嗜好を構造化してください。

## 目的
- ユーザーが「何を感じたいか」「どんな関係性を育てたいか」を明確化する
- generic な作品を避けるための anti brief を作る
- 後段の候補選抜に使える rubric を数値重み付きで作る

## 出力ルール
- 必ずJSONのみを返す
- 抽象語だけで終わらず、後続プロンプトにそのまま渡せる具体語にする
- anti_brief は禁止項目を明示的に書く
- user_rubric.intent_fit_weights は 0〜1 の実数で埋める
- must_haves / must_avoid は評価可能な文として書く
`;

export const seriesPreferenceAgent = new Agent({
  id: "series-preference-agent",
  name: "series-preference-agent",
  model: MASTRA_MODEL_FAST,
  instructions: SERIES_PREFERENCE_AGENT_INSTRUCTIONS,
});

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();

const dedupe = (values: Array<string | undefined | null>) => {
  const seen = new Set<string>();
  return values
    .map((item) => clean(item))
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
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

const fallbackFromInput = (input: SeriesPreferenceAgentInput): SeriesPreferenceAgentOutput => {
  const desiredEmotion = clean(input.interview.desired_emotion) || "余韻と高揚";
  const companion = clean(input.interview.companion_preference) || "信頼できる相棒";
  const genreWorld = clean(input.interview.genre_world) || "街歩きミステリー";
  const continuationTrigger =
    clean(input.interview.continuation_trigger) || "次話で核心に近づく明確なフック";
  const avoid = clean(input.interview.avoidance_preferences);

  return {
    preference_sheet: {
      emotional_rewards: dedupe([desiredEmotion, "小さな達成感", "継続の高揚"]),
      desired_relationship_dynamics: dedupe([
        companion,
        "固定キャラクターとの信頼深化",
        "対立と和解の往復",
      ]),
      atmosphere_keywords: dedupe([
        genreWorld,
        "地上街区",
        "歩いて発見できる余白",
      ]),
      novelty_level: /斬新|奇抜|独創|攻め/i.test(`${genreWorld} ${desiredEmotion}`)
        ? "bold"
        : "balanced",
      pacing_preference: /じっくり|ゆっくり|穏やか/.test(desiredEmotion)
        ? "slow_burn"
        : /刺激|スピード|緊張/.test(desiredEmotion)
          ? "fast_hook"
          : "balanced",
      ending_preference: /救い|爽快|達成/.test(continuationTrigger)
        ? "resolved"
        : /余韻|切ない|喪失/.test(continuationTrigger)
          ? "bittersweet"
          : "open",
      continuation_needs: dedupe([
        continuationTrigger,
        "前話の選択が次話で効く",
        "固定キャラクター関係が前進する",
      ]),
      anti_preferences: dedupe([avoid, "テンプレ展開", "説明過多"]),
      originality_targets: dedupe([
        "世界観の固有モチーフを2つ以上固定",
        "関係性のねじれを中盤で反転",
        "最終話に向けて固有の回収導線を維持",
      ]),
      interpreted_intent_summary: `${desiredEmotion}を核に、${companion}との継続関係を育てながら${genreWorld}を歩きたくなるシリーズを求めている。`,
    },
    anti_brief: {
      banned_cliches: dedupe([
        "なんでも屋の便利キャラだけで解決する展開",
        "毎話リセットで関係が進まない構造",
        "汎用的な事件解決テンプレのみ",
      ]),
      banned_world_shapes: dedupe([
        "単一屋内で完結する舞台",
        "街歩き不能な閉鎖空間のみ",
      ]),
      banned_relationship_modes: dedupe([
        "好意だけ上がって葛藤がない関係",
        "役割が重複した固定キャラ構成",
      ]),
      banned_tone_drifts: dedupe([
        "急なギャグ化",
        "無根拠な過度ダーク化",
      ]),
      banned_generic_patterns: dedupe([
        "タイトルだけ差し替えた量産パターン",
        "固有名詞不在の抽象設定",
      ]),
    },
    user_rubric: {
      intent_fit_weights: {
        intent_fit: 0.22,
        emotional_reward_fit: 0.18,
        relationship_fit: 0.16,
        world_originality: 0.15,
        character_vividness: 0.14,
        return_desire: 0.15,
        clone_penalty: 0.12,
      },
      must_haves: dedupe([
        `感情報酬「${desiredEmotion}」が物語設計に明示される`,
        `相棒像「${companion}」が固定キャラ設計に反映される`,
        `継続条件「${continuationTrigger}」がcheckpointと終端設計に反映される`,
      ]),
      nice_to_haves: dedupe([
        "各話で街区の表情差が出る",
        "固定キャラ間に協力と対立の両方がある",
      ]),
      must_avoid: dedupe([
        avoid,
        "genericなタイトル",
        "固定キャラの同質化",
      ]),
    },
  };
};

const normalize = (
  input: SeriesPreferenceAgentInput,
  raw: unknown
): SeriesPreferenceAgentOutput | null => {
  const parsed = seriesPreferenceAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const fallback = fallbackFromInput(input);
  const data = parsed.data;
  const emotionalRewards = dedupe(data.preference_sheet.emotional_rewards).slice(0, 8);
  const relationshipDynamics = dedupe(data.preference_sheet.desired_relationship_dynamics).slice(0, 8);
  const atmosphereKeywords = dedupe(data.preference_sheet.atmosphere_keywords).slice(0, 10);
  const continuationNeeds = dedupe(data.preference_sheet.continuation_needs).slice(0, 8);
  const originalityTargets = dedupe(data.preference_sheet.originality_targets).slice(0, 8);
  const mustHaves = dedupe(data.user_rubric.must_haves).slice(0, 12);

  return {
    preference_sheet: {
      emotional_rewards:
        emotionalRewards.length > 0 ? emotionalRewards : fallback.preference_sheet.emotional_rewards,
      desired_relationship_dynamics:
        relationshipDynamics.length > 0
          ? relationshipDynamics
          : fallback.preference_sheet.desired_relationship_dynamics,
      atmosphere_keywords:
        atmosphereKeywords.length > 0 ? atmosphereKeywords : fallback.preference_sheet.atmosphere_keywords,
      novelty_level: data.preference_sheet.novelty_level,
      pacing_preference: data.preference_sheet.pacing_preference,
      ending_preference: data.preference_sheet.ending_preference,
      continuation_needs:
        continuationNeeds.length > 0 ? continuationNeeds : fallback.preference_sheet.continuation_needs,
      anti_preferences: dedupe(data.preference_sheet.anti_preferences).slice(0, 12),
      originality_targets:
        originalityTargets.length > 0 ? originalityTargets : fallback.preference_sheet.originality_targets,
      interpreted_intent_summary:
        clean(data.preference_sheet.interpreted_intent_summary) ||
        fallback.preference_sheet.interpreted_intent_summary,
    },
    anti_brief: {
      banned_cliches: dedupe(data.anti_brief.banned_cliches).slice(0, 16),
      banned_world_shapes: dedupe(data.anti_brief.banned_world_shapes).slice(0, 12),
      banned_relationship_modes: dedupe(data.anti_brief.banned_relationship_modes).slice(0, 12),
      banned_tone_drifts: dedupe(data.anti_brief.banned_tone_drifts).slice(0, 12),
      banned_generic_patterns: dedupe(data.anti_brief.banned_generic_patterns).slice(0, 16),
    },
    user_rubric: {
      intent_fit_weights: data.user_rubric.intent_fit_weights,
      must_haves: mustHaves.length > 0 ? mustHaves : fallback.user_rubric.must_haves,
      nice_to_haves: dedupe(data.user_rubric.nice_to_haves).slice(0, 12),
      must_avoid: dedupe(data.user_rubric.must_avoid).slice(0, 16),
    },
  };
};

export const generateSeriesPreferenceBundle = async (
  input: SeriesPreferenceAgentInput
): Promise<SeriesPreferenceAgentOutput> => {
  if (!hasModelApiKey()) {
    console.warn("[series-preference-agent] API key not found, fallback preference bundle used");
    return fallbackFromInput(input);
  }

  const prompt = `
## ユーザー入力（Q1〜Q5由来）
- なりたい気持ち(Q1): ${input.interview.desired_emotion}
- 相棒/関係性(Q2): ${input.interview.companion_preference}
- ジャンル/世界観(Q3): ${input.interview.genre_world}
- 続きが気になる条件(Q4): ${input.interview.continuation_trigger}
- 避けたい表現(Q5): ${input.interview.avoidance_preferences || "なし"}
- 補足: ${input.interview.additional_notes || "なし"}
- 統合prompt: ${input.prompt || "なし"}
- 想定話数: ${input.desired_episode_count}

seriesPreferenceAgentOutputSchema を満たす JSON のみを返してください。
`;

  const maxAttempts = 2;
  const timeoutMs = 45_000;
  const logPrefix = "[series-preference-agent]";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.log(`${logPrefix} attempt ${attempt}/${maxAttempts} — LLM呼び出し中`);
      const result = await Promise.race([
        seriesPreferenceAgent.generate(prompt, {
          structuredOutput: { schema: seriesPreferenceAgentOutputSchema },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${timeoutMs / 1000}秒タイムアウト`)), timeoutMs)
        ),
      ]);
      const normalized = normalize(input, result.object);
      if (normalized) return normalized;
      console.warn(`${logPrefix} attempt ${attempt} — パース失敗`);
    } catch (error: any) {
      console.warn(`${logPrefix} attempt ${attempt} 失敗:`, error?.message ?? error);
    }
  }

  console.warn(`${logPrefix} 全試行失敗 — fallback使用`);
  return fallbackFromInput(input);
};
