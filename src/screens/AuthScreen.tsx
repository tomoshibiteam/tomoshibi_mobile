import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/types";
import { fonts } from "@/theme/fonts";
import { getSupabaseOrThrow, isSupabaseConfigured } from "@/lib/supabase";
import { useSessionUserId } from "@/hooks/useSessionUser";

type Props = NativeStackScreenProps<RootStackParamList, "Auth">;

export const AuthScreen = ({ navigation }: Props) => {
  const { userId } = useSessionUserId();

  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (userId) {
      navigation.replace("MainTabs", { screen: "Profile" });
    }
  }, [navigation, userId]);

  const validate = () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("入力エラー", "メールアドレスとパスワードを入力してください。");
      return false;
    }
    if (password.length < 6) {
      Alert.alert("入力エラー", "パスワードは6文字以上で入力してください。");
      return false;
    }
    if (isSignUp && !name.trim()) {
      Alert.alert("入力エラー", "名前を入力してください。");
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!isSupabaseConfigured) {
      Alert.alert("設定が必要です", "Supabase設定が未完了です。");
      return;
    }
    if (!validate()) return;

    setLoading(true);
    try {
      const supabase = getSupabaseOrThrow();

      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              name: name.trim(),
            },
          },
        });

        if (error) {
          Alert.alert("登録エラー", error.message || "新規登録に失敗しました。");
          return;
        }

        Alert.alert("登録完了", "確認メールをご確認ください。");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        Alert.alert("ログインエラー", "メールアドレスまたはパスワードが正しくありません。");
        return;
      }

      navigation.replace("MainTabs", { screen: "Profile" });
    } catch (error) {
      console.error("AuthScreen: submit failed", error);
      Alert.alert("エラー", "通信に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-[#F8F7F6]">
      <View className="flex-1 justify-center px-4">
        <View className="rounded-2xl border border-[#EBDFCF] bg-white px-4 py-5">
          <Text className="text-lg text-[#221910]" style={{ fontFamily: fonts.displayBold }}>
            {isSignUp ? "新規登録" : "ログイン"}
          </Text>
          <Text className="text-sm text-[#6C5647] mt-1" style={{ fontFamily: fonts.bodyRegular }}>
            {isSignUp ? "アカウントを作成して冒険を始めましょう" : "アカウントにログインしてください"}
          </Text>

          <View className="mt-4 gap-3">
            {isSignUp && (
              <View>
                <Text className="text-xs text-[#6C5647] mb-1" style={{ fontFamily: fonts.bodyMedium }}>
                  名前
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="氏名"
                  placeholderTextColor="#A39A90"
                  className="h-11 rounded-xl border border-[#E5DDD3] bg-[#F1ECE6] px-3 text-sm text-[#221910]"
                  style={{ fontFamily: fonts.bodyRegular }}
                />
              </View>
            )}

            <View>
              <Text className="text-xs text-[#6C5647] mb-1" style={{ fontFamily: fonts.bodyMedium }}>
                メールアドレス
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="name@example.com"
                placeholderTextColor="#A39A90"
                className="h-11 rounded-xl border border-[#E5DDD3] bg-[#F1ECE6] px-3 text-sm text-[#221910]"
                style={{ fontFamily: fonts.bodyRegular }}
              />
            </View>

            <View>
              <Text className="text-xs text-[#6C5647] mb-1" style={{ fontFamily: fonts.bodyMedium }}>
                パスワード
              </Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                placeholder="••••••••"
                placeholderTextColor="#A39A90"
                className="h-11 rounded-xl border border-[#E5DDD3] bg-[#F1ECE6] px-3 text-sm text-[#221910]"
                style={{ fontFamily: fonts.bodyRegular }}
              />
            </View>
          </View>

          <Pressable
            className="h-11 rounded-xl bg-[#EE8C2B] items-center justify-center mt-4"
            onPress={() => {
              void handleSubmit();
            }}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                {isSignUp ? "登録する" : "ログイン"}
              </Text>
            )}
          </Pressable>

          <Pressable className="items-center mt-4" onPress={() => setIsSignUp((prev) => !prev)} disabled={loading}>
            <Text className="text-sm text-[#EE8C2B]" style={{ fontFamily: fonts.bodyMedium }}>
              {isSignUp ? "既にアカウントをお持ちですか？ログイン" : "アカウントをお持ちでない方は新規登録"}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
};
