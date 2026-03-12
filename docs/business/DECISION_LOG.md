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

### [DEC-20260312-015] seriesEpisodePlannerAgent全試行失敗時は生成中断せずfallback planで継続
- 日付: 2026-03-12
- ステータス: 決定
- 決定内容: `seriesEpisodePlannerAgent` は LLM 呼び出し全試行失敗時に例外を投げず、`buildFallbackPlan` を返してシリーズ生成を継続する方針に変更した。
- 理由: 実運用で「AIモデルからの応答が得られませんでした」によりシリーズ生成が停止し、ユーザー体験が失敗で終わっていたため。まず生成完了を優先し、後段で品質改善を行う。
- 影響範囲: シリーズ生成成功率、`generate-series-checkpoints` ステップの障害耐性、失敗時の品質下振れ挙動。
- 関連仮説: 生成成功率は上がる一方、fallback比率が高い期間は品質ばらつきが増える可能性があるため監視が必要。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260312-014] vNextシリーズ生成を同期APIからジョブAPIへ切替
- 日付: 2026-03-12
- ステータス: 決定
- 決定内容: アプリの vNext シリーズ生成は `POST /api/series/generate` の同期呼び出しではなく、`POST /api/series/generate/jobs` + `GET /api/series/generate/jobs/:jobId` のジョブ/ポーリング方式を優先利用する実装に変更した。Mastra側にも同エンドポイントを追加した。
- 理由: 同期APIは長時間処理でHTTPタイムアウトが発生しやすく、進捗イベントがUIへ反映されず「第1段階で停止して見える」問題を引き起こしていたため。
- 影響範囲: シリーズ生成の安定性、進捗UIの実時間更新、クライアント/サーバーAPI契約。
- 関連仮説: ジョブ方式でタイムアウト率は低下し、進捗可視化による離脱率も下がる。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260312-013] アプリvNextシリーズ生成のHTTPタイムアウトを180秒へ拡張
- 日付: 2026-03-12
- ステータス: 決定
- 決定内容: アプリ側 `generateSeriesDraftViaMastra` の vNext呼び出し（`/api/series/generate`）に対する通信タイムアウトを固定45秒相当から延長し、`EXPO_PUBLIC_SERIES_VNEXT_REQUEST_TIMEOUT_MS=180000`（既定180秒）を導入した。ジョブ作成/ポーリングの短いタイムアウト設定は維持。
- 理由: 実運用でシリーズ生成の長時間工程が45秒で打ち切られ、検証時と同等の成功率が得られなかったため。
- 影響範囲: アプリからのvNextシリーズ生成成功率、失敗時の待機時間、運用時のenvチューニング。
- 関連仮説: 通信打ち切り失敗は減少するが、ネットワーク断の検知は遅くなるためUX文言の最適化が必要。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260312-012] アプリ側シリーズ生成をvNext strict化し旧経路へのサイレントフォールバックを停止
- 日付: 2026-03-12
- ステータス: 決定
- 決定内容: `generateSeriesDraftViaMastra` は `EXPO_PUBLIC_SERIES_VNEXT_STRICT=true` を既定として、`/api/series/generate` が利用可能な環境では旧 `/api/series/jobs` への自動フォールバックを行わない方針に変更した（404/405など endpoint 未提供時のみ旧経路許可）。
- 理由: 最新実装を使っているつもりでも旧経路へ暗黙遷移する運用は、品質評価と障害切り分けを困難にし、continuity-first 実装の検証価値を損なうため。
- 影響範囲: アプリのシリーズ生成失敗時挙動、障害調査の明確性、旧経路依存環境での互換運用。
- 関連仮説: 成功率は一時的に低下する可能性があるが、失敗原因の可観測性が上がり、vNext品質改善サイクルは速くなる。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260312-011] seriesEpisodePlannerAgentのタイムアウトを可変化し既定75秒へ延長
- 日付: 2026-03-12
- ステータス: 決定
- 決定内容: `seriesEpisodePlannerAgent` の固定60秒タイムアウトを環境変数制御へ変更し、既定を `SERIES_EPISODE_PLANNER_TIMEOUT_MS=75000`、`SERIES_EPISODE_PLANNER_MAX_ATTEMPTS=2`、`SERIES_EPISODE_PLANNER_TIMEOUT_GROWTH=1.35` に設定した。
- 理由: 実運用ログで planner が60秒タイムアウトを連続発生させ、シリーズ生成失敗の主因になっていたため。
- 影響範囲: シリーズ生成の planner 工程成功率・待機時間、運用時のパラメータチューニング。
- 関連仮説: タイムアウト起因の失敗率は低下するが、失敗時の待機時間上限は増えるため閾値運用が必要。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260312-010] seriesCharacterAgentのタイムアウトを可変化し既定180秒へ延長
- 日付: 2026-03-12
- ステータス: 決定
- 決定内容: `seriesCharacterAgent` のLLM呼び出しタイムアウトを固定90秒から環境変数制御へ変更し、既定値を180秒に延長。さらにリトライ時にタイムアウトを段階拡張する方式を導入した（attempt上限もenv化）。
- 理由: 90秒固定でタイムアウト連鎖が起きると、再試行の実効性が低く、シリーズ生成の体験が劣化するため。
- 影響範囲: シリーズ生成（キャラクター工程）の成功率・待機時間、運用時のパラメータ調整容易性。
- 関連仮説: ピーク時でもタイムアウト失敗率を下げられる一方、失敗時の最長待機時間は増えるため、監視指標で最適点を調整する必要がある。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260312-009] runtimeのLLM puzzle生成を停止し章生成へ集約
- 日付: 2026-03-12
- ステータス: 決定
- 決定内容: `seriesRuntimeEpisodeAgent` のスポット処理から `generatePuzzle` 呼び出しを外し、章生成後に互換性維持用の決定論的フィールドを埋める方式へ変更した。
- 理由: 現段階では puzzle 層は中核要件ではなく、実行時間の主要ボトルネックだったため。
- 影響範囲: エピソード1話あたりのLLM呼び出し回数、生成時間、`spot_puzzle_*` 進捗イベント。
- 関連仮説: 品質低下を限定しつつ、スポット数に比例して処理時間を短縮できる。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260312-008] Geminiモデルをエージェント別に分離し速度最適化を優先
- 日付: 2026-03-12
- ステータス: 決定
- 決定内容: Mastraのモデル設定を `deep / balanced / fast` の3階層に再編し、さらにシリーズ/エピソード各エージェント単位で個別モデルを指定可能にした。既定値は `series concept=gemini-3.1-pro-preview`、`runtime planner=gemini-3-flash-preview`、`chapter/puzzle/consistency=gemini-3.1-flash-lite-preview` とした。
- 理由: continuity-first で品質を維持しつつ、製品体験として許容可能な応答時間へ寄せるため。重い思考系モデルを全工程に適用する構成を避ける。
- 影響範囲: `mastra/src/lib/modelConfig.ts`、`.env` のモデル設定運用、シリーズ生成/エピソード生成の体感速度とコスト。
- 関連仮説: planner品質を維持したまま、スポット数×章/謎生成の合計時間を30〜50%短縮できる。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260312-007] vNextエピソード出力に固定キャラ同一性・callback/payoff検証を必須化
- 日付: 2026-03-12
- ステータス: 決定
- 決定内容: `generateEpisodeRuntimeVNext` の最終出力直前で、(1) fixed character identity validator、(2) callback/payoff validator を実行し、軽微な欠落は自動補正、重大違反はジョブ失敗として扱う方針にした。
- 理由: continuity-first の非交渉要件（固定キャラ同一性、過去参照、伏線の進行/回収）を生成品質ゲートとして実行時に担保するため。
- 影響範囲: Mastra vNext ランタイム品質、`generationTrace` の検証ログ、エピソードジョブ失敗条件。
- 関連仮説: 生成失敗率は一時的に上がるが、継続破綻率は下がる。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260312-006] series_biblesへvNext continuity列を追加し既存progress_stateから最小バックフィル
- 日付: 2026-03-12
- ステータス: 決定
- 決定内容: `series_bibles` に `series_blueprint` / `initial_user_series_state_template` / `episode_runtime_bootstrap_payload` / `user_series_state` を追加し、既存行は `progress_state` から `user_series_state` を最小構造でバックフィルする migration を追加した。
- 理由: vNext continuity-first ランタイムの保存先を明確化しつつ、既存シリーズの継続情報が空のままになる移行リスクを下げるため。
- 影響範囲: Supabase schema、シリーズ保存/読み出し、エピソード終了後の継続パッチ反映経路。
- 関連仮説: 最小バックフィルでも継続体験の破綻を防げるかは、実運用ログで追加検証する。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260312-005] Continuity-first vNextスキーマ/APIを既存Mastra実装へアダプタ統合
- 日付: 2026-03-12
- ステータス: 決定
- 決定内容: `SeriesBlueprint` / `UserSeriesState` / `EpisodeContinuityPatch` を含む vNext スキーマを追加し、`/api/series/generate` と vNext 版 `/api/series/episode(/jobs)` を既存実装と並行運用するアダプタ方式で導入した。
- 理由: 既存の v7 系ワークフロー資産を活かしつつ、非交渉要件である継続記憶・関係性蓄積・回収設計を型/API 契約として先行固定するため。
- 影響範囲: Mastra API 層、ランタイム入出力契約、状態更新関数（`applyEpisodeContinuityPatch`）、今後の DB 正規化と段階移行計画。
- 関連仮説: 旧形式との並行運用により移行リスクを抑えつつ、vNext 形式の生成品質検証を進められる。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

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
