import { getSupabaseOrThrow } from "@/lib/supabase";
import { fetchSeriesDetail, fetchSeriesEpisodes } from "@/services/quests";

export type GameplayMessage = {
  id: string;
  speakerType: "narrator" | "character" | "system";
  name?: string | null;
  avatarUrl?: string | null;
  text: string;
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
  spots: GameplaySpot[];
};

const BACKGROUND_IMAGES = [
  "https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?auto=format&fit=crop&w=1080&q=80",
  "https://images.unsplash.com/photo-1470770903676-69b98201ea1c?auto=format&fit=crop&w=1080&q=80",
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1080&q=80",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1080&q=80",
] as const;

const normalizeText = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();

const parseHints = (hintText?: string | null) =>
  (hintText || "")
    .split("||")
    .map((hint) => hint.trim())
    .filter(Boolean);

const makeNarration = (id: string, text: string): GameplayMessage => ({
  id,
  speakerType: "narrator",
  text,
});

const isMissingRelationError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string; details?: string };
  const body = `${maybe.message || ""} ${maybe.details || ""}`.toLowerCase();
  return maybe.code === "42P01" || body.includes("does not exist") || body.includes("relation");
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
    speakerType: type === "character" ? "character" : type === "system" ? "system" : "narrator",
    name: normalizeText(row.speaker_name) || null,
    avatarUrl: row.avatar_url || null,
    text,
  };
};

const buildFallbackQuestFromEpisodes = async (questId: string): Promise<GameplayQuest | null> => {
  const [series, episodes] = await Promise.all([fetchSeriesDetail(questId), fetchSeriesEpisodes(questId)]);
  if (!series) return null;

  const spots: GameplaySpot[] = episodes.map((episode, index) => {
    const body = normalizeText(episode.body);
    const lineChunks = body
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    return {
      id: `episode-${episode.id}`,
      orderIndex: index + 1,
      name: normalizeText(episode.title) || `第${episode.episodeNo}話`,
      description: body || "新しいエピソードが始まります。",
      lat: null,
      lng: null,
      backgroundImage: BACKGROUND_IMAGES[index % BACKGROUND_IMAGES.length],
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
    spots,
  } satisfies GameplayQuest;
};

export const fetchGameplayQuest = async (questId: string): Promise<GameplayQuest | null> => {
  const supabase = getSupabaseOrThrow();

  const { data: questData, error: questError } = await supabase
    .from("quests")
    .select("id, title, area_name, cover_image_url")
    .eq("id", questId)
    .maybeSingle();

  if (questError) throw questError;
  if (!questData) return null;

  const questRow = questData as {
    id: string;
    title: string | null;
    area_name: string | null;
    cover_image_url: string | null;
  };

  try {
    const { data: spotsData, error: spotsError } = await supabase
      .from("spots")
      .select("id, name, order_index, lat, lng")
      .eq("quest_id", questId)
      .order("order_index", { ascending: true });

    if (spotsError) throw spotsError;

    const rawSpots = (spotsData || []) as Array<{
      id: string;
      name: string | null;
      order_index: number | null;
      lat: number | null;
      lng: number | null;
    }>;

    if (rawSpots.length === 0) {
      return buildFallbackQuestFromEpisodes(questId);
    }

    const spotIds = rawSpots.map((spot) => spot.id);

    const [{ data: detailsData, error: detailsError }, { data: messagesData, error: messagesError }] =
      await Promise.all([
        supabase
          .from("spot_details")
          .select("id, spot_id, question_text, answer_text, hint_text, explanation_text")
          .in("spot_id", spotIds),
        supabase
          .from("spot_story_messages")
          .select("id, spot_id, stage, order_index, speaker_type, speaker_name, avatar_url, text")
          .in("spot_id", spotIds)
          .order("order_index", { ascending: true }),
      ]);

    if (detailsError) throw detailsError;
    if (messagesError) throw messagesError;

    const detailsBySpotId = new Map<string, {
      question_text: string | null;
      answer_text: string | null;
      hint_text: string | null;
      explanation_text: string | null;
    }>();

    ((detailsData || []) as Array<{
      spot_id: string;
      question_text: string | null;
      answer_text: string | null;
      hint_text: string | null;
      explanation_text: string | null;
    }>).forEach((row) => {
      detailsBySpotId.set(row.spot_id, {
        question_text: row.question_text,
        answer_text: row.answer_text,
        hint_text: row.hint_text,
        explanation_text: row.explanation_text,
      });
    });

    const messagesBySpotId = new Map<string, { pre: GameplayMessage[]; post: GameplayMessage[] }>();
    ((messagesData || []) as Array<{
      id: string;
      spot_id: string | null;
      stage: string | null;
      speaker_type: string | null;
      speaker_name: string | null;
      avatar_url: string | null;
      text: string | null;
    }>).forEach((row) => {
      if (!row.spot_id) return;
      const mapped = toMessage({
        id: row.id,
        speaker_type: row.speaker_type,
        speaker_name: row.speaker_name,
        avatar_url: row.avatar_url,
        text: row.text,
      });
      if (!mapped) return;

      const existing = messagesBySpotId.get(row.spot_id) || { pre: [], post: [] };
      const stage = (row.stage || "").toLowerCase();
      if (stage.includes("post") || stage.includes("after")) {
        existing.post.push(mapped);
      } else {
        existing.pre.push(mapped);
      }
      messagesBySpotId.set(row.spot_id, existing);
    });

    const spots: GameplaySpot[] = rawSpots.map((spot, index) => {
      const detail = detailsBySpotId.get(spot.id);
      const messageBundle = messagesBySpotId.get(spot.id) || { pre: [], post: [] };

      return {
        id: spot.id,
        orderIndex: spot.order_index ?? index + 1,
        name: normalizeText(spot.name) || `スポット${index + 1}`,
        description: normalizeText(detail?.explanation_text) || "周辺を観察し、手がかりを集めましょう。",
        lat: typeof spot.lat === "number" ? spot.lat : null,
        lng: typeof spot.lng === "number" ? spot.lng : null,
        backgroundImage: BACKGROUND_IMAGES[index % BACKGROUND_IMAGES.length],
        puzzleQuestion: normalizeText(detail?.question_text) || null,
        puzzleAnswer: normalizeText(detail?.answer_text) || null,
        puzzleHints: parseHints(detail?.hint_text),
        puzzleSuccessMessage: normalizeText(detail?.explanation_text) || null,
        preMessages:
          messageBundle.pre.length > 0
            ? messageBundle.pre
            : [makeNarration(`pre-${spot.id}`, `${normalizeText(spot.name) || "スポット"}に到着しました。`)],
        postMessages:
          messageBundle.post.length > 0
            ? messageBundle.post
            : [makeNarration(`post-${spot.id}`, "謎を解き明かしました。次の地点へ進みましょう。")],
      } satisfies GameplaySpot;
    });

    return {
      id: questRow.id,
      title: normalizeText(questRow.title) || "旅のエピソード",
      areaName: questRow.area_name,
      coverImageUrl: questRow.cover_image_url,
      spots,
    } satisfies GameplayQuest;
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
    return buildFallbackQuestFromEpisodes(questId);
  }
};
