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
  characters: z.array(seriesCharacterSchema).min(3).max(8),
  desired_episode_count: z.number().int().min(3).max(24),
  mystery_profile: seriesMysteryProfileSchema.optional(),
  recent_generation_context: seriesRecentGenerationContextSchema.optional(),
});

export const seriesEpisodePlannerAgentOutputSchema = z.object({
  checkpoints: z.array(seriesCheckpointSchema).min(4).max(8),
  first_episode_seed: seriesEpisodeSeedSchema,
});

export type SeriesEpisodePlannerAgentInput = z.infer<typeof seriesEpisodePlannerAgentInputSchema>;
export type SeriesEpisodePlannerAgentOutput = z.infer<typeof seriesEpisodePlannerAgentOutputSchema>;

const SERIES_EPISODE_AGENT_INSTRUCTIONS = `
あなたは連載シリーズの体験設計作家です。
シリーズの継続導線を設計しつつ、初回の現実連動型・外出周遊ミステリーエピソードに着地させてください。

## 必須方針
- checkpoints は 4〜8 個
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

const buildFallbackSpotRequirements = (setting: string) => {
  const area = clean(setting) || "中心エリア";
  return [
    {
      requirement_id: "req_1",
      scene_role: "起" as const,
      spot_role: "初期違和感を観察できる開けた地点",
      required_attributes: ["公共アクセス可能", `${area}らしさが分かる`, "現地の見え方の差が観察できる"],
      visit_constraints: ["単独屋内完結にしない", "1回の外出として無理のない導線にする"],
      tourism_value_type: "初期違和感の提示",
    },
    {
      requirement_id: "req_2",
      scene_role: "承" as const,
      spot_role: "証言確認や記録照合がしやすい半公共空間",
      required_attributes: ["人の出入りがある", "聞き込みや観察が成立する", "記録物や掲示物へ接続できる"],
      visit_constraints: ["現実的に移動可能な範囲", "公共空間または準公共空間"],
      tourism_value_type: "証言・記録の照合",
    },
    {
      requirement_id: "req_3",
      scene_role: "結" as const,
      spot_role: "認識反転を確かめられる視点差のある地点",
      required_attributes: ["締めに使える景観や視界差", "次話フックを置きやすい", "安全にアクセス可能"],
      visit_constraints: ["日中または一般的な営業時間内に成立", "帰路を現実的に確保できる"],
      tourism_value_type: "認識反転と未解決フック",
    },
  ];
};

const hasModelApiKey = () =>
  Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );
const SERIES_AGENT_FALLBACK_ENABLED = false;

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
  1
);
const EPISODE_PLANNER_BASE_TIMEOUT_MS = toPositiveInt(
  process.env.SERIES_EPISODE_PLANNER_TIMEOUT_MS,
  90_000
);
const EPISODE_PLANNER_TIMEOUT_GROWTH = toGrowthFactor(
  process.env.SERIES_EPISODE_PLANNER_TIMEOUT_GROWTH,
  1.15
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
        : `${pivotCharacter.name}の選択で、次に何を確認しに行くべきかを明確化する。`,
    unlock_hint:
      checkpointNo === 1
        ? "初回エピソードで現地の違和感を提示し、誤認の種を固定する。"
        : `CP${checkpointNo - 1}で生じた未解決点を、移動先スポットで回収して前進する。`,
    expected_emotion: checkpointNo === checkpointCount ? "達成と余韻" : "発見と高まり",
    carry_over: "次回冒頭で参照する未解決情報か証拠断片を1つ明示する。",
    knowledge_gain: "この地点で得られる新情報を1つ明示する。",
    remaining_unknown: "まだ説明できない矛盾を1つ残す。",
    next_move_reason: "次の地点へ移動する因果を1文で示す。",
  };
};

const buildFallbackEpisodeSeed = (input: SeriesEpisodePlannerAgentInput) => ({
  title: "第1話: 旅の始まり",
  objective: "シリーズの主要目的へ向かう最初の局所事件を追い、次回へ持ち越す疑問を得る。",
  opening_scene: `${input.world.setting}で、見えている事実と説明が食い違う小さな異変に遭遇し、2〜4スポットを巡る捜査行動を開始する。`,
  expected_duration_minutes: 30,
  route_style: "現実的に到達可能な複数スポットを巡る外出周遊",
  movement_style: "地域に応じた自然な移動手段を含む現実的な周遊",
  completion_condition: "主要スポットを2つ以上巡り、最初の誤認を崩して未解決の核心を持ち帰る。",
  carry_over_hint: "最初の仮説は崩れたが、次に確かめるべき相手と場所が残る。",
  inciting_incident: "現地で見たものと、事前に聞いていた説明が食い違う。",
  first_false_assumption: "最初は単純な行き違いか偶然だと思う。",
  first_reversal: "現地確認により、人為的な隠し方か誤認誘導の可能性が浮かぶ。",
  unresolved_hook: "真相に近い人物や記録は見えたが、まだ決定打が足りない。",
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
    knowledge_gain: clean(raw.knowledge_gain) || fallback.knowledge_gain,
    remaining_unknown: clean(raw.remaining_unknown) || fallback.remaining_unknown,
    next_move_reason: clean(raw.next_move_reason) || fallback.next_move_reason,
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
    route_style: ensureTraversalStyle(raw.route_style || fallback.route_style),
    movement_style: clean(raw.movement_style) || clean(fallback.movement_style) || ensureTraversalStyle(raw.route_style || fallback.route_style),
    completion_condition: clean(raw.completion_condition) || fallback.completion_condition,
    carry_over_hint: clean(raw.carry_over_hint) || fallback.carry_over_hint,
    inciting_incident: clean(raw.inciting_incident) || fallback.inciting_incident,
    first_false_assumption: clean(raw.first_false_assumption) || fallback.first_false_assumption,
    first_reversal: clean(raw.first_reversal) || fallback.first_reversal,
    unresolved_hook: clean(raw.unresolved_hook) || fallback.unresolved_hook,
    spot_requirements: normalizeSpotRequirements(raw.spot_requirements, fallback.spot_requirements),
    suggested_spots: Array.isArray(raw.suggested_spots) && raw.suggested_spots.length > 0 ? raw.suggested_spots : fallback.suggested_spots,
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
    if (SERIES_AGENT_FALLBACK_ENABLED) {
      console.warn("[series-episode-planner-agent] API key not found, fallback episode plan used");
      return buildFallbackPlan(input);
    }
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
  if (SERIES_AGENT_FALLBACK_ENABLED) {
    return buildFallbackPlan(input);
  }
  throw new Error("エピソード計画生成に失敗しました。AIモデルからの応答が得られませんでした。再度お試しください。");
};
