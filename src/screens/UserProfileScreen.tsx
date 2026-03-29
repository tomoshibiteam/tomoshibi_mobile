import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackParamList } from "@/navigation/types";
import { TopBar } from "@/components/common/TopBar";
import { fonts } from "@/theme/fonts";
import { formatProfileHandle } from "@/lib/profileHandle";
import { useSessionUserId } from "@/hooks/useSessionUser";
import { useFriendshipsRealtime } from "@/hooks/useFriendshipsRealtime";
import {
  fetchFollowCounts,
  fetchQuestSocialStats,
  fetchUserAchievements,
  fetchUserProfile,
  fetchUserPublishedSeries,
  fetchViewerRelations,
  followUser,
  isMutualFollowBlockedError,
  isFollowingUser,
  unfollowByRelationId,
} from "@/services/social";
import type { AchievementRow, FriendshipRow, ProfileRow, UserSeriesRow } from "@/types/social";
import { ProfileAvatar } from "@/components/common/ProfileAvatar";

type Props = NativeStackScreenProps<RootStackParamList, "UserProfile">;
type ProfileTab = "series" | "timeline" | "likes";

const FALLBACK_COVER =
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=800&q=80";

const PROFILE_TABS: Array<{ key: ProfileTab; label: string }> = [
  { key: "series", label: "シリーズ" },
  { key: "timeline", label: "タイムライン" },
  { key: "likes", label: "いいね" },
];

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

export const UserProfileScreen = ({ navigation, route }: Props) => {
  const { userId: targetUserId } = route.params;
  const { userId: viewerUserId } = useSessionUserId();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [series, setSeries] = useState<UserSeriesRow[]>([]);
  const [achievements, setAchievements] = useState<AchievementRow[]>([]);
  const [ratingMap, setRatingMap] = useState<Record<string, number>>({});
  const [playCountMap, setPlayCountMap] = useState<Record<string, number>>({});
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [relation, setRelation] = useState<FriendshipRow | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>("series");

  const isSelf = viewerUserId === targetUserId;
  const isFollowing = useMemo(() => isFollowingUser(relation, viewerUserId), [relation, viewerUserId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [profileRow, counts, seriesRows, achievementRows] = await Promise.all([
        fetchUserProfile(targetUserId),
        fetchFollowCounts(targetUserId),
        fetchUserPublishedSeries(targetUserId),
        fetchUserAchievements(targetUserId),
      ]);

      setProfile(profileRow);
      setFollowers(counts.followers);
      setFollowing(counts.following);
      setSeries(seriesRows);
      setAchievements(achievementRows);

      if (seriesRows.length > 0) {
        const stats = await fetchQuestSocialStats(seriesRows.map((row) => row.id));
        setRatingMap(stats.ratingByQuestId);
        setPlayCountMap(stats.playCountByQuestId);
      } else {
        setRatingMap({});
        setPlayCountMap({});
      }

      if (viewerUserId && !isSelf) {
        const relationMap = await fetchViewerRelations(viewerUserId);
        setRelation(relationMap[targetUserId] || null);
      } else {
        setRelation(null);
      }
    } catch (error) {
      console.error("UserProfileScreen: failed to refresh", error);
      Alert.alert("プロフィールを読み込めません", "時間をおいて再度お試しください。");
    } finally {
      setLoading(false);
    }
  }, [targetUserId, viewerUserId, isSelf]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  useFriendshipsRealtime([targetUserId, viewerUserId], refresh);

  const displayName = profile?.name || "旅人";
  const displayBio = profile?.bio || "物語を紡ぎながら、新しい景色を探しています。";
  const handle = useMemo(
    () => formatProfileHandle(profile?.handle || null, profile?.name || null, targetUserId),
    [profile?.handle, profile?.name, targetUserId]
  );
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

  const handleToggleFollow = async () => {
    if (!viewerUserId) {
      navigation.navigate("Auth");
      return;
    }

    if (isSelf) {
      navigation.navigate("MainTabs", { screen: "Profile" });
      return;
    }

    setActionLoading(true);
    try {
      if (!isFollowing) {
        await followUser(viewerUserId, targetUserId);
      } else if (relation) {
        await unfollowByRelationId(relation.id);
      }
      await refresh();
    } catch (error) {
      console.error("UserProfileScreen: follow action failed", error);
      if (isMutualFollowBlockedError(error)) {
        Alert.alert("フォロー操作に失敗しました", "DB設定の制約により相互フォローが作成できません。");
        return;
      }
      Alert.alert("フォロー操作に失敗しました", "時間をおいて再度お試しください。");
    } finally {
      setActionLoading(false);
    }
  };

  const handleMessage = () => {
    Alert.alert("準備中", "メッセージ機能は次のフェーズで追加予定です。");
  };

  return (
    <View className="flex-1 bg-[#F8F7F6]">
      <TopBar title={handle} right={<Ionicons name="ellipsis-horizontal" size={18} color="#6C5647" />} />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#EE8C2B" />
        </View>
      ) : !profile ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-lg text-[#221910] mb-2" style={{ fontFamily: fonts.displayBold }}>
            ユーザーが見つかりません
          </Text>
          <Text className="text-sm text-[#6C5647] text-center" style={{ fontFamily: fonts.bodyRegular }}>
            URLが正しいか確認してください。
          </Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 120 }}
          stickyHeaderIndices={[2]}
          showsVerticalScrollIndicator={false}
        >
          <View className="px-5 pt-6 pb-2 items-center">
            <View className="relative mb-0">
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
                  imageUrl={profile.profile_picture_url}
                  size={112}
                  showBorder={false}
                />
              </View>
              <View className="absolute bottom-1 right-1 w-8 h-8 rounded-full border-2 border-white bg-[#EE8C2B] items-center justify-center">
                <Ionicons name="sparkles" size={14} color="#FFFFFF" />
              </View>
            </View>

            <Text className="text-[28px] text-[#221910] mt-4" style={{ fontFamily: fonts.displayExtraBold }}>
              {displayName}
            </Text>
            <Text
              className="text-sm text-[#6C5647] mt-2 text-center px-4 leading-6 max-w-[280px]"
              style={{ fontFamily: fonts.bodyRegular }}
            >
              {displayBio}
            </Text>

            <View className="flex-row items-center mt-5 mb-6">
              <Pressable
                className="items-center px-4"
                onPress={() => navigation.navigate("UserConnections", { userId: targetUserId, tab: "followers" })}
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
                onPress={() => navigation.navigate("UserConnections", { userId: targetUserId, tab: "following" })}
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
                  {formatCompactNumber(series.length)}
                </Text>
                <Text className="text-xs text-[#6C5647]" style={{ fontFamily: fonts.bodyRegular }}>
                  作品数
                </Text>
              </View>
            </View>

            <View className="flex-row gap-3 w-full max-w-xs">
              <Pressable
                className="flex-1 h-11 rounded-xl items-center justify-center flex-row gap-2 bg-[#EE8C2B]"
                onPress={() => {
                  void handleToggleFollow();
                }}
                disabled={actionLoading}
                style={{
                  shadowColor: "#EE8C2B",
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.25,
                  shadowRadius: 8,
                  elevation: 2,
                }}
              >
                {actionLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="person-add" size={16} color="#FFFFFF" />
                    <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                      {isSelf ? "マイプロフィール" : isFollowing ? "フォロー中" : "フォローする"}
                    </Text>
                  </>
                )}
              </Pressable>

              <Pressable
                className="h-11 w-11 rounded-xl border border-[#E3D6C9] bg-white items-center justify-center"
                onPress={handleMessage}
              >
                <Ionicons name="mail-outline" size={18} color="#6C5647" />
              </Pressable>
            </View>
          </View>

          <View className="mt-4 pb-6 border-b border-[#EFE2D6]">
            <View className="px-5 mb-3 flex-row items-center justify-between">
              <Text className="text-sm text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                獲得称号
              </Text>
              <Pressable
                onPress={() => {
                  Alert.alert("称号", "称号一覧画面は次フェーズで追加予定です。");
                }}
              >
                <Text className="text-xs text-[#EE8C2B]" style={{ fontFamily: fonts.displayBold }}>
                  すべて見る
                </Text>
              </Pressable>
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
              {PROFILE_TABS.map((tab) => {
                const active = activeTab === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    className={`flex-1 pb-3 items-center border-b-2 ${active ? "border-[#EE8C2B]" : "border-transparent"}`}
                    onPress={() => setActiveTab(tab.key)}
                  >
                    <Text
                      className={`text-sm ${active ? "text-[#EE8C2B]" : "text-[#6C5647]"}`}
                      style={{ fontFamily: active ? fonts.displayBold : fonts.bodyMedium }}
                    >
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View className="px-5 pt-5">
            {activeTab === "series" ? (
              <>
                <View className="flex-row items-center justify-between mb-4">
                  <Text className="text-lg text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                    公開シリーズ
                  </Text>
                  <Text className="text-xs text-[#7A6652]" style={{ fontFamily: fonts.bodyRegular }}>
                    {series.length}件
                  </Text>
                </View>

                {series.length === 0 ? (
                  <View className="rounded-3xl border border-dashed border-[#E7D9C7] bg-white/70 px-5 py-8">
                    <Text className="text-sm text-[#6C5647] text-center" style={{ fontFamily: fonts.bodyRegular }}>
                      まだ公開中のシリーズはありません。
                    </Text>
                  </View>
                ) : (
                  <View className="flex-row flex-wrap justify-between">
                    {series.map((item) => {
                      const playCount = playCountMap[item.id] || 0;
                      const averageRating = ratingMap[item.id];
                      const tags = (item.tags || []).slice(0, 2);

                      return (
                        <Pressable
                          key={item.id}
                          style={{ width: "48%", marginBottom: 16 }}
                          onPress={() => {
                            navigation.navigate("SeriesDetail", { questId: item.id });
                          }}
                        >
                          <View className="relative rounded-xl overflow-hidden mb-2.5 bg-[#E3D6C9]" style={{ aspectRatio: 3 / 4 }}>
                            <Image
                              source={{ uri: item.cover_image_url || FALLBACK_COVER }}
                              className="absolute inset-0 w-full h-full"
                              resizeMode="cover"
                            />
                            <View className="absolute inset-0 bg-black/20" />

                            <View className="absolute top-2 right-2 bg-black/60 rounded-full px-2 py-0.5 flex-row items-center gap-1">
                              <Ionicons name="eye-outline" size={10} color="#FFFFFF" />
                              <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                                {playCount > 0 ? formatCompactNumber(playCount) : "NEW"}
                              </Text>
                            </View>

                            {typeof averageRating === "number" && (
                              <View className="absolute bottom-2 left-2 bg-black/55 rounded-full px-2 py-0.5 flex-row items-center gap-1">
                                <Ionicons name="star" size={10} color="#FCD34D" />
                                <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                                  {averageRating.toFixed(1)}
                                </Text>
                              </View>
                            )}
                          </View>

                          <Text
                            className="text-sm text-[#2B1E16] mb-1 leading-5"
                            numberOfLines={2}
                            style={{ fontFamily: fonts.displayBold }}
                          >
                            {item.title || "タイトル未設定"}
                          </Text>

                          <Text
                            className="text-xs text-[#7A6652]"
                            numberOfLines={1}
                            style={{ fontFamily: fonts.bodyRegular }}
                          >
                            {item.description || item.area_name || "新しい物語が公開されています"}
                          </Text>

                          <View className="flex-row flex-wrap gap-1 mt-2">
                            {tags.length > 0 ? (
                              tags.map((tag) => (
                                <Text
                                  key={`${item.id}-${tag}`}
                                  className="text-[10px] bg-[#F2E7D8] text-[#7A6652] px-1.5 py-0.5 rounded"
                                  style={{ fontFamily: fonts.bodyRegular }}
                                >
                                  {tag}
                                </Text>
                              ))
                            ) : (
                              <Text
                                className="text-[10px] bg-[#F2E7D8] text-[#7A6652] px-1.5 py-0.5 rounded"
                                style={{ fontFamily: fonts.bodyRegular }}
                              >
                                ストーリー
                              </Text>
                            )}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </>
            ) : (
              <View className="rounded-3xl border border-[#EADFCF] bg-white/80 px-5 py-8 items-center">
                <View className="w-14 h-14 rounded-full bg-[#F6EBDD] border border-[#EADFCF] items-center justify-center mb-3">
                  <Ionicons
                    name={activeTab === "timeline" ? "time-outline" : "heart-outline"}
                    size={24}
                    color="#9B7753"
                  />
                </View>
                <Text className="text-sm text-[#3D2E1F] mb-1" style={{ fontFamily: fonts.displayBold }}>
                  {activeTab === "timeline" ? "タイムライン準備中" : "いいね一覧準備中"}
                </Text>
                <Text className="text-xs text-[#6C5647]" style={{ fontFamily: fonts.bodyRegular }}>
                  このタブは今後のアップデートで追加されます。
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
};
