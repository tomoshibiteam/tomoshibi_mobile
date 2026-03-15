import React, { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import MapView, { Marker, Polyline } from "react-native-maps";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  applySeriesContinuityPatchVNext,
  applySeriesProgressPatch,
  createEpisodeForSeries,
  fetchSeriesDetail,
  saveRuntimeEpisodeSpots,
  type RuntimeSpotCoordinate,
} from "@/services/quests";
import { useSessionUserId } from "@/hooks/useSessionUser";
import type { RootStackParamList } from "@/navigation/types";
import type {
  EpisodeCharacter,
  GeneratedRuntimeEpisode,
} from "@/services/seriesAi";
import { fonts } from "@/theme/fonts";
import { geocodeAddress } from "@/lib/geocode";

type Props = NativeStackScreenProps<RootStackParamList, "EpisodeGenerationResult">;

type TabKey = "route" | "overview" | "characters";
type RoutePoint = {
  key: string;
  order: number;
  spotName: string;
  sceneRole: string;
  sceneObjective: string;
  lat: number;
  lng: number;
  address?: string | null;
};
type CharacterCard = {
  id: string;
  name: string;
  role: string;
  personality: string;
  avatarUrl: string;
  isSeriesFixed: boolean;
};
type RouteSpotPin = {
  key: string;
  order: number;
  spotName: string;
  sceneRole: string;
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "route", label: "ルート" },
  { key: "overview", label: "概要" },
  { key: "characters", label: "登場人物" },
];

const FALLBACK_COVER =
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1200&q=80";
const DEFAULT_REGION = {
  latitude: 35.4437,
  longitude: 139.638,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};
const GOOGLE_MAPS_WEB_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY ??
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ??
  "";

const normalizeKey = (value?: string | null) => (value || "").trim().toLowerCase();

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

const buildSeedAvatar = (seed: string) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed || "tomoshibi-character")}/320/320`;
const buildSeedCover = (seed: string) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed || "tomoshibi-episode-cover")}/1200/800`;

const pickEpisodeCoverFromRuntime = (runtimeEpisode: GeneratedRuntimeEpisode) => {
  const output =
    runtimeEpisode.episodeOutputVNext &&
    typeof runtimeEpisode.episodeOutputVNext === "object" &&
    !Array.isArray(runtimeEpisode.episodeOutputVNext)
      ? (runtimeEpisode.episodeOutputVNext as Record<string, unknown>)
      : {};
  const candidates = [
    runtimeEpisode.coverImageUrl,
    output.coverImageUrl,
    output.cover_image_url,
    output.episodeCoverImageUrl,
    output.episode_cover_image_url,
  ];
  for (const candidate of candidates) {
    const normalized =
      typeof candidate === "string" ? candidate.replace(/\s+/g, " ").trim() : "";
    if (normalized) return normalized;
  }
  return null;
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
      return `${header}\n\n${narration ? `${narration}\n\n` : ""}${blocks}`;
    })
    .join("\n\n---\n\n");

  return [...headerLines, "", spotBody].filter(Boolean).join("\n");
};

const buildRegionFromPoints = (
  points: RoutePoint[],
  fallback?: { lat: number; lng: number } | null
) => {
  if (points.length === 0) {
    if (
      fallback &&
      Number.isFinite(fallback.lat) &&
      Number.isFinite(fallback.lng)
    ) {
      return {
        latitude: fallback.lat,
        longitude: fallback.lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      };
    }
    return DEFAULT_REGION;
  }

  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLng = points[0].lng;
  let maxLng = points[0].lng;

  points.forEach((point) => {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  });

  const latitudeDelta = Math.max(0.012, (maxLat - minLat) * 1.8);
  const longitudeDelta = Math.max(0.012, (maxLng - minLng) * 1.8);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta,
    longitudeDelta,
  };
};

const spreadOverlappingRoutePoints = (points: RoutePoint[]): RoutePoint[] => {
  if (points.length <= 1) return points;
  const grouped = new Map<string, number[]>();

  points.forEach((point, index) => {
    const key = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      grouped.set(key, [index]);
    }
  });

  const adjusted = points.map((point) => ({ ...point }));
  grouped.forEach((indexes) => {
    if (indexes.length <= 1) return;
    const step = (Math.PI * 2) / indexes.length;
    const radius = 0.00042;
    indexes.forEach((pointIndex, index) => {
      adjusted[pointIndex].lat = adjusted[pointIndex].lat + Math.sin(step * index) * radius;
      adjusted[pointIndex].lng = adjusted[pointIndex].lng + Math.cos(step * index) * radius;
    });
  });

  return adjusted;
};

const buildWaypointQuery = (point: RoutePoint, stageLocation?: string) => {
  const fromAddress = (point.address || "").trim();
  if (fromAddress) return fromAddress;
  const fromName = `${point.spotName || ""} ${stageLocation || ""}`.trim();
  if (fromName) return fromName;
  return `${point.lat},${point.lng}`;
};

const decodeGooglePolyline = (encoded: string) => {
  const points: Array<{ latitude: number; longitude: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return points;
};

const fetchGoogleDirectionsPath = async (
  points: RoutePoint[],
  stageLocation?: string
): Promise<Array<{ latitude: number; longitude: number }>> => {
  if (!GOOGLE_MAPS_WEB_API_KEY || points.length < 2) return [];

  const origin = buildWaypointQuery(points[0], stageLocation);
  const destination = buildWaypointQuery(points[points.length - 1], stageLocation);
  const waypoints = points
    .slice(1, -1)
    .map((point) => buildWaypointQuery(point, stageLocation))
    .filter(Boolean);

  const params = new URLSearchParams({
    origin,
    destination,
    mode: "walking",
    language: "ja",
    region: "jp",
    key: GOOGLE_MAPS_WEB_API_KEY,
  });
  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.join("|"));
  }

  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`
    );
    if (!response.ok) return [];
    const data = (await response.json()) as {
      status?: string;
      routes?: Array<{ overview_polyline?: { points?: string } }>;
    };

    if (data.status !== "OK") return [];
    const encoded = data.routes?.[0]?.overview_polyline?.points;
    if (!encoded) return [];
    return decodeGooglePolyline(encoded);
  } catch {
    return [];
  }
};

const buildGoogleDirectionsLink = (points: RoutePoint[], stageLocation?: string) => {
  if (points.length === 0) return "";
  const origin = buildWaypointQuery(points[0], stageLocation);
  const destination = buildWaypointQuery(points[points.length - 1], stageLocation);
  const waypoints = points
    .slice(1, -1)
    .map((point) => buildWaypointQuery(point, stageLocation));

  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "walking",
  });
  if (waypoints.length > 0) params.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

const buildGoogleDirectionsEmbedUrl = (points: RoutePoint[], stageLocation?: string) => {
  if (!GOOGLE_MAPS_WEB_API_KEY || points.length === 0) return "";
  const origin = buildWaypointQuery(points[0], stageLocation);
  const destination = buildWaypointQuery(points[points.length - 1], stageLocation);
  const waypoints = points
    .slice(1, -1)
    .map((point) => buildWaypointQuery(point, stageLocation));

  const params = new URLSearchParams({
    key: GOOGLE_MAPS_WEB_API_KEY,
    origin,
    destination,
    mode: "walking",
  });
  if (waypoints.length > 0) params.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/embed/v1/directions?${params.toString()}`;
};

const buildGoogleSpotLink = (spotName: string, stageLocation?: string) => {
  const query = `${spotName || ""} ${stageLocation || ""}`.trim() || spotName || "日本";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
};

const buildGooglePlaceEmbedUrl = (query: string) => {
  if (!GOOGLE_MAPS_WEB_API_KEY) return "";
  const params = new URLSearchParams({
    key: GOOGLE_MAPS_WEB_API_KEY,
    q: query || "日本",
    zoom: "15",
  });
  return `https://www.google.com/maps/embed/v1/place?${params.toString()}`;
};

const buildOsmEmbedUrl = (
  points: RoutePoint[],
  fallback?: { lat: number; lng: number } | null
) => {
  const target =
    points[0] ||
    (fallback && Number.isFinite(fallback.lat) && Number.isFinite(fallback.lng)
      ? { lat: fallback.lat, lng: fallback.lng }
      : { lat: DEFAULT_REGION.latitude, lng: DEFAULT_REGION.longitude });

  const span = 0.01;
  const bbox = [
    target.lng - span,
    target.lat - span,
    target.lng + span,
    target.lat + span,
  ].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${target.lat}%2C${target.lng}`;
};

const openUrlSafely = async (url: string) => {
  if (!url) return;
  try {
    await Linking.openURL(url);
  } catch {
    // ignore
  }
};

let googleMapsJsLoader: Promise<void> | null = null;

const loadGoogleMapsJs = async () => {
  if (Platform.OS !== "web") return;
  const hasGoogle = Boolean((globalThis as any)?.google?.maps);
  if (hasGoogle) return;
  if (!GOOGLE_MAPS_WEB_API_KEY) {
    throw new Error("GOOGLE_MAPS_WEB_API_KEY is missing");
  }
  if (!googleMapsJsLoader) {
    googleMapsJsLoader = new Promise<void>((resolve, reject) => {
      const scriptId = "tomoshibi-google-maps-js";
      const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Google Maps script load failed")), {
          once: true,
        });
        return;
      }

      const script = document.createElement("script");
      script.id = scriptId;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_WEB_API_KEY}`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Google Maps script load failed"));
      document.head.appendChild(script);
    });
  }

  await googleMapsJsLoader;
};

export const EpisodeGenerationResultScreen = ({ navigation, route }: Props) => {
  const {
    runtimeEpisode,
    seriesId,
    seriesTitle,
    episodeNo,
    stageLocation,
    stageCoords,
  } = route.params;
  const { userId } = useSessionUserId();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<TabKey>("route");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [routeCoordinates, setRouteCoordinates] = useState<RuntimeSpotCoordinate[]>([]);
  const [seriesCharacterRefs, setSeriesCharacterRefs] = useState<
    Array<{ id: string; name: string; role: string; avatarUrl: string | null }>
  >([]);

  const runtimeEpisodeCover = useMemo(
    () => pickEpisodeCoverFromRuntime(runtimeEpisode),
    [runtimeEpisode]
  );
  const fallbackEpisodeCover = useMemo(
    () =>
      buildSeedCover(
        `${seriesTitle}-${runtimeEpisode.title}-${String(episodeNo || 1)}`
      ),
    [episodeNo, runtimeEpisode.title, seriesTitle]
  );
  const coverUri = runtimeEpisodeCover || fallbackEpisodeCover || FALLBACK_COVER;
  const spots = runtimeEpisode.spots || [];
  const characters = runtimeEpisode.characters || [];
  const episodeDisplayNo = Math.max(1, episodeNo || 1);
  const saveButtonLabel = `第${episodeDisplayNo}話を保存する`;
  const savingButtonLabel = `第${episodeDisplayNo}話を保存中...`;

  const resolveSpotCoordinates = useCallback(async (): Promise<RuntimeSpotCoordinate[]> => {
    const uniqueByName = new Set<string>();
    const uniqueSpots: string[] = [];

    for (const spot of runtimeEpisode.spots || []) {
      const name = (spot.spotName || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (uniqueByName.has(key)) continue;
      uniqueByName.add(key);
      uniqueSpots.push(name);
    }

    const resolved: Array<RuntimeSpotCoordinate | null> = await Promise.all(
      uniqueSpots.map(async (name) => {
        const geocoded = await geocodeSpotCoordinate(name, stageLocation);
        if (geocoded) {
          return {
            spotName: name,
            lat: geocoded.lat,
            lng: geocoded.lng,
            address: geocoded.address,
          } satisfies RuntimeSpotCoordinate;
        }

        if (
          stageCoords &&
          Number.isFinite(stageCoords.lat) &&
          Number.isFinite(stageCoords.lng)
        ) {
          return {
            spotName: name,
            lat: stageCoords.lat,
            lng: stageCoords.lng,
            address: stageLocation || name,
          } satisfies RuntimeSpotCoordinate;
        }

        return null;
      })
    );

    return resolved.filter(
      (row): row is RuntimeSpotCoordinate => row !== null
    );
  }, [runtimeEpisode.spots, stageLocation, stageCoords]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (spots.length === 0) {
        setRouteCoordinates([]);
        return;
      }
      setIsRouteLoading(true);
      try {
        const resolved = await resolveSpotCoordinates();
        if (!cancelled) {
          setRouteCoordinates(resolved);
        }
      } finally {
        if (!cancelled) {
          setIsRouteLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [resolveSpotCoordinates, spots.length]);

  useEffect(() => {
    let cancelled = false;

    const loadSeriesCharacterImages = async () => {
      if (!seriesId) {
        setSeriesCharacterRefs([]);
        return;
      }
      try {
        const detail = await fetchSeriesDetail(seriesId);
        if (cancelled) return;

        const refs = (detail?.characters || []).map((character, index) => ({
          id: (character.id || `series-char-${index + 1}`).trim(),
          name: (character.name || "").trim(),
          role: (character.role || "").trim(),
          avatarUrl: (character.avatarImageUrl || "").trim() || null,
        }));
        setSeriesCharacterRefs(refs);
      } catch (error) {
        if (!cancelled) {
          console.warn("EpisodeGenerationResult: fetchSeriesDetail warning", error);
          setSeriesCharacterRefs([]);
        }
      }
    };

    void loadSeriesCharacterImages();
    return () => {
      cancelled = true;
    };
  }, [seriesId]);

  const routePoints = useMemo<RoutePoint[]>(() => {
    const coordinateByName = new Map(
      routeCoordinates.map((row) => [normalizeKey(row.spotName), row])
    );

    const next: RoutePoint[] = [];
    spots.forEach((spot, index) => {
      const resolved = coordinateByName.get(normalizeKey(spot.spotName));

      if (resolved) {
        next.push({
          key: `${spot.spotName}-${index}`,
          order: index + 1,
          spotName: spot.spotName,
          sceneRole: spot.sceneRole || "",
          sceneObjective: spot.sceneObjective || "",
          lat: resolved.lat,
          lng: resolved.lng,
          address: resolved.address || null,
        });
        return;
      }

      if (
        stageCoords &&
        Number.isFinite(stageCoords.lat) &&
        Number.isFinite(stageCoords.lng)
      ) {
        next.push({
          key: `${spot.spotName}-${index}`,
          order: index + 1,
          spotName: spot.spotName,
          sceneRole: spot.sceneRole || "",
          sceneObjective: spot.sceneObjective || "",
          lat: stageCoords.lat,
          lng: stageCoords.lng,
          address: stageLocation || null,
        });
      }
    });

    return next;
  }, [routeCoordinates, spots, stageCoords, stageLocation]);

  const routeRegion = useMemo(
    () => buildRegionFromPoints(routePoints, stageCoords),
    [routePoints, stageCoords]
  );

  const routeSpotPins = useMemo<RouteSpotPin[]>(
    () =>
      spots.map((spot, index) => ({
        key: `${spot.spotName}-${index}`,
        order: index + 1,
        spotName: spot.spotName,
        sceneRole: spot.sceneRole || "",
      })),
    [spots]
  );

  const directionUrl = useMemo(
    () => buildGoogleDirectionsLink(routePoints, stageLocation),
    [routePoints, stageLocation]
  );

  const characterCards = useMemo<CharacterCard[]>(() => {
    const seriesById = new Map<string, { name: string; role: string; avatarUrl: string | null }>();
    const seriesByName = new Map<string, { name: string; role: string; avatarUrl: string | null }>();
    seriesCharacterRefs.forEach((character) => {
      const idKey = normalizeKey(character.id);
      if (idKey && !seriesById.has(idKey)) {
        seriesById.set(idKey, character);
      }
      const nameKey = normalizeKey(character.name);
      if (nameKey && !seriesByName.has(nameKey)) {
        seriesByName.set(nameKey, character);
      }
    });
    const sourceIdPattern = /^char[_-]?(\d+)$/i;

    return characters.map((character, index) => {
      const idRaw = (character.id || "").trim();
      const nameRaw = (character.name || "").trim();
      const roleRaw = (character.role || "").trim();
      const idKey = normalizeKey(idRaw);
      const nameKey = normalizeKey(nameRaw);

      let matchedSeries =
        (idKey ? seriesById.get(idKey) : undefined) ||
        (nameKey ? seriesByName.get(nameKey) : undefined) ||
        null;

      if (!matchedSeries) {
        const match = (idRaw || nameRaw).match(sourceIdPattern);
        if (match) {
          const orderIndex = Number.parseInt(match[1], 10) - 1;
          if (
            Number.isFinite(orderIndex) &&
            orderIndex >= 0 &&
            orderIndex < seriesCharacterRefs.length
          ) {
            matchedSeries = seriesCharacterRefs[orderIndex];
          }
        }
      }

      const key = normalizeKey(character.name);
      const seriesImage =
        (matchedSeries?.avatarUrl || (key ? seriesByName.get(key)?.avatarUrl : "") || "").trim();
      const isSeriesFixed = character.origin === "series" || Boolean(matchedSeries) || Boolean(seriesImage);
      const localGeneratedImage = (character.avatarImageUrl || "").trim();
      const avatarUrl =
        seriesImage ||
        localGeneratedImage ||
        buildSeedAvatar(`${seriesTitle}-${runtimeEpisode.title}-${character.name}-${index}`);
      const shouldReplaceName =
        !nameRaw || sourceIdPattern.test(nameRaw) || nameRaw === idRaw;
      const displayName = shouldReplaceName
        ? (matchedSeries?.name || nameRaw || `登場人物${index + 1}`)
        : nameRaw;
      const displayRole =
        roleRaw && roleRaw !== "series_character"
          ? roleRaw
          : matchedSeries?.role || roleRaw || "役割未設定";

      return {
        id: character.id || `${character.name}-${index}`,
        name: displayName,
        role: displayRole,
        personality: character.personality,
        avatarUrl,
        isSeriesFixed,
      } satisfies CharacterCard;
    });
  }, [characters, runtimeEpisode.title, seriesCharacterRefs, seriesTitle]);

  const seriesFixedCount = useMemo(
    () => characterCards.filter((card) => card.isSeriesFixed).length,
    [characterCards]
  );

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
        coverImageUrl: runtimeEpisodeCover || fallbackEpisodeCover,
      });

      try {
        const spotCoordinates =
          routeCoordinates.length > 0
            ? routeCoordinates
            : await resolveSpotCoordinates();

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

      if (runtimeEpisode.continuityPatchVNext && result.questId) {
        try {
          await applySeriesContinuityPatchVNext({
            questId: result.questId,
            userId,
            savedEpisodeNo:
              result.storage === "quest_episodes" ? result.episodeNo : undefined,
            continuityPatch: runtimeEpisode.continuityPatchVNext,
          });
        } catch (continuityPatchError) {
          console.warn(
            "EpisodeGenerationResult: applySeriesContinuityPatchVNext warning",
            continuityPatchError
          );
        }
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

      navigation.replace("SeriesDetail", { questId: result.questId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Alert.alert("保存に失敗しました", msg);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    episodeNo,
    navigation,
    resolveSpotCoordinates,
    routeCoordinates,
    runtimeEpisode,
    seriesId,
    seriesTitle,
    stageCoords,
    stageLocation,
    fallbackEpisodeCover,
    runtimeEpisodeCover,
    userId,
  ]);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View className="flex-1 bg-[#F8F7F6]">
      <View className="flex-1">
        <View className="relative h-[300px]">
          <ImageBackground
            source={{ uri: coverUri }}
            resizeMode="cover"
            className="absolute inset-0"
          />
          <View className="absolute inset-0 bg-black/40" />

          <SafeAreaView edges={["top"]} className="absolute top-0 left-0 right-0">
            <View className="px-4 py-3">
              <Pressable
                className="w-10 h-10 rounded-full bg-black/25 items-center justify-center"
                onPress={handleBack}
              >
                <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
          </SafeAreaView>

          <View className="absolute left-0 right-0 bottom-0 px-5 pb-6">
            <View className="self-start rounded-md bg-white/20 border border-white/10 px-2.5 py-1 mb-3">
              <Text
                className="text-[10px] text-white tracking-[1.2px]"
                style={{
                  fontFamily: fonts.displayBold,
                  textShadowColor: "rgba(0,0,0,0.6)",
                  textShadowOffset: { width: 0, height: 1 },
                  textShadowRadius: 4,
                }}
              >
                EPISODE #{String(episodeNo || 1).padStart(2, "0")}
              </Text>
            </View>

            <Text
              className="text-[30px] leading-[38px] text-white"
              style={{
                fontFamily: fonts.displayExtraBold,
                textShadowColor: "rgba(0,0,0,0.7)",
                textShadowOffset: { width: 0, height: 2 },
                textShadowRadius: 8,
              }}
            >
              {runtimeEpisode.title}
            </Text>

            <View className="flex-row items-center gap-4 mt-3">
              <View className="flex-row items-center gap-1">
                <Ionicons name="time-outline" size={15} color="#EAE4DE" />
                <Text
                  className="text-xs text-[#EAE4DE]"
                  style={{
                    fontFamily: fonts.bodyMedium,
                    textShadowColor: "rgba(0,0,0,0.6)",
                    textShadowOffset: { width: 0, height: 1 },
                    textShadowRadius: 4,
                  }}
                >
                  {runtimeEpisode.estimatedDurationMinutes}分
                </Text>
              </View>
              <View className="flex-row items-center gap-1">
                <Ionicons name="map-outline" size={15} color="#EAE4DE" />
                <Text
                  className="text-xs text-[#EAE4DE]"
                  style={{
                    fontFamily: fonts.bodyMedium,
                    textShadowColor: "rgba(0,0,0,0.6)",
                    textShadowOffset: { width: 0, height: 1 },
                    textShadowRadius: 4,
                  }}
                  numberOfLines={1}
                >
                  {stageLocation || "舞台未設定"}
                </Text>
              </View>
            </View>

            {runtimeEpisode.oneLiner ? (
              <Text
                className="text-xs text-[#EFE6DD] mt-2"
                style={{
                  fontFamily: fonts.bodyRegular,
                  textShadowColor: "rgba(0,0,0,0.55)",
                  textShadowOffset: { width: 0, height: 1 },
                  textShadowRadius: 3,
                }}
                numberOfLines={2}
              >
                「{runtimeEpisode.oneLiner}」
              </Text>
            ) : null}
          </View>
        </View>

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

        {activeTab === "route" ? (
          <View className="flex-1 bg-[#EFE6DD]/30">
            <RouteTab
              routePoints={routePoints}
              routeSpotPins={routeSpotPins}
              routeRegion={routeRegion}
              isRouteLoading={isRouteLoading}
              stageCoords={stageCoords}
              stageLocation={stageLocation}
              onOpenDirections={() => void openUrlSafely(directionUrl)}
              onOpenSpotPin={(spotName) =>
                void openUrlSafely(buildGoogleSpotLink(spotName, stageLocation))
              }
              bottomInset={Math.max(118, insets.bottom + 92)}
            />
          </View>
        ) : (
          <ScrollView
            className="flex-1 bg-[#EFE6DD]/30"
            contentContainerStyle={{ paddingBottom: 132 }}
            showsVerticalScrollIndicator={false}
          >
            {activeTab === "overview" ? (
              <OverviewTab runtimeEpisode={runtimeEpisode} episodeNo={episodeNo} />
            ) : null}
            {activeTab === "characters" ? (
              <CharactersTab
                cards={characterCards}
                seriesFixedCount={seriesFixedCount}
              />
            ) : null}
          </ScrollView>
        )}
      </View>

      <View
        className="absolute bottom-0 left-0 right-0 border-t border-[#ECE6DF] bg-[#F8F7F6] px-4 pt-3"
        style={{ paddingBottom: Math.max(12, insets.bottom + 10) }}
      >
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={handleBack}
            className="w-12 h-12 rounded-2xl border border-[#E5DDD5] bg-white items-center justify-center"
          >
            <Ionicons name="arrow-back" size={20} color="#9A734C" />
          </Pressable>

          <Pressable
            onPress={handleSave}
            disabled={isSubmitting}
            className="flex-1 h-12 rounded-2xl bg-[#EE8C2B] items-center justify-center flex-row gap-2"
            style={{ opacity: isSubmitting ? 0.78 : 1 }}
          >
            {isSubmitting ? (
              <>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                  {savingButtonLabel}
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="book" size={18} color="#FFFFFF" />
                <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                  {saveButtonLabel}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
};

function WebGoogleRouteMap({
  routePoints,
  routingPoints,
  routeRegion,
  stageCoords,
  stageLocation,
  fallbackEmbedUrl,
}: {
  routePoints: RoutePoint[];
  routingPoints: RoutePoint[];
  routeRegion: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
  stageCoords?: { lat: number; lng: number } | null;
  stageLocation?: string;
  fallbackEmbedUrl: string;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const renderMap = async () => {
      try {
        await loadGoogleMapsJs();
        if (cancelled) return;

        const googleApi = (globalThis as any)?.google;
        const maps = googleApi?.maps;
        const host = mapContainerRef.current;
        if (!maps || !host) {
          setLoadFailed(true);
          return;
        }

        if (!mapRef.current) {
          mapRef.current = new maps.Map(host, {
            center: {
              lat: routeRegion.latitude,
              lng: routeRegion.longitude,
            },
            zoom: 14,
            gestureHandling: "greedy",
            disableDefaultUI: true,
          });
        }

        const map = mapRef.current;

        overlaysRef.current.forEach((overlay) => {
          if (overlay && typeof overlay.setMap === "function") {
            overlay.setMap(null);
          }
        });
        overlaysRef.current = [];

        if (routePoints.length > 0) {
          const bounds = new maps.LatLngBounds();
          routePoints.forEach((point) => {
            bounds.extend({ lat: point.lat, lng: point.lng });
          });
          map.fitBounds(bounds, 52);
          if (routePoints.length === 1) {
            map.setZoom(15);
          }
        } else if (
          stageCoords &&
          Number.isFinite(stageCoords.lat) &&
          Number.isFinite(stageCoords.lng)
        ) {
          map.setCenter({ lat: stageCoords.lat, lng: stageCoords.lng });
          map.setZoom(14);
        } else {
          map.setCenter({
            lat: routeRegion.latitude,
            lng: routeRegion.longitude,
          });
          map.setZoom(13);
        }

        routePoints.forEach((point, index) => {
          const isStart = index === 0;
          const isLast = index === routePoints.length - 1;
          const marker = new maps.Marker({
            map,
            position: { lat: point.lat, lng: point.lng },
            title: `${point.order}. ${point.spotName}`,
            label: {
              text: String(point.order),
              color: "#FFFFFF",
              fontWeight: "700",
            },
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: isStart ? 11 : 10,
              fillColor: isStart ? "#22C55E" : isLast ? "#EF4444" : "#EE8C2B",
              fillOpacity: 1,
              strokeColor: "#FFFFFF",
              strokeWeight: 2,
            },
          });
          overlaysRef.current.push(marker);
        });

        if (routingPoints.length > 1) {
          const requestOrigin = buildWaypointQuery(routingPoints[0], stageLocation);
          const requestDestination = buildWaypointQuery(
            routingPoints[routingPoints.length - 1],
            stageLocation
          );
          const requestWaypoints = routingPoints.slice(1, -1).map((point) => ({
            location: buildWaypointQuery(point, stageLocation),
            stopover: true,
          }));

          try {
            const directionsService = new maps.DirectionsService();
            const routeResult = await new Promise<any>((resolve, reject) => {
              directionsService.route(
                {
                  origin: requestOrigin,
                  destination: requestDestination,
                  waypoints: requestWaypoints,
                  optimizeWaypoints: false,
                  travelMode: maps.TravelMode.WALKING,
                },
                (result: any, status: string) => {
                  if (status === "OK" && result) resolve(result);
                  else reject(new Error(status));
                }
              );
            });

            const directionsRenderer = new maps.DirectionsRenderer({
              map,
              suppressMarkers: true,
              preserveViewport: true,
              polylineOptions: {
                strokeColor: "#EE8C2B",
                strokeOpacity: 0.95,
                strokeWeight: 4,
              },
            });
            directionsRenderer.setDirections(routeResult);
            overlaysRef.current.push(directionsRenderer);
          } catch {
            const polyline = new maps.Polyline({
              map,
              path: routePoints.map((point) => ({
                lat: point.lat,
                lng: point.lng,
              })),
              strokeColor: "#EE8C2B",
              strokeOpacity: 0.95,
              strokeWeight: 4,
            });
            overlaysRef.current.push(polyline);
          }
        }

        setLoadFailed(false);
        setMapReady(true);
      } catch {
        if (!cancelled) {
          setLoadFailed(true);
          setMapReady(false);
        }
      }
    };

    setMapReady(false);
    void renderMap();

    return () => {
      cancelled = true;
    };
  }, [
    routePoints,
    routingPoints,
    routeRegion.latitude,
    routeRegion.longitude,
    routeRegion.latitudeDelta,
    routeRegion.longitudeDelta,
    stageCoords,
    stageLocation,
  ]);

  return (
    <View className="flex-1">
      {loadFailed ? (
        fallbackEmbedUrl
          ? createElement("iframe", {
              src: fallbackEmbedUrl,
              loading: "eager",
              allowFullScreen: true,
              referrerPolicy: "no-referrer-when-downgrade",
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: "100%",
                height: "100%",
                border: "none",
                pointerEvents: "auto",
              },
            })
          : null
      ) : (
        createElement("div", {
          ref: mapContainerRef,
          style: {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            height: "100%",
          },
        })
      )}

      {!mapReady ? (
        <View className="absolute right-4 top-14 rounded-full bg-white/90 px-3 py-1.5 flex-row items-center gap-2">
          <ActivityIndicator size="small" color="#EE8C2B" />
          <Text className="text-[11px] text-[#6C5647]" style={{ fontFamily: fonts.bodyRegular }}>
            地図を準備中
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function RouteTab({
  routePoints,
  routeSpotPins,
  routeRegion,
  isRouteLoading,
  stageCoords,
  stageLocation,
  onOpenDirections,
  onOpenSpotPin,
  bottomInset,
}: {
  routePoints: RoutePoint[];
  routeSpotPins: RouteSpotPin[];
  routeRegion: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
  isRouteLoading: boolean;
  stageCoords?: { lat: number; lng: number } | null;
  stageLocation?: string;
  onOpenDirections: () => void;
  onOpenSpotPin: (spotName: string) => void;
  bottomInset: number;
}) {
  const displayRoutePoints = useMemo(
    () => spreadOverlappingRoutePoints(routePoints),
    [routePoints]
  );
  const [nativeRoutePath, setNativeRoutePath] = useState<
    Array<{ latitude: number; longitude: number }>
  >([]);

  const fallbackEmbedUrl = useMemo(
    () => buildOsmEmbedUrl(displayRoutePoints, stageCoords),
    [displayRoutePoints, stageCoords]
  );

  const embedUrl = useMemo(() => {
    if (GOOGLE_MAPS_WEB_API_KEY) {
      if (routePoints.length >= 2) {
        return buildGoogleDirectionsEmbedUrl(routePoints, stageLocation);
      }
      const query =
        routePoints.length > 0
          ? `${routePoints[0].lat},${routePoints[0].lng}`
          : stageLocation || "日本";
      return buildGooglePlaceEmbedUrl(query);
    }
    return fallbackEmbedUrl;
  }, [routePoints, stageLocation, fallbackEmbedUrl]);

  useEffect(() => {
    if (Platform.OS === "web") {
      setNativeRoutePath([]);
      return;
    }
    if (routePoints.length < 2 || !GOOGLE_MAPS_WEB_API_KEY) {
      setNativeRoutePath([]);
      return;
    }

    let cancelled = false;
    const loadNativeRoute = async () => {
      const path = await fetchGoogleDirectionsPath(routePoints, stageLocation);
      if (!cancelled) {
        setNativeRoutePath(path);
      }
    };
    void loadNativeRoute();

    return () => {
      cancelled = true;
    };
  }, [routePoints, stageLocation]);

  return (
    <View className="flex-1">
      <View className="flex-1 overflow-hidden" style={{ backgroundColor: "#EDE6DE" }}>
        {Platform.OS === "web" ? (
          GOOGLE_MAPS_WEB_API_KEY ? (
            <WebGoogleRouteMap
              routePoints={displayRoutePoints}
              routingPoints={routePoints}
              routeRegion={routeRegion}
              stageCoords={stageCoords}
              stageLocation={stageLocation}
              fallbackEmbedUrl={fallbackEmbedUrl}
            />
          ) : embedUrl ? (
            createElement("iframe", {
              src: embedUrl,
              loading: "eager",
              allowFullScreen: true,
              referrerPolicy: "no-referrer-when-downgrade",
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: "100%",
                height: "100%",
                border: "none",
                pointerEvents: "auto",
              },
            })
          ) : null
        ) : (
          <MapView
            key={displayRoutePoints.map((point) => `${point.lat},${point.lng}`).join("|") || "empty-route"}
            style={{ width: "100%", height: "100%" }}
            initialRegion={routeRegion}
            showsUserLocation={false}
            showsMyLocationButton={false}
            pitchEnabled={false}
          >
            {displayRoutePoints.length > 1 ? (
              <Polyline
                coordinates={
                  nativeRoutePath.length > 1
                    ? nativeRoutePath
                    : displayRoutePoints.map((point) => ({
                        latitude: point.lat,
                        longitude: point.lng,
                      }))
                }
                strokeColor="#EE8C2B"
                strokeWidth={4}
              />
            ) : null}

            {displayRoutePoints.map((point, index) => {
              const isStart = index === 0;
              const isLast = index === displayRoutePoints.length - 1;
              return (
                <Marker
                  key={point.key}
                  coordinate={{ latitude: point.lat, longitude: point.lng }}
                  title={`${point.order}. ${point.spotName}`}
                  description={point.sceneRole || undefined}
                  pinColor={isStart ? "#22C55E" : isLast ? "#EF4444" : "#EE8C2B"}
                />
              );
            })}
          </MapView>
        )}

        <View className="absolute top-4 left-4 right-4 flex-row items-center justify-between">
          <View className="px-3 py-1.5 rounded-full bg-black/45 border border-white/15">
            <Text className="text-[11px] text-white" style={{ fontFamily: fonts.displayBold }}>
              スポット {routeSpotPins.length}件
            </Text>
          </View>
          <Pressable onPress={onOpenDirections} className="px-3 py-1.5 rounded-full bg-white/92 border border-[#E5D3BE]">
            <Text className="text-[11px] text-[#B86921]" style={{ fontFamily: fonts.displayBold }}>
              地図アプリで開く
            </Text>
          </Pressable>
        </View>

        {isRouteLoading ? (
          <View className="absolute right-4 top-14 rounded-full bg-white/90 px-3 py-1.5 flex-row items-center gap-2">
            <ActivityIndicator size="small" color="#EE8C2B" />
            <Text className="text-[11px] text-[#6C5647]" style={{ fontFamily: fonts.bodyRegular }}>
              ルートを解析中
            </Text>
          </View>
        ) : null}

        {routeSpotPins.length > 0 ? (
          <View
            className="absolute left-3 right-3"
            style={{ bottom: Math.max(10, bottomInset - 8) }}
            pointerEvents="box-none"
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 10, gap: 8 }}
            >
              {routeSpotPins.map((spot) => (
                <Pressable
                  key={spot.key}
                  onPress={() => onOpenSpotPin(spot.spotName)}
                  className="flex-row items-center rounded-2xl border border-[#E7D7C7] bg-white/95 px-3 py-2"
                >
                  <View className="w-6 h-6 rounded-full bg-[#EE8C2B] items-center justify-center mr-2">
                    <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                      {spot.order}
                    </Text>
                  </View>
                  <View style={{ maxWidth: 180 }}>
                    <Text
                      className="text-xs text-[#3A2B1F]"
                      style={{ fontFamily: fonts.displayBold }}
                      numberOfLines={1}
                    >
                      {spot.spotName}
                    </Text>
                    {spot.sceneRole ? (
                      <Text
                        className="text-[10px] text-[#8A7B6C]"
                        style={{ fontFamily: fonts.bodyRegular }}
                        numberOfLines={1}
                      >
                        {spot.sceneRole}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function OverviewTab({
  runtimeEpisode,
  episodeNo,
}: {
  runtimeEpisode: GeneratedRuntimeEpisode;
  episodeNo?: number;
}) {
  return (
    <View className="p-5">
      <View className="bg-white p-4 rounded-r-xl border-l-4 border-[#EE8C2B]/50 border border-[#ECE6DF] mb-4">
        <Text
          className="text-[10px] text-[#EE8C2B] mb-1"
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

      <View className="bg-white rounded-xl border border-[#ECE6DF] p-5 mb-4">
        <Text
          className="text-base text-[#221910] mb-3 pb-2 border-b border-[#EFE6DD]"
          style={{ fontFamily: fonts.displayBold }}
        >
          第{episodeNo || 1}話のあらすじ
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
    </View>
  );
}

function CharactersTab({
  cards,
  seriesFixedCount,
}: {
  cards: CharacterCard[];
  seriesFixedCount: number;
}) {
  return (
    <View className="p-5">
      <View className="mb-4">
        <Text
          className="text-base text-[#221910]"
          style={{ fontFamily: fonts.displayBold }}
        >
          登場人物
        </Text>
        <Text
          className="text-xs text-[#9A734C] mt-0.5"
          style={{ fontFamily: fonts.bodyRegular }}
        >
          シリーズ固定 {seriesFixedCount}人 / エピソード固有 {Math.max(0, cards.length - seriesFixedCount)}人
        </Text>
      </View>

      <View className="gap-4">
        {cards.map((card) => (
          <View
            key={card.id}
            className="bg-white rounded-xl overflow-hidden border border-[#ECE6DF] flex-row min-h-[104px]"
          >
            <View className="w-24 bg-[#E5DFD7] items-center justify-center overflow-hidden">
              <Image source={{ uri: card.avatarUrl }} className="w-full h-full" resizeMode="cover" />
            </View>

            <View className="flex-1 p-3 justify-center">
              <View className="flex-row items-center justify-between mb-1.5">
                <View className={`px-2 py-0.5 rounded-full ${card.isSeriesFixed ? "bg-[#ECFDF3] border border-[#BBE9CB]" : "bg-[#FFF5E7] border border-[#F7DAB5]"}`}>
                  <Text
                    className="text-[10px]"
                    style={{
                      fontFamily: fonts.displayBold,
                      color: card.isSeriesFixed ? "#0F8A43" : "#B86921",
                    }}
                  >
                    {card.isSeriesFixed ? "シリーズ固定" : "エピソード固有"}
                  </Text>
                </View>
                <Text className="text-[10px] text-[#A78E79]" style={{ fontFamily: fonts.bodyMedium }}>
                  {card.role}
                </Text>
              </View>

              <Text
                className="text-base text-[#221910]"
                style={{ fontFamily: fonts.displayBold }}
              >
                {card.name}
              </Text>

              {card.personality ? (
                <Text
                  className="text-xs text-[#9A734C] mt-1"
                  style={{ fontFamily: fonts.bodyRegular }}
                  numberOfLines={2}
                >
                  {card.personality}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
