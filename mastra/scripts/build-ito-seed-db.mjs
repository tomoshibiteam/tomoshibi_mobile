#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const ITO_CENTER = { lat: 33.59588443, lng: 130.2178404 };
const ITO_BBOX = {
  minLat: 33.43,
  maxLat: 33.77,
  minLng: 130.02,
  maxLng: 130.42,
};
const ITO_RADIUS_KM = Math.max(
  0.5,
  Number.parseFloat(process.env.ITO_SEED_RADIUS_KM || "2.5") || 2.5
);
const TARGET_SPOT_COUNT = Math.max(
  50,
  Number.parseInt(process.env.ITO_SEED_TARGET || "500", 10) || 500
);
const ALLOW_GENERATED_NAMES = process.env.ITO_ALLOW_GENERATED_NAMES !== "0";
const DEDUPE_BY_NAME = process.env.ITO_SEED_DEDUPE_BY_NAME !== "0";
const DEBUG_LOG = process.env.ITO_SEED_DEBUG === "1";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const WIKIPEDIA_API = "https://ja.wikipedia.org/w/api.php";

const KEYWORDS = [
  "九州大学 伊都",
  "伊都キャンパス",
  "大学",
  "神社",
  "寺",
  "古墳",
  "史跡",
  "資料館",
  "博物館",
  "郵便局",
  "公園",
  "学校",
  "図書館",
  "商店",
  "カフェ",
  "レストラン",
  "展望台",
  "記念館",
];

const KIND_JA_MAP = {
  museum: "博物館",
  library: "図書館",
  restaurant: "飲食店",
  cafe: "カフェ",
  university: "大学施設",
  school: "学校",
  park: "公園",
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

const sanitizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
const replaceKindsJa = (value) => {
  let out = sanitizeText(value);
  Object.entries(KIND_JA_MAP).forEach(([en, ja]) => {
    out = out.replace(new RegExp(`\\b${en}\\b`, "gi"), ja);
  });
  return out;
};
const toJapaneseKinds = (kinds) =>
  Array.from(
    new Set(
      sanitizeText(kinds)
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => {
          const lower = token.toLowerCase();
          return KIND_JA_MAP[lower] || (/[a-z]/i.test(token) ? "施設" : token);
        })
    )
  ).slice(0, 4);

const inferNameContext = (name) => {
  const text = String(name || "");
  if (/(大学|研究|学部|講義|実験|図書|キャンパス|棟)/.test(text))
    return "学術拠点らしい知的な雰囲気があり、学びの文脈を組み込みやすい。";
  if (/(神社|寺|宮)/.test(text)) return "祈りと歴史が重なる落ち着いた立ち寄り先。";
  if (/(古墳|遺跡|史跡)/.test(text)) return "古代から続く土地の記憶を感じられる。";
  if (/(記念|モニュメント|碑|像|アート)/.test(text))
    return "記念性が高く、写真映えするランドマーク。";
  if (/(公園|広場|運動|グラウンド|芝生)/.test(text)) return "散策や休憩を挟みやすい開放的な地点。";
  if (/(カフェ|レストラン|食堂|寿司|バーガー|ダイニング)/.test(text))
    return "食事や休憩を組み込める実用的な立ち寄り先。";
  return "周辺の生活や景観を読み解く手がかりになる地点。";
};

const buildSeedSummary = (spot) => {
  const description = replaceKindsJa(spot.description);
  if (description) {
    if (description.length >= 95) return description.slice(0, 180);
    return `${description}${description.endsWith("。") ? "" : "。"}短い滞在でも特徴を把握しやすく、周辺ルートに組み込みやすい。`;
  }
  const kind = toJapaneseKinds(spot.kinds).join("・");
  const address = sanitizeText(spot.address);
  const context = inferNameContext(spot.name);
  const base =
    kind && address
      ? `${spot.name}は${address}周辺の${kind}で、${context}`
      : kind
        ? `${spot.name}は${kind}で、${context}`
        : address
          ? `${spot.name}は${address}周辺に位置し、${context}`
          : `${spot.name}は${context}`;
  return `${base}観察時間が短くても特徴を拾いやすく、移動体験に組み込みやすい。`.slice(0, 180);
};

const buildSeedKeywords = (spot) => {
  const keywords = [...toJapaneseKinds(spot.kinds)];
  const name = String(spot.name || "");
  if (/(大学|研究|学部|講義|実験|キャンパス|棟)/.test(name)) keywords.push("学術");
  if (/(神社|寺|宮)/.test(name)) keywords.push("信仰");
  if (/(古墳|遺跡|史跡)/.test(name)) keywords.push("史跡");
  if (/(記念|モニュメント|碑|像|アート)/.test(name)) keywords.push("ランドマーク");
  if (/(公園|広場|運動|グラウンド|芝生)/.test(name)) keywords.push("散策");
  if (/(カフェ|レストラン|食堂|寿司|バーガー|ダイニング)/.test(name)) keywords.push("グルメ");
  return Array.from(new Set(keywords.map((v) => sanitizeText(v)).filter(Boolean))).slice(0, 6);
};

const withTourismMetadata = (spot) => ({
  ...spot,
  tourism_summary: buildSeedSummary(spot),
  tourism_keywords: buildSeedKeywords(spot),
});

const normalizeName = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[、。,.!！?？・\-–—]/g, "");

const isLikelyNoiseName = (name) => {
  const trimmed = String(name || "").trim();
  if (!trimmed) return true;
  // pure number-like labels such as "40", "12-3" are not useful spot names
  if (/^[0-9０-９\s\-_.]+$/.test(trimmed)) return true;
  return false;
};

const haversineKm = (a, b) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

const isInItoBbox = (lat, lng) =>
  lat >= ITO_BBOX.minLat &&
  lat <= ITO_BBOX.maxLat &&
  lng >= ITO_BBOX.minLng &&
  lng <= ITO_BBOX.maxLng;

const isWithinItoRadius = (lat, lng) =>
  haversineKm(ITO_CENTER, { lat, lng }) <= ITO_RADIUS_KM + 1e-6;

const isLikelyAreaName = (name) => {
  const trimmed = String(name || "").trim();
  if (!trimmed) return true;
  if (trimmed === "伊都キャンパス" || trimmed === "九州大学伊都キャンパス") return false;
  if (/(市|町|村|地域|エリア|半島|諸島)$/.test(trimmed) && trimmed.length <= 5) return true;
  return false;
};

const withTimeoutFetch = async (url, init = {}, timeoutMs = 20000) => {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...init, signal });
};

const fetchOverpassElements = async (query) => {
  let data = null;
  const errors = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await withTimeoutFetch(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
        },
        70000
      );
      if (!response.ok) {
        errors.push(`${endpoint}: HTTP ${response.status}`);
        continue;
      }
      data = await response.json();
      if (Array.isArray(data?.elements)) break;
      errors.push(`${endpoint}: unexpected payload`);
    } catch (error) {
      errors.push(`${endpoint}: ${error?.message || String(error)}`);
      continue;
    }
  }
  if (DEBUG_LOG && (!Array.isArray(data?.elements) || data.elements.length === 0)) {
    console.warn("[ItoSeed][Overpass] empty result", { errors });
  }
  return Array.isArray(data?.elements) ? data.elements : [];
};

const CATEGORY_LABELS = {
  amenity: "施設",
  shop: "店舗",
  tourism: "観光",
  historic: "史跡",
  leisure: "レジャー",
  office: "事業所",
  healthcare: "医療",
  building: "建物",
  man_made: "構造物",
  public_transport: "交通",
  railway: "鉄道",
  aeroway: "航空",
  emergency: "防災",
  sport: "スポーツ",
  craft: "工房",
};

const compactTagValue = (value) => String(value || "").trim().slice(0, 24);

const deriveGeneratedName = (item, tags) => {
  const ref = compactTagValue(tags.ref || tags["addr:housenumber"]);
  const keyOrder = [
    "amenity",
    "shop",
    "tourism",
    "historic",
    "leisure",
    "office",
    "healthcare",
    "public_transport",
    "railway",
    "emergency",
    "sport",
    "man_made",
    "craft",
    "building",
  ];
  const foundKey = keyOrder.find((key) => typeof tags[key] === "string" && tags[key].trim().length > 0);
  if (!foundKey) return "";
  const label = CATEGORY_LABELS[foundKey] || "地点";
  const detail = compactTagValue(tags[foundKey]);
  const suffix = ref || `${item.type}:${item.id}`;
  return `${label}:${detail || "unknown"} ${suffix}`.trim();
};

const hasUsefulOverpassTag = (tags) =>
  Boolean(
    tags.amenity ||
      tags.shop ||
      tags.tourism ||
      tags.historic ||
      tags.leisure ||
      tags.office ||
      tags.healthcare ||
      tags.public_transport ||
      tags.railway ||
      tags.emergency ||
      tags.sport ||
      tags.man_made ||
      tags.craft ||
      tags.aeroway ||
      tags.building
  );

const extractNationalDataCandidates = async () => {
  const dataPaths = [
    path.resolve(projectRoot, "data/tourism.geojson"),
    path.resolve(projectRoot, "data/culture.geojson"),
    path.resolve(projectRoot, "data/tourism_ksj.geojson"),
    path.resolve(projectRoot, "data/attractions_ksj.geojson"),
  ];

  const nameKeys = ["name", "名称", "施設名", "観光地名", "観光資源名", "title", "名称_1", "名称2"];
  const categoryKeys = ["カテゴリ", "種別", "区分", "category", "type"];
  const addressKeys = ["address", "住所", "所在地", "所在地_1", "所在地1", "address_1", "所在地２", "所在地2"];
  const descriptionKeys = ["description", "説明", "概要", "紹介", "解説", "特徴", "備考", "remarks"];

  const readFirst = (props, keys) => {
    for (const key of keys) {
      const value = props?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };

  const out = [];
  for (const file of dataPaths) {
    let json;
    try {
      json = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      continue;
    }
    const features = Array.isArray(json?.features) ? json.features : Array.isArray(json) ? json : [];
    for (const feature of features) {
      const geometry = feature?.geometry;
      if (!geometry) continue;
      let lat;
      let lng;
      if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
        lng = geometry.coordinates[0];
        lat = geometry.coordinates[1];
      } else if (geometry.type === "MultiPoint" && Array.isArray(geometry.coordinates) && geometry.coordinates[0]) {
        lng = geometry.coordinates[0][0];
        lat = geometry.coordinates[0][1];
      } else {
        continue;
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (!isInItoBbox(lat, lng)) continue;
      if (!isWithinItoRadius(lat, lng)) continue;
      const props = feature?.properties || {};
      const name = readFirst(props, nameKeys);
      if (!name || isLikelyNoiseName(name) || isLikelyAreaName(name)) continue;
      out.push({
        id: feature?.id ? String(feature.id) : undefined,
        name,
        lat,
        lng,
        kinds: readFirst(props, categoryKeys) || undefined,
        address: readFirst(props, addressKeys) || undefined,
        description: readFirst(props, descriptionKeys) || undefined,
        source: "national",
      });
    }
  }
  return out;
};

const extractOverpassCandidates = async () => {
  const around = `around:${Math.round(ITO_RADIUS_KM * 1000)},${ITO_CENTER.lat},${ITO_CENTER.lng}`;
  const namedQuery = [
    "[out:json][timeout:120];",
    "(",
    `  node(${around})[name][~"^(amenity|tourism|historic|shop|leisure|office|craft|healthcare|building|man_made|public_transport|railway|aeroway|emergency|sport)$"~"."];`,
    `  way(${around})[name][~"^(amenity|tourism|historic|shop|leisure|office|craft|healthcare|building|man_made|public_transport|railway|aeroway|emergency|sport)$"~"."];`,
    `  relation(${around})[name][~"^(amenity|tourism|historic|shop|leisure|office|craft|healthcare|building|man_made|public_transport|railway|aeroway|emergency|sport)$"~"."];`,
    ");",
    "out center tags;",
  ].join("\n");
  const denseQuery = [
    "[out:json][timeout:120];",
    "(",
    `  node(${around})[~"^(amenity|tourism|historic|shop|leisure|office|craft|healthcare|building|man_made|public_transport|railway|aeroway|emergency|sport)$"~"."];`,
    `  way(${around})[~"^(amenity|tourism|historic|shop|leisure|office|craft|healthcare|building|man_made|public_transport|railway|aeroway|emergency|sport)$"~"."];`,
    `  relation(${around})[~"^(amenity|tourism|historic|shop|leisure|office|craft|healthcare|building|man_made|public_transport|railway|aeroway|emergency|sport)$"~"."];`,
    ");",
    "out center tags;",
  ].join("\n");

  const [namedElements, denseElements] = await Promise.all([
    fetchOverpassElements(namedQuery),
    fetchOverpassElements(denseQuery),
  ]);
  const elements = [...namedElements, ...denseElements];
  const out = [];
  for (const item of elements) {
    const tags = item?.tags || {};
    const explicitName = tags["name:ja"] || tags.name || tags["name:en"];
    const generatedName = ALLOW_GENERATED_NAMES ? deriveGeneratedName(item, tags) : "";
    const name = typeof explicitName === "string" && explicitName.trim() ? explicitName.trim() : generatedName;
    if (!name) continue;
    if (!hasUsefulOverpassTag(tags)) continue;
    if (!generatedName && isLikelyAreaName(name)) continue;
    const lat = Number.isFinite(item?.lat) ? item.lat : item?.center?.lat;
    const lng = Number.isFinite(item?.lon) ? item.lon : item?.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!isInItoBbox(lat, lng)) continue;
    if (!isWithinItoRadius(lat, lng)) continue;
    const kinds = [
      tags.amenity,
      tags.tourism,
      tags.historic,
      tags.shop,
      tags.leisure,
      tags.office,
      tags.craft,
      tags.healthcare,
      tags.building,
      tags.man_made,
      tags.public_transport,
      tags.railway,
      tags.aeroway,
      tags.emergency,
      tags.sport,
    ]
      .filter(Boolean)
      .join(",");
    out.push({
      id: `${item.type}:${item.id}`,
      name,
      lat,
      lng,
      kinds: kinds || undefined,
      address: tags["addr:full"] || undefined,
      source:
        typeof explicitName === "string" && explicitName.trim() ? "overpass" : "overpass_generated",
      name_quality:
        typeof explicitName === "string" && explicitName.trim() ? 2 : generatedName ? 1 : 0,
    });
  }
  return out;
};

const extractWikipediaCandidates = async () => {
  const url = new URL(WIKIPEDIA_API);
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "geosearch");
  url.searchParams.set("gscoord", `${ITO_CENTER.lat}|${ITO_CENTER.lng}`);
  url.searchParams.set("gsradius", "20000");
  url.searchParams.set("gslimit", "500");
  url.searchParams.set("format", "json");

  let data;
  try {
    const response = await withTimeoutFetch(url.toString(), {}, 20000);
    if (!response.ok) return [];
    data = await response.json();
  } catch (error) {
    if (DEBUG_LOG) {
      console.warn("[ItoSeed][Wikipedia] request failed", error?.message || String(error));
    }
    return [];
  }
  const list = Array.isArray(data?.query?.geosearch) ? data.query.geosearch : [];
  const out = [];
  for (const item of list) {
    const name = String(item?.title || "").trim();
    const lat = Number(item?.lat);
    const lng = Number(item?.lon);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (isLikelyNoiseName(name)) continue;
    if (isLikelyAreaName(name)) continue;
    if (!isInItoBbox(lat, lng)) continue;
    if (!isWithinItoRadius(lat, lng)) continue;
    out.push({
      id: `wikipedia:${item.pageid}`,
      name,
      lat,
      lng,
      source: "wikipedia",
      description: "Wikipedia geosearch",
    });
  }
  return out;
};

const extractNominatimCandidates = async () => {
  const out = [];
  for (const keyword of KEYWORDS) {
    const url = new URL(NOMINATIM_ENDPOINT);
    url.searchParams.set("q", `九州大学 伊都 ${keyword}`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("countrycodes", "jp");
    url.searchParams.set("limit", "50");
    try {
      const response = await withTimeoutFetch(
        url.toString(),
        {
          headers: {
            "User-Agent": "tomoshibi-ito-db-builder/1.0 (local script)",
          },
        },
        15000
      );
      if (!response.ok) continue;
      const rows = await response.json();
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const name = String(row?.display_name || row?.name || "").split(",")[0]?.trim();
        const lat = Number(row?.lat);
        const lng = Number(row?.lon);
        if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (isLikelyNoiseName(name)) continue;
        if (!isInItoBbox(lat, lng)) continue;
        if (!isWithinItoRadius(lat, lng)) continue;
        if (isLikelyAreaName(name)) continue;
        out.push({
          id: row?.osm_id ? `nominatim:${row.osm_type || "x"}:${row.osm_id}` : undefined,
          name,
          lat,
          lng,
          kinds: row?.type || undefined,
          address: typeof row?.display_name === "string" ? row.display_name : undefined,
          source: "nominatim",
        });
      }
    } catch (error) {
      if (DEBUG_LOG) {
        console.warn("[ItoSeed][Nominatim] request failed", {
          keyword,
          error: error?.message || String(error),
        });
      }
      continue;
    }
  }
  return out;
};

const mergeAndRank = (sources) => {
  const seen = new Set();
  const seenName = new Set();
  const merged = [];

  for (const source of sources) {
    for (const spot of source) {
      const name = String(spot.name || "").trim();
      if (!name) continue;
      if (isLikelyNoiseName(name)) continue;
      const lat = Number(spot.lat);
      const lng = Number(spot.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (!isWithinItoRadius(lat, lng)) continue;
      const normalized = normalizeName(name);
      const key = `${normalized}:${lat.toFixed(5)}:${lng.toFixed(5)}`;
      if (seen.has(key)) continue;
      if (DEDUPE_BY_NAME && seenName.has(normalized)) continue;
      seen.add(key);
      if (DEDUPE_BY_NAME) seenName.add(normalized);
      merged.push({
        id: spot.id,
        name,
        lat,
        lng,
        kinds: spot.kinds,
        address: spot.address,
        description: spot.description,
        source: spot.source,
        name_quality: Number.isFinite(spot.name_quality) ? spot.name_quality : undefined,
        distance_km: haversineKm(ITO_CENTER, { lat, lng }),
      });
    }
  }

  merged.sort((a, b) => {
    const sourceWeight = (source) => {
      if (source === "overpass") return 0;
      if (source === "national") return 0.25;
      if (source === "nominatim") return 0.45;
      if (source === "wikipedia") return 0.55;
      if (source === "overpass_generated") return 1.4;
      return 1;
    };
    const qualityPenalty = (quality) => {
      if (!Number.isFinite(quality)) return 0.6;
      if (quality >= 2) return 0;
      if (quality >= 1) return 0.45;
      return 1.2;
    };
    const aScore = sourceWeight(a.source) + qualityPenalty(a.name_quality) + (a.distance_km || 0) * 0.02;
    const bScore = sourceWeight(b.source) + qualityPenalty(b.name_quality) + (b.distance_km || 0) * 0.02;
    return aScore - bScore;
  });
  return merged;
};

const main = async () => {
  const [overpass, wikipedia, nominatim, national] = await Promise.all([
    extractOverpassCandidates(),
    extractWikipediaCandidates(),
    extractNominatimCandidates(),
    extractNationalDataCandidates(),
  ]);

  const merged = mergeAndRank([overpass, nominatim, wikipedia, national]);
  const spots = merged.slice(0, TARGET_SPOT_COUNT).map((spot, index) =>
    withTourismMetadata({
      id: spot.id || `ito_seed:${index + 1}`,
      name: spot.name,
      lat: spot.lat,
      lng: spot.lng,
      kinds: spot.kinds,
      address: spot.address,
      description: spot.description,
      source: "ito_seed",
    })
  );

  const payload = {
    generated_at: new Date().toISOString(),
    center: ITO_CENTER,
    radius_km: ITO_RADIUS_KM,
    bbox: ITO_BBOX,
    counts: {
      overpass: overpass.length,
      nominatim: nominatim.length,
      wikipedia: wikipedia.length,
      national: national.length,
      merged: merged.length,
      stored: spots.length,
    },
    spots,
  };

  const outPath = path.resolve(projectRoot, "src/data/ito_spots.seed.json");
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log("Ito seed DB written:", outPath);
  console.log(payload.counts);
  if (spots.length < TARGET_SPOT_COUNT) {
    console.warn(
      `[WARN] Ito seed target not reached within ${ITO_RADIUS_KM}km: ${spots.length}/${TARGET_SPOT_COUNT}`
    );
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
