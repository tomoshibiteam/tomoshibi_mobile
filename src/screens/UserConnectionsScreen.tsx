import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, Text, TextInput, View } from "react-native";
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
  fetchConnections,
  fetchUserProfile,
  fetchViewerRelations,
  followUser,
  isMutualFollowBlockedError,
  isFollowingUser,
  unfollowByRelationId,
} from "@/services/social";
import type { ConnectionTab, FriendshipRow, ProfileRow } from "@/types/social";
import { UserListItem } from "@/components/social/UserListItem";

type Props = NativeStackScreenProps<RootStackParamList, "UserConnections">;

const normalizeTab = (tab?: ConnectionTab): ConnectionTab => (tab === "following" ? "following" : "followers");

export const UserConnectionsScreen = ({ navigation, route }: Props) => {
  const { userId: targetUserId, tab } = route.params;
  const { userId: viewerUserId } = useSessionUserId();

  const [activeTab, setActiveTab] = useState<ConnectionTab>(normalizeTab(tab));
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [targetProfile, setTargetProfile] = useState<ProfileRow | null>(null);
  const [followers, setFollowers] = useState<ProfileRow[]>([]);
  const [following, setFollowing] = useState<ProfileRow[]>([]);
  const [relationsByUserId, setRelationsByUserId] = useState<Record<string, FriendshipRow>>({});
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const isSelfProfile = Boolean(viewerUserId && viewerUserId === targetUserId);

  useEffect(() => {
    setActiveTab(normalizeTab(tab));
  }, [tab]);

  const refreshTarget = useCallback(async () => {
    setLoading(true);
    try {
      const [profile, connectionResult] = await Promise.all([
        fetchUserProfile(targetUserId),
        fetchConnections(targetUserId),
      ]);

      setTargetProfile(profile);
      setFollowers(connectionResult.followers);
      setFollowing(connectionResult.following);
    } catch (error) {
      console.error("UserConnectionsScreen: failed to fetch", error);
      Alert.alert("フォロー一覧を読み込めません", "時間をおいて再度お試しください。");
      setFollowers([]);
      setFollowing([]);
    } finally {
      setLoading(false);
    }
  }, [targetUserId]);

  const refreshViewerRelations = useCallback(async () => {
    if (!viewerUserId) {
      setRelationsByUserId({});
      return;
    }

    try {
      const relationMap = await fetchViewerRelations(viewerUserId);
      setRelationsByUserId(relationMap);
    } catch (error) {
      console.warn("UserConnectionsScreen: failed to fetch viewer relations", error);
    }
  }, [viewerUserId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshTarget(), refreshViewerRelations()]);
  }, [refreshTarget, refreshViewerRelations]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll])
  );

  useFriendshipsRealtime([targetUserId, viewerUserId], refreshAll);

  const visibleUsers = useMemo(() => {
    const source = activeTab === "followers" ? followers : following;
    const normalized = keyword.trim().toLowerCase();

    if (!normalized) return source;

    return source.filter((profile) => {
      const name = (profile.name || "").toLowerCase();
      const bio = (profile.bio || "").toLowerCase();
      return name.includes(normalized) || bio.includes(normalized);
    });
  }, [activeTab, followers, following, keyword]);

  const handleOpenProfile = (profileId: string) => {
    if (viewerUserId && profileId === viewerUserId) {
      navigation.navigate("MainTabs", { screen: "Profile" });
      return;
    }
    navigation.navigate("UserProfile", { userId: profileId });
  };

  const handleToggleFollow = async (profileId: string) => {
    if (!viewerUserId) {
      navigation.navigate("Auth");
      return;
    }

    if (profileId === viewerUserId) return;

    const relation = relationsByUserId[profileId];
    const isFollowing = isFollowingUser(relation, viewerUserId);
    setActionUserId(profileId);

    try {
      if (!isFollowing) {
        await followUser(viewerUserId, profileId);
      } else if (relation) {
        await unfollowByRelationId(relation.id);
      }

      await refreshAll();
    } catch (error) {
      console.error("UserConnectionsScreen: follow action failed", error);
      if (isMutualFollowBlockedError(error)) {
        Alert.alert("フォロー操作に失敗しました", "DB設定の制約により相互フォローが作成できません。");
        return;
      }
      Alert.alert("フォロー操作に失敗しました", "時間をおいて再度お試しください。");
    } finally {
      setActionUserId(null);
    }
  };

  const handle = formatProfileHandle(targetProfile?.handle || null, targetProfile?.name || null, targetUserId);

  if (!loading && !targetProfile) {
    return (
      <View className="flex-1 bg-[#F8F7F6]">
        <TopBar title={handle} />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-lg text-[#221910] mb-2" style={{ fontFamily: fonts.displayBold }}>
            ユーザーが見つかりません
          </Text>
          <Text className="text-sm text-[#6C5647] text-center mb-6" style={{ fontFamily: fonts.bodyRegular }}>
            URLが正しいか確認してください。
          </Text>
          <Pressable
            className="h-11 rounded-full px-6 bg-[#2B1E16] items-center justify-center"
            onPress={() => navigation.goBack()}
          >
            <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
              戻る
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-[#F8F7F6]">
      <TopBar title={handle} />

      <View className="border-b border-[#E7D9C7] bg-[#F8F7F6]">
        <View className="flex-row">
          <Pressable
            className={`flex-1 py-3 items-center border-b-2 ${
              activeTab === "followers" ? "border-[#EE8C2B]" : "border-transparent"
            }`}
            onPress={() => setActiveTab("followers")}
          >
            <Text
              className={`text-sm ${activeTab === "followers" ? "text-[#EE8C2B]" : "text-[#6C5647]"}`}
              style={{ fontFamily: activeTab === "followers" ? fonts.displayBold : fonts.bodyMedium }}
            >
              フォロワー <Text className="text-xs opacity-80">({followers.length})</Text>
            </Text>
          </Pressable>

          <Pressable
            className={`flex-1 py-3 items-center border-b-2 ${
              activeTab === "following" ? "border-[#EE8C2B]" : "border-transparent"
            }`}
            onPress={() => setActiveTab("following")}
          >
            <Text
              className={`text-sm ${activeTab === "following" ? "text-[#EE8C2B]" : "text-[#6C5647]"}`}
              style={{ fontFamily: activeTab === "following" ? fonts.displayBold : fonts.bodyMedium }}
            >
              フォロー中 <Text className="text-xs opacity-80">({following.length})</Text>
            </Text>
          </Pressable>
        </View>

        <View className="px-5 py-4">
          <View className="flex-row items-center rounded-xl border border-[#E5DDD3] bg-[#F1ECE6] px-3 py-2.5">
            <Ionicons name="search" size={18} color="#9A938B" />
            <TextInput
              value={keyword}
              onChangeText={setKeyword}
              placeholder="名前で検索"
              placeholderTextColor="#A39A90"
              className="flex-1 ml-2 text-sm text-[#221910]"
              style={{ fontFamily: fonts.bodyRegular }}
            />
            {keyword.length > 0 && (
              <Pressable onPress={() => setKeyword("")}>
                <Ionicons name="close-circle" size={18} color="#A39A90" />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 px-5 py-4">
          {Array.from({ length: 7 }).map((_, index) => (
            <View key={`skeleton-${index}`} className="flex-row items-center gap-3 mb-4">
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
        <FlatList
          data={visibleUsers}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 14 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <UserListItem
              profile={item}
              isSelf={Boolean(viewerUserId && item.id === viewerUserId)}
              isFollowing={isFollowingUser(relationsByUserId[item.id], viewerUserId)}
              loading={actionUserId === item.id}
              onPressProfile={() => handleOpenProfile(item.id)}
              onToggleFollow={() => {
                void handleToggleFollow(item.id);
              }}
            />
          )}
          ListEmptyComponent={
            <View className="rounded-2xl border border-dashed border-[#E6DED5] bg-white/80 px-4 py-10 mt-2">
              <Text className="text-sm text-[#3D2E1F] text-center" style={{ fontFamily: fonts.displayBold }}>
                {activeTab === "followers"
                  ? "フォロワーが見つかりません"
                  : "フォロー中のユーザーが見つかりません"}
              </Text>
              <Text className="text-xs text-[#6C5647] text-center mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                {keyword.trim()
                  ? "検索キーワードを変更してください。"
                  : isSelfProfile
                    ? "検索画面から気になるユーザーをフォローしましょう。"
                    : "まだユーザーがいません。"}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
};
