import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { MainTabParamList, RootStackParamList } from "@/navigation/types";
import { fonts } from "@/theme/fonts";
import { formatProfileHandle } from "@/lib/profileHandle";
import { useSessionUserId } from "@/hooks/useSessionUser";
import { useFriendshipsRealtime } from "@/hooks/useFriendshipsRealtime";
import {
  fetchFollowCounts,
  fetchQuestSocialStats,
  fetchUserProfile,
} from "@/services/social";
import type { ProfileRow } from "@/types/social";
import { ProfileAvatar } from "@/components/common/ProfileAvatar";
import { getSupabaseOrThrow, isSupabaseConfigured } from "@/lib/supabase";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import { deleteSeriesDraft, fetchMySeriesOptions, type SeriesOption } from "@/services/quests";

type Props = BottomTabScreenProps<MainTabParamList, "Profile">;
type ProfileTab = "series" | "timeline" | "likes";
type SeriesVisibility = "private" | "public";

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

export const ProfileScreen = ({}: Props) => {
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { userId, loading: authLoading } = useSessionUserId();

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<"publish" | "delete" | "logout" | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [allSeries, setAllSeries] = useState<SeriesOption[]>([]);
  const [timelineRows, setTimelineRows] = useState<TimelineRow[]>([]);
  const [likedQuests, setLikedQuests] = useState<LikedQuestRow[]>([]);
  const [ratingMap, setRatingMap] = useState<Record<string, number>>({});
  const [playCountMap, setPlayCountMap] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<ProfileTab>("series");
  const [seriesVisibility, setSeriesVisibility] = useState<SeriesVisibility>("private");

  const refresh = useCallback(async () => {
    if (!userId || !isSupabaseConfigured) {
      setProfile(null);
      setFollowers(0);
      setFollowing(0);
      setAllSeries([]);
      setTimelineRows([]);
      setLikedQuests([]);
      setRatingMap({});
      setPlayCountMap({});
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [profileRow, counts, seriesRows] = await Promise.all([
        fetchUserProfile(userId),
        fetchFollowCounts(userId),
        fetchMySeriesOptions(userId, 120),
      ]);

      setProfile(profileRow);
      setFollowers(counts.followers);
      setFollowing(counts.following);
      setAllSeries(seriesRows);

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

  useFriendshipsRealtime([userId], refresh);

  const displayName = useMemo(() => profile?.name || "旅人", [profile?.name]);
  const displayBio = useMemo(
    () => profile?.bio || "日常の中にある小さな奇跡を探しています。あなたの次の冒険を書き残しましょう。",
    [profile?.bio]
  );
  const handle = useMemo(
    () => (userId ? formatProfileHandle(profile?.handle || null, profile?.name || null, userId) : "@guest"),
    [profile?.handle, profile?.name, userId]
  );

  const publishedSeries = useMemo(
    () => allSeries.filter((series) => !series.status || series.status === "published"),
    [allSeries]
  );
  const privateSeries = useMemo(
    () => allSeries.filter((series) => series.status && series.status !== "published"),
    [allSeries]
  );

  const tabs: Array<{ key: ProfileTab; label: string }> = [
    { key: "series", label: "シリーズ" },
    { key: "timeline", label: "タイムライン" },
    { key: "likes", label: "いいね" },
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

  const runDeleteDraft = async (questId: string) => {
    if (!userId || actionLoading) return;

    setActionLoading("delete");
    try {
      await deleteSeriesDraft({ questId, userId });
      if (Platform.OS === "web" && typeof globalThis.alert === "function") {
        globalThis.alert("下書きを消去しました。");
      } else {
        Alert.alert("消去しました", "下書きを消去しました。");
      }
      await refresh();
    } catch (error) {
      console.error("ProfileScreen: delete draft failed", error);
      if (Platform.OS === "web" && typeof globalThis.alert === "function") {
        globalThis.alert("下書きの消去に失敗しました。時間をおいて再度お試しください。");
      } else {
        Alert.alert("消去に失敗しました", "時間をおいて再度お試しください。");
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteDraft = (questId: string) => {
    if (!userId || actionLoading) return;

    if (Platform.OS === "web") {
      const shouldDelete =
        typeof globalThis.confirm === "function"
          ? globalThis.confirm("この下書きを消去しますか？")
          : true;
      if (!shouldDelete) return;
      void runDeleteDraft(questId);
      return;
    }

    Alert.alert("下書きを消去", "この下書きを消去しますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "消去",
        style: "destructive",
        onPress: () => {
          void runDeleteDraft(questId);
        },
      },
    ]);
  };

  const runLogout = async () => {
    if (actionLoading) return;

    setActionLoading("logout");
    try {
      const supabase = getSupabaseOrThrow();
      const { error } = await supabase.auth.signOut();
      const canIgnoreSignOutError =
        typeof error?.message === "string" && /auth session missing/i.test(error.message);

      if (error && !canIgnoreSignOutError) throw error;
      rootNavigation.reset({
        index: 0,
        routes: [{ name: "MainTabs", params: { screen: "Profile" } }],
      });
    } catch (error) {
      console.error("ProfileScreen: sign out failed", error);
      if (Platform.OS === "web" && typeof globalThis.alert === "function") {
        globalThis.alert("ログアウトに失敗しました。時間をおいて再度お試しください。");
      } else {
        Alert.alert("ログアウトに失敗しました", "時間をおいて再度お試しください。");
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleLogout = () => {
    if (actionLoading) return;

    if (Platform.OS === "web") {
      const shouldLogout =
        typeof globalThis.confirm === "function" ? globalThis.confirm("ログアウトしますか？") : true;
      if (!shouldLogout) return;
      void runLogout();
      return;
    }

    Alert.alert("ログアウト", "ログアウトしますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "ログアウト",
        style: "destructive",
        onPress: () => {
          void runLogout();
        },
      },
    ]);
  };

  const renderSeries = () => {
    const isPublicView = seriesVisibility === "public";
    const seriesItems = isPublicView ? publishedSeries : privateSeries;

    if (seriesItems.length === 0) {
      return (
        <View className="rounded-2xl border border-dashed border-[#E2DBD3] bg-white px-5 py-8 items-center">
          <Text className="text-sm text-[#6B6762] mb-3" style={{ fontFamily: fonts.bodyRegular }}>
            {isPublicView ? "公開しているシリーズはありません" : "非公開のシリーズはありません"}
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
        {seriesItems.map((item) => {
          const playCount = playCountMap[item.id] || 0;
          const averageRating = ratingMap[item.id];
          const statusText = isPublicView ? (playCount > 0 ? formatCompactNumber(playCount) : "NEW") : "非公開";

          return (
            <View key={item.id} style={{ width: "48%", marginBottom: 16 }}>
              <Pressable onPress={() => rootNavigation.navigate("SeriesDetail", { questId: item.id })}>
                <View
                  className="relative rounded-xl overflow-hidden mb-2.5 bg-[#E3D6C9]"
                  style={{ aspectRatio: 3 / 4 }}
                >
                  <Image
                    source={{ uri: item.coverImageUrl || FALLBACK_COVER }}
                    className="absolute inset-0 w-full h-full"
                    resizeMode="cover"
                  />
                  <View className="absolute inset-0 bg-black/20" />

                  <View className="absolute top-2 right-2 bg-black/60 rounded-full px-2 py-0.5 flex-row items-center gap-1">
                    <Ionicons
                      name={isPublicView ? "eye-outline" : "lock-closed-outline"}
                      size={10}
                      color="#FFFFFF"
                    />
                    <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                      {statusText}
                    </Text>
                  </View>

                  {isPublicView && typeof averageRating === "number" ? (
                    <View className="absolute bottom-2 left-2 bg-black/55 rounded-full px-2 py-0.5 flex-row items-center gap-1">
                      <Ionicons name="star" size={10} color="#FCD34D" />
                      <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                        {averageRating.toFixed(1)}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <Text
                  className="text-sm text-[#2B1E16] mb-1 leading-5"
                  numberOfLines={2}
                  style={{ fontFamily: fonts.displayBold }}
                >
                  {item.title || "タイトル未設定"}
                </Text>

                <Text className="text-xs text-[#7A6652]" numberOfLines={1} style={{ fontFamily: fonts.bodyRegular }}>
                  {item.description || item.areaName || (isPublicView ? "新しい物語が公開されています" : "まだ公開していないシリーズです")}
                </Text>
              </Pressable>

              {!isPublicView ? (
                <View className="flex-row items-center gap-2 mt-3">
                  <Pressable
                    className="flex-1 h-8 rounded-lg border border-[#D8CFC6] bg-white items-center justify-center"
                    onPress={() => {
                      handleDeleteDraft(item.id);
                    }}
                    disabled={Boolean(actionLoading)}
                  >
                    {actionLoading === "delete" ? (
                      <ActivityIndicator size="small" color="#9A4236" />
                    ) : (
                      <Text className="text-xs text-[#9A4236]" style={{ fontFamily: fonts.displayBold }}>
                        消去
                      </Text>
                    )}
                  </Pressable>

                  <Pressable
                    className="flex-1 h-8 rounded-lg bg-[#EE8C2B] items-center justify-center"
                    onPress={() => {
                      void handlePublishDraft(item.id);
                    }}
                    disabled={Boolean(actionLoading)}
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
              ) : null}
            </View>
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

  const renderActiveContent = () => {
    if (activeTab === "series") return renderSeries();
    if (activeTab === "timeline") return renderTimeline();
    return renderLikes();
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
        <View className="h-14 px-4 border-b border-[#ECE6DF] flex-row items-center justify-center">
          <Text className="text-base text-[#3D2E1F]" style={{ fontFamily: fonts.displayBold }}>
            プロフィール
          </Text>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 20,
            paddingTop: 28,
            paddingBottom: 32,
            justifyContent: "center",
          }}
          showsVerticalScrollIndicator={false}
        >
          <View className="items-center">
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
                name="ゲスト"
                imageUrl={null}
                size={112}
                showBorder={false}
              />
            </View>

            <Text className="text-[28px] text-[#221910] mt-4" style={{ fontFamily: fonts.displayExtraBold }}>
              ゲスト
            </Text>
            <Text
              className="text-sm text-[#6C5647] mt-2 text-center leading-6 max-w-[320px]"
              style={{ fontFamily: fonts.bodyRegular }}
            >
              ホームや検索はそのまま使えます。ログインすると、プロフィール保存、作品管理、フォロー、プレイ履歴が使えるようになります。
            </Text>

            <View className="flex-row gap-3 w-full mt-6">
              <Pressable
                className="flex-1 h-12 rounded-xl bg-[#EE8C2B] items-center justify-center"
                onPress={() => rootNavigation.navigate("Auth")}
              >
                <Text className="text-white text-sm" style={{ fontFamily: fonts.displayBold }}>
                  ログイン / 新規登録
                </Text>
              </Pressable>

              <Pressable
                className="flex-1 h-12 rounded-xl border border-[#DDD5CC] bg-white items-center justify-center"
                onPress={() => rootNavigation.navigate("MainTabs", { screen: "Search" })}
              >
                <Text className="text-sm text-[#6C5647]" style={{ fontFamily: fonts.displayBold }}>
                  作品を探す
                </Text>
              </Pressable>
            </View>
          </View>

        </ScrollView>
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

          <View className="w-9 h-9" />
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

        <View className="mt-4 pt-2 bg-[#F8F7F6]">
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
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="px-5 pt-5">
          <View className="flex-row items-center justify-between mb-4">
            {activeTab === "series" ? (
              <View className="rounded-full bg-[#EFE7DE] p-1 flex-row">
                <Pressable
                  className={`h-9 px-5 rounded-full items-center justify-center ${
                    seriesVisibility === "private" ? "bg-[#221910]" : ""
                  }`}
                  onPress={() => setSeriesVisibility("private")}
                >
                  <Text
                    className={`text-sm ${seriesVisibility === "private" ? "text-white" : "text-[#6C5647]"}`}
                    style={{ fontFamily: fonts.displayBold }}
                  >
                    非公開
                  </Text>
                </Pressable>

                <Pressable
                  className={`h-9 px-5 rounded-full items-center justify-center ${
                    seriesVisibility === "public" ? "bg-[#EE8C2B]" : ""
                  }`}
                  onPress={() => setSeriesVisibility("public")}
                >
                  <Text
                    className={`text-sm ${seriesVisibility === "public" ? "text-white" : "text-[#6C5647]"}`}
                    style={{ fontFamily: fonts.displayBold }}
                  >
                    公開
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Text className="text-lg text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                {activeTab === "timeline" && "最近のタイムライン"}
                {activeTab === "likes" && "お気に入り"}
              </Text>
            )}
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
