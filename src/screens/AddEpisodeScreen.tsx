import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Alert,
  Easing,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { AddEpisodeMapView } from "./AddEpisodeMapView";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { fonts } from "@/theme/fonts";
import { useSessionUserId } from "@/hooks/useSessionUser";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  createEpisodeForSeries,
  createQuestDraft,
  fetchSeriesDetail,
  type SeriesDetail,
  type SeriesEpisode,
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
  type RuntimeEpisodeGenerationPhase,
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

type SeriesSummaryMeta = {
  currentEpisodeNo: number;
  nextEpisodeNo: number;
  episodeCount: number;
  latestEpisodeTitle: string | null;
  characterNames: string[];
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

const EMPTY_SERIES_META: SeriesSummaryMeta = {
  currentEpisodeNo: 0,
  nextEpisodeNo: 1,
  episodeCount: 0,
  latestEpisodeTitle: null,
  characterNames: [],
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
  return `${compact || "舞台"}の${purpose}`;
};

const buildGeneratedEpisodeBody = (
  seriesTitle: string,
  purpose: Purpose,
  stageLocation: string,
  stageCoords?: { lat: number; lng: number } | null
) => {
  const coordsLine =
    stageCoords && Number.isFinite(stageCoords.lat) && Number.isFinite(stageCoords.lng)
      ? `座標: ${stageCoords.lat.toFixed(6)},${stageCoords.lng.toFixed(6)}`
      : null;
  return [
    `${seriesTitle}の新章。`,
    "",
    `舞台: ${stageLocation}`,
    coordsLine,
    `目的: ${purpose}`,
    "",
    "土地に眠る手がかりを辿りながら、次の真実へと物語を進める。",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
};

const safeParseProgressState = (value?: Record<string, unknown> | null) => {
  if (!value || typeof value !== "object") return undefined;
  const unresolved = Array.isArray(value.unresolved_threads)
    ? value.unresolved_threads.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  const revealed = Array.isArray(value.revealed_facts)
    ? value.revealed_facts.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  const relationshipFlags = Array.isArray(value.relationship_flags)
    ? value.relationship_flags.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  const recentRelationShift = Array.isArray(value.recent_relation_shift)
    ? value.recent_relation_shift.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  const last = Number.parseInt(String(value.last_completed_episode_no ?? 0), 10);
  const trust = Number.parseFloat(String(value.companion_trust_level ?? 40));

  return {
    lastCompletedEpisodeNo: Number.isFinite(last) ? Math.max(0, last) : 0,
    unresolvedThreads: unresolved,
    revealedFacts: revealed,
    relationshipStateSummary: String(value.relationship_state_summary ?? "").trim() || "関係性は継続中。",
    relationshipFlags,
    recentRelationShift,
    companionTrustLevel: Number.isFinite(trust) ? Math.max(0, Math.min(100, trust)) : undefined,
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
    spotRequirements: Array.isArray(value.spot_requirements)
      ? value.spot_requirements
          .map((item, index): {
            requirementId: string;
            sceneRole: "起" | "承" | "転" | "結";
            spotRole: string;
            requiredAttributes: string[];
            visitConstraints: string[];
            tourismValueType: string;
          } | null => {
            if (!item || typeof item !== "object") return null;
            const row = item as Record<string, unknown>;
            const spotRole = String(row.spot_role ?? "").trim();
            if (!spotRole) return null;
            const sceneRoleRaw = String(row.scene_role ?? "").trim();
            const sceneRole: "起" | "承" | "転" | "結" =
              sceneRoleRaw === "起" || sceneRoleRaw === "承" || sceneRoleRaw === "転" || sceneRoleRaw === "結"
                ? sceneRoleRaw
                : index === 0
                  ? "起"
                  : "結";
            return {
              requirementId: String(row.requirement_id ?? `req_${index + 1}`).trim(),
              sceneRole,
              spotRole,
              requiredAttributes: Array.isArray(row.required_attributes)
                ? row.required_attributes.map((v) => String(v ?? "").trim()).filter(Boolean)
                : [],
              visitConstraints: Array.isArray(row.visit_constraints)
                ? row.visit_constraints.map((v) => String(v ?? "").trim()).filter(Boolean)
                : [],
              tourismValueType: String(row.tourism_value_type ?? "").trim() || "地域体験",
            };
          })
          .filter((item): item is {
            requirementId: string;
            sceneRole: "起" | "承" | "転" | "結";
            spotRole: string;
            requiredAttributes: string[];
            visitConstraints: string[];
            tourismValueType: string;
          } => Boolean(item))
      : [],
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

const normalizeImageUri = (value?: string | null) => {
  const raw = (value || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:image/")) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) {
    const base = (
      process.env.EXPO_PUBLIC_MASTRA_BASE_URL ||
      process.env.MASTRA_BASE_URL ||
      process.env.EXPO_PUBLIC_API_BASE_URL ||
      ""
    )
      .replace(/\/+$/, "")
      .trim();
    if (base) return `${base}${raw}`;
  }
  return raw;
};

const createEpisodeVisualAbortError = () => {
  const error = new Error("画像反映待機を中止しました。");
  (error as Error & { name: string }).name = "AbortError";
  return error;
};

const ensureVisualPrefetchNotAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw createEpisodeVisualAbortError();
};

const waitForAbortableDelay = async (ms: number, signal?: AbortSignal) => {
  if (ms <= 0) return;
  ensureVisualPrefetchNotAborted(signal);

  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(createEpisodeVisualAbortError());
    };

    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

type EpisodeVisualPrefetchResult = "loaded" | "timeout" | "failed";

const prefetchImageWithTimeout = async (
  uri: string,
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<EpisodeVisualPrefetchResult> => {
  const { timeoutMs = 12_000, signal } = options;
  ensureVisualPrefetchNotAborted(signal);

  return await new Promise<EpisodeVisualPrefetchResult>((resolve, reject) => {
    const boundedTimeoutMs = Math.max(2_000, timeoutMs);
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    const finish = (result: EpisodeVisualPrefetchResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(createEpisodeVisualAbortError());
    };

    timer = setTimeout(() => finish("timeout"), boundedTimeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });

    Image.prefetch(uri)
      .then(() => finish("loaded"))
      .catch(() => finish("failed"));
  });
};

const collectEpisodeVisualImageUris = (
  episode: GeneratedRuntimeEpisode,
  options: {
    selectedSeriesCoverImageUrl?: string | null;
    seriesDetail?: SeriesDetail | null;
  } = {}
) => {
  const rawUris = [
    episode.coverImageUrl,
    options.selectedSeriesCoverImageUrl,
    options.seriesDetail?.coverImageUrl,
    ...(episode.characters || []).map((character) => character.avatarImageUrl),
    ...(episode.episodeUniqueCharacters || []).map((character) => character.portraitImageUrl),
    ...((options.seriesDetail?.characters || []).map((character) => character.avatarImageUrl)),
  ];

  return Array.from(
    new Set(rawUris.map((uri) => normalizeImageUri(uri)).filter((uri): uri is string => Boolean(uri)))
  );
};

const waitForEpisodeVisualsReady = async (options: {
  uris: string[];
  signal?: AbortSignal;
  perImageTimeoutMs?: number;
  retryDelayMs?: number;
  maxWaitMs?: number;
  onProgress?: (progress: {
    readyCount: number;
    totalCount: number;
    pendingCount: number;
    lastUri?: string;
    lastStatus?: EpisodeVisualPrefetchResult;
  }) => void;
}) => {
  const {
    uris,
    signal,
    perImageTimeoutMs = 12_000,
    retryDelayMs = 1_200,
    maxWaitMs = 90_000,
    onProgress,
  } = options;

  const targetUris = Array.from(
    new Set(uris.map((uri) => normalizeImageUri(uri)).filter((uri): uri is string => Boolean(uri)))
  );
  if (targetUris.length === 0) {
    onProgress?.({ readyCount: 0, totalCount: 0, pendingCount: 0 });
    return;
  }

  const readyUris = new Set<string>();
  const startedAt = Date.now();

  while (readyUris.size < targetUris.length) {
    ensureVisualPrefetchNotAborted(signal);

    for (const uri of targetUris) {
      if (readyUris.has(uri)) continue;
      const status = await prefetchImageWithTimeout(uri, {
        timeoutMs: perImageTimeoutMs,
        signal,
      });
      if (status === "loaded") readyUris.add(uri);
      onProgress?.({
        readyCount: readyUris.size,
        totalCount: targetUris.length,
        pendingCount: targetUris.length - readyUris.size,
        lastUri: uri,
        lastStatus: status,
      });
    }

    if (readyUris.size >= targetUris.length) return;
    if (Date.now() - startedAt >= Math.max(15_000, maxWaitMs)) {
      throw new Error("画像の生成完了を確認できませんでした。時間をおいて再度お試しください。");
    }
    await waitForAbortableDelay(retryDelayMs, signal);
  }
};

const buildMetaFromEpisodeLogs = (logs: Array<{ text: string }>): SeriesSummaryMeta => {
  const episodes = logs
    .map((row) => {
      const match = row.text.match(/EP\.(\d+)/i);
      return match ? Number.parseInt(match[1], 10) : 0;
    })
    .filter((value) => Number.isFinite(value) && value > 0);

  const currentEpisodeNo = episodes.length > 0 ? Math.max(...episodes) : 0;
  return {
    currentEpisodeNo,
    nextEpisodeNo: currentEpisodeNo + 1 || 1,
    episodeCount: episodes.length,
    latestEpisodeTitle: null,
    characterNames: [],
  };
};

const buildMetaFromEpisodesAndCharacterNames = (
  episodes: SeriesEpisode[],
  characterNames: string[]
): SeriesSummaryMeta => {
  const currentEpisodeNo = episodes.reduce((max, row) => Math.max(max, row.episodeNo || 0), 0);
  const latestEpisode = [...episodes].sort((left, right) => right.episodeNo - left.episodeNo)[0];
  return {
    currentEpisodeNo,
    nextEpisodeNo: Math.max(1, currentEpisodeNo + 1),
    episodeCount: episodes.length,
    latestEpisodeTitle: latestEpisode?.title || null,
    characterNames: characterNames.map((name) => name.trim()).filter(Boolean),
  };
};

const EPISODE_PHASE_USER_COPY: Record<RuntimeEpisodeGenerationPhase, string> = {
  request_received: "生成依頼を受け取りました。",
  input_validated: "入力内容を確認しています。",
  characters_validated: "固定キャラクター情報を検証しています。",
  series_context_loaded: "シリーズの文脈を読み込んでいます。",
  episode_request_brief_start: "今回の目的と制約を整理しています。",
  episode_request_brief_done: "今回の目的と制約を確定しました。",
  local_material_selection_start: "現地素材と候補スポットを選定しています。",
  local_material_selection_done: "現地素材と候補スポットの選定が完了しました。",
  continuity_context_built: "前話までの継続情報を組み立てています。",
  pipeline_start: "今回の生成パイプラインを起動しています。",
  fallback_plan_start: "計画生成の復旧ルートを準備しています。",
  fallback_plan_done: "復旧ルートの準備が完了しました。",
  episode_plan_start: "今回話の構成を設計しています。",
  episode_plan_done: "エピソード構成の設計が完了しました。",
  spot_resolution_start: "物語目的に沿ってスポットを選定しています。",
  spot_resolution_done: "スポット選定が完了しました。",
  episode_cast_design_start: "固定キャラと現地キャラの配置を設計しています。",
  episode_cast_design_done: "キャスト配置の設計が完了しました。",
  episode_cast_usage_start: "今回の固定キャラの使い方を設計しています。",
  episode_cast_usage_done: "今回の固定キャラ配置を確定しました。",
  spot_mystery_structure_start: "各スポットでの謎構造を設計しています。",
  spot_mystery_structure_done: "各スポットでの謎構造を確定しました。",
  narration_plan_start: "地の文の補完計画を設計しています。",
  narration_plan_done: "地の文の補完計画が完了しました。",
  dialogue_plan_start: "会話の役割分担を設計しています。",
  dialogue_plan_done: "会話の役割分担が完了しました。",
  episode_outline_start: "今回話のアウトラインを統合しています。",
  episode_outline_done: "今回話のアウトラインを確定しました。",
  route_dry_run_start: "導線と所要時間を検証しています。",
  route_dry_run_done: "導線検証が完了しました。",
  scene_generation_start: "各スポットのシーンを生成しています。",
  scene_generation_done: "シーン生成が完了しました。",
  spot_chapter_start: "シーンの章立てを整えています。",
  spot_chapter_done: "章立ての整形が完了しました。",
  spot_puzzle_start: "シーン詳細を整えています。",
  spot_puzzle_done: "シーン詳細の整形が完了しました。",
  episode_character_images_start: "登場人物の画像を生成しています。",
  episode_character_images_done: "登場人物の画像生成が完了しました。",
  episode_cover_image_start: "エピソードのカバー画像を生成しています。",
  episode_cover_image_done: "カバー画像の生成が完了しました。",
  episode_assemble_start: "エピソード全体を統合しています。",
  episode_assemble_done: "エピソード統合が完了しました。",
  continuity_patch_build_start: "次話へ引き継ぐ継続差分を構築しています。",
  continuity_patch_build_done: "継続差分の構築が完了しました。",
  response_preparing: "仕上げ中です。結果を整えて返却準備をしています。",
  completed: "エピソード生成が完了しました。",
  episode_visual_finalize_start: "画像の生成完了と反映を確認しています。",
  episode_visual_finalize_done: "画像の生成と反映が完了しました。",
};

type EpisodeWorkflowStageStatus = "pending" | "active" | "done";
type EpisodeWorkflowStage = {
  id: string;
  label: string;
  summary: string;
  phases: readonly RuntimeEpisodeGenerationPhase[];
};

const EPISODE_WORKFLOW_STAGES: readonly EpisodeWorkflowStage[] = [
  {
    id: "request",
    label: "受付と検証",
    summary: "生成依頼と入力情報を検証します。",
    phases: ["request_received", "input_validated", "characters_validated"],
  },
  {
    id: "context",
    label: "継続文脈の構築",
    summary: "シリーズ文脈と継続状態を読み込みます。",
    phases: [
      "series_context_loaded",
      "episode_request_brief_start",
      "episode_request_brief_done",
      "local_material_selection_start",
      "local_material_selection_done",
      "continuity_context_built",
      "pipeline_start",
    ],
  },
  {
    id: "plan",
    label: "話構成の設計",
    summary: "今回話の目的・進行・復旧方針を設計します。",
    phases: [
      "fallback_plan_start",
      "fallback_plan_done",
      "episode_plan_start",
      "episode_plan_done",
    ],
  },
  {
    id: "spots_cast",
    label: "スポットとキャスト設計",
    summary: "スポット選定とキャラ配置を設計します。",
    phases: [
      "spot_resolution_start",
      "spot_resolution_done",
      "episode_cast_design_start",
      "episode_cast_design_done",
      "episode_cast_usage_start",
      "episode_cast_usage_done",
      "spot_mystery_structure_start",
      "spot_mystery_structure_done",
      "narration_plan_start",
      "narration_plan_done",
      "dialogue_plan_start",
      "dialogue_plan_done",
      "episode_outline_start",
      "episode_outline_done",
      "route_dry_run_start",
      "route_dry_run_done",
    ],
  },
  {
    id: "scenes",
    label: "シーン生成",
    summary: "スポットごとのシーン表現を生成します。",
    phases: [
      "scene_generation_start",
      "scene_generation_done",
      "spot_chapter_start",
      "spot_chapter_done",
      "spot_puzzle_start",
      "spot_puzzle_done",
    ],
  },
  {
    id: "visuals",
    label: "ビジュアル生成",
    summary: "登場人物画像とカバー画像を生成します。",
    phases: [
      "episode_character_images_start",
      "episode_character_images_done",
      "episode_cover_image_start",
      "episode_cover_image_done",
    ],
  },
  {
    id: "assemble",
    label: "統合と継続差分",
    summary: "エピソード統合と継続パッチ構築を行います。",
    phases: [
      "episode_assemble_start",
      "episode_assemble_done",
      "continuity_patch_build_start",
      "continuity_patch_build_done",
      "response_preparing",
    ],
  },
  {
    id: "visual_finalize",
    label: "画像反映待ち",
    summary: "カバー画像とキャラクター画像の反映完了を確認します。",
    phases: ["completed", "episode_visual_finalize_start"],
  },
  {
    id: "done",
    label: "完了",
    summary: "画像反映まで完了したエピソードを返却します。",
    phases: ["episode_visual_finalize_done"],
  },
] as const;

const normalizeUiCopy = (value?: string | null, fallback = "") => {
  const cleaned = (value || "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
};

const toEpisodePhaseMessage = (event: RuntimeEpisodeGenerationEvent) => {
  const phaseCopy = EPISODE_PHASE_USER_COPY[event.phase];
  const detail = normalizeUiCopy(event.detail).toLowerCase();
  if (
    detail &&
    !detail.includes("attempt") &&
    !detail.includes("llm") &&
    !detail.includes("schema") &&
    !detail.includes("timeout")
  ) {
    return phaseCopy;
  }

  const spotName = normalizeUiCopy(event.spotName);
  if (spotName && (event.phase === "scene_generation_start" || event.phase === "spot_resolution_start")) {
    return `${phaseCopy}\n対象: ${spotName}`;
  }

  if (event.spotIndex && event.spotCount && event.spotCount > 0) {
    return `${phaseCopy}\n進行: ${event.spotIndex}/${event.spotCount}`;
  }

  return phaseCopy;
};

const resolveEpisodeWorkflowStageIndex = (phase: RuntimeEpisodeGenerationPhase) => {
  for (let index = 0; index < EPISODE_WORKFLOW_STAGES.length; index += 1) {
    if (EPISODE_WORKFLOW_STAGES[index].phases.includes(phase)) return index;
  }
  return 0;
};

const EpisodeForgeLoadingOverlay = ({
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
    status: EpisodeWorkflowStageStatus;
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
      <LinearGradient colors={["#06130D", "#0C2317", "#18412A"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
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
                backgroundColor: "rgba(122, 221, 155, 0.2)",
                opacity: pulse.interpolate({
                  inputRange: [0.4, 1],
                  outputRange: [0.4, 0.78],
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
                borderColor: "rgba(176, 255, 204, 0.34)",
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
                  backgroundColor: "rgba(214, 255, 228, 0.95)",
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
                  backgroundColor: "rgba(214, 255, 228, 0.85)",
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
                borderColor: "rgba(115, 216, 151, 0.34)",
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
                  backgroundColor: "rgba(200, 255, 220, 0.92)",
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
                  backgroundColor: "rgba(200, 255, 220, 0.76)",
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
                colors={["#D8FFE7", "#89E6AE", "#2EA769"]}
                start={{ x: 0.15, y: 0.1 }}
                end={{ x: 1, y: 1 }}
                className="flex-1 items-center justify-center"
              >
                <Ionicons name="leaf" size={42} color="#0E2A1A" />
              </LinearGradient>
            </Animated.View>
          </View>

          <Text
            className="text-[25px] text-[#DDFBE9]"
            style={{ fontFamily: fonts.displayBold, letterSpacing: 1.2 }}
          >
            エピソードを生成しています
          </Text>
          <Text className="text-sm text-[#A9E5C1] mt-2" style={{ fontFamily: fonts.bodyMedium, letterSpacing: 0.4 }}>
            {message}
          </Text>

          <View className="w-full mt-4 rounded-2xl border border-white/15 bg-white/8 px-4 py-3">
            <Text className="text-[11px] text-[#C5F2D7]" style={{ fontFamily: fonts.bodyMedium, letterSpacing: 0.6 }}>
              生成ログ
            </Text>
            {recentMessages.map((line, index) => {
              const isLatest = index === recentMessages.length - 1;
              return (
                <View
                  key={`episode-progress-message-${index}-${line}`}
                  className={`mt-2 rounded-xl px-3 py-2 ${isLatest ? "bg-[#E8FFF2]/95" : "bg-white/10"}`}
                >
                  <Text
                    className={`text-[12px] leading-5 ${isLatest ? "text-[#123623]" : "text-[#D5F4E2]"}`}
                    style={{ fontFamily: fonts.bodyRegular }}
                  >
                    {line}
                  </Text>
                </View>
              );
            })}
          </View>

          <View className="w-full mt-3 rounded-2xl border border-white/15 bg-white/8 px-4 py-3">
            <Text className="text-[11px] text-[#C5F2D7]" style={{ fontFamily: fonts.bodyMedium, letterSpacing: 0.6 }}>
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
                    ? "#8FE7B4"
                    : stage.status === "active"
                      ? "#D7FFE8"
                      : "rgba(201, 241, 219, 0.45)";
                return (
                  <View key={stage.id} className="flex-row items-center gap-2">
                    <Ionicons name={iconName as any} size={15} color={iconColor} />
                    <Text
                      className={`text-[12px] ${stage.status === "pending" ? "text-[#8FC5A8]" : "text-[#DDFBEA]"}`}
                      style={{ fontFamily: stage.status === "active" ? fonts.bodyBold : fonts.bodyMedium }}
                    >
                      {stage.label}
                    </Text>
                  </View>
                );
              })}
            </View>
            {activeStage ? (
              <Text className="mt-2 text-[11px] text-[#BDEED2]" style={{ fontFamily: fonts.bodyRegular }}>
                現在: {activeStage.summary}
              </Text>
            ) : null}
          </View>

          <View className="w-full mt-3 h-1.5 rounded-full bg-white/15 overflow-hidden">
            <Animated.View
              className="h-full bg-[#32B56F]"
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
              <Text className="text-[12px] text-[#D9F9E6]" style={{ fontFamily: fonts.bodyMedium, letterSpacing: 0.6 }}>
                生成を中止
              </Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
};


export const AddEpisodeScreen = ({ navigation, route }: Props) => {
  const { userId } = useSessionUserId();
  const prefillSeriesId = route.params?.prefillSeriesId ?? null;
  const prefillSeriesTitle = route.params?.prefillSeriesTitle ?? "";

  const [seriesOptions, setSeriesOptions] = useState<SelectableSeries[]>(fallbackSeriesRows());
  const [selectedSeriesKey, setSelectedSeriesKey] = useState<string | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesMetaLoading, setSeriesMetaLoading] = useState(false);
  const [seriesSelectorOpen, setSeriesSelectorOpen] = useState(false);

  const [step, setStep] = useState<1 | 2>(1);
  const [stageLocation, setStageLocation] = useState("横浜赤レンガ倉庫");
  const [purpose, setPurpose] = useState<Purpose>("観光");
  const [desiredSpotCount, setDesiredSpotCount] = useState<5 | 6 | 7>(5);
  const [userWishes, setUserWishes] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [latestEpisodeGenerationPhase, setLatestEpisodeGenerationPhase] =
    useState<RuntimeEpisodeGenerationPhase>("request_received");
  const [episodeGenerationMessage, setEpisodeGenerationMessage] = useState(
    EPISODE_PHASE_USER_COPY.request_received
  );
  const [episodeGenerationProgressMessages, setEpisodeGenerationProgressMessages] = useState<
    string[]
  >([]);

  const isMountedRef = useRef(true);
  const generationAbortRef = useRef<AbortController | null>(null);
  const seriesSheetTranslateY = useRef(new Animated.Value(42)).current;

  const [seriesMetaByKey, setSeriesMetaByKey] = useState<Record<string, SeriesSummaryMeta>>({});
  const [suggestedSpots, setSuggestedSpots] = useState<string[]>([]);
  const [geocodedCoords, setGeocodedCoords] = useState<{ lat: number; lng: number } | null>(null);

  const selectedSeries = useMemo(
    () => seriesOptions.find((item) => item.key === selectedSeriesKey) || seriesOptions[0] || null,
    [seriesOptions, selectedSeriesKey]
  );
  const selectedSeriesMeta = useMemo(() => {
    if (!selectedSeries) return EMPTY_SERIES_META;
    return seriesMetaByKey[selectedSeries.key] || EMPTY_SERIES_META;
  }, [selectedSeries, seriesMetaByKey]);

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

  const episodeWorkflowStageRows = useMemo(() => {
    const currentIndex = resolveEpisodeWorkflowStageIndex(latestEpisodeGenerationPhase);
    return EPISODE_WORKFLOW_STAGES.map((stage, index) => {
      let status: EpisodeWorkflowStageStatus = "pending";
      if (index < currentIndex) status = "done";
      if (index === currentIndex) status = "active";
      if (latestEpisodeGenerationPhase === "episode_visual_finalize_done" && index <= currentIndex) {
        status = "done";
      }
      return {
        id: stage.id,
        label: stage.label,
        summary: stage.summary,
        status,
      };
    });
  }, [latestEpisodeGenerationPhase]);

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

  useEffect(() => {
    if (!isGenerating) {
      setLatestEpisodeGenerationPhase("request_received");
      setEpisodeGenerationMessage(EPISODE_PHASE_USER_COPY.request_received);
      setEpisodeGenerationProgressMessages([]);
      return;
    }
    if (episodeGenerationProgressMessages.length === 0) {
      setEpisodeGenerationProgressMessages([EPISODE_PHASE_USER_COPY.request_received]);
    }
  }, [episodeGenerationProgressMessages.length, isGenerating]);

  useEffect(() => {
    if (!seriesSelectorOpen) return;
    seriesSheetTranslateY.setValue(42);
    Animated.spring(seriesSheetTranslateY, {
      toValue: 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 3,
    }).start();
  }, [seriesSelectorOpen, seriesSheetTranslateY]);

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
      setSuggestedSpots([]);
      return;
    }

    if (!stageLocation.trim()) {
      setStageLocation(selected.areaName || "横浜赤レンガ倉庫");
    }

    const hydrateSeriesMeta = async () => {
      setSeriesMetaLoading(true);
      try {
        if (selected.id && userId) {
          const [rows, runtimeCtx, seriesDetail] = await Promise.all([
            fetchSeriesEpisodes(selected.id),
            fetchSeriesEpisodeRuntimeContext(selected.id, userId).catch(() => null),
            fetchSeriesDetail(selected.id).catch(() => null),
          ]);

          if (runtimeCtx) {
            const seed = runtimeCtx.firstEpisodeSeed as Record<string, unknown> | null;
            const spotsFromSeed = Array.isArray(seed?.suggested_spots)
              ? seed.suggested_spots.map((s) => String(s ?? "").trim()).filter(Boolean)
              : [];
            const spotsFromRequirements = Array.isArray(seed?.spot_requirements)
              ? seed.spot_requirements
                  .map((item) => {
                    if (!item || typeof item !== "object") return "";
                    const row = item as Record<string, unknown>;
                    return String(row.spot_role ?? "").trim();
                  })
                  .filter(Boolean)
              : [];
            setSuggestedSpots([...spotsFromSeed, ...spotsFromRequirements].slice(0, 7));
          } else {
            setSuggestedSpots([]);
          }

          const runtimeCharacterNames = (runtimeCtx?.characters || [])
            .map((row) => row.name.trim())
            .filter(Boolean);
          const detailCharacterNames = (seriesDetail?.characters || [])
            .map((row) => row.name.trim())
            .filter(Boolean);
          const resolvedCharacterNames =
            runtimeCharacterNames.length > 0 ? runtimeCharacterNames : detailCharacterNames;

          setSeriesMetaByKey((prev) => ({
            ...prev,
            [selected.key]: buildMetaFromEpisodesAndCharacterNames(rows, resolvedCharacterNames),
          }));
          return;
        }

        setSuggestedSpots([]);
        setSeriesMetaByKey((prev) => ({
          ...prev,
          [selected.key]: buildMetaFromEpisodeLogs(FALLBACK_EPISODE_LOGS[selected.title] || []),
        }));
      } catch (error) {
        console.warn("AddEpisodeScreen: failed to load series summary", error);
        setSeriesMetaByKey((prev) => ({
          ...prev,
          [selected.key]: prev[selected.key] || EMPTY_SERIES_META,
        }));
      } finally {
        setSeriesMetaLoading(false);
      }
    };

    void hydrateSeriesMeta();
  }, [selectedSeries, userId]);

  useEffect(() => {
    if (!seriesSelectorOpen || !userId || seriesOptions.length === 0) return;

    let cancelled = false;
    const targetRows = seriesOptions
      .filter((row) => row.id && !seriesMetaByKey[row.key])
      .slice(0, 8);

    if (targetRows.length === 0) return;

    const prefetch = async () => {
      try {
        const entries = await Promise.all(
          targetRows.map(async (item) => {
            try {
              const [episodes, seriesDetail] = await Promise.all([
                fetchSeriesEpisodes(item.id!),
                fetchSeriesDetail(item.id!).catch(() => null),
              ]);
              const characterNames = (seriesDetail?.characters || [])
                .map((row) => row.name.trim())
                .filter(Boolean);
              return [item.key, buildMetaFromEpisodesAndCharacterNames(episodes, characterNames)] as const;
            } catch {
              return [item.key, EMPTY_SERIES_META] as const;
            }
          })
        );

        if (cancelled) return;
        setSeriesMetaByKey((prev) => ({
          ...prev,
          ...Object.fromEntries(entries),
        }));
      } catch (error) {
        if (!cancelled) {
          console.warn("AddEpisodeScreen: failed to prefetch series metadata", error);
        }
      }
    };

    void prefetch();
    return () => {
      cancelled = true;
    };
  }, [seriesMetaByKey, seriesOptions, seriesSelectorOpen, userId]);

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
      Alert.alert("舞台を入力してください", "今回のエピソードで描く場所を指定してください。");
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
    const generationAbortController = new AbortController();
    generationAbortRef.current = generationAbortController;
    const initialPhase: RuntimeEpisodeGenerationPhase = "request_received";
    const initialMessage = EPISODE_PHASE_USER_COPY.request_received;
    setLatestEpisodeGenerationPhase(initialPhase);
    setEpisodeGenerationMessage(initialMessage);
    setEpisodeGenerationProgressMessages([initialMessage]);
    let didNavigateToResult = false;

    const pushEpisodeGenerationMessage = (message: string) => {
      if (!isMountedRef.current) return;
      setEpisodeGenerationMessage(message);
      setEpisodeGenerationProgressMessages((prev) => {
        if (prev[prev.length - 1] === message) return prev;
        return [...prev, message].slice(-8);
      });
    };

    const applyEpisodeGenerationPhase = (
      phase: RuntimeEpisodeGenerationPhase,
      overrideMessage?: string
    ) => {
      if (!isMountedRef.current) return;
      const message = overrideMessage || EPISODE_PHASE_USER_COPY[phase];
      setLatestEpisodeGenerationPhase(phase);
      pushEpisodeGenerationMessage(message);
    };

    try {
      let targetSeriesId = selectedSeries.id;
      const targetSeriesTitle = selectedSeries.title;

      if (!targetSeriesId) {
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
      let episodeBody = buildGeneratedEpisodeBody(
        targetSeriesTitle,
        purpose,
        stageLocation,
        mapCoords
      );
      let runtimeEpisode: GeneratedRuntimeEpisode | null = null;

      if (isMastraSeriesConfigured) {
        try {
          const runtimeContext = targetSeriesId
            ? await fetchSeriesEpisodeRuntimeContext(targetSeriesId, userId)
            : null;

          const characters = runtimeContext?.characters || [];
          if (characters.length === 0) {
            throw new Error(
              "シリーズのキャラクター情報が取得できません。シリーズ保存時にエラーが発生した可能性があります。シリーズ詳細画面から再度保存を試すか、シリーズを最初から作り直してください。"
            );
          }

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
                id: character.id || `char_${index + 1}`,
                name: character.name,
                role: character.role,
                mustAppear: Boolean(character.mustAppear),
                personality: character.personality || undefined,
                portraitImageUrl: character.avatarImageUrl || undefined,
                arcStart: character.arcStart || undefined,
                arcEnd: character.arcEnd || undefined,
              })),
              recentEpisodes: runtimeContext?.recentEpisodes || [],
              seriesBlueprint: runtimeContext?.seriesBlueprint || null,
              initialUserSeriesStateTemplate:
                runtimeContext?.initialUserSeriesStateTemplate || null,
              episodeRuntimeBootstrapPayload:
                runtimeContext?.episodeRuntimeBootstrapPayload || null,
              userSeriesState: runtimeContext?.userSeriesState || null,
            },
            userId,
            stageLocation: stageLocation.trim(),
            purpose,
            userWishes: userWishes.trim() || undefined,
            desiredDurationMinutes: 20,
            desiredSpotCount,
            language: "ja",
          }, {
            signal: generationAbortController.signal,
            onProgress: (event: RuntimeEpisodeGenerationEvent) => {
              const nextMessage = toEpisodePhaseMessage(event);
              applyEpisodeGenerationPhase(event.phase, nextMessage);
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
                return `${header}\n\n${narration ? `${narration}\n\n` : ""}${blocks}`;
              })
              .join("\n\n---\n\n");
          }

          const rawState = runtimeContext?.progressState as Record<string, unknown> | undefined;
          const lastEpNo =
            rawState && typeof rawState === "object"
              ? Number(rawState.last_completed_episode_no ?? rawState.lastCompletedEpisodeNo ?? 0) || 0
              : 0;
          const nextEpisodeNo = lastEpNo + 1;

          let seriesDetailForVisualWait: SeriesDetail | null = null;
          if (targetSeriesId) {
            try {
              seriesDetailForVisualWait = await fetchSeriesDetail(targetSeriesId);
            } catch (error) {
              console.warn(
                "AddEpisodeScreen: failed to fetch series detail before visual finalize",
                error
              );
            }
          }

          const visualUris = collectEpisodeVisualImageUris(runtimeEpisode, {
            selectedSeriesCoverImageUrl: selectedSeries?.coverImageUrl,
            seriesDetail: seriesDetailForVisualWait,
          });

          applyEpisodeGenerationPhase("episode_visual_finalize_start");
          await waitForEpisodeVisualsReady({
            uris: visualUris,
            signal: generationAbortController.signal,
            onProgress: ({ readyCount, totalCount, pendingCount }) => {
              if (totalCount <= 0) return;
              const resolvedCount = pendingCount > 0 ? readyCount : totalCount;
              pushEpisodeGenerationMessage(
                `${EPISODE_PHASE_USER_COPY.episode_visual_finalize_start}\n進行: ${resolvedCount}/${totalCount}`
              );
            },
          });
          applyEpisodeGenerationPhase("episode_visual_finalize_done");

          if (__DEV__) {
            console.log(
              "[AddEpisodeScreen] Mastra success, navigating to EpisodeGenerationResult after visual finalize"
            );
          }
          navigation.replace("EpisodeGenerationResult", {
            runtimeEpisode: runtimeEpisode!,
            seriesId: targetSeriesId,
            seriesTitle: targetSeriesTitle,
            coverImageUrl: selectedSeries?.coverImageUrl,
            episodeNo: nextEpisodeNo,
            stageLocation: stageLocation.trim(),
            stageCoords: mapCoords,
          });
          didNavigateToResult = true;
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

      const result = await createEpisodeForSeries({
        userId,
        seriesId: targetSeriesId,
        seriesTitle: targetSeriesTitle,
        episodeTitle,
        episodeText: episodeBody,
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
      if (isMountedRef.current && !didNavigateToResult) {
        setIsGenerating(false);
      }
    }
  };

  const handleCancelEpisodeGeneration = () => {
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    if (isMountedRef.current) {
      setIsGenerating(false);
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
            エピソード生成画面
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

                <View className="mt-4 rounded-xl border border-[#ECE6DF] bg-white p-4">
                  <View className="flex-row gap-3">
                    <View className="w-16 h-16 rounded-lg bg-[#E5DFD7] items-center justify-center overflow-hidden">
                      {selectedSeries?.coverImageUrl ? (
                        <Image source={{ uri: selectedSeries.coverImageUrl }} className="w-full h-full" resizeMode="cover" />
                      ) : (
                        <Ionicons name="book-outline" size={22} color="#8A7B6C" />
                      )}
                    </View>

                    <View className="flex-1">
                      <View className="flex-row items-start justify-between">
                        <View className="flex-1 pr-2">
                          <Text className="text-xs text-[#8A7B6C] mb-0.5" style={{ fontFamily: fonts.bodyRegular }}>
                            現在選択中
                          </Text>
                          <Text className="text-base text-[#221910]" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
                            {selectedSeries?.title || "シリーズ未選択"}
                          </Text>
                        </View>
                        <Ionicons name="checkmark-circle" size={20} color="#EE8C2B" />
                      </View>

                      <View className="flex-row flex-wrap gap-1.5 mt-2">
                        <View className="px-2.5 py-1 rounded-full bg-[#FFF6EC] border border-[#F5D6B3]">
                          <Text className="text-[10px] text-[#C66A18]" style={{ fontFamily: fonts.displayBold }}>
                            現在 EP.{selectedSeriesMeta.currentEpisodeNo}
                          </Text>
                        </View>
                        <View className="px-2.5 py-1 rounded-full bg-[#ECFDF3] border border-[#BBE9CB]">
                          <Text className="text-[10px] text-[#0F8A43]" style={{ fontFamily: fonts.displayBold }}>
                            次 EP.{selectedSeriesMeta.nextEpisodeNo}
                          </Text>
                        </View>
                        <View className="px-2.5 py-1 rounded-full bg-[#EEF2FF] border border-[#D7DEF9]">
                          <Text className="text-[10px] text-[#4754AA]" style={{ fontFamily: fonts.displayBold }}>
                            登場人物 {selectedSeriesMeta.characterNames.length}人
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  {seriesMetaLoading ? (
                    <View className="py-2 items-center">
                      <ActivityIndicator size="small" color="#EE8C2B" />
                    </View>
                  ) : (
                    <>
                      <Text className="mt-3 text-[11px] text-[#62584E]" numberOfLines={2} style={{ fontFamily: fonts.bodyRegular }}>
                        {selectedSeriesOverview}
                      </Text>

                      <View className="mt-2 flex-row items-center gap-1.5">
                        <Ionicons name="refresh-outline" size={12} color="#8A7B6C" />
                        <Text className="text-[11px] text-[#8A7B6C] flex-1" numberOfLines={1} style={{ fontFamily: fonts.bodyRegular }}>
                          {selectedSeriesMeta.latestEpisodeTitle
                            ? `最新話: ${selectedSeriesMeta.latestEpisodeTitle}`
                            : "まだ公開済みエピソードはありません"}
                        </Text>
                      </View>

                      <View className="mt-2 flex-row items-center gap-1.5">
                        <Ionicons name="people-outline" size={12} color="#8A7B6C" />
                        <Text className="text-[11px] text-[#6C5647] flex-1" numberOfLines={1} style={{ fontFamily: fonts.bodyRegular }}>
                          {selectedSeriesMeta.characterNames.length > 0
                            ? `引き継ぎキャラ: ${selectedSeriesMeta.characterNames.slice(0, 3).join(" / ")}${
                                selectedSeriesMeta.characterNames.length > 3
                                  ? ` +${selectedSeriesMeta.characterNames.length - 3}`
                                  : ""
                              }`
                            : "引き継ぎキャラ: 未設定"}
                        </Text>
                      </View>
                    </>
                  )}
                </View>
              </View>

              <View className="px-5 py-4 border-t border-[#EFE9E3]">
                <View className="flex-row items-center gap-2 mb-3">
                  <Ionicons name="map-outline" size={16} color="#EE8C2B" />
                  <Text className="text-sm text-[#5E554C]" style={{ fontFamily: fonts.displayBold }}>
                    今回の舞台（どこを描く？）
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
                    舞台
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
                    エピソードのテーマ
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
                  <Ionicons name="trail-sign-outline" size={16} color="#EE8C2B" />
                  <Text className="text-sm text-[#5E554C]" style={{ fontFamily: fonts.displayBold }}>
                    今回の巡回スポット数
                  </Text>
                </View>
                <Text className="text-xs text-[#8A7B6C] mb-3" style={{ fontFamily: fonts.bodyRegular }}>
                  5〜7件から選択。選んだ件数をAI生成に反映します
                </Text>
                <View className="flex-row gap-2">
                  {[5, 6, 7].map((value) => {
                    const active = desiredSpotCount === value;
                    return (
                      <Pressable
                        key={value}
                        onPress={() => setDesiredSpotCount(value as 5 | 6 | 7)}
                        className={`flex-1 h-11 rounded-xl border items-center justify-center ${
                          active ? "border-[#EE8C2B] bg-[#EE8C2B]" : "border-[#E3D6C9] bg-white"
                        }`}
                      >
                        <Text
                          className={`text-sm ${active ? "text-white" : "text-[#6C5647]"}`}
                          style={{ fontFamily: fonts.displayBold }}
                        >
                          {value}件
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
                      AIで次のエピソードを生成
                    </Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>

      <Modal visible={seriesSelectorOpen} transparent animationType="none" onRequestClose={() => setSeriesSelectorOpen(false)}>
        <View className="flex-1 justify-end bg-black/45">
          <Pressable className="absolute inset-0" onPress={() => setSeriesSelectorOpen(false)} />
          <Animated.View
            className="rounded-t-3xl bg-white px-5 pt-4 pb-8 max-h-[80%]"
            style={{ transform: [{ translateY: seriesSheetTranslateY }] }}
          >
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
                  const meta = seriesMetaByKey[item.key];
                  const isMetaPending = Boolean(item.id && !meta);
                  const currentEpisodeNo = meta?.currentEpisodeNo || 0;
                  const nextEpisodeNo = meta?.nextEpisodeNo || 1;
                  const characterCount = meta?.characterNames.length || 0;
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
                        <View className="w-11 h-11 rounded-md bg-[#E5DFD7] overflow-hidden items-center justify-center">
                          {item.coverImageUrl ? (
                            <Image source={{ uri: item.coverImageUrl }} className="w-full h-full" resizeMode="cover" />
                          ) : (
                            <Ionicons name="book-outline" size={18} color="#8A7B6C" />
                          )}
                        </View>

                        <View className="flex-1">
                          <Text className="text-sm text-[#2B1E16]" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
                            {item.title}
                          </Text>
                          <Text className="text-[11px] text-[#7A6F63] mt-0.5" numberOfLines={1} style={{ fontFamily: fonts.bodyRegular }}>
                            {item.areaName || item.description || "シリーズ"}
                          </Text>

                          {isMetaPending ? (
                            <View className="mt-1.5">
                              <Text className="text-[10px] text-[#A09183]" style={{ fontFamily: fonts.bodyRegular }}>
                                EP / 登場人物 情報を取得中...
                              </Text>
                            </View>
                          ) : (
                            <View className="flex-row flex-wrap gap-1 mt-1.5">
                              <View className="px-2 py-0.5 rounded-full bg-[#FFF6EC] border border-[#F5D6B3]">
                                <Text className="text-[10px] text-[#C66A18]" style={{ fontFamily: fonts.displayBold }}>
                                  EP.{currentEpisodeNo} → 次EP.{nextEpisodeNo}
                                </Text>
                              </View>
                              <View className="px-2 py-0.5 rounded-full bg-[#EEF2FF] border border-[#D7DEF9]">
                                <Text className="text-[10px] text-[#4754AA]" style={{ fontFamily: fonts.displayBold }}>
                                  登場人物 {characterCount}人
                                </Text>
                              </View>
                            </View>
                          )}

                          {!isMetaPending && characterCount > 0 ? (
                            <Text className="text-[10px] text-[#7A6F63] mt-1" numberOfLines={1} style={{ fontFamily: fonts.bodyRegular }}>
                              継承: {meta?.characterNames.slice(0, 2).join(" / ")}
                              {characterCount > 2 ? ` +${characterCount - 2}` : ""}
                            </Text>
                          ) : null}
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
          </Animated.View>
        </View>
      </Modal>

      {isGenerating ? (
        <EpisodeForgeLoadingOverlay
          message={episodeGenerationMessage}
          stages={episodeWorkflowStageRows}
          progressMessages={episodeGenerationProgressMessages}
          onCancel={handleCancelEpisodeGeneration}
        />
      ) : null}
    </View>
  );
};
