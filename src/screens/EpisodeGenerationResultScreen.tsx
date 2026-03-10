import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  applySeriesProgressPatch,
  createEpisodeForSeries,
  saveRuntimeEpisodeSpots,
  type RuntimeSpotCoordinate,
} from "@/services/quests";
import { useSessionUserId } from "@/hooks/useSessionUser";
import type { RootStackParamList } from "@/navigation/types";
import type {
  EpisodeCharacter,
  EpisodeSpot,
  GeneratedRuntimeEpisode,
} from "@/services/seriesAi";
import { fonts } from "@/theme/fonts";
import { geocodeAddress } from "@/lib/geocode";

type Props = NativeStackScreenProps<RootStackParamList, "EpisodeGenerationResult">;

type TabKey = "route" | "overview" | "characters" | "clear";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "route", label: "ルート" },
  { key: "overview", label: "概要" },
  { key: "characters", label: "登場人物" },
  { key: "clear", label: "条件" },
];

const FALLBACK_COVER =
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1200&q=80";
const GOOGLE_MAPS_WEB_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY ??
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ??
  "";

const parseInlineCoords = (value?: string | null): { lat: number; lng: number } | null => {
  const text = (value || "").trim();
  if (!text) return null;
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number.parseFloat(match[1]);
  const lng = Number.parseFloat(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
};

const geocodeSpotCoordinate = async (
  spotName: string,
  stageLocation?: string
): Promise<{ lat: number; lng: number; address: string } | null> => {
  const inline = parseInlineCoords(spotName);
  if (inline) {
    return { ...inline, address: spotName };
  }

  const queries = [
    `${spotName} ${stageLocation || ""}`.trim(),
    spotName.trim(),
    (stageLocation || "").trim(),
  ].filter(Boolean);

  for (const query of queries) {
    try {
      if (Platform.OS === "web") {
        if (!GOOGLE_MAPS_WEB_API_KEY) continue;
        const coords = await geocodeAddress(query, GOOGLE_MAPS_WEB_API_KEY);
        if (coords) {
          return { lat: coords.lat, lng: coords.lng, address: query };
        }
      } else {
        const geocoded = await Location.geocodeAsync(query);
        const first = geocoded.find(
          (item) =>
            Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
        );
        if (first) {
          return { lat: first.latitude, lng: first.longitude, address: query };
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
};

const buildEpisodeBody = (
  runtimeEpisode: GeneratedRuntimeEpisode,
  seriesTitle: string,
  stageLocation?: string,
  stageCoords?: { lat: number; lng: number } | null
): string => {
  const charMap = new Map(
    (runtimeEpisode.characters || []).map((c) => [c.id, c.name])
  );
  const coordsLine =
    stageCoords && Number.isFinite(stageCoords.lat) && Number.isFinite(stageCoords.lng)
      ? `座標: ${stageCoords.lat.toFixed(6)},${stageCoords.lng.toFixed(6)}`
      : null;
  const headerLines = [
    stageLocation ? `舞台: ${stageLocation}` : `舞台: ${seriesTitle}`,
    coordsLine,
  ].filter((line): line is string => Boolean(line));

  const spotBody = (runtimeEpisode.spots || [])
    .map((spot) => {
      const roleLabel = spot.sceneRole ? `【${spot.sceneRole}】` : "";
      const header = `${roleLabel}${spot.spotName}`;
      const narration = spot.sceneNarration || "";
      const blocks = (spot.blocks || [])
        .map((b) => {
          if (b.type === "dialogue") {
            const name =
              (b.speakerId && charMap.get(b.speakerId)) || b.speakerId || "？";
            return `${name}「${b.text}」`;
          }
          if (b.type === "mission") return `▶ ${b.text}`;
          return b.text;
        })
        .join("\n");
      const puzzle = spot.questionText
        ? `\n❓ ${spot.questionText}\n💡 ヒント: ${spot.hintText}\n✅ 答え: ${spot.answerText}\n📖 ${spot.explanationText}`
        : "";
      return `${header}\n\n${narration ? `${narration}\n\n` : ""}${blocks}${puzzle}`;
    })
    .join("\n\n---\n\n");

  return [...headerLines, "", spotBody].filter(Boolean).join("\n");
};

export const EpisodeGenerationResultScreen = ({ navigation, route }: Props) => {
  const {
    runtimeEpisode,
    seriesId,
    seriesTitle,
    coverImageUrl,
    episodeNo,
    stageLocation,
    stageCoords,
  } =
    route.params;
  const { userId } = useSessionUserId();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<TabKey>("route");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const coverUri = coverImageUrl || FALLBACK_COVER;
  const spots = runtimeEpisode.spots || [];
  const characters = runtimeEpisode.characters || [];
  const currentSpot = spots[0];

  const resolveSpotCoordinates = useCallback(async (): Promise<RuntimeSpotCoordinate[]> => {
    const resolved: RuntimeSpotCoordinate[] = [];
    const uniqueByName = new Set<string>();

    for (const spot of runtimeEpisode.spots || []) {
      const name = (spot.spotName || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (uniqueByName.has(key)) continue;
      uniqueByName.add(key);

      const geocoded = await geocodeSpotCoordinate(name, stageLocation);
      if (geocoded) {
        resolved.push({
          spotName: name,
          lat: geocoded.lat,
          lng: geocoded.lng,
          address: geocoded.address,
        });
        continue;
      }

      if (
        stageCoords &&
        Number.isFinite(stageCoords.lat) &&
        Number.isFinite(stageCoords.lng)
      ) {
        resolved.push({
          spotName: name,
          lat: stageCoords.lat,
          lng: stageCoords.lng,
          address: stageLocation || name,
        });
      }
    }

    return resolved;
  }, [runtimeEpisode.spots, stageLocation, stageCoords]);

  const handleSave = useCallback(async () => {
    if (!userId || !seriesId) {
      Alert.alert("保存できません", "ログインが必要です。");
      return;
    }
    setIsSubmitting(true);
    try {
      const episodeBody = buildEpisodeBody(
        runtimeEpisode,
        seriesTitle,
        stageLocation,
        stageCoords
      );
      const result = await createEpisodeForSeries({
        userId,
        seriesId,
        seriesTitle,
        episodeTitle: runtimeEpisode.title,
        episodeText: episodeBody,
      });

      try {
        const spotCoordinates = await resolveSpotCoordinates();
        await saveRuntimeEpisodeSpots({
          questId: result.questId,
          userId,
          episodeNo:
            (result.storage === "quest_episodes" ? result.episodeNo : undefined) ||
            episodeNo ||
            undefined,
          runtimeEpisode,
          stageLocation,
          stageCoords,
          spotCoordinates,
        });
      } catch (spotSaveError) {
        console.warn("EpisodeGenerationResult: saveRuntimeEpisodeSpots warning", spotSaveError);
      }

      if (runtimeEpisode.progressPatch && result.questId) {
        try {
          await applySeriesProgressPatch({
            questId: result.questId,
            userId,
            savedEpisodeNo:
              result.storage === "quest_episodes" ? result.episodeNo : undefined,
            progressPatch: runtimeEpisode.progressPatch,
          });
        } catch {
          // ignore
        }
      }

      Alert.alert(
        "エピソードを保存しました",
        `「${result.questTitle}」に追加しました。`,
        [
          {
            text: "確認する",
            onPress: () =>
              navigation.replace("SeriesDetail", { questId: result.questId }),
          },
        ]
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Alert.alert("保存に失敗しました", msg);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    userId,
    seriesId,
    seriesTitle,
    runtimeEpisode,
    stageLocation,
    stageCoords,
    resolveSpotCoordinates,
    navigation,
  ]);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View className="flex-1 bg-[#F8F7F6]">
      <View className="flex-1">
        {/* Header with cover */}
        <View className="h-48 overflow-hidden">
          <ImageBackground
            source={{ uri: coverUri }}
            className="flex-1"
            resizeMode="cover"
            style={{ opacity: 0.9 }}
          >
            <View className="absolute inset-0 bg-[#221910]/40" />
            <SafeAreaView edges={["top"]} className="absolute top-0 left-0 right-0 flex-row justify-between px-4 pt-2">
              <Pressable
                onPress={handleBack}
                className="w-9 h-9 rounded-full bg-black/30 items-center justify-center"
              >
                <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
              </Pressable>
            </SafeAreaView>
            <View className="absolute bottom-0 left-0 right-0 px-5 pb-3 pt-8 bg-[#F8F7F6]/90">
              <View className="flex-row items-center gap-2 mb-1">
                {episodeNo != null && (
                  <View className="bg-[#EE8C2B] px-2 py-0.5 rounded">
                    <Text
                      className="text-[10px] text-white font-bold"
                      style={{ fontFamily: fonts.displayBold }}
                    >
                      Ep.{String(episodeNo).padStart(2, "0")}
                    </Text>
                  </View>
                )}
                <View className="flex-row items-center gap-1 bg-[#EFE6DD]/80 px-2 py-0.5 rounded-full">
                  <Ionicons name="time-outline" size={12} color="#9A734C" />
                  <Text
                    className="text-[10px] text-[#9A734C]"
                    style={{ fontFamily: fonts.bodyMedium }}
                  >
                    {runtimeEpisode.estimatedDurationMinutes}分
                  </Text>
                </View>
              </View>
              <Text
                className="text-lg text-[#221910]"
                style={{ fontFamily: fonts.displayBold }}
                numberOfLines={1}
              >
                {runtimeEpisode.title}
              </Text>
              {runtimeEpisode.oneLiner ? (
                <Text
                  className="text-xs text-[#9A734C] mt-0.5"
                  style={{ fontFamily: fonts.bodyRegular }}
                  numberOfLines={1}
                >
                  「{runtimeEpisode.oneLiner}」
                </Text>
              ) : null}
            </View>
          </ImageBackground>
        </View>

        {/* Tab bar */}
        <View className="flex-row border-b border-[#EFE6DD] bg-[#F8F7F6] px-2">
          {TABS.map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              className="flex-1 py-3 items-center"
              style={{
                borderBottomWidth: 2,
                borderBottomColor:
                  activeTab === tab.key ? "#EE8C2B" : "transparent",
              }}
            >
              <Text
                className="text-sm"
                style={{
                  fontFamily:
                    activeTab === tab.key ? fonts.displayBold : fonts.bodyMedium,
                  color: activeTab === tab.key ? "#EE8C2B" : "#9A734C",
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Tab content */}
        <ScrollView
          className="flex-1 bg-[#EFE6DD]/30"
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          {activeTab === "route" && (
            <RouteTab spots={spots} characters={characters} currentSpot={currentSpot} />
          )}
          {activeTab === "overview" && (
            <OverviewTab runtimeEpisode={runtimeEpisode} />
          )}
          {activeTab === "characters" && (
            <CharactersTab characters={characters} />
          )}
          {activeTab === "clear" && (
            <ClearTab runtimeEpisode={runtimeEpisode} />
          )}
        </ScrollView>
      </View>

      {/* Bottom save bar */}
      <View
        className="absolute bottom-0 left-0 right-0 px-4 pb-6 pt-3 bg-[#F8F7F6]/95"
        style={{ paddingBottom: insets.bottom + 24 }}
      >
        <View className="flex-row items-center gap-3 max-w-sm mx-auto">
          <Pressable
            onPress={handleBack}
            className="w-12 h-12 rounded-full border border-[#ECE6DF] bg-white items-center justify-center"
          >
            <Ionicons name="arrow-back" size={20} color="#9A734C" />
          </Pressable>
          <Pressable
            onPress={handleSave}
            disabled={isSubmitting}
            className="flex-1 h-12 rounded-full bg-[#EE8C2B] items-center justify-center flex-row gap-2"
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="book" size={18} color="#FFFFFF" />
                <Text
                  className="text-sm text-white font-bold"
                  style={{ fontFamily: fonts.displayBold }}
                >
                  物語を保存する
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
};

function RouteTab({
  spots,
  currentSpot,
}: {
  spots: EpisodeSpot[];
  characters: EpisodeCharacter[];
  currentSpot?: EpisodeSpot;
}) {
  return (
    <View className="p-4">
      {/* Route diagram - simplified list */}
      <View className="bg-[#E8E4E1] rounded-xl overflow-hidden mb-4 border border-[#E3D6C9]">
        <View className="p-4">
          {spots.map((spot, index) => (
            <View key={index} className="flex-row items-center gap-3 mb-3 last:mb-0">
              <View className="w-8 h-8 rounded-full bg-white items-center justify-center border-2 border-[#EE8C2B]">
                <Ionicons name="location" size={14} color="#EE8C2B" />
              </View>
              <View className="flex-1">
                <Text
                  className="text-sm font-bold text-[#221910]"
                  style={{ fontFamily: fonts.displayBold }}
                >
                  {spot.spotName}
                </Text>
                <Text
                  className="text-[10px] text-[#9A734C]"
                  style={{ fontFamily: fonts.bodyRegular }}
                >
                  {spot.sceneRole} · {spot.sceneObjective?.slice(0, 30)}
                  {spot.sceneObjective && spot.sceneObjective.length > 30
                    ? "…"
                    : ""}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* Current spot card */}
      {currentSpot && (
        <View className="mb-4">
          <View className="flex-row items-center gap-2 mb-2">
            <View className="w-1.5 h-1.5 rounded-full bg-[#EE8C2B]" />
            <Text
              className="text-xs text-[#9A734C] font-bold"
              style={{ fontFamily: fonts.displayBold }}
            >
              最初のスポット
            </Text>
          </View>
          <View className="bg-white rounded-xl border border-[#ECE6DF] overflow-hidden">
            <View className="p-4">
              <View className="flex-row justify-between items-start mb-2">
                <Text
                  className="text-base font-bold text-[#221910]"
                  style={{ fontFamily: fonts.displayBold }}
                >
                  {currentSpot.spotName}
                </Text>
                <View className="bg-[#EFE6DD] px-2 py-0.5 rounded">
                  <Text
                    className="text-[10px] text-[#9A734C] font-bold"
                    style={{ fontFamily: fonts.displayBold }}
                  >
                    {currentSpot.sceneRole}
                  </Text>
                </View>
              </View>
              {currentSpot.sceneNarration ? (
                <Text
                  className="text-xs text-[#6C5647] leading-5 italic"
                  style={{ fontFamily: fonts.bodyRegular }}
                  numberOfLines={3}
                >
                  「{currentSpot.sceneNarration}」
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function OverviewTab({
  runtimeEpisode,
}: {
  runtimeEpisode: GeneratedRuntimeEpisode;
}) {
  return (
    <View className="p-5">
      <View className="bg-white rounded-xl border border-[#ECE6DF] p-5 mb-4">
        <Text
          className="text-base font-bold text-[#221910] mb-3 pb-2 border-b border-[#EFE6DD]"
          style={{ fontFamily: fonts.displayBold }}
        >
          あらすじ
        </Text>
        <Text
          className="text-sm text-[#6C5647] leading-6 mb-4"
          style={{ fontFamily: fonts.bodyRegular }}
        >
          {runtimeEpisode.summary}
        </Text>
        {runtimeEpisode.carryOverHook ? (
          <View className="bg-[#F8F7F6] p-3 rounded-lg border border-[#EFE6DD]">
            <Text
              className="text-xs text-[#9A734C]"
              style={{ fontFamily: fonts.bodyRegular }}
            >
              <Text style={{ fontFamily: fonts.displayBold }}>次回への伏線: </Text>
              {runtimeEpisode.carryOverHook}
            </Text>
          </View>
        ) : null}
      </View>

      <View className="gap-3">
        <View className="bg-white p-4 rounded-r-xl border-l-4 border-[#EE8C2B]/50 border border-[#ECE6DF]">
          <Text
            className="text-[10px] text-[#EE8C2B] font-bold mb-1"
            style={{ fontFamily: fonts.displayBold }}
          >
            前提 (Premise)
          </Text>
          <Text
            className="text-xs text-[#6C5647] leading-5"
            style={{ fontFamily: fonts.bodyRegular }}
          >
            {runtimeEpisode.mainPlot?.premise || "—"}
          </Text>
        </View>
        <View className="bg-white p-4 rounded-r-xl border-l-4 border-[#221910]/50 border border-[#ECE6DF]">
          <Text
            className="text-[10px] text-[#221910] font-bold mb-1"
            style={{ fontFamily: fonts.displayBold }}
          >
            目的 (Goal)
          </Text>
          <Text
            className="text-xs text-[#6C5647] leading-5"
            style={{ fontFamily: fonts.bodyRegular }}
          >
            {runtimeEpisode.mainPlot?.goal || "—"}
          </Text>
        </View>
      </View>
    </View>
  );
}

function CharactersTab({ characters }: { characters: EpisodeCharacter[] }) {
  return (
    <View className="p-5">
      <View className="mb-4">
        <Text
          className="text-base font-bold text-[#221910]"
          style={{ fontFamily: fonts.displayBold }}
        >
          主要人物
        </Text>
        <Text
          className="text-xs text-[#9A734C] mt-0.5"
          style={{ fontFamily: fonts.bodyRegular }}
        >
          この物語の鍵を握るキャラクターたち
        </Text>
      </View>
      <View className="gap-4">
        {characters.map((char, index) => (
          <View
            key={char.id}
            className="bg-white rounded-xl overflow-hidden border border-[#ECE6DF] flex-row h-24"
          >
            <View className="w-20 bg-[#E5DFD7] items-center justify-center">
              <Ionicons name="person" size={28} color="#9A734C" />
            </View>
            <View className="flex-1 p-3 justify-center">
              <Text
                className="text-[10px] text-[#EE8C2B] font-bold mb-0.5"
                style={{ fontFamily: fonts.displayBold }}
              >
                {char.role.toUpperCase()}
              </Text>
              <Text
                className="text-base font-bold text-[#221910]"
                style={{ fontFamily: fonts.displayBold }}
              >
                {char.name}
              </Text>
              {char.personality ? (
                <Text
                  className="text-xs text-[#9A734C] mt-1"
                  style={{ fontFamily: fonts.bodyRegular }}
                  numberOfLines={2}
                >
                  {char.personality}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function ClearTab({
  runtimeEpisode,
}: {
  runtimeEpisode: GeneratedRuntimeEpisode;
}) {
  const conditions = useMemo(() => {
    const text = (runtimeEpisode.completionCondition || "").trim();
    if (!text) return ["主要スポットを巡り、物語を完結させる。"];
    const byNewline = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (byNewline.length > 1) return byNewline;
    const byPeriod = text.split(/[。]+/).map((s) => s.trim()).filter(Boolean);
    return byPeriod.length > 0 ? byPeriod : [text];
  }, [runtimeEpisode.completionCondition]);

  return (
    <View className="p-5">
      <View className="bg-white rounded-xl border border-[#ECE6DF] overflow-hidden">
        <View className="bg-[#EFE6DD]/50 p-4 border-b border-[#ECE6DF] flex-row items-center gap-2">
          <Ionicons name="trophy" size={20} color="#EE8C2B" />
          <Text
            className="text-sm font-bold text-[#221910]"
            style={{ fontFamily: fonts.displayBold }}
          >
            クリア条件
          </Text>
        </View>
        <View className="p-4">
          {conditions.map((item, index) => (
            <View key={index} className="flex-row items-start gap-3 mb-3 last:mb-0">
              <View className="w-5 h-5 rounded-full bg-[#EE8C2B]/10 items-center justify-center mt-0.5">
                <Text
                  className="text-[10px] font-bold text-[#EE8C2B]"
                  style={{ fontFamily: fonts.displayBold }}
                >
                  {index + 1}
                </Text>
              </View>
              <Text
                className="flex-1 text-sm text-[#221910]"
                style={{ fontFamily: fonts.bodyMedium }}
              >
                {item}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
