/**
 * Quest Context - スポット間の一貫性を管理するコンテキストDB
 * 
 * NovelGenerator の Story Context Database パターンに基づく
 */

import type { QuestOutput } from "../../schemas/quest";

/**
 * キャラクター状態
 */
export interface CharacterState {
    id: string;
    name: string;
    revealedInfo: string[];      // 明かした情報
    emotionalArc: string[];       // 感情の推移
    lastSpeechTone: string;       // 最後の発言トーン
}

/**
 * プロットスレッド（伏線）
 */
export interface PlotThread {
    id: string;
    description: string;
    plantedAt: number;            // 埋め込んだスポットインデックス
    resolvedAt?: number;          // 回収したスポットインデックス
    isResolved: boolean;
}

/**
 * 物語の約束（伏線・謎）
 */
export interface NarrativePromise {
    id: string;
    type: 'mystery' | 'relationship' | 'conflict';
    description: string;
    setupSpotIndex: number;
    status: 'unresolved' | 'developed' | 'resolved';
    importance: 'high' | 'medium' | 'low';
}

/**
 * 人間関係マトリクス
 */
export interface RelationshipState {
    value: number;               // -10(敵対) 〜 0(中立) 〜 10(信頼)
    dynamic: string;             // 例: "mentor", "suspicious"
    history: string[];           // 変動の履歴ログ
}

/**
 * 反復防止の使用履歴
 */
export interface UsageHistory {
    recentAdjectives: string[];
    recentSentenceStarters: string[];
    globalForbidden: Set<string>;
}

/**
 * クエストコンテキスト
 */
export interface QuestContext {
    // ミッション情報
    missionGoal: string;
    theme: string;

    // キャラクター状態
    characters: Map<string, CharacterState>;

    // プロット管理
    plotThreads: PlotThread[];
    narrativePromises: NarrativePromise[];
    establishedFacts: string[];   // 確立された事実

    // 発見した手がかり
    discoveredClues: string[];

    // 訪問スポット
    visitedSpots: Array<{
        name: string;
        index: number;
        role: "起" | "承" | "転" | "結";
        tourismAnchor: string;
        puzzleAnswer?: string;
        emotionalTone?: string;        // 感情トーン（Plot Agentから）
        keyDiscovery?: string;         // 重要発見（Plot Agentから）
    }>;

    // プレイヤー関与追跡
    playerName: string;
    difficulty: "easy" | "medium" | "hard";
    playerCallCount: number;           // プレイヤー名呼びかけ回数
    correctAnswerCount: number;        // 正解数
    encouragementGiven: string[];      // 与えた励まし

    // 感情曲線（Plot Agentから）
    emotionalArc: string[];

    // テーマキーワード
    thematicKeywords: string[];

    // 人間関係マップ
    relationshipMap: Map<string, RelationshipState>;

    // 反復防止の使用履歴
    usageHistory: UsageHistory;
}

/**
 * コンテキストを初期化
 */
export const createQuestContext = (options: {
    missionGoal: string;
    theme: string;
    playerName: string;
    difficulty: "easy" | "medium" | "hard";
    characters?: Array<{ id: string; name: string }>;
}): QuestContext => {
    const characterMap = new Map<string, CharacterState>();
    const relationshipMap = new Map<string, RelationshipState>();

    const globalForbidden = new Set<string>([
        "神秘的な",
        "圧倒的な",
        "静寂に包まれた",
        "息を呑む",
        "壮大な",
    ]);

    // デフォルトキャラクター
    const defaultChars = options.characters || [
        { id: "char_1", name: "春香" },
        { id: "char_2", name: "蓮" },
        { id: "char_3", name: "結衣" },
        { id: "char_4", name: "葵" },
    ];

    defaultChars.forEach(char => {
        characterMap.set(char.id, {
            id: char.id,
            name: char.name,
            revealedInfo: [],
            emotionalArc: [],
            lastSpeechTone: "neutral",
        });
    });

    // デフォルトの人間関係（中立）
    defaultChars.forEach((source) => {
        defaultChars.forEach((target) => {
            if (source.id === target.id) return;
            const key = `${source.id}:${target.id}`;
            relationshipMap.set(key, {
                value: 0,
                dynamic: "neutral",
                history: [],
            });
        });
    });

    return {
        missionGoal: options.missionGoal,
        theme: options.theme,
        characters: characterMap,
        plotThreads: [],
        narrativePromises: [],
        establishedFacts: [],
        discoveredClues: [],
        visitedSpots: [],
        playerName: options.playerName,
        difficulty: options.difficulty,
        // 新規フィールド
        playerCallCount: 0,
        correctAnswerCount: 0,
        encouragementGiven: [],
        emotionalArc: [],
        thematicKeywords: [],
        relationshipMap,
        usageHistory: {
            recentAdjectives: [],
            recentSentenceStarters: [],
            globalForbidden,
        },
    };
};

/**
 * スポット訪問を記録
 */
export const recordSpotVisit = (
    context: QuestContext,
    spot: {
        name: string;
        index: number;
        role: "起" | "承" | "転" | "結";
        tourismAnchor: string;
        puzzleAnswer?: string;
    }
): QuestContext => {
    return {
        ...context,
        visitedSpots: [...context.visitedSpots, spot],
        discoveredClues: spot.puzzleAnswer
            ? [...context.discoveredClues, spot.puzzleAnswer]
            : context.discoveredClues,
    };
};

/**
 * 伏線を植える
 */
export const plantPlotThread = (
    context: QuestContext,
    thread: Omit<PlotThread, "isResolved" | "resolvedAt">
): QuestContext => {
    return {
        ...context,
        plotThreads: [
            ...context.plotThreads,
            { ...thread, isResolved: false },
        ],
    };
};

/**
 * 伏線を回収
 */
export const resolvePlotThread = (
    context: QuestContext,
    threadId: string,
    resolvedAtIndex: number
): QuestContext => {
    return {
        ...context,
        plotThreads: context.plotThreads.map(thread =>
            thread.id === threadId
                ? { ...thread, isResolved: true, resolvedAt: resolvedAtIndex }
                : thread
        ),
    };
};

/**
 * キャラクター状態を更新
 */
export const updateCharacterState = (
    context: QuestContext,
    characterId: string,
    update: Partial<Pick<CharacterState, "revealedInfo" | "emotionalArc" | "lastSpeechTone">>
): QuestContext => {
    const current = context.characters.get(characterId);
    if (!current) return context;

    const newCharacters = new Map(context.characters);
    newCharacters.set(characterId, {
        ...current,
        ...update,
        revealedInfo: update.revealedInfo
            ? [...current.revealedInfo, ...update.revealedInfo]
            : current.revealedInfo,
        emotionalArc: update.emotionalArc
            ? [...current.emotionalArc, ...update.emotionalArc]
            : current.emotionalArc,
    });

    return {
        ...context,
        characters: newCharacters,
    };
};

/**
 * 事実を確立
 */
export const establishFact = (
    context: QuestContext,
    fact: string
): QuestContext => {
    if (context.establishedFacts.includes(fact)) return context;
    return {
        ...context,
        establishedFacts: [...context.establishedFacts, fact],
    };
};

/**
 * コンテキストのサマリーを生成（プロンプト用）
 */
export const summarizeContext = (context: QuestContext): string => {
    const visitedSummary = context.visitedSpots
        .map((s, i) => `${i + 1}. ${s.name}(${s.role}): ${s.puzzleAnswer || "探索中"}`)
        .join("\n");

    const cluesSummary = context.discoveredClues.join("、");
    const factsSummary = context.establishedFacts.join("、");

    const unresolved = context.plotThreads.filter(t => !t.isResolved);
    const unresolvedSummary = unresolved.map(t => t.description).join("、");
    const unresolvedPromises = context.narrativePromises
        .filter((p) => p.status !== "resolved")
        .map((p) => p.description)
        .join("、");

    return `
## クエストコンテキスト

### ミッション
${context.missionGoal}

### 訪問済みスポット
${visitedSummary || "(なし)"}

### 発見した手がかり
${cluesSummary || "(なし)"}

### 確立された事実
${factsSummary || "(なし)"}

### 未回収の伏線
${unresolvedSummary || "(なし)"}

### 未解決の物語の約束
${unresolvedPromises || "(なし)"}

### プレイヤー
${context.playerName}（難易度: ${context.difficulty}）
`.trim();
};

/**
 * QuestOutput からコンテキストを復元
 */
export const restoreContextFromQuest = (
    quest: QuestOutput,
    playerName: string,
    difficulty: "easy" | "medium" | "hard"
): QuestContext => {
    const missionGoal = quest.player_preview?.mission
        || quest.creator_payload?.main_plot?.goal
        || "謎を解き明かす";

    const theme = quest.player_preview?.one_liner || missionGoal;

    const context = createQuestContext({
        missionGoal,
        theme,
        playerName,
        difficulty,
        characters: quest.creator_payload?.characters?.map(c => ({
            id: c.id,
            name: c.name,
        })),
    });

    // 既存スポットを復元
    const spots = quest.creator_payload?.spots || [];
    let updatedContext = context;

    spots.forEach((spot, index) => {
        const role = (spot.scene_role?.includes("起") ? "起"
            : spot.scene_role?.includes("承") ? "承"
                : spot.scene_role?.includes("転") ? "転"
                    : "結") as "起" | "承" | "転" | "結";

        updatedContext = recordSpotVisit(updatedContext, {
            name: spot.spot_name,
            index,
            role,
            tourismAnchor: spot.scene_tourism_anchor || "",
            puzzleAnswer: spot.answer_text,
        });
    });

    return updatedContext;
};

/**
 * Plot Agent の出力をコンテキストに適用
 */
export const applyPlotAgentOutput = (
    context: QuestContext,
    plotOutput: {
        emotionalArc: string[];
        foreshadowings: Array<{
            id: string;
            hint: string;
            plantSpotIndex: number;
            payoffSpotIndex: number;
            importance: "major" | "minor";
        }>;
        thematicKeywords: string[];
    }
): QuestContext => {
    // 伏線をプロットスレッドに変換
    const newPlotThreads: PlotThread[] = plotOutput.foreshadowings.map(f => ({
        id: f.id,
        description: f.hint,
        plantedAt: f.plantSpotIndex,
        isResolved: false,
    }));

    const newNarrativePromises: NarrativePromise[] = plotOutput.foreshadowings.map(f => ({
        id: f.id,
        type: "mystery",
        description: f.hint,
        setupSpotIndex: f.plantSpotIndex,
        status: "unresolved",
        importance: f.importance === "major" ? "high" : "medium",
    }));

    return {
        ...context,
        emotionalArc: plotOutput.emotionalArc,
        thematicKeywords: plotOutput.thematicKeywords,
        plotThreads: [...context.plotThreads, ...newPlotThreads],
        narrativePromises: [...context.narrativePromises, ...newNarrativePromises],
    };
};

/**
 * プレイヤー呼びかけを記録
 */
export const recordPlayerCall = (context: QuestContext): QuestContext => {
    return {
        ...context,
        playerCallCount: context.playerCallCount + 1,
    };
};

/**
 * 励ましを記録
 */
export const recordEncouragement = (
    context: QuestContext,
    encouragement: string
): QuestContext => {
    return {
        ...context,
        encouragementGiven: [...context.encouragementGiven, encouragement],
    };
};

/**
 * 正解を記録
 */
export const recordCorrectAnswer = (context: QuestContext): QuestContext => {
    return {
        ...context,
        correctAnswerCount: context.correctAnswerCount + 1,
    };
};
