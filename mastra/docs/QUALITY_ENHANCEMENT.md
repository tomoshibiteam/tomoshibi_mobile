# クエスト品質向上システム v2

## 概要

このシステムは、AIによるクエスト生成の品質を大幅に向上させるために設計されました。
SCRAPのリアル脱出ゲームや謎解き街歩きをベンチマークとし、プレイヤーが没入できる高品質な体験を生成します。

## 新機能

### 1. 強化版プロンプトビルダー (`/lib/prompt/questPromptBuilder.ts`)

- **ペルソナ設計**: プレイヤーの目的、同行者、時間帯を考慮
- **NPCプロファイル**: 4人のNPCに専門性と個性を付与
- **ストーリービブル**: 起承転結の構造に基づくストーリー設計
- **謎設計ガイドライン**: 自己完結型、観光情報連動型の謎

### 2. NPCパターンライブラリ (`/lib/prompt/npcPatterns.ts`)

- 4人のNPCそれぞれに専門分野を割り当て
- 発言フェーズ（intro, observation, connection, puzzle_hint等）別のテンプレート
- 文脈変数の埋め込みによる動的セリフ生成

### 3. ストーリービブル (`/lib/prompt/storyBible.ts`)

- 起承転結に基づいた物語構造の設計
- 各スポットの役割（narrativePurpose, emotionalBeat）の定義
- スポット間の因果関係の設計

### 4. 謎デザインヘルパー (`/lib/prompt/puzzleDesign.ts`)

- 4種類の謎パターン（discovery, connection, synthesis, conclusion）
- 観光情報からのキーワード抽出
- 自己完結型の謎テキスト生成
- 現地観察不要・計算不要の制約チェック

### 5. 体験品質ルール (`/lib/validation/qualityRules.ts`)

- 6つの品質指標:
  - `dialogueSpecificity`: 会話の具体性
  - `storyProgression`: ストーリー進行
  - `puzzleLearning`: 謎解きからの学び
  - `characterVoice`: キャラクターの個性
  - `playerEngagement`: プレイヤーエンゲージメント
  - `tourismIntegration`: 観光情報の統合度
- 総合スコアと改善提案の出力

### 6. 会話品質向上 (`/lib/repair/dialogueEnhancer.ts`)

- NPCパターンに基づく文脈に即した会話の強化
- スポット名・観光情報の言及確保
- プレイヤー名の呼びかけ確保
- NPC自己紹介の自動追加

### 7. 謎品質向上 (`/lib/repair/puzzleRefiner.ts`)

- 現地観察用語の自動除去
- 計算用語の自動除去
- 因果マーカーの自動追加
- 観光情報との関連付け強化

## 環境変数

```bash
# V2プロンプト機能を有効にする
MASTRA_USE_V2_PROMPT=true
```

## ワークフローの変更点

`generate-quest` ステップで以下が追加されました：

1. 環境変数 `MASTRA_USE_V2_PROMPT` が `true` の場合、強化版プロンプトを使用
2. 生成後に謎の品質向上処理を実行
3. 生成後に会話の品質向上処理を実行
4. NPC自己紹介の確保
5. 品質スコアのログ出力

## ディレクトリ構造

```
mastra/src/lib/
├── prompt/
│   ├── index.ts                 # エントリポイント
│   ├── questPromptBuilder.ts    # 強化版プロンプトビルダー
│   ├── storyBible.ts            # ストーリー設計ヘルパー
│   ├── npcPatterns.ts           # NPC会話パターン
│   └── puzzleDesign.ts          # 謎デザインヘルパー
├── validation/
│   ├── index.ts                 # エントリポイント
│   └── qualityRules.ts          # 体験品質ルール
└── repair/
    ├── index.ts                 # エントリポイント
    ├── dialogueEnhancer.ts      # 会話品質向上
    └── puzzleRefiner.ts         # 謎品質向上
```

## 使用方法

### V1プロンプト（従来版）を使用する場合

```bash
MASTRA_USE_V2_PROMPT=false
```

### V2プロンプト（強化版）を使用する場合

```bash
MASTRA_USE_V2_PROMPT=true
```

## 品質スコアの読み方

ログに出力される品質スコアの例：

```
[Quality] Overall Score: 75
[Quality] Breakdown: {
  "dialogueSpecificity": 80,
  "storyProgression": 70,
  "puzzleLearning": 75,
  "characterVoice": 85,
  "playerEngagement": 65,
  "tourismIntegration": 75
}
[Quality] Suggestions:
  - プレイヤーへの呼びかけや励ましを各スポットで入れてください
```

- **Overall Score**: 総合スコア（100点満点）
- **Breakdown**: 各品質指標のスコア
- **Suggestions**: 改善のための具体的な提案

## 今後の改善予定

1. スポット選定のテーマベース強化
2. 多様性最適化（カテゴリの偏り防止）
3. プレイヤーフィードバックに基づく品質チューニング
