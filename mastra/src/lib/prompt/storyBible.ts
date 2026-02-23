/**
 * ストーリー設計ヘルパー (Story Bible)
 * 
 * 起承転結の構造に基づき、各スポットの物語的役割と
 * テーマとの関連性を設計するためのヘルパー関数群
 */

import type { SpotCandidate } from '../spotTypes';

export interface StoryBeat {
    spotIndex: number;
    spotName: string;
    role: '起' | '承' | '転' | '結';
    narrativePurpose: string;
    objectiveAction: string;
    emotionalBeat: string;
    tourismHook: string;
    connectionToPrev?: string;
    connectionToNext?: string;
    clueToReveal: string;
    puzzleType: 'discovery' | 'connection' | 'synthesis' | 'conclusion';
}

export interface StoryArc {
    premise: string;
    mystery: string;
    goal: string;
    finalReveal: string;
    thematicMessage: string;
}

/**
 * 起承転結の役割定義
 */
export const STORY_ROLES = {
    '起': {
        narrativePurpose: '物語の導入と謎の提示',
        emotionalBeat: '好奇心の喚起',
        objectivePattern: '事件の入口を発見する',
        puzzleType: 'discovery' as const,
        dialogueTone: '期待感と不思議さ',
        keyActions: ['発見する', '気づく', '出会う', '始まる'],
    },
    '承': {
        narrativePurpose: '手がかりの収集と検証',
        emotionalBeat: '発見の喜びと学び',
        objectivePattern: '情報を集めて検証する',
        puzzleType: 'connection' as const,
        dialogueTone: '分析的で協力的',
        keyActions: ['調べる', '確認する', '照合する', '記録する'],
    },
    '転': {
        narrativePurpose: '視点の転換と新たな気づき',
        emotionalBeat: '驚きと理解の深化',
        objectivePattern: '隠れた関係性を見抜く',
        puzzleType: 'synthesis' as const,
        dialogueTone: '意外性と洞察',
        keyActions: ['見抜く', '気づく', '転換する', '発見する'],
    },
    '結': {
        narrativePurpose: '真相の解明と達成感',
        emotionalBeat: '達成感と余韻',
        objectivePattern: '全てをつなげて結論に至る',
        puzzleType: 'conclusion' as const,
        dialogueTone: '感動と締めくくり',
        keyActions: ['解き明かす', '完成させる', '理解する', '達成する'],
    },
};

/**
 * スポット数に応じた役割配分を決定
 */
export const buildRoleSequence = (spotCount: number): Array<'起' | '承' | '転' | '結'> => {
    if (spotCount <= 1) return ['起'];
    if (spotCount === 2) return ['起', '結'];
    if (spotCount === 3) return ['起', '承', '結'];
    if (spotCount === 4) return ['起', '承', '転', '結'];

    // 5スポット以上: 起 + 承×n + 転 + 結
    const middleCount = spotCount - 3; // 起と結を除いた中間数から転を引く
    const shoCount = Math.ceil(middleCount / 2);
    const tenCount = middleCount - shoCount;

    const roles: Array<'起' | '承' | '転' | '結'> = ['起'];
    for (let i = 0; i < shoCount; i++) roles.push('承');
    for (let i = 0; i < tenCount; i++) roles.push('転');
    roles.push('転'); // 必ず1つは転
    roles.push('結');

    return roles;
};

/**
 * テーマからストーリーアークを生成
 */
export const buildStoryArc = (
    theme: string,
    location: string,
    spotCount: number
): StoryArc => {
    // テーマのキーワードを抽出
    const themeKeywords = theme.replace(/[、。,.!！?？]/g, ' ').split(/\s+/).filter(Boolean);
    const mainTopic = themeKeywords[0] || '街の歴史';

    return {
        premise: `${location}には、${mainTopic}にまつわる隠された物語がある。`,
        mystery: `なぜ${location}に${mainTopic}の痕跡が残されているのか？その真相を探る。`,
        goal: `${spotCount}つのスポットを巡り、${mainTopic}の謎を解き明かす。`,
        finalReveal: `${mainTopic}の真の意味と、この街との深いつながりが明らかになる。`,
        thematicMessage: `${location}を歩くことで、${mainTopic}への理解が深まり、新たな視点を得る。`,
    };
};

/**
 * 各スポットのストーリービートを構築
 */
export const buildStoryBeats = (
    candidates: SpotCandidate[],
    theme: string,
    missionGoal: string,
    spotCount: number
): StoryBeat[] => {
    const roles = buildRoleSequence(spotCount);
    const selected = candidates.slice(0, spotCount);

    return selected.map((spot, index) => {
        const role = roles[index];
        const roleConfig = STORY_ROLES[role];
        const prevSpot = index > 0 ? selected[index - 1] : null;
        const nextSpot = index < selected.length - 1 ? selected[index + 1] : null;

        // 観光情報からフックを生成
        const tourismHook = spot.description?.trim()
            || (spot.kinds ? `${spot.name}は${spot.kinds.split(',')[0]}として知られる` : '')
            || `${spot.name}の雰囲気や歴史`;

        // ミッションと連動した目標アクション
        const objectiveAction = buildObjectiveAction(role, spot.name, tourismHook, missionGoal);

        // 明かすべき手がかり
        const clueToReveal = buildClueToReveal(role, spot, theme, index, spotCount);

        return {
            spotIndex: index,
            spotName: spot.name,
            role,
            narrativePurpose: roleConfig.narrativePurpose,
            objectiveAction,
            emotionalBeat: roleConfig.emotionalBeat,
            tourismHook,
            connectionToPrev: prevSpot
                ? `${prevSpot.name}で得た手がかりを踏まえ、${spot.name}で新たな発見をする`
                : undefined,
            connectionToNext: nextSpot
                ? `${spot.name}での発見が、${nextSpot.name}への探索につながる`
                : `${spot.name}での発見が、最終的な真相解明につながる`,
            clueToReveal,
            puzzleType: roleConfig.puzzleType,
        };
    });
};

/**
 * 役割に応じた目標アクションを生成
 */
const buildObjectiveAction = (
    role: '起' | '承' | '転' | '結',
    spotName: string,
    tourismHook: string,
    missionGoal: string
): string => {
    const roleConfig = STORY_ROLES[role];
    const action = roleConfig.keyActions[Math.floor(Math.random() * roleConfig.keyActions.length)];

    switch (role) {
        case '起':
            return `${spotName}で物語の始まりを${action}。${tourismHook}が最初の手がかりとなる。`;
        case '承':
            return `${spotName}の特徴を${action}。${tourismHook}から情報を積み上げる。`;
        case '転':
            return `${spotName}で新たな視点を${action}。${tourismHook}が意外な事実を示す。`;
        case '結':
            return `${spotName}で全てを${action}。${tourismHook}が${missionGoal}の答えにつながる。`;
    }
};

/**
 * 明かすべき手がかりを生成
 */
const buildClueToReveal = (
    role: '起' | '承' | '転' | '結',
    spot: SpotCandidate,
    theme: string,
    index: number,
    totalSpots: number
): string => {
    const spotFeature = spot.description?.slice(0, 30)
        || spot.kinds?.split(',')[0]
        || spot.name;

    switch (role) {
        case '起':
            return `${spotFeature}が${theme}とどう関係するのか、最初のヒントを発見する`;
        case '承':
            return `${spotFeature}を通じて、${theme}についての理解を深める`;
        case '転':
            return `${spotFeature}から、これまでの推理を覆す新事実が明らかになる`;
        case '結':
            return `${spotFeature}が最後のピースとなり、${theme}の真相が完成する`;
    }
};

/**
 * ストーリービートをプロンプト用テキストに変換
 */
export const storyBeatsToPromptText = (beats: StoryBeat[]): string => {
    return beats.map((beat, index) => {
        const parts = [
            `## スポット${index + 1}: ${beat.spotName}`,
            `- 役割: 【${beat.role}】${beat.narrativePurpose}`,
            `- 目標: ${beat.objectiveAction}`,
            `- 感情: ${beat.emotionalBeat}`,
            `- 観光フック: ${beat.tourismHook}`,
            `- 手がかり: ${beat.clueToReveal}`,
            `- 謎タイプ: ${beat.puzzleType}`,
        ];

        if (beat.connectionToPrev) {
            parts.push(`- 前との関連: ${beat.connectionToPrev}`);
        }
        if (beat.connectionToNext) {
            parts.push(`- 次への布石: ${beat.connectionToNext}`);
        }

        return parts.join('\n');
    }).join('\n\n');
};

/**
 * 謎タイプに応じた出題ガイドラインを生成
 */
export const getPuzzleGuideline = (puzzleType: StoryBeat['puzzleType']): string => {
    switch (puzzleType) {
        case 'discovery':
            return `
        【発見型の謎】
        - このスポットの特徴や由来に基づくシンプルなクイズ
        - 観光情報から直接答えが導ける
        - 難易度: 易しめ。プレイヤーに成功体験を与える
      `;
        case 'connection':
            return `
        【関連型の謎】
        - 前のスポットで得た情報と、今のスポットの情報を組み合わせる
        - 2つ以上の手がかりを照合する必要がある
        - 難易度: 中程度。論理的思考を求める
      `;
        case 'synthesis':
            return `
        【統合型の謎】
        - これまでの複数のスポットから得た情報を統合
        - 視点を変えて再解釈する必要がある
        - 難易度: やや難しい。気づきが必要
      `;
        case 'conclusion':
            return `
        【結論型の謎】
        - 全スポットの情報を総合して最終的な答えを導く
        - ミッション（クエストのゴール）に直接つながる
        - 難易度: 達成感を伴う。全てがつながる感動を演出
      `;
    }
};
