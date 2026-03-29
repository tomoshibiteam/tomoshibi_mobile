import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { questSchema, QuestOutput } from "../schemas/quest";
import {
  deriveRouteConstraints,
  evaluateOneWayLineRoute,
  haversineKm,
  selectRouteCandidatesWithDiagnostics,
} from "../lib/geo";
import { SpotCandidate } from "../lib/spotTypes";
import { fetchOverpassCandidates, fetchOverpassCandidatesInBbox } from "../lib/overpass";
import { geocodeWithNominatim } from "../lib/geocode";
import {
  buildValidationError,
  logQuestValidation,
  QuestRequestContext,
  validateQuestOutput,
} from "../lib/questValidation";
import { ensureDialogueArrays, normalizePlayerName } from "../lib/questRepair";
import { generatePlotPlan } from "../lib/agents/plotAgent";
import { generateChapter } from "../lib/agents/chapterAgent";
import { generatePuzzle } from "../lib/agents/puzzleAgent";
import { generateSpotTourismResearch } from "../lib/agents/tourismResearchAgent";
import { normalizeObjectiveMissionLink } from "../lib/objectiveMissionLink";
import { logQuestProgressData, withQuestProgress } from "../lib/questProgress";
import { isMastraTextModelAvailable } from "../lib/modelConfig";

const requestSchema = z.object({
  prompt: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  spot_count: z.number().int().min(2).max(12),
  player_name: z.string().optional(),
  theme_tags: z.array(z.string()).optional(),
  genre_support: z.string().optional(),
  tone_support: z.string().optional(),
  center_location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  radius_km: z.number().optional(),
  include_national_chains: z.boolean().optional(),
  spot_candidates: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        lat: z.number(),
        lng: z.number(),
        kinds: z.string().optional(),
        address: z.string().optional(),
        description: z.string().optional(),
        tourism_summary: z.string().optional(),
        tourism_keywords: z.array(z.string()).optional(),
        rate: z.number().optional(),
        wikidata: z.string().optional(),
        distance_km: z.number().optional(),
        source: z.string().optional(),
      })
    )
    .optional(),
  spot_candidate_mode: z.enum(["fixed", "pool"]).optional(),
  prompt_support: z
    .object({
      protagonist: z.string().optional(),
      objective: z.string().optional(),
      ending: z.string().optional(),
      when: z.string().optional(),
      where: z.string().optional(),
      purpose: z.string().optional(),
      withWhom: z.string().optional(),
    })
    .optional(),
});

const resolvedSchema = requestSchema.extend({
  difficulty: z.enum(["easy", "medium", "hard"]),
  center_location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  radius_km: z.number().optional(),
});

const candidatesSchema = resolvedSchema.extend({
  center_location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  radius_km: z.number().optional(),
  spot_candidates: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string(),
      lat: z.number(),
      lng: z.number(),
      kinds: z.string().optional(),
      address: z.string().optional(),
      description: z.string().optional(),
      tourism_summary: z.string().optional(),
      tourism_keywords: z.array(z.string()).optional(),
      rate: z.number().optional(),
      wikidata: z.string().optional(),
      distance_km: z.number().optional(),
      source: z.string().optional(),
    })
  ),
  spot_candidate_mode: z.enum(["fixed", "pool"]).default("pool"),
  route_diagnostics: z.any().optional(),
});

const workflowOutputSchema = z.object({
  quest: questSchema,
  meta: z.object({
    candidates_used: z.number(),
    candidate_mode: z.enum(["fixed", "pool"]),
    candidate_source: z.string().optional(),
    candidate_source_stats: z.record(z.number()).optional(),
    tourism_research_used: z.boolean().optional(),
    tourism_research_count: z.number().optional(),
    radius_km: z.number().optional(),
    center_location: z.object({ lat: z.number(), lng: z.number() }).optional(),
    attempts: z.number(),
    repair_attempts: z.number(),
    route_attempts: z.number(),
    validation_errors: z.array(z.string()),
  }),
});

const logWorkflow = (..._args: unknown[]) => {};

const toLogJson = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
};

const summarizeCandidateSources = (spots: SpotCandidate[]) => {
  const stats: Record<string, number> = {};
  spots.forEach((spot) => {
    const source = typeof spot.source === "string" && spot.source.trim() ? spot.source : "unknown";
    stats[source] = (stats[source] || 0) + 1;
  });
  return stats;
};

const detectCandidateSourceLabel = (sourceStats: Record<string, number>) => {
  const keys = Object.keys(sourceStats);
  if (keys.length === 1 && keys[0] === "ito_seed") return "ito_seed_db";
  if (keys.length === 1 && keys[0] === "iki_seed") return "iki_seed_db";
  if (keys.length === 1) return keys[0];
  return "mixed";
};

const OVERPASS_ENTITY_SUFFIX_PATTERN = /\s*\((?:node|way|relation):\d+\)\s*$/i;

const normalizeSpotDisplayBaseName = (spot: SpotCandidate, index: number) => {
  const rawName = typeof spot.name === "string" ? spot.name : "";
  const cleanedName = rawName.replace(OVERPASS_ENTITY_SUFFIX_PATTERN, "").trim().replace(/\s+/g, " ");
  if (cleanedName) return cleanedName;

  const firstKind =
    typeof spot.kinds === "string"
      ? spot.kinds
          .split(",")
          .map((item) => item.trim())
          .find(Boolean)
      : "";
  if (firstKind) return firstKind;

  return `スポット${index + 1}`;
};

const sanitizeOrderedSpotNames = (spots: SpotCandidate[]) => {
  const usedNameCounts = new Map<string, number>();
  return spots.map((spot, index) => {
    const baseName = normalizeSpotDisplayBaseName(spot, index);
    const key = baseName.toLocaleLowerCase("ja-JP");
    const count = usedNameCounts.get(key) ?? 0;
    usedNameCounts.set(key, count + 1);
    const uniqueName = count === 0 ? baseName : `${baseName} ${count + 1}`;
    if (uniqueName === spot.name) return spot;
    return { ...spot, name: uniqueName };
  });
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const BAD_GEO_TERMS = new Set([
  "現在地周辺で",
  "現在地周辺",
  "現在地",
  "周辺",
  "近く",
  "付近",
  "この辺",
  "その辺",
]);

const cleanGeoQuery = (value: string) => {
  let text = value.trim();
  text = text.replace(/^(現在地周辺で|現在地周辺|現在地)/g, "");
  text = text.replace(/(周辺|付近|界隈|近く|周り|一帯|エリア|駅周辺|駅付近|駅近|駅)$/g, "");
  text = text.replace(/(で|に|へ|から)$/g, "");
  text = text.replace(/^[\s、,。]+/, "").replace(/[\s、,。]+$/, "");
  return text;
};

const STORY_NOISE_PATTERN =
  /(ミステリー|謎解き|謎|雰囲気|ストーリー|物語|クエスト|体験|散歩|散策|旅|コース|プラン|おすすめ|デート|1時間|2時間|半日|徒歩)/;
const LOCATION_TOKEN_PATTERN =
  /([^。,\n、\s]{1,24}(?:都|道|府|県|市|区|町|村|島|半島|岬|山|川|湖|湾|駅|港|空港))/;

const KNOWN_PLACE_PATTERNS = [
  "対馬", "対馬市", "壱岐", "壱岐市", "壱岐島", "福江島", "五島列島", "奄美大島", "宮古島", "石垣島",
  "東京", "京都", "大阪", "神戸", "奈良", "横浜", "名古屋", "福岡", "札幌", "仙台",
  "広島", "金沢", "那覇", "鎌倉", "日光", "箱根", "軽井沢", "熱海", "伊豆", "沖縄",
  "浅草", "渋谷", "新宿", "銀座", "池袋", "上野", "秋葉原", "原宿", "表参道",
  "祇園", "嵐山", "伏見", "清水", "金閣", "銀閣", "二条", "四条", "河原町",
  "梅田", "難波", "心斎橋", "天王寺", "道頓堀", "通天閣",
  "北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島",
  "茨城", "栃木", "群馬", "埼玉", "千葉", "神奈川",
  "新潟", "富山", "石川", "福井", "山梨", "長野", "岐阜", "静岡", "愛知",
  "三重", "滋賀", "兵庫", "和歌山",
  "鳥取", "島根", "岡山", "山口", "徳島", "香川", "愛媛", "高知",
  "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島",
];

const PLACE_ALIASES: Record<string, string[]> = {
  対馬: ["対馬市 長崎県", "対馬 長崎県", "Tsushima Nagasaki Japan"],
  対馬市: ["対馬市 長崎県", "Tsushima Nagasaki Japan"],
  壱岐: ["壱岐市 長崎県", "壱岐島 長崎県", "Iki Nagasaki Japan"],
  壱岐島: ["壱岐市 長崎県", "Iki Nagasaki Japan"],
  五島: ["五島市 長崎県", "五島列島 長崎県"],
  五島列島: ["五島市 長崎県", "五島列島 長崎県"],
  渋谷: ["渋谷区 東京都", "Shibuya Tokyo Japan"],
  新宿: ["新宿区 東京都", "Shinjuku Tokyo Japan"],
};

const PLACE_FALLBACK_CENTERS: Array<{
  keyword: string;
  center: { lat: number; lng: number };
}> = [
  { keyword: "壱岐", center: { lat: 33.7500515, lng: 129.6913078 } },
  { keyword: "壱岐島", center: { lat: 33.7500515, lng: 129.6913078 } },
  { keyword: "壱岐市", center: { lat: 33.7500515, lng: 129.6913078 } },
  { keyword: "iki", center: { lat: 33.7500515, lng: 129.6913078 } },
  { keyword: "対馬", center: { lat: 34.2053717, lng: 129.2946547 } },
  { keyword: "対馬市", center: { lat: 34.2053717, lng: 129.2946547 } },
  { keyword: "tsushima", center: { lat: 34.2053717, lng: 129.2946547 } },
];

const inferFallbackCenterByKeyword = (texts: Array<string | undefined>) => {
  const haystack = texts
    .map((value) => String(value || "").trim().toLocaleLowerCase("ja-JP"))
    .filter(Boolean);
  if (haystack.length === 0) return undefined;
  for (const item of PLACE_FALLBACK_CENTERS) {
    const keyword = item.keyword.toLocaleLowerCase("ja-JP");
    if (haystack.some((text) => text.includes(keyword))) {
      return item.center;
    }
  }
  return undefined;
};

const looksLikeAreaLabel = (value: string) => {
  const cleaned = cleanGeoQuery(value);
  if (!cleaned) return false;
  if (cleaned.length > 28) return false;
  if (BAD_GEO_TERMS.has(cleaned)) return false;
  if (STORY_NOISE_PATTERN.test(cleaned)) return false;
  return true;
};

const buildGeocodeQueryVariants = (raw: string) => {
  const base = cleanGeoQuery(raw);
  if (!looksLikeAreaLabel(base)) return [];
  const variants: string[] = [];
  const push = (value: string) => {
    const cleaned = cleanGeoQuery(value);
    if (!looksLikeAreaLabel(cleaned)) return;
    if (!variants.includes(cleaned)) variants.push(cleaned);
  };

  // Prefer specific aliases (prefecture/city/island) over bare labels.
  (PLACE_ALIASES[base] || []).forEach((alias) => push(alias));
  push(base);

  const hasSuffix = /(都|道|府|県|市|区|町|村|島|半島|岬|山|川|湖|湾|駅|港|空港)$/.test(base);
  if (!hasSuffix && base.length <= 14) {
    push(`${base}市`);
    push(`${base}区`);
    push(`${base}町`);
    push(`${base}島`);
  }
  if (base.endsWith("島")) {
    push(base.replace(/島$/, ""));
    push(base.replace(/島$/, "市"));
  }

  push(`${base} 日本`);

  const scored = variants.map((value, index) => {
    let score = 0;
    if (/(都|道|府|県)/.test(value)) score += 8;
    if (/(市|区|町|村|島|半島|岬|山|川|湖|湾|駅|港|空港)/.test(value)) score += 6;
    if (/(日本|japan)/i.test(value)) score += 4;
    if (/[A-Za-z]/.test(value)) score += 1;
    score += Math.min(3, value.length / 8);
    return { value, index, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });
  return scored.map((entry) => entry.value);
};

const derivePromptHeadLocationHints = (prompt: string) => {
  const normalized = prompt
    .replace(/[（）()【】\[\]「」『』]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  const hints: string[] = [];
  const prefixByTheme = normalized.split(STORY_NOISE_PATTERN)[0]?.trim() || "";
  if (prefixByTheme && prefixByTheme.length <= 18) {
    hints.push(prefixByTheme);
  }
  const headMatch = normalized.match(
    /^([^\s、,。]{2,14}?)(?:歴史|文化|自然|ミステリー|謎解き|謎|散歩|散策|旅|観光|体験)/
  );
  if (headMatch?.[1]) {
    hints.push(headMatch[1]);
  }
  return hints;
};

const deriveGeocodeQueries = (inputData: z.infer<typeof resolvedSchema>) => {
  const queries: string[] = [];
  const push = (value: string) => {
    const cleaned = cleanGeoQuery(value);
    if (!looksLikeAreaLabel(cleaned)) return;
    if (!queries.includes(cleaned)) queries.push(cleaned);
  };
  const pushMany = (values: string[]) => values.forEach((value) => push(value));

  const where = inputData.prompt_support?.where?.trim();
  if (where) {
    pushMany(buildGeocodeQueryVariants(where));
    if (queries.length > 0) return queries.slice(0, 12);
  }

  const prompt = inputData.prompt?.trim() || "";
  if (!prompt) return [];

  for (const place of KNOWN_PLACE_PATTERNS) {
    if (prompt.includes(place)) {
      pushMany(buildGeocodeQueryVariants(place));
    }
  }
  if (queries.length > 0) return queries.slice(0, 12);

  derivePromptHeadLocationHints(prompt).forEach((hint) =>
    pushMany(buildGeocodeQueryVariants(hint))
  );
  if (queries.length > 0) return queries.slice(0, 12);

  const particleMatch = prompt.match(/([^\s、,。]{2,12})(?:で|に|へ|から|周辺|付近)/);
  if (particleMatch?.[1]) {
    pushMany(buildGeocodeQueryVariants(particleMatch[1]));
    if (queries.length > 0) return queries.slice(0, 12);
  }

  const regexMatch = prompt.match(/([^\s、,。]{2,12}(?:都|道|府|県|市|区|町|村))/);
  if (regexMatch?.[1]) {
    pushMany(buildGeocodeQueryVariants(regexMatch[1]));
    if (queries.length > 0) return queries.slice(0, 12);
  }

  const tokenMatch = prompt.match(LOCATION_TOKEN_PATTERN);
  if (tokenMatch?.[1]) {
    pushMany(buildGeocodeQueryVariants(tokenMatch[1]));
    if (queries.length > 0) return queries.slice(0, 12);
  }

  const firstChunk = prompt.split(/[、,。]/)[0]?.trim() || "";
  if (firstChunk) {
    pushMany(buildGeocodeQueryVariants(firstChunk));
    if (queries.length > 0) return queries.slice(0, 12);
  }

  const cleaned = prompt
    .replace(/現在地周辺で|現在地周辺|現在地|周辺|近く|付近/g, "")
    .replace(/^[\s、,。]+/, "")
    .trim();
  if (cleaned) {
    pushMany(buildGeocodeQueryVariants(cleaned.slice(0, 20)));
  }
  return queries.slice(0, 12);
};

const SPECIFIC_POI_QUERY_PATTERN =
  /(店|神社|寺|駅|ホテル|旅館|図書館|博物館|美術館|公園|空港|港|病院|学校|大学|キャンパス|センター|モール|郵便局|役場|市役所|県庁|丁目|番地|号)/i;
const BROAD_AREA_QUERY_PATTERN = /(都|道|府|県|市|区|町|村|島|半島|岬|山|川|湖|湾)$/;

const isBroadAreaLocationQuery = (query: string) => {
  const cleaned = cleanGeoQuery(query);
  if (!cleaned) return false;
  if (/[0-9０-９]/.test(cleaned)) return false;
  if (SPECIFIC_POI_QUERY_PATTERN.test(cleaned)) return false;
  if (BROAD_AREA_QUERY_PATTERN.test(cleaned)) return true;
  return KNOWN_PLACE_PATTERNS.includes(cleaned);
};

const jitterCenterWithinKm = (
  center: { lat: number; lng: number },
  maxDistanceKm: number
) => {
  const maxDist = Math.max(0.2, maxDistanceKm);
  const distanceKm = Math.sqrt(Math.random()) * maxDist;
  const theta = Math.random() * Math.PI * 2;
  const latScale = 111.32;
  const lngScale = 111.32 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180));
  return {
    lat: center.lat + (distanceKm * Math.cos(theta)) / latScale,
    lng: center.lng + (distanceKm * Math.sin(theta)) / lngScale,
  };
};

type GeoBBox = { south: number; north: number; west: number; east: number };

const isValidGeoBBox = (bbox?: GeoBBox) =>
  Boolean(
    bbox &&
      isFiniteNumber(bbox.south) &&
      isFiniteNumber(bbox.north) &&
      isFiniteNumber(bbox.west) &&
      isFiniteNumber(bbox.east) &&
      bbox.south < bbox.north &&
      bbox.west < bbox.east
  );

const randomPointWithinBBox = (bbox: GeoBBox) => ({
  lat: bbox.south + Math.random() * (bbox.north - bbox.south),
  lng: bbox.west + Math.random() * (bbox.east - bbox.west),
});

const withDistanceFromCenter = (
  candidates: SpotCandidate[],
  center: { lat: number; lng: number }
) =>
  candidates
    .map((candidate) => ({
      ...candidate,
      distance_km:
        typeof candidate.distance_km === "number"
          ? haversineKm(center, candidate)
          : haversineKm(center, candidate),
    }))
    .sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));

const countCandidatesWithinRadius = (
  candidates: SpotCandidate[],
  center: { lat: number; lng: number },
  radiusKm: number
) =>
  candidates.reduce((count, candidate) => {
    const distance = haversineKm(center, candidate);
    return distance <= radiusKm + 1e-6 ? count + 1 : count;
  }, 0);

type RouteHintInput = {
  prompt?: string;
  theme_tags?: string[];
  genre_support?: string;
  tone_support?: string;
  prompt_support?: {
    where?: string;
    purpose?: string;
    objective?: string;
  };
};

const deriveRouteStartHints = (inputData: RouteHintInput) => {
  const hints: string[] = [];
  const push = (value: string) => {
    const cleaned = cleanGeoQuery(value);
    if (!looksLikeAreaLabel(cleaned)) return;
    if (!hints.includes(cleaned)) hints.push(cleaned);
  };

  const where = inputData.prompt_support?.where?.trim();
  if (where) push(where);

  const prompt = inputData.prompt?.trim() || "";
  if (!prompt) return hints.slice(0, 12);

  for (const place of KNOWN_PLACE_PATTERNS) {
    if (prompt.includes(place)) push(place);
  }

  derivePromptHeadLocationHints(prompt).forEach((hint) => push(hint));

  const particleMatch = prompt.match(/([^\s、,。]{2,16})(?:で|に|へ|から|周辺|付近)/);
  if (particleMatch?.[1]) push(particleMatch[1]);

  const tokenMatch = prompt.match(LOCATION_TOKEN_PATTERN);
  if (tokenMatch?.[1]) push(tokenMatch[1]);

  const firstChunk = prompt.split(/[、,。]/)[0]?.trim() || "";
  if (firstChunk) push(firstChunk);

  return hints.slice(0, 12);
};

type RouteIntent = "tourism" | "food" | "history" | "scary";

const ROUTE_INTENT_RULES: Record<
  RouteIntent,
  { detect: RegExp[]; kindHints: string[]; textHints: string[] }
> = {
  tourism: {
    detect: [
      /(観光|まち歩き|散策|散歩|景色|絶景|名所|自然|フォト|写真|映え)/i,
      /(sightseeing|tour|explore|walk)/i,
    ],
    kindHints: [
      "観光:",
      "観光名所",
      "展望スポット",
      "博物館",
      "ギャラリー",
      "アート作品",
      "公園",
      "庭園",
      "自然保護区",
      "ビーチ",
    ],
    textHints: [
      "観光",
      "名所",
      "絶景",
      "景色",
      "展望",
      "ミュージアム",
      "museum",
      "gallery",
      "viewpoint",
    ],
  },
  food: {
    detect: [
      /(食べ|グルメ|ランチ|ディナー|カフェ|スイーツ|海鮮|居酒屋|レストラン|食事|飲み歩き)/i,
      /(food|gourmet|restaurant|cafe|sweets)/i,
    ],
    kindHints: [
      "生活:飲食店",
      "生活:カフェ",
      "生活:ファストフード",
      "生活:バー",
      "生活:パブ",
      "生活:市場",
      "買い物:菓子店",
      "買い物:ベーカリー",
      "買い物:鮮魚店",
      "買い物:青果店",
    ],
    textHints: [
      "食",
      "グルメ",
      "ランチ",
      "ディナー",
      "カフェ",
      "スイーツ",
      "海鮮",
      "restaurant",
      "cafe",
    ],
  },
  history: {
    detect: [
      /(歴史|史跡|遺跡|神社|寺|城|文化|伝統|幕末|戦国)/i,
      /(history|historic|heritage|culture)/i,
    ],
    kindHints: [
      "歴史:",
      "城",
      "遺跡",
      "古戦場",
      "記念碑",
      "記念物/慰霊碑",
      "墓所",
      "遺構",
      "路傍祠",
    ],
    textHints: [
      "歴史",
      "史跡",
      "遺跡",
      "城",
      "神社",
      "寺",
      "文化",
      "historic",
      "heritage",
    ],
  },
  scary: {
    detect: [
      /(怖|こわ|ホラー|心霊|怪談|不気味|ゾク|ぞく|サスペンス|スリル|ミステリー)/i,
      /(horror|scary|spooky|thrill|suspense)/i,
    ],
    kindHints: [
      "歴史:遺跡",
      "歴史:遺構",
      "歴史:古戦場",
      "歴史:墓所",
      "歴史:記念物/慰霊碑",
    ],
    textHints: [
      "怖",
      "ホラー",
      "心霊",
      "怪談",
      "不気味",
      "廃",
      "遺跡",
      "墓",
      "horror",
      "spooky",
    ],
  },
};

const collectRouteIntentTexts = (inputData: RouteHintInput) => {
  const texts: string[] = [];
  const push = (value?: string | null) => {
    if (typeof value !== "string") return;
    const text = value.trim();
    if (!text) return;
    texts.push(text);
  };

  push(inputData.prompt);
  push(inputData.prompt_support?.purpose);
  push(inputData.prompt_support?.objective);
  push(inputData.genre_support);
  push(inputData.tone_support);
  (inputData.theme_tags || []).forEach((tag) => push(tag));

  return texts;
};

const deriveRouteIntentHints = (inputData: RouteHintInput) => {
  const texts = collectRouteIntentTexts(inputData);
  if (texts.length === 0) return [] as RouteIntent[];
  const joined = texts.join(" ").toLowerCase();
  const intents: RouteIntent[] = [];

  (Object.keys(ROUTE_INTENT_RULES) as RouteIntent[]).forEach((intent) => {
    const matched = ROUTE_INTENT_RULES[intent].detect.some((pattern) =>
      pattern.test(joined)
    );
    if (matched) intents.push(intent);
  });

  return intents;
};

const scoreCandidateByRouteIntent = (
  candidate: SpotCandidate,
  intents: RouteIntent[]
) => {
  if (intents.length === 0) return 0;
  const kinds = (candidate.kinds || "").toLowerCase();
  const haystack = [
    candidate.name || "",
    candidate.description || "",
    candidate.tourism_summary || "",
    candidate.address || "",
    candidate.kinds || "",
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  intents.forEach((intent) => {
    const rule = ROUTE_INTENT_RULES[intent];
    rule.kindHints.forEach((hint) => {
      if (kinds.includes(hint.toLowerCase())) score += 5;
    });
    rule.textHints.forEach((hint) => {
      if (haystack.includes(hint.toLowerCase())) score += 2;
    });
  });
  return score;
};

const buildIntentAwareCandidatePool = (params: {
  inputData: RouteHintInput;
  candidates: SpotCandidate[];
  center: { lat: number; lng: number };
  radiusKm: number;
  spotCount: number;
}) => {
  const { inputData, candidates, center, radiusKm, spotCount } = params;
  const intents = deriveRouteIntentHints(inputData);
  if (intents.length === 0 || candidates.length === 0) {
    return {
      intents,
      applied: false,
      candidates,
      stats: {
        matched: 0,
        total: candidates.length,
        selected: candidates.length,
        minSeparationKm: 0.1,
      },
    };
  }

  const scored = candidates.map((candidate) => ({
    candidate,
    score: scoreCandidateByRouteIntent(candidate, intents),
    distanceKm:
      typeof candidate.distance_km === "number"
        ? candidate.distance_km
        : haversineKm(center, candidate),
  }));

  const matched = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm)
    .map((entry) => entry.candidate);

  if (matched.length === 0) {
    return {
      intents,
      applied: false,
      candidates,
      stats: {
        matched: 0,
        total: candidates.length,
        selected: candidates.length,
        minSeparationKm: 0.1,
      },
    };
  }

  const fallback = scored
    .filter((entry) => entry.score === 0)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map((entry) => entry.candidate);

  const targetPool = Math.min(
    candidates.length,
    Math.max(18, Math.min(48, spotCount * 6))
  );
  const useMatchedOnly = matched.length >= Math.max(16, spotCount * 2);
  const sourceLists = useMatchedOnly ? [matched] : [matched, fallback];
  const merged = mergeCandidates({
    lists: sourceLists,
    center,
    radiusKm: Math.max(0.5, radiusKm),
    maxCandidates: targetPool,
    minSeparationKm: 0.1,
    sectorCount: 10,
    ringCount: 3,
  });
  const { selected: mergedSelected } = merged.stats;

  const selectedPool =
    merged.merged.length >= spotCount
      ? merged.merged
      : useMatchedOnly && matched.length >= spotCount
        ? matched.slice(0, Math.max(spotCount, Math.min(targetPool, matched.length)))
        : candidates;

  return {
    intents,
    applied: true,
    candidates: selectedPool,
    stats: {
      ...merged.stats,
      matched: matched.length,
      total: candidates.length,
      selected: selectedPool.length,
      mergedSelected,
      targetPool,
      minSeparationKm: 0.1,
      matchedOnlyMode: useMatchedOnly,
    },
  };
};

const runRouteSearchWithIntentPreference = (params: {
  inputData: z.infer<typeof candidatesSchema>;
  center: { lat: number; lng: number };
  constraints: { minLegKm: number; maxLegKm: number };
  routeStartHints: string[];
}) => {
  const { inputData, center, constraints, routeStartHints } = params;
  const hardMaxLegKm = 10;

  const resolveStepThresholdsKm = (minLegKm: number) => {
    const primary = Math.max(0.1, minLegKm);
    const values = Array.from(new Set([primary, 0.08, 0.05]))
      .map((value) => Math.max(0.03, Math.min(1.5, value)))
      .sort((a, b) => b - a);
    return values;
  };

  const selectStartIndex = (candidates: SpotCandidate[]) => {
    if (candidates.length === 0) return -1;
    const normalizedHints = routeStartHints
      .map((hint) => normalizeCandidateName(hint))
      .filter(Boolean);
    const byDistance = candidates
      .map((candidate, index) => ({
        index,
        distanceKm:
          typeof candidate.distance_km === "number"
            ? candidate.distance_km
            : haversineKm(center, candidate),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
    if (normalizedHints.length > 0) {
      const exactMatched = byDistance.find(({ index }) => {
        const name = normalizeCandidateName(candidates[index]?.name || "");
        if (!name) return false;
        return normalizedHints.some((hint) => name === hint);
      });
      if (exactMatched) return exactMatched.index;

      const matched = byDistance.find(({ index }) => {
        const name = normalizeCandidateName(candidates[index]?.name || "");
        if (!name) return false;
        return normalizedHints.some((hint) => name.includes(hint) || hint.includes(name));
      });
      if (matched) return matched.index;
    }
    return byDistance[0]?.index ?? -1;
  };

  const runSequentialNearest = (candidates: SpotCandidate[], minLegKm: number) => {
    const stepThresholdsKm = resolveStepThresholdsKm(minLegKm);
    if (candidates.length < inputData.spot_count || inputData.spot_count <= 0) {
      return {
        route: [] as SpotCandidate[],
        diagnostics: {
          planner: "sequential_nearest_v1",
          candidateCount: candidates.length,
          requestedSpotCount: inputData.spot_count,
          stepThresholdsKm,
          failureReason: "insufficient_candidates",
          selectedCount: 0,
        },
      };
    }

    const startIndex = selectStartIndex(candidates);
    if (startIndex < 0) {
      return {
        route: [] as SpotCandidate[],
        diagnostics: {
          planner: "sequential_nearest_v1",
          candidateCount: candidates.length,
          requestedSpotCount: inputData.spot_count,
          stepThresholdsKm,
          failureReason: "start_not_found",
          selectedCount: 0,
        },
      };
    }

    const path: number[] = [startIndex];
    const visited = new Set<number>(path);
    const thresholdTrail: number[] = [];
    const legTrailKm: number[] = [];

    while (path.length < inputData.spot_count) {
      const currentIndex = path[path.length - 1];
      const current = candidates[currentIndex];
      let pickedIndex = -1;
      let pickedThreshold = 0;
      let pickedDistanceKm = Number.POSITIVE_INFINITY;

      for (const thresholdKm of stepThresholdsKm) {
        let bestIndex = -1;
        let bestDistanceKm = Number.POSITIVE_INFINITY;

        for (let i = 0; i < candidates.length; i += 1) {
          if (visited.has(i)) continue;
          const legKm = haversineKm(current, candidates[i]);
          if (legKm + 1e-6 < thresholdKm) continue;
          if (legKm - 1e-6 > hardMaxLegKm) continue;
          if (legKm < bestDistanceKm) {
            bestDistanceKm = legKm;
            bestIndex = i;
          }
        }

        if (bestIndex >= 0) {
          pickedIndex = bestIndex;
          pickedThreshold = thresholdKm;
          pickedDistanceKm = bestDistanceKm;
          break;
        }
      }

      if (pickedIndex < 0 || !Number.isFinite(pickedDistanceKm)) {
        const partialRoute = path.map((idx) => candidates[idx]);
        return {
          route: partialRoute,
          diagnostics: {
            planner: "sequential_nearest_v1",
            candidateCount: candidates.length,
            requestedSpotCount: inputData.spot_count,
            selectedCount: partialRoute.length,
            startIndex,
            startName: candidates[startIndex]?.name || "",
            hardMaxLegKm,
            stepThresholdsKm,
            thresholdTrail,
            legTrailKm,
            failedAtStep: path.length,
            failureReason: "no_next_spot_for_thresholds",
          },
        };
      }

      path.push(pickedIndex);
      visited.add(pickedIndex);
      thresholdTrail.push(pickedThreshold);
      legTrailKm.push(pickedDistanceKm);
    }

    const route = path.map((index) => candidates[index]);
    const totalKm = legTrailKm.reduce((sum, value) => sum + value, 0);
    return {
      route,
      diagnostics: {
        planner: "sequential_nearest_v1",
        candidateCount: candidates.length,
        requestedSpotCount: inputData.spot_count,
        selectedCount: route.length,
        startIndex,
        startName: candidates[startIndex]?.name || "",
        hardMaxLegKm,
        stepThresholdsKm,
        thresholdTrail,
        legTrailKm,
        totalKm,
        fallbackUsed: thresholdTrail.some(
          (threshold) => threshold + 1e-9 < stepThresholdsKm[0]
        ),
      },
    };
  };

  const runSearch = (candidates: SpotCandidate[], minLegKm: number) => {
    const sequential = runSequentialNearest(candidates, minLegKm);
    if (sequential.route.length === inputData.spot_count) {
      return sequential;
    }

    const fallback = selectRouteCandidatesWithDiagnostics(
      candidates,
      center,
      inputData.spot_count,
      constraints.maxLegKm,
      minLegKm,
      {
        startNameHints: routeStartHints,
        greedyStepFallbackKm: [0.1, 0.08, 0.05],
      }
    );

    return {
      route: fallback.route,
      diagnostics: {
        planner: "sequential_then_fallback_v1",
        selectedPlanner:
          fallback.route.length === inputData.spot_count
            ? "fallback_random_heading_v1"
            : "none",
        sequential: sequential.diagnostics,
        fallback: fallback.diagnostics,
      },
    };
  };

  const defaultSearch = runSearch(
    inputData.spot_candidates,
    Math.max(0.1, constraints.minLegKm)
  );
  return {
    routeSearch: defaultSearch,
    strategy:
      defaultSearch.route.length === inputData.spot_count
        ? "overpass_sequential"
        : "overpass_sequential_fallback",
    themedDiagnostics: undefined,
    themedPool: {
      intents: [] as RouteIntent[],
      applied: false,
      candidates: inputData.spot_candidates,
      stats: {
        matched: 0,
        total: inputData.spot_candidates.length,
        selected: inputData.spot_candidates.length,
        minSeparationKm: 0.1,
      },
    },
  };
};

const parseOverpassElements = (value?: string) => {
  const allowed = new Set(["node", "way", "relation"]);
  const list = (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => allowed.has(item));
  return (list.length > 0 ? list : ["node", "way", "relation"]) as Array<
    "node" | "way" | "relation"
  >;
};

const normalizeCandidateName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[、。,.!！?？・\-–—]/g, "");

const toPlanarOffsetKm = (
  center: { lat: number; lng: number },
  point: { lat: number; lng: number }
) => {
  const latScale = 111.32;
  const lngScale = 111.32 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180));
  return {
    x: (point.lng - center.lng) * lngScale,
    y: (point.lat - center.lat) * latScale,
  };
};

const buildSpatialOrder = (params: {
  candidates: SpotCandidate[];
  center: { lat: number; lng: number };
  radiusKm: number;
  sectorCount: number;
  ringCount: number;
}) => {
  const { candidates, center, radiusKm, sectorCount, ringCount } = params;
  const buckets = new Map<string, SpotCandidate[]>();
  const safeRadius = Math.max(0.3, radiusKm);
  const tau = Math.PI * 2;

  candidates.forEach((candidate) => {
    const distanceKm =
      typeof candidate.distance_km === "number"
        ? candidate.distance_km
        : haversineKm(center, candidate);
    const norm = Math.max(0, Math.min(1, distanceKm / safeRadius));
    const ring = Math.min(ringCount - 1, Math.floor(Math.sqrt(norm) * ringCount));
    const offset = toPlanarOffsetKm(center, candidate);
    const angle = (Math.atan2(offset.y, offset.x) + tau) % tau;
    const sector = Math.min(sectorCount - 1, Math.floor((angle / tau) * sectorCount));
    const key = `${ring}:${sector}`;
    const bucket = buckets.get(key) || [];
    bucket.push(candidate);
    buckets.set(key, bucket);
  });

  buckets.forEach((bucket) => {
    bucket.sort((a, b) => {
      const da =
        typeof a.distance_km === "number" ? a.distance_km : haversineKm(center, a);
      const db =
        typeof b.distance_km === "number" ? b.distance_km : haversineKm(center, b);
      return da - db;
    });
  });

  const keys = Array.from(buckets.keys()).sort((a, b) => {
    const [ar, as] = a.split(":").map((v) => Number.parseInt(v, 10));
    const [br, bs] = b.split(":").map((v) => Number.parseInt(v, 10));
    if (ar !== br) return br - ar;
    return as - bs;
  });

  const pointers = new Map<string, number>();
  keys.forEach((key) => pointers.set(key, 0));

  const ordered: SpotCandidate[] = [];
  while (true) {
    let pushed = false;
    keys.forEach((key) => {
      const bucket = buckets.get(key) || [];
      const pointer = pointers.get(key) || 0;
      if (pointer < bucket.length) {
        ordered.push(bucket[pointer]);
        pointers.set(key, pointer + 1);
        pushed = true;
      }
    });
    if (!pushed) break;
  }
  return { ordered, bucketCount: keys.length };
};

const mergeCandidates = (params: {
  lists: SpotCandidate[][];
  center: { lat: number; lng: number };
  radiusKm: number;
  maxCandidates: number;
  minSeparationKm: number;
  sectorCount: number;
  ringCount: number;
}) => {
  const {
    lists,
    center,
    radiusKm,
    maxCandidates,
    minSeparationKm,
    sectorCount,
    ringCount,
  } = params;
  const seen = new Map<string, SpotCandidate>();
  lists.flat().forEach((candidate) => {
    const name = candidate?.name || "";
    const normalized = normalizeCandidateName(name);
    if (!normalized) return;
    const existing = seen.get(normalized);
    if (!existing) {
      seen.set(normalized, candidate);
      return;
    }
    const existingDist = existing.distance_km ?? Number.POSITIVE_INFINITY;
    const nextDist = candidate.distance_km ?? Number.POSITIVE_INFINITY;
    if (nextDist < existingDist) {
      seen.set(normalized, candidate);
    }
  });

  const deduped = Array.from(seen.values());
  const withinRadius = deduped
    .map((candidate) => ({
      ...candidate,
      distance_km:
        typeof candidate.distance_km === "number"
          ? candidate.distance_km
          : haversineKm(center, candidate),
    }))
    .filter((candidate) => (candidate.distance_km ?? 0) <= radiusKm + 1e-6);

  const { ordered, bucketCount } = buildSpatialOrder({
    candidates: withinRadius,
    center,
    radiusKm,
    sectorCount,
    ringCount,
  });

  const selected: SpotCandidate[] = [];
  const used = new Set<string>();
  const pushIfFarEnough = (candidate: SpotCandidate, thresholdKm: number) => {
    const key = normalizeCandidateName(candidate.name || "");
    if (!key || used.has(key)) return false;
    const farEnough = selected.every(
      (picked) => haversineKm(picked, candidate) + 1e-6 >= thresholdKm
    );
    if (!farEnough) return false;
    selected.push(candidate);
    used.add(key);
    return true;
  };

  let threshold = Math.max(0.03, minSeparationKm);
  for (let pass = 0; pass < 4 && selected.length < maxCandidates; pass += 1) {
    ordered.forEach((candidate) => {
      if (selected.length >= maxCandidates) return;
      pushIfFarEnough(candidate, threshold);
    });
    threshold = Math.max(0.03, threshold * 0.72);
  }

  if (selected.length < maxCandidates) {
    ordered.forEach((candidate) => {
      if (selected.length >= maxCandidates) return;
      const key = normalizeCandidateName(candidate.name || "");
      if (!key || used.has(key)) return;
      selected.push(candidate);
      used.add(key);
    });
  }

  return {
    merged: selected.slice(0, maxCandidates),
    stats: {
      deduped: deduped.length,
      withinRadius: withinRadius.length,
      bucketCount,
      minSeparationKm,
      selected: Math.min(maxCandidates, selected.length),
    },
  };
};

const buildTourismAnchor = (candidate: SpotCandidate) => {
  const name = candidate.name || "このスポット";
  const precomputedSummary = candidate.tourism_summary?.trim();
  if (precomputedSummary) {
    return precomputedSummary.replace(/\s+/g, " ").slice(0, 160);
  }
  const description = candidate.description?.trim();
  if (description) {
    return description.replace(/\s+/g, " ").slice(0, 140);
  }
  const address = candidate.address?.trim();
  const kind = candidate.kinds?.split(",")[0]?.trim();
  const location = address ? `${address}にある` : "";
  const category = kind ? `${kind}のスポット` : "観光スポット";
  return `${name}は${location}${category}。`;
};

const TOURISM_KEYWORD_STOPWORDS = new Set([
  "観光",
  "名所",
  "スポット",
  "場所",
  "地域",
  "文化",
  "歴史",
  "背景",
  "情報",
  "体験",
  "名物",
  "施設",
  "周辺",
  "徒歩",
  "導線",
  "拠点",
  "魅力",
  "おすすめ",
  "ポイント",
  "文脈",
  "手がかり",
]);

const normalizeTourismKeywordToken = (value: string) =>
  value
    .replace(/[「」『』【】()（）［］\[\]'"`]/g, "")
    .replace(/[、。,.!！?？:：]/g, "")
    .replace(/[はがをにでへとやのも]+$/g, "")
    .trim();

const extractSpotSpecificTourismKeywords = (params: {
  spotName: string;
  tourismSummary?: string;
  tourismKeywords?: string[];
}) => {
  const fromModel = Array.isArray(params.tourismKeywords) ? params.tourismKeywords : [];
  const summary = (params.tourismSummary || "").trim();
  const signatureSeeds: string[] = [];

  const patterns: Array<[RegExp, string]> = [
    [/(?:ウニ|うに)/i, "ウニ"],
    [/壱岐牛/i, "壱岐牛"],
    [/古墳/i, "古墳"],
    [/神社/i, "神社"],
    [/寺(?:院)?/i, "寺院"],
    [/記念碑/i, "記念碑"],
    [/展望(?:所|台|スポット)?/i, "展望"],
    [/温泉/i, "温泉"],
    [/寿司/i, "寿司"],
    [/ラーメン/i, "ラーメン"],
  ];
  patterns.forEach(([pattern, label]) => {
    if (pattern.test(summary) || pattern.test(params.spotName)) signatureSeeds.push(label);
  });

  const summaryTokens = summary
    .split(/[、。,\s/・|｜:：;；]+/)
    .map((token) => normalizeTourismKeywordToken(token))
    .filter((token) => token.length >= 2 && token.length <= 16);

  const seedTokens = [...fromModel, ...signatureSeeds, ...summaryTokens];
  const seen = new Set<string>();
  const out: string[] = [];
  seedTokens.forEach((token) => {
    const normalized = normalizeTourismKeywordToken(token);
    if (!normalized) return;
    if (TOURISM_KEYWORD_STOPWORDS.has(normalized)) return;
    const key = normalized.toLocaleLowerCase("ja-JP");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  });

  if (out.length === 0) {
    const fallback = normalizeTourismKeywordToken(params.spotName)
      .replace(/(ホテル|旅館|神社|寺院|寺|図書館|博物館|資料館|公園|食堂|カフェ|レストラン)$/g, "")
      .trim();
    if (fallback.length >= 2) out.push(fallback);
  }

  return out.slice(0, 6);
};

const toAreaHint = (input: z.infer<typeof candidatesSchema>, spots: SpotCandidate[]) => {
  const where = input.prompt_support?.where?.trim();
  if (where) return where;
  const promptHead = (input.prompt || "").split(/[、,。]/)[0]?.trim();
  if (promptHead) return promptHead.slice(0, 40);
  const address = spots.find((spot) => spot.address?.trim())?.address?.trim();
  if (address) return address.slice(0, 40);
  return "";
};

const NARRATION_BLOCK_SEPARATOR = "\n---\n";
const MISSION_PREFIX = "[MISSION]";

const serializeNarrationBlocks = (blocks: Array<{ type: "narration" | "mission"; text: string }>) =>
  blocks
    .map((block) => {
      const text = block.text?.trim();
      if (!text) return "";
      const prefix = block.type === "mission" ? MISSION_PREFIX : "";
      return `${prefix}${text}`;
    })
    .filter(Boolean)
    .join(NARRATION_BLOCK_SEPARATOR);

const sanitizeNarrationText = (value: string) => {
  let text = value.trim();
  text = text.replace(/^(sceneObjective|sceneRole|objective|mission)[:：]\s*/i, "");
  text = text.replace(/^ミッション[:：]\s*/i, "");
  text = text.replace(/^目的[:：]\s*/i, "");
  return text.trim();
};

const resolveCenterStep = createStep({
  id: "resolve-center",
  inputSchema: requestSchema,
  outputSchema: resolvedSchema,
  execute: async ({ inputData }) =>
    withQuestProgress("resolve_input", async () => {
      const baseRadius = Math.max(0.3, parseFloat(process.env.MASTRA_RADIUS_KM || "") || 5);
      const configuredMaxRadiusRaw = parseFloat(process.env.MASTRA_MAX_RADIUS_KM || "");
      const maxRadius = Number.isFinite(configuredMaxRadiusRaw)
        ? Math.max(baseRadius, configuredMaxRadiusRaw)
        : Math.max(baseRadius, 25);
      const center = inputData.center_location;
      const radius = Math.max(0.3, inputData.radius_km ?? baseRadius);
      return {
        ...inputData,
        difficulty: inputData.difficulty ?? "medium",
        center_location: center,
        radius_km: Math.min(radius, maxRadius),
      };
    }),
});

const fetchCandidatesStep = createStep({
  id: "fetch-candidates",
  inputSchema: resolvedSchema,
  outputSchema: candidatesSchema,
  execute: async ({ inputData }) =>
    withQuestProgress("fetch_candidates", async () => {
    if (Array.isArray(inputData.spot_candidates) && inputData.spot_candidates.length > 0) {
      logWorkflow("fetch-candidates:ignore-input-candidates", {
        provided: inputData.spot_candidates.length,
      });
    }

    const radiusKm = Math.max(0.3, inputData.radius_km ?? 5);
    const lang = process.env.MASTRA_LANG || "ja";
    const overpassElements = parseOverpassElements(process.env.MASTRA_OVERPASS_ELEMENTS);
    const overpassEndpoints = (process.env.MASTRA_OVERPASS_ENDPOINTS || "")
      .split(",")
      .map((item: string) => item.trim())
      .filter(Boolean);
    const overpassTimeoutSec = parseInt(process.env.MASTRA_OVERPASS_TIMEOUT_SEC || "25", 10);
    const overpassTimeoutMs = parseInt(process.env.MASTRA_OVERPASS_TIMEOUT_MS || "20000", 10);

    const explicitWhere = inputData.prompt_support?.where?.trim() || "";
    const promptText = inputData.prompt?.trim() || "";
    const promptHasKnownPlace = KNOWN_PLACE_PATTERNS.some((place) => promptText.includes(place));
    const shouldPreferPromptLocation =
      !inputData.center_location || Boolean(explicitWhere) || promptHasKnownPlace;
    const geocodeQueries = shouldPreferPromptLocation ? deriveGeocodeQueries(inputData) : [];
    const geocodeQuery = geocodeQueries[0] || "";
    const geocodeCountryCodes = (process.env.MASTRA_NOMINATIM_COUNTRYCODES || "jp")
      .split(",")
      .map((item: string) => item.trim().toLowerCase())
      .filter(Boolean);
    const geocodeEndpoints = (
      process.env.MASTRA_NOMINATIM_ENDPOINTS || process.env.MASTRA_NOMINATIM_ENDPOINT || ""
    )
      .split(",")
      .map((item: string) => item.trim())
      .filter(Boolean);
    const fallbackLat = parseFloat(process.env.MASTRA_FALLBACK_CENTER_LAT || "");
    const fallbackLng = parseFloat(process.env.MASTRA_FALLBACK_CENTER_LNG || "");
    const configuredFallbackCenter =
      !inputData.center_location && isFiniteNumber(fallbackLat) && isFiniteNumber(fallbackLng)
        ? { lat: fallbackLat, lng: fallbackLng }
        : undefined;
    const keywordFallbackCenter = !inputData.center_location
      ? inferFallbackCenterByKeyword([explicitWhere, promptText, geocodeQuery, ...geocodeQueries])
      : undefined;
    const fallbackCenter = keywordFallbackCenter || configuredFallbackCenter;

    logWorkflow("fetch-candidates:start", {
      spot_count: inputData.spot_count,
      radius_km: radiusKm,
      center_location: inputData.center_location ?? null,
      include_national_chains: Boolean(inputData.include_national_chains),
      geocodeQuery: geocodeQuery || null,
      geocodeQueries: geocodeQueries.length > 1 ? geocodeQueries : undefined,
      geocodeEndpoints: geocodeEndpoints.length,
      overpassEndpoints: overpassEndpoints.length,
      source_policy: "overpass_geo_only",
      prompt_location_preferred: shouldPreferPromptLocation,
    });

    let center = inputData.center_location || fallbackCenter;
    let resolvedGeocodeQuery: string | undefined;
    let resolvedGeocodeBBox: GeoBBox | undefined;
    if (geocodeQueries.length > 0) {
      const endpointCandidates =
        geocodeEndpoints.length > 0
          ? geocodeEndpoints
          : ["https://nominatim.openstreetmap.org/search"];
      for (const query of geocodeQueries) {
        for (const endpoint of endpointCandidates) {
          const geocodeResult = await geocodeWithNominatim({
            query,
            endpoint,
            lang,
            timeoutMs: 8000,
            userAgent: process.env.MASTRA_NOMINATIM_USER_AGENT,
            countryCodes: geocodeCountryCodes,
          });
          if (geocodeResult) {
            center = { lat: geocodeResult.lat, lng: geocodeResult.lng };
            resolvedGeocodeQuery = query;
            resolvedGeocodeBBox = isValidGeoBBox(geocodeResult.bbox)
              ? geocodeResult.bbox
              : undefined;
            logWorkflow("fetch-candidates:geocode-success", {
              query,
              endpoint,
              center,
              bbox: resolvedGeocodeBBox || undefined,
              overrode_input_center: Boolean(inputData.center_location),
            });
            break;
          }
          logWorkflow("fetch-candidates:geocode-miss", { query, endpoint });
        }
        if (center) break;
      }
    }

    if (!center) {
      logWorkflow("fetch-candidates:missing-center", {
        geocodeQuery: geocodeQuery || null,
        geocodeQueries,
      });
      throw new Error("center_location is required or geocode must succeed");
    }

    const randomizeBroadAreaCenter =
      process.env.MASTRA_RANDOMIZE_BROAD_AREA_CENTER !== "0" &&
      !inputData.center_location &&
      isBroadAreaLocationQuery(resolvedGeocodeQuery || geocodeQuery);
    const randomCenterTrialsRaw = parseInt(
      process.env.MASTRA_BROAD_AREA_RANDOM_CENTER_TRIALS || "4",
      10
    );
    const randomCenterTrials = Number.isFinite(randomCenterTrialsRaw)
      ? Math.min(10, Math.max(1, randomCenterTrialsRaw))
      : 4;
    const randomCenterJitterRaw = parseFloat(
      process.env.MASTRA_BROAD_AREA_RANDOM_CENTER_KM || ""
    );
    const randomCenterJitterKm = isFiniteNumber(randomCenterJitterRaw)
      ? Math.min(20, Math.max(0.5, randomCenterJitterRaw))
      : Math.min(20, Math.max(4, radiusKm * 3));

    logWorkflow("fetch-candidates:center-strategy", {
      strategy: randomizeBroadAreaCenter ? "broad_area_randomized" : "fixed_center",
      explicit_center: Boolean(inputData.center_location),
      geocode_query: resolvedGeocodeQuery || geocodeQuery || null,
      random_trials: randomizeBroadAreaCenter ? randomCenterTrials : 0,
      random_jitter_km: randomizeBroadAreaCenter ? randomCenterJitterKm : 0,
      geocode_bbox: resolvedGeocodeBBox || undefined,
    });

    const fetchAroundCandidates = async (
      centerPoint: { lat: number; lng: number },
      radius: number
    ) => {
      let overpass = { candidates: [] as SpotCandidate[], totalFetched: 0 };
      try {
        overpass = await fetchOverpassCandidates({
          center: centerPoint,
          radiusKm: radius,
          includeConvenience: Boolean(inputData.include_national_chains),
          elementTypes: overpassElements,
          endpoints: overpassEndpoints.length > 0 ? overpassEndpoints : undefined,
          timeoutSec: overpassTimeoutSec,
          timeoutMs: overpassTimeoutMs,
        });
      } catch {
        // Ignore transient endpoint errors and continue with remaining data.
      }

      const allCandidates = withDistanceFromCenter(overpass.candidates, centerPoint)
        .filter((candidate) => (candidate.distance_km ?? 0) <= radius + 1e-6)
        .sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));

      logWorkflow("fetch-candidates:batch", {
        mode: "around",
        radius_km: radius,
        overpass_total_fetched: overpass.totalFetched,
        overpass_candidates: overpass.candidates.length,
        all_candidates: allCandidates.length,
      });
      return { candidates: allCandidates };
    };

    const fetchBBoxCandidates = async (
      bbox: GeoBBox,
      centerPoint: { lat: number; lng: number }
    ) => {
      let overpass = { candidates: [] as SpotCandidate[], totalFetched: 0 };
      try {
        overpass = await fetchOverpassCandidatesInBbox({
          bbox,
          includeConvenience: Boolean(inputData.include_national_chains),
          elementTypes: overpassElements,
          endpoints: overpassEndpoints.length > 0 ? overpassEndpoints : undefined,
          timeoutSec: overpassTimeoutSec,
          timeoutMs: overpassTimeoutMs,
          distanceCenter: centerPoint,
        });
      } catch {
        // Ignore transient endpoint errors and continue with remaining data.
      }
      const allCandidates = withDistanceFromCenter(overpass.candidates, centerPoint);
      logWorkflow("fetch-candidates:batch", {
        mode: "bbox",
        bbox,
        radius_km: radiusKm,
        overpass_total_fetched: overpass.totalFetched,
        overpass_candidates: overpass.candidates.length,
        all_candidates: allCandidates.length,
      });
      return { candidates: allCandidates };
    };

    let currentRadius = radiusKm;
    let candidateResult: { candidates: SpotCandidate[] };
    const useBBoxBroadAreaFetch = randomizeBroadAreaCenter && isValidGeoBBox(resolvedGeocodeBBox);
    if (useBBoxBroadAreaFetch && resolvedGeocodeBBox) {
      const baseCenter = center;
      const fullAreaResult = await fetchBBoxCandidates(resolvedGeocodeBBox, baseCenter);
      const fullCandidates = fullAreaResult.candidates;
      const trialResults: Array<{
        trial: number;
        randomized: boolean;
        center: { lat: number; lng: number };
        local_candidates: number;
      }> = [];

      const baseLocalCount = countCandidatesWithinRadius(fullCandidates, baseCenter, currentRadius);
      trialResults.push({
        trial: 0,
        randomized: false,
        center: baseCenter,
        local_candidates: baseLocalCount,
      });
      logWorkflow("fetch-candidates:random-center-trial", {
        trial: 0,
        total_trials: randomCenterTrials,
        randomized: false,
        center_location: baseCenter,
        random_mode: "bbox",
        radius_km: currentRadius,
        local_candidates: baseLocalCount,
        pool_candidates: fullCandidates.length,
      });

      for (let trial = 1; trial <= randomCenterTrials; trial += 1) {
        const trialCenter = randomPointWithinBBox(resolvedGeocodeBBox);
        const localCount = countCandidatesWithinRadius(fullCandidates, trialCenter, currentRadius);
        trialResults.push({
          trial,
          randomized: true,
          center: trialCenter,
          local_candidates: localCount,
        });
        logWorkflow("fetch-candidates:random-center-trial", {
          trial,
          total_trials: randomCenterTrials,
          randomized: true,
          center_location: trialCenter,
          random_mode: "bbox",
          radius_km: currentRadius,
          local_candidates: localCount,
          pool_candidates: fullCandidates.length,
        });
      }

      const successfulTrials = trialResults.filter(
        (entry) => entry.local_candidates >= inputData.spot_count
      );
      const pickFrom = successfulTrials.length > 0 ? successfulTrials : trialResults;
      const selectedTrial = pickFrom[Math.floor(Math.random() * pickFrom.length)];
      center = selectedTrial.center;
      candidateResult = { candidates: withDistanceFromCenter(fullCandidates, center) };
      logWorkflow("fetch-candidates:random-center-selected", {
        selected_trial: selectedTrial.trial,
        randomized: selectedTrial.randomized,
        random_mode: "bbox",
        radius_km: currentRadius,
        candidates: candidateResult.candidates.length,
        local_candidates: selectedTrial.local_candidates,
        center_location: selectedTrial.center,
        successful_trial_count: successfulTrials.length,
      });
    } else if (randomizeBroadAreaCenter) {
      const baseCenter = center;
      const trialResults: Array<{
        trial: number;
        randomized: boolean;
        center: { lat: number; lng: number };
        result: { candidates: SpotCandidate[] };
      }> = [];

      const baseResult = await fetchAroundCandidates(baseCenter, currentRadius);
      trialResults.push({
        trial: 0,
        randomized: false,
        center: baseCenter,
        result: baseResult,
      });
      logWorkflow("fetch-candidates:random-center-trial", {
        trial: 0,
        total_trials: randomCenterTrials,
        randomized: false,
        center_location: baseCenter,
        radius_km: currentRadius,
        candidates: baseResult.candidates.length,
      });

      for (let trial = 1; trial <= randomCenterTrials; trial += 1) {
        const trialCenter = jitterCenterWithinKm(baseCenter, randomCenterJitterKm);
        const trialResult = await fetchAroundCandidates(trialCenter, currentRadius);
        trialResults.push({
          trial,
          randomized: true,
          center: trialCenter,
          result: trialResult,
        });
        logWorkflow("fetch-candidates:random-center-trial", {
          trial,
          total_trials: randomCenterTrials,
          randomized: true,
          center_location: trialCenter,
          radius_km: currentRadius,
          candidates: trialResult.candidates.length,
        });
      }

      const successfulTrials = trialResults.filter(
        (entry) => entry.result.candidates.length >= inputData.spot_count
      );
      const selectedTrial =
        successfulTrials.length > 0
          ? successfulTrials[Math.floor(Math.random() * successfulTrials.length)]
          : trialResults.reduce((best, entry) =>
              entry.result.candidates.length > best.result.candidates.length ? entry : best
            );

      center = selectedTrial.center;
      candidateResult = selectedTrial.result;
      logWorkflow("fetch-candidates:random-center-selected", {
        selected_trial: selectedTrial.trial,
        randomized: selectedTrial.randomized,
        random_mode: "jitter",
        radius_km: currentRadius,
        candidates: selectedTrial.result.candidates.length,
        center_location: selectedTrial.center,
        successful_trial_count: successfulTrials.length,
      });
    } else {
      candidateResult = await fetchAroundCandidates(center, currentRadius);
    }
    const configuredMaxRadiusRaw = parseFloat(process.env.MASTRA_MAX_RADIUS_KM || "");
    const maxRadius = Number.isFinite(configuredMaxRadiusRaw)
      ? Math.max(currentRadius, configuredMaxRadiusRaw)
      : Math.max(currentRadius * 2, currentRadius + 3);

    let expansionCount = 0;
    while (
      candidateResult.candidates.length < inputData.spot_count &&
      currentRadius < maxRadius &&
      expansionCount < 3
    ) {
      if (useBBoxBroadAreaFetch) break;
      const expanded = Math.min(currentRadius * 1.5, maxRadius);
      if (expanded <= currentRadius) break;
      currentRadius = expanded;
      logWorkflow("fetch-candidates:expand", { radius_km: currentRadius });
      candidateResult = await fetchAroundCandidates(center, currentRadius);
      expansionCount += 1;
    }

    if (candidateResult.candidates.length === 0) {
      const queryInfo = geocodeQuery ? `query="${geocodeQuery}"` : "center_location";
      logWorkflow("fetch-candidates:empty", { queryInfo });
      throw new Error(`No candidates found (${queryInfo}).`);
    }

    logWorkflow("fetch-candidates:done", {
      radius_km: currentRadius,
      candidates: candidateResult.candidates.length,
      center_location: center,
    });

    return {
      ...inputData,
      center_location: inputData.center_location ?? center,
      radius_km: currentRadius,
      spot_candidates: candidateResult.candidates,
      spot_candidate_mode: "pool",
    } as z.infer<typeof candidatesSchema>;
    }),
});

const selectRouteStep = createStep({
  id: "select-route",
  inputSchema: candidatesSchema,
  outputSchema: candidatesSchema,
  execute: async ({ inputData }) =>
    withQuestProgress("select_route", async () => {
    const center = inputData.center_location;
    if (!center) return inputData;
    const constraints = deriveRouteConstraints(inputData.radius_km ?? 5, inputData.spot_count);
    const routeStartHints = deriveRouteStartHints(inputData);
    logWorkflow("select-route:start", {
      candidate_count: inputData.spot_candidates.length,
      spot_count: inputData.spot_count,
      constraints,
      mode: inputData.spot_candidate_mode || "pool",
      route_start_hints: routeStartHints,
    });

    if (inputData.spot_candidate_mode === "fixed") {
      const fixedRoute = inputData.spot_candidates.slice(0, inputData.spot_count);
      const routeContinuityDetails =
        fixedRoute.length === inputData.spot_count
          ? evaluateOneWayLineRoute(fixedRoute)
          : null;
      const routeContinuityOk = routeContinuityDetails?.pass ?? false;
      const legsOk =
        fixedRoute.length === inputData.spot_count &&
        legsWithinBounds(fixedRoute, constraints.minLegKm, constraints.maxLegKm);
      const legSummary = summarizeRouteLegs(fixedRoute);
      if (
        fixedRoute.length !== inputData.spot_count ||
        !routeContinuityOk ||
        !legsOk
      ) {
        logWorkflow("select-route:fixed-invalid", {
          route_length: fixedRoute.length,
          expected_length: inputData.spot_count,
          route_continuity_ok: routeContinuityOk,
          route_continuity_details: routeContinuityDetails,
          legs_ok: legsOk,
          leg_summary: legSummary,
          constraints,
        });
        throw new Error(
          "Route planning failed: fixed route must avoid backtracking-heavy or loop-like paths."
        );
      }
      logWorkflow("select-route:fixed-pass", {
        route_length: fixedRoute.length,
        route_continuity_ok: routeContinuityOk,
        route_continuity_details: routeContinuityDetails,
        legs_ok: legsOk,
        leg_summary: legSummary,
      });
      return {
        ...inputData,
        route_diagnostics: {
          mode: "fixed",
          route_length: fixedRoute.length,
          route_continuity_ok: routeContinuityOk,
          route_continuity_details: routeContinuityDetails,
          legs_ok: legsOk,
          leg_summary: legSummary,
          constraints,
        },
      } as z.infer<typeof candidatesSchema>;
    }

    const preferredSearch = runRouteSearchWithIntentPreference({
      inputData,
      center,
      constraints,
      routeStartHints,
    });
    const routeSearch = preferredSearch.routeSearch;
    const selected = routeSearch.route;

    const isFixed = selected.length === inputData.spot_count;
    logWorkflow("select-route:search-result", {
      selected_count: selected.length,
      expected_count: inputData.spot_count,
      is_fixed: isFixed,
      route_strategy: preferredSearch.strategy,
      candidate_source_policy: "overpass_direct",
      diagnostics: routeSearch.diagnostics,
      diagnostics_json: toLogJson(routeSearch.diagnostics),
    });
    return {
      ...inputData,
      spot_candidates: isFixed ? selected : inputData.spot_candidates,
      spot_candidate_mode: (isFixed ? "fixed" : "pool") as "fixed" | "pool",
      route_diagnostics: routeSearch.diagnostics,
    } as z.infer<typeof candidatesSchema>;
    }),
});

const isDialogueExpression = (
  value: string | undefined
): value is "neutral" | "smile" | "serious" | "surprise" | "excited" =>
  value === "neutral" ||
  value === "smile" ||
  value === "serious" ||
  value === "surprise" ||
  value === "excited";

const mapDialogueLine = (
  line: { speaker_id?: string; text: string; expression?: string },
  fallbackId: string
) => {
  const mapped: {
    character_id: string;
    text: string;
    expression?: "neutral" | "smile" | "serious" | "surprise" | "excited";
  } = {
    character_id: line.speaker_id || fallbackId,
    text: line.text,
  };
  if (isDialogueExpression(line.expression)) {
    mapped.expression = line.expression;
  }
  return mapped;
};

const buildRouteMeta = (spots: SpotCandidate[], difficulty: string) => {
  const totalKm = spots.reduce((sum, spot, idx) => {
    if (idx === 0) return sum;
    const prev = spots[idx - 1];
    return sum + haversineKm({ lat: prev.lat, lng: prev.lng }, { lat: spot.lat, lng: spot.lng });
  }, 0);
  const estimatedMinutes = Math.round(totalKm * 18 + spots.length * 6);
  return {
    area_start: spots[0]?.name || "",
    area_end: spots[spots.length - 1]?.name || "",
    distance_km: totalKm.toFixed(1),
    estimated_time_min: `${Math.max(30, estimatedMinutes)}`,
    spots_count: spots.length,
    outdoor_ratio_percent: "70%",
    recommended_people: "1-3",
    difficulty_label: difficulty,
    difficulty_reason: "移動距離と謎の難度から算出",
    weather_note: "雨天時は足元に注意してください",
  };
};

const legsWithinBounds = (
  spots: Array<{ lat: number; lng: number }>,
  _minLegKm: number,
  _maxLegKm: number
) => {
  const hardMaxLegKm = 10;
  if (!Array.isArray(spots) || spots.length <= 1) return true;
  for (let i = 1; i < spots.length; i += 1) {
    const legKm = haversineKm(spots[i - 1], spots[i]);
    if (!Number.isFinite(legKm) || legKm <= 0) return false;
    if (legKm - 1e-6 > hardMaxLegKm) return false;
  }
  return true;
};

const summarizeRouteLegs = (spots: Array<{ lat: number; lng: number }>) => {
  const legs: number[] = [];
  for (let i = 1; i < spots.length; i += 1) {
    legs.push(haversineKm(spots[i - 1], spots[i]));
  }
  const totalKm = legs.reduce((sum, value) => sum + value, 0);
  const minKm = legs.length > 0 ? Math.min(...legs) : 0;
  const maxKm = legs.length > 0 ? Math.max(...legs) : 0;
  return { legCount: legs.length, minKm, maxKm, totalKm };
};

const normalizeText = (value: string) =>
  value.toLowerCase().replace(/[\s　]+/g, "").replace(/[、。,.!！?？・\-–—]/g, "");

const ensurePostProgression = (params: {
  postDialogues: Array<{ character_id: string; text: string; expression?: string }>;
  narrationBlocks: Array<{ type: "narration" | "mission"; text: string }>;
  characters: Array<{ id: string; name: string }>;
  nextSpotName?: string;
  nextObjective?: string;
  mission: string;
  isFinalSpot: boolean;
}) => {
  const {
    postDialogues,
    narrationBlocks,
    characters,
    nextSpotName,
    nextObjective,
    mission,
    isFinalSpot,
  } = params;
  const text = isFinalSpot
    ? `ここまでの手がかりで${mission}の結末へ進む。`
    : `次は${nextSpotName || "次の場所"}へ。${nextObjective || mission}のため向かう。`;

  if (postDialogues.length === 0) {
    narrationBlocks.push({ type: "narration", text });
    return;
  }

  const hasMotive = postDialogues.some((line) =>
    normalizeText(line.text).includes(normalizeText(nextSpotName || mission).slice(0, 4))
  );
  if (hasMotive) return;

  const roster = characters.length > 0 ? characters : [{ id: "char_1", name: "同行者" }];
  const char = roster[0];
  postDialogues.push({ character_id: char.id, text });
};

const generateQuestStep = createStep({
  id: "generate-quest",
  inputSchema: candidatesSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData }) => {
    const playerName = inputData.player_name || "プレイヤー";
    const difficulty = inputData.difficulty ?? "medium";
    const center = inputData.center_location;
    const constraints = deriveRouteConstraints(inputData.radius_km ?? 5, inputData.spot_count);
    const routeStartHints = deriveRouteStartHints(inputData);
    const routeState = await withQuestProgress("route_fixed_state", async () => {
      let candidates = inputData.spot_candidates;
      let candidateMode = (inputData.spot_candidate_mode || "pool") as "fixed" | "pool";
      let routeAttempts = 0;
      let latestRouteDiagnostics: unknown = inputData.route_diagnostics;
      logWorkflow("generate-quest:route-start", {
        candidate_mode: candidateMode,
        candidate_count: candidates.length,
        spot_count: inputData.spot_count,
        constraints,
        route_start_hints: routeStartHints,
        route_diagnostics: latestRouteDiagnostics ?? null,
        route_diagnostics_json: toLogJson(latestRouteDiagnostics ?? null),
      });

      if (candidateMode !== "fixed") {
        routeAttempts += 1;
        const preferredSearch = runRouteSearchWithIntentPreference({
          inputData: {
            ...inputData,
            spot_candidates: candidates,
          },
          center: center || candidates[0],
          constraints,
          routeStartHints,
        });
        const routeSearch = preferredSearch.routeSearch;
        latestRouteDiagnostics = routeSearch.diagnostics;
        const selected = routeSearch.route;
        logWorkflow("generate-quest:route-search", {
          attempt: routeAttempts,
          selected_count: selected.length,
          expected_count: inputData.spot_count,
          route_strategy: preferredSearch.strategy,
          candidate_source_policy: "overpass_direct",
          diagnostics: routeSearch.diagnostics,
          diagnostics_json: toLogJson(routeSearch.diagnostics),
        });
        if (selected.length === inputData.spot_count) {
          candidates = selected;
          candidateMode = "fixed";
        }
      }

      if (candidateMode !== "fixed") {
        const diagnosticsText = toLogJson(latestRouteDiagnostics ?? null).slice(0, 1800);
        logWorkflow("generate-quest:route-fail-unresolved", {
          route_attempts: routeAttempts,
          candidate_count: candidates.length,
          constraints,
          route_diagnostics: latestRouteDiagnostics ?? null,
          route_diagnostics_json: toLogJson(latestRouteDiagnostics ?? null),
        });
        throw new Error(
          `Route planning failed: unable to build a sequential-nearest walkable route. diagnostics=${diagnosticsText}`
        );
      }

      if (candidates.length < inputData.spot_count) {
        throw new Error(
          `Not enough spot candidates (got ${candidates.length}, expected ${inputData.spot_count})`
        );
      }

      return {
        candidateMode,
        routeAttempts,
        latestRouteDiagnostics,
        candidates,
      };
    });

    const {
      candidateMode,
      routeAttempts,
      latestRouteDiagnostics,
      candidates,
    } = routeState;

    const { orderedSpots, candidateSource, candidateSourceStats } = await withQuestProgress(
      "spot_preparation",
      async () => {
        const preparedSpots = sanitizeOrderedSpotNames(candidates.slice(0, inputData.spot_count));
        const sourceStats = summarizeCandidateSources(preparedSpots);
        const source = detectCandidateSourceLabel(sourceStats);
        logWorkflow("generate-quest:candidate-source", {
          candidate_source: source,
          candidate_source_stats: sourceStats,
        });
        return {
          orderedSpots: preparedSpots,
          candidateSource: source,
          candidateSourceStats: sourceStats,
        };
      }
    );

    await withQuestProgress("route_validation", async () => {
      const routeContinuityDetails = evaluateOneWayLineRoute(orderedSpots);
      const routePlanner = String((latestRouteDiagnostics as any)?.planner || "");
      const selectedPlanner = String((latestRouteDiagnostics as any)?.selectedPlanner || "");
      const usesSequentialMainPlanner =
        routePlanner === "sequential_nearest_v1" ||
        (routePlanner === "sequential_then_fallback_v1" &&
          selectedPlanner !== "fallback_random_heading_v1");
      const routeContinuityOk = usesSequentialMainPlanner ? true : routeContinuityDetails.pass;
      const legsOk = usesSequentialMainPlanner
        ? legsWithinBounds(orderedSpots, 0.05, Number.POSITIVE_INFINITY)
        : legsWithinBounds(orderedSpots, constraints.minLegKm, constraints.maxLegKm);
      if (!routeContinuityOk || !legsOk) {
        logWorkflow("generate-quest:route-fail-final-check", {
          route_length: orderedSpots.length,
          expected_length: inputData.spot_count,
          route_continuity_ok: routeContinuityOk,
          route_continuity_details: routeContinuityDetails,
          legs_ok: legsOk,
          leg_summary: summarizeRouteLegs(orderedSpots),
          constraints,
          route_diagnostics: latestRouteDiagnostics ?? null,
          route_diagnostics_json: toLogJson(latestRouteDiagnostics ?? null),
        });
        throw new Error(
          "Route planning failed: route must avoid backtracking-heavy or loop-like paths."
        );
      }
    });

    const tourismState = await withQuestProgress("tourism_research", async () => {
      if (!isMastraTextModelAvailable()) {
        throw new Error(
          "Tourism research requires an available text model configuration (API key or local Ollama mode)."
        );
      }
      const tourismResearch = await generateSpotTourismResearch({
        prompt: inputData.prompt,
        areaHint: toAreaHint(inputData, orderedSpots),
        spots: orderedSpots.map((spot, idx) => ({
          index: idx,
          name: spot.name,
          lat: spot.lat,
          lng: spot.lng,
          kinds: spot.kinds,
          address: spot.address,
          description: spot.description,
        })),
      });
      const tourismAnchorByIndex = new Map<number, string>();
      const tourismKeywordsByIndex = new Map<number, string[]>();
      tourismResearch.spots.forEach((entry) => {
        if (typeof entry.index !== "number") return;
        if (!orderedSpots[entry.index]) return;
        const summary = (entry.tourism_summary || "").trim();
        if (!summary) return;
        tourismAnchorByIndex.set(entry.index, summary.slice(0, 160));
        tourismKeywordsByIndex.set(
          entry.index,
          extractSpotSpecificTourismKeywords({
            spotName: orderedSpots[entry.index].name,
            tourismSummary: summary,
            tourismKeywords: Array.isArray(entry.tourism_keywords) ? entry.tourism_keywords : [],
          })
        );
      });

      const researchEntries = orderedSpots.map((spot, idx) => {
        const matched = tourismResearch.spots.find((entry) => entry.index === idx);
        const summary = (matched?.tourism_summary || "").trim();
        const keywords = tourismKeywordsByIndex.get(idx) || [];
        return {
          index: idx,
          spot_name: spot.name,
          tourism_summary: summary || null,
          tourism_summary_chars: summary.length,
          tourism_keywords: keywords,
        };
      });
      logWorkflow("generate-quest:tourism-research", {
        enabled: true,
        applied: true,
        requested_spots: orderedSpots.length,
        researched_spots: tourismResearch.spots.length,
        reason: {
          candidate_source: candidateSource,
          ai_mode: "required",
        },
        results: researchEntries,
      });

      logWorkflow(
        "generate-quest:tourism-anchors",
        orderedSpots.map((spot, idx) => {
          const anchor = tourismAnchorByIndex.get(idx) || buildTourismAnchor(spot);
          return {
            index: idx,
            spot_name: spot.name,
            tourism_anchor: anchor,
            tourism_anchor_chars: anchor.length,
          };
        })
      );

      return {
        tourismAnchorByIndex,
        tourismKeywordsByIndex,
        tourismResearchUsed: true,
        tourismResearchCount: tourismResearch.spots.length,
      };
    });

    const {
      tourismAnchorByIndex,
      tourismKeywordsByIndex,
      tourismResearchUsed,
      tourismResearchCount,
    } = tourismState;

    const plotPlan = await withQuestProgress("plot_generation", async () => {
      const generated = await generatePlotPlan({
        prompt: inputData.prompt,
        spotCount: inputData.spot_count,
        playerName,
        difficulty,
        spots: orderedSpots.map((spot, idx) => ({
          index: idx,
          name: spot.name,
          tourismAnchor: tourismAnchorByIndex.get(idx) || buildTourismAnchor(spot),
          tourismKeywords: tourismKeywordsByIndex.get(idx) || [],
        })),
      });
      logQuestProgressData("plot_generation", "生成した全体プロット", {
        title: generated.title,
        one_liner: generated.one_liner,
        mission: generated.mission,
        premise: generated.premise,
        epilogue: generated.epilogue,
        narrative_voice: generated.narrative_voice,
        characters: generated.characters.map((char) => ({
          id: char.id,
          name: char.name,
          role: char.role,
          personality: char.personality,
        })),
        chapters: generated.chapters.map((chapter) => ({
          spotIndex: chapter.spotIndex,
          spotName: chapter.spotName,
          sceneRole: chapter.sceneRole,
          objective: chapter.objective,
          purpose: chapter.purpose,
          chapterHook: chapter.chapterHook,
          tourismFocus: chapter.tourismFocus,
          keyClue: chapter.keyClue,
          tensionLevel: chapter.tensionLevel,
          objective_mission_link: chapter.objective_mission_link,
        })),
      });
      return generated;
    });

    if (process.env.MASTRA_STOP_AFTER_PLOT_GENERATION === "1") {
      throw new Error("Stopped intentionally after plot generation (MASTRA_STOP_AFTER_PLOT_GENERATION=1).");
    }

    let previousSummary = "";
    let previousClue = "";
    const chapterOutputs: Array<{
      chapter: Awaited<ReturnType<typeof generateChapter>>;
      puzzle: Awaited<ReturnType<typeof generatePuzzle>>;
      chapterPlan: typeof plotPlan.chapters[number] | undefined;
      tourismAnchor: string;
    }> = [];

    for (let idx = 0; idx < orderedSpots.length; idx += 1) {
      const spot = orderedSpots[idx];
      const chapterPlan =
        plotPlan.chapters.find((chapter) => chapter.spotIndex === idx) ||
        plotPlan.chapters[idx];
      const tourismAnchor = tourismAnchorByIndex.get(idx) || buildTourismAnchor(spot);
      const spotDetail = `${idx + 1}/${orderedSpots.length} ${spot.name}`;

      const chapter = await withQuestProgress(
        "chapter_generation",
        async () =>
          generateChapter({
            spotIndex: idx,
            spotCount: inputData.spot_count,
            spotName: spot.name,
            tourismAnchor,
            tourismFocus: chapterPlan?.tourismFocus || tourismAnchor,
            sceneRole: chapterPlan?.sceneRole || "承",
            sceneObjective: chapterPlan?.objective || "手がかりを得る",
            scenePurpose: chapterPlan?.purpose || "物語を進める",
            chapterHook: chapterPlan?.chapterHook || "次の手がかりが示される",
            keyClue: chapterPlan?.keyClue || "",
            tensionLevel: chapterPlan?.tensionLevel || 5,
            mission: plotPlan.mission,
            narrativeVoice: plotPlan.narrative_voice || "past",
            playerName,
            previousSummary,
            previousClue,
            characters: plotPlan.characters,
          }),
        spotDetail
      );

      const objectiveMissionLink = normalizeObjectiveMissionLink({
        spotName: spot.name,
        objectiveResult: chapterPlan?.objective || "手がかりを得る",
        link: chapterPlan?.objective_mission_link,
        keyClue: chapterPlan?.keyClue,
        tourismAnchor,
        tourismKeywords:
          chapterPlan?.objective_mission_link?.tourism_keywords ||
          tourismKeywordsByIndex.get(idx) ||
          [],
      });

      const puzzle = await withQuestProgress(
        "puzzle_generation",
        async () =>
          generatePuzzle({
            spotName: spot.name,
            tourismAnchor,
            sceneObjective: chapterPlan?.objective || "手がかりを得る",
            mission: plotPlan.mission,
            sceneRole: chapterPlan?.sceneRole || "承",
            keyClue: chapterPlan?.keyClue,
            objective_mission_link: objectiveMissionLink,
          }),
        spotDetail
      );

      previousSummary = chapter.summary;
      previousClue = chapter.newClue || chapterPlan?.keyClue || previousClue;
      chapterOutputs.push({ chapter, puzzle, chapterPlan, tourismAnchor });
    }

    const { quest } = await withQuestProgress("payload_build", async () => {
      const builtQuest: QuestOutput = {
        player_preview: {
          title: plotPlan.title,
          one_liner: plotPlan.one_liner,
          trailer: plotPlan.premise,
          mission: plotPlan.mission,
          teasers: plotPlan.chapters.map((chapter) => chapter.chapterHook),
          summary_actions: plotPlan.chapters.map(
            (chapter) => `${chapter.spotName}で${chapter.objective}`
          ),
          route_meta: buildRouteMeta(orderedSpots, difficulty),
          highlight_spots: plotPlan.chapters.slice(0, 3).map((chapter) => ({
            name: chapter.spotName,
            teaser_experience: chapter.chapterHook,
          })),
          tags: inputData.theme_tags || [],
          prep_and_safety: ["歩きやすい靴", "水分補給", "モバイルバッテリー"],
          cta_copy: {
            primary: "この物語を追う",
            secondary: "詳細を見る",
            note: "安全に楽しんでください",
          },
        },
        creator_payload: {
          quest_title: plotPlan.title,
          main_plot: {
            premise: plotPlan.premise,
            goal: plotPlan.mission,
            final_reveal_outline: plotPlan.epilogue,
          },
          characters: plotPlan.characters.map((char) => ({
            id: char.id,
            name: char.name,
            role: char.role,
            personality: char.personality,
            image_prompt: char.image_prompt,
          })),
          spots: chapterOutputs.map((entry, idx) => {
            const spot = orderedSpots[idx];
            const defaultCharacterId = plotPlan.characters[0]?.id || "char_1";
            const preDialogues: QuestOutput["creator_payload"]["spots"][number]["pre_mission_dialogue"] = [];
            const postDialogues: QuestOutput["creator_payload"]["spots"][number]["post_mission_dialogue"] = [];
            const narrationBlocks: Array<{ type: "narration" | "mission"; text: string }> = [];

            let missionPassed = false;
            entry.chapter.blocks.forEach((block) => {
              if (block.type === "narration") {
                narrationBlocks.push({ type: "narration", text: sanitizeNarrationText(block.text) });
                return;
              }
              if (block.type === "mission") {
                narrationBlocks.push({ type: "mission", text: sanitizeNarrationText(block.text) });
                missionPassed = true;
                return;
              }
              const dialogueLine = mapDialogueLine(
                {
                  speaker_id: block.speaker_id,
                  text: block.text,
                  expression: block.expression,
                },
                defaultCharacterId
              );
              if (missionPassed) {
                postDialogues.push(dialogueLine);
              } else {
                preDialogues.push(dialogueLine);
              }
            });

            if (narrationBlocks.length === 0) {
              narrationBlocks.push({
                type: "narration",
                text: `${spot.name}に到着する。${entry.tourismAnchor}`,
              });
            }

            if (!narrationBlocks.some((block) => block.type === "mission")) {
              const missionTarget = entry.chapterPlan?.objective || plotPlan.mission;
              const missionText = `この章では「${missionTarget}」を達成するために、次の手がかりを探す。`;
              const insertIndex = Math.min(1, narrationBlocks.length);
              narrationBlocks.splice(insertIndex, 0, { type: "mission", text: missionText });
            }

            const tourismSnippet =
              entry.tourismAnchor.split(/[。！？!?]/)[0]?.trim() || entry.tourismAnchor;
            const objectiveSnippet = entry.chapterPlan?.objective || "手がかりを得る";
            const normalize = (value: string) => value.replace(/\s+/g, "");
            const hasTourism = narrationBlocks.some((block) =>
              normalize(block.text).includes(normalize(tourismSnippet))
            );
            const hasObjective = narrationBlocks.some((block) =>
              normalize(block.text).includes(normalize(objectiveSnippet))
            );
            if (!hasTourism || !hasObjective) {
              const appendParts: string[] = [];
              if (!hasTourism && tourismSnippet) appendParts.push(tourismSnippet);
              if (!hasObjective && objectiveSnippet) appendParts.push(objectiveSnippet);
              if (appendParts.length > 0) {
                narrationBlocks[0].text = `${narrationBlocks[0].text} ${appendParts.join(" ")}。`;
              }
            }

            const nextChapter = plotPlan.chapters[idx + 1];
            ensurePostProgression({
              postDialogues,
              narrationBlocks,
              characters: plotPlan.characters.map((char) => ({ id: char.id, name: char.name })),
              nextSpotName: nextChapter?.spotName,
              nextObjective: nextChapter?.objective,
              mission: plotPlan.mission,
              isFinalSpot: idx === orderedSpots.length - 1,
            });

            let questionText = entry.puzzle.question_text;
            if (idx === orderedSpots.length - 1) {
              const missionKey = normalizeText(plotPlan.mission);
              const questionKey = normalizeText(questionText);
              if (missionKey && !questionKey.includes(missionKey.slice(0, 6))) {
                questionText = `${questionText}（${plotPlan.mission}に関わる問い）`;
              }
            }

            return {
              spot_id: spot.id || `spot-${idx + 1}`,
              spot_name: spot.name,
              place_id: spot.id,
              address: spot.address,
              lat: spot.lat,
              lng: spot.lng,
              scene_role: entry.chapterPlan?.sceneRole || "承",
              scene_objective: entry.chapterPlan?.objective || "手がかりを得る",
              scene_purpose: entry.chapterPlan?.purpose || "物語を進める",
              scene_tourism_anchor: entry.tourismAnchor,
              objective_mission_link: entry.chapterPlan?.objective_mission_link,
              scene_narration: serializeNarrationBlocks(narrationBlocks),
              question_text: questionText,
              answer_text: entry.puzzle.answer_text,
              hint_text: entry.puzzle.hint_text,
              explanation_text: entry.puzzle.explanation_text,
              pre_mission_dialogue: preDialogues,
              post_mission_dialogue: postDialogues,
            };
          }),
        },
      };

      return { quest: builtQuest };
    });

    const { ensured } = await withQuestProgress("output_normalize", async () => {
      const normalized = normalizePlayerName(quest, playerName);
      const { output } = ensureDialogueArrays(normalized);
      return { ensured: output };
    });

    const validationContext: QuestRequestContext = {
      spot_count: inputData.spot_count,
      difficulty,
      center_location: inputData.center_location,
      radius_km: inputData.radius_km,
      player_name: playerName,
    };

    const validation = await withQuestProgress("validation", async () => {
      const result = validateQuestOutput(ensured, validationContext);
      logQuestValidation(result);
      if (!result.passed) {
        throw buildValidationError(result.errors);
      }
      return result;
    });

    return {
      quest: ensured,
      meta: {
        candidates_used: orderedSpots.length,
        candidate_mode: candidateMode,
        candidate_source: candidateSource,
        candidate_source_stats: candidateSourceStats,
        tourism_research_used: tourismResearchUsed,
        tourism_research_count: tourismResearchCount,
        radius_km: inputData.radius_km,
        center_location: inputData.center_location,
        attempts: 1,
        repair_attempts: 0,
        route_attempts: routeAttempts,
        validation_errors: validation.errors.map((issue) => issue.message),
      },
    };
  },
});

export const questWorkflow = createWorkflow({
  id: "quest-workflow",
  inputSchema: requestSchema,
  outputSchema: workflowOutputSchema,
})
  .then(resolveCenterStep)
  .then(fetchCandidatesStep)
  .then(selectRouteStep)
  .then(generateQuestStep)
  .commit();

export type QuestWorkflowInput = z.infer<typeof requestSchema>;
export type QuestWorkflowOutput = z.infer<typeof workflowOutputSchema>;
