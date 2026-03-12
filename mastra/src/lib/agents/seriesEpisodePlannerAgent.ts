import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SERIES_EPISODE_MODEL } from "../modelConfig";
import {
  seriesCharacterSchema,
  seriesCheckpointSchema,
  seriesEpisodeSeedSchema,
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
  checkpoints: z.array(seriesCheckpointSchema).min(4).max(8),
  first_episode_seed: seriesEpisodeSeedSchema,
});

export type SeriesEpisodePlannerAgentInput = z.infer<typeof seriesEpisodePlannerAgentInputSchema>;
export type SeriesEpisodePlannerAgentOutput = z.infer<typeof seriesEpisodePlannerAgentOutputSchema>;

const SERIES_EPISODE_AGENT_INSTRUCTIONS = `
あなたは連載シリーズの体験設計作家です。
シリーズの継続導線を設計しつつ、初回の街歩きエピソードに着地させてください。

## 必須方針
- checkpoints は 4〜8 個
- checkpoints.checkpoint_no は 1 から連番
- checkpoints.carry_over は次回に引き継ぐ状態変化を記述
- first_episode_seed は 15〜30 分の街歩き体験を想定
- first_episode_seed.carry_over_hint は次回へ続けたくなる余韻にする
- first_episode_seed.spot_requirements は2〜4件で、各件に
  - requirement_id
  - scene_role
  - spot_role
  - required_attributes
  - visit_constraints
  - tourism_value_type
  を必ず入れる
- 単一の屋内拠点で完結させず、街路・公共空間の移動を含める
- 空中都市・宇宙・海底・閉鎖施設内のみ等、街歩き不能な舞台を避ける
- ここで具体スポット名は決めない（spot_roleまで）
`;

export const seriesEpisodePlannerAgent = new Agent({
  id: "series-episode-planner-agent",
  name: "series-episode-planner-agent",
  model: MASTRA_SERIES_EPISODE_MODEL,
  instructions: SERIES_EPISODE_AGENT_INSTRUCTIONS,
});

const clean = (value?: string) => (value || "").replace(/\s+/g, " ").trim();
const WALK_ROUTE_PATTERN = /(徒歩|街歩き|周遊|散策)/;
const INCOMPATIBLE_ROLE_PATTERN =
  /(オフィス内(?:だけ|のみ)?|社内(?:だけ|のみ)?|会議室|閉鎖施設|空中都市|天空都市|浮遊都市|宇宙|海底|塔内(?:だけ|のみ)?)/i;

const dedupeStrings = (values: string[]) => {
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

const ensureWalkableRouteStyle = (value?: string) => {
  const normalized = clean(value);
  if (normalized && WALK_ROUTE_PATTERN.test(normalized)) return normalized;
  return "徒歩中心の周遊";
};

const SCENE_ROLES = ["起", "承", "転", "結"] as const;
type SceneRole = (typeof SCENE_ROLES)[number];
const isSceneRole = (value: string): value is SceneRole =>
  (SCENE_ROLES as readonly string[]).includes(value);

const resolveSceneRoleForIndex = (index: number, count: number): SceneRole => {
  if (count <= 2) return index === 0 ? "起" : "結";
  if (index === 0) return "起";
  if (index === count - 1) return "結";
  return index === 1 ? "承" : "転";
};

const buildFallbackSpotRequirements = (setting: string) => {
  const area = clean(setting) || "中心エリア";
  return [
    {
      requirement_id: "req_1",
      scene_role: "起" as const,
      spot_role: "導入用の静かな公共スポット",
      required_attributes: ["公共アクセス可能", "徒歩導線の起点", `${area}らしさが分かる`],
      visit_constraints: ["日中訪問を想定", "単独屋内完結にしない"],
      tourism_value_type: "地域導入",
    },
    {
      requirement_id: "req_2",
      scene_role: "承" as const,
      spot_role: "関係進展が起こる回遊拠点",
      required_attributes: ["滞在余地がある", "会話が発生しやすい", "観光文脈に接続できる"],
      visit_constraints: ["徒歩10〜20分圏", "公共空間または準公共空間"],
      tourism_value_type: "文化体験",
    },
    {
      requirement_id: "req_3",
      scene_role: "結" as const,
      spot_role: "最後の余韻に向く見晴らし地点",
      required_attributes: ["締めに使える景観", "次話フックを置きやすい", "安全にアクセス可能"],
      visit_constraints: ["日没後も危険が低い", "徒歩で戻れる範囲"],
      tourism_value_type: "景観",
    },
  ];
};

const hasModelApiKey = () =>
  Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toGrowthFactor = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
};

const EPISODE_PLANNER_MAX_ATTEMPTS = toPositiveInt(
  process.env.SERIES_EPISODE_PLANNER_MAX_ATTEMPTS,
  2
);
const EPISODE_PLANNER_BASE_TIMEOUT_MS = toPositiveInt(
  process.env.SERIES_EPISODE_PLANNER_TIMEOUT_MS,
  75_000
);
const EPISODE_PLANNER_TIMEOUT_GROWTH = toGrowthFactor(
  process.env.SERIES_EPISODE_PLANNER_TIMEOUT_GROWTH,
  1.35
);

const resolveCheckpointCount = (desiredEpisodeCount: number) =>
  Math.max(4, Math.min(8, Math.round(desiredEpisodeCount / 2)));

const buildFallbackCheckpoint = (
  input: SeriesEpisodePlannerAgentInput,
  checkpointNo: number,
  checkpointCount: number
) => {
  const pivotCharacter = input.characters[(checkpointNo - 1) % input.characters.length];
  const phase =
    checkpointNo === 1
      ? "導入"
      : checkpointNo < checkpointCount
        ? "進展"
        : "収束";

  return {
    checkpoint_no: checkpointNo,
    title: `CP${checkpointNo}: ${phase}`,
    purpose:
      checkpointNo === checkpointCount
        ? "シーズン目標の達成条件を満たし、主要対立を決着へ導く。"
        : `${pivotCharacter.name}の選択で、徒歩で巡る次の街歩き目的を明確化する。`,
    unlock_hint:
      checkpointNo === 1
        ? "初回エピソードで街路の違和感を提示し、伏線として固定する。"
        : `CP${checkpointNo - 1}で生じた未解決点を、移動先スポットで回収して前進する。`,
    expected_emotion: checkpointNo === checkpointCount ? "達成と余韻" : "発見と高まり",
    carry_over: "次回冒頭で参照する状態変化を1つ明示する。",
  };
};

const buildFallbackEpisodeSeed = (input: SeriesEpisodePlannerAgentInput) => ({
  title: "第1話: 旅の始まり",
  objective: "シリーズの主要目的へ向かう最初の手がかりを得る。",
  opening_scene: `${input.world.setting}を歩き始めた直後に小さな違和感に出会い、2〜4スポットを巡る行動を開始する。`,
  expected_duration_minutes: 20,
  route_style: "徒歩中心の周遊",
  completion_condition: "主要スポットを2つ以上巡り、次回につながる発見を得る。",
  carry_over_hint: "相棒との会話で新たな疑問が残る。",
  spot_requirements: buildFallbackSpotRequirements(input.world.setting),
});

const normalizeSpotRequirements = (
  raw: z.infer<typeof seriesEpisodeSeedSchema>["spot_requirements"] | undefined,
  fallback: z.infer<typeof seriesEpisodeSeedSchema>["spot_requirements"]
) => {
  const base = Array.isArray(raw) ? raw : [];
  const normalized = base
    .slice(0, 4)
    .map((row, index) => {
      const fallbackRow = fallback[Math.min(index, fallback.length - 1)];
      const sceneRoleRaw = clean(String(row.scene_role || ""));
      const sceneRole = isSceneRole(sceneRoleRaw) ? sceneRoleRaw : resolveSceneRoleForIndex(index, Math.max(base.length, 2));
      const spotRole = clean(row.spot_role) || fallbackRow?.spot_role || "回遊スポット";
      if (!spotRole || INCOMPATIBLE_ROLE_PATTERN.test(spotRole)) return null;
      return {
        requirement_id: clean(row.requirement_id) || `req_${index + 1}`,
        scene_role: sceneRole,
        spot_role: spotRole,
        required_attributes: dedupeStrings(
          (Array.isArray(row.required_attributes) ? row.required_attributes : []).map((item) => clean(String(item)))
        ).slice(0, 8),
        visit_constraints: dedupeStrings(
          (Array.isArray(row.visit_constraints) ? row.visit_constraints : []).map((item) => clean(String(item)))
        ).slice(0, 8),
        tourism_value_type: clean(row.tourism_value_type) || fallbackRow?.tourism_value_type || "地域体験",
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (normalized.length < 2) return fallback;
  return normalized;
};

const normalizeCheckpoint = (
  raw: z.infer<typeof seriesCheckpointSchema>,
  fallback: z.infer<typeof seriesCheckpointSchema>,
  checkpointNo: number
) => {
  return {
    checkpoint_no: checkpointNo,
    title: clean(raw.title) || fallback.title,
    purpose: clean(raw.purpose) || fallback.purpose,
    unlock_hint: clean(raw.unlock_hint) || fallback.unlock_hint,
    expected_emotion: clean(raw.expected_emotion) || fallback.expected_emotion,
    carry_over: clean(raw.carry_over) || fallback.carry_over,
  };
};

const normalizeEpisodeSeed = (
  raw: z.infer<typeof seriesEpisodeSeedSchema>,
  fallback: z.infer<typeof seriesEpisodeSeedSchema>
) => {
  const duration = Number.parseInt(String(raw.expected_duration_minutes), 10);
  const safeDuration = Number.isFinite(duration) ? Math.max(10, Math.min(45, duration)) : fallback.expected_duration_minutes;

  return {
    title: clean(raw.title) || fallback.title,
    objective: clean(raw.objective) || fallback.objective,
    opening_scene: clean(raw.opening_scene) || fallback.opening_scene,
    expected_duration_minutes: safeDuration,
    route_style: ensureWalkableRouteStyle(raw.route_style || fallback.route_style),
    completion_condition: clean(raw.completion_condition) || fallback.completion_condition,
    carry_over_hint: clean(raw.carry_over_hint) || fallback.carry_over_hint,
    spot_requirements: normalizeSpotRequirements(raw.spot_requirements, fallback.spot_requirements),
  };
};

const normalizeEpisodeOutput = (
  input: SeriesEpisodePlannerAgentInput,
  raw: unknown
): SeriesEpisodePlannerAgentOutput | null => {
  const parsed = seriesEpisodePlannerAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;

  const checkpointCount = resolveCheckpointCount(input.desired_episode_count);
  const byCheckpointNo = new Map<number, z.infer<typeof seriesCheckpointSchema>>();
  parsed.data.checkpoints.forEach((checkpoint, index) => {
    const parsedCheckpointNo = Number.parseInt(String(checkpoint.checkpoint_no), 10);
    const safeNo = Number.isFinite(parsedCheckpointNo) && parsedCheckpointNo > 0 ? parsedCheckpointNo : index + 1;
    if (!byCheckpointNo.has(safeNo)) {
      byCheckpointNo.set(safeNo, checkpoint);
    }
  });

  const normalizedCheckpoints = Array.from({ length: checkpointCount }, (_, index) => {
    const checkpointNo = index + 1;
    const fallback = buildFallbackCheckpoint(input, checkpointNo, checkpointCount);
    const rawCheckpoint = byCheckpointNo.get(checkpointNo) || fallback;
    return normalizeCheckpoint(rawCheckpoint, fallback, checkpointNo);
  });

  const fallbackSeed = buildFallbackEpisodeSeed(input);
  const normalizedSeed = normalizeEpisodeSeed(parsed.data.first_episode_seed, fallbackSeed);

  return {
    checkpoints: normalizedCheckpoints,
    first_episode_seed: normalizedSeed,
  };
};

const buildFallbackPlan = (input: SeriesEpisodePlannerAgentInput): SeriesEpisodePlannerAgentOutput => ({
  checkpoints: Array.from({ length: resolveCheckpointCount(input.desired_episode_count) }, (_, index) =>
    buildFallbackCheckpoint(input, index + 1, resolveCheckpointCount(input.desired_episode_count))
  ),
  first_episode_seed: buildFallbackEpisodeSeed(input),
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
- 想定エピソード数: ${input.desired_episode_count}

## TOMOSHIBI 制約（最優先）
- 各 checkpoint は「徒歩で2〜4スポットを巡る」導線を前提にする。
- first_episode_seed.route_style は徒歩中心にする。
- first_episode_seed.spot_requirements は2〜4件にする。
- spot_requirements では spot_role / scene_role / required_attributes / visit_constraints / tourism_value_type を必ず出す。
- 具体スポット名は出さない。
- 単一屋内完結・空中都市・宇宙・海底・閉鎖施設内のみの舞台は採用しない。

## キャラクター
${input.characters
  .map(
    (character) =>
      `- ${character.id} ${character.name} (${character.role}) / goal: ${character.goal}`
  )
  .join("\n")}

seriesEpisodePlannerAgentOutputSchema を満たす JSON を返してください。
`;

  const maxAttempts = EPISODE_PLANNER_MAX_ATTEMPTS;
  const logPrefix = "[series-episode-planner-agent]";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const timeoutMs = Math.round(
      EPISODE_PLANNER_BASE_TIMEOUT_MS *
        Math.pow(EPISODE_PLANNER_TIMEOUT_GROWTH, Math.max(0, attempt - 1))
    );
    try {
      console.log(
        `${logPrefix} attempt ${attempt}/${maxAttempts} — LLM呼び出し中 (${Math.round(timeoutMs / 1000)}秒でタイムアウト)`
      );
      const result = await Promise.race([
        seriesEpisodePlannerAgent.generate(prompt, {
          structuredOutput: { schema: seriesEpisodePlannerAgentOutputSchema },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `エピソード計画生成が${Math.round(timeoutMs / 1000)}秒でタイムアウトしました。`
                )
              ),
            timeoutMs
          )
        ),
      ]);
      console.log(`${logPrefix} attempt ${attempt} — LLM応答受信`);
      const normalized = normalizeEpisodeOutput(input, result.object);
      if (normalized) return normalized;
      console.warn(`${logPrefix} attempt ${attempt} — パース失敗`);
    } catch (error: any) {
      console.warn(`${logPrefix} attempt ${attempt} 失敗:`, error?.message ?? error);
    }
  }

  console.error(`${logPrefix} 全試行失敗 — fallback plan を使用`);
  return buildFallbackPlan(input);
};
