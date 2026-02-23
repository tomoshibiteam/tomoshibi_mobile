/**
 * NPC会話パターンライブラリ
 * 
 * NovelGenerator の CharacterVoiceProfile パターンを統合。
 * 各NPCに明確な「専門性」「個性」「音声特性」を持たせ、
 * 一貫した高品質な会話を生成するためのテンプレート集
 */

import { NOVEL_CORE_GUIDELINES, NOVEL_DIALOGUE_GUIDELINES } from "./novelGuidelines";

/**
 * NovelGenerator インスパイアの音声プロファイル
 * キャラクターの話し方を詳細に定義
 */
export interface VoiceProfile {
    /** 語彙レベル: formal=丁寧/casual=カジュアル/street=砕けた/archaic=古風 */
    vocabularyLevel: 'formal' | 'casual' | 'street' | 'archaic';
    /** 感情表現範囲: reserved=控えめ/expressive=表現豊か/volatile=激情的/stoic=冷静 */
    emotionalRange: 'reserved' | 'expressive' | 'volatile' | 'stoic';
    /** コミュニケーションスタイル: direct=直接的/indirect=遠回し/verbose=饒舌/terse=簡潔/poetic=詩的 */
    communicationStyle: 'direct' | 'indirect' | 'verbose' | 'terse' | 'poetic';
    /** 口癖・決まり文句 */
    catchphrases: string[];
    /** 特徴的な語尾・表現 */
    speechPatterns: string[];
    /** 方言・地域性のメモ */
    dialectNotes?: string;
    /** 禁止表現（このキャラは絶対使わない言い回し） */
    forbiddenPhrases: string[];
}

export interface NPCProfile {
    id: string;
    name: string;
    role: string;
    specialty: string;
    personality: string;
    speechStyle: string;
    imagePrompt: string;
    /** NovelGenerator風の音声プロファイル */
    voiceProfile?: VoiceProfile;
}


export type DialoguePhase =
    | 'intro'           // スポット到着時の導入
    | 'observation'     // スポットの観察・発見
    | 'connection'      // 前スポットとの関連づけ
    | 'puzzle_hint'     // 謎解きへのヒント
    | 'puzzle_reaction' // 謎解き後のリアクション
    | 'transition';     // 次スポットへの誘導

export interface DialogueContext {
    spotName: string;
    spotIndex: number;
    totalSpots: number;
    tourismAnchor: string;
    sceneRole: string;
    sceneObjective: string;
    playerName?: string;
    prevSpotName?: string;
    prevClue?: string;
    missionGoal: string;
    specificDetail?: string;
}

/**
 * 4人のNPCプロファイル
 * それぞれ異なる視点と専門性を持つ
 * NovelGenerator の CharacterVoiceProfile パターンで音声特性を明確化
 */
export const DEFAULT_NPC_PROFILES: NPCProfile[] = [
    {
        id: 'char_1',
        name: '春香',
        role: '歴史研究者',
        specialty: '地域の歴史・由来・文化的背景',
        personality: '知的で落ち着いた分析派。物事の背景を調べ上げる。',
        speechStyle: '丁寧語で論理的。「〜よ」「〜ね」を使う。',
        imagePrompt: 'calm scholarly woman with glasses, professional attire, warm smile',
        voiceProfile: {
            vocabularyLevel: 'formal',
            emotionalRange: 'reserved',
            communicationStyle: 'verbose',
            catchphrases: ['興味深いわね', '調べによると', '歴史的には'],
            speechPatterns: ['〜のよ', '〜わね', '〜かしら', '〜なの'],
            dialectNotes: '標準語。丁寧で落ち着いた学術口調。',
            forbiddenPhrases: ['マジ', 'ヤバい', 'ウケる', '草'],
        },
    },
    {
        id: 'char_2',
        name: '蓮',
        role: '地元探索ガイド',
        specialty: '現地の雰囲気・隠れスポット・地元情報',
        personality: '好奇心旺盛で行動派。五感で街を感じ取る。',
        speechStyle: 'カジュアルで親しみやすい。「〜だな」「〜じゃん」',
        imagePrompt: 'energetic young man with casual outdoor clothes, adventurous spirit',
        voiceProfile: {
            vocabularyLevel: 'street',
            emotionalRange: 'expressive',
            communicationStyle: 'direct',
            catchphrases: ['おっ見てくれ', '俺の勘だと', 'やるじゃん'],
            speechPatterns: ['〜だぜ', '〜じゃん', '〜だな', '〜ぞ'],
            dialectNotes: '関東口調。砕けた話し方。',
            forbiddenPhrases: ['ですわ', 'でございます', '〜かしら'],
        },
    },
    {
        id: 'char_3',
        name: '結衣',
        role: '記録・分析担当',
        specialty: '情報の整理・パターン発見・論理的推理',
        personality: '几帳面で観察眼が鋭い。細部に注目する。',
        speechStyle: '正確で明快。「〜です」「〜ですね」',
        imagePrompt: 'detail-oriented young woman with notebook, observant expression',
        voiceProfile: {
            vocabularyLevel: 'formal',
            emotionalRange: 'stoic',
            communicationStyle: 'terse',
            catchphrases: ['記録によると', 'パターンが見えてきました', '論理的に考えると'],
            speechPatterns: ['〜です', '〜ですね', '〜でしょう', '〜と思われます'],
            dialectNotes: '標準語。淡々とした分析口調。',
            forbiddenPhrases: ['多分', 'なんとなく', '適当に', 'テキトー'],
        },
    },
    {
        id: 'char_4',
        name: '葵',
        role: '謎解きアドバイザー',
        specialty: '謎の解き方・ヒント提供・プレイヤーサポート',
        personality: '明るく励まし上手。プレイヤーを導く。',
        speechStyle: '励ましの言葉が多い。「〜よ！」「頑張って！」',
        imagePrompt: 'cheerful supportive woman, bright expression, encouraging pose',
        voiceProfile: {
            vocabularyLevel: 'casual',
            emotionalRange: 'expressive',
            communicationStyle: 'direct',
            catchphrases: ['大丈夫だよ', 'きっとできる', 'やったー！', '一緒に頑張ろう'],
            speechPatterns: ['〜だよ！', '〜ね！', '〜よ！', '〜かも！'],
            dialectNotes: '標準語。明るく励ます口調。',
            forbiddenPhrases: ['無理', 'できない', 'ダメ', '諦めて'],
        },
    },
];


/**
 * NPC別会話テンプレート
 * ${variable} 形式でコンテキスト変数を埋め込み可能
 */
export const NPC_DIALOGUE_TEMPLATES: Record<string, Record<DialoguePhase, string[]>> = {
    char_1: {
        intro: [
            '${spotName}に着いたわね。ここは${tourismAnchor}として知られているの。',
            '私の調べによると、${spotName}は${tourismAnchor}なのよ。',
            '${playerName}、ここが${spotName}よ。歴史的には${tourismAnchor}として重要な場所ね。',
        ],
        observation: [
            '興味深いわ。${specificDetail}に注目してみて。',
            '歴史を紐解くと、この場所には深い意味があるのよ。',
            '${tourismAnchor}という特徴が、今回の謎と関係しているかもしれないわね。',
        ],
        connection: [
            'さっきの${prevSpotName}で見つけた手がかりと、ここには関連がありそうね。',
            'つまり、${prevClue}という情報と、この場所の特徴を組み合わせると...',
            '点と点がつながってきたわ。${sceneObjective}に近づいている気がするの。',
        ],
        puzzle_hint: [
            'ヒントを出すわね。${tourismAnchor}について考えてみて。',
            '答えは歴史の中に隠れているわ。この場所の由来を思い出して。',
            '${playerName}、落ち着いて考えれば分かるはずよ。',
        ],
        puzzle_reaction: [
            'さすがね、${playerName}。その通りよ。',
            '正解よ。${tourismAnchor}がヒントになったのね。',
            'よくできたわ。これで${sceneObjective}が達成できたわね。',
        ],
        transition: [
            '次の場所に向かいましょう。まだ謎は残っているわ。',
            '${missionGoal}に向けて、次のスポットへ進みましょう。',
            'ここでの発見を忘れずに。次も期待しているわよ、${playerName}。',
        ],
    },
    char_2: {
        intro: [
            'おっ、${spotName}に着いたな！ここは${tourismAnchor}で有名なんだ。',
            '${playerName}、ここが${spotName}だ。雰囲気いいだろ？',
            '着いたぜ！${spotName}は${tourismAnchor}として地元でも人気なんだ。',
        ],
        observation: [
            'おい見てくれ、${specificDetail}が見えるぞ。',
            'この場所の空気感、感じ取ってくれよ。何か気づくことがあるはずだ。',
            '俺の勘だと、ここには隠れた魅力がある。${tourismAnchor}だけじゃない何かがな。',
        ],
        connection: [
            'さっきの${prevSpotName}で聞いた話、覚えてるか？ここと関係ありそうだぜ。',
            '${prevClue}...これと今いる場所、つながってきたな。',
            'だんだん見えてきた。${sceneObjective}への道筋が分かってきた気がする。',
        ],
        puzzle_hint: [
            'ヒント出すぜ。この場所の名前や特徴に注目してみ。',
            '難しく考えすぎるなよ。${tourismAnchor}がそのまま答えに関係してるかも。',
            '${playerName}、五感を使って考えてみろよ。',
        ],
        puzzle_reaction: [
            'やるじゃん${playerName}！その調子だ！',
            '正解だ！${tourismAnchor}の特徴を見抜いたな。',
            'さすがだぜ。俺としても鼻が高いよ。',
        ],
        transition: [
            'よし、次行こうぜ！まだまだ探索は続くからな。',
            '${missionGoal}まであと少しだ。気合入れていこう！',
            '次のスポットも楽しみだな。ついてきてくれよ、${playerName}。',
        ],
    },
    char_3: {
        intro: [
            '${spotName}に到着しました。ここは${tourismAnchor}として記録されています。',
            '記録によると、${spotName}は${tourismAnchor}という特徴があるようです。',
            '${playerName}、ここが${spotName}です。観察ポイントを整理しますね。',
        ],
        observation: [
            '注目すべき点があります。${specificDetail}をご覧ください。',
            '観察した結果、${tourismAnchor}という特徴が謎に関係しそうです。',
            'ここのポイントは3つあります。まず${tourismAnchor}、それから...',
        ],
        connection: [
            '${prevSpotName}での情報と照合すると、関連性が見えてきます。',
            '${prevClue}という手がかりと、この場所の特徴を組み合わせると...',
            'パターンが見えてきました。${sceneObjective}に向かっていますね。',
        ],
        puzzle_hint: [
            'ヒントを整理します。${tourismAnchor}に含まれるキーワードに注目してください。',
            '論理的に考えると、この場所の特徴が答えに直結しています。',
            '${playerName}、情報を整理してみてください。答えは必ずあります。',
        ],
        puzzle_reaction: [
            '正解です、${playerName}。論理的な導出ができましたね。',
            'その通りです。${tourismAnchor}から正しく推理できました。',
            '${sceneObjective}、達成です。記録しておきますね。',
        ],
        transition: [
            '次のスポットへ移動しましょう。ここでの発見を記録しました。',
            '${missionGoal}に向けて、次のポイントへ進みます。',
            '準備はいいですか、${playerName}？次も一緒に分析しましょう。',
        ],
    },
    char_4: {
        intro: [
            '${playerName}、${spotName}に着いたよ！ここは${tourismAnchor}で素敵な場所だよね！',
            'わー、${spotName}だ！${tourismAnchor}って聞いてたけど、実際に見ると感動するね！',
            'いよいよ${spotName}よ！楽しみにしてたの、${tourismAnchor}って有名だもんね！',
        ],
        observation: [
            '見て見て！${specificDetail}があるよ！これ、ヒントになるかも！',
            'ここの雰囲気、すごくいい！${tourismAnchor}の魅力を感じるね。',
            '${playerName}、ここで大事なのは${tourismAnchor}よ。覚えておいてね！',
        ],
        connection: [
            '${prevSpotName}で見たこと、役に立ちそうだよ！関係あるんじゃない？',
            '${prevClue}って言ってたよね？ここにも関係してると思う！',
            'つながってきた！${sceneObjective}、きっとできるよ！',
        ],
        puzzle_hint: [
            '大丈夫、${playerName}ならできるよ！${tourismAnchor}を思い出してみて！',
            '難しく考えなくていいの。この場所の特徴をそのまま活かして！',
            'ヒントはね、さっき見た${specificDetail}にあるよ。頑張って！',
        ],
        puzzle_reaction: [
            'やったー！${playerName}、すごい！正解だよ！',
            '大正解！${tourismAnchor}を活かした素晴らしい答えだね！',
            'さすが${playerName}！${sceneObjective}クリアよ！',
        ],
        transition: [
            '次行こう！まだまだ楽しい探索は続くよ！',
            '${missionGoal}まであと少し！一緒に頑張ろうね！',
            '${playerName}、次も楽しみだね！ついてきて！',
        ],
    },
};

/**
 * 会話テンプレートに変数を埋め込む
 */
export const interpolateTemplate = (
    template: string,
    context: DialogueContext
): string => {
    return template
        .replace(/\$\{spotName\}/g, context.spotName || 'このスポット')
        .replace(/\$\{tourismAnchor\}/g, context.tourismAnchor || 'この場所の特徴')
        .replace(/\$\{playerName\}/g, context.playerName || '君')
        .replace(/\$\{prevSpotName\}/g, context.prevSpotName || '前のスポット')
        .replace(/\$\{prevClue\}/g, context.prevClue || '前の手がかり')
        .replace(/\$\{sceneObjective\}/g, context.sceneObjective || '目標')
        .replace(/\$\{missionGoal\}/g, context.missionGoal || '謎の解明')
        .replace(/\$\{specificDetail\}/g, context.specificDetail || '注目点');
};

/**
 * NPCとフェーズに基づいて会話を生成
 */
export const generateDialogueLine = (
    npcId: string,
    phase: DialoguePhase,
    context: DialogueContext,
    variationIndex = 0
): string => {
    const templates = NPC_DIALOGUE_TEMPLATES[npcId]?.[phase];
    if (!templates || templates.length === 0) {
        return `${context.spotName}を調査しましょう。`;
    }
    const template = templates[variationIndex % templates.length];
    return interpolateTemplate(template, context);
};

/**
 * 起承転結に基づいた会話フロー構成
 */
export const ROLE_DIALOGUE_FLOW: Record<string, DialoguePhase[]> = {
    '起': ['intro', 'observation', 'puzzle_hint'],
    '承': ['intro', 'connection', 'observation', 'puzzle_hint'],
    '転': ['intro', 'connection', 'observation', 'puzzle_hint'],
    '結': ['intro', 'connection', 'observation', 'puzzle_hint', 'puzzle_reaction', 'transition'],
};

/**
 * スポットの役割に基づいて会話セットを生成
 */
export const generateDialogueSet = (
    sceneRole: string,
    context: DialogueContext,
    npcProfiles: NPCProfile[] = DEFAULT_NPC_PROFILES
): Array<{ character_id: string; text: string; expression: string }> => {
    const roleKey = sceneRole.includes('起') ? '起'
        : sceneRole.includes('承') ? '承'
            : sceneRole.includes('転') ? '転'
                : sceneRole.includes('結') ? '結'
                    : '承';

    const phases = ROLE_DIALOGUE_FLOW[roleKey] || ['intro', 'observation'];
    const dialogues: Array<{ character_id: string; text: string; expression: string }> = [];

    phases.forEach((phase, phaseIndex) => {
        // 各フェーズで1-2人のNPCが話す
        const speakerCount = phase === 'intro' ? 2 : 1;
        for (let i = 0; i < speakerCount; i++) {
            const npc = npcProfiles[(phaseIndex + i) % npcProfiles.length];
            const text = generateDialogueLine(npc.id, phase, context, phaseIndex + context.spotIndex);
            const expression = phase === 'puzzle_reaction' ? 'excited'
                : phase === 'intro' ? 'smile'
                    : 'neutral';
            dialogues.push({
                character_id: npc.id,
                text: text.slice(0, 60), // 60文字制限
                expression,
            });
        }
    });

    return dialogues;
};

// ============================================================
// NovelGenerator 核心技術: 高品質会話生成ガイドライン
// ============================================================

/**
 * VoiceProfile から LLM 用のガイドライン文字列を生成
 * NovelGenerator の getDialogueGuidelines パターン
 */
export const buildVoiceGuidelines = (profile: NPCProfile): string => {
    const vp = profile.voiceProfile;
    if (!vp) return '';

    let guidelines = `\n### ${profile.name}（${profile.role}）の話し方ガイドライン\n`;

    // 語彙レベル
    switch (vp.vocabularyLevel) {
        case 'formal':
            guidelines += `- 丁寧で教養のある言葉遣い。完全な文、正しい文法。\n`;
            break;
        case 'casual':
            guidelines += `- 日常的でリラックスした言葉遣い。自然体。\n`;
            break;
        case 'street':
            guidelines += `- 砕けた話し方。短縮形やスラングOK。直接的な表現。\n`;
            break;
        case 'archaic':
            guidelines += `- 古風で格式のある話し方。伝統を重んじる。\n`;
            break;
    }

    // 感情表現
    switch (vp.emotionalRange) {
        case 'reserved':
            guidelines += `- 感情は控えめ。落ち着いた態度を維持。\n`;
            break;
        case 'expressive':
            guidelines += `- 感情を素直に表現。喜怒哀楽が豊か。\n`;
            break;
        case 'volatile':
            guidelines += `- 感情が激しく変動。すぐにリアクション。\n`;
            break;
        case 'stoic':
            guidelines += `- 感情をほぼ見せない。冷静沈着。\n`;
            break;
    }

    // コミュニケーションスタイル
    switch (vp.communicationStyle) {
        case 'direct':
            guidelines += `- 言いたいことをはっきり言う。回りくどくない。\n`;
            break;
        case 'indirect':
            guidelines += `- 遠回しに表現。含みを持たせる。\n`;
            break;
        case 'verbose':
            guidelines += `- 詳しく説明。文脈や背景を加える。\n`;
            break;
        case 'terse':
            guidelines += `- 短く簡潔に。余計な言葉は使わない。\n`;
            break;
        case 'poetic':
            guidelines += `- 比喩や詩的表現を使う。美しい言い回し。\n`;
            break;
    }

    // 口癖
    if (vp.catchphrases.length > 0) {
        guidelines += `- **口癖**: ${vp.catchphrases.map(p => `「${p}」`).join('、')}\n`;
    }

    // 語尾パターン
    if (vp.speechPatterns.length > 0) {
        guidelines += `- **語尾**: ${vp.speechPatterns.join('、')}\n`;
    }

    // 方言・地域性
    if (vp.dialectNotes && vp.dialectNotes.trim().length > 0) {
        guidelines += `- **方言・地域性**: ${vp.dialectNotes}\n`;
    }

    // 禁止表現
    if (vp.forbiddenPhrases.length > 0) {
        guidelines += `- **禁止**: ${vp.forbiddenPhrases.join('、')}は絶対使わない\n`;
    }

    return guidelines;
};

/**
 * 全NPCの音声ガイドラインを生成
 */
export const buildAllVoiceGuidelines = (profiles: NPCProfile[] = DEFAULT_NPC_PROFILES): string => {
    let guidelines = `\n## キャラクター音声ガイドライン（NovelGenerator準拠）\n\n`;
    guidelines += `**重要**: 各キャラクターの話し方は明確に区別すること。\n`;
    guidelines += `読者がセリフだけで誰が話しているか分かるようにする。\n\n`;

    for (const profile of profiles) {
        guidelines += buildVoiceGuidelines(profile);
        guidelines += '\n';
    }

    return guidelines;
};

/**
 * NovelGenerator の Anti-AI Pattern ガイドライン
 * AI臭さを防止するためのルール
 */
export const ANTI_AI_PATTERN_GUIDELINES = `
## AI臭さ防止ルール（Anti-AI Pattern）

### 必須チェック（各スポットで最低1つは入れる）
1. **奇妙な個人的ディテール** - クセ、趣味、持ち物など小さな個性
2. **不完全な瞬間** - 言い淀み、言い直し、脱線など人間らしい不完全さ
3. **未解決要素** - 説明しない何か、次への伏線
4. **予期せぬ構造** - 前スポットと違う始まり方
5. **身体的なディテール** - 疲れ、空腹、天気への言及など

### 禁止パターン
- 🚫 連続スポットで同じ始まり方をしない
- 🚫 全ての感情を最大強度で表現しない（「圧倒的な」「凄まじい」を乱用しない）
- 🚫 全てを説明しすぎない（読者に考える余地を残す）
- 🚫 全ての対話が完璧なリズムを持たない（意図的に崩す）
- 🚫 全ての伏線をその場で回収しない

### 具体性ルール
- ❌ 「神秘的な雰囲気」→ ✅ 「古い畳のような匂いがした」
- ❌ 「圧倒的な絶望」→ ✅ 「窓枠のペンキを爪でカリカリ剥がしていた」
- ❌ 「美しい月明かり」→ ✅ 「街灯のせいで全部緑っぽく見えた」
`;

/**
 * NovelGenerator の 70/30 ルール
 * アクション/対話 70% : 描写 30%
 */
export const SEVENTY_THIRTY_RULE = `
## 70/30ルール（会話品質）

### 構成比率
- **70%**: アクション・リアクション・対話の掛け合い
- **30%**: 状況描写・説明

### Show Don't Tell
- ❌ 「彼女は怒っていた」→ ✅ 「拳をぎゅっと握りしめた」
- ❌ 「嬉しそうだった」→ ✅ 「思わず飛び跳ねた」
- ❌ 「緊張していた」→ ✅ 「声が少し震えて」

### 会話の自然さ
- 人は完璧に話さない。「えっと」「あの」「うーん」を適度に使う
- 人は相手の話を遮ることがある
- 人は言いたいことを直接言わないことがある
- 1つの会話に1つ気まずい沈黙か誤解を入れる
`;

/**
 * プロンプトに追加する全ガイドライン
 */
export const buildNovelGeneratorGuidelines = (profiles: NPCProfile[] = DEFAULT_NPC_PROFILES): string => {
    return [
        buildAllVoiceGuidelines(profiles),
        ANTI_AI_PATTERN_GUIDELINES,
        SEVENTY_THIRTY_RULE,
        NOVEL_CORE_GUIDELINES,
        NOVEL_DIALOGUE_GUIDELINES,
    ].join('\n');
};
