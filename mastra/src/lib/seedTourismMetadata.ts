import { SpotCandidate } from "./spotTypes";

type SpotLike = Pick<
  SpotCandidate,
  "name" | "kinds" | "address" | "description" | "tourism_summary" | "tourism_keywords"
>;

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
  return deduped.slice(0, 3);
};

const inferNameContext = (name: string) => {
  if (/(郷土館|資料館|博物館)/.test(name)) return "地域史や民俗の文脈を短時間でつかみやすい。";
  if (/図書館/.test(name)) return "地域文化資料に触れられる静かな滞在ポイント。";
  if (/(神社|寺|宮)/.test(name)) return "祈りと歴史が重なる落ち着いた立ち寄り先。";
  if (/(古墳|遺跡|史跡)/.test(name)) return "古代から続く土地の記憶を感じられる。";
  if (/(記念|モニュメント|碑|像|アート)/.test(name))
    return "記念性が高く、写真映えするランドマーク。";
  if (/(大学|研究|学部|講義|実験|図書|キャンパス|棟)/.test(name))
    return "学術拠点らしい知的な雰囲気がある。";
  if (/(公園|広場|運動|グラウンド|芝生)/.test(name))
    return "散策や休憩を挟みやすい開放的な地点。";
  if (/(会館|公民館|センター)/.test(name)) return "地域交流や催しの舞台になりやすい拠点。";
  if (/(カフェ|レストラン|食堂|寿司|バーガー|ダイニング)/.test(name))
    return "食事や休憩を組み込める実用的な立ち寄り先。";
  return "地域の景観や暮らしの文脈を読み解く手がかりになる。";
};

const expandSummary = (base: string, minChars: number, maxChars: number) => {
  let out = sanitizeText(base);
  const fillers = [
    "短い滞在でも特徴を把握しやすく、ルート設計上の拠点として扱いやすい。",
    "周辺スポットと組み合わせると、地域の文脈を段階的に理解しやすい。",
    "移動途中の観察ポイントとしても使いやすく、物語展開に接続しやすい。",
  ];
  let fillerIndex = 0;
  while (out.length < minChars && fillerIndex < fillers.length) {
    const next = fillers[fillerIndex];
    fillerIndex += 1;
    if (out.includes(next)) continue;
    out = `${out}${/[。！？]$/.test(out) ? "" : "。"}${next}`;
    out = sanitizeText(out);
  }
  if (out.length <= maxChars) return out;
  const sliced = out.slice(0, maxChars);
  const lastPunct = Math.max(sliced.lastIndexOf("。"), sliced.lastIndexOf("！"), sliced.lastIndexOf("？"));
  if (lastPunct >= Math.floor(maxChars * 0.7)) return sliced.slice(0, lastPunct + 1);
  return `${sliced.replace(/[。！？，、\s]+$/g, "")}。`;
};

const isLowQualitySummary = (summary: string) => {
  if (!summary) return true;
  const sentences = summary
    .split(/(?<=[。！？])/)
    .map((part) => sanitizeText(part))
    .filter(Boolean);
  if (sentences.length <= 1) return false;
  const unique = new Set(sentences);
  return unique.size / sentences.length < 0.75;
};

const fallbackSummary = (spot: SpotLike, summaryMinChars: number, summaryMaxChars: number) => {
  const description = replaceEnglishKinds(sanitizeText(spot.description || ""));
  if (description) return expandSummary(description, summaryMinChars, summaryMaxChars);

  const kind = toJapaneseKinds(spot.kinds).join("・");
  const address = sanitizeText(spot.address || "");
  const context = inferNameContext(spot.name || "このスポット");
  const base =
    kind && address
      ? `${spot.name}は${address}周辺の${kind}で、${context}`
      : kind
        ? `${spot.name}は${kind}で、${context}`
        : address
          ? `${spot.name}は${address}周辺に位置し、${context}`
          : `${spot.name}は${context}`;
  return expandSummary(base, summaryMinChars, summaryMaxChars);
};

const fallbackKeywords = (spot: SpotLike) => {
  const keywords: string[] = [];
  keywords.push(...toJapaneseKinds(spot.kinds));

  const name = spot.name || "";
  if (/(郷土館|資料館|博物館)/.test(name)) keywords.push("歴史資料");
  if (/図書館/.test(name)) keywords.push("地域文化");
  if (/(神社|寺|宮)/.test(name)) keywords.push("信仰");
  if (/(古墳|遺跡|史跡)/.test(name)) keywords.push("史跡");
  if (/(記念|モニュメント|碑|像|アート)/.test(name)) keywords.push("ランドマーク");
  if (/(大学|研究|学部|講義|実験|キャンパス|棟)/.test(name)) keywords.push("学術");
  if (/(公園|広場|運動|グラウンド|芝生)/.test(name)) keywords.push("散策");
  if (/(カフェ|レストラン|食堂|寿司|バーガー|ダイニング)/.test(name)) keywords.push("グルメ");

  return Array.from(new Set(keywords.map((word) => sanitizeText(word)).filter(Boolean))).slice(0, 6);
};

const normalizeKeywords = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((word) => replaceEnglishKinds(sanitizeText(String(word || ""))))
        .filter(Boolean)
    )
  ).slice(0, 8);
};

export const withPrecomputedTourismMetadata = <T extends SpotLike>(
  spot: T,
  options?: { summaryMinChars?: number; summaryMaxChars?: number }
): T & { tourism_summary: string; tourism_keywords: string[] } => {
  const summaryMinChars = Math.max(60, options?.summaryMinChars ?? 90);
  const summaryMaxChars = Math.max(summaryMinChars + 20, options?.summaryMaxChars ?? 180);
  const summaryRaw = replaceEnglishKinds(sanitizeText(String(spot.tourism_summary || "")));
  const tourism_summary = summaryRaw.length >= summaryMinChars && !isLowQualitySummary(summaryRaw)
    ? expandSummary(summaryRaw, summaryMinChars, summaryMaxChars)
    : fallbackSummary(spot, summaryMinChars, summaryMaxChars);
  const tourism_keywords = normalizeKeywords(spot.tourism_keywords);
  return {
    ...spot,
    tourism_summary,
    tourism_keywords: tourism_keywords.length > 0 ? tourism_keywords : fallbackKeywords(spot),
  };
};

const THEME_TOKEN_RULES: Array<{ pattern: RegExp; tokens: string[] }> = [
  {
    pattern: /(歴史|史跡|遺跡|古墳|神社|寺|伝承|文化財|郷土|幕末|戦国|古代)/,
    tokens: ["歴史", "史跡", "文化", "伝承", "神社", "寺院", "遺跡", "古墳"],
  },
  {
    pattern: /(ミステリー|謎|推理|事件|サスペンス)/,
    tokens: ["謎解き", "探索", "推理", "事件"],
  },
  {
    pattern: /(自然|海|山|川|森林|景観|絶景)/,
    tokens: ["自然", "景観", "展望", "散策"],
  },
  {
    pattern: /(グルメ|食|寿司|カフェ|ランチ|ディナー)/,
    tokens: ["グルメ", "飲食店", "カフェ", "食文化"],
  },
  {
    pattern: /(大学|キャンパス|研究|学術|教育)/,
    tokens: ["学術", "大学", "研究", "教育"],
  },
];

const PROMPT_SPLIT_PATTERN = /[\s、,。・/]+/;

export const buildThemeTokens = (params: { prompt?: string; themeTags?: string[] }) => {
  const tokens = new Set<string>();
  const prompt = sanitizeText(params.prompt || "");
  const themeTags = Array.isArray(params.themeTags) ? params.themeTags : [];

  themeTags
    .flatMap((tag) => sanitizeText(String(tag || "")).split(PROMPT_SPLIT_PATTERN))
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 12)
    .forEach((token) => tokens.add(token));

  if (prompt) {
    THEME_TOKEN_RULES.forEach((rule) => {
      if (rule.pattern.test(prompt)) {
        rule.tokens.forEach((token) => tokens.add(token));
      }
    });
    const directTokens = prompt
      .split(PROMPT_SPLIT_PATTERN)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && token.length <= 12 && !/^[0-9]+$/.test(token));
    directTokens.slice(0, 12).forEach((token) => tokens.add(token));
  }

  return Array.from(tokens);
};

export const scoreThemeMatch = (spot: SpotLike, themeTokens: string[]) => {
  if (!Array.isArray(themeTokens) || themeTokens.length === 0) return 0;
  const haystack = [
    sanitizeText(spot.name || ""),
    sanitizeText(spot.kinds || ""),
    sanitizeText(spot.description || ""),
    sanitizeText(spot.tourism_summary || ""),
    ...(Array.isArray(spot.tourism_keywords) ? spot.tourism_keywords.map((token) => sanitizeText(String(token || ""))) : []),
  ]
    .filter(Boolean)
    .join(" ");

  if (!haystack) return 0;
  let score = 0;
  themeTokens.forEach((token) => {
    if (!token) return;
    if (haystack.includes(token)) score += Math.max(1, Math.min(4, Math.floor(token.length / 2)));
    if ((spot.name || "").includes(token)) score += 2;
  });
  return score;
};
