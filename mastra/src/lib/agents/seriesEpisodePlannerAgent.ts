import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SERIES_EPISODE_MODEL } from "../modelConfig";
import {
  seriesCharacterSchema,
  seriesCheckpointSchema,
  seriesEpisodeSeedSchema,
  seriesMysteryProfileSchema,
  seriesRecentGenerationContextSchema,
  seriesWorldSchema,
} from "../../schemas/series";

export const seriesEpisodePlannerAgentInputSchema = z.object({
  title: z.string(),
  premise: z.string(),
  season_goal: z.string(),
  genre: z.string(),
  tone: z.string(),
  world: seriesWorldSchema,
  characters: z.array(seriesCharacterSchema).min(2).max(8),
  desired_episode_count: z.literal(3),
  mystery_profile: seriesMysteryProfileSchema.optional(),
  recent_generation_context: seriesRecentGenerationContextSchema.optional(),
});

export const seriesEpisodePlannerAgentOutputSchema = z.object({
  checkpoints: z.array(seriesCheckpointSchema).length(3),
  first_episode_seed: seriesEpisodeSeedSchema,
});

const lightCheckpointSchema = z.object({
  checkpoint_no: z.number().int().min(1).max(3).optional(),
  title: z.string().optional(),
  purpose: z.string().optional(),
  unlock_hint: z.string().optional(),
  expected_emotion: z.string().optional(),
  carry_over: z.string().optional(),
  knowledge_gain: z.string().optional(),
  remaining_unknown: z.string().optional(),
  next_move_reason: z.string().optional(),
});

const lightSpotRequirementSchema = z.object({
  requirement_id: z.string().optional(),
  scene_role: z.enum(["起", "承", "転", "結"]).optional(),
  spot_role: z.string().optional(),
  required_attributes: z.array(z.string()).optional(),
  visit_constraints: z.array(z.string()).optional(),
  tourism_value_type: z.string().optional(),
});

const lightEpisodeSeedSchema = z.object({
  title: z.string().optional(),
  objective: z.string().optional(),
  opening_scene: z.string().optional(),
  expected_duration_minutes: z.number().int().min(10).max(45).optional(),
  route_style: z.string().optional(),
  movement_style: z.string().optional(),
  completion_condition: z.string().optional(),
  carry_over_hint: z.string().optional(),
  inciting_incident: z.string().optional(),
  first_false_assumption: z.string().optional(),
  first_reversal: z.string().optional(),
  unresolved_hook: z.string().optional(),
  spot_requirements: z.array(lightSpotRequirementSchema).optional(),
  suggested_spots: z.array(z.string()).optional(),
});

const lightEpisodePlannerOutputSchema = z.object({
  checkpoints: z.array(lightCheckpointSchema).min(1).max(3),
  first_episode_seed: lightEpisodeSeedSchema.optional(),
});

export type SeriesEpisodePlannerAgentInput = z.infer<typeof seriesEpisodePlannerAgentInputSchema>;
export type SeriesEpisodePlannerAgentOutput = z.infer<typeof seriesEpisodePlannerAgentOutputSchema>;

const SERIES_EPISODE_AGENT_INSTRUCTIONS = `
あなたは連載シリーズの体験設計作家です。
シリーズの継続導線を設計しつつ、初回の現実連動型・外出周遊ミステリーエピソードに着地させてください。

## 必須方針
- checkpoints は 3 個固定（導入・展開・結末）
- checkpoints.checkpoint_no は 1 から連番
- checkpoints.carry_over は次回に持ち越す未解決情報・疑念・証拠断片・関係変化を記述
- 各 checkpoint は「事件理解が一段階変わる認識更新点」にする
- 各 checkpoint には少なくとも1つの knowledge_gain / remaining_unknown / next_move_reason を持たせる
- first_episode_seed は 15〜45 分程度の現実的な外出として成立させる
- first_episode_seed.carry_over_hint は次回へ続けたくなる余韻にする
- first_episode_seed には inciting_incident / first_false_assumption / first_reversal / unresolved_hook を必ず入れる
- first_episode_seed.spot_requirements は2〜4件で、各件に
  - requirement_id
  - scene_role
  - spot_role
  - required_attributes
  - visit_constraints
  - tourism_value_type
  を必ず入れる
- 具体スポット名は決めない（spot_roleまで）
- 単一の屋内拠点で完結させず、現実的な外出・移動・周遊を含める
- 移動手段は徒歩固定にせず、その地域で自然な移動手段を許容する
- 極端に遠距離な移動や、1話で現実的でない大移動は避ける
- 超常依存、偶然依存、説明不足依存、ご都合主義依存を避ける
- ここで具体スポット名は決めない（spot_roleまで）
`;

export const seriesEpisodePlannerAgent = new Agent({
  id: "series-episode-planner-agent",
  name: "series-episode-planner-agent",
  model: MASTRA_SERIES_EPISODE_MODEL,
  instructions: SERIES_EPISODE_AGENT_INSTRUCTIONS,
});

const clean = (value?: string) => (value || "").replace(/\s+/g, " ").trim();
const cleanBounded = (value: string | undefined, maxChars: number) => {
  const normalized = clean(value);
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trimEnd()}…`;
};
const TRAVERSAL_PATTERN = /(外出|周遊|巡る|移動|公共交通|自転車|フェリー|ロープウェイ|車)/;
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

const formatRecentContext = (
  recent?: z.infer<typeof seriesRecentGenerationContextSchema>
) => {
  const value = recent || undefined;
  if (!value) return "なし";
  const sections = [
    ["recent_checkpoint_patterns", value.recent_checkpoint_patterns],
    ["recent_first_episode_patterns", value.recent_first_episode_patterns],
    ["recent_environment_patterns", value.recent_environment_patterns],
    ["recent_truth_patterns", value.recent_truth_patterns],
  ] as const;
  const lines = sections
    .map(([label, items]) => {
      const joined = dedupeStrings(items || []).join(" / ");
      return joined ? `- ${label}: ${joined}` : "";
    })
    .filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : "なし";
};

const ensureTraversalStyle = (value?: string) => {
  const normalized = clean(value);
  if (normalized && TRAVERSAL_PATTERN.test(normalized)) return normalized;
  return "地域に応じた自然な移動手段で巡る外出周遊";
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

const checkpointArcLabel = (checkpointNo: number, checkpointCount: number) =>
  checkpointNo === 1 ? "導入" : checkpointNo === checkpointCount ? "結末" : "展開";

const ensureArcPrefixedTitle = (title: string, checkpointNo: number, checkpointCount: number) => {
  const arc = checkpointArcLabel(checkpointNo, checkpointCount);
  const normalized = clean(title).replace(/^(導入|展開|結末)\s*[:：\-]\s*/u, "");
  if (!normalized) return "";
  return `${arc}: ${normalized}`;
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

const EPISODE_PLANNER_MAX_ATTEMPTS = 1;
const EPISODE_PLANNER_BASE_TIMEOUT_MS = Math.max(
  120_000,
  toPositiveInt(process.env.SERIES_EPISODE_PLANNER_TIMEOUT_MS, 120_000)
);
const EPISODE_PLANNER_TIMEOUT_GROWTH = toGrowthFactor(
  process.env.SERIES_EPISODE_PLANNER_TIMEOUT_GROWTH,
  1.15
);
const EPISODE_PLANNER_MAX_TOKENS = Math.max(
  800,
  Math.min(2600, Number.parseInt(clean(process.env.SERIES_EPISODE_PLANNER_MAX_TOKENS) || "1400", 10) || 1400)
);

const resolveCheckpointCount = () => 3;

const normalizeSpotRequirements = (
  raw: z.infer<typeof lightEpisodeSeedSchema>["spot_requirements"] | undefined
): z.infer<typeof seriesEpisodeSeedSchema>["spot_requirements"] | null => {
  const base = Array.isArray(raw) ? raw : [];
  const normalized = base
    .slice(0, 4)
    .map((row, index) => {
      const sceneRoleRaw = clean(String(row.scene_role || ""));
      if (!isSceneRole(sceneRoleRaw)) return null;
      const sceneRole = sceneRoleRaw;
      const spotRole = cleanBounded(row.spot_role, 160);
      if (!spotRole || INCOMPATIBLE_ROLE_PATTERN.test(spotRole)) return null;
      const tourismValueType = cleanBounded(row.tourism_value_type, 120);
      if (!tourismValueType) return null;
      return {
        requirement_id: cleanBounded(row.requirement_id, 40) || `req_${index + 1}`,
        scene_role: sceneRole,
        spot_role: spotRole,
        required_attributes: dedupeStrings(
          (Array.isArray(row.required_attributes) ? row.required_attributes : [])
            .map((item) => cleanBounded(String(item), 120))
            .filter(Boolean)
        ).slice(0, 8),
        visit_constraints: dedupeStrings(
          (Array.isArray(row.visit_constraints) ? row.visit_constraints : [])
            .map((item) => cleanBounded(String(item), 120))
            .filter(Boolean)
        ).slice(0, 8),
        tourism_value_type: tourismValueType,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (normalized.length < 2) return null;
  return normalized;
};

const normalizeCheckpoint = (
  raw: z.infer<typeof lightCheckpointSchema> | undefined,
  checkpointNo: number,
  checkpointCount: number
): z.infer<typeof seriesCheckpointSchema> | null => {
  if (!raw) return null;
  const rawTitle = cleanBounded(raw.title, 120);
  const purpose = cleanBounded(raw.purpose, 220);
  const unlockHint = cleanBounded(raw.unlock_hint, 200);
  if (!rawTitle || !purpose || !unlockHint) return null;
  const title = ensureArcPrefixedTitle(
    rawTitle,
    checkpointNo,
    checkpointCount
  );
  const expectedEmotion = cleanBounded(raw.expected_emotion, 100);
  const carryOver = cleanBounded(raw.carry_over, 220);
  const knowledgeGain = cleanBounded(raw.knowledge_gain, 200);
  const remainingUnknown = cleanBounded(raw.remaining_unknown, 200);
  const nextMoveReason = cleanBounded(raw.next_move_reason, 200);

  return {
    checkpoint_no: checkpointNo,
    title,
    purpose,
    unlock_hint: unlockHint,
    expected_emotion: expectedEmotion,
    carry_over: carryOver,
    ...(knowledgeGain ? { knowledge_gain: knowledgeGain } : {}),
    ...(remainingUnknown ? { remaining_unknown: remainingUnknown } : {}),
    ...(nextMoveReason ? { next_move_reason: nextMoveReason } : {}),
  };
};

const normalizeEpisodeSeed = (
  raw: z.infer<typeof lightEpisodeSeedSchema> | undefined
): z.infer<typeof seriesEpisodeSeedSchema> | null => {
  if (!raw) return null;
  const duration = Number.parseInt(String(raw?.expected_duration_minutes), 10);
  if (!Number.isFinite(duration)) return null;
  const safeDuration = Math.max(10, Math.min(45, duration));
  const title = cleanBounded(raw.title, 120);
  const objective = cleanBounded(raw.objective, 220);
  const openingScene = cleanBounded(raw.opening_scene, 240);
  const routeStyle = cleanBounded(raw.route_style, 120);
  const completionCondition = cleanBounded(raw.completion_condition, 220);
  const carryOverHint = cleanBounded(raw.carry_over_hint, 220);
  const spotRequirements = normalizeSpotRequirements(raw.spot_requirements);
  if (!title || !objective || !openingScene || !routeStyle || !completionCondition || !carryOverHint || !spotRequirements) {
    return null;
  }

  return {
    title,
    objective,
    opening_scene: openingScene,
    expected_duration_minutes: safeDuration,
    route_style: ensureTraversalStyle(routeStyle),
    movement_style:
      cleanBounded(raw.movement_style, 120) ||
      ensureTraversalStyle(routeStyle),
    completion_condition: completionCondition,
    carry_over_hint: carryOverHint,
    ...(cleanBounded(raw.inciting_incident, 200) ? { inciting_incident: cleanBounded(raw.inciting_incident, 200) } : {}),
    ...(cleanBounded(raw.first_false_assumption, 200) ? { first_false_assumption: cleanBounded(raw.first_false_assumption, 200) } : {}),
    ...(cleanBounded(raw.first_reversal, 200) ? { first_reversal: cleanBounded(raw.first_reversal, 200) } : {}),
    ...(cleanBounded(raw.unresolved_hook, 200) ? { unresolved_hook: cleanBounded(raw.unresolved_hook, 200) } : {}),
    spot_requirements: spotRequirements,
    suggested_spots: dedupeStrings(
      (Array.isArray(raw.suggested_spots) ? raw.suggested_spots : [])
        .map((spot) => cleanBounded(String(spot), 100))
        .filter(Boolean)
    ).slice(0, 6),
  };
};

const normalizeEpisodeOutput = (
  input: SeriesEpisodePlannerAgentInput,
  raw: unknown
): SeriesEpisodePlannerAgentOutput | null => {
  const parsed = lightEpisodePlannerOutputSchema.safeParse(raw);
  if (!parsed.success) return null;

  const checkpointCount = resolveCheckpointCount();
  const normalizedCheckpoints = Array.from({ length: checkpointCount }, (_, index) => {
    const checkpoint = normalizeCheckpoint(parsed.data.checkpoints[index], index + 1, checkpointCount);
    if (!checkpoint) return null;
    return checkpoint;
  });
  if (normalizedCheckpoints.some((checkpoint) => !checkpoint)) return null;
  const normalizedSeed = normalizeEpisodeSeed(parsed.data.first_episode_seed);
  if (!normalizedSeed) return null;

  return {
    checkpoints: normalizedCheckpoints as z.infer<typeof seriesCheckpointSchema>[],
    first_episode_seed: normalizedSeed,
  };
};

export const generateSeriesEpisodePlan = async (
  input: SeriesEpisodePlannerAgentInput
): Promise<SeriesEpisodePlannerAgentOutput> => {
  if (!hasModelApiKey()) {
    throw new Error("エピソード計画生成に失敗しました。利用可能なAIモデルがありません。");
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

## mystery_profile
- case_core: ${clean(input.mystery_profile?.case_core) || "未指定"}
- investigation_style: ${clean(input.mystery_profile?.investigation_style) || "未指定"}
- emotional_tone: ${clean(input.mystery_profile?.emotional_tone) || "未指定"}
- duo_dynamic: ${clean(input.mystery_profile?.duo_dynamic) || "未指定"}
- truth_nature: ${clean(input.mystery_profile?.truth_nature) || "未指定"}
- visual_language: ${clean(input.mystery_profile?.visual_language) || "未指定"}
- environment_layer: ${clean(input.mystery_profile?.environment_layer) || "未指定"}

## TOMOSHIBI 制約（最優先）
- checkpoints は3個固定（導入→展開→結末）にする。
- 各 checkpoint は「事件理解が一段階変わる認識更新点」にする。
- checkpoints は観光イベント列ではなく、捜査と認識更新の列にする。
- 各 checkpoint に「何が分かるか」「何がまだ分からないか」「なぜ次の地点へ移動するのか」を明示する。
- first_episode_seed は 1回の外出として成立する長さにする。
- first_episode_seed.spot_requirements は2〜4件にする。
- spot_requirements では spot_role / scene_role / required_attributes / visit_constraints / tourism_value_type を必ず出す。
- 具体スポット名は出さない。
- movement_style / traversal_style は徒歩固定にしない。
- 現実的に移動可能な範囲にする。
- 単一屋内完結・空中都市・宇宙・海底・閉鎖施設内のみの舞台は採用しない。
- 1話目には必ず inciting_incident / first_false_assumption / first_reversal / unresolved_hook を入れる。

## Variation reference
- 直近との差分を最低3点作ること。
${formatRecentContext(input.recent_generation_context)}

## キャラクター
${input.characters
  .map(
    (character) =>
      `- ${character.id} ${character.name} (${character.role}) / goal: ${character.goal} / investigation=${clean(character.investigation_function)}`
  )
  .join("\n")}

## checkpoint 設計ルール
- 各 checkpoint に少なくとも1つ含める:
  - 新しい手掛かり
  - 証言の矛盾
  - 現場と記録の不一致
  - 仮説の反転
  - キャラクター認識の更新
- 「手掛かりが更新されるから次の地点へ移動する」構造にする。

## spot_requirements 設計ルール
- spot_role は観光カテゴリではなく、捜査上の役割で書く。
- 例:
  - 初期違和感を観察できる開けた場所
  - 証言確認がしやすい人の出入りがある地点
  - 掲示物や記録と接続できる半公共空間
  - 導線矛盾を確かめられる分岐点や視点差のある場所

## 出力フォーマット（必須）
- checkpoints は必ず3件。
- 各 checkpoint の必須キーは次の4つのみ:
  - checkpoint_no
  - title
  - purpose
  - unlock_hint
- 余力があれば expected_emotion / carry_over / knowledge_gain / remaining_unknown / next_move_reason を追加してよい。
- first_episode_seed の必須キーは次の5つのみ:
  - title
  - objective
  - opening_scene
  - carry_over_hint
  - spot_requirements
- spot_requirements は2〜4件。各要素の必須キーは次の3つのみ:
  - requirement_id
  - scene_role
  - spot_role
- 余力があれば required_attributes / visit_constraints / tourism_value_type を追加してよい。
- 各フィールドは短文1つにし、スラッシュ区切りの大量列挙・同文反復を禁止する。

seriesEpisodePlannerAgentOutputSchema を満たす JSON を返してください。
`;

  const maxAttempts = EPISODE_PLANNER_MAX_ATTEMPTS;
  const logPrefix = "[series-episode-planner-agent]";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const abortController = new AbortController();
    let activeTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutMs = Math.round(
      EPISODE_PLANNER_BASE_TIMEOUT_MS *
        Math.pow(EPISODE_PLANNER_TIMEOUT_GROWTH, Math.max(0, attempt - 1))
    );
    try {
      activeTimeoutHandle = setTimeout(() => abortController.abort("series_episode_planner_timeout"), timeoutMs);
      console.log(
        `${logPrefix} attempt ${attempt}/${maxAttempts} — LLM呼び出し中 (${Math.round(timeoutMs / 1000)}秒でタイムアウト)`
      );
      const result = await seriesEpisodePlannerAgent.generate(prompt, {
        structuredOutput: { schema: lightEpisodePlannerOutputSchema },
        modelSettings: {
          maxRetries: 0,
          maxOutputTokens: EPISODE_PLANNER_MAX_TOKENS,
        },
        abortSignal: abortController.signal,
      });
      console.log(`${logPrefix} attempt ${attempt} — LLM応答受信`);
      const normalized = normalizeEpisodeOutput(input, result.object);
      if (normalized) return normalized;
      console.warn(`${logPrefix} attempt ${attempt} — パース失敗`);
    } catch (error: any) {
      if (abortController.signal.aborted) {
        console.warn(`${logPrefix} attempt ${attempt} 失敗: エピソード計画生成がタイムアウトしました（${timeoutMs}ms）`);
        console.warn(`${logPrefix} タイムアウト後の追加課金を避けるため、追加リトライしません`);
        break;
      }
      console.warn(`${logPrefix} attempt ${attempt} 失敗:`, error?.message ?? error);
    } finally {
      if (activeTimeoutHandle) clearTimeout(activeTimeoutHandle);
    }
  }

  console.error(`${logPrefix} 全試行失敗`);
  throw new Error("エピソード計画生成に失敗しました。外部AIの生成結果を取得できませんでした。");
};
