import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { fonts } from "@/theme/fonts";
import type { RootStackParamList } from "@/navigation/types";

type CreateActionCardProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  onPress: () => void;
};

const CreateActionCard = ({ icon, title, description, onPress }: CreateActionCardProps) => (
  <Pressable
    className="w-full text-left p-4 bg-[#F9F7F4] border border-[#EFE2D3] rounded-2xl flex-row items-start gap-4"
    onPress={onPress}
  >
    <View className="p-3 bg-white rounded-xl border border-[#EFE2D3]">
      <Ionicons name={icon} size={24} color="#EE8C2B" />
    </View>
    <View className="flex-1">
      <Text className="text-sm text-[#2B1E16] mb-1" style={{ fontFamily: fonts.displayBold }}>
        {title}
      </Text>
      <Text className="text-xs text-[#7A6652] leading-5" style={{ fontFamily: fonts.bodyRegular }}>
        {description}
      </Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color="#C9B9A9" />
  </Pressable>
);

export const CreateScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-[#F8F7F6]">
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, paddingBottom: 110 }}>
        <View className="items-center mb-6">
          <View className="w-12 h-1.5 bg-[#E8E0D8] rounded-full mb-6" />
          <View className="w-full flex-row justify-between items-center">
            <Text className="text-xl text-[#2B1E16]" style={{ fontFamily: fonts.displayBold }}>
              作成する
            </Text>
            <Pressable
              className="w-9 h-9 rounded-full bg-[#F6F0E8] items-center justify-center"
              onPress={() => navigation.navigate("MainTabs", { screen: "Home" })}
            >
              <Ionicons name="close" size={18} color="#8E8072" />
            </Pressable>
          </View>
        </View>

        <View className="gap-4">
          <CreateActionCard
            icon="book-outline"
            title="新しいシリーズを作る"
            description="世界観やキャラクターをゼロから構築し、物語の骨格を作ります。"
            onPress={() => navigation.navigate("CreateSeries")}
          />

          <CreateActionCard
            icon="document-text-outline"
            title="エピソードを追加する"
            description="既存シリーズに、新しい場所や物語の続きを追加します。"
            onPress={() => navigation.navigate("AddEpisode")}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};
