import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SERIES_CONCEPT_MODEL } from "../modelConfig";
import {
  seriesInterviewSchema,
  seriesWorldSchema,
} from "../../schemas/series";
import { buildCoverImagePrompt, buildSeriesVisualStyleGuide } from "../seriesVisuals";

export const seriesConceptAgentInputSchema = z.object({
  interview: seriesInterviewSchema,
  desiredEpisodeCount: z.number().int().min(3).max(24),
  prompt: z.string().optional(),
  language: z.string().default("ja"),
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
  ai_rule_points: z.array(z.string()).min(3).max(8),
});

export type SeriesConceptAgentInput = z.infer<typeof seriesConceptAgentInputSchema>;
export type SeriesConceptAgentOutput = z.infer<typeof seriesConceptAgentOutputSchema>;

const SERIES_CONCEPT_AGENT_INSTRUCTIONS = `
あなたは「連載シリーズ設計」の専門エージェントです。
与えられたユーザー入力から、エピソード連動を前提にシリーズの骨格を定義してください。

## 必須方針
- シリーズ全体を貫く目的と対立を明確にする
- 1話ごとの連動を前提に、伏線回収可能な設計にする
- 現実性と物語性のバランスを保つ
- 抽象語だけで済ませず、次の設計工程で使える具体度で出力する
- title は固有名を含む具体名にし、「新しいシリーズ」「〇〇シリーズ」のような汎用名を避ける
- TOMOSHIBI の前提として「街歩き」を最優先にする（徒歩で複数スポットを巡る体験）
- 単一屋内拠点で完結する設計を避ける（屋外・公共空間の移動を必ず含める）
- 空中都市・宇宙・海底・閉鎖施設内のみ等、街歩き不能な舞台は採用しない

## world の要件
- taboo_rules は「世界の不文律や禁則」を2つ以上
- recurring_motifs は「繰り返し登場する象徴」を2つ以上
- core_conflict は人物間の軋轢か社会構造の衝突を含める

## ai_rule_points の要件
- 後続エピソード生成で必ず守る運用ルールを書く
- キャラクター一貫性・因果整合・伏線管理を含める

## cover_image_prompt の要件
- シリーズの雰囲気が1枚で分かる具体的な描画指示にする
- テキストやロゴを描かない指示を含める
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

const WALKABLE_WORLD_BASE = "現代日本の徒歩で巡れる街区（駅前・商店街・公園・川沿い）";
const WALKABLE_SERIES_SENTENCE = "各話は徒歩で巡れる複数スポット（目安2〜4箇所）を移動しながら進行する。";
const INCOMPATIBLE_WORLD_PATTERN =
  /(空中都市|天空都市|浮遊都市|雲上都市|宇宙|月面|火星|宇宙船|海底都市|閉鎖施設|オフィス内(?:だけ|のみ)?|屋内(?:だけ|のみ)?|建物内(?:だけ|のみ)?|社内(?:だけ|のみ)?)/i;
const PLACE_LIKE_PATTERN = /(市|町|街|駅|商店街|路地|川|港|公園|エリア|都市|下町|温泉|郊外)/;
const MANDATORY_WALK_RULES = [
  "各エピソードは徒歩で巡れる地上の街区を舞台にし、2〜4スポットを移動して進行する。",
  "単一の屋内拠点だけで完結させず、街路・公共空間での体験導線を含める。",
  "空中都市・宇宙・海底・閉鎖施設のみなど街歩き不能な舞台設定は採用しない。",
];

const hasIncompatibleWorld = (value?: string) => INCOMPATIBLE_WORLD_PATTERN.test(clean(value));

const resolveWalkableSetting = (value?: string) => {
  const normalized = clean(value);
  if (!normalized || hasIncompatibleWorld(normalized)) return WALKABLE_WORLD_BASE;
  if (PLACE_LIKE_PATTERN.test(normalized)) return normalized;
  return `${WALKABLE_WORLD_BASE}（${normalized}テイスト）`;
};

const ensureWalkableNarrative = (value: string) => {
  const normalized = clean(value);
  if (!normalized) return WALKABLE_SERIES_SENTENCE;
  if (normalized.includes("徒歩") || normalized.includes("街歩き")) return normalized;
  return `${normalized} ${WALKABLE_SERIES_SENTENCE}`;
};

const withMandatoryWalkRules = (rules: string[], limit = 8) =>
  dedupe([...MANDATORY_WALK_RULES, ...rules]).slice(0, limit);

const hasModelApiKey = () =>
  Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );

const inferFallbackTitle = (input: SeriesConceptAgentInput) => {
  const fromGenre = clean(input.interview.genre_world).slice(0, 14);
  if (fromGenre.length >= 3) return `${fromGenre}譚`;
  const fromTrigger = clean(input.interview.continuation_trigger).slice(0, 14);
  if (fromTrigger.length >= 3) return `${fromTrigger}録`;
  return "新しいシリーズ";
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
  const safeGenre = hasIncompatibleWorld(genreWorld) ? "現代都市街歩き連続劇" : genreWorld || "現代日本の都市圏";
  const safeSetting = resolveWalkableSetting(genreWorld);
  const safeEmotion = desiredEmotion || "ワクワクと安心感";
  const safeCompanion = companion || "信頼できる相棒";
  const safeContinuation = continuationTrigger || "次回で答え合わせしたくなる余韻";
  const safeAvoidance = avoidancePreferences || "過度に重い・刺激の強い表現";
  const fallbackTitle = inferFallbackTitle(input);
  const styleGuide = buildSeriesVisualStyleGuide({
    seriesTitle: fallbackTitle,
    genre: safeGenre,
    tone: `${safeEmotion}を重視した連続劇`,
    setting: safeSetting,
    stylePreset: visualStylePreset,
    styleDirection: visualStyleNotes,
  });

  return {
    title: fallbackTitle,
    genre: safeGenre,
    tone: `${safeEmotion}を重視した連続劇`,
    premise: ensureWalkableNarrative(
      `${safeSetting}を舞台に、${safeCompanion}と共に進みながら${safeEmotion}を得られる物語体験。`
    ),
    overview: ensureWalkableNarrative(
      `${safeSetting}を舞台に、${safeContinuation}を満たす導線で進む連載シリーズ。各回で小さな達成感を作りつつ、次回への余韻を残す。避けたい表現: ${safeAvoidance}。${extra || prompt}`
    ),
    season_goal: safeContinuation,
    world: {
      era: "現代",
      setting: safeSetting,
      social_structure: "表の秩序と裏の情報網が併存する",
      core_conflict: "真実を隠す側と、掘り起こす側の衝突",
      taboo_rules: ["証拠なしで断定しない", "仲間の過去を本人の同意なく暴かない"],
      recurring_motifs: ["手帳に残る断片メモ", "同じ時間に届く通知"],
      visual_assets: [],
    },
    cover_image_prompt: buildCoverImagePrompt({
      title: fallbackTitle,
      genre: safeGenre,
      tone: `${safeEmotion}を重視した連続劇`,
      premise: `${safeGenre}を舞台に、${safeCompanion}と共に進みながら${safeEmotion}を得られる物語体験。`,
      setting: safeSetting,
      styleGuide,
      excludeCharacters: true,
    }),
    ai_rule_points: withMandatoryWalkRules([
      "各話の冒頭で前話の結果を1行で継承する。",
      "主要キャラクターの価値観変化をエピソード単位で追跡する。",
      "伏線は最大3話以内で中間回収し、最終話で大回収する。",
      "目的達成までの因果を省略せず、行動理由を明示する。",
      `避けたい表現(${safeAvoidance})に抵触しない描写を維持する。`,
    ]),
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
    setting: resolveWalkableSetting(clean(world.setting) || fallback.setting),
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

  return {
    title: clean(output.title) || fallback.title,
    genre: hasIncompatibleWorld(normalizedGenre) ? "現代都市街歩き連続劇" : normalizedGenre,
    tone: clean(output.tone) || fallback.tone,
    premise: ensureWalkableNarrative(clean(output.premise) || fallback.premise),
    overview: ensureWalkableNarrative(clean(output.overview) || fallback.overview),
    season_goal: clean(output.season_goal) || fallback.season_goal,
    cover_image_prompt:
      clean(output.cover_image_prompt) ||
      buildCoverImagePrompt({
        title: clean(output.title) || fallback.title,
        genre: clean(output.genre) || fallback.genre,
        tone: clean(output.tone) || fallback.tone,
        premise: clean(output.premise) || fallback.premise,
        setting: clean(output.world?.setting) || fallback.world.setting,
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
    world: normalizeWorld(output.world, fallback.world),
    ai_rule_points: aiRulePoints.length > 0 ? withMandatoryWalkRules(aiRulePoints, 8) : fallback.ai_rule_points,
  };
};

export const generateSeriesConcept = async (
  input: SeriesConceptAgentInput
): Promise<SeriesConceptAgentOutput> => {
  if (!hasModelApiKey()) {
    console.warn("[series-concept-agent] API key not found, fallback concept used");
    return buildFallbackConcept(input);
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

## TOMOSHIBI 制約（最優先）
- 街歩き体験が前提。各話は徒歩で2〜4スポットを巡る設計にする。
- 舞台は地上の歩行可能な都市/街区に限定する。
- 空中都市・宇宙・海底・閉鎖施設内のみ・オフィス内完結は禁止。
- 屋内単一拠点だけで終わらせず、街路や公共空間での移動を必ず含める。
- 非歩行な要望が入力されても、雰囲気だけ活かして地上街区へ再解釈する。
- cover/world/character で画風がぶれないよう、同一の画風カノンに揃える。

seriesConceptAgentOutputSchema を満たす JSON のみを出力してください。
`;

  const maxAttempts = 2;
  const timeoutMs = 60_000;
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
  throw new Error("コンセプト生成に失敗しました。AIモデルからの応答が得られませんでした。再度お試しください。");
};
