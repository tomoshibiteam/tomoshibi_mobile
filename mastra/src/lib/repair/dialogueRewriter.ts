/**
 * 完全リライト型 会話強化モジュール
 * 
 * AIが生成した低品質な会話を、完全に書き換える
 * 機械的なフィラーではなく、物語として成立する会話を生成
 */

import { QuestOutput } from '../../schemas/quest';
import type { QuestRequestContext } from '../questValidation';
import { DEFAULT_NPC_PROFILES, type NPCProfile } from '../prompt/npcPatterns';
import { STORY_ROLES, buildRoleSequence } from '../prompt/storyBible';

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

type ExpressionType = 'neutral' | 'smile' | 'serious' | 'surprise' | 'excited';

interface DialogueLine {
    character_id: string;
    text: string;
    expression?: ExpressionType;
}

interface DialogueContext {
    spotName: string;
    spotIndex: number;
    totalSpots: number;
    tourismAnchor: string;
    sceneRole: string;
    sceneObjective: string;
    playerName: string;
    prevSpotName?: string;
    prevClue?: string;
    missionGoal: string;
    characters: NPCProfile[];
}

/**
 * 会話行を作成
 */
const line = (
    characterId: string,
    text: string,
    expression: ExpressionType = 'neutral'
): DialogueLine => ({
    character_id: characterId,
    text: text.slice(0, 60),
    expression,
});

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
 * 【起】スポットの pre_mission_dialogue を生成
 * 物語の始まり、キャラクター紹介、好奇心の喚起
 */
const generateKiPreDialogue = (ctx: DialogueContext): DialogueLine[] => {
    const [char1, char2, char3, char4] = ctx.characters;
    const shortName = ctx.spotName.slice(0, 8);
    const tourismShort = ctx.tourismAnchor.slice(0, 25);

    return [
        line(char1.id, `${ctx.playerName}、${shortName}に着いたわ。`, 'smile'),
        line(char2.id, `へぇ、ここが${shortName}か。雰囲気あるな。`, 'smile'),
        line(char1.id, `私の調べによると、${tourismShort}らしいの。`, 'neutral'),
        line(char3.id, `興味深いですね。記録しておきます。`, 'neutral'),
        line(char4.id, `${ctx.playerName}、今回の目標は「${ctx.missionGoal.slice(0, 15)}」だよ！`, 'excited'),
        line(char2.id, `よし、まずはこの場所を調査しよう。`, 'smile'),
        line(char1.id, `${tourismShort}に何か手がかりがあるはず。`, 'serious'),
        line(char3.id, `では、調査を始めましょう。`, 'neutral'),
        line(char4.id, `${ctx.playerName}、一緒に頑張ろうね！`, 'smile'),
        line(char2.id, `何か気になることがあったら教えてくれ。`, 'neutral'),
    ];
};

/**
 * 【起】スポットの post_mission_dialogue を生成
 */
const generateKiPostDialogue = (ctx: DialogueContext): DialogueLine[] => {
    const [char1, char2, char3, char4] = ctx.characters;

    return [
        line(char4.id, `やったね${ctx.playerName}！最初の謎、クリアだよ！`, 'excited'),
        line(char1.id, `いい発見だわ。次の場所では更に深く調べましょう。`, 'smile'),
        line(char3.id, `この手がかりを記録しました。次に活かせそうです。`, 'neutral'),
        line(char2.id, `よし、次の場所に向かおう。`, 'smile'),
        line(char4.id, `この調子で進めば${ctx.missionGoal.slice(0, 10)}できそう！`, 'excited'),
        line(char1.id, `まだ始まったばかりよ。慎重に進みましょう。`, 'neutral'),
    ];
};

/**
 * 【承】スポットの pre_mission_dialogue を生成
 * 情報収集、手がかりの蓄積
 */
const generateShoPreDialogue = (ctx: DialogueContext): DialogueLine[] => {
    const [char1, char2, char3, char4] = ctx.characters;
    const shortName = ctx.spotName.slice(0, 8);
    const tourismShort = ctx.tourismAnchor.slice(0, 25);
    const prevShort = ctx.prevSpotName?.slice(0, 6) || '前の場所';

    return [
        line(char2.id, `${shortName}に着いたぜ。`, 'smile'),
        line(char1.id, `ここは${tourismShort}として知られているわ。`, 'neutral'),
        line(char3.id, `${prevShort}で得た情報と合わせて考えてみましょう。`, 'neutral'),
        line(char4.id, `${ctx.playerName}、何か気づいたことある？`, 'smile'),
        line(char2.id, `${prevShort}での発見が、ここでも役立つかもしれない。`, 'serious'),
        line(char1.id, `${tourismShort}について詳しく調べてみましょう。`, 'neutral'),
        line(char3.id, `情報が繋がってきた気がします。`, 'neutral'),
        line(char4.id, `${ctx.sceneObjective.slice(0, 15)}、頑張ろう！`, 'excited'),
        line(char2.id, `よし、調査開始だ。`, 'smile'),
        line(char1.id, `${ctx.playerName}、一緒に確認しましょう。`, 'smile'),
    ];
};

/**
 * 【承】スポットの post_mission_dialogue を生成
 */
const generateShoPostDialogue = (ctx: DialogueContext): DialogueLine[] => {
    const [char1, char2, char3, char4] = ctx.characters;

    return [
        line(char4.id, `${ctx.playerName}、すごい！また一つ解けたね！`, 'excited'),
        line(char3.id, `新しい手がかりを記録しました。`, 'neutral'),
        line(char1.id, `だんだん全体像が見えてきたわ。`, 'smile'),
        line(char2.id, `よし、次も期待できそうだな。`, 'smile'),
        line(char4.id, `この調子で進もう！`, 'excited'),
        line(char1.id, `次の場所で更に詳しいことが分かるかもしれないわ。`, 'neutral'),
    ];
};

/**
 * 【転】スポットの pre_mission_dialogue を生成
 * 視点の転換、新たな気づき
 */
const generateTenPreDialogue = (ctx: DialogueContext): DialogueLine[] => {
    const [char1, char2, char3, char4] = ctx.characters;
    const shortName = ctx.spotName.slice(0, 8);
    const tourismShort = ctx.tourismAnchor.slice(0, 25);
    const prevShort = ctx.prevSpotName?.slice(0, 6) || '前の場所';

    return [
        line(char1.id, `${shortName}に到着。ここは重要な場所よ。`, 'serious'),
        line(char2.id, `待て、何かおかしいぞ...`, 'surprise'),
        line(char3.id, `確かに、これまでの情報と矛盾する点があります。`, 'serious'),
        line(char4.id, `${ctx.playerName}、どういうこと...？`, 'neutral'),
        line(char1.id, `${tourismShort}...もしかして...`, 'surprise'),
        line(char2.id, `${prevShort}で見たこととは違う解釈ができるかも。`, 'serious'),
        line(char3.id, `視点を変えて考え直す必要がありそうです。`, 'neutral'),
        line(char4.id, `え、じゃあ今までの推理は...？`, 'surprise'),
        line(char1.id, `落ち着いて。新しい発見と捉えましょう。`, 'neutral'),
        line(char2.id, `${ctx.playerName}、ここで真実に近づけるはずだ。`, 'serious'),
    ];
};

/**
 * 【転】スポットの post_mission_dialogue を生成
 */
const generateTenPostDialogue = (ctx: DialogueContext): DialogueLine[] => {
    const [char1, char2, char3, char4] = ctx.characters;

    return [
        line(char1.id, `なるほど...そういうことだったのね。`, 'surprise'),
        line(char2.id, `${ctx.playerName}、すごい発見だ！`, 'excited'),
        line(char3.id, `これで全ての情報が繋がりました。`, 'smile'),
        line(char4.id, `やった！核心に迫ったね！`, 'excited'),
        line(char1.id, `あとは最後の場所で全てを確認するだけよ。`, 'smile'),
        line(char2.id, `よし、最後の場所に向かおう！`, 'excited'),
    ];
};

/**
 * 【結】スポットの pre_mission_dialogue を生成
 * 真相の解明、クライマックス
 */
const generateKetsuPreDialogue = (ctx: DialogueContext): DialogueLine[] => {
    const [char1, char2, char3, char4] = ctx.characters;
    const shortName = ctx.spotName.slice(0, 8);
    const tourismShort = ctx.tourismAnchor.slice(0, 25);

    return [
        line(char4.id, `${ctx.playerName}、ついに最後の場所だよ！`, 'excited'),
        line(char1.id, `${shortName}。ここで全ての謎が解けるはずよ。`, 'serious'),
        line(char2.id, `今までの手がかりを思い出してくれ。`, 'neutral'),
        line(char3.id, `収集した情報は全て揃っています。`, 'neutral'),
        line(char4.id, `${ctx.missionGoal.slice(0, 15)}、ついに解決できる！`, 'excited'),
        line(char1.id, `${tourismShort}...これが最後のピースよ。`, 'serious'),
        line(char2.id, `${ctx.playerName}、全てを統合して考えてみろ。`, 'serious'),
        line(char3.id, `答えは必ずあります。頑張ってください。`, 'smile'),
        line(char4.id, `${ctx.playerName}なら絶対できるよ！`, 'excited'),
        line(char1.id, `さあ、最後の謎を解きましょう。`, 'smile'),
    ];
};

/**
 * 【結】スポットの post_mission_dialogue を生成
 */
const generateKetsuPostDialogue = (ctx: DialogueContext): DialogueLine[] => {
    const [char1, char2, char3, char4] = ctx.characters;

    return [
        line(char4.id, `やったー！！${ctx.playerName}、おめでとう！！`, 'excited'),
        line(char2.id, `すげえ！本当にやったな！`, 'excited'),
        line(char1.id, `${ctx.missionGoal.slice(0, 15)}、見事に達成よ。`, 'smile'),
        line(char3.id, `全ての謎が解けました。記録完了です。`, 'smile'),
        line(char4.id, `${ctx.playerName}と一緒に冒険できて楽しかった！`, 'excited'),
        line(char1.id, `また機会があれば、一緒に謎を解きましょうね。`, 'smile'),
        line(char2.id, `${ctx.playerName}、最高のパートナーだったぜ。`, 'smile'),
        line(char3.id, `お疲れ様でした。素晴らしい探索でした。`, 'smile'),
    ];
};

/**
 * 会話品質をチェック - 問題があればtrue
 */
const hasDialogueProblems = (dialogue: DialogueLine[] | undefined): boolean => {
    if (!dialogue || dialogue.length < 4) return true;

    const texts = dialogue.map(l => l.text || '').join(' ');

    // 自己紹介が多すぎる（3回以上「だ。」で終わる自己紹介的な文）
    const introCount = dialogue.filter(l =>
        l.text?.includes('だ。') &&
        (l.text?.includes('として') || l.text?.includes('ここに来た'))
    ).length;
    if (introCount >= 3) return true;

    // 同じテキストの繰り返し
    const uniqueTexts = new Set(dialogue.map(l => l.text?.slice(0, 20)));
    if (uniqueTexts.size < dialogue.length * 0.7) return true;

    // 内容が薄い（スポット名への言及がない、など）
    if (texts.length < 100) return true;

    return false;
};

/**
 * クエスト全体の会話を完全リライト
 * 問題がある会話のみを書き換え
 */
export const rewriteQuestDialogues = (
    quest: QuestOutput,
    context: QuestRequestContext
): { output: QuestOutput; updated: boolean; rewrittenSpots: number[] } => {
    const next = JSON.parse(JSON.stringify(quest)) as QuestOutput;
    const spots = next.creator_payload?.spots || [];
    const rawCharacters = next.creator_payload?.characters || [];
    const rewrittenSpots: number[] = [];
    let updated = false;

    // キャラクターが4人未満の場合はデフォルトを使用
    const characters: NPCProfile[] = rawCharacters.length >= 4
        ? rawCharacters.map(c => ({
            id: c.id || 'char_1',
            name: c.name || 'NPC',
            role: c.role || '協力者',
            specialty: '',
            personality: c.personality || '',
            speechStyle: '',
            imagePrompt: c.image_prompt || '',
        }))
        : DEFAULT_NPC_PROFILES;

    const playerName = context.player_name || '君';
    const missionGoal = next.player_preview?.mission
        || next.creator_payload?.main_plot?.goal
        || '謎を解き明かす';

    spots.forEach((spot, index) => {
        const roleKey = resolveRoleKey(spot.scene_role);
        const prevSpot = index > 0 ? spots[index - 1] : null;

        const ctx: DialogueContext = {
            spotName: spot.spot_name || 'このスポット',
            spotIndex: index,
            totalSpots: spots.length,
            tourismAnchor: spot.scene_tourism_anchor || spot.spot_name || '',
            sceneRole: spot.scene_role || '承',
            sceneObjective: spot.scene_objective || '調査する',
            playerName,
            prevSpotName: prevSpot?.spot_name,
            prevClue: prevSpot?.scene_objective,
            missionGoal,
            characters,
        };

        // pre_mission_dialogue のチェックとリライト
        if (hasDialogueProblems(spot.pre_mission_dialogue)) {
            let newPre: DialogueLine[];
            switch (roleKey) {
                case '起': newPre = generateKiPreDialogue(ctx); break;
                case '承': newPre = generateShoPreDialogue(ctx); break;
                case '転': newPre = generateTenPreDialogue(ctx); break;
                case '結': newPre = generateKetsuPreDialogue(ctx); break;
            }
            spot.pre_mission_dialogue = newPre;
            if (!rewrittenSpots.includes(index)) rewrittenSpots.push(index);
            updated = true;
        }

        // post_mission_dialogue のチェックとリライト
        if (hasDialogueProblems(spot.post_mission_dialogue)) {
            let newPost: DialogueLine[];
            switch (roleKey) {
                case '起': newPost = generateKiPostDialogue(ctx); break;
                case '承': newPost = generateShoPostDialogue(ctx); break;
                case '転': newPost = generateTenPostDialogue(ctx); break;
                case '結': newPost = generateKetsuPostDialogue(ctx); break;
            }
            spot.post_mission_dialogue = newPost;
            if (!rewrittenSpots.includes(index)) rewrittenSpots.push(index);
            updated = true;
        }
    });

    return { output: next, updated, rewrittenSpots };
};
