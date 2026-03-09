const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();

const UNIFIED_ART_STYLE =
  "soft anime illustration style, cel-shaded coloring, warm cinematic lighting, consistent color palette, studio quality, digital painting";

const getImageProviderBaseUrl = () =>
  clean(process.env.SERIES_IMAGE_PROVIDER_URL) || "https://image.pollinations.ai/prompt";
const getImageProviderModel = () => clean(process.env.SERIES_IMAGE_PROVIDER_MODEL) || "flux";
const getImageProviderSetting = () => clean(process.env.SERIES_IMAGE_PROVIDER).toLowerCase();
const getImageDeliveryMode = () => clean(process.env.SERIES_IMAGE_DELIVERY).toLowerCase();
const getMastraPublicBaseUrl = () => clean(process.env.MASTRA_PUBLIC_BASE_URL).replace(/\/+$/, "");
const hasGeminiApiKey = () =>
  Boolean(clean(process.env.GOOGLE_GENERATIVE_AI_API_KEY) || clean(process.env.GEMINI_API_KEY));

const hashText = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
};

const clampSize = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clampSeed = (value: number) => Math.max(0, Math.min(2147483647, Math.floor(Math.abs(value))));

export type SeriesImageRequest = {
  prompt: string;
  seed: number;
  width: number;
  height: number;
};

export type SeriesImageProvider = "gemini" | "pollinations";

export const resolveSeriesImageProvider = (): SeriesImageProvider => {
  const imageProviderSetting = getImageProviderSetting();
  if (imageProviderSetting === "gemini") return "gemini";
  if (imageProviderSetting === "pollinations") return "pollinations";
  return hasGeminiApiKey() ? "gemini" : "pollinations";
};

const SERIES_IMAGE_ASPECT_RATIOS: Array<{ ratio: string; value: number }> = [
  { ratio: "1:1", value: 1 },
  { ratio: "3:4", value: 3 / 4 },
  { ratio: "4:3", value: 4 / 3 },
  { ratio: "9:16", value: 9 / 16 },
  { ratio: "16:9", value: 16 / 9 },
];

export const resolveSeriesImageAspectRatio = (width: number, height: number) => {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const target = safeWidth / safeHeight;
  let best = SERIES_IMAGE_ASPECT_RATIOS[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of SERIES_IMAGE_ASPECT_RATIOS) {
    const distance = Math.abs(entry.value - target);
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }

  return best.ratio;
};

export const resolveSeriesImageRequest = (options: {
  prompt?: string | null;
  seedKey?: string | null;
  seed?: number | string | null;
  width?: number | string | null;
  height?: number | string | null;
}): SeriesImageRequest | null => {
  const prompt = clean(options.prompt);
  if (!prompt) return null;
  const safePrompt = prompt.slice(0, 140);

  const widthCandidate =
    typeof options.width === "string" ? Number.parseInt(options.width, 10) : Number(options.width ?? 768);
  const heightCandidate =
    typeof options.height === "string" ? Number.parseInt(options.height, 10) : Number(options.height ?? 1024);
  const width = clampSize(Number.isFinite(widthCandidate) ? widthCandidate : 768, 320, 1536);
  const height = clampSize(Number.isFinite(heightCandidate) ? heightCandidate : 1024, 320, 1536);

  const seedFromInput =
    typeof options.seed === "string" ? Number.parseInt(options.seed, 10) : Number(options.seed ?? NaN);
  const seedFromSeedKey = hashText(`${clean(options.seedKey)}:${safePrompt}`);
  const seed = clampSeed(Number.isFinite(seedFromInput) ? seedFromInput : seedFromSeedKey);

  return {
    prompt: safePrompt,
    seed,
    width,
    height,
  };
};

export const buildSeriesImageProviderUrl = (request: SeriesImageRequest) => {
  const imageProviderBaseUrl = getImageProviderBaseUrl();
  const imageProviderModel = getImageProviderModel();
  const url = new URL(`${imageProviderBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(request.prompt)}`);
  url.searchParams.set("model", imageProviderModel);
  url.searchParams.set("width", String(request.width));
  url.searchParams.set("height", String(request.height));
  url.searchParams.set("seed", String(request.seed));
  url.searchParams.set("nologo", "true");
  url.searchParams.set("safe", "true");
  url.searchParams.set("enhance", "true");
  return url.toString();
};

export const buildSeriesImageProxyUrl = (request: SeriesImageRequest) => {
  const mastraPublicBaseUrl = getMastraPublicBaseUrl();
  if (!mastraPublicBaseUrl) return "";
  const url = new URL(`${mastraPublicBaseUrl}/api/series/image`);
  url.searchParams.set("prompt", request.prompt);
  url.searchParams.set("seed", String(request.seed));
  url.searchParams.set("width", String(request.width));
  url.searchParams.set("height", String(request.height));
  return url.toString();
};

export const buildSeriesImageUrl = (options: {
  prompt: string;
  seedKey: string;
  width?: number;
  height?: number;
}) => {
  const request = resolveSeriesImageRequest({
    prompt: options.prompt,
    seedKey: options.seedKey,
    width: options.width,
    height: options.height,
  });
  if (!request) return "";

  const imageDeliveryMode = getImageDeliveryMode();
  const useMastraProxy =
    imageDeliveryMode === "proxy" ||
    imageDeliveryMode === "mastra" ||
    resolveSeriesImageProvider() === "gemini";
  if (useMastraProxy) {
    const proxyUrl = buildSeriesImageProxyUrl(request);
    if (proxyUrl) return proxyUrl;
  }

  return buildSeriesImageProviderUrl(request);
};

export const buildCoverImagePrompt = (input: {
  title: string;
  genre: string;
  tone: string;
  premise: string;
  setting: string;
}) => {
  const title = clean(input.title);
  const genre = clean(input.genre);
  const tone = clean(input.tone);
  const premise = clean(input.premise);
  const setting = clean(input.setting);

  const parts = [
    UNIFIED_ART_STYLE,
    "novel cover composition",
    `${title}`,
    `${genre}`,
    `${tone}`,
    setting ? `set in ${setting}` : "",
    premise ? `theme: ${premise}` : "",
    "dramatic lighting, high detail, no text, no watermark",
  ]
    .map((item) => clean(item))
    .filter(Boolean);

  return parts.join(", ");
};

export const buildCharacterPortraitPrompt = (input: {
  seriesTitle: string;
  genre: string;
  tone: string;
  name: string;
  role: string;
  personality: string;
  appearance: string;
  setting: string;
  dominantColor?: string;
  bodyType?: string;
  distinguishingFeature?: string;
}) => {
  const parts = [
    UNIFIED_ART_STYLE,
    "character portrait, waist-up",
    clean(input.name),
    clean(input.role),
    clean(input.appearance),
    clean(input.dominantColor) ? `color theme: ${clean(input.dominantColor)}` : "",
    clean(input.bodyType) ? `build: ${clean(input.bodyType)}` : "",
    clean(input.distinguishingFeature) ? `notable feature: ${clean(input.distinguishingFeature)}` : "",
    clean(input.personality),
    clean(input.setting) ? `background hint: ${clean(input.setting)}` : "",
    clean(input.genre),
    clean(input.tone),
    clean(input.seriesTitle) ? `from series ${clean(input.seriesTitle)}` : "",
    "clean composition, no text, no watermark",
  ]
    .map((item) => clean(item))
    .filter(Boolean);

  return parts.join(", ");
};

export const buildWorldVisualPrompt = (input: {
  seriesTitle: string;
  genre: string;
  tone: string;
  setting: string;
  focusTitle: string;
  focusDescription: string;
  atmosphere?: string;
}) => {
  const parts = [
    UNIFIED_ART_STYLE,
    "environment concept art, street-level perspective, walkable city district",
    clean(input.focusTitle),
    clean(input.focusDescription),
    clean(input.setting) ? `setting: ${clean(input.setting)}` : "",
    clean(input.genre),
    clean(input.tone),
    clean(input.atmosphere),
    clean(input.seriesTitle) ? `from series ${clean(input.seriesTitle)}` : "",
    "high detail, no text, no logo, no watermark",
  ]
    .map((item) => clean(item))
    .filter(Boolean);

  return parts.join(", ");
};
