import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MASTRA_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(MASTRA_ROOT, "..");

const ENV_CANDIDATES = [
  path.resolve(REPO_ROOT, ".env"),
  path.resolve(REPO_ROOT, ".env.local"),
  path.resolve(MASTRA_ROOT, ".env"),
  path.resolve(MASTRA_ROOT, ".env.local"),
];

for (const envPath of ENV_CANDIDATES) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
}

const clean = (value?: string | null) => (value || "").trim();
const toLower = (value?: string | null) => clean(value).toLowerCase();
const isTruthy = (value?: string | null) => /^(1|true|on|yes)$/i.test(clean(value));

const GEMINI_FLASH_PREVIEW_MODEL = "google/gemini-3-flash-preview";

// Local/ollama provider fallback has been removed intentionally.
// We keep these env checks only to emit explicit warnings when old config is still present.
const requestedProvider =
  toLower(process.env.MASTRA_TEXT_MODEL_PROVIDER) ||
  toLower(process.env.MASTRA_MODEL_PROVIDER);
if (requestedProvider && requestedProvider !== "external") {
  console.warn(
    "[model-config] Local model provider settings are deprecated and ignored. External provider only."
  );
}
if (isTruthy(process.env.MASTRA_USE_OLLAMA) || isTruthy(process.env.MASTRA_LOCAL_LLM)) {
  console.warn(
    "[model-config] MASTRA_USE_OLLAMA / MASTRA_LOCAL_LLM is deprecated and ignored. External provider only."
  );
}

export const MASTRA_TEXT_MODEL_PROVIDER_MODE = "external" as const;

const hasExternalTextModelApiKey = () =>
  Boolean(
    clean(process.env.GOOGLE_GENERATIVE_AI_API_KEY) ||
      clean(process.env.GEMINI_API_KEY) ||
      clean(process.env.OPENAI_API_KEY) ||
      clean(process.env.ANTHROPIC_API_KEY)
  );

export const isMastraTextModelAvailable = () =>
  hasExternalTextModelApiKey();

const normalizeDeprecatedGeminiModel = (raw?: string | null) => {
  const normalized = clean(raw);
  if (!normalized) return "";

  if (normalized === "google/gemini-3-pro-preview") {
    return "google/gemini-3.1-pro-preview";
  }
  if (normalized === "gemini-3-pro-preview") {
    return "gemini-3.1-pro-preview";
  }

  return normalized;
};

const pickModel = (...candidates: Array<string | undefined | null>) => {
  for (const candidate of candidates) {
    const normalized = normalizeDeprecatedGeminiModel(candidate);
    if (normalized) return normalized;
  }
  return "";
};

const pickUnifiedTextModel = (...candidates: Array<string | undefined | null>) => {
  return pickModel(
    ...candidates,
    process.env.MASTRA_MODEL_TEXT,
    process.env.MASTRA_MODEL_FAST,
    process.env.MASTRA_MODEL_FLASH_LITE,
    GEMINI_FLASH_PREVIEW_MODEL
  );
};

// Tier defaults:
// - deep: highest quality / hardest reasoning
// - balanced: default product path
// - fast: high-throughput / lowest latency path
export const MASTRA_MODEL_DEEP = pickUnifiedTextModel(process.env.MASTRA_MODEL_DEEP);

export const MASTRA_MODEL_BALANCED = pickUnifiedTextModel(process.env.MASTRA_MODEL_BALANCED);

export const MASTRA_MODEL_FAST = pickUnifiedTextModel(process.env.MASTRA_MODEL_FAST);

// Backward-compatible exports kept for existing imports.
export const MASTRA_MODEL_PRO = MASTRA_MODEL_DEEP;
export const MASTRA_MODEL_FLASH = MASTRA_MODEL_BALANCED;

// Agent-specific model mapping (can be overridden per agent via env).
export const MASTRA_SERIES_CONCEPT_MODEL = pickUnifiedTextModel(process.env.MASTRA_SERIES_CONCEPT_MODEL);
export const MASTRA_SERIES_DESIGN_BRIEF_MODEL = pickUnifiedTextModel(
  process.env.MASTRA_SERIES_DESIGN_BRIEF_MODEL,
  process.env.MASTRA_MODEL_FAST
);
export const MASTRA_SERIES_CHARACTER_MODEL = pickUnifiedTextModel(process.env.MASTRA_SERIES_CHARACTER_MODEL);
export const MASTRA_SERIES_EPISODE_MODEL = pickUnifiedTextModel(process.env.MASTRA_SERIES_EPISODE_MODEL);
export const MASTRA_SERIES_RUNTIME_EPISODE_MODEL = pickUnifiedTextModel(
  process.env.MASTRA_SERIES_RUNTIME_EPISODE_MODEL
);
export const MASTRA_SERIES_CONSISTENCY_MODEL = pickUnifiedTextModel(process.env.MASTRA_SERIES_CONSISTENCY_MODEL);

export const MASTRA_PLOT_MODEL = pickUnifiedTextModel(process.env.MASTRA_PLOT_MODEL);
export const MASTRA_TOURISM_MODEL = pickUnifiedTextModel(process.env.MASTRA_TOURISM_MODEL);
export const MASTRA_CHAPTER_MODEL = pickUnifiedTextModel(process.env.MASTRA_CHAPTER_MODEL);
export const MASTRA_PUZZLE_MODEL = pickUnifiedTextModel(process.env.MASTRA_PUZZLE_MODEL);
export const MASTRA_SLOT_FILLER_MODEL = pickUnifiedTextModel(process.env.MASTRA_SLOT_FILLER_MODEL);
