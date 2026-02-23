import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SERIES_CONCEPT_MODEL } from "../modelConfig";
import {
  seriesInterviewSchema,
  seriesWorldSchema,
} from "../../schemas/series";
import { buildCoverImagePrompt } from "../seriesVisuals";

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

const hasModelApiKey = () =>
  Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );

const inferFallbackTitle = (input: SeriesConceptAgentInput) => {
  const fromGoal = clean(input.interview.main_objective).slice(0, 14);
  if (fromGoal.length >= 3) return `${fromGoal}譚`;
  return "新しいシリーズ";
};

const buildFallbackConcept = (input: SeriesConceptAgentInput): SeriesConceptAgentOutput => {
  const genreWorld = clean(input.interview.genre_world);
  const partner = clean(input.interview.partner_description);
  const objective = clean(input.interview.main_objective);
  const protagonist = clean(input.interview.protagonist_position);
  const extra = clean(input.interview.additional_notes);
  const prompt = clean(input.prompt);

  return {
    title: inferFallbackTitle(input),
    genre: genreWorld || "ドラマ",
    tone: "没入感のある連続劇",
    premise: `${protagonist}が${objective}を追う中で、${partner}との関係が物語を前進させる。`,
    overview: `${genreWorld}を舞台に、${objective}へ向かう連載シリーズ。各話の行動が次話の前提となる構成で進行する。${extra || prompt}`,
    season_goal: objective || "最終話で核心へ到達する",
    world: {
      era: "現代",
      setting: genreWorld || "複数地域をまたぐ都市圏",
      social_structure: "表の秩序と裏の情報網が併存する",
      core_conflict: "真実を隠す側と、掘り起こす側の衝突",
      taboo_rules: ["証拠なしで断定しない", "仲間の過去を本人の同意なく暴かない"],
      recurring_motifs: ["手帳に残る断片メモ", "同じ時間に届く通知"],
    },
    cover_image_prompt: buildCoverImagePrompt({
      title: inferFallbackTitle(input),
      genre: genreWorld || "ドラマ",
      tone: "没入感のある連続劇",
      premise: `${protagonist}が${objective}を追う中で、${partner}との関係が物語を前進させる。`,
      setting: genreWorld || "複数地域をまたぐ都市圏",
    }),
    ai_rule_points: [
      "各話の冒頭で前話の結果を1行で継承する。",
      "主要キャラクターの価値観変化をエピソード単位で追跡する。",
      "伏線は最大3話以内で中間回収し、最終話で大回収する。",
      "目的達成までの因果を省略せず、行動理由を明示する。",
    ],
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
    setting: clean(world.setting) || fallback.setting,
    social_structure: clean(world.social_structure) || fallback.social_structure,
    core_conflict: clean(world.core_conflict) || fallback.core_conflict,
    taboo_rules: tabooRules.length > 0 ? tabooRules : fallback.taboo_rules,
    recurring_motifs: recurringMotifs.length > 0 ? recurringMotifs : fallback.recurring_motifs,
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

  return {
    title: clean(output.title) || fallback.title,
    genre: clean(output.genre) || fallback.genre,
    tone: clean(output.tone) || fallback.tone,
    premise: clean(output.premise) || fallback.premise,
    overview: clean(output.overview) || fallback.overview,
    season_goal: clean(output.season_goal) || fallback.season_goal,
    cover_image_prompt:
      clean(output.cover_image_prompt) ||
      buildCoverImagePrompt({
        title: clean(output.title) || fallback.title,
        genre: clean(output.genre) || fallback.genre,
        tone: clean(output.tone) || fallback.tone,
        premise: clean(output.premise) || fallback.premise,
        setting: clean(output.world?.setting) || fallback.world.setting,
      }),
    world: normalizeWorld(output.world, fallback.world),
    ai_rule_points: aiRulePoints.length > 0 ? aiRulePoints.slice(0, 8) : fallback.ai_rule_points,
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
- 最大目的: ${input.interview.main_objective}
- 主人公の立ち位置: ${input.interview.protagonist_position}
- パートナー像: ${input.interview.partner_description}
- 補足: ${input.interview.additional_notes || "なし"}
- 自由入力: ${input.prompt || "なし"}
- 想定エピソード数: ${input.desiredEpisodeCount}

seriesConceptAgentOutputSchema を満たす JSON のみを出力してください。
`;

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await seriesConceptAgent.generate(prompt, {
        structuredOutput: { schema: seriesConceptAgentOutputSchema },
      });
      const normalized = normalizeConceptOutput(input, response.object);
      if (normalized) return normalized;
    } catch (error) {
      console.warn("[series-concept-agent] generation failed", { attempt, error });
    }
  }

  console.warn("[series-concept-agent] fallback concept used");
  return buildFallbackConcept(input);
};
