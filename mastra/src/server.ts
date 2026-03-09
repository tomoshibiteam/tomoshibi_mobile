import dotenv from "dotenv";
dotenv.config({ override: true });
import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { MastraServer, HonoBindings, HonoVariables } from "@mastra/hono";
import { mastra } from "./index";
import { seriesGenerationRequestSchema } from "./schemas/series";
import { questWorkflow } from "./workflows/quest-workflow";
import {
  generateSeriesWorkflowWithProgress,
  type SeriesGenerationProgressEvent,
  type SeriesWorkflowOutput,
  seriesWorkflow,
} from "./workflows/series-workflow";
import { withQuestProgress } from "./lib/questProgress";
import {
  generateSeriesRuntimeEpisode,
  type SeriesRuntimeEpisodeOutput,
  type SeriesRuntimeEpisodeProgressEvent,
  seriesRuntimeEpisodeRequestSchema,
} from "./lib/agents/seriesRuntimeEpisodeAgent";
import {
  buildSeriesImageProviderUrl,
  resolveSeriesImageAspectRatio,
  resolveSeriesImageProvider,
  resolveSeriesImageRequest,
  SeriesImageRequest,
} from "./lib/seriesVisuals";

const app = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();
app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization"] }));

const server = new MastraServer({ app, mastra });
await server.init();

app.get("/", (c) => c.text("TOMOSHIBI Mastra API"));

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();
const GEMINI_IMAGE_MODEL = clean(process.env.SERIES_IMAGE_GEMINI_MODEL) || "gemini-3-pro-image-preview";
const GEMINI_API_KEY =
  clean(process.env.GOOGLE_GENERATIVE_AI_API_KEY) || clean(process.env.GEMINI_API_KEY);
const GEMINI_POLLINATIONS_FALLBACK = clean(process.env.SERIES_IMAGE_GEMINI_FALLBACK).toLowerCase() !== "off";
const IMAGE_CACHE_TTL_SECONDS = Math.max(
  60,
  Number.parseInt(clean(process.env.SERIES_IMAGE_CACHE_TTL_SEC) || "21600", 10) || 21600
);
const IMAGE_CACHE_LIMIT = Math.max(
  16,
  Number.parseInt(clean(process.env.SERIES_IMAGE_CACHE_LIMIT) || "96", 10) || 96
);

type CachedImage = {
  contentType: string;
  data: ArrayBuffer;
  expiresAt: number;
};

const seriesImageCache = new Map<string, CachedImage>();

const buildSeriesImageCacheKey = (provider: string, request: SeriesImageRequest) =>
  createHash("sha256")
    .update(
      [
        provider,
        String(request.seed),
        String(request.width),
        String(request.height),
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
  return [
    "Generate a single illustration for a mobile story app.",
    `Aspect ratio: ${aspectRatio}.`,
    "Art style: soft anime illustration, cel-shaded coloring, warm cinematic lighting, studio quality digital painting.",
    "IMPORTANT: Maintain a consistent anime illustration style. Do NOT mix photorealistic and anime styles.",
    "No text, no letters, no logos, no watermark.",
    "Keep composition cinematic and clear.",
    `Style seed hint: ${request.seed}.`,
    `Scene prompt: ${request.prompt}`,
  ].join("\n");
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
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: buildGeminiImagePrompt(request) }],
        },
      ],
      generationConfig: {
        temperature: 0.8,
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
  });

  if (!response.ok) {
    const errorText = clean(await response.text()).slice(0, 500);
    throw new Error(`gemini_api_error:${response.status}:${errorText || "unknown"}`);
  }

  const payload = await response.json();
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

type EpisodeJobProgressPhase =
  | SeriesRuntimeEpisodeProgressEvent["phase"]
  | "request_received"
  | "input_validated"
  | "characters_validated"
  | "response_preparing"
  | "completed";

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
  spots_count: number;
  elapsed_ms: number;
};

type EpisodeGenerationJob = {
  id: string;
  status: "running" | "succeeded" | "failed";
  created_ms: number;
  updated_ms: number;
  events: EpisodeJobProgressEvent[];
  episode?: SeriesRuntimeEpisodeOutput;
  meta?: EpisodeGenerationMeta;
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

  return {
    job_id: job.id,
    status: job.status,
    created_at: new Date(job.created_ms).toISOString(),
    updated_at: new Date(job.updated_ms).toISOString(),
    cursor,
    next_cursor: cursor + events.length,
    events,
    ...(job.episode ? { episode: job.episode } : {}),
    ...(job.meta ? { meta: job.meta } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
};

type SeriesJobProgressPhase =
  | SeriesGenerationProgressEvent["phase"]
  | "request_received"
  | "input_validated"
  | "response_preparing"
  | "completed";

type SeriesJobProgressEvent = {
  phase: SeriesJobProgressPhase;
  at: string;
  detail?: string;
};

type SeriesGenerationJob = {
  id: string;
  status: "running" | "succeeded" | "failed";
  created_ms: number;
  updated_ms: number;
  events: SeriesJobProgressEvent[];
  output?: SeriesWorkflowOutput;
  error?: string;
};

const SERIES_JOB_TTL_MS = 30 * 60 * 1000;
const SERIES_JOB_MAX_EVENTS = 160;
const seriesGenerationJobs = new Map<string, SeriesGenerationJob>();

const pruneSeriesGenerationJobs = () => {
  const cutoff = Date.now() - SERIES_JOB_TTL_MS;
  for (const [id, job] of seriesGenerationJobs.entries()) {
    if (job.updated_ms < cutoff) {
      seriesGenerationJobs.delete(id);
    }
  }
};

const appendSeriesJobEvent = (
  job: SeriesGenerationJob,
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

const serializeSeriesJob = (job: SeriesGenerationJob, cursorRaw?: string | null) => {
  const parsedCursor = Number.parseInt(String(cursorRaw ?? "0"), 10);
  const cursor = Number.isFinite(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;
  const events = job.events.slice(cursor);

  return {
    job_id: job.id,
    status: job.status,
    created_at: new Date(job.created_ms).toISOString(),
    updated_at: new Date(job.updated_ms).toISOString(),
    cursor,
    next_cursor: cursor + events.length,
    events,
    ...(job.output ? job.output : {}),
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

app.post("/api/series/jobs", async (c) => {
  const logPrefix = "[api/series/jobs]";
  try {
    pruneSeriesGenerationJobs();

    const raw = await c.req.json();
    const parsed = seriesGenerationRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const msg = parsed.error.flatten().formErrors?.join("; ") || parsed.error.message;
      console.error(`${logPrefix} invalid request:`, msg, parsed.error.flatten());
      return c.json({ status: "failed", error: `リクエストが不正です: ${msg}` }, 400);
    }

    const jobId = randomUUID();
    const now = Date.now();
    const job: SeriesGenerationJob = {
      id: jobId,
      status: "running",
      created_ms: now,
      updated_ms: now,
      events: [],
    };
    seriesGenerationJobs.set(jobId, job);

    appendSeriesJobEvent(job, {
      phase: "request_received",
      detail: "シリーズ生成リクエストを受領",
    });
    appendSeriesJobEvent(job, {
      phase: "input_validated",
      detail: "入力スキーマ検証を完了",
    });

    void (async () => {
      try {
        console.log(`${logPrefix} ジョブ開始 — id: ${jobId}`);
        const output = await generateSeriesWorkflowWithProgress(parsed.data, {
          onProgress: async (event) => {
            appendSeriesJobEvent(job, event);
          },
        });

        appendSeriesJobEvent(job, {
          phase: "response_preparing",
          detail: "レスポンス整形を実施",
        });

        const series = output?.series;
        const hasLegacyEpisodes = Array.isArray(series?.episode_blueprints);
        const hasCheckpoints = Array.isArray(series?.checkpoints);
        if (series?.title && (hasCheckpoints || hasLegacyEpisodes)) {
          job.status = "succeeded";
          job.output = output;
          appendSeriesJobEvent(job, {
            phase: "completed",
            detail: "シリーズ生成が完了",
          });
          console.log(`${logPrefix} ジョブ成功 — id: ${jobId}, title: ${series.title}`);
          return;
        }

        throw new Error("Series payload missing in generated output");
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
        job_id: jobId,
        status: "running",
        poll_path: `/api/series/jobs/${jobId}`,
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

app.get("/api/series/jobs/:jobId", async (c) => {
  pruneSeriesGenerationJobs();
  const jobId = c.req.param("jobId");
  const job = seriesGenerationJobs.get(jobId);
  if (!job) {
    return c.json(
      {
        status: "failed",
        error: "job_not_found",
      },
      404
    );
  }
  return c.json(serializeSeriesJob(job, c.req.query("cursor")));
});

app.post("/api/series", async (c) => {
  try {
    const raw = await c.req.json();
    const parsed = seriesGenerationRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const msg = parsed.error.flatten().formErrors?.join("; ") || parsed.error.message;
      console.error("[api/series] invalid request:", msg, parsed.error.flatten());
      return c.json({ status: "failed", error: `リクエストが不正です: ${msg}` }, 400);
    }
    const input = parsed.data;
    console.log("[api/series] リクエスト受付 — ワークフロー開始");
    const run = await seriesWorkflow.createRun();
    const result = await run.start({ inputData: input });
    console.log("[api/series] ワークフロー実行完了");
    const output = unwrapMastraOutput(result);

    const series = output?.series || output;
    const meta =
      output?.meta ??
      (result as any)?.outputData?.meta ??
      (result as any)?.output?.meta ??
      (result as any)?.data?.meta ??
      (result as any)?.result?.meta ??
      null;

    const hasLegacyEpisodes = Array.isArray(series?.episode_blueprints);
    const hasCheckpoints = Array.isArray(series?.checkpoints);
    if (series?.title && (hasCheckpoints || hasLegacyEpisodes)) {
      console.log("[api/series] 成功 — シリーズ返却:", series?.title ?? "—");
      return c.json({ series, meta });
    }

    const failure = extractFailure(result) || "Series payload missing in Mastra result";
    console.error("[api/series] workflow did not return valid series:", failure, result);
    return c.json(
      {
        status: "failed",
        error: failure,
      },
      500
    );
  } catch (error: any) {
    console.error("[api/series] error:", error?.message, error);
    return c.json(
      {
        status: "failed",
        error: error?.message || "unknown error",
      },
      500
    );
  }
});

app.post("/api/series/episode/jobs", async (c) => {
  const epLog = "[api/series/episode/jobs]";
  try {
    pruneEpisodeGenerationJobs();

    const rawInput = await c.req.json();
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
            workflow_version: "series-runtime-episode-v2-pipeline",
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
        job_id: jobId,
        status: "running",
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
          workflow_version: "series-runtime-episode-v2-pipeline",
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

    const selectedProvider = resolveSeriesImageProvider();
    const selectedCacheKey = buildSeriesImageCacheKey(selectedProvider, request);
    const cached = getSeriesImageCache(selectedCacheKey);
    if (cached) {
      const headers = new Headers();
      headers.set("Content-Type", cached.contentType);
      headers.set("Cache-Control", `public, max-age=${IMAGE_CACHE_TTL_SECONDS}, s-maxage=${IMAGE_CACHE_TTL_SECONDS}`);
      headers.set("X-Series-Image-Provider", `${selectedProvider}:cache`);
      return new Response(cached.data, { status: 200, headers });
    }

    if (selectedProvider === "gemini") {
      try {
        const generated = await generateSeriesImageWithGemini(request);
        setSeriesImageCache(selectedCacheKey, generated);
        const headers = new Headers();
        headers.set("Content-Type", generated.contentType || "image/png");
        headers.set(
          "Cache-Control",
          `public, max-age=${IMAGE_CACHE_TTL_SECONDS}, s-maxage=${IMAGE_CACHE_TTL_SECONDS}`
        );
        headers.set("X-Series-Image-Provider", "gemini");
        return new Response(generated.data, {
          status: 200,
          headers,
        });
      } catch (geminiError) {
        if (!GEMINI_POLLINATIONS_FALLBACK) {
          throw geminiError;
        }
        console.warn("[series-image] Gemini failed, fallback to pollinations", geminiError);
      }
    }

    const upstreamUrl = buildSeriesImageProviderUrl(request);
    const upstream = await fetch(upstreamUrl, {
      headers: {
        "User-Agent": "tomoshibi-mastra/series-image-proxy",
      },
      redirect: "follow",
    });

    if (!upstream.ok) {
      return c.json(
        {
          status: "failed",
          error: `image_provider_error:${upstream.status}`,
          provider_url: upstreamUrl,
        },
        502
      );
    }

    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength === 0) {
      return c.json(
        {
          status: "failed",
          error: "image_provider_empty",
          provider_url: upstreamUrl,
        },
        502
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
    headers.set(
      "Cache-Control",
      `public, max-age=${IMAGE_CACHE_TTL_SECONDS}, s-maxage=${IMAGE_CACHE_TTL_SECONDS}`
    );
    headers.set("X-Series-Image-Provider", "pollinations");

    setSeriesImageCache(buildSeriesImageCacheKey("pollinations", request), {
      contentType: headers.get("Content-Type") || "image/jpeg",
      data: bytes,
    });

    return new Response(bytes, {
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
