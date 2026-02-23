import React from "react";
import { Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RootStackParamList } from "@/navigation/types";
import { fonts } from "@/theme/fonts";

type Props = NativeStackScreenProps<RootStackParamList, "GamePlay">;

export const GamePlayScreen = ({ navigation }: Props) => {
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-[#F8F7F6]">
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-xl text-[#221910] mb-3 text-center" style={{ fontFamily: fonts.displayBold }}>
          Web版では現在ゲームプレイを利用できません
        </Text>
        <Text className="text-sm text-[#6C5647] text-center mb-6" style={{ fontFamily: fonts.bodyRegular }}>
          位置情報と地図機能を使用するため、アプリ版でご利用ください。
        </Text>
        <Pressable
          className="h-11 rounded-xl bg-[#EE8C2B] px-5 items-center justify-center"
          onPress={() => navigation.goBack()}
        >
          <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
            戻る
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};
