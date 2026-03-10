import { getSupabaseOrThrow } from "@/lib/supabase";
import type { GeneratedSeriesDraft } from "@/services/seriesAi";

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
  creatorId: string | null;
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
  checkpoints: Array<{
    checkpointNo: number;
    title: string;
    purpose: string | null;
    unlockHint: string | null;
    carryOver: string | null;
  }>;
  characters: Array<{
    name: string;
    role: string;
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
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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
    creatorId: row.creator_id,
    createdAt: row.created_at,
  } satisfies SeriesDetail;
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
    .select(
      "overview, premise, season_goal, ai_rules, world, continuity, identity_pack, cover_consistency_report, progress_state, first_episode_seed"
    )
    .eq("quest_id", questId)
    .eq("creator_id", userId)
    .limit(1);

  let bibleRows = (bibleResponse.data || null) as Array<Record<string, unknown>> | null;
  let bibleError = bibleResponse.error;

  if (
    bibleError &&
    isMissingAnyColumn(bibleError, [
      "progress_state",
      "first_episode_seed",
      "identity_pack",
      "cover_consistency_report",
    ])
  ) {
    const retry = await supabase
      .from("series_bibles")
      .select("overview, premise, season_goal, ai_rules, world, continuity")
      .eq("quest_id", questId)
      .eq("creator_id", userId)
      .limit(1);
    bibleRows = (retry.data || null) as Array<Record<string, unknown>> | null;
    bibleError = retry.error;
  }

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
      name: string | null;
      role: string | null;
      personality: string | null;
      arc_start: string | null;
      arc_end: string | null;
    }>
    | null = null;

  try {
    const query = await supabase
      .from("series_characters")
      .select("name, role, personality, arc_start, arc_end")
      .eq("quest_id", questId)
      .eq("creator_id", userId)
      .order("character_order", { ascending: true })
      .limit(8);
    if (query.error) throw query.error;
    characterRows = (query.data || null) as Array<{
      name: string | null;
      role: string | null;
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
      name: string | null;
      role: string | null;
      personality: string | null;
      arc_start: string | null;
      arc_end: string | null;
    }>)
      .filter((row) => Boolean(row.name && row.role))
      .map((row) => ({
        name: row.name || "登場人物",
        role: row.role || "役割未設定",
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

  const trustDelta = Number.parseFloat(String(payload.progressPatch.companionTrustDelta ?? 0));
  const nextTrust = Number.isFinite(currentTrust) ? currentTrust : 40;
  const companionTrustLevel = Math.max(0, Math.min(100, Math.round(nextTrust + (Number.isFinite(trustDelta) ? trustDelta : 0))));
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

export const fetchSeriesEpisodes = async (questId: string) => {
  const supabase = getSupabaseOrThrow();

  try {
    const { data, error } = await supabase
      .from("quest_episodes")
      .select("id, title, body, episode_no, status, created_at, user_id")
      .eq("quest_id", questId)
      .order("episode_no", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw error;

    return ((data || []) as Array<{
      id: string;
      title: string | null;
      body: string | null;
      episode_no: number | null;
      status: string | null;
      created_at: string | null;
      user_id: string;
    }>).map((row, index) => ({
      id: row.id,
      title: (row.title || "").trim() || `エピソード ${row.episode_no || index + 1}`,
      body: row.body || "",
      episodeNo: row.episode_no || index + 1,
      status: row.status || "published",
      source: "quest_episodes",
      userId: row.user_id,
      createdAt: row.created_at,
    })) satisfies SeriesEpisode[];
  } catch (error) {
    if (!isQuestEpisodesUnavailable(error)) throw error;
  }

  const { data: posts, error: postError } = await supabase
    .from("quest_posts")
    .select("id, message, created_at, user_id")
    .eq("quest_id", questId)
    .order("created_at", { ascending: true });

  if (postError) throw postError;

  return ((posts || []) as Array<{
    id: string;
    message: string | null;
    created_at: string | null;
    user_id: string;
  }>).map((row, index) => {
    const lines = (row.message || "").split(/\r?\n/);
    const titleFromMessage = (lines[0] || "").trim();
    const bodyFromMessage = lines.slice(1).join("\n").trim();

    return {
      id: row.id,
      title: titleFromMessage || `エピソード ${index + 1}`,
      body: bodyFromMessage,
      episodeNo: index + 1,
      status: "published",
      source: "quest_posts",
      userId: row.user_id,
      createdAt: row.created_at,
    } satisfies SeriesEpisode;
  });
};

type EpisodeMutationPayload = {
  episodeId: string;
  source: "quest_episodes" | "quest_posts";
  userId: string;
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
    const { error } = await supabase
      .from("quest_episodes")
      .delete()
      .eq("id", payload.episodeId)
      .eq("user_id", payload.userId);

    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("quest_posts")
    .delete()
    .eq("id", payload.episodeId)
    .eq("user_id", payload.userId);

  if (error) throw error;
};

export const createEpisodeForSeries = async (payload: CreateEpisodePayload) => {
  const supabase = getSupabaseOrThrow();

  const trimmedSeriesTitle = payload.seriesTitle.trim();
  const trimmedEpisodeTitle = payload.episodeTitle.trim();
  const trimmedEpisodeText = payload.episodeText.trim();

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

    const { error: insertError } = await supabase
      .from("quest_episodes")
      .insert({
        quest_id: targetQuest.id,
        user_id: payload.userId,
        title: trimmedEpisodeTitle,
        body: trimmedEpisodeText || "",
        episode_no: nextEpisodeNo,
        status: "published",
      });

    if (insertError) throw insertError;

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

    const { error: insertError } = await supabase.from("quest_posts").insert({
      user_id: payload.userId,
      quest_id: targetQuest.id,
      message,
      image_urls: [],
    });

    if (insertError) throw insertError;

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
    secrets: character.secrets || [],
    relationship_hooks: character.relationshipHooks || [],
    updated_at: now,
  }));

  if (characterRows.length > 0) {
    let { error: insertCharactersError } = await supabase.from("series_characters").insert(characterRows);

    if (
      insertCharactersError &&
      isMissingAnyColumn(insertCharactersError, [
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
        secrets: row.secrets,
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

  const episodeRowsFromCheckpoints = (payload.generated.checkpoints || []).map((checkpoint, index) => ({
    bible_id: bibleId,
    quest_id: payload.questId,
    creator_id: payload.userId,
    episode_no: checkpoint.checkpointNo || index + 1,
    title: checkpoint.title,
    objective: checkpoint.purpose || null,
    synopsis: checkpoint.unlockHint || null,
    key_location: payload.generated.world?.setting || null,
    emotional_beat: checkpoint.expectedEmotion || null,
    required_setups: [checkpoint.unlockHint].filter(Boolean),
    payoff_targets: [checkpoint.carryOver].filter(Boolean),
    cliffhanger: checkpoint.carryOver || null,
    continuity_notes: "checkpoint_based_series_design",
    suggested_mission: checkpoint.purpose || null,
    updated_at: now,
  }));

  const episodeRows = episodeRowsFromBlueprints.length > 0 ? episodeRowsFromBlueprints : episodeRowsFromCheckpoints;

  if (episodeRows.length > 0) {
    const { error: insertEpisodesError } = await supabase.from("series_episode_blueprints").insert(episodeRows);
    if (insertEpisodesError) throw insertEpisodesError;
  }
};
