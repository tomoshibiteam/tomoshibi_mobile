/**
 * Context Index - コンテキスト管理モジュールのエントリーポイント
 */

export {
    createQuestContext,
    recordSpotVisit,
    plantPlotThread,
    resolvePlotThread,
    updateCharacterState,
    establishFact,
    summarizeContext,
    restoreContextFromQuest,
    // Phase 2: 深いコンテキスト追跡
    applyPlotAgentOutput,
    recordPlayerCall,
    recordEncouragement,
    recordCorrectAnswer,
    type QuestContext,
    type CharacterState,
    type PlotThread,
    type NarrativePromise,
    type RelationshipState,
    type UsageHistory,
} from "./questContext";

export {
    updateRelationships,
    resolvePromise,
} from "./updateContext";
