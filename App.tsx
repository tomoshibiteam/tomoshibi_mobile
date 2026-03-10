import "./src/styles/global.css";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts as usePlusJakartaFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import {
  NotoSansJP_400Regular,
  NotoSansJP_500Medium,
  NotoSansJP_700Bold,
  useFonts as useNotoSansFonts,
} from "@expo-google-fonts/noto-sans-jp";
import {
  NotoSerifJP_400Regular,
  NotoSerifJP_600SemiBold,
  useFonts as useNotoSerifFonts,
} from "@expo-google-fonts/noto-serif-jp";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { RootNavigator } from "@/navigation/RootNavigator";

export default function App() {
  const [displayLoaded] = usePlusJakartaFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  const [bodyLoaded] = useNotoSansFonts({
    NotoSansJP_400Regular,
    NotoSansJP_500Medium,
    NotoSansJP_700Bold,
  });
  const [storyLoaded] = useNotoSerifFonts({
    NotoSerifJP_400Regular,
    NotoSerifJP_600SemiBold,
  });

  const fontsReady = displayLoaded && bodyLoaded && storyLoaded;

  if (!fontsReady) {
    return (
      <View className="flex-1 items-center justify-center bg-[#F8F7F6]">
        <ActivityIndicator color="#EE8C2B" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
