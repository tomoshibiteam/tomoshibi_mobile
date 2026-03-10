import { getSupabaseOrThrow } from "@/lib/supabase";
import { fetchSeriesDetail, fetchSeriesEpisodes } from "@/services/quests";

export type GameplayMessage = {
  id: string;
  speakerType: "narrator" | "character" | "system";
  name?: string | null;
  avatarUrl?: string | null;
  text: string;
};

export type GameplayCharacter = {
  id: string;
  name: string;
  role: string;
  avatarUrl: string | null;
};

export type GameplaySpot = {
  id: string;
  orderIndex: number;
  name: string;
  description: string;
  lat: number | null;
  lng: number | null;
  backgroundImage: string;
  puzzleQuestion: string | null;
  puzzleAnswer: string | null;
  puzzleHints: string[];
  puzzleSuccessMessage: string | null;
  preMessages: GameplayMessage[];
  postMessages: GameplayMessage[];
};

export type GameplayQuest = {
  id: string;
  title: string;
  areaName: string | null;
  coverImageUrl: string | null;
  prologue: string | null;
  epilogue: string | null;
  characters: GameplayCharacter[];
  spots: GameplaySpot[];
};

type QuestRow = {
  id: string;
  title: string | null;
  area_name: string | null;
  cover_image_url: string | null;
};

type SpotRow = {
  id: string;
  name: string | null;
  order_index: number | null;
  lat: number | null;
  lng: number | null;
  image_url?: string | null;
};

type SpotDetailRow = {
  id: string;
  spot_id: string;
  question_text: string | null;
  answer_text: string | null;
  hint_text: string | null;
  explanation_text: string | null;
};

type SpotStoryMessageRow = {
  id: string;
  spot_id: string | null;
  stage: string | null;
  order_index: number | null;
  speaker_type: string | null;
  speaker_name: string | null;
  avatar_url: string | null;
  text: string | null;
};

type StoryTimelineRow = {
  prologue: string | null;
  epilogue: string | null;
};

type QuestCharacterRow = {
  id: string | number | null;
  name: string | null;
  role: string | null;
  image_url: string | null;
};

type QuestDialogueRow = {
  id: string | number | null;
  spot_id: string | null;
  character_id: string | number | null;
  timing: string | null;
  text: string | null;
  order_index: number | null;
};

const BACKGROUND_IMAGES = [
  "https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?auto=format&fit=crop&w=1080&q=80",
  "https://images.unsplash.com/photo-1470770903676-69b98201ea1c?auto=format&fit=crop&w=1080&q=80",
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1080&q=80",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1080&q=80",
] as const;

const normalizeText = (value?: string | null) =>
  (value || "").replace(/\s+/g, " ").trim();

const parseHints = (hintText?: string | null) =>
  (hintText || "")
    .split("||")
    .map((hint) => hint.trim())
    .filter(Boolean);

const parseBodyCoords = (body?: string | null): { lat: number; lng: number } | null => {
  const text = (body || "").trim();
  if (!text) return null;
  const lineMatch = text.match(
    /(?:^|\n)\s*(?:座標|位置|coords?)\s*[:：]\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i
  );
  if (!lineMatch) return null;
  const lat = Number.parseFloat(lineMatch[1]);
  const lng = Number.parseFloat(lineMatch[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
};

const parseBodyStageName = (body?: string | null): string | null => {
  const text = (body || "").trim();
  if (!text) return null;
  const stageMatch = text.match(/(?:^|\n)\s*舞台\s*[:：]\s*(.+)(?:\n|$)/);
  return normalizeText(stageMatch?.[1] || null) || null;
};

const makeNarration = (id: string, text: string): GameplayMessage => ({
  id,
  speakerType: "narrator",
  text,
});

const isMissingRelationError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string; details?: string };
  const body = `${maybe.message || ""} ${maybe.details || ""}`.toLowerCase();
  return (
    maybe.code === "42P01" ||
    body.includes("does not exist") ||
    body.includes("relation")
  );
};

const isMissingColumnError = (error: unknown, column: string) => {
  if (!error || typeof error !== "object") return false;
  const maybe = error as {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  };
  const body = `${maybe.message || ""} ${maybe.details || ""} ${maybe.hint || ""}`.toLowerCase();
  return maybe.code === "42703" && body.includes(column.toLowerCase());
};

const toMessage = (row: {
  id: string;
  speaker_type: string | null;
  speaker_name: string | null;
  avatar_url: string | null;
  text: string | null;
}): GameplayMessage | null => {
  const text = normalizeText(row.text);
  if (!text) return null;
  const type = (row.speaker_type || "").toLowerCase();
  return {
    id: row.id,
    speakerType:
      type === "character"
        ? "character"
        : type === "system"
          ? "system"
          : "narrator",
    name: normalizeText(row.speaker_name) || null,
    avatarUrl: row.avatar_url || null,
    text,
  };
};

const fetchStoryTimeline = async (
  questId: string
): Promise<{ prologue: string | null; epilogue: string | null }> => {
  const supabase = getSupabaseOrThrow();

  const { data, error } = await supabase
    .from("story_timelines")
    .select("prologue, epilogue")
    .eq("quest_id", questId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      return { prologue: null, epilogue: null };
    }
    console.warn("fetchStoryTimeline: failed, fallback to null", error);
    return { prologue: null, epilogue: null };
  }

  const row = (data || null) as StoryTimelineRow | null;
  return {
    prologue: row?.prologue || null,
    epilogue: row?.epilogue || null,
  };
};

const buildFallbackQuestFromEpisodes = async (
  questId: string,
  story?: { prologue: string | null; epilogue: string | null }
): Promise<GameplayQuest | null> => {
  const [series, episodes, timeline] = await Promise.all([
    fetchSeriesDetail(questId),
    fetchSeriesEpisodes(questId),
    story ? Promise.resolve(story) : fetchStoryTimeline(questId),
  ]);

  if (!series) return null;

  const spots: GameplaySpot[] = episodes.map((episode, index) => {
    const body = normalizeText(episode.body);
    const parsedCoords = parseBodyCoords(episode.body);
    const parsedStageName = parseBodyStageName(episode.body);
    const lineChunks = body
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    return {
      id: `episode-${episode.id}`,
      orderIndex: index + 1,
      name: parsedStageName || normalizeText(episode.title) || `第${episode.episodeNo}話`,
      description: body || "新しいエピソードが始まります。",
      lat: parsedCoords?.lat ?? null,
      lng: parsedCoords?.lng ?? null,
      backgroundImage:
        normalizeText(series.coverImageUrl) ||
        BACKGROUND_IMAGES[index % BACKGROUND_IMAGES.length],
      puzzleQuestion: null,
      puzzleAnswer: null,
      puzzleHints: [],
      puzzleSuccessMessage: null,
      preMessages: [
        makeNarration(
          `ep-pre-${episode.id}`,
          lineChunks[0] || `${normalizeText(episode.title) || "エピソード"}を開始します。`
        ),
      ],
      postMessages: [
        makeNarration(
          `ep-post-${episode.id}`,
          lineChunks[1] || "このエピソードは完了です。次の目的地へ進みましょう。"
        ),
      ],
    } satisfies GameplaySpot;
  });

  return {
    id: series.id,
    title: series.title,
    areaName: series.areaName,
    coverImageUrl: series.coverImageUrl,
    prologue: timeline.prologue,
    epilogue: timeline.epilogue,
    characters: [],
    spots,
  } satisfies GameplayQuest;
};

const normalizeStage = (raw: string | null) => {
  const stage = (raw || "").toLowerCase();
  if (stage.includes("post") || stage.includes("after")) return "post" as const;
  return "pre" as const;
};

export const fetchGameplayQuest = async (
  questId: string
): Promise<GameplayQuest | null> => {
  const supabase = getSupabaseOrThrow();

  const [{ data: questData, error: questError }, timeline] = await Promise.all([
    supabase
      .from("quests")
      .select("id, title, area_name, cover_image_url")
      .eq("id", questId)
      .maybeSingle(),
    fetchStoryTimeline(questId),
  ]);

  if (questError) throw questError;
  if (!questData) return null;

  const questRow = questData as QuestRow;

  try {
    const fetchSpots = async () => {
      const withImage = await supabase
        .from("spots")
        .select("id, name, order_index, lat, lng, image_url")
        .eq("quest_id", questId)
        .order("order_index", { ascending: true });

      if (!withImage.error) {
        return (withImage.data || []) as SpotRow[];
      }

      if (!isMissingColumnError(withImage.error, "image_url")) {
        throw withImage.error;
      }

      const fallback = await supabase
        .from("spots")
        .select("id, name, order_index, lat, lng")
        .eq("quest_id", questId)
        .order("order_index", { ascending: true });

      if (fallback.error) throw fallback.error;
      return (fallback.data || []) as SpotRow[];
    };

    const rawSpots = await fetchSpots();
    if (rawSpots.length === 0) {
      return buildFallbackQuestFromEpisodes(questId, timeline);
    }

    const spotIds = rawSpots.map((spot) => spot.id);

    const [
      { data: detailsData, error: detailsError },
      { data: messagesData, error: messagesError },
      { data: charactersData, error: charactersError },
      { data: questDialoguesData, error: questDialoguesError },
    ] = await Promise.all([
      supabase
        .from("spot_details")
        .select("id, spot_id, question_text, answer_text, hint_text, explanation_text")
        .in("spot_id", spotIds),
      supabase
        .from("spot_story_messages")
        .select("id, spot_id, stage, order_index, speaker_type, speaker_name, avatar_url, text")
        .in("spot_id", spotIds)
        .order("order_index", { ascending: true }),
      supabase
        .from("quest_characters")
        .select("id, name, role, image_url")
        .eq("quest_id", questId),
      supabase
        .from("quest_dialogues")
        .select("id, spot_id, character_id, timing, text, order_index")
        .in("spot_id", spotIds)
        .order("order_index", { ascending: true }),
    ]);

    if (detailsError) throw detailsError;
    if (messagesError) throw messagesError;

    if (charactersError && !isMissingRelationError(charactersError)) {
      console.warn("fetchGameplayQuest: quest_characters read warning", charactersError);
    }

    if (questDialoguesError && !isMissingRelationError(questDialoguesError)) {
      console.warn("fetchGameplayQuest: quest_dialogues read warning", questDialoguesError);
    }

    const rawCharacters = (charactersData || []) as QuestCharacterRow[];
    const characters: GameplayCharacter[] = rawCharacters.map((row, index) => ({
      id: String(row.id || `quest-char-${index + 1}`),
      name: normalizeText(row.name) || `キャラクター${index + 1}`,
      role: normalizeText(row.role) || "旅の同行者",
      avatarUrl: normalizeText(row.image_url) || null,
    }));

    const characterById = new Map<string, GameplayCharacter>();
    characters.forEach((character) => {
      characterById.set(character.id, character);
    });

    const detailsBySpotId = new Map<string, SpotDetailRow>();
    ((detailsData || []) as SpotDetailRow[]).forEach((row) => {
      detailsBySpotId.set(row.spot_id, row);
    });

    const storyMessagesBySpot = new Map<
      string,
      { pre: GameplayMessage[]; post: GameplayMessage[] }
    >();

    ((messagesData || []) as SpotStoryMessageRow[]).forEach((row, index) => {
      if (!row.spot_id) return;

      const mapped = toMessage({
        id: row.id || `${row.spot_id}-msg-${index}`,
        speaker_type: row.speaker_type,
        speaker_name: row.speaker_name,
        avatar_url: row.avatar_url,
        text: row.text,
      });
      if (!mapped) return;

      const existing = storyMessagesBySpot.get(row.spot_id) || {
        pre: [],
        post: [],
      };
      const stage = normalizeStage(row.stage);
      existing[stage].push(mapped);
      storyMessagesBySpot.set(row.spot_id, existing);
    });

    const questDialoguesBySpot = new Map<
      string,
      { pre: GameplayMessage[]; post: GameplayMessage[] }
    >();

    ((questDialoguesData || []) as QuestDialogueRow[]).forEach((row, index) => {
      if (!row.spot_id) return;
      const text = normalizeText(row.text);
      if (!text) return;

      const characterId = row.character_id ? String(row.character_id) : null;
      const character = characterId ? characterById.get(characterId) : undefined;
      const stage = normalizeStage(row.timing);

      const existing = questDialoguesBySpot.get(row.spot_id) || {
        pre: [],
        post: [],
      };

      existing[stage].push({
        id: String(row.id || `${row.spot_id}-qd-${index}`),
        speakerType: character ? "character" : "narrator",
        name: character?.name || null,
        avatarUrl: character?.avatarUrl || null,
        text,
      });

      questDialoguesBySpot.set(row.spot_id, existing);
    });

    const spots: GameplaySpot[] = rawSpots.map((spot, index) => {
      const detail = detailsBySpotId.get(spot.id);
      const storyBundle = storyMessagesBySpot.get(spot.id) || { pre: [], post: [] };
      const questBundle = questDialoguesBySpot.get(spot.id) || { pre: [], post: [] };

      const mergedPre =
        storyBundle.pre.length > 0
          ? storyBundle.pre
          : questBundle.pre.length > 0
            ? questBundle.pre
            : [
                makeNarration(
                  `pre-${spot.id}`,
                  `${normalizeText(spot.name) || "スポット"}に到着しました。`
                ),
              ];

      const mergedPost =
        storyBundle.post.length > 0
          ? storyBundle.post
          : questBundle.post.length > 0
            ? questBundle.post
            : [
                makeNarration(
                  `post-${spot.id}`,
                  "謎を解き明かしました。次の地点へ進みましょう。"
                ),
              ];

      return {
        id: spot.id,
        orderIndex: spot.order_index ?? index + 1,
        name: normalizeText(spot.name) || `スポット${index + 1}`,
        description:
          normalizeText(detail?.question_text) ||
          normalizeText(detail?.explanation_text) ||
          "周辺を観察し、手がかりを集めましょう。",
        lat: typeof spot.lat === "number" ? spot.lat : null,
        lng: typeof spot.lng === "number" ? spot.lng : null,
        backgroundImage:
          normalizeText(spot.image_url) ||
          normalizeText(questRow.cover_image_url) ||
          BACKGROUND_IMAGES[index % BACKGROUND_IMAGES.length],
        puzzleQuestion: normalizeText(detail?.question_text) || null,
        puzzleAnswer: normalizeText(detail?.answer_text) || null,
        puzzleHints: parseHints(detail?.hint_text),
        puzzleSuccessMessage: normalizeText(detail?.explanation_text) || null,
        preMessages: mergedPre,
        postMessages: mergedPost,
      } satisfies GameplaySpot;
    });

    return {
      id: questRow.id,
      title: normalizeText(questRow.title) || "旅のエピソード",
      areaName: questRow.area_name,
      coverImageUrl: questRow.cover_image_url,
      prologue: timeline.prologue,
      epilogue: timeline.epilogue,
      characters,
      spots,
    } satisfies GameplayQuest;
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
    return buildFallbackQuestFromEpisodes(questId, timeline);
  }
};
