import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RootStackParamList } from "@/navigation/types";
import { fonts } from "@/theme/fonts";
import { useSessionUserId } from "@/hooks/useSessionUser";
import {
  generateSeriesDraftViaMastra,
  type GeneratedSeriesDraft,
  type SeriesInterviewInput,
} from "@/services/seriesAi";

const SERIES_OPTIONS_KEY = "tomoshibi.seriesOptions";
const SELECTED_SERIES_KEY = "tomoshibi.selectedSeries";
const SERIES_DRAFTS_KEY = "tomoshibi.seriesDrafts";

const GENERATING_MESSAGES = ["世界観を構築中...", "登場人物の命を吹き込み中...", "歴史の断片を収集中..."] as const;

const SERIES_INTERVIEW_STEPS = [
  {
    question: "Q1. 作りたいシリーズの『ジャンルや世界観』を教えてください。",
    placeholder: "探偵ミステリー",
  },
  {
    question: "Q2. 作りたいシリーズを通して追いかける『最大の目的』は何ですか？",
    placeholder: "未解決事件の真相を暴く",
  },
  {
    question: "Q3. この世界で、あなた自身はどのような立ち位置ですか？",
    placeholder: "偶然事件に巻き込まれた旅行者",
  },
  {
    question: "Q4. シリーズを通して、あなたのパートナーとなる人物はどんな人物ですか？",
    placeholder: "いつも前向きで引っ張ってくれる後輩",
  },
] as const;

const SERIES_INTERVIEW_DONE_MESSAGE =
  "ありがとうございます。必要な情報が揃いました。右下の「生成する」でシリーズ骨格を作成できます。";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

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

const deriveCharacters = (prompt: string): GeneratedSeriesDraft["characters"] => {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  const rules: Array<{ keywords: string[]; character: GeneratedSeriesDraft["characters"][number] }> = [
    {
      keywords: ["探偵", "事件", "推理", "謎解き"],
      character: { name: "レイ", role: "推理役" },
    },
    {
      keywords: ["高校生", "学生", "少年", "少女"],
      character: { name: "ミオ", role: "若き相棒" },
    },
    {
      keywords: ["教授", "研究", "学者", "考古"],
      character: { name: "ソウジ", role: "知識担当" },
    },
    {
      keywords: ["歴史", "伝承", "神社", "遺跡"],
      character: { name: "カナデ", role: "歴史ガイド" },
    },
    {
      keywords: ["旅", "放浪", "各地", "巡る"],
      character: { name: "ハル", role: "案内人" },
    },
    {
      keywords: ["コミカル", "コメディ", "軽快", "明るい"],
      character: { name: "タクミ", role: "ムードメーカー" },
    },
  ];

  const picked: GeneratedSeriesDraft["characters"] = [];
  const usedNames = new Set<string>();

  rules.forEach((rule) => {
    if (!containsAny(cleaned, rule.keywords)) return;
    if (usedNames.has(rule.character.name)) return;
    usedNames.add(rule.character.name);
    picked.push(rule.character);
  });

  const fallback: GeneratedSeriesDraft["characters"] = [
    { name: "アオイ", role: "主人公" },
    { name: "ユウ", role: "相棒" },
    { name: "クロ", role: "ライバル" },
  ];

  fallback.forEach((character) => {
    if (picked.length >= 3) return;
    if (usedNames.has(character.name)) return;
    usedNames.add(character.name);
    picked.push(character);
  });

  return picked.slice(0, 3);
};

const deriveOverview = (prompt: string) => {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  const concept = cleaned.length > 170 ? `${cleaned.slice(0, 170)}...` : cleaned;

  if (containsAny(cleaned, ["探偵", "事件", "謎", "推理"])) {
    return `${concept}\nこのシリーズでは、各地で発生する不可解な事件を解きながら、背後でつながる大きな真相へ迫っていきます。`;
  }
  if (containsAny(cleaned, ["歴史", "伝承", "遺跡", "古代"])) {
    return `${concept}\n土地に残る史実や伝承を手がかりに、過去と現在を結ぶ真実を一歩ずつ解き明かしていくシリーズです。`;
  }
  if (containsAny(cleaned, ["旅", "放浪", "巡る", "各地"])) {
    return `${concept}\n舞台が変わるたびに新しい出会いと謎が生まれ、積み重なった記憶がシリーズ全体の核心につながっていきます。`;
  }

  return `${concept}\n毎話で新しい舞台と出来事を描きながら、シリーズ全体を通してひとつの大きなテーマへ収束していきます。`;
};

const deriveAiRules = (prompt: string) => {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  const rules: string[] = [];

  if (containsAny(cleaned, ["コミカル", "コメディ", "軽快"])) {
    rules.push("シリアスな展開の中に、テンポのよい軽い会話を適度に挟むこと。");
  }
  if (containsAny(cleaned, ["リアル", "現実", "史実", "歴史"])) {
    rules.push("設定や出来事は、現実世界の文脈や因果関係を意識して描写すること。");
  }
  if (containsAny(cleaned, ["ミステリー", "探偵", "謎", "推理"])) {
    rules.push("謎の手がかりは段階的に提示し、解決に至るロジックを省略しないこと。");
  }

  if (rules.length === 0) {
    rules.push("キャラクターの一貫性とシリーズ全体のテーマを保ち、毎話に発見がある構成にすること。");
  }

  return rules.join(" ");
};

const generateSeriesDraftFromPrompt = (prompt: string): GeneratedSeriesDraft => ({
  title: deriveSeriesTitle(prompt),
  overview: deriveOverview(prompt),
  aiRules: deriveAiRules(prompt),
  characters: deriveCharacters(prompt),
  premise: deriveOverview(prompt),
  seasonGoal: "シリーズ全体の核心を解き明かす",
});

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

const persistSeriesDraft = async (generated: GeneratedSeriesDraft, sourcePrompt: string) => {
  const trimmedPrompt = sourcePrompt.trim();
  const trimmedTitle = generated.title.trim();
  if (!trimmedPrompt || !trimmedTitle) return;

  try {
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
      episodeBlueprints: generated.episodeBlueprints || [],
      workflowVersion: generated.workflowVersion || null,
      sourcePrompt: trimmedPrompt,
      updatedAt: new Date().toISOString(),
    };

    await AsyncStorage.setItem(SERIES_DRAFTS_KEY, JSON.stringify(drafts));
  } catch (error) {
    console.warn("CreateSeriesScreen: failed to persist AI draft", error);
  }
};

type Props = NativeStackScreenProps<RootStackParamList, "CreateSeries">;

export const CreateSeriesScreen = ({ route }: Props) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { userId } = useSessionUserId();
  const prefillPrompt = route.params?.prefillPrompt?.trim() || "";

  const [seriesChatMessages, setSeriesChatMessages] = useState<ChatMessage[]>([buildInterviewQuestionMessage(0)]);
  const [seriesChatInput, setSeriesChatInput] = useState("");
  const [seriesNameCandidate, setSeriesNameCandidate] = useState("");
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [isInterviewComplete, setIsInterviewComplete] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);

  const seriesChatScrollRef = useRef<ScrollView | null>(null);
  const generationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasInjectedPrefillRef = useRef(false);

  const latestUserMessage = useMemo(
    () => [...seriesChatMessages].reverse().find((message) => message.role === "user")?.text || "",
    [seriesChatMessages]
  );

  const sourcePrompt = useMemo(() => {
    const joined = seriesChatMessages
      .filter((message) => message.role === "user")
      .map((message) => message.text.trim())
      .filter(Boolean)
      .join("\n");
    return joined.trim();
  }, [seriesChatMessages]);

  const interviewInput = useMemo<SeriesInterviewInput>(() => {
    const answers = seriesChatMessages
      .filter((message) => message.role === "user")
      .map((message) => message.text.trim())
      .filter(Boolean);

    return {
      genreWorld: answers[0] || latestUserMessage || "現代ドラマ",
      mainObjective: answers[1] || "未解決の核心へ到達する",
      protagonistPosition: answers[2] || "偶然事件に巻き込まれた旅人",
      partnerDescription: answers[3] || "冷静に支えてくれる相棒",
      additionalNotes: answers.slice(4).join("\n").trim() || undefined,
    };
  }, [seriesChatMessages, latestUserMessage]);

  const canSubmit = sourcePrompt.length > 0;

  const inputPlaceholder = useMemo(() => {
    if (isInterviewComplete || activeQuestionIndex >= SERIES_INTERVIEW_STEPS.length) {
      return "補足があれば自由に入力してください";
    }
    return SERIES_INTERVIEW_STEPS[activeQuestionIndex]?.placeholder ?? "メッセージを入力...";
  }, [activeQuestionIndex, isInterviewComplete]);

  useEffect(() => {
    return () => {
      if (generationIntervalRef.current) {
        clearInterval(generationIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!prefillPrompt || hasInjectedPrefillRef.current) return;
    if (seriesChatMessages.length !== 1 || seriesChatMessages[0]?.role !== "assistant") return;

    hasInjectedPrefillRef.current = true;

    const firstAnswer: ChatMessage = { id: generateId(), role: "user", text: prefillPrompt };
    const nextQuestion = buildInterviewQuestionMessage(1);
    const inferred = inferSeriesName(prefillPrompt);
    const fallback = inferred || deriveSeriesTitle(prefillPrompt);

    if (fallback && fallback !== "新しいシリーズ") {
      setSeriesNameCandidate(fallback);
    }

    setSeriesChatMessages((prev) => [...prev, firstAnswer, nextQuestion]);
    setActiveQuestionIndex(1);
  }, [prefillPrompt, seriesChatMessages]);

  const submitSeriesChat = useCallback(
    (rawText?: string) => {
      const text = (rawText ?? seriesChatInput).trim();
      if (!text) return;

      const inferred = inferSeriesName(text);
      const fallback = inferred || seriesNameCandidate.trim() || deriveSeriesTitle(text);
      if (inferred) {
        setSeriesNameCandidate(inferred);
      } else if (!seriesNameCandidate.trim() && fallback && fallback !== "新しいシリーズ") {
        setSeriesNameCandidate(fallback);
      }

      const nextMessages: ChatMessage[] = [{ id: generateId(), role: "user", text }];
      const nextQuestionIndex = activeQuestionIndex + 1;

      if (!isInterviewComplete) {
        if (nextQuestionIndex < SERIES_INTERVIEW_STEPS.length) {
          nextMessages.push(buildInterviewQuestionMessage(nextQuestionIndex));
          setActiveQuestionIndex(nextQuestionIndex);
        } else {
          nextMessages.push(buildInterviewDoneMessage());
          setIsInterviewComplete(true);
          setActiveQuestionIndex(SERIES_INTERVIEW_STEPS.length);
        }
      }

      setSeriesChatMessages((prev) => [...prev, ...nextMessages]);
      setSeriesChatInput("");
    },
    [activeQuestionIndex, isInterviewComplete, seriesChatInput, seriesNameCandidate]
  );

  const scrollToBottom = () => {
    setTimeout(() => {
      seriesChatScrollRef.current?.scrollToEnd({ animated: true });
    }, 16);
  };

  const handleGenerateSeries = useCallback(async () => {
    if (!canSubmit || isSaving) {
      Alert.alert("入力が必要です", "どんなシリーズを作りたいかチャットで教えてください。");
      return;
    }

    const promptForGeneration = (sourcePrompt || latestUserMessage).trim();
    if (!promptForGeneration) return;

    setIsSaving(true);
    setIsGenerating(true);
    setMessageIndex(0);

    if (generationIntervalRef.current) {
      clearInterval(generationIntervalRef.current);
    }
    generationIntervalRef.current = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % GENERATING_MESSAGES.length);
    }, 2200);

    let normalizedDraft: GeneratedSeriesDraft | null = null;

    try {
      const titleCandidate = seriesNameCandidate.trim();

      try {
        const aiDraft = await generateSeriesDraftViaMastra({
          interview: interviewInput,
          prompt: promptForGeneration,
          desiredEpisodeCount: 8,
          creatorId: userId || undefined,
        });

        normalizedDraft = {
          ...aiDraft,
          title: (aiDraft.title || titleCandidate || "新しいシリーズ").trim(),
          aiRules:
            aiDraft.aiRules?.trim() ||
            "キャラクターと伏線の整合性を保ち、各話の結果を次話へ引き継ぐこと。",
        };
      } catch (error) {
        console.warn("CreateSeriesScreen: Mastra generation failed, fallback local draft", error);
        const fallbackDraft = generateSeriesDraftFromPrompt(promptForGeneration);
        normalizedDraft = {
          ...fallbackDraft,
          title: (titleCandidate || fallbackDraft.title || "新しいシリーズ").trim(),
        };
      }

      if (!normalizedDraft) {
        throw new Error("Series draft generation returned empty result.");
      }

      await persistSeriesDraft(normalizedDraft, promptForGeneration);
    } catch (error) {
      console.error("CreateSeriesScreen: failed to create draft", error);
      Alert.alert("シリーズ作成に失敗しました", "時間をおいて再度お試しください。");
    }

    setTimeout(() => {
      if (generationIntervalRef.current) {
        clearInterval(generationIntervalRef.current);
      }
      setIsSaving(false);
      setIsGenerating(false);

      if (!normalizedDraft) return;

      navigation.replace("SeriesGenerationResult", {
        generated: normalizedDraft,
        sourcePrompt: promptForGeneration,
      });
    }, 3400);
  }, [canSubmit, isSaving, sourcePrompt, latestUserMessage, seriesNameCandidate, interviewInput, userId, navigation]);

  if (isGenerating) {
    return (
      <View className="flex-1 bg-[#2E1D13] items-center justify-center px-8">
        <View className="absolute top-20 left-8 w-24 h-24 rounded-full bg-[#D88338]/20" />
        <View className="absolute bottom-24 right-10 w-32 h-32 rounded-full bg-[#9E673C]/20" />
        <View className="w-28 h-28 rounded-full border border-[#DCA16A]/35 items-center justify-center mb-8">
          <Ionicons name="flame" size={44} color="#F4E2CF" />
        </View>
        <Text className="text-xl text-[#F2E8DC] tracking-[3px]" style={{ fontFamily: fonts.displayBold }}>
          物語を紡いでいます...
        </Text>
        <Text className="text-sm text-[#D6B899] mt-3 text-center" style={{ fontFamily: fonts.bodyRegular }}>
          あなたの設定から、新しい世界を構築中
        </Text>

        <View className="w-full mt-10">
          <View className="h-1 w-full rounded-full bg-[#4A3525] overflow-hidden">
            <View className="h-full w-1/2 rounded-full bg-[#D97B2E]" />
          </View>
          <Text className="text-xs text-[#D9BFA6] text-center mt-4 tracking-[2px]" style={{ fontFamily: fonts.bodyMedium }}>
            {GENERATING_MESSAGES[messageIndex]}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-[#F8F7F6]">
      <SafeAreaView edges={["top"]} className="bg-[#F8F7F6]">
        <View className="h-14 px-4 border-b border-[#ECE6DF] flex-row items-center justify-between">
          <Pressable onPress={() => navigation.goBack()} className="w-9 h-9 items-center justify-center rounded-full">
            <Ionicons name="arrow-back" size={19} color="#6C5647" />
          </Pressable>
          <Text className="text-base text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
            シリーズ新規作成
          </Text>
          <View className="w-9 h-9" />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView
          ref={seriesChatScrollRef}
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 160 }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollToBottom}
        >
          <View className="gap-5">
            {seriesChatMessages.map((message) =>
              message.role === "assistant" ? (
                <View key={message.id} className="flex-row items-start gap-3 pr-10">
                  <View className="w-8 h-8 rounded-full bg-[#EE8C2B] items-center justify-center mt-1">
                    <Ionicons name="sparkles" size={14} color="#FFFFFF" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[11px] text-[#9A9389] mb-1" style={{ fontFamily: fonts.bodyRegular }}>
                      AIアシスタント
                    </Text>
                    <View className="rounded-2xl rounded-tl-md bg-white border border-[#EFE8E1] px-3.5 py-3">
                      <Text className="text-sm text-[#2B1E16] leading-6" style={{ fontFamily: fonts.bodyRegular }}>
                        {message.text}
                      </Text>
                    </View>
                  </View>
                </View>
              ) : (
                <View key={message.id} className="flex-row-reverse items-start gap-3 pl-10">
                  <View className="w-8 h-8 rounded-full bg-[#E8E2DA] items-center justify-center mt-1">
                    <Ionicons name="person" size={14} color="#8F877D" />
                  </View>
                  <View className="flex-1 items-end">
                    <View className="rounded-2xl rounded-tr-md bg-[#EE8C2B] px-3.5 py-3">
                      <Text className="text-sm text-white leading-6" style={{ fontFamily: fonts.bodyRegular }}>
                        {message.text}
                      </Text>
                    </View>
                  </View>
                </View>
              )
            )}

            {seriesNameCandidate.trim().length > 0 ? (
              <View className="flex-row items-start gap-3 pr-10">
                <View className="w-8 h-8 rounded-full bg-[#EE8C2B] items-center justify-center mt-1">
                  <Ionicons name="sparkles" size={14} color="#FFFFFF" />
                </View>
                <View className="flex-1">
                  <Text className="text-[11px] text-[#9A9389] mb-1" style={{ fontFamily: fonts.bodyRegular }}>
                    AIアシスタント
                  </Text>
                  <View className="rounded-2xl rounded-tl-md bg-[#FFF7EC] border border-[#F4DFC6] px-3.5 py-3">
                    <Text className="text-sm text-[#2B1E16]" style={{ fontFamily: fonts.bodyRegular }}>
                      現在の仮タイトル: <Text style={{ fontFamily: fonts.displayBold, color: "#C87A2D" }}>「{seriesNameCandidate}」</Text>
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}
          </View>
        </ScrollView>

        <SafeAreaView edges={["bottom"]} className="bg-[#F8F7F6] border-t border-[#EFE7DD]">
          <View className="px-4 pt-2 pb-3">
            {isInterviewComplete ? (
              <Pressable
                onPress={() => {
                  void handleGenerateSeries();
                }}
                disabled={!canSubmit || isSaving}
                className={`h-12 rounded-2xl items-center justify-center ${
                  canSubmit && !isSaving ? "bg-[#EE8C2B]" : "bg-[#E8E2DA]"
                }`}
                style={
                  canSubmit && !isSaving
                    ? {
                        shadowColor: "#EE8C2B",
                        shadowOffset: { width: 0, height: 5 },
                        shadowOpacity: 0.28,
                        shadowRadius: 12,
                        elevation: 3,
                      }
                    : undefined
                }
              >
                {isSaving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text
                    className={`text-base ${canSubmit ? "text-white" : "text-[#A39A90]"}`}
                    style={{ fontFamily: fonts.displayBold }}
                  >
                    生成する
                  </Text>
                )}
              </Pressable>
            ) : (
              <View className="rounded-3xl border border-[#E6DED5] bg-white px-2 py-1.5 flex-row items-end gap-2">
                <Pressable
                  className="w-9 h-9 rounded-full items-center justify-center"
                  onPress={() => Alert.alert("準備中", "画像入力は次フェーズで追加予定です。")}
                >
                  <Ionicons name="image-outline" size={20} color="#A39A90" />
                </Pressable>

                <TextInput
                  value={seriesChatInput}
                  onChangeText={setSeriesChatInput}
                  placeholder={inputPlaceholder}
                  placeholderTextColor="#A39A90"
                  multiline
                  className="flex-1 min-h-[40px] max-h-[120px] py-2 px-1 text-sm text-[#221910]"
                  style={{ fontFamily: fonts.bodyRegular, textAlignVertical: "center" }}
                />

                <Pressable
                  className="w-9 h-9 rounded-full bg-[#EE8C2B] items-center justify-center"
                  onPress={() => submitSeriesChat()}
                >
                  <Ionicons name="send" size={16} color="#FFFFFF" />
                </Pressable>
              </View>
            )}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
};
