# SERIES PIPELINE PHASE 1 INTERNAL MEMO

- 作成日: 2026-03-19
- ステータス: Phase 1 確定
- 対象: シリーズ生成〜エピソード生成〜画像生成の全体フロー再編（責務と境界のみ）
- 非対象: prompt本文、schema詳細、validator詳細、スコア閾値詳細

## 1. ステップ一覧（Phase 1 確定）

### Layer A: シリーズ設計フェーズ
1. `sanitize_series_request`
2. `derive_series_design_brief`
3. `generate_series_concept_candidates`（1 API call / 複数候補）
4. `select_and_refine_series_concept`
5. `design_season_architecture`
6. `generate_series_characters`
7. `build_series_identity_pack`
8. `design_episode_generation_constraints`（生成仕様のみ。concrete episodeは作らない）
9. `run_series_narrative_quality_gate`
10. `finalize_series_blueprint`（Layer A唯一の正本 artifact 作成）

### Layer B: エピソード具体化フェーズ
11. `generate_episode_pack_once`（1 API call / 3話一括）
12. `seed_route_dry_run`
13. `derive_visual_narrative_brief`（Step 10主体 + Step 12補助）
14. `generate_visual_bundle`
15. `run_final_quality_gate`（Step 9 の narrative gate summary を入力に含める）
16. `finalize_series_package`

## 2. Artifact 定義

### `SeriesBlueprintV2`（Layer A 正本）
- 役割: シリーズ設計の canonical artifact。
- 作成ステップ: Step 10 のみ。
- 含む:
  - 選定済み concept
  - season architecture（3話役割と進行設計）
  - fixed characters
  - identity pack
  - episode generation constraints（仕様）
  - continuity rules
  - narrative gate summary
- 含まない:
  - 3話の完成本文
  - 画像実体
  - 最終受入判定

### `SeriesPackageV2`（最終納品）
- 役割: UI表示・保存・配信の最終パッケージ。
- 作成ステップ: Step 16。
- 含む:
  - `SeriesBlueprintV2`
  - `EpisodePack`（3話一括生成結果）
  - `VisualBundle`（cover / portraits 等）
  - `FinalQualityGateReport`
  - metadata / lineage

## 3. Re-entry ルール（Phase 1）

### Step 9 `run_series_narrative_quality_gate`
- 失敗時:
  - concept妥当性不足: Step 4 へ戻す
  - 3話構造不足: Step 5 へ戻す
  - キャラ同一性不足: Step 6 or 7 へ戻す
  - 生成制約不足: Step 8 へ戻す

### Step 12 `seed_route_dry_run`
- 失敗時:
  - 導線成立性のみの問題: Step 11 へ戻す
  - エピソード制約定義不足/矛盾: Step 8 へ戻し、再度 Step 11
  - 3話構造レベルの設計不整合: Step 5 へ戻し、Step 8 → Step 11

### Step 15 `run_final_quality_gate`
- 失敗時:
  - narrative整合の毀損: Step 11 へ戻す（必要に応じて 8 / 5 へエスカレーション）
  - visual整合不足: Step 14 へ戻す

## 4. Deprecated Step 一覧（旧フローからの整理）

### Deprecated（置き換え）
- `generate_series_checkpoints_start`
- `generate_series_checkpoints_done`
  - 置換先: `design_season_architecture_*` + `design_episode_generation_constraints_*`

- `generate_series_cover_candidates_start`
- `generate_series_cover_candidates_done`
- `validate_cover_identity_start`
- `validate_cover_identity_done`
  - 置換先: `generate_visual_bundle_*` + `run_final_quality_gate_*`

### 意味を再定義（名称維持可）
- `finalize_series_blueprint_*`
  - 旧: blueprint統合 + 画像 + accept 混在
  - 新: Layer A 正本 `SeriesBlueprintV2` の確定専任
