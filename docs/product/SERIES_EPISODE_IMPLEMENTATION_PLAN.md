# シリーズ/エピソード実装計画アップデート（2026-03-11）

## 0. 目的と前提
- 目的: `灯火（TOMOSHIBI）共通認識` に沿って、シリーズ/エピソード体験を「継続愛着」と「行動変容」を生む構造へ実装面で寄せる。
- 対象: シリーズ生成、エピソード生成、継続状態管理、プレイ導線、計測、将来B2B制御。
- 非対象: クリエイター向け高度編集UI、広告管理画面の完成実装。

参照基準:
- `docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md`
- `docs/business/COMMON_UNDERSTANDING_OPERATIONS.md`

---

## 1. 現在実装（As-Is）

### 1-1. シリーズ生成
- モバイル: `CreateSeriesScreen -> generateSeriesDraftViaMastra`
- API: `POST /api/series/jobs`（ジョブポーリング）
- Mastra: `series-workflow-v6-style-lock`
  - concept -> characters -> identity_pack -> checkpoints/first_episode_seed -> consistency -> cover
- 永続化: `saveSeriesBlueprint` が `series_bibles / series_characters / series_episode_blueprints` に保存

### 1-2. エピソード生成
- モバイル: `AddEpisodeScreen -> fetchSeriesEpisodeRuntimeContext -> generateSeriesEpisodeViaMastra`
- API: `POST /api/series/episode/jobs`
- Mastra: `seriesRuntimeEpisodeAgent`
  - plan -> chapter/puzzle -> assemble
- 保存: `EpisodeGenerationResultScreen`
  - `createEpisodeForSeries`（`quest_episodes`優先）
  - `saveRuntimeEpisodeSpots`（`spots/spot_details/spot_story_messages`）
  - `applySeriesProgressPatch`（`series_bibles.progress_state`更新）

### 1-3. プレイ導線
- `fetchGameplayQuest` は `spots` 系を優先し、不足時は `quest_episodes` 本文からフォールバック復元。
- `GamePlayScreen` はプレイ完了時に `play_sessions` を記録。

### 1-4. できていること
- シリーズ固定キャラの保存/再利用、進行状態JSONの更新、エピソード連番化。
- 5〜7スポット前提や徒歩制約をプロンプトで保持。
- ジョブ進捗イベントをUIに返せる。

### 1-5. 主要な不足
- 無料3話完結など話数プラン制御が未実装。
- 進行更新が「LLM出力patch依存」で、矛盾検出の自動検証が弱い。
- スポット選定が物語先行（地点候補最適化アルゴリズムが未導入）。
- 「愛着・継続」の計測イベントが不足（現状は `play_sessions` 中心）。
- 共有シリーズ×ユーザー固有エピソードの分析基盤が未整備。
- B2B訴求の表示制御/強度制御が未実装。

---

## 2. As-Is -> To-Be 変更マップ

| 領域 | As-Is | To-Be |
|---|---|---|
| シリーズ進行 | `progress_state` を都度patch | イベントソーシング + 決定的 reducer で更新 |
| 話数設計 | 事実上無制限 | 無料3話（導入/展開/収束）+ 有料延長を明示制御 |
| スポット選定 | LLMが地点名を直接生成 | Plannerは役割仕様のみ生成 -> 候補収集/適格性フィルタ/MMR/ルート最適化で実地点確定 |
| キャラクター構成 | 固定キャラが同列 | `primary/secondary` 階層 + `must_appear` で登場密度を制御 |
| 継続整合 | ルール/プロンプト中心 | 自動整合チェック（矛盾検出 + スコア閾値） |
| キャラ愛着計測 | 明示計測ほぼなし | キャラ別反応・再訪・次話遷移をイベント化 |
| 関係性状態 | `companion_trust_level` 単一軸 | `relationship_state_summary/flags/recent_relation_shift` を真の状態にし、trustは派生値化 |
| 現地成立性 | 文章構造中心の判定 | 現実適格性ゲート（公共アクセス/徒歩導線/移動負荷/地域性）を追加 |
| 共有と固有 | シリーズ単位保存のみ | 共通シリーズID + ユーザー分岐履歴を分離保存 |
| 実験基盤 | 単純比較 | CUPED + オフポリシー評価で高速改善 |
| B2B制御 | 未実装 | 訴求ON/OFF、強度、挿入位置をポリシー化 |

---

## 3. 技術アーキテクチャ更新案

### 3-1. データモデル（Supabase）
新規追加（案）:
1. `series_state_events`
- `id, quest_id, user_id, episode_no, event_type, payload_json, created_at`
- 目的: 進行状態を「差分イベント」で監査可能にする。

2. `series_runtime_snapshots`
- `quest_id, user_id, episode_no, unresolved_threads, revealed_facts, relationship_flags, relationship_summary, next_hook, updated_at`
- 目的: 再生成時の安定参照点を作る。

3. `episode_generation_traces`
- `id, quest_id, user_id, episode_no, stage_location, candidate_spots_json, selected_spots_json, route_score, continuity_score, eligibility_reject_reasons_json, created_at`
- 目的: 生成品質の追跡。

4. `user_series_affinity`
- `user_id, quest_id, worldview_affinity, character_affinity_json, revisit_intent_score, updated_at`
- 目的: 愛着推定の基礎指標。

5. `engagement_events`
- `user_id, quest_id, episode_no, event_name, value_json, occurred_at`
- 例: `episode_start`, `episode_complete`, `next_episode_click`, `character_reaction_open`

6. `sponsorship_policies`（将来B2B）
- `quest_id, policy_mode, intensity, allowed_surfaces, is_opt_out_allowed`

7. `series_characters` 拡張
- 追加列: `tier (primary|secondary)`, `must_appear boolean`
- 目的: 初期体験での愛着分散を防ぎ、主要キャラ露出を担保する。

### 3-2. API/ワークフロー更新
- `seriesRuntimeEpisodeAgent` を責務分離:
  1. `planner`（`spot_role/scene_role/required_attributes/visit_constraints/tourism_value_type` を出す）
  2. `candidate_spot_retrieval`（地理候補）
  3. `eligibility_filter`（公共アクセス/徒歩導線/移動負荷/地域性）
  4. `mmr_rerank`
  5. `route_optimizer`（時間/移動制約下で選択）
  6. `narrative_builder`（確定スポットを物語化）
- `applySeriesProgressPatch` は reducer 化し、LLM patch をそのまま採用せず検証後に反映。
- `fetchSeriesEpisodeRuntimeContext` は `recent_episodes` に加え、`series_state_events` 要約を返す。

### 3-3. クライアント更新
- `AddEpisodeScreen`: 生成前に `episode_budget`（無料残話数/プラン）を表示。
- `EpisodeGenerationResultScreen`: 保存時に trace + engagement event を記録。
- `SeriesDetailScreen`: タグ由来ではなく `series_characters` を一次表示。
- `GamePlayScreen`: 話間遷移イベントとキャラ選好イベントを追加送信。
- 主要キャラ（primary）の会話露出をUI上でも担保し、secondaryは補助露出に制限。

---

## 4. 採用アルゴリズム（リサーチ反映）

### 4-1. 候補検索・記憶参照
1. `RAG`（Retrieval-Augmented Generation）
- 用途: 過去エピソード/進行状態を参照して連続性を担保。
- 実装: `recent_episodes + state_events` の要約検索を前段に置く。
- 参考: [RAG paper](https://arxiv.org/abs/2005.11401)

2. `Sentence-BERT` + `pgvector(HNSW)`
- 用途: 過去描写・キャラ台詞・伏線の近傍検索を高速化。
- 実装: 埋め込みを `pgvector` に保存し、`hnsw` インデックス運用。
- 参考: [Sentence-BERT](https://arxiv.org/abs/1908.10084), [pgvector docs](https://github.com/pgvector/pgvector), [HNSW](https://arxiv.org/abs/1603.09320)

3. `MMR`（Maximal Marginal Relevance）
- 用途: 「関連性」と「重複回避」を同時最適化（スポット選定・記憶抽出）。
- 実装: `score = λ*relevance - (1-λ)*redundancy` で再ランク。
- 参考: [MMR original paper](https://www.cs.cmu.edu/~jgc/publication/The_Use_MMR_Diversity_Based_LTMIR_1998.pdf)

### 4-2. ルート最適化
4. `VRPTW/Orienteering近似`
- 用途: 制限時間内で「巡る価値最大」の5〜7スポットを選択。
- 実装: OR-Toolsの時間窓制約を使い、総移動時間と導線自然さを同時最適化。
- 参考: [OR-Tools VRPTW](https://developers.google.com/optimization/routing/vrptw)

### 4-3. 継続率最適化・推薦
5. `LinUCB`（初期運用）
- 用途: ユーザー文脈ごとに次話導線（感情トーン/難易度/ミッションタイプ）を最適化。
- 実装: 腕（導線テンプレ）を文脈特徴で選択、報酬は `next_episode_start`。
- 参考: [LinUCB/Contextual Bandit](https://arxiv.org/abs/1003.0146)

6. `Thompson Sampling`（探索強化）
- 用途: サンプルが増えた後に探索と収益性の両立を強化。
- 実装: 主要導線のサンプリング選択へ段階的移行。
- 参考: [Thompson Sampling for Linear Contextual Bandits](https://proceedings.mlr.press/v28/agrawal13.html)

7. `Doubly Robust OPE`
- 用途: 本番全量実験前に、ログデータで方策比較を安全に実施。
- 実装: propensity付きログを必須化してDR推定。
- 参考: [Doubly Robust Policy Evaluation](https://arxiv.org/abs/1103.4601)

### 4-4. 評価・実験設計
8. `BERTScore`（文章一貫性の補助指標）
- 用途: エピソード間の要約整合・語彙ドリフト監視。
- 実装: 前話要約との意味近傍スコアを品質ゲートに利用。
- 参考: [BERTScore](https://openreview.net/forum?id=SkeHuCVFDr)

9. `CUPED`
- 用途: A/Bの感度向上（継続率や完了率の差を短期間で判定）。
- 実装: pre-period指標を共変量にして分散削減。
- 参考: [CUPED paper](https://exp-platform.com/Documents/2013-02-CUPED-ImprovingSensitivityOfControlledExperiments.pdf)

---

## 5. フェーズ別実装計画

### Phase 0（1週間）: 計測基盤の先行整備
- `engagement_events`, `episode_generation_traces` を追加。
- クライアントで最低イベント送信（開始/完了/次話遷移）。
- DoD: DWHでシリーズ別継続率が日次で見える。

### Phase 1（1〜2週間）: 継続状態の決定的更新
- `series_state_events` + `series_runtime_snapshots` 導入。
- `applySeriesProgressPatch` を reducer 化（矛盾時はreject+再生成）。
- DoD: 同一入力で状態更新結果が再現可能。

### Phase 2（2週間）: スポット選定をアルゴリズム化
- Plannerを「役割仕様出力」に変更（具体スポット名を出さない）。
- 候補収集 + 適格性フィルタ + MMR + VRPTW近似で最終スポット選定。
- LLMは「選ばれたスポット」を前提に章生成。
- DoD: ルート破綻率（遠すぎ/逆戻り）が現状比50%減。

### Phase 2.5（1週間）: キャラクター階層化
- `series_characters` に `tier/must_appear` を追加。
- 主要固定キャラ1〜2人を必須、secondaryは最大2〜3人に制約。
- DoD: 各話でprimaryキャラ露出が最低閾値を満たす。

### Phase 3（2週間）: 無料3話構造と延長設計
- シリーズに `plan_type(free/pro)` と `max_episode_no` を追加。
- 3話テンプレ（導入/展開/収束）を `checkpoints` に固定。
- 有料延長時は新シーズンgoal追加で再開。
- DoD: 無料3話で必ず収束し、4話目生成は課金状態連動。

### Phase 4（2〜3週間）: パーソナライズ最適化
- LinUCB導入（導線テンプレ選択）。
- propensityログを保存しDRでオフライン評価。
- 一定データ後にThompson Samplingを部分導入。
- DoD: D7再訪率の改善が統計的に検出可能。

### Phase 5（将来）: B2B訴求制御
- `sponsorship_policies` と表示面制御を導入。
- ユーザー側の訴求ON/OFF・強度選択を提供。
- DoD: 没入感指標悪化なしで訴求到達率を計測可能。

---

## 6. 変更対象ファイル（初期実装の主対象）

サーバ/生成:
- `mastra/src/lib/agents/seriesRuntimeEpisodeAgent.ts`
- `mastra/src/workflows/series-workflow.ts`
- `mastra/src/server.ts`
- `mastra/src/lib/geo.ts`（再利用/拡張）

モバイル:
- `src/screens/AddEpisodeScreen.tsx`
- `src/screens/EpisodeGenerationResultScreen.tsx`
- `src/screens/SeriesDetailScreen.tsx`
- `src/screens/GamePlayScreen.tsx`

データアクセス:
- `src/services/quests.ts`
- `src/services/seriesAi.ts`
- `supabase/sql/*.sql`（新規migration追加）

---

## 7. 最初の実装順（推奨）
1. Phase 0 + Phase 1（計測と状態管理）を先に固定
2. その上で Phase 2（スポット最適化）を入れる
3. 次に Phase 3（無料3話制御）で事業仮説を実装
4. 最後に Phase 4（バンディット最適化）で改善速度を上げる

この順にする理由:
- 計測なしでは最適化しても改善判定ができない
- 状態管理が不安定なまま最適化を入れると再現性が崩れる
- 収益仮説（3話完結/延長）を早めに検証できる
