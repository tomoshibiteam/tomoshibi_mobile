import { getSupabaseOrThrow } from "@/lib/supabase";

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

const shouldRetryWithoutMode = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: string; message?: string; details?: string };
  const code = maybeError.code || "";
  const normalized = `${maybeError.message || ""} ${maybeError.details || ""}`.toLowerCase();
  return code === "PGRST204" || code === "42703" || normalized.includes("column") || normalized.includes("mode");
};

const normalize = (value: string | null | undefined) => (value || "").trim().toLowerCase();

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

export const createQuestDraft = async (payload: CreateQuestDraftPayload) => {
  const supabase = getSupabaseOrThrow();

  const basePayload = {
    creator_id: payload.creatorId,
    title: payload.title,
    description: payload.description || null,
    area_name: payload.areaName || null,
    cover_image_url: payload.coverImageUrl || null,
    status: "draft",
  };

  let { data, error } = await supabase
    .from("quests")
    .insert({
      ...basePayload,
      mode: "PRIVATE",
    })
    .select("id")
    .maybeSingle();

  if (error && shouldRetryWithoutMode(error)) {
    const retry = await supabase
      .from("quests")
      .insert(basePayload)
      .select("id")
      .maybeSingle();

    data = retry.data;
    error = retry.error;
  }

  if (error) {
    throw error;
  }

  if (!data?.id) {
    throw new Error("Quest draft was created but ID could not be returned.");
  }

  return data.id as string;
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
