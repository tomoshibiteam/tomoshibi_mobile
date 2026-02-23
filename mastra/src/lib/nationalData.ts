import fs from "node:fs/promises";
import path from "node:path";
import { SpotCandidate } from "./spotTypes";
import { haversineKm } from "./geo";

const DATA_CACHE = new Map<string, SpotCandidate[]>();

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const normalizeName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[、。,.!！?？・\-–—]/g, "");

const extractName = (properties: Record<string, any>) => {
  const keys = [
    "name",
    "名称",
    "施設名",
    "観光地名",
    "観光資源名",
    "title",
    "名称_1",
    "名称2",
  ];
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const extractCategory = (properties: Record<string, any>) => {
  const keys = ["カテゴリ", "種別", "区分", "category", "type"];
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const extractAddress = (properties: Record<string, any>) => {
  const keys = ["address", "住所", "所在地", "所在地_1", "所在地1", "address_1", "所在地２", "所在地2"];
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const extractDescription = (properties: Record<string, any>) => {
  const keys = ["description", "説明", "概要", "紹介", "解説", "特徴", "備考", "remarks"];
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const extractPoint = (geometry: any) => {
  if (!geometry || !geometry.type || !geometry.coordinates) return null;
  if (geometry.type === "Point") {
    const [lng, lat] = geometry.coordinates;
    if (isFiniteNumber(lat) && isFiniteNumber(lng)) return { lat, lng };
  }
  if (geometry.type === "MultiPoint" && Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0) {
    const [lng, lat] = geometry.coordinates[0];
    if (isFiniteNumber(lat) && isFiniteNumber(lng)) return { lat, lng };
  }
  return null;
};

const parseGeoJson = (data: any): SpotCandidate[] => {
  const features = Array.isArray(data?.features) ? data.features : Array.isArray(data) ? data : [];
  const candidates: SpotCandidate[] = [];
  const seen = new Set<string>();

  features.forEach((feature: any, index: number) => {
    const geometry = feature?.geometry;
    const properties = feature?.properties || {};
    const point = extractPoint(geometry);
    if (!point) return;
    const name = extractName(properties);
    if (!name) return;
    const normalized = normalizeName(name);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);

    const category = extractCategory(properties);
    const address = extractAddress(properties);
    const description = extractDescription(properties);
    candidates.push({
      id: feature?.id ? String(feature.id) : `national:${index}`,
      name,
      lat: point.lat,
      lng: point.lng,
      kinds: category || undefined,
      address: address || undefined,
      description: description || undefined,
      source: "national",
    });
  });

  return candidates;
};

export const loadNationalData = async (paths: string[]): Promise<SpotCandidate[]> => {
  const allCandidates: SpotCandidate[] = [];
  for (const rawPath of paths) {
    const trimmed = rawPath.trim();
    if (!trimmed) continue;
    const resolved = path.resolve(trimmed);
    if (DATA_CACHE.has(resolved)) {
      allCandidates.push(...(DATA_CACHE.get(resolved) || []));
      continue;
    }
    try {
      const file = await fs.readFile(resolved, "utf8");
      const json = JSON.parse(file);
      const parsed = parseGeoJson(json);
      DATA_CACHE.set(resolved, parsed);
      console.log(`[NationalData] loaded ${resolved}: ${parsed.length} features`);
      allCandidates.push(...parsed);
    } catch (error) {
      console.warn(`[NationalData] Failed to read ${resolved}:`, error);
      DATA_CACHE.set(resolved, []);
    }
  }
  return allCandidates;
};

export const queryNationalCandidates = async (options: {
  center: { lat: number; lng: number };
  radiusKm: number;
  maxCandidates: number;
  dataPaths: string[];
}) => {
  if (!options.dataPaths.length) {
    return { candidates: [], totalFetched: 0 };
  }
  const data = await loadNationalData(options.dataPaths);
  const within = data
    .map((spot) => ({
      ...spot,
      distance_km: haversineKm(options.center, { lat: spot.lat, lng: spot.lng }),
    }))
    .filter((spot) => (spot.distance_km ?? 0) <= options.radiusKm)
    .sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));

  return {
    candidates: within.slice(0, options.maxCandidates),
    totalFetched: within.length,
  };
};
