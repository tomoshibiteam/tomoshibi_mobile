#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const IKI_CENTER = { lat: 33.749, lng: 129.688 };
const IKI_BBOX = {
  minLat: 33.65,
  maxLat: 33.9,
  minLng: 129.6,
  maxLng: 129.85,
};
const TARGET_SPOT_COUNT = Math.max(
  50,
  Number.parseInt(process.env.IKI_SEED_TARGET || "500", 10) || 500
);

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const WIKIPEDIA_API = "https://ja.wikipedia.org/w/api.php";

const KEYWORDS = [
  "神社",
  "寺",
  "古墳",
  "史跡",
  "資料館",
  "博物館",
  "郵便局",
  "公園",
  "学校",
  "商店",
  "カフェ",
  "レストラン",
  "港",
  "灯台",
  "海水浴場",
  "展望台",
  "温泉",
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
  if (/(郷土館|資料館|博物館)/.test(text)) return "地域史や民俗の背景を短時間でつかみやすい。";
  if (/(神社|寺|宮)/.test(text)) return "祈りと歴史が重なる落ち着いた立ち寄り先。";
  if (/(古墳|遺跡|史跡)/.test(text)) return "古代から続く土地の記憶を感じられる。";
  if (/(記念|モニュメント|碑|像|アート)/.test(text)) return "記念性が高く、写真映えするランドマーク。";
  if (/(港|海|浜|岬|灯台)/.test(text)) return "海辺の景観と地域の暮らしを感じやすい地点。";
  if (/(公園|広場|運動|グラウンド|芝生)/.test(text)) return "散策や休憩を挟みやすい開放的な地点。";
  if (/(カフェ|レストラン|食堂|寿司|バーガー|ダイニング)/.test(text))
    return "食事や休憩を組み込める実用的な立ち寄り先。";
  return "地域の景観や暮らしの文脈を読み解く手がかりになる。";
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
  return `${base}短い観察時間でも特徴を拾いやすく、移動体験に組み込みやすい。`.slice(0, 180);
};

const buildSeedKeywords = (spot) => {
  const keywords = [...toJapaneseKinds(spot.kinds)];
  const name = String(spot.name || "");
  if (/(郷土館|資料館|博物館)/.test(name)) keywords.push("歴史資料");
  if (/図書館/.test(name)) keywords.push("地域文化");
  if (/(神社|寺|宮)/.test(name)) keywords.push("信仰");
  if (/(古墳|遺跡|史跡)/.test(name)) keywords.push("史跡");
  if (/(記念|モニュメント|碑|像|アート)/.test(name)) keywords.push("ランドマーク");
  if (/(港|海|浜|岬|灯台)/.test(name)) keywords.push("海景観");
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

const isInIkiBbox = (lat, lng) =>
  lat >= IKI_BBOX.minLat &&
  lat <= IKI_BBOX.maxLat &&
  lng >= IKI_BBOX.minLng &&
  lng <= IKI_BBOX.maxLng;

const isLikelyAreaName = (name) => {
  const trimmed = String(name || "").trim();
  if (!trimmed) return true;
  if (trimmed === "壱岐島") return true;
  if (/(市|町|村|地域|エリア|半島|諸島)$/.test(trimmed) && trimmed.length <= 5) return true;
  return false;
};

const withTimeoutFetch = async (url, init = {}, timeoutMs = 20000) => {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...init, signal });
};

const fetchOverpassElements = async (query) => {
  let data = null;
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
      if (!response.ok) continue;
      data = await response.json();
      if (Array.isArray(data?.elements)) break;
    } catch {
      continue;
    }
  }
  return Array.isArray(data?.elements) ? data.elements : [];
};

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
      if (!isInIkiBbox(lat, lng)) continue;
      const props = feature?.properties || {};
      const name = readFirst(props, nameKeys);
      if (!name || isLikelyAreaName(name)) continue;
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
  const tagKeys = [
    "amenity",
    "tourism",
    "historic",
    "shop",
    "leisure",
    "office",
    "craft",
    "healthcare",
    "building",
    "man_made",
    "public_transport",
    "railway",
    "aeroway",
    "emergency",
    "sport",
  ];
  const elementTypes = ["node", "way", "relation"];
  const bbox = `${IKI_BBOX.minLat},${IKI_BBOX.minLng},${IKI_BBOX.maxLat},${IKI_BBOX.maxLng}`;
  const blocks = [];
  for (const element of elementTypes) {
    for (const key of tagKeys) {
      blocks.push(`  ${element}(${bbox})[name][${key}];`);
    }
  }
  const query = [
    "[out:json][timeout:60];",
    "(",
    ...blocks,
    ");",
    "out center tags;",
  ].join("\n");
  const elements = await fetchOverpassElements(query);
  const out = [];
  for (const item of elements) {
    const tags = item?.tags || {};
    const name = tags["name:ja"] || tags.name || tags["name:en"];
    if (typeof name !== "string" || !name.trim()) continue;
    if (isLikelyAreaName(name)) continue;
    const lat = Number.isFinite(item?.lat) ? item.lat : item?.center?.lat;
    const lng = Number.isFinite(item?.lon) ? item.lon : item?.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!isInIkiBbox(lat, lng)) continue;
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
      name: name.trim(),
      lat,
      lng,
      kinds: kinds || undefined,
      address: tags["addr:full"] || undefined,
      source: "overpass",
    });
  }

  if (out.length < TARGET_SPOT_COUNT) {
    const genericQuery = [
      "[out:json][timeout:60];",
      "(",
      `  node(${bbox})[name];`,
      `  way(${bbox})[name];`,
      `  relation(${bbox})[name];`,
      ");",
      "out center tags;",
    ].join("\n");
    const fallbackElements = await fetchOverpassElements(genericQuery);
    for (const item of fallbackElements) {
      const tags = item?.tags || {};
      if (tags.highway || tags.place || tags.boundary || tags.route || tags.waterway) continue;
      const name = tags["name:ja"] || tags.name || tags["name:en"];
      if (typeof name !== "string" || !name.trim()) continue;
      if (isLikelyAreaName(name)) continue;
      const lat = Number.isFinite(item?.lat) ? item.lat : item?.center?.lat;
      const lng = Number.isFinite(item?.lon) ? item.lon : item?.center?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (!isInIkiBbox(lat, lng)) continue;
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
        name: name.trim(),
        lat,
        lng,
        kinds: kinds || undefined,
        address: tags["addr:full"] || undefined,
        source: "overpass_generic",
      });
    }
  }
  return out;
};

const extractWikipediaCandidates = async () => {
  const url = new URL(WIKIPEDIA_API);
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "geosearch");
  url.searchParams.set("gscoord", `${IKI_CENTER.lat}|${IKI_CENTER.lng}`);
  url.searchParams.set("gsradius", "25000");
  url.searchParams.set("gslimit", "500");
  url.searchParams.set("format", "json");

  let data;
  try {
    const response = await withTimeoutFetch(url.toString(), {}, 20000);
    if (!response.ok) return [];
    data = await response.json();
  } catch {
    return [];
  }
  const list = Array.isArray(data?.query?.geosearch) ? data.query.geosearch : [];
  const out = [];
  for (const item of list) {
    const name = String(item?.title || "").trim();
    const lat = Number(item?.lat);
    const lng = Number(item?.lon);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (isLikelyAreaName(name)) continue;
    if (!isInIkiBbox(lat, lng)) continue;
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
    url.searchParams.set("q", `壱岐 ${keyword}`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("countrycodes", "jp");
    url.searchParams.set("limit", "50");
    try {
      const response = await withTimeoutFetch(
        url.toString(),
        {
          headers: {
            "User-Agent": "tomoshibi-iki-db-builder/1.0 (local script)",
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
        if (!isInIkiBbox(lat, lng)) continue;
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
    } catch {
      continue;
    }
  }
  return out;
};

const mergeAndRank = (sources) => {
  const seen = new Set();
  const merged = [];

  for (const source of sources) {
    for (const spot of source) {
      const name = String(spot.name || "").trim();
      if (!name) continue;
      const lat = Number(spot.lat);
      const lng = Number(spot.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const key = `${normalizeName(name)}:${lat.toFixed(5)}:${lng.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        id: spot.id,
        name,
        lat,
        lng,
        kinds: spot.kinds,
        address: spot.address,
        description: spot.description,
        source: spot.source,
        distance_km: haversineKm(IKI_CENTER, { lat, lng }),
      });
    }
  }

  merged.sort((a, b) => {
    const aScore = (a.source === "overpass" ? 0 : 1) + (a.distance_km || 0) * 0.03;
    const bScore = (b.source === "overpass" ? 0 : 1) + (b.distance_km || 0) * 0.03;
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
      id: spot.id || `iki_seed:${index + 1}`,
      name: spot.name,
      lat: spot.lat,
      lng: spot.lng,
      kinds: spot.kinds,
      address: spot.address,
      description: spot.description,
      source: "iki_seed",
    })
  );

  const payload = {
    generated_at: new Date().toISOString(),
    center: IKI_CENTER,
    bbox: IKI_BBOX,
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

  const outPath = path.resolve(projectRoot, "src/data/iki_spots.seed.json");
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log("Iki seed DB written:", outPath);
  console.log(payload.counts);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
