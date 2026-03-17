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

type RenderingBibleProfile = {
  mediumFamily: string;
  lineTreatment: string;
  shadingTreatment: string;
  textureTreatment: string;
  realismLevel: string;
  lightingRule: string;
  paletteRule: string;
  cameraRule: string;
  eraRealism: string;
  forbiddenRenderingDrifts: string[];
};

const RENDERING_BIBLE_LIBRARY: Record<string, RenderingBibleProfile> = {
  cinematic_anime: {
    mediumFamily: "cinematic anime illustration",
    lineTreatment: "clean controlled linework, stable thickness, readable contour hierarchy",
    shadingTreatment: "cel-shaded base with restrained painterly transitions",
    textureTreatment: "stylized texture accents only, avoid gritty photo noise",
    realismLevel: "grounded stylization (human-scale, physically plausible materials)",
    lightingRule: "single key-light logic with soft rim support, avoid random neon glow",
    paletteRule: "limited controlled palette with one warm/cool anchor pair",
    cameraRule: "human-eye lens feeling, clear focal hierarchy, no extreme distortion",
    eraRealism: "contemporary or historically plausible environment rendering",
    forbiddenRenderingDrifts: [
      "photorealistic skin pores",
      "mixed-media collage",
      "3D CGI waxy rendering",
      "speculative sci-fi glow language",
    ],
  },
  retro_manga: {
    mediumFamily: "retro manga illustration",
    lineTreatment: "ink-driven contour emphasis with print-like readability",
    shadingTreatment: "halftone-led tonal blocks, limited gradient blending",
    textureTreatment: "paper-like grain and print texture, no glossy plastic surfaces",
    realismLevel: "grounded illustration with period-consistent material behavior",
    lightingRule: "clear contrast logic, restrained bloom, no synthetic neon haze",
    paletteRule: "reduced vintage palette with stable accent colors",
    cameraRule: "poster-readable framing, human-scale perspective",
    eraRealism: "period-plausible signage and props",
    forbiddenRenderingDrifts: [
      "hyperreal modern rendering",
      "cyberpunk neon skyline",
      "futuristic interface overlays",
      "fantasy monument drift",
    ],
  },
  watercolor_illustration: {
    mediumFamily: "watercolor illustration",
    lineTreatment: "light line accents with soft edge control",
    shadingTreatment: "layered wash shading with smooth tonal transitions",
    textureTreatment: "paper-grain and pigment bleed in controlled amount",
    realismLevel: "grounded soft stylization",
    lightingRule: "atmospheric natural light, avoid artificial specular highlights",
    paletteRule: "muted cohesive palette with restrained saturation spikes",
    cameraRule: "human-scale framing and readable object silhouettes",
    eraRealism: "plausible contemporary/historical environment materials",
    forbiddenRenderingDrifts: [
      "hard-edged photorealism",
      "glossy CGI reflections",
      "sci-fi hologram effects",
      "impossible geometric structures",
    ],
  },
  graphic_novel: {
    mediumFamily: "graphic novel illustration",
    lineTreatment: "bold contour hierarchy with intentional negative space",
    shadingTreatment: "high-contrast shadow design, controlled halftone or ink fills",
    textureTreatment: "illustrated ink texture over photo texture",
    realismLevel: "grounded dramatic stylization",
    lightingRule: "directional contrast logic, no arbitrary glow",
    paletteRule: "low-noise palette with clear accent channel",
    cameraRule: "narrative framing with strong focal priority",
    eraRealism: "human-scale environment plausibility",
    forbiddenRenderingDrifts: [
      "soft photo snapshot look",
      "fantasy ruin aesthetics",
      "futuristic UI overlays",
      "speculative technology motifs",
    ],
  },
  painterly_fantasy: {
    mediumFamily: "painterly digital illustration",
    lineTreatment: "brush-defined contour accents with clear silhouette control",
    shadingTreatment: "painterly massing with coherent value structure",
    textureTreatment: "visible brush texture with consistent material logic",
    realismLevel: "grounded painterly realism (not fantasy spectacle)",
    lightingRule: "coherent naturalistic light behavior across materials",
    paletteRule: "rich but unified palette with controlled contrast anchors",
    cameraRule: "cinematic but human-scale composition",
    eraRealism: "contemporary/historically plausible architecture and props",
    forbiddenRenderingDrifts: [
      "fantasy ornament overload",
      "sci-fi skyline motifs",
      "holographic interfaces",
      "impossible architecture",
    ],
  },
};

type NarrativeVisualBrief = {
  caseCore: string;
  truthNature: string;
  environmentLayer: string;
  clueObjects: string[];
  humanTraces: string[];
  materialAnchors: string[];
  timeWindow: string;
  weatherWindow: string;
  coverCompositionFamily: string;
  recurringVisualMotifs: string[];
  hardForbiddenMotifs: string[];
};

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

const deriveCoverCompositionFamily = (source: string) => {
  const normalized = clean(source);
  if (/(記録|台帳|履歴|照合|アーカイブ|帳票|文書|改ざん)/.test(normalized)) {
    return "archive / record-led cover";
  }
  if (/(導線|地理|経路|移動|視点差|追跡|パターン)/.test(normalized)) {
    return "route-fragment collage";
  }
  if (/(現場|痕跡|荒ら|攪乱|違和感|直後)/.test(normalized)) {
    return "disturbance at scene";
  }
  if (/(景観|場所|生活圏|街区|地区|港|温泉|郊外|集落)/.test(normalized)) {
    return "place-first mystery";
  }
  return "clue tableau";
};

const deriveClueObjects = (source: string) => {
  const normalized = clean(source);
  const pool = dedupeStrings([
    /(失踪|行方|消失)/.test(normalized) ? "updated notice board with inconsistent timestamps" : "",
    /(盗難|すり替え|欠落)/.test(normalized) ? "storage log with overwritten item entry" : "",
    /(証言|矛盾|食い違い)/.test(normalized) ? "conflicting handwritten statements" : "",
    /(記録|改ざん|履歴|台帳)/.test(normalized) ? "tampered archive ledger" : "",
    /(地理|導線|経路|追跡)/.test(normalized) ? "annotated local route map with unusual detour marks" : "",
    "local notice print with subtle correction marks",
    "ticket stub or receipt with mismatched sequence",
    "public timetable snapshot with a missing line",
  ]);
  return pool.slice(0, 5);
};

const deriveHumanTraces = (source: string) => {
  const normalized = clean(source);
  const pool = dedupeStrings([
    /(追跡|導線|移動)/.test(normalized) ? "recently displaced wayfinding marker" : "",
    /(記録|改ざん|履歴)/.test(normalized) ? "fresh fingerprint smudge near public record surface" : "",
    /(失踪|消失)/.test(normalized) ? "abandoned personal item left in ordinary public space" : "",
    "wet footprint or dirt transfer indicating recent movement",
    "half-open locker/cabinet with hurried handling marks",
    "recently removed tape or pin marks on a community board",
  ]);
  return pool.slice(0, 4);
};

const deriveMaterialAnchors = (source: string) => {
  const normalized = clean(source);
  const pool = dedupeStrings([
    /(港|海|湾|離島|島|潮)/.test(normalized) ? "salt-weathered metal and rope fibers" : "",
    /(温泉|湯|湿)/.test(normalized) ? "damp wood grain, stone moisture, paper curl from humidity" : "",
    /(山|高原|渓谷|農村)/.test(normalized) ? "weathered timber, soil dust, matte painted signboards" : "",
    /(都市|再開発|駅前|高架)/.test(normalized) ? "brushed steel rails, acrylic signage, concrete wear" : "",
    "real public-signage materials and aging patterns",
    "human-scale architectural surfaces with plausible wear",
  ]);
  return pool.slice(0, 4);
};

const deriveTimeWindow = (tone: string) => {
  const normalized = clean(tone);
  if (/(静かな不穏|不穏|緊張|ノワール|冷)/.test(normalized)) return "late afternoon to early night";
  if (/(温|余韻|郷愁|穏)/.test(normalized)) return "late morning to dusk";
  return "daylight to twilight";
};

const deriveWeatherWindow = (tone: string) => {
  const normalized = clean(tone);
  if (/(不穏|緊張|乾)/.test(normalized)) return "overcast, light rain, or wind traces";
  if (/(温|余韻|郷愁)/.test(normalized)) return "clear to thin-cloud conditions";
  return "realistically variable local weather";
};

const DEFAULT_FORBIDDEN_SCI_FI_MOTIFS = [
  "futuristic architecture",
  "holograms",
  "glowing UI overlays",
  "spacecraft",
  "mecha",
  "cyberpunk skyline",
  "fantasy ruins",
  "impossible geometry",
  "speculative technology objects",
];

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
  const purpose = normalizeSeriesImagePurpose(options.purpose);
  const promptMaxLength = purpose === "character_portrait" ? 260 : 420;
  const safePrompt = prompt.slice(0, promptMaxLength);

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
  const references = parseSeriesImageReferences(options.references);
  const styleReference = clean(options.styleReference).slice(0, 120);

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
  const renderingProfile = RENDERING_BIBLE_LIBRARY[preset.id] || RENDERING_BIBLE_LIBRARY[DEFAULT_STYLE_PRESET.id];
  const styleDirection = clean(input.styleDirection);
  const palette = dedupeStrings((input.dominantColors || []).slice(0, 3));
  const motifs = dedupeStrings((input.recurringMotifs || []).slice(0, 2));
  const parts = [
    `style preset: ${preset.label}`,
    `style canon: ${preset.styleCanon}`,
    styleDirection ? `user style direction: ${styleDirection}` : "",
    `render medium: ${renderingProfile.mediumFamily}`,
    `line rule: ${renderingProfile.lineTreatment}`,
    `shading rule: ${renderingProfile.shadingTreatment}`,
    `texture rule: ${renderingProfile.textureTreatment}`,
    `realism rule: ${renderingProfile.realismLevel}`,
    `lighting rule: ${renderingProfile.lightingRule}`,
    `palette rule: ${renderingProfile.paletteRule}`,
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

export const buildSeriesRenderingBible = (input: {
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
  const renderingProfile = RENDERING_BIBLE_LIBRARY[preset.id] || RENDERING_BIBLE_LIBRARY[DEFAULT_STYLE_PRESET.id];
  const styleDirection = clean(input.styleDirection);
  const palette = dedupeStrings((input.dominantColors || []).slice(0, 3));
  const motifs = dedupeStrings((input.recurringMotifs || []).slice(0, 2));
  const parts = [
    "rendering bible:",
    `style preset: ${preset.label}`,
    `style canon: ${preset.styleCanon}`,
    `medium_family: ${renderingProfile.mediumFamily}`,
    `line_treatment: ${renderingProfile.lineTreatment}`,
    `shading_treatment: ${renderingProfile.shadingTreatment}`,
    `texture_treatment: ${renderingProfile.textureTreatment}`,
    `realism_level: ${renderingProfile.realismLevel}`,
    `lighting_rule: ${renderingProfile.lightingRule}`,
    `palette_rule: ${renderingProfile.paletteRule}`,
    `camera_lens_feeling: ${renderingProfile.cameraRule}`,
    `era_realism: ${renderingProfile.eraRealism}`,
    styleDirection ? `user style direction: ${styleDirection}` : "",
    `style guardrails: ${preset.guardrails}`,
    `forbidden_rendering_drifts: ${dedupeStrings([...renderingProfile.forbiddenRenderingDrifts, preset.negatives]).join(" / ")}`,
    palette.length > 0 ? `palette anchors: ${palette.join(" / ")}` : "",
    motifs.length > 0 ? `visual motifs: ${motifs.join(" / ")}` : "",
    clean(input.genre) ? `genre mood: ${clean(input.genre)}` : "",
    clean(input.tone) ? `emotional tone: ${clean(input.tone)}` : "",
    clean(input.setting) ? `setting texture: ${clean(input.setting)}` : "",
    clean(input.seriesTitle) ? `for series ${clean(input.seriesTitle)}` : "",
  ]
    .map((item) => clean(item))
    .filter(Boolean);
  return parts.join(", ");
};

export const buildSeriesNarrativeVisualBrief = (input: {
  premise?: string;
  setting?: string;
  tone?: string;
  caseCore?: string;
  truthNature?: string;
  environmentLayer?: string;
  recurringMotifs?: string[];
  clueObjects?: string[];
  humanTraces?: string[];
  materialAnchors?: string[];
  timeWindow?: string;
  weatherWindow?: string;
  coverCompositionFamily?: string;
  hardForbiddenMotifs?: string[];
}) => {
  const caseCore = clean(input.caseCore) || "small-scale anomalies and contradictions connected across episodes";
  const truthNature = clean(input.truthNature) || "grounded human-causal truth behind apparent inconsistencies";
  const environmentLayer = clean(input.environmentLayer) || clean(input.setting) || "real-world human-scale local environment";
  const clueObjects = dedupeStrings(input.clueObjects || deriveClueObjects(`${caseCore} ${truthNature} ${environmentLayer}`)).slice(0, 5);
  const humanTraces = dedupeStrings(input.humanTraces || deriveHumanTraces(`${caseCore} ${truthNature} ${environmentLayer}`)).slice(0, 4);
  const materialAnchors = dedupeStrings(input.materialAnchors || deriveMaterialAnchors(environmentLayer)).slice(0, 4);
  const timeWindow = clean(input.timeWindow) || deriveTimeWindow(clean(input.tone));
  const weatherWindow = clean(input.weatherWindow) || deriveWeatherWindow(clean(input.tone));
  const coverCompositionFamily =
    clean(input.coverCompositionFamily) ||
    deriveCoverCompositionFamily(`${caseCore} ${truthNature} ${clean(input.premise)}`);
  const recurringVisualMotifs = dedupeStrings(input.recurringMotifs || []).slice(0, 4);
  const hardForbiddenMotifs = dedupeStrings(input.hardForbiddenMotifs || DEFAULT_FORBIDDEN_SCI_FI_MOTIFS).slice(0, 12);

  const parts = [
    "narrative visual brief:",
    `case_core: ${caseCore}`,
    `truth_nature: ${truthNature}`,
    `environment_layer: ${environmentLayer}`,
    `clue_objects: ${clueObjects.join(" / ")}`,
    `human_traces: ${humanTraces.join(" / ")}`,
    `material_anchors: ${materialAnchors.join(" / ")}`,
    `time_window: ${timeWindow}`,
    `weather_window: ${weatherWindow}`,
    `cover_composition_family: ${coverCompositionFamily}`,
    recurringVisualMotifs.length > 0 ? `recurring_visual_motifs: ${recurringVisualMotifs.join(" / ")}` : "",
    `hard_forbidden_motifs: ${hardForbiddenMotifs.join(" / ")}`,
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
  renderingBible?: string;
  narrativeVisualBrief?: string;
  caseCore?: string;
  truthNature?: string;
  environmentLayer?: string;
  clueObjects?: string[];
  humanTraces?: string[];
  materialAnchors?: string[];
  timeWindow?: string;
  weatherWindow?: string;
  coverCompositionFamily?: string;
  hardForbiddenMotifs?: string[];
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
  const renderingBible =
    clean(input.renderingBible) ||
    buildSeriesRenderingBible({
      seriesTitle: title,
      genre,
      tone,
      setting,
      dominantColors: input.dominantColors,
      recurringMotifs: input.recurringMotifs,
    });
  const narrativeVisualBrief =
    clean(input.narrativeVisualBrief) ||
    buildSeriesNarrativeVisualBrief({
      premise,
      setting,
      tone,
      caseCore: input.caseCore,
      truthNature: input.truthNature,
      environmentLayer: input.environmentLayer,
      recurringMotifs: input.recurringMotifs,
      clueObjects: input.clueObjects,
      humanTraces: input.humanTraces,
      materialAnchors: input.materialAnchors,
      timeWindow: input.timeWindow,
      weatherWindow: input.weatherWindow,
      coverCompositionFamily: input.coverCompositionFamily,
      hardForbiddenMotifs: input.hardForbiddenMotifs,
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
  const briefSource = `${clean(input.caseCore)} ${clean(input.truthNature)} ${clean(input.environmentLayer)} ${premise}`;
  const clueObjects = dedupeStrings(input.clueObjects || deriveClueObjects(briefSource)).slice(0, 5);
  const humanTraces = dedupeStrings(input.humanTraces || deriveHumanTraces(briefSource)).slice(0, 3);
  const materialAnchors = dedupeStrings(input.materialAnchors || deriveMaterialAnchors(clean(input.environmentLayer) || setting)).slice(0, 4);
  const coverCompositionFamily =
    clean(input.coverCompositionFamily) || deriveCoverCompositionFamily(briefSource);
  const timeWindow = clean(input.timeWindow) || deriveTimeWindow(tone);
  const weatherWindow = clean(input.weatherWindow) || deriveWeatherWindow(tone);
  const hardForbiddenMotifs = dedupeStrings(input.hardForbiddenMotifs || DEFAULT_FORBIDDEN_SCI_FI_MOTIFS).slice(0, 12);
  const caseCore = clean(input.caseCore) || "small-scale anomalies and contradictions";
  const truthNature = clean(input.truthNature) || "grounded human-causal truth";
  const environmentLayer = clean(input.environmentLayer) || setting || "real-world local environment";

  const parts = [
    renderingBible,
    narrativeVisualBrief,
    "cover purpose: communicate the core mystery, place identity, and emotional promise of this series at a glance",
    "hard constraint: grounded real-world mystery illustration, not sci-fi concept art, not fantasy environment art, not cinematic key visual drift",
    excludeCharacters ? "hard constraint: do not depict any person or character" : "",
    excludeCharacters ? "hard constraint: no face, no body, no human silhouette, no crowd" : "",
    excludeCharacters
      ? "hard constraint: show human presence only through traces, evidence, absence, and recently disturbed surroundings"
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
    `composition family: ${coverCompositionFamily}`,
    `primary environment: ${environmentLayer}`,
    `case core: ${caseCore}`,
    `truth texture: ${truthNature}`,
    `must show 3 to 5 tangible clue objects tied to the case: ${clueObjects.join(" / ")}`,
    `must show 2 to 3 signs of recent human activity or disruption: ${humanTraces.join(" / ")}`,
    `material anchors: ${materialAnchors.join(" / ")}`,
    `time / weather window: ${timeWindow}, ${weatherWindow}`,
    `${title}`,
    `${genre}`,
    `${tone}`,
    setting ? `set in ${setting}` : "",
    premise ? `theme: ${premise}` : "",
    (input.recurringMotifs || []).length > 0
      ? `visual motifs: ${dedupeStrings(input.recurringMotifs || []).join(" / ")}`
      : "",
    focusCharacters.length > 0 ? `focus characters: ${focusCharacters.join(" | ")}` : "",
    `hard negative constraints: ${hardForbiddenMotifs.join(", ")}`,
    "composition rule: readable mystery cover, strong focal hierarchy, clean object silhouettes, clear place identity, unresolved tension",
    clean(input.additionalDirection),
    "no text, no watermark",
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
  caseCore?: string;
  environmentLayer?: string;
  investigationFunction?: string;
  relationshipTemperature?: string;
  signatureProp?: string;
  environmentResidue?: string;
  dominantColor?: string;
  bodyType?: string;
  distinguishingFeature?: string;
  anchorHair?: string;
  anchorSilhouette?: string;
  anchorOutfitKeyItem?: string;
  styleGuide?: string;
  renderingBible?: string;
  narrativeVisualBrief?: string;
}) => {
  const renderingBible =
    clean(input.renderingBible) ||
    buildSeriesRenderingBible({
      seriesTitle: input.seriesTitle,
      genre: input.genre,
      tone: input.tone,
      setting: input.setting,
      dominantColors: [input.dominantColor || ""],
    });
  const narrativeVisualBrief =
    clean(input.narrativeVisualBrief) ||
    buildSeriesNarrativeVisualBrief({
      premise: "",
      setting: input.setting,
      tone: input.tone,
      caseCore: input.caseCore,
      environmentLayer: input.environmentLayer,
    });
  const investigationFunction = clean(input.investigationFunction) || "observation and contradiction extraction";
  const relationshipTemperature = clean(input.relationshipTemperature) || "controlled tension with cooperative undertone";
  const signatureProp = clean(input.signatureProp) || (() => {
    if (/(記録|台帳|照合|資料)/.test(investigationFunction)) return "annotated folder and clipped note stack";
    if (/(聞き込み|対話|人心)/.test(investigationFunction)) return "well-used field notebook and voice memo device";
    if (/(地理|導線|追跡)/.test(investigationFunction)) return "folded local map with route annotations";
    if (/(矛盾|嘘|検知)/.test(investigationFunction)) return "marked timeline sheet with discrepancy tags";
    return "field notebook with case markers";
  })();
  const environmentResidue = clean(input.environmentResidue) || (() => {
    const source = clean(input.environmentLayer) || clean(input.setting);
    if (/(港|海|湾|離島|島)/.test(source)) return "salt haze, wind-worn fabric edges, metal corrosion traces";
    if (/(温泉|湯|湿)/.test(source)) return "moist air residue, wood grain swelling, soft mineral stains";
    if (/(山|農村|郊外|集落)/.test(source)) return "dust on footwear edges, matte signage wear, natural fiber texture";
    return "subtle wear from daily public movement and local material aging";
  })();
  const caseCore = clean(input.caseCore) || "small-scale anomaly linked to larger unresolved truth";
  const environmentLayer = clean(input.environmentLayer) || clean(input.setting) || "real-world local environment";
  const parts = [
    renderingBible,
    narrativeVisualBrief,
    "character purpose: portrait for a grounded mystery series; this character must feel like they belong to the exact same world as the cover art",
    "identity lock: keep the same face identity and anchor traits whenever this character appears again",
    "hard constraint: must match the exact same rendering family, texture logic, lighting logic, and palette logic as the cover art",
    "hard constraint: no photorealistic drift, no mixed media drift, no sci-fi costume drift, no fantasy accessory drift",
    clean(input.name),
    clean(input.role),
    `investigation function: ${investigationFunction}`,
    `relationship temperature: ${relationshipTemperature}`,
    `signature prop: ${signatureProp}`,
    `environment residue: ${environmentResidue}`,
    clean(input.anchorHair) ? `hair anchor: ${clean(input.anchorHair)}` : "",
    clean(input.anchorSilhouette) ? `silhouette anchor: ${clean(input.anchorSilhouette)}` : "",
    clean(input.anchorOutfitKeyItem) ? `outfit anchor item: ${clean(input.anchorOutfitKeyItem)}` : "",
    clean(input.dominantColor) ? `color theme: ${clean(input.dominantColor)}` : "",
    clean(input.distinguishingFeature) ? `notable feature: ${clean(input.distinguishingFeature)}` : "",
    clean(input.appearance),
    clean(input.bodyType) ? `build: ${clean(input.bodyType)}` : "",
    clean(input.personality),
    `set within the material reality of: ${environmentLayer}`,
    clean(input.setting) ? `background hint: ${clean(input.setting)}` : "",
    clean(input.seriesTitle) ? `from series: ${clean(input.seriesTitle)}` : "",
    `case core: ${caseCore}`,
    clean(input.tone) ? `tone: ${clean(input.tone)}` : "",
    "portrait framing: waist-up or mid-shot, three-quarter angle preferred when needed for silhouette clarity",
    "composition rule: clean portrait with one clear role-defining prop and one subtle world clue",
    "negative constraints: no idol poster feel, no generic anime hero styling, no sci-fi accessories, no cyberpunk costume logic, no fantasy ornament overload, no interchangeable cast design",
    "no text, no watermark",
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
    "environment concept art, human-scale real-world location perspective",
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
