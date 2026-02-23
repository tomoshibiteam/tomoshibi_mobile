import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_PUZZLE_MODEL } from "../modelConfig";
import {
  containsLooseFragment,
  normalizeObjectiveMissionLink,
  objectiveMissionLinkSchema,
} from "../objectiveMissionLink";

export const puzzleAgentInputSchema = z.object({
  spotName: z.string(),
  tourismAnchor: z.string(),
  sceneObjective: z.string(),
  mission: z.string(),
  sceneRole: z.enum(["起", "承", "転", "結"]),
  keyClue: z.string().optional(),
  objective_mission_link: objectiveMissionLinkSchema,
});

export const puzzleAgentOutputSchema = z.object({
  question_text: z.string(),
  answer_text: z.string(),
  hint_text: z.string(),
  explanation_text: z.string(),
});

export type PuzzleAgentInput = z.infer<typeof puzzleAgentInputSchema>;
export type PuzzleAgentOutput = z.infer<typeof puzzleAgentOutputSchema>;

const PUZZLE_AGENT_INSTRUCTIONS = `
あなたは観光×物語の謎を作る専門家です。

## ルール
- 現地観察が必要な謎は禁止（看板/展示/現在の天気など）
- 問題文だけで解けるようにする
- 観光要素と sceneObjective に必ず結びつける
- explanation_text に因果マーカー（だから/理由/手がかり）を必ず含める
- 最終章（sceneRole=結）の謎はミッションに必ず触れる
- 数値計算や単位問題は禁止
- objective_mission_link を最優先で反映する
  - question_text は mission_question と一致する問いを出す
  - answer_text は expected_answer と一致する（1語〜12文字目安）
  - explanation_text で「その答えにより success_outcome が成立する」因果を明示する
`;

export const puzzleAgent = new Agent({
  id: "puzzle-agent",
  name: "puzzle-agent",
  model: MASTRA_PUZZLE_MODEL,
  instructions: PUZZLE_AGENT_INSTRUCTIONS,
});

const CAUSAL_MARKERS = ["だから", "理由", "手がかり", "なので", "結論"];
const ONSITE_TERMS = ["現地", "現場", "看板", "展示", "今", "現在", "その場"];

const sanitize = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/["“”]/g, "")
    .trim();

const buildFallbackPuzzle = (input: PuzzleAgentInput): PuzzleAgentOutput => ({
  question_text: sanitize(input.objective_mission_link.mission_question),
  answer_text: sanitize(input.objective_mission_link.expected_answer),
  hint_text: sanitize(
    `${input.tourismAnchor.slice(0, 40)} を、${input.objective_mission_link.objective_result}の成立条件として読み直す。`
  ),
  explanation_text: sanitize(
    `${input.tourismAnchor.slice(0, 80)}が判断材料になる。だから「${input.objective_mission_link.expected_answer}」に到達し、${input.objective_mission_link.success_outcome}が成立する。`
  ),
});

const normalizePuzzleOutput = (
  input: PuzzleAgentInput,
  raw: unknown
): PuzzleAgentOutput | null => {
  const parsed = puzzleAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const output = parsed.data;
  const fallback = buildFallbackPuzzle(input);
  return {
    question_text: sanitize(output.question_text) || fallback.question_text,
    answer_text: sanitize(output.answer_text) || fallback.answer_text,
    hint_text: sanitize(output.hint_text) || fallback.hint_text,
    explanation_text: sanitize(output.explanation_text) || fallback.explanation_text,
  };
};

export const generatePuzzle = async (input: PuzzleAgentInput): Promise<PuzzleAgentOutput> => {
  const objectiveMissionLink = normalizeObjectiveMissionLink({
    spotName: input.spotName,
    objectiveResult: input.sceneObjective,
    link: input.objective_mission_link,
    keyClue: input.keyClue,
    tourismAnchor: input.tourismAnchor,
  });

  const prompt = `
## スポット
- スポット名: ${input.spotName}
- 観光要素: ${input.tourismAnchor}
- 目的: ${input.sceneObjective}
- 章の役割: ${input.sceneRole}
- ミッション: ${input.mission}
- 重要な手がかり: ${input.keyClue || "なし"}

## objective_mission_link（必ず遵守）
- objective_result: ${objectiveMissionLink.objective_result}
- mission_question: ${objectiveMissionLink.mission_question}
- expected_answer: ${objectiveMissionLink.expected_answer}
- success_outcome: ${objectiveMissionLink.success_outcome}

上記に基づいて puzzleAgentOutputSchema を満たす JSON を出力してください。
`;

  let result: PuzzleAgentOutput | null = null;
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await puzzleAgent.generate(prompt, {
        structuredOutput: { schema: puzzleAgentOutputSchema },
      });
      const normalized = normalizePuzzleOutput(input, response.object);
      if (normalized) {
        result = normalized;
        break;
      }
    } catch (error) {
      console.warn("[puzzle-agent] generation failed", { attempt, spot: input.spotName, error });
    }
  }
  if (!result) {
    console.warn("[puzzle-agent] fallback puzzle used", { spot: input.spotName });
    result = buildFallbackPuzzle({
      ...input,
      objective_mission_link: objectiveMissionLink,
    });
  }

  let question = sanitize(result.question_text || "");
  if (!containsLooseFragment(question, objectiveMissionLink.mission_question, 6)) {
    question = objectiveMissionLink.mission_question;
  }

  const answer = objectiveMissionLink.expected_answer;

  let explanation = sanitize(result.explanation_text || "");
  if (!CAUSAL_MARKERS.some((m) => explanation.includes(m))) {
    explanation = `${explanation} だからこの答えになる。`.trim();
  }
  if (!containsLooseFragment(explanation, objectiveMissionLink.success_outcome, 4)) {
    explanation = `${explanation} この答えにより${objectiveMissionLink.success_outcome}。`.trim();
  }

  const cleanse = (text: string) => {
    let next = sanitize(text);
    ONSITE_TERMS.forEach((term) => {
      if (next.includes(term)) next = next.replaceAll(term, "");
    });
    return next.trim();
  };

  return {
    question_text: cleanse(question),
    answer_text: cleanse(answer),
    hint_text: cleanse(result.hint_text || ""),
    explanation_text: explanation,
  };
};
