# 意思決定ログ（Decision Log）

## 使い方
- 重要な意思決定を時系列で追記する（上に新しいものを追加）
- 各項目は「決定内容」「理由」「影響範囲」を最小セットで記載する
- 基準文書本文を更新した場合は、対象セクションを明記する

## テンプレート

```md
### [DEC-YYYYMMDD-XXX] タイトル
- 日付: YYYY-MM-DD
- ステータス: 決定 / 取り消し / 更新
- 決定内容:
- 理由:
- 影響範囲:
- 関連仮説:
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md（該当セクション）
  - docs/business/COMMON_UNDERSTANDING_OPERATIONS.md（必要時）
```

## ログ

### [DEC-20260311-004] Planner責務分離・キャラ階層化・関係性状態・現実適格性ゲートを反映
- 日付: 2026-03-11
- ステータス: 決定
- 決定内容: シリーズ/エピソード生成仕様を改訂し、(1) Plannerはスポット役割仕様のみ生成、(2) 固定キャラを `primary/secondary` + `must_appear` で管理、(3) progressを `relationship_state_summary/flags/recent_relation_shift` 中心に変更、(4) 現実適格性ゲート（公共アクセス・徒歩導線・移動負荷・地域性）を追加した。
- 理由: 物語構造の成立と現地成立性を分離し、後段の検索/最適化設計と一貫させるため。
- 影響範囲: Mastra planner設計、ルート確定パイプライン、series_charactersスキーマ、progress reducer、品質ゲート。
- 関連仮説: primary/secondary運用による愛着集中、relationship状態の多軸化による破綻低減は継続検証。
- 関連文書:
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md
  - docs/product/SERIES_EPISODE_IMPLEMENTATION_PLAN.md

### [DEC-20260311-003] 生成品質優先のシリーズ/エピソード詳細フローを確定
- 日付: 2026-03-11
- ステータス: 決定
- 決定内容: `docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md` を作成し、シリーズ生成とエピソード生成を基準文書由来の非交渉要件に基づく詳細フローとして定義した。無料枠/課金枠は生成本体の後段ポリシーとして分離する。
- 理由: まず「意図した生成品質」を安定化しないと、継続率・愛着形成・課金導線の検証が成立しないため。
- 影響範囲: Mastraワークフロー、保存処理、品質ゲート、状態更新、次スプリント実装優先順位。
- 関連仮説: 生成品質ゲート導入による離脱率改善、無料3話制御導入時の継続意欲維持は継続検証。
- 関連文書:
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md
  - docs/product/SERIES_EPISODE_IMPLEMENTATION_PLAN.md

### [DEC-20260311-002] シリーズ/エピソード実装計画をアルゴリズム基盤で更新
- 日付: 2026-03-11
- ステータス: 決定
- 決定内容: `docs/product/SERIES_EPISODE_IMPLEMENTATION_PLAN.md` を作成し、As-Is/To-Be差分、実装フェーズ、採用アルゴリズム（RAG, MMR, HNSW, VRPTW, LinUCB, Thompson Sampling, DR, CUPED）を明文化した。
- 理由: 事業仮説（継続愛着、行動変容、無料3話完結、有料延長）を実装可能な形に落とし込むため。
- 影響範囲: Series/Episode生成、状態管理、計測基盤、プレイ導線、将来B2B制御。
- 関連仮説: パーソナライズ方策の最適化効果、B2B訴求制御の没入感影響は継続検証。
- 関連文書:
  - docs/product/SERIES_EPISODE_IMPLEMENTATION_PLAN.md
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md

### [DEC-20260311-001] 共通認識文書の運用開始
- 日付: 2026-03-11
- ステータス: 決定
- 決定内容: `docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md` を灯火の事業・プロダクト前提に関する基準文書として運用開始する。
- 理由: 共同創業者・協業先・将来メンバーとの認識一致を維持するため。
- 影響範囲: 仕様検討、UX議論、ピッチ資料作成、外部説明資料。
- 関連仮説: 課金詳細、B2B提供パッケージ、計測設計は継続検証。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/business/COMMON_UNDERSTANDING_OPERATIONS.md
