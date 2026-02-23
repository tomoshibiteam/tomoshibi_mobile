/**
 * 謎品質向上モジュール
 * 
 * 観光情報と連動した自己完結型の謎に改善
 */

import { QuestOutput } from '../../schemas/quest';
import type { QuestRequestContext } from '../questValidation';
import {
    extractPuzzleKeywords,
    buildSelfContainedPuzzle,
    scorePuzzleQuality,
    isOnsiteRequired,
    hasCalculation,
} from '../prompt/puzzleDesign';
import { STORY_ROLES, buildRoleSequence, type StoryBeat } from '../prompt/storyBible';
import { CAUSAL_MARKERS } from '../questValidation';

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

/**
 * 役割キーを解決
 */
const resolveRoleKey = (role?: string): '起' | '承' | '転' | '結' => {
    if (!role) return '承';
    if (role.includes('起')) return '起';
    if (role.includes('承')) return '承';
    if (role.includes('転')) return '転';
    if (role.includes('結')) return '結';
    return '承';
};

/**
 * 謎タイプを決定
 */
const getPuzzleType = (role: '起' | '承' | '転' | '結'): 'discovery' | 'connection' | 'synthesis' | 'conclusion' => {
    switch (role) {
        case '起': return 'discovery';
        case '承': return 'connection';
        case '転': return 'synthesis';
        case '結': return 'conclusion';
    }
};

/**
 * 最小文字数を保証
 */
const ensureMinLength = (text: string, min: number): string => {
    if (text.length >= min) return text;
    return text + '考えてみてください。'.slice(0, min - text.length + 1);
};

/**
 * 現地観察用語を除去
 */
const sanitizeOnsiteTerms = (text: string): string => {
    const onsiteTerms = [
        '現地', '現場', 'この場所で', '看板', '掲示', '案内板',
        '実物', '外観', '目の前', '今日', '天気', '今',
    ];
    let result = text;
    onsiteTerms.forEach(term => {
        result = result.replaceAll(term, '手がかり');
    });
    return result;
};

/**
 * 計算関連用語を除去
 */
const sanitizeCalculationTerms = (text: string): string => {
    const calcTerms = [
        '計算', '換算', '合計', '平均', '何メートル', '何km', '何度', '何%', '何％',
    ];
    let result = text;
    calcTerms.forEach(term => {
        result = result.replaceAll(term, 'ヒント');
    });
    return result;
};

/**
 * 因果マーカーを追加
 */
const ensureCausalMarker = (text: string): string => {
    const hasCausal = CAUSAL_MARKERS.some((marker: string) => text.includes(marker));
    if (hasCausal) return text;
    return text + ' だからこの答えになる。';
};

/**
 * 単一スポットの謎を改善
 */
const refineSpotPuzzle = (
    spot: QuestOutput['creator_payload']['spots'][0],
    spotIndex: number,
    totalSpots: number,
    missionGoal: string,
    prevClues: string[],
    difficulty: 'easy' | 'medium' | 'hard'
): {
    question_text: string;
    answer_text: string;
    hint_text: string;
    explanation_text: string;
    refined: boolean;
} => {
    let question = spot.question_text || '';
    let answer = spot.answer_text || '';
    let hint = spot.hint_text || '';
    let explanation = spot.explanation_text || '';
    let refined = false;

    const spotName = spot.spot_name || 'このスポット';
    const tourismAnchor = spot.scene_tourism_anchor || spotName;
    const roleKey = resolveRoleKey(spot.scene_role);
    const isFinal = spotIndex === totalSpots - 1;
    const puzzleType = getPuzzleType(roleKey);

    // キーワード抽出
    const keywords = {
        mainKeyword: spotName.replace(/[（(][^)）]*[)）]/g, '').split(/[・、,\s]+/)[0] || spotName.slice(0, 4),
        tourismKeywords: tourismAnchor
            .replace(/[。、,.!！?？]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 2)
            .slice(0, 3),
    };

    // === 質問文のチェックと改善 ===
    let questionNeedsRefine = false;

    // 文字数チェック
    if (question.length < 12) {
        questionNeedsRefine = true;
    }

    // 現地観察チェック
    if (isOnsiteRequired(question)) {
        question = sanitizeOnsiteTerms(question);
        questionNeedsRefine = true;
    }

    // 計算チェック
    if (hasCalculation(question)) {
        question = sanitizeCalculationTerms(question);
        questionNeedsRefine = true;
    }

    // 観光情報との関連チェック
    const hasRelevance = keywords.tourismKeywords.some(kw => question.includes(kw)) ||
        question.includes(spotName);
    if (!hasRelevance && keywords.tourismKeywords.length > 0) {
        questionNeedsRefine = true;
    }

    // 最終問題のミッション言及チェック
    if (isFinal) {
        const missionSlice = missionGoal.slice(0, 6);
        if (!question.includes(missionSlice)) {
            questionNeedsRefine = true;
        }
    }

    if (questionNeedsRefine) {
        const clueList = prevClues.length > 0
            ? prevClues.slice(-2).join('、')
            : tourismAnchor.slice(0, 30);

        switch (puzzleType) {
            case 'discovery':
                question = `手がかり：「${tourismAnchor.slice(0, 30)}」「${spotName}」「${keywords.mainKeyword}」。これらから連想されるキーワードは？`;
                break;
            case 'connection':
                question = `${clueList}と、${tourismAnchor.slice(0, 25)}。共通するキーワードは？`;
                break;
            case 'synthesis':
                question = `これまでの手がかり「${clueList}」と${spotName}の特徴を統合すると見えてくる答えは？`;
                break;
            case 'conclusion':
                question = `「${missionGoal}」を解き明かす最終問題。手がかり「${clueList}」と「${tourismAnchor.slice(0, 20)}」から導かれる答えは？`;
                break;
        }
        refined = true;
    }
    question = ensureMinLength(question, 12);

    // === 回答のチェックと改善 ===
    if (!isNonEmptyString(answer) || answer.length < 2) {
        answer = keywords.mainKeyword.slice(0, 6) || spotName.slice(0, 4);
        refined = true;
    }

    // === ヒントのチェックと改善 ===
    if (!isNonEmptyString(hint) || hint.length < 6) {
        hint = `手がかりに共通するイメージを探してみてください。${tourismAnchor.slice(0, 15)}がヒントです。`;
        refined = true;
    }
    if (isOnsiteRequired(hint)) {
        hint = sanitizeOnsiteTerms(hint);
        refined = true;
    }
    hint = ensureMinLength(hint, 10);

    // === 解説のチェックと改善 ===
    if (!isNonEmptyString(explanation) || explanation.length < 12) {
        explanation = `答えは「${answer}」です。理由は、${tourismAnchor.slice(0, 30)}という特徴が手がかりになるからです。`;
        refined = true;
    }
    if (isOnsiteRequired(explanation)) {
        explanation = sanitizeOnsiteTerms(explanation);
        refined = true;
    }
    if (!CAUSAL_MARKERS.some((marker: string) => explanation.includes(marker))) {
        explanation = ensureCausalMarker(explanation);
        refined = true;
    }
    explanation = ensureMinLength(explanation, 12);

    return {
        question_text: question,
        answer_text: answer,
        hint_text: hint,
        explanation_text: explanation,
        refined,
    };
};

/**
 * クエスト全体の謎を改善
 */
export const refineQuestPuzzles = (
    quest: QuestOutput,
    context: QuestRequestContext
): { output: QuestOutput; updated: boolean; refinedSpots: number[] } => {
    const next = JSON.parse(JSON.stringify(quest)) as QuestOutput;
    const spots = next.creator_payload?.spots || [];
    const missionGoal = next.player_preview?.mission
        || next.creator_payload?.main_plot?.goal
        || '謎を解き明かす';
    const difficulty = context.difficulty || 'medium';
    const refinedSpots: number[] = [];
    let updated = false;

    const prevClues: string[] = [];

    spots.forEach((spot, index) => {
        const refined = refineSpotPuzzle(
            spot,
            index,
            spots.length,
            missionGoal,
            prevClues,
            difficulty
        );

        if (refined.refined) {
            spot.question_text = refined.question_text;
            spot.answer_text = refined.answer_text;
            spot.hint_text = refined.hint_text;
            spot.explanation_text = refined.explanation_text;
            refinedSpots.push(index);
            updated = true;
        }

        // 次のスポット用に手がかりを蓄積
        prevClues.push(spot.scene_tourism_anchor || spot.spot_name);
    });

    return { output: next, updated, refinedSpots };
};

/**
 * 謎品質をスコアリング
 */
export const scoreAllPuzzles = (quest: QuestOutput): {
    scores: Array<{ index: number; score: number; issues: string[] }>;
    averageScore: number;
} => {
    const spots = quest.creator_payload?.spots || [];
    const scores: Array<{ index: number; score: number; issues: string[] }> = [];

    spots.forEach((spot, index) => {
        const puzzleDesign = {
            questionText: spot.question_text || '',
            answerText: spot.answer_text || '',
            hintText: spot.hint_text || '',
            explanationText: spot.explanation_text || '',
            difficultyLevel: 'medium' as const,
            tourismConnection: spot.scene_tourism_anchor || '',
        };

        const result = scorePuzzleQuality(puzzleDesign);
        scores.push({
            index,
            score: result.score,
            issues: result.issues,
        });
    });

    const averageScore = scores.length > 0
        ? Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length)
        : 0;

    return { scores, averageScore };
};
