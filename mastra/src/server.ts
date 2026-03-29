import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MASTRA_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(MASTRA_ROOT, "..");
for (const envPath of [
  path.resolve(REPO_ROOT, ".env"),
  path.resolve(REPO_ROOT, ".env.local"),
  path.resolve(MASTRA_ROOT, ".env"),
  path.resolve(MASTRA_ROOT, ".env.local"),
]) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
}
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { MastraServer, HonoBindings, HonoVariables } from "@mastra/hono";
import { Rembg } from "rembg-node";
import sharp from "sharp";
import { mastra } from "./index";
import { questWorkflow } from "./workflows/quest-workflow";
import { withQuestProgress } from "./lib/questProgress";
import {
  generateSeriesRuntimeEpisode,
  type SeriesRuntimeEpisodeOutput,
  seriesRuntimeEpisodeRequestSchema,
} from "./lib/agents/seriesRuntimeEpisodeAgent";
import {
  generateEpisodeRuntimeInputSchema,
  rawSeriesGenerationRequestSchema,
  type GenerateEpisodeRuntimeResult,
  type SeriesGenerationResult,
} from "./schemas/series-runtime-v2";
import {
  generateEpisodeRuntimeVNext,
  generateSeriesGenerationResultVNext,
} from "./lib/runtime/seriesRuntimeV2";
import {
  buildSeriesImageProviderUrl,
  resolveSeriesImageAspectRatio,
  resolveSeriesImageRequest,
  SeriesImageRequest,
} from "./lib/seriesVisuals";
import { installMastraAgentIoLogging } from "./lib/agentIoLogging";

const app = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();
app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization"] }));

installMastraAgentIoLogging();

const server = new MastraServer({ app, mastra });
await server.init();

app.get("/", (c) => c.text("TOMOSHIBI Mastra API"));

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();
const SERIES_VERBOSE_CONSOLE = clean(process.env.SERIES_VERBOSE_CONSOLE).toLowerCase() !== "off";
const truncate = (value: string, max = 120) => {
  const normalized = clean(value);
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1))}…`;
};
const formatList = (values: Array<string | undefined | null>, max = 3) =>
  values
    .map((value) => clean(value))
    .filter(Boolean)
    .slice(0, max)
    .join(" / ");
const formatRecentCountSummary = (raw: Record<string, unknown>) => {
  const pairs = [
    ["titles", Array.isArray(raw.recentTitles) ? raw.recentTitles.length : 0],
    ["cases", Array.isArray(raw.recentCaseMotifs) ? raw.recentCaseMotifs.length : 0],
    ["chars", Array.isArray(raw.recentCharacterArchetypes) ? raw.recentCharacterArchetypes.length : 0],
    ["relations", Array.isArray(raw.recentRelationshipPatterns) ? raw.recentRelationshipPatterns.length : 0],
    ["visuals", Array.isArray(raw.recentVisualMotifs) ? raw.recentVisualMotifs.length : 0],
    ["truths", Array.isArray(raw.recentTruthPatterns) ? raw.recentTruthPatterns.length : 0],
    ["envs", Array.isArray(raw.recentEnvironmentPatterns) ? raw.recentEnvironmentPatterns.length : 0],
  ] as const;
  return pairs.filter(([, count]) => count > 0).map(([label, count]) => `${label}=${count}`).join(", ");
};
const summarizeVNextSeriesRequest = (input: {
  interview?: string;
  prompt?: string;
  desiredEpisodeLimit?: number;
  explicitGenreHints?: string[];
  excludedDirections?: string[];
}): string =>
  [
    `episodeLimit=${Number.isFinite(input.desiredEpisodeLimit) ? input.desiredEpisodeLimit : "default"}`,
    truncate(`interview=${input.interview || "none"}`, 140),
    input.prompt ? truncate(`prompt=${input.prompt}`, 140) : "",
    input.explicitGenreHints?.length ? `hints=${formatList(input.explicitGenreHints)}` : "",
    input.excludedDirections?.length ? `avoid=${formatList(input.excludedDirections)}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
const logSeriesProgressEvent = (
  logPrefix: string,
  params: {
    jobId?: string;
    startedMs: number;
    event: { phase: string; detail?: string; at?: string };
  }
) => {
  if (!SERIES_VERBOSE_CONSOLE) return;
  const elapsedSec = ((Date.now() - params.startedMs) / 1000).toFixed(1);
  const idPart = params.jobId ? ` id=${params.jobId}` : "";
  const detailPart = clean(params.event.detail) ? ` detail=${truncate(params.event.detail || "", 180)}` : "";
  console.log(
    `${logPrefix} progress${idPart} +${elapsedSec}s phase=${clean(params.event.phase) || "unknown"}${detailPart}`
  );
};
const logSeriesResultSummary = (
  logPrefix: string,
  params: {
    jobId?: string;
    startedMs: number;
    title?: string;
    characterCount?: number;
    continuityAxisCount?: number;
    workflowVersion?: string;
  }
) => {
  const elapsedSec = ((Date.now() - params.startedMs) / 1000).toFixed(1);
  const idPart = params.jobId ? ` id=${params.jobId}` : "";
  console.log(
    `${logPrefix} result${idPart} +${elapsedSec}s title=${truncate(params.title || "unknown", 80)} characters=${
      params.characterCount ?? 0
    } continuityAxes=${params.continuityAxisCount ?? 0} workflow=${clean(params.workflowVersion) || "unknown"}`
  );
};
const GEMINI_IMAGE_MODEL =
  clean(process.env.SERIES_IMAGE_GEMINI_MODEL) || "gemini-3.1-flash-image-preview";
const GEMINI_API_KEY =
  clean(process.env.GOOGLE_GENERATIVE_AI_API_KEY) || clean(process.env.GEMINI_API_KEY);
const BILLING_LOG_ENABLED = clean(process.env.MASTRA_BILLING_LOG).toLowerCase() !== "off";
const BILLING_USDJPY_RATE = Math.max(
  1,
  Number.parseFloat(clean(process.env.MASTRA_BILLING_USDJPY) || "158.95") || 158.95
);
const SERIES_IMAGE_CUTOUT_ENABLED = clean(process.env.SERIES_IMAGE_CUTOUT_ENABLED).toLowerCase() !== "off";
const SERIES_IMAGE_VERTEX_ENDPOINT = clean(process.env.SERIES_IMAGE_VERTEX_ENDPOINT);
const SERIES_IMAGE_DIFFUSERS_ENDPOINT = clean(process.env.SERIES_IMAGE_DIFFUSERS_ENDPOINT);
const SERIES_IMAGE_VERTEX_TOKEN = clean(process.env.SERIES_IMAGE_VERTEX_TOKEN);
const SERIES_IMAGE_DIFFUSERS_TOKEN = clean(process.env.SERIES_IMAGE_DIFFUSERS_TOKEN);
const SERIES_IMAGE_HYBRID_ORDER = clean(process.env.SERIES_IMAGE_HYBRID_ORDER) || "vertex,diffusers,gemini,pollinations";
const IMAGE_CACHE_TTL_SECONDS = Math.max(
  60,
  Number.parseInt(clean(process.env.SERIES_IMAGE_CACHE_TTL_SEC) || "21600", 10) || 21600
);
const IMAGE_CACHE_LIMIT = Math.max(
  16,
  Number.parseInt(clean(process.env.SERIES_IMAGE_CACHE_LIMIT) || "96", 10) || 96
);
const IMAGE_FETCH_TIMEOUT_MS = Math.max(
  5_000,
  Number.parseInt(clean(process.env.SERIES_IMAGE_FETCH_TIMEOUT_MS) || "45000", 10) || 45_000
);
const IMAGE_PROVIDER_TIMEOUT_MS = Math.max(
  8_000,
  Number.parseInt(clean(process.env.SERIES_IMAGE_PROVIDER_TIMEOUT_MS) || "90000", 10) || 90_000
);
const GEMINI_IMAGE_TIMEOUT_MS = Math.max(
  8_000,
  Number.parseInt(clean(process.env.SERIES_IMAGE_GEMINI_TIMEOUT_MS) || "90000", 10) || 90_000
);
const SERIES_IMAGE_CUTOUT_MODEL_TIMEOUT_MS = Math.max(
  10_000,
  Number.parseInt(clean(process.env.SERIES_IMAGE_CUTOUT_MODEL_TIMEOUT_MS) || "240000", 10) || 240_000
);
const DEFAULT_SERIES_IMAGE_CUTOUT_MODEL_URLS = [
  "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx",
];
const isAbortLikeError = (error: unknown) => {
  const message = clean(error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return true;
  return /abort|aborted|timeout|timed out/.test(message);
};

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const asNumber = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const extractGeminiTokenUsage = (payload: unknown): TokenUsage | null => {
  const usage = asObject(asObject(payload).usageMetadata);
  if (!usage || Object.keys(usage).length === 0) return null;
  const inputTokens = Math.max(0, asNumber(usage.promptTokenCount));
  const outputTokens = Math.max(0, asNumber(usage.candidatesTokenCount));
  const totalTokens = Math.max(0, asNumber(usage.totalTokenCount) || inputTokens + outputTokens);
  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) return null;
  return { inputTokens, outputTokens, totalTokens };
};

const estimateFlashImageUnitUsd = (width: number, height: number) => {
  const maxEdge = Math.max(width, height);
  if (maxEdge <= 512) return 0.045;
  if (maxEdge <= 1024) return 0.067;
  if (maxEdge <= 2048) return 0.101;
  return 0.151;
};

const estimateGeminiImageUsd = (usage: TokenUsage | null, model: string, request: SeriesImageRequest) => {
  const normalized = clean(model).toLowerCase();
  if (!normalized.includes("flash-image")) return null;

  if (usage) {
    const inputCost = (usage.inputTokens / 1_000_000) * 0.5;
    const outputCost = (usage.outputTokens / 1_000_000) * 60;
    return {
      usd: inputCost + outputCost,
      mode: "token-based" as const,
    };
  }

  return {
    usd: estimateFlashImageUnitUsd(request.width, request.height),
    mode: "dimension-fallback" as const,
  };
};

type CachedImage = {
  contentType: string;
  data: ArrayBuffer;
  expiresAt: number;
};

const seriesImageCache = new Map<string, CachedImage>();
let portraitCutoutRembg: Rembg | null = null;
let portraitCutoutModelReady: Promise<void> | null = null;

const pathExists = async (targetPath: string) => {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
};

const resolvePortraitCutoutModelDir = () =>
  clean(process.env.SERIES_IMAGE_CUTOUT_MODEL_DIR || process.env.U2NET_HOME) ||
  path.resolve(os.homedir(), ".u2net");

const resolvePortraitCutoutModelPath = () =>
  path.resolve(resolvePortraitCutoutModelDir(), "u2net.onnx");

const resolvePortraitCutoutModelUrls = () => {
  const raw = clean(process.env.SERIES_IMAGE_CUTOUT_MODEL_URLS || process.env.SERIES_IMAGE_CUTOUT_MODEL_URL);
  const seen = new Set<string>();
  return (raw ? raw.split(",").map((part) => clean(part)).filter(Boolean) : [])
    .concat(DEFAULT_SERIES_IMAGE_CUTOUT_MODEL_URLS)
    .filter((entry) => {
      if (!entry) return false;
      if (seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
};

const downloadPortraitCutoutModel = async (url: string, modelPath: string) => {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "tomoshibi-mastra/portrait-cutout-model",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(SERIES_IMAGE_CUTOUT_MODEL_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new Error(`cutout_model_download_timeout:${Math.floor(SERIES_IMAGE_CUTOUT_MODEL_TIMEOUT_MS / 1000)}s`);
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(`cutout_model_download_error:${response.status}`);
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 1_000_000) {
    throw new Error("cutout_model_payload_too_small");
  }

  const tmpPath = `${modelPath}.tmp-${randomUUID()}`;
  await writeFile(tmpPath, Buffer.from(bytes));
  await rename(tmpPath, modelPath);
};

const ensurePortraitCutoutModel = async () => {
  const modelPath = resolvePortraitCutoutModelPath();
  if (await pathExists(modelPath)) return;

  if (!portraitCutoutModelReady) {
    portraitCutoutModelReady = (async () => {
      const modelDir = resolvePortraitCutoutModelDir();
      await mkdir(modelDir, { recursive: true });

      const errors: string[] = [];
      for (const url of resolvePortraitCutoutModelUrls()) {
        try {
          await downloadPortraitCutoutModel(url, modelPath);
          if (await pathExists(modelPath)) return;
        } catch (error: any) {
          errors.push(`${url}:${clean(error?.message || String(error))}`.slice(0, 260));
        }
      }
      throw new Error(`cutout_model_unavailable:${errors.join("|") || "download_failed"}`);
    })();
  }

  try {
    await portraitCutoutModelReady;
  } catch (error) {
    portraitCutoutModelReady = null;
    throw error;
  }
};

const buildSeriesImageCacheKey = (
  provider: string,
  request: SeriesImageRequest,
  options?: { cutout?: boolean }
) =>
  createHash("sha256")
    .update(
      [
        provider,
        options?.cutout ? "cutout" : "raw",
        String(request.seed),
        String(request.width),
        String(request.height),
        String(request.purpose),
        clean(request.styleReference),
        JSON.stringify(request.references || []),
        clean(request.prompt),
      ].join("|")
    )
    .digest("hex");

const getSeriesImageCache = (cacheKey: string): CachedImage | null => {
  const current = seriesImageCache.get(cacheKey);
  if (!current) return null;
  if (current.expiresAt <= Date.now()) {
    seriesImageCache.delete(cacheKey);
    return null;
  }
  return current;
};

const pruneSeriesImageCache = () => {
  const now = Date.now();
  for (const [key, value] of seriesImageCache.entries()) {
    if (value.expiresAt <= now) {
      seriesImageCache.delete(key);
    }
  }

  if (seriesImageCache.size <= IMAGE_CACHE_LIMIT) return;

  const entries = Array.from(seriesImageCache.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const overflow = seriesImageCache.size - IMAGE_CACHE_LIMIT;
  for (let index = 0; index < overflow; index += 1) {
    seriesImageCache.delete(entries[index][0]);
  }
};

const setSeriesImageCache = (cacheKey: string, payload: { contentType: string; data: ArrayBuffer }) => {
  pruneSeriesImageCache();
  seriesImageCache.set(cacheKey, {
    contentType: payload.contentType,
    data: payload.data,
    expiresAt: Date.now() + IMAGE_CACHE_TTL_SECONDS * 1000,
  });
};

const getPortraitCutoutRembg = async () => {
  if (!portraitCutoutRembg) {
    await ensurePortraitCutoutModel();
    portraitCutoutRembg = new Rembg({ logging: false });
  }
  return portraitCutoutRembg;
};

const applyPortraitCutout = async (payload: { contentType: string; data: ArrayBuffer }) => {
  const rembg = await getPortraitCutoutRembg();
  const sharpInput = sharp(Buffer.from(payload.data), { failOnError: false }).rotate();
  const transparentForeground = await rembg.remove(sharpInput);
  const png = await transparentForeground
    .trim()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  if (!png || png.byteLength === 0) {
    throw new Error("portrait_cutout_empty");
  }

  return {
    contentType: "image/png",
    data: toArrayBuffer(new Uint8Array(png)),
  };
};

type GeminiExtractedImage = {
  data: string;
  mimeType: string;
};

const toArrayBuffer = (value: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
};

const normalizeGeminiImageMime = (value?: string | null) => {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return "image/png";
  if (normalized === "image/jpg") return "image/jpeg";
  return normalized.startsWith("image/") ? normalized : "image/png";
};

const extractGeminiImages = (payload: any): GeminiExtractedImage[] => {
  const images: GeminiExtractedImage[] = [];
  const append = (data?: string | null, mimeType?: string | null) => {
    const normalizedData = clean(data);
    if (!normalizedData) return;
    images.push({
      data: normalizedData,
      mimeType: normalizeGeminiImageMime(mimeType),
    });
  };

  const candidates = Array.isArray(payload?.candidates)
    ? payload.candidates
    : payload
      ? [payload]
      : [];
  for (const candidate of candidates) {
    const generatedImages = Array.isArray(candidate?.images)
      ? candidate.images
      : Array.isArray(candidate?.generatedImages)
        ? candidate.generatedImages
        : [];
    for (const image of generatedImages) {
      append(
        image?.imageBytes || image?.base64 || image?.data,
        image?.mimeType || image?.mime_type
      );
    }

    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const inlineData = part?.inlineData || part?.inline_data;
      append(
        inlineData?.data || part?.data,
        inlineData?.mimeType || inlineData?.mime_type || part?.mimeType || part?.mime_type
      );
    }

    append(
      candidate?.inlineData?.data || candidate?.inline_data?.data,
      candidate?.inlineData?.mimeType ||
      candidate?.inlineData?.mime_type ||
      candidate?.inline_data?.mimeType ||
      candidate?.inline_data?.mime_type
    );
  }

  return images;
};

const buildGeminiImagePrompt = (request: SeriesImageRequest) => {
  const aspectRatio = resolveSeriesImageAspectRatio(request.width, request.height);
  const isWorldCover = request.purpose === "cover";
  const isCharacterPortrait = request.purpose === "character_portrait";
  const referenceMap = request.references
    .map((ref, index) => {
      const id = clean(ref.characterId) || `ref_${index + 1}`;
      const note = clean(ref.note) || "subject";
      return `${id}: ${note}`;
    })
    .join(" | ");
  return [
    "Generate a single illustration for a mobile story app.",
    `Aspect ratio: ${aspectRatio}.`,
    `Purpose: ${request.purpose}.`,
    "Art style: soft anime illustration, cel-shaded coloring, warm cinematic lighting, studio quality digital painting.",
    "IMPORTANT: Maintain a consistent anime illustration style. Do NOT mix photorealistic and anime styles.",
    "No text, no letters, no logos, no watermark.",
    "Keep composition cinematic and clear.",
    isWorldCover
      ? "HARD CONSTRAINT: This cover is a world concept poster."
      : "",
    isWorldCover
      ? "HARD CONSTRAINT: Do NOT depict people, characters, faces, bodies, or human silhouettes."
      : "",
    isWorldCover
      ? "HARD CONSTRAINT: Express the series only through environment, architecture, objects, weather, and atmosphere."
      : "",
    isCharacterPortrait
      ? "HARD CONSTRAINT: Render exactly one unique character and keep this identity distinct from other cast members."
      : "",
    request.references.length > 0
      ? `Reference subjects map: ${referenceMap}.`
      : "",
    `Style seed hint: ${request.seed}.`,
    `Scene prompt: ${request.prompt}`,
  ].join("\n");
};

type GeminiInlineData = {
  mimeType: string;
  data: string;
};

const guessImageMimeTypeFromUrl = (url: string) => {
  const normalized = clean(url).toLowerCase();
  if (normalized.includes(".jpg") || normalized.includes(".jpeg")) return "image/jpeg";
  if (normalized.includes(".webp")) return "image/webp";
  return "image/png";
};

const fetchImageAsInlineData = async (url: string): Promise<GeminiInlineData | null> => {
  const normalized = clean(url);
  if (!normalized) return null;

  try {
    const response = await fetch(normalized, {
      headers: {
        "User-Agent": "tomoshibi-mastra/series-image-proxy",
      },
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) return null;

    const contentType =
      normalizeGeminiImageMime(response.headers.get("content-type")) || guessImageMimeTypeFromUrl(normalized);
    const base64 = Buffer.from(bytes).toString("base64");
    if (!base64) return null;
    return {
      mimeType: contentType,
      data: base64,
    };
  } catch {
    return null;
  }
};

const generateSeriesImageWithGemini = async (
  request: SeriesImageRequest
): Promise<{ contentType: string; data: ArrayBuffer }> => {
  if (!GEMINI_API_KEY) {
    throw new Error("gemini_api_key_missing");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_IMAGE_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const inlineReferences = await Promise.all(
    dedupeImageReferences([
      ...request.references.map((row) => row.url),
      request.styleReference || "",
    ])
      .slice(0, 4)
      .map((url) => fetchImageAsInlineData(url))
  );

  const parts: Array<Record<string, unknown>> = [{ text: buildGeminiImagePrompt(request) }];
  for (const inline of inlineReferences) {
    if (!inline?.data) continue;
    parts.push({
      inlineData: {
        mimeType: inline.mimeType || "image/png",
        data: inline.data,
      },
    });
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts,
          },
        ],
        generationConfig: {
          temperature: 0.8,
          responseModalities: ["TEXT", "IMAGE"],
        },
      }),
      signal: AbortSignal.timeout(GEMINI_IMAGE_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new Error(`gemini_api_timeout:${Math.floor(GEMINI_IMAGE_TIMEOUT_MS / 1000)}s`);
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = clean(await response.text()).slice(0, 500);
    throw new Error(`gemini_api_error:${response.status}:${errorText || "unknown"}`);
  }

  const payload = await response.json();
  const usage = extractGeminiTokenUsage(payload);
  if (BILLING_LOG_ENABLED) {
    const estimated = estimateGeminiImageUsd(usage, GEMINI_IMAGE_MODEL, request);
    const usagePart = usage
      ? `input_tokens=${usage.inputTokens} output_tokens=${usage.outputTokens} total_tokens=${usage.totalTokens}`
      : "usage=unavailable";
    if (estimated) {
      const estimatedJpy = estimated.usd * BILLING_USDJPY_RATE;
      console.log(
        `[image-billing] provider=gemini model=${GEMINI_IMAGE_MODEL} purpose=${request.purpose} size=${request.width}x${request.height} ${usagePart} estimated_usd=${estimated.usd.toFixed(6)} estimated_jpy=${estimatedJpy.toFixed(3)} usd_jpy=${BILLING_USDJPY_RATE.toFixed(4)} mode=${estimated.mode}`
      );
    } else {
      console.log(
        `[image-billing] provider=gemini model=${GEMINI_IMAGE_MODEL} purpose=${request.purpose} size=${request.width}x${request.height} ${usagePart} estimated_usd=unavailable`
      );
    }
  }
  const extracted = extractGeminiImages(payload);
  if (extracted.length === 0) {
    throw new Error("gemini_image_missing");
  }

  const first = extracted[0];
  const data = new Uint8Array(Buffer.from(first.data, "base64"));
  if (data.length === 0) {
    throw new Error("gemini_image_decode_failed");
  }

  return {
    contentType: first.mimeType,
    data: toArrayBuffer(data),
  };
};

const dedupeImageReferences = (values: Array<string | undefined | null>) => {
  const seen = new Set<string>();
  return values
    .map((value) => clean(value))
    .filter((value) => {
      if (!value) return false;
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
};

type HybridImageProvider = "vertex" | "diffusers" | "gemini" | "pollinations";

type HybridImageResult = {
  provider: HybridImageProvider;
  contentType: string;
  data: ArrayBuffer;
};

const isIdentityLockedRequest = (request?: SeriesImageRequest) =>
  Boolean(
    request &&
    (request.purpose === "cover" ||
      request.purpose === "character_portrait" ||
      request.references.length > 0 ||
      Boolean(request.styleReference))
  );

const normalizeHybridProviderOrder = (request?: SeriesImageRequest): HybridImageProvider[] => {
  const identityLocked = isIdentityLockedRequest(request);
  const allowed = new Set<HybridImageProvider>(["vertex", "diffusers", "gemini", "pollinations"]);
  let parsed = SERIES_IMAGE_HYBRID_ORDER
    .split(",")
    .map((part) => clean(part).toLowerCase())
    .filter((part): part is HybridImageProvider => allowed.has(part as HybridImageProvider));
  if (identityLocked) {
    parsed = parsed.filter((provider) => provider !== "pollinations");
  }
  if (parsed.length > 0) return parsed;
  if (identityLocked) {
    return ["vertex", "diffusers", "gemini"];
  }
  return ["vertex", "diffusers", "gemini", "pollinations"];
};

const extractImageFromCustomProviderPayload = async (payload: any): Promise<{ contentType: string; data: ArrayBuffer } | null> => {
  const base64 =
    clean(payload?.image_base64) ||
    clean(payload?.imageBase64) ||
    clean(payload?.base64) ||
    clean(payload?.data);
  if (base64) {
    const bytes = new Uint8Array(Buffer.from(base64, "base64"));
    if (bytes.byteLength === 0) return null;
    const contentType = normalizeGeminiImageMime(payload?.mime_type || payload?.mimeType || payload?.content_type);
    return {
      contentType,
      data: toArrayBuffer(bytes),
    };
  }

  const imageUrl = clean(payload?.image_url) || clean(payload?.imageUrl) || clean(payload?.url);
  if (!imageUrl) return null;
  const response = await fetch(imageUrl, {
    headers: {
      "User-Agent": "tomoshibi-mastra/series-image-proxy",
    },
    signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) return null;
  return {
    contentType: normalizeGeminiImageMime(response.headers.get("content-type")),
    data: bytes,
  };
};

const generateSeriesImageWithCustomEndpoint = async (
  endpoint: string,
  token: string,
  provider: HybridImageProvider,
  request: SeriesImageRequest
): Promise<HybridImageResult> => {
  const normalizedEndpoint = clean(endpoint);
  if (!normalizedEndpoint) {
    throw new Error(`${provider}_endpoint_unconfigured`);
  }

  let response: Response;
  try {
    response = await fetch(normalizedEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        prompt: request.prompt,
        seed: request.seed,
        size: {
          width: request.width,
          height: request.height,
        },
        purpose: request.purpose,
        references: request.references,
        style_reference: request.styleReference || undefined,
      }),
      signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new Error(`${provider}_api_timeout:${Math.floor(IMAGE_PROVIDER_TIMEOUT_MS / 1000)}s`);
    }
    throw error;
  }

  if (!response.ok) {
    const errText = clean(await response.text()).slice(0, 500);
    throw new Error(`${provider}_api_error:${response.status}:${errText || "unknown"}`);
  }

  const payload = await response.json();
  const extracted = await extractImageFromCustomProviderPayload(payload);
  if (!extracted) {
    throw new Error(`${provider}_image_missing`);
  }
  return {
    provider,
    contentType: extracted.contentType,
    data: extracted.data,
  };
};

const generateSeriesImageWithPollinations = async (
  request: SeriesImageRequest
): Promise<HybridImageResult> => {
  const pollinationsRequest: SeriesImageRequest = {
    ...request,
    // Pollinations は style_ref / refs を付けると失敗率が上がるため最小化する。
    styleReference: undefined,
    references: [],
  };
  const upstreamUrl = buildSeriesImageProviderUrl(pollinationsRequest);
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: {
        "User-Agent": "tomoshibi-mastra/series-image-proxy",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new Error(`pollinations_api_timeout:${Math.floor(IMAGE_PROVIDER_TIMEOUT_MS / 1000)}s`);
    }
    throw error;
  }
  if (!upstream.ok) {
    throw new Error(`pollinations_api_error:${upstream.status}`);
  }
  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error("pollinations_image_missing");
  }
  return {
    provider: "pollinations",
    contentType: normalizeGeminiImageMime(upstream.headers.get("content-type") || "image/jpeg"),
    data: bytes,
  };
};

const generateSeriesImageHybrid = async (
  request: SeriesImageRequest
): Promise<HybridImageResult> => {
  const order = normalizeHybridProviderOrder(request);
  const provider = order[0];
  if (!provider) {
    throw new Error("series_image_provider_missing");
  }
  if (provider === "vertex") {
    return generateSeriesImageWithCustomEndpoint(
      SERIES_IMAGE_VERTEX_ENDPOINT,
      SERIES_IMAGE_VERTEX_TOKEN,
      "vertex",
      request
    );
  }
  if (provider === "diffusers") {
    return generateSeriesImageWithCustomEndpoint(
      SERIES_IMAGE_DIFFUSERS_ENDPOINT,
      SERIES_IMAGE_DIFFUSERS_TOKEN,
      "diffusers",
      request
    );
  }
  if (provider === "gemini") {
    const generated = await generateSeriesImageWithGemini(request);
    return {
      provider: "gemini",
      contentType: generated.contentType,
      data: generated.data,
    };
  }
  if (provider === "pollinations") {
    return generateSeriesImageWithPollinations(request);
  }
  throw new Error(`hybrid_image_generation_failed:${provider}`);
};

const unwrapMastraOutput = (value: any): any => {
  if (!value) return value;
  if (value.outputData) return unwrapMastraOutput(value.outputData);
  if (value.output) return unwrapMastraOutput(value.output);
  if (value.data) return unwrapMastraOutput(value.data);
  if (value.result) return unwrapMastraOutput(value.result);
  return value;
};

const extractFailure = (value: any) => {
  if (!value || typeof value !== "object") return null;
  if (value?.error) return value.error?.message || value.error;
  const steps = value?.steps;
  if (steps && typeof steps === "object") {
    for (const [stepId, step] of Object.entries(steps)) {
      const status = (step as any)?.status;
      if (status === "failed") {
        const err = (step as any)?.error || (step as any)?.payload?.error;
        return err?.message || err || `step ${stepId} failed`;
      }
    }
  }
  return null;
};

type EpisodeJobProgressPhase = string;

type EpisodeJobProgressEvent = {
  phase: EpisodeJobProgressPhase;
  at: string;
  detail?: string;
  spot_index?: number;
  spot_count?: number;
  spot_name?: string;
};

type EpisodeGenerationMeta = {
  workflow_version: string;
  spots_count?: number;
  elapsed_ms: number;
};

type EpisodeGenerationJob = {
  id: string;
  status: "running" | "succeeded" | "failed";
  created_ms: number;
  updated_ms: number;
  events: EpisodeJobProgressEvent[];
  episode?: SeriesRuntimeEpisodeOutput;
  result?: GenerateEpisodeRuntimeResult;
  meta?: EpisodeGenerationMeta;
  mode?: "legacy" | "vnext";
  error?: string;
};

const EPISODE_JOB_TTL_MS = 30 * 60 * 1000;
const EPISODE_JOB_MAX_EVENTS = 240;
const episodeGenerationJobs = new Map<string, EpisodeGenerationJob>();

const pruneEpisodeGenerationJobs = () => {
  const cutoff = Date.now() - EPISODE_JOB_TTL_MS;
  for (const [id, job] of episodeGenerationJobs.entries()) {
    if (job.updated_ms < cutoff) {
      episodeGenerationJobs.delete(id);
    }
  }
};

const appendEpisodeJobEvent = (
  job: EpisodeGenerationJob,
  event: Omit<EpisodeJobProgressEvent, "at"> & { at?: string }
) => {
  const normalizedAt = clean(event.at) || new Date().toISOString();
  job.events.push({
    phase: event.phase,
    at: normalizedAt,
    detail: clean(event.detail) || undefined,
    spot_index: event.spot_index,
    spot_count: event.spot_count,
    spot_name: clean(event.spot_name) || undefined,
  });
  if (job.events.length > EPISODE_JOB_MAX_EVENTS) {
    job.events = job.events.slice(job.events.length - EPISODE_JOB_MAX_EVENTS);
  }
  job.updated_ms = Date.now();
};

const serializeEpisodeJob = (job: EpisodeGenerationJob, cursorRaw?: string | null) => {
  const parsedCursor = Number.parseInt(String(cursorRaw ?? "0"), 10);
  const cursor = Number.isFinite(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;
  const events = job.events.slice(cursor);
  const publicStatus =
    job.status === "succeeded" ? "completed" : job.status === "running" ? "running" : "failed";

  return {
    jobId: job.id,
    job_id: job.id,
    status: publicStatus,
    created_at: new Date(job.created_ms).toISOString(),
    updated_at: new Date(job.updated_ms).toISOString(),
    cursor,
    next_cursor: cursor + events.length,
    events,
    progressEvents: events.map((event) => event.phase),
    ...(job.episode ? { episode: job.episode } : {}),
    ...(job.result ? { result: job.result } : {}),
    ...(job.meta ? { meta: job.meta } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
};

type SeriesJobProgressPhase = string;

type SeriesJobProgressEvent = {
  phase: SeriesJobProgressPhase;
  at: string;
  detail?: string;
};

type SeriesGenerationVNextJob = {
  id: string;
  status: "running" | "succeeded" | "failed";
  created_ms: number;
  updated_ms: number;
  events: SeriesJobProgressEvent[];
  result?: SeriesGenerationResult;
  error?: string;
};

const SERIES_JOB_TTL_MS = 30 * 60 * 1000;
const SERIES_JOB_MAX_EVENTS = 160;
const seriesGenerationVNextJobs = new Map<string, SeriesGenerationVNextJob>();

const pruneSeriesGenerationJobs = () => {
  const cutoff = Date.now() - SERIES_JOB_TTL_MS;
  for (const [id, job] of seriesGenerationVNextJobs.entries()) {
    if (job.updated_ms < cutoff) {
      seriesGenerationVNextJobs.delete(id);
    }
  }
};

const appendSeriesJobEvent = (
  job: SeriesGenerationVNextJob,
  event: Omit<SeriesJobProgressEvent, "at"> & { at?: string }
) => {
  const normalizedAt = clean(event.at) || new Date().toISOString();
  job.events.push({
    phase: event.phase,
    at: normalizedAt,
    detail: clean(event.detail) || undefined,
  });
  if (job.events.length > SERIES_JOB_MAX_EVENTS) {
    job.events = job.events.slice(job.events.length - SERIES_JOB_MAX_EVENTS);
  }
  job.updated_ms = Date.now();
};

const serializeSeriesVNextJob = (job: SeriesGenerationVNextJob, cursorRaw?: string | null) => {
  const parsedCursor = Number.parseInt(String(cursorRaw ?? "0"), 10);
  const cursor = Number.isFinite(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;
  const events = job.events.slice(cursor);
  const publicStatus =
    job.status === "succeeded" ? "completed" : job.status === "running" ? "running" : "failed";

  return {
    jobId: job.id,
    job_id: job.id,
    status: publicStatus,
    created_at: new Date(job.created_ms).toISOString(),
    updated_at: new Date(job.updated_ms).toISOString(),
    cursor,
    next_cursor: cursor + events.length,
    events,
    progressEvents: events.map((event) => event.phase),
    ...(job.result ? job.result : {}),
    ...(job.error ? { error: job.error } : {}),
  };
};

app.post("/api/quest", async (c) => {
  try {
    const input = await withQuestProgress("api_request_received", async () => c.req.json());
    const run = await questWorkflow.createRun();
    const result = await run.start({ inputData: input });

    const payload: any = unwrapMastraOutput(result)?.quest || unwrapMastraOutput(result);
    const meta =
      (result as any)?.outputData?.meta ??
      (result as any)?.output?.meta ??
      (result as any)?.data?.meta ??
      (result as any)?.result?.meta ??
      null;

    if (payload?.player_preview && payload?.creator_payload) {
      return withQuestProgress("api_response", async () => c.json({ quest: payload, meta }));
    }

    const failure = extractFailure(result) || "Quest payload missing in Mastra result";

    return withQuestProgress("api_response", async () =>
      c.json(
        {
          status: "failed",
          error: failure,
          result,
        },
        500
      )
    );
  } catch (error: any) {
    return withQuestProgress("api_response", async () =>
      c.json(
        {
          status: "failed",
          error: error?.message || "unknown error",
        },
        500
      )
    );
  }
});

app.post("/api/series/generate", async (c) => {
  const logPrefix = "[api/series/generate]";
  try {
    const raw = await c.req.json();
    const parsed = rawSeriesGenerationRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const msg = parsed.error.flatten().formErrors?.join("; ") || parsed.error.message;
      console.error(`${logPrefix} invalid request:`, msg, parsed.error.flatten());
      return c.json({ status: "failed", error: `リクエストが不正です: ${msg}` }, 400);
    }

    const startedMs = Date.now();
    if (SERIES_VERBOSE_CONSOLE) {
      const rawRow = parsed.data as unknown as Record<string, unknown>;
      console.log(`${logPrefix} request accepted — ${summarizeVNextSeriesRequest(parsed.data)}`);
      const recentSummary = formatRecentCountSummary(rawRow);
      if (recentSummary) {
        console.log(`${logPrefix} recent context — ${recentSummary}`);
      }
    }

    const result = await generateSeriesGenerationResultVNext(parsed.data, {
      onProgress: async (event) => {
        logSeriesProgressEvent(logPrefix, {
          startedMs,
          event,
        });
      },
    });
    logSeriesResultSummary(logPrefix, {
      startedMs,
      title: result.seriesBlueprint.concept.title,
      characterCount: 2,
      continuityAxisCount: result.seriesBlueprint.continuityAxes.axes.length,
      workflowVersion: result.workflowVersion,
    });
    return c.json(result);
  } catch (error: any) {
    console.error(`${logPrefix} error:`, error?.message || error);
    return c.json(
      {
        status: "failed",
        error: error?.message || "unknown error",
      },
      500
    );
  }
});

app.post("/api/series/generate/jobs", async (c) => {
  const logPrefix = "[api/series/generate/jobs]";
  try {
    pruneSeriesGenerationJobs();

    const raw = await c.req.json();
    const parsed = rawSeriesGenerationRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const msg = parsed.error.flatten().formErrors?.join("; ") || parsed.error.message;
      console.error(`${logPrefix} invalid request:`, msg, parsed.error.flatten());
      return c.json({ status: "failed", error: `リクエストが不正です: ${msg}` }, 400);
    }

    const jobId = randomUUID();
    const now = Date.now();
    const job: SeriesGenerationVNextJob = {
      id: jobId,
      status: "running",
      created_ms: now,
      updated_ms: now,
      events: [],
    };
    seriesGenerationVNextJobs.set(jobId, job);
    if (SERIES_VERBOSE_CONSOLE) {
      const rawRow = parsed.data as unknown as Record<string, unknown>;
      console.log(`${logPrefix} request accepted — id=${jobId} ${summarizeVNextSeriesRequest(parsed.data)}`);
      const recentSummary = formatRecentCountSummary(rawRow);
      if (recentSummary) {
        console.log(`${logPrefix} recent context — id=${jobId} ${recentSummary}`);
      }
    }

    appendSeriesJobEvent(job, {
      phase: "request_received",
      detail: "vNextシリーズ生成リクエストを受領",
    });
    appendSeriesJobEvent(job, {
      phase: "input_validated",
      detail: "vNext入力スキーマ検証を完了",
    });

    void (async () => {
      try {
        const startedMs = Date.now();
        console.log(`${logPrefix} ジョブ開始 — id: ${jobId}`);
        const result = await generateSeriesGenerationResultVNext(parsed.data, {
          onProgress: async (event) => {
            appendSeriesJobEvent(job, event);
            logSeriesProgressEvent(logPrefix, {
              jobId,
              startedMs,
              event,
            });
          },
        });

        appendSeriesJobEvent(job, {
          phase: "response_preparing",
          detail: "レスポンス整形を実施",
        });
        job.status = "succeeded";
        job.result = result;
        appendSeriesJobEvent(job, {
          phase: "completed",
          detail: "vNextシリーズ生成が完了",
        });
        logSeriesResultSummary(logPrefix, {
          jobId,
          startedMs,
          title: result.seriesBlueprint.concept.title,
          characterCount: 2,
          continuityAxisCount: result.seriesBlueprint.continuityAxes.axes.length,
          workflowVersion: result.workflowVersion,
        });
        console.log(`${logPrefix} ジョブ成功 — id: ${jobId}, title: ${result.seriesBlueprint.concept.title}`);
      } catch (error: any) {
        const message = error?.message || "unknown error";
        job.status = "failed";
        job.error = message;
        job.updated_ms = Date.now();
        console.error(`${logPrefix} ジョブ失敗 — id: ${jobId}:`, message);
      }
    })();

    return c.json(
      {
        jobId,
        job_id: jobId,
        status: "running",
        pollPath: `/api/series/generate/jobs/${jobId}`,
        poll_path: `/api/series/generate/jobs/${jobId}`,
        cursor: 0,
        next_cursor: job.events.length,
        events: job.events,
      },
      202
    );
  } catch (error: any) {
    console.error(`${logPrefix} error:`, error?.message || error);
    return c.json(
      {
        status: "failed",
        error: error?.message || "unknown error",
      },
      500
    );
  }
});

app.get("/api/series/generate/jobs/:jobId", async (c) => {
  pruneSeriesGenerationJobs();
  const jobId = c.req.param("jobId");
  const job = seriesGenerationVNextJobs.get(jobId);
  if (!job) {
    return c.json(
      {
        status: "failed",
        error: "job_not_found",
      },
      404
    );
  }
  return c.json(serializeSeriesVNextJob(job, c.req.query("cursor")));
});

app.post("/api/series/episode/jobs", async (c) => {
  const epLog = "[api/series/episode/jobs]";
  try {
    pruneEpisodeGenerationJobs();

    const rawInput = await c.req.json();
    const parsedVNext = generateEpisodeRuntimeInputSchema.safeParse(rawInput);
    if (parsedVNext.success) {
      const jobId = randomUUID();
      const now = Date.now();
      const job: EpisodeGenerationJob = {
        id: jobId,
        status: "running",
        created_ms: now,
        updated_ms: now,
        events: [],
        mode: "vnext",
      };
      episodeGenerationJobs.set(jobId, job);

      appendEpisodeJobEvent(job, {
        phase: "request_received",
        detail: "vNextランタイム入力を受領",
      });
      appendEpisodeJobEvent(job, {
        phase: "input_validated",
        detail: "vNextスキーマ検証を完了",
      });

      void (async () => {
        const startMs = Date.now();
        try {
          console.log(
            `${epLog} vNextジョブ開始 — id: ${jobId}, series: ${parsedVNext.data.seriesBlueprint.concept.title}, location: ${parsedVNext.data.request.episodeRequest.locationContext.cityOrArea}`
          );
          const result = await generateEpisodeRuntimeVNext(parsedVNext.data, {
            onProgress: async (event) => {
              appendEpisodeJobEvent(job, {
                phase: clean(event.phase) || "runtime_progress",
                detail: clean(event.detail),
                at: clean(event.at),
              });
            },
          });

          appendEpisodeJobEvent(job, {
            phase: "response_preparing",
            detail: "レスポンス整形を実施",
          });

          const elapsedMs = Date.now() - startMs;
          job.status = "succeeded";
          job.result = result;
          job.meta = {
            workflow_version: result.workflowVersion,
            spots_count: result.episodeOutput.selectedSpots.length,
            elapsed_ms: elapsedMs,
          };
          appendEpisodeJobEvent(job, {
            phase: "completed",
            detail: "vNextエピソード生成が完了",
          });
          console.log(
            `${epLog} vNextジョブ成功 — id: ${jobId}, title: ${result.episodeOutput.title}, spots: ${result.episodeOutput.selectedSpots.length}, elapsed: ${(elapsedMs / 1000).toFixed(1)}秒`
          );
        } catch (error: any) {
          const message = error?.message || "unknown error";
          job.status = "failed";
          job.error = message;
          job.updated_ms = Date.now();
          console.error(`${epLog} vNextジョブ失敗 — id: ${jobId}:`, message);
        }
      })();

      return c.json(
        {
          jobId,
          job_id: jobId,
          status: "running",
          pollPath: `/api/series/episode/jobs/${jobId}`,
          poll_path: `/api/series/episode/jobs/${jobId}`,
          cursor: 0,
          next_cursor: job.events.length,
          events: job.events,
        },
        202
      );
    }

    const rawSeries = (rawInput as any)?.series;
    const rawChars = rawSeries?.characters;
    const charsLen = Array.isArray(rawChars) ? rawChars.length : "not-array";
    console.log(
      `${epLog} リクエスト受付 — series: ${rawSeries?.title || "?"}, location: ${(rawInput as any)?.episode_request?.stage_location || "?"}, purpose: ${(rawInput as any)?.episode_request?.purpose || "?"}, characters受信: ${charsLen}`
    );

    const parsed = seriesRuntimeEpisodeRequestSchema.safeParse(rawInput);
    if (!parsed.success) {
      console.error(`${epLog} バリデーション失敗:`, parsed.error.flatten());
      return c.json(
        {
          status: "failed",
          error: "invalid_input",
          details: parsed.error.flatten(),
        },
        400
      );
    }

    const characters = parsed.data.series.characters || [];
    if (characters.length === 0) {
      console.error(
        `${epLog} キャラクターが空 — リクエスト拒否 (raw受信: ${charsLen}, parsed後: ${characters.length})`
      );
      return c.json(
        {
          status: "failed",
          error: "characters_required",
          message: "シリーズのキャラクター情報が必須です。シリーズを保存し直してください。",
        },
        400
      );
    }

    const jobId = randomUUID();
    const now = Date.now();
    const job: EpisodeGenerationJob = {
      id: jobId,
      status: "running",
      created_ms: now,
      updated_ms: now,
      events: [],
      mode: "legacy",
    };
    episodeGenerationJobs.set(jobId, job);

    appendEpisodeJobEvent(job, {
      phase: "request_received",
      detail: "エピソード生成リクエストを受領",
    });
    appendEpisodeJobEvent(job, {
      phase: "input_validated",
      detail: "入力スキーマ検証を完了",
    });
    appendEpisodeJobEvent(job, {
      phase: "characters_validated",
      detail: `キャラクター${characters.length}名を確認`,
    });

    void (async () => {
      const startMs = Date.now();
      try {
        console.log(`${epLog} ジョブ開始 — id: ${jobId}`);
        const episode = await generateSeriesRuntimeEpisode(parsed.data, {
          onProgress: async (event) => {
            appendEpisodeJobEvent(job, event);
          },
        });
        appendEpisodeJobEvent(job, {
          phase: "response_preparing",
          detail: "レスポンス整形を実施",
        });

        if (episode?.title && episode?.spots?.length) {
          const elapsedMs = Date.now() - startMs;
          job.status = "succeeded";
          job.episode = episode;
          job.meta = {
            workflow_version: "series-runtime-episode-v3-route-trace",
            spots_count: episode.spots.length,
            elapsed_ms: elapsedMs,
          };
          appendEpisodeJobEvent(job, {
            phase: "completed",
            detail: "エピソード生成が完了",
          });
          console.log(
            `${epLog} ジョブ成功 — id: ${jobId}, title: ${episode.title}, spots: ${episode.spots.length}, elapsed: ${(elapsedMs / 1000).toFixed(1)}秒`
          );
          return;
        }

        throw new Error("Episode payload missing");
      } catch (error: any) {
        const message = error?.message || "unknown error";
        job.status = "failed";
        job.error = message;
        job.updated_ms = Date.now();
        console.error(`${epLog} ジョブ失敗 — id: ${jobId}:`, message);
      }
    })();

    return c.json(
      {
        jobId,
        job_id: jobId,
        status: "running",
        pollPath: `/api/series/episode/jobs/${jobId}`,
        poll_path: `/api/series/episode/jobs/${jobId}`,
        cursor: 0,
        next_cursor: job.events.length,
        events: job.events,
      },
      202
    );
  } catch (error: any) {
    console.error(`${epLog} エラー:`, error?.message || error);
    return c.json(
      {
        status: "failed",
        error: error?.message || "unknown error",
      },
      500
    );
  }
});

app.get("/api/series/episode/jobs/:jobId", async (c) => {
  pruneEpisodeGenerationJobs();
  const jobId = c.req.param("jobId");
  const job = episodeGenerationJobs.get(jobId);
  if (!job) {
    return c.json(
      {
        status: "failed",
        error: "job_not_found",
      },
      404
    );
  }
  return c.json(serializeEpisodeJob(job, c.req.query("cursor")));
});

app.post("/api/series/episode", async (c) => {
  const epLog = "[api/series/episode]";
  try {
    const rawInput = await c.req.json();
    const parsedVNext = generateEpisodeRuntimeInputSchema.safeParse(rawInput);
    if (parsedVNext.success) {
      console.log(
        `${epLog} vNext リクエスト受付 — series: ${parsedVNext.data.seriesBlueprint.concept.title}, location: ${parsedVNext.data.request.episodeRequest.locationContext.cityOrArea}, goal: ${parsedVNext.data.request.episodeRequest.tourismGoal}`
      );
      const startMs = Date.now();
      const result = await generateEpisodeRuntimeVNext(parsedVNext.data);
      const elapsedMs = Date.now() - startMs;
      return c.json({
        result,
        meta: {
          workflow_version: result.workflowVersion,
          spots_count: result.episodeOutput.selectedSpots.length,
          elapsed_ms: elapsedMs,
        },
      });
    }

    const rawSeries = (rawInput as any)?.series;
    const rawChars = rawSeries?.characters;
    const charsLen = Array.isArray(rawChars) ? rawChars.length : "not-array";
    console.log(`${epLog} リクエスト受付 — series: ${rawSeries?.title || "?"}, location: ${(rawInput as any)?.episode_request?.stage_location || "?"}, purpose: ${(rawInput as any)?.episode_request?.purpose || "?"}, characters受信: ${charsLen}`);

    const parsed = seriesRuntimeEpisodeRequestSchema.safeParse(rawInput);
    if (!parsed.success) {
      console.error(`${epLog} バリデーション失敗:`, parsed.error.flatten());
      return c.json(
        {
          status: "failed",
          error: "invalid_input",
          details: parsed.error.flatten(),
        },
        400
      );
    }

    const characters = parsed.data.series.characters || [];
    if (characters.length === 0) {
      console.error(`${epLog} キャラクターが空 — リクエスト拒否 (raw受信: ${charsLen}, parsed後: ${characters.length})`);
      return c.json(
        {
          status: "failed",
          error: "characters_required",
          message: "シリーズのキャラクター情報が必須です。シリーズを保存し直してください。",
        },
        400
      );
    }

    console.log(`${epLog} エピソード生成開始`);
    const startMs = Date.now();
    const episode = await generateSeriesRuntimeEpisode(parsed.data);
    const elapsedMs = Date.now() - startMs;

    if (episode?.title && episode?.spots?.length) {
      console.log(`${epLog} エピソード生成成功 (${(elapsedMs / 1000).toFixed(1)}秒) — title: ${episode.title}, spots: ${episode.spots.length}`);
      return c.json({
        episode,
        meta: {
          workflow_version: "series-runtime-episode-v3-route-trace",
          spots_count: episode.spots.length,
          elapsed_ms: elapsedMs,
        },
      });
    }

    console.error(`${epLog} エピソード生成失敗 — title/spots が空`);
    return c.json(
      {
        status: "failed",
        error: "Episode payload missing",
      },
      500
    );
  } catch (error: any) {
    console.error(`${epLog} エラー:`, error?.message || error);
    return c.json(
      {
        status: "failed",
        error: error?.message || "unknown error",
      },
      500
    );
  }
});

app.get("/api/series/image", async (c) => {
  try {
    const request = resolveSeriesImageRequest({
      prompt: c.req.query("prompt"),
      seed: c.req.query("seed"),
      width: c.req.query("width"),
      height: c.req.query("height"),
      purpose: c.req.query("purpose"),
      styleReference: c.req.query("style_ref"),
      references: c.req.query("refs"),
    });

    if (!request) {
      return c.json(
        {
          status: "failed",
          error: "invalid_image_request",
        },
        400
      );
    }

    const cutoutQuery = clean(c.req.query("cutout")).toLowerCase();
    const isCutoutDisabledByQuery =
      cutoutQuery === "0" ||
      cutoutQuery === "false" ||
      cutoutQuery === "off" ||
      cutoutQuery === "no";
    const shouldApplyPortraitCutout =
      SERIES_IMAGE_CUTOUT_ENABLED &&
      request.purpose === "character_portrait" &&
      !isCutoutDisabledByQuery;

    const cacheProviders = normalizeHybridProviderOrder(request);
    for (const provider of cacheProviders) {
      const cacheKey = buildSeriesImageCacheKey(provider, request, {
        cutout: shouldApplyPortraitCutout,
      });
      const cached = getSeriesImageCache(cacheKey);
      if (!cached) continue;
      const headers = new Headers();
      headers.set("Content-Type", cached.contentType);
      headers.set("Cache-Control", `public, max-age=${IMAGE_CACHE_TTL_SECONDS}, s-maxage=${IMAGE_CACHE_TTL_SECONDS}`);
      headers.set(
        "X-Series-Image-Provider",
        shouldApplyPortraitCutout ? `${provider}:cutout:cache` : `${provider}:cache`
      );
      return new Response(cached.data, { status: 200, headers });
    }

    let generated = await generateSeriesImageHybrid(request);
    let responsePayload = {
      contentType: generated.contentType || "image/png",
      data: generated.data,
    };
    let cutoutApplied = false;

    if (shouldApplyPortraitCutout) {
      try {
        responsePayload = await applyPortraitCutout(responsePayload);
        cutoutApplied = true;
      } catch (error: any) {
        console.warn(
          `[series-image] portrait cutout failed (provider=${generated.provider}): ${
            clean(error?.message || String(error)) || "unknown"
          }`
        );
      }
    }

    const headers = new Headers();
    headers.set("Content-Type", responsePayload.contentType || "image/png");
    headers.set(
      "Cache-Control",
      `public, max-age=${IMAGE_CACHE_TTL_SECONDS}, s-maxage=${IMAGE_CACHE_TTL_SECONDS}`
    );
    headers.set(
      "X-Series-Image-Provider",
      cutoutApplied ? `${generated.provider}:cutout` : generated.provider
    );

    setSeriesImageCache(buildSeriesImageCacheKey(generated.provider, request, {
      cutout: cutoutApplied,
    }), {
      contentType: headers.get("Content-Type") || "image/png",
      data: responsePayload.data,
    });

    return new Response(responsePayload.data, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    return c.json(
      {
        status: "failed",
        error: error?.message || "image_proxy_unknown_error",
      },
      500
    );
  }
});

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT || 4111),
});

console.log(`Mastra server running on http://localhost:${process.env.PORT || 4111}`);
