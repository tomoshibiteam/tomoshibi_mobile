import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/types";
import { getSupabaseOrThrow, isSupabaseConfigured } from "@/lib/supabase";
import {
  buildOnboardingMetadataUpdate,
  type OnboardingAnswerValue,
  type OnboardingSurveyAnswers,
} from "@/lib/authOnboarding";
import { fonts } from "@/theme/fonts";

type Props = NativeStackScreenProps<RootStackParamList, "OnboardingSurvey">;

type SurveyKey = keyof OnboardingSurveyAnswers;

type SurveyOption = {
  id: string;
  label: string;
  description?: string;
  eyebrow?: string;
  icon?: string;
  imageUri?: string;
  colors: [string, string, ...string[]];
};

type SurveyStep = {
  key: SurveyKey;
  progressLabel: string;
  titlePrefix: string;
  titleAccent: string;
  titleSuffix: string;
  subtitle: string;
  layout: "list" | "grid";
  options: SurveyOption[];
};

const CURRENT_LIFESTYLE_OPTIONS: SurveyOption[] = [
  {
    id: "university_student",
    label: "大学生・大学院生",
    eyebrow: "Campus",
    imageUri: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1200&q=80",
    colors: ["#8D5A3B", "#533222"],
  },
  {
    id: "vocational_student",
    label: "専門学校生・短大生",
    eyebrow: "Practical",
    imageUri: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80",
    colors: ["#7A624B", "#413127"],
  },
  {
    id: "fulltime_employee",
    label: "フルタイム勤務",
    eyebrow: "Office",
    imageUri: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80",
    colors: ["#84634E", "#3A2A22"],
  },
  {
    id: "shift_worker",
    label: "シフト勤務・不規則勤務",
    eyebrow: "Shift",
    imageUri: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=1200&q=80",
    colors: ["#965C3A", "#4B2E21"],
  },
  {
    id: "freelance_owner",
    label: "フリーランス・個人事業",
    eyebrow: "Freelance",
    imageUri: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80",
    colors: ["#7B674D", "#3B3027"],
  },
  {
    id: "homemaker",
    label: "主婦・主夫",
    eyebrow: "Home",
    imageUri: "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80",
    colors: ["#A06B4F", "#54352A"],
  },
  {
    id: "exam_job_change",
    label: "受験・就活・転職中",
    eyebrow: "Challenge",
    imageUri: "https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=1200&q=80",
    colors: ["#8F613E", "#4C3424"],
  },
  {
    id: "other",
    label: "その他",
    eyebrow: "Other",
    imageUri: "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1200&q=80",
    colors: ["#6F5A4A", "#352B24"],
  },
];

const OUTING_FREQUENCY_OPTIONS: SurveyOption[] = [
  {
    id: "almost_everyday_heavy",
    label: "ほぼ毎日かなり移動する",
    eyebrow: "Daily",
    imageUri: "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?auto=format&fit=crop&w=1200&q=80",
    colors: ["#4D6A7A", "#223644"],
  },
  {
    id: "everyday_medium",
    label: "毎日そこそこ移動する",
    eyebrow: "Routine",
    imageUri: "https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=1200&q=80",
    colors: ["#6E5C4B", "#342920"],
  },
  {
    id: "commute_not_detour",
    label: "通学・通勤はあるが寄り道は少ない",
    eyebrow: "Commute",
    imageUri: "https://images.unsplash.com/photo-1494522358652-f30e61a60313?auto=format&fit=crop&w=1200&q=80",
    colors: ["#6C6260", "#2E2D2D"],
  },
  {
    id: "weekend_only",
    label: "休日だけよく出かける",
    eyebrow: "Weekend",
    imageUri: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
    colors: ["#7C644F", "#3D2D23"],
  },
  {
    id: "nearby_often",
    label: "近場にはよく出る",
    eyebrow: "Nearby",
    imageUri: "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1200&q=80",
    colors: ["#5E7C61", "#2C4130"],
  },
  {
    id: "travel_lover",
    label: "旅行や遠出は好き",
    eyebrow: "Travel",
    imageUri: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=80",
    colors: ["#4D6B8C", "#1F3045"],
  },
  {
    id: "rarely_go_out",
    label: "あまり外出しない",
    eyebrow: "Indoors",
    imageUri: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80",
    colors: ["#85705E", "#46372D"],
  },
  {
    id: "varies_widely",
    label: "その時々でかなり違う",
    eyebrow: "Flexible",
    imageUri: "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1200&q=80",
    colors: ["#5F5A6A", "#2B2833"],
  },
];

const LEISURE_STYLE_OPTIONS: SurveyOption[] = [
  {
    id: "video_streaming",
    label: "動画・配信を見ることが多い",
    eyebrow: "Video",
    imageUri: "https://images.unsplash.com/photo-1518932945647-7a1c969f8be2?auto=format&fit=crop&w=1200&q=80",
    colors: ["#7A4D48", "#321E22"],
  },
  {
    id: "games_story",
    label: "ゲームや物語作品を楽しむ",
    eyebrow: "Story",
    imageUri: "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80",
    colors: ["#5C4C74", "#262033"],
  },
  {
    id: "cafe_stroll",
    label: "カフェや街をぶらぶらする",
    eyebrow: "Stroll",
    imageUri: "https://images.unsplash.com/photo-1445116572660-236099ec97a0?auto=format&fit=crop&w=1200&q=80",
    colors: ["#8C5D44", "#432A20"],
  },
  {
    id: "with_friends_partner",
    label: "友だち・恋人と出かける",
    eyebrow: "Together",
    imageUri: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1200&q=80",
    colors: ["#7D6559", "#3E302A"],
  },
  {
    id: "quiet_solo",
    label: "一人で静かに過ごす",
    eyebrow: "Solo",
    imageUri: "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1200&q=80",
    colors: ["#645A55", "#2E2A29"],
  },
  {
    id: "discover_new_places",
    label: "新しい場所を見つけたい",
    eyebrow: "Discover",
    imageUri: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1200&q=80",
    colors: ["#5C7A6F", "#283932"],
  },
  {
    id: "kill_time",
    label: "なんとなく時間をつぶすことが多い",
    eyebrow: "Casual",
    imageUri: "https://images.unsplash.com/photo-1516321497487-e288fb19713f?auto=format&fit=crop&w=1200&q=80",
    colors: ["#7B6B61", "#3B322E"],
  },
  {
    id: "mood_dependent",
    label: "気分でかなり変わる",
    eyebrow: "Mood",
    imageUri: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1200&q=80",
    colors: ["#6A5675", "#2D2635"],
  },
];

const SURVEY_STEPS: SurveyStep[] = [
  {
    key: "currentLifestyle",
    progressLabel: "Step 01 / 03",
    titlePrefix: "いまの",
    titleAccent: "生活スタイル",
    titleSuffix: "はどれに近いですか？",
    subtitle: "あなたの時間の使い方に近いものを選んでください。",
    layout: "grid",
    options: CURRENT_LIFESTYLE_OPTIONS,
  },
  {
    key: "outingFrequency",
    progressLabel: "Step 02 / 03",
    titlePrefix: "ふだん、",
    titleAccent: "どれくらい",
    titleSuffix: "外に出たり移動したりしますか？",
    subtitle: "外出や移動の頻度に近いものを選んでください。",
    layout: "grid",
    options: OUTING_FREQUENCY_OPTIONS,
  },
  {
    key: "leisureStyle",
    progressLabel: "Step 03 / 03",
    titlePrefix: "休日や空き時間は、",
    titleAccent: "どんなふうに",
    titleSuffix: "過ごすことが多いですか？",
    subtitle: "空き時間の過ごし方に近いものを選んでください。",
    layout: "grid",
    options: LEISURE_STYLE_OPTIONS,
  },
];

const buildAnswerValue = (option: SurveyOption): OnboardingAnswerValue => ({
  id: option.id,
  label: option.label,
});

export const OnboardingSurveyScreen = ({ navigation }: Props) => {
  const { width, height } = useWindowDimensions();
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Partial<OnboardingSurveyAnswers>>({});
  const [isBootLoading, setIsBootLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [contentViewportHeight, setContentViewportHeight] = useState(0);

  const currentStep = SURVEY_STEPS[stepIndex];
  const selectedAnswer = answers[currentStep.key];
  const canContinue = Boolean(selectedAnswer) && !isSubmitting;
  const headerTitleText = `${currentStep.titlePrefix}${currentStep.titleAccent}${currentStep.titleSuffix}`;
  const headerWidth = Math.min(width, 720);
  const headerTitleCharacterWidth =
    headerTitleText.length >= 27 ? 1.05 : headerTitleText.length >= 24 ? 1.02 : 0.98;
  const headerTitleUsableWidth = Math.max(280, headerWidth - 10);
  const headerTitleFontSize = Math.max(
    width <= 360 ? 12 : 14,
    Math.min(24, Math.floor(headerTitleUsableWidth / (headerTitleText.length * headerTitleCharacterWidth))),
  );
  const headerTitleMetrics = {
    fontSize: headerTitleFontSize,
    lineHeight: Math.round(headerTitleFontSize * 1.12),
    letterSpacing: headerTitleText.length >= 24 ? -0.18 : -0.04,
  };
  const progress = (stepIndex + 1) / SURVEY_STEPS.length;
  const contentWidth = Math.min(width - 32, 520);
  const gridGap = width <= 390 ? 10 : 14;
  const worldCardWidth = Math.floor((contentWidth - gridGap) / 2);
  const isCompactGrid = currentStep.options.length > 4;
  const gridRowCount = Math.ceil(currentStep.options.length / 2);
  const fallbackViewportHeight = Math.max(360, height - 292);
  const resolvedViewportHeight = contentViewportHeight || fallbackViewportHeight;
  const worldCardHeight = isCompactGrid
    ? Math.max(78, Math.min(128, Math.floor((resolvedViewportHeight - gridGap * (gridRowCount - 1)) / gridRowCount)))
    : Math.max(146, Math.min(196, Math.floor(worldCardWidth * 0.92)));

  useEffect(() => {
    let isMounted = true;

    const hydrate = async () => {
      if (!isSupabaseConfigured) {
        navigation.replace("Auth");
        return;
      }

      try {
        const supabase = getSupabaseOrThrow();
        const { data, error } = await supabase.auth.getUser();
        if (!isMounted) return;

        if (error || !data.user) {
          navigation.replace("Auth");
          return;
        }

        setIsBootLoading(false);
      } catch (error) {
        console.error("OnboardingSurveyScreen: failed to hydrate session", error);
        if (isMounted) {
          navigation.replace("Auth");
        }
      }
    };

    void hydrate();

    return () => {
      isMounted = false;
    };
  }, [navigation]);

  const handleSelect = (option: SurveyOption) => {
    setAnswers((current) => ({
      ...current,
      [currentStep.key]: buildAnswerValue(option),
    }));
  };

  const handleBack = () => {
    if (isSubmitting) return;
    setStepIndex((current) => Math.max(0, current - 1));
  };

  const handleContinue = async () => {
    if (!selectedAnswer) {
      return;
    }

    if (stepIndex < SURVEY_STEPS.length - 1) {
      setStepIndex((current) => current + 1);
      return;
    }

    if (!isSupabaseConfigured) {
      Alert.alert("設定が必要です", "Supabase設定が未完了です。");
      return;
    }

    const completedAnswers = answers as OnboardingSurveyAnswers;
    setIsSubmitting(true);

    try {
      const supabase = getSupabaseOrThrow();
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        Alert.alert("セッションエラー", "ログイン状態を確認できませんでした。再度お試しください。");
        navigation.replace("Auth");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        data: buildOnboardingMetadataUpdate(data.user, completedAnswers),
      });

      if (updateError) {
        Alert.alert("保存エラー", updateError.message || "アンケートの保存に失敗しました。");
        return;
      }

      navigation.reset({
        index: 0,
        routes: [{ name: "MainTabs", params: { screen: "Home" } }],
      });
    } catch (error) {
      console.error("OnboardingSurveyScreen: failed to complete onboarding", error);
      Alert.alert("エラー", "通信に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const content = useMemo(() => {
    if (currentStep.layout === "grid") {
      return (
        <View
          onLayout={(event) => {
            const nextHeight = Math.floor(event.nativeEvent.layout.height);
            if (nextHeight > 0 && Math.abs(nextHeight - contentViewportHeight) > 1) {
              setContentViewportHeight(nextHeight);
            }
          }}
          style={styles.contentViewport}
        >
          <View
            style={[
              styles.gridWrap,
              {
                width: contentWidth,
                rowGap: gridGap,
                columnGap: gridGap,
              },
            ]}
          >
            {currentStep.options.map((option) => {
              const isSelected = selectedAnswer?.id === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => handleSelect(option)}
                  style={[
                    styles.worldCard,
                    {
                      width: worldCardWidth,
                      height: worldCardHeight,
                    },
                    isSelected && styles.worldCardSelected,
                  ]}
                >
                  <ImageBackground
                    source={option.imageUri ? { uri: option.imageUri } : undefined}
                    style={styles.worldCardMedia}
                    imageStyle={styles.worldCardImage}
                  >
                    <View style={styles.worldCardGlobalVeil} />
                    <LinearGradient
                      colors={["rgba(0,0,0,0.02)", "rgba(0,0,0,0.24)", "rgba(0,0,0,0.72)"]}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={styles.worldCardShade}
                    />
                    <View style={styles.worldCardFooter}>
                      <Text style={styles.worldCardEyebrow}>{option.eyebrow}</Text>
                      <Text style={styles.worldCardTitle}>{option.label}</Text>
                      {option.description ? <Text style={styles.worldCardDescription}>{option.description}</Text> : null}
                    </View>
                  </ImageBackground>
                  {isSelected ? (
                    <View style={styles.selectionBadge}>
                      <MaterialCommunityIcons name="check" size={14} color="#5B2F00" />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      );
    }

    return null;
  }, [contentViewportHeight, contentWidth, currentStep, gridGap, selectedAnswer?.id, worldCardHeight, worldCardWidth]);

  if (isBootLoading) {
    return (
      <View style={styles.screen}>
        <SafeAreaView edges={["top", "bottom"]} style={styles.loadingState}>
          <ActivityIndicator color="#904D00" />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View pointerEvents="none" style={styles.backgroundOrbPrimary} />
      <View pointerEvents="none" style={styles.backgroundOrbSecondary} />
      <View pointerEvents="none" style={styles.textureOverlayWrap}>
        <Image
          source={{
            uri: "https://lh3.googleusercontent.com/aida-public/AB6AXuDrkouOnKT9kRngyDJLkrisKPT71ssn8_WX8hAE8ZpwdqVia0sLDNdwn-SnI3C4d4wkrGCsT6D3lZFzzWO8NaaXw5-ZvepFsdrMquGR5JZ_s_stAgibyZxBDXMj692ExeW_aIsPdt7mLwXoo8k_VduZdZ1aW8MAJ_Z1bR0yIlMqC_My4G7VWosnPzTTWeW4HzRMAHBksQPu4K2UgqIqqGLkiZREXEiCT_jK3uKn75ne_qlPK-aVlKpp-Eqdm6x0jwp-DrsWOBBPIz_V",
          }}
          style={styles.textureOverlay}
          resizeMode="cover"
        />
      </View>

      <SafeAreaView edges={["top"]} style={styles.safeTop}>
        <View style={[styles.progressSection, { width: contentWidth }]}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.progressLabel}>{currentStep.progressLabel}</Text>
        </View>

        <View style={[styles.headerSection, { width: headerWidth }]}>
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={[styles.headerTitle, headerTitleMetrics]}
          >
            {headerTitleText}
          </Text>
        </View>

        {content}
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={styles.footerSafeArea}>
        {!selectedAnswer ? (
          <Text style={styles.footerHintText}>1つ選ぶと次へ進めます</Text>
        ) : (
          <Text style={styles.footerHintTextSelected}>選択済みです。Continue で次へ進みます</Text>
        )}
        <View style={[styles.footerShell, { width: contentWidth }]}>
          <Pressable
            onPress={handleBack}
            disabled={stepIndex === 0 || isSubmitting}
            style={[styles.footerGhostButton, (stepIndex === 0 || isSubmitting) && styles.footerGhostButtonDisabled]}
          >
            <MaterialCommunityIcons name="arrow-left" size={18} color="#6C5647" />
            <Text style={styles.footerGhostText}>Back</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              void handleContinue();
            }}
            disabled={!canContinue}
            style={[styles.footerPrimaryButton, !canContinue && styles.footerPrimaryButtonDisabled]}
          >
            <LinearGradient colors={["#904D00", "#EE8C2B"]} style={styles.footerPrimaryGradient}>
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.footerPrimaryText}>{stepIndex === SURVEY_STEPS.length - 1 ? "はじめる" : "Continue"}</Text>
                  <MaterialCommunityIcons name="arrow-right" size={18} color="#FFFFFF" />
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#FFF8F4",
  },
  safeTop: {
    flex: 1,
    alignItems: "center",
    paddingTop: 12,
  },
  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  backgroundOrbPrimary: {
    position: "absolute",
    top: -120,
    right: -60,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(238,140,43,0.12)",
  },
  backgroundOrbSecondary: {
    position: "absolute",
    bottom: 110,
    left: -90,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(163,111,82,0.10)",
  },
  textureOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.03,
  },
  textureOverlayWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  topBar: {
    height: 56,
    paddingHorizontal: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandWordmark: {
    color: "#904D00",
    fontSize: 18,
    letterSpacing: -0.4,
    fontFamily: fonts.displayBold,
  },
  topMeta: {
    color: "rgba(35,26,17,0.54)",
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    fontFamily: fonts.bodyMedium,
  },
  progressSection: {
    marginTop: 0,
    alignItems: "center",
  },
  progressTrack: {
    width: 128,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#F2DFD0",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#904D00",
  },
  progressLabel: {
    marginTop: 6,
    color: "rgba(35,26,17,0.38)",
    fontSize: 9,
    letterSpacing: 2.2,
    textTransform: "uppercase",
    fontFamily: fonts.bodyMedium,
  },
  headerSection: {
    marginTop: 14,
    alignItems: "center",
    paddingHorizontal: 2,
  },
  headerTitle: {
    color: "#231A11",
    fontSize: 23,
    lineHeight: 28,
    textAlign: "center",
    fontFamily: fonts.displayBold,
  },
  contentViewport: {
    flex: 1,
    width: "100%",
    paddingTop: 8,
    paddingBottom: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  listWrap: {
    gap: 12,
  },
  choiceCard: {
    minHeight: 92,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E7D9C7",
    backgroundColor: "rgba(255,255,255,0.88)",
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  choiceCardSelected: {
    borderColor: "#EE8C2B",
    backgroundColor: "#FFF2E7",
  },
  choiceIconShell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  choiceCopy: {
    flex: 1,
    paddingRight: 12,
  },
  choiceTitle: {
    color: "#231A11",
    fontSize: 17,
    lineHeight: 22,
    fontFamily: fonts.storySerifSemiBold,
  },
  choiceDescription: {
    marginTop: 4,
    color: "#6C5647",
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.bodyRegular,
  },
  choiceCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D8C6B5",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  choiceCheckSelected: {
    borderColor: "#F0B27A",
    backgroundColor: "#FFDCC2",
  },
  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignContent: "stretch",
  },
  worldCard: {
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    backgroundColor: "#DDD",
  },
  worldCardMedia: {
    flex: 1,
  },
  worldCardImage: {
    borderRadius: 8,
  },
  worldCardSelected: {
    borderColor: "#FFDCC2",
    borderWidth: 2,
  },
  worldCardShade: {
    ...StyleSheet.absoluteFillObject,
  },
  worldCardGlobalVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  worldCardFooter: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
  },
  worldCardEyebrow: {
    color: "rgba(255,255,255,0.64)",
    fontSize: 8,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    fontFamily: fonts.bodyMedium,
  },
  worldCardTitle: {
    marginTop: 3,
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fonts.displayBold,
  },
  worldCardDescription: {
    marginTop: 4,
    color: "rgba(255,255,255,0.92)",
    fontSize: 10,
    lineHeight: 14,
    fontFamily: fonts.bodyMedium,
  },
  selectionBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#FFDCC2",
    alignItems: "center",
    justifyContent: "center",
  },
  footerSafeArea: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 18,
  },
  footerHintText: {
    alignSelf: "center",
    marginBottom: 10,
    color: "#8A7566",
    fontSize: 11,
    lineHeight: 16,
    fontFamily: fonts.bodyMedium,
  },
  footerHintTextSelected: {
    alignSelf: "center",
    marginBottom: 10,
    color: "#904D00",
    fontSize: 11,
    lineHeight: 16,
    fontFamily: fonts.bodyMedium,
  },
  footerShell: {
    alignSelf: "center",
    minHeight: 64,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E7D9C7",
    backgroundColor: "rgba(255,248,244,0.96)",
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  footerGhostButton: {
    height: 46,
    borderRadius: 999,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  footerGhostButtonDisabled: {
    opacity: 0.35,
  },
  footerGhostText: {
    color: "#6C5647",
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    fontFamily: fonts.bodyMedium,
  },
  footerPrimaryButton: {
    flex: 1,
    marginLeft: 10,
    borderRadius: 999,
    overflow: "hidden",
  },
  footerPrimaryButtonDisabled: {
    opacity: 0.45,
  },
  footerPrimaryGradient: {
    minHeight: 46,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  footerPrimaryText: {
    color: "#FFFFFF",
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    fontFamily: fonts.displayBold,
  },
});
