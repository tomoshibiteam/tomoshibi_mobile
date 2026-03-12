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
  style_guide: z.string().optional(),
  target_count: z.number().int().min(3).max(8).default(4),
});

export const seriesCharacterAgentOutputSchema = z.object({
  characters: z.array(seriesCharacterSchema).min(3).max(8),
});

/** LLM に渡す軽量スキーマ（必須フィールドのみ） */
const lightCharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  tier: z.enum(["primary", "secondary"]).optional(),
  must_appear: z.boolean().optional(),
  goal: z.string(),
  arc_start: z.string(),
  arc_end: z.string(),
  personality: z.string(),
  appearance: z.string(),
  secrets: z.array(z.string()),
  relationship_hooks: z.array(z.string()),
});

const lightOutputSchema = z.object({
  characters: z.array(lightCharacterSchema).min(3).max(8),
});

export type SeriesCharacterAgentInput = z.infer<typeof seriesCharacterAgentInputSchema>;
export type SeriesCharacterAgentOutput = z.infer<typeof seriesCharacterAgentOutputSchema>;

// ─── スキーマと一致した簡潔な指示（応答の安定化・高速化のため） ─────
const SERIES_CHARACTER_AGENT_INSTRUCTIONS = `
あなたはシリーズ用のキャラクター一覧を出力するエージェントです。

## 出力ルール（厳守）
- 指定されたスキーマの型とフィールド名をそのまま使うこと。
- personality は**文字列1つ**（性格の一文要約）。オブジェクトは出さない。
- 各キャラクター: id(char_1〜), name, role, goal, arc_start, arc_end, personality, appearance は必須。
- tier は primary/secondary。
- must_appear は primary のみ true を許可。
- portrait_prompt: 画像生成用の短い英語説明（1文）。portrait_image_url: 空文字 "" でよい。
- secrets, relationship_hooks は文字列の配列（空配列可）。
- 上記以外の拡張フィールドは出力しない（レスポンス短縮のため）。

## 差別化
- キャラ数は3〜5。名前・口癖・dominant_colorは互いに被らせない。
- primary は1〜2人を必須。secondary は最大3人。
- name に「あなた」「アナタ」「プレイヤー」「主人公」「You」など自己参照語を使わない。全員を固有名詞で命名する。
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

// ─── Visual design helpers ─────────────────────────────────────────────
const DOMINANT_COLORS = ["深紅", "群青", "翡翠", "金", "銀灰", "紫紺", "珊瑚", "墨黒"];
const BODY_TYPES = ["長身で引き締まった", "小柄で俊敏な", "がっしりとした", "華奢ながら芯のある"];
const SILHOUETTES = ["鋭角的", "流線型", "角ばった", "柔らかく丸みのある"];
const FEATURES = [
  "右目の下に古い傷痕",
  "左手首に革の腕輪",
  "常にヘッドフォンを首にかけている",
  "片眉の中に白い一筋",
  "右手の甲に小さな刺青",
  "常に手袋を外さない",
  "額にかかる長い前髪",
  "左耳に3つ並んだピアス",
];

const ARCHETYPE_POOL = [
  "Hero", "Innocent", "Everyman", "Caregiver",
  "Explorer", "Rebel", "Lover", "Creator",
  "Jester", "Sage", "Magician", "Ruler",
];

const ENNEAGRAM_FEARS: Record<number, string> = {
  1: "不完全であること",
  2: "必要とされないこと",
  3: "価値がないと思われること",
  4: "平凡で個性がないこと",
  5: "無能で無力であること",
  6: "支えを失い孤立すること",
  7: "苦痛に囚われること",
  8: "他者に支配されること",
  9: "衝突と断絶",
};

const ENNEAGRAM_DESIRES: Record<number, string> = {
  1: "正しくあること",
  2: "愛されること",
  3: "価値ある存在であること",
  4: "自分だけの意味を見出すこと",
  5: "有能で理解すること",
  6: "安全と確実さ",
  7: "満たされ自由であること",
  8: "自分の運命を握ること",
  9: "内なる平穏",
};

const withVisuals = (
  input: SeriesCharacterAgentInput,
  character: {
    id: string;
    name: string;
    role: string;
    tier?: "primary" | "secondary";
    must_appear?: boolean;
    goal: string;
    arc_start: string;
    arc_end: string;
    personality: string;
    appearance: string;
    secrets: string[];
    relationship_hooks: string[];
    visual_design?: {
      dominant_color?: string;
      body_type?: string;
      silhouette_keyword?: string;
      distinguishing_feature?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  },
  index: number
) => {
  const vd = character.visual_design;

  const portraitPrompt = buildCharacterPortraitPrompt({
    seriesTitle: input.title,
    genre: input.genre,
    tone: input.tone,
    name: character.name,
    role: character.role,
    personality: character.personality,
    appearance: character.appearance,
    setting: input.premise,
    dominantColor: vd?.dominant_color,
    bodyType: vd?.body_type,
    distinguishingFeature: vd?.distinguishing_feature,
    styleGuide: input.style_guide,
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

// ─── Rich fallback characters ──────────────────────────────────────────
const fallbackCharacters = (input: SeriesCharacterAgentInput): SeriesCharacterAgentOutput["characters"] => {
  const base = [
    {
      id: "char_1",
      name: "主人公",
      role: input.protagonist_position || "物語の視点人物",
      tier: "primary" as const,
      must_appear: true,
      archetype: "Hero",
      goal: input.season_goal || "真相へ到達する",
      drive: "知りたいという衝動と、見て見ぬふりできない性分",
      dilemma: "真実を追うほど大切な人を危険に晒す矛盾",
      arc_start: "断片的な情報に振り回される。",
      arc_midpoint: "信頼していた前提が崩れ、自分の判断基準を問い直す。",
      arc_end: "不確実性を受け入れつつ判断できる。",
      arc_trigger: "相棒が隠していた事実が発覚する場面",
      backstory: "かつて重要な選択を誤り、その後悔が行動の根底にある。安定した日常を捨てて真実を追い始めたのは、あの日の償いでもある。",
      personality: "観察力は高いが、抱え込みやすい。",
      big_five: { openness: 75, conscientiousness: 60, extraversion: 45, agreeableness: 55, neuroticism: 65 },
      enneagram_type: 5,
      core_fear: ENNEAGRAM_FEARS[5],
      core_desire: ENNEAGRAM_DESIRES[5],
      speech_pattern: "丁寧語ベースだが、核心に触れると急にタメ口になる",
      catchphrase: "……これ、偶然じゃないよな。",
      quirks: ["考え込むと左手で首の後ろを触る", "重要なことほど小声になる"],
      appearance: "落ち着いたダークグリーンのジャケット、鋭い目線。中肉中背だが姿勢がよく、常に周囲を観察している。",
      visual_design: {
        dominant_color: "翡翠",
        body_type: "中肉中背で姿勢の良い",
        silhouette_keyword: "鋭角的",
        distinguishing_feature: "右目の下に古い傷痕",
      },
      secrets: ["過去の選択に未解決の後悔がある。"],
      relationship_hooks: ["相棒への依存と自立の揺れを抱える。"],
      relationships: [
        { target_id: "char_2", type: "trust" as const, description: "最も信頼する存在だが、依存と自立の間で揺れている", tension_level: 45 },
        { target_id: "char_3", type: "debt" as const, description: "過去に助けられた恩義があり、頭が上がらない", tension_level: 30 },
      ],
    },
    {
      id: "char_2",
      name: "相棒",
      role: input.partner_description || "主人公を支える実務家",
      tier: "primary" as const,
      must_appear: true,
      archetype: "Caregiver",
      goal: "主人公の目的達成を補助しつつ自分の信念を守る。",
      drive: "守りたいものを守る。そのためなら手を汚す覚悟もある",
      dilemma: "効率と情のどちらを優先すべきか、答えが出ない",
      arc_start: "感情より効率を優先する。",
      arc_midpoint: "効率だけでは守れないと悟り、感情に向き合う。",
      arc_end: "信頼を優先し、危機時には踏み込む。",
      arc_trigger: "主人公が危険に陥り、合理的判断だけでは救えない場面",
      backstory: "かつて組織に属していた時期があり、その頃の人脈と経験が今の実務能力の源。しかし組織を離れた理由は本人しか知らない。",
      personality: "冷静で機転が利く。",
      big_five: { openness: 40, conscientiousness: 85, extraversion: 55, agreeableness: 50, neuroticism: 30 },
      enneagram_type: 6,
      core_fear: ENNEAGRAM_FEARS[6],
      core_desire: ENNEAGRAM_DESIRES[6],
      speech_pattern: "簡潔で断定的。専門用語を自然に混ぜる",
      catchphrase: "事実だけ見ろ。感情は後だ。",
      quirks: ["考え事をするとき腕時計を回す", "甘いものに目がない（本人は認めない）"],
      appearance: "機能的な服装で、整った姿勢を崩さない。暗い紺色のコート。",
      visual_design: {
        dominant_color: "群青",
        body_type: "長身で引き締まった",
        silhouette_keyword: "流線型",
        distinguishing_feature: "常に手袋を外さない（左手に秘密がある）",
      },
      secrets: ["敵側と接点を持っていた時期がある。"],
      relationship_hooks: ["主人公と衝突しながら協働の型を作る。"],
      relationships: [
        { target_id: "char_1", type: "trust" as const, description: "主人公を守る使命感と、対等でいたい葛藤", tension_level: 40 },
        { target_id: "char_4", type: "secret" as const, description: "過去の組織時代に面識があり、その事実を隠している", tension_level: 75 },
      ],
    },
    {
      id: "char_3",
      name: "調停者",
      role: "対立陣営の橋渡し役",
      tier: "secondary" as const,
      must_appear: false,
      archetype: "Sage",
      goal: "大きな衝突を避けつつ均衡を保つ。",
      drive: "争いが生む痛みを誰にも味わわせたくない",
      dilemma: "中立を守ることで、結果的に悪を見逃しているのではないか",
      arc_start: "中立を守ることだけを重視する。",
      arc_midpoint: "中立のままでは守れないものがあると気づく。",
      arc_end: "中立では守れないもののため選択する。",
      arc_trigger: "自分の中立姿勢が原因で誰かが傷つく場面",
      backstory: "両親が対立する陣営に属していた過去があり、幼少期から板挟みの世界で育った。争いの無意味さを骨身に知っている。",
      personality: "穏やかだが計算高い。",
      big_five: { openness: 60, conscientiousness: 70, extraversion: 65, agreeableness: 80, neuroticism: 40 },
      enneagram_type: 9,
      core_fear: ENNEAGRAM_FEARS[9],
      core_desire: ENNEAGRAM_DESIRES[9],
      speech_pattern: "柔らかい口調。疑問形で相手に考えさせる話法",
      catchphrase: "それは本当に、あなたが望んでいることですか？",
      quirks: ["紅茶を淹れる所作が異様に丁寧", "嘘を見抜く直感が鋭い"],
      appearance: "柔らかな笑顔だが、目の奥に緊張感がある。アイボリーと金の装い。",
      visual_design: {
        dominant_color: "金",
        body_type: "華奢ながら芯のある",
        silhouette_keyword: "柔らかく丸みのある",
        distinguishing_feature: "左手首に古い革の腕輪（両親の形見）",
      },
      secrets: ["序盤の事件に直接関与している。"],
      relationship_hooks: ["主人公陣営の信頼を試す立場にある。"],
      relationships: [
        { target_id: "char_1", type: "mentor" as const, description: "主人公に助言を与えるが、全てを打ち明けてはいない", tension_level: 35 },
        { target_id: "char_4", type: "rivalry" as const, description: "対抗者の目的を理解しつつも容認できない", tension_level: 60 },
      ],
    },
    {
      id: "char_4",
      name: "対抗者",
      role: "同じ目的を別手段で追うライバル",
      tier: "secondary" as const,
      must_appear: false,
      archetype: "Rebel",
      goal: "主人公より先に核心を掴み主導権を握る。",
      drive: "正義は行動で示すもの。待っていても世界は変わらない",
      dilemma: "目的のために手段を選ばない自分と、かつて信じた理想とのズレ",
      arc_start: "結果のためなら手段を選ばない。",
      arc_midpoint: "同じ手段で得た結果が、予想外の犠牲を生む。",
      arc_end: "代償を知り、共闘の余地を見出す。",
      arc_trigger: "自分の行動が無関係な人間を巻き込んだと知る場面",
      backstory: "かつて主人公と同じ側にいたが、方法論の違いから決別した。その後独自のネットワークを築き、同じ真相を別ルートで追っている。",
      personality: "大胆で挑発的。",
      big_five: { openness: 80, conscientiousness: 45, extraversion: 75, agreeableness: 25, neuroticism: 50 },
      enneagram_type: 8,
      core_fear: ENNEAGRAM_FEARS[8],
      core_desire: ENNEAGRAM_DESIRES[8],
      speech_pattern: "挑発的で断定的。相手の反応を楽しむ余裕がある",
      catchphrase: "待つだけの正義に、価値なんてあるか？",
      quirks: ["常にコインを指で弾く", "危険を前にすると笑う"],
      appearance: "印象的な深紅のアクセントカラー。攻めた装い。鋭い目つきと自信に満ちた姿勢。",
      visual_design: {
        dominant_color: "深紅",
        body_type: "がっしりとした",
        silhouette_keyword: "角ばった",
        distinguishing_feature: "右手の甲に小さな刺青（かつての組織の印）",
      },
      secrets: ["主人公と同じ手がかりを密かに保有する。"],
      relationship_hooks: ["競合しつつ、終盤で限定的に共闘する。"],
      relationships: [
        { target_id: "char_1", type: "rivalry" as const, description: "同じ目的を追う好敵手。互いの能力は認めている", tension_level: 70 },
        { target_id: "char_2", type: "secret" as const, description: "過去に同じ組織に所属していた事実を互いに隠している", tension_level: 80 },
      ],
    },
  ];

  return base.map((character, index) => withVisuals(input, character, index)) as SeriesCharacterAgentOutput["characters"];
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

const SELF_REFERENCE_NAME_PATTERN = /^(?:あなた|アナタ|you|君|きみ|プレイヤー|player|主人公|protagonist|ユーザー|self)$/i;
const FALLBACK_CHARACTER_NAMES = [
  "九条サク",
  "神代レン",
  "霧島ユイ",
  "黒崎アオ",
  "白峰ナギ",
  "天城リオ",
  "桐生ミナ",
  "真壁トウマ",
];

const isSelfReferenceName = (name?: string | null) => SELF_REFERENCE_NAME_PATTERN.test(clean(name ?? undefined));

const enforceCharacterNamePolicy = (characters: SeriesCharacterAgentOutput["characters"]) => {
  const used = new Set<string>();

  return characters.map((character, index) => {
    let name = clean(character.name);
    if (!name || isSelfReferenceName(name) || used.has(name.toLowerCase())) {
      const candidateFromPool = FALLBACK_CHARACTER_NAMES.find((candidate) => !used.has(candidate.toLowerCase()));
      name = candidateFromPool || `キャラクター${index + 1}`;
    }
    used.add(name.toLowerCase());
    return {
      ...character,
      name,
      role: clean(character.role).replace(/プレイヤー本人|ユーザー本人/g, "主人公"),
    };
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
    tier:
      raw.tier === "primary" || raw.tier === "secondary"
        ? raw.tier
        : fallback.tier === "primary" || fallback.tier === "secondary"
          ? fallback.tier
          : "secondary",
    must_appear:
      typeof raw.must_appear === "boolean"
        ? raw.must_appear
        : typeof fallback.must_appear === "boolean"
          ? fallback.must_appear
          : false,
    archetype: clean(raw.archetype) || fallback.archetype || ARCHETYPE_POOL[index % ARCHETYPE_POOL.length],
    goal: clean(raw.goal) || fallback.goal,
    drive: clean(raw.drive) || fallback.drive,
    dilemma: clean(raw.dilemma) || fallback.dilemma,
    arc_start: clean(raw.arc_start) || fallback.arc_start,
    arc_midpoint: clean(raw.arc_midpoint) || fallback.arc_midpoint,
    arc_end: clean(raw.arc_end) || fallback.arc_end,
    arc_trigger: clean(raw.arc_trigger) || fallback.arc_trigger,
    backstory: clean(raw.backstory) || fallback.backstory,
    personality: clean(raw.personality) || fallback.personality,
    big_five: raw.big_five || fallback.big_five,
    enneagram_type: raw.enneagram_type || fallback.enneagram_type,
    core_fear: clean(raw.core_fear) || fallback.core_fear,
    core_desire: clean(raw.core_desire) || fallback.core_desire,
    speech_pattern: clean(raw.speech_pattern) || fallback.speech_pattern,
    catchphrase: clean(raw.catchphrase) || fallback.catchphrase,
    quirks: Array.isArray(raw.quirks) && raw.quirks.length > 0
      ? raw.quirks.map((q) => clean(q)).filter(Boolean)
      : fallback.quirks,
    appearance: clean(raw.appearance) || fallback.appearance,
    visual_design: raw.visual_design || fallback.visual_design || {
      dominant_color: DOMINANT_COLORS[index % DOMINANT_COLORS.length],
      body_type: BODY_TYPES[index % BODY_TYPES.length],
      silhouette_keyword: SILHOUETTES[index % SILHOUETTES.length],
      distinguishing_feature: FEATURES[index % FEATURES.length],
    },
    portrait_prompt: clean(raw.portrait_prompt) || fallback.portrait_prompt,
    portrait_image_url: fallback.portrait_image_url,
    secrets: secrets.length > 0 ? secrets : fallback.secrets,
    relationship_hooks: relationshipHooks.length > 0 ? relationshipHooks : fallback.relationship_hooks,
    relationships: raw.relationships || fallback.relationships,
  };
};

const applyTierPolicy = (
  characters: SeriesCharacterAgentOutput["characters"]
): SeriesCharacterAgentOutput["characters"] => {
  if (characters.length === 0) return characters;
  const requestedPrimary = characters.filter((character) => character.tier === "primary").length;
  const primaryTarget = requestedPrimary >= 2 ? 2 : 1;
  const capped = characters.slice(0, 5);

  return capped.map((character, index) => {
    const isPrimary = index < primaryTarget;
    return {
      ...character,
      tier: isPrimary ? "primary" : "secondary",
      must_appear: isPrimary,
    };
  });
};

const normalizeCharacterOutput = (
  input: SeriesCharacterAgentInput,
  raw: unknown
): SeriesCharacterAgentOutput | null => {
  const parsed = seriesCharacterAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const fallback = fallbackCharacters(input);
  const deduped = dedupeCharacters(parsed.data.characters);

  const targetCount = Math.max(3, Math.min(5, input.target_count));
  const merged = [...deduped, ...fallback].slice(0, targetCount);
  const normalizedCharacters = merged
    .slice(0, targetCount)
    .map((character, index) => normalizeCharacter(character, fallback[index] || fallback[0], index));
  const policyAppliedCharacters = applyTierPolicy(enforceCharacterNamePolicy(normalizedCharacters));

  return {
    characters: policyAppliedCharacters.map((normalized, index) => {
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
            dominantColor: normalized.visual_design?.dominant_color,
            bodyType: normalized.visual_design?.body_type,
            distinguishingFeature: normalized.visual_design?.distinguishing_feature,
            styleGuide: input.style_guide,
          });

        return {
          ...normalized,
          portrait_prompt: portraitPrompt,
          portrait_image_url: buildSeriesImageUrl({
            prompt: portraitPrompt,
            seedKey: `${input.title}:char:${index + 1}:${normalized.name}`,
            width: 768,
            height: 1024,
          }),
        };
      }),
  };
};

const CHARACTER_GENERATION_TIMEOUT_MS = Math.max(
  60_000,
  Number.parseInt(clean(process.env.SERIES_CHARACTER_GENERATION_TIMEOUT_MS) || "180000", 10) || 180_000
);
const CHARACTER_GENERATION_MAX_ATTEMPTS = Math.max(
  1,
  Math.min(3, Number.parseInt(clean(process.env.SERIES_CHARACTER_GENERATION_MAX_ATTEMPTS) || "2", 10) || 2)
);
const CHARACTER_GENERATION_TIMEOUT_GROWTH = Math.max(
  1,
  Number.parseFloat(clean(process.env.SERIES_CHARACTER_GENERATION_TIMEOUT_GROWTH) || "1.35") || 1.35
);

export const generateSeriesCharacters = async (
  input: SeriesCharacterAgentInput
): Promise<SeriesCharacterAgentOutput> => {
  const logPrefix = "[series-character-agent]";
  console.log(`${logPrefix} 開始 — title: ${input.title}, target_count: ${input.target_count}`);

  if (!hasModelApiKey()) {
    console.error(`${logPrefix} APIキー未設定`);
    throw new Error("AI生成に必要なAPIキーが設定されていません。GOOGLE_GENERATIVE_AI_API_KEY を確認してください。");
  }

  const prompt = `
シリーズ「${input.title}」のキャラクターを ${Math.max(3, Math.min(5, input.target_count))} 人分、JSON で出力してください。
ジャンル: ${input.genre} / トーン: ${input.tone} / 前提: ${input.premise}
主人公: ${input.protagonist_position} / 相棒像: ${input.partner_description} / シーズン目標: ${input.season_goal}

各キャラクターに以下のフィールドを含めてください:
- id: "char_1" から連番
- name: キャラ名
- role: 物語上の役割（1文）
- tier: "primary" または "secondary"
- must_appear: boolean（primary のみ true）
- goal: 目標（1文）
- arc_start: シリーズ開始時の状態（1文）
- arc_end: シリーズ終盤の状態（1文）
- personality: 性格（1文）
- appearance: 外見（1〜2文）
- secrets: 秘密の配列（1〜2個）
- relationship_hooks: 関係性フック（1〜2個）

名前・性格・外見が互いに被らないようにしてください。
primary は1〜2人、secondary は最大3人にしてください。
name には「あなた」「アナタ」「プレイヤー」「主人公」「You」など自己参照語を使わず、全員を固有名詞で命名してください。
`;

  const maxAttempts = CHARACTER_GENERATION_MAX_ATTEMPTS;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const timeoutMs = Math.round(
        CHARACTER_GENERATION_TIMEOUT_MS *
          Math.pow(CHARACTER_GENERATION_TIMEOUT_GROWTH, Math.max(0, attempt - 1))
      );
      console.log(
        `${logPrefix} attempt ${attempt}/${maxAttempts} — LLM呼び出し中 (軽量スキーマ, ${Math.round(timeoutMs / 1000)}秒でタイムアウト)`
      );
      const generatePromise = seriesCharacterAgent.generate(prompt, {
        structuredOutput: { schema: lightOutputSchema },
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`キャラクター生成が${Math.round(timeoutMs / 1000)}秒でタイムアウトしました。`)),
          timeoutMs
        )
      );
      const response = await Promise.race([generatePromise, timeoutPromise]);
      console.log(`${logPrefix} attempt ${attempt} — LLM応答受信`);

      const lightParsed = lightOutputSchema.safeParse(response.object);
      if (!lightParsed.success) {
        console.warn(`${logPrefix} attempt ${attempt} — 軽量スキーマのパース失敗:`, lightParsed.error.message);
        continue;
      }

      const enriched = lightParsed.data.characters.map((ch, i) => ({
        ...ch,
        portrait_prompt: "",
        portrait_image_url: "",
      }));
      const normalized = normalizeCharacterOutput(input, { characters: enriched });
      if (normalized) {
        console.log(`${logPrefix} 完了 — ${normalized.characters.length}人を生成`);
        return normalized;
      }
      console.warn(`${logPrefix} attempt ${attempt} — normalizeCharacterOutput 失敗`);
    } catch (error: any) {
      console.warn(`${logPrefix} attempt ${attempt} 失敗:`, error?.message ?? error);
    }
  }

  console.error(`${logPrefix} 全試行失敗`);
  throw new Error("キャラクター生成に失敗しました。AIモデルからの応答が得られませんでした。再度お試しください。");
};
