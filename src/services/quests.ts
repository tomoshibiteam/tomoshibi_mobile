import { getSupabaseOrThrow } from "@/lib/supabase";
import type {
  EpisodeSpot,
  GeneratedRuntimeEpisode,
  GeneratedSeriesDraft,
  GeneratedSeriesRecentContext,
} from "@/services/seriesAi";

type CreateQuestDraftPayload = {
  creatorId: string;
  title: string;
  description?: string | null;
  areaName?: string | null;
  coverImageUrl?: string | null;
};

type CreateEpisodePayload = {
  userId: string;
  seriesId?: string | null;
  seriesTitle: string;
  episodeTitle: string;
  episodeText: string;
  coverImageUrl?: string | null;
};

type DeleteSeriesDraftPayload = {
  userId: string;
  questId: string;
};

type EpisodeSaveResult = {
  questId: string;
  questTitle: string;
  storage: "quest_episodes" | "quest_posts";
  episodeNo?: number;
};

export type RuntimeSpotCoordinate = {
  spotName: string;
  lat: number;
  lng: number;
  address?: string | null;
};

export type SeriesOption = {
  id: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  areaName: string | null;
  status: string | null;
  createdAt: string | null;
};

export type SeriesDetail = {
  id: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  areaName: string | null;
  status: string | null;
  tags: string[];
  characters: Array<{
    id: string;
    name: string;
    role: string;
    avatarImageUrl: string | null;
  }>;
  creatorId: string | null;
  createdAt: string | null;
};

export type ReusableSeriesDraft = {
  questId: string;
  seriesId: string;
  title: string;
  sourcePrompt: string | null;
  createdAt: string | null;
};

export type SeriesEpisode = {
  id: string;
  title: string;
  body: string;
  episodeNo: number;
  status: string;
  source: "quest_episodes" | "quest_posts";
  userId: string;
  createdAt: string | null;
  coverImageUrl?: string | null;
};

export type SeriesEpisodeRuntimeContext = {
  title: string;
  overview: string | null;
  premise: string | null;
  seasonGoal: string | null;
  aiRules: string | null;
  worldSetting: string | null;
  continuity: Record<string, unknown> | null;
  identityPack: Record<string, unknown> | null;
  coverConsistencyReport: Record<string, unknown> | null;
  progressState: Record<string, unknown> | null;
  firstEpisodeSeed: Record<string, unknown> | null;
  seriesBlueprint: Record<string, unknown> | null;
  initialUserSeriesStateTemplate: Record<string, unknown> | null;
  episodeRuntimeBootstrapPayload: Record<string, unknown> | null;
  userSeriesState: Record<string, unknown> | null;
  checkpoints: Array<{
    checkpointNo: number;
    title: string;
    purpose: string | null;
    unlockHint: string | null;
    carryOver: string | null;
  }>;
  characters: Array<{
    id?: string;
    name: string;
    role: string;
    avatarImageUrl?: string | null;
    mustAppear?: boolean;
    personality: string | null;
    arcStart: string | null;
    arcEnd: string | null;
  }>;
  recentEpisodes: Array<{
    episodeNo: number;
    title: string;
    summary: string;
  }>;
};

const shouldRetryWithoutMode = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: string; message?: string; details?: string };
  const code = maybeError.code || "";
  const normalized = `${maybeError.message || ""} ${maybeError.details || ""}`.toLowerCase();
  return code === "PGRST204" || code === "42703" || normalized.includes("column") || normalized.includes("mode");
};

const normalize = (value: string | null | undefined) => (value || "").trim().toLowerCase();
const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const resolveMediaBaseUrl = () =>
  clean(
    process.env.EXPO_PUBLIC_MASTRA_BASE_URL ||
      process.env.MASTRA_BASE_URL ||
      process.env.EXPO_PUBLIC_API_BASE_URL ||
      ""
  ).replace(/\/+$/, "");
const normalizeEpisodeCoverUrl = (value?: string | null) => {
  const raw = clean(value);
  if (!raw) return null;

  const base = resolveMediaBaseUrl();
  const tuneSeriesImageUrl = (url: URL) => {
    if (!/\/api\/series\/image(?:\/|$)/.test(url.pathname)) return;
    const purpose = clean(url.searchParams.get("purpose")).toLowerCase();
    if (purpose === "character_portrait") {
      // 一覧サムネイルでは透過cutout画像が見えづらいので通常画像を優先する。
      url.searchParams.set("cutout", "0");
    }
  };

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      tuneSeriesImageUrl(parsed);
      if (base) {
        const baseParsed = new URL(base);
        const shouldRewriteHost =
          LOCALHOST_HOSTS.has(clean(parsed.hostname).toLowerCase()) ||
          /^\/api\/series\/image(?:\/|$)/.test(parsed.pathname);
        if (shouldRewriteHost) {
          parsed.protocol = baseParsed.protocol;
          parsed.hostname = baseParsed.hostname;
          parsed.port = baseParsed.port;
          return parsed.toString();
        }
      }
      return parsed.toString();
    } catch {
      return raw;
    }
  }

  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) {
    if (base) {
      try {
        const parsed = new URL(`${base}${raw}`);
        tuneSeriesImageUrl(parsed);
        return parsed.toString();
      } catch {
        return `${base}${raw}`;
      }
    }
  }
  return raw;
};
const buildEpisodeSeedCoverUrl = (
  seriesTitle: string,
  episodeTitle: string,
  userId?: string | null
) => {
  const seed = [seriesTitle, episodeTitle, userId || "guest"]
    .map((item) => clean(item))
    .filter(Boolean)
    .join("-");
  return `https://picsum.photos/seed/${encodeURIComponent(seed || "tomoshibi-episode-cover")}/1200/800`;
};
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asRecordArray = (value: unknown) =>
  (Array.isArray(value) ? value : []).map((item) => asRecord(item));
const asStringArray = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .map((item) => clean(typeof item === "string" ? item : String(item ?? "")))
    .filter(Boolean);
const dedupe = (values: string[]) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value);
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const toFiniteNumber = (value: unknown, fallback = 0) => {
  const parsed = Number.parseFloat(String(value ?? fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asCodedError = (message: string, code: string) => {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
};

const isQuestEpisodesUnavailable = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: string; message?: string; details?: string };
  const code = maybeError.code || "";
  const normalized = `${maybeError.message || ""} ${maybeError.details || ""}`.toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST204" ||
    code === "42703" ||
    normalized.includes("quest_episodes")
  );
};

const isQuestPostsUnavailable = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: string; message?: string; details?: string };
  const code = maybeError.code || "";
  const normalized = `${maybeError.message || ""} ${maybeError.details || ""}`.toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST204" ||
    code === "42703" ||
    normalized.includes("quest_posts")
  );
};

const isMissingAnyColumn = (error: unknown, columnNames: string[]) => {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: string; message?: string; details?: string };
  const code = maybeError.code || "";
  const normalized = `${maybeError.message || ""} ${maybeError.details || ""}`.toLowerCase();
  if (code !== "42703" && code !== "PGRST204" && !normalized.includes("column")) return false;
  return columnNames.some((column) => normalized.includes(column.toLowerCase()));
};

const isMissingTableError = (error: unknown, tableName: string) => {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: string; message?: string; details?: string };
  const code = maybeError.code || "";
  const normalized = `${maybeError.message || ""} ${maybeError.details || ""}`.toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    normalized.includes("does not exist") ||
    normalized.includes(tableName.toLowerCase())
  );
};

const generateUuid = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const createQuestDraft = async (payload: CreateQuestDraftPayload) => {
  const supabase = getSupabaseOrThrow();

  const { data: seriesRow, error: seriesError } = await supabase
    .from("series")
    .insert({
      owner_id: payload.creatorId,
      title: payload.title || "",
      worldview_text: payload.description || "",
      continuity_rules: {},
      visibility: "private",
      remix_policy: "none",
      temporary: false,
    })
    .select("id")
    .maybeSingle();

  if (seriesError) {
    console.error("createQuestDraft: series insert failed:", {
      code: (seriesError as any)?.code,
      message: (seriesError as any)?.message,
      details: (seriesError as any)?.details,
    });
    throw seriesError;
  }

  if (!seriesRow?.id) {
    throw new Error("Series row was created but id was not returned.");
  }

  const seriesId = seriesRow.id as string;

  const { data, error } = await supabase
    .from("quests")
    .insert({
      creator_id: payload.creatorId,
      title: payload.title || "",
      description: payload.description || null,
      area_name: payload.areaName || null,
      cover_image_url: payload.coverImageUrl || null,
      status: "draft",
      mode: "PRIVATE",
      series_id: seriesId,
      episode_no: 1,
      base_language: "ja",
      supported_languages: ["ja"],
      tags: [] as string[],
      category_tags: [] as string[],
      hashtag_tags: [] as string[],
      quality_checklist: {},
      share_settings: {},
      generation_mode: "original",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("createQuestDraft: quests insert failed:", {
      code: (error as any)?.code,
      message: (error as any)?.message,
      details: (error as any)?.details,
    });
    throw error;
  }

  if (!data?.id) {
    throw new Error("Quest draft was created but ID could not be returned.");
  }

  return { questId: data.id as string, seriesId };
};

export const fetchMySeriesOptions = async (userId: string, limit = 40) => {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("quests")
    .select("id, title, description, cover_image_url, area_name, status, created_at")
    .eq("creator_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return ((data || []) as Array<{
    id: string;
    title: string | null;
    description: string | null;
    cover_image_url: string | null;
    area_name: string | null;
    status: string | null;
    created_at: string | null;
  }>).map((row) => ({
    id: row.id,
    title: row.title || "タイトル未設定",
    description: row.description,
    coverImageUrl: row.cover_image_url,
    areaName: row.area_name,
    status: row.status,
    createdAt: row.created_at,
  })) satisfies SeriesOption[];
};

export const deleteSeriesDraft = async (payload: DeleteSeriesDraftPayload) => {
  const supabase = getSupabaseOrThrow();

  try {
    const { error } = await supabase
      .from("quest_episodes")
      .delete()
      .eq("quest_id", payload.questId)
      .eq("user_id", payload.userId);

    if (error) throw error;
  } catch (error) {
    if (!isQuestEpisodesUnavailable(error)) throw error;
  }

  try {
    const { error } = await supabase
      .from("quest_posts")
      .delete()
      .eq("quest_id", payload.questId)
      .eq("user_id", payload.userId);

    if (error) throw error;
  } catch (error) {
    if (!isQuestPostsUnavailable(error)) throw error;
  }

  const { data, error } = await supabase
    .from("quests")
    .delete()
    .eq("id", payload.questId)
    .eq("creator_id", payload.userId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) {
    throw asCodedError("Quest draft was not deleted.", "NOT_DELETED");
  }
};

export const fetchSeriesDetail = async (questId: string) => {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("quests")
    .select("id, title, description, cover_image_url, area_name, status, tags, creator_id, created_at")
    .eq("id", questId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  let characterRows:
    | Array<{
      id: string | null;
      name: string | null;
      role: string | null;
      portrait_image_url: string | null;
      character_order?: number | null;
    }>
    | null = null;

  try {
    const withPortrait = await supabase
      .from("series_characters")
      .select("id, name, role, portrait_image_url, character_order")
      .eq("quest_id", questId)
      .limit(10);

    if (
      withPortrait.error &&
      isMissingAnyColumn(withPortrait.error, ["portrait_image_url", "character_order"])
    ) {
      const legacy = await supabase
        .from("series_characters")
        .select("id, name, role")
        .eq("quest_id", questId)
        .limit(10);
      if (legacy.error) throw legacy.error;

      characterRows = ((legacy.data || []) as Array<{
        id: string | null;
        name: string | null;
        role: string | null;
      }>).map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        portrait_image_url: null,
      }));
    } else {
      if (withPortrait.error) throw withPortrait.error;
      characterRows = ((withPortrait.data || []) as Array<{
        id: string | null;
        name: string | null;
        role: string | null;
        portrait_image_url: string | null;
        character_order?: number | null;
      }>).sort((a, b) => (Number(a.character_order || 0) || 0) - (Number(b.character_order || 0) || 0));
    }
  } catch (characterError) {
    console.warn("fetchSeriesDetail: series_characters read warning", characterError);
  }

  const row = data as {
    id: string;
    title: string | null;
    description: string | null;
    cover_image_url: string | null;
    area_name: string | null;
    status: string | null;
    tags: string[] | null;
    creator_id: string | null;
    created_at: string | null;
  };

  return {
    id: row.id,
    title: row.title || "タイトル未設定",
    description: row.description,
    coverImageUrl: row.cover_image_url,
    areaName: row.area_name,
    status: row.status,
    tags: row.tags || [],
    characters: ((characterRows || []) as Array<{
      id: string | null;
      name: string | null;
      role: string | null;
      portrait_image_url: string | null;
      character_order?: number | null;
    }>)
      .filter((character) => Boolean(character.name))
      .map((character, index) => {
        return {
          id: character.id || `series-char-${index + 1}`,
          name: character.name || "登場人物",
          role: character.role || "役割未設定",
          avatarImageUrl: normalizeEpisodeCoverUrl(character.portrait_image_url),
        };
      }),
    creatorId: row.creator_id,
    createdAt: row.created_at,
  } satisfies SeriesDetail;
};

const limitRecentContext = (values: string[], limit = 8) => dedupe(values).slice(0, limit);

export const fetchRecentSeriesGenerationContext = async (
  userId: string,
  limit = 6
): Promise<GeneratedSeriesRecentContext> => {
  const supabase = getSupabaseOrThrow();

  const { data: questRows, error: questError } = await supabase
    .from("quests")
    .select("id, title, area_name, created_at")
    .eq("creator_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, limit));

  if (questError) throw questError;
  if (!questRows || questRows.length === 0) return {};

  const questIds = questRows
    .map((row) => clean((row as { id?: string | null }).id || ""))
    .filter(Boolean);
  if (questIds.length === 0) return {};

  const bibleByQuestId = new Map<string, Record<string, unknown>>();
  try {
    const bibleQuery = await supabase
      .from("series_bibles")
      .select(
        "quest_id, title, overview, genre, tone, premise, season_goal, world, continuity, first_episode_seed, series_blueprint"
      )
      .in("quest_id", questIds)
      .eq("creator_id", userId);
    if (bibleQuery.error) throw bibleQuery.error;
    for (const row of (bibleQuery.data || []) as Array<Record<string, unknown>>) {
      const questId = clean(typeof row.quest_id === "string" ? row.quest_id : "");
      if (questId) bibleByQuestId.set(questId, row);
    }
  } catch (error) {
    const coded = error as { code?: string };
    if (coded?.code !== "42P01" && !isMissingAnyColumn(error, ["series_blueprint", "first_episode_seed"])) {
      throw error;
    }
  }

  const characterRowsByQuestId = new Map<string, Array<Record<string, unknown>>>();
  try {
    const characterQuery = await supabase
      .from("series_characters")
      .select("quest_id, role, personality, arc_start, arc_end")
      .in("quest_id", questIds)
      .eq("creator_id", userId);
    if (characterQuery.error) throw characterQuery.error;
    for (const row of (characterQuery.data || []) as Array<Record<string, unknown>>) {
      const questId = clean(typeof row.quest_id === "string" ? row.quest_id : "");
      if (!questId) continue;
      const rows = characterRowsByQuestId.get(questId) || [];
      rows.push(row);
      characterRowsByQuestId.set(questId, rows);
    }
  } catch (error) {
    const coded = error as { code?: string };
    if (coded?.code !== "42P01" && !isMissingAnyColumn(error, ["personality", "arc_start", "arc_end"])) {
      throw error;
    }
  }

  const recentTitles: string[] = [];
  const recentCaseMotifs: string[] = [];
  const recentCharacterArchetypes: string[] = [];
  const recentRelationshipPatterns: string[] = [];
  const recentVisualMotifs: string[] = [];
  const recentTruthPatterns: string[] = [];
  const recentCheckpointPatterns: string[] = [];
  const recentFirstEpisodePatterns: string[] = [];
  const recentEnvironmentPatterns: string[] = [];
  const recentAppearancePatterns: string[] = [];

  for (const questRow of questRows as Array<Record<string, unknown>>) {
    const questId = clean(typeof questRow.id === "string" ? questRow.id : "");
    const bible = bibleByQuestId.get(questId) || {};
    const world = asRecord(bible.world);
    const continuity = asRecord(bible.continuity);
    const firstEpisodeSeed = asRecord(bible.first_episode_seed);
    const seriesBlueprint = asRecord(bible.series_blueprint);
    const frameworkBrief = asRecord(seriesBlueprint.frameworkBrief);
    const seriesDesign = asRecord(frameworkBrief.seriesDesign);
    const continuityAxes = asRecord(seriesBlueprint.continuityAxes);
    const identityPack = asRecord(seriesBlueprint.identityPack);
    const seriesCoreAnchors = asRecord(identityPack.seriesCoreAnchors);
    const characterRows = characterRowsByQuestId.get(questId) || [];

    recentTitles.push(
      clean(typeof bible.title === "string" ? bible.title : "") ||
        clean(typeof questRow.title === "string" ? questRow.title : "")
    );
    recentCaseMotifs.push(
      clean(typeof continuity.global_mystery === "string" ? continuity.global_mystery : ""),
      clean(typeof bible.premise === "string" ? bible.premise : ""),
      clean(typeof bible.overview === "string" ? bible.overview : "")
    );
    recentTruthPatterns.push(
      clean(typeof continuity.finale_payoff === "string" ? continuity.finale_payoff : ""),
      clean(typeof continuity.mid_season_twist === "string" ? continuity.mid_season_twist : ""),
      clean(typeof bible.season_goal === "string" ? bible.season_goal : "")
    );
    recentEnvironmentPatterns.push(
      clean(typeof world.setting === "string" ? world.setting : ""),
      clean(typeof questRow.area_name === "string" ? questRow.area_name : "")
    );
    recentFirstEpisodePatterns.push(
      clean(typeof firstEpisodeSeed.opening_scene === "string" ? firstEpisodeSeed.opening_scene : ""),
      clean(typeof firstEpisodeSeed.completion_condition === "string" ? firstEpisodeSeed.completion_condition : ""),
      clean(typeof firstEpisodeSeed.route_style === "string" ? firstEpisodeSeed.route_style : "")
    );
    recentRelationshipPatterns.push(
      clean(typeof seriesDesign.relationshipPromise === "string" ? seriesDesign.relationshipPromise : ""),
      clean(typeof seriesDesign.fixedCastPolicy === "string" ? seriesDesign.fixedCastPolicy : "")
    );
    recentVisualMotifs.push(
      ...asStringArray(world.recurringMotifs),
      ...asStringArray(seriesCoreAnchors.nonNegotiableMood),
      ...asStringArray(seriesCoreAnchors.nonNegotiableTheme)
    );
    recentCheckpointPatterns.push(
      ...asRecordArray(continuityAxes.axes).map((row) => clean(typeof row.label === "string" ? row.label : "")),
      ...asRecordArray(continuityAxes.axes).map((row) =>
        clean(typeof row.carryOverRule === "string" ? row.carryOverRule : "")
      )
    );

    for (const row of characterRows) {
      recentCharacterArchetypes.push(
        clean(typeof row.role === "string" ? row.role : ""),
        clean(typeof row.personality === "string" ? row.personality : "")
      );
      recentAppearancePatterns.push(
        clean(typeof row.personality === "string" ? row.personality : ""),
        clean(typeof row.arc_start === "string" ? row.arc_start : ""),
        clean(typeof row.arc_end === "string" ? row.arc_end : "")
      );
    }
  }

  return {
    recentTitles: limitRecentContext(recentTitles),
    recentCaseMotifs: limitRecentContext(recentCaseMotifs),
    recentCharacterArchetypes: limitRecentContext(recentCharacterArchetypes),
    recentRelationshipPatterns: limitRecentContext(recentRelationshipPatterns),
    recentVisualMotifs: limitRecentContext(recentVisualMotifs),
    recentTruthPatterns: limitRecentContext(recentTruthPatterns),
    recentCheckpointPatterns: limitRecentContext(recentCheckpointPatterns),
    recentFirstEpisodePatterns: limitRecentContext(recentFirstEpisodePatterns),
    recentEnvironmentPatterns: limitRecentContext(recentEnvironmentPatterns),
    recentAppearancePatterns: limitRecentContext(recentAppearancePatterns),
  };
};

export const findReusableSeriesDraft = async (payload: {
  userId: string;
  sourcePrompt: string;
  titleCandidate?: string | null;
  limit?: number;
}): Promise<ReusableSeriesDraft | null> => {
  const supabase = getSupabaseOrThrow();
  const normalizedPrompt = normalize(payload.sourcePrompt);
  const normalizedTitle = normalize(payload.titleCandidate);
  if (!normalizedPrompt && !normalizedTitle) return null;

  const { data: questRows, error: questError } = await supabase
    .from("quests")
    .select("id, series_id, title, status, created_at")
    .eq("creator_id", payload.userId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, payload.limit ?? 20));

  if (questError) throw questError;
  if (!questRows || questRows.length === 0) return null;

  const questIds = questRows
    .map((row) => clean((row as { id?: string | null }).id || ""))
    .filter(Boolean);

  const sourcePromptByQuestId = new Map<string, string>();
  try {
    const bibleQuery = await supabase
      .from("series_bibles")
      .select("quest_id, source_prompt")
      .in("quest_id", questIds)
      .eq("creator_id", payload.userId);
    if (bibleQuery.error) throw bibleQuery.error;
    for (const row of (bibleQuery.data || []) as Array<Record<string, unknown>>) {
      const questId = clean(typeof row.quest_id === "string" ? row.quest_id : "");
      const sourcePrompt = clean(typeof row.source_prompt === "string" ? row.source_prompt : "");
      if (questId && sourcePrompt) sourcePromptByQuestId.set(questId, sourcePrompt);
    }
  } catch (error) {
    const coded = error as { code?: string };
    if (coded?.code !== "42P01" && !isMissingAnyColumn(error, ["source_prompt"])) {
      throw error;
    }
  }

  let best: ReusableSeriesDraft | null = null;
  let bestScore = 0;

  for (const row of questRows as Array<Record<string, unknown>>) {
    const questId = clean(typeof row.id === "string" ? row.id : "");
    const seriesId = clean(typeof row.series_id === "string" ? row.series_id : "");
    const title = clean(typeof row.title === "string" ? row.title : "");
    if (!questId || !seriesId) continue;

    const sourcePrompt = sourcePromptByQuestId.get(questId) || null;
    let score = 0;
    if (sourcePrompt && normalizedPrompt && normalize(sourcePrompt) === normalizedPrompt) score += 100;
    if (title && normalizedTitle && normalize(title) === normalizedTitle) score += 60;
    if (sourcePrompt && normalizedPrompt && normalize(sourcePrompt).includes(normalizedPrompt)) score += 20;
    if (title && normalizedTitle && normalize(title).includes(normalizedTitle)) score += 10;
    if (score <= 0) continue;

    if (score > bestScore) {
      bestScore = score;
      best = {
        questId,
        seriesId,
        title: title || "タイトル未設定",
        sourcePrompt,
        createdAt: typeof row.created_at === "string" ? row.created_at : null,
      };
    }
  }

  return best;
};

type UpdateQuestDraftMetadataPayload = {
  questId: string;
  seriesId: string;
  userId: string;
  title: string;
  description?: string | null;
  areaName?: string | null;
  coverImageUrl?: string | null;
};

export const updateQuestDraftMetadata = async (payload: UpdateQuestDraftMetadataPayload) => {
  const supabase = getSupabaseOrThrow();

  const { error: seriesError } = await supabase
    .from("series")
    .update({
      title: payload.title,
      worldview_text: payload.description || "",
    })
    .eq("id", payload.seriesId)
    .eq("owner_id", payload.userId);

  if (seriesError) throw seriesError;

  const { error: questError } = await supabase
    .from("quests")
    .update({
      title: payload.title,
      description: payload.description || null,
      area_name: payload.areaName || null,
      cover_image_url: payload.coverImageUrl || null,
    })
    .eq("id", payload.questId)
    .eq("creator_id", payload.userId)
    .eq("status", "draft");

  if (questError) throw questError;
};

export const fetchSeriesEpisodeRuntimeContext = async (questId: string, userId: string) => {
  const supabase = getSupabaseOrThrow();

  const { data: questRow, error: questError } = await supabase
    .from("quests")
    .select("id, title, description, area_name")
    .eq("id", questId)
    .eq("creator_id", userId)
    .maybeSingle();

  if (questError) throw questError;
  if (!questRow) return null;

  const bibleResponse = await supabase
    .from("series_bibles")
    .select("*")
    .eq("quest_id", questId)
    .eq("creator_id", userId)
    .limit(1);

  const bibleRows = (bibleResponse.data || null) as Array<Record<string, unknown>> | null;
  const bibleError = bibleResponse.error;

  if (bibleError && bibleError.code !== "42P01") {
    throw bibleError;
  }

  const bibleRow =
    ((bibleRows || [])[0] as
      | {
        overview?: string | null;
        premise?: string | null;
        season_goal?: string | null;
        ai_rules?: string | null;
        world?: Record<string, unknown> | null;
        continuity?: Record<string, unknown> | null;
        identity_pack?: Record<string, unknown> | null;
        cover_consistency_report?: Record<string, unknown> | null;
        progress_state?: Record<string, unknown> | null;
        first_episode_seed?: Record<string, unknown> | null;
        series_blueprint?: Record<string, unknown> | null;
        initial_user_series_state_template?: Record<string, unknown> | null;
        episode_runtime_bootstrap_payload?: Record<string, unknown> | null;
        user_series_state?: Record<string, unknown> | null;
      }
      | undefined) || null;

  let checkpointRows:
    | Array<{
      episode_no: number | null;
      title: string | null;
      objective: string | null;
      synopsis: string | null;
      cliffhanger: string | null;
    }>
    | null = null;

  try {
    const query = await supabase
      .from("series_episode_blueprints")
      .select("episode_no, title, objective, synopsis, cliffhanger")
      .eq("quest_id", questId)
      .eq("creator_id", userId)
      .order("episode_no", { ascending: true })
      .limit(8);
    checkpointRows = (query.data || null) as Array<{
      episode_no: number | null;
      title: string | null;
      objective: string | null;
      synopsis: string | null;
      cliffhanger: string | null;
    }> | null;
    if (query.error) throw query.error;
  } catch (error) {
    if (!isQuestEpisodesUnavailable(error)) {
      const coded = error as { code?: string };
      if (coded?.code !== "42P01") throw error;
    }
  }

  let characterRows:
    | Array<{
      id: string | null;
      name: string | null;
      role: string | null;
      portrait_image_url: string | null;
      must_appear: boolean | null;
      personality: string | null;
      arc_start: string | null;
      arc_end: string | null;
    }>
    | null = null;

  try {
    const queryWithTier = await supabase
      .from("series_characters")
      .select("id, name, role, portrait_image_url, must_appear, personality, arc_start, arc_end")
      .eq("quest_id", questId)
      .eq("creator_id", userId)
      .order("character_order", { ascending: true })
      .limit(8);

    let dataForMapping: Array<{
      id: string | null;
      name: string | null;
      role: string | null;
      portrait_image_url?: string | null;
      must_appear?: boolean | null;
      personality: string | null;
      arc_start: string | null;
      arc_end: string | null;
    }> | null = null;

    if (
      queryWithTier.error &&
      isMissingAnyColumn(queryWithTier.error, ["must_appear", "portrait_image_url"])
    ) {
      const legacyQuery = await supabase
        .from("series_characters")
        .select("id, name, role, personality, arc_start, arc_end")
        .eq("quest_id", questId)
        .eq("creator_id", userId)
        .order("character_order", { ascending: true })
        .limit(8);
      if (legacyQuery.error) throw legacyQuery.error;
      dataForMapping = ((legacyQuery.data || null) as Array<{
        id: string | null;
        name: string | null;
        role: string | null;
        personality: string | null;
        arc_start: string | null;
        arc_end: string | null;
      }> | null)?.map((row) => ({
        ...row,
        portrait_image_url: null,
        must_appear: null,
      })) || null;
    } else {
      if (queryWithTier.error) throw queryWithTier.error;
      dataForMapping = (queryWithTier.data || null) as Array<{
        id: string | null;
        name: string | null;
        role: string | null;
        portrait_image_url?: string | null;
        must_appear?: boolean | null;
        personality: string | null;
        arc_start: string | null;
        arc_end: string | null;
      }> | null;
    }

    characterRows = (dataForMapping || null) as Array<{
      id: string | null;
      name: string | null;
      role: string | null;
      portrait_image_url: string | null;
      must_appear: boolean | null;
      personality: string | null;
      arc_start: string | null;
      arc_end: string | null;
    }> | null;
  } catch (error) {
    const coded = error as { code?: string };
    if (coded?.code !== "42P01") throw error;
  }

  const recentEpisodes = (await fetchSeriesEpisodes(questId))
    .slice(-3)
    .map((episode) => ({
      episodeNo: episode.episodeNo,
      title: episode.title,
      summary: clean(episode.body).slice(0, 160),
    }));

  return {
    title: (questRow as { title: string | null }).title || "タイトル未設定",
    overview: bibleRow?.overview || (questRow as { description: string | null }).description || null,
    premise: bibleRow?.premise || null,
    seasonGoal: bibleRow?.season_goal || null,
    aiRules: bibleRow?.ai_rules || null,
    worldSetting: clean(typeof bibleRow?.world?.setting === "string" ? (bibleRow?.world?.setting as string) : "") ||
      (questRow as { area_name: string | null }).area_name ||
      null,
    continuity: (bibleRow?.continuity as Record<string, unknown>) || null,
    identityPack: (bibleRow?.identity_pack as Record<string, unknown>) || null,
    coverConsistencyReport: (bibleRow?.cover_consistency_report as Record<string, unknown>) || null,
    progressState: (bibleRow?.progress_state as Record<string, unknown>) || null,
    firstEpisodeSeed: (bibleRow?.first_episode_seed as Record<string, unknown>) || null,
    seriesBlueprint: (bibleRow?.series_blueprint as Record<string, unknown>) || null,
    initialUserSeriesStateTemplate:
      (bibleRow?.initial_user_series_state_template as Record<string, unknown>) || null,
    episodeRuntimeBootstrapPayload:
      (bibleRow?.episode_runtime_bootstrap_payload as Record<string, unknown>) || null,
    userSeriesState: (bibleRow?.user_series_state as Record<string, unknown>) || null,
    checkpoints: ((checkpointRows || []) as Array<{
      episode_no: number | null;
      title: string | null;
      objective: string | null;
      synopsis: string | null;
      cliffhanger: string | null;
    }>).map((row, index) => ({
      checkpointNo: row.episode_no || index + 1,
      title: row.title || `CP${index + 1}`,
      purpose: row.objective || null,
      unlockHint: row.synopsis || null,
      carryOver: row.cliffhanger || null,
    })),
    characters: ((characterRows || []) as Array<{
      id: string | null;
      name: string | null;
      role: string | null;
      portrait_image_url: string | null;
      must_appear?: boolean | null;
      personality: string | null;
      arc_start: string | null;
      arc_end: string | null;
    }>)
      .filter((row) => Boolean(row.name && row.role))
      .map((row) => ({
        id: row.id || undefined,
        name: row.name || "登場人物",
        role: row.role || "役割未設定",
        avatarImageUrl: normalizeEpisodeCoverUrl(row.portrait_image_url),
        mustAppear: typeof row.must_appear === "boolean" ? row.must_appear : false,
        personality: row.personality,
        arcStart: row.arc_start,
        arcEnd: row.arc_end,
      })),
    recentEpisodes,
  } satisfies SeriesEpisodeRuntimeContext;
};

type ApplySeriesProgressPatchPayload = {
  questId: string;
  userId: string;
  savedEpisodeNo?: number;
  progressPatch: {
    unresolvedThreadsToAdd?: string[];
    unresolvedThreadsToRemove?: string[];
    revealedFactsToAdd?: string[];
    relationshipStateSummary?: string;
    relationshipFlagsToAdd?: string[];
    relationshipFlagsToRemove?: string[];
    recentRelationShift?: string[];
    companionTrustDelta?: number;
    nextHook?: string;
  };
};

export const applySeriesProgressPatch = async (payload: ApplySeriesProgressPatchPayload) => {
  const supabase = getSupabaseOrThrow();

  const { data, error } = await supabase
    .from("series_bibles")
    .select("id, progress_state")
    .eq("quest_id", payload.questId)
    .eq("creator_id", payload.userId)
    .maybeSingle();

  if (error) {
    if (isMissingAnyColumn(error, ["progress_state"])) return;
    if ((error as { code?: string })?.code === "42P01") return;
    throw error;
  }
  if (!data?.id) return;

  const rawCurrent = asRecord((data as { progress_state?: unknown }).progress_state);
  const currentLast = Number.parseInt(String(rawCurrent.last_completed_episode_no ?? 0), 10);
  const currentTrust = Number.parseFloat(String(rawCurrent.companion_trust_level ?? 40));

  const unresolvedBefore = asStringArray(rawCurrent.unresolved_threads);
  const unresolvedRemoved = asStringArray(payload.progressPatch.unresolvedThreadsToRemove || []);
  const unresolvedAfter = dedupe(
    unresolvedBefore
      .filter((item) => !unresolvedRemoved.some((removed) => normalize(removed) === normalize(item)))
      .concat(asStringArray(payload.progressPatch.unresolvedThreadsToAdd || []))
  );

  const revealedAfter = dedupe(
    asStringArray(rawCurrent.revealed_facts).concat(asStringArray(payload.progressPatch.revealedFactsToAdd || []))
  );

  const currentFlags = asStringArray(rawCurrent.relationship_flags);
  const relationFlagsToRemove = asStringArray(payload.progressPatch.relationshipFlagsToRemove || []);
  const relationFlagsAfter = dedupe(
    currentFlags
      .filter((item) => !relationFlagsToRemove.some((removed) => normalize(removed) === normalize(item)))
      .concat(asStringArray(payload.progressPatch.relationshipFlagsToAdd || []))
  );
  const recentRelationShift = dedupe([
    ...asStringArray(payload.progressPatch.recentRelationShift || []),
    ...asStringArray(rawCurrent.recent_relation_shift),
  ]).slice(0, 8);
  const relationshipStateSummary =
    clean(payload.progressPatch.relationshipStateSummary) ||
    clean(typeof rawCurrent.relationship_state_summary === "string" ? rawCurrent.relationship_state_summary : "") ||
    "関係性は継続中。";

  const trustDelta = Number.parseFloat(String(payload.progressPatch.companionTrustDelta ?? 0));
  const nextTrust = Number.isFinite(currentTrust) ? currentTrust : 40;
  const derivedTrustFromFlags = 40 + relationFlagsAfter.length * 2;
  const companionTrustLevel = Math.max(
    0,
    Math.min(
      100,
      Math.round((Number.isFinite(nextTrust) ? nextTrust : derivedTrustFromFlags) + (Number.isFinite(trustDelta) ? trustDelta : 0))
    )
  );
  const nextHook = clean(payload.progressPatch.nextHook) || clean(typeof rawCurrent.next_hook === "string" ? rawCurrent.next_hook : "");
  const currentLastSafe = Number.isFinite(currentLast) ? Math.max(0, currentLast) : 0;
  const lastCompletedEpisodeNo = Math.max(
    currentLastSafe,
    Number.isFinite(payload.savedEpisodeNo) ? (payload.savedEpisodeNo as number) : currentLastSafe + 1
  );

  const nextState = {
    last_completed_episode_no: lastCompletedEpisodeNo,
    unresolved_threads: unresolvedAfter,
    revealed_facts: revealedAfter,
    relationship_state_summary: relationshipStateSummary,
    relationship_flags: relationFlagsAfter,
    recent_relation_shift: recentRelationShift,
    companion_trust_level: companionTrustLevel,
    next_hook: nextHook,
  };

  const { error: updateError } = await supabase
    .from("series_bibles")
    .update({
      progress_state: nextState,
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.id)
    .eq("creator_id", payload.userId);

  if (updateError) {
    if (isMissingAnyColumn(updateError, ["progress_state"])) return;
    throw updateError;
  }
};

type ApplySeriesContinuityPatchVNextPayload = {
  questId: string;
  userId: string;
  savedEpisodeNo?: number;
  continuityPatch: Record<string, unknown>;
};

const continuityPatchToLegacyProgressPatch = (
  patch: Record<string, unknown>
): ApplySeriesProgressPatchPayload["progressPatch"] => {
  const memoryPatch = asRecord(patch.memoryPatch);
  const relationshipPatch = Array.isArray(patch.relationshipPatch) ? patch.relationshipPatch : [];
  const payoffPatch = asRecord(patch.payoffPatch);
  const arcPatch = asRecord(patch.arcPatch);

  const trustDeltas = relationshipPatch
    .map((item) => Number.parseFloat(String(asRecord(item).trustDelta ?? 0)))
    .filter((value) => Number.isFinite(value));
  const avgTrustDelta = trustDeltas.length
    ? trustDeltas.reduce((sum, value) => sum + value, 0) / trustDeltas.length
    : 0;

  return {
    unresolvedThreadsToAdd: asStringArray(payoffPatch.activeThreads),
    unresolvedThreadsToRemove: asStringArray(payoffPatch.closedThreads),
    revealedFactsToAdd: dedupe([
      ...asStringArray(memoryPatch.addedEvents),
      ...asStringArray(memoryPatch.addedSharedMemories),
    ]),
    relationshipStateSummary:
      clean(typeof arcPatch.arcSummaryAfterEpisode === "string" ? arcPatch.arcSummaryAfterEpisode : "") ||
      "関係性は継続中。",
    relationshipFlagsToAdd: dedupe(
      relationshipPatch
        .map((item) => {
          const row = asRecord(item);
          return clean(typeof row.newRelationshipState === "string" ? row.newRelationshipState : "");
        })
        .filter(Boolean)
    ),
    relationshipFlagsToRemove: [],
    recentRelationShift: dedupe(
      relationshipPatch
        .map((item) => {
          const row = asRecord(item);
          return clean(typeof row.keyMomentSummary === "string" ? row.keyMomentSummary : "");
        })
        .filter(Boolean)
    ).slice(0, 8),
    companionTrustDelta: Number.isFinite(avgTrustDelta)
      ? Math.round(Math.max(-10, Math.min(10, avgTrustDelta)))
      : undefined,
    nextHook:
      asStringArray(payoffPatch.newlySeededForeshadowing)[0] ||
      clean(typeof arcPatch.approachToEnding === "string" ? arcPatch.approachToEnding : "") ||
      "",
  };
};

export const applySeriesContinuityPatchVNext = async (
  payload: ApplySeriesContinuityPatchVNextPayload
) => {
  const supabase = getSupabaseOrThrow();
  const { continuityPatch } = payload;
  if (!continuityPatch || typeof continuityPatch !== "object") return;

  const baseLegacyPatch = continuityPatchToLegacyProgressPatch(
    asRecord(continuityPatch)
  );

  const query = await supabase
    .from("series_bibles")
    .select("id, user_series_state, progress_state")
    .eq("quest_id", payload.questId)
    .eq("creator_id", payload.userId)
    .maybeSingle();

  if (query.error) {
    if (isMissingAnyColumn(query.error, ["user_series_state"])) {
      await applySeriesProgressPatch({
        questId: payload.questId,
        userId: payload.userId,
        savedEpisodeNo: payload.savedEpisodeNo,
        progressPatch: baseLegacyPatch,
      });
      return;
    }
    if ((query.error as { code?: string })?.code === "42P01") return;
    throw query.error;
  }

  if (!query.data?.id) {
    await applySeriesProgressPatch({
      questId: payload.questId,
      userId: payload.userId,
      savedEpisodeNo: payload.savedEpisodeNo,
      progressPatch: baseLegacyPatch,
    });
    return;
  }

  const row = query.data as {
    id: string;
    user_series_state?: unknown;
    progress_state?: unknown;
  };

  const rawPatch = asRecord(continuityPatch);
  const memoryPatch = asRecord(rawPatch.memoryPatch);
  const relationshipPatch = Array.isArray(rawPatch.relationshipPatch)
    ? rawPatch.relationshipPatch
    : [];
  const achievementPatch = asRecord(rawPatch.achievementPatch);
  const payoffPatch = asRecord(rawPatch.payoffPatch);
  const continuityAxisPatch = Array.isArray(rawPatch.continuityAxisPatch)
    ? rawPatch.continuityAxisPatch
    : [];
  const localCharacterPatch = asRecord(rawPatch.localCharacterPatch);

  const legacyProgress = asRecord(row.progress_state);
  const currentState = asRecord(row.user_series_state);
  const progressSummary = asRecord(currentState.progressSummary);
  const currentProgress = asRecord(currentState.currentProgress);
  const rememberedExperience = asRecord(currentState.rememberedExperience);
  const achievementState = asRecord(currentState.achievementState);
  const continuityState = asRecord(currentState.continuityState);

  const currentEpisodeCount = Math.max(
    0,
    Number.parseInt(
      String(
        progressSummary.episodeCountCompleted ??
          currentProgress.episodeCountCompleted ??
          legacyProgress.last_completed_episode_no ??
          0
      ),
      10
    ) || 0
  );
  const nextEpisodeCount = Math.max(
    currentEpisodeCount + 1,
    Number.isFinite(payload.savedEpisodeNo || NaN)
      ? Number(payload.savedEpisodeNo)
      : currentEpisodeCount + 1
  );
  const unresolvedThreads = dedupe(
    asStringArray(payoffPatch.activeThreads).concat(
      asStringArray(progressSummary.activeThreads)
    ).concat(
      asStringArray(currentProgress.unresolvedThreads)
    )
  ).filter(
    (item) =>
      !asStringArray(payoffPatch.closedThreads).some(
        (closed) => normalize(closed) === normalize(item)
      )
  );
  const resolvedThreads = dedupe(
    asStringArray(progressSummary.resolvedThreads)
      .concat(asStringArray(currentProgress.resolvedThreads))
      .concat(asStringArray(legacyProgress.revealed_facts))
      .concat(asStringArray(payoffPatch.closedThreads))
      .concat(asStringArray(payoffPatch.resolvedForeshadowing))
      .concat(asStringArray(memoryPatch.addedEvents))
  );
  const activeForeshadowing = dedupe(
    asStringArray(currentProgress.activeForeshadowing).concat(
      asStringArray(payoffPatch.newlySeededForeshadowing)
    )
  ).filter(
    (item) =>
      !asStringArray(payoffPatch.resolvedForeshadowing).some(
        (resolved) => normalize(resolved) === normalize(item)
      )
  );

  const continuityAxisProgressById = new Map<string, Record<string, unknown>>();
  asRecordArray(progressSummary.continuityAxisProgress).forEach((item) => {
    const axisId = clean(typeof item.axisId === "string" ? item.axisId : "");
    if (!axisId) return;
    continuityAxisProgressById.set(axisId, item);
  });
  continuityAxisPatch.forEach((item) => {
    const rowPatch = asRecord(item);
    const axisId = clean(typeof rowPatch.axisId === "string" ? rowPatch.axisId : "");
    if (!axisId) return;
    const before = continuityAxisProgressById.get(axisId) || {};
    continuityAxisProgressById.set(axisId, {
      ...before,
      axisId,
      currentLabel:
        clean(typeof rowPatch.nextLabel === "string" ? rowPatch.nextLabel : "") ||
        clean(typeof before.currentLabel === "string" ? before.currentLabel : "") ||
        "進行中",
      recentShift:
        clean(typeof rowPatch.movementReason === "string" ? rowPatch.movementReason : "") ||
        clean(typeof before.recentShift === "string" ? before.recentShift : "") ||
        "変化なし",
    });
  });
  const continuityAxisProgress = Array.from(continuityAxisProgressById.values()).map((item) => ({
    axisId: clean(typeof item.axisId === "string" ? item.axisId : ""),
    currentLabel: clean(typeof item.currentLabel === "string" ? item.currentLabel : "") || "進行中",
    recentShift: clean(typeof item.recentShift === "string" ? item.recentShift : "") || "変化なし",
  }));

  const previousRelationship = Array.isArray(currentState.relationshipState)
    ? currentState.relationshipState.map((item) => asRecord(item))
    : [];
  const relationById = new Map<string, Record<string, unknown>>();
  previousRelationship.forEach((item) => {
    const id = clean(typeof item.characterId === "string" ? item.characterId : "");
    if (!id) return;
    relationById.set(id, item);
  });

  relationshipPatch.forEach((item) => {
    const rowPatch = asRecord(item);
    const characterId = clean(
      typeof rowPatch.characterId === "string" ? rowPatch.characterId : ""
    );
    if (!characterId) return;
    const before = relationById.get(characterId) || {
      characterId,
      closenessLabel: "neutral",
      trustLevel: 40,
      tensionLevel: 20,
      affectionLevel: 0,
      specialFlags: [],
      sharedMemories: [],
      unresolvedEmotions: [],
    };
    const trustLevel = Math.max(
      0,
      Math.min(
        100,
        toFiniteNumber(before.trustLevel, 40) + toFiniteNumber(rowPatch.trustDelta, 0)
      )
    );
    const tensionLevel = Math.max(
      0,
      Math.min(
        100,
        toFiniteNumber(before.tensionLevel, 20) + toFiniteNumber(rowPatch.tensionDelta, 0)
      )
    );
    const affectionLevel = Math.max(
      0,
      Math.min(
        100,
        toFiniteNumber(before.affectionLevel, 0) + toFiniteNumber(rowPatch.affectionDelta, 0)
      )
    );
    relationById.set(characterId, {
      ...before,
      characterId,
      trustLevel: Math.round(trustLevel),
      tensionLevel: Math.round(tensionLevel),
      affectionLevel: Math.round(affectionLevel),
      closenessLabel:
        clean(
          typeof rowPatch.newRelationshipState === "string"
            ? rowPatch.newRelationshipState
            : ""
        ) || clean(typeof before.closenessLabel === "string" ? before.closenessLabel : "") || "neutral",
      specialFlags: dedupe(
        asStringArray(before.specialFlags).concat(
          clean(
            typeof rowPatch.newRelationshipState === "string"
              ? rowPatch.newRelationshipState
              : ""
          )
        )
      ),
      sharedMemories: dedupe(
        asStringArray(before.sharedMemories)
          .concat(asStringArray(memoryPatch.addedSharedMemories))
          .concat(
            clean(
              typeof rowPatch.keyMomentSummary === "string"
                ? rowPatch.keyMomentSummary
                : ""
            )
          )
      ),
      unresolvedEmotions:
        tensionLevel > 55
          ? dedupe(
              asStringArray(before.unresolvedEmotions).concat(
                clean(
                  typeof rowPatch.keyMomentSummary === "string"
                    ? rowPatch.keyMomentSummary
                    : ""
                )
              )
            )
          : asStringArray(before.unresolvedEmotions),
    });
  });

  const callbackEligibleRows = Array.isArray(localCharacterPatch.callbackEligible)
    ? localCharacterPatch.callbackEligible.map((item) => asRecord(item))
    : [];
  const introducedRows = Array.isArray(localCharacterPatch.introduced)
    ? localCharacterPatch.introduced.map((item) => asRecord(item))
    : [];

  const callbackMemoryLabels = introducedRows
    .map((item) => {
      const localCharacterId = clean(
        typeof item.localCharacterId === "string" ? item.localCharacterId : ""
      );
      if (!localCharacterId) return "";
      const reasonRow = callbackEligibleRows.find(
        (rowCallback) =>
          clean(
            typeof rowCallback.localCharacterId === "string"
              ? rowCallback.localCharacterId
              : ""
          ) === localCharacterId
      );
      const displayName =
        clean(typeof item.displayName === "string" ? item.displayName : "") ||
        localCharacterId;
      const reason =
        clean(typeof reasonRow?.reason === "string" ? reasonRow.reason : "") ||
        "再登場候補";
      return `${displayName}:${reason}`;
    })
    .filter(Boolean);

  const remembered = {
    visitedLocations: dedupe(
      asStringArray(rememberedExperience.visitedLocations).concat(
        asStringArray(memoryPatch.addedLocationMemories)
      )
    ),
    keyEvents: dedupe(
      asStringArray(rememberedExperience.keyEvents).concat(
        asStringArray(memoryPatch.addedEvents)
      )
    ),
    importantConversations: dedupe(
      asStringArray(rememberedExperience.importantConversations).concat(
        asStringArray(memoryPatch.addedConversations)
      )
    ),
    playerChoices: asStringArray(rememberedExperience.playerChoices),
    emotionalMoments: dedupe(
      asStringArray(rememberedExperience.emotionalMoments).concat(
        relationshipPatch
          .map((item) => {
            const row = asRecord(item);
            return clean(
              typeof row.keyMomentSummary === "string"
                ? row.keyMomentSummary
                : ""
            );
          })
          .filter(Boolean)
      )
    ),
    relationshipTurningPoints: dedupe(
      asStringArray(rememberedExperience.relationshipTurningPoints).concat(
        relationshipPatch
          .map((item) => {
            const row = asRecord(item);
            return clean(
              typeof row.keyMomentSummary === "string"
                ? row.keyMomentSummary
                : ""
            );
          })
          .filter(Boolean)
      )
    ),
  };

  const nextUserSeriesState = {
    id:
      clean(typeof currentState.id === "string" ? currentState.id : "") ||
      `${payload.questId}:${payload.userId}`,
    userId:
      clean(typeof currentState.userId === "string" ? currentState.userId : "") ||
      payload.userId,
    seriesBlueprintId:
      clean(
        typeof currentState.seriesBlueprintId === "string"
          ? currentState.seriesBlueprintId
          : ""
      ) || payload.questId,
    referencedBlueprintVersion: Math.max(
      1,
      Number.parseInt(String(currentState.referencedBlueprintVersion ?? 1), 10) || 1
    ),
    stateVersion:
      Math.max(1, Number.parseInt(String(currentState.stateVersion ?? 1), 10) || 1) + 1,
    progressSummary: {
      episodeCountCompleted: nextEpisodeCount,
      activeThreads: unresolvedThreads,
      resolvedThreads,
      recentEpisodeIds: dedupe(
        asStringArray(progressSummary.recentEpisodeIds).concat(
        asStringArray(currentProgress.completedEpisodeIds).concat(
          `episode_${nextEpisodeCount}`
        )
        )
      ),
      continuityAxisProgress,
    },
    rememberedExperience: remembered,
    relationshipState: Array.from(relationById.values()),
    achievementState: {
      titles: dedupe(
        asStringArray(achievementState.titles).concat(
          asStringArray(achievementPatch.addedTitles)
        )
      ),
      achievements: dedupe(
        asStringArray(achievementState.achievements).concat(
          asStringArray(achievementPatch.addedAchievements)
        )
      ),
      discoveryTags: dedupe(
        asStringArray(achievementState.discoveryTags).concat(
          asStringArray(achievementPatch.addedDiscoveryTags)
        )
      ),
    },
    continuityState: {
      callbackCandidates: dedupe(
        asStringArray(continuityState.callbackCandidates)
          .concat(asStringArray(memoryPatch.addedEvents))
          .concat(callbackMemoryLabels)
      ),
      motifsInUse: asStringArray(continuityState.motifsInUse),
      blockedLines: asStringArray(continuityState.blockedLines),
      promisedPayoffs: dedupe(
        asStringArray(continuityState.promisedPayoffs).concat(
          asStringArray(payoffPatch.newlySeededForeshadowing)
        )
      ),
    },
  };

  const trustAverage = (() => {
    const trustValues = nextUserSeriesState.relationshipState
      .map((item) => toFiniteNumber(asRecord(item).trustLevel, NaN))
      .filter((value) => Number.isFinite(value));
    if (trustValues.length === 0) return 40;
    return Math.round(
      trustValues.reduce((sum, value) => sum + value, 0) / trustValues.length
    );
  })();

  const projectedProgressState = {
    last_completed_episode_no: nextUserSeriesState.progressSummary.episodeCountCompleted,
    unresolved_threads: nextUserSeriesState.progressSummary.activeThreads,
    revealed_facts: nextUserSeriesState.progressSummary.resolvedThreads,
    relationship_state_summary:
      dedupe(
        nextUserSeriesState.relationshipState.map((item) => {
          const row = asRecord(item);
          return clean(typeof row.closenessLabel === "string" ? row.closenessLabel : "");
        })
      ).join(" / ") ||
      baseLegacyPatch.relationshipStateSummary,
    relationship_flags: dedupe(
      nextUserSeriesState.relationshipState.flatMap((item) =>
        asStringArray(asRecord(item).specialFlags)
      )
    ),
    recent_relation_shift: remembered.relationshipTurningPoints.slice(-8),
    companion_trust_level: trustAverage,
    next_hook:
      asStringArray(payoffPatch.newlySeededForeshadowing)[0] ||
      baseLegacyPatch.nextHook ||
      clean(typeof legacyProgress.next_hook === "string" ? legacyProgress.next_hook : ""),
  };

  const update = await supabase
    .from("series_bibles")
    .update({
      user_series_state: nextUserSeriesState,
      progress_state: projectedProgressState,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("creator_id", payload.userId);

  if (update.error) {
    if (isMissingAnyColumn(update.error, ["user_series_state"])) {
      await applySeriesProgressPatch({
        questId: payload.questId,
        userId: payload.userId,
        savedEpisodeNo: payload.savedEpisodeNo,
        progressPatch: baseLegacyPatch,
      });
      return;
    }
    throw update.error;
  }
};

export const fetchSeriesEpisodes = async (questId: string) => {
  const supabase = getSupabaseOrThrow();

  try {
    const withCover = await supabase
      .from("quest_episodes")
      .select(
        "id, title, body, episode_no, status, created_at, user_id, cover_image_url"
      )
      .eq("quest_id", questId)
      .order("episode_no", { ascending: true })
      .order("created_at", { ascending: true });

    let data:
      | Array<{
          id: string;
          title: string | null;
          body: string | null;
          episode_no: number | null;
          status: string | null;
          created_at: string | null;
          user_id: string;
          cover_image_url?: string | null;
        }>
      | null = null;

    if (withCover.error) {
      if (!isMissingAnyColumn(withCover.error, ["cover_image_url"])) {
        throw withCover.error;
      }
      console.warn(
        "fetchSeriesEpisodes: quest_episodes.cover_image_url column is missing. Episode covers will not be loaded until migration is applied."
      );

      const withoutCover = await supabase
        .from("quest_episodes")
        .select("id, title, body, episode_no, status, created_at, user_id")
        .eq("quest_id", questId)
        .order("episode_no", { ascending: true })
        .order("created_at", { ascending: true });

      if (withoutCover.error) throw withoutCover.error;
      data =
        (withoutCover.data as Array<{
          id: string;
          title: string | null;
          body: string | null;
          episode_no: number | null;
          status: string | null;
          created_at: string | null;
          user_id: string;
        }> | null) || [];
    } else {
      data =
        (withCover.data as Array<{
          id: string;
          title: string | null;
          body: string | null;
          episode_no: number | null;
          status: string | null;
          created_at: string | null;
          user_id: string;
          cover_image_url?: string | null;
        }> | null) || [];
    }

    return (data || []).map((row, index) => ({
      id: row.id,
      title: (row.title || "").trim() || `エピソード ${row.episode_no || index + 1}`,
      body: row.body || "",
      episodeNo: row.episode_no || index + 1,
      status: row.status || "published",
      source: "quest_episodes",
      userId: row.user_id,
      createdAt: row.created_at,
      coverImageUrl: normalizeEpisodeCoverUrl(row.cover_image_url),
    })) satisfies SeriesEpisode[];
  } catch (error) {
    if (!isQuestEpisodesUnavailable(error)) throw error;
  }

  let posts:
    | Array<{
        id: string;
        message: string | null;
        created_at: string | null;
        user_id: string;
        image_urls?: unknown;
      }>
    | null = null;

  const withImages = await supabase
    .from("quest_posts")
    .select("id, message, created_at, user_id, image_urls")
    .eq("quest_id", questId)
    .order("created_at", { ascending: true });

  if (withImages.error) {
    if (!isMissingAnyColumn(withImages.error, ["image_urls"])) {
      throw withImages.error;
    }
    console.warn(
      "fetchSeriesEpisodes: quest_posts.image_urls column is missing. Episode covers will not be loaded until migration is applied."
    );
    const withoutImages = await supabase
      .from("quest_posts")
      .select("id, message, created_at, user_id")
      .eq("quest_id", questId)
      .order("created_at", { ascending: true });
    if (withoutImages.error) throw withoutImages.error;
    posts =
      (withoutImages.data as Array<{
        id: string;
        message: string | null;
        created_at: string | null;
        user_id: string;
      }> | null) || [];
  } else {
    posts =
      (withImages.data as Array<{
        id: string;
        message: string | null;
        created_at: string | null;
        user_id: string;
        image_urls?: unknown;
      }> | null) || [];
  }

  return (posts || []).map((row, index) => {
    const lines = (row.message || "").split(/\r?\n/);
    const titleFromMessage = (lines[0] || "").trim();
    const bodyFromMessage = lines.slice(1).join("\n").trim();
    const imageCandidates = Array.isArray(row.image_urls)
      ? row.image_urls
          .map((item) => normalizeEpisodeCoverUrl(typeof item === "string" ? item : String(item ?? "")))
          .filter((item): item is string => Boolean(item))
      : [];

    return {
      id: row.id,
      title: titleFromMessage || `エピソード ${index + 1}`,
      body: bodyFromMessage,
      episodeNo: index + 1,
      status: "published",
      source: "quest_posts",
      userId: row.user_id,
      createdAt: row.created_at,
      coverImageUrl: imageCandidates[0] || null,
    } satisfies SeriesEpisode;
  });
};

type EpisodeMutationPayload = {
  episodeId: string;
  source: "quest_episodes" | "quest_posts";
  userId: string;
  questId?: string;
};

type UpdateEpisodePayload = EpisodeMutationPayload & {
  title: string;
  body: string;
};

export const updateSeriesEpisode = async (payload: UpdateEpisodePayload) => {
  const supabase = getSupabaseOrThrow();
  const normalizedTitle = payload.title.trim();
  if (!normalizedTitle) {
    throw asCodedError("Episode title is required.", "INVALID_INPUT");
  }

  if (payload.source === "quest_episodes") {
    const { error } = await supabase
      .from("quest_episodes")
      .update({
        title: normalizedTitle,
        body: payload.body,
      })
      .eq("id", payload.episodeId)
      .eq("user_id", payload.userId);

    if (error) throw error;
    return;
  }

  const message = payload.body.trim() ? `${normalizedTitle}\n\n${payload.body}` : normalizedTitle;
  const { error } = await supabase
    .from("quest_posts")
    .update({ message })
    .eq("id", payload.episodeId)
    .eq("user_id", payload.userId);

  if (error) throw error;
};

export const deleteSeriesEpisode = async (payload: EpisodeMutationPayload) => {
  const supabase = getSupabaseOrThrow();

  if (payload.source === "quest_episodes") {
    const ownedDelete = await supabase
      .from("quest_episodes")
      .delete()
      .eq("id", payload.episodeId)
      .eq("user_id", payload.userId)
      .select("id");

    if (ownedDelete.error) throw ownedDelete.error;
    if ((ownedDelete.data || []).length > 0) return;

    if (payload.questId) {
      const questOwnerDelete = await supabase
        .from("quest_episodes")
        .delete()
        .eq("id", payload.episodeId)
        .eq("quest_id", payload.questId)
        .select("id");

      if (questOwnerDelete.error) throw questOwnerDelete.error;
      if ((questOwnerDelete.data || []).length > 0) return;
    }

    throw asCodedError("Episode delete was not permitted.", "EPISODE_DELETE_FORBIDDEN");
    return;
  }

  const ownedDelete = await supabase
    .from("quest_posts")
    .delete()
    .eq("id", payload.episodeId)
    .eq("user_id", payload.userId)
    .select("id");

  if (ownedDelete.error) throw ownedDelete.error;
  if ((ownedDelete.data || []).length > 0) return;

  if (payload.questId) {
    const questOwnerDelete = await supabase
      .from("quest_posts")
      .delete()
      .eq("id", payload.episodeId)
      .eq("quest_id", payload.questId)
      .select("id");

    if (questOwnerDelete.error) throw questOwnerDelete.error;
    if ((questOwnerDelete.data || []).length > 0) return;
  }

  throw asCodedError("Episode delete was not permitted.", "EPISODE_DELETE_FORBIDDEN");
};

export const createEpisodeForSeries = async (payload: CreateEpisodePayload) => {
  const supabase = getSupabaseOrThrow();

  const trimmedSeriesTitle = payload.seriesTitle.trim();
  const trimmedEpisodeTitle = payload.episodeTitle.trim();
  const trimmedEpisodeText = payload.episodeText.trim();
  const normalizedCoverImageUrl =
    normalizeEpisodeCoverUrl(payload.coverImageUrl) ||
    buildEpisodeSeedCoverUrl(trimmedSeriesTitle, trimmedEpisodeTitle, payload.userId);

  if (!trimmedSeriesTitle || !trimmedEpisodeTitle) {
    throw asCodedError("Series title and episode title are required.", "INVALID_INPUT");
  }

  let targetQuest: { id: string; title: string | null } | null = null;
  if (payload.seriesId) {
    const { data: byIdRow, error: byIdError } = await supabase
      .from("quests")
      .select("id, title")
      .eq("id", payload.seriesId)
      .eq("creator_id", payload.userId)
      .maybeSingle();

    if (byIdError) throw byIdError;
    targetQuest = (byIdRow as { id: string; title: string | null } | null) || null;
  } else {
    const { data: questCandidates, error: questError } = await supabase
      .from("quests")
      .select("id, title")
      .eq("creator_id", payload.userId)
      .ilike("title", `%${trimmedSeriesTitle}%`)
      .order("created_at", { ascending: false })
      .limit(20);

    if (questError) throw questError;

    const candidates = (questCandidates || []) as Array<{ id: string; title: string | null }>;
    if (candidates.length > 0) {
      const exact = candidates.find((quest) => normalize(quest.title) === normalize(trimmedSeriesTitle));
      targetQuest = exact || candidates[0];
    }
  }

  if (!targetQuest) {
    throw asCodedError("Series not found.", "SERIES_NOT_FOUND");
  }

  const targetQuestTitle = targetQuest.title || trimmedSeriesTitle;

  const saveToQuestEpisodes = async () => {
    const { data: lastRows, error: lastError } = await supabase
      .from("quest_episodes")
      .select("episode_no")
      .eq("quest_id", targetQuest.id)
      .order("episode_no", { ascending: false })
      .limit(1);

    if (lastError) throw lastError;

    const nextEpisodeNo = (((lastRows || []) as Array<{ episode_no: number | null }>)[0]?.episode_no || 0) + 1;

    const withCover = await supabase
      .from("quest_episodes")
      .insert({
        quest_id: targetQuest.id,
        user_id: payload.userId,
        title: trimmedEpisodeTitle,
        body: trimmedEpisodeText || "",
        episode_no: nextEpisodeNo,
        status: "published",
        ...(normalizedCoverImageUrl ? { cover_image_url: normalizedCoverImageUrl } : {}),
      });

    if (withCover.error) {
      if (
        normalizedCoverImageUrl &&
        isMissingAnyColumn(withCover.error, ["cover_image_url"])
      ) {
        console.warn(
          "createEpisodeForSeries: quest_episodes.cover_image_url column is missing. Episode cover cannot be persisted."
        );
        const withoutCover = await supabase.from("quest_episodes").insert({
          quest_id: targetQuest.id,
          user_id: payload.userId,
          title: trimmedEpisodeTitle,
          body: trimmedEpisodeText || "",
          episode_no: nextEpisodeNo,
          status: "published",
        });
        if (withoutCover.error) throw withoutCover.error;
      } else {
        throw withCover.error;
      }
    }

    return {
      questId: targetQuest.id,
      questTitle: targetQuestTitle,
      storage: "quest_episodes",
      episodeNo: nextEpisodeNo,
    } satisfies EpisodeSaveResult;
  };

  const saveToQuestPosts = async () => {
    const message = trimmedEpisodeText
      ? `${trimmedEpisodeTitle}\n\n${trimmedEpisodeText}`
      : trimmedEpisodeTitle;

    const withImages = await supabase.from("quest_posts").insert({
      user_id: payload.userId,
      quest_id: targetQuest.id,
      message,
      image_urls: normalizedCoverImageUrl ? [normalizedCoverImageUrl] : [],
    });

    if (withImages.error) {
      if (isMissingAnyColumn(withImages.error, ["image_urls"])) {
        console.warn(
          "createEpisodeForSeries: quest_posts.image_urls column is missing. Episode cover cannot be persisted."
        );
        const withoutImages = await supabase.from("quest_posts").insert({
          user_id: payload.userId,
          quest_id: targetQuest.id,
          message,
        });
        if (withoutImages.error) throw withoutImages.error;
      } else {
        throw withImages.error;
      }
    }

    return {
      questId: targetQuest.id,
      questTitle: targetQuestTitle,
      storage: "quest_posts",
    } satisfies EpisodeSaveResult;
  };

  try {
    return await saveToQuestEpisodes();
  } catch (error) {
    if (!isQuestEpisodesUnavailable(error)) throw error;
    return saveToQuestPosts();
  }
};

type SaveRuntimeEpisodeSpotsPayload = {
  questId: string;
  userId?: string;
  episodeNo?: number;
  runtimeEpisode: GeneratedRuntimeEpisode;
  stageLocation?: string;
  stageCoords?: { lat: number; lng: number } | null;
  spotCoordinates?: RuntimeSpotCoordinate[];
};

export const saveRuntimeEpisodeSpots = async (
  payload: SaveRuntimeEpisodeSpotsPayload
) => {
  const supabase = getSupabaseOrThrow();
  const spots = payload.runtimeEpisode.spots || [];
  if (spots.length === 0) return { savedSpotCount: 0 };

  const coordsByName = new Map<string, RuntimeSpotCoordinate>();
  (payload.spotCoordinates || []).forEach((item) => {
    const key = normalize(item.spotName);
    if (!key) return;
    coordsByName.set(key, item);
  });

  const { data: currentRows, error: currentError } = await supabase
    .from("spots")
    .select("order_index")
    .eq("quest_id", payload.questId)
    .order("order_index", { ascending: false })
    .limit(1);

  if (currentError) {
    if (isMissingTableError(currentError, "spots")) {
      return { savedSpotCount: 0 };
    }
    throw currentError;
  }

  const maxOrder = ((currentRows || []) as Array<{ order_index: number | null }>)[0]?.order_index || 0;

  const toSpotRow = (spot: EpisodeSpot, index: number) => {
    const resolved = coordsByName.get(normalize(spot.spotName) || "");
    const lat = resolved?.lat ?? payload.stageCoords?.lat ?? null;
    const lng = resolved?.lng ?? payload.stageCoords?.lng ?? null;
    return {
      quest_id: payload.questId,
      name: clean(spot.spotName) || `スポット${index + 1}`,
      address:
        clean(resolved?.address || payload.stageLocation || spot.spotName) || "",
      lat,
      lng,
      order_index: maxOrder + index + 1,
    };
  };

  const spotRows = spots.map(toSpotRow);

  const { data: insertedSpots, error: insertSpotsError } = await supabase
    .from("spots")
    .insert(spotRows)
    .select("id, name, order_index");

  if (insertSpotsError) {
    if (isMissingTableError(insertSpotsError, "spots")) {
      return { savedSpotCount: 0 };
    }
    throw insertSpotsError;
  }

  const inserted =
    ((insertedSpots || []) as Array<{ id: string; name: string | null; order_index: number | null }>)
      .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  if (inserted.length === 0) return { savedSpotCount: 0 };

  const detailRows = inserted.map((row, index) => {
    const source = spots[index];
    return {
      spot_id: row.id,
      question_text: clean(source?.questionText) || null,
      answer_text: clean(source?.answerText) || null,
      hint_text: clean(source?.hintText) || null,
      explanation_text: clean(source?.explanationText) || null,
    };
  });

  const { error: detailsError } = await supabase.from("spot_details").insert(detailRows);
  if (detailsError && !isMissingTableError(detailsError, "spot_details")) {
    console.warn("saveRuntimeEpisodeSpots: spot_details insert warning", detailsError);
  }

  const characterMetaById = new Map(
    (payload.runtimeEpisode.characters || []).map((character) => [
      character.id,
      {
        name: clean(character.name) || character.id,
        avatarUrl: normalizeEpisodeCoverUrl(character.avatarImageUrl) || null,
      },
    ])
  );

  const messageRows = inserted.flatMap((row, index) => {
    const source = spots[index];
    if (!source) return [];

    const rows: Array<{
      quest_id: string;
      spot_id: string;
      stage: string;
      order_index: number;
      speaker_type: "narrator" | "character";
      speaker_name: string | null;
      avatar_url: string | null;
      text: string;
    }> = [];

    let preOrder = 1;
    if (clean(source.sceneNarration)) {
      rows.push({
        quest_id: payload.questId,
        spot_id: row.id,
        stage: "pre_puzzle",
        order_index: preOrder,
        speaker_type: "narrator",
        speaker_name: null,
        avatar_url: null,
        text: clean(source.sceneNarration),
      });
      preOrder += 1;
    }

    (source.preMissionDialogue || [])
      .map((dialogue) => ({
        characterMeta:
          (dialogue.characterId && characterMetaById.get(dialogue.characterId)) || null,
        speakerName: clean(
          (dialogue.characterId && characterMetaById.get(dialogue.characterId)?.name) ||
            dialogue.characterId ||
            ""
        ),
        text: clean(dialogue.text),
      }))
      .filter((dialogue) => dialogue.text)
      .forEach((dialogue, innerIndex) => {
        rows.push({
          quest_id: payload.questId,
          spot_id: row.id,
          stage: "pre_puzzle",
          order_index: preOrder + innerIndex,
          speaker_type: "character",
          speaker_name: dialogue.speakerName || null,
          avatar_url: dialogue.characterMeta?.avatarUrl || null,
          text: dialogue.text,
        });
      });

    (source.postMissionDialogue || [])
      .map((dialogue) => ({
        characterMeta:
          (dialogue.characterId && characterMetaById.get(dialogue.characterId)) || null,
        speakerName: clean(
          (dialogue.characterId && characterMetaById.get(dialogue.characterId)?.name) ||
            dialogue.characterId ||
            ""
        ),
        text: clean(dialogue.text),
      }))
      .filter((dialogue) => dialogue.text)
      .forEach((dialogue, innerIndex) => {
        rows.push({
          quest_id: payload.questId,
          spot_id: row.id,
          stage: "post_puzzle",
          order_index: innerIndex + 1,
          speaker_type: "character",
          speaker_name: dialogue.speakerName || null,
          avatar_url: dialogue.characterMeta?.avatarUrl || null,
          text: dialogue.text,
        });
      });

    return rows;
  });

  if (messageRows.length > 0) {
    const { error: messagesError } = await supabase
      .from("spot_story_messages")
      .insert(messageRows);
    if (messagesError && !isMissingTableError(messagesError, "spot_story_messages")) {
      console.warn(
        "saveRuntimeEpisodeSpots: spot_story_messages insert warning",
        messagesError
      );
    }
  }

  const trace = payload.runtimeEpisode.generationTrace;
  const resolvedEpisodeNo =
    Number.isFinite(payload.episodeNo) && (payload.episodeNo || 0) > 0
      ? Math.floor(payload.episodeNo as number)
      : null;

  if (trace && payload.userId && resolvedEpisodeNo) {
    const traceRow = {
      quest_id: payload.questId,
      user_id: payload.userId,
      episode_no: resolvedEpisodeNo,
      stage_location: clean(payload.stageLocation || trace.stageLocation) || null,
      candidate_spots_json: (trace.candidateSpots || []).map((requirement) => ({
        requirement_id: requirement.requirementId,
        scene_role: requirement.sceneRole,
        spot_role: requirement.spotRole,
        candidates: (requirement.candidates || []).map((candidate) => ({
          spot_name: candidate.spotName,
          tourism_focus: candidate.tourismFocus,
          estimated_walk_minutes: candidate.estimatedWalkMinutes,
          public_accessible: candidate.publicAccessible,
          role_match_score: candidate.roleMatchScore,
          tourism_match_score: candidate.tourismMatchScore,
          locality_score: candidate.localityScore,
        })),
      })),
      selected_spots_json: (trace.selectedSpots || []).map((spot) => ({
        requirement_id: spot.requirementId,
        scene_role: spot.sceneRole,
        spot_name: spot.spotName,
        tourism_focus: spot.tourismFocus,
        estimated_walk_minutes: spot.estimatedWalkMinutes,
      })),
      route_score:
        Number.isFinite(trace.routeScore) ? Number(trace.routeScore.toFixed(4)) : null,
      continuity_score:
        Number.isFinite(trace.continuityScore) ? Number(trace.continuityScore.toFixed(4)) : null,
      eligibility_reject_reasons_json: trace.eligibilityRejectReasons || [],
      mmr_scores_json: (trace.mmrScores || []).map((score) => ({
        requirement_id: score.requirementId,
        spot_name: score.spotName,
        relevance_score: score.relevanceScore,
        redundancy_penalty: score.redundancyPenalty,
        mmr_score: score.mmrScore,
      })),
      route_metrics_json: {
        optimizer: trace.routeMetrics.optimizer,
        total_estimated_walk_minutes: trace.routeMetrics.totalEstimatedWalkMinutes,
        transfer_minutes: trace.routeMetrics.transferMinutes,
        max_leg_minutes: trace.routeMetrics.maxLegMinutes,
        max_total_walk_minutes: trace.routeMetrics.maxTotalWalkMinutes,
        feasible: trace.routeMetrics.feasible,
        failure_reasons: trace.routeMetrics.failureReasons,
        optimized_order_indices: trace.routeMetrics.optimizedOrderIndices,
        optimized_order_spot_names: trace.routeMetrics.optimizedOrderSpotNames,
      },
    };

    const { error: traceError } = await supabase
      .from("episode_generation_traces")
      .insert(traceRow);
    if (traceError && !isMissingTableError(traceError, "episode_generation_traces")) {
      console.warn("saveRuntimeEpisodeSpots: episode_generation_traces insert warning", traceError);
    }
  }

  return { savedSpotCount: inserted.length };
};


type SaveSeriesBlueprintPayload = {
  questId: string;
  seriesId: string;
  userId: string;
  sourcePrompt?: string | null;
  generated: GeneratedSeriesDraft;
};

export const saveSeriesBlueprint = async (payload: SaveSeriesBlueprintPayload) => {
  const supabase = getSupabaseOrThrow();
  const now = new Date().toISOString();
  const seriesId = payload.seriesId;
  const seriesBlueprintRaw = asRecord(payload.generated.seriesBlueprint);
  const initialTemplateRaw = asRecord(payload.generated.initialUserSeriesStateTemplate);
  const progressStateRaw = asRecord(payload.generated.progressState);
  const blueprintPersistentCharacters = asRecord(seriesBlueprintRaw.persistentCharacters);
  const blueprintContinuityAxes = asRecordArray(asRecord(seriesBlueprintRaw.continuityAxes).axes);
  const seriesBlueprintId = clean(
    typeof seriesBlueprintRaw.id === "string" ? seriesBlueprintRaw.id : ""
  ) || seriesId;
  const referencedBlueprintVersion = Math.max(
    1,
    Number.parseInt(String(seriesBlueprintRaw.version ?? 1), 10) || 1
  );

  const buildDefaultRelationshipState = () => {
    const rows = [
      asRecord(blueprintPersistentCharacters.partner),
      asRecord(blueprintPersistentCharacters.anchorNpc),
    ].filter((row) => Object.keys(row).length > 0);
    return rows.map((row, index) => ({
      characterId: clean(typeof row.id === "string" ? row.id : "") || `char_${index + 1}`,
      closenessLabel: index === 0 ? "neutral" : "distant",
      trustLevel: index === 0 ? 40 : 30,
      tensionLevel: 20,
      affectionLevel: 0,
      specialFlags: [],
      sharedMemories: [],
      unresolvedEmotions: [],
    }));
  };

  const continuityAxisProgress =
    asRecordArray(asRecord(initialTemplateRaw.progressSummary).continuityAxisProgress).length > 0
      ? asRecordArray(asRecord(initialTemplateRaw.progressSummary).continuityAxisProgress).map((row, index) => ({
          axisId: clean(typeof row.axisId === "string" ? row.axisId : "") || `axis_${index + 1}`,
          currentLabel: clean(typeof row.currentLabel === "string" ? row.currentLabel : "") || "初期",
          recentShift: clean(typeof row.recentShift === "string" ? row.recentShift : "") || "初期状態",
        }))
      : blueprintContinuityAxes.map((row, index) => ({
          axisId: clean(typeof row.axisId === "string" ? row.axisId : "") || `axis_${index + 1}`,
          currentLabel:
            clean(typeof row.initialStateLabel === "string" ? row.initialStateLabel : "") || "初期",
          recentShift: "初期状態",
        }));

  const initialUserSeriesStatePayload =
    Object.keys(initialTemplateRaw).length > 0 || Object.keys(seriesBlueprintRaw).length > 0
      ? {
          id: `${payload.questId}:${payload.userId}`,
          userId: payload.userId,
          seriesBlueprintId,
          referencedBlueprintVersion,
          stateVersion: 1,
          progressSummary: {
            episodeCountCompleted: Math.max(
              0,
              Number.parseInt(
                String(
                  asRecord(initialTemplateRaw.progressSummary).episodeCountCompleted ??
                    progressStateRaw.lastCompletedEpisodeNo ??
                    0
                ),
                10
              ) || 0
            ),
            activeThreads: dedupe(
              asStringArray(asRecord(initialTemplateRaw.progressSummary).activeThreads).concat(
                asStringArray(progressStateRaw.unresolvedThreads)
              )
            ),
            resolvedThreads: dedupe(
              asStringArray(asRecord(initialTemplateRaw.progressSummary).resolvedThreads).concat(
                asStringArray(progressStateRaw.revealedFacts)
              )
            ),
            recentEpisodeIds: asStringArray(asRecord(initialTemplateRaw.progressSummary).recentEpisodeIds),
            continuityAxisProgress,
          },
          rememberedExperience: {
            visitedLocations: asStringArray(asRecord(initialTemplateRaw.rememberedExperience).visitedLocations),
            keyEvents: asStringArray(asRecord(initialTemplateRaw.rememberedExperience).keyEvents),
            importantConversations: asStringArray(
              asRecord(initialTemplateRaw.rememberedExperience).importantConversations
            ),
            playerChoices: asStringArray(asRecord(initialTemplateRaw.rememberedExperience).playerChoices),
            emotionalMoments: asStringArray(asRecord(initialTemplateRaw.rememberedExperience).emotionalMoments),
            relationshipTurningPoints: asStringArray(
              asRecord(initialTemplateRaw.rememberedExperience).relationshipTurningPoints
            ),
          },
          relationshipState:
            asRecordArray(initialTemplateRaw.relationshipState).length > 0
              ? asRecordArray(initialTemplateRaw.relationshipState)
              : buildDefaultRelationshipState(),
          achievementState: {
            titles: asStringArray(asRecord(initialTemplateRaw.achievementState).titles),
            achievements: asStringArray(asRecord(initialTemplateRaw.achievementState).achievements),
            discoveryTags: asStringArray(asRecord(initialTemplateRaw.achievementState).discoveryTags),
          },
          continuityState: {
            callbackCandidates: asStringArray(asRecord(initialTemplateRaw.continuityState).callbackCandidates),
            motifsInUse: asStringArray(asRecord(initialTemplateRaw.continuityState).motifsInUse),
            blockedLines: asStringArray(asRecord(initialTemplateRaw.continuityState).blockedLines),
            promisedPayoffs: asStringArray(asRecord(initialTemplateRaw.continuityState).promisedPayoffs),
          },
        }
      : {};

  const bibleBasePayload = {
    quest_id: payload.questId,
    creator_id: payload.userId,
    title: payload.generated.title,
    overview: payload.generated.overview || null,
    genre: payload.generated.genre || null,
    tone: payload.generated.tone || null,
    premise: payload.generated.premise || null,
    season_goal: payload.generated.seasonGoal || null,
    ai_rules: payload.generated.aiRules || null,
    world: payload.generated.world || {},
    continuity: payload.generated.continuity || {},
    source_prompt: payload.sourcePrompt || null,
    workflow_version: payload.generated.workflowVersion || null,
    updated_at: now,
  };

  const bibleExtendedPayload = {
    ...bibleBasePayload,
    progress_state: payload.generated.progressState || {},
    first_episode_seed: payload.generated.firstEpisodeSeed || {},
    cover_image_prompt: payload.generated.coverImagePrompt || null,
    cover_image_url: payload.generated.coverImageUrl || null,
    identity_pack: payload.generated.identityPack || {},
    cover_consistency_report: payload.generated.coverConsistencyReport || {},
    series_blueprint: payload.generated.seriesBlueprint || {},
    initial_user_series_state_template:
      payload.generated.initialUserSeriesStateTemplate || {},
    episode_runtime_bootstrap_payload:
      payload.generated.episodeRuntimeBootstrapPayload || {},
    user_series_state: initialUserSeriesStatePayload,
  };

  let { data: bibleRow, error: bibleError } = await supabase
    .from("series_bibles")
    .upsert(bibleExtendedPayload, { onConflict: "quest_id" })
    .select("id")
    .maybeSingle();

  if (
    bibleError &&
    isMissingAnyColumn(
      bibleError,
      [
        "cover_image_prompt",
        "cover_image_url",
        "progress_state",
        "first_episode_seed",
        "identity_pack",
        "cover_consistency_report",
        "series_blueprint",
        "initial_user_series_state_template",
        "episode_runtime_bootstrap_payload",
        "user_series_state",
      ]
    )
  ) {
    const retry = await supabase
      .from("series_bibles")
      .upsert(bibleBasePayload, { onConflict: "quest_id" })
      .select("id")
      .maybeSingle();

    bibleRow = retry.data;
    bibleError = retry.error;
  }

  if (bibleError) throw bibleError;
  if (!bibleRow?.id) throw new Error("series_bibles upsert succeeded but id was not returned.");

  const bibleId = bibleRow.id as string;

  const characters = payload.generated.characters || [];
  if (characters.length === 0) {
    throw new Error("シリーズにキャラクターが含まれていません。AI生成結果を確認してください。");
  }

  const { error: deleteCharactersError } = await supabase
    .from("series_characters")
    .delete()
    .eq("bible_id", bibleId)
    .eq("creator_id", payload.userId);

  if (deleteCharactersError) throw deleteCharactersError;

  const characterRows = characters.map((character, index) => ({
    series_id: seriesId,
    bible_id: bibleId,
    quest_id: payload.questId,
    creator_id: payload.userId,
    character_order: index + 1,
    name: character.name,
    role: character.role,
    must_appear: Boolean(character.mustAppear),
    goal: character.goal || null,
    arc_start: character.arcStart || null,
    arc_end: character.arcEnd || null,
    personality: character.personality || null,
    appearance: character.appearance || null,
    portrait_prompt: character.portraitPrompt || null,
    portrait_image_url: character.portraitImageUrl || null,
    is_key_person: Boolean(character.isKeyPerson),
    identity_anchor_tokens:
      character.identityAnchorTokens
        ? {
            hair: character.identityAnchorTokens.hair || "",
            silhouette: character.identityAnchorTokens.silhouette || "",
            dominant_color: character.identityAnchorTokens.dominantColor || "",
            outfit_key_item: character.identityAnchorTokens.outfitKeyItem || "",
            distinguishing_feature: character.identityAnchorTokens.distinguishingFeature || "",
          }
        : {},
    relationship_hooks: (character.relationshipHooks || []).map((hook) => ({
      target_id: clean(hook.targetId) || "",
      target_name: clean(hook.targetName) || "",
      relation: clean(hook.relation) || "",
    })),
    updated_at: now,
  }));

  if (characterRows.length > 0) {
    let { error: insertCharactersError } = await supabase.from("series_characters").insert(characterRows);

    if (
      insertCharactersError &&
      isMissingAnyColumn(insertCharactersError, [
        "must_appear",
        "appearance",
        "portrait_prompt",
        "portrait_image_url",
        "is_key_person",
        "identity_anchor_tokens",
      ])
    ) {
      const legacyRows = characterRows.map((row) => ({
        series_id: row.series_id,
        bible_id: row.bible_id,
        quest_id: row.quest_id,
        creator_id: row.creator_id,
        character_order: row.character_order,
        name: row.name,
        role: row.role,
        goal: row.goal,
        arc_start: row.arc_start,
        arc_end: row.arc_end,
        personality: row.personality,
        relationship_hooks: row.relationship_hooks,
        updated_at: row.updated_at,
      }));

      const retry = await supabase.from("series_characters").insert(legacyRows);
      insertCharactersError = retry.error;
    }

    if (insertCharactersError) throw insertCharactersError;
  }

  const { error: deleteEpisodesError } = await supabase
    .from("series_episode_blueprints")
    .delete()
    .eq("bible_id", bibleId)
    .eq("creator_id", payload.userId);

  if (deleteEpisodesError) throw deleteEpisodesError;

  const episodeRowsFromBlueprints = (payload.generated.episodeBlueprints || []).map((episode, index) => ({
    bible_id: bibleId,
    quest_id: payload.questId,
    creator_id: payload.userId,
    episode_no: episode.episodeNo || index + 1,
    title: episode.title,
    objective: episode.objective || null,
    synopsis: episode.synopsis || null,
    key_location: episode.keyLocation || null,
    emotional_beat: episode.emotionalBeat || null,
    required_setups: episode.requiredSetups || [],
    payoff_targets: episode.payoffTargets || [],
    cliffhanger: episode.cliffhanger || null,
    continuity_notes: episode.continuityNotes || null,
    suggested_mission: episode.suggestedMission || null,
    updated_at: now,
  }));

  const episodeRows = episodeRowsFromBlueprints;

  if (episodeRows.length > 0) {
    const { error: insertEpisodesError } = await supabase.from("series_episode_blueprints").insert(episodeRows);
    if (insertEpisodesError) throw insertEpisodesError;
  }
};
