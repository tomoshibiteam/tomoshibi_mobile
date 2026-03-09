import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FontAwesome } from "@expo/vector-icons";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as AuthSession from "expo-auth-session";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import type { RootStackParamList } from "@/navigation/types";
import { fonts } from "@/theme/fonts";
import { getSupabaseOrThrow, isSupabaseConfigured } from "@/lib/supabase";
import { useSessionUserId } from "@/hooks/useSessionUser";

WebBrowser.maybeCompleteAuthSession();

type Props = NativeStackScreenProps<RootStackParamList, "Auth">;

const GOOGLE_REDIRECT_SCHEME = "com.tomoshibi.mobile";
const GOOGLE_REDIRECT_PATH = "auth/callback";
const trimEnv = (value: string | undefined) => value?.trim() ?? "";
const GOOGLE_OAUTH_CLIENT_ID = trimEnv(process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID);
const GOOGLE_OAUTH_WEB_CLIENT_ID = trimEnv(process.env.EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID);
const GOOGLE_OAUTH_IOS_CLIENT_ID = trimEnv(process.env.EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID);
const GOOGLE_OAUTH_ANDROID_CLIENT_ID = trimEnv(process.env.EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID);

type GoogleSignInAttemptResult =
  | { status: "success" }
  | { status: "cancelled" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

const parseOAuthSessionUrl = (url: string) => {
  const [baseWithQuery, hash = ""] = url.split("#");
  const query = baseWithQuery.includes("?") ? baseWithQuery.split("?")[1] ?? "" : "";
  const mergedParams = new URLSearchParams(query);

  const hashParams = new URLSearchParams(hash);
  hashParams.forEach((value, key) => {
    mergedParams.set(key, value);
  });

  return {
    code: mergedParams.get("code"),
    accessToken: mergedParams.get("access_token"),
    refreshToken: mergedParams.get("refresh_token"),
    errorDescription: mergedParams.get("error_description") ?? mergedParams.get("error"),
  };
};

export const AuthScreen = ({ navigation }: Props) => {
  const { userId } = useSessionUserId();

  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loadingMode, setLoadingMode] = useState<"email" | "google" | null>(null);
  const loading = loadingMode !== null;
  const appScheme = typeof Constants.expoConfig?.scheme === "string" ? Constants.expoConfig.scheme : GOOGLE_REDIRECT_SCHEME;
  const isNativeBuild =
    Constants.executionEnvironment === ExecutionEnvironment.Bare ||
    Constants.executionEnvironment === ExecutionEnvironment.Standalone;
  const canUseDirectGoogleOAuth = Platform.OS === "web" || isNativeBuild;
  const hasGoogleConsoleOAuthClientId =
    Platform.OS === "ios"
      ? Boolean(GOOGLE_OAUTH_IOS_CLIENT_ID || GOOGLE_OAUTH_CLIENT_ID)
      : Platform.OS === "android"
        ? Boolean(GOOGLE_OAUTH_ANDROID_CLIENT_ID || GOOGLE_OAUTH_CLIENT_ID)
        : Boolean(GOOGLE_OAUTH_WEB_CLIENT_ID || GOOGLE_OAUTH_CLIENT_ID);
  const isGoogleConsoleOAuthConfigured = canUseDirectGoogleOAuth && hasGoogleConsoleOAuthClientId;
  const [googleAuthRequest, , promptGoogleAuth] = Google.useIdTokenAuthRequest(
    {
      clientId: GOOGLE_OAUTH_CLIENT_ID,
      webClientId: GOOGLE_OAUTH_WEB_CLIENT_ID || GOOGLE_OAUTH_CLIENT_ID,
      iosClientId: GOOGLE_OAUTH_IOS_CLIENT_ID || GOOGLE_OAUTH_CLIENT_ID,
      androidClientId: GOOGLE_OAUTH_ANDROID_CLIENT_ID || GOOGLE_OAUTH_CLIENT_ID,
      selectAccount: true,
      scopes: ["openid", "profile", "email"],
    },
    {
      native: `${appScheme}:/oauthredirect`,
    }
  );

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

    setLoadingMode("email");
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
      setLoadingMode(null);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!isSupabaseConfigured) {
      Alert.alert("設定が必要です", "Supabase設定が未完了です。");
      return;
    }

    setLoadingMode("google");
    try {
      const supabase = getSupabaseOrThrow();
      const tryGoogleConsoleOAuth = async (): Promise<GoogleSignInAttemptResult> => {
        if (!canUseDirectGoogleOAuth) {
          return {
            status: "skipped",
            reason: "Expo Go環境ではGoogle Consoleの直接OAuthを利用できないため、フォールバックに切り替えます。",
          };
        }
        if (!isGoogleConsoleOAuthConfigured) {
          return { status: "skipped", reason: "Google Console OAuthのクライアントIDが未設定です。" };
        }
        if (!googleAuthRequest) {
          return { status: "failed", reason: "Google認証の準備が完了していません。再度お試しください。" };
        }

        const authResult = await promptGoogleAuth();
        if (authResult.type === "cancel" || authResult.type === "dismiss") {
          return { status: "cancelled" };
        }
        if (authResult.type !== "success") {
          const params = "params" in authResult ? authResult.params : {};
          const authErrorMessage =
            "error" in authResult && authResult.error?.message ? authResult.error.message : undefined;
          const errorMessage =
            params.error_description ??
            params.error ??
            authErrorMessage ??
            "Google認証が完了しませんでした。";
          return { status: "failed", reason: errorMessage };
        }

        const idToken = authResult.params.id_token || authResult.authentication?.idToken;
        const accessToken = authResult.params.access_token || authResult.authentication?.accessToken;
        if (!idToken) {
          return { status: "failed", reason: "GoogleのIDトークンを取得できませんでした。" };
        }

        const { error } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: idToken,
          access_token: accessToken,
          nonce: googleAuthRequest.nonce,
        });

        if (error) {
          return { status: "failed", reason: error.message || "IDトークンでのログインに失敗しました。" };
        }

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !sessionData.session) {
          return {
            status: "failed",
            reason: sessionError?.message || "Googleログイン後のセッション取得に失敗しました。",
          };
        }

        return { status: "success" };
      };

      const trySupabaseOAuthFallback = async (): Promise<GoogleSignInAttemptResult> => {
        const redirectTo =
          Platform.OS === "web"
            ? AuthSession.makeRedirectUri({ path: GOOGLE_REDIRECT_PATH })
            : AuthSession.makeRedirectUri({ scheme: appScheme, path: GOOGLE_REDIRECT_PATH });
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo,
            skipBrowserRedirect: Platform.OS !== "web",
          },
        });

        if (error) {
          return { status: "failed", reason: error.message || "Supabase OAuthログインに失敗しました。" };
        }
        if (Platform.OS === "web") {
          const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) {
            return { status: "failed", reason: sessionError.message || "Webセッションの取得に失敗しました。" };
          }
          if (!sessionData.session) {
            return {
              status: "failed",
              reason: "Google認証後のセッションが見つかりません。OAuthリダイレクト設定をご確認ください。",
            };
          }
          return { status: "success" };
        }
        if (!data.url) {
          return { status: "failed", reason: "認証URLの生成に失敗しました。" };
        }

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type === "cancel" || result.type === "dismiss") {
          return { status: "cancelled" };
        }
        if (result.type !== "success") {
          return { status: "failed", reason: "認証が完了しませんでした。" };
        }

        const { code, accessToken, refreshToken, errorDescription } = parseOAuthSessionUrl(result.url);
        if (errorDescription) {
          return { status: "failed", reason: errorDescription };
        }

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            return { status: "failed", reason: exchangeError.message || "認証コード交換に失敗しました。" };
          }
        } else if (accessToken && refreshToken) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (setSessionError) {
            return { status: "failed", reason: setSessionError.message || "セッションの作成に失敗しました。" };
          }
        } else {
          return { status: "failed", reason: "認証コードまたはトークンを取得できませんでした。" };
        }

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !sessionData.session) {
          return {
            status: "failed",
            reason: sessionError?.message || "Googleログイン後のセッション取得に失敗しました。",
          };
        }

        return { status: "success" };
      };

      const fallbackResult = await trySupabaseOAuthFallback();
      if (fallbackResult.status === "success") {
        navigation.replace("MainTabs", { screen: "Profile" });
        return;
      }
      if (fallbackResult.status === "cancelled") {
        return;
      }

      const googleConsoleResult = await tryGoogleConsoleOAuth();
      if (googleConsoleResult.status === "success") {
        navigation.replace("MainTabs", { screen: "Profile" });
        return;
      }
      if (googleConsoleResult.status === "cancelled") {
        return;
      }

      const reasons: string[] = [];
      reasons.push(`Supabase OAuth: ${fallbackResult.reason}`);
      if (googleConsoleResult.status !== "skipped") {
        reasons.push(`Google Console OAuth fallback: ${googleConsoleResult.reason}`);
      }
      Alert.alert("Googleログインエラー", reasons.join("\n"));
    } catch (error) {
      console.error("AuthScreen: google sign in failed", error);
      Alert.alert("エラー", "通信に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setLoadingMode(null);
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
            {loadingMode === "email" ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
                {isSignUp ? "登録する" : "ログイン"}
              </Text>
            )}
          </Pressable>

          <View className="mt-4 flex-row items-center">
            <View className="h-px flex-1 bg-[#E5DDD3]" />
            <Text className="mx-3 text-xs text-[#8B7C70]" style={{ fontFamily: fonts.bodyRegular }}>
              または
            </Text>
            <View className="h-px flex-1 bg-[#E5DDD3]" />
          </View>

          <Pressable
            className="h-11 rounded-xl border border-[#E5DDD3] bg-white items-center justify-center mt-4 flex-row"
            onPress={() => {
              void handleGoogleSignIn();
            }}
            disabled={loading}
          >
            {loadingMode === "google" ? (
              <ActivityIndicator color="#221910" />
            ) : (
              <>
                <FontAwesome name="google" size={16} color="#221910" />
                <Text className="text-sm text-[#221910] ml-2" style={{ fontFamily: fonts.bodyMedium }}>
                  Googleでログイン
                </Text>
              </>
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
