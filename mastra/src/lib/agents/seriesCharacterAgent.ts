import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SERIES_CHARACTER_MODEL } from "../modelConfig";
import { seriesCharacterSchema } from "../../schemas/series";
import { buildCharacterPortraitPrompt, buildSeriesImageUrl } from "../seriesVisuals";

export const seriesCharacterAgentInputSchema = z.object({
  title: z.string(),
  genre: z.string(),
  tone: z.string(),
  premise: z.string(),
  season_goal: z.string(),
  protagonist_position: z.string(),
  partner_description: z.string(),
  target_count: z.number().int().min(3).max(8).default(4),
});

export const seriesCharacterAgentOutputSchema = z.object({
  characters: z.array(seriesCharacterSchema).min(3).max(8),
});

export type SeriesCharacterAgentInput = z.infer<typeof seriesCharacterAgentInputSchema>;
export type SeriesCharacterAgentOutput = z.infer<typeof seriesCharacterAgentOutputSchema>;

const SERIES_CHARACTER_AGENT_INSTRUCTIONS = `
あなたはシリーズのキャラクターバイブルを設計するエージェントです。
後続エピソード生成で使えるよう、各人物の「初期状態→到達状態」を明示してください。

## 必須方針
- 役割が重複しすぎないように設計する
- character.id は char_1 から連番にする
- arc_start / arc_end は価値観や行動原理の変化が分かる文にする
- secrets は後続話で開示できる具体的情報にする
- relationship_hooks は他キャラとの衝突/協力の導線にする
- appearance は見た目・服装・雰囲気を1文で書く
- portrait_prompt は画像生成で使える具体指示にする（テキストなし）
`;

export const seriesCharacterAgent = new Agent({
  id: "series-character-agent",
  name: "series-character-agent",
  model: MASTRA_SERIES_CHARACTER_MODEL,
  instructions: SERIES_CHARACTER_AGENT_INSTRUCTIONS,
});

const clean = (value?: string) => (value || "").replace(/\s+/g, " ").trim();

const hasModelApiKey = () =>
  Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );

const withVisuals = (
  input: SeriesCharacterAgentInput,
  character: {
    id: string;
    name: string;
    role: string;
    goal: string;
    arc_start: string;
    arc_end: string;
    personality: string;
    appearance: string;
    secrets: string[];
    relationship_hooks: string[];
  },
  index: number
) => {
  const portraitPrompt = buildCharacterPortraitPrompt({
    seriesTitle: input.title,
    genre: input.genre,
    tone: input.tone,
    name: character.name,
    role: character.role,
    personality: character.personality,
    appearance: character.appearance,
    setting: input.premise,
  });

  return {
    ...character,
    portrait_prompt: portraitPrompt,
    portrait_image_url: buildSeriesImageUrl({
      prompt: portraitPrompt,
      seedKey: `${input.title}:char:${index + 1}:${character.name}`,
      width: 768,
      height: 1024,
    }),
  };
};

const fallbackCharacters = (input: SeriesCharacterAgentInput): SeriesCharacterAgentOutput["characters"] => {
  const base = [
    {
      id: "char_1",
      name: "主人公",
      role: input.protagonist_position || "物語の視点人物",
      goal: input.season_goal || "真相へ到達する",
      arc_start: "断片的な情報に振り回される。",
      arc_end: "不確実性を受け入れつつ判断できる。",
      personality: "観察力は高いが、抱え込みやすい。",
      appearance: "落ち着いた装いで、目線が鋭い。",
      secrets: ["過去の選択に未解決の後悔がある。"],
      relationship_hooks: ["相棒への依存と自立の揺れを抱える。"],
    },
    {
      id: "char_2",
      name: "相棒",
      role: input.partner_description || "主人公を支える実務家",
      goal: "主人公の目的達成を補助しつつ自分の信念を守る。",
      arc_start: "感情より効率を優先する。",
      arc_end: "信頼を優先し、危機時には踏み込む。",
      personality: "冷静で機転が利く。",
      appearance: "機能的な服装で、整った姿勢を崩さない。",
      secrets: ["敵側と接点を持っていた時期がある。"],
      relationship_hooks: ["主人公と衝突しながら協働の型を作る。"],
    },
    {
      id: "char_3",
      name: "調停者",
      role: "対立陣営の橋渡し役",
      goal: "大きな衝突を避けつつ均衡を保つ。",
      arc_start: "中立を守ることだけを重視する。",
      arc_end: "中立では守れないもののため選択する。",
      personality: "穏やかだが計算高い。",
      appearance: "柔らかな笑顔だが、目の奥に緊張感がある。",
      secrets: ["序盤の事件に直接関与している。"],
      relationship_hooks: ["主人公陣営の信頼を試す立場にある。"],
    },
    {
      id: "char_4",
      name: "対抗者",
      role: "同じ目的を別手段で追うライバル",
      goal: "主人公より先に核心を掴み主導権を握る。",
      arc_start: "結果のためなら手段を選ばない。",
      arc_end: "代償を知り、共闘の余地を見出す。",
      personality: "大胆で挑発的。",
      appearance: "印象的なアクセントカラーを身に着けた攻めた装い。",
      secrets: ["主人公と同じ手がかりを密かに保有する。"],
      relationship_hooks: ["競合しつつ、終盤で限定的に共闘する。"],
    },
  ];

  return base.map((character, index) => withVisuals(input, character, index));
};

const dedupeCharacters = (characters: SeriesCharacterAgentOutput["characters"]) => {
  const seen = new Set<string>();
  return characters.filter((character) => {
    const key = clean(character.name).toLowerCase();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeCharacter = (
  raw: SeriesCharacterAgentOutput["characters"][number],
  fallback: SeriesCharacterAgentOutput["characters"][number],
  index: number
): SeriesCharacterAgentOutput["characters"][number] => {
  const secrets = Array.isArray(raw.secrets)
    ? raw.secrets.map((item) => clean(item)).filter(Boolean)
    : [];
  const relationshipHooks = Array.isArray(raw.relationship_hooks)
    ? raw.relationship_hooks.map((item) => clean(item)).filter(Boolean)
    : [];

  return {
    id: `char_${index + 1}`,
    name: clean(raw.name) || fallback.name,
    role: clean(raw.role) || fallback.role,
    goal: clean(raw.goal) || fallback.goal,
    arc_start: clean(raw.arc_start) || fallback.arc_start,
    arc_end: clean(raw.arc_end) || fallback.arc_end,
    personality: clean(raw.personality) || fallback.personality,
    appearance: clean(raw.appearance) || fallback.appearance,
    portrait_prompt: clean(raw.portrait_prompt) || fallback.portrait_prompt,
    portrait_image_url: clean(raw.portrait_image_url) || fallback.portrait_image_url,
    secrets: secrets.length > 0 ? secrets : fallback.secrets,
    relationship_hooks: relationshipHooks.length > 0 ? relationshipHooks : fallback.relationship_hooks,
  };
};

const normalizeCharacterOutput = (
  input: SeriesCharacterAgentInput,
  raw: unknown
): SeriesCharacterAgentOutput | null => {
  const parsed = seriesCharacterAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const fallback = fallbackCharacters(input);
  const deduped = dedupeCharacters(parsed.data.characters);

  const merged = [...deduped, ...fallback].slice(0, Math.max(3, input.target_count));
  return {
    characters: merged
      .slice(0, 8)
      .map((character, index) => {
        const normalized = normalizeCharacter(character, fallback[index] || fallback[0], index);
        const portraitPrompt =
          clean(normalized.portrait_prompt) ||
          buildCharacterPortraitPrompt({
            seriesTitle: input.title,
            genre: input.genre,
            tone: input.tone,
            name: normalized.name,
            role: normalized.role,
            personality: normalized.personality,
            appearance: normalized.appearance,
            setting: input.premise,
          });

        return {
          ...normalized,
          portrait_prompt: portraitPrompt,
          portrait_image_url:
            clean(normalized.portrait_image_url) ||
            buildSeriesImageUrl({
              prompt: portraitPrompt,
              seedKey: `${input.title}:char:${index + 1}:${normalized.name}`,
              width: 768,
              height: 1024,
            }),
        };
      }),
  };
};

export const generateSeriesCharacters = async (
  input: SeriesCharacterAgentInput
): Promise<SeriesCharacterAgentOutput> => {
  if (!hasModelApiKey()) {
    console.warn("[series-character-agent] API key not found, fallback characters used");
    return { characters: fallbackCharacters(input).slice(0, input.target_count) };
  }

  const prompt = `
## シリーズ情報
- タイトル: ${input.title}
- ジャンル: ${input.genre}
- トーン: ${input.tone}
- 前提: ${input.premise}
- シーズン目標: ${input.season_goal}
- 主人公の立ち位置: ${input.protagonist_position}
- 相棒像: ${input.partner_description}
- 目標キャラ数: ${input.target_count}

seriesCharacterAgentOutputSchema を満たす JSON を返してください。
`;

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await seriesCharacterAgent.generate(prompt, {
        structuredOutput: { schema: seriesCharacterAgentOutputSchema },
      });
      const normalized = normalizeCharacterOutput(input, response.object);
      if (normalized) return normalized;
    } catch (error) {
      console.warn("[series-character-agent] generation failed", { attempt, error });
    }
  }

  console.warn("[series-character-agent] fallback characters used");
  return { characters: fallbackCharacters(input).slice(0, input.target_count) };
};
