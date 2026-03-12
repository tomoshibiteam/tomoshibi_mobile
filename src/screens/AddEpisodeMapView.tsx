import React, { createElement, memo, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, Pressable, Text, View } from "react-native";
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
const OSM_ZOOM = 15;
const TILE_SIZE = 0.01;
const MAP_QUERY_DEBOUNCE_MS = 360;
const EMBED_DEFER_MS = 140;

const useDebouncedText = (value: string, delayMs = MAP_QUERY_DEBOUNCE_MS) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [delayMs, value]);
  return debounced;
};

const WebPlaceholder = ({ stageLocation, mapCoords }: Props) => {
  const trimmedStage = stageLocation.trim();
  const mapQuery = useDebouncedText(trimmedStage || "横浜");
  const [showEmbed, setShowEmbed] = useState(false);
  const [embedLoaded, setEmbedLoaded] = useState(false);

  useEffect(() => {
    setEmbedLoaded(false);
    setShowEmbed(false);
    const timer = setTimeout(() => {
      setShowEmbed(true);
    }, EMBED_DEFER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [mapQuery]);

  const openInGoogleMaps = () => {
    const query = mapCoords
      ? `${mapCoords.lat},${mapCoords.lng}`
      : encodeURIComponent(mapQuery || "日本");
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
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

  const hasGoogleKey = GOOGLE_MAPS_WEB_API_KEY.length > 0;
  const placeQuery = mapQuery || "横浜";
  const googleEmbedUrl = hasGoogleKey
    ? `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_WEB_API_KEY}&q=${encodeURIComponent(
        placeQuery
      )}&zoom=15`
    : null;
  const embedUrl = googleEmbedUrl || osmEmbedUrl;

  const staticMapUrl = hasGoogleKey
    ? `https://maps.googleapis.com/maps/api/staticmap?key=${GOOGLE_MAPS_WEB_API_KEY}&center=${encodeURIComponent(
        placeQuery
      )}&zoom=15&size=1200x360&scale=2&markers=color:0xEE8C2B%7C${encodeURIComponent(placeQuery)}`
    : `https://staticmap.openstreetmap.de/staticmap.php?center=${center.lat},${center.lng}&zoom=${OSM_ZOOM}&size=1200x360&markers=${center.lat},${center.lng},red-pushpin`;

  return (
    <View style={{ width: "100%", height: 180, minHeight: 180, overflow: "hidden" }}>
      <Image
        source={{ uri: staticMapUrl }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: "100%",
          height: "100%",
        }}
        resizeMode="cover"
      />

      {showEmbed
        ? createElement("iframe", {
            src: embedUrl,
            onLoad: () => setEmbedLoaded(true),
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: "100%",
              height: "100%",
              border: "none",
              opacity: embedLoaded ? 1 : 0,
              transition: "opacity 180ms ease-out",
            },
          })
        : null}

      {!embedLoaded ? (
        <View
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
          <Text style={{ color: "#6C5647", fontSize: 11 }}>地図を準備中</Text>
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
          {hasGoogleKey ? "Google Mapsで開く" : "外部地図で開く"}
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
      style={{ width: "100%", height: 180, minHeight: 180 }}
      initialRegion={mapRegion}
      region={mapCoords ? mapRegion : undefined}
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
