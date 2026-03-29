import { z } from "zod";
import {
  seriesConceptGroundingContextSchema,
  seriesDeviceServiceDesignBriefSchema,
  seriesInterviewSchema,
} from "../schemas/series";

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();

const DEFAULT_GROUNDING_TIMEOUT_MS = 12_000;
const DEFAULT_GROUNDING_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_MATCHED_ITEMS = 4;
const WORD_PATTERN = /[A-Za-z0-9一-龥ぁ-んァ-ヶー]{2,24}/g;
const CONTEXT_MATCH_BONUS_PATTERN = /(都市伝説|伝承|逸話|噂|怪談|謎|事件|未解決|史跡|資料|記録|証言)/;
const GROUNDING_URL_ENV_KEYS = [
  "SERIES_CONCEPT_GROUNDING_SERIES_SHEET_URL",
  "SERIES_CONCEPT_GROUNDING_SPREADSHEET_URL",
  "SERIES_CONCEPT_GROUNDING_CSV_URL",
] as const;
const SCOPE_COLUMN_CANDIDATES = [
  "scope",
  "layer",
  "type",
  "kind",
  "record_type",
  "用途",
  "レイヤー",
  "種別",
  "分類",
  "カテゴリ",
];
const SPOT_SCOPE_PATTERN = /(spot|episode|scene|location|地点|スポット|エピソード|シーン)/i;
const SERIES_SCOPE_PATTERN = /(series|global|campus|world|overall|全体|シリーズ|世界観|共通)/i;

const STOP_WORDS = new Set([
  "する",
  "できる",
  "こと",
  "ため",
  "よう",
  "状態",
  "利用",
  "体験",
  "文脈",
  "主軸",
  "事件",
  "ミステリー",
  "シリーズ",
  "ユーザー",
  "ガイド",
  "デザイン",
  "ブリーフ",
  "オブジェクティブ",
  "サービス",
  "style",
  "guide",
  "with",
  "from",
  "that",
  "this",
]);

type SeriesDesignBrief = z.infer<typeof seriesDeviceServiceDesignBriefSchema>;
type SeriesInterview = z.infer<typeof seriesInterviewSchema>;
export type SeriesConceptGroundingContext = z.infer<typeof seriesConceptGroundingContextSchema>;

type SpreadsheetGroundingRow = {
  anchor: string;
  detail: string;
  tags: string[];
  sourceRef?: string;
  rawText: string;
};

type CachedDataset = {
  sourceUrl: string;
  sourceLabel?: string;
  rows: SpreadsheetGroundingRow[];
  expiresAtMs: number;
};

const datasetCache = new Map<string, CachedDataset>();
const inflightDatasetLoads = new Map<string, Promise<CachedDataset>>();

const parseIntSafe = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(clean(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const resolveGroundingUrlFromEnv = () => {
  for (const key of GROUNDING_URL_ENV_KEYS) {
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

const truncate = (value: string, max: number) => {
  const normalized = clean(value);
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1))}…`;
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
  ).slice(0, 6);

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

const extractPlaceAnchors = (brief: SeriesDesignBrief) => {
  const source = clean([brief.target_user_context, brief.usage_scene, brief.spatial_behavior_policy].join(" "));
  const patterns = [
    /([^\s、。・「」]+大学[^\s、。・「」]{0,12}キャンパス)/u,
    /([^\s、。・「」]{2,20}キャンパス)/u,
    /([^\s、。・「」]{2,20}(?:県|市|町|村|島))/u,
  ];
  const anchors: string[] = [];
  for (const pattern of patterns) {
    const matched = source.match(pattern);
    if (matched?.[1]) anchors.push(clean(matched[1]));
  }
  return dedupe(anchors);
};

const extractKeywordTokens = (params: {
  brief: SeriesDesignBrief;
  prompt?: string;
  interview?: SeriesInterview;
}) => {
  const source = clean(
    [
      params.prompt,
      params.interview?.genre_world,
      params.interview?.additional_notes,
      params.brief.experience_objective,
      params.brief.service_value_hypothesis,
      params.brief.target_user_context,
      params.brief.usage_scene,
      params.brief.emotional_outcome,
      params.brief.role_design_direction,
      params.brief.spatial_behavior_policy,
      params.brief.ux_guidance_style,
    ].join(" ")
  );
  const matches = source.match(WORD_PATTERN) || [];
  const tokens = matches
    .map((token) => clean(token))
    .filter((token) => token.length >= 2 && token.length <= 20)
    .filter((token) => !STOP_WORDS.has(token.toLowerCase()))
    .filter((token) => !/^[0-9]+$/.test(token));

  const weighted = dedupe(tokens).sort((a, b) => b.length - a.length);
  return weighted.slice(0, 24);
};

const scoreRow = (row: SpreadsheetGroundingRow, tokens: string[], anchors: string[]) => {
  let score = 0;
  const reasons: string[] = [];

  for (const anchor of anchors) {
    if (!anchor) continue;
    if (row.rawText.includes(anchor)) {
      score += 5;
      reasons.push(`場所一致:${anchor}`);
    }
  }

  for (const token of tokens) {
    if (!token || token.length < 2) continue;
    if (row.rawText.includes(token)) {
      const tokenScore = token.length >= 6 ? 3 : token.length >= 4 ? 2 : 1;
      score += tokenScore;
      reasons.push(`語一致:${token}`);
    }
  }

  if (CONTEXT_MATCH_BONUS_PATTERN.test(row.rawText)) {
    score += 2;
    reasons.push("事件題材語");
  }

  return { score, reasons: dedupe(reasons).slice(0, 6) };
};

const createRowsFromCsv = (csvText: string): SpreadsheetGroundingRow[] => {
  const csvRows = parseCsv(csvText);
  if (csvRows.length === 0) return [];

  const headers = csvRows[0].map((cell) => clean(cell));
  const bodyRows = csvRows.slice(1);
  const titleIndex = findHeaderIndex(headers, [
    "title",
    "name",
    "spot",
    "theme",
    "topic",
    "タイトル",
    "名称",
    "名前",
    "場所",
    "スポット",
    "題材",
    "見出し",
  ]);
  const detailIndex = findHeaderIndex(headers, [
    "summary",
    "description",
    "detail",
    "content",
    "body",
    "概要",
    "説明",
    "内容",
    "メモ",
    "解説",
  ]);
  const tagsIndex = findHeaderIndex(headers, ["tags", "tag", "keywords", "keyword", "キーワード", "カテゴリ", "分類"]);
  const sourceIndex = findHeaderIndex(headers, ["source", "url", "link", "reference", "参照", "出典"]);
  const scopeIndex = findHeaderIndex(headers, SCOPE_COLUMN_CANDIDATES);
  const includeSpotRows = clean(process.env.SERIES_CONCEPT_GROUNDING_INCLUDE_SPOT_ROWS) === "1";

  const rows: SpreadsheetGroundingRow[] = [];
  for (const cells of bodyRows) {
    const normalizedCells = cells.map((cell) => clean(cell));
    if (!normalizedCells.some(Boolean)) continue;

    const scopeValue = scopeIndex >= 0 ? clean(normalizedCells[scopeIndex] || "") : "";
    if (!includeSpotRows && scopeValue) {
      if (SPOT_SCOPE_PATTERN.test(scopeValue) && !SERIES_SCOPE_PATTERN.test(scopeValue)) {
        continue;
      }
    }

    const anchor = truncate(
      titleIndex >= 0 ? normalizedCells[titleIndex] || "" : normalizedCells.find((cell) => cell.length > 0) || "",
      80
    );
    const detailFromColumn = detailIndex >= 0 ? normalizedCells[detailIndex] || "" : "";
    const fallbackDetail = normalizedCells
      .filter((cell, index) => index !== titleIndex && index !== tagsIndex && index !== sourceIndex)
      .join(" / ");
    const detail = truncate(detailFromColumn || fallbackDetail || anchor, 220);
    const tags = tagsIndex >= 0 ? toTagList(normalizedCells[tagsIndex]) : [];
    const sourceRef = sourceIndex >= 0 ? truncate(normalizedCells[sourceIndex] || "", 120) : "";
    const rawText = clean(normalizedCells.join(" "));
    if (!anchor || !detail) continue;

    rows.push({
      anchor,
      detail,
      tags,
      sourceRef: sourceRef || undefined,
      rawText,
    });
  }

  return rows;
};

const fetchDataset = async (sourceUrl: string): Promise<CachedDataset> => {
  const timeoutMs = parseIntSafe(
    process.env.SERIES_CONCEPT_GROUNDING_TIMEOUT_MS,
    DEFAULT_GROUNDING_TIMEOUT_MS,
    3_000,
    60_000
  );
  const { csvUrl, sourceLabel } = resolveSpreadsheetCsvUrl(sourceUrl);
  if (!csvUrl) {
    return {
      sourceUrl,
      sourceLabel,
      rows: [],
      expiresAtMs: Date.now() + DEFAULT_GROUNDING_CACHE_TTL_MS,
    };
  }

  const response = await fetch(csvUrl, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "tomoshibi-mastra/series-concept-grounding" },
  });
  if (!response.ok) {
    throw new Error(`grounding_fetch_failed:${response.status}`);
  }
  const csvText = await response.text();
  const rows = createRowsFromCsv(csvText);
  const cacheTtlMs = parseIntSafe(
    process.env.SERIES_CONCEPT_GROUNDING_CACHE_TTL_MS,
    DEFAULT_GROUNDING_CACHE_TTL_MS,
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

export const resolveSeriesConceptGroundingContext = async (params: {
  design_brief: SeriesDesignBrief;
  prompt?: string;
  interview?: SeriesInterview;
  scope?: string;
}): Promise<SeriesConceptGroundingContext | undefined> => {
  const sourceUrl = resolveGroundingUrlFromEnv();
  if (!sourceUrl) return undefined;

  try {
    const dataset = await loadDatasetWithCache(sourceUrl);
    if (dataset.rows.length === 0) return undefined;

    const anchors = extractPlaceAnchors(params.design_brief);
    const tokens = extractKeywordTokens({
      brief: params.design_brief,
      prompt: params.prompt,
      interview: params.interview,
    });

    const scored = dataset.rows
      .map((row) => {
        const { score, reasons } = scoreRow(row, tokens, anchors);
        return { row, score, reasons };
      })
      .sort((a, b) => b.score - a.score);

    const maxItems = parseIntSafe(
      process.env.SERIES_CONCEPT_GROUNDING_MAX_ITEMS,
      DEFAULT_MAX_MATCHED_ITEMS,
      1,
      8
    );
    const positive = scored.filter((entry) => entry.score > 0).slice(0, maxItems);
    const fallbackRows = scored.slice(0, Math.min(maxItems, 2));
    const selected = positive.length > 0 ? positive : fallbackRows;
    if (selected.length === 0) return undefined;

    const context: SeriesConceptGroundingContext = {
      source_type: "spreadsheet",
      source_url: sourceUrl,
      source_label: dataset.sourceLabel,
      retrieval_note:
        positive.length > 0
          ? `${positive.length}件の関連候補を抽出`
          : "関連一致が弱いため先頭候補を参考として採用",
      matched_items: selected.map((entry) => ({
        anchor: entry.row.anchor,
        detail: entry.row.detail,
        tags: entry.row.tags,
        source_ref: entry.row.sourceRef,
        relevance_reason: entry.reasons.join(" / "),
      })),
    };

    const parsed = seriesConceptGroundingContextSchema.safeParse(context);
    if (!parsed.success) {
      console.warn(
        `[series-concept-grounding] context schema parse failed${params.scope ? ` (${params.scope})` : ""}`
      );
      return undefined;
    }
    return parsed.data;
  } catch (error: any) {
    const message = clean(error?.message || String(error || "unknown"));
    console.warn(
      `[series-concept-grounding] load skipped${params.scope ? ` (${params.scope})` : ""}: ${message || "unknown"}`
    );
    return undefined;
  }
};
