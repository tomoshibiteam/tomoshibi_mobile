/**
 * 強化版クエストプロンプトビルダー
 * 
 * SCRAPのリアル脱出ゲーム級の体験を生成するための
 * 詳細なプロンプト構築システム
 */

import type { SpotCandidate } from '../spotTypes';
import {
    buildStoryArc,
    buildStoryBeats,
    storyBeatsToPromptText,
    buildRoleSequence,
    STORY_ROLES,
    getPuzzleGuideline,
    type StoryBeat,
} from './storyBible';
import {
    DEFAULT_NPC_PROFILES,
    type NPCProfile,
    buildNovelGeneratorGuidelines,
} from './npcPatterns';
import {
    extractPuzzleKeywords,
} from './puzzleDesign';

export interface EnhancedQuestPromptInput {
    prompt: string;
    difficulty: 'easy' | 'medium' | 'hard';
    spotCount: number;
    playerName?: string;
    themeTags?: string[];
    genreSupport?: string;
    toneSupport?: string;
    center?: { lat: number; lng: number };
    radiusKm?: number;
    candidates: SpotCandidate[];
    candidateMode: 'fixed' | 'pool';
    forbiddenPhrases?: string[];
    promptSupport?: {
        protagonist?: string;
        objective?: string;
        ending?: string;
        when?: string;
        where?: string;
        purpose?: string;
        withWhom?: string;
    };
}

/**
 * プロンプトのセクション区切り
 */
const SECTION_DIVIDER = '\n---\n';

/**
 * 難易度ラベル
 */
const DIFFICULTY_LABELS: Record<string, { ja: string; desc: string }> = {
    easy: { ja: '初級', desc: '観光情報から直接答えが導ける。初心者向け。' },
    medium: { ja: '中級', desc: '複数の手がかりを組み合わせる必要がある。' },
    hard: { ja: '上級', desc: '情報の統合と推理力が必要。達成感が大きい。' },
};

/**
 * ペルソナプロファイル生成
 */
const buildPersonaProfile = (input: EnhancedQuestPromptInput): string => {
    const playerName = input.playerName || '旅人';
    const purpose = input.promptSupport?.purpose || '観光と謎解きを楽しむ';
    const when = input.promptSupport?.when || '日中';
    const withWhom = input.promptSupport?.withWhom || '単独または友人と';

    return `
## プレイヤーペルソナ

- **名前**: ${playerName}
- **目的**: ${purpose}
- **時間帯**: ${when}
- **同行者**: ${withWhom}

### プレイヤーへの配慮
- ${playerName}に直接語りかけるセリフを各スポットで必ず入れる
- 専門用語は避け、わかりやすい表現を使う
- 達成感と発見の喜びを演出する
`;
};

/**
 * NPCプロファイルセクション生成
 */
const buildNPCProfileSection = (npcs: NPCProfile[] = DEFAULT_NPC_PROFILES): string => {
    const profiles = npcs.map((npc) => {
        const voice = npc.voiceProfile
            ? `
  - **語彙レベル**: ${npc.voiceProfile.vocabularyLevel}
  - **感情レンジ**: ${npc.voiceProfile.emotionalRange}
  - **話法スタイル**: ${npc.voiceProfile.communicationStyle}
  - **口癖**: ${npc.voiceProfile.catchphrases.join('、') || 'なし'}
  - **語尾**: ${npc.voiceProfile.speechPatterns.join('、') || 'なし'}
  - **方言・地域性**: ${npc.voiceProfile.dialectNotes || '標準語'}
  - **禁止表現**: ${npc.voiceProfile.forbiddenPhrases.join('、') || 'なし'}
`
            : '';

        return `
### ${npc.name}（${npc.id}）
- **役割**: ${npc.role}
- **専門**: ${npc.specialty}
- **性格**: ${npc.personality}
- **話し方**: ${npc.speechStyle}
- **イメージ**: ${npc.imagePrompt}
${voice}`.trim();
    }).join('\n');

    return `
## キャラクター設計

以下の4人のNPCが登場します。それぞれ異なる専門性と視点を持ち、
プレイヤーの謎解きをサポートします。

${profiles}

### キャラクター会話ルール
1. 各NPCは自分の専門分野に基づいた発言をする
2. プレイヤー（${DEFAULT_NPC_PROFILES[0].name}）は会話に参加しない（語りかけられるのみ）
3. NPC同士の掛け合いも自然に入れる
4. 各スポットで最低2人のNPCが発言する
`;
};

/**
 * 禁止表現セクション生成
 */
const buildForbiddenSection = (forbiddenPhrases: string[] = []): string => {
    const unique = Array.from(new Set(forbiddenPhrases.map(p => p.trim()).filter(Boolean)));
    if (unique.length === 0) return '';

    const list = unique.slice(0, 40).map((phrase) => `- ${phrase}`).join('\n');
    return `
## 禁止表現リスト（必ず回避）

以下の表現は **絶対に使用しない** こと：
${list}
`;
};

/**
 * スポット候補セクション生成
 */
const buildCandidatesSection = (
    candidates: SpotCandidate[],
    spotCount: number,
    mode: 'fixed' | 'pool'
): string => {
    const selected = candidates.slice(0, Math.min(40, candidates.length));
    const roles = buildRoleSequence(spotCount);

    const candidatesList = selected.map((spot, idx) => {
        const role = idx < spotCount ? `【${roles[idx]}】` : '';
        const keywords = extractPuzzleKeywords(spot);
        const description = spot.description
            ? `  - 説明: ${spot.description.slice(0, 100)}`
            : '';
        const kinds = spot.kinds
            ? `  - カテゴリ: ${spot.kinds.split(',')[0]}`
            : '';
        const address = spot.address
            ? `  - 住所: ${spot.address}`
            : '';

        return `
${idx + 1}. **${spot.name}** ${role}
  - 座標: (${spot.lat.toFixed(5)}, ${spot.lng.toFixed(5)})
${kinds}
${address}
${description}
  - キーワード: ${keywords.mainKeyword}, ${keywords.subKeywords.slice(0, 2).join(', ')}
`;
    }).join('');

    const modeInstruction = mode === 'fixed'
        ? `
**【必須】上記の候補リストの順番通りに、最初の${spotCount}件を使用してください。**
スポット名と座標は絶対に変更しないでください。
`
        : `
上記の候補から${spotCount}件を選択してください。
選択時は、テーマとの親和性、カテゴリの多様性、ルートの歩きやすさを考慮してください。
`;

    return `
## スポット候補（${mode === 'fixed' ? '固定順' : 'プール選択'}）

${candidatesList}

${modeInstruction}
`;
};

/**
 * ストーリー設計セクション生成
 */
const buildStorySection = (
    input: EnhancedQuestPromptInput,
    storyBeats: StoryBeat[]
): string => {
    const theme = input.prompt.trim() || '街の謎';
    const location = input.promptSupport?.where || '探索エリア';
    const arc = buildStoryArc(theme, location, input.spotCount);

    return `
## ストーリー設計（Story Bible）

### 物語の骨格
- **前提**: ${arc.premise}
- **謎**: ${arc.mystery}
- **目標**: ${arc.goal}
- **最終的な発覚**: ${arc.finalReveal}
- **テーマメッセージ**: ${arc.thematicMessage}

### 起承転結の流れ

プレイヤーが体験すべき感情の流れ：
1. 【起】好奇心の喚起 - 「なにこれ、気になる！」
2. 【承】発見と学び - 「へぇ、そうだったんだ」
3. 【転】驚きと気づき - 「まさか、そういうことか！」
4. 【結】達成感と余韻 - 「やった！全部つながった！」

### 各スポットのビート

${storyBeatsToPromptText(storyBeats)}
`;
};

/**
 * 謎設計ガイドラインセクション生成
 */
const buildPuzzleSection = (
    storyBeats: StoryBeat[],
    difficulty: 'easy' | 'medium' | 'hard'
): string => {
    const difficultyInfo = DIFFICULTY_LABELS[difficulty];

    const puzzleGuides = storyBeats.map(beat => {
        const guide = getPuzzleGuideline(beat.puzzleType);
        return `
### スポット${beat.spotIndex + 1}: ${beat.spotName}の謎
${guide}
- 観光フック活用: ${beat.tourismHook.slice(0, 50)}
- 手がかり: ${beat.clueToReveal.slice(0, 50)}
`;
    }).join('');

    return `
## 謎設計ガイドライン

### 難易度: ${difficultyInfo.ja}
${difficultyInfo.desc}

### 謎設計の原則

1. **自己完結型**: 問題文内の情報だけで解ける（現地観察不要）
2. **観光情報活用**: 各スポットの特徴・由来を活用した出題
3. **段階的難易度**: 起=易しい → 結=やや難しい
4. **因果マーカー必須**: 解説文に「だから」「理由」「つまり」などを含める
5. **ミッション連動**: 最終問題はクエスト全体のゴールにつながる
6. **スポット間連携**: 前のスポットで得た情報を次の謎の手がかりにする（特に中盤以降）

### 禁止事項
- 現地の看板・掲示物を見る必要がある問題
- 複雑な計算や単位変換が必要な問題
- 答えが曖昧で複数解釈できる問題
- 外部知識（ネット検索）が必要な問題

${puzzleGuides}
`;
};

/**
 * 会話設計ガイドラインセクション生成
 */
const buildDialogueSection = (
    playerName: string,
    storyBeats: StoryBeat[]
): string => {
    const roleDialogueGuides = storyBeats.map((beat, idx) => {
        const roleConfig = STORY_ROLES[beat.role];
        return `
### スポット${idx + 1}（${beat.role}）の会話トーン
- 感情ビート: ${roleConfig.emotionalBeat}
- 会話トーン: ${roleConfig.dialogueTone}
- キーアクション: ${roleConfig.keyActions.join('、')}
- 必須要素: ${beat.tourismHook.slice(0, 30)}への言及
`;
    }).join('');

    return `
## 会話設計ガイドライン

### 基本ルール
1. 各スポットで **pre_mission_dialogue**（10-12行）と **post_mission_dialogue**（6-8行）を作成
2. 各セリフは **60文字以内**
3. **プレイヤー（${playerName}）は発言しない**（NPCから話しかけられるのみ）
4. 各スポットで **最低2人のNPC** が発言する
5. プレイヤー名 **${playerName}** を各スポットで **最低1回** 呼びかける
6. NPC同士だけの掛け合い（プレイヤー名なし）も入れる

### 会話に含めるべき内容

#### pre_mission_dialogue（謎解き前）
1. スポット到着の導入（そのスポットの観光情報に言及）
2. 前スポットとの関連づけ（2スポット目以降）
3. 今回の目標・調査ポイントの説明
4. 謎解きへの誘導

#### post_mission_dialogue（謎解き後）
1. 正解へのリアクション
2. 発見した手がかりのまとめ
3. 次スポットへの期待・誘導（最終スポット以外）
4. 全体ミッションとの関連づけ

### 役割別の会話トーン

${roleDialogueGuides}

### 具体性の確保
- スポット名を必ず会話内で言及する
- 観光情報（由来、特徴、歴史）を織り込む
- 「ここ」「この場所」ではなく具体的な名前を使う
- 前スポットの手がかりを参照する（2スポット目以降）
`;
};

/**
 * ナレーション設計ガイドライン
 */
const buildNarrationSection = (): string => {
    return `
## ナレーション設計ガイドライン

### 目的
読者（プレイヤー）が場面を理解しやすいように、短いナレーションで状況整理を行う。

### ルール
1. 各スポットに **scene_narration** を必ず作成（2〜4文）
2. **scene_tourism_anchor** と **scene_objective** を必ず含める
3. 身体感覚や環境のディテールを1つ含める（風/匂い/疲れ等）
4. 未解決要素を1つ残す（“まだ何か足りない”など）
5. 「ナレーター」等のメタ表現は禁止
`;
};

/**
 * 出力形式セクション生成
 */
const buildOutputSection = (): string => {
    return `
## 出力形式

**JSONスキーマに厳密に従ってください。**

### 重要な制約
1. スポット名（spot_name）と座標（lat, lng）は候補リストから変更しない
2. 全てのテキストは日本語で出力
3. 各スポットに scene_role（起/承/転/結）を必ず設定
4. 各スポットに scene_narration（2〜4文）を必ず設定
5. 各スポットに question_text, answer_text, hint_text, explanation_text を設定
6. question_text は12文字以上
7. explanation_text に因果マーカー（だから/理由/つまり/手がかり）を含める
8. 最終スポットの question_text でミッション（クエストゴール）に言及する
9. ナレーターは **characters に追加しない**（scene_narration で表現する）

### チェックリスト
□ スポット数は指定通りか
□ 各NPCの発言が専門性に合っているか
□ プレイヤー名が各スポットで呼ばれているか
□ 観光情報が会話に織り込まれているか
□ 謎が自己完結型か（現地観察不要）
□ 起承転結の流れが適切か
□ 最終問題がミッションにつながっているか
`;
};

/**
 * 強化版クエストプロンプトを構築
 */
export const buildEnhancedQuestPrompt = (input: EnhancedQuestPromptInput): string => {
    const playerName = input.playerName || '旅人';
    const theme = input.prompt.trim() || '街の謎を解く';
    const location = input.promptSupport?.where || '探索エリア';

    // ストーリービートを構築
    const storyBeats = buildStoryBeats(
        input.candidates,
        theme,
        input.promptSupport?.objective || `${theme}を解き明かす`,
        input.spotCount
    );

    // 各セクションを構築（NovelGeneratorガイドライン追加）
    const sections = [
        buildHeader(theme, input),
        buildPersonaProfile(input),
        buildNPCProfileSection(),
        buildNovelGeneratorGuidelines(),  // ← NovelGenerator核心技術
        buildForbiddenSection(input.forbiddenPhrases),
        buildCandidatesSection(input.candidates, input.spotCount, input.candidateMode),
        buildStorySection(input, storyBeats),
        buildPuzzleSection(storyBeats, input.difficulty),
        buildNarrationSection(),
        buildDialogueSection(playerName, storyBeats),
        buildOutputSection(),
    ].filter((section) => section && section.trim().length > 0);

    return sections.join(SECTION_DIVIDER);
};

/**
 * ヘッダーセクション生成
 */
const buildHeader = (theme: string, input: EnhancedQuestPromptInput): string => {
    const tags = input.themeTags?.filter(Boolean).join(', ') || 'なし';
    const difficultyInfo = DIFFICULTY_LABELS[input.difficulty];

    return `
# クエスト設計ブリーフ

あなたは観光謎解きクエストの専門脚本家です。
SCRAPのリアル脱出ゲームや謎解き街歩きレベルの、
プレイヤーが没入できる高品質な体験を設計してください。

## リクエスト概要

- **テーマ**: ${theme}
- **難易度**: ${difficultyInfo.ja}（${difficultyInfo.desc}）
- **スポット数**: ${input.spotCount}箇所
- **タグ**: ${tags}
- **ジャンル**: ${input.genreSupport || '謎解き街歩き'}
- **トーン**: ${input.toneSupport || '冒険と発見'}

## 品質基準

この体験を通じてプレイヤーが感じるべきこと：
1. 「なにこれ、気になる！」→ 好奇心の喚起
2. 「へぇ、そうだったんだ」→ 発見と学び
3. 「あ！わかった！」→ 達成感
4. 「また来たい」→ 記憶に残る体験
`;
};

/**
 * 従来のプロンプト形式との互換性のためのエクスポート
 */
export { buildEnhancedQuestPrompt as buildQuestPromptV2 };
