import React from "react";
import { View } from "react-native";

export default function MapViewMock(props: { children?: React.ReactNode; style?: unknown; [key: string]: unknown }) {
  return <View style={props.style}>{props.children}</View>;
}

export function Marker() {
  return null;
}

export const Polyline = () => null;
