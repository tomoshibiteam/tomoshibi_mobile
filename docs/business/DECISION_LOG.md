# 意思決定ログ（Decision Log）

- 最終更新日: 2026-03-15

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

### [DEC-20260315-027] シリーズ生成を多候補探索＋text judge rerankの品質パイプラインへ更新
- 日付: 2026-03-15
- ステータス: 決定
- 決定内容: `/api/series/generate` の内部で使う `generateSeriesWorkflowWithProgress` に quality pipeline を追加し、(1) sanitize昇格（SeriesPreferenceSheet / SeriesAntiBrief / UserSeriesRubric）、(2) concept seed多候補生成（6〜10案）と fingerprint＋意味重複dedupe、(3) 上位2〜3案の詳細展開（rich fixed characters / identity pack / checkpoints / first episode seed / seed評価）、(4) text judge＋pairwise rerank による採用、(5) finalize deterministic 統合を導入した。feature flag により quality/legacy 切替と strict fallback 制御を可能にした。
- 理由: 既存の単発案生成ではユーザー意図の深い反映、独自性、固定キャラ固有性、checkpoint/endingのシリーズ化、本文の選抜品質が不足し、平均解へ寄る傾向があったため。
- 影響範囲: `mastra/src/workflows/series-workflow.ts` の生成経路、シリーズ設計用agent群（preference/concept seed/rich character/checkpoint/first seed/text judge）、`series-runtime-vnext` の modelInfo 表示、生成ログ観測項目。
- 関連仮説: LLM負荷が高い環境では候補展開数を絞る必要があり、`SERIES_WORKFLOW_QUALITY_MODE` / `SERIES_CONCEPT_EXPAND_TARGET` / text judge切替の運用で成功率と品質の最適点を継続調整する。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/business/COMMON_UNDERSTANDING_OPERATIONS.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260314-026] GamePlayのバックエンド取得でエピソード背景とキャラクターアイコンを優先利用
- 日付: 2026-03-14
- ステータス: 決定
- 決定内容: `fetchGameplayQuest` で、背景画像は `spots.image_url` が無い場合に `quest_episodes/quest_posts` 側のエピソードカバーを優先利用する。キャラクターは `quest_characters` に加え `series_characters` を補完利用し、`spot_story_messages` の発話者名に一致するアバターを自動補完する。`spots` 非存在時のフォールバック経路でもシリーズキャラクター付きメッセージを返す。
- 理由: テキストのみ接続され、背景画像とキャラクターアイコンが画面に反映されないケースが発生していたため。
- 影響範囲: `src/services/gameplay.ts` のクエスト組み立てロジック、GamePlay（native/web）での背景・会話アイコン表示。
- 関連仮説: 既存データの列欠落環境でも表示欠落は減るが、元データ側の `speaker_name` とキャラ名が大きく不一致な場合は一部ナレーション表示が残る。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260314-025] WebプレビューGamePlayも演出統一しパズル導線を停止
- 日付: 2026-03-14
- ステータス: 決定
- 決定内容: `GamePlayScreen.web.tsx` にタイプライター会話表示、オープニング導入（`opening_prologue`）、シーン切替フェード、背景マスク調整を適用し、`story_pre` から `puzzle` へ遷移せず `story_post` へ進める。`puzzle` UIはWebプレビューでは非表示とする。
- 理由: ユーザーがPC URLで確認している際に、実装済みnative演出との差分が大きく、反映されていないように見える問題があったため。
- 影響範囲: `src/screens/GamePlayScreen.web.tsx` の進行制御、会話表示UI、遷移演出、パズル表示条件。
- 関連仮説: Webとnativeの演出差分を縮小することでレビュー効率は向上するが、最終的な体感は実機で再確認が必要。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260314-024] ネイティブGamePlayでパズル導線を一時停止し演出を優先
- 日付: 2026-03-14
- ステータス: 決定
- 決定内容: 実機向け `GamePlayScreen.tsx` では `story_pre` 後に `puzzle` へ遷移せず `story_post` へ直接進める。あわせて、会話表示のタイプライター演出強化、シーン切替フェード、背景マスクの暗さ調整を行う。
- 理由: 現時点の要件はパズル機能よりも物語体験のUI/UX再現を優先するため。
- 影響範囲: `src/screens/GamePlayScreen.tsx` の進行制御（`handleDialogueComplete`、`handleArrive`）、会話表示UI、画面遷移演出。
- 関連仮説: パズル導線を止めることで体験離脱は減るが、再導入時は達成感設計の再検証が必要。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260314-023] ネイティブGamePlayのUI/UXをReplica準拠へ再調整
- 日付: 2026-03-14
- ステータス: 決定
- 決定内容: 実機向け `GamePlayScreen.tsx` に、Replica準拠の上部HUD（戻る・進捗・GPS状態）、移動フェーズの補助CTA（現在地有効化・地図を開く）、会話UIの完了誘導テキストを追加し、文言/導線を再調整した。
- 理由: フローは実装済みでも、ボタン配置・表示情報・演出の密度が不足しており、体験品質に差分があったため。
- 影響範囲: `src/screens/GamePlayScreen.tsx` の表示層（HUD・travelカード・dialogueオーバーレイ）と操作導線。
- 関連仮説: 視認性と進行理解が向上し、開始〜移動〜謎解きの離脱率が低下する。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260314-022] Web版GamePlayもReplica準拠フローへ統一
- 日付: 2026-03-14
- ステータス: 決定
- 決定内容: `GamePlayScreen.web.tsx` を全面更新し、`location_gate → travel → story_pre → puzzle → story_post → epilogue` のフェーズ進行、位置情報スキップ、選択式/入力式の謎解き、フロント単体デモフォールバックを実装した。
- 理由: Webプラットフォームだけ旧簡易画面のままだと、Replica準拠UI/UXの確認結果が端末依存になり、実装完了判定が不整合になるため。
- 影響範囲: `src/screens/GamePlayScreen.web.tsx` の状態遷移・表示ロジック、Webでのフロント先行検証導線。
- 関連仮説: Webでも同一フローが再現できることでUI検証速度は向上するが、最終的な永続化/分析イベントはバックエンド接続後に再検証が必要。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260314-021] GamePlayはReplica準拠のフロント単体モードを先行実装
- 日付: 2026-03-14
- ステータス: 決定
- 決定内容: `GamePlay` ルートをプレースホルダーから本画面へ戻し、バックエンド未接続でも進行確認できるようにReplica準拠のフロント単体デモクエスト（2スポット、謎解き、会話進行）を導入した。位置情報は通常取得に加えて「スキップ開始」を許可する。
- 理由: ゼロベース再実装フェーズでは、先に画面体験を固めてからバックエンド接続する方針のため。
- 影響範囲: `src/navigation/RootNavigator.tsx` の `GamePlay` ルート、`src/screens/SeriesDetailScreen.tsx` の遷移復帰、`src/screens/GamePlayScreen.tsx` のデモデータ/位置情報スキップ/ロードフォールバック。
- 関連仮説: デモモードでUI/導線検証速度は上がるが、最終的なデータ整合はバックエンド接続後に再検証が必要。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260314-020] 既存GamePlay画面をフローから一時撤去しプレースホルダーへ差し替え
- 日付: 2026-03-14
- ステータス: 決定
- 決定内容: 新規ゼロベース実装に向けて、既存 `GamePlayScreen` は遷移フローから外し、`GamePlay` ルートは一時プレースホルダー画面へ差し替える。シリーズ詳細の「ゲームプレイ/進む」操作は準備中案内を返す。
- 理由: 現行実装を前提に改修を続けると再設計コストが増えるため、実行導線を止めたうえで新規実装に集中するため。
- 影響範囲: `src/navigation/RootNavigator.tsx` の `GamePlay` ルート、`src/screens/SeriesDetailScreen.tsx` の遷移操作、`src/screens/GamePlayPlaceholderScreen.tsx` の追加。
- 関連仮説: 旧画面を誤って利用する経路が減り、新規実装時の検証品質が上がる。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260314-019] シリーズ作成者は配下エピソードを削除可能とする
- 日付: 2026-03-14
- ステータス: 決定
- 決定内容: シリーズ詳細画面ではシリーズ作成者に各エピソードの削除操作を常時提供し、削除APIは「投稿者本人」削除に失敗した場合でも「シリーズ作成者」権限での削除を試行する。Supabaseでは `quest_episodes` / `quest_posts` にシリーズ作成者向けDELETEポリシーを追加する運用とした。
- 理由: 過去データや保存経路差分で `episode.user_id` がシリーズ作成者と一致しない場合、削除ボタンが非表示または実行不能になっていたため。
- 影響範囲: `src/screens/SeriesDetailScreen.tsx` の削除UI表示条件、`src/services/quests.ts` の削除実行ロジック、`supabase/sql/20260314_allow_series_creator_episode_delete.sql` の適用。
- 関連仮説: 旧データ互換下でも削除失敗率は低下するが、RLS未適用環境では依然として権限エラーが残る。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260314-018] エピソードカバー永続化のためquest_episodes/quest_posts列を必須化
- 日付: 2026-03-14
- ステータス: 決定
- 決定内容: エピソード生成カバー画像を永続化するため、Supabaseに `quest_episodes.cover_image_url` と `quest_posts.image_urls` を追加する運用を必須化した。アプリ側は列欠落時に警告ログを出し、互換モード挿入は継続する。
- 理由: 生成結果画面では画像が表示されても、DB列不足で保存時に画像URLが破棄され、シリーズ詳細でフォールバック表示になる問題が発生していたため。
- 影響範囲: `supabase/sql/20260314_add_episode_cover_columns.sql` の適用、`src/services/quests.ts` の保存/読込時警告、エピソードカバー保存の運用手順。
- 関連仮説: 列適用後はエピソードカバー欠落率が大幅に低下するが、生成失敗時のみフォールバックが残る。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260314-017] エピソードカバーはシリーズカバーへフォールバックしない
- 日付: 2026-03-14
- ステータス: 決定
- 決定内容: シリーズ詳細の各エピソードカードでは、`episode.cover_image_url` を最優先し、未設定時はエピソード単位のシード画像を生成して使用する。シリーズカバーへのフォールバックは行わない。また保存処理側（`createEpisodeForSeries`）でも、カバー未指定時はエピソード単位のシード画像URLを自動付与する。
- 理由: 各エピソードの視覚的識別が失われ、シリーズ体験が「同じサムネイルの繰り返し」に見えることで、継続利用時の物語差分認知が弱くなっていたため。
- 影響範囲: `src/screens/SeriesDetailScreen.tsx` のサムネイル解決、`src/screens/EpisodeGenerationResultScreen.tsx` の保存時カバー決定、`src/services/quests.ts` のエピソード保存デフォルト値。
- 関連仮説: 画像生成URLが未返却でも各話サムネイルの識別性は維持できるが、将来的にはシード画像ではなく完全にAI生成カバーへ収束させる余地がある。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

### [DEC-20260314-016] legacyエピソード生成でもカバー画像・キャラクター画像URLを返却する
- 日付: 2026-03-14
- ステータス: 決定
- 決定内容: Mastra の legacy エピソード生成（`seriesRuntimeEpisodeAgent`）で、`cover_image_prompt / cover_image_url` と、シリーズ固定・エピソード固有キャラクターの画像URL（`avatar_image_url`, `portrait_image_url`）を出力する方針に変更した。画像URLはシリーズ生成と同じ `buildSeriesImageUrl` 系を利用する。
- 理由: アプリ側が vNext 入力を作れないケースや旧データ経路で legacy にフォールバックした際、エピソード画面でカバー画像・キャラクター画像が欠落し、愛着形成の主要体験が毀損していたため。
- 影響範囲: `mastra/src/lib/agents/seriesRuntimeEpisodeAgent.ts` の出力契約、`src/services/seriesAi.ts` の legacy リクエスト項目、エピソード生成結果画面の画像表示安定性。
- 関連仮説: legacy経路でも画像欠落率は下がるが、画像生成URLのクエリ長・生成レイテンシ増加の監視が必要。
- 関連文書:
  - docs/business/TOMOSHIBI_COMMON_UNDERSTANDING.md
  - docs/product/SERIES_EPISODE_GENERATION_FLOW_DETAIL.md

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
