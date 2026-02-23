import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_CHAPTER_MODEL } from "../modelConfig";

export const chapterAgentInputSchema = z.object({
  spotIndex: z.number().int(),
  spotCount: z.number().int(),
  spotName: z.string(),
  tourismAnchor: z.string(),
  tourismFocus: z.string(),
  sceneRole: z.enum(["起", "承", "転", "結"]),
  sceneObjective: z.string(),
  scenePurpose: z.string(),
  chapterHook: z.string(),
  keyClue: z.string(),
  tensionLevel: z.number().int().min(1).max(10),
  mission: z.string(),
  narrativeVoice: z.enum(["past", "present"]),
  playerName: z.string().optional(),
  previousSummary: z.string().optional(),
  previousClue: z.string().optional(),
  characters: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      personality: z.string(),
      voice_profile: z.object({
        vocabulary: z.string(),
        emotional_range: z.string(),
        style: z.string(),
        catchphrases: z.array(z.string()),
        dialect_notes: z.string().optional(),
      }),
    })
  ),
});

export const chapterBlockSchema = z.object({
  type: z.enum(["narration", "dialogue", "mission"]),
  text: z.string(),
  speaker_id: z.string().optional(),
  expression: z.enum(["neutral", "smile", "serious", "surprise", "excited"]).optional(),
});

export const chapterAgentOutputSchema = z.object({
  chapter_text: z.string(),
  blocks: z.array(chapterBlockSchema),
  summary: z.string(),
  newClue: z.string().optional(),
});

export type ChapterAgentInput = z.infer<typeof chapterAgentInputSchema>;
export type ChapterAgentOutput = z.infer<typeof chapterAgentOutputSchema>;

const CHAPTER_AGENT_INSTRUCTIONS = `
あなたは小説の「1章」を書く専門エージェントです。
地の文（第三者視点）を主役にし、会話は補助的に挿入します。

## 出力ルール
- blocks は「narration / dialogue / mission」だけ
- narration は最も多く、dialogue は少なめ
- dialogue は1行60文字以内、地の文は120文字以内
- mission は1回だけ挿入（ラベル表記は使わず、自然な地の文で書く）
- 各ブロックは時系列順に並べる
- 直前の章の要素（previousSummary または previousClue）を必ず1回参照する
- 観光要素と sceneObjective を必ず地の文に含める
- 自己紹介の定型文は禁止
- 登場人物は必要な分だけ登場させる（全員登場は不要）
- 「sceneObjective」「ミッション」「目的」などのラベル表記は禁止
- 章の最後に次の章へのフックを必ず含める
- 次の定型文は **絶対に使わない**:
  - 「この件に詳しい」「現場の事情を知っている」「今日は力になれると思う」「状況の整理に協力する」
  - 「えっと…今の話、少し言い直させて」

## 小説品質指針（NovelGenerator思想を踏襲）
- 70〜85% は地の文、15〜30% は会話
- 感情は行動や描写で示す（show, don’t tell）
- 各章に必ず「小さな不完全さ」「身体感覚」「未解決の余韻」を含める
`;

export const chapterAgent = new Agent({
  id: "chapter-agent",
  name: "chapter-agent",
  model: MASTRA_CHAPTER_MODEL,
  instructions: CHAPTER_AGENT_INSTRUCTIONS,
});

const clean = (value?: string) => (value || "").replace(/\s+/g, " ").trim();

const buildFallbackChapter = (input: ChapterAgentInput): ChapterAgentOutput => {
  const speakerId = input.characters[0]?.id || "char_1";
  const missionText = `${input.sceneObjective}ために、次へ進む手がかりを整理する。`;
  const blocks: ChapterAgentOutput["blocks"] = [
    {
      type: "narration",
      text: clean(`${input.spotName}に到着する。${input.tourismFocus}`) || `${input.spotName}に到着する。`,
    },
    {
      type: "dialogue",
      speaker_id: speakerId,
      expression: "serious",
      text: clean(`ここで${input.sceneObjective}。焦らず手順を確認しよう。`),
    },
    {
      type: "mission",
      text: missionText,
    },
    {
      type: "narration",
      text: clean(`${input.chapterHook} ${input.keyClue ? `手がかりは「${input.keyClue}」。` : ""}`),
    },
  ];
  const filteredBlocks = blocks.filter((block) => clean(block.text).length > 0);

  const chapterText = filteredBlocks.map((block) => block.text).join("\n");
  return {
    chapter_text: chapterText,
    blocks: filteredBlocks.length > 0 ? filteredBlocks : blocks,
    summary: clean(`${input.spotName}で${input.sceneObjective}を進めた。`),
    newClue: clean(input.keyClue) || clean(`${input.spotName}で得た断片`),
  };
};

const normalizeChapterOutput = (
  input: ChapterAgentInput,
  raw: unknown
): ChapterAgentOutput | null => {
  const parsed = chapterAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const output = parsed.data;
  const fallback = buildFallbackChapter(input);
  const normalizedBlocks = Array.isArray(output.blocks)
    ? output.blocks
        .map((block) => ({
          ...block,
          text: clean(block.text),
        }))
        .filter((block) => block.text.length > 0)
    : [];

  return {
    chapter_text: clean(output.chapter_text) || fallback.chapter_text,
    blocks: normalizedBlocks.length > 0 ? normalizedBlocks : fallback.blocks,
    summary: clean(output.summary) || fallback.summary,
    newClue: clean(output.newClue) || fallback.newClue,
  };
};

export const generateChapter = async (input: ChapterAgentInput): Promise<ChapterAgentOutput> => {
  const prompt = `
## 章情報
- 章: ${input.spotIndex + 1}/${input.spotCount}
- スポット: ${input.spotName}
- 観光要素: ${input.tourismFocus}
- 役割: ${input.sceneRole}
- 目的: ${input.sceneObjective}
- 章フック: ${input.chapterHook}
- 伏線/手がかり: ${input.keyClue}
- 緊張度: ${input.tensionLevel}/10
- 物語の目的: ${input.mission}
- 語り口: ${input.narrativeVoice === "present" ? "現在形" : "過去形"}
- プレイヤー名: ${input.playerName || "旅人"}

## 前章の情報
${input.previousSummary ? `- 直前の要約: ${input.previousSummary}` : "- 直前の要約: なし"}
${input.previousClue ? `- 直前の手がかり: ${input.previousClue}` : "- 直前の手がかり: なし"}

## 登場人物（口調を遵守）
${input.characters
  .map(
    (c) =>
      `- ${c.id} ${c.name} (${c.role}) / 口調: ${c.voice_profile.style}, 語彙: ${c.voice_profile.vocabulary}, 感情: ${c.voice_profile.emotional_range}`
  )
  .join("\n")}

上記を基に chapterAgentOutputSchema を満たす JSON を出力してください。
`;

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await chapterAgent.generate(prompt, {
        structuredOutput: { schema: chapterAgentOutputSchema },
      });
      const normalized = normalizeChapterOutput(input, response.object);
      if (normalized) return normalized;
    } catch (error) {
      console.warn("[chapter-agent] generation failed", { attempt, spot: input.spotName, error });
    }
  }
  console.warn("[chapter-agent] fallback chapter used", { spot: input.spotName });
  return buildFallbackChapter(input);
};
