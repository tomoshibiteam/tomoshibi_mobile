/**
 * 体験品質ルール
 * 
 * 形式的な制約だけでなく、プレイヤーの体験品質を測定するバリデーションルール
 */

import { QuestOutput } from '../../schemas/quest';
import type { QuestRequestContext, ValidationIssue, RuleResult } from '../questValidation';

/**
 * 品質スコア結果
 */
export interface QualityScore {
    overall: number;
    breakdown: {
        dialogueSpecificity: number;
        storyProgression: number;
        puzzleLearning: number;
        characterVoice: number;
        playerEngagement: number;
        tourismIntegration: number;
    };
    issues: ValidationIssue[];
    suggestions: string[];
}

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

/**
 * 会話の具体性をスコアリング
 * - スポット名が含まれているか
 * - 観光情報が含まれているか
 * - 具体的なアクション動詞があるか
 */
export const scoreDialogueSpecificity = (quest: QuestOutput): {
    score: number;
    issues: ValidationIssue[];
} => {
    const spots = quest.creator_payload?.spots || [];
    const issues: ValidationIssue[] = [];
    let totalScore = 0;
    let checkCount = 0;

    spots.forEach((spot, index) => {
        const spotName = spot.spot_name || '';
        const tourismAnchor = spot.scene_tourism_anchor || '';
        const allDialogue = [
            ...(spot.pre_mission_dialogue || []),
            ...(spot.post_mission_dialogue || []),
        ];

        if (allDialogue.length === 0) {
            issues.push({
                level: 'error',
                ruleId: 'dialogue_specificity_v1',
                message: `スポット${index + 1}に会話がありません`,
                path: `creator_payload.spots[${index}]`,
            });
            return;
        }

        const texts = allDialogue.map(line => line.text || '').join(' ');

        // スポット名の言及チェック
        const hasSpotName = texts.includes(spotName) ||
            (spotName.length > 2 && texts.includes(spotName.slice(0, 3)));
        if (hasSpotName) {
            totalScore += 25;
        } else {
            issues.push({
                level: 'warning',
                ruleId: 'dialogue_specificity_v1',
                message: `スポット${index + 1}の会話にスポット名「${spotName}」が言及されていません`,
                path: `creator_payload.spots[${index}]`,
            });
        }
        checkCount++;

        // 観光情報の言及チェック
        const tourismKeywords = tourismAnchor
            .replace(/[。、,.!！?？]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 3)
            .slice(0, 3);

        const hasTourism = tourismKeywords.some(kw => texts.includes(kw));
        if (hasTourism) {
            totalScore += 25;
        } else if (tourismKeywords.length > 0) {
            issues.push({
                level: 'warning',
                ruleId: 'dialogue_specificity_v1',
                message: `スポット${index + 1}の会話に観光情報が織り込まれていません`,
                path: `creator_payload.spots[${index}].scene_tourism_anchor`,
            });
        }
        checkCount++;

        // 具体的なアクション動詞チェック
        const actionVerbs = ['見て', '調べ', '確認', '発見', '探', '注目', '気づ', '覚え', '思い出'];
        const hasAction = actionVerbs.some(verb => texts.includes(verb));
        if (hasAction) {
            totalScore += 25;
        }
        checkCount++;

        // 「ここ」「この場所」などの抽象表現チェック
        const abstractTerms = ['ここ', 'この場所', 'このスポット', 'この辺'];
        const abstractCount = abstractTerms.filter(term => texts.includes(term)).length;
        const specificCount = texts.split(spotName).length - 1;

        if (specificCount >= abstractCount) {
            totalScore += 25;
        } else {
            issues.push({
                level: 'warning',
                ruleId: 'dialogue_specificity_v1',
                message: `スポット${index + 1}の会話で抽象的な表現が多く使われています`,
                path: `creator_payload.spots[${index}]`,
            });
        }
        checkCount++;
    });

    return {
        score: checkCount > 0 ? Math.round(totalScore / checkCount) : 0,
        issues,
    };
};

/**
 * ストーリー進行をスコアリング
 * - 各スポットで新しい情報が追加されているか
 * - 前スポットの情報が参照されているか
 */
export const scoreStoryProgression = (quest: QuestOutput): {
    score: number;
    issues: ValidationIssue[];
} => {
    const spots = quest.creator_payload?.spots || [];
    const issues: ValidationIssue[] = [];
    let totalScore = 0;
    let checkCount = 0;

    spots.forEach((spot, index) => {
        const objective = spot.scene_objective || '';
        const prevSpot = index > 0 ? spots[index - 1] : null;
        const allDialogue = [
            ...(spot.pre_mission_dialogue || []),
            ...(spot.post_mission_dialogue || []),
        ];
        const texts = allDialogue.map(line => line.text || '').join(' ');

        // 目標の独自性チェック（前スポットと異なる目標か）
        if (prevSpot) {
            const prevObjective = prevSpot.scene_objective || '';
            if (objective !== prevObjective && objective.length > 5) {
                totalScore += 30;
            } else {
                issues.push({
                    level: 'warning',
                    ruleId: 'story_progression_v1',
                    message: `スポット${index + 1}の目標が前スポットと同一または類似`,
                    path: `creator_payload.spots[${index}].scene_objective`,
                });
            }
            checkCount++;

            // 前スポットへの言及チェック
            const prevSpotName = prevSpot.spot_name || '';
            const progressionTerms = ['さっき', '前の', '先ほど', prevSpotName.slice(0, 3)];
            const hasProgression = progressionTerms.some(term => texts.includes(term));
            if (hasProgression) {
                totalScore += 40;
            } else if (index > 0) {
                issues.push({
                    level: 'warning',
                    ruleId: 'story_progression_v1',
                    message: `スポット${index + 1}で前スポットの情報が参照されていません`,
                    path: `creator_payload.spots[${index}]`,
                });
            }
            checkCount++;
        }

        // 新しい発見・情報の追加チェック
        const discoveryTerms = ['分かった', 'わかった', '発見', '見つけ', '気づ', '判明', '手がかり'];
        const hasDiscovery = discoveryTerms.some(term => texts.includes(term));
        if (hasDiscovery) {
            totalScore += 30;
        }
        checkCount++;
    });

    return {
        score: checkCount > 0 ? Math.round(totalScore / checkCount) : 100,
        issues,
    };
};

/**
 * 謎解きから学びを得られるかスコアリング
 */
export const scorePuzzleLearning = (quest: QuestOutput): {
    score: number;
    issues: ValidationIssue[];
} => {
    const spots = quest.creator_payload?.spots || [];
    const issues: ValidationIssue[] = [];
    let totalScore = 0;
    let checkCount = 0;

    spots.forEach((spot, index) => {
        const questionText = spot.question_text || '';
        const explanationText = spot.explanation_text || '';
        const tourismAnchor = spot.scene_tourism_anchor || '';

        // 質問と観光情報の関連チェック
        const tourismKeywords = tourismAnchor
            .replace(/[。、,.!！?？]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 2)
            .slice(0, 5);

        const questionHasTourism = tourismKeywords.some(kw => questionText.includes(kw));
        if (questionHasTourism) {
            totalScore += 30;
        } else if (tourismKeywords.length > 0) {
            issues.push({
                level: 'warning',
                ruleId: 'puzzle_learning_v1',
                message: `スポット${index + 1}の謎が観光情報と関連していません`,
                path: `creator_payload.spots[${index}].question_text`,
            });
        }
        checkCount++;

        // 解説から学びが得られるかチェック
        const learningIndicators = ['歴史', '由来', '特徴', '理由', '背景', 'ため', 'から'];
        const hasLearning = learningIndicators.filter(ind => explanationText.includes(ind)).length >= 2;
        if (hasLearning) {
            totalScore += 40;
        } else {
            issues.push({
                level: 'warning',
                ruleId: 'puzzle_learning_v1',
                message: `スポット${index + 1}の解説から学びが得られにくい`,
                path: `creator_payload.spots[${index}].explanation_text`,
            });
        }
        checkCount++;

        // 解説の因果関係チェック
        const causalMarkers = ['だから', '理由', 'つまり', 'ゆえに', 'そのため'];
        const hasCausal = causalMarkers.some(marker => explanationText.includes(marker));
        if (hasCausal) {
            totalScore += 30;
        }
        checkCount++;
    });

    return {
        score: checkCount > 0 ? Math.round(totalScore / checkCount) : 0,
        issues,
    };
};

/**
 * キャラクターの個性一貫性をスコアリング
 */
export const scoreCharacterVoice = (quest: QuestOutput): {
    score: number;
    issues: ValidationIssue[];
} => {
    const characters = quest.creator_payload?.characters || [];
    const spots = quest.creator_payload?.spots || [];
    const issues: ValidationIssue[] = [];

    if (characters.length === 0) {
        return {
            score: 0, issues: [{
                level: 'error',
                ruleId: 'character_voice_v1',
                message: 'キャラクターが定義されていません',
                path: 'creator_payload.characters',
            }]
        };
    }

    // 各キャラクターの発言を収集
    const characterDialogues: Record<string, string[]> = {};
    characters.forEach(char => {
        characterDialogues[char.id] = [];
    });

    spots.forEach(spot => {
        const allDialogue = [
            ...(spot.pre_mission_dialogue || []),
            ...(spot.post_mission_dialogue || []),
        ];
        allDialogue.forEach(line => {
            if (characterDialogues[line.character_id]) {
                characterDialogues[line.character_id].push(line.text || '');
            }
        });
    });

    let totalScore = 0;
    let checkCount = 0;

    characters.forEach(char => {
        const dialogues = characterDialogues[char.id] || [];

        // 発言数チェック
        if (dialogues.length < 2) {
            issues.push({
                level: 'warning',
                ruleId: 'character_voice_v1',
                message: `キャラクター「${char.name}」の発言が少なすぎます`,
                path: `creator_payload.characters`,
            });
            return;
        }

        // 専門性に基づいた発言があるかチェック
        const specialty = char.role || char.personality || '';
        const specialtyKeywords = specialty
            .replace(/[。、,.!！?？]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 2);

        const allText = dialogues.join(' ');
        const hasSpecialtyContent = specialtyKeywords.some(kw => allText.includes(kw));
        if (hasSpecialtyContent) {
            totalScore += 50;
        } else {
            issues.push({
                level: 'warning',
                ruleId: 'character_voice_v1',
                message: `キャラクター「${char.name}」の発言が役割（${char.role}）と合っていません`,
                path: `creator_payload.characters`,
            });
        }
        checkCount++;

        // 発言パターンの一貫性チェック（簡易版）
        totalScore += 50; // 基本点
        checkCount++;
    });

    return {
        score: checkCount > 0 ? Math.round(totalScore / checkCount) : 0,
        issues,
    };
};

/**
 * プレイヤーエンゲージメントをスコアリング
 */
export const scorePlayerEngagement = (
    quest: QuestOutput,
    playerName?: string
): {
    score: number;
    issues: ValidationIssue[];
} => {
    const spots = quest.creator_payload?.spots || [];
    const issues: ValidationIssue[] = [];
    const targetName = playerName || '君';
    let totalScore = 0;
    let checkCount = 0;

    spots.forEach((spot, index) => {
        const allDialogue = [
            ...(spot.pre_mission_dialogue || []),
            ...(spot.post_mission_dialogue || []),
        ];
        const texts = allDialogue.map(line => line.text || '').join(' ');

        // プレイヤー名の呼びかけチェック
        const hasPlayerName = texts.includes(targetName);
        if (hasPlayerName) {
            totalScore += 30;
        } else {
            issues.push({
                level: 'warning',
                ruleId: 'player_engagement_v1',
                message: `スポット${index + 1}でプレイヤー（${targetName}）への呼びかけがありません`,
                path: `creator_payload.spots[${index}]`,
            });
        }
        checkCount++;

        // 質問・投げかけのチェック
        const questionPatterns = ['?', '？', 'どう思う', 'だろう', 'かな', 'みて', '確認して'];
        const hasQuestion = questionPatterns.some(pat => texts.includes(pat));
        if (hasQuestion) {
            totalScore += 35;
        }
        checkCount++;

        // 励ましの言葉チェック
        const encouragementTerms = ['すごい', 'さすが', 'いいね', 'やった', '正解', 'できた'];
        const hasEncouragement = encouragementTerms.some(term => texts.includes(term));
        if (hasEncouragement) {
            totalScore += 35;
        }
        checkCount++;
    });

    return {
        score: checkCount > 0 ? Math.round(totalScore / checkCount) : 0,
        issues,
    };
};

/**
 * 観光情報の統合度をスコアリング
 */
export const scoreTourismIntegration = (quest: QuestOutput): {
    score: number;
    issues: ValidationIssue[];
} => {
    const spots = quest.creator_payload?.spots || [];
    const issues: ValidationIssue[] = [];
    let totalScore = 0;
    let checkCount = 0;

    spots.forEach((spot, index) => {
        const tourismAnchor = spot.scene_tourism_anchor || '';
        const questionText = spot.question_text || '';
        const explanationText = spot.explanation_text || '';
        const allDialogue = [
            ...(spot.pre_mission_dialogue || []),
            ...(spot.post_mission_dialogue || []),
        ];
        const dialogueTexts = allDialogue.map(line => line.text || '').join(' ');

        // 観光アンカーの品質チェック
        if (tourismAnchor.length < 10) {
            issues.push({
                level: 'warning',
                ruleId: 'tourism_integration_v1',
                message: `スポット${index + 1}の観光情報（scene_tourism_anchor）が不十分`,
                path: `creator_payload.spots[${index}].scene_tourism_anchor`,
            });
        } else {
            totalScore += 20;
        }
        checkCount++;

        // 観光情報が会話に活用されているかチェック
        const tourismKeywords = tourismAnchor
            .replace(/[。、,.!！?？]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 3)
            .slice(0, 3);

        const usedInDialogue = tourismKeywords.filter(kw => dialogueTexts.includes(kw)).length;
        const usedInPuzzle = tourismKeywords.filter(kw =>
            questionText.includes(kw) || explanationText.includes(kw)
        ).length;

        if (usedInDialogue > 0) {
            totalScore += 40;
        }
        checkCount++;

        if (usedInPuzzle > 0) {
            totalScore += 40;
        } else {
            issues.push({
                level: 'warning',
                ruleId: 'tourism_integration_v1',
                message: `スポット${index + 1}の謎に観光情報が活用されていません`,
                path: `creator_payload.spots[${index}]`,
            });
        }
        checkCount++;
    });

    return {
        score: checkCount > 0 ? Math.round(totalScore / checkCount) : 0,
        issues,
    };
};

/**
 * 総合的な体験品質スコアを計算
 */
export const calculateQuestQualityScore = (
    quest: QuestOutput,
    context: QuestRequestContext
): QualityScore => {
    const dialogueSpecificity = scoreDialogueSpecificity(quest);
    const storyProgression = scoreStoryProgression(quest);
    const puzzleLearning = scorePuzzleLearning(quest);
    const characterVoice = scoreCharacterVoice(quest);
    const playerEngagement = scorePlayerEngagement(quest, context.player_name);
    const tourismIntegration = scoreTourismIntegration(quest);

    const allIssues = [
        ...dialogueSpecificity.issues,
        ...storyProgression.issues,
        ...puzzleLearning.issues,
        ...characterVoice.issues,
        ...playerEngagement.issues,
        ...tourismIntegration.issues,
    ];

    const breakdown = {
        dialogueSpecificity: dialogueSpecificity.score,
        storyProgression: storyProgression.score,
        puzzleLearning: puzzleLearning.score,
        characterVoice: characterVoice.score,
        playerEngagement: playerEngagement.score,
        tourismIntegration: tourismIntegration.score,
    };

    // 重み付け平均
    const weights = {
        dialogueSpecificity: 0.20,
        storyProgression: 0.15,
        puzzleLearning: 0.20,
        characterVoice: 0.15,
        playerEngagement: 0.15,
        tourismIntegration: 0.15,
    };

    const overall = Math.round(
        breakdown.dialogueSpecificity * weights.dialogueSpecificity +
        breakdown.storyProgression * weights.storyProgression +
        breakdown.puzzleLearning * weights.puzzleLearning +
        breakdown.characterVoice * weights.characterVoice +
        breakdown.playerEngagement * weights.playerEngagement +
        breakdown.tourismIntegration * weights.tourismIntegration
    );

    // 改善提案の生成
    const suggestions: string[] = [];
    if (breakdown.dialogueSpecificity < 60) {
        suggestions.push('会話にスポット名や観光情報をより具体的に含めてください');
    }
    if (breakdown.storyProgression < 60) {
        suggestions.push('各スポットで前の情報を参照し、物語を進行させてください');
    }
    if (breakdown.puzzleLearning < 60) {
        suggestions.push('謎と観光情報を関連付け、解説で学びを提供してください');
    }
    if (breakdown.characterVoice < 60) {
        suggestions.push('各キャラクターの専門性に基づいた発言を増やしてください');
    }
    if (breakdown.playerEngagement < 60) {
        suggestions.push('プレイヤーへの呼びかけや励ましを各スポットで入れてください');
    }
    if (breakdown.tourismIntegration < 60) {
        suggestions.push('観光情報を会話や謎により積極的に活用してください');
    }

    return {
        overall,
        breakdown,
        issues: allIssues,
        suggestions,
    };
};

/**
 * 品質スコアをログ出力
 */
export const logQualityScore = (score: QualityScore): void => {
    console.log('[Quality] Overall Score:', score.overall);
    console.log('[Quality] Breakdown:', JSON.stringify(score.breakdown, null, 2));
    if (score.issues.length > 0) {
        console.log('[Quality] Issues:');
        score.issues.slice(0, 10).forEach(issue => {
            console.log(`  [${issue.level}] ${issue.message}`);
        });
    }
    if (score.suggestions.length > 0) {
        console.log('[Quality] Suggestions:');
        score.suggestions.forEach(suggestion => {
            console.log(`  - ${suggestion}`);
        });
    }
};
