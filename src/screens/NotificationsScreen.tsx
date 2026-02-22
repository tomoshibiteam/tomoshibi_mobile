import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { isSupabaseConfigured } from "@/lib/supabase";
import { fetchNotifications } from "@/services/feed";
import type { NotificationItem } from "@/types/feed";
import { ProfileAvatar } from "@/components/common/ProfileAvatar";

const THUMB_PLACEHOLDER =
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=200&q=80";

type NotificationKind = "play" | "follow" | "like" | "announcement";
type NotificationCard = {
  id: string;
  actorId: string;
  actorName: string;
  actorAvatar: string | null;
  postedAt: string;
  kind: NotificationKind;
  questTitle?: string;
  unread?: boolean;
};

const formatRelativeTime = (value: string | null) => {
  if (!value) return "たった今";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "たった今";
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}日前`;
  return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
};

const isTodayLabel = (label: string) =>
  label === "たった今" || label.includes("分前") || label.includes("時間前");

const fallbackCards: NotificationCard[] = [
  {
    id: "sample-remix",
    actorId: "sample-remix",
    actorName: "ハルト",
    postedAt: "5分前",
    kind: "play",
    questTitle: "港の記憶",
    unread: true,
    actorAvatar: null,
  },
  {
    id: "sample-follow",
    actorId: "sample-follow",
    actorName: "新しいフォロワー",
    postedAt: "3時間前",
    kind: "follow",
    actorAvatar: null,
  },
  {
    id: "sample-like",
    actorId: "sample-like",
    actorName: "ユウキ",
    postedAt: "2日前",
    kind: "like",
    questTitle: "星屑の街",
    actorAvatar: null,
  },
  {
    id: "sample-notice",
    actorId: "sample-notice",
    actorName: "TOMOSHIBI運営",
    postedAt: "3日前",
    kind: "announcement",
    questTitle: "メンテナンスが終了しました",
    actorAvatar: null,
  },
];

export const NotificationsScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { userId, loading: authLoading } = useSessionUserId();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);

  const load = useCallback(
    async (refresh = false) => {
      if (!isSupabaseConfigured) {
        setLoading(false);
        return;
      }

      if (!userId) {
        setItems([]);
        setLoading(false);
        return;
      }

      if (refresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const rows = await fetchNotifications(userId, 32);
        setItems(rows);
      } catch (error) {
        console.error("NotificationsScreen: failed to load", error);
        Alert.alert("通知を読み込めません", "時間をおいて再度お試しください。");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userId]
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const cards: NotificationCard[] = useMemo(() => {
    const mapped: NotificationCard[] = items.map((item, index) => {
      const kind: NotificationKind =
        item.type === "follow" ? "follow" : index % 2 === 0 ? "play" : "like";
      return {
        id: item.id,
        actorId: item.actorId,
        actorName: item.actorName,
        actorAvatar: item.actorAvatar,
        postedAt: formatRelativeTime(item.createdAt),
        kind,
        questTitle: item.message,
        unread: index === 0,
      } satisfies NotificationCard;
    });

    if (mapped.length === 0) return fallbackCards;
    const hasAnnouncement = mapped.some((item) => item.kind === "announcement");
    return hasAnnouncement
      ? mapped
      : [
          ...mapped,
          {
            id: "ops-announcement",
            actorId: "ops-announcement",
            actorName: "TOMOSHIBI運営",
            postedAt: "3日前",
            kind: "announcement",
            questTitle: "メンテナンスが終了しました",
            actorAvatar: null,
          },
        ];
  }, [items]);

  const sections = useMemo(() => {
    const today = cards.filter((card) => isTodayLabel(card.postedAt));
    const week = cards.filter((card) => !isTodayLabel(card.postedAt));
    return [
      { label: "今日", items: today },
      { label: "今週", items: week },
    ].filter((section) => section.items.length > 0);
  }, [cards]);

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
            <Ionicons name="notifications-outline" size={34} color="#EE8C2B" />
          </View>
          <Text className="text-[30px] text-[#221910] mb-2" style={{ fontFamily: fonts.displayBold }}>
            通知
          </Text>
          <Text className="text-sm text-[#6C5647] text-center mb-6" style={{ fontFamily: fonts.bodyRegular }}>
            ログインすると、あなた宛ての通知をここで確認できます。
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
      <View className="px-4 py-3 border-b border-[#EE8C2B]/15 bg-[#F8F7F6] flex-row items-center justify-between">
        <View className="flex-row items-center gap-3">
          <Pressable
            className="w-8 h-8 rounded-full items-center justify-center"
            onPress={() => navigation.navigate("MainTabs", { screen: "Home" })}
          >
            <Ionicons name="arrow-back" size={20} color="#334155" />
          </Pressable>
          <Text className="text-xl text-slate-900" style={{ fontFamily: fonts.displayBold }}>
            通知
          </Text>
        </View>

        <Pressable className="w-8 h-8 rounded-full items-center justify-center">
          <Ionicons name="options-outline" size={16} color="#EE8C2B" />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor="#EE8C2B" />}
      >
        {sections.map((section) => (
          <View key={section.label}>
            <Text
              className="px-5 py-3 text-xs text-slate-400 uppercase tracking-wider"
              style={{ fontFamily: fonts.displayBold }}
            >
              {section.label}
            </Text>

            <View className="px-3">
              {section.items.map((post) => {
                const isUnread = Boolean(post.unread);
                const isAnnouncement = post.kind === "announcement";
                const isFollow = post.kind === "follow";

                const meta = (() => {
                  if (post.kind === "play") {
                    return {
                      icon: "play" as const,
                      badgeBg: "#3B82F6",
                      text: `${post.actorName}さんが「${post.questTitle || "作品"}」をプレイしました`,
                    };
                  }
                  if (post.kind === "follow") {
                    return {
                      icon: "person-add" as const,
                      badgeBg: "#22C55E",
                      text: "新しいフォロワーが1人増えました",
                    };
                  }
                  if (post.kind === "announcement") {
                    return {
                      icon: "megaphone" as const,
                      badgeBg: "#EE8C2B",
                      text: `${post.actorName}からのお知らせ: ${post.questTitle || "最新情報があります"}`,
                    };
                  }
                  return {
                    icon: "heart" as const,
                    badgeBg: "#EC4899",
                    text: `${post.actorName}さんが「${post.questTitle || "作品"}」にいいねしました`,
                  };
                })();

                return (
                  <View
                    key={post.id}
                    className={`relative mb-1 rounded-xl p-4 flex-row items-start gap-4 ${
                      isUnread
                        ? "bg-[#EE8C2B]/10"
                        : isAnnouncement
                          ? "bg-white/70"
                          : "bg-white"
                    }`}
                  >
                    {isUnread && <View className="absolute left-1 top-1/2 -mt-1 h-1.5 w-1.5 rounded-full bg-[#EE8C2B]" />}

                    <View className="relative">
                      {isAnnouncement ? (
                        <View className="w-12 h-12 rounded-full bg-[#EE8C2B]/10 items-center justify-center">
                          <Ionicons name="notifications-outline" size={20} color="#EE8C2B" />
                        </View>
                      ) : isFollow ? (
                        <View className="w-12 h-12 rounded-full bg-slate-100 items-center justify-center">
                          <Ionicons name="person-add-outline" size={20} color="#94A3B8" />
                        </View>
                      ) : (
                        <Pressable onPress={() => navigation.navigate("UserProfile", { userId: post.actorId })}>
                          <ProfileAvatar name={post.actorName} imageUrl={post.actorAvatar} size={48} />
                        </Pressable>
                      )}

                      <View
                        className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-white items-center justify-center"
                        style={{ backgroundColor: meta.badgeBg }}
                      >
                        <Ionicons name={meta.icon} size={10} color="#FFFFFF" />
                      </View>
                    </View>

                    <View className="flex-1 min-w-0">
                      <Text className="text-sm text-slate-900 leading-5" style={{ fontFamily: fonts.bodyRegular }}>
                        {meta.text}
                      </Text>
                      <Text className="mt-1 text-xs text-slate-500" style={{ fontFamily: fonts.bodyRegular }}>
                        {post.postedAt}
                      </Text>
                    </View>

                    {isFollow ? (
                      <Pressable className="px-3 py-1.5 rounded-full bg-[#EE8C2B]/10">
                        <Text className="text-xs text-[#EE8C2B]" style={{ fontFamily: fonts.displayBold }}>
                          確認する
                        </Text>
                      </Pressable>
                    ) : (
                      <Image source={{ uri: THUMB_PLACEHOLDER }} className="w-12 h-12 rounded-lg opacity-90" resizeMode="cover" />
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        <View className="h-12 items-center justify-center flex-row">
          <Ionicons name="notifications-outline" size={16} color="#94A3B8" />
          <Text className="ml-2 text-sm text-slate-400" style={{ fontFamily: fonts.bodyRegular }}>
            すべて読み込みました
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};
