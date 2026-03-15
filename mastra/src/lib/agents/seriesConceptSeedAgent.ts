import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_MODEL_BALANCED, MASTRA_MODEL_FAST } from "../modelConfig";
import {
  seriesAntiBriefSchema,
  seriesConceptSeedBatchSchema,
  seriesConceptSeedSchema,
  seriesPreferenceSheetSchema,
  seriesTextJudgeScoreSchema,
  userSeriesRubricSchema,
} from "../../schemas/series";

export const seriesConceptSeedAgentInputSchema = z.object({
  prompt: z.string().optional(),
  desired_episode_count: z.number().int().min(3).max(24).default(8),
  preference_sheet: seriesPreferenceSheetSchema,
  anti_brief: seriesAntiBriefSchema,
  user_rubric: userSeriesRubricSchema,
  desired_seed_count: z.number().int().min(6).max(10).default(8),
  language: z.string().default("ja"),
});

export const seriesConceptPairwiseJudgeOutputSchema = z.object({
  winner_seed_id: z.string(),
  loser_seed_id: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

export const seriesConceptSimilarityJudgeOutputSchema = z.object({
  similar: z.boolean(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

export type SeriesConceptSeedAgentInput = z.infer<typeof seriesConceptSeedAgentInputSchema>;
export type SeriesConceptPairwiseJudgeOutput = z.infer<typeof seriesConceptPairwiseJudgeOutputSchema>;

const SERIES_CONCEPT_SEED_AGENT_INSTRUCTIONS = `
あなたはシリーズ企画の探索エージェントです。
平均解を避けるため、探索軸を意図的に分けた複数案を作ってください。

## 必須
- 6〜10案を出す
- 各案は generation_angle を必ず変える
- title / premise / central_relationship_dynamic / ending_flavor が意味的に重複しないようにする
- uniqueness_claims は具体的な差別化主張を1〜6個入れる
- fingerprint は候補の本質を短い語で表す
`;

const SERIES_CONCEPT_PAIRWISE_JUDGE_INSTRUCTIONS = `
あなたはシリーズ案の比較審査員です。
2案を比較し、ユーザー意図適合・独自性・継続動機が高い方を1つ選んでください。
`;

const SERIES_CONCEPT_SIMILARITY_JUDGE_INSTRUCTIONS = `
あなたはシリーズ候補の重複排除審査員です。
2候補が「タイトル違いの同型案」かどうかを判定してください。
語句一致ではなく、世界観・関係性・継続モード・終端味の意味が近いかで判定します。
`;

export const seriesConceptSeedAgent = new Agent({
  id: "series-concept-seed-agent",
  name: "series-concept-seed-agent",
  model: MASTRA_MODEL_BALANCED,
  instructions: SERIES_CONCEPT_SEED_AGENT_INSTRUCTIONS,
});

export const seriesConceptPairwiseJudgeAgent = new Agent({
  id: "series-concept-pairwise-judge-agent",
  name: "series-concept-pairwise-judge-agent",
  model: MASTRA_MODEL_FAST,
  instructions: SERIES_CONCEPT_PAIRWISE_JUDGE_INSTRUCTIONS,
});

export const seriesConceptSimilarityJudgeAgent = new Agent({
  id: "series-concept-similarity-judge-agent",
  name: "series-concept-similarity-judge-agent",
  model: MASTRA_MODEL_FAST,
  instructions: SERIES_CONCEPT_SIMILARITY_JUDGE_INSTRUCTIONS,
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

const ANGLES: Array<z.infer<typeof seriesConceptSeedSchema>["generation_angle"]> = [
  "emotion-first",
  "relationship-first",
  "world-first",
  "originality-first",
  "ending-first",
  "continuation-trigger-first",
  "place-portability-first",
  "bittersweet-first",
];

const hashText = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
};

const ANGLE_WORLD_BIASES: Record<
  z.infer<typeof seriesConceptSeedSchema>["generation_angle"],
  string
> = {
  "emotion-first": "感情の残響が見える街区",
  "relationship-first": "関係性の衝突点が交差する回遊路",
  "world-first": "地層のように歴史が重なる街並み",
  "originality-first": "通常導線をずらした裏回廊のある街区",
  "ending-first": "終端の手がかりが先に提示される街路",
  "continuation-trigger-first": "毎話のフックを埋め込む転換点密集エリア",
  "place-portability-first": "土地を変えても骨格が崩れない可搬型世界",
  "bittersweet-first": "失ったものの痕跡が温度として残る街区",
};

const ANGLE_RELATION_BIASES: Record<
  z.infer<typeof seriesConceptSeedSchema>["generation_angle"],
  string
> = {
  "emotion-first": "感情の揺れを言語化できる相棒関係",
  "relationship-first": "共闘と対立が反復する主従反転関係",
  "world-first": "土地の記憶を巡って立場が揺れる協働関係",
  "originality-first": "価値観が真逆のまま同じ目的を追う関係",
  "ending-first": "終盤の選択に向けて信頼を積み上げる関係",
  "continuation-trigger-first": "次話フックを互いに持ち寄る契約関係",
  "place-portability-first": "場所適応のたびに役割が入れ替わる関係",
  "bittersweet-first": "守りたい対象が互いに食い違う関係",
};

const fallbackSeeds = (
  input: SeriesConceptSeedAgentInput
): z.infer<typeof seriesConceptSeedBatchSchema>["seeds"] => {
  const desired = Math.max(6, Math.min(10, input.desired_seed_count));
  const emotion = input.preference_sheet.emotional_rewards[0] || "余韻";
  const relation = input.preference_sheet.desired_relationship_dynamics[0] || "相棒との信頼形成";
  const atmosphere = input.preference_sheet.atmosphere_keywords[0] || "地上街区";
  const continuation = input.preference_sheet.continuation_needs[0] || "次回への未回収フック";
  const signature = `${input.prompt || ""}|${atmosphere}|${emotion}|${relation}|${continuation}`;

  return Array.from({ length: desired }, (_, index) => {
    const angle = ANGLES[index % ANGLES.length];
    const moodWord = input.preference_sheet.emotional_rewards[index % input.preference_sheet.emotional_rewards.length] || emotion;
    const worldBias = ANGLE_WORLD_BIASES[angle];
    const relationBias = ANGLE_RELATION_BIASES[angle];
    const endingFlavor =
      angle === "ending-first"
        ? "伏線回収型の決着"
        : angle === "bittersweet-first"
          ? "代償を伴う救済"
          : angle === "continuation-trigger-first"
            ? "真相を次話へ持ち越す連鎖型"
            : "余韻を残す収束";
    const localTag = (hashText(`${signature}:${angle}:${index}`) % 87) + 13;
    return {
      seed_id: `seed_${index + 1}`,
      generation_angle: angle,
      title: `${atmosphere}${localTag}区画${angle.replace(/-first$/, "")}譚`,
      one_line_hook: `${moodWord}を核に、${relationBias}が話数ごとに段階更新される。`,
      premise: `${worldBias}を歩きながら、${continuation}を追う連載体験。`,
      worldview_core: `${atmosphere}に加えて「${worldBias}」が機能する歩行可能な街。`,
      emotional_core: `${moodWord}と小さな達成感を往復させる。`,
      central_relationship_dynamic: `${relation} / ${relationBias}`,
      return_reason: `${continuation}と${endingFlavor}の回収を見届けたい。`,
      ending_flavor: endingFlavor,
      uniqueness_claims: dedupe([
        `${angle}視点で設計された継続導線`,
        `${worldBias}を運用ルールに固定`,
        `${relationBias}をcheckpointで段階更新`,
        `${endingFlavor}に向けた固有の回収導線`,
      ]).slice(0, 6),
      fingerprint: {
        worldview_archetype: worldBias,
        emotional_promise: moodWord,
        fixed_character_dynamic: relationBias,
        continuation_mode: `${continuation}:${angle}`,
        motif_cluster: dedupe([
          ...input.preference_sheet.atmosphere_keywords,
          worldBias,
          angle,
        ]).slice(0, 4),
        ending_type:
          angle === "ending-first"
            ? "resolved"
            : angle === "bittersweet-first"
              ? "bittersweet"
              : "open_for_extension",
      },
    };
  });
};

const normalizeSeeds = (
  input: SeriesConceptSeedAgentInput,
  raw: unknown
): z.infer<typeof seriesConceptSeedBatchSchema>["seeds"] | null => {
  const parsed = seriesConceptSeedBatchSchema.safeParse(raw);
  if (!parsed.success) return null;

  const fallback = fallbackSeeds(input);
  const used = new Set<string>();
  const normalized = parsed.data.seeds.map((seed, index) => {
    let seedId = clean(seed.seed_id) || `seed_${index + 1}`;
    if (used.has(seedId)) seedId = `${seedId}_${index + 1}`;
    used.add(seedId);

    const uniquenessClaims = dedupe(seed.uniqueness_claims).slice(0, 6);
    const motifCluster = dedupe(seed.fingerprint.motif_cluster).slice(0, 6);

    return {
      seed_id: seedId,
      generation_angle: seed.generation_angle,
      title: clean(seed.title) || fallback[index % fallback.length].title,
      one_line_hook: clean(seed.one_line_hook) || fallback[index % fallback.length].one_line_hook,
      premise: clean(seed.premise) || fallback[index % fallback.length].premise,
      worldview_core:
        clean(seed.worldview_core) || fallback[index % fallback.length].worldview_core,
      emotional_core:
        clean(seed.emotional_core) || fallback[index % fallback.length].emotional_core,
      central_relationship_dynamic:
        clean(seed.central_relationship_dynamic) ||
        fallback[index % fallback.length].central_relationship_dynamic,
      return_reason: clean(seed.return_reason) || fallback[index % fallback.length].return_reason,
      ending_flavor: clean(seed.ending_flavor) || fallback[index % fallback.length].ending_flavor,
      uniqueness_claims:
        uniquenessClaims.length > 0
          ? uniquenessClaims
          : fallback[index % fallback.length].uniqueness_claims,
      fingerprint: {
        worldview_archetype:
          clean(seed.fingerprint.worldview_archetype) ||
          fallback[index % fallback.length].fingerprint.worldview_archetype,
        emotional_promise:
          clean(seed.fingerprint.emotional_promise) ||
          fallback[index % fallback.length].fingerprint.emotional_promise,
        fixed_character_dynamic:
          clean(seed.fingerprint.fixed_character_dynamic) ||
          fallback[index % fallback.length].fingerprint.fixed_character_dynamic,
        continuation_mode:
          clean(seed.fingerprint.continuation_mode) ||
          fallback[index % fallback.length].fingerprint.continuation_mode,
        motif_cluster:
          motifCluster.length > 0
            ? motifCluster
            : fallback[index % fallback.length].fingerprint.motif_cluster,
        ending_type:
          clean(seed.fingerprint.ending_type) ||
          fallback[index % fallback.length].fingerprint.ending_type,
      },
    };
  });

  return normalized;
};

export const generateSeriesConceptSeeds = async (
  input: SeriesConceptSeedAgentInput
): Promise<z.infer<typeof seriesConceptSeedBatchSchema>["seeds"]> => {
  if (!hasModelApiKey()) {
    console.warn("[series-concept-seed-agent] API key not found, fallback seeds used");
    return fallbackSeeds(input);
  }

  const prompt = `
## ユーザー意図
- interpreted_intent_summary: ${input.preference_sheet.interpreted_intent_summary}
- emotional_rewards: ${input.preference_sheet.emotional_rewards.join(" / ")}
- desired_relationship_dynamics: ${input.preference_sheet.desired_relationship_dynamics.join(" / ")}
- atmosphere_keywords: ${input.preference_sheet.atmosphere_keywords.join(" / ")}
- continuation_needs: ${input.preference_sheet.continuation_needs.join(" / ")}
- originality_targets: ${input.preference_sheet.originality_targets.join(" / ")}

## anti brief
- banned_cliches: ${input.anti_brief.banned_cliches.join(" / ")}
- banned_world_shapes: ${input.anti_brief.banned_world_shapes.join(" / ")}
- banned_relationship_modes: ${input.anti_brief.banned_relationship_modes.join(" / ")}
- banned_tone_drifts: ${input.anti_brief.banned_tone_drifts.join(" / ")}
- banned_generic_patterns: ${input.anti_brief.banned_generic_patterns.join(" / ")}

## 制約
- 生成数: ${input.desired_seed_count}
- 全候補で generation_angle を分散させる
- タイトルと premise を意味的に重複させない

seriesConceptSeedBatchSchema を満たす JSON のみを返してください。
`;

  const maxAttempts = 2;
  const timeoutMs = 60_000;
  const logPrefix = "[series-concept-seed-agent]";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.log(`${logPrefix} attempt ${attempt}/${maxAttempts} — LLM呼び出し中`);
      const result = await Promise.race([
        seriesConceptSeedAgent.generate(prompt, {
          structuredOutput: { schema: seriesConceptSeedBatchSchema },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${timeoutMs / 1000}秒タイムアウト`)), timeoutMs)
        ),
      ]);
      const normalized = normalizeSeeds(input, result.object);
      if (normalized && normalized.length >= 6) {
        return normalized.slice(0, Math.max(6, Math.min(10, input.desired_seed_count)));
      }
      console.warn(`${logPrefix} attempt ${attempt} — パース失敗または候補不足`);
    } catch (error: any) {
      console.warn(`${logPrefix} attempt ${attempt} 失敗:`, error?.message ?? error);
    }
  }

  console.warn(`${logPrefix} 全試行失敗 — fallback seeds使用`);
  return fallbackSeeds(input);
};

const pairwiseFallback = (params: {
  left: z.infer<typeof seriesConceptSeedSchema>;
  right: z.infer<typeof seriesConceptSeedSchema>;
  leftScore: z.infer<typeof seriesTextJudgeScoreSchema>;
  rightScore: z.infer<typeof seriesTextJudgeScoreSchema>;
}): SeriesConceptPairwiseJudgeOutput => {
  const leftValue =
    params.leftScore.intent_fit +
    params.leftScore.emotional_reward_fit +
    params.leftScore.relationship_fit +
    params.leftScore.world_originality +
    params.leftScore.character_vividness +
    params.leftScore.return_desire -
    params.leftScore.clone_penalty;
  const rightValue =
    params.rightScore.intent_fit +
    params.rightScore.emotional_reward_fit +
    params.rightScore.relationship_fit +
    params.rightScore.world_originality +
    params.rightScore.character_vividness +
    params.rightScore.return_desire -
    params.rightScore.clone_penalty;

  const leftWins = leftValue >= rightValue;

  return {
    winner_seed_id: leftWins ? params.left.seed_id : params.right.seed_id,
    loser_seed_id: leftWins ? params.right.seed_id : params.left.seed_id,
    confidence: Math.max(0.5, Math.min(0.95, Math.abs(leftValue - rightValue) / 6 + 0.5)),
    rationale: leftWins
      ? "fallback scoring で左候補の総合値が高い"
      : "fallback scoring で右候補の総合値が高い",
  };
};

export const compareSeriesSeedsPairwise = async (params: {
  left: z.infer<typeof seriesConceptSeedSchema>;
  right: z.infer<typeof seriesConceptSeedSchema>;
  leftScore: z.infer<typeof seriesTextJudgeScoreSchema>;
  rightScore: z.infer<typeof seriesTextJudgeScoreSchema>;
  preference_summary: string;
  anti_patterns: string[];
}): Promise<SeriesConceptPairwiseJudgeOutput> => {
  if (!hasModelApiKey()) {
    return pairwiseFallback(params);
  }

  const prompt = `
ユーザー意図: ${params.preference_summary}
避けるべきパターン: ${params.anti_patterns.join(" / ")}

left:
- seed_id: ${params.left.seed_id}
- title: ${params.left.title}
- hook: ${params.left.one_line_hook}
- premise: ${params.left.premise}
- relationship: ${params.left.central_relationship_dynamic}
- ending: ${params.left.ending_flavor}
- score_hint: intent=${params.leftScore.intent_fit.toFixed(2)} originality=${params.leftScore.world_originality.toFixed(2)} clone_penalty=${params.leftScore.clone_penalty.toFixed(2)}

right:
- seed_id: ${params.right.seed_id}
- title: ${params.right.title}
- hook: ${params.right.one_line_hook}
- premise: ${params.right.premise}
- relationship: ${params.right.central_relationship_dynamic}
- ending: ${params.right.ending_flavor}
- score_hint: intent=${params.rightScore.intent_fit.toFixed(2)} originality=${params.rightScore.world_originality.toFixed(2)} clone_penalty=${params.rightScore.clone_penalty.toFixed(2)}

seriesConceptPairwiseJudgeOutputSchema を満たす JSON のみ返してください。
`;

  const timeoutMs = 35_000;
  try {
    const result = await Promise.race([
      seriesConceptPairwiseJudgeAgent.generate(prompt, {
        structuredOutput: { schema: seriesConceptPairwiseJudgeOutputSchema },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${timeoutMs / 1000}秒タイムアウト`)), timeoutMs)
      ),
    ]);

    const parsed = seriesConceptPairwiseJudgeOutputSchema.safeParse(result.object);
    if (parsed.success) return parsed.data;
  } catch {
    // ignore and fallback
  }

  return pairwiseFallback(params);
};

const similarityFallback = (left: z.infer<typeof seriesConceptSeedSchema>, right: z.infer<typeof seriesConceptSeedSchema>) => {
  const leftKey = dedupe([
    left.fingerprint.worldview_archetype,
    left.fingerprint.emotional_promise,
    left.fingerprint.fixed_character_dynamic,
    left.fingerprint.continuation_mode,
    left.fingerprint.ending_type,
  ]).join("|");
  const rightKey = dedupe([
    right.fingerprint.worldview_archetype,
    right.fingerprint.emotional_promise,
    right.fingerprint.fixed_character_dynamic,
    right.fingerprint.continuation_mode,
    right.fingerprint.ending_type,
  ]).join("|");
  const exact = clean(leftKey) === clean(rightKey);
  return {
    similar: exact,
    confidence: exact ? 0.86 : 0.58,
    rationale: exact ? "fallback fingerprint key一致" : "fallback fingerprint key不一致",
  } as z.infer<typeof seriesConceptSimilarityJudgeOutputSchema>;
};

export const judgeSeriesSeedSemanticSimilarity = async (params: {
  left: z.infer<typeof seriesConceptSeedSchema>;
  right: z.infer<typeof seriesConceptSeedSchema>;
}): Promise<z.infer<typeof seriesConceptSimilarityJudgeOutputSchema>> => {
  const fallback = similarityFallback(params.left, params.right);
  if (!hasModelApiKey()) return fallback;

  const prompt = `
left:
- id: ${params.left.seed_id}
- title: ${params.left.title}
- hook: ${params.left.one_line_hook}
- premise: ${params.left.premise}
- relation: ${params.left.central_relationship_dynamic}
- continuation: ${params.left.fingerprint.continuation_mode}
- ending: ${params.left.ending_flavor}

right:
- id: ${params.right.seed_id}
- title: ${params.right.title}
- hook: ${params.right.one_line_hook}
- premise: ${params.right.premise}
- relation: ${params.right.central_relationship_dynamic}
- continuation: ${params.right.fingerprint.continuation_mode}
- ending: ${params.right.ending_flavor}

seriesConceptSimilarityJudgeOutputSchema を満たす JSON のみ返してください。
`;

  const timeoutMs = 25_000;
  try {
    const result = await Promise.race([
      seriesConceptSimilarityJudgeAgent.generate(prompt, {
        structuredOutput: { schema: seriesConceptSimilarityJudgeOutputSchema },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${timeoutMs / 1000}秒タイムアウト`)), timeoutMs)
      ),
    ]);

    const parsed = seriesConceptSimilarityJudgeOutputSchema.safeParse(result.object);
    if (parsed.success) return parsed.data;
  } catch {
    // fallback
  }

  return fallback;
};
