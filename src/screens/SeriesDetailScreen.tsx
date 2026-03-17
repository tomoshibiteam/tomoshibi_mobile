import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RootStackParamList } from "@/navigation/types";
import { fonts } from "@/theme/fonts";
import {
  deleteSeriesEpisode,
  fetchSeriesDetail,
  fetchSeriesEpisodes,
  type SeriesDetail,
  type SeriesEpisode,
  updateSeriesEpisode,
} from "@/services/quests";
import { useSessionUserId } from "@/hooks/useSessionUser";

type Props = NativeStackScreenProps<RootStackParamList, "SeriesDetail">;

type Character = {
  id: string;
  name: string;
  role: string;
  avatarImageUrl: string | null;
  icon: keyof typeof Ionicons.glyphMap;
};

const FALLBACK_COVER =
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1200&q=80";

const pickCharacterIcon = (role: string): keyof typeof Ionicons.glyphMap => {
  const normalized = role.toLowerCase();
  if (/(猫|cat|動物|pet)/i.test(normalized)) return "paw-outline";
  if (/(案内|guide|ナビ|ガイド)/i.test(normalized)) return "compass-outline";
  if (/(探偵|detective|調査|分析)/i.test(normalized)) return "search-outline";
  if (/(医者|doctor|看護|治療)/i.test(normalized)) return "medkit-outline";
  if (/(教授|先生|研究|学者)/i.test(normalized)) return "flask-outline";
  return "person-outline";
};

const statusToLabel = (status: string | null) => {
  const normalized = (status || "").toLowerCase();
  if (normalized === "completed") return "完了";
  if (normalized === "in_progress" || normalized === "published") return "進行中";
  if (normalized === "draft") return "下書き";
  return "未開始";
};

const formatDate = (value: string | null) => {
  if (!value) return "日付不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日付不明";
  return date.toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" });
};

const summarizeEpisodeBody = (body: string, maxLength = 80) => {
  const cleaned = body.replace(/\s+/g, " ").trim();
  if (!cleaned) return "本文はまだありません。";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
};

const normalizeCoverValue = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();
const buildEpisodeFallbackCover = (seriesTitle: string, episode: SeriesEpisode) =>
  `https://picsum.photos/seed/${encodeURIComponent(
    `${seriesTitle}-${String(episode.episodeNo || 1)}-${episode.id}-${episode.title}`
  )}/900/600`;

export const SeriesDetailScreen = ({ navigation, route }: Props) => {
  const { questId } = route.params;
  const { userId: viewerUserId } = useSessionUserId();

  const [loading, setLoading] = useState(true);
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [episodes, setEpisodes] = useState<SeriesEpisode[]>([]);
  const [actionEpisodeId, setActionEpisodeId] = useState<string | null>(null);
  const [editingEpisodeId, setEditingEpisodeId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingBody, setEditingBody] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [seriesRow, episodeRows] = await Promise.all([fetchSeriesDetail(questId), fetchSeriesEpisodes(questId)]);
      setSeries(seriesRow);
      setEpisodes(episodeRows);
    } catch (error) {
      console.error("SeriesDetailScreen: failed to load", error);
      Alert.alert("シリーズを読み込めません", "時間をおいて再度お試しください。");
      setSeries(null);
      setEpisodes([]);
    } finally {
      setLoading(false);
    }
  }, [questId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const title = series?.title || "シリーズ詳細";
  const overview = (series?.description || "").trim() || "シリーズ概要はまだ設定されていません。";
  const coverImageUrl = series?.coverImageUrl || FALLBACK_COVER;
  const canManageSeries = Boolean(viewerUserId && series?.creatorId === viewerUserId);

  const timelineEpisodes = useMemo(() => [...episodes].reverse(), [episodes]);
  const latestEpisode = useMemo(() => {
    if (episodes.length === 0) return null;
    return episodes.reduce<SeriesEpisode>((latest, current) =>
      current.episodeNo > latest.episodeNo ? current : latest,
    episodes[0]);
  }, [episodes]);
  const totalEpisodes = episodes.length;
  const latestEpisodeNo = latestEpisode?.episodeNo || 0;
  const progressLabel = statusToLabel(series?.status || null);
  const resolveEpisodeCover = useCallback(
    (episode: SeriesEpisode) => {
      const episodeCover = normalizeCoverValue(episode.coverImageUrl);
      const seriesCover = normalizeCoverValue(coverImageUrl);
      if (episodeCover && episodeCover !== seriesCover) return episodeCover;
      return buildEpisodeFallbackCover(title, episode);
    },
    [coverImageUrl, title]
  );

  const characters = useMemo<Character[]>(
    () =>
      (series?.characters || []).map((character) => ({
        id: character.id,
        name: character.name,
        role: character.role,
        avatarImageUrl: character.avatarImageUrl,
        icon: pickCharacterIcon(character.role),
      })),
    [series?.characters]
  );

  const startEdit = (episode: SeriesEpisode) => {
    setEditingEpisodeId(episode.id);
    setEditingTitle(episode.title);
    setEditingBody(episode.body);
  };

  const cancelEdit = () => {
    setEditingEpisodeId(null);
    setEditingTitle("");
    setEditingBody("");
  };

  const saveEdit = async (episode: SeriesEpisode) => {
    if (!viewerUserId) {
      navigation.navigate("Auth");
      return;
    }

    if (!editingTitle.trim()) {
      Alert.alert("入力不足", "エピソードタイトルを入力してください。");
      return;
    }

    setActionEpisodeId(episode.id);
    try {
      await updateSeriesEpisode({
        episodeId: episode.id,
        source: episode.source,
        userId: viewerUserId,
        title: editingTitle.trim(),
        body: editingBody.trim(),
      });

      setEpisodes((prev) =>
        prev.map((item) =>
          item.id === episode.id
            ? {
                ...item,
                title: editingTitle.trim(),
                body: editingBody.trim(),
              }
            : item
        )
      );
      cancelEdit();
    } catch (error) {
      console.error("SeriesDetailScreen: failed to update episode", error);
      Alert.alert("更新に失敗しました", "時間をおいて再度お試しください。");
    } finally {
      setActionEpisodeId(null);
    }
  };

  const removeEpisode = (episode: SeriesEpisode) => {
    if (!viewerUserId) {
      navigation.navigate("Auth");
      return;
    }

    Alert.alert("エピソードを削除", "このエピソードを削除しますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          setActionEpisodeId(episode.id);
          try {
            await deleteSeriesEpisode({
              episodeId: episode.id,
              source: episode.source,
              userId: viewerUserId,
              questId,
            });
            setEpisodes((prev) => prev.filter((item) => item.id !== episode.id));
            if (editingEpisodeId === episode.id) {
              cancelEdit();
            }
          } catch (error) {
            console.error("SeriesDetailScreen: failed to delete episode", error);
            const maybeError = error as { code?: string };
            if (maybeError.code === "EPISODE_DELETE_FORBIDDEN") {
              Alert.alert("削除できません", "このエピソードを削除する権限がありません。");
            } else {
              Alert.alert("削除に失敗しました", "時間をおいて再度お試しください。");
            }
          } finally {
            setActionEpisodeId(null);
          }
        },
      },
    ]);
  };

  const handleStartGameplay = () => {
    if (!latestEpisode) return;

    navigation.navigate("GamePlay", {
      questId,
      startEpisodeNo: latestEpisode.episodeNo,
    });
  };

  const handleAddEpisode = () => {
    if (!series) return;

    navigation.navigate("AddEpisode", {
      prefillSeriesId: series.id,
      prefillSeriesTitle: series.title,
    });
  };

  if (loading) {
    return (
      <View className="flex-1 bg-[#F8F7F6] items-center justify-center">
        <ActivityIndicator color="#EE8C2B" />
      </View>
    );
  }

  if (!series) {
    return (
      <View className="flex-1 bg-[#F8F7F6]">
        <SafeAreaView edges={["top"]} className="bg-[#F8F7F6]">
          <View className="h-14 px-4 border-b border-[#ECE6DF] flex-row items-center justify-between">
            <Pressable onPress={() => navigation.goBack()} className="w-9 h-9 items-center justify-center">
              <Ionicons name="arrow-back" size={20} color="#6C5647" />
            </Pressable>
            <Text className="text-base text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
              シリーズ詳細
            </Text>
            <View className="w-9 h-9" />
          </View>
        </SafeAreaView>

        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-lg text-[#221910] mb-2" style={{ fontFamily: fonts.displayBold }}>
            シリーズが見つかりません
          </Text>
          <Text className="text-sm text-[#6C5647] text-center" style={{ fontFamily: fonts.bodyRegular }}>
            非公開、または削除されている可能性があります。
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-[#F8F7F6]">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 120 }}>
        <View className="h-64 relative overflow-hidden">
          <Image source={{ uri: coverImageUrl }} className="absolute inset-0 w-full h-full" resizeMode="cover" />
          <View className="absolute inset-0 bg-black/45" />

          <SafeAreaView edges={["top"]} className="absolute top-0 left-0 right-0 z-10">
            <View className="px-4 py-2 flex-row items-center justify-between">
              <Pressable
                className="w-10 h-10 rounded-full bg-black/25 items-center justify-center"
                onPress={() => navigation.goBack()}
              >
                <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
              </Pressable>

              <Pressable
                className="w-10 h-10 rounded-full bg-black/25 items-center justify-center"
                onPress={() => Alert.alert("準備中", "シリーズメニューは次フェーズで追加予定です。")}
              >
                <Ionicons name="ellipsis-horizontal" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
          </SafeAreaView>

          <View className="absolute bottom-0 left-0 right-0 px-6 pb-6">
            <Text className="text-3xl text-white" style={{ fontFamily: fonts.displayExtraBold }}>
              {title}
            </Text>
            <View className="mt-2 flex-row items-center gap-2">
              <View className="px-2 py-0.5 rounded bg-[#EE8C2B]">
                <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                  {progressLabel}
                </Text>
              </View>
              <Text className="text-xs text-white/90" style={{ fontFamily: fonts.bodyMedium }}>
                エピソード: {totalEpisodes}話 / 最新話: {latestEpisodeNo > 0 ? `第${latestEpisodeNo}話` : "未作成"}
              </Text>
            </View>
          </View>
        </View>

        <View className="bg-white px-6 pt-7 pb-7 border-b border-[#EFE7DD]">
          <View className="mb-8">
            <Text className="text-sm text-[#221910] mb-3 pl-3 border-l-4 border-[#EE8C2B]" style={{ fontFamily: fonts.displayBold }}>
              シリーズ概要
            </Text>
            <Text className="text-sm text-[#4A3E34] leading-7" style={{ fontFamily: fonts.bodyRegular }}>
              {overview}
            </Text>
          </View>

          <View>
            <Text className="text-sm text-[#221910] mb-4 pl-3 border-l-4 border-[#EE8C2B]" style={{ fontFamily: fonts.displayBold }}>
              シリーズ固定の登場人物
            </Text>
            {characters.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 16 }}>
                {characters.map((character) => (
                  <View key={character.id} className="w-24 items-center">
                    <View className="w-16 h-16 rounded-full border border-[#E3DDD6] bg-[#F4F1ED] items-center justify-center overflow-hidden">
                      {character.avatarImageUrl ? (
                        <Image
                          source={{ uri: character.avatarImageUrl }}
                          className="w-full h-full"
                          resizeMode="cover"
                          style={{ transform: [{ scale: 1.12 }] }}
                        />
                      ) : (
                        <Ionicons name={character.icon} size={23} color="#9A9287" />
                      )}
                    </View>
                    <Text className="text-xs text-[#3D3026] mt-2 text-center" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
                      {character.name}
                    </Text>
                    <Text
                      className="text-[10px] text-[#7A746D] mt-0.5 text-center"
                      numberOfLines={2}
                      style={{ fontFamily: fonts.bodyRegular, lineHeight: 14 }}
                    >
                      {character.role}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View className="rounded-xl border border-dashed border-[#E3DDD6] bg-[#FBF9F6] px-4 py-4">
                <Text className="text-[12px] text-[#7A746D]" style={{ fontFamily: fonts.bodyRegular }}>
                  シリーズ固定の登場人物はまだ登録されていません。
                </Text>
              </View>
            )}
          </View>
        </View>

        <View className="px-4 pt-6">
          <View className="mb-10">
            <Text className="text-sm text-[#221910] mb-4 pl-3 border-l-4 border-[#EE8C2B]" style={{ fontFamily: fonts.displayBold }}>
              最新エピソード
            </Text>

            <Pressable
              className="rounded-2xl overflow-hidden border border-[#EFE7DD] bg-white"
              onPress={latestEpisode ? handleStartGameplay : canManageSeries ? handleAddEpisode : undefined}
              style={{
                shadowColor: "#DCC8B5",
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.22,
                shadowRadius: 14,
                elevation: 3,
              }}
            >
              {latestEpisode ? (
                <>
                  <View className="h-32 relative">
                    <Image
                      source={{
                        uri: resolveEpisodeCover(latestEpisode),
                      }}
                      className="w-full h-full"
                      resizeMode="cover"
                    />
                    <View className="absolute inset-0 bg-black/30" />
                    <View className="absolute top-0 right-0 bg-[#EE8C2B] px-3 py-1 rounded-bl-xl">
                      <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                        最新話
                      </Text>
                    </View>
                    <View className="absolute bottom-3 left-4 flex-row items-center gap-1">
                      <Ionicons name="location-outline" size={12} color="#FFFFFF" />
                      <Text className="text-xs text-white" style={{ fontFamily: fonts.bodyMedium }}>
                        {series.areaName || "舞台未設定"}
                      </Text>
                    </View>
                  </View>

                  <View className="p-5">
                    <View className="flex-row items-start gap-4 mb-3">
                      <View className="w-10 h-10 rounded-lg bg-[#FDF2E4] border border-[#EE8C2B]/20 items-center justify-center">
                        <Text className="text-base text-[#EE8C2B]" style={{ fontFamily: fonts.displayBold }}>
                          {latestEpisode.episodeNo}
                        </Text>
                      </View>

                      <View className="flex-1">
                        <Text className="text-[11px] text-[#B9763A] mb-1" style={{ fontFamily: fonts.displayBold }}>
                          第{latestEpisode.episodeNo}話
                        </Text>
                        <Text className="text-xl text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                          {latestEpisode.title}
                        </Text>
                      </View>
                    </View>

                    <View className="rounded-lg bg-[#FFF3E5] border border-[#F8DFC2] px-3.5 py-3 mb-4 flex-row items-start gap-2">
                      <Ionicons name="sparkles" size={14} color="#A8632D" style={{ marginTop: 2 }} />
                      <Text className="text-xs text-[#A8632D] flex-1 leading-5" style={{ fontFamily: fonts.bodyMedium }}>
                        {summarizeEpisodeBody(latestEpisode.body, 95)}
                      </Text>
                    </View>

                    <Text className="text-sm text-[#64584D] leading-6" style={{ fontFamily: fonts.bodyRegular }}>
                      {summarizeEpisodeBody(latestEpisode.body, 120)}
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <View className="h-28 relative">
                    <Image source={{ uri: coverImageUrl }} className="w-full h-full" resizeMode="cover" />
                    <View className="absolute inset-0 bg-black/35" />
                    <View className="absolute top-0 right-0 bg-[#8E8984] px-3 py-1 rounded-bl-xl">
                      <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                        生成待ち
                      </Text>
                    </View>
                  </View>
                  <View className="p-5">
                    <Text className="text-sm text-[#64584D] leading-6" style={{ fontFamily: fonts.bodyRegular }}>
                      このシリーズの既存エピソードはすべてクリア済みです。次の物語を生成して続きを作りましょう。
                    </Text>
                  </View>
                </>
              )}
            </Pressable>
          </View>

          <View className="mb-6">
            <Text className="text-sm text-[#221910] mb-6 pl-3 border-l-4 border-[#D6CDC3]" style={{ fontFamily: fonts.displayBold }}>
              物語の歩み
            </Text>

            {canManageSeries ? (
              <View className="rounded-2xl border border-[#E8DED4] bg-[#FFF7ED] px-4 py-4 mb-4">
                <Text className="text-sm text-[#3D2E1F] mb-2" style={{ fontFamily: fonts.displayBold }}>
                  {latestEpisode
                    ? `第${latestEpisode.episodeNo}話の上に、新しいエピソードを追加しますか？`
                    : "最初のエピソードを追加しますか？"}
                </Text>
                <Pressable
                  className="h-10 rounded-xl bg-[#EE8C2B] items-center justify-center flex-row gap-2"
                  onPress={handleAddEpisode}
                >
                  <Ionicons name="sparkles" size={14} color="#FFFFFF" />
                  <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                    エピソードを追加
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {timelineEpisodes.length === 0 ? (
              <View className="rounded-2xl border border-dashed border-[#E6DED5] bg-white/80 px-4 py-8">
                <Text className="text-sm text-[#3D2E1F] text-center" style={{ fontFamily: fonts.displayBold }}>
                  エピソードはまだありません
                </Text>
                <Text className="text-xs text-[#6C5647] text-center mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                  {canManageSeries ? "上の「エピソードを追加」から開始できます。" : "次回更新をお待ちください。"}
                </Text>
              </View>
            ) : (
              <View className="pl-6">
                <View className="absolute left-2 top-0 bottom-0 w-[2px] bg-[#E1D8CE]" />

                {timelineEpisodes.map((episode) => {
                  const isCurrentEditing = editingEpisodeId === episode.id;
                  const canEdit = canManageSeries && viewerUserId === episode.userId;
                  const canDelete = canManageSeries;

                  return (
                    <View key={episode.id} className="relative mb-5">
                      <View className="absolute -left-4 top-6 w-3 h-3 rounded-full bg-white border-2 border-[#BDB4A9]" />

                      <View className="rounded-xl overflow-hidden border border-[#EFE7DD] bg-white">
                        <View className="flex-row">
                          <View className="w-28 h-32 bg-[#E6DED5] relative">
                            <Image
                              source={{
                                uri: resolveEpisodeCover(episode),
                              }}
                              className="w-full h-full"
                              resizeMode="cover"
                            />
                            <View className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5">
                              <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                                第{String(episode.episodeNo).padStart(2, "0")}話
                              </Text>
                            </View>
                          </View>

                          <View className="flex-1 px-3.5 py-3.5">
                            {isCurrentEditing ? (
                              <View>
                                <TextInput
                                  value={editingTitle}
                                  onChangeText={setEditingTitle}
                                  placeholder="エピソードタイトル"
                                  placeholderTextColor="#A39A90"
                                  className="h-10 rounded-lg border border-[#E5DDD3] bg-[#F1ECE6] px-3 text-sm text-[#221910] mb-2"
                                  style={{ fontFamily: fonts.bodyRegular }}
                                />

                                <TextInput
                                  value={editingBody}
                                  onChangeText={setEditingBody}
                                  placeholder="本文"
                                  placeholderTextColor="#A39A90"
                                  multiline
                                  textAlignVertical="top"
                                  className="min-h-[90px] rounded-lg border border-[#E5DDD3] bg-[#F1ECE6] px-3 py-2 text-sm text-[#221910]"
                                  style={{ fontFamily: fonts.bodyRegular }}
                                />

                                <View className="flex-row items-center justify-end gap-2 mt-3">
                                  <Pressable className="px-3 py-1.5 rounded-lg bg-[#F1ECE6]" onPress={cancelEdit}>
                                    <Text className="text-xs text-[#6C5647]" style={{ fontFamily: fonts.displayBold }}>
                                      キャンセル
                                    </Text>
                                  </Pressable>

                                  <Pressable
                                    className="px-3 py-1.5 rounded-lg bg-[#EE8C2B] min-w-16 items-center"
                                    onPress={() => {
                                      void saveEdit(episode);
                                    }}
                                    disabled={actionEpisodeId === episode.id}
                                  >
                                    {actionEpisodeId === episode.id ? (
                                      <ActivityIndicator size="small" color="#FFFFFF" />
                                    ) : (
                                      <Text className="text-xs text-white" style={{ fontFamily: fonts.displayBold }}>
                                        保存
                                      </Text>
                                    )}
                                  </Pressable>
                                </View>
                              </View>
                            ) : (
                              <>
                                <View className="flex-row items-start justify-between mb-1">
                                  <Text className="text-sm text-[#3D3026] flex-1 pr-2" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
                                    {episode.title}
                                  </Text>
                                  <Text className="text-[10px] text-[#9A9389]" style={{ fontFamily: fonts.bodyRegular }}>
                                    {formatDate(episode.createdAt)}
                                  </Text>
                                </View>

                                <View className="flex-row items-center gap-1 mb-2">
                                  <Ionicons name="location-outline" size={11} color="#7A746D" />
                                  <Text className="text-[10px] text-[#7A746D]" numberOfLines={1} style={{ fontFamily: fonts.bodyRegular }}>
                                    {series.areaName || "舞台未設定"}
                                  </Text>
                                </View>

                                <Text className="text-[11px] text-[#5B4F44] leading-5" numberOfLines={3} style={{ fontFamily: fonts.bodyRegular }}>
                                  {summarizeEpisodeBody(episode.body, 96)}
                                </Text>
                              </>
                            )}

                            {(canEdit || canDelete) && !isCurrentEditing ? (
                              <View className="flex-row items-center justify-end gap-2 mt-3">
                                {canEdit ? (
                                  <Pressable
                                    className="px-3 py-1.5 rounded-lg bg-[#F1ECE6]"
                                    onPress={() => startEdit(episode)}
                                    disabled={actionEpisodeId === episode.id}
                                  >
                                    <Text className="text-xs text-[#6C5647]" style={{ fontFamily: fonts.displayBold }}>
                                      編集
                                    </Text>
                                  </Pressable>
                                ) : null}

                                {canDelete ? (
                                  <Pressable
                                    className="px-3 py-1.5 rounded-lg bg-[#FBE2DC]"
                                    onPress={() => removeEpisode(episode)}
                                    disabled={actionEpisodeId === episode.id}
                                  >
                                    {actionEpisodeId === episode.id ? (
                                      <ActivityIndicator size="small" color="#D64E3B" />
                                    ) : (
                                      <Text className="text-xs text-[#D64E3B]" style={{ fontFamily: fonts.displayBold }}>
                                        削除
                                      </Text>
                                    )}
                                  </Pressable>
                                ) : null}
                              </View>
                            ) : null}
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {latestEpisode ? (
        <SafeAreaView
          edges={["bottom"]}
          className="absolute left-0 right-0 bottom-0 bg-[#F8F7F6] border-t border-[#ECE6DF]"
        >
          <View className="px-4 pt-3 pb-2">
            <Pressable
              className="h-12 rounded-xl bg-[#EE8C2B] items-center justify-center flex-row gap-2"
              style={{
                shadowColor: "#EE8C2B",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.26,
                shadowRadius: 10,
                elevation: 3,
              }}
              onPress={handleStartGameplay}
            >
              <Ionicons name="play" size={15} color="#FFFFFF" />
              <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                第{latestEpisode.episodeNo}話をプレイする
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
};
