import { getSupabaseOrThrow } from "@/lib/supabase";
import { fetchSeriesDetail, fetchSeriesEpisodes } from "@/services/quests";
import Constants from "expo-constants";
import { NativeModules, Platform } from "react-native";

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
const normalizeSpeakerKey = (value?: string | null) =>
  normalizeText(value).toLowerCase();
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const extractHostFromEndpoint = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  const withoutScheme = normalized.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const hostPort = withoutScheme.split("/")[0] || "";
  const hostOnly = hostPort.split(":")[0] || "";
  return normalizeText(hostOnly);
};
const resolveScriptHostFromNative = () => {
  const nativeModules = (NativeModules as unknown as Record<string, unknown>) || {};
  const sourceCode = (nativeModules.SourceCode as Record<string, unknown> | undefined) || undefined;
  const scriptUrl = normalizeText(typeof sourceCode?.scriptURL === "string" ? sourceCode.scriptURL : "");
  if (!scriptUrl) return "";
  return extractHostFromEndpoint(scriptUrl);
};
const resolveExpoDevHost = () => {
  const c = Constants as unknown as Record<string, unknown>;
  const expoConfig = (c.expoConfig as Record<string, unknown> | undefined) || undefined;
  const manifest = (c.manifest as Record<string, unknown> | undefined) || undefined;
  const manifest2 = (c.manifest2 as Record<string, unknown> | undefined) || undefined;
  const expoGoConfig = (c.expoGoConfig as Record<string, unknown> | undefined) || undefined;
  const expoClient =
    ((manifest2?.extra as Record<string, unknown> | undefined)?.expoClient as
      | Record<string, unknown>
      | undefined) || undefined;

  const candidates = [
    normalizeText(typeof expoConfig?.hostUri === "string" ? expoConfig.hostUri : ""),
    normalizeText(typeof manifest?.debuggerHost === "string" ? manifest.debuggerHost : ""),
    normalizeText(typeof expoGoConfig?.debuggerHost === "string" ? expoGoConfig.debuggerHost : ""),
    normalizeText(typeof c.linkingUri === "string" ? c.linkingUri : ""),
    normalizeText(typeof c.experienceUrl === "string" ? c.experienceUrl : ""),
    normalizeText(typeof expoClient?.hostUri === "string" ? expoClient.hostUri : ""),
    normalizeText(resolveScriptHostFromNative()),
    normalizeText(
      typeof ((manifest2?.extra as Record<string, unknown> | undefined)?.expoGo as
        | Record<string, unknown>
        | undefined)?.debuggerHost === "string"
        ? (((manifest2?.extra as Record<string, unknown> | undefined)?.expoGo as Record<
            string,
            unknown
          >).debuggerHost as string)
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
const resolveGameplayMediaBaseUrl = () =>
  normalizeText(
    process.env.EXPO_PUBLIC_MASTRA_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || ""
  ).replace(/\/+$/, "");
const tuneGameplayAvatarUrl = (url: URL) => {
  const pathname = normalizeText(url.pathname);
  if (!pathname.endsWith("/api/series/image")) return;
  const purpose = normalizeText(url.searchParams.get("purpose")).toLowerCase();
  if (purpose !== "character_portrait") return;
  // Gameplay側はカード表示に寄せたので、重いcutout処理は無効化して表示を優先する。
  url.searchParams.set("cutout", "0");
};
const toGameplayAvatarUrl = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      tuneGameplayAvatarUrl(parsed);
      const host = normalizeText(parsed.hostname).toLowerCase();
      if (LOCALHOST_HOSTS.has(host)) {
        const base = resolveGameplayMediaBaseUrl();
        if (base) {
          try {
            const baseParsed = new URL(base);
            const baseHost = normalizeText(baseParsed.hostname).toLowerCase();
            if (!LOCALHOST_HOSTS.has(baseHost)) {
              parsed.protocol = baseParsed.protocol;
              parsed.hostname = baseParsed.hostname;
              parsed.port = baseParsed.port;
              return parsed.toString();
            }
          } catch {
            // Ignore and try Expo host fallback.
          }
        }

        const expoHost = resolveExpoDevHost();
        if (expoHost) {
          parsed.hostname = expoHost;
          return parsed.toString();
        }

        if (Platform.OS === "android") {
          parsed.hostname = "10.0.2.2";
          return parsed.toString();
        }
      }
      return parsed.toString();
    } catch {
      return normalized;
    }
  }
  if (normalized.startsWith("/")) {
    const base = resolveGameplayMediaBaseUrl();
    if (!base) return normalized;
    try {
      const parsed = new URL(`${base}${normalized}`);
      tuneGameplayAvatarUrl(parsed);
      return parsed.toString();
    } catch {
      return `${base}${normalized}`;
    }
  }
  return normalized;
};

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

const makeCharacterMessage = (
  id: string,
  text: string,
  character: GameplayCharacter
): GameplayMessage => ({
  id,
  speakerType: "character",
  name: character.name,
  avatarUrl: character.avatarUrl,
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
}, options?: {
  avatarBySpeakerName?: Map<string, string>;
  knownCharacterNames?: Set<string>;
}): GameplayMessage | null => {
  const text = normalizeText(row.text);
  if (!text) return null;

  const speakerName = normalizeText(row.speaker_name) || null;
  const speakerKey = normalizeSpeakerKey(speakerName);
  const avatarFromName = speakerKey
    ? options?.avatarBySpeakerName?.get(speakerKey) || null
    : null;
  const type = (row.speaker_type || "").toLowerCase();
  const isCharacterSpeaker =
    type === "character" ||
    (speakerKey ? options?.knownCharacterNames?.has(speakerKey) : false);

  return {
    id: row.id,
    speakerType:
      isCharacterSpeaker
        ? "character"
        : type === "system"
          ? "system"
          : "narrator",
    name: speakerName,
    avatarUrl: toGameplayAvatarUrl(normalizeText(row.avatar_url) || avatarFromName || null),
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

  const characters: GameplayCharacter[] = (series.characters || []).map(
    (character, index) => ({
      id: character.id || `series-char-${index + 1}`,
      name: normalizeText(character.name) || `キャラクター${index + 1}`,
      role: normalizeText(character.role) || "旅の同行者",
      avatarUrl: toGameplayAvatarUrl(character.avatarImageUrl),
    })
  );
  const leadCharacter = characters[0] || null;
  const supportCharacter = characters[1] || leadCharacter;

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
        normalizeText(episode.coverImageUrl) ||
        normalizeText(series.coverImageUrl) ||
        BACKGROUND_IMAGES[index % BACKGROUND_IMAGES.length],
      puzzleQuestion: null,
      puzzleAnswer: null,
      puzzleHints: [],
      puzzleSuccessMessage: null,
      preMessages: leadCharacter
        ? [
            makeCharacterMessage(
              `ep-pre-${episode.id}`,
              lineChunks[0] || `${normalizeText(episode.title) || "エピソード"}を開始します。`,
              leadCharacter
            ),
          ]
        : [
            makeNarration(
              `ep-pre-${episode.id}`,
              lineChunks[0] || `${normalizeText(episode.title) || "エピソード"}を開始します。`
            ),
          ],
      postMessages: supportCharacter
        ? [
            makeCharacterMessage(
              `ep-post-${episode.id}`,
              lineChunks[1] || "このエピソードは完了です。次の目的地へ進みましょう。",
              supportCharacter
            ),
          ]
        : [
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
    characters,
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

    const [seriesDetail, episodes] = await Promise.all([
      fetchSeriesDetail(questId).catch((error) => {
        console.warn("fetchGameplayQuest: series detail read warning", error);
        return null;
      }),
      fetchSeriesEpisodes(questId).catch((error) => {
        console.warn("fetchGameplayQuest: episode covers read warning", error);
        return [];
      }),
    ]);

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
    const normalizedCharacters: GameplayCharacter[] = rawCharacters.map((row, index) => ({
      id: String(row.id || `quest-char-${index + 1}`),
      name: normalizeText(row.name) || `キャラクター${index + 1}`,
      role: normalizeText(row.role) || "旅の同行者",
      avatarUrl: toGameplayAvatarUrl(row.image_url),
    }));
    const seriesCharacters: GameplayCharacter[] = (seriesDetail?.characters || []).map(
      (row, index) => ({
        id: row.id || `series-char-${index + 1}`,
        name: normalizeText(row.name) || `キャラクター${index + 1}`,
        role: normalizeText(row.role) || "旅の同行者",
        avatarUrl: toGameplayAvatarUrl(row.avatarImageUrl),
      })
    );

    const mergedCharactersByKey = new Map<string, GameplayCharacter>();
    [...seriesCharacters, ...normalizedCharacters].forEach((character) => {
      const key = normalizeSpeakerKey(character.name) || character.id;
      if (!key) return;

      const existing = mergedCharactersByKey.get(key);
      if (!existing) {
        mergedCharactersByKey.set(key, character);
        return;
      }

      const existingRole = normalizeText(existing.role);
      const incomingRole = normalizeText(character.role);
      const shouldPromoteRole = !existingRole || existingRole === "旅の同行者";

      mergedCharactersByKey.set(key, {
        ...existing,
        id: existing.id || character.id,
        name: existing.name || character.name,
        role:
          shouldPromoteRole && incomingRole
            ? incomingRole
            : existing.role || incomingRole || "旅の同行者",
        avatarUrl: existing.avatarUrl || character.avatarUrl || null,
      });
    });
    const characters = Array.from(mergedCharactersByKey.values());

    const characterById = new Map<string, GameplayCharacter>();
    characters.forEach((character) => {
      characterById.set(character.id, character);
    });
    const avatarBySpeakerName = new Map<string, string>();
    const knownCharacterNames = new Set<string>();
    characters.forEach((character) => {
      const nameKey = normalizeSpeakerKey(character.name);
      const idKey = normalizeSpeakerKey(character.id);

      if (nameKey) {
        knownCharacterNames.add(nameKey);
      }
      if (idKey) {
        knownCharacterNames.add(idKey);
      }

      if (character.avatarUrl) {
        if (nameKey) {
          avatarBySpeakerName.set(nameKey, character.avatarUrl);
        }
        if (idKey) {
          avatarBySpeakerName.set(idKey, character.avatarUrl);
        }
      }
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
      }, {
        avatarBySpeakerName,
        knownCharacterNames,
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

    const episodeCoverByOrder = new Map<number, string>();
    episodes.forEach((episode, index) => {
      const cover = normalizeText(episode.coverImageUrl);
      if (!cover) return;
      if (Number.isFinite(episode.episodeNo)) {
        episodeCoverByOrder.set(episode.episodeNo, cover);
      }
      episodeCoverByOrder.set(index + 1, cover);
    });

    const spots: GameplaySpot[] = rawSpots.map((spot, index) => {
      const detail = detailsBySpotId.get(spot.id);
      const storyBundle = storyMessagesBySpot.get(spot.id) || { pre: [], post: [] };
      const questBundle = questDialoguesBySpot.get(spot.id) || { pre: [], post: [] };
      const spotOrder = spot.order_index ?? index + 1;
      const episodeCover = episodeCoverByOrder.get(spotOrder) || null;

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
          episodeCover ||
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
