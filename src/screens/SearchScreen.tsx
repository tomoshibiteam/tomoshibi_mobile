import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { MainTabParamList, RootStackParamList } from "@/navigation/types";
import { fonts } from "@/theme/fonts";
import {
  fetchViewerRelations,
  fetchUsersByKeyword,
  followUser,
  unfollowByRelationId,
} from "@/services/social";
import { fetchExplorePayload } from "@/services/feed";
import type { ExploreCreator, ExploreQuest } from "@/types/feed";
import type { FriendshipRow, ProfileRow } from "@/types/social";
import { useSessionUserId } from "@/hooks/useSessionUser";
import { getSupabaseOrThrow, isSupabaseConfigured } from "@/lib/supabase";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import { ProfileAvatar } from "@/components/common/ProfileAvatar";

type Props = BottomTabScreenProps<MainTabParamList, "Search">;
type SearchResultTab = "series" | "creators";
type QuestDetail = {
  id: string;
  title: string | null;
  coverImageUrl: string | null;
  difficulty: number | null;
  durationMin: number | null;
  areaName: string | null;
  description: string | null;
  rating: number | null;
  spotsCount: number;
};

const PLACEHOLDER_IMAGE =
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=800&q=80";

const areaFilters = ["すべて", "東京", "大阪", "京都", "その他"] as const;
const trendingKeywords = [
  "歴史ミステリー",
  "近所の冒険",
  "対馬",
  "短編物語",
  "カフェ巡り",
  "夜景スポット",
] as const;

const areaMapping: Record<string, string> = {
  tokyo: "東京",
  osaka: "大阪",
  kyoto: "京都",
};

const toRadians = (value: number) => (value * Math.PI) / 180;

const distanceMeters = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) => {
  const earthRadius = 6371000;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
};

const formatDistance = (
  userLocation: { lat: number; lng: number } | null,
  questLocation: { lat: number; lng: number } | null
) => {
  if (!userLocation || !questLocation) return "距離不明";
  const meters = distanceMeters(userLocation, questLocation);
  if (meters < 1000) return `${Math.max(1, Math.round(meters))}m`;
  const kilometers = meters / 1000;
  if (kilometers < 10) return `${kilometers.toFixed(1)}km`;
  return `${Math.round(kilometers)}km`;
};

export const SearchScreen = ({}: Props) => {
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { userId } = useSessionUserId();

  const [keyword, setKeyword] = useState("");
  const [searchResultTab, setSearchResultTab] = useState<SearchResultTab>("creators");
  const [selectedArea, setSelectedArea] = useState<(typeof areaFilters)[number]>("すべて");
  const [showFilters, setShowFilters] = useState(false);
  const [locating, setLocating] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  const [quests, setQuests] = useState<ExploreQuest[]>([]);
  const [creators, setCreators] = useState<ExploreCreator[]>([]);
  const [questCountByCreatorId, setQuestCountByCreatorId] = useState<Record<string, number>>({});
  const [purchasedQuestIds, setPurchasedQuestIds] = useState<Set<string>>(new Set());
  const [keywordUsers, setKeywordUsers] = useState<ProfileRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [keywordLoading, setKeywordLoading] = useState(false);
  const [actionTargetId, setActionTargetId] = useState<string | null>(null);
  const [relationsByUserId, setRelationsByUserId] = useState<Record<string, FriendshipRow>>({});
  const [selectedQuestId, setSelectedQuestId] = useState<string | null>(null);
  const [selectedQuestDetail, setSelectedQuestDetail] = useState<QuestDetail | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  const hasKeyword = keyword.trim().length > 0;

  const refreshRelations = useCallback(async () => {
    if (!userId || !isSupabaseConfigured) {
      setRelationsByUserId({});
      return;
    }
    try {
      const map = await fetchViewerRelations(userId);
      setRelationsByUserId(map);
    } catch (error) {
      console.warn("SearchScreen: failed to refresh relations", error);
    }
  }, [userId]);

  const refreshExplore = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setQuests([]);
      setCreators([]);
      setQuestCountByCreatorId({});
      setPurchasedQuestIds(new Set());
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const payload = await fetchExplorePayload(userId);
      setQuests(payload.quests);
      setCreators(payload.creators);
      setQuestCountByCreatorId(payload.questCountByCreatorId);
      setPurchasedQuestIds(new Set(payload.purchasedQuestIds));
    } catch (error) {
      console.error("SearchScreen: failed to load explore payload", error);
      setQuests([]);
      setCreators([]);
      setQuestCountByCreatorId({});
      setPurchasedQuestIds(new Set());
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refreshExplore();
  }, [refreshExplore]);

  useEffect(() => {
    void refreshRelations();
  }, [refreshRelations]);

  useEffect(() => {
    if (!isSupabaseConfigured || !hasKeyword) {
      setKeywordUsers([]);
      setKeywordLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      setKeywordLoading(true);
      fetchUsersByKeyword(keyword, userId)
        .then((rows) => {
          setKeywordUsers(rows);
        })
        .catch((error) => {
          console.warn("SearchScreen: failed to search creators", error);
          setKeywordUsers([]);
        })
        .finally(() => {
          setKeywordLoading(false);
        });
    }, 220);

    return () => clearTimeout(timer);
  }, [hasKeyword, keyword, userId]);

  useEffect(() => {
    if (!isSupabaseConfigured || !selectedQuestId) {
      setSelectedQuestDetail(null);
      return;
    }

    let active = true;
    const fetchQuestDetail = async () => {
      setModalLoading(true);
      try {
        const supabase = getSupabaseOrThrow();
        const { data, error: detailError } = await supabase
          .from("quests")
          .select("id, title, cover_image_url, difficulty, duration_min, area_name, description, spots(count)")
          .eq("id", selectedQuestId)
          .single();

        if (detailError) throw detailError;
        if (!active) return;

        const detail = data as {
          id: string;
          title: string | null;
          cover_image_url: string | null;
          difficulty: number | null;
          duration_min: number | null;
          area_name: string | null;
          description: string | null;
          spots: Array<{ count: number | null }> | null;
        };

        const { data: reviewsData, error: reviewsError } = await supabase
          .from("quest_reviews")
          .select("rating")
          .eq("quest_id", selectedQuestId);

        if (reviewsError) {
          console.warn("SearchScreen: failed to fetch ratings", reviewsError);
        }
        if (!active) return;

        const ratings = ((reviewsData || []) as Array<{ rating: number | null }>)
          .map((row) => row.rating)
          .filter((rating): rating is number => typeof rating === "number");

        const rating =
          ratings.length > 0
            ? ratings.reduce((sum, current) => sum + current, 0) / ratings.length
            : null;

        setSelectedQuestDetail({
          id: detail.id,
          title: detail.title,
          coverImageUrl: detail.cover_image_url,
          difficulty: detail.difficulty,
          durationMin: detail.duration_min,
          areaName: detail.area_name,
          description: detail.description,
          rating,
          spotsCount: detail.spots?.[0]?.count || 0,
        });
      } catch (error) {
        console.error("SearchScreen: failed to fetch quest detail", error);
        if (active) {
          setSelectedQuestDetail(null);
        }
      } finally {
        if (active) {
          setModalLoading(false);
        }
      }
    };

    void fetchQuestDetail();
    return () => {
      active = false;
    };
  }, [selectedQuestId]);

  const filteredQuests = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return quests.filter((quest) => {
      const title = (quest.title || "").toLowerCase();
      const area = (quest.areaName || "").toLowerCase();
      const creator = (quest.creatorName || "").toLowerCase();

      if (
        normalizedKeyword &&
        !title.includes(normalizedKeyword) &&
        !area.includes(normalizedKeyword) &&
        !creator.includes(normalizedKeyword)
      ) {
        return false;
      }

      if (selectedArea === "すべて") return true;

      const normalizedArea = areaMapping[area] || quest.areaName || "";
      if (selectedArea === "その他") {
        const major = ["東京", "大阪", "京都"];
        return !major.some((city) => normalizedArea.includes(city) || area.includes(city.toLowerCase()));
      }

      const matchesJapanese = normalizedArea.includes(selectedArea);
      const matchesEnglish = Object.entries(areaMapping).some(
        ([englishName, japaneseName]) => japaneseName === selectedArea && area.includes(englishName)
      );

      return matchesJapanese || matchesEnglish;
    });
  }, [quests, keyword, selectedArea]);

  const featuredQuests = useMemo(() => filteredQuests.slice(0, 8), [filteredQuests]);

  const visibleCreators = useMemo(() => {
    if (hasKeyword) {
      return keywordUsers
        .filter((user) => !userId || user.id !== userId)
        .map((user) => ({
          id: user.id,
          name: user.name || "旅する作家",
          profilePictureUrl: user.profile_picture_url || null,
          questCount: questCountByCreatorId[user.id] || 0,
        }));
    }

    return creators.filter((creator) => !userId || creator.id !== userId);
  }, [hasKeyword, keywordUsers, userId, creators, questCountByCreatorId]);

  const handleOpenProfile = (profileId: string) => {
    if (profileId === userId) {
      rootNavigation.navigate("MainTabs", { screen: "Profile" });
      return;
    }
    rootNavigation.navigate("UserProfile", { userId: profileId });
  };

  const handleToggleFollow = async (profileId: string) => {
    if (!userId) {
      rootNavigation.navigate("Auth");
      return;
    }

    const relation = relationsByUserId[profileId];
    setActionTargetId(profileId);
    try {
      if (!relation) {
        await followUser(userId, profileId);
      } else {
        await unfollowByRelationId(relation.id);
      }
      await refreshRelations();
    } catch (error) {
      console.error("SearchScreen: follow action failed", error);
      Alert.alert("操作に失敗しました", "時間をおいて再度お試しください。");
    } finally {
      setActionTargetId(null);
    }
  };

  const handleUseCurrentLocation = () => {
    const geo = (globalThis as any)?.navigator?.geolocation as
      | {
          getCurrentPosition: (
            success: (position: { coords: { latitude: number; longitude: number } }) => void,
            error?: () => void,
            options?: { enableHighAccuracy?: boolean; timeout?: number }
          ) => void;
        }
      | undefined;
    if (!geo || locating) return;
    setLocating(true);
    geo.getCurrentPosition(
      (position) => {
        setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleNavigateToDetail = () => {
    if (!selectedQuestId) return;
    setSelectedQuestId(null);
    rootNavigation.navigate("SeriesDetail", { questId: selectedQuestId });
  };

  if (!isSupabaseConfigured) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-[#F8F7F6]">
        <View className="px-5 py-8">
          <Text className="text-sm text-[#6C5647]" style={{ fontFamily: fonts.bodyRegular }}>
            EXPO_PUBLIC_SUPABASE_URL と EXPO_PUBLIC_SUPABASE_ANON_KEY を `.env` に設定してください。
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-[#F8F7F6]">
      <View className="bg-[#F8F7F6] border-b border-[#ECE6DF]">
        <View className="flex-row items-center gap-3 px-4 pt-3 pb-3">
          <View className="flex-1 relative">
            <Ionicons name="search" size={16} color="#A39A90" style={{ position: "absolute", left: 12, top: 13 }} />
            <TextInput
              value={keyword}
              onChangeText={setKeyword}
              placeholder="場所、物語のタイトル、作者を検索"
              placeholderTextColor="#A39A90"
              className="w-full h-11 pl-10 pr-10 bg-[#F1ECE6] border border-[#E5DDD3] rounded-xl text-sm text-[#221910]"
              style={{ fontFamily: fonts.bodyRegular }}
            />
            {hasKeyword && (
              <Pressable className="absolute right-3 top-3" onPress={() => setKeyword("")}>
                <Ionicons name="close" size={16} color="#9A938B" />
              </Pressable>
            )}
          </View>

          <Pressable
            className={`w-11 h-11 rounded-xl border items-center justify-center ${
              showFilters
                ? "bg-[#FCEAD8] border-[#EE8C2B]/30"
                : "bg-[#F1ECE6] border-[#E5DDD3]"
            }`}
            onPress={() => setShowFilters((prev) => !prev)}
          >
            <Ionicons name="options-outline" size={18} color={showFilters ? "#EE8C2B" : "#7A746D"} />
          </Pressable>
        </View>

        {showFilters && (
          <View className="px-4 pb-3">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              {areaFilters.map((area) => {
                const active = selectedArea === area;
                return (
                  <Pressable
                    key={area}
                    className={`px-3.5 py-1.5 rounded-full border ${
                      active
                        ? "bg-[#FDECD8] border-[#EE8C2B]/35"
                        : "bg-white border-[#E6DED5]"
                    }`}
                    onPress={() => setSelectedArea(area)}
                  >
                    <Text
                      className={`text-xs ${active ? "text-[#EE8C2B]" : "text-[#6E6963]"}`}
                      style={{ fontFamily: fonts.displayBold }}
                    >
                      {area}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable className="mt-3 flex-row items-center gap-1 self-start" onPress={handleUseCurrentLocation}>
              {locating ? (
                <ActivityIndicator size="small" color="#EE8C2B" />
              ) : (
                <Ionicons name="navigate-outline" size={12} color="#EE8C2B" />
              )}
              <Text className="text-[11px] text-[#EE8C2B]" style={{ fontFamily: fonts.displayBold }}>
                現在地付近の距離を表示
              </Text>
            </Pressable>
          </View>
        )}

        {hasKeyword && (
          <View className="flex-row border-t border-[#ECE6DF]">
            <Pressable
              className="flex-1 items-center py-3"
              onPress={() => setSearchResultTab("series")}
            >
              <Text
                className={`text-sm ${searchResultTab === "series" ? "text-[#221910]" : "text-[#7A746D]"}`}
                style={{ fontFamily: searchResultTab === "series" ? fonts.displayBold : fonts.bodyMedium }}
              >
                シリーズ
              </Text>
              {searchResultTab === "series" && <View className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#EE8C2B]" />}
            </Pressable>

            <Pressable
              className="flex-1 items-center py-3"
              onPress={() => setSearchResultTab("creators")}
            >
              <Text
                className={`text-sm ${searchResultTab === "creators" ? "text-[#221910]" : "text-[#7A746D]"}`}
                style={{ fontFamily: searchResultTab === "creators" ? fonts.displayBold : fonts.bodyMedium }}
              >
                クリエイター
              </Text>
              {searchResultTab === "creators" && <View className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#EE8C2B]" />}
            </Pressable>
          </View>
        )}
      </View>

      {loading ? (
        <View className="flex-1 px-5 py-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <View key={`search-skeleton-${index}`} className="flex-row items-center gap-3 mb-4">
              <View className="w-12 h-12 rounded-full bg-[#E8E1D8]" />
              <View className="flex-1 gap-2">
                <View className="h-4 w-32 rounded-md bg-[#E8E1D8]" />
                <View className="h-3 w-44 rounded-md bg-[#E8E1D8]" />
              </View>
              <View className="h-8 w-20 rounded-lg bg-[#E8E1D8]" />
            </View>
          ))}
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 120 }}>
          {hasKeyword ? (
            <View className="px-4 pt-4">
              <Text className="text-xs text-[#7A746D] mb-4 px-1" style={{ fontFamily: fonts.displayBold }}>
                {searchResultTab === "creators"
                  ? `${visibleCreators.length}件のユーザーが見つかりました`
                  : `${filteredQuests.length}件のシリーズが見つかりました`}
              </Text>

              {searchResultTab === "creators" ? (
                <View className="gap-3">
                  {(keywordLoading ? [] : visibleCreators).map((creator) => {
                    const relation = relationsByUserId[creator.id];
                    const isSelfCreator = userId === creator.id;
                    const isFollowing = Boolean(relation);
                    const isActionLoading = actionTargetId === creator.id;
                    return (
                      <View
                        key={creator.id}
                        className="flex-row items-center gap-3 p-4 bg-white rounded-2xl border border-[#ECE6DF]"
                      >
                        <Pressable onPress={() => handleOpenProfile(creator.id)}>
                          <ProfileAvatar name={creator.name} imageUrl={creator.profilePictureUrl} size={56} />
                        </Pressable>

                        <View className="flex-1 min-w-0">
                          <Text className="text-sm text-[#221910]" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
                            {creator.name}
                          </Text>
                          <Text className="text-xs text-[#7A746D] mt-0.5" numberOfLines={1} style={{ fontFamily: fonts.bodyRegular }}>
                            {creator.questCount > 0 ? "公開中のシリーズがあります" : "プロフィールを準備中です"}
                          </Text>
                          <Text className="text-[10px] text-[#9A938B] mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                            {creator.questCount} シリーズ
                          </Text>
                        </View>

                        <Pressable
                          className={`px-4 py-1.5 rounded-full ${
                            isFollowing || isSelfCreator
                              ? "bg-[#F1ECE6] border border-[#DDD4CA]"
                              : "bg-[#EE8C2B]"
                          }`}
                          disabled={isActionLoading || isSelfCreator}
                          onPress={() => {
                            void handleToggleFollow(creator.id);
                          }}
                        >
                          {isActionLoading ? (
                            <ActivityIndicator size="small" color={isFollowing ? "#7A6F63" : "#FFFFFF"} />
                          ) : (
                            <Text
                              className={`text-xs ${isFollowing || isSelfCreator ? "text-[#8A8278]" : "text-white"}`}
                              style={{ fontFamily: fonts.displayBold }}
                            >
                              {isSelfCreator ? "あなた" : isFollowing ? "フォロー中" : "フォロー"}
                            </Text>
                          )}
                        </Pressable>
                      </View>
                    );
                  })}

                  {keywordLoading && (
                    <View className="items-center py-8">
                      <ActivityIndicator color="#EE8C2B" />
                    </View>
                  )}

                  {!keywordLoading && visibleCreators.length === 0 && (
                    <View className="rounded-2xl border border-dashed border-[#E5DDD3] bg-white px-5 py-10">
                      <Text className="text-sm text-[#6E6963] text-center" style={{ fontFamily: fonts.bodyRegular }}>
                        一致するユーザーが見つかりませんでした
                      </Text>
                    </View>
                  )}
                </View>
              ) : (
                <View className="gap-3">
                  {filteredQuests.map((quest) => (
                    <Pressable
                      key={quest.id}
                      className="flex-row items-center gap-3 rounded-2xl border border-[#ECE6DF] bg-white p-3"
                      onPress={() => setSelectedQuestId(quest.id)}
                    >
                      <View className="w-20 h-20 rounded-xl overflow-hidden bg-[#DFDAD4]">
                        <Image source={{ uri: quest.coverImageUrl || PLACEHOLDER_IMAGE }} className="w-full h-full" resizeMode="cover" />
                      </View>

                      <View className="flex-1 min-w-0">
                        <Text className="text-sm text-[#221910]" numberOfLines={2} style={{ fontFamily: fonts.displayBold }}>
                          {quest.title}
                        </Text>
                        <Text className="text-xs text-[#7A746D] mt-1" numberOfLines={1} style={{ fontFamily: fonts.bodyRegular }}>
                          {quest.creatorName || "旅する作家"}
                        </Text>
                        <View className="flex-row items-center gap-1 mt-1">
                          <Ionicons name="location-outline" size={11} color="#7A746D" />
                          <Text className="text-[11px] text-[#7A746D]" numberOfLines={1} style={{ fontFamily: fonts.bodyRegular }}>
                            {quest.areaName || "エリア未設定"}
                          </Text>
                        </View>
                      </View>

                      <View className="px-3 py-1.5 rounded-full border border-[#EE8C2B]/25 bg-[#FDECD8]">
                        <Text className="text-[11px] text-[#EE8C2B]" style={{ fontFamily: fonts.displayBold }}>
                          詳細
                        </Text>
                      </View>
                    </Pressable>
                  ))}

                  {filteredQuests.length === 0 && (
                    <View className="rounded-2xl border border-dashed border-[#E5DDD3] bg-white px-5 py-10">
                      <Text className="text-sm text-[#6E6963] text-center" style={{ fontFamily: fonts.bodyRegular }}>
                        一致するシリーズが見つかりませんでした
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          ) : (
            <>
              <View className="px-5 pt-6 pb-4">
                <View className="flex-row items-center gap-2 mb-4">
                  <Ionicons name="trending-up-outline" size={18} color="#EE8C2B" />
                  <Text className="text-lg text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                    人気のキーワード
                  </Text>
                </View>

                <View className="flex-row flex-wrap gap-2">
                  {trendingKeywords.map((tag, index) => (
                    <Pressable
                      key={tag}
                      onPress={() => setKeyword(tag)}
                      className={`px-4 py-2 rounded-full border ${
                        index < 4
                          ? "border-[#EE8C2B]/30 bg-[#FDECD8]"
                          : "border-[#E6DED5] bg-white"
                      }`}
                    >
                      <Text
                        className={`text-sm ${index < 4 ? "text-[#EE8C2B]" : "text-[#6E6963]"}`}
                        style={{ fontFamily: fonts.bodyMedium }}
                      >
                        #{tag}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View className="pb-6 border-b border-[#EFE9E3]">
                <View className="px-5 mb-4 flex-row items-center justify-between">
                  <Text className="text-lg text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                    人気のクリエイター
                  </Text>
                  <Pressable onPress={() => rootNavigation.navigate("MainTabs", { screen: "Notifications" })}>
                    <Text className="text-xs text-[#EE8C2B]" style={{ fontFamily: fonts.displayBold }}>
                      すべて見る
                    </Text>
                  </Pressable>
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}>
                  {visibleCreators.slice(0, 12).map((creator) => {
                    const relation = relationsByUserId[creator.id];
                    const isSelfCreator = userId === creator.id;
                    const isFollowing = Boolean(relation);
                    const isActionLoading = actionTargetId === creator.id;

                    return (
                      <View key={creator.id} className="w-24 items-center gap-2">
                        <Pressable onPress={() => handleOpenProfile(creator.id)} className="items-center gap-2">
                          <ProfileAvatar name={creator.name} imageUrl={creator.profilePictureUrl} size={64} />
                          <Text className="text-xs text-[#221910] text-center" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
                            {creator.name}
                          </Text>
                        </Pressable>

                        <Text className="text-[10px] text-[#8A8278]" style={{ fontFamily: fonts.bodyRegular }}>
                          {creator.questCount}作品
                        </Text>

                        <Pressable
                          className={`w-full py-1 rounded-full border ${
                            isFollowing || isSelfCreator
                              ? "text-[#8A8278] border-[#DDD4CA] bg-[#F1ECE6]"
                              : "border-[#EE8C2B] bg-white"
                          }`}
                          disabled={isSelfCreator || isActionLoading}
                          onPress={() => {
                            void handleToggleFollow(creator.id);
                          }}
                        >
                          {isActionLoading ? (
                            <ActivityIndicator size="small" color="#EE8C2B" />
                          ) : (
                            <Text
                              className={`text-[10px] text-center ${
                                isFollowing || isSelfCreator ? "text-[#8A8278]" : "text-[#EE8C2B]"
                              }`}
                              style={{ fontFamily: fonts.displayBold }}
                            >
                              {isSelfCreator ? "あなた" : isFollowing ? "フォロー中" : "フォロー"}
                            </Text>
                          )}
                        </Pressable>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>

              <View className="p-5">
                <View className="flex-row items-center justify-between mb-4">
                  <Text className="text-lg text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                    おすすめのスポット
                  </Text>
                  <Pressable onPress={() => setKeyword("スポット")}>
                    <Ionicons name="map-outline" size={16} color="#8E8984" />
                  </Pressable>
                </View>

                {featuredQuests.length === 0 ? (
                  <View className="rounded-2xl border border-dashed border-[#E5DDD3] bg-white px-5 py-10 items-center">
                    <View className="w-12 h-12 rounded-full bg-[#F5EFE8] items-center justify-center mb-3">
                      <Ionicons name="sparkles-outline" size={18} color="#B8AFA4" />
                    </View>
                    <Text className="text-sm text-[#6E6963] mb-3" style={{ fontFamily: fonts.bodyRegular }}>
                      条件に合うスポットが見つかりません
                    </Text>
                    <Pressable
                      className="h-9 px-4 rounded-lg border border-[#DDD4CA] items-center justify-center"
                      onPress={() => {
                        setKeyword("");
                        setSelectedArea("すべて");
                      }}
                    >
                      <Text className="text-xs text-[#6E6963]" style={{ fontFamily: fonts.displayBold }}>
                        フィルターをリセット
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <View className="flex-row flex-wrap justify-between">
                    {featuredQuests.map((quest) => (
                      <Pressable
                        key={quest.id}
                        className="mb-4"
                        style={{ width: "48%" }}
                        onPress={() => setSelectedQuestId(quest.id)}
                      >
                        <View className="relative rounded-xl overflow-hidden mb-2 bg-[#DFDAD4]" style={{ aspectRatio: 3 / 4 }}>
                          <Image source={{ uri: quest.coverImageUrl || PLACEHOLDER_IMAGE }} className="w-full h-full" resizeMode="cover" />

                          <View className="absolute top-2 right-2 bg-black/60 rounded-full px-2 py-0.5 flex-row items-center gap-1">
                            <Ionicons name="navigate-outline" size={10} color="#FFFFFF" />
                            <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                              {formatDistance(userLocation, quest.startLocation)}
                            </Text>
                          </View>

                          {purchasedQuestIds.has(quest.id) && (
                            <View className="absolute bottom-2 left-2 bg-white/90 rounded-full px-2 py-0.5">
                              <Text className="text-[10px] text-[#7A746D]" style={{ fontFamily: fonts.displayBold }}>
                                保存済み
                              </Text>
                            </View>
                          )}
                        </View>

                        <Text className="text-sm text-[#221910]" numberOfLines={2} style={{ fontFamily: fonts.displayBold }}>
                          {quest.title}
                        </Text>

                        <View className="flex-row items-center gap-1 mt-1">
                          <Ionicons name="location-outline" size={11} color="#7A746D" />
                          <Text className="text-xs text-[#7A746D]" numberOfLines={1} style={{ fontFamily: fonts.bodyRegular }}>
                            {quest.areaName || "エリア未設定"}
                          </Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            </>
          )}
        </ScrollView>
      )}

      <Modal
        visible={Boolean(selectedQuestId)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedQuestId(null)}
      >
        <View className="flex-1 items-center justify-center bg-black/55 px-4">
          <Pressable className="absolute inset-0" onPress={() => setSelectedQuestId(null)} />
          <View className="w-full max-w-md rounded-3xl bg-[#F8F7F6] border border-[#E6DED5] overflow-hidden">
            <View className="h-48 bg-[#E6DED5] relative">
              {selectedQuestDetail?.coverImageUrl ? (
                <Image source={{ uri: selectedQuestDetail.coverImageUrl }} className="w-full h-full" resizeMode="cover" />
              ) : (
                <View className="w-full h-full items-center justify-center">
                  <Ionicons name="map-outline" size={42} color="#B7AD9F" />
                </View>
              )}
              <View className="absolute inset-0 bg-black/35" />
              <View className="absolute bottom-4 left-4 right-4">
                <Text className="text-xl text-white leading-snug" style={{ fontFamily: fonts.displayBold }}>
                  {selectedQuestDetail?.title || "Loading..."}
                </Text>
              </View>
              <Pressable
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/30 items-center justify-center"
                onPress={() => setSelectedQuestId(null)}
              >
                <Ionicons name="close" size={16} color="#FFFFFF" />
              </Pressable>
            </View>

            <View className="p-6">
              {modalLoading ? (
                <View className="items-center py-8">
                  <ActivityIndicator color="#EE8C2B" />
                </View>
              ) : (
                <>
                  <View className="flex-row gap-3 mb-5">
                    <View className="flex-1 p-2 rounded-xl bg-white border border-[#E6DED5] items-center">
                      <Ionicons name="time-outline" size={16} color="#EE8C2B" />
                      <Text className="text-[10px] text-[#7A746D] mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                        TIME
                      </Text>
                      <Text className="text-xs text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                        {selectedQuestDetail?.durationMin ?? 60}分
                      </Text>
                    </View>

                    <View className="flex-1 p-2 rounded-xl bg-white border border-[#E6DED5] items-center">
                      <Ionicons name="location-outline" size={16} color="#EE8C2B" />
                      <Text className="text-[10px] text-[#7A746D] mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                        AREA
                      </Text>
                      <Text className="text-xs text-[#221910] px-1" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
                        {selectedQuestDetail?.areaName || "Unknown"}
                      </Text>
                    </View>

                    <View className="flex-1 p-2 rounded-xl bg-white border border-[#E6DED5] items-center">
                      <Ionicons name="star" size={16} color="#EE8C2B" />
                      <Text className="text-[10px] text-[#7A746D] mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                        RATING
                      </Text>
                      <Text className="text-xs text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                        {selectedQuestDetail?.rating ? selectedQuestDetail.rating.toFixed(1) : "-"}
                      </Text>
                    </View>
                  </View>

                  <Text className="text-sm text-[#6E6963] leading-6 mb-6" numberOfLines={3} style={{ fontFamily: fonts.bodyRegular }}>
                    {selectedQuestDetail?.description || "No description available."}
                  </Text>

                  <View className="flex-row gap-3">
                    <Pressable
                      className="flex-1 h-11 rounded-full border border-[#E0D7CD] bg-white items-center justify-center"
                      onPress={() => setSelectedQuestId(null)}
                    >
                      <Text className="text-sm text-[#6E6963]" style={{ fontFamily: fonts.displayBold }}>
                        閉じる
                      </Text>
                    </Pressable>

                    <Pressable
                      className="flex-[2] h-11 rounded-full bg-[#EE8C2B] items-center justify-center"
                      onPress={handleNavigateToDetail}
                    >
                      <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                        詳細を見る
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};
