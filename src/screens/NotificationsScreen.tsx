import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { fonts } from "@/theme/fonts";
import type { RootStackParamList } from "@/navigation/types";
import { useSessionUserId } from "@/hooks/useSessionUser";
import { fetchFollowCounts, fetchUserAchievements, fetchUserProfile } from "@/services/social";
import type { AchievementRow } from "@/types/social";
import { getSupabaseOrThrow, isSupabaseConfigured } from "@/lib/supabase";
import { ProfileAvatar } from "@/components/common/ProfileAvatar";

type AchievementTab = "summary" | "badges" | "friends" | "history";

type SummaryStats = {
  totalPlayCount: number;
  totalDurationSec: number;
  seriesCount: number;
  activeDaysInWeek: number;
};

type SocialStats = {
  followers: number;
  following: number;
  mutualFollowers: number;
  sharedPostCount: number;
  coopPlayCount: number;
  reviewCount: number;
};

type HistoryRow = {
  id: string;
  title: string;
  endedAt: string | null;
  durationSec: number | null;
  wrongAnswers: number | null;
  hintsUsed: number | null;
};

type LeaderboardRow = {
  rank: number;
  userId: string;
  name: string;
  avatarUrl: string | null;
  score: number;
  playCount: number;
  sharedPostCount: number;
  badgeCount: number;
  isMe: boolean;
};

type BadgeTone = "primary" | "gold" | "sunset";
type BadgeCard = {
  id: string;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: BadgeTone;
};

type FriendRelation = {
  requester_id: string;
  receiver_id: string;
  status: string;
};

type SessionRow = {
  id: string;
  quest_id: string | null;
  ended_at: string | null;
  duration_sec: number | null;
  wrong_answers: number | null;
  hints_used: number | null;
};

const ACHIEVEMENT_TABS: Array<{ key: AchievementTab; label: string }> = [
  { key: "summary", label: "サマリー" },
  { key: "badges", label: "バッジ" },
  { key: "friends", label: "フレンド" },
  { key: "history", label: "履歴" },
];

const FALLBACK_BADGES: BadgeCard[] = [
  { id: "traveler-debut", name: "旅人デビュー", icon: "compass", tone: "primary" },
  { id: "journey-master", name: "長旅マスター", icon: "sparkles", tone: "gold" },
  { id: "no-hint-clear", name: "ノーヒントクリア", icon: "flash", tone: "sunset" },
];

const TOTAL_BADGE_COUNT = 30;

const createDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const countActiveDaysInLastWeek = (sessions: SessionRow[]) => {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - 6);
  const sinceMs = since.getTime();

  const activeKeys = new Set<string>();
  sessions.forEach((session) => {
    if (!session.ended_at) return;
    const date = new Date(session.ended_at);
    if (Number.isNaN(date.getTime()) || date.getTime() < sinceMs) return;
    activeKeys.add(createDateKey(date));
  });

  return activeKeys.size;
};

const countMutualFollowers = (rows: FriendRelation[], userId: string) => {
  const followerIds = new Set<string>();
  const followingIds = new Set<string>();

  rows.forEach((row) => {
    if (row.status !== "accepted") return;
    if (row.receiver_id === userId) {
      followerIds.add(row.requester_id);
    }
    if (row.requester_id === userId) {
      followingIds.add(row.receiver_id);
    }
  });

  let total = 0;
  followingIds.forEach((id) => {
    if (followerIds.has(id)) total += 1;
  });
  return total;
};

const formatDurationTotal = (seconds: number) => {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${remain}m`;
};

const formatDurationCompact = (seconds: number | null | undefined) => {
  if (!seconds || seconds <= 0) return "-";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return `${hours}h ${remain}m`;
};

const formatHistoryDateTime = (value: string | null) => {
  if (!value) return "日時不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時不明";

  const datePart = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replace(/\//g, ".");

  const timePart = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  return `${datePart} | ${timePart}`;
};

const resolveBadgeTone = (index: number): BadgeTone => {
  if (index % 3 === 1) return "gold";
  if (index % 3 === 2) return "sunset";
  return "primary";
};

const resolveAchievementIcon = (raw: string | null | undefined, index: number): keyof typeof Ionicons.glyphMap => {
  const icon = (raw || "").trim().toLowerCase();
  if (icon.includes("star")) return "sparkles";
  if (icon.includes("flash") || icon.includes("bolt")) return "flash";
  if (icon.includes("compass") || icon.includes("explore")) return "compass";
  if (icon.includes("map")) return "map";
  if (icon.includes("people") || icon.includes("friend")) return "people";
  if (icon.includes("heart")) return "heart";
  if (icon.includes("share")) return "share-social";
  if (icon.includes("trophy")) return "trophy";
  if (icon.includes("medal")) return "medal";
  return FALLBACK_BADGES[index % FALLBACK_BADGES.length]?.icon || "trophy";
};

const toneStyle = (tone: BadgeTone) => {
  if (tone === "gold") {
    return {
      background: "#FDEFC8",
      border: "#EAB308",
      icon: "#CA8A04",
    };
  }
  if (tone === "sunset") {
    return {
      background: "#FFE3D4",
      border: "#EA580C",
      icon: "#C2410C",
    };
  }
  return {
    background: "#FDEBD6",
    border: "#EE8C2B",
    icon: "#EE8C2B",
  };
};

const rankColor = (rank: number) => {
  if (rank === 1) return "#EAB308";
  if (rank === 2) return "#94A3B8";
  if (rank === 3) return "#FB923C";
  return "#6C5647";
};

export const NotificationsScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { userId, loading: authLoading } = useSessionUserId();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<AchievementTab>("summary");

  const [displayName, setDisplayName] = useState("My User");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [summaryStats, setSummaryStats] = useState<SummaryStats>({
    totalPlayCount: 0,
    totalDurationSec: 0,
    seriesCount: 0,
    activeDaysInWeek: 0,
  });
  const [socialStats, setSocialStats] = useState<SocialStats>({
    followers: 0,
    following: 0,
    mutualFollowers: 0,
    sharedPostCount: 0,
    coopPlayCount: 0,
    reviewCount: 0,
  });
  const [achievementRows, setAchievementRows] = useState<AchievementRow[]>([]);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);

  const refresh = useCallback(
    async (manualRefresh = false) => {
      if (!isSupabaseConfigured) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (!userId) {
        setDisplayName("My User");
        setProfileAvatarUrl(null);
        setSummaryStats({
          totalPlayCount: 0,
          totalDurationSec: 0,
          seriesCount: 0,
          activeDaysInWeek: 0,
        });
        setSocialStats({
          followers: 0,
          following: 0,
          mutualFollowers: 0,
          sharedPostCount: 0,
          coopPlayCount: 0,
          reviewCount: 0,
        });
        setAchievementRows([]);
        setHistoryRows([]);
        setLeaderboardRows([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (manualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const supabase = getSupabaseOrThrow();

        const [
          profileRow,
          followCounts,
          userAchievements,
          sessions,
          friendships,
          sharedPostCount,
          reviewCount,
        ] = await Promise.all([
          fetchUserProfile(userId),
          fetchFollowCounts(userId),
          fetchUserAchievements(userId, 60),
          (async () => {
            try {
              const { data, error } = await supabase
                .from("play_sessions")
                .select("id, quest_id, ended_at, duration_sec, wrong_answers, hints_used")
                .eq("user_id", userId)
                .order("ended_at", { ascending: false })
                .limit(120);
              if (error) throw error;
              return (data || []) as SessionRow[];
            } catch (error) {
              console.warn("AchievementsScreen: failed to fetch sessions", error);
              return [] as SessionRow[];
            }
          })(),
          (async () => {
            try {
              const { data, error } = await supabase
                .from("friendships")
                .select("requester_id, receiver_id, status")
                .eq("status", "accepted")
                .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);
              if (error) throw error;
              return (data || []) as FriendRelation[];
            } catch (error) {
              console.warn("AchievementsScreen: failed to fetch friendships", error);
              return [] as FriendRelation[];
            }
          })(),
          (async () => {
            try {
              const { count, error } = await supabase
                .from("quest_posts")
                .select("id", { count: "exact", head: true })
                .eq("user_id", userId);
              if (error) throw error;
              return count || 0;
            } catch (error) {
              console.warn("AchievementsScreen: failed to fetch quest_posts count", error);
              return 0;
            }
          })(),
          (async () => {
            try {
              const { count, error } = await supabase
                .from("quest_reviews")
                .select("quest_id", { count: "exact", head: true })
                .eq("user_id", userId);
              if (error) throw error;
              return count || 0;
            } catch (error) {
              console.warn("AchievementsScreen: failed to fetch quest_reviews count", error);
              return 0;
            }
          })(),
        ]);

        const profileDisplayName = profileRow?.name || "My User";
        setDisplayName(profileDisplayName);
        setProfileAvatarUrl(profileRow?.profile_picture_url || null);
        setAchievementRows(userAchievements);

        const questIds = Array.from(
          new Set(sessions.map((row) => row.quest_id).filter((questId): questId is string => Boolean(questId)))
        );

        let questMap = new Map<string, { title: string; creatorId: string | null }>();
        if (questIds.length > 0) {
          try {
            const { data, error } = await supabase
              .from("quests")
              .select("id, title, creator_id")
              .in("id", questIds);

            if (error) {
              console.warn("AchievementsScreen: failed to fetch quest map", error);
            } else {
              questMap = new Map(
                ((data || []) as Array<{ id: string; title: string | null; creator_id: string | null }>).map(
                  (row) => [row.id, { title: row.title || "クエスト", creatorId: row.creator_id || null }]
                )
              );
            }
          } catch (error) {
            console.warn("AchievementsScreen: failed to resolve quests", error);
          }
        }

        const totalDurationSec = sessions.reduce((sum, row) => sum + (row.duration_sec || 0), 0);
        const coopPlayCount = sessions.filter((row) => {
          if (!row.quest_id) return false;
          const creatorId = questMap.get(row.quest_id)?.creatorId;
          return Boolean(creatorId && creatorId !== userId);
        }).length;

        const mappedHistory: HistoryRow[] = sessions.slice(0, 20).map((row) => ({
          id: row.id,
          title: row.quest_id ? questMap.get(row.quest_id)?.title || "クエスト" : "クエスト",
          endedAt: row.ended_at,
          durationSec: row.duration_sec,
          wrongAnswers: row.wrong_answers,
          hintsUsed: row.hints_used,
        }));
        setHistoryRows(mappedHistory);

        setSummaryStats({
          totalPlayCount: sessions.length,
          totalDurationSec,
          seriesCount: questIds.length,
          activeDaysInWeek: countActiveDaysInLastWeek(sessions),
        });

        setSocialStats({
          followers: followCounts.followers,
          following: followCounts.following,
          mutualFollowers: countMutualFollowers(friendships, userId),
          sharedPostCount,
          coopPlayCount,
          reviewCount,
        });

        const friendIds = Array.from(
          new Set(
            friendships
              .flatMap((row) => [row.requester_id, row.receiver_id])
              .filter((id) => Boolean(id) && id !== userId)
          )
        );

        const candidateIds = Array.from(new Set([userId, ...friendIds]));
        if (candidateIds.length > 0) {
          const [profileRows, playRows, postRows, badgeRows] = await Promise.all([
            (async () => {
              try {
                const { data, error } = await supabase
                  .from("profiles")
                  .select("id, name, profile_picture_url")
                  .in("id", candidateIds);
                if (error) throw error;
                return (data || []) as Array<{ id: string; name: string | null; profile_picture_url: string | null }>;
              } catch (error) {
                console.warn("AchievementsScreen: failed to fetch leaderboard profiles", error);
                return [] as Array<{ id: string; name: string | null; profile_picture_url: string | null }>;
              }
            })(),
            (async () => {
              try {
                const { data, error } = await supabase
                  .from("play_sessions")
                  .select("user_id")
                  .in("user_id", candidateIds)
                  .limit(4000);
                if (error) throw error;
                return (data || []) as Array<{ user_id: string | null }>;
              } catch (error) {
                console.warn("AchievementsScreen: failed to fetch leaderboard play sessions", error);
                return [] as Array<{ user_id: string | null }>;
              }
            })(),
            (async () => {
              try {
                const { data, error } = await supabase
                  .from("quest_posts")
                  .select("user_id")
                  .in("user_id", candidateIds)
                  .limit(4000);
                if (error) throw error;
                return (data || []) as Array<{ user_id: string | null }>;
              } catch (error) {
                console.warn("AchievementsScreen: failed to fetch leaderboard posts", error);
                return [] as Array<{ user_id: string | null }>;
              }
            })(),
            (async () => {
              try {
                const { data, error } = await supabase
                  .from("achievements")
                  .select("user_id")
                  .in("user_id", candidateIds)
                  .limit(4000);
                if (error) throw error;
                return (data || []) as Array<{ user_id: string | null }>;
              } catch (error) {
                console.warn("AchievementsScreen: failed to fetch leaderboard achievements", error);
                return [] as Array<{ user_id: string | null }>;
              }
            })(),
          ]);

          const profileMap = new Map(profileRows.map((row) => [row.id, row]));
          const playCountMap = new Map<string, number>();
          const postCountMap = new Map<string, number>();
          const badgeCountMap = new Map<string, number>();

          playRows.forEach((row) => {
            if (!row.user_id) return;
            playCountMap.set(row.user_id, (playCountMap.get(row.user_id) || 0) + 1);
          });
          postRows.forEach((row) => {
            if (!row.user_id) return;
            postCountMap.set(row.user_id, (postCountMap.get(row.user_id) || 0) + 1);
          });
          badgeRows.forEach((row) => {
            if (!row.user_id) return;
            badgeCountMap.set(row.user_id, (badgeCountMap.get(row.user_id) || 0) + 1);
          });

          const ranked = candidateIds
            .map((id) => {
              const playCount = playCountMap.get(id) || 0;
              const postCount = postCountMap.get(id) || 0;
              const badgeCount = badgeCountMap.get(id) || 0;
              return {
                userId: id,
                name: profileMap.get(id)?.name || (id === userId ? profileDisplayName : "旅人"),
                avatarUrl: profileMap.get(id)?.profile_picture_url || null,
                playCount,
                sharedPostCount: postCount,
                badgeCount,
                score: playCount * 10 + postCount * 25 + badgeCount * 50,
                isMe: id === userId,
              };
            })
            .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "ja"));

          setLeaderboardRows(
            ranked.map((row, index) => ({
              ...row,
              rank: index + 1,
            }))
          );
        } else {
          setLeaderboardRows([]);
        }
      } catch (error) {
        console.error("AchievementsScreen: failed to load", error);
        Alert.alert("実績を読み込めません", "時間をおいて再度お試しください。");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userId]
  );

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const badgeCards = useMemo(() => {
    const cards =
      achievementRows.length > 0
        ? achievementRows.map((row, index) => ({
            id: row.id,
            name: row.name || `バッジ ${index + 1}`,
            icon: resolveAchievementIcon(row.icon, index),
            tone: resolveBadgeTone(index),
          }))
        : FALLBACK_BADGES;

    const unlockedCount = achievementRows.length > 0 ? achievementRows.length : FALLBACK_BADGES.length;
    const displayCards = cards.slice(0, 6);
    const lockedCount = Math.max(0, 6 - displayCards.length);

    return {
      unlockedCount,
      cards: [
        ...displayCards.map((card) => ({ ...card, locked: false })),
        ...Array.from({ length: lockedCount }, (_, index) => ({
          id: `locked-${index}`,
          name: "???",
          icon: "lock-closed" as const,
          tone: "primary" as const,
          locked: true,
        })),
      ],
    };
  }, [achievementRows]);

  const myRank = useMemo(() => leaderboardRows.find((row) => row.isMe) || null, [leaderboardRows]);
  const friendRankRows = useMemo(
    () => leaderboardRows.filter((row) => !row.isMe).slice(0, 10),
    [leaderboardRows]
  );

  if (!isSupabaseConfigured) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-[#F8F7F6]">
        <View className="px-6 pt-10">
          <Text className="text-lg text-[#221910] mb-2" style={{ fontFamily: fonts.displayBold }}>
            Supabase設定が必要です
          </Text>
          <Text className="text-sm text-[#6C5647]" style={{ fontFamily: fonts.bodyRegular }}>
            `.env` に EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY を設定してください。
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (authLoading || loading) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-[#F8F7F6]">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#EE8C2B" />
        </View>
      </SafeAreaView>
    );
  }

  if (!userId) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-[#F8F7F6] px-6">
        <View className="flex-1 items-center justify-center">
          <View className="w-20 h-20 rounded-full bg-white border border-[#E3D6C9] items-center justify-center mb-4">
            <Ionicons name="trophy" size={34} color="#EE8C2B" />
          </View>
          <Text className="text-[30px] text-[#221910] mb-2" style={{ fontFamily: fonts.displayBold }}>
            実績
          </Text>
          <Text className="text-sm text-[#6C5647] text-center mb-6" style={{ fontFamily: fonts.bodyRegular }}>
            ログインすると、これまでの旅の記録やフレンドランキングを確認できます。
          </Text>
          <Pressable
            className="h-12 rounded-full px-8 bg-[#EE8C2B] items-center justify-center"
            onPress={() => navigation.navigate("Auth")}
          >
            <Text className="text-white text-sm" style={{ fontFamily: fonts.displayBold }}>
              ログイン / 新規登録
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-[#F8F7F6]">
      <View className="px-4 py-3 border-b border-[#EFE6DD] bg-[#F8F7F6] flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Ionicons name="trophy" size={24} color="#EE8C2B" />
          <Text className="text-lg text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
            実績
          </Text>
        </View>
        <Pressable
          className="w-10 h-10 rounded-full items-center justify-center"
          onPress={() => navigation.navigate("Settings")}
        >
          <Ionicons name="settings-outline" size={20} color="#221910" />
        </Pressable>
      </View>

      <View className="bg-[#F8F7F6] border-b border-[#EFE6DD]">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, justifyContent: "center", flexGrow: 1 }}
          className="max-h-[48px]"
        >
          {ACHIEVEMENT_TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                className={`mx-1.5 px-6 py-3 border-b-2 ${active ? "border-[#EE8C2B]" : "border-transparent"}`}
              >
                <Text
                  className={`text-sm ${active ? "text-[#EE8C2B]" : "text-[#62584E]"}`}
                  style={{ fontFamily: active ? fonts.displayBold : fonts.bodyMedium }}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh(true)} tintColor="#EE8C2B" />
        }
      >
        {activeTab === "summary" ? (
          <View className="p-4 gap-4">
            <View className="bg-white rounded-2xl p-5 border border-[#EFE6DD]">
              <View className="flex-row items-center gap-4 mb-4">
                <View className="w-16 h-16 rounded-2xl bg-[#FDF2E4] items-center justify-center">
                  <Ionicons name="stats-chart" size={32} color="#EE8C2B" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm text-[#62584E]" style={{ fontFamily: fonts.bodyMedium }}>
                    全体サマリー
                  </Text>
                  <Text className="text-xl text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                    これまでの活動記録
                  </Text>
                </View>
              </View>

              <View className="flex-row flex-wrap justify-between">
                <View className="w-[48%] rounded-xl border border-[#EFE6DD] bg-[#F8F7F6] p-3 mb-3">
                  <Text className="text-[10px] text-[#62584E]" style={{ fontFamily: fonts.bodyRegular }}>
                    合計プレイ
                  </Text>
                  <Text className="text-base text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                    {summaryStats.totalPlayCount} <Text className="text-[10px]">回</Text>
                  </Text>
                </View>
                <View className="w-[48%] rounded-xl border border-[#EFE6DD] bg-[#F8F7F6] p-3 mb-3">
                  <Text className="text-[10px] text-[#62584E]" style={{ fontFamily: fonts.bodyRegular }}>
                    合計時間
                  </Text>
                  <Text className="text-base text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                    {formatDurationTotal(summaryStats.totalDurationSec)}
                  </Text>
                </View>
                <View className="w-[48%] rounded-xl border border-[#EFE6DD] bg-[#F8F7F6] p-3">
                  <Text className="text-[10px] text-[#62584E]" style={{ fontFamily: fonts.bodyRegular }}>
                    参加シリーズ
                  </Text>
                  <Text className="text-base text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                    {summaryStats.seriesCount} <Text className="text-[10px]">作品</Text>
                  </Text>
                </View>
                <View className="w-[48%] rounded-xl border border-[#EFE6DD] bg-[#F8F7F6] p-3">
                  <Text className="text-[10px] text-[#62584E]" style={{ fontFamily: fonts.bodyRegular }}>
                    継続日数(7日)
                  </Text>
                  <Text className="text-base text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                    {summaryStats.activeDaysInWeek} <Text className="text-[10px]">日</Text>
                  </Text>
                </View>
              </View>
            </View>

            <View className="bg-white rounded-2xl p-5 border border-[#EFE6DD]">
              <View className="flex-row items-center gap-2 mb-4">
                <Ionicons name="share-social" size={20} color="#EE8C2B" />
                <Text className="text-sm text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                  ソーシャル実績
                </Text>
              </View>

              <View className="flex-row items-center justify-around border-b border-[#EFE6DD] pb-5 mb-5">
                <View className="items-center">
                  <Text className="text-xl text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                    {socialStats.followers}
                  </Text>
                  <Text className="text-[10px] text-[#62584E]" style={{ fontFamily: fonts.bodyRegular }}>
                    フォロワー
                  </Text>
                </View>
                <View className="h-6 w-px bg-[#EFE6DD]" />
                <View className="items-center">
                  <Text className="text-xl text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                    {socialStats.following}
                  </Text>
                  <Text className="text-[10px] text-[#62584E]" style={{ fontFamily: fonts.bodyRegular }}>
                    フォロー
                  </Text>
                </View>
                <View className="h-6 w-px bg-[#EFE6DD]" />
                <View className="items-center">
                  <Text className="text-xl text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                    {socialStats.mutualFollowers}
                  </Text>
                  <Text className="text-[10px] text-[#62584E]" style={{ fontFamily: fonts.bodyRegular }}>
                    相互フォロー
                  </Text>
                </View>
              </View>

              <View className="gap-3">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2">
                    <Ionicons name="gift-outline" size={17} color="#EE8C2B" />
                    <Text className="text-xs text-[#221910]" style={{ fontFamily: fonts.bodyMedium }}>
                      ギフト送付回数
                    </Text>
                  </View>
                  <Text className="text-xs text-[#62584E]" style={{ fontFamily: fonts.displayBold }}>
                    {socialStats.sharedPostCount} 回
                  </Text>
                </View>
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2">
                    <Ionicons name="people-outline" size={17} color="#EE8C2B" />
                    <Text className="text-xs text-[#221910]" style={{ fontFamily: fonts.bodyMedium }}>
                      協力プレイ回数
                    </Text>
                  </View>
                  <Text className="text-xs text-[#62584E]" style={{ fontFamily: fonts.displayBold }}>
                    {socialStats.coopPlayCount} 回
                  </Text>
                </View>
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2">
                    <Ionicons name="chatbubble-ellipses-outline" size={17} color="#EE8C2B" />
                    <Text className="text-xs text-[#221910]" style={{ fontFamily: fonts.bodyMedium }}>
                      コメント投稿数
                    </Text>
                  </View>
                  <Text className="text-xs text-[#62584E]" style={{ fontFamily: fonts.displayBold }}>
                    {socialStats.reviewCount} 件
                  </Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {activeTab === "badges" ? (
          <View className="p-4">
            <View className="bg-white rounded-2xl p-5 border border-[#EFE6DD]">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-base text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                  アチーブメントメダル
                </Text>
                <Text className="text-sm text-[#EE8C2B]" style={{ fontFamily: fonts.displayBold }}>
                  {badgeCards.unlockedCount} / {TOTAL_BADGE_COUNT}
                </Text>
              </View>

              <View className="w-full h-2 rounded-full bg-[#EFE6DD] overflow-hidden mb-6">
                <View
                  className="h-full rounded-full bg-[#EE8C2B]"
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(100, Math.round((badgeCards.unlockedCount / TOTAL_BADGE_COUNT) * 100))
                    )}%`,
                  }}
                />
              </View>

              <View className="flex-row flex-wrap justify-between">
                {badgeCards.cards.map((badge) => {
                  const style = toneStyle(badge.tone);
                  return (
                    <View
                      key={badge.id}
                      className={`w-[31%] items-center mb-6 ${badge.locked ? "opacity-45" : ""}`}
                    >
                      <View
                        className="w-16 h-16 rounded-full items-center justify-center border-2"
                        style={{
                          backgroundColor: badge.locked ? "#E2E8F0" : style.background,
                          borderColor: badge.locked ? "#CBD5E1" : style.border,
                        }}
                      >
                        <Ionicons
                          name={badge.icon}
                          size={26}
                          color={badge.locked ? "#64748B" : style.icon}
                        />
                      </View>
                      <Text
                        className={`text-[10px] mt-2 text-center ${badge.locked ? "text-[#62584E]" : "text-[#221910]"}`}
                        style={{ fontFamily: badge.locked ? fonts.bodyMedium : fonts.displayBold }}
                      >
                        {badge.name}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        ) : null}

        {activeTab === "friends" ? (
          <View className="p-4">
            <Text className="text-base text-[#221910] mb-4" style={{ fontFamily: fonts.displayBold }}>
              フレンドランキング
            </Text>

            <View className="bg-white rounded-2xl overflow-hidden border border-[#EFE6DD]">
              {myRank ? (
                <View className="bg-[#FFF6EC] p-4 flex-row items-center gap-3 border-b border-[#F4DEC4]">
                  <Text className="text-lg text-[#EE8C2B] w-7" style={{ fontFamily: fonts.displayBold }}>
                    {myRank.rank}
                  </Text>
                  <ProfileAvatar name={displayName} imageUrl={profileAvatarUrl} size={40} />
                  <View className="flex-1">
                    <Text className="text-sm text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                      {displayName} (My User)
                    </Text>
                    <Text className="text-[10px] text-[#62584E]" style={{ fontFamily: fonts.bodyRegular }}>
                      スコア: {myRank.score.toLocaleString("ja-JP")} pt
                    </Text>
                  </View>
                  <View className="px-2 py-1 rounded-full bg-[#FDECD8]">
                    <Text className="text-[10px] text-[#EE8C2B]" style={{ fontFamily: fonts.displayBold }}>
                      MY RANK
                    </Text>
                  </View>
                </View>
              ) : null}

              {friendRankRows.length === 0 ? (
                <View className="px-4 py-8 items-center">
                  <Ionicons name="people-outline" size={28} color="#94A3B8" />
                  <Text className="text-sm text-[#62584E] mt-2" style={{ fontFamily: fonts.bodyRegular }}>
                    ランキング対象のフレンドがまだいません
                  </Text>
                </View>
              ) : (
                <View>
                  {friendRankRows.map((row, index) => (
                    <View
                      key={row.userId}
                      className={`p-3 flex-row items-center gap-3 ${index > 0 ? "border-t border-[#EFE6DD]" : ""}`}
                    >
                      <Text
                        className="w-6 text-base text-center"
                        style={{ fontFamily: fonts.displayBold, color: rankColor(row.rank) }}
                      >
                        {row.rank}
                      </Text>
                      <ProfileAvatar name={row.name} imageUrl={row.avatarUrl} size={34} />
                      <Text className="flex-1 text-sm text-[#221910]" style={{ fontFamily: fonts.bodyMedium }}>
                        {row.name}
                      </Text>
                      <Text className="text-xs text-[#62584E]" style={{ fontFamily: fonts.displayBold }}>
                        {row.score.toLocaleString("ja-JP")} pt
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              <View className="p-2 bg-[#F8F7F6]">
                <Text className="text-[9px] text-[#62584E] text-center" style={{ fontFamily: fonts.bodyRegular }}>
                  計算式: プレイ数×10 + 投稿シェア×25 + 獲得メダル×50
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {activeTab === "history" ? (
          <View className="p-4">
            <Text className="text-base text-[#221910] mb-4" style={{ fontFamily: fonts.displayBold }}>
              最近のジャーニーログ
            </Text>

            {historyRows.length === 0 ? (
              <View className="bg-white rounded-2xl border border-dashed border-[#E5DDD3] p-6 items-center">
                <Ionicons name="map-outline" size={28} color="#94A3B8" />
                <Text className="text-sm text-[#62584E] mt-2" style={{ fontFamily: fonts.bodyRegular }}>
                  まだプレイ履歴がありません
                </Text>
              </View>
            ) : (
              <View className="gap-3">
                {historyRows.map((row) => (
                  <View
                    key={row.id}
                    className="bg-white p-4 rounded-xl border border-[#EFE6DD]"
                  >
                    <View className="flex-row items-start justify-between">
                      <View className="flex-1 pr-3">
                        <Text className="text-sm text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                          {row.title}
                        </Text>
                        <Text className="text-[10px] text-[#62584E] mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                          {formatHistoryDateTime(row.endedAt)}
                        </Text>
                      </View>
                      <View className="px-2 py-0.5 rounded-full bg-[#22C55E]">
                        <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                          クリア
                        </Text>
                      </View>
                    </View>

                    <View className="flex-row mt-3">
                      <View className="flex-1 items-center">
                        <Text className="text-[9px] text-[#62584E]" style={{ fontFamily: fonts.bodyRegular }}>
                          所要時間
                        </Text>
                        <Text className="text-xs text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                          {formatDurationCompact(row.durationSec)}
                        </Text>
                      </View>
                      <View className="flex-1 items-center">
                        <Text className="text-[9px] text-[#62584E]" style={{ fontFamily: fonts.bodyRegular }}>
                          エラー
                        </Text>
                        <Text className="text-xs text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                          {row.wrongAnswers || 0}回
                        </Text>
                      </View>
                      <View className="flex-1 items-center">
                        <Text className="text-[9px] text-[#62584E]" style={{ fontFamily: fonts.bodyRegular }}>
                          ヒント
                        </Text>
                        <Text className="text-xs text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                          {row.hintsUsed || 0}回
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};
