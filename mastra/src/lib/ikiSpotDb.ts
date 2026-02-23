import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpotCandidate } from "./spotTypes";
import { haversineKm } from "./geo";
import {
  buildThemeTokens,
  scoreThemeMatch,
  withPrecomputedTourismMetadata,
} from "./seedTourismMetadata";

const IKI_PROMPT_PATTERN = /(壱岐|壱岐島|いきしま|iki)/i;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_IKI_DB_PATH = path.resolve(__dirname, "../data/iki_spots.seed.json");
const DEFAULT_IKI_CENTER = { lat: 33.749, lng: 129.688 };

type IkiSeedPayload = {
  center?: { lat: number; lng: number };
  spots?: SpotCandidate[];
};

let ikiCache: SpotCandidate[] | null = null;
let ikiCenterCache: { lat: number; lng: number } = DEFAULT_IKI_CENTER;
const USE_SEED_CACHE = process.env.MASTRA_SEED_CACHE === "1";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const resolveIkiDbPath = () => process.env.MASTRA_IKI_SPOT_DB_PATH || DEFAULT_IKI_DB_PATH;

const parseIkiPayload = (payload: IkiSeedPayload) => {
  const center =
    isFiniteNumber(payload?.center?.lat) && isFiniteNumber(payload?.center?.lng)
      ? { lat: payload.center.lat, lng: payload.center.lng }
      : DEFAULT_IKI_CENTER;
  const spots = Array.isArray(payload?.spots)
    ? payload.spots.filter(
        (spot) =>
          spot &&
          typeof spot.name === "string" &&
          spot.name.trim().length > 0 &&
          isFiniteNumber(spot.lat) &&
          isFiniteNumber(spot.lng)
      )
    : [];
  return { center, spots };
};

export const loadIkiSeedSpots = async () => {
  if (USE_SEED_CACHE && ikiCache) return { center: ikiCenterCache, spots: ikiCache };
  const file = await fs.readFile(resolveIkiDbPath(), "utf8");
  const parsed = parseIkiPayload(JSON.parse(file));
  ikiCenterCache = parsed.center;
  const summaryMinChars = parseInt(process.env.MASTRA_SEED_SUMMARY_MIN_CHARS || "90", 10);
  ikiCache = parsed.spots.map((spot) =>
    withPrecomputedTourismMetadata(
      {
        ...spot,
        source: "iki_seed",
      },
      {
        summaryMinChars,
        summaryMaxChars: Math.max(140, summaryMinChars + 80),
      }
    )
  );
  return { center: ikiCenterCache, spots: ikiCache };
};

export const looksLikeIkiPrompt = (input: {
  prompt?: string;
  prompt_support?: { where?: string };
}) => {
  const prompt = input.prompt || "";
  const where = input.prompt_support?.where || "";
  return IKI_PROMPT_PATTERN.test(prompt) || IKI_PROMPT_PATTERN.test(where);
};

export const getIkiSeedCandidates = async (params: {
  center?: { lat: number; lng: number };
  maxCandidates: number;
  radiusKm?: number;
  requiredCount?: number;
  prompt?: string;
  themeTags?: string[];
}) => {
  const db = await loadIkiSeedSpots();
  const center = params.center || db.center || DEFAULT_IKI_CENTER;
  const radiusKm =
    isFiniteNumber(params.radiusKm) && params.radiusKm > 0 ? params.radiusKm : undefined;
  const summaryMinChars = parseInt(process.env.MASTRA_SEED_SUMMARY_MIN_CHARS || "90", 10);
  const requireSummary = process.env.MASTRA_SEED_REQUIRE_SUMMARY !== "0";
  const minThemeScore = parseInt(process.env.MASTRA_SEED_THEME_MIN_SCORE || "1", 10);
  const themeTokens = buildThemeTokens({
    prompt: params.prompt,
    themeTags: params.themeTags,
  });

  const scored = db.spots
    .map((spot) => ({
      ...spot,
      distance_km: haversineKm(center, { lat: spot.lat, lng: spot.lng }),
      source: "iki_seed",
      theme_score: scoreThemeMatch(spot, themeTokens),
    }))
    .filter((spot) =>
      radiusKm ? (spot.distance_km ?? Number.POSITIVE_INFINITY) <= radiusKm + 1e-6 : true
    );

  const qualityFiltered = requireSummary
    ? scored.filter((spot) => (spot.tourism_summary || "").trim().length >= summaryMinChars)
    : scored;

  const requiredCount = Math.max(1, params.requiredCount ?? 1);
  const themeFiltered =
    themeTokens.length > 0
      ? qualityFiltered.filter((spot) => spot.theme_score >= minThemeScore)
      : qualityFiltered;
  const useThemeFiltered = themeTokens.length > 0 && themeFiltered.length >= requiredCount;

  const ranked = (useThemeFiltered ? themeFiltered : qualityFiltered).sort((a, b) => {
    const scoreDiff = (b.theme_score || 0) - (a.theme_score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return (a.distance_km ?? 0) - (b.distance_km ?? 0);
  });

  const candidates = ranked
    .slice(0, Math.max(1, params.maxCandidates))
    .map(({ theme_score, ...spot }) => spot as SpotCandidate);
  return {
    center,
    candidates,
    radius_km: radiusKm ?? null,
    total_spots: db.spots.length,
    in_radius_spots: scored.length,
    quality_filtered_spots: qualityFiltered.length,
    themed_spots: themeFiltered.length,
    theme_tokens: themeTokens,
    theme_filtered_used: useThemeFiltered,
  };
};
