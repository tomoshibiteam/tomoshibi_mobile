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
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { fonts } from "@/theme/fonts";
import type { RootStackParamList } from "@/navigation/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useSessionUserId } from "@/hooks/useSessionUser";
import { fetchViewerRelations } from "@/services/social";
import { fetchExplorePayload } from "@/services/feed";
import type { ExploreCreator, ExploreQuest } from "@/types/feed";

const HERO_FALLBACK =
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1200&q=80";

type FeedPost = {
  id: string;
  questId: string;
  authorId: string | null;
  authorName: string;
  authorAvatar: string | null;
  postedAt: string;
  questTitle: string;
  questImage: string;
  area: string;
  tags: string[];
};

const formatRelativeTime = (value?: string | null) => {
  if (!value) return "たった今";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "たった今";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}日前`;
  return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
};

const estimateDuration = (title: string) => `${Math.min(140, Math.max(35, title.length * 4))}分`;
const estimateDistance = (title: string) => `${Math.min(7, Math.max(1.2, title.length / 8)).toFixed(1)}km`;

const toFeedPost = (
  quest: ExploreQuest,
  creatorById: Record<string, ExploreCreator>
): FeedPost => {
  const creatorId = quest.creatorId || null;
  const creator = creatorId ? creatorById[creatorId] : undefined;

  return {
    id: quest.id,
    questId: quest.id,
    authorId: creatorId,
    authorName: quest.creatorName || creator?.name || "旅の案内人",
    authorAvatar: creator?.profilePictureUrl || null,
    postedAt: "たった今",
    questTitle: quest.title || "無題の物語",
    questImage: quest.coverImageUrl || HERO_FALLBACK,
    area: quest.areaName || "エリア未設定",
    tags: quest.areaName ? [quest.areaName] : ["最新ストーリー"],
  } satisfies FeedPost;
};

export const HomeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { userId } = useSessionUserId();

  const [loading, setLoading] = useState(true);
  const [quests, setQuests] = useState<ExploreQuest[]>([]);
  const [creatorById, setCreatorById] = useState<Record<string, ExploreCreator>>({});
  const [acceptedFriendIds, setAcceptedFriendIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const payload = await fetchExplorePayload(userId);
      setQuests(payload.quests);

      const creatorMap: Record<string, ExploreCreator> = {};
      [...payload.creators, ...payload.allCreators].forEach((creator) => {
        if (!creatorMap[creator.id]) {
          creatorMap[creator.id] = creator;
        }
      });
      setCreatorById(creatorMap);

      if (userId) {
        const relations = await fetchViewerRelations(userId);
        const friendIds = new Set(
          Object.entries(relations)
            .filter(([, relation]) => relation.status === "accepted")
            .map(([otherId]) => otherId)
        );
        setAcceptedFriendIds(friendIds);
      } else {
        setAcceptedFriendIds(new Set());
      }
    } catch (error) {
      console.error("HomeScreen: failed to refresh", error);
      Alert.alert("ホームを読み込めません", "時間をおいて再度お試しください。");
      setQuests([]);
      setCreatorById({});
      setAcceptedFriendIds(new Set());
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const forYouPosts = useMemo(() => quests.slice(0, 10).map((quest) => toFeedPost(quest, creatorById)), [quests, creatorById]);
  const explorePosts = useMemo(() => [...quests].reverse().slice(0, 10).map((quest) => toFeedPost(quest, creatorById)), [quests, creatorById]);
  const friendPosts = useMemo(
    () =>
      quests
        .filter((quest) => quest.creatorId && acceptedFriendIds.has(quest.creatorId))
        .slice(0, 10)
        .map((quest) => toFeedPost(quest, creatorById)),
    [quests, acceptedFriendIds, creatorById]
  );

  const homeHeroPost = useMemo(() => forYouPosts[0] || explorePosts[0] || null, [forYouPosts, explorePosts]);

  const recommendationPosts = useMemo(() => {
    const seen = new Set<string>();
    return [...explorePosts, ...forYouPosts].filter((post) => {
      if (seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    });
  }, [explorePosts, forYouPosts]);

  const homeFeedPosts = useMemo(() => {
    const seen = new Set<string>();
    return [...forYouPosts, ...friendPosts, ...explorePosts].filter((post) => {
      if (seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    });
  }, [forYouPosts, friendPosts, explorePosts]);

  const heroProgressValue = useMemo(() => {
    if (!homeHeroPost) return 65;
    return Math.min(92, Math.max(35, homeHeroPost.questTitle.length * 3));
  }, [homeHeroPost]);

  const handleOpenQuests = () => {
    navigation.navigate("MainTabs", { screen: "Search" });
  };

  const handleOpenCreator = (creatorId: string | null) => {
    if (!creatorId) return;
    if (creatorId === userId) {
      navigation.navigate("MainTabs", { screen: "Profile" });
      return;
    }
    navigation.navigate("UserProfile", { userId: creatorId });
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

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-[#F8F7F6]">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <View className="w-full" style={{ aspectRatio: 4 / 5 }}>
          <Image source={{ uri: homeHeroPost?.questImage || HERO_FALLBACK }} className="absolute inset-0 w-full h-full" resizeMode="cover" />
          <View className="absolute inset-0 bg-black/45" />
          <View className="absolute inset-x-0 bottom-0 h-52 bg-black/45" />

          <View className="absolute inset-x-0 top-0 px-5 pt-4 flex-row items-center justify-between">
            <Text className="text-xl text-white" style={{ fontFamily: fonts.displayBold }}>
              TOMOSHIBI
            </Text>

            <View className="flex-row items-center gap-3">
              <Pressable
                className="w-9 h-9 rounded-full bg-black/20 items-center justify-center"
                onPress={() => navigation.navigate("MainTabs", { screen: "Notifications" })}
              >
                <Ionicons name="notifications-outline" size={18} color="#FFFFFF" />
              </Pressable>
              <Pressable
                className="w-9 h-9 rounded-full bg-black/20 items-center justify-center"
                onPress={() => navigation.navigate("Settings")}
              >
                <Ionicons name="settings-outline" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>

          <View className="absolute inset-x-0 bottom-0 px-6 pb-8">
            <View className="flex-row items-center gap-2 mb-2">
              <View className="rounded px-2 py-0.5 bg-[#F29130]/90">
                <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                  CONTINUE
                </Text>
              </View>
              <Text className="text-xs text-slate-200" style={{ fontFamily: fonts.bodyMedium }}>
                最終プレイ: {homeHeroPost ? formatRelativeTime(homeHeroPost.postedAt) : "2時間前"}
              </Text>
            </View>

            <Text className="text-3xl text-white mb-1" numberOfLines={2} style={{ fontFamily: fonts.displayExtraBold }}>
              {homeHeroPost?.questTitle || "港の記憶"}
            </Text>
            <Text className="text-sm text-slate-200 mb-5" style={{ fontFamily: fonts.bodyMedium }}>
              {homeHeroPost?.area || "第2話：夕暮れの約束"}
            </Text>

            <View className="flex-row items-end justify-between gap-4">
              <View className="flex-1 pb-1.5">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-[10px] text-slate-300" style={{ fontFamily: fonts.bodyMedium }}>
                    Progress
                  </Text>
                  <Text className="text-[10px] text-slate-300" style={{ fontFamily: fonts.bodyMedium }}>
                    {heroProgressValue}%
                  </Text>
                </View>
                <View className="h-1 rounded-full bg-white/20 overflow-hidden">
                  <View className="h-full rounded-full bg-[#F29130]" style={{ width: `${heroProgressValue}%` }} />
                </View>
              </View>

              <Pressable
                className="h-11 rounded-full bg-white px-5 flex-row items-center justify-center gap-1"
                onPress={handleOpenQuests}
              >
                <Ionicons name="play" size={15} color="#111827" />
                <Text className="text-xs text-slate-900" style={{ fontFamily: fonts.displayBold }}>
                  再開
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View className="pt-8 pb-4">
          <View className="px-5 flex-row items-center justify-between mb-4">
            <Text className="text-lg text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
              あなたへのおすすめ
            </Text>
            <Pressable onPress={() => navigation.navigate("MainTabs", { screen: "Search" })}>
              <Text className="text-xs text-[#F29130]" style={{ fontFamily: fonts.displayBold }}>
                すべて見る
              </Text>
            </Pressable>
          </View>

          {loading ? (
            <View className="items-center py-6">
              <ActivityIndicator color="#EE8C2B" />
            </View>
          ) : recommendationPosts.length === 0 ? (
            <View className="mx-5 rounded-2xl border border-dashed border-[#E2DBD3] bg-white px-5 py-8 items-center">
              <Text className="text-sm text-[#6E6963]" style={{ fontFamily: fonts.bodyRegular }}>
                おすすめがまだありません
              </Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}>
              {recommendationPosts.map((post, index) => (
                <Pressable key={post.id} className="w-44" onPress={handleOpenQuests}>
                  <View className="relative rounded-2xl overflow-hidden mb-3" style={{ aspectRatio: 2 / 3 }}>
                    <Image source={{ uri: post.questImage }} className="w-full h-full" resizeMode="cover" />
                    <View className="absolute top-2 right-2 rounded-full px-2 py-1 bg-black/45 flex-row items-center gap-0.5">
                      <Ionicons name="star" size={10} color="#FBBF24" />
                      <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                        {(4.5 + ((index % 5) * 0.1)).toFixed(1)}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-base text-[#221910] mb-1" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
                    {post.questTitle}
                  </Text>
                  <Text className="text-xs text-[#7A746D]" numberOfLines={1} style={{ fontFamily: fonts.bodyRegular }}>
                    {post.area}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>

        <View className="px-5 pb-8">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-lg text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
              新着フィード
            </Text>
            <Pressable
              className="w-8 h-8 rounded-md items-center justify-center"
              onPress={() => navigation.navigate("MainTabs", { screen: "Search" })}
            >
              <Ionicons name="options-outline" size={18} color="#8E8984" />
            </Pressable>
          </View>

          {loading ? (
            <View className="items-center py-8">
              <ActivityIndicator color="#EE8C2B" />
            </View>
          ) : homeFeedPosts.length === 0 ? (
            <View className="rounded-2xl border border-dashed border-[#E2DBD3] bg-white px-5 py-8 items-center mt-2">
              <Text className="text-sm text-[#6E6963] mb-3" style={{ fontFamily: fonts.bodyRegular }}>
                まだフィードがありません
              </Text>
              <Pressable
                className="h-9 rounded-lg border border-[#DDD4CA] px-4 items-center justify-center"
                onPress={() => navigation.navigate("MainTabs", { screen: "Create" })}
              >
                <Text className="text-xs text-[#6E6963]" style={{ fontFamily: fonts.displayBold }}>
                  最初の投稿を作成
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="mt-1">
              {homeFeedPosts.slice(0, 10).map((post) => (
                <Pressable key={post.id} className="flex-row gap-4 py-3 border-b border-[#EDE6DD]" onPress={handleOpenQuests}>
                  <View className="w-20 h-20 rounded-xl overflow-hidden bg-[#DDD6CC]">
                    <Image source={{ uri: post.questImage }} className="w-full h-full" resizeMode="cover" />
                  </View>

                  <View className="flex-1 justify-center min-w-0">
                    <View className="flex-row items-center gap-2 mb-1.5">
                      <Pressable
                        className="w-4 h-4 rounded-full overflow-hidden bg-[#D7CEC3]"
                        onPress={(event) => {
                          event.stopPropagation();
                          handleOpenCreator(post.authorId);
                        }}
                      >
                        {post.authorAvatar ? (
                          <Image source={{ uri: post.authorAvatar }} className="w-full h-full" resizeMode="cover" />
                        ) : (
                          <View className="w-full h-full items-center justify-center">
                            <Ionicons name="people" size={9} color="#8D847A" />
                          </View>
                        )}
                      </Pressable>

                      <Text className="text-[10px] text-[#7A746D]" numberOfLines={1} style={{ fontFamily: fonts.bodyMedium }}>
                        @{post.authorName.replace(/\s+/g, "_").toLowerCase()}
                      </Text>
                      <View className="w-[2px] h-[2px] rounded-full bg-[#CFC6BC]" />
                      <Text className="text-[10px] text-[#A19A90]" style={{ fontFamily: fonts.bodyRegular }}>
                        {formatRelativeTime(post.postedAt)}
                      </Text>
                    </View>

                    <Text className="text-base text-[#221910] mb-0.5" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
                      {post.questTitle}
                    </Text>
                    <Text className="text-xs text-[#7A746D]" numberOfLines={1} style={{ fontFamily: fonts.bodyMedium }}>
                      {post.tags[0] ? `#${post.tags[0]}` : post.area}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
};
