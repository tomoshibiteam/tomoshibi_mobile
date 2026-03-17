import Constants from "expo-constants";
import { NativeModules } from "react-native";

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();
const WALKABLE_WORLD_FALLBACK = "人々の記憶と記録のずれが静かに事件性を生む現代の生活圏";
const INCOMPATIBLE_WORLD_PATTERN =
  /(空中都市|天空都市|浮遊都市|雲上都市|宇宙|月面|火星|宇宙船|海底都市|閉鎖施設|オフィス内(?:だけ|のみ)?|屋内(?:だけ|のみ)?|建物内(?:だけ|のみ)?|社内(?:だけ|のみ)?)/i;
const INCOMPATIBLE_SPOT_PATTERN =
  /(空中都市|天空都市|浮遊都市|宇宙|海底|閉鎖施設|オフィス内(?:だけ|のみ)?|屋内(?:だけ|のみ)?|建物内(?:だけ|のみ)?|社内(?:だけ|のみ)?)/i;
const WALK_ROUTE_PATTERN = /(徒歩|周遊|散策|移動|公共交通|自転車|フェリー|ロープウェイ)/;
const SERIES_META_OUTPUT_PATTERN =
  /(現実拡張型|外出周遊|周遊ミステリー|シリーズ型ミステリー|スポット|2〜4|移動手段|徒歩|公共交通|自転車|フェリー|ロープウェイ|その土地|その地域|各島|島々|離島ごと|島ごと|15〜45分|15〜30分)/;
const TITLE_LOCATION_LOCK_PATTERN =
  /(群島|離島|港町|温泉街|温泉郷|旧市街|城下町|宿場町|商店街|駅前|高架下|団地|海辺|湾岸|岬|渓谷|高原|農村|漁村|村落)/;
const MANDATORY_WALK_RULES = [
  "真相は現実因果で回収し、超常を解決の主因にしない。",
  "固定キャラクターの役割分担と関係変化を継続管理する。",
  "各話で新しい手掛かりか認識更新を最低1つ追加する。",
  "局所事件とシリーズ大謎の接続を少しずつ前進させる。",
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
  if (SERIES_META_OUTPUT_PATTERN.test(normalized)) return WALKABLE_WORLD_FALLBACK;
  return normalized;
};

const ensureWalkRouteStyle = (value?: string | null) => {
  const normalized = clean(value);
  if (normalized && WALK_ROUTE_PATTERN.test(normalized)) return normalized;
  return "現地の自然な移動手段を含む周遊";
};

const ensureWalkSuggestedSpots = (spots: string[], settingHint?: string) => {
  const normalized = dedupeStrings(spots).filter((spot) => !INCOMPATIBLE_SPOT_PATTERN.test(spot));
  if (normalized.length >= 2) return normalized.slice(0, 6);
  const fallback = dedupeStrings([settingHint || "", "半公共の記録確認地点", "導線差を観察できる地点"]).filter(
    (spot) => !INCOMPATIBLE_SPOT_PATTERN.test(spot)
  );
  const merged = dedupeStrings([...normalized, ...fallback]);
  if (merged.length >= 2) return merged.slice(0, 6);
  return ["半公共の記録確認地点", "導線差を観察できる地点"];
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
      spotRole: "証言確認と聞き込みがしやすい接続地点",
      requiredAttributes: ["会話しやすい", "現実的な移動手段で接続可能"],
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
  const filtered = rawLines.filter((line) => !SERIES_META_OUTPUT_PATTERN.test(line));
  const withPrefix = filtered.map((line) => (line.startsWith("-") ? line : `- ${line}`));
  const mandatory = MANDATORY_WALK_RULES.map((rule) => `- ${rule}`);
  return dedupeStrings([...withPrefix, ...mandatory]).join("\n");
};

export type GeneratedSeriesRecentContext = {
  recentTitles?: string[];
  recentCaseMotifs?: string[];
  recentCharacterArchetypes?: string[];
  recentRelationshipPatterns?: string[];
  recentVisualMotifs?: string[];
  recentTruthPatterns?: string[];
  recentCheckpointPatterns?: string[];
  recentFirstEpisodePatterns?: string[];
  recentEnvironmentPatterns?: string[];
  recentAppearancePatterns?: string[];
};

export type GeneratedSeriesMysteryProfile = {
  caseCore: string;
  investigationStyle: string;
  emotionalTone: string;
  duoDynamic: string;
  truthNature: string;
  visualLanguage: string;
  environmentLayer: string;
  differentiationAxes?: string[];
  bannedTemplatesAvoided?: string[];
};

const derivePortableGenre = (
  genre?: string | null,
  mysteryProfile?: GeneratedSeriesMysteryProfile
) => {
  const source = `${clean(genre)} ${clean(mysteryProfile?.caseCore)} ${clean(mysteryProfile?.investigationStyle)} ${clean(
    mysteryProfile?.truthNature
  )}`;
  if (/(記録|改ざん|履歴|台帳)/.test(source)) return "記録反転ミステリー";
  if (/(証言|矛盾|食い違い)/.test(source)) return "証言対立ミステリー";
  if (/(失踪|行方|消失)/.test(source)) return "失踪連作ミステリー";
  if (/(盗難|すり替え|欠落)/.test(source)) return "痕跡追跡ミステリー";
  return "連作ミステリー";
};

const derivePortableTitle = (mysteryProfile?: GeneratedSeriesMysteryProfile) => {
  const emotionalTone = clean(mysteryProfile?.emotionalTone);
  if (/(静|不穏|緊張)/.test(emotionalTone)) return "静かな誤差録";
  if (/(温|余韻|切な)/.test(emotionalTone)) return "余白の記録";
  if (/(知的|乾)/.test(emotionalTone)) return "白日の痕跡";
  return "未解記録譚";
};

const buildPortablePremise = (mysteryProfile?: GeneratedSeriesMysteryProfile) => {
  const duoDynamic = clean(mysteryProfile?.duoDynamic) || "補い合う二人";
  const caseCore = clean(mysteryProfile?.caseCore) || "小さな異変や矛盾";
  const truthNature = clean(mysteryProfile?.truthNature) || "現実因果で説明可能な真相";
  return `${duoDynamic}の関係にある二人が、${caseCore}に見える出来事を追ううちに、${truthNature}へとつながる連鎖に巻き込まれていく。`;
};

const buildPortableOverview = (mysteryProfile?: GeneratedSeriesMysteryProfile) => {
  const investigationStyle = clean(mysteryProfile?.investigationStyle) || "観察と照合";
  return `一見すると個別の案件に見える出来事の背後には、同じ種類の歪みが潜んでいる。二人は${investigationStyle}を重ねながら、見えていた説明が噛み合わなくなる瞬間を拾い上げ、やがて全体を貫く真相へ近づいていく。`;
};

const buildPortableSeasonGoal = (mysteryProfile?: GeneratedSeriesMysteryProfile) => {
  const truthNature = clean(mysteryProfile?.truthNature) || "積み重なる食い違いの先にある真相";
  return `${truthNature}として現れるシリーズ大謎の正体を突き止め、主要人物たちの関係を決定づける選択へ辿り着く。`;
};

const buildPortableGlobalMystery = (mysteryProfile?: GeneratedSeriesMysteryProfile) => {
  const truthNature = clean(mysteryProfile?.truthNature) || "積み重なる違和感の連鎖";
  return `${truthNature}へつながる見落としの正体は何か。`;
};

const buildPortableMidSeasonTwist = () => "中盤で、それまで信じていた説明が別の意味へ反転する。";

const buildPortableFinalePayoff = () => "積み重ねた手掛かりが一つの真相として結び直される。";

const isSeriesMetaLeak = (value?: string | null) => SERIES_META_OUTPUT_PATTERN.test(clean(value));

const sanitizeSeriesField = (
  value: string | null | undefined,
  fallback: string
) => {
  const normalized = clean(value);
  if (!normalized) return fallback;
  if (INCOMPATIBLE_WORLD_PATTERN.test(normalized)) return fallback;
  if (isSeriesMetaLeak(normalized)) return fallback;
  return normalized;
};

const sanitizeSeriesTitle = (value: string | null | undefined, mysteryProfile?: GeneratedSeriesMysteryProfile) => {
  const normalized = clean(value);
  if (!normalized) return derivePortableTitle(mysteryProfile);
  if (isSeriesMetaLeak(normalized)) return derivePortableTitle(mysteryProfile);
  if (TITLE_LOCATION_LOCK_PATTERN.test(normalized)) return derivePortableTitle(mysteryProfile);
  return normalized;
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
  investigationFunction?: string;
  emotionalTemperature?: string;
  relationshipTemperature?: string;
  signatureProp?: string;
  environmentResidue?: string;
  postureGrammar?: string;
  truthProximity?: string;
  hypothesisPressure?: string;
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
  knowledgeGain?: string;
  remainingUnknown?: string;
  nextMoveReason?: string;
};

export type GeneratedSeriesFirstEpisodeSeed = {
  title: string;
  objective: string;
  openingScene: string;
  expectedDurationMinutes: number;
  routeStyle: string;
  movementStyle?: string;
  completionCondition: string;
  carryOverHint: string;
  incitingIncident?: string;
  firstFalseAssumption?: string;
  firstReversal?: string;
  unresolvedHook?: string;
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
  mode: "quality_first" | "single_pass";
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
  mysteryProfile?: GeneratedSeriesMysteryProfile;
  checkpoints?: GeneratedSeriesCheckpoint[];
  firstEpisodeSeed?: GeneratedSeriesFirstEpisodeSeed;
  progressState?: GeneratedSeriesProgressState;
  episodeBlueprints?: GeneratedSeriesEpisodeBlueprint[];
  continuity?: GeneratedSeriesContinuity;
  coverFocusCharacters?: GeneratedSeriesCoverFocusCharacter[];
  identityPack?: GeneratedSeriesIdentityPack;
  coverConsistencyReport?: GeneratedSeriesCoverConsistencyReport;
  workflowVersion?: string;
  // vNext payloads (optional pass-through for continuity-first runtime migration)
  seriesBlueprint?: Record<string, unknown>;
  initialUserSeriesStateTemplate?: Record<string, unknown>;
  episodeRuntimeBootstrapPayload?: Record<string, unknown>;
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
  avatarPrompt?: string;
  avatarImageUrl?: string;
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
  portraitPrompt?: string;
  portraitImageUrl?: string;
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
  coverImagePrompt?: string;
  coverImageUrl?: string;
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
  continuityPatchVNext?: Record<string, unknown>;
  episodeOutputVNext?: Record<string, unknown>;
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
  seriesBlueprint?: Record<string, unknown> | null;
  initialUserSeriesStateTemplate?: Record<string, unknown> | null;
  episodeRuntimeBootstrapPayload?: Record<string, unknown> | null;
  userSeriesState?: Record<string, unknown> | null;
};

export type GenerateSeriesEpisodeByMastraPayload = {
  userId?: string;
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
  "series_context_loaded",
  "continuity_context_built",
  "pipeline_start",
  "fallback_plan_start",
  "fallback_plan_done",
  "episode_plan_start",
  "episode_plan_done",
  "spot_resolution_start",
  "spot_resolution_done",
  "episode_cast_design_start",
  "episode_cast_design_done",
  "scene_generation_start",
  "scene_generation_done",
  "spot_chapter_start",
  "spot_chapter_done",
  "spot_puzzle_start",
  "spot_puzzle_done",
  "episode_character_images_start",
  "episode_character_images_done",
  "episode_cover_image_start",
  "episode_cover_image_done",
  "episode_assemble_start",
  "episode_assemble_done",
  "continuity_patch_build_start",
  "continuity_patch_build_done",
  "response_preparing",
  "completed",
  "episode_visual_finalize_start",
  "episode_visual_finalize_done",
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
  recentGenerationContext?: GeneratedSeriesRecentContext;
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
const SERIES_VNEXT_STRICT =
  clean(process.env.EXPO_PUBLIC_SERIES_VNEXT_STRICT ?? process.env.SERIES_VNEXT_STRICT).toLowerCase() !==
  "false";
const SERIES_VNEXT_LEGACY_FALLBACK_ALLOWED = false;
const SERIES_VNEXT_SYNC_FALLBACK_ALLOWED = false;
const SERIES_RUNTIME_EPISODE_LEGACY_FALLBACK_ALLOWED = false;
const SERIES_VNEXT_REQUEST_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(
    clean(
      process.env.EXPO_PUBLIC_SERIES_VNEXT_REQUEST_TIMEOUT_MS ??
        process.env.SERIES_VNEXT_REQUEST_TIMEOUT_MS
    ),
    10
  );
  if (!Number.isFinite(parsed) || parsed <= 0) return 180_000;
  return parsed;
})();

const isSeriesDraftGenerationPhase = (value: string): value is SeriesDraftGenerationPhase =>
  (SERIES_DRAFT_GENERATION_PHASES as readonly string[]).includes(value);

const normalizeStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((item) => clean(typeof item === "string" ? item : String(item ?? ""))).filter(Boolean);
};
const asStringArray = (value: unknown) => normalizeStringArray(value);

const normalizeMysteryProfile = (raw: unknown): GeneratedSeriesMysteryProfile | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const caseCore = clean(typeof row.case_core === "string" ? row.case_core : "");
  const investigationStyle = clean(typeof row.investigation_style === "string" ? row.investigation_style : "");
  const emotionalTone = clean(typeof row.emotional_tone === "string" ? row.emotional_tone : "");
  const duoDynamic = clean(typeof row.duo_dynamic === "string" ? row.duo_dynamic : "");
  const truthNature = clean(typeof row.truth_nature === "string" ? row.truth_nature : "");
  const visualLanguage = clean(typeof row.visual_language === "string" ? row.visual_language : "");
  const environmentLayer = clean(typeof row.environment_layer === "string" ? row.environment_layer : "");
  if (
    !caseCore &&
    !investigationStyle &&
    !emotionalTone &&
    !duoDynamic &&
    !truthNature &&
    !visualLanguage &&
    !environmentLayer
  ) {
    return undefined;
  }
  return {
    caseCore,
    investigationStyle,
    emotionalTone,
    duoDynamic,
    truthNature,
    visualLanguage,
    environmentLayer,
    differentiationAxes: normalizeStringArray(row.differentiation_axes),
    bannedTemplatesAvoided: normalizeStringArray(row.banned_templates_avoided),
  };
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
        undefined,
      secrets: normalizeStringArray(row.secrets),
      relationshipHooks: normalizeStringArray(row.relationship_hooks),
      investigationFunction:
        clean(typeof row.investigation_function === "string" ? row.investigation_function : undefined) || undefined,
      emotionalTemperature:
        clean(typeof row.emotional_temperature === "string" ? row.emotional_temperature : undefined) || undefined,
      relationshipTemperature:
        clean(typeof row.relationship_temperature === "string" ? row.relationship_temperature : undefined) || undefined,
      signatureProp:
        clean(typeof row.signature_prop === "string" ? row.signature_prop : undefined) || undefined,
      environmentResidue:
        clean(typeof row.environment_residue === "string" ? row.environment_residue : undefined) || undefined,
      postureGrammar:
        clean(typeof row.posture_grammar === "string" ? row.posture_grammar : undefined) || undefined,
      truthProximity:
        clean(typeof row.truth_proximity === "string" ? row.truth_proximity : undefined) || undefined,
      hypothesisPressure:
        clean(typeof row.hypothesis_pressure === "string" ? row.hypothesis_pressure : undefined) || undefined,
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
      knowledgeGain: clean(typeof row.knowledge_gain === "string" ? row.knowledge_gain : undefined) || undefined,
      remainingUnknown:
        clean(typeof row.remaining_unknown === "string" ? row.remaining_unknown : undefined) || undefined,
      nextMoveReason: clean(typeof row.next_move_reason === "string" ? row.next_move_reason : undefined) || undefined,
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
    knowledgeGain: episode.synopsis || undefined,
    remainingUnknown: episode.cliffhanger || undefined,
    nextMoveReason: episode.suggestedMission || undefined,
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
  const mysteryProfile = normalizeMysteryProfile((continuity as Record<string, unknown>).mystery_profile);
  return {
    globalMystery: sanitizeSeriesField(
      typeof continuity.global_mystery === "string" ? continuity.global_mystery : undefined,
      buildPortableGlobalMystery(mysteryProfile)
    ),
    midSeasonTwist: sanitizeSeriesField(
      typeof continuity.mid_season_twist === "string" ? continuity.mid_season_twist : undefined,
      buildPortableMidSeasonTwist()
    ),
    finalePayoff: sanitizeSeriesField(
      typeof continuity.finale_payoff === "string" ? continuity.finale_payoff : undefined,
      buildPortableFinalePayoff()
    ),
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
  const mode: GeneratedSeriesCoverConsistencyReport["mode"] =
    modeRaw === "single_pass" ? "single_pass" : "quality_first";

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
    clean(typeof seed.movement_style === "string" ? seed.movement_style : undefined) ||
      clean(typeof seed.route_style === "string" ? seed.route_style : undefined)
  );
  const suggestedSpots = dedupeStrings([...legacySuggested, ...deriveSuggestedSpotsFromRequirements(spotRequirements)]).slice(0, 6);
  return {
    title: clean(typeof seed.title === "string" ? seed.title : undefined) || "第1話: 旅の始まり",
    objective:
      clean(typeof seed.objective === "string" ? seed.objective : undefined) || "シリーズの目的へ向かう最初の手がかりを得る。",
    openingScene:
      clean(typeof seed.opening_scene === "string" ? seed.opening_scene : undefined) || "外出の導入で小さな違和感に出会う。",
    expectedDurationMinutes,
    routeStyle: ensureWalkRouteStyle(typeof seed.route_style === "string" ? seed.route_style : undefined),
    movementStyle: clean(typeof seed.movement_style === "string" ? seed.movement_style : undefined) || undefined,
    completionCondition:
      clean(typeof seed.completion_condition === "string" ? seed.completion_condition : undefined) ||
      "主要スポットで発見を得る。",
    carryOverHint:
      clean(typeof seed.carry_over_hint === "string" ? seed.carry_over_hint : undefined) || "次回に続く問いが残る。",
    incitingIncident: clean(typeof seed.inciting_incident === "string" ? seed.inciting_incident : undefined) || undefined,
    firstFalseAssumption:
      clean(typeof seed.first_false_assumption === "string" ? seed.first_false_assumption : undefined) || undefined,
    firstReversal: clean(typeof seed.first_reversal === "string" ? seed.first_reversal : undefined) || undefined,
    unresolvedHook: clean(typeof seed.unresolved_hook === "string" ? seed.unresolved_hook : undefined) || undefined,
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

const mapVNextSceneRoleToLegacy = (value: string): GeneratedSeriesCheckpoint["expectedEmotion"] => {
  const normalized = clean(value);
  if (normalized === "opening") return "期待";
  if (normalized === "turning_point") return "緊張";
  if (normalized === "pre-ending") return "高揚";
  if (normalized === "ending") return "余韻";
  return "発見";
};

const normalizeDraftFromVNextResponse = (
  envelope: unknown,
  fallback: GenerateSeriesByMastraPayload
): GeneratedSeriesDraft | null => {
  const payloadObject = asObject(envelope);
  const blueprint = asObject(payloadObject.seriesBlueprint);
  const visualBundle = asObject(payloadObject.visualBundle);
  const concept = asObject(blueprint.concept);
  const narrative = asObject(blueprint.narrative);
  const worldRules = asObject(blueprint.worldRules);
  const continuityContract = asObject(blueprint.continuityContract);
  const identityPackRaw = asObject(blueprint.identityPack);
  const firstEpisodeSeedRaw = asObject(blueprint.firstEpisodeSeed);
  const initialTemplate = asObject(payloadObject.initialUserSeriesStateTemplate);

  const oneLineHook = clean(typeof concept.oneLineHook === "string" ? concept.oneLineHook : "");
  const premise = clean(typeof concept.premise === "string" ? concept.premise : "");
  const worldviewCore = clean(typeof concept.worldviewCore === "string" ? concept.worldviewCore : "");
  const mysteryProfile = normalizeMysteryProfile(concept.mysteryProfile);
  const title = sanitizeSeriesTitle(typeof concept.title === "string" ? concept.title : "", mysteryProfile);
  if (!title) return null;
  const sanitizedPremise = sanitizeSeriesField(premise, buildPortablePremise(mysteryProfile));
  const sanitizedOverview = sanitizeSeriesField(oneLineHook || premise, buildPortableOverview(mysteryProfile));
  const sanitizedGenre = sanitizeSeriesField(
    normalizeStringArray(concept.genreAxes)[0] || clean(fallback.interview.genreWorld),
    derivePortableGenre(clean(fallback.interview.genreWorld), mysteryProfile)
  );
  const sanitizedSeasonGoal = sanitizeSeriesField(
    clean(typeof narrative.longArcGoal === "string" ? narrative.longArcGoal : ""),
    buildPortableSeasonGoal(mysteryProfile)
  );
  const sanitizedWorldSetting = sanitizeSeriesField(worldviewCore, WALKABLE_WORLD_FALLBACK);

  const hardRules = normalizeStringArray(worldRules.hardRules);
  const mandatoryCallbacks = normalizeStringArray(continuityContract.mandatoryCallbackTypes);
  const aiRules = ensureWalkAiRules(
    [...hardRules, ...mandatoryCallbacks].map((line) => `- ${line}`).join("\n")
  );

  const visualCharactersRaw = Array.isArray(visualBundle.characters) ? visualBundle.characters : [];
  const visualCharacters = visualCharactersRaw
    .map((item, index) => {
      const row = asObject(item);
      const characterId = clean(typeof row.characterId === "string" ? row.characterId : "");
      const displayName = clean(typeof row.displayName === "string" ? row.displayName : "");
      const portraitPrompt = clean(typeof row.portraitPrompt === "string" ? row.portraitPrompt : "") || undefined;
      const portraitImageUrl =
        normalizeMediaUrlForClient(typeof row.portraitImageUrl === "string" ? row.portraitImageUrl : "") || undefined;
      if (!characterId && !displayName && !portraitPrompt && !portraitImageUrl) return null;
      return {
        characterId: characterId || `char_${index + 1}`,
        displayName: displayName || "",
        portraitPrompt,
        portraitImageUrl,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const visualCharacterById = new Map(visualCharacters.map((row) => [row.characterId, row]));
  const visualCharacterByName = new Map(
    visualCharacters
      .map((row) => [row.displayName.toLowerCase(), row] as const)
      .filter(([key]) => Boolean(key))
  );

  const vNextCharactersRaw = Array.isArray(blueprint.characters) ? blueprint.characters : [];
  const characters = vNextCharactersRaw
    .map((item, index) => {
      const row = asObject(item);
      const identity = asObject(row.identity);
      const usageRules = asObject(row.usageRules);
      const relationshipDesign = asObject(row.relationshipDesign);
      const hooks = asObject(row.recurringHooks);
      const name = clean(typeof row.displayName === "string" ? row.displayName : "");
      if (!name) return null;
      const characterId = clean(typeof row.id === "string" ? row.id : "") || `char_${index + 1}`;
      const visual =
        visualCharacterById.get(characterId) ||
        visualCharacterByName.get(name.toLowerCase()) ||
        undefined;
      const mustAppearFrequency = clean(
        typeof usageRules.mustAppearFrequency === "string" ? usageRules.mustAppearFrequency : ""
      );
      return {
        id: characterId,
        name,
        role:
          clean(typeof row.coreFunctionInSeries === "string" ? row.coreFunctionInSeries : "") ||
          clean(typeof row.role === "string" ? row.role : "") ||
          "同行者",
        tier: mustAppearFrequency === "every_episode" ? "primary" : "secondary",
        mustAppear: mustAppearFrequency === "every_episode",
        archetype: clean(typeof row.archetype === "string" ? row.archetype : "") || undefined,
        personality: dedupeStrings([
          ...normalizeStringArray(identity.immutableTraits),
          ...normalizeStringArray(identity.mutableTraits),
        ]).join(" / "),
        goal:
          clean(typeof identity.motivationCore === "string" ? identity.motivationCore : "") ||
          undefined,
        arcStart:
          clean(typeof relationshipDesign.initialDistanceToUser === "string"
            ? relationshipDesign.initialDistanceToUser
            : "") || undefined,
        arcEnd:
          clean(typeof relationshipDesign.expectedArcWithUser === "string"
            ? relationshipDesign.expectedArcWithUser
            : "") || undefined,
        relationshipHooks: normalizeStringArray(hooks.conversationalHooks),
        secrets: normalizeStringArray(usageRules.cannotContradict),
        relationshipTemperature:
          clean(typeof (row as Record<string, unknown>).relationshipTemperature === "string"
            ? (row as Record<string, unknown>).relationshipTemperature as string
            : "") || undefined,
        signatureProp:
          clean(typeof (row as Record<string, unknown>).signatureProp === "string"
            ? (row as Record<string, unknown>).signatureProp as string
            : "") || undefined,
        environmentResidue:
          clean(typeof (row as Record<string, unknown>).environmentResidue === "string"
            ? (row as Record<string, unknown>).environmentResidue as string
            : "") || undefined,
        postureGrammar:
          clean(typeof (row as Record<string, unknown>).postureGrammar === "string"
            ? (row as Record<string, unknown>).postureGrammar as string
            : "") || undefined,
        portraitPrompt: visual?.portraitPrompt,
        portraitImageUrl: visual?.portraitImageUrl || undefined,
      } satisfies GeneratedSeriesCharacter;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const vNextCheckpointsRaw = Array.isArray(blueprint.checkpoints) ? blueprint.checkpoints : [];
  const checkpoints: GeneratedSeriesCheckpoint[] = vNextCheckpointsRaw.reduce<GeneratedSeriesCheckpoint[]>(
    (acc, item, index) => {
      const row = asObject(item);
      const label = clean(typeof row.label === "string" ? row.label : "");
      if (!label) return acc;
      const checkpointNo = Number.parseInt(String(row.index ?? index), 10);
      acc.push({
        checkpointNo: Number.isFinite(checkpointNo) ? checkpointNo + 1 : index + 1,
        title: label,
        purpose: clean(typeof row.narrativePurpose === "string" ? row.narrativePurpose : "") || "",
        unlockHint: normalizeStringArray(row.requiredProgressConditions).join(" / "),
        expectedEmotion:
          normalizeStringArray(row.expectedUserEmotion)[0] ||
          mapVNextSceneRoleToLegacy(clean(typeof row.roleInArc === "string" ? row.roleInArc : "")),
        carryOver: normalizeStringArray(row.mustRememberAfterPassing).join(" / "),
        knowledgeGain: clean(typeof row.narrativePurpose === "string" ? row.narrativePurpose : "") || undefined,
        remainingUnknown: normalizeStringArray(row.requiredCallbackKinds).join(" / ") || undefined,
        nextMoveReason: normalizeStringArray(row.requiredProgressConditions).join(" / ") || undefined,
      });
      return acc;
    },
    []
  );

  const seedSpotTypes = normalizeStringArray(firstEpisodeSeedRaw.suggestedPlaceTypes);
  const handoffNotes = normalizeStringArray(firstEpisodeSeedRaw.handoffNotesForEpisodeRuntime);
  const firstEpisodeSeed: GeneratedSeriesFirstEpisodeSeed = {
    title: `${title} 第1話`,
    objective: clean(typeof firstEpisodeSeedRaw.purpose === "string" ? firstEpisodeSeedRaw.purpose : "") || "導入",
    openingScene:
      clean(typeof firstEpisodeSeedRaw.openingSituation === "string" ? firstEpisodeSeedRaw.openingSituation : "") ||
      "旅の入口で違和感と出会う",
    expectedDurationMinutes: 20,
    routeStyle: "現地の自然な移動手段を含む周遊",
    movementStyle: handoffNotes.find((note) => /移動|徒歩|公共交通|自転車|フェリー|ロープウェイ/.test(note)),
    completionCondition:
      clean(typeof firstEpisodeSeedRaw.whyGoThereLogic === "string" ? firstEpisodeSeedRaw.whyGoThereLogic : "") ||
      "主要スポットで手がかりを得る。",
    carryOverHint: normalizeStringArray(asObject(firstEpisodeSeedRaw.foreshadowingPlan).seed)[0] || "次話に続く問いが残る。",
    incitingIncident:
      handoffNotes.find((note) => /きっかけ|incident|異変|依頼|発端/.test(note)) || "現地で小さな異変が発生する。",
    firstFalseAssumption:
      handoffNotes.find((note) => /誤認|仮説|assumption/.test(note)) || "最初の見立てが後で揺らぐ。",
    firstReversal:
      handoffNotes.find((note) => /反転|reversal|矛盾/.test(note)) || "別地点の情報で認識が反転する。",
    unresolvedHook:
      normalizeStringArray(asObject(firstEpisodeSeedRaw.foreshadowingPlan).seed)[0] || "回収しきれない問いが残る。",
    spotRequirements: normalizeSpotRequirements(
      seedSpotTypes.map((spotRole, index) => ({
        requirement_id: `req_${index + 1}`,
        scene_role: sceneRoleForIndex(index, Math.max(seedSpotTypes.length, 2)),
        spot_role: spotRole,
        required_attributes: [],
        visit_constraints: [],
        tourism_value_type: "地域体験",
      })),
      worldviewCore
    ),
    suggestedSpots: ensureWalkSuggestedSpots(seedSpotTypes, worldviewCore),
  };

  const currentProgress = asObject(initialTemplate.currentProgress);
  const progressState: GeneratedSeriesProgressState = {
    lastCompletedEpisodeNo: Number.parseInt(String(currentProgress.episodeCountCompleted ?? 0), 10) || 0,
    unresolvedThreads: normalizeStringArray(currentProgress.unresolvedThreads),
    revealedFacts: normalizeStringArray(currentProgress.resolvedThreads),
    relationshipStateSummary: "主要キャラクターとの関係は導入段階。",
    relationshipFlags: [],
    recentRelationShift: [],
    companionTrustLevel: 40,
    nextHook: normalizeStringArray(currentProgress.activeForeshadowing)[0] || "",
  };

  const nonNegotiableTheme = normalizeStringArray(asObject(identityPackRaw.seriesCoreAnchors).nonNegotiableTheme);
  const identityCharacterAnchors = Array.isArray(identityPackRaw.characterAnchors)
    ? identityPackRaw.characterAnchors
    : [];
  const keyPersonCharacterIds = characters
    .filter((character) => character.mustAppear)
    .map((character) => character.id || "")
    .filter(Boolean)
    .slice(0, 3);
  const identityPack: GeneratedSeriesIdentityPack | undefined =
    keyPersonCharacterIds.length > 0
      ? {
          version: Number.parseInt(String(blueprint.version ?? 1), 10) || 1,
          source: "generated",
          styleBible: nonNegotiableTheme.join(" / ") || "continuity-first",
          keyPersonCharacterIds,
          characters: characters.slice(0, 8).map((character) => {
            const anchor = identityCharacterAnchors.find((item) => {
              const row = asObject(item);
              return clean(typeof row.characterId === "string" ? row.characterId : "") === character.id;
            });
            const anchorRow = asObject(anchor);
            return {
              characterId: character.id || "",
              name: character.name,
              role: character.role,
              isKeyPerson: keyPersonCharacterIds.includes(character.id || ""),
              identityAnchorTokens: {
                hair: "特徴的な髪型",
                silhouette: "印象的なシルエット",
                dominantColor: "アクセントカラー",
                outfitKeyItem: "象徴アイテム",
                distinguishingFeature:
                  clean(typeof anchorRow.anchorSummary === "string" ? anchorRow.anchorSummary : "") || "印象的な特徴",
              },
            };
          }),
          lockedAt: clean(typeof blueprint.origin === "object" ? asObject(blueprint.origin).generatedAt as string : "") || new Date().toISOString(),
        }
      : undefined;

  const worldVisualAssets = Array.isArray(visualBundle.worldVisualAssets)
    ? visualBundle.worldVisualAssets.reduce<
      Array<{
        id: string;
        title: string;
        description: string;
        prompt?: string;
        imageUrl?: string;
      }>
    >((acc, item, index) => {
      const row = asObject(item);
      const id = clean(typeof row.id === "string" ? row.id : "") || `world_${index + 1}`;
      const title = clean(typeof row.title === "string" ? row.title : "");
      const description = clean(typeof row.description === "string" ? row.description : "");
      const prompt = clean(typeof row.prompt === "string" ? row.prompt : "") || undefined;
      const imageUrl =
        normalizeMediaUrlForClient(typeof row.imageUrl === "string" ? row.imageUrl : "") || undefined;
      if (!title && !description && !prompt && !imageUrl) return acc;
      acc.push({
        id,
        title: title || `世界観ビジュアル ${index + 1}`,
        description: description || "世界観の雰囲気を示すビジュアル。",
        prompt,
        imageUrl,
      });
      return acc;
    }, [])
    : [];
  const coverImagePrompt =
    clean(typeof visualBundle.coverImagePrompt === "string" ? visualBundle.coverImagePrompt : "") || undefined;
  const coverImageUrl =
    normalizeMediaUrlForClient(typeof visualBundle.coverImageUrl === "string" ? visualBundle.coverImageUrl : "") ||
    undefined;
  const coverConsistencyReport = normalizeCoverConsistencyReport(visualBundle.coverConsistencyReport);

  return {
    title,
    overview: sanitizedOverview || "概要を生成できませんでした。",
    aiRules,
    characters: characters.length > 0 ? characters : [],
    coverImagePrompt,
    coverImageUrl,
    genre: sanitizedGenre || undefined,
    tone: normalizeStringArray(concept.toneKeywords)[0] || clean(fallback.interview.desiredEmotion) || undefined,
    premise: sanitizedPremise || undefined,
    seasonGoal: sanitizedSeasonGoal || undefined,
    mysteryProfile,
    world: {
      visualAssets: worldVisualAssets,
      setting: sanitizedWorldSetting,
      coreConflict:
        clean(typeof narrative.coreMysteryOrDrive === "string" ? narrative.coreMysteryOrDrive : "") || undefined,
      recurringMotifs: normalizeStringArray(concept.aestheticKeywords),
      tabooRules: normalizeStringArray(worldRules.forbiddenBreaks),
    },
    checkpoints,
    firstEpisodeSeed,
    progressState,
    continuity: {
      globalMystery: sanitizeSeriesField(
        typeof narrative.coreMysteryOrDrive === "string" ? narrative.coreMysteryOrDrive : "",
        buildPortableGlobalMystery(mysteryProfile)
      ),
      finalePayoff: sanitizeSeriesField(
        typeof narrative.plannedEnding === "string" ? narrative.plannedEnding : "",
        buildPortableFinalePayoff()
      ),
      invariantRules: hardRules,
      episodeLinkPolicy: normalizeStringArray(continuityContract.mandatoryCallbackTypes),
    },
    coverFocusCharacters: characters.slice(0, 3).map((character) => ({
      characterId: character.id || "",
      name: character.name,
      role: character.role,
      focusReason: "継続話での中心人物",
      visualAnchor: character.personality || "印象的な佇まい",
    })),
    identityPack,
    coverConsistencyReport,
    workflowVersion:
      clean(typeof payloadObject.workflowVersion === "string" ? payloadObject.workflowVersion : "") || undefined,
    seriesBlueprint: payloadObject.seriesBlueprint as Record<string, unknown>,
    initialUserSeriesStateTemplate:
      payloadObject.initialUserSeriesStateTemplate as Record<string, unknown>,
    episodeRuntimeBootstrapPayload:
      payloadObject.episodeRuntimeBootstrapPayload as Record<string, unknown>,
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
  const vNextRequestTimeoutMs = Math.max(
    30_000,
    Math.min(300_000, Math.max(Math.floor(timeoutMs / 2), SERIES_VNEXT_REQUEST_TIMEOUT_MS))
  );

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
    recent_generation_context: payload.recentGenerationContext
      ? {
          recent_titles: dedupeStrings(payload.recentGenerationContext.recentTitles || []),
          recent_case_motifs: dedupeStrings(payload.recentGenerationContext.recentCaseMotifs || []),
          recent_character_archetypes: dedupeStrings(
            payload.recentGenerationContext.recentCharacterArchetypes || []
          ),
          recent_relationship_patterns: dedupeStrings(
            payload.recentGenerationContext.recentRelationshipPatterns || []
          ),
          recent_visual_motifs: dedupeStrings(payload.recentGenerationContext.recentVisualMotifs || []),
          recent_truth_patterns: dedupeStrings(payload.recentGenerationContext.recentTruthPatterns || []),
          recent_checkpoint_patterns: dedupeStrings(
            payload.recentGenerationContext.recentCheckpointPatterns || []
          ),
          recent_first_episode_patterns: dedupeStrings(
            payload.recentGenerationContext.recentFirstEpisodePatterns || []
          ),
          recent_environment_patterns: dedupeStrings(
            payload.recentGenerationContext.recentEnvironmentPatterns || []
          ),
          recent_appearance_patterns: dedupeStrings(
            payload.recentGenerationContext.recentAppearancePatterns || []
          ),
        }
      : undefined,
  };

  const emitProgress = (event: SeriesDraftGenerationEvent) => {
    options.onProgress?.(event);
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

  const normalizeDraftFromResponse = (json: unknown): GeneratedSeriesDraft => {
    const payloadObject = (json && typeof json === "object" ? (json as Record<string, unknown>) : null) || {};
    const vNextDraft = normalizeDraftFromVNextResponse(payloadObject, payload);
    if (vNextDraft) return vNextDraft;
    const seriesRaw = (payloadObject.series as Record<string, unknown> | undefined) || payloadObject;
    const metaRaw = (payloadObject.meta as Record<string, unknown> | undefined) || null;

    const mysteryProfile = normalizeMysteryProfile(seriesRaw.mystery_profile);
    const title = sanitizeSeriesTitle(
      typeof seriesRaw.title === "string" ? seriesRaw.title : undefined,
      mysteryProfile
    );
    const rawOverview =
      clean(typeof seriesRaw.overview === "string" ? seriesRaw.overview : undefined) ||
      clean(typeof seriesRaw.premise === "string" ? seriesRaw.premise : undefined) ||
      "概要を生成できませんでした。";
    const overview = sanitizeSeriesField(rawOverview, buildPortableOverview(mysteryProfile));
    const aiRules = ensureWalkAiRules(typeof seriesRaw.ai_rules === "string" ? seriesRaw.ai_rules : undefined);
    const sanitizedGenre = sanitizeSeriesField(
      typeof seriesRaw.genre === "string" ? seriesRaw.genre : undefined,
      derivePortableGenre(typeof seriesRaw.genre === "string" ? seriesRaw.genre : undefined, mysteryProfile)
    );
    const sanitizedPremise = sanitizeSeriesField(
      typeof seriesRaw.premise === "string" ? seriesRaw.premise : undefined,
      buildPortablePremise(mysteryProfile)
    );
    const sanitizedSeasonGoal = sanitizeSeriesField(
      typeof seriesRaw.season_goal === "string" ? seriesRaw.season_goal : undefined,
      buildPortableSeasonGoal(mysteryProfile)
    );

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
        undefined,
      genre: sanitizedGenre || undefined,
      tone: clean(typeof seriesRaw.tone === "string" ? seriesRaw.tone : undefined) || undefined,
      premise: sanitizedPremise || undefined,
      seasonGoal: sanitizedSeasonGoal || undefined,
      mysteryProfile,
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
            openingScene: checkpoints[0].unlockHint || "外出の導入で小さな違和感に出会う。",
            expectedDurationMinutes: 20,
            routeStyle: "現地の自然な移動手段を含む周遊",
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

  const runVNextEndpoint = async (): Promise<GeneratedSeriesDraft> => {
    const rawRequest = {
      userId: isUuid(payload.creatorId) ? payload.creatorId : undefined,
      interview: dedupeStrings([
        payload.interview.genreWorld,
        payload.interview.desiredEmotion,
        payload.interview.companionPreference,
        payload.interview.continuationTrigger,
        payload.interview.avoidExpressions,
        payload.interview.additionalNotes || "",
      ]).join(" / "),
      prompt: clean(payload.prompt) || undefined,
      desiredEpisodeLimit: payload.desiredEpisodeCount,
      explicitGenreHints: dedupeStrings([payload.interview.genreWorld]).filter(Boolean),
      excludedDirections: dedupeStrings(
        clean(payload.interview.avoidExpressions)
          .split(/[／/、,]/)
          .map((item) => clean(item))
          .filter(Boolean)
      ),
      safetyPreferences: [],
      recentTitles: dedupeStrings(payload.recentGenerationContext?.recentTitles || []),
      recentCaseMotifs: dedupeStrings(payload.recentGenerationContext?.recentCaseMotifs || []),
      recentCharacterArchetypes: dedupeStrings(
        payload.recentGenerationContext?.recentCharacterArchetypes || []
      ),
      recentRelationshipPatterns: dedupeStrings(
        payload.recentGenerationContext?.recentRelationshipPatterns || []
      ),
      recentVisualMotifs: dedupeStrings(payload.recentGenerationContext?.recentVisualMotifs || []),
      recentTruthPatterns: dedupeStrings(payload.recentGenerationContext?.recentTruthPatterns || []),
      recentCheckpointPatterns: dedupeStrings(
        payload.recentGenerationContext?.recentCheckpointPatterns || []
      ),
      recentFirstEpisodePatterns: dedupeStrings(
        payload.recentGenerationContext?.recentFirstEpisodePatterns || []
      ),
      recentEnvironmentPatterns: dedupeStrings(
        payload.recentGenerationContext?.recentEnvironmentPatterns || []
      ),
      recentAppearancePatterns: dedupeStrings(
        payload.recentGenerationContext?.recentAppearancePatterns || []
      ),
    };

    const runVNextSyncFallback = async (): Promise<GeneratedSeriesDraft> => {
      const response = await fetchWithTimeout(
        `${baseUrl}/api/series/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(rawRequest),
        },
        vNextRequestTimeoutMs,
        options.signal
      );
      const rawText = await response.text();
      const json = parseJsonSafe(rawText);
      if (!response.ok) {
        if (response.status === 404 || response.status === 405) {
          throw new Error("vnext_endpoint_not_available");
        }
        const errMsg =
          json && typeof json === "object" && json !== null && "error" in json
            ? String((json as { error?: unknown }).error || "")
            : rawText || `HTTP ${response.status}`;
        throw new Error(errMsg || "vNextシリーズ生成に失敗しました。");
      }

      const normalized = normalizeDraftFromVNextResponse(json, payload);
      if (!normalized || !Array.isArray(normalized.characters) || normalized.characters.length === 0) {
        throw new Error("vnext_response_normalization_failed");
      }
      return normalized;
    };

    let createJobResponse: Response | null = null;
    let createJobRaw = "";
    let createJobJson: unknown = null;
    try {
      createJobResponse = await fetchWithTimeout(
        `${baseUrl}/api/series/generate/jobs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(rawRequest),
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
      throw new Error("vNextシリーズ生成ジョブ作成レスポンスが取得できませんでした。");
    }

    if (!createJobResponse.ok) {
      if (createJobResponse.status === 404 || createJobResponse.status === 405) {
        if (SERIES_VNEXT_SYNC_FALLBACK_ALLOWED) {
          return runVNextSyncFallback();
        }
        throw new Error("vNextシリーズ生成ジョブAPIが利用できません。");
      }
      const errMsg =
        createJobJson && typeof createJobJson === "object" && "error" in createJobJson
          ? String((createJobJson as { error?: unknown }).error || "")
          : createJobRaw || `HTTP ${createJobResponse.status}`;
      throw new Error(errMsg || "vNextシリーズ生成ジョブの作成に失敗しました。");
    }

    const createJobPayload = asObject(createJobJson);
    const jobId = clean(
      typeof createJobPayload.job_id === "string"
        ? createJobPayload.job_id
        : typeof createJobPayload.jobId === "string"
          ? createJobPayload.jobId
          : ""
    );
    if (!jobId) {
      if (SERIES_VNEXT_SYNC_FALLBACK_ALLOWED) {
        return runVNextSyncFallback();
      }
      throw new Error("vNextシリーズ生成ジョブIDが取得できませんでした。");
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

    const pollPath = clean(
      typeof createJobPayload.poll_path === "string"
        ? createJobPayload.poll_path
        : typeof createJobPayload.pollPath === "string"
          ? createJobPayload.pollPath
          : ""
    );
    const pollUrl = pollPath
      ? `${baseUrl}${pollPath.startsWith("/") ? "" : "/"}${pollPath}`
      : `${baseUrl}/api/series/generate/jobs/${encodeURIComponent(jobId)}`;

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
        throw new Error("vNextシリーズ生成ジョブのポーリングレスポンスが取得できませんでした。");
      }

      if (!pollResponse.ok) {
        const errMsg =
          pollJson && typeof pollJson === "object" && "error" in pollJson
            ? String((pollJson as { error?: unknown }).error || "")
            : pollRaw || `HTTP ${pollResponse.status}`;
        throw new Error(errMsg || "vNextシリーズ生成ジョブの取得に失敗しました。");
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
      if (status === "completed" || status === "succeeded") {
        const normalized =
          normalizeDraftFromVNextResponse(asObject(pollPayload.result), payload) ||
          normalizeDraftFromVNextResponse(pollPayload, payload);
        if (!normalized || !Array.isArray(normalized.characters) || normalized.characters.length === 0) {
          throw new Error("vnext_response_normalization_failed");
        }
        return normalized;
      }
      if (status === "failed") {
        const reason = clean(typeof pollPayload.error === "string" ? pollPayload.error : "") || "vNextシリーズ生成に失敗しました。";
        throw new Error(reason);
      }

      await waitFor(pollIntervalMs, options.signal);
    }
  };

  try {
    emitProgress({ phase: "request_received", at: new Date().toISOString(), detail: "シリーズ生成リクエストを受領" });
    emitProgress({ phase: "input_validated", at: new Date().toISOString(), detail: "入力スキーマ検証を完了" });
    const vNext = await runVNextEndpoint();
    emitProgress({ phase: "completed", at: new Date().toISOString(), detail: "vNextシリーズ生成が完了" });
    return vNext;
  } catch (vNextError) {
    const message = clean(vNextError instanceof Error ? vNextError.message : String(vNextError));
    if (SERIES_VNEXT_STRICT || !SERIES_VNEXT_LEGACY_FALLBACK_ALLOWED) {
      console.warn("[seriesAi] vNext series generate failed (no-fallback mode):", message);
      throw new Error(message || "vNextシリーズ生成に失敗しました。");
    }
    if (message !== "vnext_endpoint_not_available") {
      console.warn("[seriesAi] vNext series generate fallback to legacy:", message);
    }
  }

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
      if (SERIES_VNEXT_LEGACY_FALLBACK_ALLOWED) {
        return runLegacyEndpoint();
      }
      throw new Error("シリーズ生成ジョブAPIが利用できません。");
    }
    const errMsg =
      createJobJson && typeof createJobJson === "object" && "error" in createJobJson
        ? String((createJobJson as { error?: unknown }).error || "")
        : createJobRaw || `HTTP ${createJobResponse.status}`;
    throw new Error(errMsg || "シリーズ生成ジョブの作成に失敗しました。");
  }

  const createJobPayload = asObject(createJobJson);
  const jobId = clean(
    typeof createJobPayload.job_id === "string"
      ? createJobPayload.job_id
      : typeof createJobPayload.jobId === "string"
        ? createJobPayload.jobId
        : ""
  );
  if (!jobId) {
    if (SERIES_VNEXT_LEGACY_FALLBACK_ALLOWED) {
      return runLegacyEndpoint();
    }
    throw new Error("シリーズ生成ジョブIDが取得できませんでした。");
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

  const pollPath = clean(
    typeof createJobPayload.poll_path === "string"
      ? createJobPayload.poll_path
      : typeof createJobPayload.pollPath === "string"
        ? createJobPayload.pollPath
        : ""
  );
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
    if (status === "succeeded" || status === "completed") {
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
      ...(clean(c.avatar_prompt || c.avatarPrompt)
        ? { avatarPrompt: clean(c.avatar_prompt || c.avatarPrompt) }
        : {}),
      ...(normalizeMediaUrlForClient(c.avatar_image_url || c.avatarImageUrl)
        ? { avatarImageUrl: normalizeMediaUrlForClient(c.avatar_image_url || c.avatarImageUrl) }
        : {}),
    }));
};

const normalizeEpisodeWorld = (raw: unknown): EpisodeWorld => {
  const row = asObject(raw);
  return {
    title: clean(typeof row.title === "string" ? row.title : "") || "今回の旅の章",
    mood: clean(typeof row.mood === "string" ? row.mood : "") || "発見と余韻",
    atmosphere:
      clean(typeof row.atmosphere === "string" ? row.atmosphere : "") ||
      "現実の外出先を巡りながら物語を体験する",
    sensoryKeywords: normalizeStringArray(row.sensory_keywords).slice(0, 8),
    storyAxis:
      clean(typeof row.story_axis === "string" ? row.story_axis : "") ||
      "複数地点の断片情報を繋ぎ次話へ進む",
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
    .map((item, index): EpisodeUniqueCharacter | null => {
      const row = asObject(item);
      const name = clean(typeof row.name === "string" ? row.name : "");
      const role = clean(typeof row.role === "string" ? row.role : "");
      if (!name || !role) return null;
      const normalized: EpisodeUniqueCharacter = {
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
      };
      const portraitPrompt =
        clean(
          typeof row.portrait_prompt === "string"
            ? row.portrait_prompt
            : typeof row.portraitPrompt === "string"
              ? row.portraitPrompt
              : ""
        ) || "";
      if (portraitPrompt) {
        normalized.portraitPrompt = portraitPrompt;
      }
      const portraitImageUrl =
        normalizeMediaUrlForClient(
          typeof row.portrait_image_url === "string"
            ? row.portrait_image_url
            : typeof row.portraitImageUrl === "string"
              ? row.portraitImageUrl
              : ""
        ) || "";
      if (portraitImageUrl) {
        normalized.portraitImageUrl = portraitImageUrl;
      }
      return normalized;
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
  const coverImagePrompt =
    clean(
      typeof row.cover_image_prompt === "string"
        ? row.cover_image_prompt
        : typeof row.coverImagePrompt === "string"
          ? row.coverImagePrompt
          : ""
    ) || undefined;
  const coverImageUrl =
    normalizeMediaUrlForClient(
      typeof row.cover_image_url === "string"
        ? row.cover_image_url
        : typeof row.coverImageUrl === "string"
          ? row.coverImageUrl
          : typeof row.episode_cover_image_url === "string"
            ? row.episode_cover_image_url
            : typeof row.episodeCoverImageUrl === "string"
              ? row.episodeCoverImageUrl
              : ""
    ) || undefined;

  const trustDelta = Number.parseInt(String(patchRaw.companion_trust_delta ?? 0), 10);

  return {
    title,
    summary: clean(typeof row.summary === "string" ? row.summary : "") || `${title}の概要`,
    oneLiner: clean(typeof row.one_liner === "string" ? row.one_liner : "") || "",
    coverImagePrompt,
    coverImageUrl,
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

const vNextSceneRoleToLegacy = (value: string): EpisodeSpot["sceneRole"] => {
  const normalized = clean(value);
  if (normalized === "opening") return "起";
  if (normalized === "ending") return "結";
  if (normalized === "turn") return "転";
  return "承";
};

const normalizeRuntimeEpisodeFromVNext = (envelope: unknown): GeneratedRuntimeEpisode | null => {
  const payloadObject = asObject(envelope);
  const resultRow = asObject(payloadObject.result);
  const episodeOutput = asObject(
    resultRow.episodeOutput ||
      payloadObject.episodeOutput ||
      payloadObject
  );
  const episodeMeta = asObject(episodeOutput.episodeMeta);
  const continuityPatch = asObject(episodeOutput.continuityPatch);
  const memoryPatch = asObject(continuityPatch.memoryPatch);
  const payoffPatch = asObject(continuityPatch.payoffPatch);
  const arcPatch = asObject(continuityPatch.arcPatch);
  const ending = asObject(episodeOutput.ending);

  const title = clean(typeof episodeMeta.title === "string" ? episodeMeta.title : "");
  if (!title) return null;
  const coverImagePrompt =
    clean(
      typeof episodeOutput.coverImagePrompt === "string"
        ? episodeOutput.coverImagePrompt
        : typeof episodeOutput.cover_image_prompt === "string"
          ? episodeOutput.cover_image_prompt
          : typeof episodeOutput.episodeCoverImagePrompt === "string"
            ? episodeOutput.episodeCoverImagePrompt
            : typeof episodeOutput.episode_cover_image_prompt === "string"
              ? episodeOutput.episode_cover_image_prompt
              : ""
    ) || undefined;
  const coverImageUrl =
    normalizeMediaUrlForClient(
      typeof episodeOutput.coverImageUrl === "string"
        ? episodeOutput.coverImageUrl
        : typeof episodeOutput.cover_image_url === "string"
          ? episodeOutput.cover_image_url
          : typeof episodeOutput.episodeCoverImageUrl === "string"
            ? episodeOutput.episodeCoverImageUrl
            : typeof episodeOutput.episode_cover_image_url === "string"
              ? episodeOutput.episode_cover_image_url
              : ""
    ) || undefined;

  const scenesRaw = Array.isArray(episodeOutput.scenes) ? episodeOutput.scenes : [];
  const spots: EpisodeSpot[] = scenesRaw.map((item, index) => {
    const scene = asObject(item);
    const narration = asObject(scene.narration);
    const progression = asObject(scene.progression);
    const dialogue = asObject(scene.dialogue);
    const opening = Array.isArray(dialogue.opening) ? dialogue.opening : [];
    const exploration = Array.isArray(dialogue.exploration) ? dialogue.exploration : [];
    const emotionalBeat = Array.isArray(dialogue.emotionalBeat) ? dialogue.emotionalBeat : [];
    const toLine = (row: unknown): EpisodeDialogueLine | null => {
      const line = asObject(row);
      const text = clean(typeof line.text === "string" ? line.text : "");
      if (!text) return null;
      return {
        characterId:
          clean(typeof line.speakerId === "string" ? line.speakerId : "") || "narrator",
        text,
      };
    };
    const toBlock = (row: unknown): EpisodeSpotBlock | null => {
      const line = asObject(row);
      const text = clean(typeof line.text === "string" ? line.text : "");
      if (!text) return null;
      return {
        type: "dialogue",
        text,
        speakerId: clean(typeof line.speakerId === "string" ? line.speakerId : "") || undefined,
      };
    };
    const intro = clean(typeof narration.intro === "string" ? narration.intro : "");
    const arrival = clean(typeof narration.arrival === "string" ? narration.arrival : "");
    const climax = clean(typeof narration.emotionalClimax === "string" ? narration.emotionalClimax : "");
    const outro = clean(typeof narration.outro === "string" ? narration.outro : "");
    const sceneNarration = [intro, arrival, climax, outro].filter(Boolean).join("\n");
    const blocks = [
      ...opening.map(toBlock),
      ...exploration.map(toBlock),
      ...emotionalBeat.map(toBlock),
      {
        type: "mission" as const,
        text:
          clean(typeof progression.nextSpotReason === "string" ? progression.nextSpotReason : "") ||
          "次の地点へ向かう。",
      },
    ].filter((block): block is EpisodeSpotBlock => Boolean(block));
    return {
      spotName: clean(typeof scene.spotName === "string" ? scene.spotName : "") || `スポット ${index + 1}`,
      sceneRole: vNextSceneRoleToLegacy(clean(typeof scene.sceneRole === "string" ? scene.sceneRole : "")),
      sceneObjective: clean(typeof scene.sceneGoal === "string" ? scene.sceneGoal : "") || "",
      sceneNarration: sceneNarration || "シーン進行",
      blocks,
      questionText:
        clean(typeof progression.clueOrRealization === "string" ? progression.clueOrRealization : "") ||
        "このシーンの要点は？",
      answerText:
        clean(typeof progression.clueOrRealization === "string" ? progression.clueOrRealization : "") ||
        "",
      hintText:
        clean(typeof progression.nextSpotReason === "string" ? progression.nextSpotReason : "") ||
        "次の展開に繋がる要素を確認する。",
      explanationText:
        clean(typeof progression.emotionalOutcome === "string" ? progression.emotionalOutcome : "") ||
        "",
      preMissionDialogue: opening.map(toLine).filter((line): line is EpisodeDialogueLine => Boolean(line)),
      postMissionDialogue: emotionalBeat.map(toLine).filter((line): line is EpisodeDialogueLine => Boolean(line)),
    } satisfies EpisodeSpot;
  });

  if (spots.length === 0) return null;

  const fixedCharactersAppeared = normalizeStringArray(episodeOutput.fixedCharactersAppeared);
  const localCharactersIntroduced = Array.isArray(episodeOutput.localCharactersIntroduced)
    ? episodeOutput.localCharactersIntroduced
    : [];
  const localCharacterVisualById = new Map<
    string,
    { displayName?: string; portraitPrompt?: string; portraitImageUrl?: string }
  >();
  localCharactersIntroduced.forEach((item, index) => {
    const row = asObject(item);
    const localCharacterId =
      clean(typeof row.localCharacterId === "string" ? row.localCharacterId : "") ||
      `ep_char_${index + 1}`;
    if (!localCharacterId) return;
    localCharacterVisualById.set(localCharacterId, {
      displayName:
        clean(typeof row.displayName === "string" ? row.displayName : "") || undefined,
      portraitPrompt:
        clean(
          typeof row.portraitPrompt === "string"
            ? row.portraitPrompt
            : typeof row.portrait_prompt === "string"
              ? row.portrait_prompt
              : ""
        ) || undefined,
      portraitImageUrl:
        normalizeMediaUrlForClient(
          typeof row.portraitImageUrl === "string"
            ? row.portraitImageUrl
            : typeof row.portrait_image_url === "string"
              ? row.portrait_image_url
              : ""
        ) || undefined,
    });
  });

  const characters: EpisodeCharacter[] = [
    ...fixedCharactersAppeared.map((id) => ({
      id,
      name: id,
      role: "series_character",
      personality: "",
      origin: "series" as const,
    })),
    ...localCharactersIntroduced.map((item, index) => {
      const row = asObject(item);
      const localCharacterId =
        clean(typeof row.localCharacterId === "string" ? row.localCharacterId : "") ||
        `ep_char_${index + 1}`;
      const portraitPrompt =
        clean(
          typeof row.portraitPrompt === "string"
            ? row.portraitPrompt
            : typeof row.portrait_prompt === "string"
              ? row.portrait_prompt
              : ""
        ) || undefined;
      const portraitImageUrl =
        normalizeMediaUrlForClient(
          typeof row.portraitImageUrl === "string"
            ? row.portraitImageUrl
            : typeof row.portrait_image_url === "string"
              ? row.portrait_image_url
              : ""
        ) || undefined;
      return {
        id: localCharacterId,
        name: clean(typeof row.displayName === "string" ? row.displayName : "") || `ローカル人物${index + 1}`,
        role: clean(typeof row.roleInEpisode === "string" ? row.roleInEpisode : "") || "local_character",
        personality: normalizeStringArray(row.personalityTraits).join(" / "),
        origin: "episode" as const,
        avatarPrompt: portraitPrompt,
        avatarImageUrl: portraitImageUrl,
      } satisfies EpisodeCharacter;
    }),
  ];

  const relationshipPatch = Array.isArray(continuityPatch.relationshipPatch)
    ? continuityPatch.relationshipPatch
    : [];
  const trustDeltas = relationshipPatch
    .map((item) => Number.parseInt(String(asObject(item).trustDelta ?? 0), 10))
    .filter((value) => Number.isFinite(value));
  const avgTrustDelta = trustDeltas.length
    ? Math.round(trustDeltas.reduce((sum, value) => sum + value, 0) / trustDeltas.length)
    : 0;

  return {
    title,
    summary:
      clean(typeof episodeMeta.summaryHook === "string" ? episodeMeta.summaryHook : "") ||
      clean(typeof ending.closingNarration === "string" ? ending.closingNarration : "") ||
      `${title}の概要`,
    oneLiner:
      clean(typeof episodeMeta.summaryHook === "string" ? episodeMeta.summaryHook : "") ||
      clean(typeof episodeMeta.episodePurpose === "string" ? episodeMeta.episodePurpose : ""),
    coverImagePrompt,
    coverImageUrl,
    mainPlot: {
      premise: clean(typeof episodeMeta.episodePurpose === "string" ? episodeMeta.episodePurpose : ""),
      goal: clean(typeof episodeMeta.episodePurpose === "string" ? episodeMeta.episodePurpose : ""),
    },
    characters,
    episodeWorld: {
      title: clean(typeof episodeMeta.title === "string" ? episodeMeta.title : "") || "今回の旅の章",
      mood: normalizeStringArray(ending.emotionalAftertaste)[0] || "発見と余韻",
      atmosphere: clean(typeof ending.closingNarration === "string" ? ending.closingNarration : "") || "継続物語の進展",
      sensoryKeywords: [],
      storyAxis: clean(typeof episodeMeta.episodePurpose === "string" ? episodeMeta.episodePurpose : ""),
      emotionalArc: clean(typeof arcPatch.arcSummaryAfterEpisode === "string" ? arcPatch.arcSummaryAfterEpisode : ""),
      localTheme: clean(typeof episodeMeta.arcRole === "string" ? episodeMeta.arcRole : "") || "development",
    },
    episodeUniqueCharacters: localCharactersIntroduced.map((item, index) => {
      const row = asObject(item);
      const localCharacterId =
        clean(typeof row.localCharacterId === "string" ? row.localCharacterId : "") ||
        `ep_char_${index + 1}`;
      const visual = localCharacterVisualById.get(localCharacterId);
      return {
        id: localCharacterId,
        name:
          clean(typeof row.displayName === "string" ? row.displayName : "") ||
          visual?.displayName ||
          `ローカル人物${index + 1}`,
        role: clean(typeof row.roleInEpisode === "string" ? row.roleInEpisode : "") || "地域人物",
        personality: normalizeStringArray(row.personalityTraits).join(" / ") || "観察力が高い",
        motivation: clean(typeof row.motivation === "string" ? row.motivation : "") || "地域情報を伝える",
        relationToSeries:
          clean(typeof row.relationToSeriesTheme === "string" ? row.relationToSeriesTheme : "") ||
          "シリーズ進行に接続",
        introductionScene:
          clean(typeof row.relationToSpot === "string" ? row.relationToSpot : "") ||
          "中盤で登場",
        portraitPrompt: visual?.portraitPrompt,
        portraitImageUrl: visual?.portraitImageUrl,
      } satisfies EpisodeUniqueCharacter;
    }),
    spots,
    completionCondition:
      clean(typeof episodeMeta.episodePurpose === "string" ? episodeMeta.episodePurpose : "") ||
      "主要スポットで進展を得る。",
    carryOverHook:
      clean(typeof ending.nextEpisodeHook === "string" ? ending.nextEpisodeHook : "") ||
      "次回に続く問いが残る。",
    estimatedDurationMinutes: Math.max(10, Math.min(45, spots.length * 6)),
    progressPatch: {
      unresolvedThreadsToAdd: normalizeStringArray(payoffPatch.activeThreads),
      unresolvedThreadsToRemove: normalizeStringArray(payoffPatch.closedThreads),
      revealedFactsToAdd: normalizeStringArray(memoryPatch.addedEvents),
      relationshipStateSummary:
        clean(typeof arcPatch.arcSummaryAfterEpisode === "string" ? arcPatch.arcSummaryAfterEpisode : "") ||
        "関係性は継続中。",
      relationshipFlagsToAdd: dedupeStrings(
        relationshipPatch
          .map((item) => {
            const row = asObject(item);
            const value =
              typeof row.newRelationshipState === "string" ? row.newRelationshipState : "";
            return clean(value);
          })
          .filter(Boolean)
      ),
      relationshipFlagsToRemove: [],
      recentRelationShift: dedupeStrings(
        relationshipPatch
          .map((item) => {
            const row = asObject(item);
            const value =
              typeof row.keyMomentSummary === "string" ? row.keyMomentSummary : "";
            return clean(value);
          })
          .filter(Boolean)
      ).slice(0, 6),
      companionTrustDelta: Number.isFinite(avgTrustDelta) ? Math.max(-10, Math.min(10, avgTrustDelta)) : undefined,
      nextHook:
        clean(typeof ending.nextEpisodeHook === "string" ? ending.nextEpisodeHook : "") ||
        "",
    },
    continuityPatchVNext: continuityPatch,
    episodeOutputVNext: episodeOutput,
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

const normalizeCharacterLookupKey = (value?: string | null) => clean(value).toLowerCase();

const enrichRuntimeEpisodeCharacters = (
  episode: GeneratedRuntimeEpisode,
  sourceCharacters?: RuntimeEpisodeContext["characters"]
): GeneratedRuntimeEpisode => {
  const sources = (sourceCharacters || [])
    .map((character, index) => {
      const id = clean(character.id) || `char_${index + 1}`;
      const name = clean(character.name);
      const role = clean(character.role);
      const personality = clean(character.personality || "");
      const avatarImageUrl = normalizeMediaUrlForClient(character.portraitImageUrl || "") || "";
      if (!id && !name) return null;
      return { id, name, role, personality, avatarImageUrl };
    })
    .filter((item): item is { id: string; name: string; role: string; personality: string; avatarImageUrl: string } => Boolean(item));

  if (sources.length === 0 || !Array.isArray(episode.characters) || episode.characters.length === 0) {
    return episode;
  }

  const byId = new Map<string, (typeof sources)[number]>();
  const byName = new Map<string, (typeof sources)[number]>();
  sources.forEach((character) => {
    const idKey = normalizeCharacterLookupKey(character.id);
    if (idKey) byId.set(idKey, character);
    const nameKey = normalizeCharacterLookupKey(character.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, character);
  });

  const sourceIdPattern = /^char[_-]?(\d+)$/i;

  const enrichedCharacters = episode.characters.map((character, index) => {
    const characterId = clean(character.id);
    const characterName = clean(character.name);
    const characterRole = clean(character.role);
    const directById = byId.get(normalizeCharacterLookupKey(characterId));
    const directByName = byName.get(normalizeCharacterLookupKey(characterName));
    let matched = directById || directByName || null;

    if (!matched) {
      const sourceKey = characterId || characterName;
      const match = sourceKey.match(sourceIdPattern);
      if (match) {
        const sourceIndex = Number.parseInt(match[1], 10) - 1;
        if (Number.isFinite(sourceIndex) && sourceIndex >= 0 && sourceIndex < sources.length) {
          matched = sources[sourceIndex];
        }
      }
    }

    if (!matched) return character;

    const shouldReplaceName =
      !characterName || sourceIdPattern.test(characterName) || characterName === characterId;
    const resolvedName = shouldReplaceName ? matched.name || characterName : characterName;
    const resolvedRole =
      !characterRole || characterRole === "series_character" ? matched.role || characterRole : characterRole;
    const resolvedPersonality = clean(character.personality) || matched.personality;
    const resolvedAvatar =
      normalizeMediaUrlForClient(character.avatarImageUrl || "") || matched.avatarImageUrl || undefined;

    return {
      ...character,
      id: characterId || matched.id || `char_${index + 1}`,
      name: resolvedName || character.name,
      role: resolvedRole || character.role,
      personality: resolvedPersonality,
      origin: character.origin || "series",
      ...(resolvedAvatar ? { avatarImageUrl: resolvedAvatar } : {}),
    } satisfies EpisodeCharacter;
  });

  return {
    ...episode,
    characters: enrichedCharacters,
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
        id: clean(character.id) || undefined,
        name: character.name,
        role: character.role,
        tier: character.tier || "secondary",
        must_appear: Boolean(character.mustAppear),
        personality: clean(character.personality),
        appearance: clean(character.appearance) || undefined,
        portrait_prompt: clean(character.portraitPrompt) || undefined,
        portrait_image_url: clean(character.portraitImageUrl) || undefined,
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

  const parseInlineCoordinates = (
    value: string
  ): { lat: number; lng: number } | undefined => {
    const match = clean(value).match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!match) return undefined;
    const lat = Number.parseFloat(match[1]);
    const lng = Number.parseFloat(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
    return { lat, lng };
  };

  const buildVNextEpisodeBody = () => {
    const blueprint = asObject(payload.series.seriesBlueprint);
    if (Object.keys(blueprint).length === 0) return null;

    const blueprintNarrative = asObject(blueprint.narrative);
    const rawUserState = asObject(payload.series.userSeriesState);
    const template = asObject(payload.series.initialUserSeriesStateTemplate);
    const rawProgress = payload.series.progressState || undefined;

    const requestUserId =
      clean(payload.userId) ||
      clean(typeof rawUserState.userId === "string" ? rawUserState.userId : "") ||
      "anonymous_user";
    const requestSeriesBlueprintId =
      clean(typeof blueprint.id === "string" ? blueprint.id : "") ||
      clean(typeof rawUserState.seriesBlueprintId === "string" ? rawUserState.seriesBlueprintId : "") ||
      `series_${clean(payload.series.title) || "draft"}`;
    const requestUserSeriesStateId =
      clean(typeof rawUserState.id === "string" ? rawUserState.id : "") ||
      `${requestSeriesBlueprintId}:${requestUserId}`;

    const currentProgress = asObject(rawUserState.currentProgress);
    const templateProgress = asObject(template.currentProgress);
    const episodeCountCompleted =
      Number.parseInt(
        String(
          currentProgress.episodeCountCompleted ??
            templateProgress.episodeCountCompleted ??
            rawProgress?.lastCompletedEpisodeNo ??
            0
        ),
        10
      ) || 0;

    const userSeriesState = {
      id: requestUserSeriesStateId,
      userId: requestUserId,
      seriesBlueprintId: requestSeriesBlueprintId,
      referencedBlueprintVersion:
        Number.parseInt(String(rawUserState.referencedBlueprintVersion ?? blueprint.version ?? 1), 10) || 1,
      stateVersion: Number.parseInt(String(rawUserState.stateVersion ?? 1), 10) || 1,
      currentProgress: {
        episodeCountCompleted,
        currentCheckpointIndex:
          Number.parseInt(
            String(
              currentProgress.currentCheckpointIndex ??
                templateProgress.currentCheckpointIndex ??
                0
            ),
            10
          ) || 0,
        currentArcSummary:
          clean(typeof currentProgress.currentArcSummary === "string" ? currentProgress.currentArcSummary : "") ||
          clean(rawProgress?.relationshipStateSummary) ||
          "導入段階",
        unresolvedThreads: dedupeStrings(
          asStringArray(currentProgress.unresolvedThreads).concat(
            rawProgress?.unresolvedThreads || []
          )
        ),
        resolvedThreads: dedupeStrings(
          asStringArray(currentProgress.resolvedThreads).concat(
            rawProgress?.revealedFacts || []
          )
        ),
        activeForeshadowing: dedupeStrings(
          asStringArray(currentProgress.activeForeshadowing)
        ),
        completedEpisodeIds: asStringArray(currentProgress.completedEpisodeIds),
      },
      rememberedExperience: {
        visitedLocations: asStringArray(asObject(rawUserState.rememberedExperience).visitedLocations),
        keyEvents: asStringArray(asObject(rawUserState.rememberedExperience).keyEvents),
        importantConversations: asStringArray(
          asObject(rawUserState.rememberedExperience).importantConversations
        ),
        playerChoices: asStringArray(asObject(rawUserState.rememberedExperience).playerChoices),
        emotionalMoments: asStringArray(asObject(rawUserState.rememberedExperience).emotionalMoments),
        relationshipTurningPoints: asStringArray(
          asObject(rawUserState.rememberedExperience).relationshipTurningPoints
        ),
      },
      relationshipState: Array.isArray(rawUserState.relationshipState)
        ? rawUserState.relationshipState
        : Array.isArray(template.relationshipState)
          ? template.relationshipState
          : [],
      continuityState: {
        callbackCandidates: dedupeStrings(
          asStringArray(asObject(rawUserState.continuityState).callbackCandidates)
        ),
        motifsInUse: dedupeStrings(asStringArray(asObject(rawUserState.continuityState).motifsInUse)),
        blockedLines: asStringArray(asObject(rawUserState.continuityState).blockedLines),
        promisedPayoffs: dedupeStrings(
          asStringArray(asObject(rawUserState.continuityState).promisedPayoffs)
        ),
        episodeLocalCharacterCarryovers: Array.isArray(
          asObject(rawUserState.continuityState).episodeLocalCharacterCarryovers
        )
          ? asObject(rawUserState.continuityState).episodeLocalCharacterCarryovers
          : [],
      },
      monetizationState: {
        episodeLimit:
          Number.parseInt(
            String(
              asObject(rawUserState.monetizationState).episodeLimit ??
                blueprintNarrative.freePlanDefaultEpisodeLimit ??
                3
            ),
            10
          ) || 3,
        extensionUnlocked: Boolean(
          asObject(rawUserState.monetizationState).extensionUnlocked
        ),
      },
    };

    const locationContext = {
      cityOrArea: payload.stageLocation,
      coordinates: parseInlineCoordinates(payload.stageLocation),
      candidateSpots: payload.series.firstEpisodeSeed?.suggestedSpots || undefined,
      transportMode: "mixed" as const,
      availableMinutes: payload.desiredDurationMinutes ?? 20,
    };

    return {
      request: {
        userId: requestUserId,
        seriesBlueprintId: requestSeriesBlueprintId,
        userSeriesStateId: requestUserSeriesStateId,
        episodeRequest: {
          locationContext,
          tourismGoal: payload.purpose,
          desiredMoodToday: clean(payload.userWishes)
            ? [clean(payload.userWishes)]
            : undefined,
        },
        runtimeOptions: {
          maxSpots: desiredSpotCount,
          minSpots: Math.min(3, desiredSpotCount),
          fallbackAllowed: false,
          plannerRetries: 2,
        },
      },
      seriesBlueprint: blueprint,
      userSeriesState,
    };
  };

  const vNextEpisodeBody = buildVNextEpisodeBody();
  const runtimeBody = vNextEpisodeBody || body;

  const emitProgress = (event: RuntimeEpisodeGenerationEvent) => {
    options.onProgress?.(event);
  };

  const normalizeEpisodeFromResponse = (envelope: unknown) => {
    const enrich = (runtime: GeneratedRuntimeEpisode) =>
      enrichRuntimeEpisodeCharacters(runtime, payload.series.characters);

    const vNext = normalizeRuntimeEpisodeFromVNext(envelope);
    if (vNext) return enrich(vNext);
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
    return enrich(normalized);
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
        body: JSON.stringify(runtimeBody),
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
      if (SERIES_RUNTIME_EPISODE_LEGACY_FALLBACK_ALLOWED) {
        return runLegacyEndpoint();
      }
      throw new Error("エピソード生成ジョブAPIが利用できません。");
    }
    if (
      vNextEpisodeBody &&
      (createJobResponse.status === 400 || createJobResponse.status === 422)
    ) {
      if (SERIES_RUNTIME_EPISODE_LEGACY_FALLBACK_ALLOWED) {
        console.warn(
          "[seriesAi] vNext episode job rejected, fallback to legacy format",
          createJobRaw
        );
        return runLegacyEndpoint();
      }
      throw new Error(`Mastra episode job rejected (${createJobResponse.status}): ${createJobRaw || "unknown"}`);
    }
    const errorBody = createJobJson && typeof createJobJson === "object" ? JSON.stringify(createJobJson) : createJobRaw;
    throw new Error(`Mastra episode job creation failed (${createJobResponse.status}): ${errorBody || "unknown"}`);
  }

  const createJobPayload = asObject(createJobJson);
  const jobId = clean(
    typeof createJobPayload.job_id === "string"
      ? createJobPayload.job_id
      : typeof createJobPayload.jobId === "string"
        ? createJobPayload.jobId
        : ""
  );
  if (!jobId) {
    if (SERIES_RUNTIME_EPISODE_LEGACY_FALLBACK_ALLOWED) {
      return runLegacyEndpoint();
    }
    throw new Error("エピソード生成ジョブIDが取得できませんでした。");
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

  const pollPath = clean(
    typeof createJobPayload.poll_path === "string"
      ? createJobPayload.poll_path
      : typeof createJobPayload.pollPath === "string"
        ? createJobPayload.pollPath
        : ""
  );
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
    if (status === "succeeded" || status === "completed") {
      return normalizeEpisodeFromResponse(pollJson);
    }
    if (status === "failed") {
      const reason = clean(typeof pollPayload.error === "string" ? pollPayload.error : "") || "Mastra episode generation failed.";
      throw new Error(reason);
    }

    await waitFor(pollIntervalMs, options.signal);
  }
};
