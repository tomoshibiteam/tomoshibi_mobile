import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { TopBar } from "@/components/common/TopBar";
import { fonts } from "@/theme/fonts";
import type { RootStackParamList } from "@/navigation/types";
import { useSessionUserId } from "@/hooks/useSessionUser";
import { fetchUserProfile } from "@/services/social";
import { getSupabaseOrThrow, isSupabaseConfigured } from "@/lib/supabase";
import { ProfileAvatar } from "@/components/common/ProfileAvatar";

type SettingRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  value?: string;
  destructive?: boolean;
};

const SettingRow = ({ icon, label, onPress, value, destructive }: SettingRowProps) => (
  <Pressable
    onPress={onPress}
    className="w-full flex-row items-center justify-between px-4 py-4 border-b border-[#E8D5BE]/50"
  >
    <View className="flex-row items-center gap-3">
      <Ionicons name={icon} size={18} color={destructive ? "#B85A1F" : "#D87A32"} />
      <Text
        className={`text-sm ${destructive ? "text-[#B85A1F]" : "text-[#3D2E1F]"}`}
        style={{ fontFamily: fonts.displayBold }}
      >
        {label}
      </Text>
    </View>

    {value ? (
      <Text className="text-xs text-[#7A6652]" style={{ fontFamily: fonts.bodyRegular }}>
        {value}
      </Text>
    ) : (
      <Ionicons name="chevron-forward" size={16} color="#9A938B" />
    )}
  </Pressable>
);

export const SettingsScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { userId } = useSessionUserId();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{ name: string; email: string; image: string | null }>({
    name: "名前未設定",
    email: "",
    image: null,
  });

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const row = await fetchUserProfile(userId);
      setProfile({
        name: row?.name || "名前未設定",
        email: "",
        image: row?.profile_picture_url || null,
      });
    } catch (error) {
      console.error("SettingsScreen: failed to load profile", error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const handleLogout = () => {
    Alert.alert("ログアウト", "ログアウトしますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "ログアウト",
        style: "destructive",
        onPress: async () => {
          if (!isSupabaseConfigured) return;
          try {
            const supabase = getSupabaseOrThrow();
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
            navigation.reset({ index: 0, routes: [{ name: "MainTabs", params: { screen: "Home" } }] });
          } catch (error) {
            console.error("SettingsScreen: sign out failed", error);
            Alert.alert("エラー", "ログアウトに失敗しました。");
          }
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert("お問い合わせください", "アカウント削除はサポートまでお問い合わせください。");
  };

  return (
    <View className="flex-1 bg-[#FEF9F3]">
      <TopBar title="設定" />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#D87A32" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
          <View className="pt-6 mb-8 items-center">
            <Text className="text-2xl text-[#3D2E1F] mb-1" style={{ fontFamily: fonts.displayBold }}>
              設定
            </Text>
            <Text className="text-xs text-[#7A6652]" style={{ fontFamily: fonts.bodyMedium }}>
              冒険の記録と設定
            </Text>
          </View>

          <Pressable
            onPress={() => navigation.navigate("ProfileEdit")}
            className="mb-8 p-5 rounded-3xl bg-white/80 border border-[#E8D5BE]"
          >
            <View className="flex-row items-center gap-4">
              <ProfileAvatar name={profile.name} imageUrl={profile.image} size={64} />
              <View className="flex-1 min-w-0">
                <Text className="text-lg text-[#3D2E1F]" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
                  {profile.name}
                </Text>
                <Text className="text-xs text-[#7A6652] mt-0.5" numberOfLines={1} style={{ fontFamily: fonts.bodyRegular }}>
                  {profile.email || "メールアドレス未設定"}
                </Text>
                <View className="flex-row items-center mt-1">
                  <Text className="text-[10px] text-[#D87A32]" style={{ fontFamily: fonts.displayBold }}>
                    プロフィール編集
                  </Text>
                  <Ionicons name="chevron-forward" size={12} color="#D87A32" />
                </View>
              </View>
            </View>
          </Pressable>

          <View className="mb-6">
            <Text className="text-xs text-[#7A6652] ml-4 mb-2" style={{ fontFamily: fonts.displayBold }}>
              アプリ設定
            </Text>
            <View className="rounded-2xl bg-white/60 border border-[#E8D5BE] overflow-hidden">
              <SettingRow icon="language-outline" label="言語" value="日本語" />
              <SettingRow icon="information-circle-outline" label="バージョン" value="1.0.0" />
            </View>
          </View>

          <View>
            <Text className="text-xs text-[#7A6652] ml-4 mb-2" style={{ fontFamily: fonts.displayBold }}>
              アカウント
            </Text>
            <View className="rounded-2xl bg-white/60 border border-[#E8D5BE] overflow-hidden">
              <SettingRow icon="create-outline" label="プロフィール編集" onPress={() => navigation.navigate("ProfileEdit")} />
              <SettingRow
                icon="person-add-outline"
                label="フォロー管理"
                onPress={() => {
                  if (!userId) {
                    navigation.navigate("Auth");
                    return;
                  }
                  navigation.navigate("UserConnections", { userId, tab: "following" });
                }}
              />
              <SettingRow icon="log-out-outline" label="ログアウト" onPress={handleLogout} />
              <Pressable onPress={handleDeleteAccount} className="w-full px-4 py-4">
                <View className="flex-row items-center gap-3">
                  <Ionicons name="trash-outline" size={18} color="#B85A1F" />
                  <Text className="text-sm text-[#B85A1F]" style={{ fontFamily: fonts.displayBold }}>
                    アカウント削除
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
};
