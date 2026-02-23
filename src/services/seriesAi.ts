const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();

export type SeriesInterviewInput = {
  genreWorld: string;
  mainObjective: string;
  protagonistPosition: string;
  partnerDescription: string;
  additionalNotes?: string;
};

export type GeneratedSeriesCharacter = {
  id?: string;
  name: string;
  role: string;
  goal?: string;
  arcStart?: string;
  arcEnd?: string;
  personality?: string;
  appearance?: string;
  portraitPrompt?: string;
  portraitImageUrl?: string;
  secrets?: string[];
  relationshipHooks?: string[];
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

export type GeneratedSeriesWorld = {
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
  world?: GeneratedSeriesWorld;
  episodeBlueprints?: GeneratedSeriesEpisodeBlueprint[];
  continuity?: GeneratedSeriesContinuity;
  workflowVersion?: string;
};

export type GenerateSeriesByMastraPayload = {
  interview: SeriesInterviewInput;
  prompt?: string;
  desiredEpisodeCount?: number;
  creatorId?: string;
};

const normalizeStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((item) => clean(typeof item === "string" ? item : String(item ?? ""))).filter(Boolean);
};

const buildSeedFallbackImageUrl = (seedBase: string, width: number, height: number) => {
  const seed = clean(seedBase) || "tomoshibi";
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${Math.max(120, width)}/${Math.max(120, height)}`;
};

const resolveMastraBaseUrl = () => {
  const explicit = clean(process.env.EXPO_PUBLIC_MASTRA_BASE_URL);
  if (explicit) return explicit.replace(/\/+$/, "");

  const fallback = clean(process.env.EXPO_PUBLIC_API_BASE_URL);
  return fallback ? fallback.replace(/\/+$/, "") : "";
};

export const isMastraSeriesConfigured = resolveMastraBaseUrl().length > 0;

const normalizeCharacters = (raw: unknown): GeneratedSeriesCharacter[] => {
  if (!Array.isArray(raw)) return [];

  return raw.reduce<GeneratedSeriesCharacter[]>((acc, item, index) => {
    if (!item || typeof item !== "object") return acc;
    const row = item as Record<string, unknown>;
    const name = clean(typeof row.name === "string" ? row.name : undefined);
    const role = clean(typeof row.role === "string" ? row.role : undefined);
    if (!name || !role) return acc;

    acc.push({
      id: clean(typeof row.id === "string" ? row.id : undefined) || `char_${index + 1}`,
      name,
      role,
      goal: clean(typeof row.goal === "string" ? row.goal : undefined) || undefined,
      arcStart: clean(typeof row.arc_start === "string" ? row.arc_start : undefined) || undefined,
      arcEnd: clean(typeof row.arc_end === "string" ? row.arc_end : undefined) || undefined,
      personality: clean(typeof row.personality === "string" ? row.personality : undefined) || undefined,
      appearance: clean(typeof row.appearance === "string" ? row.appearance : undefined) || undefined,
      portraitPrompt: clean(typeof row.portrait_prompt === "string" ? row.portrait_prompt : undefined) || undefined,
      portraitImageUrl:
        clean(typeof row.portrait_image_url === "string" ? row.portrait_image_url : undefined) ||
        buildSeedFallbackImageUrl(`${name}-${role}-portrait`, 768, 1024),
      secrets: normalizeStringArray(row.secrets),
      relationshipHooks: normalizeStringArray(row.relationship_hooks),
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

const normalizeWorld = (raw: unknown): GeneratedSeriesWorld | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const world = raw as Record<string, unknown>;
  return {
    era: clean(typeof world.era === "string" ? world.era : undefined) || undefined,
    setting: clean(typeof world.setting === "string" ? world.setting : undefined) || undefined,
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

export const generateSeriesDraftViaMastra = async (
  payload: GenerateSeriesByMastraPayload
): Promise<GeneratedSeriesDraft> => {
  const baseUrl = resolveMastraBaseUrl();
  if (!baseUrl) {
    throw new Error("Mastra API base URL is missing. Set EXPO_PUBLIC_MASTRA_BASE_URL or EXPO_PUBLIC_API_BASE_URL.");
  }

  const body = {
    interview: {
      genre_world: payload.interview.genreWorld,
      main_objective: payload.interview.mainObjective,
      protagonist_position: payload.interview.protagonistPosition,
      partner_description: payload.interview.partnerDescription,
      additional_notes: payload.interview.additionalNotes,
    },
    prompt: clean(payload.prompt) || undefined,
    desired_episode_count: payload.desiredEpisodeCount ?? 8,
    creator_id: payload.creatorId,
    language: "ja",
  };

  const response = await fetch(`${baseUrl}/api/series`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  let json: unknown = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const errorBody = json && typeof json === "object" ? JSON.stringify(json) : rawText;
    throw new Error(`Mastra series generation failed (${response.status}): ${errorBody || "unknown"}`);
  }

  const payloadObject = (json && typeof json === "object" ? (json as Record<string, unknown>) : null) || {};
  const seriesRaw = (payloadObject.series as Record<string, unknown> | undefined) || payloadObject;
  const metaRaw = (payloadObject.meta as Record<string, unknown> | undefined) || null;

  const title = clean(typeof seriesRaw.title === "string" ? seriesRaw.title : undefined) || "新しいシリーズ";
  const overview =
    clean(typeof seriesRaw.overview === "string" ? seriesRaw.overview : undefined) ||
    clean(typeof seriesRaw.premise === "string" ? seriesRaw.premise : undefined) ||
    "概要を生成できませんでした。";
  const aiRules = clean(typeof seriesRaw.ai_rules === "string" ? seriesRaw.ai_rules : undefined);

  const characters = normalizeCharacters(seriesRaw.characters);
  if (characters.length === 0) {
    throw new Error("Mastra response does not include valid characters.");
  }

  const episodeBlueprints = normalizeEpisodeBlueprints(seriesRaw.episode_blueprints);

  return {
    title,
    overview,
    aiRules,
    characters,
    coverImagePrompt:
      clean(typeof seriesRaw.cover_image_prompt === "string" ? seriesRaw.cover_image_prompt : undefined) || undefined,
    coverImageUrl:
      clean(typeof seriesRaw.cover_image_url === "string" ? seriesRaw.cover_image_url : undefined) ||
      buildSeedFallbackImageUrl(`${title}-${clean(typeof seriesRaw.genre === "string" ? seriesRaw.genre : undefined)}`, 1024, 1365),
    genre: clean(typeof seriesRaw.genre === "string" ? seriesRaw.genre : undefined) || undefined,
    tone: clean(typeof seriesRaw.tone === "string" ? seriesRaw.tone : undefined) || undefined,
    premise: clean(typeof seriesRaw.premise === "string" ? seriesRaw.premise : undefined) || undefined,
    seasonGoal: clean(typeof seriesRaw.season_goal === "string" ? seriesRaw.season_goal : undefined) || undefined,
    world: normalizeWorld(seriesRaw.world),
    episodeBlueprints,
    continuity: normalizeContinuity(seriesRaw.continuity),
    workflowVersion:
      clean(typeof metaRaw?.workflow_version === "string" ? metaRaw.workflow_version : undefined) || undefined,
  };
};
