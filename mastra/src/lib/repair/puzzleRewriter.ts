/**
 * 完全リライト型 謎強化モジュール
 * 
 * AIが生成した低品質な謎を、完全に書き換える
 * 選択肢がない問題、意味不明な問題を検出して修正
 */

import { QuestOutput } from '../../schemas/quest';
import type { QuestRequestContext } from '../questValidation';
import { CAUSAL_MARKERS } from '../questValidation';

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

/**
 * 謎に問題があるかチェック
 */
const hasPuzzleProblems = (
    question: string,
    answer: string,
    hint: string,
    explanation: string
): { hasProblem: boolean; reasons: string[] } => {
    const reasons: string[] = [];

    // 質問文が短すぎる
    if (!question || question.length < 12) {
        reasons.push('質問文が短すぎる');
    }

    // 「どれ」「どちら」を問うが選択肢がない
    if (question.includes('どれ') || question.includes('どちら') || question.includes('どの')) {
        if (!question.includes('1.') && !question.includes('①') && !question.includes('A.')) {
            reasons.push('選択肢がない問題');
        }
    }

    // 同じ文が繰り返されている
    const sentences = question.split(/[。、,.!！?？]/);
    const uniqueSentences = new Set(sentences.filter(s => s.length > 10));
    if (sentences.length > 2 && uniqueSentences.size < sentences.length * 0.5) {
        reasons.push('同じ文の繰り返し');
    }

    // 回答が空または短すぎる
    if (!answer || answer.length < 2) {
        reasons.push('回答が短すぎる');
    }

    // ヒントが空
    if (!hint || hint.length < 5) {
        reasons.push('ヒントが短すぎる');
    }

    // 解説に因果マーカーがない
    if (!explanation || !CAUSAL_MARKERS.some((m: string) => explanation.includes(m))) {
        reasons.push('解説に因果関係がない');
    }

    // 現地観察を必要とする
    const onsiteTerms = ['現地', '看板', '掲示', '外観', '目の前', '今日'];
    if (onsiteTerms.some(term => question.includes(term))) {
        reasons.push('現地観察が必要');
    }

    return {
        hasProblem: reasons.length > 0,
        reasons,
    };
};

/**
 * スポット名からキーワードを抽出
 */
const extractKeyword = (spotName: string): string => {
    // 括弧内を除去
    const clean = spotName.replace(/[（(][^)）]*[)）]/g, '').trim();
    // 区切り文字で分割
    const parts = clean.split(/[・、,\s]+/).filter(p => p.length >= 2);
    return parts[0]?.slice(0, 6) || spotName.slice(0, 4);
};

/**
 * 観光情報からキーワードを抽出
 */
const extractTourismKeywords = (anchor: string): string[] => {
    return anchor
        .replace(/[。、,.!！?？]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && w.length <= 10)
        .slice(0, 3);
};

interface PuzzleContext {
    spotName: string;
    spotIndex: number;
    totalSpots: number;
    tourismAnchor: string;
    sceneRole: string;
    missionGoal: string;
    prevClues: string[];
}

/**
 * 【起】用の謎を生成 - シンプルな連想問題
 */
const generateKiPuzzle = (ctx: PuzzleContext): {
    question: string;
    answer: string;
    hint: string;
    explanation: string;
} => {
    const keyword = extractKeyword(ctx.spotName);
    const tourismKws = extractTourismKeywords(ctx.tourismAnchor);
    const shortTourism = ctx.tourismAnchor.slice(0, 30);

    return {
        question: `手がかり：「${ctx.spotName}」「${shortTourism}」「${tourismKws[0] || '歴史'}」。これらから連想される場所の名前は？`,
        answer: keyword,
        hint: `3つの手がかりに共通するキーワードを探してください。${ctx.spotName.slice(0, 4)}に注目。`,
        explanation: `答えは「${keyword}」です。理由は、「${ctx.spotName}」は「${shortTourism}」として知られており、${tourismKws[0] || 'その特徴'}が手がかりになるからです。`,
    };
};

/**
 * 【承】用の謎を生成 - 情報を組み合わせる問題
 */
const generateShoPuzzle = (ctx: PuzzleContext): {
    question: string;
    answer: string;
    hint: string;
    explanation: string;
} => {
    const keyword = extractKeyword(ctx.spotName);
    const shortTourism = ctx.tourismAnchor.slice(0, 30);
    const prevClue = ctx.prevClues[ctx.prevClues.length - 1] || '前の発見';

    return {
        question: `前のスポットで判明した「${prevClue.slice(0, 15)}」と、ここ「${ctx.spotName}」の特徴「${shortTourism}」。共通するキーワードは？`,
        answer: keyword,
        hint: `${ctx.spotName.slice(0, 5)}と${prevClue.slice(0, 5)}に共通するものを考えてください。`,
        explanation: `答えは「${keyword}」です。「${prevClue.slice(0, 15)}」と「${shortTourism}」は、どちらも${keyword}に関連しているからです。`,
    };
};

/**
 * 【転】用の謎を生成 - 視点を変える問題
 */
const generateTenPuzzle = (ctx: PuzzleContext): {
    question: string;
    answer: string;
    hint: string;
    explanation: string;
} => {
    const keyword = extractKeyword(ctx.spotName);
    const shortTourism = ctx.tourismAnchor.slice(0, 30);
    const clueList = ctx.prevClues.slice(-2).map(c => c.slice(0, 10)).join('、') || '今までの発見';

    return {
        question: `これまでの手がかり「${clueList}」と、「${ctx.spotName}」の特徴を統合すると、新たに見えてくることがあります。それは何でしょう？`,
        answer: keyword,
        hint: `今までの情報を別の角度から見直してください。${ctx.spotName.slice(0, 5)}がカギです。`,
        explanation: `答えは「${keyword}」です。理由は、これまでの手がかりと「${shortTourism}」を組み合わせると、${keyword}という共通点が浮かび上がるからです。`,
    };
};

/**
 * 【結】用の謎を生成 - 総合問題
 */
const generateKetsuPuzzle = (ctx: PuzzleContext): {
    question: string;
    answer: string;
    hint: string;
    explanation: string;
} => {
    const keyword = extractKeyword(ctx.spotName);
    const shortTourism = ctx.tourismAnchor.slice(0, 25);
    const clueList = ctx.prevClues.slice(-3).map(c => c.slice(0, 8)).join('、') || '全ての手がかり';
    const missionShort = ctx.missionGoal.slice(0, 15);

    return {
        question: `「${missionShort}」を解き明かす最終問題。手がかり「${clueList}」と「${shortTourism}」から導かれる答えは？`,
        answer: keyword,
        hint: `全てのスポットで得た情報を総合してください。「${missionShort}」の核心を考えましょう。`,
        explanation: `答えは「${keyword}」です。これまでの全ての手がかりと「${shortTourism}」を統合すると、${keyword}が「${missionShort}」の答えとして導かれます。`,
    };
};

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
 * クエスト全体の謎を完全リライト
 * 問題がある謎のみを書き換え
 */
export const rewriteQuestPuzzles = (
    quest: QuestOutput,
    context: QuestRequestContext
): { output: QuestOutput; updated: boolean; rewrittenSpots: number[] } => {
    const next = JSON.parse(JSON.stringify(quest)) as QuestOutput;
    const spots = next.creator_payload?.spots || [];
    const missionGoal = next.player_preview?.mission
        || next.creator_payload?.main_plot?.goal
        || '謎を解き明かす';
    const rewrittenSpots: number[] = [];
    let updated = false;

    const prevClues: string[] = [];

    spots.forEach((spot, index) => {
        const check = hasPuzzleProblems(
            spot.question_text || '',
            spot.answer_text || '',
            spot.hint_text || '',
            spot.explanation_text || ''
        );

        if (check.hasProblem) {
            const roleKey = resolveRoleKey(spot.scene_role);

            const ctx: PuzzleContext = {
                spotName: spot.spot_name || 'このスポット',
                spotIndex: index,
                totalSpots: spots.length,
                tourismAnchor: spot.scene_tourism_anchor || spot.spot_name || '',
                sceneRole: spot.scene_role || '承',
                missionGoal,
                prevClues: [...prevClues],
            };

            let newPuzzle: { question: string; answer: string; hint: string; explanation: string };
            switch (roleKey) {
                case '起': newPuzzle = generateKiPuzzle(ctx); break;
                case '承': newPuzzle = generateShoPuzzle(ctx); break;
                case '転': newPuzzle = generateTenPuzzle(ctx); break;
                case '結': newPuzzle = generateKetsuPuzzle(ctx); break;
            }

            spot.question_text = newPuzzle.question;
            spot.answer_text = newPuzzle.answer;
            spot.hint_text = newPuzzle.hint;
            spot.explanation_text = newPuzzle.explanation;

            rewrittenSpots.push(index);
            updated = true;

            console.log(`[PuzzleRewriter] Spot ${index + 1} rewritten. Reasons: ${check.reasons.join(', ')}`);
        }

        // 次のスポット用に情報を蓄積
        prevClues.push(spot.scene_tourism_anchor || spot.spot_name);
    });

    return { output: next, updated, rewrittenSpots };
};
