import Constants from "expo-constants";
import { NativeModules } from "react-native";

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();
const WALKABLE_WORLD_FALLBACK = "現代日本の徒歩で巡れる街区（駅前・商店街・公園・川沿い）";
const INCOMPATIBLE_WORLD_PATTERN =
  /(空中都市|天空都市|浮遊都市|雲上都市|宇宙|月面|火星|宇宙船|海底都市|閉鎖施設|オフィス内(?:だけ|のみ)?|屋内(?:だけ|のみ)?|建物内(?:だけ|のみ)?|社内(?:だけ|のみ)?)/i;
const INCOMPATIBLE_SPOT_PATTERN =
  /(空中都市|天空都市|浮遊都市|宇宙|海底|閉鎖施設|オフィス内(?:だけ|のみ)?|屋内(?:だけ|のみ)?|建物内(?:だけ|のみ)?|社内(?:だけ|のみ)?)/i;
const WALK_ROUTE_PATTERN = /(徒歩|街歩き|周遊|散策)/;
const MANDATORY_WALK_RULES = [
  "各エピソードは徒歩で2〜4スポットを巡る街歩き導線を維持する。",
  "単一屋内拠点だけで完結させず、街路・公共空間での移動を必ず入れる。",
  "空中都市・宇宙・海底・閉鎖施設内のみなど街歩き不能な舞台へ逸脱しない。",
];

const dedupeStrings = (values: string[]) => {
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

const ensureWalkableSetting = (value?: string | null) => {
  const normalized = clean(value);
  if (!normalized) return WALKABLE_WORLD_FALLBACK;
  if (INCOMPATIBLE_WORLD_PATTERN.test(normalized)) return WALKABLE_WORLD_FALLBACK;
  return normalized;
};

const ensureWalkRouteStyle = (value?: string | null) => {
  const normalized = clean(value);
  if (normalized && WALK_ROUTE_PATTERN.test(normalized)) return normalized;
  return "徒歩中心の周遊";
};

const ensureWalkSuggestedSpots = (spots: string[], settingHint?: string) => {
  const normalized = dedupeStrings(spots).filter((spot) => !INCOMPATIBLE_SPOT_PATTERN.test(spot));
  if (normalized.length >= 2) return normalized.slice(0, 6);
  const fallback = dedupeStrings([settingHint || "", "駅前広場", "商店街"]).filter(
    (spot) => !INCOMPATIBLE_SPOT_PATTERN.test(spot)
  );
  const merged = dedupeStrings([...normalized, ...fallback]);
  if (merged.length >= 2) return merged.slice(0, 6);
  return ["駅前広場", "商店街"];
};

const SCENE_ROLES = ["起", "承", "転", "結"] as const;
const isSceneRole = (value: string): value is (typeof SCENE_ROLES)[number] =>
  (SCENE_ROLES as readonly string[]).includes(value);

const sceneRoleForIndex = (index: number, count: number): "起" | "承" | "転" | "結" => {
  if (count <= 2) return index === 0 ? "起" : "結";
  if (index === 0) return "起";
  if (index === count - 1) return "結";
  return index === 1 ? "承" : "転";
};

const normalizeSpotRequirements = (
  raw: unknown,
  settingHint?: string
): GeneratedSeriesFirstEpisodeSeed["spotRequirements"] => {
  const rows = Array.isArray(raw) ? raw : [];
  const normalized = rows
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const spotRole = clean(typeof row.spot_role === "string" ? row.spot_role : "");
      if (!spotRole) return null;
      const sceneRoleRaw = clean(typeof row.scene_role === "string" ? row.scene_role : "");
      return {
        requirementId: clean(typeof row.requirement_id === "string" ? row.requirement_id : "") || `req_${index + 1}`,
        sceneRole: isSceneRole(sceneRoleRaw) ? sceneRoleRaw : sceneRoleForIndex(index, Math.max(rows.length, 2)),
        spotRole,
        requiredAttributes: normalizeStringArray(row.required_attributes),
        visitConstraints: normalizeStringArray(row.visit_constraints),
        tourismValueType: clean(typeof row.tourism_value_type === "string" ? row.tourism_value_type : "") || "地域体験",
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (normalized.length >= 2) return normalized.slice(0, 4);
  return [
    {
      requirementId: "req_1",
      sceneRole: "起",
      spotRole: "導入用の静かな公共スポット",
      requiredAttributes: ["公共アクセス可能", `${clean(settingHint) || "地域"}らしさが分かる`],
      visitConstraints: ["単独屋内完結を避ける"],
      tourismValueType: "地域導入",
    },
    {
      requirementId: "req_2",
      sceneRole: "承",
      spotRole: "関係進展が起こる回遊拠点",
      requiredAttributes: ["会話しやすい", "徒歩導線で接続可能"],
      visitConstraints: ["移動負荷を抑える"],
      tourismValueType: "文化体験",
    },
    {
      requirementId: "req_3",
      sceneRole: "結",
      spotRole: "余韻に向く見晴らし地点",
      requiredAttributes: ["景観価値", "次話フック設置しやすい"],
      visitConstraints: ["公共アクセスで離脱可能"],
      tourismValueType: "景観",
    },
  ];
};

const deriveSuggestedSpotsFromRequirements = (
  requirements: GeneratedSeriesFirstEpisodeSeed["spotRequirements"]
) =>
  requirements
    .map((requirement) => clean(requirement.spotRole))
    .filter(Boolean)
    .slice(0, 4);

const ensureWalkAiRules = (value?: string | null) => {
  const rawLines = clean(value)
    .split(/\n+/)
    .map((line) => clean(line))
    .filter(Boolean);
  const withPrefix = rawLines.map((line) => (line.startsWith("-") ? line : `- ${line}`));
  const mandatory = MANDATORY_WALK_RULES.map((rule) => `- ${rule}`);
  return dedupeStrings([...withPrefix, ...mandatory]).join("\n");
};

export type SeriesInterviewInput = {
  genreWorld: string;
  desiredEmotion: string;
  companionPreference: string;
  continuationTrigger: string;
  avoidExpressions: string;
  additionalNotes?: string;
  visualStylePreset?: string;
  visualStyleNotes?: string;
};

export type GeneratedSeriesCharacterPersonality = {
  summary: string;
  bigFive?: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
  };
  enneagramType?: number;
  coreFear?: string;
  coreDesire?: string;
  speechPattern?: string;
  catchphrase?: string;
  quirks?: string[];
};

export type GeneratedSeriesCharacterRelationship = {
  targetId: string;
  type: string;
  description: string;
  tensionLevel?: number;
};

export type GeneratedSeriesCharacterVisualDesign = {
  dominantColor: string;
  bodyType: string;
  silhouetteKeyword: string;
  distinguishingFeature: string;
};

export type GeneratedSeriesCharacterIdentityAnchorTokens = {
  hair: string;
  silhouette: string;
  dominantColor: string;
  outfitKeyItem: string;
  distinguishingFeature: string;
};

export type GeneratedSeriesCharacter = {
  id?: string;
  name: string;
  role: string;
  tier?: "primary" | "secondary";
  mustAppear?: boolean;
  archetype?: string;
  goal?: string;
  drive?: string;
  dilemma?: string;
  arcStart?: string;
  arcMidpoint?: string;
  arcEnd?: string;
  arcTrigger?: string;
  backstory?: string;
  personality?: string;
  appearance?: string;
  visualDesign?: GeneratedSeriesCharacterVisualDesign;
  isKeyPerson?: boolean;
  identityAnchorTokens?: GeneratedSeriesCharacterIdentityAnchorTokens;
  portraitPrompt?: string;
  portraitImageUrl?: string;
  secrets?: string[];
  relationshipHooks?: string[];
  relationships?: GeneratedSeriesCharacterRelationship[];
  // Flattened personality extensions
  bigFive?: GeneratedSeriesCharacterPersonality['bigFive'];
  enneagramType?: number;
  coreFear?: string;
  coreDesire?: string;
  speechPattern?: string;
  catchphrase?: string;
  quirks?: string[];
};

export type GeneratedSeriesEpisodeBlueprint = {
  episodeNo: number;
  title: string;
  objective: string;
  synopsis: string;
  keyLocation: string;
  emotionalBeat: string;
  requiredSetups: string[];
  payoffTargets: string[];
  cliffhanger: string;
  continuityNotes: string;
  suggestedMission: string;
};

export type GeneratedSeriesCheckpoint = {
  checkpointNo: number;
  title: string;
  purpose: string;
  unlockHint: string;
  expectedEmotion: string;
  carryOver: string;
};

export type GeneratedSeriesFirstEpisodeSeed = {
  title: string;
  objective: string;
  openingScene: string;
  expectedDurationMinutes: number;
  routeStyle: string;
  completionCondition: string;
  carryOverHint: string;
  spotRequirements: Array<{
    requirementId: string;
    sceneRole: "起" | "承" | "転" | "結";
    spotRole: string;
    requiredAttributes: string[];
    visitConstraints: string[];
    tourismValueType: string;
  }>;
  suggestedSpots: string[];
};

export type GeneratedSeriesProgressState = {
  lastCompletedEpisodeNo: number;
  unresolvedThreads: string[];
  revealedFacts: string[];
  relationshipStateSummary: string;
  relationshipFlags: string[];
  recentRelationShift: string[];
  companionTrustLevel?: number;
  nextHook: string;
};

export type GeneratedSeriesWorld = {
  visualAssets?: Array<{
    id: string;
    title: string;
    description: string;
    prompt?: string;
    imageUrl?: string;
  }>;
  era?: string;
  setting?: string;
  socialStructure?: string;
  coreConflict?: string;
  tabooRules?: string[];
  recurringMotifs?: string[];
};

export type GeneratedSeriesContinuity = {
  globalMystery?: string;
  midSeasonTwist?: string;
  finalePayoff?: string;
  invariantRules?: string[];
  episodeLinkPolicy?: string[];
};

export type GeneratedSeriesCoverFocusCharacter = {
  characterId: string;
  name: string;
  role: string;
  focusReason: string;
  visualAnchor: string;
};

export type GeneratedSeriesIdentityPackCharacter = {
  characterId: string;
  name: string;
  role: string;
  isKeyPerson: boolean;
  identityAnchorTokens: GeneratedSeriesCharacterIdentityAnchorTokens;
  portraitPrompt?: string;
  portraitImageUrl?: string;
};

export type GeneratedSeriesIdentityPack = {
  version: number;
  source: "generated" | "reused";
  styleBible: string;
  keyPersonCharacterIds: string[];
  characters: GeneratedSeriesIdentityPackCharacter[];
  lockedAt: string;
};

export type GeneratedSeriesCoverConsistencyCharacterScore = {
  characterId: string;
  name: string;
  role: string;
  arcfaceSimilarity: number;
  clipSimilarity: number;
  visionAnchorMatch: number;
  passedAxes: number;
  passed: boolean;
};

export type GeneratedSeriesCoverConsistencyCandidateReport = {
  candidateIndex: number;
  roundIndex: number;
  imageUrl: string;
  provider?: string;
  prompt: string;
  arcfaceAvg: number;
  clipAvg: number;
  visionAnchorAvg: number;
  styleSimilarity: number;
  passRate: number;
  passed: boolean;
  characterScores: GeneratedSeriesCoverConsistencyCharacterScore[];
};

export type GeneratedSeriesCoverConsistencyReport = {
  mode: "quality_first";
  thresholds: {
    requiredAxesPerCharacter: number;
    minAveragePassRate: number;
    minStyleSimilarity: number;
  };
  validationRounds: number;
  selectedCandidateIndex: number;
  selectedCoverImageUrl: string;
  selectedCoverImagePrompt: string;
  selectedProvider?: string;
  passed: boolean;
  summary: string;
  candidateReports: GeneratedSeriesCoverConsistencyCandidateReport[];
};

export type GeneratedSeriesDraft = {
  title: string;
  overview: string;
  aiRules: string;
  characters: GeneratedSeriesCharacter[];
  coverImagePrompt?: string;
  coverImageUrl?: string;
  genre?: string;
  tone?: string;
  premise?: string;
  seasonGoal?: string;
  visualStylePreset?: string;
  visualStyleNotes?: string;
  world?: GeneratedSeriesWorld;
  checkpoints?: GeneratedSeriesCheckpoint[];
  firstEpisodeSeed?: GeneratedSeriesFirstEpisodeSeed;
  progressState?: GeneratedSeriesProgressState;
  episodeBlueprints?: GeneratedSeriesEpisodeBlueprint[];
  continuity?: GeneratedSeriesContinuity;
  coverFocusCharacters?: GeneratedSeriesCoverFocusCharacter[];
  identityPack?: GeneratedSeriesIdentityPack;
  coverConsistencyReport?: GeneratedSeriesCoverConsistencyReport;
  workflowVersion?: string;
};

export type RuntimeEpisodeProgressPatch = {
  unresolvedThreadsToAdd: string[];
  unresolvedThreadsToRemove: string[];
  revealedFactsToAdd: string[];
  relationshipStateSummary: string;
  relationshipFlagsToAdd: string[];
  relationshipFlagsToRemove: string[];
  recentRelationShift: string[];
  companionTrustDelta?: number;
  nextHook: string;
};

export type EpisodeSpotBlock = {
  type: "narration" | "dialogue" | "mission";
  text: string;
  speakerId?: string;
  expression?: "neutral" | "smile" | "serious" | "surprise" | "excited";
};

export type EpisodeDialogueLine = {
  characterId: string;
  text: string;
  expression?: "neutral" | "smile" | "serious" | "surprise" | "excited";
};

export type EpisodeSpot = {
  spotName: string;
  sceneRole: "起" | "承" | "転" | "結";
  sceneObjective: string;
  sceneNarration: string;
  blocks: EpisodeSpotBlock[];
  questionText: string;
  answerText: string;
  hintText: string;
  explanationText: string;
  preMissionDialogue: EpisodeDialogueLine[];
  postMissionDialogue: EpisodeDialogueLine[];
};

export type EpisodeCharacter = {
  id: string;
  name: string;
  role: string;
  personality: string;
  origin?: "series" | "episode";
};

export type EpisodeWorld = {
  title: string;
  mood: string;
  atmosphere: string;
  sensoryKeywords: string[];
  storyAxis: string;
  emotionalArc: string;
  localTheme: string;
};

export type EpisodeUniqueCharacter = {
  id: string;
  name: string;
  role: string;
  personality: string;
  motivation: string;
  relationToSeries: string;
  introductionScene: string;
};

export type RuntimeEpisodeGenerationTraceCandidate = {
  spotName: string;
  tourismFocus: string;
  estimatedWalkMinutes: number;
  publicAccessible: boolean;
  roleMatchScore: number;
  tourismMatchScore: number;
  localityScore: number;
};

export type RuntimeEpisodeGenerationTraceRequirement = {
  requirementId: string;
  sceneRole: "起" | "承" | "転" | "結";
  spotRole: string;
  candidates: RuntimeEpisodeGenerationTraceCandidate[];
};

export type RuntimeEpisodeGenerationRouteMetrics = {
  optimizer: string;
  totalEstimatedWalkMinutes: number;
  transferMinutes: number;
  maxLegMinutes: number;
  maxTotalWalkMinutes: number;
  feasible: boolean;
  failureReasons: string[];
  optimizedOrderIndices: number[];
  optimizedOrderSpotNames: string[];
};

export type RuntimeEpisodeGenerationTrace = {
  stageLocation: string;
  candidateSpots: RuntimeEpisodeGenerationTraceRequirement[];
  selectedSpots: Array<{
    requirementId: string;
    sceneRole: "起" | "承" | "転" | "結";
    spotName: string;
    tourismFocus: string;
    estimatedWalkMinutes: number;
  }>;
  eligibilityRejectReasons: string[];
  mmrScores: Array<{
    requirementId: string;
    spotName: string;
    relevanceScore: number;
    redundancyPenalty: number;
    mmrScore: number;
  }>;
  routeMetrics: RuntimeEpisodeGenerationRouteMetrics;
  routeScore: number;
  continuityScore: number;
};

export type GeneratedRuntimeEpisode = {
  title: string;
  summary: string;
  oneLiner: string;
  mainPlot: {
    premise: string;
    goal: string;
  };
  characters: EpisodeCharacter[];
  episodeWorld: EpisodeWorld;
  episodeUniqueCharacters: EpisodeUniqueCharacter[];
  spots: EpisodeSpot[];
  completionCondition: string;
  carryOverHook: string;
  estimatedDurationMinutes: number;
  progressPatch: RuntimeEpisodeProgressPatch;
  generationTrace?: RuntimeEpisodeGenerationTrace;
};

export type RuntimeEpisodeContext = {
  title: string;
  overview?: string | null;
  premise?: string | null;
  seasonGoal?: string | null;
  aiRules?: string | null;
  worldSetting?: string | null;
  continuity?: GeneratedSeriesContinuity | null;
  progressState?: GeneratedSeriesProgressState | null;
  firstEpisodeSeed?: GeneratedSeriesFirstEpisodeSeed | null;
  checkpoints?: GeneratedSeriesCheckpoint[];
  characters?: GeneratedSeriesCharacter[];
  recentEpisodes?: Array<{
    episodeNo?: number;
    title: string;
    summary?: string;
  }>;
};

export type GenerateSeriesEpisodeByMastraPayload = {
  series: RuntimeEpisodeContext;
  stageLocation: string;
  purpose: string;
  userWishes?: string;
  desiredSpotCount?: number;
  desiredDurationMinutes?: number;
  language?: string;
};

const RUNTIME_EPISODE_GENERATION_PHASES = [
  "request_received",
  "input_validated",
  "characters_validated",
  "pipeline_start",
  "fallback_plan_start",
  "fallback_plan_done",
  "episode_plan_start",
  "episode_plan_done",
  "spot_resolution_start",
  "spot_resolution_done",
  "spot_chapter_start",
  "spot_chapter_done",
  "spot_puzzle_start",
  "spot_puzzle_done",
  "episode_assemble_start",
  "episode_assemble_done",
  "response_preparing",
  "completed",
] as const;

export type RuntimeEpisodeGenerationPhase = (typeof RUNTIME_EPISODE_GENERATION_PHASES)[number];

export type RuntimeEpisodeGenerationEvent = {
  phase: RuntimeEpisodeGenerationPhase;
  at: string;
  detail?: string;
  spotIndex?: number;
  spotCount?: number;
  spotName?: string;
};

export type GenerateSeriesEpisodeByMastraOptions = {
  onProgress?: (event: RuntimeEpisodeGenerationEvent) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

export type GenerateSeriesByMastraPayload = {
  interview: SeriesInterviewInput;
  prompt?: string;
  desiredEpisodeCount?: number;
  creatorId?: string;
  generationMode?: "proposal" | "full";
  existingIdentityPack?: GeneratedSeriesIdentityPack;
  identityRetcon?: boolean;
};

const SERIES_DRAFT_GENERATION_PHASES = [
  "request_received",
  "input_validated",
  "sanitize_series_request_start",
  "sanitize_series_request_done",
  "generate_series_concept_start",
  "generate_series_concept_done",
  "generate_series_characters_start",
  "generate_series_characters_done",
  "build_series_identity_pack_start",
  "build_series_identity_pack_done",
  "generate_series_checkpoints_start",
  "generate_series_checkpoints_done",
  "seed_route_dry_run_start",
  "seed_route_dry_run_done",
  "finalize_series_blueprint_start",
  "generate_series_cover_candidates_start",
  "generate_series_cover_candidates_done",
  "validate_cover_identity_start",
  "validate_cover_identity_done",
  "finalize_series_blueprint_done",
  "response_preparing",
  "completed",
] as const;

export type SeriesDraftGenerationPhase = (typeof SERIES_DRAFT_GENERATION_PHASES)[number];

export type SeriesDraftGenerationEvent = {
  phase: SeriesDraftGenerationPhase;
  at: string;
  detail?: string;
};

export type GenerateSeriesByMastraOptions = {
  onProgress?: (event: SeriesDraftGenerationEvent) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

const SERIES_DRAFT_DEFAULT_TIMEOUT_MS = 600_000;
const SERIES_DRAFT_DEFAULT_POLL_INTERVAL_MS = 700;

const isSeriesDraftGenerationPhase = (value: string): value is SeriesDraftGenerationPhase =>
  (SERIES_DRAFT_GENERATION_PHASES as readonly string[]).includes(value);

const normalizeStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((item) => clean(typeof item === "string" ? item : String(item ?? ""))).filter(Boolean);
};

const normalizeIdentityAnchorTokens = (raw: unknown): GeneratedSeriesCharacterIdentityAnchorTokens | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  return {
    hair: clean(typeof row.hair === "string" ? row.hair : "") || "",
    silhouette: clean(typeof row.silhouette === "string" ? row.silhouette : "") || "",
    dominantColor: clean(typeof row.dominant_color === "string" ? row.dominant_color : "") || "",
    outfitKeyItem: clean(typeof row.outfit_key_item === "string" ? row.outfit_key_item : "") || "",
    distinguishingFeature:
      clean(typeof row.distinguishing_feature === "string" ? row.distinguishing_feature : "") || "",
  };
};

const buildSeedFallbackImageUrl = (seedBase: string, width: number, height: number) => {
  const seed = clean(seedBase) || "tomoshibi";
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${Math.max(120, width)}/${Math.max(120, height)}`;
};

const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const extractHostFromEndpoint = (value?: string | null) => {
  const normalized = clean(value);
  if (!normalized) return "";
  const withoutScheme = normalized.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const hostPort = withoutScheme.split("/")[0] || "";
  const hostOnly = hostPort.split(":")[0] || "";
  return clean(hostOnly);
};

const resolveScriptHostFromNative = () => {
  const nativeModules = (NativeModules as unknown as Record<string, unknown>) || {};
  const sourceCode = (nativeModules.SourceCode as Record<string, unknown> | undefined) || undefined;
  const scriptUrl = clean(typeof sourceCode?.scriptURL === "string" ? sourceCode.scriptURL : "");
  if (!scriptUrl) return "";
  return extractHostFromEndpoint(scriptUrl);
};

const resolveExpoDevHost = () => {
  const c = Constants as unknown as Record<string, unknown>;
  const expoConfig = (c.expoConfig as Record<string, unknown> | undefined) || undefined;
  const manifest = (c.manifest as Record<string, unknown> | undefined) || undefined;
  const manifest2 = (c.manifest2 as Record<string, unknown> | undefined) || undefined;
  const expoGoConfig = (c.expoGoConfig as Record<string, unknown> | undefined) || undefined;
  const expoClient = ((manifest2?.extra as Record<string, unknown> | undefined)?.expoClient as Record<string, unknown> | undefined) || undefined;

  const candidates = [
    clean(typeof expoConfig?.hostUri === "string" ? expoConfig.hostUri : ""),
    clean(typeof manifest?.debuggerHost === "string" ? manifest.debuggerHost : ""),
    clean(typeof expoGoConfig?.debuggerHost === "string" ? expoGoConfig.debuggerHost : ""),
    clean(typeof c.linkingUri === "string" ? c.linkingUri : ""),
    clean(typeof c.experienceUrl === "string" ? c.experienceUrl : ""),
    clean(typeof expoClient?.hostUri === "string" ? expoClient.hostUri : ""),
    clean(resolveScriptHostFromNative()),
    clean(
      typeof ((manifest2?.extra as Record<string, unknown> | undefined)?.expoGo as Record<string, unknown> | undefined)
        ?.debuggerHost === "string"
        ? (((manifest2?.extra as Record<string, unknown> | undefined)?.expoGo as Record<string, unknown>).debuggerHost as string)
        : ""
    ),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const host = extractHostFromEndpoint(candidate);
    if (host && !LOCALHOST_HOSTS.has(host.toLowerCase())) {
      return host;
    }
  }
  return "";
};

const rewriteLocalhostBaseUrlForDevice = (value: string) => {
  const normalized = clean(value).replace(/\/+$/, "");
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    if (!LOCALHOST_HOSTS.has(parsed.hostname.toLowerCase())) {
      return normalized;
    }
    const devHost = resolveExpoDevHost();
    if (!devHost) return normalized;
    parsed.hostname = devHost;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return normalized;
  }
};

const normalizeMediaUrlForClient = (value?: string | null) => {
  const normalized = clean(value);
  if (!normalized) return "";

  if (/^https?:\/\//i.test(normalized)) {
    const rewritten = rewriteLocalhostBaseUrlForDevice(normalized);
    try {
      const parsed = new URL(rewritten);
      const baseUrl = resolveMastraBaseUrl();
      if (baseUrl && /^\/api\/series\/image(?:\/|$)/.test(parsed.pathname)) {
        const baseParsed = new URL(baseUrl);
        parsed.protocol = baseParsed.protocol;
        parsed.hostname = baseParsed.hostname;
        parsed.port = baseParsed.port;
        return parsed.toString();
      }
    } catch {
      return rewritten;
    }
    return rewritten;
  }

  if (normalized.startsWith("/")) {
    const baseUrl = resolveMastraBaseUrl();
    if (!baseUrl) return normalized;
    const safePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
    return `${baseUrl}${safePath}`;
  }

  return normalized;
};

const resolveMastraBaseUrl = () => {
  const explicit = clean(process.env.EXPO_PUBLIC_MASTRA_BASE_URL);
  if (explicit) return rewriteLocalhostBaseUrlForDevice(explicit);

  const fallback = clean(process.env.EXPO_PUBLIC_API_BASE_URL);
  if (fallback) return rewriteLocalhostBaseUrlForDevice(fallback);

  const devHost = resolveExpoDevHost();
  if (!devHost) return "";
  return `http://${devHost}:4111`;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_REGEX.test(value);

export const isMastraSeriesConfigured = resolveMastraBaseUrl().length > 0;

const normalizeCharacters = (raw: unknown): GeneratedSeriesCharacter[] => {
  if (!Array.isArray(raw)) return [];

  return raw.reduce<GeneratedSeriesCharacter[]>((acc, item, index) => {
    if (!item || typeof item !== "object") return acc;
    const row = item as Record<string, unknown>;
    const name = clean(typeof row.name === "string" ? row.name : undefined);
    const role = clean(typeof row.role === "string" ? row.role : undefined);
    if (!name || !role) return acc;

    // Normalize personality: now always a flat string
    const personality = clean(typeof row.personality === "string" ? row.personality : undefined) || undefined;

    // Normalize Big Five
    let bigFive: GeneratedSeriesCharacterPersonality['bigFive'] | undefined;
    const bigFiveRaw = row.big_five as Record<string, unknown> | undefined;
    if (bigFiveRaw && typeof bigFiveRaw === "object") {
      bigFive = {
        openness: Number(bigFiveRaw.openness) || 50,
        conscientiousness: Number(bigFiveRaw.conscientiousness) || 50,
        extraversion: Number(bigFiveRaw.extraversion) || 50,
        agreeableness: Number(bigFiveRaw.agreeableness) || 50,
        neuroticism: Number(bigFiveRaw.neuroticism) || 50,
      };
    }

    // Normalize visual design
    let visualDesign: GeneratedSeriesCharacterVisualDesign | undefined;
    if (typeof row.visual_design === "object" && row.visual_design !== null) {
      const vd = row.visual_design as Record<string, unknown>;
      visualDesign = {
        dominantColor: clean(typeof vd.dominant_color === "string" ? vd.dominant_color : "") || "",
        bodyType: clean(typeof vd.body_type === "string" ? vd.body_type : "") || "",
        silhouetteKeyword: clean(typeof vd.silhouette_keyword === "string" ? vd.silhouette_keyword : "") || "",
        distinguishingFeature: clean(typeof vd.distinguishing_feature === "string" ? vd.distinguishing_feature : "") || "",
      };
    }

    // Normalize relationships
    let relationships: GeneratedSeriesCharacterRelationship[] | undefined;
    if (Array.isArray(row.relationships)) {
      relationships = row.relationships
        .filter((r: unknown) => r && typeof r === "object")
        .map((r: unknown) => {
          const rel = r as Record<string, unknown>;
          return {
            targetId: clean(typeof rel.target_id === "string" ? rel.target_id : "") || "",
            type: clean(typeof rel.type === "string" ? rel.type : "trust") || "trust",
            description: clean(typeof rel.description === "string" ? rel.description : "") || "",
            tensionLevel: typeof rel.tension_level === "number" ? rel.tension_level : undefined,
          };
        })
        .filter((r) => r.targetId && r.description);
    }

    acc.push({
      id: clean(typeof row.id === "string" ? row.id : undefined) || `char_${index + 1}`,
      name,
      role,
      tier:
        clean(typeof row.tier === "string" ? row.tier : "").toLowerCase() === "primary"
          ? "primary"
          : "secondary",
      mustAppear:
        typeof row.must_appear === "boolean"
          ? row.must_appear
          : clean(typeof row.tier === "string" ? row.tier : "").toLowerCase() === "primary",
      archetype: clean(typeof row.archetype === "string" ? row.archetype : undefined) || undefined,
      goal: clean(typeof row.goal === "string" ? row.goal : undefined) || undefined,
      drive: clean(typeof row.drive === "string" ? row.drive : undefined) || undefined,
      dilemma: clean(typeof row.dilemma === "string" ? row.dilemma : undefined) || undefined,
      arcStart: clean(typeof row.arc_start === "string" ? row.arc_start : undefined) || undefined,
      arcMidpoint: clean(typeof row.arc_midpoint === "string" ? row.arc_midpoint : undefined) || undefined,
      arcEnd: clean(typeof row.arc_end === "string" ? row.arc_end : undefined) || undefined,
      arcTrigger: clean(typeof row.arc_trigger === "string" ? row.arc_trigger : undefined) || undefined,
      backstory: clean(typeof row.backstory === "string" ? row.backstory : undefined) || undefined,
      personality,
      bigFive,
      enneagramType: typeof row.enneagram_type === "number" ? row.enneagram_type : undefined,
      coreFear: clean(typeof row.core_fear === "string" ? row.core_fear : undefined),
      coreDesire: clean(typeof row.core_desire === "string" ? row.core_desire : undefined),
      speechPattern: clean(typeof row.speech_pattern === "string" ? row.speech_pattern : undefined),
      catchphrase: clean(typeof row.catchphrase === "string" ? row.catchphrase : undefined),
      quirks: normalizeStringArray(row.quirks),
      appearance: clean(typeof row.appearance === "string" ? row.appearance : undefined) || undefined,
      visualDesign,
      isKeyPerson:
        typeof row.is_key_person === "boolean"
          ? row.is_key_person
          : clean(typeof row.role === "string" ? row.role : "").includes("主人公")
            ? true
            : undefined,
      identityAnchorTokens: normalizeIdentityAnchorTokens(row.identity_anchor_tokens),
      portraitPrompt: clean(typeof row.portrait_prompt === "string" ? row.portrait_prompt : undefined) || undefined,
      portraitImageUrl:
        normalizeMediaUrlForClient(typeof row.portrait_image_url === "string" ? row.portrait_image_url : undefined) ||
        buildSeedFallbackImageUrl(`${name}-${role}-portrait`, 768, 1024),
      secrets: normalizeStringArray(row.secrets),
      relationshipHooks: normalizeStringArray(row.relationship_hooks),
      relationships,
    });

    return acc;
  }, []);
};

const normalizeEpisodeBlueprints = (raw: unknown): GeneratedSeriesEpisodeBlueprint[] => {
  if (!Array.isArray(raw)) return [];

  return raw.reduce<GeneratedSeriesEpisodeBlueprint[]>((acc, item, index) => {
    if (!item || typeof item !== "object") return acc;
    const row = item as Record<string, unknown>;
    const title = clean(typeof row.title === "string" ? row.title : undefined);
    if (!title) return acc;

    const episodeNo = Number.parseInt(String(row.episode_no ?? index + 1), 10);
    const safeEpisodeNo = Number.isFinite(episodeNo) && episodeNo > 0 ? episodeNo : index + 1;

    acc.push({
      episodeNo: safeEpisodeNo,
      title,
      objective: clean(typeof row.objective === "string" ? row.objective : undefined),
      synopsis: clean(typeof row.synopsis === "string" ? row.synopsis : undefined),
      keyLocation: clean(typeof row.key_location === "string" ? row.key_location : undefined),
      emotionalBeat: clean(typeof row.emotional_beat === "string" ? row.emotional_beat : undefined),
      requiredSetups: normalizeStringArray(row.required_setups),
      payoffTargets: normalizeStringArray(row.payoff_targets),
      cliffhanger: clean(typeof row.cliffhanger === "string" ? row.cliffhanger : undefined),
      continuityNotes: clean(typeof row.continuity_notes === "string" ? row.continuity_notes : undefined),
      suggestedMission: clean(typeof row.suggested_mission === "string" ? row.suggested_mission : undefined),
    });

    return acc;
  }, []);
};

const normalizeCheckpoints = (raw: unknown): GeneratedSeriesCheckpoint[] => {
  if (!Array.isArray(raw)) return [];

  return raw.reduce<GeneratedSeriesCheckpoint[]>((acc, item, index) => {
    if (!item || typeof item !== "object") return acc;
    const row = item as Record<string, unknown>;
    const title = clean(typeof row.title === "string" ? row.title : undefined);
    if (!title) return acc;

    const checkpointNo = Number.parseInt(String(row.checkpoint_no ?? index + 1), 10);
    const safeCheckpointNo = Number.isFinite(checkpointNo) && checkpointNo > 0 ? checkpointNo : index + 1;

    acc.push({
      checkpointNo: safeCheckpointNo,
      title,
      purpose: clean(typeof row.purpose === "string" ? row.purpose : undefined),
      unlockHint: clean(typeof row.unlock_hint === "string" ? row.unlock_hint : undefined),
      expectedEmotion: clean(typeof row.expected_emotion === "string" ? row.expected_emotion : undefined),
      carryOver: clean(typeof row.carry_over === "string" ? row.carry_over : undefined),
    });

    return acc;
  }, []);
};

const deriveCheckpointsFromLegacyEpisodes = (episodes: GeneratedSeriesEpisodeBlueprint[]): GeneratedSeriesCheckpoint[] =>
  episodes.slice(0, 8).map((episode, index) => ({
    checkpointNo: index + 1,
    title: episode.title,
    purpose: episode.objective || "次の体験へ進むための条件を満たす。",
    unlockHint: episode.requiredSetups?.join(" / ") || "前話の結果を引き継ぐ。",
    expectedEmotion: episode.emotionalBeat || "発見",
    carryOver: episode.cliffhanger || episode.continuityNotes || "次回に続く余韻を残す。",
  }));

const normalizeWorld = (raw: unknown): GeneratedSeriesWorld | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const world = raw as Record<string, unknown>;
  const visualAssets = Array.isArray(world.visual_assets)
    ? world.visual_assets.reduce<
      Array<{
        id: string;
        title: string;
        description: string;
        prompt?: string;
        imageUrl?: string;
      }>
    >((acc, item, index) => {
      if (!item || typeof item !== "object") return acc;
      const row = item as Record<string, unknown>;
      const id = clean(typeof row.id === "string" ? row.id : undefined) || `world_${index + 1}`;
      const title = clean(typeof row.title === "string" ? row.title : undefined);
      const description = clean(typeof row.description === "string" ? row.description : undefined);
      if (!title && !description) return acc;
      acc.push({
        id,
        title: title || `世界観ビジュアル ${index + 1}`,
        description: description || "世界観の雰囲気を示すビジュアル。",
        prompt: clean(typeof row.prompt === "string" ? row.prompt : undefined) || undefined,
        imageUrl: normalizeMediaUrlForClient(typeof row.image_url === "string" ? row.image_url : undefined) || undefined,
      });
      return acc;
    }, [])
    : [];

  return {
    visualAssets,
    era: clean(typeof world.era === "string" ? world.era : undefined) || undefined,
    setting: ensureWalkableSetting(typeof world.setting === "string" ? world.setting : undefined),
    socialStructure: clean(typeof world.social_structure === "string" ? world.social_structure : undefined) || undefined,
    coreConflict: clean(typeof world.core_conflict === "string" ? world.core_conflict : undefined) || undefined,
    tabooRules: normalizeStringArray(world.taboo_rules),
    recurringMotifs: normalizeStringArray(world.recurring_motifs),
  };
};

const normalizeContinuity = (raw: unknown): GeneratedSeriesContinuity | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const continuity = raw as Record<string, unknown>;
  return {
    globalMystery: clean(typeof continuity.global_mystery === "string" ? continuity.global_mystery : undefined) || undefined,
    midSeasonTwist: clean(typeof continuity.mid_season_twist === "string" ? continuity.mid_season_twist : undefined) || undefined,
    finalePayoff: clean(typeof continuity.finale_payoff === "string" ? continuity.finale_payoff : undefined) || undefined,
    invariantRules: normalizeStringArray(continuity.invariant_rules),
    episodeLinkPolicy: normalizeStringArray(continuity.episode_link_policy),
  };
};

const normalizeCoverFocusCharacters = (raw: unknown): GeneratedSeriesCoverFocusCharacter[] => {
  if (!Array.isArray(raw)) return [];
  return raw.reduce<GeneratedSeriesCoverFocusCharacter[]>((acc, item) => {
    if (!item || typeof item !== "object") return acc;
    const row = item as Record<string, unknown>;
    const characterId = clean(typeof row.character_id === "string" ? row.character_id : "");
    const name = clean(typeof row.name === "string" ? row.name : "");
    if (!characterId || !name) return acc;
    acc.push({
      characterId,
      name,
      role: clean(typeof row.role === "string" ? row.role : "") || "キーパーソン",
      focusReason:
        clean(typeof row.focus_reason === "string" ? row.focus_reason : "") || "物語の鍵を握る人物",
      visualAnchor:
        clean(typeof row.visual_anchor === "string" ? row.visual_anchor : "") || "印象的なシルエット",
    });
    return acc;
  }, []);
};

const normalizeIdentityPack = (raw: unknown): GeneratedSeriesIdentityPack | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const version = Number.parseInt(String(row.version ?? 1), 10);
  const sourceRaw = clean(typeof row.source === "string" ? row.source : "").toLowerCase();
  const source: GeneratedSeriesIdentityPack["source"] = sourceRaw === "reused" ? "reused" : "generated";
  const styleBible = clean(typeof row.style_bible === "string" ? row.style_bible : "");
  const keyPersonCharacterIds = normalizeStringArray(row.key_person_character_ids).slice(0, 3);

  const characters = Array.isArray(row.characters)
    ? row.characters.reduce<GeneratedSeriesIdentityPackCharacter[]>((acc, item) => {
        if (!item || typeof item !== "object") return acc;
        const c = item as Record<string, unknown>;
        const characterId = clean(typeof c.character_id === "string" ? c.character_id : "");
        const name = clean(typeof c.name === "string" ? c.name : "");
        if (!characterId || !name) return acc;
        acc.push({
          characterId,
          name,
          role: clean(typeof c.role === "string" ? c.role : "") || "キーパーソン",
          isKeyPerson: Boolean(c.is_key_person),
          identityAnchorTokens:
            normalizeIdentityAnchorTokens(c.identity_anchor_tokens) || {
              hair: "",
              silhouette: "",
              dominantColor: "",
              outfitKeyItem: "",
              distinguishingFeature: "",
            },
          portraitPrompt: clean(typeof c.portrait_prompt === "string" ? c.portrait_prompt : "") || undefined,
          portraitImageUrl:
            normalizeMediaUrlForClient(typeof c.portrait_image_url === "string" ? c.portrait_image_url : "") || undefined,
        });
        return acc;
      }, [])
    : [];

  if (!styleBible || keyPersonCharacterIds.length === 0 || characters.length === 0) return undefined;
  return {
    version: Number.isFinite(version) && version > 0 ? version : 1,
    source,
    styleBible,
    keyPersonCharacterIds,
    characters: characters.slice(0, 8),
    lockedAt: clean(typeof row.locked_at === "string" ? row.locked_at : "") || new Date().toISOString(),
  };
};

const normalizeCoverConsistencyReport = (raw: unknown): GeneratedSeriesCoverConsistencyReport | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const modeRaw = clean(typeof row.mode === "string" ? row.mode : "");
  const mode: GeneratedSeriesCoverConsistencyReport["mode"] = modeRaw === "quality_first" ? "quality_first" : "quality_first";

  const thresholdsRaw =
    row.thresholds && typeof row.thresholds === "object" ? (row.thresholds as Record<string, unknown>) : {};
  const thresholds = {
    requiredAxesPerCharacter: Number.parseInt(String(thresholdsRaw.required_axes_per_character ?? 3), 10) || 3,
    minAveragePassRate: Number.parseFloat(String(thresholdsRaw.min_average_pass_rate ?? 0.75)) || 0.75,
    minStyleSimilarity: Number.parseFloat(String(thresholdsRaw.min_style_similarity ?? 0.45)) || 0.45,
  };

  const candidateReports = Array.isArray(row.candidate_reports)
    ? row.candidate_reports.reduce<GeneratedSeriesCoverConsistencyCandidateReport[]>((acc, item) => {
      if (!item || typeof item !== "object") return acc;
      const c = item as Record<string, unknown>;
      const imageUrl = normalizeMediaUrlForClient(typeof c.image_url === "string" ? c.image_url : "");
      const prompt = clean(typeof c.prompt === "string" ? c.prompt : "");
      if (!imageUrl || !prompt) return acc;

        const characterScores = Array.isArray(c.character_scores)
          ? c.character_scores.reduce<GeneratedSeriesCoverConsistencyCharacterScore[]>((scoreAcc, scoreItem) => {
              if (!scoreItem || typeof scoreItem !== "object") return scoreAcc;
              const score = scoreItem as Record<string, unknown>;
              const characterId = clean(typeof score.character_id === "string" ? score.character_id : "");
              const name = clean(typeof score.name === "string" ? score.name : "");
              if (!characterId || !name) return scoreAcc;
              scoreAcc.push({
                characterId,
                name,
                role: clean(typeof score.role === "string" ? score.role : "") || "キーパーソン",
                arcfaceSimilarity: Number.parseFloat(String(score.arcface_similarity ?? 0)) || 0,
                clipSimilarity: Number.parseFloat(String(score.clip_similarity ?? 0)) || 0,
                visionAnchorMatch: Number.parseFloat(String(score.vision_anchor_match ?? 0)) || 0,
                passedAxes: Number.parseInt(String(score.passed_axes ?? 0), 10) || 0,
                passed: Boolean(score.passed),
              });
              return scoreAcc;
            }, [])
          : [];

        acc.push({
          candidateIndex: Number.parseInt(String(c.candidate_index ?? acc.length + 1), 10) || acc.length + 1,
          roundIndex: Number.parseInt(String(c.round_index ?? 1), 10) || 1,
          imageUrl,
          provider: clean(typeof c.provider === "string" ? c.provider : "") || undefined,
          prompt,
          arcfaceAvg: Number.parseFloat(String(c.arcface_avg ?? 0)) || 0,
          clipAvg: Number.parseFloat(String(c.clip_avg ?? 0)) || 0,
          visionAnchorAvg: Number.parseFloat(String(c.vision_anchor_avg ?? 0)) || 0,
          styleSimilarity: Number.parseFloat(String(c.style_similarity ?? 0)) || 0,
          passRate: Number.parseFloat(String(c.pass_rate ?? 0)) || 0,
          passed: Boolean(c.passed),
          characterScores,
        });
        return acc;
      }, [])
    : [];

  const selectedCoverImageUrl = normalizeMediaUrlForClient(
    typeof row.selected_cover_image_url === "string" ? row.selected_cover_image_url : ""
  );
  const selectedCoverImagePrompt = clean(
    typeof row.selected_cover_image_prompt === "string" ? row.selected_cover_image_prompt : ""
  );
  if (!selectedCoverImageUrl || !selectedCoverImagePrompt) return undefined;

  return {
    mode,
    thresholds,
    validationRounds: Number.parseInt(String(row.validation_rounds ?? 1), 10) || 1,
    selectedCandidateIndex: Number.parseInt(String(row.selected_candidate_index ?? 1), 10) || 1,
    selectedCoverImageUrl,
    selectedCoverImagePrompt,
    selectedProvider: clean(typeof row.selected_provider === "string" ? row.selected_provider : "") || undefined,
    passed: Boolean(row.passed),
    summary: clean(typeof row.summary === "string" ? row.summary : "") || "",
    candidateReports: candidateReports.slice(0, 12),
  };
};

const normalizeFirstEpisodeSeed = (raw: unknown): GeneratedSeriesFirstEpisodeSeed | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const seed = raw as Record<string, unknown>;
  const duration = Number.parseInt(String(seed.expected_duration_minutes ?? 20), 10);
  const expectedDurationMinutes = Number.isFinite(duration) ? Math.max(10, Math.min(45, duration)) : 20;
  const spotRequirements = normalizeSpotRequirements(
    seed.spot_requirements,
    clean(typeof seed.opening_scene === "string" ? seed.opening_scene : "")
  );
  const legacySuggested = ensureWalkSuggestedSpots(
    normalizeStringArray(seed.suggested_spots),
    clean(typeof seed.route_style === "string" ? seed.route_style : undefined)
  );
  const suggestedSpots = dedupeStrings([...legacySuggested, ...deriveSuggestedSpotsFromRequirements(spotRequirements)]).slice(0, 6);
  return {
    title: clean(typeof seed.title === "string" ? seed.title : undefined) || "第1話: 旅の始まり",
    objective:
      clean(typeof seed.objective === "string" ? seed.objective : undefined) || "シリーズの目的へ向かう最初の手がかりを得る。",
    openingScene:
      clean(typeof seed.opening_scene === "string" ? seed.opening_scene : undefined) || "街歩きの導入で違和感に出会う。",
    expectedDurationMinutes,
    routeStyle: ensureWalkRouteStyle(typeof seed.route_style === "string" ? seed.route_style : undefined),
    completionCondition:
      clean(typeof seed.completion_condition === "string" ? seed.completion_condition : undefined) ||
      "主要スポットで発見を得る。",
    carryOverHint:
      clean(typeof seed.carry_over_hint === "string" ? seed.carry_over_hint : undefined) || "次回に続く問いが残る。",
    spotRequirements,
    suggestedSpots,
  };
};

const normalizeProgressState = (raw: unknown): GeneratedSeriesProgressState | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const state = raw as Record<string, unknown>;
  const lastCompletedEpisodeNo = Number.parseInt(String(state.last_completed_episode_no ?? 0), 10);
  const trust = Number.parseFloat(String(state.companion_trust_level ?? 40));

  return {
    lastCompletedEpisodeNo:
      Number.isFinite(lastCompletedEpisodeNo) && lastCompletedEpisodeNo >= 0 ? lastCompletedEpisodeNo : 0,
    unresolvedThreads: normalizeStringArray(state.unresolved_threads),
    revealedFacts: normalizeStringArray(state.revealed_facts),
    relationshipStateSummary:
      clean(typeof state.relationship_state_summary === "string" ? state.relationship_state_summary : "") || "関係性は初期状態。",
    relationshipFlags: normalizeStringArray(state.relationship_flags),
    recentRelationShift: normalizeStringArray(state.recent_relation_shift),
    companionTrustLevel: Number.isFinite(trust) ? Math.max(0, Math.min(100, trust)) : undefined,
    nextHook: clean(typeof state.next_hook === "string" ? state.next_hook : undefined) || "",
  };
};

export const generateSeriesDraftViaMastra = async (
  payload: GenerateSeriesByMastraPayload,
  options: GenerateSeriesByMastraOptions = {}
): Promise<GeneratedSeriesDraft> => {
  const baseUrl = resolveMastraBaseUrl();
  if (!baseUrl) {
    throw new Error("Mastra API base URL is missing. Set EXPO_PUBLIC_MASTRA_BASE_URL or EXPO_PUBLIC_API_BASE_URL.");
  }
  const timeoutMs = Math.max(30_000, options.timeoutMs ?? SERIES_DRAFT_DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(250, options.pollIntervalMs ?? SERIES_DRAFT_DEFAULT_POLL_INTERVAL_MS);
  const requestTimeoutMs = Math.max(8_000, Math.min(45_000, Math.floor(timeoutMs / 8)));

  const body = {
    interview: {
      genre_world: payload.interview.genreWorld,
      desired_emotion: payload.interview.desiredEmotion,
      companion_preference: payload.interview.companionPreference,
      continuation_trigger: payload.interview.continuationTrigger,
      avoidance_preferences: payload.interview.avoidExpressions,
      additional_notes: payload.interview.additionalNotes,
      visual_style_preset: clean(payload.interview.visualStylePreset) || undefined,
      visual_style_notes: clean(payload.interview.visualStyleNotes) || undefined,
    },
    prompt: clean(payload.prompt) || undefined,
    desired_episode_count: payload.desiredEpisodeCount ?? 8,
    generation_mode: payload.generationMode || undefined,
    ...(isUuid(payload.creatorId) ? { creator_id: payload.creatorId } : {}),
    language: "ja",
    existing_identity_pack: payload.existingIdentityPack
      ? {
          version: payload.existingIdentityPack.version,
          source: payload.existingIdentityPack.source,
          style_bible: payload.existingIdentityPack.styleBible,
          key_person_character_ids: payload.existingIdentityPack.keyPersonCharacterIds,
          characters: payload.existingIdentityPack.characters.map((character) => ({
            character_id: character.characterId,
            name: character.name,
            role: character.role,
            is_key_person: character.isKeyPerson,
            identity_anchor_tokens: {
              hair: character.identityAnchorTokens.hair,
              silhouette: character.identityAnchorTokens.silhouette,
              dominant_color: character.identityAnchorTokens.dominantColor,
              outfit_key_item: character.identityAnchorTokens.outfitKeyItem,
              distinguishing_feature: character.identityAnchorTokens.distinguishingFeature,
            },
            portrait_prompt: clean(character.portraitPrompt) || undefined,
            portrait_image_url: clean(character.portraitImageUrl) || undefined,
          })),
          locked_at: payload.existingIdentityPack.lockedAt,
        }
      : undefined,
    identity_retcon: payload.identityRetcon ? true : undefined,
  };

  const emitProgress = (event: SeriesDraftGenerationEvent) => {
    options.onProgress?.(event);
  };

  const normalizeDraftFromResponse = (json: unknown): GeneratedSeriesDraft => {
    const payloadObject = (json && typeof json === "object" ? (json as Record<string, unknown>) : null) || {};
    const seriesRaw = (payloadObject.series as Record<string, unknown> | undefined) || payloadObject;
    const metaRaw = (payloadObject.meta as Record<string, unknown> | undefined) || null;

    const title = clean(typeof seriesRaw.title === "string" ? seriesRaw.title : undefined) || "新しいシリーズ";
    const overview =
      clean(typeof seriesRaw.overview === "string" ? seriesRaw.overview : undefined) ||
      clean(typeof seriesRaw.premise === "string" ? seriesRaw.premise : undefined) ||
      "概要を生成できませんでした。";
    const aiRules = ensureWalkAiRules(typeof seriesRaw.ai_rules === "string" ? seriesRaw.ai_rules : undefined);

    const characters = normalizeCharacters(seriesRaw.characters);
    if (characters.length === 0) {
      throw new Error("Mastra response does not include valid characters.");
    }

    const episodeBlueprints = normalizeEpisodeBlueprints(seriesRaw.episode_blueprints);
    const checkpointsRaw = normalizeCheckpoints(seriesRaw.checkpoints);
    const checkpoints =
      checkpointsRaw.length > 0
        ? checkpointsRaw
        : episodeBlueprints.length > 0
          ? deriveCheckpointsFromLegacyEpisodes(episodeBlueprints)
          : [];
    const normalizedWorld = normalizeWorld(seriesRaw.world);
    const firstEpisodeSeed = normalizeFirstEpisodeSeed(seriesRaw.first_episode_seed);
    const progressState = normalizeProgressState(seriesRaw.progress_state);

    return {
      title,
      overview,
      aiRules,
      characters,
      coverImagePrompt:
        clean(typeof seriesRaw.cover_image_prompt === "string" ? seriesRaw.cover_image_prompt : undefined) || undefined,
      coverImageUrl:
        normalizeMediaUrlForClient(typeof seriesRaw.cover_image_url === "string" ? seriesRaw.cover_image_url : undefined) ||
        buildSeedFallbackImageUrl(`${title}-${clean(typeof seriesRaw.genre === "string" ? seriesRaw.genre : undefined)}`, 1024, 1365),
      genre: clean(typeof seriesRaw.genre === "string" ? seriesRaw.genre : undefined) || undefined,
      tone: clean(typeof seriesRaw.tone === "string" ? seriesRaw.tone : undefined) || undefined,
      premise: clean(typeof seriesRaw.premise === "string" ? seriesRaw.premise : undefined) || undefined,
      seasonGoal: clean(typeof seriesRaw.season_goal === "string" ? seriesRaw.season_goal : undefined) || undefined,
      visualStylePreset:
        clean(typeof seriesRaw.visual_style_preset === "string" ? seriesRaw.visual_style_preset : undefined) ||
        clean(payload.interview.visualStylePreset) ||
        undefined,
      visualStyleNotes:
        clean(typeof seriesRaw.visual_style_notes === "string" ? seriesRaw.visual_style_notes : undefined) ||
        clean(payload.interview.visualStyleNotes) ||
        undefined,
      world: normalizedWorld,
      checkpoints,
      firstEpisodeSeed:
        firstEpisodeSeed ||
        (checkpoints[0]
          ? {
            title: checkpoints[0].title || "第1話: 旅の始まり",
            objective: checkpoints[0].purpose || "シリーズ導入の体験を進める。",
            openingScene: checkpoints[0].unlockHint || "街歩きの導入で違和感に出会う。",
            expectedDurationMinutes: 20,
            routeStyle: "徒歩中心の周遊",
            completionCondition: "主要スポットで発見を得る。",
            carryOverHint: checkpoints[0].carryOver || "次回に続く問いが残る。",
            spotRequirements: normalizeSpotRequirements([], normalizedWorld?.setting || WALKABLE_WORLD_FALLBACK),
            suggestedSpots: ensureWalkSuggestedSpots([
              normalizedWorld?.setting ||
              clean(
                typeof (seriesRaw.world as Record<string, unknown> | undefined)?.setting === "string"
                  ? ((seriesRaw.world as Record<string, unknown>).setting as string)
                  : ""
              ) ||
              WALKABLE_WORLD_FALLBACK,
            ]),
          }
          : undefined),
      progressState:
        progressState ||
        {
          lastCompletedEpisodeNo: 0,
          unresolvedThreads: (() => {
            const continuity = seriesRaw.continuity as Record<string, unknown> | undefined;
            const mystery = clean(typeof continuity?.global_mystery === "string" ? continuity.global_mystery : "");
            return mystery ? [mystery] : [];
          })(),
          revealedFacts: [],
          relationshipStateSummary: "主要キャラクターとの関係は導入段階。",
          relationshipFlags: [],
          recentRelationShift: [],
          companionTrustLevel: 40,
          nextHook: "",
        },
      episodeBlueprints,
      continuity: normalizeContinuity(seriesRaw.continuity),
      coverFocusCharacters: normalizeCoverFocusCharacters(seriesRaw.cover_focus_characters),
      identityPack: normalizeIdentityPack(seriesRaw.identity_pack),
      coverConsistencyReport: normalizeCoverConsistencyReport(seriesRaw.cover_consistency_report),
      workflowVersion:
        clean(typeof metaRaw?.workflow_version === "string" ? metaRaw.workflow_version : undefined) || undefined,
    };
  };

  const runLegacyEndpoint = async (): Promise<GeneratedSeriesDraft> => {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${baseUrl}/api/series`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        requestTimeoutMs,
        options.signal
      );
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        throw new Error(`シリーズ生成がタイムアウトしました（${Math.floor(timeoutMs / 1000)}秒）。再度お試しください。`);
      }
      if (fetchError instanceof Error && fetchError.name === "TimeoutError") {
        throw new Error(`Mastra APIの応答がタイムアウトしました（${Math.floor(requestTimeoutMs / 1000)}秒）。`);
      }
      if (isLikelyNetworkError(fetchError)) {
        throw buildMastraNetworkError(baseUrl, fetchError);
      }
      throw fetchError;
    }

    const rawText = await response.text();
    const json = parseJsonSafe(rawText);
    if (!response.ok) {
      const errMsg =
        json && typeof json === "object" && json !== null && "error" in json && typeof (json as { error: unknown }).error === "string"
          ? (json as { error: string }).error
          : rawText || `HTTP ${response.status}`;
      throw new Error(errMsg);
    }
    return normalizeDraftFromResponse(json);
  };

  const normalizeSeriesDraftProgressEvent = (raw: unknown): SeriesDraftGenerationEvent | null => {
    const row = asObject(raw);
    const phase = clean(typeof row.phase === "string" ? row.phase : "");
    if (!isSeriesDraftGenerationPhase(phase)) return null;
    return {
      phase,
      at: clean(typeof row.at === "string" ? row.at : "") || new Date().toISOString(),
      detail: clean(typeof row.detail === "string" ? row.detail : "") || undefined,
    };
  };

  let createJobResponse: Response | null = null;
  let createJobRaw = "";
  let createJobJson: unknown = null;
  try {
    createJobResponse = await fetchWithTimeout(
      `${baseUrl}/api/series/jobs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      requestTimeoutMs,
      options.signal
    );
    createJobRaw = await createJobResponse.text();
    createJobJson = parseJsonSafe(createJobRaw);
  } catch (fetchError) {
    if (fetchError instanceof Error && fetchError.name === "AbortError") {
      throw createAbortError();
    }
    if (fetchError instanceof Error && fetchError.name === "TimeoutError") {
      throw new Error(`Mastra APIへの接続がタイムアウトしました（${Math.floor(requestTimeoutMs / 1000)}秒）。`);
    }
    if (isLikelyNetworkError(fetchError)) {
      throw buildMastraNetworkError(baseUrl, fetchError);
    }
    throw fetchError;
  }
  if (!createJobResponse) {
    throw new Error("シリーズ生成ジョブの作成レスポンスが取得できませんでした。");
  }

  if (!createJobResponse.ok) {
    if (createJobResponse.status === 404 || createJobResponse.status === 405) {
      return runLegacyEndpoint();
    }
    const errMsg =
      createJobJson && typeof createJobJson === "object" && "error" in createJobJson
        ? String((createJobJson as { error?: unknown }).error || "")
        : createJobRaw || `HTTP ${createJobResponse.status}`;
    throw new Error(errMsg || "シリーズ生成ジョブの作成に失敗しました。");
  }

  const createJobPayload = asObject(createJobJson);
  const jobId = clean(typeof createJobPayload.job_id === "string" ? createJobPayload.job_id : "");
  if (!jobId) {
    return runLegacyEndpoint();
  }

  const initialEvents = Array.isArray(createJobPayload.events) ? createJobPayload.events : [];
  initialEvents.forEach((rawEvent) => {
    const normalized = normalizeSeriesDraftProgressEvent(rawEvent);
    if (normalized) emitProgress(normalized);
  });

  const nextCursor = Number.parseInt(
    String(createJobPayload.next_cursor ?? createJobPayload.cursor ?? initialEvents.length),
    10
  );
  let cursor = Number.isFinite(nextCursor) && nextCursor >= 0 ? nextCursor : initialEvents.length;

  const pollPath = clean(typeof createJobPayload.poll_path === "string" ? createJobPayload.poll_path : "");
  const pollUrl = pollPath
    ? `${baseUrl}${pollPath.startsWith("/") ? "" : "/"}${pollPath}`
    : `${baseUrl}/api/series/jobs/${encodeURIComponent(jobId)}`;

  const startedAt = Date.now();
  while (true) {
    if (options.signal?.aborted) {
      throw createAbortError();
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`シリーズ生成がタイムアウトしました（${Math.floor(timeoutMs / 1000)}秒）。再度お試しください。`);
    }

    const separator = pollUrl.includes("?") ? "&" : "?";
    let pollResponse: Response | null = null;
    let pollRaw = "";
    let pollJson: unknown = null;
    try {
      pollResponse = await fetchWithTimeout(
        `${pollUrl}${separator}cursor=${cursor}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        },
        requestTimeoutMs,
        options.signal
      );
      pollRaw = await pollResponse.text();
      pollJson = parseJsonSafe(pollRaw);
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        throw createAbortError();
      }
      if (fetchError instanceof Error && fetchError.name === "TimeoutError") {
        throw new Error(`Mastra APIポーリングがタイムアウトしました（${Math.floor(requestTimeoutMs / 1000)}秒）。`);
      }
      if (isLikelyNetworkError(fetchError)) {
        throw buildMastraNetworkError(baseUrl, fetchError);
      }
      throw fetchError;
    }

    if (!pollResponse) {
      throw new Error("シリーズ生成ジョブのポーリングレスポンスが取得できませんでした。");
    }

    if (!pollResponse.ok) {
      const errMsg =
        pollJson && typeof pollJson === "object" && "error" in pollJson
          ? String((pollJson as { error?: unknown }).error || "")
          : pollRaw || `HTTP ${pollResponse.status}`;
      throw new Error(errMsg || "シリーズ生成ジョブの取得に失敗しました。");
    }

    const pollPayload = asObject(pollJson);
    const events = Array.isArray(pollPayload.events) ? pollPayload.events : [];
    events.forEach((rawEvent) => {
      const normalized = normalizeSeriesDraftProgressEvent(rawEvent);
      if (normalized) emitProgress(normalized);
    });

    const next = Number.parseInt(String(pollPayload.next_cursor ?? ""), 10);
    if (Number.isFinite(next) && next >= cursor) {
      cursor = next;
    } else {
      cursor += events.length;
    }

    const status = clean(typeof pollPayload.status === "string" ? pollPayload.status : "");
    if (status === "succeeded") {
      return normalizeDraftFromResponse(pollJson);
    }
    if (status === "failed") {
      const reason = clean(typeof pollPayload.error === "string" ? pollPayload.error : "") || "シリーズ生成に失敗しました。";
      throw new Error(reason);
    }
    await waitFor(pollIntervalMs, options.signal);
  }
};

const normalizeDialogueLines = (raw: unknown): EpisodeDialogueLine[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d: any) => d && typeof d.character_id === "string" && typeof d.text === "string")
    .map((d: any) => ({
      characterId: d.character_id,
      text: clean(d.text) || "",
      ...(d.expression ? { expression: d.expression } : {}),
    }));
};

const normalizeBlocks = (raw: unknown): EpisodeSpotBlock[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b: any) => b && typeof b.type === "string" && typeof b.text === "string")
    .map((b: any) => ({
      type: b.type as EpisodeSpotBlock["type"],
      text: clean(b.text) || "",
      ...(b.speaker_id ? { speakerId: b.speaker_id } : {}),
      ...(b.expression ? { expression: b.expression } : {}),
    }));
};

const normalizeSpots = (raw: unknown): EpisodeSpot[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s: any) => s && typeof s === "object" && typeof s.spot_name === "string")
    .map((s: any) => ({
      spotName: clean(s.spot_name) || "不明なスポット",
      sceneRole: s.scene_role || "承",
      sceneObjective: clean(s.scene_objective) || "",
      sceneNarration: clean(s.scene_narration) || "",
      blocks: normalizeBlocks(s.blocks),
      questionText: clean(s.question_text) || "",
      answerText: clean(s.answer_text) || "",
      hintText: clean(s.hint_text) || "",
      explanationText: clean(s.explanation_text) || "",
      preMissionDialogue: normalizeDialogueLines(s.pre_mission_dialogue),
      postMissionDialogue: normalizeDialogueLines(s.post_mission_dialogue),
    }));
};

const normalizeEpisodeCharacters = (raw: unknown): EpisodeCharacter[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c: any) => c && typeof c.name === "string")
    .map((c: any) => ({
      id: c.id || "char_?",
      name: clean(c.name) || "",
      role: clean(c.role) || "",
      personality: clean(c.personality) || "",
      ...(c.origin === "series" || c.origin === "episode" ? { origin: c.origin } : {}),
    }));
};

const normalizeEpisodeWorld = (raw: unknown): EpisodeWorld => {
  const row = asObject(raw);
  return {
    title: clean(typeof row.title === "string" ? row.title : "") || "今回の旅の章",
    mood: clean(typeof row.mood === "string" ? row.mood : "") || "発見と余韻",
    atmosphere:
      clean(typeof row.atmosphere === "string" ? row.atmosphere : "") ||
      "現実の街を歩きながら物語を体験する",
    sensoryKeywords: normalizeStringArray(row.sensory_keywords).slice(0, 8),
    storyAxis:
      clean(typeof row.story_axis === "string" ? row.story_axis : "") ||
      "街の断片情報を繋ぎ次話へ進む",
    emotionalArc:
      clean(typeof row.emotional_arc === "string" ? row.emotional_arc : "") ||
      "導入から収束へ向かう感情曲線",
    localTheme:
      clean(typeof row.local_theme === "string" ? row.local_theme : "") ||
      "地域性を体験として回収する",
  };
};

const normalizeEpisodeUniqueCharacters = (raw: unknown): EpisodeUniqueCharacter[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      const row = asObject(item);
      const name = clean(typeof row.name === "string" ? row.name : "");
      const role = clean(typeof row.role === "string" ? row.role : "");
      if (!name || !role) return null;
      return {
        id: clean(typeof row.id === "string" ? row.id : "") || `ep_char_${index + 1}`,
        name,
        role,
        personality:
          clean(typeof row.personality === "string" ? row.personality : "") || "観察力が高い",
        motivation:
          clean(typeof row.motivation === "string" ? row.motivation : "") ||
          "この土地の情報を正確に伝えたい",
        relationToSeries:
          clean(typeof row.relation_to_series === "string" ? row.relation_to_series : "") ||
          "シリーズの進行に関わる情報を持つ",
        introductionScene:
          clean(typeof row.introduction_scene === "string" ? row.introduction_scene : "") ||
          "導入で出会う",
      } satisfies EpisodeUniqueCharacter;
    })
    .filter((character): character is EpisodeUniqueCharacter => Boolean(character));
};

const toBoundedInt = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const toBoundedNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number.parseFloat(String(value ?? fallback));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const normalizeRuntimeEpisodeGenerationTrace = (
  raw: unknown
): RuntimeEpisodeGenerationTrace | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const routeMetricsRaw =
    row.route_metrics && typeof row.route_metrics === "object"
      ? (row.route_metrics as Record<string, unknown>)
      : {};

  const candidateSpots = Array.isArray(row.candidate_spots)
    ? row.candidate_spots
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const requirement = item as Record<string, unknown>;
          const candidates = Array.isArray(requirement.candidates)
            ? requirement.candidates
                .map((candidate) => {
                  if (!candidate || typeof candidate !== "object") return null;
                  const c = candidate as Record<string, unknown>;
                  const spotName = clean(typeof c.spot_name === "string" ? c.spot_name : "");
                  if (!spotName) return null;
                  return {
                    spotName,
                    tourismFocus: clean(typeof c.tourism_focus === "string" ? c.tourism_focus : "") || "",
                    estimatedWalkMinutes: toBoundedInt(c.estimated_walk_minutes, 0, 240, 0),
                    publicAccessible: Boolean(c.public_accessible),
                    roleMatchScore: toBoundedNumber(c.role_match_score, 0, 1, 0),
                    tourismMatchScore: toBoundedNumber(c.tourism_match_score, 0, 1, 0),
                    localityScore: toBoundedNumber(c.locality_score, 0, 1, 0),
                  } satisfies RuntimeEpisodeGenerationTraceCandidate;
                })
                .filter((candidate): candidate is RuntimeEpisodeGenerationTraceCandidate => Boolean(candidate))
            : [];
          const requirementId = clean(
            typeof requirement.requirement_id === "string" ? requirement.requirement_id : ""
          );
          if (!requirementId) return null;
          const sceneRoleRaw =
            clean(typeof requirement.scene_role === "string" ? requirement.scene_role : "") || "承";
          const sceneRole = isSceneRole(sceneRoleRaw) ? sceneRoleRaw : "承";
          return {
            requirementId,
            sceneRole,
            spotRole: clean(typeof requirement.spot_role === "string" ? requirement.spot_role : "") || "",
            candidates,
          } satisfies RuntimeEpisodeGenerationTraceRequirement;
        })
        .filter((item): item is RuntimeEpisodeGenerationTraceRequirement => Boolean(item))
    : [];

  const selectedSpots = Array.isArray(row.selected_spots)
    ? row.selected_spots
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const selected = item as Record<string, unknown>;
          const requirementId = clean(
            typeof selected.requirement_id === "string" ? selected.requirement_id : ""
          );
          const spotName = clean(typeof selected.spot_name === "string" ? selected.spot_name : "");
          if (!requirementId || !spotName) return null;
          const sceneRoleRaw = clean(typeof selected.scene_role === "string" ? selected.scene_role : "") || "承";
          const sceneRole = isSceneRole(sceneRoleRaw) ? sceneRoleRaw : "承";
          return {
            requirementId,
            sceneRole,
            spotName,
            tourismFocus: clean(typeof selected.tourism_focus === "string" ? selected.tourism_focus : "") || "",
            estimatedWalkMinutes: toBoundedInt(selected.estimated_walk_minutes, 0, 240, 0),
          };
        })
        .filter(
          (
            item
          ): item is RuntimeEpisodeGenerationTrace["selectedSpots"][number] => Boolean(item)
        )
    : [];

  const mmrScores = Array.isArray(row.mmr_scores)
    ? row.mmr_scores
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const score = item as Record<string, unknown>;
          const requirementId = clean(
            typeof score.requirement_id === "string" ? score.requirement_id : ""
          );
          const spotName = clean(typeof score.spot_name === "string" ? score.spot_name : "");
          if (!requirementId || !spotName) return null;
          return {
            requirementId,
            spotName,
            relevanceScore: toBoundedNumber(score.relevance_score, 0, 100, 0),
            redundancyPenalty: toBoundedNumber(score.redundancy_penalty, 0, 100, 0),
            mmrScore: toBoundedNumber(score.mmr_score, -100, 100, 0),
          };
        })
        .filter((item): item is RuntimeEpisodeGenerationTrace["mmrScores"][number] => Boolean(item))
    : [];

  return {
    stageLocation: clean(typeof row.stage_location === "string" ? row.stage_location : "") || "",
    candidateSpots,
    selectedSpots,
    eligibilityRejectReasons: normalizeStringArray(row.eligibility_reject_reasons),
    mmrScores,
    routeMetrics: {
      optimizer:
        clean(typeof routeMetricsRaw.optimizer === "string" ? routeMetricsRaw.optimizer : "") ||
        "unknown",
      totalEstimatedWalkMinutes: toBoundedInt(routeMetricsRaw.total_estimated_walk_minutes, 0, 720, 0),
      transferMinutes: toBoundedInt(routeMetricsRaw.transfer_minutes, 0, 720, 0),
      maxLegMinutes: toBoundedInt(routeMetricsRaw.max_leg_minutes, 0, 360, 0),
      maxTotalWalkMinutes: toBoundedInt(routeMetricsRaw.max_total_walk_minutes, 0, 720, 0),
      feasible: Boolean(routeMetricsRaw.feasible),
      failureReasons: normalizeStringArray(routeMetricsRaw.failure_reasons),
      optimizedOrderIndices: (Array.isArray(routeMetricsRaw.optimized_order_indices)
        ? routeMetricsRaw.optimized_order_indices
        : []
      )
        .map((value) => Number.parseInt(String(value ?? ""), 10))
        .filter((value) => Number.isFinite(value) && value >= 0),
      optimizedOrderSpotNames: normalizeStringArray(routeMetricsRaw.optimized_order_spot_names),
    },
    routeScore: toBoundedNumber(row.route_score, 0, 1, 0),
    continuityScore: toBoundedNumber(row.continuity_score, 0, 1, 0),
  };
};

const normalizeRuntimeEpisode = (raw: unknown): GeneratedRuntimeEpisode | null => {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const title = clean(typeof row.title === "string" ? row.title : "");
  if (!title) return null;

  const spots = normalizeSpots(row.spots);
  if (spots.length < 1) return null;

  const mainPlotRaw = (row.main_plot && typeof row.main_plot === "object"
    ? (row.main_plot as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const estimated = Number.parseInt(String(row.estimated_duration_minutes ?? 20), 10);
  const patchRaw = (row.progress_patch && typeof row.progress_patch === "object"
    ? (row.progress_patch as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const generationTrace = normalizeRuntimeEpisodeGenerationTrace(row.generation_trace);
  const episodeWorld = normalizeEpisodeWorld(row.episode_world);
  const episodeUniqueCharacters = normalizeEpisodeUniqueCharacters(row.episode_unique_characters);

  const trustDelta = Number.parseInt(String(patchRaw.companion_trust_delta ?? 0), 10);

  return {
    title,
    summary: clean(typeof row.summary === "string" ? row.summary : "") || `${title}の概要`,
    oneLiner: clean(typeof row.one_liner === "string" ? row.one_liner : "") || "",
    mainPlot: {
      premise: clean(typeof mainPlotRaw.premise === "string" ? mainPlotRaw.premise : "") || "",
      goal: clean(typeof mainPlotRaw.goal === "string" ? mainPlotRaw.goal : "") || "",
    },
    characters: normalizeEpisodeCharacters(row.characters),
    episodeWorld,
    episodeUniqueCharacters,
    spots,
    completionCondition:
      clean(typeof row.completion_condition === "string" ? row.completion_condition : "") ||
      "主要スポットで手がかりを得る。",
    carryOverHook:
      clean(typeof row.carry_over_hook === "string" ? row.carry_over_hook : "") ||
      "次回につながる問いが残る。",
    estimatedDurationMinutes: Number.isFinite(estimated) ? Math.max(10, Math.min(45, estimated)) : 20,
    progressPatch: {
      unresolvedThreadsToAdd: normalizeStringArray(patchRaw.unresolved_threads_to_add),
      unresolvedThreadsToRemove: normalizeStringArray(patchRaw.unresolved_threads_to_remove),
      revealedFactsToAdd: normalizeStringArray(patchRaw.revealed_facts_to_add),
      relationshipStateSummary:
        clean(typeof patchRaw.relationship_state_summary === "string" ? patchRaw.relationship_state_summary : "") ||
        "関係性は継続中。",
      relationshipFlagsToAdd: normalizeStringArray(patchRaw.relationship_flags_to_add),
      relationshipFlagsToRemove: normalizeStringArray(patchRaw.relationship_flags_to_remove),
      recentRelationShift: normalizeStringArray(patchRaw.recent_relation_shift),
      companionTrustDelta: Number.isFinite(trustDelta) ? Math.max(-10, Math.min(10, trustDelta)) : undefined,
      nextHook: clean(typeof patchRaw.next_hook === "string" ? patchRaw.next_hook : ""),
    },
    generationTrace,
  };
};

const EPISODE_GENERATION_DEFAULT_TIMEOUT_MS = 600_000;
const EPISODE_GENERATION_DEFAULT_POLL_INTERVAL_MS = 700;

const isRuntimeEpisodeGenerationPhase = (value: string): value is RuntimeEpisodeGenerationPhase =>
  (RUNTIME_EPISODE_GENERATION_PHASES as readonly string[]).includes(value);

const parseJsonSafe = (rawText: string): unknown => {
  try {
    return rawText ? JSON.parse(rawText) : null;
  } catch {
    return null;
  }
};

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const createAbortError = () => {
  const error = new Error("生成を中止しました。");
  (error as Error & { name: string }).name = "AbortError";
  return error;
};

const createRequestTimeoutError = (timeoutMs: number) => {
  const seconds = Math.max(1, Math.floor(timeoutMs / 1000));
  const error = new Error(`通信がタイムアウトしました（${seconds}秒）。`);
  (error as Error & { name: string }).name = "TimeoutError";
  return error;
};

const fetchWithTimeout = async (
  input: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<Response> => {
  if (externalSignal?.aborted) throw createAbortError();
  const controller = new AbortController();
  const boundedMs = Math.max(2_000, timeoutMs);
  let timedOut = false;
  const onAbort = () => controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, boundedMs);

  externalSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (externalSignal?.aborted) throw createAbortError();
    if (timedOut) throw createRequestTimeoutError(boundedMs);
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
};

const isLikelyNetworkError = (error: unknown) => {
  if (error instanceof TypeError) return true;
  const message = clean(error instanceof Error ? error.message : String(error ?? ""));
  return /network request failed|fetch failed|networkerror|failed to fetch/i.test(message);
};

const buildMastraNetworkError = (baseUrl: string, original?: unknown) => {
  const detail = clean(original instanceof Error ? original.message : String(original ?? ""));
  const baseMessage =
    `Mastra APIに接続できません (${baseUrl})。実機の場合は EXPO_PUBLIC_MASTRA_BASE_URL をPCのLAN IPに設定してください。例: http://192.168.x.x:4111`;
  return new Error(detail ? `${baseMessage}\n詳細: ${detail}` : baseMessage);
};

const waitFor = async (ms: number, signal?: AbortSignal) => {
  if (ms <= 0) return;
  if (signal?.aborted) throw createAbortError();

  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };

    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

const normalizeRuntimeEpisodeGenerationEvent = (raw: unknown): RuntimeEpisodeGenerationEvent | null => {
  const row = asObject(raw);
  const phase = clean(typeof row.phase === "string" ? row.phase : "");
  if (!isRuntimeEpisodeGenerationPhase(phase)) return null;

  const spotIndex = Number.parseInt(String(row.spot_index ?? row.spotIndex ?? ""), 10);
  const spotCount = Number.parseInt(String(row.spot_count ?? row.spotCount ?? ""), 10);
  const at = clean(typeof row.at === "string" ? row.at : "") || new Date().toISOString();

  return {
    phase,
    at,
    detail: clean(typeof row.detail === "string" ? row.detail : "") || undefined,
    spotIndex: Number.isFinite(spotIndex) && spotIndex > 0 ? spotIndex : undefined,
    spotCount: Number.isFinite(spotCount) && spotCount > 0 ? spotCount : undefined,
    spotName: clean(typeof row.spot_name === "string" ? row.spot_name : typeof row.spotName === "string" ? row.spotName : "") || undefined,
  };
};

export const generateSeriesEpisodeViaMastra = async (
  payload: GenerateSeriesEpisodeByMastraPayload,
  options: GenerateSeriesEpisodeByMastraOptions = {}
): Promise<GeneratedRuntimeEpisode> => {
  const baseUrl = resolveMastraBaseUrl();
  if (!baseUrl) {
    throw new Error("Mastra API base URL is missing. Set EXPO_PUBLIC_MASTRA_BASE_URL or EXPO_PUBLIC_API_BASE_URL.");
  }

  const timeoutMs = Math.max(30_000, options.timeoutMs ?? EPISODE_GENERATION_DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(250, options.pollIntervalMs ?? EPISODE_GENERATION_DEFAULT_POLL_INTERVAL_MS);
  const requestTimeoutMs = Math.max(8_000, Math.min(45_000, Math.floor(timeoutMs / 8)));

  const characters = payload.series.characters || [];
  if (characters.length === 0) {
    throw new Error(
      "シリーズのキャラクター情報が必須です。シリーズを保存し直してください。"
    );
  }
  const desiredSpotCount = Math.max(
    5,
    Math.min(7, Number.parseInt(String(payload.desiredSpotCount ?? 5), 10) || 5)
  );

  const body = {
    series: {
      title: payload.series.title,
      overview: clean(payload.series.overview || undefined) || undefined,
      premise: clean(payload.series.premise || undefined) || undefined,
      season_goal: clean(payload.series.seasonGoal || undefined) || undefined,
      ai_rules: clean(payload.series.aiRules || undefined) || undefined,
      world_setting: clean(payload.series.worldSetting || undefined) || undefined,
      continuity: payload.series.continuity
        ? {
          global_mystery: clean(payload.series.continuity.globalMystery),
          mid_season_twist: clean(payload.series.continuity.midSeasonTwist),
          finale_payoff: clean(payload.series.continuity.finalePayoff),
          invariant_rules: payload.series.continuity.invariantRules || [],
          episode_link_policy: payload.series.continuity.episodeLinkPolicy || [],
        }
        : undefined,
      progress_state: payload.series.progressState
        ? {
          last_completed_episode_no: payload.series.progressState.lastCompletedEpisodeNo || 0,
          unresolved_threads: payload.series.progressState.unresolvedThreads || [],
          revealed_facts: payload.series.progressState.revealedFacts || [],
          relationship_state_summary: clean(payload.series.progressState.relationshipStateSummary),
          relationship_flags: payload.series.progressState.relationshipFlags || [],
          recent_relation_shift: payload.series.progressState.recentRelationShift || [],
          companion_trust_level: payload.series.progressState.companionTrustLevel,
          next_hook: clean(payload.series.progressState.nextHook),
        }
        : undefined,
      first_episode_seed: payload.series.firstEpisodeSeed
        ? {
          title: clean(payload.series.firstEpisodeSeed.title),
          objective: clean(payload.series.firstEpisodeSeed.objective),
          opening_scene: clean(payload.series.firstEpisodeSeed.openingScene),
          expected_duration_minutes: payload.series.firstEpisodeSeed.expectedDurationMinutes || 20,
          route_style: clean(payload.series.firstEpisodeSeed.routeStyle),
          completion_condition: clean(payload.series.firstEpisodeSeed.completionCondition),
          carry_over_hint: clean(payload.series.firstEpisodeSeed.carryOverHint),
          spot_requirements: (payload.series.firstEpisodeSeed.spotRequirements || []).map((requirement, index) => ({
            requirement_id: clean(requirement.requirementId) || `req_${index + 1}`,
            scene_role: requirement.sceneRole,
            spot_role: clean(requirement.spotRole),
            required_attributes: requirement.requiredAttributes || [],
            visit_constraints: requirement.visitConstraints || [],
            tourism_value_type: clean(requirement.tourismValueType),
          })),
          suggested_spots: payload.series.firstEpisodeSeed.suggestedSpots || [],
        }
        : undefined,
      checkpoints: (payload.series.checkpoints || []).map((checkpoint, index) => ({
        checkpoint_no: checkpoint.checkpointNo || index + 1,
        title: checkpoint.title,
        purpose: clean(checkpoint.purpose),
        unlock_hint: clean(checkpoint.unlockHint),
        carry_over: clean(checkpoint.carryOver),
      })),
      characters: characters.map((character) => ({
        name: character.name,
        role: character.role,
        tier: character.tier || "secondary",
        must_appear: Boolean(character.mustAppear),
        personality: clean(character.personality),
        arc_start: clean(character.arcStart),
        arc_end: clean(character.arcEnd),
      })),
      recent_episodes: (payload.series.recentEpisodes || []).map((episode, index) => ({
        episode_no: episode.episodeNo || index + 1,
        title: episode.title,
        summary: clean(episode.summary),
      })),
    },
    episode_request: {
      stage_location: payload.stageLocation,
      purpose: payload.purpose,
      user_wishes: clean(payload.userWishes) || undefined,
      desired_spot_count: desiredSpotCount,
      desired_duration_minutes: payload.desiredDurationMinutes ?? 20,
      language: clean(payload.language) || "ja",
    },
  };

  const emitProgress = (event: RuntimeEpisodeGenerationEvent) => {
    options.onProgress?.(event);
  };

  const normalizeEpisodeFromResponse = (envelope: unknown) => {
    const payloadObject = asObject(envelope);
    const nestedEpisode = payloadObject.episode;
    const episodeRaw =
      nestedEpisode && typeof nestedEpisode === "object"
        ? (nestedEpisode as Record<string, unknown>)
        : payloadObject;
    const normalized = normalizeRuntimeEpisode(episodeRaw);
    if (!normalized) {
      const title = episodeRaw?.title;
      const spotsLen = Array.isArray(episodeRaw?.spots) ? episodeRaw.spots.length : "not-array";
      console.warn(
        "[seriesAi] Mastra episode normalization failed — title:",
        title,
        "spots:",
        spotsLen,
        "rawKeys:",
        episodeRaw ? Object.keys(episodeRaw) : []
      );
      throw new Error("Mastra episode response does not include valid title/body.");
    }
    return normalized;
  };

  const runLegacyEndpoint = async () => {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${baseUrl}/api/series/episode`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        requestTimeoutMs,
        options.signal
      );
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        throw createAbortError();
      }
      if (fetchError instanceof Error && fetchError.name === "TimeoutError") {
        throw new Error(`Mastra APIの応答がタイムアウトしました（${Math.floor(requestTimeoutMs / 1000)}秒）。`);
      }
      if (isLikelyNetworkError(fetchError)) {
        throw buildMastraNetworkError(baseUrl, fetchError);
      }
      throw fetchError;
    }
    const rawText = await response.text();
    const json = parseJsonSafe(rawText);
    if (!response.ok) {
      const errorBody = json && typeof json === "object" ? JSON.stringify(json) : rawText;
      throw new Error(`Mastra episode generation failed (${response.status}): ${errorBody || "unknown"}`);
    }
    return normalizeEpisodeFromResponse(json);
  };

  let createJobResponse: Response | null = null;
  let createJobRaw = "";
  let createJobJson: unknown = null;
  try {
    createJobResponse = await fetchWithTimeout(
      `${baseUrl}/api/series/episode/jobs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      requestTimeoutMs,
      options.signal
    );
    createJobRaw = await createJobResponse.text();
    createJobJson = parseJsonSafe(createJobRaw);
  } catch (fetchError) {
    if (fetchError instanceof Error && fetchError.name === "AbortError") {
      throw createAbortError();
    }
    if (fetchError instanceof Error && fetchError.name === "TimeoutError") {
      throw new Error(`Mastra APIへの接続がタイムアウトしました（${Math.floor(requestTimeoutMs / 1000)}秒）。`);
    }
    if (isLikelyNetworkError(fetchError)) {
      throw buildMastraNetworkError(baseUrl, fetchError);
    }
    throw fetchError;
  }
  if (!createJobResponse) {
    throw new Error("エピソード生成ジョブの作成レスポンスが取得できませんでした。");
  }

  if (!createJobResponse.ok) {
    if (createJobResponse.status === 404 || createJobResponse.status === 405) {
      return runLegacyEndpoint();
    }
    const errorBody = createJobJson && typeof createJobJson === "object" ? JSON.stringify(createJobJson) : createJobRaw;
    throw new Error(`Mastra episode job creation failed (${createJobResponse.status}): ${errorBody || "unknown"}`);
  }

  const createJobPayload = asObject(createJobJson);
  const jobId = clean(typeof createJobPayload.job_id === "string" ? createJobPayload.job_id : "");
  if (!jobId) {
    return runLegacyEndpoint();
  }

  const initialEvents = Array.isArray(createJobPayload.events) ? createJobPayload.events : [];
  initialEvents.forEach((rawEvent) => {
    const normalized = normalizeRuntimeEpisodeGenerationEvent(rawEvent);
    if (normalized) emitProgress(normalized);
  });

  const nextCursor = Number.parseInt(
    String(createJobPayload.next_cursor ?? createJobPayload.cursor ?? initialEvents.length),
    10
  );
  let cursor = Number.isFinite(nextCursor) && nextCursor >= 0 ? nextCursor : initialEvents.length;

  const pollPath = clean(typeof createJobPayload.poll_path === "string" ? createJobPayload.poll_path : "");
  const pollUrl = pollPath
    ? `${baseUrl}${pollPath.startsWith("/") ? "" : "/"}${pollPath}`
    : `${baseUrl}/api/series/episode/jobs/${encodeURIComponent(jobId)}`;

  const startedAt = Date.now();
  while (true) {
    if (options.signal?.aborted) {
      throw createAbortError();
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`エピソード生成がタイムアウトしました（${Math.floor(timeoutMs / 1000)}秒）。`);
    }

    const separator = pollUrl.includes("?") ? "&" : "?";
    let pollResponse: Response | null = null;
    let pollRaw = "";
    let pollJson: unknown = null;
    try {
      pollResponse = await fetchWithTimeout(
        `${pollUrl}${separator}cursor=${cursor}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        },
        requestTimeoutMs,
        options.signal
      );
      pollRaw = await pollResponse.text();
      pollJson = parseJsonSafe(pollRaw);
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        throw createAbortError();
      }
      if (fetchError instanceof Error && fetchError.name === "TimeoutError") {
        throw new Error(`Mastra APIポーリングがタイムアウトしました（${Math.floor(requestTimeoutMs / 1000)}秒）。`);
      }
      if (isLikelyNetworkError(fetchError)) {
        throw buildMastraNetworkError(baseUrl, fetchError);
      }
      throw fetchError;
    }
    if (!pollResponse) {
      throw new Error("エピソード生成ジョブのポーリングレスポンスが取得できませんでした。");
    }

    if (!pollResponse.ok) {
      const errorBody = pollJson && typeof pollJson === "object" ? JSON.stringify(pollJson) : pollRaw;
      throw new Error(`Mastra episode job polling failed (${pollResponse.status}): ${errorBody || "unknown"}`);
    }

    const pollPayload = asObject(pollJson);
    const events = Array.isArray(pollPayload.events) ? pollPayload.events : [];
    events.forEach((rawEvent) => {
      const normalized = normalizeRuntimeEpisodeGenerationEvent(rawEvent);
      if (normalized) emitProgress(normalized);
    });

    const next = Number.parseInt(String(pollPayload.next_cursor ?? ""), 10);
    if (Number.isFinite(next) && next >= cursor) {
      cursor = next;
    } else {
      cursor += events.length;
    }

    const status = clean(typeof pollPayload.status === "string" ? pollPayload.status : "");
    if (status === "succeeded") {
      return normalizeEpisodeFromResponse(pollJson);
    }
    if (status === "failed") {
      const reason = clean(typeof pollPayload.error === "string" ? pollPayload.error : "") || "Mastra episode generation failed.";
      throw new Error(reason);
    }

    await waitFor(pollIntervalMs, options.signal);
  }
};
