import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { MainTabParamList, RootStackParamList } from "@/navigation/types";
import { fonts } from "@/theme/fonts";
import { useSessionUserId } from "@/hooks/useSessionUser";
import {
  fetchFollowCounts,
  fetchQuestSocialStats,
  fetchUserAchievements,
  fetchUserProfile,
} from "@/services/social";
import type { AchievementRow, ProfileRow } from "@/types/social";
import { ProfileAvatar } from "@/components/common/ProfileAvatar";
import { getSupabaseOrThrow, isSupabaseConfigured } from "@/lib/supabase";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import { fetchMySeriesOptions, type SeriesOption } from "@/services/quests";

type Props = BottomTabScreenProps<MainTabParamList, "Profile">;
type ProfileTab = "series" | "timeline" | "likes" | "drafts";

type TimelineRow = {
  id: string;
  questId: string;
  questTitle: string;
  endedAt: string | null;
  durationSec: number | null;
  wrongAnswers: number | null;
  hintsUsed: number | null;
};

type LikedQuestRow = {
  questId: string;
  title: string;
  area: string | null;
  coverImageUrl: string | null;
  rating: number;
};

const FALLBACK_COVER =
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=800&q=80";

const FALLBACK_ACHIEVEMENTS = [
  { id: "guide", name: "名誉案内人", tone: "featured" as const },
  { id: "story", name: "ストーリーテラー", tone: "normal" as const },
  { id: "reader", name: "読書家", tone: "normal" as const },
];

const formatCompactNumber = (value: number) => {
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${value}`;
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "日付不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日付不明";
  return date.toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" });
};

const formatDuration = (seconds: number | null | undefined) => {
  if (!seconds || seconds <= 0) return "-";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}分`;
  const hour = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return `${hour}時間${remain}分`;
};

const createHandle = (name: string | null | undefined, userId: string) => {
  const base = (name || "traveler")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_\-.ぁ-んァ-ヶ一-龠]/g, "");
  if (base.length > 0) return `@${base}`;
  return `@user_${userId.slice(0, 6)}`;
};

export const ProfileScreen = ({}: Props) => {
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { userId, loading: authLoading } = useSessionUserId();

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<"publish" | "logout" | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [allSeries, setAllSeries] = useState<SeriesOption[]>([]);
  const [timelineRows, setTimelineRows] = useState<TimelineRow[]>([]);
  const [likedQuests, setLikedQuests] = useState<LikedQuestRow[]>([]);
  const [achievements, setAchievements] = useState<AchievementRow[]>([]);
  const [ratingMap, setRatingMap] = useState<Record<string, number>>({});
  const [playCountMap, setPlayCountMap] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<ProfileTab>("series");

  const refresh = useCallback(async () => {
    if (!userId || !isSupabaseConfigured) {
      setProfile(null);
      setFollowers(0);
      setFollowing(0);
      setAllSeries([]);
      setTimelineRows([]);
      setLikedQuests([]);
      setAchievements([]);
      setRatingMap({});
      setPlayCountMap({});
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [profileRow, counts, seriesRows, achievementRows] = await Promise.all([
        fetchUserProfile(userId),
        fetchFollowCounts(userId),
        fetchMySeriesOptions(userId, 120),
        fetchUserAchievements(userId),
      ]);

      setProfile(profileRow);
      setFollowers(counts.followers);
      setFollowing(counts.following);
      setAllSeries(seriesRows);
      setAchievements(achievementRows);

      const publishedSeriesIds = seriesRows
        .filter((row) => !row.status || row.status === "published")
        .map((row) => row.id);

      if (publishedSeriesIds.length > 0) {
        const stats = await fetchQuestSocialStats(publishedSeriesIds);
        setRatingMap(stats.ratingByQuestId);
        setPlayCountMap(stats.playCountByQuestId);
      } else {
        setRatingMap({});
        setPlayCountMap({});
      }

      const supabase = getSupabaseOrThrow();

      try {
        const { data: sessionsData, error: sessionsError } = await supabase
          .from("play_sessions")
          .select("id, quest_id, ended_at, duration_sec, wrong_answers, hints_used")
          .eq("user_id", userId)
          .order("ended_at", { ascending: false })
          .limit(24);

        if (sessionsError) {
          console.warn("ProfileScreen: failed to fetch timeline", sessionsError);
          setTimelineRows([]);
        } else {
          const sessionRows =
            (sessionsData || []) as Array<{
              id: string;
              quest_id: string | null;
              ended_at: string | null;
              duration_sec: number | null;
              wrong_answers: number | null;
              hints_used: number | null;
            }>;

          const questIds = Array.from(new Set(sessionRows.map((row) => row.quest_id).filter(Boolean))) as string[];
          let questMap = new Map<string, string>();

          if (questIds.length > 0) {
            const { data: questsData, error: questsError } = await supabase
              .from("quests")
              .select("id, title")
              .in("id", questIds);

            if (!questsError) {
              questMap = new Map(
                ((questsData || []) as Array<{ id: string; title: string | null }>).map((row) => [
                  row.id,
                  row.title || "クエスト",
                ])
              );
            }
          }

          const nextTimeline = sessionRows
            .filter((row) => row.quest_id)
            .map((row) => ({
              id: row.id,
              questId: row.quest_id || "",
              questTitle: (row.quest_id && questMap.get(row.quest_id)) || "クエスト",
              endedAt: row.ended_at,
              durationSec: row.duration_sec,
              wrongAnswers: row.wrong_answers,
              hintsUsed: row.hints_used,
            }))
            .slice(0, 20);

          setTimelineRows(nextTimeline);
        }
      } catch (error) {
        console.warn("ProfileScreen: timeline fallback", error);
        setTimelineRows([]);
      }

      try {
        const { data: reviewsData, error: reviewsError } = await supabase
          .from("quest_reviews")
          .select("quest_id, rating")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(80);

        if (reviewsError) {
          console.warn("ProfileScreen: failed to fetch likes", reviewsError);
          setLikedQuests([]);
        } else {
          const reviews =
            (reviewsData || []) as Array<{
              quest_id: string | null;
              rating: number | null;
            }>;

          const questIdSet = new Set<string>();
          reviews.forEach((review) => {
            if (review.quest_id && typeof review.rating === "number") {
              questIdSet.add(review.quest_id);
            }
          });

          const questIds = Array.from(questIdSet);
          if (questIds.length === 0) {
            setLikedQuests([]);
          } else {
            const { data: questsData, error: questsError } = await supabase
              .from("quests")
              .select("id, title, area_name, cover_image_url")
              .in("id", questIds);

            if (questsError) {
              console.warn("ProfileScreen: failed to fetch liked quests", questsError);
              setLikedQuests([]);
            } else {
              const questMap = new Map(
                ((questsData || []) as Array<{
                  id: string;
                  title: string | null;
                  area_name: string | null;
                  cover_image_url: string | null;
                }>).map((quest) => [quest.id, quest])
              );

              const rows: LikedQuestRow[] = reviews
                .filter((review) => review.quest_id && typeof review.rating === "number")
                .map((review) => {
                  const quest = review.quest_id ? questMap.get(review.quest_id) : undefined;
                  return {
                    questId: review.quest_id || "",
                    title: quest?.title || "タイトル未設定",
                    area: quest?.area_name || null,
                    coverImageUrl: quest?.cover_image_url || null,
                    rating: review.rating || 0,
                  } satisfies LikedQuestRow;
                })
                .filter((item, index, array) => array.findIndex((row) => row.questId === item.questId) === index)
                .slice(0, 30);

              setLikedQuests(rows);
            }
          }
        }
      } catch (error) {
        console.warn("ProfileScreen: likes fallback", error);
        setLikedQuests([]);
      }
    } catch (error) {
      console.error("ProfileScreen: failed to fetch profile", error);
      Alert.alert("読み込みに失敗しました", "時間をおいて再度お試しください。");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const displayName = useMemo(() => profile?.name || "旅人", [profile?.name]);
  const displayBio = useMemo(
    () => profile?.bio || "日常の中にある小さな奇跡を探しています。あなたの次の冒険を書き残しましょう。",
    [profile?.bio]
  );
  const handle = useMemo(() => (userId ? createHandle(profile?.name || null, userId) : "@guest"), [profile?.name, userId]);

  const badgeItems = useMemo(() => {
    if (achievements.length > 0) {
      return achievements.map((item, index) => ({
        id: item.id,
        name: item.name,
        tone: index === 0 ? ("featured" as const) : ("normal" as const),
      }));
    }
    return FALLBACK_ACHIEVEMENTS;
  }, [achievements]);

  const publishedSeries = useMemo(
    () => allSeries.filter((series) => !series.status || series.status === "published"),
    [allSeries]
  );
  const draftSeries = useMemo(
    () => allSeries.filter((series) => series.status && series.status !== "published"),
    [allSeries]
  );

  const tabs: Array<{ key: ProfileTab; label: string; badge?: number }> = [
    { key: "series", label: "シリーズ" },
    { key: "timeline", label: "タイムライン" },
    { key: "likes", label: "いいね" },
    { key: "drafts", label: "下書き", badge: draftSeries.length },
  ];

  const handlePublishDraft = async (questId: string) => {
    if (!userId || actionLoading) return;

    setActionLoading("publish");
    try {
      const supabase = getSupabaseOrThrow();
      const { error } = await supabase
        .from("quests")
        .update({ status: "published" })
        .eq("id", questId)
        .eq("creator_id", userId);

      if (error) throw error;
      Alert.alert("公開しました", "シリーズを公開しました。");
      await refresh();
    } catch (error) {
      console.error("ProfileScreen: publish draft failed", error);
      Alert.alert("公開に失敗しました", "時間をおいて再度お試しください。");
    } finally {
      setActionLoading(null);
    }
  };

  const handleLogout = async () => {
    if (actionLoading) return;

    Alert.alert("ログアウト", "ログアウトしますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "ログアウト",
        style: "destructive",
        onPress: async () => {
          setActionLoading("logout");
          try {
            const supabase = getSupabaseOrThrow();
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
            rootNavigation.navigate("Auth");
          } catch (error) {
            console.error("ProfileScreen: sign out failed", error);
            Alert.alert("ログアウトに失敗しました", "時間をおいて再度お試しください。");
          } finally {
            setActionLoading(null);
          }
        },
      },
    ]);
  };

  const renderSeries = () => {
    if (publishedSeries.length === 0) {
      return (
        <View className="rounded-2xl border border-dashed border-[#E2DBD3] bg-white px-5 py-8 items-center">
          <Text className="text-sm text-[#6B6762] mb-3" style={{ fontFamily: fonts.bodyRegular }}>
            表示できるシリーズがありません
          </Text>
          <Pressable
            className="h-10 rounded-xl bg-[#EE8C2B] px-4 items-center justify-center"
            onPress={() => rootNavigation.navigate("MainTabs", { screen: "Search" })}
          >
            <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
              探索して追加する
            </Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View className="flex-row flex-wrap justify-between">
        {publishedSeries.map((item) => {
          const playCount = playCountMap[item.id] || 0;
          const averageRating = ratingMap[item.id];
          const statusText = playCount > 0 ? formatCompactNumber(playCount) : "NEW";

          return (
            <Pressable
              key={item.id}
              style={{ width: "48%", marginBottom: 16 }}
              onPress={() => rootNavigation.navigate("SeriesDetail", { questId: item.id })}
            >
              <View className="relative rounded-xl overflow-hidden mb-2.5 bg-[#E3D6C9]" style={{ aspectRatio: 3 / 4 }}>
                <Image
                  source={{ uri: item.coverImageUrl || FALLBACK_COVER }}
                  className="absolute inset-0 w-full h-full"
                  resizeMode="cover"
                />
                <View className="absolute inset-0 bg-black/20" />

                <View className="absolute top-2 right-2 bg-black/60 rounded-full px-2 py-0.5 flex-row items-center gap-1">
                  <Ionicons name="eye-outline" size={10} color="#FFFFFF" />
                  <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                    {statusText}
                  </Text>
                </View>

                {typeof averageRating === "number" ? (
                  <View className="absolute bottom-2 left-2 bg-black/55 rounded-full px-2 py-0.5 flex-row items-center gap-1">
                    <Ionicons name="star" size={10} color="#FCD34D" />
                    <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                      {averageRating.toFixed(1)}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text className="text-sm text-[#2B1E16] mb-1 leading-5" numberOfLines={2} style={{ fontFamily: fonts.displayBold }}>
                {item.title || "タイトル未設定"}
              </Text>

              <Text className="text-xs text-[#7A6652]" numberOfLines={1} style={{ fontFamily: fonts.bodyRegular }}>
                {item.description || item.areaName || "新しい物語が公開されています"}
              </Text>
            </Pressable>
          );
        })}

        <Pressable
          style={{ width: "48%", marginBottom: 16 }}
          onPress={() => rootNavigation.navigate("MainTabs", { screen: "Search" })}
        >
          <View className="rounded-xl border-2 border-dashed border-[#CFC8C0] bg-[#F6F2EE]" style={{ aspectRatio: 3 / 4 }}>
            <View className="flex-1 items-center justify-center">
              <Ionicons name="add-circle-outline" size={28} color="#9B938B" />
              <Text className="text-xs text-[#8C847B] mt-2" style={{ fontFamily: fonts.displayBold }}>
                新しいシリーズ
              </Text>
            </View>
          </View>
        </Pressable>
      </View>
    );
  };

  const renderTimeline = () => {
    if (timelineRows.length === 0) {
      return (
        <View className="rounded-2xl border border-dashed border-[#E2DBD3] bg-white px-5 py-8 items-center">
          <Text className="text-sm text-[#6B6762] mb-2" style={{ fontFamily: fonts.bodyRegular }}>
            まだタイムラインはありません
          </Text>
          <Text className="text-xs text-[#8E8984]" style={{ fontFamily: fonts.bodyRegular }}>
            クエストをプレイすると履歴がここに表示されます。
          </Text>
        </View>
      );
    }

    return (
      <View className="gap-3">
        {timelineRows.map((session) => (
          <View key={session.id} className="rounded-2xl border border-[#ECE6DF] bg-white px-4 py-3">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1 min-w-0">
                <Text className="text-sm text-[#221910]" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
                  {session.questTitle}
                </Text>
                <Text className="text-xs text-[#6B6762] mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                  {formatDate(session.endedAt)}
                </Text>
              </View>

              <View className="rounded-full bg-[#F1ECE6] px-2 py-1 flex-row items-center gap-1">
                <Ionicons name="time-outline" size={11} color="#6B6762" />
                <Text className="text-[10px] text-[#6B6762]" style={{ fontFamily: fonts.displayBold }}>
                  {formatDuration(session.durationSec)}
                </Text>
              </View>
            </View>

            <View className="flex-row items-center gap-3 mt-3">
              <Text className="text-xs text-[#8E8984]" style={{ fontFamily: fonts.bodyRegular }}>
                ミス: {session.wrongAnswers || 0}
              </Text>
              <Text className="text-xs text-[#8E8984]" style={{ fontFamily: fonts.bodyRegular }}>
                ヒント: {session.hintsUsed || 0}
              </Text>
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderLikes = () => {
    if (likedQuests.length === 0) {
      return (
        <View className="rounded-2xl border border-dashed border-[#E2DBD3] bg-white px-5 py-8 items-center">
          <Text className="text-sm text-[#6B6762] mb-2" style={{ fontFamily: fonts.bodyRegular }}>
            まだ「いいね」した作品はありません
          </Text>
          <Text className="text-xs text-[#8E8984]" style={{ fontFamily: fonts.bodyRegular }}>
            レビューを投稿するとここから見返せます。
          </Text>
        </View>
      );
    }

    return (
      <View className="gap-3">
        {likedQuests.map((quest) => (
          <Pressable
            key={quest.questId}
            className="rounded-2xl border border-[#ECE6DF] bg-white px-4 py-3"
            onPress={() => rootNavigation.navigate("SeriesDetail", { questId: quest.questId })}
          >
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1 min-w-0">
                <Text className="text-sm text-[#221910]" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
                  {quest.title}
                </Text>
                <Text className="text-xs text-[#6B6762] mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                  {quest.area || "エリア未設定"}
                </Text>
              </View>

              <View className="rounded-full bg-[#FDF2E4] px-2 py-1 flex-row items-center gap-1">
                <Ionicons name="heart" size={11} color="#EE8C2B" />
                <Text className="text-xs text-[#EE8C2B]" style={{ fontFamily: fonts.displayBold }}>
                  {quest.rating.toFixed(1)}
                </Text>
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    );
  };

  const renderDrafts = () => {
    if (draftSeries.length === 0) {
      return (
        <View className="rounded-2xl border border-dashed border-[#E2DBD3] bg-white px-5 py-8 items-center">
          <Text className="text-sm text-[#6B6762] mb-2" style={{ fontFamily: fonts.bodyRegular }}>
            下書きはありません
          </Text>
          <Text className="text-xs text-[#8E8984]" style={{ fontFamily: fonts.bodyRegular }}>
            作成中のクエストがあるとここに表示されます。
          </Text>
        </View>
      );
    }

    return (
      <View className="gap-3">
        {draftSeries.map((quest) => (
          <Pressable
            key={quest.id}
            className="rounded-2xl border border-[#ECE6DF] bg-white px-4 py-3"
            onPress={() => rootNavigation.navigate("SeriesDetail", { questId: quest.id })}
          >
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1 min-w-0">
                <Text className="text-sm text-[#221910]" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
                  {quest.title}
                </Text>
                <Text className="text-xs text-[#6B6762] mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                  {quest.areaName || "エリア未設定"}
                </Text>
              </View>

              <Pressable
                className="h-8 rounded-lg bg-[#EE8C2B] px-3 items-center justify-center"
                onPress={(event) => {
                  event.stopPropagation();
                  void handlePublishDraft(quest.id);
                }}
                disabled={actionLoading === "publish"}
              >
                {actionLoading === "publish" ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text className="text-xs text-white" style={{ fontFamily: fonts.displayBold }}>
                    公開
                  </Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        ))}
      </View>
    );
  };

  const renderActiveContent = () => {
    if (activeTab === "series") return renderSeries();
    if (activeTab === "timeline") return renderTimeline();
    if (activeTab === "likes") return renderLikes();
    return renderDrafts();
  };

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
      <SafeAreaView edges={["top"]} className="flex-1 bg-[#F8F7F6]">
        <View className="px-6 pt-10">
          <Text className="text-xl text-[#221910] mb-2" style={{ fontFamily: fonts.displayBold }}>
            ログインが必要です
          </Text>
          <Text className="text-sm text-[#6C5647]" style={{ fontFamily: fonts.bodyRegular }}>
            マイプロフィールとフォロー情報を表示するにはログインしてください。
          </Text>

          <Pressable
            className="h-11 rounded-xl bg-[#EE8C2B] mt-5 items-center justify-center"
            onPress={() => rootNavigation.navigate("Auth")}
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
    <View className="flex-1 bg-[#F8F7F6]">
      <SafeAreaView edges={["top"]} className="bg-[#F8F7F6]">
        <View className="h-14 px-4 border-b border-[#ECE6DF] flex-row items-center justify-between">
          <Pressable
            className="w-9 h-9 rounded-full items-center justify-center"
            onPress={() => Alert.alert("準備中", "QR機能は近日追加予定です")}
          >
            <Ionicons name="qr-code-outline" size={20} color="#6B6762" />
          </Pressable>

          <Text className="text-base text-[#3D2E1F]" style={{ fontFamily: fonts.displayBold }}>
            {handle}
          </Text>

          <Pressable
            className="w-9 h-9 rounded-full items-center justify-center"
            onPress={() => rootNavigation.navigate("Settings")}
          >
            <Ionicons name="menu" size={20} color="#6B6762" />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120 }}
        stickyHeaderIndices={[2]}
        showsVerticalScrollIndicator={false}
      >
        <View className="px-5 pt-6 pb-2 items-center">
          <View
            className="w-28 h-28 rounded-full overflow-hidden border-4 border-white shadow-md bg-[#E6E1DB]"
            style={{
              shadowColor: "#000000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.12,
              shadowRadius: 10,
              elevation: 3,
            }}
          >
            <ProfileAvatar
              name={displayName}
              imageUrl={profile?.profile_picture_url || null}
              size={112}
              showBorder={false}
            />
          </View>

          <Text className="text-[28px] text-[#221910] mt-4" style={{ fontFamily: fonts.displayExtraBold }}>
            {displayName}
          </Text>
          <Text
            className="text-sm text-[#6C5647] mt-2 text-center leading-6 px-4 max-w-[300px]"
            style={{ fontFamily: fonts.bodyRegular }}
          >
            {displayBio}
          </Text>

          <View className="flex-row items-center mt-5 mb-6">
            <Pressable
              className="items-center px-4"
              onPress={() => rootNavigation.navigate("UserConnections", { userId, tab: "followers" })}
            >
              <Text className="text-xl text-[#221910]" style={{ fontFamily: fonts.displayExtraBold }}>
                {formatCompactNumber(followers)}
              </Text>
              <Text className="text-xs text-[#6C5647]" style={{ fontFamily: fonts.bodyRegular }}>
                フォロワー
              </Text>
            </Pressable>

            <View className="w-px h-8 bg-[#E7D9C7]" />

            <Pressable
              className="items-center px-4"
              onPress={() => rootNavigation.navigate("UserConnections", { userId, tab: "following" })}
            >
              <Text className="text-xl text-[#221910]" style={{ fontFamily: fonts.displayExtraBold }}>
                {formatCompactNumber(following)}
              </Text>
              <Text className="text-xs text-[#6C5647]" style={{ fontFamily: fonts.bodyRegular }}>
                フォロー中
              </Text>
            </Pressable>

            <View className="w-px h-8 bg-[#E7D9C7]" />

            <View className="items-center px-4">
              <Text className="text-xl text-[#221910]" style={{ fontFamily: fonts.displayExtraBold }}>
                {formatCompactNumber(allSeries.length)}
              </Text>
              <Text className="text-xs text-[#6C5647]" style={{ fontFamily: fonts.bodyRegular }}>
                作品数
              </Text>
            </View>
          </View>

          <View className="flex-row gap-3 w-full max-w-xs">
            <Pressable
              className="flex-1 h-11 rounded-xl bg-[#EE8C2B] items-center justify-center flex-row gap-2"
              onPress={() => rootNavigation.navigate("ProfileEdit")}
              style={{
                shadowColor: "#EE8C2B",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.25,
                shadowRadius: 8,
                elevation: 2,
              }}
            >
              <Ionicons name="create-outline" size={16} color="#FFFFFF" />
              <Text className="text-white text-sm" style={{ fontFamily: fonts.displayBold }}>
                プロフィールを編集
              </Text>
            </Pressable>

            <Pressable
              className="h-11 w-11 rounded-xl border border-[#DDD5CC] bg-white items-center justify-center"
              onPress={() => rootNavigation.navigate("Settings")}
            >
              <Ionicons name="settings-outline" size={16} color="#6C5647" />
            </Pressable>
          </View>
        </View>

        <View className="mt-4 pb-6 border-b border-[#EFE2D6]">
          <View className="px-5 mb-3 flex-row items-center justify-between">
            <Text className="text-sm text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
              獲得称号
            </Text>
            <Text className="text-xs text-[#EE8C2B]" style={{ fontFamily: fonts.displayBold }}>
              すべて見る
            </Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 4, gap: 10 }}
          >
            {badgeItems.map((badge) => (
              <View
                key={badge.id}
                className={`rounded-full border flex-row items-center gap-2 py-1.5 pl-2 pr-4 ${
                  badge.tone === "featured" ? "bg-[#FFF1DE] border-[#F4D6AE]" : "bg-[#F3ECE4] border-[#EADFCF]"
                }`}
              >
                <View
                  className={`w-6 h-6 rounded-full items-center justify-center ${
                    badge.tone === "featured" ? "bg-[#EE8C2B]/20" : "bg-[#DED1BF]"
                  }`}
                >
                  <Ionicons
                    name="book-outline"
                    size={12}
                    color={badge.tone === "featured" ? "#EE8C2B" : "#8F7A64"}
                  />
                </View>
                <Text className="text-xs text-[#5F4A38]" style={{ fontFamily: fonts.displayBold }}>
                  {badge.name}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <View className="pt-2 bg-[#F8F7F6]">
          <View className="flex-row border-b border-[#E7D9C7]">
            {tabs.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <Pressable
                  key={tab.key}
                  className={`flex-1 pb-3 items-center border-b-2 ${active ? "border-[#EE8C2B]" : "border-transparent"}`}
                  onPress={() => setActiveTab(tab.key)}
                >
                  <View className="flex-row items-center gap-1">
                    <Text
                      className={`text-sm ${active ? "text-[#EE8C2B]" : "text-[#6C5647]"}`}
                      style={{ fontFamily: active ? fonts.displayBold : fonts.bodyMedium }}
                    >
                      {tab.label}
                    </Text>
                    {typeof tab.badge === "number" && tab.badge > 0 ? (
                      <View className="px-1.5 py-0.5 rounded-full bg-[#E6DED5]">
                        <Text className="text-[10px] text-[#6B6762]" style={{ fontFamily: fonts.displayBold }}>
                          {tab.badge}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="px-5 pt-5">
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-lg text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
              {activeTab === "series" && "公開シリーズ"}
              {activeTab === "timeline" && "最近のタイムライン"}
              {activeTab === "likes" && "お気に入り"}
              {activeTab === "drafts" && "下書き"}
            </Text>
          </View>

          {renderActiveContent()}

          <View className="pt-8">
            <Pressable className="h-11 rounded-xl items-center justify-center" onPress={handleLogout}>
              <View className="flex-row items-center gap-2">
                {actionLoading === "logout" ? (
                  <ActivityIndicator size="small" color="#8E8984" />
                ) : (
                  <Ionicons name="log-out-outline" size={16} color="#8E8984" />
                )}
                <Text className="text-sm text-[#8E8984]" style={{ fontFamily: fonts.displayBold }}>
                  ログアウト
                </Text>
              </View>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};
