import React, { createElement, memo, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from "react-native";
import MapView, { Marker } from "react-native-maps";

type Props = {
  stageLocation: string;
  mapCoords: { lat: number; lng: number } | null;
  mapRegion: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
};

const GOOGLE_MAPS_WEB_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY ??
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ??
  "";

const DEFAULT_CENTER = { lat: 35.4437, lng: 139.638 };
const TILE_SIZE = 0.01;
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
        if ((globalThis as any)?.google?.maps) {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("Google Maps script load failed")),
          {
            once: true,
          }
        );
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

const WebPlaceholder = ({ stageLocation, mapCoords }: Props) => {
  const trimmedStage = stageLocation.trim();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const placeQuery = useMemo(() => {
    if (mapCoords && Number.isFinite(mapCoords.lat) && Number.isFinite(mapCoords.lng)) {
      return `${mapCoords.lat},${mapCoords.lng}`;
    }
    return trimmedStage || "横浜";
  }, [mapCoords, trimmedStage]);

  const openInGoogleMaps = () => {
    const query = encodeURIComponent(placeQuery || "日本");
    void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
  };

  const center = mapCoords ?? DEFAULT_CENTER;
  const bbox = useMemo(
    () =>
      [
        center.lng - TILE_SIZE,
        center.lat - TILE_SIZE,
        center.lng + TILE_SIZE,
        center.lat + TILE_SIZE,
      ].join(","),
    [center.lat, center.lng]
  );
  const osmEmbedUrl = useMemo(
    () =>
      `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${center.lat}%2C${center.lng}`,
    [bbox, center.lat, center.lng]
  );
  const googleEmbedUrl = useMemo(
    () => `https://www.google.com/maps?q=${encodeURIComponent(placeQuery)}&z=15&output=embed`,
    [placeQuery]
  );

  useEffect(() => {
    let cancelled = false;
    if (!GOOGLE_MAPS_WEB_API_KEY) {
      setLoadFailed(true);
      setMapReady(false);
      return () => {
        cancelled = true;
      };
    }

    const renderMap = async () => {
      try {
        await loadGoogleMapsJs();
        if (cancelled) return;
        const googleApi = (globalThis as any)?.google;
        const maps = googleApi?.maps;
        const host = mapContainerRef.current;
        if (!maps || !host) {
          setLoadFailed(true);
          setMapReady(false);
          return;
        }

        const centerPoint = mapCoords
          ? { lat: mapCoords.lat, lng: mapCoords.lng }
          : { lat: center.lat, lng: center.lng };

        if (!mapRef.current) {
          mapRef.current = new maps.Map(host, {
            center: centerPoint,
            zoom: mapCoords ? 15 : 13,
            gestureHandling: "greedy",
            disableDefaultUI: true,
            clickableIcons: false,
          });
        } else {
          mapRef.current.setCenter(centerPoint);
          mapRef.current.setZoom(mapCoords ? 15 : 13);
        }

        if (markerRef.current && typeof markerRef.current.setMap === "function") {
          markerRef.current.setMap(null);
          markerRef.current = null;
        }

        if (mapCoords) {
          markerRef.current = new maps.Marker({
            map: mapRef.current,
            position: { lat: mapCoords.lat, lng: mapCoords.lng },
            title: trimmedStage || "舞台",
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: "#EE8C2B",
              fillOpacity: 1,
              strokeColor: "#FFFFFF",
              strokeWeight: 2,
            },
          });
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
  }, [center.lat, center.lng, mapCoords?.lat, mapCoords?.lng, trimmedStage]);

  return (
    <View style={{ width: "100%", height: 180, minHeight: 180, overflow: "hidden" }}>
      {loadFailed
        ? createElement("iframe", {
            src: GOOGLE_MAPS_WEB_API_KEY ? googleEmbedUrl : osmEmbedUrl,
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
        : createElement("div", {
            ref: mapContainerRef,
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: "100%",
              height: "100%",
              touchAction: "none",
            },
          })}

      {!mapReady ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            right: 8,
            top: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            backgroundColor: "rgba(255,255,255,0.88)",
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 999,
          }}
        >
          <ActivityIndicator size="small" color="#EE8C2B" />
          <Text style={{ color: "#6C5647", fontSize: 11 }}>
            {loadFailed ? "地図を読み込み中" : "地図を準備中"}
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={openInGoogleMaps}
        style={{
          position: "absolute",
          bottom: 4,
          right: 4,
          backgroundColor: "rgba(255,255,255,0.9)",
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 4,
        }}
      >
        <Text style={{ color: "#EE8C2B", fontSize: 11 }}>
          Google Mapsで開く
        </Text>
      </Pressable>
    </View>
  );
};

const AddEpisodeMapViewBase = (props: Props) => {
  if (Platform.OS === "web") {
    return <WebPlaceholder {...props} />;
  }

  const { stageLocation, mapCoords, mapRegion } = props;
  return (
    <MapView
      key={
        mapCoords
          ? `${mapCoords.lat.toFixed(6)},${mapCoords.lng.toFixed(6)}`
          : `${mapRegion.latitude.toFixed(6)},${mapRegion.longitude.toFixed(6)}`
      }
      style={{ width: "100%", height: 180, minHeight: 180 }}
      initialRegion={mapRegion}
      showsUserLocation={false}
      showsMyLocationButton={false}
      scrollEnabled={true}
      pitchEnabled={false}
    >
      {mapCoords ? (
        <Marker
          coordinate={{ latitude: mapCoords.lat, longitude: mapCoords.lng }}
          title={stageLocation.trim()}
          pinColor="#EE8C2B"
        />
      ) : null}
    </MapView>
  );
};

export const AddEpisodeMapView = memo(
  AddEpisodeMapViewBase,
  (prev, next) =>
    prev.stageLocation === next.stageLocation &&
    prev.mapCoords?.lat === next.mapCoords?.lat &&
    prev.mapCoords?.lng === next.mapCoords?.lng &&
    prev.mapRegion.latitude === next.mapRegion.latitude &&
    prev.mapRegion.longitude === next.mapRegion.longitude &&
    prev.mapRegion.latitudeDelta === next.mapRegion.latitudeDelta &&
    prev.mapRegion.longitudeDelta === next.mapRegion.longitudeDelta
);
