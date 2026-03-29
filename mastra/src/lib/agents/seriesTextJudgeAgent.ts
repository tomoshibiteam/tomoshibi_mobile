import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import {
  MASTRA_MODEL_BALANCED,
  MASTRA_MODEL_FAST,
} from "../modelConfig";
import {
  seriesAntiBriefSchema,
  seriesCheckpointSchema,
  seriesCharacterSchema,
  seriesConceptSeedSchema,
  seriesEpisodeSeedSchema,
  seriesPreferenceSheetSchema,
  seriesTextJudgeScoreSchema,
  userSeriesRubricSchema,
} from "../../schemas/series";

export const seriesTextJudgeCandidateSchema = z.object({
  candidate_id: z.string(),
  seed: seriesConceptSeedSchema,
  title: z.string(),
  overview: z.string(),
  premise: z.string(),
  season_goal: z.string(),
  characters: z.array(seriesCharacterSchema).min(2).max(8),
  checkpoints: z.array(seriesCheckpointSchema).length(3),
  first_episode_seed: seriesEpisodeSeedSchema,
});

export const seriesTextJudgeInputSchema = z.object({
  preference_sheet: seriesPreferenceSheetSchema,
  anti_brief: seriesAntiBriefSchema,
  user_rubric: userSeriesRubricSchema,
  candidate: seriesTextJudgeCandidateSchema,
});

export const seriesTextJudgeOutputSchema = z.object({
  candidate_id: z.string(),
  score: seriesTextJudgeScoreSchema,
  reject: z.boolean(),
  reject_reasons: z.array(z.string()).max(8).default([]),
});

export const seriesTextPairwiseInputSchema = z.object({
  preference_sheet: seriesPreferenceSheetSchema,
  anti_brief: seriesAntiBriefSchema,
  user_rubric: userSeriesRubricSchema,
  left: seriesTextJudgeCandidateSchema,
  right: seriesTextJudgeCandidateSchema,
});

export const seriesTextPairwiseOutputSchema = z.object({
  winner_candidate_id: z.string(),
  loser_candidate_id: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

export type SeriesTextJudgeInput = z.infer<typeof seriesTextJudgeInputSchema>;
export type SeriesTextJudgeOutput = z.infer<typeof seriesTextJudgeOutputSchema>;
export type SeriesTextPairwiseInput = z.infer<typeof seriesTextPairwiseInputSchema>;
export type SeriesTextPairwiseOutput = z.infer<typeof seriesTextPairwiseOutputSchema>;

const SERIES_TEXT_JUDGE_INSTRUCTIONS = `
あなたはシリーズ本文の品質審査員です。
画像ではなくテキスト設計を評価します。

評価軸:
- intentFit
- emotionalRewardFit
- relationshipFit
- worldOriginality
- characterVividness
- returnDesire
- clonePenalty
`;

const SERIES_TEXT_PAIRWISE_INSTRUCTIONS = `
あなたはシリーズ候補の比較審査員です。
2候補を比較し、ユーザー適合・独自性・継続動機が高い方を選んでください。
`;

export const seriesTextJudgeAgent = new Agent({
  id: "series-text-judge-agent",
  name: "series-text-judge-agent",
  model: MASTRA_MODEL_BALANCED,
  instructions: SERIES_TEXT_JUDGE_INSTRUCTIONS,
});

export const seriesTextPairwiseAgent = new Agent({
  id: "series-text-pairwise-agent",
  name: "series-text-pairwise-agent",
  model: MASTRA_MODEL_FAST,
  instructions: SERIES_TEXT_PAIRWISE_INSTRUCTIONS,
});

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();

const hasModelApiKey = () =>
  Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const containsAny = (text: string, keywords: string[]) =>
  keywords.some((keyword) => {
    const k = clean(keyword);
    return Boolean(k) && text.includes(k);
  });

const fallbackJudge = (input: SeriesTextJudgeInput): SeriesTextJudgeOutput => {
  const aggregateText = clean(
    [
      input.candidate.seed.one_line_hook,
      input.candidate.premise,
      input.candidate.overview,
      input.candidate.season_goal,
      ...input.candidate.characters.map((row) => `${row.name} ${row.goal} ${row.arc_start} ${row.arc_end}`),
      ...input.candidate.checkpoints.map((row) => `${row.title} ${row.purpose} ${row.carry_over}`),
      input.candidate.first_episode_seed.carry_over_hint,
    ].join(" ")
  );

  const intentFit = containsAny(aggregateText, input.user_rubric.must_haves) ? 0.82 : 0.64;
  const emotionalFit = containsAny(aggregateText, input.preference_sheet.emotional_rewards) ? 0.8 : 0.6;
  const relationshipFit = containsAny(
    aggregateText,
    input.preference_sheet.desired_relationship_dynamics
  )
    ? 0.78
    : 0.58;
  const worldOriginality = input.candidate.seed.uniqueness_claims.length >= 2 ? 0.74 : 0.55;
  const vividness = input.candidate.characters.some((row) => clean(row.arc_end).length > 0) ? 0.76 : 0.56;
  const returnDesire = clean(input.candidate.first_episode_seed.carry_over_hint).length >= 12 ? 0.8 : 0.57;
  const clonePenalty = containsAny(aggregateText, input.anti_brief.banned_generic_patterns) ? 0.72 : 0.28;

  const rejectReasons: string[] = [];
  if (intentFit < 0.55) rejectReasons.push("intent_fit_low");
  if (relationshipFit < 0.5) rejectReasons.push("relationship_fit_low");
  if (clonePenalty > 0.65) rejectReasons.push("clone_penalty_high");

  return {
    candidate_id: input.candidate.candidate_id,
    score: {
      intent_fit: clamp01(intentFit),
      emotional_reward_fit: clamp01(emotionalFit),
      relationship_fit: clamp01(relationshipFit),
      world_originality: clamp01(worldOriginality),
      character_vividness: clamp01(vividness),
      return_desire: clamp01(returnDesire),
      clone_penalty: clamp01(clonePenalty),
      rationale: rejectReasons.length > 0 ? `fallback: ${rejectReasons.join(",")}` : "fallback: acceptable",
    },
    reject: rejectReasons.length > 0,
    reject_reasons: rejectReasons,
  };
};

const weightedValue = (
  score: z.infer<typeof seriesTextJudgeScoreSchema>,
  weights: z.infer<typeof userSeriesRubricSchema>["intent_fit_weights"]
) => {
  return (
    score.intent_fit * weights.intent_fit +
    score.emotional_reward_fit * weights.emotional_reward_fit +
    score.relationship_fit * weights.relationship_fit +
    score.world_originality * weights.world_originality +
    score.character_vividness * weights.character_vividness +
    score.return_desire * weights.return_desire -
    score.clone_penalty * weights.clone_penalty
  );
};

const tieBreakScore = (candidate: z.infer<typeof seriesTextJudgeCandidateSchema>) =>
  candidate.seed.uniqueness_claims.length * 0.04 +
  candidate.checkpoints.length * 0.02 +
  candidate.first_episode_seed.spot_requirements.length * 0.03;

export const evaluateSeriesTextCandidate = async (
  input: SeriesTextJudgeInput
): Promise<SeriesTextJudgeOutput> => {
  if (!hasModelApiKey()) {
    console.warn("[series-text-judge-agent] API key not found, fallback text judge used");
    return fallbackJudge(input);
  }

  const prompt = `
## user preference
- emotional_rewards: ${input.preference_sheet.emotional_rewards.join(" / ")}
- desired_relationship_dynamics: ${input.preference_sheet.desired_relationship_dynamics.join(" / ")}
- continuation_needs: ${input.preference_sheet.continuation_needs.join(" / ")}
- must_haves: ${input.user_rubric.must_haves.join(" / ")}
- must_avoid: ${input.user_rubric.must_avoid.join(" / ")}

## anti brief
- banned_generic_patterns: ${input.anti_brief.banned_generic_patterns.join(" / ")}
- banned_cliches: ${input.anti_brief.banned_cliches.join(" / ")}

## candidate
- id: ${input.candidate.candidate_id}
- seed angle: ${input.candidate.seed.generation_angle}
- title: ${input.candidate.title}
- hook: ${input.candidate.seed.one_line_hook}
- premise: ${input.candidate.premise}
- season_goal: ${input.candidate.season_goal}
- return_reason: ${input.candidate.seed.return_reason}
- ending_flavor: ${input.candidate.seed.ending_flavor}
- characters: ${input.candidate.characters.map((row) => `${row.name}(${row.role})`).join(" / ")}
- checkpoint_count: ${input.candidate.checkpoints.length}
- first_episode_seed.carry_over_hint: ${input.candidate.first_episode_seed.carry_over_hint}

seriesTextJudgeOutputSchema を満たす JSON のみ返してください。
`;

  const timeoutMs = 35_000;
  try {
    const result = await Promise.race([
      seriesTextJudgeAgent.generate(prompt, {
        structuredOutput: { schema: seriesTextJudgeOutputSchema },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${timeoutMs / 1000}秒タイムアウト`)), timeoutMs)
      ),
    ]);

    const parsed = seriesTextJudgeOutputSchema.safeParse(result.object);
    if (parsed.success) return parsed.data;
  } catch {
    // fallback
  }

  return fallbackJudge(input);
};

export const compareSeriesTextCandidatesPairwise = async (
  input: SeriesTextPairwiseInput,
  leftScore: z.infer<typeof seriesTextJudgeScoreSchema>,
  rightScore: z.infer<typeof seriesTextJudgeScoreSchema>
): Promise<SeriesTextPairwiseOutput> => {
  const fallback = (() => {
    const leftValue = weightedValue(leftScore, input.user_rubric.intent_fit_weights);
    const rightValue = weightedValue(rightScore, input.user_rubric.intent_fit_weights);
    const diff = leftValue - rightValue;
    const leftWins =
      Math.abs(diff) < 0.02
        ? tieBreakScore(input.left) >= tieBreakScore(input.right)
        : diff >= 0;
    return {
      winner_candidate_id: leftWins ? input.left.candidate_id : input.right.candidate_id,
      loser_candidate_id: leftWins ? input.right.candidate_id : input.left.candidate_id,
      confidence: Math.max(0.5, Math.min(0.95, Math.abs(leftValue - rightValue) + 0.5)),
      rationale: leftWins
        ? "fallback weighted score で左候補が優位"
        : "fallback weighted score で右候補が優位",
    } satisfies SeriesTextPairwiseOutput;
  })();

  if (!hasModelApiKey()) {
    console.warn("[series-text-judge-agent] API key not found, fallback pairwise judge used");
    return fallback;
  }

  const prompt = `
## preference summary
- emotional_rewards: ${input.preference_sheet.emotional_rewards.join(" / ")}
- desired_relationship_dynamics: ${input.preference_sheet.desired_relationship_dynamics.join(" / ")}
- continuation_needs: ${input.preference_sheet.continuation_needs.join(" / ")}

left:
- id: ${input.left.candidate_id}
- title: ${input.left.title}
- hook: ${input.left.seed.one_line_hook}
- premise: ${input.left.premise}
- relation: ${input.left.seed.central_relationship_dynamic}
- ending: ${input.left.seed.ending_flavor}
- score_hint: intent=${leftScore.intent_fit.toFixed(2)} originality=${leftScore.world_originality.toFixed(2)} clone=${leftScore.clone_penalty.toFixed(2)}

right:
- id: ${input.right.candidate_id}
- title: ${input.right.title}
- hook: ${input.right.seed.one_line_hook}
- premise: ${input.right.premise}
- relation: ${input.right.seed.central_relationship_dynamic}
- ending: ${input.right.seed.ending_flavor}
- score_hint: intent=${rightScore.intent_fit.toFixed(2)} originality=${rightScore.world_originality.toFixed(2)} clone=${rightScore.clone_penalty.toFixed(2)}

seriesTextPairwiseOutputSchema を満たす JSON のみ返してください。
`;

  const timeoutMs = 35_000;
  try {
    const result = await Promise.race([
      seriesTextPairwiseAgent.generate(prompt, {
        structuredOutput: { schema: seriesTextPairwiseOutputSchema },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${timeoutMs / 1000}秒タイムアウト`)), timeoutMs)
      ),
    ]);
    const parsed = seriesTextPairwiseOutputSchema.safeParse(result.object);
    if (parsed.success) return parsed.data;
  } catch {
    // fallback
  }

  return fallback;
};
