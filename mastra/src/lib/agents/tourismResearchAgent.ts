import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_TOURISM_MODEL } from "../modelConfig";

export const tourismResearchInputSchema = z.object({
  prompt: z.string().optional(),
  areaHint: z.string().optional(),
  spots: z.array(
    z.object({
      index: z.number().int(),
      name: z.string(),
      lat: z.number(),
      lng: z.number(),
      kinds: z.string().optional(),
      address: z.string().optional(),
      description: z.string().optional(),
    })
  ),
});

const tourismResearchSpotSchema = z.object({
  index: z.number().int(),
  tourism_summary: z.string(),
  tourism_keywords: z.array(z.string()).default([]),
});

export const tourismResearchOutputSchema = z.object({
  spots: z.array(tourismResearchSpotSchema),
});

export type TourismResearchInput = z.infer<typeof tourismResearchInputSchema>;
export type TourismResearchOutput = z.infer<typeof tourismResearchOutputSchema>;

const TOURISM_RESEARCH_INSTRUCTIONS = `
あなたは観光編集者です。渡されたスポットごとに、旅行者向けの「概要」を短く作成してください。
ネットから検索し、ファクトに基づく情報を用いてください。

## 目的
- ルート型クエスト生成で使う scene_tourism_anchor を補完する
- 物語づくりに使える要点（観光情報 / 背景や歴史 / 面白い小話）を抽出する

## 出力ルール
- spots 配列は入力の各 spot.index と1対1で返す
- tourism_summary は簡潔な日本語の説明にする
- tourism_keywords は 2〜4語（短い名詞句）
- summary には観光情報を必ず含める
- summary には背景や歴史を必ず含める
- summary には面白い小話を、確認できる場合のみ1つ含める
- summary には可能なら地名・文脈・観光価値（歴史/文化/景観/体験）を含める
- kinds や説明に含まれる英語タグ（museum/restaurant/library など）は日本語に言い換える
- 「〜として親しまれ」など定型文の連発を避け、スポット固有の語を必ず1つ以上入れる
- 断定しきれない細部は避け、誇張しない
- 「現地で看板を見て」など現地依存の指示は書かない
- Markdownは使わずプレーンテキスト
`;

export const tourismResearchAgent = new Agent({
  id: "tourism-research-agent",
  name: "tourism-research-agent",
  model: MASTRA_TOURISM_MODEL,
  instructions: TOURISM_RESEARCH_INSTRUCTIONS,
});

const sanitizeText = (value: string) => value.replace(/\s+/g, " ").trim();

const KIND_JA_MAP: Record<string, string> = {
  museum: "博物館",
  library: "図書館",
  restaurant: "飲食店",
  cafe: "カフェ",
  fast_food: "ファストフード",
  convenience: "コンビニ",
  books: "書店",
  university: "大学施設",
  school: "学校",
  college: "学校",
  public: "公共施設",
  community_centre: "地域交流施設",
  park: "公園",
  pitch: "グラウンド",
  sport: "スポーツ施設",
  memorial: "記念物",
  artwork: "モニュメント",
  archaeological_site: "史跡",
  place_of_worship: "信仰施設",
  shrine: "神社",
  temple: "寺院",
  platform: "交通拠点",
  information: "案内施設",
  parking: "駐車場",
  bicycle_parking: "駐輪場",
  bank: "金融施設",
  dentist: "医療施設",
  telecommunication: "通信施設",
  fuel: "給油施設",
  yes: "施設",
};

const replaceEnglishKinds = (text: string) => {
  let next = text;
  Object.entries(KIND_JA_MAP).forEach(([en, ja]) => {
    next = next.replace(new RegExp(`\\b${en}\\b`, "gi"), ja);
  });
  return next;
};

const toJapaneseKinds = (kinds: string | undefined) => {
  const tokens = sanitizeText(kinds || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      return KIND_JA_MAP[lower] || (/[a-z]/i.test(token) ? "施設" : token);
    });
  const deduped = Array.from(new Set(tokens));
  return deduped.slice(0, 2).join("・");
};

const inferNameContext = (name: string) => {
  if (/(郷土館|資料館|博物館)/.test(name)) return "地域史や民俗の文脈を短時間でつかみやすい。";
  if (/図書館/.test(name)) return "地域文化資料に触れられる静かな滞在ポイント。";
  if (/(神社|寺|宮)/.test(name)) return "祈りと歴史が重なる落ち着いた立ち寄り先。";
  if (/(古墳|遺跡|史跡)/.test(name)) return "古代から続く土地の記憶を感じられる。";
  if (/(記念|モニュメント|碑|像|大錨|ランタン|アート)/.test(name))
    return "記念性が高く、写真映えするランドマーク。";
  if (/(大学|研究|学部|講義|実験|図書|キャンパス|棟)/.test(name))
    return "学術拠点らしい知的な雰囲気がある。";
  if (/(公園|広場|運動|グラウンド|芝生)/.test(name))
    return "散策や休憩を挟みやすい開放的な地点。";
  if (/(会館|公民館|センター)/.test(name)) return "地域交流や催しの舞台になりやすい拠点。";
  if (/(カフェ|レストラン|食堂|寿司|バーガー|ダイニング)/.test(name))
    return "食事や休憩を組み込める実用的な立ち寄り先。";
  if (/(ホテル|旅館)/.test(name)) return "滞在拠点として周辺散策の起点にしやすい。";
  if (/(銀行|ATM|歯科|病院|NTT|通信)/.test(name)) return "地域の生活インフラを支える機能的な地点。";
  return "地域の景観や暮らしの文脈を読み解く手がかりになる。";
};

const fallbackSummary = (spot: TourismResearchInput["spots"][number]) => {
  const description = replaceEnglishKinds(sanitizeText(spot.description || ""));
  if (description) return description;
  const kind = toJapaneseKinds(spot.kinds);
  const address = sanitizeText(spot.address || "");
  const context = inferNameContext(spot.name);
  if (kind && address) {
    return `${spot.name}は${address}周辺の${kind}で、${context}`;
  }
  if (kind) {
    return `${spot.name}は${kind}で、${context}`;
  }
  if (address) {
    return `${spot.name}は${address}周辺に位置し、${context}`;
  }
  return `${spot.name}は${context}`;
};

const buildSummarySupplements = (params: {
  spot: TourismResearchInput["spots"][number];
  areaHint?: string;
  prompt?: string;
}) => {
  const { spot, areaHint, prompt } = params;
  const parts: string[] = [];
  const kind = toJapaneseKinds(spot.kinds);
  const address = sanitizeText(spot.address || "");
  const area = sanitizeText(areaHint || "");
  const promptText = sanitizeText(prompt || "");

  if (address) {
    parts.push(`${address}周辺は徒歩で巡る導線を作りやすく、前後の地点と組み合わせると滞在体験が立体的になる。`);
  }
  if (kind) {
    parts.push(`${kind}としての特徴があり、訪問時の観察ポイントを見つけやすい。`);
  }
  if (area) {
    parts.push(`${area}の文脈で見ると、地域の歴史や生活文化を読み解く導入地点として機能しやすい。`);
  }
  if (/ミステリー|謎|事件|推理/.test(promptText)) {
    parts.push(`ミステリー系の演出では、発見と移動をつなぐ中継点として使うと探索の緊張感を保ちやすい。`);
  }
  parts.push(`短い観察時間でも特徴を把握しやすく、写真や会話の題材を得やすい点がルート設計上の利点になる。`);
  return Array.from(new Set(parts.map((part) => sanitizeText(part)).filter(Boolean)));
};

const sanitizeSummary = (params: {
  spot: TourismResearchInput["spots"][number];
  summary: string;
  areaHint?: string;
  prompt?: string;
}) => {
  const { spot, summary, areaHint, prompt } = params;
  let text = replaceEnglishKinds(sanitizeText(summary));
  text = text.replace(/[^。！？]*物語の手がかりとして配置しやすい。?/g, "");
  text = sanitizeText(text).replace(/。{2,}/g, "。");
  if (!text) text = `${spot.name}は地域の歴史や文化を感じられるスポット。`;
  if (/として親しまれ、地域の文化や景観の魅力に触れられるスポット。?$/.test(text)) {
    text = `${spot.name}は${inferNameContext(spot.name)}`;
  }
  if (!text.includes(spot.name)) {
    text = `${spot.name}は${text}`;
  }
  const supplements = buildSummarySupplements({ spot, areaHint, prompt });
  if (supplements.length > 0) {
    const add = supplements.find((part) => !text.includes(part));
    if (add) {
      text = `${text}${/[。！？]$/.test(text) ? "" : "。"}${add}`;
    }
  }
  text = sanitizeText(text);
  if (!/[。！？]$/.test(text)) text = `${text}。`;
  return text;
};

const fallbackKeywords = (spot: TourismResearchInput["spots"][number]) => {
  const keywords: string[] = [];
  const kind = toJapaneseKinds(spot.kinds);
  if (kind) keywords.push(...kind.split("・"));

  const name = spot.name;
  if (/(郷土館|資料館|博物館)/.test(name)) keywords.push("歴史資料");
  if (/図書館/.test(name)) keywords.push("地域文化");
  if (/(神社|寺|宮)/.test(name)) keywords.push("信仰");
  if (/(古墳|遺跡|史跡)/.test(name)) keywords.push("史跡");
  if (/(記念|モニュメント|碑|像|大錨|ランタン|アート)/.test(name)) keywords.push("ランドマーク");
  if (/(大学|研究|学部|講義|実験|キャンパス|棟)/.test(name)) keywords.push("学術");
  if (/(公園|広場|運動|グラウンド|芝生)/.test(name)) keywords.push("散策");
  if (/(カフェ|レストラン|食堂|寿司|バーガー|ダイニング)/.test(name)) keywords.push("グルメ");

  const deduped = Array.from(new Set(keywords.map((word) => sanitizeText(word)).filter(Boolean)));
  return deduped.slice(0, 4);
};

export const generateSpotTourismResearch = async (
  input: TourismResearchInput
): Promise<TourismResearchOutput> => {
  const prompt = `
## 情報取得方針（必須）
ネットから検索し、ファクトに基づく情報を用いてください。
欲しい情報は「観光情報」「そのスポットの背景や歴史」「（もしあれば）面白い小話」です。

## ユーザー要望
${input.prompt || "（省略）"}

## エリアヒント
${input.areaHint || "（省略）"}

## スポット一覧
${input.spots
  .map(
    (spot) =>
      `- [${spot.index}] ${spot.name} / 種別:${spot.kinds || "不明"} / 住所:${spot.address || "不明"} / 説明:${spot.description || "不明"}`
  )
  .join("\n")}

tourismResearchOutputSchema を満たす JSON のみを返してください。
`;

  const response = await tourismResearchAgent.generate(prompt, {
    structuredOutput: { schema: tourismResearchOutputSchema },
  });
  const output = response.object as TourismResearchOutput;
  const map = new Map(output.spots.map((spot) => [spot.index, spot]));

  return {
    spots: input.spots.map((spot) => {
      const matched = map.get(spot.index);
      const summary = sanitizeSummary({
        spot,
        summary: sanitizeText(matched?.tourism_summary || fallbackSummary(spot)),
        areaHint: input.areaHint,
        prompt: input.prompt,
      });
      const keywords = Array.isArray(matched?.tourism_keywords)
        ? matched!.tourism_keywords
            .map((keyword) => sanitizeText(keyword || ""))
            .map((keyword) => replaceEnglishKinds(keyword))
            .filter(Boolean)
            .slice(0, 4)
        : fallbackKeywords(spot);
      const normalizedKeywords = keywords.length > 0 ? keywords : fallbackKeywords(spot);
      return {
        index: spot.index,
        tourism_summary: summary,
        tourism_keywords: normalizedKeywords,
      };
    }),
  };
};
