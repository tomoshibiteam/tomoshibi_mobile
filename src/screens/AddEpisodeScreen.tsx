import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { AddEpisodeMapView } from "./AddEpisodeMapView";
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
  fetchSeriesEpisodeRuntimeContext,
  fetchMySeriesOptions,
  fetchSeriesEpisodes,
  type SeriesOption,
} from "@/services/quests";
import type { RootStackParamList } from "@/navigation/types";
import {
  generateSeriesEpisodeViaMastra,
  isMastraSeriesConfigured,
  type GeneratedRuntimeEpisode,
  type RuntimeEpisodeGenerationEvent,
} from "@/services/seriesAi";
import { geocodeAddress } from "@/lib/geocode";

type Props = NativeStackScreenProps<RootStackParamList, "AddEpisode">;

type Purpose = "観光" | "食べ歩き" | "デート" | "散歩" | "写真旅";

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

const DEFAULT_MAP_REGION = {
  latitude: 35.4437,
  longitude: 139.638,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

const PURPOSE_OPTIONS: Purpose[] = ["観光", "食べ歩き", "デート", "散歩", "写真旅"];

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

const safeParseProgressState = (value?: Record<string, unknown> | null) => {
  if (!value || typeof value !== "object") return undefined;
  const unresolved = Array.isArray(value.unresolved_threads)
    ? value.unresolved_threads.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  const revealed = Array.isArray(value.revealed_facts)
    ? value.revealed_facts.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  const last = Number.parseInt(String(value.last_completed_episode_no ?? 0), 10);
  const trust = Number.parseFloat(String(value.companion_trust_level ?? 40));

  return {
    lastCompletedEpisodeNo: Number.isFinite(last) ? Math.max(0, last) : 0,
    unresolvedThreads: unresolved,
    revealedFacts: revealed,
    companionTrustLevel: Number.isFinite(trust) ? Math.max(0, Math.min(100, trust)) : 40,
    nextHook: String(value.next_hook ?? "").trim(),
  };
};

const safeParseFirstEpisodeSeed = (value?: Record<string, unknown> | null) => {
  if (!value || typeof value !== "object") return undefined;
  const duration = Number.parseInt(String(value.expected_duration_minutes ?? 20), 10);
  return {
    title: String(value.title ?? "").trim(),
    objective: String(value.objective ?? "").trim(),
    openingScene: String(value.opening_scene ?? "").trim(),
    expectedDurationMinutes: Number.isFinite(duration) ? Math.max(10, Math.min(45, duration)) : 20,
    routeStyle: String(value.route_style ?? "").trim(),
    completionCondition: String(value.completion_condition ?? "").trim(),
    carryOverHint: String(value.carry_over_hint ?? "").trim(),
    suggestedSpots: Array.isArray(value.suggested_spots)
      ? value.suggested_spots.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [],
  };
};

const safeParseContinuity = (value?: Record<string, unknown> | null) => {
  if (!value || typeof value !== "object") return undefined;
  return {
    globalMystery: String(value.global_mystery ?? "").trim() || undefined,
    midSeasonTwist: String(value.mid_season_twist ?? "").trim() || undefined,
    finalePayoff: String(value.finale_payoff ?? "").trim() || undefined,
    invariantRules: Array.isArray(value.invariant_rules)
      ? value.invariant_rules.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [],
    episodeLinkPolicy: Array.isArray(value.episode_link_policy)
      ? value.episode_link_policy.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [],
  };
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

const parseLocationCoords = (value: string): { lat: number; lng: number } | null => {
  const trimmed = value.trim();
  const match = /^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/.exec(trimmed);
  if (!match) return null;
  const lat = Number.parseFloat(match[1]);
  const lng = Number.parseFloat(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
};

type EpisodeGenerationUiState = {
  progressPercent: number;
  phaseTitle: string;
  currentTask: string;
  detailText: string;
};

const INITIAL_EPISODE_GENERATION_UI_STATE: EpisodeGenerationUiState = {
  progressPercent: 4,
  phaseTitle: "生成準備",
  currentTask: "エピソード生成の準備をしています",
  detailText: "Mastraへ接続しています",
};

const clampPercent = (value: number) => Math.max(1, Math.min(100, Math.round(value)));

const resolveSpotProgress = (
  event: RuntimeEpisodeGenerationEvent,
  startBase: number,
  range: number,
  done: boolean
) => {
  const spotCount = Math.max(1, event.spotCount || 1);
  const spotIndex = Math.max(1, Math.min(spotCount, event.spotIndex || 1));
  const ratio = done ? spotIndex / spotCount : (spotIndex - 1) / spotCount;
  return clampPercent(startBase + ratio * range);
};

const resolveEpisodeGenerationUiState = (event: RuntimeEpisodeGenerationEvent): EpisodeGenerationUiState => {
  const spotLabel =
    event.spotIndex && event.spotCount
      ? `${event.spotIndex}/${event.spotCount}${event.spotName ? ` ${event.spotName}` : ""}`
      : event.spotName || "";

  switch (event.phase) {
    case "request_received":
      return {
        progressPercent: 8,
        phaseTitle: "受付",
        currentTask: "生成リクエストを受け付けています",
        detailText: event.detail || "入力を確認しています",
      };
    case "input_validated":
      return {
        progressPercent: 13,
        phaseTitle: "入力検証",
        currentTask: "入力内容の整合性を確認しています",
        detailText: event.detail || "リクエストスキーマを検証中",
      };
    case "characters_validated":
      return {
        progressPercent: 18,
        phaseTitle: "事前確認",
        currentTask: "シリーズの登場人物を確認しています",
        detailText: event.detail || "キャラクター情報を読み込み中",
      };
    case "pipeline_start":
      return {
        progressPercent: 24,
        phaseTitle: "パイプライン開始",
        currentTask: "Mastraの生成パイプラインを起動しています",
        detailText: event.detail || "生成エンジンを準備中",
      };
    case "fallback_plan_start":
      return {
        progressPercent: 42,
        phaseTitle: "フォールバック構成",
        currentTask: "フォールバック用の構成を作成しています",
        detailText: event.detail || "基本構成を準備中",
      };
    case "fallback_plan_done":
      return {
        progressPercent: 58,
        phaseTitle: "フォールバック構成",
        currentTask: "フォールバック構成がまとまりました",
        detailText: event.detail || "最終組み立てへ進みます",
      };
    case "episode_plan_start":
      return {
        progressPercent: 32,
        phaseTitle: "プロット設計",
        currentTask: "今回のエピソード設計を作成しています",
        detailText: event.detail || "導線と目的を定義中",
      };
    case "episode_plan_done":
      return {
        progressPercent: 42,
        phaseTitle: "プロット設計",
        currentTask: "エピソード設計が確定しました",
        detailText: event.detail || "スポット生成へ進みます",
      };
    case "spot_chapter_start":
      return {
        progressPercent: resolveSpotProgress(event, 45, 25, false),
        phaseTitle: "情景生成",
        currentTask: `スポット${spotLabel ? ` ${spotLabel}` : ""}の情景を生成しています`,
        detailText: event.detail || "チャプター本文を作成中",
      };
    case "spot_chapter_done":
      return {
        progressPercent: resolveSpotProgress(event, 45, 25, true),
        phaseTitle: "情景生成",
        currentTask: `スポット${spotLabel ? ` ${spotLabel}` : ""}の情景生成が完了しました`,
        detailText: event.detail || "次の処理へ進みます",
      };
    case "spot_puzzle_start":
      return {
        progressPercent: resolveSpotProgress(event, 70, 18, false),
        phaseTitle: "謎生成",
        currentTask: `スポット${spotLabel ? ` ${spotLabel}` : ""}の謎解きを生成しています`,
        detailText: event.detail || "問題とヒントを作成中",
      };
    case "spot_puzzle_done":
      return {
        progressPercent: resolveSpotProgress(event, 70, 18, true),
        phaseTitle: "謎生成",
        currentTask: `スポット${spotLabel ? ` ${spotLabel}` : ""}の謎解き生成が完了しました`,
        detailText: event.detail || "全体整形へ進みます",
      };
    case "episode_assemble_start":
      return {
        progressPercent: 90,
        phaseTitle: "エピソード統合",
        currentTask: "生成した素材を1話分に統合しています",
        detailText: event.detail || "最終整形中",
      };
    case "episode_assemble_done":
      return {
        progressPercent: 96,
        phaseTitle: "エピソード統合",
        currentTask: "最終エピソードの組み立てが完了しました",
        detailText: event.detail || "レスポンス準備へ進みます",
      };
    case "response_preparing":
      return {
        progressPercent: 98,
        phaseTitle: "レスポンス整形",
        currentTask: "表示用データを整えています",
        detailText: event.detail || "あと少しで完了です",
      };
    case "completed":
      return {
        progressPercent: 100,
        phaseTitle: "完了",
        currentTask: "エピソード生成が完了しました",
        detailText: event.detail || "結果画面へ遷移します",
      };
    default:
      return INITIAL_EPISODE_GENERATION_UI_STATE;
  }
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

  const [step, setStep] = useState<1 | 2>(1);
  const [stageLocation, setStageLocation] = useState("横浜赤レンガ倉庫");
  const [purpose, setPurpose] = useState<Purpose>("観光");
  const [userWishes, setUserWishes] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationUiState, setGenerationUiState] = useState<EpisodeGenerationUiState>(
    INITIAL_EPISODE_GENERATION_UI_STATE
  );

  const isMountedRef = useRef(true);
  const generationAbortRef = useRef<AbortController | null>(null);

  const [selectedSeriesEpisodeLogs, setSelectedSeriesEpisodeLogs] = useState<Array<{ text: string; active: boolean }>>(
    []
  );
  const [suggestedSpots, setSuggestedSpots] = useState<string[]>([]);
  const [geocodedCoords, setGeocodedCoords] = useState<{ lat: number; lng: number } | null>(null);

  const selectedSeries = useMemo(
    () => seriesOptions.find((item) => item.key === selectedSeriesKey) || seriesOptions[0] || null,
    [seriesOptions, selectedSeriesKey]
  );

  const parsedCoords = useMemo(() => parseLocationCoords(stageLocation), [stageLocation]);
  const mapCoords = parsedCoords ?? geocodedCoords;
  const mapRegion = useMemo(
    () =>
      mapCoords
        ? {
            latitude: mapCoords.lat,
            longitude: mapCoords.lng,
            latitudeDelta: 0.0085,
            longitudeDelta: 0.0085,
          }
        : DEFAULT_MAP_REGION,
    [mapCoords]
  );

  useEffect(() => {
    const trimmed = stageLocation.trim();
    if (!trimmed || trimmed.length < 2) {
      setGeocodedCoords(null);
      return;
    }
    if (parseLocationCoords(trimmed)) {
      setGeocodedCoords(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        if (Platform.OS === "web") {
          const apiKey =
            process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY ??
            process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ??
            "";
          if (!apiKey) return;
          const coords = await geocodeAddress(trimmed, apiKey);
          if (cancelled) return;
          setGeocodedCoords(coords);
        } else {
          const results = await Location.geocodeAsync(trimmed);
          if (cancelled) return;
          const first = results[0];
          if (first?.latitude != null && first?.longitude != null) {
            setGeocodedCoords({ lat: first.latitude, lng: first.longitude });
          } else {
            setGeocodedCoords(null);
          }
        }
      } catch {
        if (!cancelled) setGeocodedCoords(null);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stageLocation]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
        if (selected.id && userId) {
          const [rows, runtimeCtx] = await Promise.all([
            fetchSeriesEpisodes(selected.id),
            fetchSeriesEpisodeRuntimeContext(selected.id, userId).catch(() => null),
          ]);

          if (runtimeCtx) {
            const seed = runtimeCtx.firstEpisodeSeed as Record<string, unknown> | null;
            const spots = Array.isArray(seed?.suggested_spots)
              ? seed.suggested_spots.map((s) => String(s ?? "").trim()).filter(Boolean)
              : [];
            setSuggestedSpots(spots.slice(0, 4));
          } else {
            setSuggestedSpots([]);
          }

          if (rows.length === 0) {
            setSelectedSeriesEpisodeLogs([
              { text: "まだ公開済みエピソードはありません", active: false },
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

        setSuggestedSpots([]);
        setSelectedSeriesEpisodeLogs(
          FALLBACK_EPISODE_LOGS[selected.title] || [
            { text: "まだ公開済みエピソードはありません", active: false },
          ]
        );
      } catch (error) {
        console.warn("AddEpisodeScreen: failed to load episode logs", error);
        setSelectedSeriesEpisodeLogs([
          { text: "エピソード状況を読み込めませんでした", active: false },
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

  const handleGoToStep2 = () => {
    if (!selectedSeries) {
      Alert.alert("シリーズを選択してください", "追加先のシリーズを選択してください。");
      return;
    }
    if (!stageLocation.trim()) {
      Alert.alert("舞台を入力してください", "どこに旅をするか、場所を指定してください。");
      return;
    }
    setStep(2);
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

  const updateGenerationUiState = useCallback((next: EpisodeGenerationUiState) => {
    setGenerationUiState((prev) => ({
      progressPercent: Math.max(prev.progressPercent, next.progressPercent),
      phaseTitle: next.phaseTitle,
      currentTask: next.currentTask,
      detailText: next.detailText,
    }));
  }, []);

  const handleCancelGeneration = useCallback(() => {
    if (!isGenerating) return;
    Alert.alert("生成を中止しますか？", "ここまでの生成内容は保存されません。", [
      { text: "続ける", style: "cancel" },
      {
        text: "中止する",
        style: "destructive",
        onPress: () => {
          generationAbortRef.current?.abort();
          generationAbortRef.current = null;
          setIsGenerating(false);
          setGenerationUiState(INITIAL_EPISODE_GENERATION_UI_STATE);
        },
      },
    ]);
  }, [isGenerating]);

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

    setGenerationUiState(INITIAL_EPISODE_GENERATION_UI_STATE);
    setIsGenerating(true);
    const generationAbortController = new AbortController();
    generationAbortRef.current = generationAbortController;

    try {
      updateGenerationUiState({
        progressPercent: 7,
        phaseTitle: "シリーズ準備",
        currentTask: "追加先シリーズの状態を確認しています",
        detailText: "保存先を確定しています",
      });

      let targetSeriesId = selectedSeries.id;
      const targetSeriesTitle = selectedSeries.title;

      if (!targetSeriesId) {
        updateGenerationUiState({
          progressPercent: 12,
          phaseTitle: "シリーズ準備",
          currentTask: "シリーズ下書きを作成しています",
          detailText: "保存先IDを発行中",
        });
        const draft = await createQuestDraft({
          creatorId: userId,
          title: targetSeriesTitle,
          description: selectedSeriesOverview,
          areaName: selectedSeries.areaName || stageLocation.trim(),
          coverImageUrl: selectedSeries.coverImageUrl,
        });
        targetSeriesId = draft.questId;
      }

      let episodeTitle = buildGeneratedEpisodeTitle(purpose, stageLocation);
      let episodeBody = buildGeneratedEpisodeBody(targetSeriesTitle, purpose, stageLocation);
      let runtimeEpisode: GeneratedRuntimeEpisode | null = null;

      if (isMastraSeriesConfigured) {
        try {
          updateGenerationUiState({
            progressPercent: 16,
            phaseTitle: "コンテキスト収集",
            currentTask: "シリーズの進行情報を取得しています",
            detailText: "Mastra実行に必要な文脈を読み込み中",
          });
          const runtimeContext = targetSeriesId
            ? await fetchSeriesEpisodeRuntimeContext(targetSeriesId, userId)
            : null;

          const characters = runtimeContext?.characters || [];
          if (characters.length === 0) {
            throw new Error(
              "シリーズのキャラクター情報が取得できません。シリーズ保存時にエラーが発生した可能性があります。シリーズ詳細画面から再度保存を試すか、シリーズを最初から作り直してください。"
            );
          }

          updateGenerationUiState({
            progressPercent: 20,
            phaseTitle: "Mastra実行",
            currentTask: "Mastraのエピソード生成ジョブを開始しています",
            detailText: "旅の軌跡を描き始めます",
          });
          runtimeEpisode = await generateSeriesEpisodeViaMastra({
            series: {
              title: runtimeContext?.title || targetSeriesTitle,
              overview: runtimeContext?.overview || selectedSeriesOverview,
              premise: runtimeContext?.premise,
              seasonGoal: runtimeContext?.seasonGoal,
              aiRules: runtimeContext?.aiRules,
              worldSetting: runtimeContext?.worldSetting || stageLocation.trim(),
              continuity: safeParseContinuity(runtimeContext?.continuity),
              progressState: safeParseProgressState(runtimeContext?.progressState),
              firstEpisodeSeed: safeParseFirstEpisodeSeed(runtimeContext?.firstEpisodeSeed),
              checkpoints: (runtimeContext?.checkpoints || []).map((checkpoint) => ({
                checkpointNo: checkpoint.checkpointNo,
                title: checkpoint.title,
                purpose: checkpoint.purpose || "",
                unlockHint: checkpoint.unlockHint || "",
                expectedEmotion: "発見",
                carryOver: checkpoint.carryOver || "",
              })),
              characters: (runtimeContext?.characters || []).map((character, index) => ({
                id: `char_${index + 1}`,
                name: character.name,
                role: character.role,
                personality: character.personality || undefined,
                arcStart: character.arcStart || undefined,
                arcEnd: character.arcEnd || undefined,
              })),
              recentEpisodes: runtimeContext?.recentEpisodes || [],
            },
            stageLocation: stageLocation.trim(),
            purpose,
            userWishes: userWishes.trim() || undefined,
            desiredDurationMinutes: 20,
            language: "ja",
          }, {
            signal: generationAbortController.signal,
            onProgress: (event) => {
              updateGenerationUiState(resolveEpisodeGenerationUiState(event));
            },
          });

          if (runtimeEpisode.title.trim()) episodeTitle = runtimeEpisode.title.trim();
          if (runtimeEpisode.spots?.length) {
            const charMap = new Map(
              (runtimeEpisode.characters || []).map((c) => [c.id, c.name])
            );
            episodeBody = runtimeEpisode.spots
              .map((spot) => {
                const roleLabel = spot.sceneRole ? `【${spot.sceneRole}】` : "";
                const header = `${roleLabel}${spot.spotName}`;
                const narration = spot.sceneNarration || "";
                const blocks = spot.blocks
                  .map((b) => {
                    if (b.type === "dialogue") {
                      const name = (b.speakerId && charMap.get(b.speakerId)) || b.speakerId || "？";
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
          }

          const rawState = runtimeContext?.progressState as Record<string, unknown> | undefined;
          const lastEpNo =
            rawState && typeof rawState === "object"
              ? Number(rawState.last_completed_episode_no ?? rawState.lastCompletedEpisodeNo ?? 0) || 0
              : 0;
          const nextEpisodeNo = lastEpNo + 1;

          updateGenerationUiState({
            progressPercent: 100,
            phaseTitle: "完了",
            currentTask: "エピソード生成が完了しました",
            detailText: "結果画面へ遷移します",
          });

          if (__DEV__) {
            console.log("[AddEpisodeScreen] Mastra success, scheduling navigation to EpisodeGenerationResult");
          }
          InteractionManager.runAfterInteractions(() => {
            if (!isMountedRef.current) return;
            try {
              navigation.replace("EpisodeGenerationResult", {
                runtimeEpisode: runtimeEpisode!,
                seriesId: targetSeriesId,
                seriesTitle: targetSeriesTitle,
                coverImageUrl: selectedSeries?.coverImageUrl,
                episodeNo: nextEpisodeNo,
              });
            } catch (navErr) {
              console.error("AddEpisodeScreen: navigation to EpisodeGenerationResult failed", navErr);
            }
          });
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }
          const msg = error instanceof Error ? error.message : String(error);
          if (/characters_required|キャラクター情報が必須|キャラクター情報が取得できません/.test(msg)) {
            Alert.alert(
              "キャラクター情報がありません",
              "シリーズのキャラクターが保存されていません。シリーズ詳細画面でシリーズを再保存するか、シリーズを最初から作り直してください。"
            );
          } else {
            Alert.alert("エピソード生成に失敗しました", msg);
          }
          return;
        }
      }

      updateGenerationUiState({
        progressPercent: 85,
        phaseTitle: "保存処理",
        currentTask: "エピソードを保存しています",
        detailText: "Supabaseへ書き込み中",
      });
      const result = await createEpisodeForSeries({
        userId,
        seriesId: targetSeriesId,
        seriesTitle: targetSeriesTitle,
        episodeTitle,
        episodeText: episodeBody,
      });

      updateGenerationUiState({
        progressPercent: 100,
        phaseTitle: "完了",
        currentTask: "エピソード生成と保存が完了しました",
        detailText: "シリーズ詳細へ移動できます",
      });
      Alert.alert(
        "エピソードを生成しました",
        `「${result.questTitle}」に新しいエピソードを追加しました。`,
        [
          {
            text: "確認する",
            onPress: () => navigation.replace("SeriesDetail", { questId: result.questId }),
          },
        ]
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      const codedError = error as { code?: string };
      if (codedError?.code === "SERIES_NOT_FOUND") {
        Alert.alert("シリーズが見つかりません", "シリーズを再選択して再度お試しください。");
      } else {
        console.error("AddEpisodeScreen: failed to generate episode", error);
        Alert.alert("生成に失敗しました", "時間をおいて再度お試しください。");
      }
    } finally {
      generationAbortRef.current = null;
      if (isMountedRef.current) {
        setIsGenerating(false);
        setGenerationUiState(INITIAL_EPISODE_GENERATION_UI_STATE);
      }
    }
  };

  return (
    <View className="flex-1 bg-[#F8F7F6]">
      <SafeAreaView edges={["top"]} className="bg-[#F8F7F6]">
        <View className="h-14 px-4 border-b border-[#ECE6DF] flex-row items-center justify-between">
          <Pressable
            onPress={() => (step === 2 ? setStep(1) : navigation.goBack())}
            className="w-9 h-9 rounded-full items-center justify-center"
          >
            <Ionicons name="arrow-back" size={20} color="#6C5647" />
          </Pressable>
          <Text className="text-base text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
            {step === 1 ? "どこに旅をする？" : "旅の目的・思い"}
          </Text>
          <View className="w-9 h-9" />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: step === 1 ? 100 : 130 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 1 ? (
            <>
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
                <View className="flex-row items-center gap-2 mb-3">
                  <Ionicons name="map-outline" size={16} color="#EE8C2B" />
                  <Text className="text-sm text-[#5E554C]" style={{ fontFamily: fonts.displayBold }}>
                    今回の舞台（どこに旅をする？）
                  </Text>
                </View>

                <View className="flex-row gap-2 mb-3">
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

                <View className="rounded-xl border border-[#ECE6DF] overflow-hidden bg-white" style={{ height: 180 }}>
                  <AddEpisodeMapView
                    stageLocation={stageLocation}
                    mapCoords={mapCoords}
                    mapRegion={mapRegion}
                  />
                </View>

                {suggestedSpots.length > 0 && (
                  <View className="mt-3">
                    <Text className="text-xs text-[#8A7B6C] mb-2" style={{ fontFamily: fonts.bodyRegular }}>
                      シリーズの推奨スポット
                    </Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        {suggestedSpots.map((spot) => (
                          <Pressable
                            key={spot}
                            onPress={() => setStageLocation(spot)}
                            style={{
                              paddingLeft: 12,
                              paddingRight: 12,
                              paddingTop: 6,
                              paddingBottom: 6,
                              borderRadius: 20,
                              borderWidth: 1,
                              borderColor: stageLocation === spot ? "#EE8C2B" : "#E3D6C9",
                              backgroundColor: stageLocation === spot ? "#FFF6EC" : "#FFFFFF",
                            }}
                          >
                            <Text
                              className="text-xs"
                              style={{
                                fontFamily: fonts.bodyMedium,
                                color: stageLocation === spot ? "#EE8C2B" : "#6C5647",
                              }}
                            >
                              📍 {spot}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}
              </View>
            </>
          ) : (
            <>
              <View className="px-5 pt-6 pb-4">
                <View className="rounded-xl border border-[#ECE6DF] bg-white p-4">
                  <Text className="text-xs text-[#8A7B6C] mb-1" style={{ fontFamily: fonts.bodyRegular }}>
                    行き先
                  </Text>
                  <Text className="text-base text-[#221910] mb-3" style={{ fontFamily: fonts.displayBold }}>
                    {stageLocation.trim() || "—"}
                  </Text>
                  <Text className="text-xs text-[#8A7B6C] mb-1" style={{ fontFamily: fonts.bodyRegular }}>
                    シリーズ
                  </Text>
                  <Text className="text-base text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
                    {selectedSeries?.title || "—"}
                  </Text>
                </View>
              </View>

              <View className="px-5 py-4 border-t border-[#EFE9E3]">
                <View className="flex-row items-center gap-2 mb-3">
                  <Ionicons name="compass-outline" size={16} color="#EE8C2B" />
                  <Text className="text-sm text-[#5E554C]" style={{ fontFamily: fonts.displayBold }}>
                    旅の目的
                  </Text>
                </View>

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

              <View className="px-5 py-4 border-t border-[#EFE9E3]">
                <View className="flex-row items-center gap-2 mb-1">
                  <Ionicons name="heart-outline" size={16} color="#EE8C2B" />
                  <Text className="text-sm text-[#5E554C]" style={{ fontFamily: fonts.displayBold }}>
                    このエピソードへの思い
                  </Text>
                </View>
                <Text className="text-xs text-[#8A7B6C] mb-3" style={{ fontFamily: fonts.bodyRegular }}>
                  反映したいこと・展開の希望を自由に書いてください
                </Text>

                <View className="rounded-xl border border-[#ECE6DF] bg-white p-3">
                  <TextInput
                    value={userWishes}
                    onChangeText={setUserWishes}
                    placeholder="例: 今回は相棒との信頼を深めたい / クライマックスへの伏線を張ってほしい / 穏やかな日常回にしたい"
                    placeholderTextColor="#B5A99B"
                    multiline
                    numberOfLines={4}
                    className="text-sm text-[#221910] min-h-[80px]"
                    style={{ fontFamily: fonts.bodyRegular, textAlignVertical: "top" }}
                  />
                </View>
              </View>
            </>
          )}
        </ScrollView>

        <SafeAreaView edges={["bottom"]} className="bg-[#F8F7F6] border-t border-[#ECE6DF]">
          <View className="px-5 pt-3 pb-2">
            {step === 1 ? (
              <Pressable
                onPress={handleGoToStep2}
                className="h-14 rounded-2xl bg-[#EE8C2B] items-center justify-center flex-row gap-2"
                style={{
                  shadowColor: "#EE8C2B",
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.3,
                  shadowRadius: 12,
                  elevation: 4,
                }}
              >
                <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                  次へ
                </Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              </Pressable>
            ) : (
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
            )}
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

      <EpisodeGenerationLoadingOverlay
        visible={isGenerating}
        state={generationUiState}
        onClose={handleCancelGeneration}
      />
    </View>
  );
};

type EpisodeGenerationLoadingOverlayProps = {
  visible: boolean;
  state: EpisodeGenerationUiState;
  onClose: () => void;
};

const EpisodeGenerationLoadingOverlay = ({ visible, state, onClose }: EpisodeGenerationLoadingOverlayProps) => {
  const clampedProgress = Math.max(1, Math.min(100, state.progressPercent));

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View className="flex-1 bg-[#F8F7F6]">
        <View className="absolute top-16 left-6 h-28 w-28 rounded-full bg-[#EE8C2B]/10" />
        <View className="absolute bottom-40 right-5 h-36 w-36 rounded-full bg-[#EE8C2B]/10" />
        <View className="absolute inset-0">
          <View className="h-full w-full">
            <View className="absolute inset-x-0 top-[18%] h-[1px] bg-[#EE8C2B]/10" />
            <View className="absolute inset-x-0 top-[30%] h-[1px] bg-[#EE8C2B]/10" />
            <View className="absolute inset-x-0 top-[42%] h-[1px] bg-[#EE8C2B]/10" />
            <View className="absolute inset-x-0 top-[54%] h-[1px] bg-[#EE8C2B]/10" />
            <View className="absolute inset-x-0 top-[66%] h-[1px] bg-[#EE8C2B]/10" />
          </View>
        </View>

        <SafeAreaView edges={["top"]} className="px-5 pt-2">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-10 w-10 items-center justify-center rounded-full border border-[#EE8C2B]/25 bg-[#EE8C2B]/12">
                <Ionicons name="compass-outline" size={20} color="#EE8C2B" />
              </View>
              <Text className="text-[11px] uppercase tracking-[1.5px] text-[#8A7B6C]" style={{ fontFamily: fonts.displayBold }}>
                Mapping the Adventure
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              className="h-10 w-10 items-center justify-center rounded-full bg-[#FFFFFFAA] border border-[#E8DED3]"
            >
              <Ionicons name="close" size={20} color="#6C5647" />
            </Pressable>
          </View>
        </SafeAreaView>

        <View className="flex-1 px-6">
          <View className="flex-1 items-center justify-center">
            <View className="w-full max-w-[520px] rounded-2xl border border-[#EE8C2B]/20 bg-white/75 p-4 shadow-xl">
              <View className="h-44 rounded-xl border border-[#E9D7C5] bg-[#EFE5DA]/60 p-3">
                <View className="flex-row items-center justify-between">
                  <View className="rounded-full border border-[#EE8C2B]/25 bg-white/85 px-3 py-1 flex-row items-center gap-2">
                    <View className="h-2 w-2 rounded-full bg-[#EE8C2B]" />
                    <Text className="text-[10px] text-[#7A6C5E]" style={{ fontFamily: fonts.displayBold }}>
                      GEO SYNC ACTIVE
                    </Text>
                  </View>
                  <View className="rounded-full border border-[#EE8C2B]/25 bg-white/85 px-3 py-1 flex-row items-center gap-1.5">
                    <Ionicons name="analytics-outline" size={11} color="#EE8C2B" />
                    <Text className="text-[10px] text-[#7A6C5E]" style={{ fontFamily: fonts.displayBold }}>
                      DATA NODES
                    </Text>
                  </View>
                </View>
                <View className="mt-5 flex-1 rounded-lg border border-[#EDDFD0] bg-white/60 p-4 justify-center">
                  <View className="h-[1px] bg-[#EE8C2B]/30" />
                  <View className="mt-4 h-[1px] bg-[#EE8C2B]/30" />
                  <View className="mt-4 h-[1px] bg-[#EE8C2B]/30" />
                  <View className="mt-4 h-[1px] bg-[#EE8C2B]/30" />
                </View>
              </View>
            </View>

            <View className="mt-10 items-center px-2">
              <Text className="text-center text-[30px] leading-[38px] text-[#221910]" style={{ fontFamily: fonts.displayRegular }}>
                旅の軌跡を、<Text style={{ fontFamily: fonts.displayBold, color: "#EE8C2B" }}>描き出しています...</Text>
              </Text>
              <View className="mt-4 flex-row items-center gap-2">
                <ActivityIndicator size="small" color="#EE8C2B" />
                <Text className="text-base text-[#6C5647]" style={{ fontFamily: fonts.bodyMedium }}>
                  {state.phaseTitle}
                </Text>
              </View>
              <Text className="mt-2 text-center text-sm text-[#8A7B6C]" style={{ fontFamily: fonts.bodyRegular }}>
                {state.detailText}
              </Text>
            </View>
          </View>
        </View>

        <SafeAreaView edges={["bottom"]} className="px-6 pb-4">
          <View className="rounded-2xl border border-[#E8DED3] bg-white/85 p-4">
            <View className="flex-row items-end justify-between">
              <View className="pr-4 flex-1">
                <Text className="text-[10px] uppercase tracking-[2px] text-[#EE8C2B]" style={{ fontFamily: fonts.displayBold }}>
                  Current Task
                </Text>
                <Text className="mt-1 text-sm text-[#221910]" numberOfLines={2} style={{ fontFamily: fonts.bodyMedium }}>
                  {state.currentTask}
                </Text>
              </View>
              <View className="flex-row items-end">
                <Text className="text-3xl text-[#221910]" style={{ fontFamily: fonts.displayRegular }}>
                  {clampedProgress}
                </Text>
                <Text className="mb-1 text-base text-[#EE8C2B]" style={{ fontFamily: fonts.bodyMedium }}>
                  %
                </Text>
              </View>
            </View>

            <View className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#E9DED2]">
              <View
                className="h-full rounded-full bg-[#EE8C2B]"
                style={{ width: `${clampedProgress}%` }}
              />
            </View>
            <View className="mt-2 flex-row justify-between">
              <Text className="text-[10px] uppercase tracking-[1.2px] text-[#A99D91]" style={{ fontFamily: fonts.bodyMedium }}>
                Request Intake
              </Text>
              <Text className="text-[10px] uppercase tracking-[1.2px] text-[#A99D91]" style={{ fontFamily: fonts.bodyMedium }}>
                Finalizing Narrative
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};
