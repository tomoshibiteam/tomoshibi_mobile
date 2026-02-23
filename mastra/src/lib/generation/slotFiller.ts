/**
 * Slot Filler - スロットベース生成システム
 * 
 * NovelGenerator のスロット方式を採用:
 * テンプレート骨格 + スロット（[SLOT_NAME]）を専門エージェントが埋める
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SLOT_FILLER_MODEL } from "../modelConfig";

/**
 * スロットの型定義
 */
export interface SlotDefinition {
    name: string;
    description: string;
    maxLength?: number;
    required?: boolean;
}

/**
 * スロット埋め結果
 */
export interface SlotFilledResult {
    template: string;
    filledText: string;
    slots: Record<string, string>;
    unfilled: string[];
}

/**
 * スロットコンテキスト（埋める際に参照する情報）
 */
export interface SlotContext {
    spotName: string;
    spotIndex: number;
    totalSpots: number;
    tourismAnchor: string;
    sceneRole: "起" | "承" | "転" | "結";
    missionGoal: string;
    previousClues: string[];
    playerName: string;
    thematicKeywords: string[];
}

/**
 * 標準スロット定義
 */
export const STANDARD_SLOTS: Record<string, SlotDefinition> = {
    TOURISM_FACT: {
        name: "TOURISM_FACT",
        description: "このスポットの観光情報から抽出した具体的な事実",
        maxLength: 60,
        required: true,
    },
    CLUE_CONNECTION: {
        name: "CLUE_CONNECTION",
        description: "前のスポットで得た手がかりとの繋がり",
        maxLength: 40,
    },
    DISCOVERY: {
        name: "DISCOVERY",
        description: "このスポットで発見する新しい情報",
        maxLength: 50,
        required: true,
    },
    EMOTIONAL_REACTION: {
        name: "EMOTIONAL_REACTION",
        description: "キャラクターの感情的な反応",
        maxLength: 30,
    },
    PLAYER_CALL: {
        name: "PLAYER_CALL",
        description: "プレイヤーへの呼びかけ",
        maxLength: 30,
    },
    PUZZLE_HINT: {
        name: "PUZZLE_HINT",
        description: "謎解きへの自然なヒント",
        maxLength: 40,
    },
    TRANSITION: {
        name: "TRANSITION",
        description: "次のスポットへの誘導",
        maxLength: 40,
    },
};

/**
 * スロットを抽出
 */
export const extractSlots = (template: string): string[] => {
    const regex = /\[([A-Z_]+)\]/g;
    const slots: string[] = [];
    let match;
    while ((match = regex.exec(template)) !== null) {
        if (!slots.includes(match[1])) {
            slots.push(match[1]);
        }
    }
    return slots;
};

/**
 * スロット埋めエージェントの instructions
 */
const SLOT_FILLER_INSTRUCTIONS = `
あなたはスロット埋め専門のAIアシスタントです。
テンプレート内の [SLOT_NAME] 形式のスロットを、コンテキストに基づいて適切なテキストで埋めてください。

## ルール
1. 各スロットは指定された最大文字数以内で埋める
2. 観光情報（tourismAnchor）を必ず活用する
3. プレイヤー名を適切に含める
4. 前のスポットの情報を参照して繋がりを作る
5. 起承転結の役割に合った内容にする

## スロットの説明
- [TOURISM_FACT]: 観光情報から抽出した具体的な事実
- [CLUE_CONNECTION]: 前の手がかりとの繋がり
- [DISCOVERY]: このスポットでの新しい発見
- [EMOTIONAL_REACTION]: キャラクターの感情的な反応
- [PLAYER_CALL]: プレイヤーへの呼びかけ
- [PUZZLE_HINT]: 謎解きへのヒント
- [TRANSITION]: 次のスポットへの誘導

## 出力形式
JSON形式で各スロットの値を返してください。
`;

/**
 * スロット埋めエージェント
 */
export const slotFillerAgent = new Agent({
    id: "slot-filler",
    name: "slot-filler",
    model: MASTRA_SLOT_FILLER_MODEL,
    instructions: SLOT_FILLER_INSTRUCTIONS,
});

/**
 * スロット埋め出力スキーマ
 */
const slotOutputSchema = z.object({
    TOURISM_FACT: z.string().optional(),
    CLUE_CONNECTION: z.string().optional(),
    DISCOVERY: z.string().optional(),
    EMOTIONAL_REACTION: z.string().optional(),
    PLAYER_CALL: z.string().optional(),
    PUZZLE_HINT: z.string().optional(),
    TRANSITION: z.string().optional(),
});

/**
 * スロットを埋める
 */
export const fillSlots = async (
    template: string,
    context: SlotContext
): Promise<SlotFilledResult> => {
    const slotsToFill = extractSlots(template);

    if (slotsToFill.length === 0) {
        return {
            template,
            filledText: template,
            slots: {},
            unfilled: [],
        };
    }

    const prompt = `
## スロット埋めリクエスト

### コンテキスト
- スポット名: ${context.spotName}（${context.spotIndex + 1}/${context.totalSpots}番目）
- 役割: ${context.sceneRole}
- 観光情報: ${context.tourismAnchor}
- ミッション: ${context.missionGoal}
- プレイヤー名: ${context.playerName}
- 前の手がかり: ${context.previousClues.join("、") || "（なし）"}
- テーマキーワード: ${context.thematicKeywords.join("、") || "（なし）"}

### 埋めるスロット
${slotsToFill.map(s => `- [${s}]: ${STANDARD_SLOTS[s]?.description || "不明"}`).join("\n")}

### テンプレート
${template}

### 要求
上記のスロットを適切な日本語テキストで埋めてください。
`;

    const response = await slotFillerAgent.generate(prompt, {
        structuredOutput: { schema: slotOutputSchema },
    });

    const filledSlots = response.object as Record<string, string>;

    // テンプレートにスロットを埋め込む
    let filledText = template;
    const unfilled: string[] = [];

    for (const slotName of slotsToFill) {
        const value = filledSlots[slotName];
        if (value) {
            filledText = filledText.replace(
                new RegExp(`\\[${slotName}\\]`, "g"),
                value
            );
        } else {
            unfilled.push(slotName);
        }
    }

    return {
        template,
        filledText,
        slots: filledSlots,
        unfilled,
    };
};

/**
 * 対話用テンプレート（起）
 */
export const DIALOGUE_TEMPLATE_KI = `
[PLAYER_CALL]、ここが[TOURISM_FACT]の場所だよ。
[EMOTIONAL_REACTION]
[DISCOVERY]を探ってみよう。
[PUZZLE_HINT]
`;

/**
 * 対話用テンプレート（承）
 */
export const DIALOGUE_TEMPLATE_SHO = `
[CLUE_CONNECTION]という前の発見を覚えてる？
ここ[TOURISM_FACT]では、さらに[DISCOVERY]がわかるはず。
[PLAYER_CALL]、[PUZZLE_HINT]
`;

/**
 * 対話用テンプレート（転）
 */
export const DIALOGUE_TEMPLATE_TEN = `
[EMOTIONAL_REACTION]！[CLUE_CONNECTION]が示すものが見えてきた。
[TOURISM_FACT]、実は[DISCOVERY]。
[PLAYER_CALL]、考えを整理しよう。[PUZZLE_HINT]
`;

/**
 * 対話用テンプレート（結）
 */
export const DIALOGUE_TEMPLATE_KETSU = `
[PLAYER_CALL]、全ての手がかりが繋がった！
[CLUE_CONNECTION]、そして[TOURISM_FACT]。
答えは[DISCOVERY]だったんだ。[EMOTIONAL_REACTION]
`;

/**
 * 役割に応じたテンプレートを取得
 */
export const getDialogueTemplate = (role: "起" | "承" | "転" | "結"): string => {
    switch (role) {
        case "起": return DIALOGUE_TEMPLATE_KI;
        case "承": return DIALOGUE_TEMPLATE_SHO;
        case "転": return DIALOGUE_TEMPLATE_TEN;
        case "結": return DIALOGUE_TEMPLATE_KETSU;
    }
};

/**
 * 謎用テンプレート
 */
export const PUZZLE_TEMPLATE = `
[TOURISM_FACT]に関する謎：
[DISCOVERY]を手がかりに答えを導け。
ヒント：[PUZZLE_HINT]
`;
