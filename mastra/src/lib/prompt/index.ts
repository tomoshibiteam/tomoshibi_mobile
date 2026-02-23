/**
 * プロンプトモジュールのエントリポイント
 */

export { buildEnhancedQuestPrompt, buildQuestPromptV2 } from './questPromptBuilder';
export type { EnhancedQuestPromptInput } from './questPromptBuilder';

export {
    DEFAULT_NPC_PROFILES,
    NPC_DIALOGUE_TEMPLATES,
    interpolateTemplate,
    generateDialogueLine,
    generateDialogueSet,
    ROLE_DIALOGUE_FLOW,
} from './npcPatterns';
export type {
    NPCProfile,
    DialoguePhase,
    DialogueContext,
} from './npcPatterns';

export {
    STORY_ROLES,
    buildRoleSequence,
    buildStoryArc,
    buildStoryBeats,
    storyBeatsToPromptText,
    getPuzzleGuideline,
} from './storyBible';
export type {
    StoryBeat,
    StoryArc,
} from './storyBible';

export {
    PUZZLE_PATTERNS,
    extractPuzzleKeywords,
    generatePuzzleTheme,
    buildSelfContainedPuzzle,
    isOnsiteRequired,
    hasCalculation,
    scorePuzzleQuality,
} from './puzzleDesign';
export type {
    PuzzleDesign,
    PuzzleContext,
} from './puzzleDesign';
