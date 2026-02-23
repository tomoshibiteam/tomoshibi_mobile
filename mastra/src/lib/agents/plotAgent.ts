import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_PLOT_MODEL } from "../modelConfig";
import {
  buildDefaultObjectiveMissionLink,
  normalizeObjectiveMissionLink,
  objectiveMissionLinkSchema,
} from "../objectiveMissionLink";

export const plotAgentInputSchema = z.object({
  prompt: z.string(),
  spotCount: z.number().int().min(2).max(12),
  playerName: z.string().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  spots: z.array(
    z.object({
      index: z.number().int(),
      name: z.string(),
      tourismAnchor: z.string().optional(),
      tourismKeywords: z.array(z.string()).default([]),
    })
  ),
});

export const plotAgentOutputSchema = z.object({
  title: z.string(),
  one_liner: z.string(),
  mission: z.string(),
  premise: z.string(),
  epilogue: z.string(),
  narrative_voice: z.enum(["past", "present"]).default("past"),
  characters: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      personality: z.string(),
      image_prompt: z.string(),
      voice_profile: z.object({
        vocabulary: z.enum(["formal", "casual", "street", "archaic"]),
        emotional_range: z.enum(["reserved", "expressive", "volatile", "stoic"]),
        style: z.enum(["direct", "indirect", "verbose", "terse", "poetic"]),
        catchphrases: z.array(z.string()),
        dialect_notes: z.string().optional(),
      }),
    })
  ),
  chapters: z.array(
    z.object({
      spotIndex: z.number().int(),
      spotName: z.string(),
      sceneRole: z.enum(["起", "承", "転", "結"]),
      objective: z.string(),
      purpose: z.string(),
      chapterHook: z.string(),
      tourismFocus: z.string(),
      keyClue: z.string(),
      tensionLevel: z.number().int().min(1).max(10),
      chapterSummary: z.string(),
      objective_mission_link: objectiveMissionLinkSchema,
    })
  ),
});

export type PlotAgentInput = z.infer<typeof plotAgentInputSchema>;
export type PlotAgentOutput = z.infer<typeof plotAgentOutputSchema>;

const PLOT_AGENT_INSTRUCTIONS = `
あなたは小説の設計者です。与えられた観光スポットを「章」と見立て、
全体の物語構造と各章の目的を設計してください。

## 基本方針
- 小説として成立する骨格（起承転結、伏線、回収）を必ず作る
- 観光情報は物語の意味として織り込む
- 会話ではなく「地の文が主役」になる前提で設計する
- 章ごとに目的・緊張・発見が変化すること

## 出力の注意
- 各章は spotIndex に一致させる
- sceneRole は 起→承→転→結 の順序で配置（spotCountに合わせて配分）
  - objective は「ミッション成功後に達成される成果（完了状態）」を書く
  - objective / purpose / chapterHook / keyClue は具体的に
  - tensionLevel は 1〜10 の整数で出力
- characters は「主人公（プレイヤー）以外の登場人物」を最低4人（推奨4〜6人）出力する
- 主人公（プレイヤー）は characters に含めない
- 主人公の personality / image_prompt / voice_profile は出力しない
- characters の口調は被らないようにし、id は char_1 から連番にする
- narrative_voice は past / present を物語に合わせて選ぶ
- 各 chapter.objective_mission_link には、そのスポットの tourismKeywords（特有キーワード）を最低1語反映する
`;

export const plotAgent = new Agent({
  id: "plot-agent",
  name: "plot-agent",
  model: MASTRA_PLOT_MODEL,
  instructions: PLOT_AGENT_INSTRUCTIONS,
});

const normalizeText = (value?: string) => (value || "").replace(/\s+/g, " ").trim();
const normalizeLoose = (value?: string) => (value || "").toLowerCase().replace(/[\s　]+/g, "");
const clampTension = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(10, parsed));
};

const sceneRoleForIndex = (index: number, spotCount: number): "起" | "承" | "転" | "結" => {
  if (spotCount <= 2) return index === 0 ? "起" : "結";
  if (index === 0) return "起";
  if (index === spotCount - 1) return "結";
  const middleCount = spotCount - 2;
  const relative = index - 1;
  return relative < Math.ceil(middleCount / 2) ? "承" : "転";
};

const DEFAULT_CHARACTERS: PlotAgentOutput["characters"] = [
  {
    id: "char_1",
    name: "案内人",
    role: "現地を導くガイド",
    personality: "慎重で観察力が高い",
    image_prompt: "落ち着いた服装の地元ガイド、自然な笑顔",
    voice_profile: {
      vocabulary: "formal",
      emotional_range: "reserved",
      style: "direct",
      catchphrases: ["まず事実を確認しよう"],
      dialect_notes: "",
    },
  },
  {
    id: "char_2",
    name: "記録係",
    role: "資料を読み解く相棒",
    personality: "知的で丁寧、仮説を積み上げる",
    image_prompt: "ノートを持つ調査役、知的な雰囲気",
    voice_profile: {
      vocabulary: "formal",
      emotional_range: "expressive",
      style: "verbose",
      catchphrases: ["記録には必ず理由が残る"],
      dialect_notes: "",
    },
  },
  {
    id: "char_3",
    name: "ムードメーカー",
    role: "場を動かす同行者",
    personality: "行動的で直感が鋭い",
    image_prompt: "軽装で活発な探検者、前向きな表情",
    voice_profile: {
      vocabulary: "casual",
      emotional_range: "volatile",
      style: "terse",
      catchphrases: ["行って確かめよう"],
      dialect_notes: "",
    },
  },
  {
    id: "char_4",
    name: "語り部",
    role: "土地の記憶を伝える人物",
    personality: "静かで余韻のある語り口",
    image_prompt: "歴史を語る地元の語り部、柔らかな光",
    voice_profile: {
      vocabulary: "archaic",
      emotional_range: "stoic",
      style: "poetic",
      catchphrases: ["土地は記憶を隠さない"],
      dialect_notes: "",
    },
  },
];

const DEFAULT_VOICE_PROFILE: PlotAgentOutput["characters"][number]["voice_profile"] = {
  vocabulary: "formal",
  emotional_range: "reserved",
  style: "direct",
  catchphrases: ["事実を整理しよう"],
  dialect_notes: "",
};

const isProtagonistCharacter = (
  input: PlotAgentInput,
  character: PlotAgentOutput["characters"][number]
) => {
  const id = normalizeLoose(character.id);
  const name = normalizeLoose(character.name);
  const role = normalizeLoose(character.role);
  const personality = normalizeLoose(character.personality);
  const player = normalizeLoose(input.playerName || "旅人");

  if (id === "player" || id === "protagonist" || id.startsWith("player_")) return true;
  if (player && (name === player || name.includes(player) || role.includes(player))) return true;

  const protagonistHints = ["主人公", "プレイヤー", "player", "protagonist", "旅人", "あなた", "君"];
  return protagonistHints.some((hint) => {
    const token = normalizeLoose(hint);
    return name.includes(token) || role.includes(token) || personality.includes(token);
  });
};

const normalizeCharactersForOutput = (
  input: PlotAgentInput,
  rawCharacters: PlotAgentOutput["characters"],
  fallbackCharacters: PlotAgentOutput["characters"]
): PlotAgentOutput["characters"] => {
  const merged: PlotAgentOutput["characters"] = [];
  const seen = new Set<string>();

  const pushUnique = (character: PlotAgentOutput["characters"][number]) => {
    const key = `${normalizeLoose(character.name)}::${normalizeLoose(character.role)}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(character);
  };

  rawCharacters
    .filter((character) => !isProtagonistCharacter(input, character))
    .forEach((character) => pushUnique(character));

  fallbackCharacters.forEach((character) => {
    if (merged.length < 4) pushUnique(character);
  });

  while (merged.length < 4) {
    const idx = merged.length + 1;
    const base = fallbackCharacters[(idx - 1) % fallbackCharacters.length] || fallbackCharacters[0];
    pushUnique({
      id: `char_${idx}`,
      name: `${base?.name || "同行者"}${idx}`,
      role: base?.role || "調査同行者",
      personality: base?.personality || "落ち着いて状況を観察する",
      image_prompt: base?.image_prompt || "観光地で手がかりを探す同行者",
      voice_profile: base?.voice_profile || DEFAULT_VOICE_PROFILE,
    });
  }

  const capped = merged.slice(0, 6);
  return capped.map((character, idx) => ({
    ...character,
    id: `char_${idx + 1}`,
  }));
};

const buildFallbackPlotPlan = (input: PlotAgentInput): PlotAgentOutput => {
  const firstSpot = input.spots[0]?.name || "この地";
  const title = `${firstSpot}を巡る歴史ミステリー`;
  const mission = `${firstSpot}を起点に、散らばる手がかりをつなぎ真相へ至る`;

  const chapters: PlotAgentOutput["chapters"] = input.spots.map((spot, idx) => {
    const role = sceneRoleForIndex(idx, input.spotCount);
    const objective =
      role === "起"
        ? "最初の手がかりの所在を特定できた"
        : role === "承"
          ? "手がかり同士の関係を説明できた"
          : role === "転"
            ? "矛盾を生む原因を特定できた"
            : "真相を一つの結論として示せた";
    const keyClue =
      role === "結" ? "全ての地点に共通する時代背景" : `${spot.name}に残る記録の断片`;
    const objectiveMissionLink = buildDefaultObjectiveMissionLink({
      spotName: spot.name,
      objectiveResult: objective,
      keyClue,
      tourismAnchor: spot.tourismAnchor,
      tourismKeywords: spot.tourismKeywords,
    });
    return {
      spotIndex: idx,
      spotName: spot.name,
      sceneRole: role,
      objective,
      purpose: "物語を段階的に進める",
      chapterHook: role === "結" ? "最後の断片がつながり、真実が見える。" : "次の地点に続く手がかりが示される。",
      tourismFocus: normalizeText(spot.tourismAnchor) || `${spot.name}の地域的背景`,
      keyClue,
      tensionLevel: Math.max(1, Math.min(10, 4 + idx)),
      chapterSummary: `${spot.name}で${objective}。${keyClue}を得る。`,
      objective_mission_link: objectiveMissionLink,
    };
  });

  return {
    title,
    one_liner: `${input.prompt}をもとに、観光地を辿って真相へ迫る。`,
    mission,
    premise: `${firstSpot}から始まる調査は、各地点の観光要素に隠れた共通点を浮かび上がらせる。`,
    epilogue: "得られた手がかりは一つの系譜に収束し、土地の歴史に新しい輪郭を与えた。",
    narrative_voice: "past",
    characters: DEFAULT_CHARACTERS,
    chapters,
  };
};

const normalizePlotPlan = (input: PlotAgentInput, raw: unknown): PlotAgentOutput | null => {
  const parsed = plotAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const output = parsed.data;
  const fallback = buildFallbackPlotPlan(input);

  const chapters = input.spots.map((spot, idx) => {
    const chapter =
      output.chapters.find((item) => item.spotIndex === idx) ||
      output.chapters[idx];
    if (!chapter) return fallback.chapters[idx];
    const rawObjective =
      normalizeText(chapter.objective) || fallback.chapters[idx].objective;
    const objectiveMissionLink = normalizeObjectiveMissionLink({
      spotName: spot.name,
      objectiveResult: rawObjective,
      link: chapter.objective_mission_link,
      keyClue: normalizeText(chapter.keyClue) || fallback.chapters[idx].keyClue,
      tourismAnchor: normalizeText(chapter.tourismFocus) || spot.tourismAnchor,
      tourismKeywords: spot.tourismKeywords,
    });
    return {
      spotIndex: idx,
      spotName: normalizeText(chapter.spotName) || spot.name || `スポット${idx + 1}`,
      sceneRole: chapter.sceneRole || sceneRoleForIndex(idx, input.spotCount),
      objective: objectiveMissionLink.objective_result,
      purpose: normalizeText(chapter.purpose) || fallback.chapters[idx].purpose,
      chapterHook: normalizeText(chapter.chapterHook) || fallback.chapters[idx].chapterHook,
      tourismFocus: normalizeText(chapter.tourismFocus) || spot.tourismAnchor || fallback.chapters[idx].tourismFocus,
      keyClue: normalizeText(chapter.keyClue) || fallback.chapters[idx].keyClue,
      tensionLevel: clampTension(chapter.tensionLevel, fallback.chapters[idx].tensionLevel),
      chapterSummary: normalizeText(chapter.chapterSummary) || fallback.chapters[idx].chapterSummary,
      objective_mission_link: objectiveMissionLink,
    };
  });

  const characters =
    Array.isArray(output.characters) && output.characters.length > 0
      ? normalizeCharactersForOutput(input, output.characters, fallback.characters)
      : normalizeCharactersForOutput(input, fallback.characters, fallback.characters);

  return {
    title: normalizeText(output.title) || fallback.title,
    one_liner: normalizeText(output.one_liner) || fallback.one_liner,
    mission: normalizeText(output.mission) || fallback.mission,
    premise: normalizeText(output.premise) || fallback.premise,
    epilogue: normalizeText(output.epilogue) || fallback.epilogue,
    narrative_voice: output.narrative_voice || fallback.narrative_voice,
    characters,
    chapters,
  };
};

export const generatePlotPlan = async (input: PlotAgentInput): Promise<PlotAgentOutput> => {
  const prompt = `
## ストーリー要件
- プレイヤー名: ${input.playerName || "旅人"}
- 難易度: ${input.difficulty || "medium"}
- スポット数: ${input.spotCount}
- ユーザーの要望: ${input.prompt}

## characters 生成制約（最重要）
- characters は「主人公（プレイヤー）以外の登場人物」のみを出力する
- 主人公（プレイヤー）の personality / image_prompt / voice_profile は出力しない
- 主人公以外の登場人物を最低4人（推奨4〜6人）出力する
- characters の id は char_1 から連番にする

## objective と mission の因果制約（最重要）
- 各 chapter.objective は「謎に正解した後に達成される成果（完了状態）」にする
- 各 chapter に objective_mission_link を必ず付ける
  - objective_result: objective と同じ成果
  - mission_question: その成果を達成するためにユーザーへ出す問い
  - expected_answer: mission_question の正答（短く一意、1語〜12文字目安、文ではなく名詞句）
  - success_outcome: expected_answer を得たことで達成される結果（objective_result と整合）
  - tourism_keywords: 観光情報から抽出した特有キーワード（配列）
  - anchor_keyword: tourism_keywords の中で主に使う語
- objective_mission_link は tourism_keywords の語を最低1つ反映し、物語文脈（objective_result）と因果を接続する

## スポット一覧（順番固定）
${input.spots
  .map(
    (spot) =>
      `- [${spot.index}] ${spot.name} / 観光要素: ${spot.tourismAnchor || "未指定"} / 特有キーワード: ${
        spot.tourismKeywords?.join("、") || "なし"
      }`
  )
  .join("\n")}

上記条件に従って plotAgentOutputSchema を満たす JSON を出力してください。
`;

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await plotAgent.generate(prompt, {
        structuredOutput: { schema: plotAgentOutputSchema },
      });
      const normalized = normalizePlotPlan(input, response.object);
      if (normalized) return normalized;
    } catch (error) {
      console.warn("[plot-agent] generation failed", { attempt, error });
    }
  }

  console.warn("[plot-agent] fallback plot plan used");
  return buildFallbackPlotPlan(input);
};
