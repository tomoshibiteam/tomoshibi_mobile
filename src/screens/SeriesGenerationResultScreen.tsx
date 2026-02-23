import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, ImageBackground, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import { createQuestDraft, saveSeriesBlueprint } from "@/services/quests";
import { useSessionUserId } from "@/hooks/useSessionUser";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { RootStackParamList } from "@/navigation/types";
import type { GeneratedSeriesCharacter } from "@/services/seriesAi";
import { fonts } from "@/theme/fonts";

type Props = NativeStackScreenProps<RootStackParamList, "SeriesGenerationResult">;

const HERO_IMAGE_URI =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuClaK6Cep3ioLM4ETJDiSBSHomcRYBC44vZUU6feXa67oKcHgv0H75jOgYm6ns5DWBqix-Xeu0UGZyMGGUgWBeq3p9qztCn2lpS6NDefOwUrmNFsyyplPmT0yQpjhACOp57nmStss03to0qE8PfSvvJgMV11p-18haW6Gggq1KHkasxWV_yw-qAqF8hDATxrLPFRQ7NE1BOFNw4WDdM1Kyfngzf7m8h8FueIsGtHNt7f-hjlQ6TLEMhG5sFs0wN6IYUG4zxziPvP0ih";

const normalizeText = (value?: string | null, fallback = "未設定") => {
  const cleaned = (value || "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
};

const buildSeedFallbackImageUrl = (seedBase: string, width: number, height: number) =>
  `https://picsum.photos/seed/${encodeURIComponent((seedBase || "tomoshibi").slice(0, 80))}/${Math.max(120, width)}/${Math.max(120, height)}`;

const roleBadge = (index: number) => (index === 0 ? "Protagonist" : "Key Person");
const pickCharacterEmoji = (character: GeneratedSeriesCharacter, index: number) => {
  const source = `${character.role} ${character.name}`.toLowerCase();
  if (source.includes("猫") || source.includes("ねこ")) return "🐈";
  if (source.includes("店") || source.includes("マスター") || source.includes("喫茶")) return "☕️";
  if (source.includes("旅") || source.includes("案内")) return "🧭";
  if (source.includes("探偵") || source.includes("捜査")) return "🕵️";
  if (source.includes("研究") || source.includes("教授")) return "📚";
  return index % 2 === 0 ? "✨" : "🌙";
};

export const SeriesGenerationResultScreen = ({ navigation, route }: Props) => {
  const { generated, sourcePrompt } = route.params;
  const { userId } = useSessionUserId();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  const [failedPortraits, setFailedPortraits] = useState<Record<string, boolean>>({});

  const sceneText = useMemo(
    () => normalizeText(generated.world?.setting || generated.premise || generated.overview, "舞台情報はまだありません。"),
    [generated.overview, generated.premise, generated.world?.setting]
  );

  const worldRuleText = useMemo(() => {
    const taboo = generated.world?.tabooRules?.find((item) => item.trim().length > 0);
    if (taboo) return taboo;

    const invariant = generated.continuity?.invariantRules?.find((item) => item.trim().length > 0);
    if (invariant) return invariant;

    const aiRuleFirst = generated.aiRules
      .split(/[。.!?]/)
      .map((item) => item.trim())
      .find(Boolean);
    if (aiRuleFirst) return aiRuleFirst;

    return "特有のルールはまだ生成されていません。";
  }, [generated.aiRules, generated.continuity?.invariantRules, generated.world?.tabooRules]);

  const sectionTags = useMemo(() => {
    const tags: string[] = [];
    if (generated.genre) tags.push(`ジャンル：${generated.genre}`);
    if (generated.tone) tags.push(`トーン：${generated.tone}`);
    return tags;
  }, [generated.genre, generated.tone]);

  const handleAdopt = useCallback(async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    let createdQuestId: string | null = null;

    try {
      if (isSupabaseConfigured && userId) {
        createdQuestId = await createQuestDraft({
          creatorId: userId,
          title: generated.title,
          description: generated.overview,
          areaName: generated.world?.setting || null,
          coverImageUrl: generated.coverImageUrl || null,
        });

        if (createdQuestId) {
          try {
            await saveSeriesBlueprint({
              questId: createdQuestId,
              userId,
              sourcePrompt,
              generated,
            });
          } catch (error) {
            console.warn("SeriesGenerationResultScreen: failed to save series blueprint", error);
          }
        }
      }

      if (!userId && isSupabaseConfigured) {
        Alert.alert(
          "ログインすると同期できます",
          "今回はローカル下書きとして利用します。ログイン後にクラウド同期できます。"
        );
      }

      navigation.replace("AddEpisode", {
        prefillSeriesId: createdQuestId || undefined,
        prefillSeriesTitle: generated.title || "新しいシリーズ",
      });
    } catch (error) {
      console.error("SeriesGenerationResultScreen: failed to adopt generated series", error);
      Alert.alert("保存に失敗しました", "時間をおいて再度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
  }, [generated, isSubmitting, navigation, sourcePrompt, userId]);

  const handleRetry = useCallback(() => {
    navigation.replace("CreateSeries", { prefillPrompt: sourcePrompt });
  }, [navigation, sourcePrompt]);

  return (
    <View className="flex-1 bg-white">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 190 }} showsVerticalScrollIndicator={false}>
        <View className="relative h-[360px] overflow-hidden">
          <ImageBackground
            source={{
              uri: heroImageFailed
                ? buildSeedFallbackImageUrl(`${generated.title}-cover-fallback`, 1024, 1365)
                : generated.coverImageUrl || HERO_IMAGE_URI,
            }}
            resizeMode="cover"
            className="absolute inset-0"
            onError={() => setHeroImageFailed(true)}
          >
            <View className="absolute inset-0 bg-black/55" />
            <View className="absolute inset-x-0 bottom-0 h-36 bg-black/50" />
          </ImageBackground>

          <SafeAreaView edges={["top"]} className="absolute top-0 left-0 right-0 z-40">
            <View className="px-4 py-3 flex-row items-center justify-between">
              <Pressable
                className="w-10 h-10 rounded-full bg-black/20 items-center justify-center"
                onPress={() => navigation.goBack()}
              >
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </Pressable>
              <View className="w-10 h-10" />
            </View>
          </SafeAreaView>

          <View className="absolute left-0 right-0 bottom-0 px-6 pb-8">
            <View className="self-start rounded-full bg-[#EE8C2B] px-3 py-1 mb-3">
              <Text className="text-[10px] text-white tracking-[2px]" style={{ fontFamily: fonts.displayBold }}>
                SERIES GENERATED
              </Text>
            </View>

            <Text className="text-[31px] text-white leading-[40px]" style={{ fontFamily: fonts.displayExtraBold }}>
              {normalizeText(generated.title, "新しいシリーズ")}
            </Text>

            {sectionTags.length > 0 ? (
              <View className="mt-4 flex-row flex-wrap gap-2">
                {sectionTags.map((tag) => (
                  <View key={tag} className="rounded-md border border-white/35 bg-white/20 px-2.5 py-1">
                    <Text className="text-[10px] text-white tracking-[0.6px]" style={{ fontFamily: fonts.bodyMedium }}>
                      {tag}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>

        <View className="-mt-6 px-4">
          <View
            className="rounded-xl bg-white shadow-sm px-5 py-5 mb-6 border border-[#EFE6DD]"
            style={{ borderLeftWidth: 4, borderLeftColor: "#EE8C2B" }}
          >
            <View className="flex-row items-center gap-2 mb-2">
              <Ionicons name="flag-outline" size={16} color="#EE8C2B" />
              <Text className="text-[11px] text-[#8B8177] tracking-[1.8px]" style={{ fontFamily: fonts.displayBold }}>
                SEASON GOAL
              </Text>
            </View>
            <Text className="text-[16px] text-[#221910] leading-7" style={{ fontFamily: fonts.displayBold }}>
              {normalizeText(generated.seasonGoal, "シーズンゴールは未設定です。")}
            </Text>
          </View>

          <View className="mb-8 px-2">
            <View className="flex-row items-center gap-2 mb-3">
              <View className="w-1.5 h-1.5 bg-[#EE8C2B] rounded-full" />
              <Text className="text-[11px] text-[#9E958C] tracking-[1.8px]" style={{ fontFamily: fonts.displayBold }}>
                WORLD SETTING
              </Text>
            </View>

            <View className="rounded-2xl bg-[#F8F7F6] border border-[#EEE6DD] px-5 py-5 gap-4">
              <View>
                <Text className="text-xs text-[#221910] mb-1.5" style={{ fontFamily: fonts.displayBold }}>
                  物語の舞台
                </Text>
                <Text className="text-sm text-[#62584E] leading-6" style={{ fontFamily: fonts.bodyRegular }}>
                  {sceneText}
                </Text>
              </View>

              <View className="pt-3 border-t border-[#E7DDD3]">
                <Text className="text-xs text-[#221910] mb-1.5" style={{ fontFamily: fonts.displayBold }}>
                  特有のルール
                </Text>
                <Text className="text-sm text-[#62584E] leading-6" style={{ fontFamily: fonts.bodyRegular }}>
                  {worldRuleText}
                </Text>
              </View>
            </View>
          </View>

          <View className="mb-8">
            <View className="px-2 mb-4 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <View className="w-1.5 h-1.5 bg-[#EE8C2B] rounded-full" />
                <Text className="text-[11px] text-[#9E958C] tracking-[1.8px]" style={{ fontFamily: fonts.displayBold }}>
                  CHARACTER CAST
                </Text>
              </View>
              <View className="rounded-md bg-[#F5F2EE] px-2 py-0.5">
                <Text className="text-[10px] text-[#8C837A]" style={{ fontFamily: fonts.bodyMedium }}>
                  {generated.characters.length}名生成
                </Text>
              </View>
            </View>

            <View className="px-1 gap-4">
              {generated.characters.map((character, index) => {
                const cardKey = `${character.id || index}-${character.name}`;
                const secret = normalizeText(character.secrets?.[0], "秘密情報は未設定です。");
                const relation = normalizeText(
                  character.relationshipHooks?.[0],
                  "他キャラクターとの関係情報は未設定です。"
                );
                const isVisible = Boolean(revealedSecrets[cardKey]);
                const portraitFallbackUrl = buildSeedFallbackImageUrl(
                  `${generated.title}-${character.name}-${character.role}-portrait-fallback`,
                  512,
                  512
                );
                const portraitUri = failedPortraits[cardKey]
                  ? portraitFallbackUrl
                  : character.portraitImageUrl || portraitFallbackUrl;

                return (
                  <View
                    key={cardKey}
                    className="rounded-2xl bg-white border border-[#EFE6DD] shadow-sm px-5 py-5"
                  >
                    <View className="flex-row items-start gap-4">
                      {portraitUri ? (
                        <View className="w-12 h-12 rounded-full bg-[#F4F1ED] border border-[#E8DED2] overflow-hidden">
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
                        </View>
                      ) : (
                        <View className="w-12 h-12 rounded-full bg-[#F4F1ED] border border-[#E8DED2] items-center justify-center">
                          <Text className="text-[23px]">{pickCharacterEmoji(character, index)}</Text>
                        </View>
                      )}

                      <View className="flex-1">
                        <View className="flex-row items-start justify-between mb-1 gap-2">
                          <Text className="text-lg text-[#221910] flex-1" style={{ fontFamily: fonts.displayBold }}>
                            {normalizeText(character.name)}
                          </Text>
                          <View
                            className="rounded-full px-2 py-0.5"
                            style={{
                              backgroundColor: index === 0 ? "rgba(238, 140, 43, 0.1)" : "#F2EEE9",
                            }}
                          >
                            <Text
                              className="text-[10px] uppercase"
                              style={{ fontFamily: fonts.displayBold, color: index === 0 ? "#EE8C2B" : "#6F675F" }}
                            >
                              {roleBadge(index)}
                            </Text>
                          </View>
                        </View>

                        <Text className="text-xs text-[#8A7E72] mb-3" style={{ fontFamily: fonts.bodyMedium }}>
                          {normalizeText(character.role)}
                        </Text>

                        {character.appearance ? (
                          <Text className="text-xs text-[#8A7E72] mb-3 -mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                            {character.appearance}
                          </Text>
                        ) : null}

                        <View className="rounded-lg bg-[#F8F7F6] px-3 py-3 mb-2.5">
                          <Text className="text-[11px] text-[#A1978D] mb-1 tracking-[1.1px]" style={{ fontFamily: fonts.displayBold }}>
                            PERSONALITY
                          </Text>
                          <Text className="text-xs text-[#64594F] leading-5" style={{ fontFamily: fonts.bodyRegular }}>
                            {normalizeText(character.personality, "性格情報は未設定です。")}
                          </Text>
                        </View>

                        <View className="flex-row gap-2">
                          <View className="flex-1 rounded-lg bg-[#F8F7F6] px-2.5 py-2.5">
                            <Text className="text-[10px] text-[#A1978D] mb-0.5 tracking-[1px]" style={{ fontFamily: fonts.displayBold }}>
                              RELATIONSHIP
                            </Text>
                            <Text className="text-[11px] text-[#64594F] leading-4" style={{ fontFamily: fonts.bodyRegular }}>
                              {relation}
                            </Text>
                          </View>

                          <Pressable
                            className="flex-1 rounded-lg bg-[#F8F7F6] border border-[#F0DABF] px-2.5 py-2.5"
                            onPress={() =>
                              setRevealedSecrets((prev) => ({
                                ...prev,
                                [cardKey]: !prev[cardKey],
                              }))
                            }
                          >
                            <View className="absolute top-1 right-1">
                              <Ionicons name="lock-closed-outline" size={11} color="#EE8C2B" />
                            </View>
                            <Text className="text-[10px] text-[#EE8C2B] mb-0.5 tracking-[1px]" style={{ fontFamily: fonts.displayBold }}>
                              SECRET
                            </Text>
                            <Text
                              className={`text-[11px] leading-4 ${isVisible ? "text-[#64594F]" : "text-[#A69A8D]"}`}
                              style={{ fontFamily: fonts.bodyRegular }}
                              numberOfLines={isVisible ? undefined : 2}
                            >
                              {isVisible ? secret : "タップして秘密を見る"}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </ScrollView>

      <SafeAreaView
        edges={["bottom"]}
        className="absolute left-0 right-0 bottom-0 border-t border-[#EFE7DD] bg-white px-6 pt-4 pb-4"
      >
        <View className="gap-3">
          <Pressable
            onPress={() => {
              void handleAdopt();
            }}
            disabled={isSubmitting}
            className="h-14 rounded-2xl bg-[#EE8C2B] items-center justify-center flex-row gap-2"
            style={{
              shadowColor: "#EE8C2B",
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.3,
              shadowRadius: 12,
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
                <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                  この物語の骨格を採用する
                </Text>
                <Ionicons name="checkmark" size={18} color="#FFFFFF" />
              </>
            )}
          </Pressable>

          <Pressable
            onPress={handleRetry}
            className="h-12 rounded-2xl bg-white border border-[#E8DED2] items-center justify-center flex-row gap-2"
          >
            <Ionicons name="create-outline" size={17} color="#6D6257" />
            <Text className="text-sm text-[#6D6257]" style={{ fontFamily: fonts.displayBold }}>
              プロンプトを修正して再試行
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
};
