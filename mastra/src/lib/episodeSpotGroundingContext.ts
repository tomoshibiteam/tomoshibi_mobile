import { z } from "zod";

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();
const WORD_PATTERN = /[A-Za-z0-9一-龥ぁ-んァ-ヶー]{2,24}/g;

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_ITEMS = 10;

const EPISODE_SPOT_URL_ENV_KEYS = [
  "EPISODE_SPOT_GROUNDING_SHEET_URL",
  "EPISODE_SPOT_GROUNDING_SPREADSHEET_URL",
  "EPISODE_SPOT_GROUNDING_CSV_URL",
] as const;

const stopWords = new Set([
  "する",
  "できる",
  "こと",
  "ため",
  "よう",
  "体験",
  "観光",
  "事件",
  "ミステリー",
  "スポット",
  "地点",
]);

export const episodeSpotGroundingRowSchema = z.object({
  name: z.string(),
  area: z.string().optional(),
  summary: z.string(),
  tags: z.array(z.string()).max(8).default([]),
  lat: z.number().optional(),
  lng: z.number().optional(),
  estimated_walk_minutes: z.number().int().min(1).max(60).optional(),
  public_accessible: z.boolean().default(true),
  source_ref: z.string().optional(),
  raw_text: z.string(),
});

export type EpisodeSpotGroundingRow = z.infer<typeof episodeSpotGroundingRowSchema>;

type CachedDataset = {
  sourceUrl: string;
  sourceLabel?: string;
  rows: EpisodeSpotGroundingRow[];
  expiresAtMs: number;
};

const datasetCache = new Map<string, CachedDataset>();
const inflightDatasetLoads = new Map<string, Promise<CachedDataset>>();

const parseIntSafe = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(clean(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const resolveEpisodeSpotUrlFromEnv = () => {
  for (const key of EPISODE_SPOT_URL_ENV_KEYS) {
    const value = clean(process.env[key]);
    if (value) return value;
  }
  return "";
};

const dedupe = (values: Array<string | undefined | null>) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = clean(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const normalizeHeader = (value: string) => clean(value).toLowerCase().replace(/[\s_\-]/g, "");

const parseCsv = (raw: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < raw.length) {
    const char = raw[i];
    if (inQuotes) {
      if (char === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  row.push(field);
  rows.push(row);
  return rows.filter((cells) => cells.some((cell) => clean(cell)));
};

const findHeaderIndex = (headers: string[], candidates: string[]) => {
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));
  const normalizedCandidates = candidates.map((candidate) => normalizeHeader(candidate));

  for (const candidate of normalizedCandidates) {
    const exactIndex = normalizedHeaders.findIndex((header) => header === candidate);
    if (exactIndex >= 0) return exactIndex;
  }
  for (const candidate of normalizedCandidates) {
    const partialIndex = normalizedHeaders.findIndex((header) => header.includes(candidate) || candidate.includes(header));
    if (partialIndex >= 0) return partialIndex;
  }
  return -1;
};

const toTagList = (value?: string) =>
  dedupe(
    clean(value)
      .split(/[\/|,、，・\n]/)
      .map((token) => clean(token))
      .filter(Boolean)
  ).slice(0, 8);

const parseFloatSafe = (value?: string) => {
  const parsed = Number.parseFloat(clean(value));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parsePublicAccessible = (value?: string) => {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return true;
  if (/^(0|false|no|x|不可|不可視|非公開|立入禁止|関係者のみ)$/.test(normalized)) return false;
  return true;
};

const resolveSpreadsheetCsvUrl = (sourceUrl: string): { csvUrl: string; sourceLabel?: string } => {
  const normalized = clean(sourceUrl);
  if (!normalized) return { csvUrl: "" };

  const googleMatch = normalized.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!googleMatch?.[1]) return { csvUrl: normalized };

  let gid = "0";
  try {
    const parsed = new URL(normalized);
    gid = clean(parsed.searchParams.get("gid")) || "0";
    if (gid === "0") {
      const hashGid = parsed.hash.match(/gid=(\d+)/)?.[1];
      if (hashGid) gid = hashGid;
    }
  } catch {
    const fallbackGid = normalized.match(/[?#&]gid=(\d+)/)?.[1];
    if (fallbackGid) gid = fallbackGid;
  }

  return {
    csvUrl: `https://docs.google.com/spreadsheets/d/${googleMatch[1]}/export?format=csv&gid=${gid}`,
    sourceLabel: "google_sheets",
  };
};

const createRowsFromCsv = (csvText: string): EpisodeSpotGroundingRow[] => {
  const csvRows = parseCsv(csvText);
  if (csvRows.length === 0) return [];

  const headers = csvRows[0].map((cell) => clean(cell));
  const bodyRows = csvRows.slice(1);

  const nameIndex = findHeaderIndex(headers, [
    "spot_name",
    "spot",
    "name",
    "title",
    "場所",
    "スポット",
    "名称",
    "名前",
  ]);
  const areaIndex = findHeaderIndex(headers, ["area", "location", "city", "district", "campus", "地域", "エリア", "所在地"]);
  const summaryIndex = findHeaderIndex(headers, ["summary", "description", "detail", "content", "概要", "説明", "内容", "豆知識"]);
  const tagsIndex = findHeaderIndex(headers, ["tags", "tag", "keywords", "キーワード", "カテゴリ", "分類"]);
  const latIndex = findHeaderIndex(headers, ["lat", "latitude", "緯度"]);
  const lngIndex = findHeaderIndex(headers, ["lng", "lon", "longitude", "経度"]);
  const walkIndex = findHeaderIndex(headers, ["walk_minutes", "estimated_walk_minutes", "移動分", "徒歩分"]);
  const accessibleIndex = findHeaderIndex(headers, ["public_accessible", "accessible", "公開", "立入"]);
  const sourceIndex = findHeaderIndex(headers, ["source", "url", "link", "reference", "参照", "出典"]);

  const rows: EpisodeSpotGroundingRow[] = [];
  for (const cells of bodyRows) {
    const normalizedCells = cells.map((cell) => clean(cell));
    if (!normalizedCells.some(Boolean)) continue;

    const name =
      (nameIndex >= 0 ? clean(normalizedCells[nameIndex]) : "") ||
      normalizedCells.find((value) => value.length > 0) ||
      "";
    if (!name) continue;

    const summaryFromColumn = summaryIndex >= 0 ? clean(normalizedCells[summaryIndex]) : "";
    const summaryFallback = normalizedCells
      .filter((cell, index) => index !== nameIndex && index !== tagsIndex && index !== sourceIndex)
      .join(" / ");
    const summary = clean(summaryFromColumn || summaryFallback || name);

    const row: EpisodeSpotGroundingRow = {
      name,
      area: areaIndex >= 0 ? clean(normalizedCells[areaIndex]) || undefined : undefined,
      summary,
      tags: tagsIndex >= 0 ? toTagList(normalizedCells[tagsIndex]) : [],
      lat: latIndex >= 0 ? parseFloatSafe(normalizedCells[latIndex]) : undefined,
      lng: lngIndex >= 0 ? parseFloatSafe(normalizedCells[lngIndex]) : undefined,
      estimated_walk_minutes:
        walkIndex >= 0
          ? parseIntSafe(normalizedCells[walkIndex], 10, 1, 60)
          : undefined,
      public_accessible:
        accessibleIndex >= 0 ? parsePublicAccessible(normalizedCells[accessibleIndex]) : true,
      source_ref: sourceIndex >= 0 ? clean(normalizedCells[sourceIndex]) || undefined : undefined,
      raw_text: clean(normalizedCells.join(" ")),
    };

    const parsed = episodeSpotGroundingRowSchema.safeParse(row);
    if (!parsed.success) continue;
    rows.push(parsed.data);
  }

  return rows;
};

const fetchDataset = async (sourceUrl: string): Promise<CachedDataset> => {
  const timeoutMs = parseIntSafe(process.env.EPISODE_SPOT_GROUNDING_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 3_000, 60_000);
  const { csvUrl, sourceLabel } = resolveSpreadsheetCsvUrl(sourceUrl);
  if (!csvUrl) {
    return {
      sourceUrl,
      sourceLabel,
      rows: [],
      expiresAtMs: Date.now() + DEFAULT_CACHE_TTL_MS,
    };
  }

  const response = await fetch(csvUrl, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "tomoshibi-mastra/episode-spot-grounding" },
  });
  if (!response.ok) {
    throw new Error(`episode_spot_sheet_fetch_failed:${response.status}`);
  }
  const csvText = await response.text();
  const rows = createRowsFromCsv(csvText);
  const cacheTtlMs = parseIntSafe(
    process.env.EPISODE_SPOT_GROUNDING_CACHE_TTL_MS,
    DEFAULT_CACHE_TTL_MS,
    30_000,
    30 * 60_000
  );

  return {
    sourceUrl,
    sourceLabel,
    rows,
    expiresAtMs: Date.now() + cacheTtlMs,
  };
};

const loadDatasetWithCache = async (sourceUrl: string): Promise<CachedDataset> => {
  const cached = datasetCache.get(sourceUrl);
  if (cached && cached.expiresAtMs > Date.now()) return cached;

  const inflight = inflightDatasetLoads.get(sourceUrl);
  if (inflight) return inflight;

  const task = fetchDataset(sourceUrl)
    .then((dataset) => {
      datasetCache.set(sourceUrl, dataset);
      inflightDatasetLoads.delete(sourceUrl);
      return dataset;
    })
    .catch((error) => {
      inflightDatasetLoads.delete(sourceUrl);
      throw error;
    });

  inflightDatasetLoads.set(sourceUrl, task);
  return task;
};

const buildKeywordTokens = (params: {
  stageLocation: string;
  purpose?: string;
  requirementHint?: string;
}) => {
  const source = clean([params.stageLocation, params.purpose, params.requirementHint].join(" "));
  const matches = source.match(WORD_PATTERN) || [];
  const tokens = matches
    .map((token) => clean(token))
    .filter((token) => token.length >= 2 && token.length <= 20)
    .filter((token) => !stopWords.has(token.toLowerCase()))
    .filter((token) => !/^[0-9]+$/.test(token));
  return dedupe(tokens).slice(0, 20);
};

const scoreSpotRow = (
  row: EpisodeSpotGroundingRow,
  stageLocation: string,
  keywordTokens: string[]
) => {
  let score = 0;
  const normalizedStage = clean(stageLocation);
  if (normalizedStage) {
    if (row.name.includes(normalizedStage)) score += 6;
    if ((row.area || "").includes(normalizedStage)) score += 5;
    if (row.raw_text.includes(normalizedStage)) score += 3;
  }

  for (const token of keywordTokens) {
    if (!token) continue;
    if (row.raw_text.includes(token) || row.name.includes(token)) {
      score += token.length >= 6 ? 3 : token.length >= 4 ? 2 : 1;
    }
  }

  if (row.public_accessible) score += 1;
  return score;
};

export const resolveEpisodeSpotSheetCandidates = async (params: {
  stageLocation: string;
  purpose?: string;
  requirementHint?: string;
  limit?: number;
  scope?: string;
}): Promise<EpisodeSpotGroundingRow[]> => {
  const sourceUrl = resolveEpisodeSpotUrlFromEnv();
  if (!sourceUrl) return [];

  try {
    const dataset = await loadDatasetWithCache(sourceUrl);
    if (dataset.rows.length === 0) return [];

    const maxItemsInput =
      params.limit ?? process.env.EPISODE_SPOT_GROUNDING_MAX_ITEMS ?? `${DEFAULT_MAX_ITEMS}`;
    const maxItems = parseIntSafe(clean(String(maxItemsInput)), DEFAULT_MAX_ITEMS, 1, 20);

    const keywordTokens = buildKeywordTokens({
      stageLocation: params.stageLocation,
      purpose: params.purpose,
      requirementHint: params.requirementHint,
    });

    const scored = dataset.rows
      .map((row) => ({
        row,
        score: scoreSpotRow(row, params.stageLocation, keywordTokens),
      }))
      .sort((a, b) => b.score - a.score);

    const positive = scored.filter((entry) => entry.score > 0).slice(0, maxItems);
    if (positive.length > 0) return positive.map((entry) => entry.row);
    return scored.slice(0, Math.min(maxItems, 4)).map((entry) => entry.row);
  } catch (error: any) {
    const message = clean(error?.message || String(error || "unknown"));
    console.warn(
      `[episode-spot-grounding] load skipped${params.scope ? ` (${params.scope})` : ""}: ${message || "unknown"}`
    );
    return [];
  }
};
