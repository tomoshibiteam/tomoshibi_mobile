const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();
const dedupeStrings = (values: Array<string | undefined | null>) => {
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

type SeriesVisualStylePresetDefinition = {
  id: string;
  label: string;
  keywords: string[];
  styleCanon: string;
  guardrails: string;
  negatives: string;
};

const STYLE_PRESET_LIBRARY: SeriesVisualStylePresetDefinition[] = [
  {
    id: "cinematic_anime",
    label: "シネマティックアニメ",
    keywords: ["cinematic", "anime", "シネマ", "アニメ", "セル", "cel"],
    styleCanon:
      "cinematic anime illustration, clean line art, cel-shaded coloring, controlled warm lighting, high readability silhouettes",
    guardrails:
      "consistent line thickness, painterly but stylized textures, limited cinematic palette, strong key light and rim light",
    negatives: "photorealistic skin pores, live-action photo look, gritty documentary realism, 3D render look",
  },
  {
    id: "retro_manga",
    label: "レトロ漫画",
    keywords: ["retro", "vintage", "manga", "昭和", "レトロ", "漫画", "ヴィンテージ"],
    styleCanon:
      "retro manga illustration, ink-driven linework, halftone texture, reduced vintage palette, print-like contrast",
    guardrails:
      "flat cel blocks with controlled grain, paper-like texture, period-accurate prop design, minimal modern glossy effects",
    negatives: "photorealistic shading, plastic CGI gloss, ultra-modern neon cyberpunk finish",
  },
  {
    id: "watercolor_illustration",
    label: "水彩イラスト",
    keywords: ["watercolor", "水彩", "aquar", "手描き", "にじみ"],
    styleCanon:
      "watercolor illustration, soft brush edges, layered pigment wash, subtle paper grain, hand-painted color transitions",
    guardrails:
      "gentle line accents, semi-transparent color layering, restrained saturation, atmospheric lighting with soft bloom",
    negatives: "hard-edged photorealism, metallic CGI reflections, over-sharpened detail noise",
  },
  {
    id: "graphic_novel",
    label: "グラフィックノベル",
    keywords: ["graphic", "novel", "comic", "コミック", "ノワール", "インク"],
    styleCanon:
      "graphic novel illustration, bold ink contours, dramatic chiaroscuro, poster-like composition, stylized shadows",
    guardrails:
      "high-contrast lighting, intentional negative space, controlled accent colors, illustrated textures over photo textures",
    negatives: "soft photo realism, random watercolor bleed, low-contrast flat snapshot look",
  },
  {
    id: "painterly_fantasy",
    label: "ペインタリー",
    keywords: ["painterly", "油彩", "絵画", "paint", "brush", "ブラシ"],
    styleCanon:
      "painterly digital illustration, visible brush strokes, rich but unified palette, stylized forms, cinematic composition",
    guardrails:
      "brush texture consistency, simplified facial rendering, coherent color grading across scenes, painterly depth cues",
    negatives: "hyper-real photo texture, waxy 3D face rendering, inconsistent mixed media collage look",
  },
];

const DEFAULT_STYLE_PRESET = STYLE_PRESET_LIBRARY[0];

const normalizeStylePresetText = (value?: string | null) => clean(value).toLowerCase();

const resolveStylePreset = (value?: string | null) => {
  const normalized = normalizeStylePresetText(value);
  if (!normalized) return DEFAULT_STYLE_PRESET;
  const direct = STYLE_PRESET_LIBRARY.find((preset) => preset.id === normalized);
  if (direct) return direct;
  const matched = STYLE_PRESET_LIBRARY.find((preset) =>
    preset.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))
  );
  return matched || DEFAULT_STYLE_PRESET;
};

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
const clampSeed = (value: number) => {
  const max = 2147483647;
  if (!Number.isFinite(value)) return 1;
  const normalized = Math.floor(Math.abs(value)) % max;
  return normalized === 0 ? 1 : normalized;
};

export type SeriesImageRequest = {
  prompt: string;
  seed: number;
  width: number;
  height: number;
  purpose: SeriesImagePurpose;
  references: SeriesImageReference[];
  styleReference?: string;
};

export type SeriesImageProvider = "gemini" | "pollinations";

export type SeriesImagePurpose =
  | "cover"
  | "character_portrait"
  | "world_visual"
  | "consistency_probe"
  | "general";

export type SeriesImageReference = {
  url: string;
  role?: "character" | "style" | "world";
  characterId?: string;
  weight?: number;
  note?: string;
};

export type SeriesCoverFocusCharacterInput = {
  name: string;
  role: string;
  visualAnchor?: string;
  focusReason?: string;
};

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

const normalizeSeriesImagePurpose = (value?: string | null): SeriesImagePurpose => {
  const normalized = clean(value).toLowerCase();
  if (normalized === "cover") return "cover";
  if (normalized === "character_portrait" || normalized === "character" || normalized === "portrait") {
    return "character_portrait";
  }
  if (normalized === "world_visual" || normalized === "world") return "world_visual";
  if (normalized === "consistency_probe") return "consistency_probe";
  return "general";
};

const parseSeriesImageReferences = (value: unknown): SeriesImageReference[] => {
  const parsedValue =
    typeof value === "string"
      ? (() => {
          const normalized = clean(value);
          if (!normalized) return [];
          try {
            const parsed = JSON.parse(normalized);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : Array.isArray(value)
        ? value
        : [];

  return parsedValue.reduce<SeriesImageReference[]>((acc, row) => {
    if (!row || typeof row !== "object") return acc;
    const obj = row as Record<string, unknown>;
    const url = clean(typeof obj.url === "string" ? obj.url : "");
    if (!url) return acc;
    const roleCandidate = clean(typeof obj.role === "string" ? obj.role : "").toLowerCase();
    const role =
      roleCandidate === "character" || roleCandidate === "style" || roleCandidate === "world"
        ? (roleCandidate as SeriesImageReference["role"])
        : undefined;
    const weightRaw = Number(obj.weight);
    acc.push({
      url,
      role,
      characterId: clean(typeof obj.characterId === "string" ? obj.characterId : ""),
      note: clean(typeof obj.note === "string" ? obj.note : ""),
      weight: Number.isFinite(weightRaw) ? Math.max(0, Math.min(1, weightRaw)) : undefined,
    });
    return acc;
  }, []).slice(0, 4);
};

export const resolveSeriesImageRequest = (options: {
  prompt?: string | null;
  seedKey?: string | null;
  seed?: number | string | null;
  width?: number | string | null;
  height?: number | string | null;
  purpose?: string | null;
  references?: unknown;
  styleReference?: string | null;
}): SeriesImageRequest | null => {
  const prompt = clean(options.prompt);
  if (!prompt) return null;
  const safePrompt = prompt.slice(0, 420);

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
  const purpose = normalizeSeriesImagePurpose(options.purpose);
  const references = parseSeriesImageReferences(options.references);
  const styleReference = clean(options.styleReference);

  return {
    prompt: safePrompt,
    seed,
    width,
    height,
    purpose,
    references,
    styleReference: styleReference || undefined,
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
  url.searchParams.set("purpose", request.purpose);
  if (request.styleReference) {
    url.searchParams.set("style_ref", request.styleReference);
  }
  if (request.references.length > 0) {
    url.searchParams.set("refs", JSON.stringify(request.references));
  }
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
  url.searchParams.set("purpose", request.purpose);
  if (request.styleReference) {
    url.searchParams.set("style_ref", request.styleReference);
  }
  if (request.references.length > 0) {
    url.searchParams.set("refs", JSON.stringify(request.references));
  }
  return url.toString();
};

export const buildSeriesImageUrl = (options: {
  prompt: string;
  seedKey: string;
  width?: number;
  height?: number;
  purpose?: SeriesImagePurpose;
  references?: SeriesImageReference[];
  styleReference?: string;
}) => {
  const request = resolveSeriesImageRequest({
    prompt: options.prompt,
    seedKey: options.seedKey,
    width: options.width,
    height: options.height,
    purpose: options.purpose,
    references: options.references,
    styleReference: options.styleReference,
  });
  if (!request) return "";

  const imageDeliveryMode = getImageDeliveryMode();
  const forceProxyByRequest =
    request.references.length > 0 ||
    Boolean(request.styleReference) ||
    request.purpose === "cover" ||
    request.purpose === "character_portrait" ||
    request.purpose === "world_visual";
  const useMastraProxy =
    forceProxyByRequest ||
    imageDeliveryMode === "proxy" ||
    imageDeliveryMode === "mastra" ||
    resolveSeriesImageProvider() === "gemini";
  if (useMastraProxy) {
    const proxyUrl = buildSeriesImageProxyUrl(request);
    if (proxyUrl) return proxyUrl;
  }

  return buildSeriesImageProviderUrl(request);
};

export const buildSeriesVisualStyleGuide = (input: {
  seriesTitle: string;
  genre: string;
  tone: string;
  setting?: string;
  dominantColors?: string[];
  recurringMotifs?: string[];
  stylePreset?: string;
  styleDirection?: string;
}) => {
  const preset = resolveStylePreset(input.stylePreset);
  const styleDirection = clean(input.styleDirection);
  const palette = dedupeStrings((input.dominantColors || []).slice(0, 3));
  const motifs = dedupeStrings((input.recurringMotifs || []).slice(0, 2));
  const parts = [
    `style preset: ${preset.label}`,
    `style canon: ${preset.styleCanon}`,
    styleDirection ? `user style direction: ${styleDirection}` : "",
    `style guardrails: ${preset.guardrails}`,
    `negative style constraints: ${preset.negatives}`,
    "single cohesive illustration art direction shared across cover, character portraits, and world visuals",
    clean(input.genre) ? `genre mood: ${clean(input.genre)}` : "",
    clean(input.tone) ? `emotional tone: ${clean(input.tone)}` : "",
    clean(input.setting) ? `setting texture: ${clean(input.setting)}` : "",
    palette.length > 0 ? `palette anchors: ${palette.join(" / ")}` : "",
    motifs.length > 0 ? `visual motifs: ${motifs.join(" / ")}` : "",
    clean(input.seriesTitle) ? `for series ${clean(input.seriesTitle)}` : "",
  ]
    .map((item) => clean(item))
    .filter(Boolean);
  return parts.join(", ");
};

export const buildCoverImagePrompt = (input: {
  title: string;
  genre: string;
  tone: string;
  premise: string;
  setting: string;
  styleGuide?: string;
  dominantColors?: string[];
  recurringMotifs?: string[];
  focusCharacters?: SeriesCoverFocusCharacterInput[];
  additionalDirection?: string;
  excludeCharacters?: boolean;
}) => {
  const title = clean(input.title);
  const genre = clean(input.genre);
  const tone = clean(input.tone);
  const premise = clean(input.premise);
  const setting = clean(input.setting);
  const styleGuide =
    clean(input.styleGuide) ||
    buildSeriesVisualStyleGuide({
      seriesTitle: title,
      genre,
      tone,
      setting,
      dominantColors: input.dominantColors,
      recurringMotifs: input.recurringMotifs,
    });
  const focusCharacters = (input.focusCharacters || [])
    .slice(0, 3)
    .map((character) => {
      const name = clean(character.name);
      const role = clean(character.role);
      const visualAnchor = clean(character.visualAnchor);
      const focusReason = clean(character.focusReason);
      const pieces = [
        name || "unknown",
        role ? `role: ${role}` : "",
        visualAnchor ? `visual: ${visualAnchor}` : "",
        focusReason ? `focus: ${focusReason}` : "",
      ]
        .map((piece) => clean(piece))
        .filter(Boolean);
      return pieces.join(" / ");
    })
    .filter(Boolean);
  const focusCount = focusCharacters.length;
  const excludeCharacters = Boolean(input.excludeCharacters);

  const parts = [
    styleGuide,
    "hard constraint: preserve exact same style canon as character portraits and world visuals",
    "hard constraint: do not drift into photorealistic or mixed-media styles",
    excludeCharacters ? "world concept poster composition" : "novel cover composition",
    excludeCharacters ? "hard constraint: do not depict any person or character" : "",
    excludeCharacters ? "hard constraint: no face, no body, no human silhouette, no crowd" : "",
    excludeCharacters
      ? "hard constraint: express the world through architecture, props, weather, lighting, and atmosphere"
      : focusCount > 0
        ? "show clear key characters that match the generated character roster"
        : "",
    !excludeCharacters && focusCount > 0
      ? "hard constraint: every key character must be the exact same person as the reference portraits"
      : "",
    !excludeCharacters && focusCount > 0
      ? "hard constraint: preserve face identity, hair shape/color, and signature outfit key items"
      : "",
    !excludeCharacters && focusCount > 0 ? "hard constraint: do not introduce unrelated central characters" : "",
    !excludeCharacters && focusCount > 0
      ? `hard constraint: visibly include all ${focusCount} key characters in the cover composition`
      : "",
    `${title}`,
    `${genre}`,
    `${tone}`,
    setting ? `set in ${setting}` : "",
    premise ? `theme: ${premise}` : "",
    focusCharacters.length > 0 ? `focus characters: ${focusCharacters.join(" | ")}` : "",
    clean(input.additionalDirection),
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
  anchorHair?: string;
  anchorSilhouette?: string;
  anchorOutfitKeyItem?: string;
  styleGuide?: string;
}) => {
  const styleGuide =
    clean(input.styleGuide) ||
    buildSeriesVisualStyleGuide({
      seriesTitle: input.seriesTitle,
      genre: input.genre,
      tone: input.tone,
      setting: input.setting,
      dominantColors: [input.dominantColor || ""],
    });
  const parts = [
    clean(input.name),
    clean(input.role),
    clean(input.anchorHair) ? `hair anchor: ${clean(input.anchorHair)}` : "",
    clean(input.anchorSilhouette) ? `silhouette anchor: ${clean(input.anchorSilhouette)}` : "",
    clean(input.anchorOutfitKeyItem) ? `outfit anchor item: ${clean(input.anchorOutfitKeyItem)}` : "",
    clean(input.dominantColor) ? `color theme: ${clean(input.dominantColor)}` : "",
    clean(input.distinguishingFeature) ? `notable feature: ${clean(input.distinguishingFeature)}` : "",
    styleGuide,
    "character portrait, waist-up",
    "must match cover and world visual style bible",
    "hard constraint: do not switch style family (no photorealistic drift, no random mixed media)",
    "identity lock: keep the same face identity and anchor traits whenever this character appears again",
    "hard constraint: this person must be visually distinct from every other cast member",
    clean(input.appearance),
    clean(input.bodyType) ? `build: ${clean(input.bodyType)}` : "",
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
  styleGuide?: string;
}) => {
  const styleGuide =
    clean(input.styleGuide) ||
    buildSeriesVisualStyleGuide({
      seriesTitle: input.seriesTitle,
      genre: input.genre,
      tone: input.tone,
      setting: input.setting,
    });
  const parts = [
    styleGuide,
    "environment concept art, street-level perspective, walkable city district",
    "same style bible as cover and character portraits",
    "hard constraint: maintain the same rendering family, brush treatment, and color grading",
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
