import { getSupabaseOrThrow } from "@/lib/supabase";
import type {
  CreatorTrend,
  ExploreCreator,
  ExplorePayload,
  ExploreQuest,
  NotificationItem,
  QuestHighlight,
} from "@/types/feed";

type QuestRow = {
  id: string;
  title: string | null;
  area_name: string | null;
  cover_image_url: string | null;
  creator_id: string | null;
  spots?: Array<{ lat: number | null; lng: number | null; order_index: number | null }> | null;
  created_at: string | null;
};

type ProfileRow = {
  id: string;
  name: string | null;
  bio: string | null;
  profile_picture_url: string | null;
};

type FriendshipRow = {
  id: string;
  requester_id: string;
  receiver_id: string;
  status: string;
  created_at: string | null;
};

type DailyReportRow = {
  id: string;
  user_id: string;
  category: string | null;
  report_text: string | null;
  created_at: string | null;
};

type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
};

const truncate = (text: string, maxLength: number) => {
  const normalized = text.trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
};

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isMissingRelationError = (error: PostgrestLikeError | null | undefined, relation: string) => {
  if (!error) return false;
  if (error.code !== "PGRST205") return false;
  return (error.message || "").includes(`'public.${relation}'`);
};

const normalizeAIPortRows = (
  rows: Record<string, unknown>[],
  friendIdSet: Set<string>,
  limit: number
): DailyReportRow[] => {
  const mapped = rows.reduce<DailyReportRow[]>((acc, row, index) => {
    const userId =
      asNonEmptyString(row.user_id) ||
      asNonEmptyString(row.userId) ||
      asNonEmptyString(row.author_id) ||
      asNonEmptyString(row.authorId) ||
      asNonEmptyString(row.creator_id) ||
      asNonEmptyString(row.creatorId);
    if (!userId || !friendIdSet.has(userId)) return acc;

    const category = asNonEmptyString(row.category) || asNonEmptyString(row.type) || null;
    const reportText =
      asNonEmptyString(row.report_text) ||
      asNonEmptyString(row.reportText) ||
      asNonEmptyString(row.summary) ||
      asNonEmptyString(row.content) ||
      asNonEmptyString(row.message) ||
      null;
    const createdAt =
      asNonEmptyString(row.created_at) ||
      asNonEmptyString(row.createdAt) ||
      asNonEmptyString(row.inserted_at) ||
      asNonEmptyString(row.updated_at) ||
      null;
    const fallbackId = `aiport-${userId}-${createdAt || index}`;
    const id =
      asNonEmptyString(row.id) ||
      asNonEmptyString(row.report_id) ||
      asNonEmptyString(row.reportId) ||
      asNonEmptyString(row.uuid) ||
      fallbackId;

    acc.push({
      id,
      user_id: userId,
      category,
      report_text: reportText,
      created_at: createdAt,
    });
    return acc;
  }, []);

  return mapped
    .sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, limit);
};

const resolveStartLocation = (
  spots: Array<{ lat: number | null; lng: number | null; order_index: number | null }> | null | undefined
) => {
  if (!spots || spots.length === 0) return null;
  const sorted = [...spots].sort(
    (left, right) => (left.order_index ?? Number.MAX_SAFE_INTEGER) - (right.order_index ?? Number.MAX_SAFE_INTEGER)
  );
  const first = sorted.find((spot) => typeof spot.lat === "number" && typeof spot.lng === "number");
  if (!first || first.lat === null || first.lng === null) return null;
  return { lat: first.lat, lng: first.lng };
};

export const fetchQuestHighlights = async (limit = 8) => {
  const supabase = getSupabaseOrThrow();

  const { data, error } = await supabase
    .from("quests")
    .select("id, title, area_name, cover_image_url, creator_id, created_at")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = (data || []) as QuestRow[];
  const creatorIds = Array.from(new Set(rows.map((row) => row.creator_id).filter(Boolean))) as string[];

  let profileMap = new Map<string, ProfileRow>();
  if (creatorIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, name, bio, profile_picture_url")
      .in("id", creatorIds);

    if (profileError) throw profileError;
    profileMap = new Map(((profiles || []) as ProfileRow[]).map((profile) => [profile.id, profile]));
  }

  return rows.map((row) => ({
    id: row.id,
    title: row.title || "タイトル未設定",
    areaName: row.area_name,
    coverImageUrl: row.cover_image_url,
    creatorId: row.creator_id,
    creatorName: row.creator_id ? profileMap.get(row.creator_id)?.name || "旅する作家" : null,
    createdAt: row.created_at,
  })) satisfies QuestHighlight[];
};

export const fetchExplorePayload = async (viewerUserId?: string | null): Promise<ExplorePayload> => {
  const supabase = getSupabaseOrThrow();

  const { data: questData, error: questError } = await supabase
    .from("quests")
    .select("id, title, area_name, cover_image_url, creator_id, spots(lat, lng, order_index), created_at")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(240);

  if (questError) throw questError;

  const quests = (questData || []) as QuestRow[];
  const creatorCountMap = new Map<string, number>();
  quests.forEach((quest) => {
    if (!quest.creator_id) return;
    creatorCountMap.set(quest.creator_id, (creatorCountMap.get(quest.creator_id) || 0) + 1);
  });

  const creatorIds = Array.from(creatorCountMap.keys());
  const [creatorProfileRes, allProfileRes, purchaseRes] = await Promise.all([
    creatorIds.length > 0
      ? supabase.from("profiles").select("id, name, bio, profile_picture_url").in("id", creatorIds)
      : Promise.resolve({ data: [] as ProfileRow[], error: null }),
    supabase
      .from("profiles")
      .select("id, name, bio, profile_picture_url")
      .order("created_at", { ascending: false }),
    viewerUserId
      ? supabase.from("purchases").select("quest_id").eq("user_id", viewerUserId)
      : Promise.resolve({ data: [] as Array<{ quest_id: string }>, error: null }),
  ]);

  if (creatorProfileRes.error) throw creatorProfileRes.error;
  if (allProfileRes.error) throw allProfileRes.error;
  if (purchaseRes.error) throw purchaseRes.error;

  const creatorProfileMap = new Map(
    ((creatorProfileRes.data || []) as ProfileRow[]).map((profile) => [profile.id, profile])
  );

  const questList = quests.map((quest) => {
    const creator = quest.creator_id ? creatorProfileMap.get(quest.creator_id) : null;
    return {
      id: quest.id,
      title: quest.title || "タイトル未設定",
      areaName: quest.area_name || null,
      coverImageUrl: quest.cover_image_url || null,
      creatorId: quest.creator_id,
      creatorName: creator?.name || "旅する作家",
      startLocation: resolveStartLocation(quest.spots),
    } satisfies ExploreQuest;
  });

  const rankedCreatorIds = Array.from(creatorCountMap.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([id]) => id);

  const toCreator = (profile: ProfileRow): ExploreCreator => ({
    id: profile.id,
    name: profile.name || "旅する作家",
    profilePictureUrl: profile.profile_picture_url || null,
    questCount: creatorCountMap.get(profile.id) || 0,
  });

  const rankedCreators = rankedCreatorIds.map((creatorId) => {
    const profile = creatorProfileMap.get(creatorId);
    if (!profile) {
      return {
        id: creatorId,
        name: "旅する作家",
        profilePictureUrl: null,
        questCount: creatorCountMap.get(creatorId) || 0,
      } satisfies ExploreCreator;
    }
    return toCreator(profile);
  });

  const allCreators = ((allProfileRes.data || []) as ProfileRow[]).map(toCreator);
  const purchasedQuestIds = ((purchaseRes.data || []) as Array<{ quest_id: string }>).map((row) => row.quest_id);

  const questCountByCreatorId: Record<string, number> = {};
  creatorCountMap.forEach((count, creatorId) => {
    questCountByCreatorId[creatorId] = count;
  });

  return {
    quests: questList,
    creators: rankedCreators,
    allCreators,
    purchasedQuestIds,
    questCountByCreatorId,
  } satisfies ExplorePayload;
};

export const fetchTrendingCreators = async (limit = 6) => {
  const supabase = getSupabaseOrThrow();

  const { data, error } = await supabase
    .from("quests")
    .select("creator_id, created_at")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(160);

  if (error) throw error;

  const questRows = (data || []) as Array<{ creator_id: string | null }>;
  const creatorCounts = new Map<string, number>();

  questRows.forEach((row) => {
    if (!row.creator_id) return;
    creatorCounts.set(row.creator_id, (creatorCounts.get(row.creator_id) || 0) + 1);
  });

  const sortedCreatorIds = Array.from(creatorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);

  if (sortedCreatorIds.length === 0) return [] as CreatorTrend[];

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, name, bio, profile_picture_url")
    .in("id", sortedCreatorIds);

  if (profileError) throw profileError;

  const profileMap = new Map(((profiles || []) as ProfileRow[]).map((profile) => [profile.id, profile]));

  return sortedCreatorIds.map((creatorId) => {
    const profile = profileMap.get(creatorId);
    return {
      id: creatorId,
      name: profile?.name || "旅する作家",
      bio: profile?.bio || null,
      profilePictureUrl: profile?.profile_picture_url || null,
      questCount: creatorCounts.get(creatorId) || 0,
    } satisfies CreatorTrend;
  });
};

export const fetchNotifications = async (viewerUserId: string, limit = 30) => {
  const supabase = getSupabaseOrThrow();

  const [friendshipsRes, followersRes] = await Promise.all([
    supabase
      .from("friendships")
      .select("id, requester_id, receiver_id, status, created_at")
      .eq("status", "accepted")
      .or(`requester_id.eq.${viewerUserId},receiver_id.eq.${viewerUserId}`),
    supabase
      .from("friendships")
      .select("id, requester_id, receiver_id, status, created_at")
      .eq("status", "accepted")
      .eq("receiver_id", viewerUserId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  if (friendshipsRes.error) throw friendshipsRes.error;
  if (followersRes.error) throw followersRes.error;

  const friendships = (friendshipsRes.data || []) as FriendshipRow[];
  const followerRows = (followersRes.data || []) as FriendshipRow[];

  const friendIds = Array.from(
    new Set(
      friendships
        .flatMap((row) => [row.requester_id, row.receiver_id])
        .filter((id) => id && id !== viewerUserId)
    )
  );

  const relatedProfileIds = Array.from(new Set([...friendIds, ...followerRows.map((row) => row.requester_id)]));

  const profilesRes =
    relatedProfileIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, name, bio, profile_picture_url")
          .in("id", relatedProfileIds)
      : { data: [] as ProfileRow[], error: null };

  if (profilesRes.error) throw profilesRes.error;

  let reportRows: DailyReportRow[] = [];
  if (friendIds.length > 0) {
    const reportsRes = await supabase
      .from("daily_reports")
      .select("id, user_id, category, report_text, created_at")
      .in("user_id", friendIds)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (reportsRes.error) {
      if (!isMissingRelationError(reportsRes.error, "daily_reports")) {
        throw reportsRes.error;
      }

      const aiPortRes = await supabase.from("AIPort").select("*").limit(Math.max(40, limit * 2));
      if (aiPortRes.error) {
        console.warn("feed: AIPort fallback query failed", aiPortRes.error);
      } else {
        reportRows = normalizeAIPortRows((aiPortRes.data || []) as Record<string, unknown>[], new Set(friendIds), limit);
      }
    } else {
      reportRows = (reportsRes.data || []) as DailyReportRow[];
    }
  }

  const profileMap = new Map(((profilesRes.data || []) as ProfileRow[]).map((profile) => [profile.id, profile]));

  const followItems = followerRows.map((row) => {
    const actor = profileMap.get(row.requester_id);

    return {
      id: `follow-${row.id}`,
      type: "follow",
      actorId: row.requester_id,
      actorName: actor?.name || "新しいフォロワー",
      actorAvatar: actor?.profile_picture_url || null,
      message: "あなたをフォローしました",
      createdAt: row.created_at,
    } satisfies NotificationItem;
  });

  const reportItems = reportRows.map((report) => {
    const actor = profileMap.get(report.user_id);
    const text = report.report_text || report.category || "新しい投稿があります";

    return {
      id: `report-${report.id}`,
      type: "report",
      actorId: report.user_id,
      actorName: actor?.name || "旅の仲間",
      actorAvatar: actor?.profile_picture_url || null,
      message: truncate(text, 40),
      createdAt: report.created_at,
    } satisfies NotificationItem;
  });

  return [...followItems, ...reportItems]
    .sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, limit);
};
