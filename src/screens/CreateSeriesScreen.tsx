import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import type { RootStackParamList } from "@/navigation/types";
import { fonts } from "@/theme/fonts";
import { useSessionUserId } from "@/hooks/useSessionUser";
import { isSupabaseConfigured } from "@/lib/supabase";
import { fetchRecentSeriesGenerationContext } from "@/services/quests";
import {
  generateSeriesDraftViaMastra,
  type GeneratedSeriesDraft,
  type GeneratedSeriesIdentityPack,
  type SeriesInterviewInput,
  type SeriesDraftGenerationPhase,
} from "@/services/seriesAi";

const SERIES_DRAFTS_KEY = "tomoshibi.seriesDrafts";

type SeriesInterviewStep = {
  id: "q1" | "q2" | "q3" | "q4" | "q5";
  label: string;
  question: string;
  placeholder: string;
  chips: string[];
  minSelect: number;
  maxSelect: number;
  optional?: boolean;
  helper: string;
};

const SERIES_INTERVIEW_STEPS: readonly SeriesInterviewStep[] = [
  {
    id: "q1",
    label: "シリーズQ1",
    question: "このシリーズでは、どんな気持ちを味わいたいですか？",
    placeholder: "必要なら補足を入力（任意）",
    chips: ["ワクワク", "ドキドキ", "ときめき", "じんわり", "癒やし", "切なさ", "不思議", "緊張感", "没入感", "安心感"],
    minSelect: 1,
    maxSelect: 2,
    helper: "1〜2個選ぶのがおすすめです",
  },
  {
    id: "q2",
    label: "シリーズQ2",
    question: "どんな相手と一緒に旅したいですか？",
    placeholder: "必要なら補足を入力（任意）",
    chips: [
      "信頼できる相棒",
      "気になる相手",
      "頼れる先輩",
      "不思議な案内人",
      "ミステリアスな相手",
      "優しい相手",
      "からかってくる相手",
      "落ち着いた相手",
      "一緒に謎を追う相手",
      "おまかせ",
    ],
    minSelect: 1,
    maxSelect: 1,
    helper: "基本は1つ選択。旅を共にする相手の雰囲気が決まります",
  },
  {
    id: "q3",
    label: "シリーズQ3",
    question: "物語の雰囲気は、どれくらい現実に近い方がいいですか？",
    placeholder: "必要なら補足を入力（任意）",
    chips: [
      "かなり現実的",
      "現実の延長",
      "現実の中に少し秘密",
      "少し不思議",
      "都市伝説っぽい",
      "謎が潜んでいる",
      "少し幻想的",
      "おまかせ",
    ],
    minSelect: 1,
    maxSelect: 1,
    helper: "世界観のリアリティラインをここで決めます",
  },
  {
    id: "q4",
    label: "シリーズQ4",
    question: "物語は、どんなふうに進んでいくのが好きですか？",
    placeholder: "必要なら補足を入力（任意）",
    chips: [
      "明るくテンポよく",
      "少しずつ深まる",
      "毎回小さな発見がある",
      "謎がつながっていく",
      "関係がじわじわ変わる",
      "最後に大きく動く",
      "会話を楽しみたい",
      "余韻が残る感じ",
      "おまかせ",
    ],
    minSelect: 1,
    maxSelect: 2,
    helper: "1〜2個選ぶと、進行のテンポがはっきりします",
  },
  {
    id: "q5",
    label: "シリーズQ5（任意）",
    question: "好きな雰囲気や、逆に苦手なものがあれば教えてください。",
    placeholder: "例: 不思議さは欲しいけど怖いのは避けたい",
    chips: [
      "甘すぎない",
      "怖すぎない",
      "重すぎない",
      "会話多めがいい",
      "ロマンチック寄り",
      "友情寄り",
      "ミステリー寄り",
      "落ち着いた雰囲気",
      "景色を味わいたい",
      "おまかせ",
    ],
    minSelect: 0,
    maxSelect: 3,
    optional: true,
    helper: "任意です。キーワードだけでもOKです",
  },
] as const;

const SERIES_INTERVIEW_DONE_MESSAGE =
  "ありがとうございます。回答をもとにシリーズを生成します。準備ができたら次へ進みましょう。";

const SERIES_PHASE_USER_COPY: Record<SeriesDraftGenerationPhase, string> = {
  request_received: "生成依頼を受け取りました。",
  input_validated: "入力内容を確認しています。",
  sanitize_series_request_start: "好みと制約を整理しています。",
  sanitize_series_request_done: "生成条件の整理が完了しました。",
  load_series_generation_context_start: "既存シリーズ文脈を確認しています。",
  load_series_generation_context_done: "既存シリーズ文脈の確認が完了しました。",
  evaluate_series_generation_eligibility_start: "新規シリーズ生成の可否を判定しています。",
  evaluate_series_generation_eligibility_done: "新規シリーズ生成が可能です。",
  derive_series_design_brief_start: "体験方針（サービス設計ブリーフ）を導出しています。",
  derive_series_design_brief_done: "体験方針の導出が完了しました。",
  derive_series_framework_brief_start: "シリーズ母体の上位契約を設計しています。",
  derive_series_framework_brief_done: "シリーズ母体の上位契約を確定しました。",
  generate_series_concept_start: "世界観と長編コンセプトを設計しています。",
  generate_series_concept_done: "世界観コンセプトの骨格ができました。",
  generate_series_core_start: "シリーズ母体の核を設計しています。",
  generate_series_core_done: "シリーズ母体の核が確定しました。",
  generate_user_role_frame_start: "ユーザーの立場をシリーズ内に配置しています。",
  generate_user_role_frame_done: "ユーザーの立場を確定しました。",
  generate_series_characters_start: "固定キャラクターを設計しています。",
  generate_series_characters_done: "固定キャラクター設計が完了しました。",
  generate_persistent_cast_start: "継続登場する固定キャラを設計しています。",
  generate_persistent_cast_done: "継続登場キャラの設計が完了しました。",
  build_series_identity_pack_start: "キャラクター同一性のアンカーを固定しています。",
  build_series_identity_pack_done: "同一性アンカーの固定が完了しました。",
  generate_series_checkpoints_start: "シリーズ進行のチェックポイントを設計しています。",
  generate_series_checkpoints_done: "チェックポイント設計が完了しました。",
  build_series_continuity_axes_start: "シリーズで積み上がる継続軸を設計しています。",
  build_series_continuity_axes_done: "継続軸の設計が完了しました。",
  build_episode_generation_contract_start: "エピソード生成契約を設計しています。",
  build_episode_generation_contract_done: "エピソード生成契約が確定しました。",
  seed_route_dry_run_start: "第1話の導線が成立するか検証しています。",
  seed_route_dry_run_done: "第1話導線の検証が完了しました。",
  finalize_series_blueprint_start: "シリーズBlueprintを統合しています。",
  generate_series_cover_candidates_start: "カバー候補を生成しています。",
  generate_series_cover_candidates_done: "カバー候補の生成が完了しました。",
  generate_series_visual_bundle_start: "シリーズのカバーと固定キャラ画像を生成しています。",
  generate_series_visual_bundle_done: "シリーズ画像の生成が完了しました。",
  validate_cover_identity_start: "カバーとシリーズ同一性を照合しています。",
  validate_cover_identity_done: "カバー整合チェックが完了しました。",
  finalize_series_blueprint_done: "最終調整を行っています。",
  response_preparing: "結果を整えて返却準備をしています。",
  completed: "シリーズ生成が完了しました。",
};

type SeriesWorkflowStageStatus = "pending" | "active" | "done";
type SeriesWorkflowStage = {
  id: string;
  label: string;
  summary: string;
  phases: readonly SeriesDraftGenerationPhase[];
};

const SERIES_WORKFLOW_STAGES: readonly SeriesWorkflowStage[] = [
  {
    id: "request",
    label: "受付と入力確認",
    summary: "生成依頼の受理と入力検証を行います。",
    phases: ["request_received", "input_validated"],
  },
  {
    id: "sanitize",
    label: "条件の正規化",
    summary: "インタビュー回答を生成条件へ正規化します。",
    phases: ["sanitize_series_request_start", "sanitize_series_request_done"],
  },
  {
    id: "context",
    label: "既存状況の確認",
    summary: "既存シリーズ文脈の取得と新規生成可否の判定を行います。",
    phases: [
      "load_series_generation_context_start",
      "load_series_generation_context_done",
      "evaluate_series_generation_eligibility_start",
      "evaluate_series_generation_eligibility_done",
    ],
  },
  {
    id: "brief",
    label: "体験方針設計",
    summary: "デバイスサービスデザインブリーフを導出し、後続生成の方針を固定します。",
    phases: [
      "derive_series_design_brief_start",
      "derive_series_design_brief_done",
      "derive_series_framework_brief_start",
      "derive_series_framework_brief_done",
    ],
  },
  {
    id: "concept",
    label: "世界観設計",
    summary: "シリーズ母体の核となるコンセプトとユーザー立場を設計します。",
    phases: [
      "generate_series_concept_start",
      "generate_series_concept_done",
      "generate_series_core_start",
      "generate_series_core_done",
      "generate_user_role_frame_start",
      "generate_user_role_frame_done",
    ],
  },
  {
    id: "cast",
    label: "固定キャラ設計",
    summary: "固定キャラクターと同一性アンカーを確定します。",
    phases: [
      "generate_series_characters_start",
      "generate_series_characters_done",
      "generate_persistent_cast_start",
      "generate_persistent_cast_done",
      "build_series_identity_pack_start",
      "build_series_identity_pack_done",
    ],
  },
  {
    id: "checkpoint",
    label: "継続契約設計",
    summary: "継続軸とエピソード生成契約を設計します。",
    phases: [
      "generate_series_checkpoints_start",
      "generate_series_checkpoints_done",
      "build_series_continuity_axes_start",
      "build_series_continuity_axes_done",
      "build_episode_generation_contract_start",
      "build_episode_generation_contract_done",
      "seed_route_dry_run_start",
      "seed_route_dry_run_done",
    ],
  },
  {
    id: "finalize",
    label: "統合と品質確認",
    summary: "Blueprint統合、カバー整合、返却準備を行います。",
    phases: [
      "finalize_series_blueprint_start",
      "generate_series_cover_candidates_start",
      "generate_series_cover_candidates_done",
      "generate_series_visual_bundle_start",
      "generate_series_visual_bundle_done",
      "validate_cover_identity_start",
      "validate_cover_identity_done",
      "finalize_series_blueprint_done",
      "response_preparing",
    ],
  },
  {
    id: "done",
    label: "完了",
    summary: "シリーズを利用できる状態で返却します。",
    phases: ["completed"],
  },
] as const;

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
const SERIES_RESULT_IMAGE_PREFETCH_TIMEOUT_MS = 25_000;

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const buildInterviewQuestionMessage = (index: number): ChatMessage => ({
  id: generateId(),
  role: "assistant",
  text: (() => {
    const step = SERIES_INTERVIEW_STEPS[Math.max(0, Math.min(index, SERIES_INTERVIEW_STEPS.length - 1))];
    return `${step.label}\n${step.question}`;
  })(),
});

const buildInterviewDoneMessage = (): ChatMessage => ({
  id: generateId(),
  role: "assistant",
  text: SERIES_INTERVIEW_DONE_MESSAGE,
});

const containsAny = (source: string, keywords: string[]) => keywords.some((keyword) => source.includes(keyword));
const normalizeCopy = (value?: string | null, fallback = "") => {
  const cleaned = (value || "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
};

const parseSeriesGenerationBlockingError = (message: string) => {
  const normalized = normalizeCopy(message);
  if (!normalized) return null;

  if (normalized.startsWith("series_generation_blocked_existing_draft:")) {
    const title = normalizeCopy(normalized.split(":").slice(1).join(":"));
    return {
      kind: "existing_draft_conflict" as const,
      title: title || "既存ドラフト",
    };
  }

  if (normalized === "series_generation_blocked_too_many_drafts") {
    return {
      kind: "too_many_drafts" as const,
    };
  }

  return null;
};

const toSeriesPhaseMessage = (phase: SeriesDraftGenerationPhase, detail?: string) => {
  const phaseCopy = SERIES_PHASE_USER_COPY[phase];
  if (!detail) return phaseCopy;
  const normalizedDetail = normalizeCopy(detail).toLowerCase();
  if (!normalizedDetail) return phaseCopy;
  if (
    normalizedDetail.includes("attempt") ||
    normalizedDetail.includes("llm") ||
    normalizedDetail.includes("schema") ||
    normalizedDetail.includes("timeout")
  ) {
    return phaseCopy;
  }
  return phaseCopy;
};

const collectSeriesDraftImageUris = (draft: GeneratedSeriesDraft): string[] => {
  const uris: string[] = [];
  const cover = normalizeCopy(draft.coverImageUrl);
  if (cover) uris.push(cover);

  for (const character of draft.characters || []) {
    const portrait = normalizeCopy(character.portraitImageUrl);
    if (portrait) uris.push(portrait);
  }

  const visualAssets = Array.isArray(draft.world?.visualAssets) ? draft.world.visualAssets : [];
  for (const visual of visualAssets) {
    const imageUrl = normalizeCopy(visual.imageUrl);
    if (imageUrl) uris.push(imageUrl);
  }

  const seen = new Set<string>();
  return uris.filter((uri) => {
    if (!uri) return false;
    if (seen.has(uri)) return false;
    seen.add(uri);
    return true;
  });
};

const createAbortError = () => {
  const error = new Error("Aborted");
  (error as Error & { name: string }).name = "AbortError";
  return error;
};

const prefetchSeriesDraftImages = async (params: {
  uris: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}) => {
  const { uris, timeoutMs, signal, onProgress } = params;
  if (uris.length === 0) return;

  await new Promise<void>((resolve, reject) => {
    let completed = 0;
    let settled = false;
    const total = uris.length;
    const timeout = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      },
      Math.max(5_000, timeoutMs ?? SERIES_RESULT_IMAGE_PREFETCH_TIMEOUT_MS)
    );

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(error);
    };

    const onAbort = () => fail(createAbortError());
    if (signal?.aborted) {
      onAbort();
      return;
    }
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    uris.forEach((uri) => {
      Image.prefetch(uri)
        .catch(() => false)
        .then(() => {
          if (settled) return;
          completed += 1;
          onProgress?.(completed, total);
          if (completed >= total) finish();
        });
    });
  });
};

const resolveSeriesWorkflowStageIndex = (phase: SeriesDraftGenerationPhase) => {
  for (let index = 0; index < SERIES_WORKFLOW_STAGES.length; index += 1) {
    if (SERIES_WORKFLOW_STAGES[index].phases.includes(phase)) return index;
  }
  return 0;
};

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
        style={{ fontFamily: fonts.bodyRegular, letterSpacing: 0.3 }}
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
    <Animated.View style={{ transform: [{ scale }] }}>
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
        className={`h-9 overflow-hidden rounded-full border px-3 items-center justify-center ${
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
          className={`text-[12px] ${active ? "text-white" : "text-[#5E4A39]"}`}
          style={{
            fontFamily: active ? fonts.bodyBold : fonts.bodyMedium,
            lineHeight: 16,
            textAlign: "center",
            textAlignVertical: "center",
            includeFontPadding: false,
          }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.74}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
};

const StoryForgeLoadingOverlay = ({
  message,
  stages,
  progressMessages,
  onCancel,
}: {
  message: string;
  stages: Array<{
    id: string;
    label: string;
    summary: string;
    status: SeriesWorkflowStageStatus;
  }>;
  progressMessages: string[];
  onCancel?: () => void;
}) => {
  const pulse = useRef(new Animated.Value(0.4)).current;
  const orbit = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ])
    );

    loop.start();
    return () => {
      loop.stop();
    };
  }, [pulse]);

  useEffect(() => {
    const orbitLoop = Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: 4200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    orbitLoop.start();
    return () => {
      orbitLoop.stop();
    };
  }, [orbit]);

  const orbitRotation = orbit.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const reverseOrbitRotation = orbit.interpolate({
    inputRange: [0, 1],
    outputRange: ["360deg", "0deg"],
  });

  const activeStage = stages.find((stage) => stage.status === "active");
  const recentMessages = (progressMessages.length > 0 ? progressMessages : [message]).slice(-3);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="auto">
      <LinearGradient colors={["#0B101D", "#1B1211", "#3A220F"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <SafeAreaView edges={["top", "bottom"]} className="flex-1 items-center justify-center px-8">
        <View className="items-center w-full max-w-[380px]">
          <View className="w-[220px] h-[220px] items-center justify-center mb-4">
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                width: 170,
                height: 170,
                borderRadius: 170,
                backgroundColor: "rgba(250, 179, 108, 0.18)",
                opacity: pulse.interpolate({
                  inputRange: [0.4, 1],
                  outputRange: [0.42, 0.8],
                }),
                transform: [
                  {
                    scale: pulse.interpolate({
                      inputRange: [0.4, 1],
                      outputRange: [0.9, 1.12],
                    }),
                  },
                ],
              }}
            />
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                width: 198,
                height: 198,
                borderRadius: 198,
                borderWidth: 1.4,
                borderColor: "rgba(248, 203, 158, 0.34)",
                transform: [{ rotate: orbitRotation }],
              }}
            >
              <View
                style={{
                  position: "absolute",
                  top: -2,
                  left: 96,
                  width: 5,
                  height: 5,
                  borderRadius: 5,
                  backgroundColor: "rgba(255, 220, 183, 0.95)",
                }}
              />
              <View
                style={{
                  position: "absolute",
                  bottom: -1,
                  right: 42,
                  width: 3,
                  height: 3,
                  borderRadius: 3,
                  backgroundColor: "rgba(255, 220, 183, 0.85)",
                }}
              />
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                width: 156,
                height: 156,
                borderRadius: 156,
                borderWidth: 1,
                borderColor: "rgba(242, 170, 112, 0.32)",
                transform: [{ rotate: reverseOrbitRotation }],
              }}
            >
              <View
                style={{
                  position: "absolute",
                  top: 21,
                  right: 7,
                  width: 4,
                  height: 4,
                  borderRadius: 4,
                  backgroundColor: "rgba(255, 205, 156, 0.92)",
                }}
              />
              <View
                style={{
                  position: "absolute",
                  bottom: 11,
                  left: 16,
                  width: 3,
                  height: 3,
                  borderRadius: 3,
                  backgroundColor: "rgba(255, 205, 156, 0.76)",
                }}
              />
            </Animated.View>
            <Animated.View
              style={{
                width: 108,
                height: 108,
                borderRadius: 108,
                overflow: "hidden",
                opacity: pulse.interpolate({
                  inputRange: [0.4, 1],
                  outputRange: [0.9, 1],
                }),
                transform: [
                  {
                    scale: pulse.interpolate({
                      inputRange: [0.4, 1],
                      outputRange: [0.95, 1.03],
                    }),
                  },
                ],
              }}
            >
              <LinearGradient
                colors={["#FFE4C5", "#F5B066", "#D8782C"]}
                start={{ x: 0.15, y: 0.1 }}
                end={{ x: 1, y: 1 }}
                className="flex-1 items-center justify-center"
              >
                <Ionicons name="flame" size={44} color="#2A1409" />
              </LinearGradient>
            </Animated.View>
          </View>

          <Text
            className="text-[25px] text-[#F8E7D4]"
            style={{ fontFamily: fonts.displayBold, letterSpacing: 1.2 }}
          >
            物語を紡いでいます
          </Text>
          <Text className="text-sm text-[#E6BE96] mt-2" style={{ fontFamily: fonts.bodyMedium, letterSpacing: 0.4 }}>
            {message}
          </Text>

          <View className="w-full mt-4 rounded-2xl border border-white/15 bg-white/8 px-4 py-3">
            <Text className="text-[11px] text-[#F1D6B8]" style={{ fontFamily: fonts.bodyMedium, letterSpacing: 0.6 }}>
              生成ログ
            </Text>
            {recentMessages.map((line, index) => {
              const isLatest = index === recentMessages.length - 1;
              return (
                <View
                  key={`progress-message-${index}-${line}`}
                  className={`mt-2 rounded-xl px-3 py-2 ${isLatest ? "bg-[#FFF5E8]/95" : "bg-white/10"}`}
                >
                  <Text
                    className={`text-[12px] leading-5 ${isLatest ? "text-[#3A2718]" : "text-[#F4DFC8]"}`}
                    style={{ fontFamily: fonts.bodyRegular }}
                  >
                    {line}
                  </Text>
                </View>
              );
            })}
          </View>

          <View className="w-full mt-3 rounded-2xl border border-white/15 bg-white/8 px-4 py-3">
            <Text className="text-[11px] text-[#F1D6B8]" style={{ fontFamily: fonts.bodyMedium, letterSpacing: 0.6 }}>
              ワークフロー進行
            </Text>
            <View className="mt-2 gap-2">
              {stages.map((stage) => {
                const iconName =
                  stage.status === "done"
                    ? "checkmark-circle"
                    : stage.status === "active"
                      ? "sync-circle"
                      : "ellipse-outline";
                const iconColor =
                  stage.status === "done"
                    ? "#FBC37F"
                    : stage.status === "active"
                      ? "#FDE2BF"
                      : "rgba(255, 234, 210, 0.45)";
                return (
                  <View key={stage.id} className="flex-row items-center gap-2">
                    <Ionicons name={iconName as any} size={15} color={iconColor} />
                    <Text
                      className={`text-[12px] ${stage.status === "pending" ? "text-[#C6AE96]" : "text-[#F5DFC6]"}`}
                      style={{ fontFamily: stage.status === "active" ? fonts.bodyBold : fonts.bodyMedium }}
                    >
                      {stage.label}
                    </Text>
                  </View>
                );
              })}
            </View>
            {activeStage ? (
              <Text className="mt-2 text-[11px] text-[#E7C7A3]" style={{ fontFamily: fonts.bodyRegular }}>
                現在: {activeStage.summary}
              </Text>
            ) : null}
          </View>

          <View className="w-full mt-3 h-1.5 rounded-full bg-white/15 overflow-hidden">
            <Animated.View
              className="h-full bg-[#F59E0B]"
              style={{
                width: "100%",
                transform: [
                  {
                    scaleX: pulse.interpolate({
                      inputRange: [0.4, 1],
                      outputRange: [0.38, 0.85],
                    }),
                  },
                ],
              }}
            />
          </View>

          {onCancel ? (
            <Pressable onPress={onCancel} className="mt-5 rounded-full border border-white/35 px-4 py-2">
              <Text className="text-[12px] text-[#F7D9B8]" style={{ fontFamily: fonts.bodyMedium, letterSpacing: 0.6 }}>
                生成を中止
              </Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
};

type Props = NativeStackScreenProps<RootStackParamList, "CreateSeries">;
type CreateSeriesInputMode = "chat" | "prompt";

export const CreateSeriesScreen = ({ route }: Props) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { userId, userName } = useSessionUserId();
  const prefillPrompt = route.params?.prefillPrompt?.trim() || "";
  const hasPrefillPrompt = prefillPrompt.length > 0;

  const [initialAssistant] = useState<ChatMessage>(() => buildInterviewQuestionMessage(0));
  const [seriesChatMessages, setSeriesChatMessages] = useState<ChatMessage[]>([initialAssistant]);
  const [typingMessageId, setTypingMessageId] = useState<string | null>(initialAssistant.id);
  const [seriesChatInput, setSeriesChatInput] = useState("");
  const [inputMode, setInputMode] = useState<CreateSeriesInputMode>(hasPrefillPrompt ? "prompt" : "chat");
  const [directPromptInput, setDirectPromptInput] = useState(prefillPrompt);
  const [seriesNameCandidate, setSeriesNameCandidate] = useState("");
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [isInterviewComplete, setIsInterviewComplete] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoAdvancing, setIsAutoAdvancing] = useState(false);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [stepAnswers, setStepAnswers] = useState<Partial<Record<SeriesInterviewStep["id"], string>>>({});
  const [latestGenerationPhase, setLatestGenerationPhase] = useState<SeriesDraftGenerationPhase>("request_received");
  const [liveGenerationMessage, setLiveGenerationMessage] = useState<string>(SERIES_PHASE_USER_COPY.request_received);
  const [generationProgressMessages, setGenerationProgressMessages] = useState<string[]>([]);

  const isMountedRef = useRef(true);
  const seriesChatScrollRef = useRef<ScrollView | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const hasInjectedPrefillRef = useRef(false);

  const sourcePrompt = useMemo(
    () =>
      SERIES_INTERVIEW_STEPS.map((step) => {
        const answer = (stepAnswers[step.id] || "").trim();
        return answer ? `${step.label}: ${answer}` : "";
      })
        .filter(Boolean)
        .join("\n"),
    [stepAnswers]
  );

  const interviewInput = useMemo<SeriesInterviewInput>(() => {
    const q1 = (stepAnswers.q1 || "").trim();
    const q2 = (stepAnswers.q2 || "").trim();
    const q3 = (stepAnswers.q3 || "").trim();
    const q4 = (stepAnswers.q4 || "").trim();
    const q5 = (stepAnswers.q5 || "").trim();
    return {
      genreWorld: q3 || "現実の中に少し秘密が潜む、徒歩で巡れる現代日本の物語",
      desiredEmotion: q1 || "ワクワクとじんわりが共存する体験",
      companionPreference: q2 || "信頼できる相棒",
      continuationTrigger: q4 || "毎回小さな発見があり、謎がつながっていく進行",
      avoidExpressions: q5 || "怖すぎる・重すぎる展開は避ける",
      visualStylePreset: "シネマティックアニメ",
      visualStyleNotes: undefined,
      additionalNotes: sourcePrompt || undefined,
    };
  }, [sourcePrompt, stepAnswers]);

  const generationPrompt = useMemo(
    () => (inputMode === "prompt" ? directPromptInput.trim() : sourcePrompt.trim()),
    [directPromptInput, inputMode, sourcePrompt]
  );

  const interviewInputForGeneration = useMemo<SeriesInterviewInput>(() => {
    if (inputMode !== "prompt") return interviewInput;
    const notes = generationPrompt || undefined;
    return {
      genreWorld: "ユーザー入力の自由プロンプトを最優先で反映",
      desiredEmotion: "プロンプト文面から抽出",
      companionPreference: "プロンプト文面から抽出",
      continuationTrigger: "プロンプト文面から抽出",
      avoidExpressions: "",
      visualStylePreset: "シネマティックアニメ",
      visualStyleNotes: undefined,
      additionalNotes: notes,
    };
  }, [generationPrompt, inputMode, interviewInput]);

  const requiredAnswered = useMemo(
    () => SERIES_INTERVIEW_STEPS.filter((step) => !step.optional).every((step) => Boolean((stepAnswers[step.id] || "").trim())),
    [stepAnswers]
  );

  const canSubmit = useMemo(() => {
    if (inputMode === "prompt") return generationPrompt.length > 0;
    return requiredAnswered;
  }, [generationPrompt, inputMode, requiredAnswered]);

  const currentStep = SERIES_INTERVIEW_STEPS[Math.max(0, Math.min(activeQuestionIndex, SERIES_INTERVIEW_STEPS.length - 1))];
  const inputPlaceholder =
    isInterviewComplete || activeQuestionIndex >= SERIES_INTERVIEW_STEPS.length
      ? "補足があれば自由に入力してください"
      : currentStep.placeholder;

  const progressRatio = useMemo(() => {
    if (inputMode === "prompt") {
      if (!generationPrompt) return 0.2;
      return Math.min(1, Math.max(0.35, generationPrompt.length / 220));
    }
    if (isInterviewComplete) return 1;
    return Math.max(0.08, Math.min(0.95, (activeQuestionIndex + 1) / SERIES_INTERVIEW_STEPS.length));
  }, [activeQuestionIndex, generationPrompt, inputMode, isInterviewComplete]);

  const workflowStageRows = useMemo(() => {
    const currentIndex = resolveSeriesWorkflowStageIndex(latestGenerationPhase);
    return SERIES_WORKFLOW_STAGES.map((stage, index) => {
      let status: SeriesWorkflowStageStatus = "pending";
      if (index < currentIndex) status = "done";
      if (index === currentIndex) status = "active";
      if (latestGenerationPhase === "completed" && index <= currentIndex) status = "done";
      return {
        id: stage.id,
        label: stage.label,
        summary: stage.summary,
        status,
      };
    });
  }, [latestGenerationPhase]);

  const interactionLocked =
    inputMode === "chat"
      ? isSaving || isGenerating || isAutoAdvancing || !!typingMessageId
      : isSaving || isGenerating;

  const scrollToBottom = useCallback((delay = 24) => {
    setTimeout(() => {
      if (!isMountedRef.current) return;
      const scrollRef = seriesChatScrollRef.current;
      if (!scrollRef || typeof scrollRef.scrollToEnd !== "function") return;
      try {
        scrollRef.scrollToEnd({ animated: true });
      } catch {
        // React Native Web can temporarily lose the underlying node during reflow/unmount.
      }
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
    if (!isGenerating) {
      setLatestGenerationPhase("request_received");
      setLiveGenerationMessage(SERIES_PHASE_USER_COPY.request_received);
      setGenerationProgressMessages([]);
      return;
    }

    if (generationProgressMessages.length === 0) {
      setLatestGenerationPhase("request_received");
      setLiveGenerationMessage(SERIES_PHASE_USER_COPY.request_received);
      setGenerationProgressMessages([SERIES_PHASE_USER_COPY.request_received]);
    }
  }, [generationProgressMessages.length, isGenerating]);

  useEffect(() => {
    scrollToBottom(18);
  }, [scrollToBottom, seriesChatMessages.length, typingMessageId]);

  useEffect(() => {
    if (!prefillPrompt || hasInjectedPrefillRef.current) return;
    hasInjectedPrefillRef.current = true;
    setDirectPromptInput((prev) => prev || prefillPrompt);
    const inferred = inferSeriesName(prefillPrompt) || deriveSeriesTitle(prefillPrompt);
    if (inferred && inferred !== "新しいシリーズ") {
      setSeriesNameCandidate(inferred);
    }
  }, [prefillPrompt]);

  const handleAssistantTypingDone = useCallback((messageId: string) => {
    setTypingMessageId((prev) => (prev === messageId ? null : prev));
  }, []);

  const toggleKeyword = useCallback(
    (keyword: string) => {
      if (!currentStep || interactionLocked) return;
      setSelectedKeywords((prev) => {
        const exists = prev.includes(keyword);
        if (exists) return prev.filter((item) => item !== keyword);
        if (currentStep.maxSelect <= 1) return [keyword];
        if (prev.length >= currentStep.maxSelect) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          return prev;
        }
        return [...prev, keyword];
      });
      void Haptics.selectionAsync();
    },
    [currentStep, interactionLocked]
  );

  const buildCurrentAnswerText = useCallback(
    (skipOptional = false) => {
      if (!currentStep) return "";
      if (skipOptional && currentStep.optional) return "";

      const selected = selectedKeywords.map((item) => item.trim()).filter(Boolean);
      const free = seriesChatInput.trim();
      if (selected.length > 0 && free) return `${selected.join(" / ")}（補足: ${free}）`;
      if (selected.length > 0) return selected.join(" / ");
      return free;
    },
    [currentStep, selectedKeywords, seriesChatInput]
  );

  const submitSeriesAnswer = useCallback(
    async (skipOptional = false) => {
      if (!currentStep || interactionLocked) return;
      setIsAutoAdvancing(true);
      const text = buildCurrentAnswerText(skipOptional);
      const selectedCount = selectedKeywords.length;
      const hasFreeInput = seriesChatInput.trim().length > 0;
      const hasAnswer = text.length > 0;

      if (!skipOptional && currentStep.minSelect > 0 && selectedCount < currentStep.minSelect && !hasFreeInput) {
        Alert.alert("回答が必要です", `${currentStep.minSelect}個以上選ぶか、補足を入力してください。`);
        setIsAutoAdvancing(false);
        return;
      }

      if (!currentStep.optional && !hasAnswer) {
        Alert.alert("回答が必要です", "この質問は回答が必要です。");
        setIsAutoAdvancing(false);
        return;
      }

      if (text) {
        const inferred = inferSeriesName(text);
        const fallback = inferred || seriesNameCandidate.trim() || deriveSeriesTitle(text);
        if (inferred) {
          setSeriesNameCandidate(inferred);
        } else if (!seriesNameCandidate.trim() && fallback && fallback !== "新しいシリーズ") {
          setSeriesNameCandidate(fallback);
        }
      }

      setStepAnswers((prev) => ({
        ...prev,
        [currentStep.id]: text,
      }));

      const userMessage: ChatMessage = {
        id: generateId(),
        role: "user",
        text: text || "（この質問はスキップ）",
      };
      setSeriesChatMessages((prev) => [...prev, userMessage]);

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
      setSelectedKeywords([]);
      setSeriesChatInput("");

      if (isMountedRef.current) {
        setIsAutoAdvancing(false);
      }
    },
    [
      activeQuestionIndex,
      buildCurrentAnswerText,
      currentStep,
      interactionLocked,
      isInterviewComplete,
      selectedKeywords.length,
      seriesChatInput,
      seriesNameCandidate,
    ]
  );

  const handleToggleInputMode = useCallback(() => {
    if (isSaving || isGenerating) return;
    setInputMode((prev) => (prev === "chat" ? "prompt" : "chat"));
    void Haptics.selectionAsync();
  }, [isGenerating, isSaving]);

  const handleGenerateSeries = useCallback(async () => {
    if (!canSubmit || isSaving) {
      Alert.alert(
        "入力が必要です",
        inputMode === "prompt"
          ? "作りたいクエスト内容をプロンプトで入力してください。"
          : "Q1〜Q4への回答を完了してください。"
      );
      return;
    }

    const promptForGeneration = generationPrompt.trim();
    if (!promptForGeneration) return;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const initialPhase: SeriesDraftGenerationPhase = "request_received";
    const initialMessage = toSeriesPhaseMessage(initialPhase);
    setIsSaving(true);
    setIsGenerating(true);
    setLatestGenerationPhase(initialPhase);
    setLiveGenerationMessage(initialMessage);
    setGenerationProgressMessages([initialMessage]);
    const generationAbortController = new AbortController();
    generationAbortRef.current = generationAbortController;

    try {
      const titleCandidate = (seriesNameCandidate.trim() || deriveSeriesTitle(promptForGeneration)).trim();
      const [existingIdentityPack, recentGenerationContext] = await Promise.all([
        loadExistingIdentityPack(titleCandidate),
        isSupabaseConfigured && userId
          ? fetchRecentSeriesGenerationContext(userId).catch((error) => {
              console.warn("CreateSeriesScreen: fetchRecentSeriesGenerationContext warning", error);
              return undefined;
            })
          : Promise.resolve(undefined),
      ]);

      const aiDraft = await generateSeriesDraftViaMastra(
        {
          interview: interviewInputForGeneration,
          prompt: promptForGeneration,
          desiredEpisodeCount: 8,
          creatorId: userId || undefined,
          creatorName: userName || undefined,
          existingIdentityPack,
          identityRetcon: false,
          recentGenerationContext,
        },
        {
          signal: generationAbortController.signal,
          onProgress: (event) => {
            if (!isMountedRef.current) return;
            const nextMessage = toSeriesPhaseMessage(event.phase, event.detail);
            setLatestGenerationPhase(event.phase);
            setLiveGenerationMessage(nextMessage);
            setGenerationProgressMessages((prev) => {
              if (prev[prev.length - 1] === nextMessage) return prev;
              return [...prev, nextMessage].slice(-6);
            });
          },
        }
      );

      const normalizedDraft: GeneratedSeriesDraft = {
        ...aiDraft,
        title: (aiDraft.title || titleCandidate || "新しいシリーズ").trim(),
        aiRules:
          aiDraft.aiRules?.trim() ||
          "キャラクターと伏線の整合性を保ち、各話の結果を次話へ引き継ぐこと。",
      };

      const pushProgressMessage = (nextMessage: string) => {
        if (!isMountedRef.current) return;
        setLiveGenerationMessage(nextMessage);
        setGenerationProgressMessages((prev) => {
          if (prev[prev.length - 1] === nextMessage) return prev;
          return [...prev, nextMessage].slice(-8);
        });
      };

      pushProgressMessage("仕上げ中です。生成結果を整えています。");
      const imageUris = collectSeriesDraftImageUris(normalizedDraft);
      if (imageUris.length > 0) {
        await prefetchSeriesDraftImages({
          uris: imageUris,
          timeoutMs: SERIES_RESULT_IMAGE_PREFETCH_TIMEOUT_MS,
          signal: generationAbortController.signal,
          onProgress: (done, total) => {
            pushProgressMessage(`仕上げ中です。画像を準備しています (${done}/${total})`);
          },
        });
      }

      if (generationAbortController.signal.aborted) return;
      pushProgressMessage("仕上げが完了しました。結果画面へ移動します。");
      await wait(120);
      if (!isMountedRef.current || generationAbortController.signal.aborted) return;

      navigation.replace("SeriesGenerationResult", {
        generated: normalizedDraft,
        sourcePrompt: promptForGeneration,
        imagesPreloaded: true,
      });
    } catch (error: any) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      const errorMessage = error?.message || "不明なエラー";
      const blockingError = parseSeriesGenerationBlockingError(String(errorMessage));
      if (blockingError?.kind === "existing_draft_conflict") {
        Alert.alert(
          "既存のシリーズ下書きがあります",
          `同じ内容で作成中のシリーズ下書き「${blockingError.title}」が既にあります。\n\n既存の下書きを続けるか、プロンプト内容を変えて再度作成してください。`
        );
        return;
      }
      if (blockingError?.kind === "too_many_drafts") {
        Alert.alert(
          "下書き数が上限に達しています",
          "シリーズの下書きが上限に達しているため、新規シリーズを作成できません。\n\n不要な下書きを整理してから再度お試しください。"
        );
        return;
      }
      const isLikelyConnectionIssue = /Mastra APIに接続できません|Network request failed|Failed to fetch/i.test(
        String(errorMessage)
      );
      if (isLikelyConnectionIssue) {
        console.warn("CreateSeriesScreen: Mastra connection issue", errorMessage);
      } else {
        console.error("CreateSeriesScreen: AI generation failed", error);
      }
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
    generationPrompt,
    inputMode,
    interviewInputForGeneration,
    isSaving,
    navigation,
    seriesNameCandidate,
    userId,
  ]);

  const handleCancelGeneration = useCallback(() => {
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    if (isMountedRef.current) {
      setIsSaving(false);
      setIsGenerating(false);
      setLatestGenerationPhase("request_received");
      setLiveGenerationMessage(SERIES_PHASE_USER_COPY.request_received);
      setGenerationProgressMessages([]);
    }
  }, []);

  const currentSelectionCount = selectedKeywords.length;
  const canAdvanceCurrentStep = useMemo(() => {
    if (!currentStep) return false;
    const hasText = seriesChatInput.trim().length > 0;
    if (currentStep.optional) {
      return true;
    }
    if (currentSelectionCount >= currentStep.minSelect) return true;
    return hasText;
  }, [currentSelectionCount, currentStep, seriesChatInput]);

  return (
    <View className="flex-1 bg-[#F8F7F6]">
      <SafeAreaView edges={["top"]} className="bg-[#F8F7F6]">
        <View className="px-4 pt-2 pb-3">
          <View className="flex-row items-center">
            <View className="w-[108px]">
              <Pressable
                onPress={() => navigation.goBack()}
                className="w-10 h-10 rounded-full items-center justify-center border border-[#ECE6DF] bg-white"
              >
                <Ionicons name="arrow-back" size={18} color="#6C5647" />
              </Pressable>
            </View>

            <View className="flex-1 items-center px-2">
              <Text className="text-[12px] text-[#8D745F]" style={{ fontFamily: fonts.bodyMedium, letterSpacing: 1.1 }}>
                シリーズ新規作成
              </Text>
              <Text className="text-[20px] text-[#2B1E16]" style={{ fontFamily: fonts.displayBold, letterSpacing: 0.8 }}>
                物語の種を集める
              </Text>
            </View>

            <View className="w-[108px] items-end">
              <Pressable
                onPress={handleToggleInputMode}
                disabled={isGenerating || isSaving}
                className={`h-10 min-w-[90px] rounded-full border bg-white px-3 flex-row items-center justify-center gap-1.5 ${
                  isGenerating || isSaving ? "border-[#EAE3DA]" : "border-[#E6DED5]"
                }`}
              >
                <Ionicons
                  name={inputMode === "chat" ? "create-outline" : "chatbubble-ellipses-outline"}
                  size={14}
                  color="#7A6351"
                />
                <Text className="text-[10px] text-[#7A6351]" style={{ fontFamily: fonts.bodyBold }}>
                  {inputMode === "chat" ? "直接入力" : "チャット"}
                </Text>
              </Pressable>
            </View>
          </View>

          {inputMode === "chat" ? (
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
          ) : (
            <View className="mt-3" />
          )}
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        {inputMode === "chat" ? (
          <>
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
                  <View className="w-full">
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
                          <Text className="text-base text-white" style={{ fontFamily: fonts.displayBold }}>
                            シリーズを生成中...
                          </Text>
                        </>
                      ) : (
                        <>
                          <Ionicons name="sparkles" size={18} color="#FFFFFF" />
                          <Text className="text-base text-white" style={{ fontFamily: fonts.displayBold, letterSpacing: 0.5 }}>
                            シリーズを生成
                          </Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                ) : (
                  <View className="w-full">
                    <View className="mb-2 px-1 flex-row items-center justify-between">
                      <View className="flex-1 pr-3">
                        <Text className="text-[12px] text-[#6F5C4A]" style={{ fontFamily: fonts.displayBold, letterSpacing: 0.7 }}>
                          {currentStep.label}
                        </Text>
                        <Text className="text-[11px] text-[#8E7B69] mt-0.5" style={{ fontFamily: fonts.bodyRegular }}>
                          {currentStep.helper}
                        </Text>
                        <Text className="text-[11px] text-[#8E7B69] mt-0.5" style={{ fontFamily: fonts.bodyRegular }}>
                          選択中: {currentSelectionCount} / {currentStep.maxSelect}
                        </Text>
                      </View>
                      <Text className="text-[11px] text-[#8E7B69]" style={{ fontFamily: fonts.bodyRegular }}>
                        {activeQuestionIndex + 1} / {SERIES_INTERVIEW_STEPS.length}
                      </Text>
                    </View>

                    <View className="mb-1 flex-row flex-wrap gap-2">
                      {(currentStep?.chips || []).map((keyword) => (
                        <StoryKeywordChip
                          key={keyword}
                          label={keyword}
                          active={selectedKeywords.includes(keyword)}
                          disabled={interactionLocked}
                          onPress={() => {
                            toggleKeyword(keyword);
                          }}
                        />
                      ))}
                    </View>

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
                          void submitSeriesAnswer();
                        }}
                        returnKeyType="done"
                      />

                      <Pressable
                        className={`w-9 h-9 rounded-full items-center justify-center ${
                          canAdvanceCurrentStep && !interactionLocked ? "bg-[#EE8C2B]" : "bg-[#D8CFC5]"
                        }`}
                        disabled={!canAdvanceCurrentStep || interactionLocked}
                        onPress={() => {
                          void submitSeriesAnswer();
                        }}
                      >
                        <Ionicons name="checkmark" size={17} color="#FFFFFF" />
                      </Pressable>
                    </View>

                    {currentStep.optional ? (
                      <Pressable
                        onPress={() => {
                          void submitSeriesAnswer(true);
                        }}
                        disabled={interactionLocked}
                        className={`mt-2 h-9 rounded-xl items-center justify-center ${interactionLocked ? "bg-[#D9D1C8]" : "bg-white border border-[#E7DDCF]"}`}
                      >
                        <Text className="text-[12px] text-[#6B5846]" style={{ fontFamily: fonts.bodyMedium }}>
                          この質問はスキップ
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>
            </SafeAreaView>
          </>
        ) : (
          <>
            <View className="flex-1 px-6 items-center justify-center">
              <View className="absolute w-[360px] h-[220px] items-center justify-center">
                <Ionicons name="flame" size={172} color="rgba(238, 140, 43, 0.24)" />
              </View>
              <View className="z-10 items-center">
                <Text className="text-[24px] text-[#6F5C4A]" style={{ fontFamily: fonts.displayBold, lineHeight: 32 }}>
                  フリープロンプト入力
                </Text>
                <Text className="mt-1 text-[13px] text-[#8E7B69]" style={{ fontFamily: fonts.bodyRegular }}>
                  作りたいシリーズ内容を自由に入力してください
                </Text>
              </View>
            </View>

            <SafeAreaView edges={["bottom"]} className="bg-[#F8F7F6]">
              <View className="px-4 pt-2 pb-3">
                <View className="rounded-3xl border border-[#E6DED5] bg-white px-2 py-1.5 flex-row items-center gap-2">
                  <TextInput
                    value={directPromptInput}
                    onChangeText={setDirectPromptInput}
                    placeholder="作りたいシリーズ内容を入力"
                    placeholderTextColor="#A38A73"
                    multiline={false}
                    numberOfLines={1}
                    allowFontScaling={false}
                    className="flex-1 h-[40px] py-2 px-2 text-[13px] text-[#2A1A0F]"
                    style={{ fontFamily: fonts.bodyRegular, textAlignVertical: "center" }}
                    editable={!interactionLocked}
                    onSubmitEditing={() => {
                      void handleGenerateSeries();
                    }}
                    returnKeyType="send"
                  />

                  <Pressable
                    className={`w-9 h-9 rounded-full items-center justify-center ${
                      canSubmit && !interactionLocked ? "bg-[#EE8C2B]" : "bg-[#D8CFC5]"
                    }`}
                    disabled={!canSubmit || interactionLocked}
                    onPress={() => {
                      void handleGenerateSeries();
                    }}
                    style={
                      canSubmit && !interactionLocked
                        ? {
                            shadowColor: "#EE8C2B",
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.28,
                            shadowRadius: 10,
                            elevation: 4,
                          }
                        : undefined
                    }
                  >
                    {isSaving ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Ionicons name="arrow-up" size={17} color="#FFFFFF" />
                    )}
                  </Pressable>
                </View>
              </View>
            </SafeAreaView>
          </>
        )}
      </KeyboardAvoidingView>

      {isGenerating ? (
        <StoryForgeLoadingOverlay
          message={liveGenerationMessage}
          stages={workflowStageRows}
          progressMessages={generationProgressMessages}
          onCancel={handleCancelGeneration}
        />
      ) : null}
    </View>
  );
};
