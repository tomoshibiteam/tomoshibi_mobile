import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import { fonts } from "@/theme/fonts";
import { useSessionUserId } from "@/hooks/useSessionUser";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  createEpisodeForSeries,
  createQuestDraft,
  fetchMySeriesOptions,
  fetchSeriesEpisodes,
  type SeriesOption,
} from "@/services/quests";
import type { RootStackParamList } from "@/navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "AddEpisode">;

type Purpose = "歴史探訪" | "謎解き" | "散策" | "グルメ" | "デート";

type SelectableSeries = {
  key: string;
  id: string | null;
  title: string;
  description: string | null;
  areaName: string | null;
  coverImageUrl: string | null;
  status: string | null;
  source: "supabase" | "local";
};

type DraftRow = {
  title?: unknown;
  overview?: unknown;
};

const SERIES_OPTIONS_KEY = "tomoshibi.seriesOptions";
const SELECTED_SERIES_KEY = "tomoshibi.selectedSeries";
const SERIES_DRAFTS_KEY = "tomoshibi.seriesDrafts";

const PURPOSE_OPTIONS: Purpose[] = ["歴史探訪", "謎解き", "散策", "グルメ", "デート"];

const FALLBACK_SERIES = ["港の記憶", "昭和レトロ探訪", "週末の小さな冒険"];
const FALLBACK_OVERVIEWS: Record<string, string> = {
  港の記憶: "港町に眠る過去の断片を辿りながら、失われた記憶を取り戻す物語。",
  昭和レトロ探訪: "昭和の面影が残る街並みを巡り、時代を超えた手がかりを集めるシリーズ。",
  週末の小さな冒険: "身近な街角を舞台に、週末ごとに新しい発見を楽しむ短編シリーズ。",
};
const FALLBACK_EPISODE_LOGS: Record<string, Array<{ text: string; active: boolean }>> = {
  港の記憶: [
    { text: "EP.1『錆びついた鍵』クリア済 | 第3倉庫周辺", active: true },
    { text: "EP.2『波音のメッセージ』進行中 | 灯台エリア", active: false },
  ],
  昭和レトロ探訪: [
    { text: "EP.1『路面電車の遺言』クリア済 | 商店街北通り", active: true },
    { text: "EP.2『映画館の暗号』未着手 | 駅前シネマ街", active: false },
  ],
  週末の小さな冒険: [
    { text: "EP.1『朝焼けの遊歩道』クリア済 | 川沿い遊歩道", active: true },
    { text: "EP.2『公園の秘密地図』進行中 | 中央公園エリア", active: false },
  ],
};

const normalizeTitle = (value: string) => value.trim().toLowerCase();

const seriesToSelectable = (series: SeriesOption): SelectableSeries => ({
  key: `supabase:${series.id}`,
  id: series.id,
  title: series.title,
  description: series.description,
  areaName: series.areaName,
  coverImageUrl: series.coverImageUrl,
  status: series.status,
  source: "supabase",
});

const loadLocalSeries = async (): Promise<SelectableSeries[]> => {
  try {
    const [rawOptions, rawDrafts] = await Promise.all([
      AsyncStorage.getItem(SERIES_OPTIONS_KEY),
      AsyncStorage.getItem(SERIES_DRAFTS_KEY),
    ]);

    const parsedOptions = rawOptions ? (JSON.parse(rawOptions) as unknown) : [];
    const optionTitles = Array.isArray(parsedOptions)
      ? parsedOptions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];

    const parsedDrafts = rawDrafts ? (JSON.parse(rawDrafts) as unknown) : {};
    const draftMap =
      parsedDrafts && typeof parsedDrafts === "object" && !Array.isArray(parsedDrafts)
        ? (parsedDrafts as Record<string, DraftRow>)
        : {};

    const mergedTitles = Array.from(new Set([...optionTitles, ...Object.keys(draftMap)]));

    return mergedTitles.map((title, index) => {
      const draft = draftMap[title];
      const overview = typeof draft?.overview === "string" ? draft.overview : null;
      return {
        key: `local:${index}:${title}`,
        id: null,
        title,
        description: overview,
        areaName: null,
        coverImageUrl: null,
        status: null,
        source: "local",
      } satisfies SelectableSeries;
    });
  } catch (error) {
    console.warn("AddEpisodeScreen: failed to load local series", error);
    return [];
  }
};

const fallbackSeriesRows = (): SelectableSeries[] =>
  FALLBACK_SERIES.map((title, index) => ({
    key: `fallback:${index}:${title}`,
    id: null,
    title,
    description: FALLBACK_OVERVIEWS[title] || null,
    areaName: null,
    coverImageUrl: null,
    status: null,
    source: "local",
  }));

const buildGeneratedEpisodeTitle = (purpose: Purpose, stageLocation: string) => {
  const compact = stageLocation.replace(/\s+/g, " ").trim().slice(0, 14);
  return `${compact || "旅路"}の${purpose}`;
};

const buildGeneratedEpisodeBody = (seriesTitle: string, purpose: Purpose, stageLocation: string) => {
  return [
    `${seriesTitle}の新章。`,
    "",
    `舞台: ${stageLocation}`,
    `目的: ${purpose}`,
    "",
    "土地に眠る手がかりを辿りながら、次の真実へと物語を進める。",
  ].join("\n");
};

const currentGeolocation = () => {
  const navigatorLike = globalThis as {
    navigator?: {
      geolocation?: {
        getCurrentPosition: (
          success: (position: { coords: { latitude: number; longitude: number } }) => void,
          error?: () => void,
          options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }
        ) => void;
      };
    };
  };
  return navigatorLike.navigator?.geolocation;
};

export const AddEpisodeScreen = ({ navigation, route }: Props) => {
  const { userId } = useSessionUserId();
  const prefillSeriesId = route.params?.prefillSeriesId ?? null;
  const prefillSeriesTitle = route.params?.prefillSeriesTitle ?? "";

  const [seriesOptions, setSeriesOptions] = useState<SelectableSeries[]>(fallbackSeriesRows());
  const [selectedSeriesKey, setSelectedSeriesKey] = useState<string | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesLogsLoading, setSeriesLogsLoading] = useState(false);
  const [seriesSelectorOpen, setSeriesSelectorOpen] = useState(false);

  const [stageLocation, setStageLocation] = useState("横浜赤レンガ倉庫");
  const [purpose, setPurpose] = useState<Purpose>("歴史探訪");
  const [isLocating, setIsLocating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const [selectedSeriesEpisodeLogs, setSelectedSeriesEpisodeLogs] = useState<Array<{ text: string; active: boolean }>>(
    []
  );

  const selectedSeries = useMemo(
    () => seriesOptions.find((item) => item.key === selectedSeriesKey) || seriesOptions[0] || null,
    [seriesOptions, selectedSeriesKey]
  );

  const selectedSeriesOverview = useMemo(() => {
    if (!selectedSeries) return "シリーズを選択してください。";
    return (
      selectedSeries.description ||
      FALLBACK_OVERVIEWS[selectedSeries.title] ||
      "このシリーズの概要はまだ設定されていません。シリーズ新規作成画面で概要を登録できます。"
    );
  }, [selectedSeries]);

  const loadSeriesOptions = useCallback(async () => {
    setSeriesLoading(true);

    try {
      const [localRows, selectedStoredTitle] = await Promise.all([
        loadLocalSeries(),
        AsyncStorage.getItem(SELECTED_SERIES_KEY),
      ]);

      const supabaseRows =
        isSupabaseConfigured && userId
          ? (await fetchMySeriesOptions(userId, 60)).map(seriesToSelectable)
          : ([] as SelectableSeries[]);

      const merged: SelectableSeries[] = [];
      const seenTitles = new Set<string>();

      supabaseRows.forEach((row) => {
        const normalized = normalizeTitle(row.title);
        if (seenTitles.has(normalized)) return;
        seenTitles.add(normalized);
        merged.push(row);
      });

      localRows.forEach((row) => {
        const normalized = normalizeTitle(row.title);
        if (seenTitles.has(normalized)) return;
        seenTitles.add(normalized);
        merged.push(row);
      });

      const nextOptions = merged.length > 0 ? merged : fallbackSeriesRows();
      setSeriesOptions(nextOptions);

      let nextSelected = nextOptions[0]?.key ?? null;

      if (prefillSeriesId) {
        const byId = nextOptions.find((row) => row.id === prefillSeriesId);
        if (byId) nextSelected = byId.key;
      }

      const preferredTitle = prefillSeriesTitle.trim() || (selectedStoredTitle || "").trim();
      if (preferredTitle.length > 0) {
        const byTitle = nextOptions.find((row) => normalizeTitle(row.title) === normalizeTitle(preferredTitle));
        if (byTitle) nextSelected = byTitle.key;
      }

      setSelectedSeriesKey(nextSelected);
    } catch (error) {
      console.error("AddEpisodeScreen: failed to load series options", error);
      setSeriesOptions(fallbackSeriesRows());
      setSelectedSeriesKey(fallbackSeriesRows()[0]?.key || null);
    } finally {
      setSeriesLoading(false);
    }
  }, [prefillSeriesId, prefillSeriesTitle, userId]);

  useFocusEffect(
    useCallback(() => {
      void loadSeriesOptions();
    }, [loadSeriesOptions])
  );

  useEffect(() => {
    const selected = selectedSeries;
    if (!selected) {
      setSelectedSeriesEpisodeLogs([]);
      return;
    }

    if (!stageLocation.trim()) {
      setStageLocation(selected.areaName || "横浜赤レンガ倉庫");
    }

    const hydrateLogs = async () => {
      setSeriesLogsLoading(true);
      try {
        if (selected.id) {
          const rows = await fetchSeriesEpisodes(selected.id);
          if (rows.length === 0) {
            setSelectedSeriesEpisodeLogs([
              {
                text: "まだ公開済みエピソードはありません",
                active: false,
              },
            ]);
            return;
          }

          const logs = rows
            .slice(0, 4)
            .map((episode, index) => ({
              text: `EP.${episode.episodeNo}『${episode.title}』${index === 0 ? "最新" : "公開済"}`,
              active: index === 0,
            }))
            .reverse();

          setSelectedSeriesEpisodeLogs(logs);
          return;
        }

        setSelectedSeriesEpisodeLogs(
          FALLBACK_EPISODE_LOGS[selected.title] || [
            {
              text: "まだ公開済みエピソードはありません",
              active: false,
            },
          ]
        );
      } catch (error) {
        console.warn("AddEpisodeScreen: failed to load episode logs", error);
        setSelectedSeriesEpisodeLogs([
          {
            text: "エピソード状況を読み込めませんでした",
            active: false,
          },
        ]);
      } finally {
        setSeriesLogsLoading(false);
      }
    };

    void hydrateLogs();
  }, [selectedSeries]);

  const handleSelectSeries = async (item: SelectableSeries) => {
    setSelectedSeriesKey(item.key);
    setSeriesSelectorOpen(false);
    await AsyncStorage.setItem(SELECTED_SERIES_KEY, item.title).catch((error) => {
      console.warn("AddEpisodeScreen: failed to persist selected series", error);
    });
  };

  const handleUseCurrentLocation = () => {
    const geolocation = currentGeolocation();

    if (!geolocation) {
      Alert.alert("現在地を取得できません", "この端末では位置情報が利用できません。");
      return;
    }

    setIsLocating(true);
    geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lng = position.coords.longitude.toFixed(6);
        setStageLocation(`${lat},${lng}`);
        setIsLocating(false);
      },
      () => {
        setIsLocating(false);
        Alert.alert("位置情報の取得に失敗しました", "位置情報の許可設定をご確認ください。");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleGenerateEpisode = async () => {
    if (!selectedSeries) {
      Alert.alert("シリーズを選択してください", "追加先のシリーズを選択してください。");
      return;
    }

    if (!stageLocation.trim()) {
      Alert.alert("舞台を入力してください", "場所を指定すると、よりリアルなエピソードを生成できます。");
      return;
    }

    if (!isSupabaseConfigured) {
      Alert.alert("設定が必要です", "Supabase設定が未完了です。");
      return;
    }

    if (!userId) {
      navigation.navigate("Auth");
      return;
    }

    setIsGenerating(true);

    try {
      let targetSeriesId = selectedSeries.id;
      const targetSeriesTitle = selectedSeries.title;

      if (!targetSeriesId) {
        targetSeriesId = await createQuestDraft({
          creatorId: userId,
          title: targetSeriesTitle,
          description: selectedSeriesOverview,
          areaName: selectedSeries.areaName || stageLocation.trim(),
          coverImageUrl: selectedSeries.coverImageUrl,
        });
      }

      const episodeTitle = buildGeneratedEpisodeTitle(purpose, stageLocation);
      const episodeBody = buildGeneratedEpisodeBody(targetSeriesTitle, purpose, stageLocation);

      const result = await createEpisodeForSeries({
        userId,
        seriesId: targetSeriesId,
        seriesTitle: targetSeriesTitle,
        episodeTitle,
        episodeText: episodeBody,
      });

      Alert.alert("エピソードを生成しました", `「${result.questTitle}」に新しいエピソードを追加しました。`, [
        {
          text: "確認する",
          onPress: () => navigation.replace("SeriesDetail", { questId: result.questId }),
        },
      ]);
    } catch (error) {
      const codedError = error as { code?: string };
      if (codedError?.code === "SERIES_NOT_FOUND") {
        Alert.alert("シリーズが見つかりません", "シリーズを再選択して再度お試しください。");
      } else {
        console.error("AddEpisodeScreen: failed to generate episode", error);
        Alert.alert("生成に失敗しました", "時間をおいて再度お試しください。");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <View className="flex-1 bg-[#F8F7F6]">
      <SafeAreaView edges={["top"]} className="bg-[#F8F7F6]">
        <View className="h-14 px-4 border-b border-[#ECE6DF] flex-row items-center justify-between">
          <Pressable onPress={() => navigation.goBack()} className="w-9 h-9 rounded-full items-center justify-center">
            <Ionicons name="arrow-back" size={20} color="#6C5647" />
          </Pressable>
          <Text className="text-base text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
            エピソードを追加
          </Text>
          <View className="w-9 h-9" />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 130 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="px-5 pt-6 pb-4">
            <Text className="text-sm text-[#5E554C] mb-3" style={{ fontFamily: fonts.displayBold }}>
              追加先のシリーズ
            </Text>

            <Pressable
              className="h-12 rounded-xl border border-[#ECE6DF] bg-white px-4 flex-row items-center justify-between"
              onPress={() => setSeriesSelectorOpen(true)}
            >
              <Text className="text-sm text-[#2B1E16] flex-1 pr-4" numberOfLines={1} style={{ fontFamily: fonts.bodyMedium }}>
                {selectedSeries?.title || "シリーズを選択"}
              </Text>
              {seriesLoading ? (
                <ActivityIndicator size="small" color="#EE8C2B" />
              ) : (
                <Ionicons name="chevron-down" size={18} color="#8A7B6C" />
              )}
            </Pressable>

            <View className="mt-4 rounded-xl border border-[#ECE6DF] bg-white overflow-hidden">
              <View className="p-4 flex-row gap-3 border-b border-[#EFE9E3]">
                <View className="w-16 h-16 rounded-lg bg-[#E5DFD7] items-center justify-center overflow-hidden">
                  {selectedSeries?.coverImageUrl ? (
                    <Image source={{ uri: selectedSeries.coverImageUrl }} className="w-full h-full" resizeMode="cover" />
                  ) : (
                    <Ionicons name="book-outline" size={22} color="#8A7B6C" />
                  )}
                </View>

                <View className="flex-1">
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 pr-3">
                      <Text className="text-xs text-[#8A7B6C] mb-0.5" style={{ fontFamily: fonts.bodyRegular }}>
                        現在選択中
                      </Text>
                      <Text className="text-base text-[#221910]" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
                        {selectedSeries?.title || "シリーズ未選択"}
                      </Text>
                    </View>
                    <Ionicons name="checkmark-circle" size={20} color="#EE8C2B" />
                  </View>

                  <Text className="mt-2 text-xs text-[#5C4D40] leading-5" style={{ fontFamily: fonts.bodyRegular }}>
                    {selectedSeriesOverview}
                  </Text>
                </View>
              </View>

              <View className="px-4 py-3 bg-[#F8F7F6]">
                <View className="flex-row items-center gap-2 mb-2">
                  <Ionicons name="time-outline" size={14} color="#9B8B7B" />
                  <Text className="text-xs text-[#8A7B6C]" style={{ fontFamily: fonts.displayBold }}>
                    過去のエピソード状況
                  </Text>
                </View>

                {seriesLogsLoading ? (
                  <View className="py-3">
                    <ActivityIndicator size="small" color="#EE8C2B" />
                  </View>
                ) : (
                  <View className="gap-2">
                    {selectedSeriesEpisodeLogs.map((item, index) => (
                      <View key={`${item.text}-${index}`} className="flex-row items-start gap-2">
                        <View className={`mt-1.5 w-1.5 h-1.5 rounded-full ${item.active ? "bg-[#EE8C2B]" : "bg-[#D0C4B6]"}`} />
                        <Text className="text-xs text-[#6C5647] leading-5 flex-1" style={{ fontFamily: fonts.bodyRegular }}>
                          {item.text}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>
          </View>

          <View className="px-5 py-4 border-t border-[#EFE9E3]">
            <Text className="text-sm text-[#5E554C] mb-3" style={{ fontFamily: fonts.displayBold }}>
              今回の舞台（場所）
            </Text>

            <View className="flex-row gap-2">
              <View className="flex-1 h-12 rounded-xl border border-[#ECE6DF] bg-white px-3 flex-row items-center">
                <Ionicons name="search" size={16} color="#9B8B7B" />
                <TextInput
                  value={stageLocation}
                  onChangeText={setStageLocation}
                  placeholder="場所名や住所を入力"
                  placeholderTextColor="#9B8B7B"
                  className="flex-1 ml-2 text-sm text-[#221910]"
                  style={{ fontFamily: fonts.bodyRegular }}
                />
              </View>

              <Pressable
                onPress={handleUseCurrentLocation}
                disabled={isLocating}
                className="w-12 h-12 rounded-xl border border-[#ECE6DF] bg-white items-center justify-center"
              >
                {isLocating ? (
                  <ActivityIndicator size="small" color="#EE8C2B" />
                ) : (
                  <Ionicons name="navigate" size={18} color="#EE8C2B" />
                )}
              </Pressable>
            </View>

            <Text className="mt-2 text-xs text-[#8A7B6C]" style={{ fontFamily: fonts.bodyRegular }}>
              具体的な場所を指定すると、よりリアルな描写が生成されます
            </Text>

            <View className="mt-3 rounded-xl border border-[#ECE6DF] bg-white overflow-hidden">
              <View className="h-52 bg-[#EFE7DD] items-center justify-center px-6">
                <Ionicons name="map-outline" size={30} color="#A38F7C" />
                <Text className="text-sm text-[#5E554C] mt-2 text-center" style={{ fontFamily: fonts.bodyMedium }}>
                  {stageLocation.trim() || "場所を入力するとプレビューされます"}
                </Text>
              </View>
            </View>
          </View>

          <View className="px-5 py-4 border-t border-[#EFE9E3]">
            <Text className="text-sm text-[#5E554C] mb-3" style={{ fontFamily: fonts.displayBold }}>
              エピソードの目的
            </Text>

            <View className="flex-row flex-wrap gap-2">
              {PURPOSE_OPTIONS.map((item) => {
                const active = item === purpose;
                return (
                  <Pressable
                    key={item}
                    onPress={() => setPurpose(item)}
                    className={`px-4 py-2.5 rounded-full border ${
                      active ? "border-[#EE8C2B] bg-[#EE8C2B]" : "border-[#E3D6C9] bg-white"
                    }`}
                  >
                    <Text
                      className={`text-sm ${active ? "text-white" : "text-[#6C5647]"}`}
                      style={{ fontFamily: fonts.bodyMedium }}
                    >
                      {item}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>

        <SafeAreaView edges={["bottom"]} className="bg-[#F8F7F6] border-t border-[#ECE6DF]">
          <View className="px-5 pt-3 pb-2">
            <Pressable
              onPress={() => {
                void handleGenerateEpisode();
              }}
              disabled={isGenerating}
              className="h-14 rounded-2xl bg-[#EE8C2B] items-center justify-center flex-row gap-2"
              style={{
                shadowColor: "#EE8C2B",
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.3,
                shadowRadius: 12,
                elevation: 4,
              }}
            >
              {isGenerating ? (
                <>
                  <ActivityIndicator color="#FFFFFF" />
                  <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                    生成中...
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons name="sparkles" size={16} color="#FFFFFF" />
                  <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                    AIでエピソードを生成
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>

      <Modal visible={seriesSelectorOpen} transparent animationType="slide" onRequestClose={() => setSeriesSelectorOpen(false)}>
        <View className="flex-1 justify-end bg-black/45">
          <Pressable className="absolute inset-0" onPress={() => setSeriesSelectorOpen(false)} />
          <View className="rounded-t-3xl bg-white px-5 pt-4 pb-8 max-h-[80%]">
            <View className="w-12 h-1.5 rounded-full bg-[#E7DDD2] self-center mb-5" />
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-lg text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                追加先シリーズ
              </Text>
              <Pressable
                className="w-8 h-8 rounded-full bg-[#F6F0E8] items-center justify-center"
                onPress={() => setSeriesSelectorOpen(false)}
              >
                <Ionicons name="close" size={16} color="#8E8072" />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View className="gap-2 pb-4">
                {seriesOptions.map((item) => {
                  const active = item.key === selectedSeries?.key;
                  return (
                    <Pressable
                      key={item.key}
                      className={`rounded-xl border px-4 py-3 ${
                        active ? "border-[#EE8C2B] bg-[#FFF6EC]" : "border-[#ECE6DF] bg-[#FCFAF8]"
                      }`}
                      onPress={() => {
                        void handleSelectSeries(item);
                      }}
                    >
                      <View className="flex-row items-start justify-between gap-3">
                        <View className="flex-1">
                          <Text className="text-sm text-[#2B1E16]" style={{ fontFamily: fonts.displayBold }}>
                            {item.title}
                          </Text>
                          <Text className="text-xs text-[#7A6F63] mt-1" numberOfLines={2} style={{ fontFamily: fonts.bodyRegular }}>
                            {item.description || item.areaName || "シリーズ"}
                          </Text>
                        </View>
                        {active ? <Ionicons name="checkmark-circle" size={19} color="#EE8C2B" /> : null}
                      </View>
                    </Pressable>
                  );
                })}

                <Pressable
                  className="rounded-xl border border-dashed border-[#E3D6C9] bg-white px-4 py-3 flex-row items-center justify-center gap-2"
                  onPress={() => {
                    setSeriesSelectorOpen(false);
                    navigation.navigate("CreateSeries");
                  }}
                >
                  <Ionicons name="add-circle-outline" size={17} color="#EE8C2B" />
                  <Text className="text-sm text-[#EE8C2B]" style={{ fontFamily: fonts.displayBold }}>
                    新しいシリーズを作成
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};
