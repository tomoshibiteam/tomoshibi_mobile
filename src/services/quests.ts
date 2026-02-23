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
  userId: string;
  sourcePrompt?: string | null;
  generated: GeneratedSeriesDraft;
};

export const saveSeriesBlueprint = async (payload: SaveSeriesBlueprintPayload) => {
  const supabase = getSupabaseOrThrow();
  const now = new Date().toISOString();

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

  let { data: bibleRow, error: bibleError } = await supabase
    .from("series_bibles")
    .upsert(
      {
        ...bibleBasePayload,
        cover_image_prompt: payload.generated.coverImagePrompt || null,
        cover_image_url: payload.generated.coverImageUrl || null,
      },
      { onConflict: "quest_id" }
    )
    .select("id")
    .maybeSingle();

  if (bibleError && isMissingAnyColumn(bibleError, ["cover_image_prompt", "cover_image_url"])) {
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

  const { error: deleteCharactersError } = await supabase
    .from("series_characters")
    .delete()
    .eq("bible_id", bibleId)
    .eq("creator_id", payload.userId);

  if (deleteCharactersError) throw deleteCharactersError;

  const characterRows = (payload.generated.characters || []).map((character, index) => ({
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
    secrets: character.secrets || [],
    relationship_hooks: character.relationshipHooks || [],
    updated_at: now,
  }));

  if (characterRows.length > 0) {
    let { error: insertCharactersError } = await supabase.from("series_characters").insert(characterRows);

    if (
      insertCharactersError &&
      isMissingAnyColumn(insertCharactersError, ["appearance", "portrait_prompt", "portrait_image_url"])
    ) {
      const legacyRows = characterRows.map((row) => ({
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

  const episodeRows = (payload.generated.episodeBlueprints || []).map((episode, index) => ({
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

  if (episodeRows.length > 0) {
    const { error: insertEpisodesError } = await supabase.from("series_episode_blueprints").insert(episodeRows);
    if (insertEpisodesError) throw insertEpisodesError;
  }
};
