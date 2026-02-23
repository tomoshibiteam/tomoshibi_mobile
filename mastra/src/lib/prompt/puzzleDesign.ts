/**
 * 謎デザインヘルパー
 * 
 * 観光情報と連動した自己完結型の謎を設計するためのヘルパー関数群
 */

import type { SpotCandidate } from '../spotTypes';
import type { StoryBeat } from './storyBible';

export interface PuzzleDesign {
    questionText: string;
    answerText: string;
    hintText: string;
    explanationText: string;
    difficultyLevel: 'easy' | 'medium' | 'hard';
    tourismConnection: string;
}

export interface PuzzleContext {
    spotName: string;
    tourismAnchor: string;
    sceneRole: '起' | '承' | '転' | '結';
    prevSpots: Array<{ name: string; clue: string }>;
    missionGoal: string;
    difficulty: 'easy' | 'medium' | 'hard';
}

/**
 * 謎のパターン定義
 */
export const PUZZLE_PATTERNS = {
    /**
     * 発見型: 観光情報から直接答えが導ける
     */
    discovery: [
        {
            templateQ: '${spotName}は${tourismFeature}として知られています。この場所の名前に含まれる、${hint}を表す言葉は何でしょう？',
            templateH: '${spotName}という名前をよく見てください。${keywordHint}が隠れています。',
            templateE: '答えは「${answer}」です。${tourismAnchor}から、${reason}という理由で導けます。',
        },
        {
            templateQ: '${tourismAnchor}について、${specificFact}と言われています。${questionFocus}は何でしょう？',
            templateH: '${tourismFeature}に関連するキーワードを思い出してください。',
            templateE: '正解は「${answer}」。${tourismAnchor}の特徴である${reason}が手がかりでした。',
        },
    ],
    /**
     * 関連型: 複数の情報を組み合わせる
     */
    connection: [
        {
            templateQ: '${prevSpotName}で見つけた「${prevClue}」と、${spotName}の「${currentFeature}」には共通点があります。それは何でしょう？',
            templateH: '両方の場所に共通するテーマやキーワードを探してみてください。',
            templateE: '答えは「${answer}」。${prevClue}と${currentFeature}は、${connectionReason}という点で関連していたのです。',
        },
        {
            templateQ: 'これまでの探索で、${prevSpotName}では${prevClue}を、そして${spotName}では${currentFeature}を発見しました。この2つをつなげるキーワードは？',
            templateH: '${prevSpotName}と${spotName}の共通点を考えてみましょう。',
            templateE: '正解は「${answer}」です。${connectionReason}という関連性がありました。',
        },
    ],
    /**
     * 統合型: 視点を変えて再解釈
     */
    synthesis: [
        {
            templateQ: 'ここまでの手がかり「${clueList}」を踏まえると、${question}について新たな視点が見えてきます。隠されていた真実は何でしょう？',
            templateH: '今までの手がかりを別の角度から見てみてください。${synthesisFocus}がポイントです。',
            templateE: '答えは「${answer}」。${clueList}を組み合わせると、${synthesisReason}ということが分かります。',
        },
    ],
    /**
     * 結論型: ミッションへの最終回答
     */
    conclusion: [
        {
            templateQ: '${missionGoal}を解き明かす最後の謎です。${allClues}という手がかりから導かれる答えは何でしょう？',
            templateH: '全てのスポットで得た情報を総合してください。${missionGoal}の核心を考えましょう。',
            templateE: '答えは「${answer}」。${conclusionReason}という理由で、${missionGoal}の真相が明らかになりました。',
        },
    ],
};

/**
 * スポット情報から謎設計のキーワードを抽出
 */
export const extractPuzzleKeywords = (spot: SpotCandidate): {
    mainKeyword: string;
    subKeywords: string[];
    category: string;
    features: string[];
} => {
    const name = spot.name || '';
    const description = spot.description || '';
    const kinds = spot.kinds || '';
    const address = spot.address || '';

    // 名前からキーワード抽出
    const nameTokens = name
        .replace(/[（(][^)）]*[)）]/g, '')
        .split(/[・、,\s]+/)
        .filter(t => t.length >= 2);

    // カテゴリ抽出
    const category = kinds.split(',')[0]?.trim() || '観光スポット';

    // 説明文からキーワード抽出
    const descKeywords = description
        .replace(/[。、,.!！?？]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 3 && t.length <= 10);

    return {
        mainKeyword: nameTokens[0] || name.slice(0, 4),
        subKeywords: [...new Set([...nameTokens.slice(1), ...descKeywords.slice(0, 3)])],
        category,
        features: [
            description.slice(0, 50),
            category,
            address ? `${address}にある` : '',
        ].filter(Boolean),
    };
};

/**
 * 観光情報を活用した謎のテーマを生成
 */
export const generatePuzzleTheme = (
    spot: SpotCandidate,
    sceneRole: '起' | '承' | '転' | '結',
    missionGoal: string
): {
    question: string;
    answer: string;
    reason: string;
} => {
    const keywords = extractPuzzleKeywords(spot);
    const tourismAnchor = spot.description?.slice(0, 60)
        || `${spot.name}は${keywords.category}として知られる`;

    // 役割に応じた謎のフォーカス
    switch (sceneRole) {
        case '起':
            return {
                question: `${spot.name}の特徴を表すキーワード`,
                answer: keywords.mainKeyword,
                reason: `${tourismAnchor}から導かれる`,
            };
        case '承':
            return {
                question: `${spot.name}と${missionGoal}の関連`,
                answer: keywords.subKeywords[0] || keywords.mainKeyword,
                reason: `${keywords.category}としての特徴が示す`,
            };
        case '転':
            return {
                question: `これまでの手がかりと${spot.name}から見える新たな視点`,
                answer: keywords.mainKeyword,
                reason: `${tourismAnchor}が新しい気づきを与える`,
            };
        case '結':
            return {
                question: `${missionGoal}の最終的な答え`,
                answer: keywords.mainKeyword,
                reason: `全てのスポットの情報を統合すると${tourismAnchor}が結論を導く`,
            };
    }
};

/**
 * 自己完結型の謎テキストを生成
 */
export const buildSelfContainedPuzzle = (
    spot: SpotCandidate,
    storyBeat: StoryBeat,
    prevClues: string[],
    missionGoal: string,
    difficulty: 'easy' | 'medium' | 'hard'
): PuzzleDesign => {
    const keywords = extractPuzzleKeywords(spot);
    const tourismAnchor = storyBeat.tourismHook || spot.description || `${spot.name}の特徴`;

    // 謎タイプに応じたパターン選択
    const patterns = PUZZLE_PATTERNS[storyBeat.puzzleType];
    const pattern = patterns[0]; // 基本パターンを使用

    // 手がかりリストの構築
    const clueList = prevClues.length > 0
        ? prevClues.slice(-3).join('、')
        : tourismAnchor.slice(0, 30);

    // 難易度に応じた調整
    const difficultyAdjust = {
        easy: { hintDetail: '詳しい', answerLength: 'short' },
        medium: { hintDetail: '適度な', answerLength: 'medium' },
        hard: { hintDetail: '控えめな', answerLength: 'long' },
    }[difficulty];

    // 観光情報から答えを導出
    const answer = keywords.mainKeyword || spot.name.slice(0, 4);

    // 質問文の構築
    let questionText: string;
    switch (storyBeat.puzzleType) {
        case 'discovery':
            questionText = `手がかり：「${tourismAnchor.slice(0, 40)}」、「${spot.name}」、「${keywords.category}」。これらから連想されるキーワードは何でしょう？`;
            break;
        case 'connection':
            questionText = `${clueList}と、${tourismAnchor.slice(0, 30)}。これらに共通するキーワードは何でしょう？`;
            break;
        case 'synthesis':
            questionText = `これまでの手がかり「${clueList}」と、${spot.name}の特徴「${tourismAnchor.slice(0, 30)}」を統合すると見えてくる答えは？`;
            break;
        case 'conclusion':
            questionText = `${missionGoal}を解き明かす最終問題。手がかり「${clueList}」と「${tourismAnchor.slice(0, 30)}」から導かれる答えは？`;
            break;
    }

    // ヒント文の構築
    const hintText = `手がかりに共通するイメージを探してみてください。${tourismAnchor.slice(0, 20)}がヒントです。`;

    // 解説文の構築（因果マーカー必須）
    const explanationText = `答えは「${answer}」です。理由は、${tourismAnchor.slice(0, 40)}という特徴が${storyBeat.objectiveAction.slice(0, 30)}につながるからです。`;

    return {
        questionText: ensureMinLength(questionText, 12),
        answerText: answer,
        hintText: ensureMinLength(hintText, 10),
        explanationText: ensureMinLength(explanationText, 20),
        difficultyLevel: difficulty,
        tourismConnection: tourismAnchor,
    };
};

/**
 * 最小文字数を保証
 */
const ensureMinLength = (text: string, min: number): string => {
    if (text.length >= min) return text;
    return text + '考えてみてください。'.slice(0, min - text.length);
};

/**
 * 現地観察を必要としないか検証
 */
export const isOnsiteRequired = (text: string): boolean => {
    const onsiteTerms = [
        '現地', '現場', 'この場所で', '看板', '掲示', '案内板',
        '実物', '外観', '目の前', '今', '今日', '天気',
    ];
    return onsiteTerms.some(term => text.includes(term));
};

/**
 * 計算問題を含まないか検証
 */
export const hasCalculation = (text: string): boolean => {
    const calcTerms = [
        '計算', '換算', '合計', '平均', '何メートル', '何km',
        '何度', '何%', '何％',
    ];
    const calcPattern = /[0-9０-９]+(?:\.[0-9]+)?\s*(m|cm|km|度|%|％)/i;
    return calcTerms.some(term => text.includes(term)) || calcPattern.test(text);
};

/**
 * 謎品質のスコアリング
 */
export const scorePuzzleQuality = (puzzle: PuzzleDesign): {
    score: number;
    issues: string[];
} => {
    const issues: string[] = [];
    let score = 100;

    // 質問文チェック
    if (puzzle.questionText.length < 12) {
        issues.push('質問文が短すぎます');
        score -= 20;
    }
    if (isOnsiteRequired(puzzle.questionText)) {
        issues.push('質問文が現地観察を必要としています');
        score -= 30;
    }
    if (hasCalculation(puzzle.questionText)) {
        issues.push('質問文に計算が含まれています');
        score -= 20;
    }

    // 解説文チェック
    const causalMarkers = ['だから', '理由', 'つまり', 'ゆえに', '手がかり'];
    if (!causalMarkers.some(m => puzzle.explanationText.includes(m))) {
        issues.push('解説文に因果マーカーがありません');
        score -= 15;
    }

    // 観光情報との関連チェック
    if (!puzzle.tourismConnection || puzzle.tourismConnection.length < 10) {
        issues.push('観光情報との関連が薄いです');
        score -= 10;
    }

    return { score: Math.max(0, score), issues };
};
