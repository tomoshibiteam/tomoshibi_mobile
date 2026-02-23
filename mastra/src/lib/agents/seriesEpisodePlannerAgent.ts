import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SERIES_EPISODE_MODEL } from "../modelConfig";
import {
  seriesCharacterSchema,
  seriesEpisodeBlueprintSchema,
  seriesWorldSchema,
} from "../../schemas/series";

export const seriesEpisodePlannerAgentInputSchema = z.object({
  title: z.string(),
  premise: z.string(),
  season_goal: z.string(),
  genre: z.string(),
  tone: z.string(),
  world: seriesWorldSchema,
  characters: z.array(seriesCharacterSchema).min(3).max(8),
  desired_episode_count: z.number().int().min(3).max(24),
});

export const seriesEpisodePlannerAgentOutputSchema = z.object({
  episode_blueprints: z.array(seriesEpisodeBlueprintSchema).min(3).max(24),
});

export type SeriesEpisodePlannerAgentInput = z.infer<typeof seriesEpisodePlannerAgentInputSchema>;
export type SeriesEpisodePlannerAgentOutput = z.infer<typeof seriesEpisodePlannerAgentOutputSchema>;

const SERIES_EPISODE_AGENT_INSTRUCTIONS = `
あなたは連載シリーズの構成作家です。
シーズン全体を「導入→展開→転換→収束」で設計し、各話が次話の前提になるようにしてください。

## 必須方針
- episode_no は 1 から連番
- required_setups は過去話から受け取る前提
- payoff_targets は将来話で回収する要素
- continuity_notes には前後話との接続条件を明記
- cliffhanger は次話への推進力として機能させる
`;

export const seriesEpisodePlannerAgent = new Agent({
  id: "series-episode-planner-agent",
  name: "series-episode-planner-agent",
  model: MASTRA_SERIES_EPISODE_MODEL,
  instructions: SERIES_EPISODE_AGENT_INSTRUCTIONS,
});

const clean = (value?: string) => (value || "").replace(/\s+/g, " ").trim();

const hasModelApiKey = () =>
  Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );

const buildFallbackEpisode = (
  input: SeriesEpisodePlannerAgentInput,
  episodeNo: number
) => {
  const isFinal = episodeNo === input.desired_episode_count;
  const phase =
    episodeNo <= Math.ceil(input.desired_episode_count * 0.3)
      ? "導入"
      : episodeNo <= Math.ceil(input.desired_episode_count * 0.75)
        ? "展開"
        : "収束";
  const pivotCharacter = input.characters[(episodeNo - 1) % input.characters.length];

  return {
    episode_no: episodeNo,
    title: isFinal ? `最終話: ${input.season_goal}` : `第${episodeNo}話 ${phase}編`,
    objective: isFinal
      ? "シーズン目標を達成し、主要対立の結論を示す。"
      : `${pivotCharacter.name}を軸に新しい手がかりを獲得する。`,
    synopsis: isFinal
      ? `${input.premise}の結末として、これまでの伏線を回収する。`
      : `${input.world.setting}で事件が進展し、${pivotCharacter.name}の選択が次話の条件になる。`,
    key_location: input.world.setting || "主要舞台",
    emotional_beat: isFinal ? "喪失と再生" : "緊張と発見",
    required_setups:
      episodeNo === 1
        ? ["シリーズ開始時点の関係性を提示する。"]
        : [`第${episodeNo - 1}話のクリフハンガーを受けて開始する。`],
    payoff_targets: isFinal
      ? ["序盤で提示した対立構造", "主人公と相棒の関係変化"]
      : [`第${Math.min(input.desired_episode_count, episodeNo + 1)}話で回収する伏線`],
    cliffhanger: isFinal ? "次章へ続く余白を残して幕を閉じる。" : "新たな事実が発覚し、次話へ直結する。",
    continuity_notes: isFinal
      ? "全キャラクターの到達点を明示して閉じる。"
      : `この話で得た情報を次話冒頭で必ず参照する。`,
    suggested_mission: isFinal ? "最終判断を下す。" : `${pivotCharacter.role}の協力を得て核心へ近づく。`,
  };
};

const normalizeEpisode = (
  raw: z.infer<typeof seriesEpisodeBlueprintSchema>,
  fallback: z.infer<typeof seriesEpisodeBlueprintSchema>,
  episodeNo: number
) => {
  const requiredSetups = Array.isArray(raw.required_setups)
    ? raw.required_setups.map((item) => clean(item)).filter(Boolean)
    : [];
  const payoffTargets = Array.isArray(raw.payoff_targets)
    ? raw.payoff_targets.map((item) => clean(item)).filter(Boolean)
    : [];

  return {
    episode_no: episodeNo,
    title: clean(raw.title) || fallback.title,
    objective: clean(raw.objective) || fallback.objective,
    synopsis: clean(raw.synopsis) || fallback.synopsis,
    key_location: clean(raw.key_location) || fallback.key_location,
    emotional_beat: clean(raw.emotional_beat) || fallback.emotional_beat,
    required_setups: requiredSetups.length > 0 ? requiredSetups : fallback.required_setups,
    payoff_targets: payoffTargets.length > 0 ? payoffTargets : fallback.payoff_targets,
    cliffhanger: clean(raw.cliffhanger) || fallback.cliffhanger,
    continuity_notes: clean(raw.continuity_notes) || fallback.continuity_notes,
    suggested_mission: clean(raw.suggested_mission) || fallback.suggested_mission,
  };
};

const normalizeEpisodeOutput = (
  input: SeriesEpisodePlannerAgentInput,
  raw: unknown
): SeriesEpisodePlannerAgentOutput | null => {
  const parsed = seriesEpisodePlannerAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;

  const byEpisodeNo = new Map<number, z.infer<typeof seriesEpisodeBlueprintSchema>>();
  parsed.data.episode_blueprints.forEach((episode, index) => {
    const parsedEpisodeNo = Number.parseInt(String(episode.episode_no), 10);
    const safeNo =
      Number.isFinite(parsedEpisodeNo) && parsedEpisodeNo > 0
        ? parsedEpisodeNo
        : index + 1;
    if (!byEpisodeNo.has(safeNo)) {
      byEpisodeNo.set(safeNo, episode);
    }
  });

  const normalizedEpisodes = Array.from({ length: input.desired_episode_count }, (_, index) => {
    const episodeNo = index + 1;
    const fallback = buildFallbackEpisode(input, episodeNo);
    const rawEpisode = byEpisodeNo.get(episodeNo) || fallback;
    return normalizeEpisode(rawEpisode, fallback, episodeNo);
  });

  return { episode_blueprints: normalizedEpisodes };
};

const buildFallbackPlan = (input: SeriesEpisodePlannerAgentInput): SeriesEpisodePlannerAgentOutput => ({
  episode_blueprints: Array.from({ length: input.desired_episode_count }, (_, index) =>
    buildFallbackEpisode(input, index + 1)
  ),
});

export const generateSeriesEpisodePlan = async (
  input: SeriesEpisodePlannerAgentInput
): Promise<SeriesEpisodePlannerAgentOutput> => {
  if (!hasModelApiKey()) {
    console.warn("[series-episode-planner-agent] API key not found, fallback episode plan used");
    return buildFallbackPlan(input);
  }

  const prompt = `
## シリーズ情報
- タイトル: ${input.title}
- ジャンル: ${input.genre}
- トーン: ${input.tone}
- 前提: ${input.premise}
- シーズン目標: ${input.season_goal}
- 世界の対立: ${input.world.core_conflict}
- エピソード数: ${input.desired_episode_count}

## キャラクター
${input.characters
  .map(
    (character) =>
      `- ${character.id} ${character.name} (${character.role}) / goal: ${character.goal}`
  )
  .join("\n")}

seriesEpisodePlannerAgentOutputSchema を満たす JSON を返してください。
`;

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await seriesEpisodePlannerAgent.generate(prompt, {
        structuredOutput: { schema: seriesEpisodePlannerAgentOutputSchema },
      });
      const normalized = normalizeEpisodeOutput(input, response.object);
      if (normalized) return normalized;
    } catch (error) {
      console.warn("[series-episode-planner-agent] generation failed", { attempt, error });
    }
  }

  console.warn("[series-episode-planner-agent] fallback episode plan used");
  return buildFallbackPlan(input);
};
