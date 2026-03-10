import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import LottieView from "lottie-react-native";
import type { RootStackParamList } from "@/navigation/types";
import { fonts } from "@/theme/fonts";
import { useSessionUserId } from "@/hooks/useSessionUser";
import {
  generateSeriesDraftViaMastra,
  type GeneratedSeriesDraft,
  type GeneratedSeriesIdentityPack,
  type SeriesInterviewInput,
} from "@/services/seriesAi";

const SERIES_DRAFTS_KEY = "tomoshibi.seriesDrafts";

const SERIES_INTERVIEW_STEPS = [
  {
    question: "最初の舞台は、どんなジャンルや世界観にしましょう？",
    placeholder: "例: 夕暮れの港町で進むミステリー",
    chips: ["日常系", "冒険", "ミステリー"],
  },
  {
    question: "この物語を進めたあと、どんな気持ちを持ち帰りたいですか？",
    placeholder: "例: じんわり癒されたい",
    chips: ["癒されたい", "ワクワクしたい", "前向き"],
  },
  {
    question: "旅をともにする相棒は、どんな存在が理想ですか？",
    placeholder: "例: 静かに背中を押してくれる相棒",
    chips: ["優しい相棒", "クールなバディ", "友達っぽい距離感"],
  },
  {
    question: "次が気になるのは、どんな余韻が残るときですか？",
    placeholder: "例: 謎がひとつ残る終わり方",
    chips: ["謎が残る", "伏線が張られる", "達成感と余韻"],
  },
  {
    question: "避けたい展開や表現があれば教えてください。",
    placeholder: "例: 怖すぎる演出は避けたい",
    chips: ["グロい表現NG", "怖すぎる演出NG", "救いなしNG"],
  },
  {
    question: "画風はどれにしますか？（カバー・世界観・登場人物で統一されます）",
    placeholder: "例: レトロ漫画 / シネマティックアニメ / 水彩イラスト",
    chips: ["シネマティックアニメ", "レトロ漫画", "水彩イラスト"],
  },
] as const;

const VISUAL_STYLE_STEP_INDEX = 5;
const VISUAL_STYLE_BADGE_SET = new Set(SERIES_INTERVIEW_STEPS[VISUAL_STYLE_STEP_INDEX].chips.map((chip) => chip.trim()));

const SERIES_INTERVIEW_DONE_MESSAGE =
  "ありがとうございます。世界の輪郭が見えてきました。準備ができたら「物語を紡ぐ」で幕を開けましょう。";

const FORGING_STATUS_MESSAGES = [
  "世界観を構築中...",
  "相棒を呼び出しています...",
  "物語の導線を編み込んでいます...",
  "余韻と伏線を調律しています...",
] as const;

const FORGING_LOTTIE_URI = "https://assets10.lottiefiles.com/packages/lf20_iwmd6pyr.json";

type GenreThemeKey = "ember" | "adventure" | "mystery" | "serene";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

const GENRE_THEMES: Record<GenreThemeKey, { colors: [string, string, string]; orb: string; spark: string }> = {
  ember: {
    colors: ["#1B120D", "#4A2717", "#9E5A2A"],
    orb: "rgba(255, 195, 120, 0.24)",
    spark: "rgba(255, 228, 168, 0.38)",
  },
  adventure: {
    colors: ["#0A1D1B", "#0F544A", "#2B9A84"],
    orb: "rgba(104, 255, 214, 0.24)",
    spark: "rgba(186, 255, 236, 0.42)",
  },
  mystery: {
    colors: ["#0F1322", "#1D2B46", "#355C7D"],
    orb: "rgba(153, 186, 255, 0.24)",
    spark: "rgba(214, 232, 255, 0.4)",
  },
  serene: {
    colors: ["#152014", "#2D4C30", "#5F8A57"],
    orb: "rgba(195, 255, 186, 0.24)",
    spark: "rgba(236, 255, 216, 0.4)",
  },
};

const PARTICLE_SEEDS = [
  { left: 6, size: 3, delayMs: 0, durationMs: 6200 },
  { left: 17, size: 2, delayMs: 600, durationMs: 5600 },
  { left: 30, size: 4, delayMs: 1400, durationMs: 7000 },
  { left: 43, size: 3, delayMs: 2000, durationMs: 6400 },
  { left: 57, size: 2, delayMs: 2600, durationMs: 7200 },
  { left: 68, size: 4, delayMs: 900, durationMs: 5800 },
  { left: 79, size: 3, delayMs: 1700, durationMs: 6700 },
  { left: 90, size: 2, delayMs: 2300, durationMs: 6100 },
] as const;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const buildInterviewQuestionMessage = (index: number): ChatMessage => ({
  id: generateId(),
  role: "assistant",
  text: SERIES_INTERVIEW_STEPS[Math.max(0, Math.min(index, SERIES_INTERVIEW_STEPS.length - 1))].question,
});

const buildInterviewDoneMessage = (): ChatMessage => ({
  id: generateId(),
  role: "assistant",
  text: SERIES_INTERVIEW_DONE_MESSAGE,
});

const containsAny = (source: string, keywords: string[]) => keywords.some((keyword) => source.includes(keyword));

const deriveSeriesTitle = (prompt: string) => {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "新しいシリーズ";

  const quoted = cleaned.match(/[「『"]([^「」『』"]{2,22})[」』"]/);
  if (quoted?.[1]) return quoted[1].trim();

  const suffixCut = cleaned.match(/([^。！？.!?\s]{2,18})(?:シリーズ|編|譚|ミステリー|物語)/);
  if (suffixCut?.[1]) return suffixCut[1].trim();

  if (containsAny(cleaned, ["探偵", "事件", "謎", "推理"])) return "未解決ファイルの追跡者";
  if (containsAny(cleaned, ["歴史", "伝承", "遺跡", "古代"])) return "時を繋ぐ記憶録";
  if (containsAny(cleaned, ["旅", "放浪", "巡る", "各地"])) return "境界線のトラベラー";

  const firstSentence = cleaned.split(/[。！？.!?]/)[0]?.trim() || cleaned;
  const compact = firstSentence.slice(0, 16).trim();
  return compact.length >= 3 ? compact : "新しいシリーズ";
};

const inferSeriesName = (rawText: string) => {
  const quoted = rawText.match(/[「『"]([^」』"]{2,40})[」』"]|\"([^\"]{2,40})\"/);
  const quotedTitle = quoted?.[1] || quoted?.[2];
  if (quotedTitle) return quotedTitle.trim();

  const cleaned = rawText
    .replace(/[。！!？?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";

  const compact = cleaned.replace(/(みたいな|ような|したい|です|ます|シリーズ|物語|感じ|を|の|で)/g, "").trim();
  const base = (compact || cleaned).slice(0, 18).trim();
  if (!base) return "";
  if (/(編|録|譚|記)$/.test(base)) return base;
  return `${base}シリーズ`;
};

const detectGenreTheme = (source: string): GenreThemeKey => {
  const text = source.toLowerCase();
  if (!text) return "ember";
  if (/(冒険|旅|探索|クエスト|放浪|遺跡)/.test(text)) return "adventure";
  if (/(ミステリー|謎|推理|探偵|事件|サスペンス)/.test(text)) return "mystery";
  if (/(日常|癒し|ほのぼの|温か|やさしい|穏やか)/.test(text)) return "serene";
  return "ember";
};

const loadExistingIdentityPack = async (titleCandidate: string): Promise<GeneratedSeriesIdentityPack | undefined> => {
  const normalizedTitle = titleCandidate.trim().toLowerCase();
  if (!normalizedTitle) return undefined;

  try {
    const rawDrafts = await AsyncStorage.getItem(SERIES_DRAFTS_KEY);
    const parsedDrafts = rawDrafts ? (JSON.parse(rawDrafts) as unknown) : {};
    if (!parsedDrafts || typeof parsedDrafts !== "object" || Array.isArray(parsedDrafts)) return undefined;
    const map = parsedDrafts as Record<string, unknown>;

    const hit = Object.entries(map).find(([title]) => title.trim().toLowerCase() === normalizedTitle);
    if (!hit) return undefined;
    const row = hit[1] as Record<string, unknown>;
    const pack = row?.identityPack;
    if (!pack || typeof pack !== "object") return undefined;
    const packRow = pack as Record<string, unknown>;
    const keyIds = Array.isArray(packRow.keyPersonCharacterIds)
      ? packRow.keyPersonCharacterIds.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];
    if (keyIds.length === 0) return undefined;
    return pack as GeneratedSeriesIdentityPack;
  } catch {
    return undefined;
  }
};

const FloatingParticle = ({
  left,
  size,
  delayMs,
  durationMs,
  color,
}: {
  left: number;
  size: number;
  delayMs: number;
  durationMs: number;
  color: string;
}) => {
  const travel = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delayMs),
        Animated.timing(travel, {
          toValue: 1,
          duration: durationMs,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(travel, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => {
      loop.stop();
    };
  }, [delayMs, durationMs, travel]);

  const translateY = travel.interpolate({
    inputRange: [0, 1],
    outputRange: [20, -140],
  });

  const opacity = travel.interpolate({
    inputRange: [0, 0.2, 0.85, 1],
    outputRange: [0, 0.34, 0.22, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: `${left}%`,
        bottom: -18,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
        transform: [{ translateY }],
      }}
    />
  );
};

const ThemeLayer = ({ themeKey }: { themeKey: GenreThemeKey }) => {
  const theme = GENRE_THEMES[themeKey];

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={theme.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View
        style={{
          position: "absolute",
          width: 230,
          height: 230,
          borderRadius: 230,
          top: -50,
          left: -30,
          backgroundColor: theme.orb,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: 280,
          height: 280,
          borderRadius: 280,
          bottom: -90,
          right: -80,
          backgroundColor: theme.orb,
        }}
      />

      {PARTICLE_SEEDS.map((particle, index) => (
        <FloatingParticle
          key={`${themeKey}-${index}`}
          left={particle.left}
          size={particle.size}
          delayMs={particle.delayMs}
          durationMs={particle.durationMs}
          color={theme.spark}
        />
      ))}

      <LinearGradient
        colors={["rgba(255,255,255,0.14)", "rgba(255,255,255,0)"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
};

const CinematicBackground = ({ themeKey }: { themeKey: GenreThemeKey }) => {
  const [currentKey, setCurrentKey] = useState<GenreThemeKey>(themeKey);
  const [incomingKey, setIncomingKey] = useState<GenreThemeKey | null>(null);
  const transitionOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (themeKey === currentKey) return;

    setIncomingKey(themeKey);
    transitionOpacity.setValue(0);

    Animated.timing(transitionOpacity, {
      toValue: 1,
      duration: 820,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setCurrentKey(themeKey);
      setIncomingKey(null);
      transitionOpacity.setValue(1);
    });
  }, [currentKey, themeKey, transitionOpacity]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <ThemeLayer themeKey={currentKey} />
      {incomingKey ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: transitionOpacity }]}>
          <ThemeLayer themeKey={incomingKey} />
        </Animated.View>
      ) : null}
    </View>
  );
};

const AssistantBubble = ({
  message,
  isTyping,
  onTypingDone,
}: {
  message: ChatMessage;
  isTyping: boolean;
  onTypingDone: (id: string) => void;
}) => {
  const [visibleText, setVisibleText] = useState(isTyping ? "" : message.text);
  const fadeAnim = useRef(new Animated.Value(isTyping ? 0 : 1)).current;

  useEffect(() => {
    if (!isTyping) {
      setVisibleText(message.text);
      fadeAnim.setValue(1);
      return;
    }

    setVisibleText("");
    fadeAnim.setValue(0);

    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

    const totalDuration = Math.min(1000, Math.max(520, message.text.length * 22));
    const intervalMs = Math.max(14, Math.floor(totalDuration / Math.max(message.text.length, 1)));

    let cursor = 0;
    const timer = setInterval(() => {
      cursor += 1;
      setVisibleText(message.text.slice(0, cursor));
      if (cursor >= message.text.length) {
        clearInterval(timer);
        onTypingDone(message.id);
      }
    }, intervalMs);

    return () => {
      clearInterval(timer);
    };
  }, [fadeAnim, isTyping, message.id, message.text, onTypingDone]);

  const translateY = fadeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        transform: [{ translateY }],
      }}
      className="rounded-2xl rounded-tl-md border border-white/35 bg-[#FFFDF8]/95 px-4 py-3"
    >
      <Text
        className="text-[11px] text-[#7A6855] mb-1"
        style={{ fontFamily: fonts.bodyMedium, letterSpacing: 0.5 }}
      >
        導き手
      </Text>
      <Text
        className="text-[15px] text-[#2B1E16] leading-7"
        style={{ fontFamily: fonts.storySerifRegular, letterSpacing: 0.3 }}
      >
        {visibleText}
      </Text>
    </Animated.View>
  );
};

const StoryKeywordChip = ({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) => {
  const ripple = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  const rippleScale = ripple.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 2.2],
  });

  const rippleOpacity = ripple.interpolate({
    inputRange: [0, 0.15, 1],
    outputRange: [0, 0.3, 0],
  });

  const handlePress = () => {
    ripple.setValue(0);
    Animated.timing(ripple, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale }], width: "100%" }}>
      <Pressable
        disabled={disabled}
        onPress={handlePress}
        onPressIn={() => {
          Animated.spring(scale, {
            toValue: 0.97,
            friction: 6,
            useNativeDriver: true,
          }).start();
        }}
        onPressOut={() => {
          Animated.spring(scale, {
            toValue: 1,
            friction: 6,
            useNativeDriver: true,
          }).start();
        }}
        className={`w-full h-10 overflow-hidden rounded-full border px-2 items-center justify-center ${
          active ? "bg-[#EE8C2B] border-[#EE8C2B]" : "bg-white border-[#E6DED5]"
        }`}
      >
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "#FFFFFF",
            opacity: rippleOpacity,
            transform: [{ scale: rippleScale }],
          }}
        />
        <Text
          className={`text-sm ${active ? "text-white" : "text-[#5E4A39]"}`}
          style={{ fontFamily: active ? fonts.bodyBold : fonts.bodyMedium }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
};

const StoryForgeLoadingOverlay = ({ message }: { message: string }) => {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => {
      loop.stop();
    };
  }, [pulse]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="auto">
      <LinearGradient colors={["#0B101D", "#1B1211", "#3A220F"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <SafeAreaView edges={["top", "bottom"]} className="flex-1 items-center justify-center px-8">
        <View className="items-center">
          <View className="w-[220px] h-[220px] items-center justify-center mb-4">
            {Platform.OS === "web" ? (
              <Animated.View style={{ opacity: pulse }} className="w-24 h-24 rounded-full border border-[#E7B788] items-center justify-center">
                <Ionicons name="sparkles" size={38} color="#F6D1AD" />
              </Animated.View>
            ) : (
              <LottieView source={{ uri: FORGING_LOTTIE_URI }} autoPlay loop style={{ width: 220, height: 220 }} />
            )}
          </View>

          <Text
            className="text-[25px] text-[#F8E7D4]"
            style={{ fontFamily: fonts.storySerifSemiBold, letterSpacing: 1.2 }}
          >
            物語を紡いでいます
          </Text>
          <Text className="text-sm text-[#E6BE96] mt-3" style={{ fontFamily: fonts.bodyMedium, letterSpacing: 0.4 }}>
            {message}
          </Text>
          <View className="w-full mt-7 h-1.5 rounded-full bg-white/15 overflow-hidden">
            <Animated.View
              className="h-full bg-[#F59E0B]"
              style={{
                width: pulse.interpolate({
                  inputRange: [0.4, 1],
                  outputRange: ["38%", "85%"],
                }),
              }}
            />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
};

type Props = NativeStackScreenProps<RootStackParamList, "CreateSeries">;

export const CreateSeriesScreen = ({ route }: Props) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { userId } = useSessionUserId();
  const { width: screenWidth } = useWindowDimensions();
  const prefillPrompt = route.params?.prefillPrompt?.trim() || "";

  const [initialAssistant] = useState<ChatMessage>(() => buildInterviewQuestionMessage(0));
  const [seriesChatMessages, setSeriesChatMessages] = useState<ChatMessage[]>([initialAssistant]);
  const [typingMessageId, setTypingMessageId] = useState<string | null>(initialAssistant.id);
  const [seriesChatInput, setSeriesChatInput] = useState("");
  const [seriesNameCandidate, setSeriesNameCandidate] = useState("");
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [isInterviewComplete, setIsInterviewComplete] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoAdvancing, setIsAutoAdvancing] = useState(false);
  const [activeKeyword, setActiveKeyword] = useState<string | null>(null);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

  const isMountedRef = useRef(true);
  const seriesChatScrollRef = useRef<ScrollView | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const hasInjectedPrefillRef = useRef(false);

  const userAnswers = useMemo(
    () =>
      seriesChatMessages
        .filter((message) => message.role === "user")
        .map((message) => message.text.trim())
        .filter(Boolean),
    [seriesChatMessages]
  );

  const latestUserMessage = useMemo(() => userAnswers[userAnswers.length - 1] || "", [userAnswers]);

  const sourcePrompt = useMemo(() => userAnswers.join("\n").trim(), [userAnswers]);

  const interviewInput = useMemo<SeriesInterviewInput>(() => {
    const styleAnswer = userAnswers[VISUAL_STYLE_STEP_INDEX] || "シネマティックアニメ";
    const styleNotes = !VISUAL_STYLE_BADGE_SET.has(styleAnswer.trim()) ? styleAnswer : undefined;
    return {
      genreWorld: userAnswers[0] || latestUserMessage || "現代日本が舞台の少し不思議な物語",
      desiredEmotion: userAnswers[1] || "ワクワクしつつ前向きな気持ちになりたい",
      companionPreference: userAnswers[2] || "落ち着いていて安心できる相棒",
      continuationTrigger: userAnswers[3] || "謎が残って次回で答え合わせがありそうな終わり方",
      avoidExpressions: userAnswers[4] || "グロい表現や救いのない結末は避けたい",
      visualStylePreset: styleAnswer,
      visualStyleNotes: styleNotes,
      additionalNotes: userAnswers.slice(VISUAL_STYLE_STEP_INDEX + 1).join("\n").trim() || undefined,
    };
  }, [latestUserMessage, userAnswers]);

  const canSubmit = sourcePrompt.length > 0;

  const currentStep = SERIES_INTERVIEW_STEPS[Math.max(0, Math.min(activeQuestionIndex, SERIES_INTERVIEW_STEPS.length - 1))];
  const inputPlaceholder =
    isInterviewComplete || activeQuestionIndex >= SERIES_INTERVIEW_STEPS.length
      ? "補足があれば自由に入力してください"
      : currentStep.placeholder;

  const progressRatio = useMemo(() => {
    if (isInterviewComplete) return 1;
    return Math.min(0.95, activeQuestionIndex / SERIES_INTERVIEW_STEPS.length);
  }, [activeQuestionIndex, isInterviewComplete]);

  const interactionLocked = isSaving || isGenerating || isAutoAdvancing || !!typingMessageId;
  const keywordChipWidth = useMemo(() => Math.max(132, Math.floor(screenWidth * 0.48)), [screenWidth]);

  const scrollToBottom = useCallback((delay = 24) => {
    setTimeout(() => {
      seriesChatScrollRef.current?.scrollToEnd({ animated: true });
    }, delay);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      generationAbortRef.current?.abort();
      generationAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isGenerating) return;

    setLoadingMessageIndex(0);
    const timer = setInterval(() => {
      setLoadingMessageIndex((prev) => (prev + 1) % FORGING_STATUS_MESSAGES.length);
    }, 2300);

    return () => clearInterval(timer);
  }, [isGenerating]);

  useEffect(() => {
    scrollToBottom(18);
  }, [scrollToBottom, seriesChatMessages.length, typingMessageId]);

  useEffect(() => {
    if (!prefillPrompt || hasInjectedPrefillRef.current) return;
    if (seriesChatMessages.length !== 1 || seriesChatMessages[0]?.role !== "assistant") return;

    hasInjectedPrefillRef.current = true;

    const firstAnswer: ChatMessage = { id: generateId(), role: "user", text: prefillPrompt };
    const inferred = inferSeriesName(prefillPrompt);
    const fallback = inferred || deriveSeriesTitle(prefillPrompt);

    if (fallback && fallback !== "新しいシリーズ") {
      setSeriesNameCandidate(fallback);
    }

    const nextQuestionIndex = 1;
    if (nextQuestionIndex >= SERIES_INTERVIEW_STEPS.length) {
      const doneMessage = buildInterviewDoneMessage();
      setSeriesChatMessages((prev) => [...prev, firstAnswer, doneMessage]);
      setTypingMessageId(doneMessage.id);
      setIsInterviewComplete(true);
      setActiveQuestionIndex(SERIES_INTERVIEW_STEPS.length);
      return;
    }

    const nextQuestion = buildInterviewQuestionMessage(nextQuestionIndex);
    setSeriesChatMessages((prev) => [...prev, firstAnswer, nextQuestion]);
    setTypingMessageId(nextQuestion.id);
    setActiveQuestionIndex(nextQuestionIndex);
  }, [prefillPrompt, seriesChatMessages]);

  const handleAssistantTypingDone = useCallback((messageId: string) => {
    setTypingMessageId((prev) => (prev === messageId ? null : prev));
  }, []);

  const submitSeriesAnswer = useCallback(
    async (rawText?: string, source: "input" | "chip" = "input") => {
      const text = (rawText ?? seriesChatInput).trim();
      if (!text || interactionLocked) return;

      setIsAutoAdvancing(true);

      if (source === "chip") {
        setActiveKeyword(text);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        void Haptics.selectionAsync();
      }

      const inferred = inferSeriesName(text);
      const fallback = inferred || seriesNameCandidate.trim() || deriveSeriesTitle(text);
      if (inferred) {
        setSeriesNameCandidate(inferred);
      } else if (!seriesNameCandidate.trim() && fallback && fallback !== "新しいシリーズ") {
        setSeriesNameCandidate(fallback);
      }

      const userMessage: ChatMessage = { id: generateId(), role: "user", text };
      setSeriesChatMessages((prev) => [...prev, userMessage]);
      setSeriesChatInput("");

      const nextQuestionIndex = activeQuestionIndex + 1;
      await wait(140);
      if (!isMountedRef.current) return;

      if (!isInterviewComplete) {
        if (nextQuestionIndex < SERIES_INTERVIEW_STEPS.length) {
          const nextQuestion = buildInterviewQuestionMessage(nextQuestionIndex);
          setSeriesChatMessages((prev) => [...prev, nextQuestion]);
          setTypingMessageId(nextQuestion.id);
          setActiveQuestionIndex(nextQuestionIndex);
        } else {
          const doneMessage = buildInterviewDoneMessage();
          setSeriesChatMessages((prev) => [...prev, doneMessage]);
          setTypingMessageId(doneMessage.id);
          setIsInterviewComplete(true);
          setActiveQuestionIndex(SERIES_INTERVIEW_STEPS.length);
        }
      }

      if (source === "chip") {
        setTimeout(() => {
          if (!isMountedRef.current) return;
          setActiveKeyword((prev) => (prev === text ? null : prev));
        }, 360);
      }

      if (isMountedRef.current) {
        setIsAutoAdvancing(false);
      }
    },
    [activeQuestionIndex, interactionLocked, isInterviewComplete, seriesChatInput, seriesNameCandidate]
  );

  const handleGenerateSeries = useCallback(async () => {
    if (!canSubmit || isSaving) {
      Alert.alert("入力が必要です", "どんなシリーズを作りたいかチャットで教えてください。");
      return;
    }

    const promptForGeneration = (sourcePrompt || latestUserMessage).trim();
    if (!promptForGeneration) return;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    setIsSaving(true);
    setIsGenerating(true);
    const generationAbortController = new AbortController();
    generationAbortRef.current = generationAbortController;

    try {
      const titleCandidate = seriesNameCandidate.trim();
      const existingIdentityPack = await loadExistingIdentityPack(titleCandidate);

      const aiDraft = await generateSeriesDraftViaMastra(
        {
          interview: interviewInput,
          prompt: promptForGeneration,
          desiredEpisodeCount: 8,
          creatorId: userId || undefined,
          existingIdentityPack,
          identityRetcon: false,
        },
        {
          signal: generationAbortController.signal,
        }
      );

      const normalizedDraft: GeneratedSeriesDraft = {
        ...aiDraft,
        title: (aiDraft.title || titleCandidate || "新しいシリーズ").trim(),
        aiRules:
          aiDraft.aiRules?.trim() ||
          "キャラクターと伏線の整合性を保ち、各話の結果を次話へ引き継ぐこと。",
      };

      navigation.replace("SeriesGenerationResult", {
        generated: normalizedDraft,
        sourcePrompt: promptForGeneration,
      });
    } catch (error: any) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      console.error("CreateSeriesScreen: AI generation failed", error);

      const errorMessage = error?.message || "不明なエラー";
      Alert.alert(
        "シリーズ生成に失敗しました",
        `AIによる生成中にエラーが発生しました。\n\n${errorMessage}\n\n時間をおいて再度お試しください。`
      );
    } finally {
      generationAbortRef.current = null;
      if (isMountedRef.current) {
        setIsSaving(false);
        setIsGenerating(false);
      }
    }
  }, [
    canSubmit,
    interviewInput,
    isSaving,
    latestUserMessage,
    navigation,
    seriesNameCandidate,
    sourcePrompt,
    userId,
  ]);

  return (
    <View className="flex-1 bg-[#F8F7F6]">
      <SafeAreaView edges={["top"]} className="bg-[#F8F7F6]">
        <View className="px-4 pt-2 pb-3">
          <View className="flex-row items-center justify-between">
            <Pressable
              onPress={() => navigation.goBack()}
              className="w-10 h-10 rounded-full items-center justify-center border border-[#ECE6DF] bg-white"
            >
              <Ionicons name="arrow-back" size={18} color="#6C5647" />
            </Pressable>

            <View className="items-center">
              <Text className="text-[12px] text-[#8D745F]" style={{ fontFamily: fonts.bodyMedium, letterSpacing: 1.1 }}>
                シリーズ新規作成
              </Text>
              <Text className="text-[20px] text-[#2B1E16]" style={{ fontFamily: fonts.storySerifSemiBold, letterSpacing: 0.8 }}>
                物語の種を集める
              </Text>
            </View>

            <View className="w-10 h-10 rounded-full border border-[#E6DED5] bg-white items-center justify-center">
              <Text className="text-[10px] text-[#7A6351]" style={{ fontFamily: fonts.bodyBold }}>
                {Math.round(progressRatio * 100)}%
              </Text>
            </View>
          </View>

          <View className="mt-3 h-1.5 rounded-full bg-[#E8E1D8] overflow-hidden">
            <LinearGradient
              colors={["#FFE3AA", "#F5A623", "#E76F36"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{
                height: "100%",
                width: `${Math.max(4, Math.round(progressRatio * 100))}%`,
              }}
            />
          </View>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView
          ref={seriesChatScrollRef}
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 178 }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollToBottom(0)}
        >
          <View className="gap-5">
            {seriesChatMessages.map((message) =>
              message.role === "assistant" ? (
                <View key={message.id} className="flex-row items-start gap-3 pr-9">
                  <View className="w-8 h-8 rounded-full bg-[#EE8C2B] items-center justify-center mt-1">
                    <Ionicons name="sparkles" size={13} color="#FFFFFF" />
                  </View>
                  <View className="flex-1">
                    <AssistantBubble
                      message={message}
                      isTyping={typingMessageId === message.id}
                      onTypingDone={handleAssistantTypingDone}
                    />
                  </View>
                </View>
              ) : (
                <View key={message.id} className="flex-row-reverse items-start gap-3 pl-9">
                  <View className="w-8 h-8 rounded-full bg-[#E8E2DA] border border-[#DCCFC0] items-center justify-center mt-1">
                    <Ionicons name="person" size={13} color="#8F877D" />
                  </View>
                  <View className="flex-1 items-end">
                    <View className="rounded-2xl rounded-tr-md bg-[#F3A14A] px-4 py-3 max-w-[95%] border border-[#FFC280]">
                      <Text className="text-[14px] text-white leading-6" style={{ fontFamily: fonts.bodyMedium }}>
                        {message.text}
                      </Text>
                    </View>
                  </View>
                </View>
              )
            )}
          </View>
        </ScrollView>

        <SafeAreaView edges={["bottom"]} className="bg-[#F8F7F6]">
          <View className="px-4 pt-2 pb-3">
            {isInterviewComplete ? (
              <Pressable
                onPress={() => {
                  void handleGenerateSeries();
                }}
                disabled={!canSubmit || interactionLocked}
                className={`h-12 rounded-2xl items-center justify-center flex-row gap-2 ${
                  canSubmit && !interactionLocked ? "bg-[#EE8C2B]" : "bg-[#C8BDB0]"
                }`}
                style={
                  canSubmit && !interactionLocked
                    ? {
                        shadowColor: "#EE8C2B",
                        shadowOffset: { width: 0, height: 6 },
                        shadowOpacity: 0.34,
                        shadowRadius: 14,
                        elevation: 6,
                      }
                    : undefined
                }
              >
                {isSaving ? (
                  <>
                    <ActivityIndicator color="#FFFFFF" />
                    <Text className="text-base text-white" style={{ fontFamily: fonts.storySerifSemiBold }}>
                      紡いでいます...
                    </Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="sparkles" size={18} color="#FFFFFF" />
                    <Text className="text-base text-white" style={{ fontFamily: fonts.storySerifSemiBold, letterSpacing: 0.5 }}>
                      物語を紡ぐ
                    </Text>
                  </>
                )}
              </Pressable>
            ) : (
              <View className="w-full">
                <View className="mb-2 px-1 flex-row items-center justify-between">
                  <Text className="text-[12px] text-[#6F5C4A]" style={{ fontFamily: fonts.bodyMedium, letterSpacing: 0.7 }}>
                    ひらめきの欠片を選ぶと、すぐ次へ進みます
                  </Text>
                  <Text className="text-[11px] text-[#8E7B69]" style={{ fontFamily: fonts.bodyRegular }}>
                    {activeQuestionIndex + 1} / {SERIES_INTERVIEW_STEPS.length}
                  </Text>
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingRight: 8 }}
                  className="mb-1"
                >
                  <View className="flex-row gap-2">
                    {(currentStep?.chips || []).map((keyword) => (
                      <View key={keyword} style={{ width: keywordChipWidth }}>
                        <StoryKeywordChip
                          label={keyword}
                          active={activeKeyword === keyword}
                          disabled={interactionLocked}
                          onPress={() => {
                            void submitSeriesAnswer(keyword, "chip");
                          }}
                        />
                      </View>
                    ))}
                  </View>
                </ScrollView>

                <View className="mt-2 rounded-3xl border border-[#E6DED5] bg-white px-2 py-1.5 flex-row items-end gap-2">
                  <TextInput
                    value={seriesChatInput}
                    onChangeText={setSeriesChatInput}
                    placeholder={inputPlaceholder}
                    placeholderTextColor="#A38A73"
                    multiline={false}
                    numberOfLines={1}
                    allowFontScaling={false}
                    className="flex-1 h-[40px] py-2 px-2 text-[13px] text-[#2A1A0F]"
                    style={{ fontFamily: fonts.bodyRegular, textAlignVertical: "center" }}
                    editable={!interactionLocked}
                    onSubmitEditing={() => {
                      void submitSeriesAnswer(undefined, "input");
                    }}
                    returnKeyType="send"
                  />

                  <Pressable
                    className={`w-9 h-9 rounded-full items-center justify-center ${
                      seriesChatInput.trim() && !interactionLocked ? "bg-[#EE8C2B]" : "bg-[#D8CFC5]"
                    }`}
                    disabled={!seriesChatInput.trim() || interactionLocked}
                    onPress={() => {
                      void submitSeriesAnswer(undefined, "input");
                    }}
                  >
                    <Ionicons name="send" size={15} color="#FFFFFF" />
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>

      {isGenerating ? <StoryForgeLoadingOverlay message={FORGING_STATUS_MESSAGES[loadingMessageIndex]} /> : null}
    </View>
  );
};
