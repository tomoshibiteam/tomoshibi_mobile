/**
 * 会話品質向上モジュール
 * 
 * NPCパターンとストーリービブルを活用して、
 * 機械的なフィラーではなく文脈に即した会話を生成
 */

import { QuestOutput } from '../../schemas/quest';
import type { QuestRequestContext } from '../questValidation';
import {
    DEFAULT_NPC_PROFILES,
    generateDialogueSet,
    generateDialogueLine,
    interpolateTemplate,
    NPC_DIALOGUE_TEMPLATES,
    type DialogueContext,
    type DialoguePhase,
} from '../prompt/npcPatterns';
import { STORY_ROLES, buildRoleSequence } from '../prompt/storyBible';

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

type ExpressionType = 'neutral' | 'smile' | 'serious' | 'surprise' | 'excited';

interface DialogueLine {
    character_id: string;
    text: string;
    expression?: ExpressionType;
}

/**
 * ダイアログコンテキストを構築
 */
const buildDialogueContext = (
    quest: QuestOutput,
    spotIndex: number,
    playerName?: string
): DialogueContext => {
    const spots = quest.creator_payload?.spots || [];
    const spot = spots[spotIndex];
    const prevSpot = spotIndex > 0 ? spots[spotIndex - 1] : null;

    const missionGoal = quest.player_preview?.mission
        || quest.creator_payload?.main_plot?.goal
        || '謎を解き明かす';

    return {
        spotName: spot?.spot_name || 'このスポット',
        spotIndex,
        totalSpots: spots.length,
        tourismAnchor: spot?.scene_tourism_anchor || spot?.spot_name || '',
        sceneRole: spot?.scene_role || '承',
        sceneObjective: spot?.scene_objective || '手がかりを探す',
        playerName: playerName || '君',
        prevSpotName: prevSpot?.spot_name,
        prevClue: prevSpot?.scene_objective,
        missionGoal,
        specificDetail: spot?.scene_tourism_anchor?.slice(0, 20),
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
 * 会話行を作成
 */
const createDialogueLine = (
    characterId: string,
    text: string,
    expression: 'neutral' | 'smile' | 'serious' | 'surprise' | 'excited' = 'neutral'
): DialogueLine => ({
    character_id: characterId,
    text: text.slice(0, 60),
    expression,
});

/**
 * pre_mission_dialogue を強化
 */
const enhancePreMissionDialogue = (
    existingDialogue: DialogueLine[],
    context: DialogueContext,
    characters: Array<{ id: string; name: string; role: string }>,
    minLines: number = 10
): DialogueLine[] => {
    const result: DialogueLine[] = [...(existingDialogue || [])];
    const npcIds = characters.map(c => c.id).filter(id => id !== 'player');
    const roleKey = resolveRoleKey(context.sceneRole);
    const roleConfig = STORY_ROLES[roleKey];

    if (npcIds.length === 0) {
        npcIds.push('char_1', 'char_2', 'char_3', 'char_4');
    }

    // 既存の発言者を確認
    const existingSpeakers = new Set(result.map(line => line.character_id));
    const existingTexts = result.map(line => line.text || '').join(' ');

    // スポット名の言及チェック
    if (!existingTexts.includes(context.spotName) && context.spotName.length > 1) {
        const intro = generateDialogueLine(npcIds[0], 'intro', context, 0);
        result.push(createDialogueLine(npcIds[0], intro, 'smile'));
    }

    // 観光情報の言及チェック
    const tourismKeywords = context.tourismAnchor
        .replace(/[。、,.!！?？]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3)
        .slice(0, 2);

    const hasTourismMention = tourismKeywords.some(kw => existingTexts.includes(kw));
    if (!hasTourismMention && tourismKeywords.length > 0) {
        const observation = generateDialogueLine(npcIds[1] || npcIds[0], 'observation', context, 1);
        result.push(createDialogueLine(npcIds[1] || npcIds[0], observation));
    }

    // 前スポットとの関連（2スポット目以降）
    if (context.spotIndex > 0 && context.prevSpotName) {
        const hasPrevReference = ['さっき', '前の', '先ほど', context.prevSpotName.slice(0, 3)]
            .some(term => existingTexts.includes(term));

        if (!hasPrevReference) {
            const connection = generateDialogueLine(npcIds[2] || npcIds[0], 'connection', context, 2);
            result.push(createDialogueLine(npcIds[2] || npcIds[0], connection));
        }
    }

    // プレイヤー名の呼びかけチェック
    if (context.playerName && !existingTexts.includes(context.playerName)) {
        const playerCallout = `${context.playerName}、ここでの調査を始めよう。`;
        result.push(createDialogueLine(npcIds[3] || npcIds[0], playerCallout, 'smile'));
    }

    // 役割に応じたキーワードチェック
    const roleKeywords = roleConfig.keyActions.slice(0, 2);
    const hasRoleKeyword = roleKeywords.some(kw => existingTexts.includes(kw));
    if (!hasRoleKeyword) {
        const roleText = `${roleConfig.emotionalBeat}を大切に、${roleKeywords[0]}していこう。`;
        result.push(createDialogueLine(npcIds[1] || npcIds[0], roleText));
    }

    // 最低ライン数を確保
    let fillIndex = 0;
    const fillerTemplates = [
        `${context.tourismAnchor.slice(0, 20)}に注目して。`,
        `${context.sceneObjective}が今回のポイントだ。`,
        `この場所の雰囲気をよく感じ取って。`,
        `手がかりは必ずある。探してみよう。`,
    ];

    while (result.length < minLines) {
        const speakerIdx = fillIndex % npcIds.length;
        const template = fillerTemplates[fillIndex % fillerTemplates.length];
        result.push(createDialogueLine(npcIds[speakerIdx], template));
        fillIndex++;
    }

    // 発言者の多様性確保
    const finalSpeakers = new Set(result.map(line => line.character_id));
    if (finalSpeakers.size < 2 && npcIds.length >= 2) {
        const secondSpeaker = npcIds.find(id => !finalSpeakers.has(id)) || npcIds[1];
        result.push(createDialogueLine(secondSpeaker, '情報を整理しておくね。'));
    }

    return result.slice(0, 12);
};

/**
 * post_mission_dialogue を強化
 */
const enhancePostMissionDialogue = (
    existingDialogue: DialogueLine[],
    context: DialogueContext,
    characters: Array<{ id: string; name: string; role: string }>,
    minLines: number = 6
): DialogueLine[] => {
    const result: DialogueLine[] = [...(existingDialogue || [])];
    const npcIds = characters.map(c => c.id).filter(id => id !== 'player');
    const roleKey = resolveRoleKey(context.sceneRole);
    const isFinal = context.spotIndex === context.totalSpots - 1;

    if (npcIds.length === 0) {
        npcIds.push('char_1', 'char_2', 'char_3', 'char_4');
    }

    const existingTexts = result.map(line => line.text || '').join(' ');

    // 達成リアクション
    const successTerms = ['すごい', 'さすが', 'やった', '正解', '素晴らしい'];
    const hasSuccess = successTerms.some(term => existingTexts.includes(term));
    if (!hasSuccess) {
        const reaction = generateDialogueLine(npcIds[0], 'puzzle_reaction', context, 0);
        result.push(createDialogueLine(npcIds[0], reaction, 'excited'));
    }

    // プレイヤー名での称賛
    if (context.playerName && !existingTexts.includes(context.playerName)) {
        result.push(createDialogueLine(
            npcIds[1] || npcIds[0],
            `${context.playerName}、見事だったよ！`,
            'smile'
        ));
    }

    // 手がかりのまとめ
    const summaryTerms = ['手がかり', '分かった', 'つまり', '整理'];
    const hasSummary = summaryTerms.some(term => existingTexts.includes(term));
    if (!hasSummary) {
        result.push(createDialogueLine(
            npcIds[2] || npcIds[0],
            `${context.tourismAnchor.slice(0, 15)}が重要な手がかりだった。`
        ));
    }

    // ファイナルスポットか否かで変化
    if (isFinal) {
        const hasConclusion = ['真相', '解決', 'クリア', '完了', 'ミッション'].some(
            term => existingTexts.includes(term)
        );
        if (!hasConclusion) {
            result.push(createDialogueLine(
                npcIds[0],
                `${context.missionGoal}、見事に達成だ！`,
                'excited'
            ));
            result.push(createDialogueLine(
                npcIds[3] || npcIds[1],
                'みんなで協力した成果だね。お疲れ様！',
                'smile'
            ));
        }
    } else {
        // 次へのトランジション
        const transition = generateDialogueLine(npcIds[3] || npcIds[0], 'transition', context, 3);
        result.push(createDialogueLine(npcIds[3] || npcIds[0], transition, 'smile'));
    }

    // 最低ライン数確保
    const fillerTemplates = [
        'ここでの発見を次に活かそう。',
        '順調に進んでいるね。',
        '次も期待しているよ。',
    ];

    let fillIndex = 0;
    while (result.length < minLines) {
        const speakerIdx = fillIndex % npcIds.length;
        const template = fillerTemplates[fillIndex % fillerTemplates.length];
        result.push(createDialogueLine(npcIds[speakerIdx], template));
        fillIndex++;
    }

    return result.slice(0, 12);
};

/**
 * クエスト全体の会話を強化
 */
export const enhanceQuestDialogues = (
    quest: QuestOutput,
    context: QuestRequestContext
): { output: QuestOutput; updated: boolean; enhancedSpots: number[] } => {
    const next = JSON.parse(JSON.stringify(quest)) as QuestOutput;
    const spots = next.creator_payload?.spots || [];
    const characters = next.creator_payload?.characters || DEFAULT_NPC_PROFILES;
    const enhancedSpots: number[] = [];
    let updated = false;

    const minPre = parseInt(process.env.MASTRA_MIN_DIALOGUE_PRE || '10', 10);
    const minPost = parseInt(process.env.MASTRA_MIN_DIALOGUE_POST || '6', 10);

    spots.forEach((spot, index) => {
        const dialogueContext = buildDialogueContext(next, index, context.player_name);

        // pre_mission_dialogue の強化
        const originalPreLength = spot.pre_mission_dialogue?.length || 0;
        const enhancedPre = enhancePreMissionDialogue(
            spot.pre_mission_dialogue || [],
            dialogueContext,
            characters,
            minPre
        );

        if (enhancedPre.length !== originalPreLength ||
            JSON.stringify(enhancedPre) !== JSON.stringify(spot.pre_mission_dialogue)) {
            spot.pre_mission_dialogue = enhancedPre;
            updated = true;
            if (!enhancedSpots.includes(index)) enhancedSpots.push(index);
        }

        // post_mission_dialogue の強化
        const originalPostLength = spot.post_mission_dialogue?.length || 0;
        const enhancedPost = enhancePostMissionDialogue(
            spot.post_mission_dialogue || [],
            dialogueContext,
            characters,
            minPost
        );

        if (enhancedPost.length !== originalPostLength ||
            JSON.stringify(enhancedPost) !== JSON.stringify(spot.post_mission_dialogue)) {
            spot.post_mission_dialogue = enhancedPost;
            updated = true;
            if (!enhancedSpots.includes(index)) enhancedSpots.push(index);
        }
    });

    return { output: next, updated, enhancedSpots };
};

/**
 * 最初のスポットでNPC自己紹介を追加
 */
export const ensureNPCIntroductions = (
    quest: QuestOutput,
    playerName?: string
): { output: QuestOutput; updated: boolean } => {
    const next = JSON.parse(JSON.stringify(quest)) as QuestOutput;
    const spots = next.creator_payload?.spots;
    const characters = next.creator_payload?.characters;

    if (!spots?.length || !characters?.length) {
        return { output: quest, updated: false };
    }

    const firstSpot = spots[0];
    if (!Array.isArray(firstSpot.pre_mission_dialogue)) {
        firstSpot.pre_mission_dialogue = [];
    }

    const existingTexts = firstSpot.pre_mission_dialogue.map(line => line.text || '').join(' ');
    let updated = false;

    // 各キャラクターの紹介があるか確認
    characters.forEach((char, idx) => {
        if (!char.name) return;

        const hasIntro = existingTexts.includes(char.name);
        if (!hasIntro && firstSpot.pre_mission_dialogue) {
            const introText = playerName
                ? `${playerName}、初めまして。${char.name}だ。${char.role || '協力者'}として一緒に謎を解こう。`
                : `初めまして。${char.name}だ。${char.role || '協力者'}として協力するよ。`;

            // 最初の方に挿入
            firstSpot.pre_mission_dialogue.splice(
                idx,
                0,
                createDialogueLine(char.id, introText, 'smile')
            );
            updated = true;
        }
    });

    // 12行を超えないようにトリム
    if (firstSpot.pre_mission_dialogue.length > 12) {
        firstSpot.pre_mission_dialogue = firstSpot.pre_mission_dialogue.slice(0, 12);
    }

    return { output: next, updated };
};
