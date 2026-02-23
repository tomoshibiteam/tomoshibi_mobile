# TOMOSHIBI Mobile (React Native)

既存のWeb版 (`/Users/wataru/tomoshibi`) を残したまま、React Native へ移行するための新規プロジェクトです。

## 技術構成
- Expo (React Native + TypeScript)
- React Navigation (Stack + Bottom Tabs)
- NativeWind (Tailwind記法)
- React Native Reanimated / Gesture Handler
- Supabase (`@supabase/supabase-js`)

## セットアップ
1. `.env` を用意
2. 必須環境変数を設定

```bash
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_MASTRA_BASE_URL=http://127.0.0.1:4111
```

3. 起動

```bash
npm install
npm start
```

`npm start` は `Expo` と `Mastra` を同時に起動します。

## Mastra (tomoshibi_mobile内)

シリーズ作成AIは以下に配置しています。

- `/Users/wataru/tomoshibi_mobile/mastra`

起動手順:

```bash
cd /Users/wataru/tomoshibi_mobile/mastra
npm install
npm run dev
```

モバイル側 `.env`:

```bash
EXPO_PUBLIC_MASTRA_BASE_URL=http://127.0.0.1:4111
```

## Firebase App Distribution

Expo管理プロジェクトのため、以下の2段階で配布します。

1. EAS Buildで配布用バイナリを作成（APK/IPA）
2. Firebase App Distributionへアップロード

### 1) 初回セットアップ

```bash
# Firebase CLIログイン（ローカル）
npx firebase-tools login

# Expo / EASログイン
npx eas-cli login

# ローカル .env を EAS (production) へ同期
npm run eas:env:push:production
```

`.env` に Firebase配布用の値を設定してください（`.env.example` 参照）。

```bash
FIREBASE_APP_ID_ANDROID=1:1234567890:android:abc123def456
FIREBASE_APP_ID_IOS=1:1234567890:ios:abc123def456
FIREBASE_TESTERS=foo@example.com,bar@example.com
FIREBASE_GROUPS=founders,qa
FIREBASE_PROJECT_ID=your-firebase-project-id
```

初回EAS Build前に、`app.json` の `expo.ios.bundleIdentifier` と `expo.android.package` も設定してください（未設定だとビルド時に止まることがあります）。

### 2) バイナリ作成（EAS）

Android APK:

```bash
npm run eas:build:android:firebase
```

iOS IPA:

```bash
npm run eas:build:ios:firebase
```

`eas.json` の `firebase` プロファイルを使用します。

### 3) Firebaseへ配布

Android:

```bash
npm run firebase:distribute:android -- --file /absolute/path/to/app.apk
```

iOS:

```bash
npm run firebase:distribute:ios -- --file /absolute/path/to/app.ipa
```

補足:
- `--groups founders` / `--testers a@x.com,b@y.com` で都度上書きできます。
- リリースノートは `--release-notes "..."` または `--release-notes-file ./notes.txt` が使えます。
- ヘルプ: `npm run firebase:distribute:help`

## 主な画面
- ホーム（実データ表示）: `src/screens/HomeScreen.tsx`
- 検索画面: `src/screens/SearchScreen.tsx`
- 他ユーザープロフィール: `src/screens/UserProfileScreen.tsx`
- シリーズ詳細: `src/screens/SeriesDetailScreen.tsx`
- フォロワー/フォロー中一覧: `src/screens/UserConnectionsScreen.tsx`
- ログイン画面: `src/screens/AuthScreen.tsx`
- 作成タブ: `src/screens/CreateScreen.tsx`
- 新規シリーズ: `src/screens/CreateSeriesScreen.tsx`
- エピソード追加: `src/screens/AddEpisodeScreen.tsx`
- プロフィール編集: `src/screens/ProfileEditScreen.tsx`
- 設定: `src/screens/SettingsScreen.tsx`
- 通知（実データ表示）: `src/screens/NotificationsScreen.tsx`

## ディレクトリ構成

```text
src/
  components/
    common/
    social/
  hooks/
  lib/
  navigation/
  screens/
  services/
  styles/
  theme/
  types/
```

## 既存Web版との関係
- Web版は変更していません。
- まずは検索 -> 他プロフィール -> フォロー一覧 の導線をRNで再構築し、同等UI/UXの移行を開始できる状態です。
- 中央作成ボタン付きのメインタブUIも実装済みです。
- ホーム/通知のデータ取得、プロフィール編集、ログアウト導線まで実装済みです。
- 他ユーザープロフィールは称号・タブ・シリーズカード表示まで拡張済みです。
- `CreateSeries` は Supabase `quests` へ下書き保存接続済みです。
- `AddEpisode` は `quest_episodes`（未作成環境では `quest_posts`）へ保存接続済みです。
- `AddEpisode` では自分のシリーズ候補サジェストから追加先を選択できます。
- `SeriesDetail` ではエピソード一覧の表示に加えて、作成者は編集・削除が可能です。
- `SeriesDetail` の右上 `+` から対象シリーズを引き継いでエピソード追加できます。
- 権限不足で検索/フォロー一覧が欠ける場合は `supabase/sql/20260222_social_visibility.sql` を実行してください。
- `quest_episodes` を正式利用する場合は `supabase/sql/20260222_add_quest_episodes.sql` を実行してください。
- Mastra連携でシリーズ骨格を保存する場合は `supabase/sql/20260223_series_blueprints.sql` を実行してください。
