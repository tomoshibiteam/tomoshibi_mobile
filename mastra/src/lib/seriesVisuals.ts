const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();

const IMAGE_PROVIDER_BASE_URL =
  clean(process.env.SERIES_IMAGE_PROVIDER_URL) || "https://image.pollinations.ai/prompt";

const hashText = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
};

const clampSize = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const buildSeriesImageUrl = (options: {
  prompt: string;
  seedKey: string;
  width?: number;
  height?: number;
}) => {
  const prompt = clean(options.prompt);
  if (!prompt) return "";
  const safePrompt = prompt.slice(0, 140);

  const seed = hashText(`${options.seedKey}:${safePrompt}`);
  const width = clampSize(options.width ?? 768, 320, 1536);
  const height = clampSize(options.height ?? 1024, 320, 1536);

  const url = new URL(`${IMAGE_PROVIDER_BASE_URL.replace(/\/+$/, "")}/${encodeURIComponent(safePrompt)}`);
  url.searchParams.set("model", "flux");
  url.searchParams.set("width", String(width));
  url.searchParams.set("height", String(height));
  url.searchParams.set("seed", String(seed));
  url.searchParams.set("nologo", "true");
  url.searchParams.set("safe", "true");
  url.searchParams.set("enhance", "true");
  return url.toString();
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
    "cinematic Japanese novel cover art",
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
}) => {
  const parts = [
    "character portrait, waist-up, Japanese illustration style",
    clean(input.name),
    clean(input.role),
    clean(input.appearance),
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
