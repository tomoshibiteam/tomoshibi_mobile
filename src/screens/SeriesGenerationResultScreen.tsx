import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, ImageBackground, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createQuestDraft,
  findReusableSeriesDraft,
  saveSeriesBlueprint,
  updateQuestDraftMetadata,
} from "@/services/quests";
import { useSessionUserId } from "@/hooks/useSessionUser";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { RootStackParamList } from "@/navigation/types";
import type { GeneratedSeriesCharacter, GeneratedSeriesDraft } from "@/services/seriesAi";
import { fonts } from "@/theme/fonts";

type Props = NativeStackScreenProps<RootStackParamList, "SeriesGenerationResult">;

type ResultTabKey = "overview" | "characters";

const SERIES_OPTIONS_KEY = "tomoshibi.seriesOptions";
const SELECTED_SERIES_KEY = "tomoshibi.selectedSeries";
const SERIES_DRAFTS_KEY = "tomoshibi.seriesDrafts";

const RESULT_TABS: Array<{ key: ResultTabKey; label: string }> = [
  { key: "overview", label: "概要" },
  { key: "characters", label: "登場人物" },
];

type CharacterTone = {
  accent: string;
  accentSoft: string;
  glow: string;
};

const CHARACTER_TONES: CharacterTone[] = [
  { accent: "#FF9F43", accentSoft: "#FFE7D0", glow: "rgba(255, 159, 67, 0.25)" },
  { accent: "#54A0FF", accentSoft: "#DDEBFF", glow: "rgba(84, 160, 255, 0.25)" },
  { accent: "#FF6B6B", accentSoft: "#FFD9D9", glow: "rgba(255, 107, 107, 0.25)" },
  { accent: "#A29BFE", accentSoft: "#E7E5FF", glow: "rgba(162, 155, 254, 0.25)" },
];

const normalizeText = (value?: string | null, fallback = "未設定") => {
  const cleaned = (value || "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
};

const stripAlphabetFromName = (name: string) =>
  name
    .replace(/\s*[（(]\s*[A-Za-z\s]+\s*[）)]\s*/g, "")
    .replace(/\s*[/／]\s*[A-Za-z\s]+$/g, "")
    .replace(/\s+[A-Za-z][A-Za-z\s]+$/g, "")
    .trim();

const buildSeedFallbackImageUrl = (seedBase: string, width: number, height: number) =>
  `https://picsum.photos/seed/${encodeURIComponent((seedBase || "tomoshibi").slice(0, 80))}/${Math.max(120, width)}/${Math.max(120, height)}`;

const persistSeriesDraftLocally = async (generated: GeneratedSeriesDraft, sourcePrompt: string) => {
  const trimmedPrompt = sourcePrompt.trim();
  const trimmedTitle = generated.title.trim();
  if (!trimmedPrompt || !trimmedTitle) {
    throw new Error("シリーズの保存情報が不足しています。");
  }

  const rawOptions = await AsyncStorage.getItem(SERIES_OPTIONS_KEY);
  const parsedOptions = rawOptions ? (JSON.parse(rawOptions) as unknown) : [];
  const options = Array.isArray(parsedOptions)
    ? parsedOptions.filter((item): item is string => typeof item === "string")
    : [];

  if (!options.includes(trimmedTitle)) {
    options.push(trimmedTitle);
  }

  await AsyncStorage.setItem(SERIES_OPTIONS_KEY, JSON.stringify(options));
  await AsyncStorage.setItem(SELECTED_SERIES_KEY, trimmedTitle);

  const rawDrafts = await AsyncStorage.getItem(SERIES_DRAFTS_KEY);
  const parsedDrafts = rawDrafts ? (JSON.parse(rawDrafts) as unknown) : {};
  const drafts =
    parsedDrafts && typeof parsedDrafts === "object" && !Array.isArray(parsedDrafts)
      ? (parsedDrafts as Record<string, unknown>)
      : {};

  drafts[trimmedTitle] = {
    title: trimmedTitle,
    overview: generated.overview,
    aiRules: generated.aiRules,
    characters: generated.characters,
    coverImagePrompt: generated.coverImagePrompt || null,
    coverImageUrl: generated.coverImageUrl || null,
    genre: generated.genre || null,
    tone: generated.tone || null,
    premise: generated.premise || null,
    seasonGoal: generated.seasonGoal || null,
    world: generated.world || null,
    continuity: generated.continuity || null,
    coverFocusCharacters: generated.coverFocusCharacters || [],
    identityPack: generated.identityPack || null,
    coverConsistencyReport: generated.coverConsistencyReport || null,
    checkpoints: generated.checkpoints || [],
    firstEpisodeSeed: generated.firstEpisodeSeed || null,
    progressState: generated.progressState || null,
    episodeBlueprints: generated.episodeBlueprints || [],
    workflowVersion: generated.workflowVersion || null,
    sourcePrompt: trimmedPrompt,
    updatedAt: new Date().toISOString(),
  };

  await AsyncStorage.setItem(SERIES_DRAFTS_KEY, JSON.stringify(drafts));
};

const pickCharacterEmoji = (character: GeneratedSeriesCharacter, index: number) => {
  const source = `${character.role} ${character.name}`.toLowerCase();
  if (source.includes("猫") || source.includes("ねこ")) return "🐈";
  if (source.includes("店") || source.includes("マスター") || source.includes("喫茶")) return "☕️";
  if (source.includes("旅") || source.includes("案内")) return "🧭";
  if (source.includes("探偵") || source.includes("捜査")) return "🕵️";
  if (source.includes("研究") || source.includes("教授")) return "📚";
  return index % 2 === 0 ? "✨" : "🌙";
};

const splitParagraphs = (...texts: Array<string | null | undefined>) =>
  texts
    .map((item) => normalizeText(item, "").trim())
    .filter(Boolean)
    .flatMap((item) =>
      item
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
    );

const formatDateLabel = () => {
  const text = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return text.replace(/\//g, ".");
};

const pickCharacterTone = (index: number) => CHARACTER_TONES[index % CHARACTER_TONES.length];
const PROTAGONIST_ROLE_PATTERN = /(主人公|主役|メイン|語り手|protagonist|hero|lead|main character|mc)/i;
const COMPANION_ROLE_PATTERN = /(相棒|バディ|相方|同行|旅の相手|伴走|partner|buddy|companion|guide|案内)/i;
const COMPANION_RELATION_PATTERN = /(相棒|バディ|同行|伴走|支える|旅を共に|partner|buddy|companion|guide)/i;

const isProtagonistRole = (role?: string | null) => PROTAGONIST_ROLE_PATTERN.test(normalizeText(role, ""));
const isCompanionRole = (role?: string | null) => COMPANION_ROLE_PATTERN.test(normalizeText(role, ""));

const sortCharactersForDisplay = (characters: GeneratedSeriesCharacter[]) =>
  characters
    .map((character, index) => ({ character, index }))
    .sort((a, b) => {
      const aPriority = isProtagonistRole(a.character.role) ? 0 : 1;
      const bPriority = isProtagonistRole(b.character.role) ? 0 : 1;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.index - b.index;
    })
    .map((item) => item.character);

const buildCharacterTags = (character: GeneratedSeriesCharacter) => {
  const relationTexts = (character.relationshipHooks || [])
    .map((hook) => normalizeText(hook?.relation, ""))
    .filter(Boolean);
  const sources = [character.role, ...relationTexts]
    .map((value) => normalizeText(value, ""))
    .filter(Boolean)
    .flatMap((value) =>
      value
        .split(/[、,・/／\s]+/)
        .map((part) => part.trim())
        .filter(Boolean)
    );

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const tag = source.replace(/[「」『』()（）]/g, "").trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    unique.push(`#${tag}`);
    if (unique.length >= 3) break;
  }

  if (unique.length > 0) return unique;
  const fallback = normalizeText(character.role, "人物");
  return [`#${fallback}`];
};

const resolveCompanionCharacterIndex = (characters: GeneratedSeriesCharacter[]) => {
  if (characters.length === 0) return -1;

  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  characters.forEach((character, index) => {
    const roleText = normalizeText(character.role, "");
    const relationTexts = (character.relationshipHooks || [])
      .map((hook) => normalizeText(hook?.relation, ""))
      .filter(Boolean);
    let score = 0;
    if (isCompanionRole(roleText)) score += 120;
    if (relationTexts.some((item) => COMPANION_RELATION_PATTERN.test(item))) {
      score += 40;
    }
    if (character.mustAppear) score += 24;
    if (character.isKeyPerson) score += 8;
    if (isProtagonistRole(roleText)) score -= 28;
    score -= index * 0.01;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  if (bestIndex >= 0 && bestScore > 0) return bestIndex;

  const fallbackNonProtagonist = characters.findIndex((character) => !isProtagonistRole(character.role));
  if (fallbackNonProtagonist >= 0) return fallbackNonProtagonist;
  return 0;
};

export const SeriesGenerationResultScreen = ({ navigation, route }: Props) => {
  const { generated, sourcePrompt, imagesPreloaded } = route.params;
  const { userId } = useSessionUserId();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<ResultTabKey>("overview");
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  const [failedPortraits, setFailedPortraits] = useState<Record<string, boolean>>({});
  const [characterSlideIndex, setCharacterSlideIndex] = useState(0);
  const [imagesReady, setImagesReady] = useState(Boolean(imagesPreloaded));

  const dateLabel = useMemo(() => formatDateLabel(), []);
  const orderedCharacters = useMemo(() => sortCharactersForDisplay(generated.characters), [generated.characters]);
  const companionCharacterIndex = useMemo(
    () => resolveCompanionCharacterIndex(orderedCharacters),
    [orderedCharacters]
  );
  const companionCharacter = useMemo(
    () => (companionCharacterIndex >= 0 ? orderedCharacters[companionCharacterIndex] : null),
    [companionCharacterIndex, orderedCharacters]
  );

  const storyParagraphs = useMemo(() => {
    const paragraphs = splitParagraphs(generated.overview, generated.premise);
    if (paragraphs.length > 0) return paragraphs;
    return ["あらすじ情報はまだ生成されていません。"];
  }, [generated.overview, generated.premise]);

  const settingRows = useMemo(
    () => [
      { label: "ジャンル", value: normalizeText(generated.genre, "未設定") },
      { label: "トーン", value: normalizeText(generated.tone, "未設定") },
      { label: "シーズンゴール", value: normalizeText(generated.seasonGoal, "未設定") },
    ],
    [generated.genre, generated.seasonGoal, generated.tone]
  );

  const characterPageWidth = Math.max(1, width);
  const characterCardWidth = Math.min(380, Math.max(300, width - 56));

  const handleAdopt = useCallback(async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    let localSaveError: Error | null = null;

    try {
      try {
        await persistSeriesDraftLocally(generated, sourcePrompt);
      } catch (error) {
        localSaveError = error instanceof Error ? error : new Error(String(error));
        console.error("SeriesGenerationResultScreen: local series save failed", error);
      }

      if (isSupabaseConfigured && userId) {
        try {
          const reusableDraft = await findReusableSeriesDraft({
            userId,
            sourcePrompt,
            titleCandidate: generated.title,
          });

          const draft = reusableDraft
            ? {
                questId: reusableDraft.questId,
                seriesId: reusableDraft.seriesId,
              }
            : await createQuestDraft({
                creatorId: userId,
                title: generated.title,
                description: generated.overview,
                areaName: generated.world?.setting || null,
                coverImageUrl: generated.coverImageUrl || null,
              });

          if (reusableDraft) {
            await updateQuestDraftMetadata({
              questId: draft.questId,
              seriesId: draft.seriesId,
              userId,
              title: generated.title,
              description: generated.overview,
              areaName: generated.world?.setting || null,
              coverImageUrl: generated.coverImageUrl || null,
            });
          }

          await saveSeriesBlueprint({
            questId: draft.questId,
            seriesId: draft.seriesId,
            userId,
            sourcePrompt,
            generated,
          });
        } catch (questError) {
          const errorMessage = questError instanceof Error ? questError.message : String(questError);
          const errorDetail = (questError as { code?: string; details?: string })?.details || "";
          console.error("SeriesGenerationResultScreen: createQuestDraft/saveSeriesBlueprint failed", questError);
          const localSaveHint = localSaveError
            ? "\n\nローカル保存にも失敗しているため、「ローカルのみで続ける」は利用できません。"
            : "";
          Alert.alert(
            "シリーズの保存に失敗しました",
            `Supabaseへの保存時にエラーが発生しました。\n\n${errorMessage}${errorDetail ? `\n${errorDetail}` : ""}\n\nSupabase SQL Editorで quests テーブルのINSERTポリシーが設定されているか確認してください。\n\nsupabase/sql/20260301_quests_insert_policy.sql を実行してください。${localSaveHint}`,
            localSaveError
              ? [{ text: "OK", style: "cancel" }]
              : [
                  { text: "OK", style: "cancel" },
                  {
                    text: "ローカルのみで続ける",
                    onPress: () => {
                      navigation.replace("AddEpisode", {
                        prefillSeriesTitle: generated.title || "新しいシリーズ",
                      });
                    },
                  },
                ]
          );
          setIsSubmitting(false);
          return;
        }
      }

      if (!userId && isSupabaseConfigured) {
        Alert.alert(
          "ログインすると同期できます",
          "今回はローカル下書きとして利用します。ログイン後にクラウド同期できます。"
        );
      }

      if (localSaveError && (!isSupabaseConfigured || !userId)) {
        throw localSaveError;
      }

      navigation.reset({
        index: 0,
        routes: [{ name: "MainTabs", params: { screen: "Profile" } }],
      });
    } catch (error) {
      console.error("SeriesGenerationResultScreen: failed to adopt generated series", error);
      const msg = error instanceof Error ? error.message : String(error);
      Alert.alert("保存に失敗しました", `${msg}\n\n時間をおいて再度お試しください。`);
    } finally {
      setIsSubmitting(false);
    }
  }, [generated, isSubmitting, navigation, sourcePrompt, userId]);

  const handleRetry = useCallback(() => {
    navigation.replace("CreateSeries", { prefillPrompt: sourcePrompt });
  }, [navigation, sourcePrompt]);

  const renderCharacterAvatar = (character: GeneratedSeriesCharacter, index: number, size: number) => {
    const portraitKey = `${character.id || index}-${character.name}`;
    const portraitUri = failedPortraits[portraitKey] ? "" : character.portraitImageUrl || "";

    if (!portraitUri) {
      return (
        <View className="items-center justify-center rounded-full bg-[#F4F1ED] border border-[#E8DED2]" style={{ width: size, height: size }}>
          <Text style={{ fontSize: Math.floor(size * 0.5) }}>{pickCharacterEmoji(character, index)}</Text>
        </View>
      );
    }

    return (
      <View className="rounded-full overflow-hidden bg-[#F4F1ED] border border-[#E8DED2]" style={{ width: size, height: size }}>
        <Image
          source={{ uri: portraitUri }}
          className="w-full h-full"
          resizeMode="cover"
          onError={() =>
            setFailedPortraits((prev) => ({
              ...prev,
              [portraitKey]: true,
            }))
          }
        />
      </View>
    );
  };

  const renderOverviewTab = () => {
    const genre = settingRows.find((row) => row.label === "ジャンル")?.value || "未設定";
    const tone = settingRows.find((row) => row.label === "トーン")?.value || "未設定";
    const seasonGoal = settingRows.find((row) => row.label === "シーズンゴール")?.value || "未設定";
    const charactersThumb =
      orderedCharacters[0]?.portraitImageUrl ||
      buildSeedFallbackImageUrl(`${generated.title}-characters-thumb`, 640, 400);
    const storyLead = `「${normalizeText(generated.genre, "物語")}の世界で、${normalizeText(orderedCharacters[0]?.name, "主人公")}が真実を追う」`;

    return (
      <View className="px-4 pt-4 pb-6 gap-6">
        <View className="gap-3">
          <View className="flex-row gap-3">
            <View className="flex-1 rounded-2xl border border-[#EFE6DD] bg-white p-4 overflow-hidden">
              <View className="absolute -right-4 -top-4 w-16 h-16 rounded-full bg-[#DFECFF]" />
              <View className="w-8 h-8 rounded-lg bg-[#EEF4FF] items-center justify-center mb-3">
                <Ionicons name="film-outline" size={18} color="#3B82F6" />
              </View>
              <Text className="text-[10px] text-[#8B8177] tracking-[0.8px] mb-1" style={{ fontFamily: fonts.displayBold }}>
                ジャンル
              </Text>
              <Text className="text-sm text-[#221910] leading-5" style={{ fontFamily: fonts.displayBold }}>
                {genre}
              </Text>
            </View>

            <View className="flex-1 rounded-2xl border border-[#EFE6DD] bg-white p-4 overflow-hidden">
              <View className="absolute -right-4 -top-4 w-16 h-16 rounded-full bg-[#FFF0DA]" />
              <View className="w-8 h-8 rounded-lg bg-[#FFF6E8] items-center justify-center mb-3">
                <Ionicons name="color-palette-outline" size={18} color="#D97706" />
              </View>
              <Text className="text-[10px] text-[#8B8177] tracking-[0.8px] mb-1" style={{ fontFamily: fonts.displayBold }}>
                トーン
              </Text>
              <Text className="text-sm text-[#221910] leading-5" style={{ fontFamily: fonts.displayBold }}>
                {tone}
              </Text>
            </View>
          </View>

          <View className="rounded-2xl border border-[#EFE6DD] bg-white p-4 overflow-hidden">
            <View className="absolute -right-8 -bottom-8 w-24 h-24 rounded-full bg-[#EE8C2B]/10" />
            <View className="flex-row items-center gap-4">
              <View className="w-10 h-10 rounded-lg bg-[#EE8C2B]/10 items-center justify-center">
                <Ionicons name="flag-outline" size={22} color="#EE8C2B" />
              </View>
              <View className="flex-1">
                <Text className="text-[10px] text-[#8B8177] tracking-[0.8px] mb-0.5" style={{ fontFamily: fonts.displayBold }}>
                  シーズンゴール
                </Text>
                <Text className="text-base text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                  {seasonGoal}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View className="rounded-2xl border border-[#EFE6DD] bg-white p-6 overflow-hidden">
          <View className="absolute top-0 right-0 w-32 h-32 rounded-bl-full bg-[#EE8C2B]/10" />
          <View className="flex-row items-center gap-2 mb-4">
            <Ionicons name="book-outline" size={20} color="#EE8C2B" />
            <Text className="text-xs text-[#EE8C2B] tracking-[0.9px]" style={{ fontFamily: fonts.displayBold }}>
              物語のあらすじ
            </Text>
          </View>
          <Text className="text-xl text-[#221910] leading-9 mb-5" style={{ fontFamily: fonts.displayBold }}>
            {storyLead}
          </Text>
          <View className="gap-4">
            {storyParagraphs.slice(0, 2).map((paragraph, index) => (
              <Text key={`overview-story-${index}`} className="text-sm text-[#62584E] leading-7" style={{ fontFamily: fonts.bodyMedium }}>
                {paragraph}
              </Text>
            ))}
          </View>
        </View>

        <View className="pb-8">
          <Pressable onPress={() => setActiveTab("characters")} className="rounded-2xl overflow-hidden" style={{ aspectRatio: 1.9 }}>
            <Image source={{ uri: charactersThumb }} className="absolute inset-0 w-full h-full" resizeMode="cover" />
            <View className="absolute inset-0 bg-black/45" />
            <View className="absolute left-3 right-3 bottom-3">
              <Text className="text-[10px] text-white/80 mb-1 tracking-[0.8px]" style={{ fontFamily: fonts.displayBold }}>
                Characters
              </Text>
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                  登場人物を見る
                </Text>
                <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
              </View>
            </View>
          </Pressable>
        </View>
      </View>
    );
  };

  const renderCharactersTab = () => (
    <View className="pt-4 pb-6 gap-4">
      {orderedCharacters.length === 0 ? (
        <View className="mx-4 rounded-2xl border border-[#EFE6DD] bg-white p-5">
          <Text className="text-sm text-[#62584E]" style={{ fontFamily: fonts.bodyRegular }}>
            登場人物はまだ生成されていません。
          </Text>
        </View>
      ) : (
        <>
          <View className="mx-4 rounded-2xl border border-[#EFE6DD] bg-white px-4 py-3.5">
            <View className="flex-row items-center gap-2 mb-1">
              <Ionicons name="people-outline" size={18} color="#EE8C2B" />
              <Text className="text-lg text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                登場人物
              </Text>
            </View>
            <Text className="text-xs text-[#62584E]" style={{ fontFamily: fonts.bodyRegular }}>
              役割と関係性を中心に、物語の主要人物を確認できます。
            </Text>
            {companionCharacter ? (
              <Text className="text-xs text-[#9A734C] mt-1.5" style={{ fontFamily: fonts.displayBold }}>
                あなたの相棒: {stripAlphabetFromName(normalizeText(companionCharacter.name, "未設定"))}
              </Text>
            ) : null}
          </View>

          <ScrollView
            className="-mx-4"
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            disableIntervalMomentum
            snapToInterval={characterPageWidth}
            contentContainerStyle={{ paddingBottom: 8 }}
            onMomentumScrollEnd={({ nativeEvent }) => {
              const next = Math.round(nativeEvent.contentOffset.x / characterPageWidth);
              const safe = Math.max(0, Math.min(orderedCharacters.length - 1, next));
              setCharacterSlideIndex(safe);
            }}
          >
            {orderedCharacters.map((character, index) => {
              const tone = pickCharacterTone(index);
              const cardKey = `${character.id || index}-${character.name}`;
              const isCompanion = index === companionCharacterIndex;
              const relation = normalizeText(
                character.relationshipHooks?.[0]?.relation,
                "他の登場人物との関係性は未設定です。"
              );
              const role = normalizeText(character.role, "主要人物");
              const tags = isCompanion
                ? ["#あなたの相棒", ...buildCharacterTags(character)].slice(0, 4)
                : buildCharacterTags(character);
              const portraitUri = failedPortraits[cardKey] ? "" : character.portraitImageUrl || "";

              return (
                <View
                  key={cardKey}
                  className="items-center px-4"
                  style={{ width: characterPageWidth }}
                >
                  <View
                    className="rounded-2xl overflow-hidden border border-[#EFE6DD] bg-white"
                    style={{
                      width: characterCardWidth,
                      shadowColor: "#000000",
                      shadowOffset: { width: 0, height: 10 },
                      shadowOpacity: 0.1,
                      shadowRadius: 24,
                      elevation: 6,
                    }}
                  >
                    <View className="absolute top-0 left-0 h-full w-1.5" style={{ backgroundColor: tone.accent }} />
                    <View className="absolute -top-24 -right-24 w-56 h-56 rounded-full" style={{ backgroundColor: tone.glow }} />

                    <View className="p-6">
                      <View className="items-center">
                        <View
                          className="w-32 h-32 rounded-full p-1 mb-4"
                          style={{
                            backgroundColor: tone.accentSoft,
                            shadowColor: tone.accent,
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.3,
                            shadowRadius: 10,
                            elevation: 4,
                          }}
                        >
                          <View className="w-full h-full rounded-full overflow-hidden border-2 border-white bg-[#F4F1ED]">
                            {portraitUri ? (
                              <Image
                                source={{ uri: portraitUri }}
                                className="w-full h-full"
                                resizeMode="cover"
                                onError={() =>
                                  setFailedPortraits((prev) => ({
                                    ...prev,
                                    [cardKey]: true,
                                  }))
                                }
                              />
                            ) : (
                              <View className="w-full h-full items-center justify-center">
                                <Text style={{ fontSize: 48 }}>{pickCharacterEmoji(character, index)}</Text>
                              </View>
                            )}
                          </View>
                        </View>

                        <Text className="text-3xl text-[#221910] mb-4" style={{ fontFamily: fonts.displayExtraBold }}>
                          {stripAlphabetFromName(normalizeText(character.name, `人物${index + 1}`))}
                        </Text>

                        {isCompanion ? (
                          <View className="mb-3 px-3 py-1.5 rounded-full border border-[#F5D4AF] bg-[#FFF4E7] flex-row items-center gap-1.5">
                            <Ionicons name="sparkles-outline" size={13} color="#B86921" />
                            <Text className="text-[11px] text-[#B86921]" style={{ fontFamily: fonts.displayBold }}>
                              あなたの相棒
                            </Text>
                          </View>
                        ) : null}

                        <View className="flex-row flex-wrap justify-center gap-2 mb-6">
                          {tags.map((tag, tagIndex) => (
                            <View
                              key={`${cardKey}-tag-${tagIndex}`}
                              className="px-2.5 py-1 rounded-2xl bg-[#F3F1EE]"
                              style={{ maxWidth: "100%" }}
                            >
                              <Text
                                className="text-xs text-[#62584E] leading-4 text-center"
                                style={{ fontFamily: fonts.bodyMedium, flexShrink: 1 }}
                              >
                                {tag}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>

                      <View className="rounded-xl border border-[#EFE6DD] bg-[#FCFBFA] p-4 mb-4">
                        <View className="flex-row items-start gap-2.5">
                          <Ionicons name="person-outline" size={17} color={tone.accent} style={{ marginTop: 1 }} />
                          <View className="flex-1">
                            <Text className="text-[11px] text-[#221910] mb-0.5" style={{ fontFamily: fonts.displayBold }}>
                              役割
                            </Text>
                            <Text className="text-xs text-[#62584E] leading-5" style={{ fontFamily: fonts.bodyRegular }}>
                              {role}
                            </Text>
                          </View>
                        </View>

                        <View className="mt-3 pt-3 border-t border-dashed border-[#E6DED5] flex-row items-start gap-2.5">
                          <Ionicons name="people-outline" size={17} color={tone.accent} style={{ marginTop: 1 }} />
                          <View className="flex-1">
                            <Text className="text-[11px] text-[#221910] mb-0.5" style={{ fontFamily: fonts.displayBold }}>
                              関係性
                            </Text>
                            <Text className="text-xs text-[#62584E] leading-5" style={{ fontFamily: fonts.bodyRegular }}>
                              {relation}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View className="flex-row justify-center items-center gap-2 mt-2 px-6">
            {orderedCharacters.slice(0, 8).map((_, index) => {
              const active = index === characterSlideIndex;
              const tone = pickCharacterTone(characterSlideIndex);
              return (
                <View
                  key={`character-indicator-${index}`}
                  className={`rounded-full ${active ? "w-6 h-1.5" : "w-1.5 h-1.5"}`}
                  style={{ backgroundColor: active ? tone.accent : "#D6D0C8" }}
                />
              );
            })}
          </View>
        </>
      )}
    </View>
  );

  const coverImageUri = heroImageFailed ? "" : generated.coverImageUrl || "";

  const allImageUris = useMemo(() => {
    const uris: string[] = [];
    if (coverImageUri) uris.push(coverImageUri);
    for (const character of orderedCharacters) {
      if (character.portraitImageUrl) uris.push(character.portraitImageUrl);
    }
    return uris.filter(Boolean);
  }, [coverImageUri, orderedCharacters]);

  const [loadedCount, setLoadedCount] = useState(0);
  const totalImages = allImageUris.length;
  const loadingProgress = totalImages > 0 ? Math.min(1, loadedCount / totalImages) : 1;

  const LOADING_MESSAGES = useMemo(() => [
    "シリーズカバーを読み込んでいます...",
    "登場人物カード用のポートレートを読み込んでいます...",
    "表示データを整えています...",
    "仕上げています...",
  ], []);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

  useEffect(() => {
    if (imagesReady) return;
    const interval = setInterval(() => {
      setLoadingMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [imagesReady, LOADING_MESSAGES.length]);

  useEffect(() => {
    if (imagesReady) return;
    if (totalImages === 0) {
      setImagesReady(true);
      return;
    }

    let cancelled = false;
    let completed = 0;

    const onDone = () => {
      completed += 1;
      if (!cancelled) setLoadedCount(completed);
      if (!cancelled && completed >= totalImages) {
        setImagesReady(true);
      }
    };

    for (const uri of allImageUris) {
      Image.prefetch(uri)
        .then(() => onDone())
        .catch(() => onDone());
    }

    const timer = setTimeout(() => {
      if (!cancelled) setImagesReady(true);
    }, 25000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [totalImages, allImageUris]);

  if (!imagesReady) {
    return (
      <View className="flex-1 bg-[#2E1D13] items-center justify-center px-8">
        <View className="absolute top-20 left-8 w-24 h-24 rounded-full bg-[#D88338]/20" />
        <View className="absolute bottom-24 right-10 w-32 h-32 rounded-full bg-[#9E673C]/20" />
        <View className="w-28 h-28 rounded-full border border-[#DCA16A]/35 items-center justify-center mb-8">
          <Ionicons name="flame" size={44} color="#F4E2CF" />
        </View>
        <Text className="text-xl text-[#F2E8DC] tracking-[3px]" style={{ fontFamily: fonts.displayBold }}>
          仕上げ中です...
        </Text>
        <Text className="text-sm text-[#D6B899] mt-3 text-center" style={{ fontFamily: fonts.bodyRegular }}>
          {LOADING_MESSAGES[loadingMessageIndex]}
        </Text>
        <View className="w-full mt-10">
          <View className="h-1 w-full rounded-full bg-[#4A3525] overflow-hidden">
            <View
              className="h-full rounded-full bg-[#D97B2E]"
              style={{ width: `${Math.max(5, Math.round(loadingProgress * 100))}%` }}
            />
          </View>
          <Text className="text-[10px] text-[#9E7E60] text-center mt-3" style={{ fontFamily: fonts.bodyRegular }}>
            {loadedCount} / {totalImages} 画像読み込み中
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-[#F8F7F6]">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 104 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
      >
        <View className="relative h-[280px]">
          {coverImageUri ? (
            <ImageBackground
              source={{ uri: coverImageUri }}
              resizeMode="cover"
              className="absolute inset-0"
              onError={() => setHeroImageFailed(true)}
            />
          ) : (
            <View className="absolute inset-0 bg-[#CFC6BD]" />
          )}

          <SafeAreaView edges={["top"]} className="absolute top-0 left-0 right-0">
            <View className="px-4 py-3">
              <Pressable
                className="w-10 h-10 rounded-full bg-black/25 items-center justify-center"
                onPress={() => navigation.goBack()}
              >
                <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
          </SafeAreaView>

          <View className="absolute left-0 right-0 bottom-0 px-5 pb-6">
            <View className="self-start rounded-md bg-white/20 border border-white/10 px-2.5 py-1 mb-3">
              <Text className="text-[10px] text-white tracking-[1.4px]" style={{ fontFamily: fonts.displayBold, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 }}>
                SERIES #01
              </Text>
            </View>

            <Text className="text-[30px] leading-[38px] text-white" style={{ fontFamily: fonts.displayExtraBold, textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 }}>
              {normalizeText(generated.title, "新しいシリーズ")}
            </Text>

            <View className="flex-row items-center gap-4 mt-3">
              <View className="flex-row items-center gap-1">
                <Ionicons name="time-outline" size={15} color="#EAE4DE" />
                <Text className="text-xs text-[#EAE4DE]" style={{ fontFamily: fonts.bodyMedium, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 }}>
                  {dateLabel}
                </Text>
              </View>
              <View className="flex-row items-center gap-1">
                <Ionicons name="eye-outline" size={15} color="#EAE4DE" />
                <Text className="text-xs text-[#EAE4DE]" style={{ fontFamily: fonts.bodyMedium, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 }}>
                  Private
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View className="bg-[#F8F7F6] border-b border-[#EFE6DD]">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, justifyContent: "center", flexGrow: 1 }}
            className="max-h-[48px]"
          >
            {RESULT_TABS.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => setActiveTab(tab.key)}
                  className={`mx-1.5 px-6 py-3 border-b-2 ${active ? "border-[#EE8C2B]" : "border-transparent"}`}
                >
                  <Text
                    className={`text-sm ${active ? "text-[#EE8C2B]" : "text-[#62584E]"}`}
                    style={{ fontFamily: active ? fonts.displayBold : fonts.bodyMedium }}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View className="px-4 pt-4">
          {activeTab === "overview" ? renderOverviewTab() : null}
          {activeTab === "characters" ? renderCharactersTab() : null}
        </View>
      </ScrollView>

      <SafeAreaView
        edges={[]}
        className="absolute left-4 right-4 rounded-2xl bg-[#F8F7F6] px-3 pt-3 pb-2"
        style={{
          bottom: Math.max(10, insets.bottom + 6),
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.08,
          shadowRadius: 10,
          elevation: 3,
        }}
      >
        <View className="flex-row gap-3">
          <Pressable
            onPress={handleRetry}
            className="flex-1 h-12 rounded-xl bg-white items-center justify-center flex-row gap-2"
          >
            <Ionicons name="create-outline" size={18} color="#6D6257" />
            <Text className="text-sm text-[#6D6257]" style={{ fontFamily: fonts.displayBold }}>
              修正
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              void handleAdopt();
            }}
            disabled={isSubmitting}
            className="flex-[1.7] h-12 rounded-xl bg-[#EE8C2B] items-center justify-center flex-row gap-2"
            style={{
              shadowColor: "#EE8C2B",
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.28,
              shadowRadius: 10,
              elevation: 4,
            }}
          >
            {isSubmitting ? (
              <>
                <ActivityIndicator color="#FFFFFF" />
                <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                  保存中...
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="save-outline" size={18} color="#FFFFFF" />
                <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                  シリーズを保存する
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
};
