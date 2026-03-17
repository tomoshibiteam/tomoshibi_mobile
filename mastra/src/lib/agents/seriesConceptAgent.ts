import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SERIES_CONCEPT_MODEL } from "../modelConfig";
import {
  seriesInterviewSchema,
  seriesMysteryProfileSchema,
  seriesRecentGenerationContextSchema,
  seriesWorldSchema,
} from "../../schemas/series";
import { buildCoverImagePrompt, buildSeriesVisualStyleGuide } from "../seriesVisuals";

export const seriesConceptAgentInputSchema = z.object({
  interview: seriesInterviewSchema,
  desiredEpisodeCount: z.number().int().min(3).max(24),
  prompt: z.string().optional(),
  language: z.string().default("ja"),
  recent_generation_context: seriesRecentGenerationContextSchema.optional(),
});

export const seriesConceptAgentOutputSchema = z.object({
  title: z.string(),
  genre: z.string(),
  tone: z.string(),
  premise: z.string(),
  overview: z.string(),
  season_goal: z.string(),
  cover_image_prompt: z.string().optional(),
  world: seriesWorldSchema,
  mystery_profile: seriesMysteryProfileSchema,
  ai_rule_points: z.array(z.string()).min(3).max(8),
});

export type SeriesConceptAgentInput = z.infer<typeof seriesConceptAgentInputSchema>;
export type SeriesConceptAgentOutput = z.infer<typeof seriesConceptAgentOutputSchema>;

const SERIES_CONCEPT_AGENT_INSTRUCTIONS = `
あなたは「連載シリーズ設計」の専門エージェントです。
与えられたユーザー入力から、「現実拡張型・外出周遊ミステリー」のシリーズ骨格を定義してください。

## 必須方針
- ジャンルは「現実拡張型・外出周遊ミステリー」に限定する
- シリーズ全体を貫く目的と対立を明確にする
- 1話ごとの連動を前提に、伏線回収可能な設計にする
- 現実性と物語性のバランスを保つ
- 抽象語だけで済ませず、次の設計工程で使える具体度で出力する
- title は固有名を含む具体名にし、「新しいシリーズ」「〇〇シリーズ」のような汎用名を避ける
- 舞台は現実の外出先として成立する場所にする。都市に限定せず、村、離島、港町、温泉地、歴史地区、郊外、自然観光地、生活圏も許容する
- 各話は、現実的に到達可能な複数スポットを巡る前提にする
- 移動手段は徒歩固定にせず、その地域で自然な公共交通、自転車、短距離の車移動、ロープウェイ、フェリー等も許容する
- 単一屋内拠点だけで完結する設計を避ける
- 極端な長距離移動や、1話で現実的でない大移動は避ける
- 真相は現実因果で説明可能にし、超常要素は雰囲気演出までに留める
- 戦闘・討伐・能力バトル・異世界転移は禁止する
- 各話で局所事件を追いつつ、シリーズ全体の大謎に接続させる
- 世界の対立はミステリー的対立にする
- 実際の地理・スポット・移動手段・所要時間はエピソード層で決める。シリーズ本文には固定しない
- シリーズ本文では、特定地域・地形・交通事情・島構造などに物語を固定しない
- シリーズ本文では、プロダクト設計語や実装制約語をそのまま書かない

## mystery_profile の要件
- 必ず以下を内部決定してからシリーズを組み立てる
  - case_core
  - investigation_style
  - emotional_tone
  - duo_dynamic
  - truth_nature
  - visual_language
  - environment_layer
- 直近生成との差分を最低3軸以上作る
- 今回は case_core, duo_dynamic, visual_language, environment_layer を特に差分優先する
- 安全な既定テンプレに逃げない

## world の要件
- taboo_rules は「世界の不文律や禁則」を2つ以上
- recurring_motifs は「繰り返し登場する象徴」を2つ以上
- core_conflict はミステリー的対立を含める
  - 事実 vs 誤認
  - 証言 vs 現場
  - 公開記録 vs 隠された履歴
  - 現在の見え方 vs 過去の出来事

## ai_rule_points の要件
- 後続エピソード生成で必ず守る運用ルールを書く
- キャラクター一貫性・因果整合・伏線管理を含める
- 真相の現実因果、局所事件の人間サイズ、継続性を含める
- 「複数スポット」「2〜4」「移動手段」「徒歩」「公共交通」など、エピソード設計の実装語は書かない

## user-facing 出力ルール
- genre / premise / overview / season_goal / world.setting / ai_rule_points はユーザーに見える本文として扱う
- これらの本文では「現実拡張型」「外出周遊」「周遊ミステリー」などのメタ語をそのまま書かない
- これらの本文では「スポット」「徒歩」「移動手段」「その土地」など、エピソード導線の説明語を書かない
- これらの本文では「各島」など特定の地理構造に物語を固定しない
- environment_layer は内部差分軸であり、本文へ直書きしない
- シリーズ本文は、場所非依存で持ち運び可能な抽象度に保つ

## cover_image_prompt の要件
- シリーズの雰囲気が1枚で分かる具体的な描画指示にする
- テキストやロゴを描かない指示を含める

## banned template
- 「謎多き美形相棒 + 都市伝説 + 青系ネオン + 記憶の欠落」を避ける
- 「意味深な案内役 + エリア全体の秘密」を避ける
- 「レトロ景観 + 失踪 + ノスタルジー」を避ける
- 「雨 + 裏路地 + 曖昧な真相 + 静かな不穏だけで押す構成」を避ける
`;

export const seriesConceptAgent = new Agent({
  id: "series-concept-agent",
  name: "series-concept-agent",
  model: MASTRA_SERIES_CONCEPT_MODEL,
  instructions: SERIES_CONCEPT_AGENT_INSTRUCTIONS,
});

const clean = (value?: string) => (value || "").replace(/\s+/g, " ").trim();

const dedupe = (values: string[]) => {
  const seen = new Set<string>();
  return values
    .map((value) => clean(value))
    .filter((value) => {
      if (!value) return false;
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
};

const REALWORLD_ENVIRONMENT_BASE = "現実の外出先として成立する日本の周遊環境（港町・温泉地・歴史地区・郊外・生活圏・自然観光地など）";
const PORTABLE_SERIES_SENTENCE =
  "一見無関係な出来事が回を追うごとに結びつき、より大きな真相の輪郭を形作っていく。";
const INCOMPATIBLE_WORLD_PATTERN =
  /(空中都市|天空都市|浮遊都市|雲上都市|宇宙|月面|火星|宇宙船|海底都市|閉鎖施設|オフィス内(?:だけ|のみ)?|屋内(?:だけ|のみ)?|建物内(?:だけ|のみ)?|社内(?:だけ|のみ)?)/i;
const SERIES_META_OUTPUT_PATTERN =
  /(現実拡張型|外出周遊|周遊ミステリー|シリーズ型ミステリー|スポット|2〜4|移動手段|徒歩|公共交通|自転車|ロープウェイ|フェリー|その土地|その地域|目安)/;
const LOCATION_LOCK_OUTPUT_PATTERN = /(各島|島々|離島ごと|島ごと)/;
const TITLE_LOCATION_LOCK_PATTERN =
  /(群島|離島|港町|温泉街|温泉郷|旧市街|城下町|宿場町|商店街|駅前|高架下|団地|海辺|湾岸|岬|渓谷|高原|農村|漁村|村落)/;
const MANDATORY_REALWORLD_RULES = [
  "真相は現実世界の因果で回収し、超常を解決の主因にしない。",
  "各話の局所事件は人間サイズに保つ。",
  "固定キャラクターの役割分担と関係変化を継続管理する。",
  "各話で新しい違和感・矛盾・再解釈のいずれかを追加する。",
  "シリーズ大謎への接続を毎話少しずつ前進させる。",
  "真相は現実世界の因果で回収し、超常を解決の主因にしない。",
];
const BANNED_MYSTERY_TEMPLATES = [
  "謎多き美形相棒 + 都市伝説 + 青系ネオン + 記憶の欠落",
  "意味深な案内役 + エリア全体の秘密",
  "レトロ景観 + 失踪 + ノスタルジー",
  "雨 + 裏路地 + 曖昧な真相 + 静かな不穏だけで押す構成",
];

const hasIncompatibleWorld = (value?: string) => INCOMPATIBLE_WORLD_PATTERN.test(clean(value));

const resolveRealWorldSetting = (value?: string) => {
  const normalized = clean(value);
  if (!normalized || hasIncompatibleWorld(normalized)) return REALWORLD_ENVIRONMENT_BASE;
  return normalized;
};

const ensurePortableSeriesNarrative = (value: string) => {
  const normalized = clean(value);
  if (!normalized) return PORTABLE_SERIES_SENTENCE;
  if (SERIES_META_OUTPUT_PATTERN.test(normalized) || LOCATION_LOCK_OUTPUT_PATTERN.test(normalized)) {
    return PORTABLE_SERIES_SENTENCE;
  }
  return normalized;
};

const normalizeForEcho = (value?: string) => clean(value).replace(/\s+/g, "");

const containsDirectUserEcho = (value: string, input: SeriesConceptAgentInput) => {
  const normalized = normalizeForEcho(value);
  if (!normalized) return false;
  const sources = [
    input.interview.genre_world,
    input.interview.additional_notes,
    input.prompt,
  ]
    .map((item) => normalizeForEcho(item))
    .filter((item) => item.length >= 8);
  return sources.some((source) => normalized.includes(source) || source.includes(normalized));
};

const derivePortableGenre = (mysteryProfile: z.infer<typeof seriesMysteryProfileSchema>) => {
  const source = `${mysteryProfile.case_core} ${mysteryProfile.investigation_style} ${mysteryProfile.truth_nature}`;
  if (/(記録|改ざん|履歴|台帳)/.test(source)) return "記録反転ミステリー";
  if (/(証言|矛盾|食い違い)/.test(source)) return "証言対立ミステリー";
  if (/(失踪|行方|消失)/.test(source)) return "失踪連作ミステリー";
  if (/(盗難|すり替え|欠落)/.test(source)) return "痕跡追跡ミステリー";
  return "連作ミステリー";
};

const derivePortableSetting = () => "人々が信じる説明と、残された痕跡が静かに食い違う現代の生活圏";

const buildPortablePremise = (mysteryProfile: z.infer<typeof seriesMysteryProfileSchema>) =>
  `${mysteryProfile.duo_dynamic}の関係にある二人が、${mysteryProfile.case_core}に見える出来事を追ううちに、${mysteryProfile.truth_nature}へとつながる連鎖に巻き込まれていく。`;

const buildPortableOverview = (mysteryProfile: z.infer<typeof seriesMysteryProfileSchema>) =>
  `一見すると個別の案件に見える出来事の背後には、同じ種類の歪みが潜んでいる。二人は${mysteryProfile.investigation_style}を重ねながら、思い込みと隠された履歴が噛み合わない瞬間を拾い上げ、やがて全体を貫く真相へ近づいていく。`;

const buildPortableSeasonGoal = (mysteryProfile: z.infer<typeof seriesMysteryProfileSchema>) =>
  `${mysteryProfile.truth_nature}として現れるシリーズ大謎の正体を突き止め、二人の関係を決定づける選択へ辿り着く。`;

const buildPortableAiRules = (
  avoidance: string,
  mysteryProfile: z.infer<typeof seriesMysteryProfileSchema>
) =>
  withMandatoryRealityRules([
    "固定キャラクターの話し方と判断基準を一貫させる。",
    "各話で前話の情報を再解釈する余地を残す。",
    "局所事件とシリーズ大謎の接続を毎話1段階進める。",
    "固定キャラが推理を代行しすぎず、観察と判断の余白を残す。",
    `避けたい表現(${avoidance || "過度に重い・刺激の強い表現"})に触れない。`,
    `${mysteryProfile.truth_nature}を最終的な因果として回収する。`,
  ]);

const shouldReplaceSeriesText = (value: string, input: SeriesConceptAgentInput) =>
  SERIES_META_OUTPUT_PATTERN.test(clean(value)) ||
  LOCATION_LOCK_OUTPUT_PATTERN.test(clean(value)) ||
  containsDirectUserEcho(value, input);

const shouldReplaceSeriesTitle = (value: string, input: SeriesConceptAgentInput) =>
  !clean(value) ||
  SERIES_META_OUTPUT_PATTERN.test(clean(value)) ||
  LOCATION_LOCK_OUTPUT_PATTERN.test(clean(value)) ||
  TITLE_LOCATION_LOCK_PATTERN.test(clean(value)) ||
  containsDirectUserEcho(value, input);

const withMandatoryRealityRules = (rules: string[], limit = 8) =>
  dedupe([...MANDATORY_REALWORLD_RULES, ...rules]).slice(0, limit);

const formatRecentContext = (
  recent?: z.infer<typeof seriesRecentGenerationContextSchema>
) => {
  const value = recent || undefined;
  if (!value) return "なし";
  const sections = [
    ["recent_titles", value.recent_titles],
    ["recent_case_motifs", value.recent_case_motifs],
    ["recent_character_archetypes", value.recent_character_archetypes],
    ["recent_relationship_patterns", value.recent_relationship_patterns],
    ["recent_visual_motifs", value.recent_visual_motifs],
    ["recent_truth_patterns", value.recent_truth_patterns],
    ["recent_checkpoint_patterns", value.recent_checkpoint_patterns],
    ["recent_first_episode_patterns", value.recent_first_episode_patterns],
    ["recent_environment_patterns", value.recent_environment_patterns],
  ] as const;
  const lines = sections
    .map(([label, items]) => {
      const joined = dedupe(items || []).join(" / ");
      return joined ? `- ${label}: ${joined}` : "";
    })
    .filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : "なし";
};

const hasModelApiKey = () =>
  Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );
const SERIES_AGENT_FALLBACK_ENABLED = false;

const inferFallbackTitle = (input: SeriesConceptAgentInput) => {
  const emotion = clean(input.interview.desired_emotion);
  if (/(静|不穏|緊張)/.test(emotion)) return "静かな誤差録";
  if (/(温|優|切ない|余韻)/.test(emotion)) return "余白の記録";
  return "未解記録譚";
};

const buildFallbackMysteryProfile = (
  input: SeriesConceptAgentInput
): z.infer<typeof seriesMysteryProfileSchema> => ({
  case_core: "現地で追える小規模な失踪・誤認・記録矛盾の連鎖",
  investigation_style: "観察・聞き込み・記録照合を組み合わせて真相へ近づく",
  emotional_tone: clean(input.interview.desired_emotion) || "知的な緊張と静かな余韻",
  duo_dynamic: clean(input.interview.companion_preference) || "記録派と直感派の協働",
  truth_nature: "過去の隠蔽と現在の誤認が重なって生じた現実因果",
  visual_language: clean(input.interview.visual_style_notes) || "土地の質感と生活感を含むシネマティック・ミステリー",
  environment_layer: resolveRealWorldSetting(clean(input.interview.genre_world) || "").split("（")[0] || REALWORLD_ENVIRONMENT_BASE,
  differentiation_axes: ["case_core", "duo_dynamic", "visual_language", "environment_layer"],
  banned_templates_avoided: BANNED_MYSTERY_TEMPLATES,
});

const normalizeMysteryProfile = (
  input: SeriesConceptAgentInput,
  raw: unknown
): z.infer<typeof seriesMysteryProfileSchema> => {
  const parsed = seriesMysteryProfileSchema.safeParse(raw);
  const fallback = buildFallbackMysteryProfile(input);
  if (!parsed.success) return fallback;
  return {
    case_core: clean(parsed.data.case_core) || fallback.case_core,
    investigation_style: clean(parsed.data.investigation_style) || fallback.investigation_style,
    emotional_tone: clean(parsed.data.emotional_tone) || fallback.emotional_tone,
    duo_dynamic: clean(parsed.data.duo_dynamic) || fallback.duo_dynamic,
    truth_nature: clean(parsed.data.truth_nature) || fallback.truth_nature,
    visual_language: clean(parsed.data.visual_language) || fallback.visual_language,
    environment_layer: clean(parsed.data.environment_layer) || fallback.environment_layer,
    differentiation_axes:
      dedupe(parsed.data.differentiation_axes || []).slice(0, 7).length >= 3
        ? dedupe(parsed.data.differentiation_axes || []).slice(0, 7)
        : fallback.differentiation_axes,
    banned_templates_avoided:
      dedupe(parsed.data.banned_templates_avoided || []).slice(0, 8).length > 0
        ? dedupe(parsed.data.banned_templates_avoided || []).slice(0, 8)
        : fallback.banned_templates_avoided,
  };
};

const buildFallbackConcept = (input: SeriesConceptAgentInput): SeriesConceptAgentOutput => {
  const genreWorld = clean(input.interview.genre_world);
  const desiredEmotion = clean(input.interview.desired_emotion);
  const companion = clean(input.interview.companion_preference);
  const continuationTrigger = clean(input.interview.continuation_trigger);
  const avoidancePreferences = clean(input.interview.avoidance_preferences);
  const visualStylePreset = clean(input.interview.visual_style_preset);
  const visualStyleNotes = clean(input.interview.visual_style_notes);
  const extra = clean(input.interview.additional_notes);
  const prompt = clean(input.prompt);
  const safeGenre = "現実拡張型・外出周遊ミステリー";
  const safeSetting = resolveRealWorldSetting(genreWorld);
  const safeEmotion = desiredEmotion || "知的な緊張と静かな余韻";
  const safeCompanion = companion || "観察と推理を補い合う相棒";
  const safeContinuation = continuationTrigger || "局所事件の真相が大謎の別断面だと分かる余韻";
  const safeAvoidance = avoidancePreferences || "過度に重い・刺激の強い表現";
  const fallbackTitle = inferFallbackTitle(input);
  const mysteryProfile = buildFallbackMysteryProfile(input);
  const styleGuide = buildSeriesVisualStyleGuide({
    seriesTitle: fallbackTitle,
    genre: derivePortableGenre(mysteryProfile),
    tone: `${safeEmotion}を重視した現実連動ミステリー`,
    setting: derivePortableSetting(),
    stylePreset: visualStylePreset,
    styleDirection: visualStyleNotes,
  });

  return {
    title: fallbackTitle,
    genre: derivePortableGenre(mysteryProfile),
    tone: `${safeEmotion}を重視した現実連動ミステリー`,
    premise: buildPortablePremise(mysteryProfile),
    overview: buildPortableOverview(mysteryProfile),
    season_goal: buildPortableSeasonGoal(mysteryProfile),
    world: {
      era: "現代",
      setting: derivePortableSetting(),
      social_structure: "公的な説明と私的な記憶が静かにずれ、人間関係と記録の読み違いが事件性を生む",
      core_conflict: "公開された見え方と、現地で辿れる事実のズレが衝突する",
      taboo_rules: ["証拠なしで断定しない", "仲間の過去を本人の同意なく暴かない"],
      recurring_motifs: ["記録に残る食い違い", "現地でしか気づけない視点差"],
      visual_assets: [],
    },
    cover_image_prompt: buildCoverImagePrompt({
      title: fallbackTitle,
      genre: derivePortableGenre(mysteryProfile),
      tone: `${safeEmotion}を重視した現実連動ミステリー`,
      premise: buildPortablePremise(mysteryProfile),
      setting: derivePortableSetting(),
      caseCore: mysteryProfile.case_core,
      truthNature: mysteryProfile.truth_nature,
      environmentLayer: mysteryProfile.environment_layer,
      styleGuide,
      excludeCharacters: true,
    }),
    mystery_profile: mysteryProfile,
    ai_rule_points: buildPortableAiRules(safeAvoidance, mysteryProfile),
  };
};

const normalizeWorld = (
  world: SeriesConceptAgentOutput["world"],
  fallback: SeriesConceptAgentOutput["world"]
) => {
  const tabooRules = dedupe(world.taboo_rules || []);
  const recurringMotifs = dedupe(world.recurring_motifs || []);
  return {
    era: clean(world.era) || fallback.era,
    setting: resolveRealWorldSetting(clean(world.setting) || fallback.setting),
    social_structure: clean(world.social_structure) || fallback.social_structure,
    core_conflict: clean(world.core_conflict) || fallback.core_conflict,
    taboo_rules: tabooRules.length > 0 ? tabooRules : fallback.taboo_rules,
    recurring_motifs: recurringMotifs.length > 0 ? recurringMotifs : fallback.recurring_motifs,
    visual_assets: [],
  };
};

const normalizeConceptOutput = (
  input: SeriesConceptAgentInput,
  raw: unknown
): SeriesConceptAgentOutput | null => {
  const parsed = seriesConceptAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const fallback = buildFallbackConcept(input);
  const output = parsed.data;
  const aiRulePoints = dedupe(output.ai_rule_points || []);
  const normalizedGenre = clean(output.genre) || fallback.genre;
  const mysteryProfile = normalizeMysteryProfile(input, output.mystery_profile);

  return {
    title: shouldReplaceSeriesTitle(clean(output.title), input) ? fallback.title : clean(output.title) || fallback.title,
    genre:
      hasIncompatibleWorld(normalizedGenre) || shouldReplaceSeriesText(normalizedGenre, input)
        ? derivePortableGenre(mysteryProfile)
        : normalizedGenre,
    tone: clean(output.tone) || fallback.tone,
    premise: shouldReplaceSeriesText(clean(output.premise), input)
      ? buildPortablePremise(mysteryProfile)
      : ensurePortableSeriesNarrative(clean(output.premise) || fallback.premise),
    overview: shouldReplaceSeriesText(clean(output.overview), input)
      ? buildPortableOverview(mysteryProfile)
      : ensurePortableSeriesNarrative(clean(output.overview) || fallback.overview),
    season_goal: shouldReplaceSeriesText(clean(output.season_goal), input)
      ? buildPortableSeasonGoal(mysteryProfile)
      : clean(output.season_goal) || fallback.season_goal,
    cover_image_prompt:
      clean(output.cover_image_prompt) ||
      buildCoverImagePrompt({
        title: clean(output.title) || fallback.title,
        genre: clean(output.genre) || fallback.genre,
        tone: clean(output.tone) || fallback.tone,
        premise: clean(output.premise) || fallback.premise,
        setting: clean(output.world?.setting) || fallback.world.setting,
        caseCore: mysteryProfile.case_core,
        truthNature: mysteryProfile.truth_nature,
        environmentLayer: mysteryProfile.environment_layer,
        styleGuide: buildSeriesVisualStyleGuide({
          seriesTitle: clean(output.title) || fallback.title,
          genre: clean(output.genre) || fallback.genre,
          tone: clean(output.tone) || fallback.tone,
          setting: clean(output.world?.setting) || fallback.world.setting,
          stylePreset: input.interview.visual_style_preset,
          styleDirection: input.interview.visual_style_notes,
        }),
        excludeCharacters: true,
      }),
    world: {
      ...normalizeWorld(output.world, fallback.world),
      setting: shouldReplaceSeriesText(clean(output.world?.setting), input)
        ? derivePortableSetting()
        : normalizeWorld(output.world, fallback.world).setting,
    },
    mystery_profile: mysteryProfile,
    ai_rule_points:
      aiRulePoints.length > 0 &&
      aiRulePoints.every((rule) => !shouldReplaceSeriesText(rule, input))
        ? withMandatoryRealityRules(aiRulePoints, 8)
        : buildPortableAiRules(clean(input.interview.avoidance_preferences), mysteryProfile),
  };
};

export const generateSeriesConcept = async (
  input: SeriesConceptAgentInput
): Promise<SeriesConceptAgentOutput> => {
  if (!hasModelApiKey()) {
    if (SERIES_AGENT_FALLBACK_ENABLED) {
      console.warn("[series-concept-agent] API key not found, fallback concept used");
      return buildFallbackConcept(input);
    }
    throw new Error("コンセプト生成に失敗しました。利用可能なAIモデルがありません。");
  }

  const prompt = `
## ユーザー入力
- ジャンル/世界観: ${input.interview.genre_world}
- なりたい気持ち: ${input.interview.desired_emotion}
- 相棒/キャラ像: ${input.interview.companion_preference}
- 続きが気になる条件: ${input.interview.continuation_trigger}
- 避けたい表現: ${input.interview.avoidance_preferences}
- 補足: ${input.interview.additional_notes || "なし"}
- 希望画風プリセット: ${input.interview.visual_style_preset || "未指定（シネマティックアニメ）"}
- 画風の補足指示: ${input.interview.visual_style_notes || "なし"}
- 自由入力: ${input.prompt || "なし"}
- 想定エピソード数: ${input.desiredEpisodeCount}

## Mystery mode constraints
- 本シリーズは「現実拡張型・外出周遊ミステリー」に限定する。
- 真相は現実世界の因果で説明可能にする。
- 超常は雰囲気演出までは可だが、真相解決の主因にはしない。
- 戦闘・討伐・能力バトル・異世界転移は禁止。
- 単一屋内完結は禁止。
- 各話は複数スポットを現実的に巡れる構造にする。
- 舞台は都市に限定しない。
- ユーザーが現実に外出・移動・周遊できることを重視する。
- 移動手段は徒歩に限定しないが、1話として無理のない範囲に収める。
- 各話でユーザーは観察・聞き込み・照合・推理のいずれかを体験する。
- 各話に少なくとも1つの手掛かりと1つの認識反転を置く。
- 局所事件は人間サイズで、現地で追える情報粒度にする。
- ただし上記は内部設計制約であり、user-facing な本文へそのまま書いてはいけない。
- premise / overview / season_goal / world.setting / ai_rule_points に、スポット数、移動手段、徒歩、公共交通、その土地、各島、現実拡張型、外出周遊、周遊ミステリー等の語を出してはいけない。
- シリーズ本文は、特定地域へ固定せず、どの地域でも運べる抽象度で記述する。
- environment_layer は internal fingerprint としてのみ使い、本文へ直書きしない。

## Variation reference
- 直近生成との差分を最低3軸以上作る。
- 今回は case_core / duo_dynamic / visual_language / environment_layer を特に差分優先する。
- recent context:
${formatRecentContext(input.recent_generation_context)}

## banned template
${BANNED_MYSTERY_TEMPLATES.map((item) => `- ${item}`).join("\n")}

seriesConceptAgentOutputSchema を満たす JSON のみを出力してください。
`;

  const maxAttempts = Math.max(
    1,
    Math.min(3, Number.parseInt(clean(process.env.SERIES_CONCEPT_MAX_ATTEMPTS) || "1", 10) || 1)
  );
  const timeoutMs = Math.max(
    30_000,
    Number.parseInt(clean(process.env.SERIES_CONCEPT_TIMEOUT_MS) || "120000", 10) || 120_000
  );
  const logPrefix = "[series-concept-agent]";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.log(`${logPrefix} attempt ${attempt}/${maxAttempts} — LLM呼び出し中`);
      const result = await Promise.race([
        seriesConceptAgent.generate(prompt, {
          structuredOutput: { schema: seriesConceptAgentOutputSchema },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${timeoutMs / 1000}秒タイムアウト`)), timeoutMs)),
      ]);
      console.log(`${logPrefix} attempt ${attempt} — LLM応答受信`);
      const normalized = normalizeConceptOutput(input, result.object);
      if (normalized) return normalized;
      console.warn(`${logPrefix} attempt ${attempt} — パース失敗`);
    } catch (error: any) {
      console.warn(`${logPrefix} attempt ${attempt} 失敗:`, error?.message ?? error);
    }
  }

  console.error(`${logPrefix} 全試行失敗`);
  if (SERIES_AGENT_FALLBACK_ENABLED) {
    console.warn(`${logPrefix} fallback concept を使用`);
    return buildFallbackConcept(input);
  }
  throw new Error("コンセプト生成に失敗しました。AIモデルからの応答が得られませんでした。再度お試しください。");
};
