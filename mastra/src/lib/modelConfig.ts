const clean = (value?: string | null) => (value || "").trim();

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

const LEGACY_GLOBAL_MODEL = clean(process.env.MASTRA_MODEL);
const LEGACY_PRO_MODEL = clean(process.env.MASTRA_MODEL_PRO);
const LEGACY_FLASH_MODEL = clean(process.env.MASTRA_MODEL_FLASH);

// Tier defaults:
// - deep: highest quality / hardest reasoning
// - balanced: default product path
// - fast: high-throughput / lowest latency path
export const MASTRA_MODEL_DEEP = pickModel(
  process.env.MASTRA_MODEL_DEEP,
  LEGACY_PRO_MODEL,
  LEGACY_GLOBAL_MODEL,
  "google/gemini-3.1-pro-preview"
);

export const MASTRA_MODEL_BALANCED = pickModel(
  process.env.MASTRA_MODEL_BALANCED,
  LEGACY_FLASH_MODEL,
  "google/gemini-3-flash-preview"
);

export const MASTRA_MODEL_FAST = pickModel(
  process.env.MASTRA_MODEL_FAST,
  process.env.MASTRA_MODEL_FLASH_LITE,
  "google/gemini-3.1-flash-lite-preview"
);

// Backward-compatible exports kept for existing imports.
export const MASTRA_MODEL_PRO = MASTRA_MODEL_DEEP;
export const MASTRA_MODEL_FLASH = MASTRA_MODEL_BALANCED;

// Agent-specific model mapping (can be overridden per agent via env).
export const MASTRA_SERIES_CONCEPT_MODEL = pickModel(
  process.env.MASTRA_SERIES_CONCEPT_MODEL,
  MASTRA_MODEL_DEEP
);
export const MASTRA_SERIES_CHARACTER_MODEL = pickModel(
  process.env.MASTRA_SERIES_CHARACTER_MODEL,
  MASTRA_MODEL_BALANCED
);
export const MASTRA_SERIES_EPISODE_MODEL = pickModel(
  process.env.MASTRA_SERIES_EPISODE_MODEL,
  MASTRA_MODEL_BALANCED
);
export const MASTRA_SERIES_RUNTIME_EPISODE_MODEL = pickModel(
  process.env.MASTRA_SERIES_RUNTIME_EPISODE_MODEL,
  MASTRA_MODEL_BALANCED
);
export const MASTRA_SERIES_CONSISTENCY_MODEL = pickModel(
  process.env.MASTRA_SERIES_CONSISTENCY_MODEL,
  MASTRA_MODEL_FAST
);

export const MASTRA_PLOT_MODEL = pickModel(
  process.env.MASTRA_PLOT_MODEL,
  MASTRA_MODEL_BALANCED
);
export const MASTRA_TOURISM_MODEL = pickModel(
  process.env.MASTRA_TOURISM_MODEL,
  MASTRA_MODEL_BALANCED
);
export const MASTRA_CHAPTER_MODEL = pickModel(
  process.env.MASTRA_CHAPTER_MODEL,
  MASTRA_MODEL_FAST
);
export const MASTRA_PUZZLE_MODEL = pickModel(
  process.env.MASTRA_PUZZLE_MODEL,
  MASTRA_MODEL_FAST
);
export const MASTRA_SLOT_FILLER_MODEL = pickModel(
  process.env.MASTRA_SLOT_FILLER_MODEL,
  MASTRA_MODEL_FAST
);
