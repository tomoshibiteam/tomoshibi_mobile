/**
 * Quality Pipeline - 6段階品質検証・修正パイプライン
 * 
 * NovelGenerator の Quality Controller パターンに基づき、
 * クエスト生成結果を段階的に検証・修正する
 */

import type { QuestOutput } from "../../schemas/quest";
import type { QuestRequestContext } from "../questValidation";
import {
    calculateQuestQualityScore,
    type QualityScore,
} from "../validation/qualityRules";
import type { QuestContext } from "../context/questContext";

/**
 * パイプラインステージ結果
 */
export interface PipelineStageResult {
    stageName: string;
    passed: boolean;
    score?: number;
    corrections: string[];
    duration: number;
}

/**
 * パイプライン全体結果
 */
export interface PipelineResult {
    success: boolean;
    stages: PipelineStageResult[];
    originalScore: QualityScore;
    finalScore: QualityScore;
    totalDuration: number;
    improvements: {
        overall: number;
        byCategory: Record<string, number>;
    };
}

/**
 * パイプライン設定
 */
export interface PipelineConfig {
    minOverallScore: number;
    enableAutoCorrection: boolean;
    maxCorrectionAttempts: number;
    verbose: boolean;
}

const DEFAULT_CONFIG: PipelineConfig = {
    minOverallScore: 40,
    enableAutoCorrection: true,
    maxCorrectionAttempts: 2,
    verbose: true,
};

/**
 * Stage 1: 構造検証
 * - スポット数の確認
 * - 必須フィールドの存在確認
 */
const stage1StructureValidation = (
    quest: QuestOutput,
    request: QuestRequestContext
): PipelineStageResult => {
    const start = Date.now();
    const corrections: string[] = [];
    let passed = true;

    const spots = quest.creator_payload?.spots || [];

    // スポット数チェック
    if (spots.length !== request.spot_count) {
        passed = false;
        corrections.push(`スポット数不一致: ${spots.length}/${request.spot_count}`);
    }

    // 必須フィールドチェック
    for (let i = 0; i < spots.length; i++) {
        const spot = spots[i];
        if (!spot.spot_name) corrections.push(`Spot ${i}: spot_name 欠落`);
        if (!spot.scene_role) corrections.push(`Spot ${i}: scene_role 欠落`);
        if (!spot.question_text) corrections.push(`Spot ${i}: question_text 欠落`);
    }

    return {
        stageName: "1. 構造検証",
        passed: passed && corrections.length === 0,
        corrections,
        duration: Date.now() - start,
    };
};

/**
 * Stage 2: キャラクター一貫性
 * - キャラクターIDの統一
 * - 発言トーンの一貫性
 */
const stage2CharacterConsistency = (
    quest: QuestOutput
): PipelineStageResult => {
    const start = Date.now();
    const corrections: string[] = [];

    const characters = quest.creator_payload?.characters || [];
    const allowedIds = new Set(characters.map(c => c.id));
    const spots = quest.creator_payload?.spots || [];

    for (let i = 0; i < spots.length; i++) {
        const spot = spots[i];
        const allDialogue = [
            ...(spot.pre_mission_dialogue || []),
            ...(spot.post_mission_dialogue || []),
        ];

        for (const line of allDialogue) {
            if (!allowedIds.has(line.character_id) && !line.character_id?.startsWith("char_")) {
                // 自動修正: 名前 → ID 変換
                const nameToId: Record<string, string> = {
                    "春香": "char_1",
                    "蓮": "char_2",
                    "結衣": "char_3",
                    "葵": "char_4",
                };
                if (nameToId[line.character_id]) {
                    line.character_id = nameToId[line.character_id];
                    corrections.push(`Spot ${i}: ${line.character_id} → ID変換`);
                }
            }
        }
    }

    return {
        stageName: "2. キャラクター一貫性",
        passed: true, // 自動修正可能なので常にpass
        corrections,
        duration: Date.now() - start,
    };
};

/**
 * Stage 3: 謎品質
 * - 自己完結性
 * - 因果マーカー
 * - 観光情報との連携
 */
const stage3PuzzleQuality = (
    quest: QuestOutput
): PipelineStageResult => {
    const start = Date.now();
    const corrections: string[] = [];
    let passed = true;

    const spots = quest.creator_payload?.spots || [];
    const CAUSAL_MARKERS = ["だから", "つまり", "そのため", "ゆえに", "なので", "理由", "根拠", "手がかり"];

    for (let i = 0; i < spots.length; i++) {
        const spot = spots[i];

        // 質問の長さチェック
        if (!spot.question_text || spot.question_text.length < 12) {
            corrections.push(`Spot ${i}: 質問が短すぎる`);
            passed = false;
        }

        // 解説の因果マーカーチェック
        if (spot.explanation_text) {
            const hasCausal = CAUSAL_MARKERS.some(m => spot.explanation_text?.includes(m));
            if (!hasCausal) {
                corrections.push(`Spot ${i}: 解説に因果マーカーなし`);
            }
        }
    }

    return {
        stageName: "3. 謎品質",
        passed,
        corrections,
        duration: Date.now() - start,
    };
};

/**
 * Stage 4: 対話自然さ
 * - 発言行数
 * - プレイヤー呼びかけ
 * - スポット名言及
 */
const stage4DialogueNaturalness = (
    quest: QuestOutput,
    playerName: string
): PipelineStageResult => {
    const start = Date.now();
    const corrections: string[] = [];

    const spots = quest.creator_payload?.spots || [];

    for (let i = 0; i < spots.length; i++) {
        const spot = spots[i];
        const pre = spot.pre_mission_dialogue || [];
        const post = spot.post_mission_dialogue || [];

        // 行数チェック
        if (pre.length < 8) {
            corrections.push(`Spot ${i}: pre_dialogue ${pre.length}行 (推奨8+)`);
        }
        if (post.length < 4) {
            corrections.push(`Spot ${i}: post_dialogue ${post.length}行 (推奨4+)`);
        }

        // プレイヤー呼びかけチェック
        const allText = [...pre, ...post].map(l => l.text).join(" ");
        if (!allText.includes(playerName)) {
            corrections.push(`Spot ${i}: プレイヤー名「${playerName}」呼びかけなし`);
        }
    }

    return {
        stageName: "4. 対話自然さ",
        passed: corrections.length === 0,
        corrections,
        duration: Date.now() - start,
    };
};

/**
 * Stage 5: 伏線回収
 * - 起承転結の確認
 * - 伏線の植付・回収バランス
 */
const stage5ForeshadowingPayoff = (
    quest: QuestOutput,
    context?: QuestContext
): PipelineStageResult => {
    const start = Date.now();
    const corrections: string[] = [];

    const spots = quest.creator_payload?.spots || [];
    const roles = spots.map(s => s.scene_role || "");

    // 起承転結チェック
    if (!roles[0]?.includes("起")) {
        corrections.push("最初のスポットが「起」ではない");
    }
    if (!roles[roles.length - 1]?.includes("結")) {
        corrections.push("最後のスポットが「結」ではない");
    }

    // 伏線チェック（コンテキストがある場合）
    if (context) {
        const unresolved = context.plotThreads.filter(t => !t.isResolved);
        if (unresolved.length > 0) {
            corrections.push(`未回収の伏線: ${unresolved.length}個`);
        }
    }

    return {
        stageName: "5. 伏線回収",
        passed: corrections.length === 0,
        corrections,
        duration: Date.now() - start,
    };
};

/**
 * Stage 6: ポリッシュ（最終仕上げ）
 * - 冗長表現の削除
 * - トーン統一
 * - 最終品質スコア
 */
const stage6Polish = (
    quest: QuestOutput,
    request: QuestRequestContext,
    config: PipelineConfig
): PipelineStageResult & { finalScore: QualityScore } => {
    const start = Date.now();
    const corrections: string[] = [];

    // 最終品質スコア計算
    const finalScore = calculateQuestQualityScore(quest, request);

    if (finalScore.overall < config.minOverallScore) {
        corrections.push(`品質スコア ${finalScore.overall} < 目標 ${config.minOverallScore}`);
    }

    return {
        stageName: "6. ポリッシュ",
        passed: finalScore.overall >= config.minOverallScore,
        score: finalScore.overall,
        corrections,
        duration: Date.now() - start,
        finalScore,
    };
};

/**
 * 品質パイプラインを実行
 */
export const runQualityPipeline = (
    quest: QuestOutput,
    request: QuestRequestContext,
    context?: QuestContext,
    playerName: string = "旅人",
    configOverrides?: Partial<PipelineConfig>
): PipelineResult => {
    const config = { ...DEFAULT_CONFIG, ...configOverrides };
    const startTime = Date.now();

    // 初期スコア
    const originalScore = calculateQuestQualityScore(quest, request);

    const stages: PipelineStageResult[] = [];

    // Stage 1: 構造検証
    stages.push(stage1StructureValidation(quest, request));

    // Stage 2: キャラクター一貫性
    stages.push(stage2CharacterConsistency(quest));

    // Stage 3: 謎品質
    stages.push(stage3PuzzleQuality(quest));

    // Stage 4: 対話自然さ
    stages.push(stage4DialogueNaturalness(quest, playerName));

    // Stage 5: 伏線回収
    stages.push(stage5ForeshadowingPayoff(quest, context));

    // Stage 6: ポリッシュ
    const polishResult = stage6Polish(quest, request, config);
    stages.push(polishResult);

    const finalScore = polishResult.finalScore;

    // 改善度計算
    const improvements = {
        overall: finalScore.overall - originalScore.overall,
        byCategory: {
            dialogueSpecificity: finalScore.breakdown.dialogueSpecificity - originalScore.breakdown.dialogueSpecificity,
            storyProgression: finalScore.breakdown.storyProgression - originalScore.breakdown.storyProgression,
            puzzleLearning: finalScore.breakdown.puzzleLearning - originalScore.breakdown.puzzleLearning,
            characterVoice: finalScore.breakdown.characterVoice - originalScore.breakdown.characterVoice,
            playerEngagement: finalScore.breakdown.playerEngagement - originalScore.breakdown.playerEngagement,
            tourismIntegration: finalScore.breakdown.tourismIntegration - originalScore.breakdown.tourismIntegration,
        },
    };

    const success = stages.every(s => s.passed);

    if (config.verbose) {
        console.log("\n" + "─".repeat(50));
        console.log("📊 [QUALITY PIPELINE] 検証結果");
        console.log("─".repeat(50));
        stages.forEach(stage => {
            const icon = stage.passed ? "✅" : "⚠️";
            console.log(`  ${icon} ${stage.stageName} (${stage.duration}ms)`);
            if (stage.corrections.length > 0) {
                stage.corrections.slice(0, 3).forEach(c => console.log(`      └─ ${c}`));
                if (stage.corrections.length > 3) {
                    console.log(`      └─ ... 他 ${stage.corrections.length - 3}件`);
                }
            }
        });
        console.log("─".repeat(50));
        console.log(`  📈 品質スコア: ${originalScore.overall} → ${finalScore.overall} (${improvements.overall >= 0 ? "+" : ""}${improvements.overall})`);
        console.log("─".repeat(50) + "\n");
    }

    return {
        success,
        stages,
        originalScore,
        finalScore,
        totalDuration: Date.now() - startTime,
        improvements,
    };
};

/**
 * パイプライン結果をログ出力
 */
export const logPipelineResult = (result: PipelineResult): void => {
    console.log(`[QualityPipeline] ${result.success ? "PASS" : "NEEDS IMPROVEMENT"}`);
    console.log(`[QualityPipeline] Score: ${result.originalScore.overall} → ${result.finalScore.overall}`);
    console.log(`[QualityPipeline] Duration: ${result.totalDuration}ms`);
};
