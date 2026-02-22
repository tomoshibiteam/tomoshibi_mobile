import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fonts } from "@/theme/fonts";

type TopBarProps = {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
};

export const TopBar = ({ title, onBack, right }: TopBarProps) => {
  const navigation = useNavigation();

  return (
    <SafeAreaView edges={["top"]} className="bg-[#F8F7F6]">
      <View className="h-14 px-4 flex-row items-center justify-between border-b border-[#ECE6DF] bg-[#F8F7F6]">
        <Pressable
          onPress={onBack || (() => navigation.goBack())}
          className="w-9 h-9 rounded-full items-center justify-center"
          android_ripple={{ color: "#EFE2D3", borderless: true }}
        >
          <Ionicons name="arrow-back" size={20} color="#6C5647" />
        </Pressable>

        <Text className="text-sm text-[#3D2E1F]" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
          {title}
        </Text>

        <View className="w-9 h-9 items-center justify-center">{right}</View>
      </View>
    </SafeAreaView>
  );
};
