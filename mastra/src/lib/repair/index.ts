/**
 * リペアモジュールのエントリポイント
 */

export { enhanceQuestDialogues, ensureNPCIntroductions } from './dialogueEnhancer';
export { refineQuestPuzzles, scoreAllPuzzles } from './puzzleRefiner';

// 完全リライト型モジュール（品質が悪い場合に全書き換え）
export { rewriteQuestDialogues } from './dialogueRewriter';
export { rewriteQuestPuzzles } from './puzzleRewriter';
