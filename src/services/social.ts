import { getSupabaseOrThrow } from "@/lib/supabase";
import { normalizeProfileHandle } from "@/lib/profileHandle";
import type {
  AchievementRow,
  FriendshipRow,
  ProfileRow,
  QuestSocialStats,
  UserSeriesRow,
} from "@/types/social";

const SEARCH_PAGE_SIZE = 100;
const SEARCH_MAX_PAGES = 100;
const PROFILE_SELECT = "id, name, handle, bio, profile_picture_url";

const normalizeSearchKeyword = (keyword: string) =>
  keyword
    .trim()
    .replace(/,/g, " ")
    .replace(/[%_]/g, (char) => `\\${char}`);

export const fetchUserProfile = async (userId: string) => {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as ProfileRow | null) ?? null;
};

export const updateUserProfile = async (
  userId: string,
  payload: {
    name: string;
    handle?: string | null;
    bio: string | null;
    profile_picture_url: string | null;
  },
) => {
  const supabase = getSupabaseOrThrow();
  const normalizedHandle =
    typeof payload.handle === "string" ? normalizeProfileHandle(payload.handle) || null : payload.handle ?? undefined;
  const { error } = await supabase
    .from("profiles")
    .update({
      name: payload.name,
      ...(normalizedHandle !== undefined ? { handle: normalizedHandle } : {}),
      bio: payload.bio,
      profile_picture_url: payload.profile_picture_url,
    })
    .eq("id", userId);

  if (error) throw error;
};

export const isProfileHandleTaken = async (handle: string, excludeUserId?: string | null) => {
  const normalizedHandle = normalizeProfileHandle(handle);
  if (!normalizedHandle) return false;

  const supabase = getSupabaseOrThrow();
  let query = supabase.from("profiles").select("id").eq("handle", normalizedHandle).limit(1);
  if (excludeUserId) {
    query = query.neq("id", excludeUserId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
};

export const syncProfileBasicsFromAuth = async (params: {
  userId: string;
  name?: string | null;
  handle?: string | null;
}) => {
  const normalizedName = params.name?.trim() || null;
  const normalizedHandle = normalizeProfileHandle(params.handle);
  const current = await fetchUserProfile(params.userId);

  const nextName = current?.name || normalizedName;
  const nextHandle = current?.handle || normalizedHandle || null;
  if (current?.name === nextName && current?.handle === nextHandle) {
    return current;
  }

  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: params.userId,
        ...(nextName ? { name: nextName } : {}),
        ...(nextHandle ? { handle: nextHandle } : {}),
      },
      { onConflict: "id" },
    )
    .select(PROFILE_SELECT)
    .maybeSingle();

  if (error) throw error;
  return (data as ProfileRow | null) ?? null;
};

export const fetchUsersByKeyword = async (keyword: string, excludeUserId?: string | null) => {
  const supabase = getSupabaseOrThrow();
  const normalizedKeyword = normalizeSearchKeyword(keyword);

  const fetchPage = async (from: number, to: number) => {
    let query = supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (normalizedKeyword.length > 0) {
      const pattern = `%${normalizedKeyword}%`;
      query = query.or(`name.ilike.${pattern},handle.ilike.${pattern},bio.ilike.${pattern}`);
    }

    if (excludeUserId) {
      query = query.neq("id", excludeUserId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return dedupeProfiles((data || []) as ProfileRow[]);
  };

  if (normalizedKeyword.length === 0) {
    return fetchPage(0, 39);
  }

  const merged: ProfileRow[] = [];
  for (let page = 0; page < SEARCH_MAX_PAGES; page += 1) {
    const from = page * SEARCH_PAGE_SIZE;
    const to = from + SEARCH_PAGE_SIZE - 1;
    const rows = await fetchPage(from, to);
    merged.push(...rows);
    if (rows.length < SEARCH_PAGE_SIZE) break;
  }

  return dedupeProfiles(merged);
};

export const fetchFollowCounts = async (userId: string) => {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("friendships")
    .select("requester_id, receiver_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);

  if (error) throw error;

  const rows = (data || []) as Array<{ requester_id: string; receiver_id: string }>;
  return {
    followers: rows.filter((row) => row.receiver_id === userId).length,
    following: rows.filter((row) => row.requester_id === userId).length,
  };
};

export const fetchViewerRelations = async (viewerUserId: string) => {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("friendships")
    .select("id, requester_id, receiver_id, status, created_at")
    .eq("status", "accepted")
    .or(`requester_id.eq.${viewerUserId},receiver_id.eq.${viewerUserId}`);

  if (error) throw error;

  const map: Record<string, FriendshipRow> = {};
  ((data || []) as FriendshipRow[]).forEach((row) => {
    const otherId = row.requester_id === viewerUserId ? row.receiver_id : row.requester_id;
    const current = map[otherId];
    if (!current) {
      map[otherId] = row;
      return;
    }

    // Prefer "viewer -> other" row if both directions exist.
    if (row.requester_id === viewerUserId && current.requester_id !== viewerUserId) {
      map[otherId] = row;
    }
  });

  return map;
};

export const isFollowingUser = (
  relation: FriendshipRow | null | undefined,
  viewerUserId: string | null | undefined
) => Boolean(relation && viewerUserId && relation.status === "accepted" && relation.requester_id === viewerUserId);

const dedupeProfiles = (profiles: ProfileRow[]) => {
  const seen = new Set<string>();
  return profiles.filter((profile) => {
    if (!profile?.id || seen.has(profile.id)) return false;
    seen.add(profile.id);
    return true;
  });
};

export const fetchConnections = async (targetUserId: string) => {
  const supabase = getSupabaseOrThrow();

  const { data: relationData, error: relationError } = await supabase
    .from("friendships")
    .select("id, requester_id, receiver_id, status, created_at")
    .eq("status", "accepted")
    .or(`requester_id.eq.${targetUserId},receiver_id.eq.${targetUserId}`)
    .order("created_at", { ascending: false });

  if (relationError) throw relationError;

  const rows = (relationData || []) as FriendshipRow[];
  const relatedIds = Array.from(
    new Set(
      rows
        .flatMap((row) => [row.requester_id, row.receiver_id])
        .filter((id) => id !== targetUserId)
    )
  );

  let profilesMap = new Map<string, ProfileRow>();
  if (relatedIds.length > 0) {
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .in("id", relatedIds);

    if (profileError) throw profileError;
    profilesMap = new Map(((profileData || []) as ProfileRow[]).map((profile) => [profile.id, profile]));
  }

  const resolveProfile = (id: string): ProfileRow =>
    profilesMap.get(id) || {
      id,
      name: "旅人",
      handle: null,
      bio: null,
      profile_picture_url: null,
    };

  const followers = dedupeProfiles(
    rows.filter((row) => row.receiver_id === targetUserId).map((row) => resolveProfile(row.requester_id))
  );

  const following = dedupeProfiles(
    rows.filter((row) => row.requester_id === targetUserId).map((row) => resolveProfile(row.receiver_id))
  );

  return { followers, following };
};

export const fetchUserPublishedSeries = async (userId: string, limit = 24) => {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("quests")
    .select("id, title, description, area_name, cover_image_url, tags, status, created_at")
    .eq("creator_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = (data || []) as UserSeriesRow[];
  return rows.filter((row) => !row.status || row.status === "published");
};

export const fetchUserAchievements = async (userId: string, limit = 6) => {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("achievements")
    .select("id, name, icon, earned_at")
    .eq("user_id", userId)
    .order("earned_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("social.fetchUserAchievements: fallback to empty list", error);
    return [] as AchievementRow[];
  }

  return (data || []) as AchievementRow[];
};

export const fetchQuestSocialStats = async (questIds: string[]) => {
  if (questIds.length === 0) {
    return {
      ratingByQuestId: {},
      playCountByQuestId: {},
    } satisfies QuestSocialStats;
  }

  const supabase = getSupabaseOrThrow();
  const [reviewsRes, sessionsRes] = await Promise.all([
    supabase.from("quest_reviews").select("quest_id, rating").in("quest_id", questIds),
    supabase.from("play_sessions").select("quest_id").in("quest_id", questIds),
  ]);

  const ratingByQuestId: Record<string, number> = {};
  const playCountByQuestId: Record<string, number> = {};

  if (reviewsRes.error) {
    console.warn("social.fetchQuestSocialStats: failed to fetch quest reviews", reviewsRes.error);
  } else {
    const accumulator: Record<string, { sum: number; count: number }> = {};
    ((reviewsRes.data || []) as Array<{ quest_id: string; rating: number | null }>).forEach((row) => {
      if (!row.quest_id || typeof row.rating !== "number") return;
      if (!accumulator[row.quest_id]) {
        accumulator[row.quest_id] = { sum: 0, count: 0 };
      }
      accumulator[row.quest_id].sum += row.rating;
      accumulator[row.quest_id].count += 1;
    });

    Object.entries(accumulator).forEach(([questId, stat]) => {
      ratingByQuestId[questId] = Number((stat.sum / stat.count).toFixed(1));
    });
  }

  if (sessionsRes.error) {
    console.warn("social.fetchQuestSocialStats: failed to fetch play sessions", sessionsRes.error);
  } else {
    ((sessionsRes.data || []) as Array<{ quest_id: string }>).forEach((row) => {
      if (!row.quest_id) return;
      playCountByQuestId[row.quest_id] = (playCountByQuestId[row.quest_id] || 0) + 1;
    });
  }

  return {
    ratingByQuestId,
    playCountByQuestId,
  } satisfies QuestSocialStats;
};

export const followUser = async (viewerUserId: string, targetUserId: string) => {
  const supabase = getSupabaseOrThrow();
  const { error } = await supabase.from("friendships").insert({
    requester_id: viewerUserId,
    receiver_id: targetUserId,
    status: "accepted",
  });

  if (!error) return;

  if (error.code === "23505") {
    const message = String(error.message || "");
    // Legacy schema (friendships_unique_pair) blocks reverse-direction follows.
    if (message.includes("friendships_unique_pair")) {
      const conflict = new Error("MUTUAL_FOLLOW_BLOCKED_BY_SCHEMA");
      conflict.name = "MutualFollowBlockedError";
      throw conflict;
    }
    // Same-direction duplicate follow is idempotent.
    return;
  }

  throw error;
};

export const isMutualFollowBlockedError = (error: unknown) =>
  error instanceof Error && error.message === "MUTUAL_FOLLOW_BLOCKED_BY_SCHEMA";

export const unfollowByRelationId = async (relationId: string) => {
  const supabase = getSupabaseOrThrow();
  const { error } = await supabase.from("friendships").delete().eq("id", relationId);
  if (error) throw error;
};
