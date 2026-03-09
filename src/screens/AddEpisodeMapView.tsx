import React, { createElement } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
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

const WebPlaceholder = ({ stageLocation, mapCoords }: Props) => {
  const openInGoogleMaps = () => {
    const query = mapCoords
      ? `${mapCoords.lat},${mapCoords.lng}`
      : encodeURIComponent(stageLocation.trim() || "日本");
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
  };

  const center = mapCoords ?? DEFAULT_CENTER;
  const bbox = [
    center.lng - TILE_SIZE,
    center.lat - TILE_SIZE,
    center.lng + TILE_SIZE,
    center.lat + TILE_SIZE,
  ].join(",");
  const osmEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${center.lat}%2C${center.lng}`;

  const hasGoogleKey = GOOGLE_MAPS_WEB_API_KEY.length > 0;
  const placeQuery = mapCoords
    ? `${mapCoords.lat},${mapCoords.lng}`
    : (stageLocation.trim() || "横浜");
  const googleEmbedUrl =
    hasGoogleKey &&
    `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_WEB_API_KEY}&q=${encodeURIComponent(placeQuery)}&zoom=15`;

  const embedUrl = hasGoogleKey && googleEmbedUrl ? googleEmbedUrl : osmEmbedUrl;
  const mapKey = `${placeQuery}-${mapCoords ? "coords" : "query"}`;

  return (
    <View style={{ width: "100%", height: 180, minHeight: 180, overflow: "hidden" }}>
      {createElement("iframe", {
        key: mapKey,
        src: embedUrl,
        style: {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: "100%",
          height: "100%",
          border: "none",
        },
      })}
      {!hasGoogleKey && (
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
          <Text style={{ color: "#EE8C2B", fontSize: 11 }}>Google Mapsで開く</Text>
        </Pressable>
      )}
    </View>
  );
};

export const AddEpisodeMapView = (props: Props) => {
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
