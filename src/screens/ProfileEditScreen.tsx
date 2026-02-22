import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RootStackParamList } from "@/navigation/types";
import { fonts } from "@/theme/fonts";
import { ProfileAvatar } from "@/components/common/ProfileAvatar";
import { useSessionUserId } from "@/hooks/useSessionUser";
import { fetchUserProfile, updateUserProfile } from "@/services/social";
import { isSupabaseConfigured } from "@/lib/supabase";

const BIO_MAX = 160;
const EXTRA_PROFILE_KEY = "tomoshibi.profileEditExtras";

type TitleBadge = "historian" | "traveler" | "collector";

type ExtraProfile = {
  websiteUrl?: string;
  xId?: string;
  instagramId?: string;
  selectedTitleBadge?: TitleBadge;
};

const titleBadges: Array<{ id: TitleBadge; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: "historian", label: "歴史の語り部", icon: "library-outline" },
  { id: "traveler", label: "国境の旅人", icon: "compass-outline" },
  { id: "collector", label: "物語の収集家", icon: "create-outline" },
];

type FormErrors = {
  name?: string;
  bio?: string;
  websiteUrl?: string;
  xId?: string;
  instagramId?: string;
};

const parseExtraProfile = (raw: string | null): ExtraProfile => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const row = parsed as ExtraProfile;
    const selectedTitleBadge =
      row.selectedTitleBadge === "historian" || row.selectedTitleBadge === "traveler" || row.selectedTitleBadge === "collector"
        ? row.selectedTitleBadge
        : undefined;

    return {
      websiteUrl: typeof row.websiteUrl === "string" ? row.websiteUrl : undefined,
      xId: typeof row.xId === "string" ? row.xId : undefined,
      instagramId: typeof row.instagramId === "string" ? row.instagramId : undefined,
      selectedTitleBadge,
    };
  } catch {
    return {};
  }
};

const validate = (params: {
  name: string;
  bio: string;
  websiteUrl: string;
  xId: string;
  instagramId: string;
}): FormErrors => {
  const errors: FormErrors = {};

  const trimmedName = params.name.trim();
  if (!trimmedName) {
    errors.name = "ユーザー名を入力してください";
  } else if (trimmedName.length > 50) {
    errors.name = "ユーザー名は50文字以内で入力してください";
  }

  if (params.bio.length > BIO_MAX) {
    errors.bio = `自己紹介は${BIO_MAX}文字以内で入力してください`;
  }

  const trimmedWebsite = params.websiteUrl.trim();
  if (trimmedWebsite.length > 0 && !/^https?:\/\//.test(trimmedWebsite)) {
    errors.websiteUrl = "URLは http:// または https:// から入力してください";
  }

  if (params.xId.trim().length > 40) {
    errors.xId = "X IDは40文字以内で入力してください";
  }

  if (params.instagramId.trim().length > 40) {
    errors.instagramId = "Instagram IDは40文字以内で入力してください";
  }

  return errors;
};

export const ProfileEditScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { userId } = useSessionUserId();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [profileImageUrl, setProfileImageUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [xId, setXId] = useState("");
  const [instagramId, setInstagramId] = useState("");
  const [selectedTitleBadge, setSelectedTitleBadge] = useState<TitleBadge>("historian");
  const [errors, setErrors] = useState<FormErrors>({});

  const loadProfile = useCallback(async () => {
    if (!userId || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [profile, rawExtra] = await Promise.all([fetchUserProfile(userId), AsyncStorage.getItem(EXTRA_PROFILE_KEY)]);
      const extra = parseExtraProfile(rawExtra);

      setName(profile?.name || "");
      setBio(profile?.bio || "");
      setProfileImageUrl(profile?.profile_picture_url || "");
      setWebsiteUrl(extra.websiteUrl || "");
      setXId(extra.xId || "");
      setInstagramId(extra.instagramId || "");
      setSelectedTitleBadge(extra.selectedTitleBadge || "historian");
      setErrors({});
    } catch (error) {
      console.error("ProfileEditScreen: failed to load", error);
      Alert.alert("プロフィールを読み込めません", "時間をおいて再度お試しください。");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void loadProfile();
    }, [loadProfile])
  );

  const canSave = useMemo(() => !saving && !loading, [saving, loading]);

  const handleSave = async () => {
    if (!userId) {
      navigation.navigate("Auth");
      return;
    }

    const validation = validate({
      name,
      bio,
      websiteUrl,
      xId,
      instagramId,
    });

    setErrors(validation);
    if (Object.keys(validation).length > 0) return;

    setSaving(true);
    try {
      await updateUserProfile(userId, {
        name: name.trim(),
        bio: bio.trim() || null,
        profile_picture_url: profileImageUrl.trim() || null,
      });

      await AsyncStorage.setItem(
        EXTRA_PROFILE_KEY,
        JSON.stringify({
          websiteUrl: websiteUrl.trim(),
          xId: xId.trim(),
          instagramId: instagramId.trim(),
          selectedTitleBadge,
        } satisfies ExtraProfile)
      );

      Alert.alert("保存しました", "プロフィールを更新しました。", [
        {
          text: "OK",
          onPress: () => navigation.goBack(),
        },
      ]);
    } catch (error) {
      console.error("ProfileEditScreen: failed to save", error);
      Alert.alert("保存に失敗しました", "時間をおいて再度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  if (!isSupabaseConfigured) {
    return (
      <View className="flex-1 bg-[#F8F7F6]">
        <SafeAreaView edges={["top"]} className="bg-[#F8F7F6]">
          <View className="h-14 px-4 border-b border-[#ECE6DF] flex-row items-center justify-between">
            <Pressable onPress={() => navigation.goBack()}>
              <Text className="text-sm text-[#6C5647]" style={{ fontFamily: fonts.bodyMedium }}>
                キャンセル
              </Text>
            </Pressable>
            <Text className="text-base text-[#1F2937]" style={{ fontFamily: fonts.displayBold }}>
              プロフィール編集
            </Text>
            <View className="w-16" />
          </View>
        </SafeAreaView>
        <View className="px-6 pt-8">
          <Text className="text-sm text-[#6C5647]" style={{ fontFamily: fonts.bodyRegular }}>
            Supabase設定が必要です。
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-[#F8F7F6]">
      <SafeAreaView edges={["top"]} className="bg-[#F8F7F6]">
        <View className="h-14 px-4 border-b border-[#EE8C2B]/10 flex-row items-center justify-between">
          <Pressable onPress={() => navigation.goBack()}>
            <Text className="text-sm text-slate-500" style={{ fontFamily: fonts.bodyMedium }}>
              キャンセル
            </Text>
          </Pressable>

          <Text className="text-base text-[#1F2937]" style={{ fontFamily: fonts.displayBold }}>
            プロフィール編集
          </Text>

          <Pressable disabled={!canSave} onPress={() => void handleSave()}>
            <Text className="text-sm text-[#EE8C2B]" style={{ fontFamily: fonts.displayBold, opacity: canSave ? 1 : 0.5 }}>
              保存
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#EE8C2B" />
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
          <ScrollView contentContainerStyle={{ paddingBottom: 156 }} keyboardShouldPersistTaps="handled">
            <View className="items-center py-8">
              <View className="relative">
                <ProfileAvatar name={name || "旅人"} imageUrl={profileImageUrl || null} size={112} />
                <Pressable
                  className="absolute bottom-0 right-0 w-8 h-8 rounded-full border-2 border-[#F8F7F6] bg-[#EE8C2B] items-center justify-center"
                  onPress={() => Alert.alert("プロフィール画像", "「プロフィール画像URL」に画像URLを入力して変更できます。")}
                >
                  <Ionicons name="pencil" size={14} color="#FFFFFF" />
                </Pressable>
              </View>
              <Text className="mt-3 text-sm text-[#EE8C2B]" style={{ fontFamily: fonts.bodyMedium }}>
                写真を変更
              </Text>
            </View>

            <View className="px-4 mb-8">
              <View className="flex-row items-center mb-4">
                <View className="w-1 h-5 rounded-full bg-[#EE8C2B] mr-2" />
                <Text className="text-lg text-[#111827]" style={{ fontFamily: fonts.displayBold }}>
                  基本情報
                </Text>
              </View>

              <View className="gap-4">
                <View>
                  <Text className="text-sm text-slate-600 mb-1.5" style={{ fontFamily: fonts.bodyMedium }}>
                    ユーザー名
                  </Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="名前を入力"
                    placeholderTextColor="#9CA3AF"
                    maxLength={50}
                    className="rounded-lg bg-white border border-slate-200 py-3 px-4 text-[#1F2937]"
                    style={{ fontFamily: fonts.bodyRegular }}
                  />
                  {errors.name ? (
                    <Text className="mt-1 text-xs text-[#D83A2E]" style={{ fontFamily: fonts.bodyRegular }}>
                      {errors.name}
                    </Text>
                  ) : null}
                </View>

                <View>
                  <Text className="text-sm text-slate-600 mb-1.5" style={{ fontFamily: fonts.bodyMedium }}>
                    自己紹介
                  </Text>
                  <TextInput
                    value={bio}
                    onChangeText={setBio}
                    placeholder="自己紹介文を入力してください"
                    placeholderTextColor="#9CA3AF"
                    maxLength={BIO_MAX}
                    multiline
                    textAlignVertical="top"
                    className="rounded-lg bg-white border border-slate-200 py-3 px-4 min-h-[110px] text-[#1F2937]"
                    style={{ fontFamily: fonts.bodyRegular }}
                  />
                  <Text className="mt-1 text-xs text-right text-slate-400" style={{ fontFamily: fonts.bodyRegular }}>
                    {bio.length} / {BIO_MAX}
                  </Text>
                  {errors.bio ? (
                    <Text className="mt-1 text-xs text-[#D83A2E]" style={{ fontFamily: fonts.bodyRegular }}>
                      {errors.bio}
                    </Text>
                  ) : null}
                </View>

                <View>
                  <Text className="text-sm text-slate-600 mb-1.5" style={{ fontFamily: fonts.bodyMedium }}>
                    プロフィール画像URL
                  </Text>
                  <TextInput
                    value={profileImageUrl}
                    onChangeText={setProfileImageUrl}
                    placeholder="https://..."
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="none"
                    className="rounded-lg bg-white border border-slate-200 py-3 px-4 text-[#1F2937]"
                    style={{ fontFamily: fonts.bodyRegular }}
                  />
                </View>
              </View>
            </View>

            <View className="px-4 mb-8">
              <View className="flex-row items-center mb-4">
                <View className="w-1 h-5 rounded-full bg-[#EE8C2B] mr-2" />
                <Text className="text-lg text-[#111827]" style={{ fontFamily: fonts.displayBold }}>
                  リンク・SNS
                </Text>
              </View>

              <View className="gap-3">
                <View>
                  <View className="rounded-lg bg-white border border-slate-200 py-3 px-3 flex-row items-center">
                    <Ionicons name="link-outline" size={16} color="#9CA3AF" />
                    <TextInput
                      value={websiteUrl}
                      onChangeText={setWebsiteUrl}
                      placeholder="https://example.com"
                      placeholderTextColor="#9CA3AF"
                      autoCapitalize="none"
                      keyboardType="url"
                      className="flex-1 ml-2 text-[#1F2937]"
                      style={{ fontFamily: fonts.bodyRegular }}
                    />
                  </View>
                  {errors.websiteUrl ? (
                    <Text className="mt-1 text-xs text-[#D83A2E]" style={{ fontFamily: fonts.bodyRegular }}>
                      {errors.websiteUrl}
                    </Text>
                  ) : null}
                </View>

                <View>
                  <View className="rounded-lg bg-white border border-slate-200 py-3 px-3 flex-row items-center">
                    <Ionicons name="at-outline" size={16} color="#9CA3AF" />
                    <TextInput
                      value={xId}
                      onChangeText={setXId}
                      placeholder="@username"
                      placeholderTextColor="#9CA3AF"
                      autoCapitalize="none"
                      className="flex-1 ml-2 text-[#1F2937]"
                      style={{ fontFamily: fonts.bodyRegular }}
                    />
                  </View>
                  {errors.xId ? (
                    <Text className="mt-1 text-xs text-[#D83A2E]" style={{ fontFamily: fonts.bodyRegular }}>
                      {errors.xId}
                    </Text>
                  ) : null}
                </View>

                <View>
                  <View className="rounded-lg bg-white border border-slate-200 py-3 px-3 flex-row items-center">
                    <Ionicons name="logo-instagram" size={16} color="#9CA3AF" />
                    <TextInput
                      value={instagramId}
                      onChangeText={setInstagramId}
                      placeholder="Instagram ID"
                      placeholderTextColor="#9CA3AF"
                      autoCapitalize="none"
                      className="flex-1 ml-2 text-[#1F2937]"
                      style={{ fontFamily: fonts.bodyRegular }}
                    />
                  </View>
                  {errors.instagramId ? (
                    <Text className="mt-1 text-xs text-[#D83A2E]" style={{ fontFamily: fonts.bodyRegular }}>
                      {errors.instagramId}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>

            <View className="px-4 mb-2">
              <View className="flex-row items-center justify-between mb-4">
                <View className="flex-row items-center">
                  <View className="w-1 h-5 rounded-full bg-[#EE8C2B] mr-2" />
                  <Text className="text-lg text-[#111827]" style={{ fontFamily: fonts.displayBold }}>
                    獲得称号
                  </Text>
                </View>
                <Text className="text-xs text-[#EE8C2B]" style={{ fontFamily: fonts.bodyMedium }}>
                  すべて見る
                </Text>
              </View>

              <Text className="text-xs text-slate-500 mb-3" style={{ fontFamily: fonts.bodyRegular }}>
                プロフィールに表示するメインの称号を選択してください。
              </Text>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
                {titleBadges.map((badge) => {
                  const checked = selectedTitleBadge === badge.id;
                  return (
                    <Pressable
                      key={badge.id}
                      onPress={() => setSelectedTitleBadge(badge.id)}
                      className={`w-32 h-24 rounded-xl border items-center justify-center ${
                        checked ? "border-[#EE8C2B] bg-[#EE8C2B]/5" : "border-slate-200 bg-white"
                      }`}
                    >
                      <Ionicons name={badge.icon} size={24} color={checked ? "#EE8C2B" : "#9CA3AF"} />
                      <Text
                        className={`text-xs mt-2 ${checked ? "text-[#EE8C2B]" : "text-slate-500"}`}
                        style={{ fontFamily: fonts.displayBold }}
                      >
                        {badge.label}
                      </Text>

                      {checked ? (
                        <View className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#EE8C2B] items-center justify-center">
                          <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </ScrollView>

          <SafeAreaView edges={["bottom"]} className="absolute left-0 right-0 bottom-0 bg-[#F8F7F6]/95 border-t border-slate-200">
            <View className="px-4 pt-4 pb-2">
              <Pressable
                onPress={() => {
                  void handleSave();
                }}
                disabled={!canSave}
                className="h-12 rounded-xl bg-[#EE8C2B] items-center justify-center flex-row gap-2"
                style={{
                  shadowColor: "#EE8C2B",
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.2,
                  shadowRadius: 9,
                  elevation: 2,
                  opacity: canSave ? 1 : 0.6,
                }}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="save-outline" size={16} color="#FFFFFF" />
                    <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                      保存する
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
};
