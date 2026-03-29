import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SERIES_CHARACTER_MODEL } from "../modelConfig";
import {
  seriesCharacterSchema,
  seriesConceptSeedSchema,
  seriesPreferenceSheetSchema,
} from "../../schemas/series";
import { buildCharacterPortraitPrompt, buildSeriesImageUrl } from "../seriesVisuals";

export const richCharacterSheetSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  must_appear: z.boolean(),
  goal: z.string(),
  arc_start: z.string(),
  arc_end: z.string(),
  personality: z.string(),
  appearance: z.string(),
  dialogue_style: z.string(),
  worldview: z.string(),
  desire: z.string(),
  fear: z.string(),
  hidden_need: z.string(),
  relation_to_user: z.string(),
  relation_arc: z.string(),
  place_reaction_style: z.string(),
  must_never_break: z.array(z.string()).min(1).max(6),
  may_evolve: z.array(z.string()).min(1).max(6),
  relationship_hooks: z
    .array(
      z.object({
        target_id: z.string().optional().default(""),
        target_name: z.string().optional().default(""),
        relation: z.string(),
      })
    )
    .min(1)
    .max(4),
});

export const seriesRichCharacterAgentInputSchema = z.object({
  title: z.string(),
  genre: z.string(),
  tone: z.string(),
  premise: z.string(),
  season_goal: z.string(),
  protagonist_position: z.string(),
  partner_description: z.string(),
  style_guide: z.string().optional(),
  target_count: z.number().int().min(2).max(8).default(2),
  concept_seed: seriesConceptSeedSchema,
  preference_sheet: seriesPreferenceSheetSchema,
});

export const seriesRichCharacterAgentOutputSchema = z.object({
  rich_characters: z.array(richCharacterSheetSchema).min(2).max(8),
});

export type SeriesRichCharacterAgentInput = z.infer<typeof seriesRichCharacterAgentInputSchema>;
export type RichCharacterSheet = z.infer<typeof richCharacterSheetSchema>;

const SERIES_RICH_CHARACTER_AGENT_INSTRUCTIONS = `
あなたはシリーズ固定キャラクター設計者です。
キャラクターを便利な案内役にせず、シリーズ固有の魅力の中核として設計してください。

## 必須
- must_appear=true/false の役割差を明確にする
- 主要キャラは関係性の推進力を持つ
- dialogue_style/worldview/desire/fear/hidden_need を具体化する
- must_never_break と may_evolve を必ず書く
- relation_to_user と relation_arc は継続利用時の変化が分かる文にする
`;

export const seriesRichCharacterAgent = new Agent({
  id: "series-rich-character-agent",
  name: "series-rich-character-agent",
  model: MASTRA_SERIES_CHARACTER_MODEL,
  instructions: SERIES_RICH_CHARACTER_AGENT_INSTRUCTIONS,
});

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();

const dedupe = (values: Array<string | undefined | null>) => {
  const seen = new Set<string>();
  return values
    .map((value) => clean(value))
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const normalizeRelationHooks = (
  hooks: Array<
    | {
        target_id?: string | null;
        target_name?: string | null;
        relation?: string | null;
      }
    | undefined
    | null
  >
) => {
  const seen = new Set<string>();
  return hooks
    .map((hook) => {
      if (!hook || typeof hook !== "object") return null;
      const targetId = clean(hook.target_id || "");
      const targetName = clean(hook.target_name || "");
      const relation = clean(hook.relation || "");
      if (!targetName || !relation) return null;
      return {
        target_id: targetId,
        target_name: targetName,
        relation,
      };
    })
    .filter((hook): hook is { target_id: string; target_name: string; relation: string } => Boolean(hook))
    .filter((hook) => {
      const key = `${hook.target_name.toLowerCase()}::${hook.relation.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
};

const hasModelApiKey = () =>
  Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );

const hashText = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
};

const PRIMARY_GIVEN_NAMES = [
  "環",
  "汐里",
  "奏多",
  "透真",
  "結衣",
  "芹",
  "玲",
  "凪",
  "匠真",
  "紬",
  "伊織",
  "朝陽",
];

const SECONDARY_GIVEN_NAMES = [
  "志乃",
  "岳",
  "鳴海",
  "椿",
  "景",
  "澄",
  "柊",
  "清",
  "紫乃",
  "巽",
  "葵",
  "悠",
];

const FAMILY_NAMES = [
  "有馬",
  "橘",
  "白石",
  "御影",
  "真柴",
  "一ノ瀬",
  "神代",
  "鳴瀬",
  "篠崎",
  "藤堂",
  "九条",
  "雪村",
];

const ANGLE_ROLE_BIAS: Record<z.infer<typeof seriesConceptSeedSchema>["generation_angle"], string> = {
  "emotion-first": "感情の機微を拾う観測者",
  "relationship-first": "関係の均衡を崩して前進させる触媒",
  "world-first": "土地のルールを読み解く案内役",
  "originality-first": "常識をずらして突破口を作る異端",
  "ending-first": "結末の鍵を先に握る当事者",
  "continuation-trigger-first": "次話の引力を設計する仕掛け人",
  "place-portability-first": "場所差分を物語価値へ変換する調停者",
  "bittersweet-first": "代償を引き受ける保護者",
};

const pickName = (seedHash: number, index: number, primary: boolean, used: Set<string>) => {
  const givenPool = primary ? PRIMARY_GIVEN_NAMES : SECONDARY_GIVEN_NAMES;
  for (let shift = 0; shift < FAMILY_NAMES.length * givenPool.length; shift += 1) {
    const family = FAMILY_NAMES[(seedHash + index * 17 + shift) % FAMILY_NAMES.length];
    const given = givenPool[(seedHash + index * 29 + shift * 3) % givenPool.length];
    const candidate = `${family} ${given}`;
    const key = candidate.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    return candidate;
  }
  const fallback = `人物${index + 1}`;
  used.add(fallback.toLowerCase());
  return fallback;
};

const fallbackRichCharacters = (input: SeriesRichCharacterAgentInput): RichCharacterSheet[] => {
  const relation = input.preference_sheet.desired_relationship_dynamics[0] || "相棒との信頼形成";
  const count = Math.max(2, Math.min(5, input.target_count));
  const continuationNeed = input.preference_sheet.continuation_needs[0] || "次話への未回収フック";
  const themeSummary = [
    input.title,
    input.genre,
    input.tone,
    input.premise,
    input.season_goal,
    input.concept_seed.seed_id,
    input.concept_seed.generation_angle,
    input.concept_seed.worldview_core,
    input.concept_seed.central_relationship_dynamic,
    input.preference_sheet.interpreted_intent_summary,
  ]
    .map((row) => clean(row))
    .filter(Boolean)
    .join("|");
  const seedHash = hashText(themeSummary);
  const usedNames = new Set<string>();
  const roleBias =
    ANGLE_ROLE_BIAS[input.concept_seed.generation_angle] || "継続導線を動かすキーパーソン";

  return Array.from({ length: count }, (_, index) => {
    const primary = index < 2;
    const no = index + 1;
    const emotion =
      input.preference_sheet.emotional_rewards[index % input.preference_sheet.emotional_rewards.length] ||
      input.preference_sheet.emotional_rewards[0] ||
      "余韻";
    const atmosphere =
      input.preference_sheet.atmosphere_keywords[index % input.preference_sheet.atmosphere_keywords.length] ||
      input.preference_sheet.atmosphere_keywords[0] ||
      "街区";
    const dynamic =
      input.preference_sheet.desired_relationship_dynamics[
        index % input.preference_sheet.desired_relationship_dynamics.length
      ] || relation;
    const name = pickName(seedHash, index, primary, usedNames);
    const role =
      no === 1
        ? clean(input.protagonist_position) || `${atmosphere}で${emotion}を追う視点人物`
        : no === 2
          ? clean(input.partner_description) || `${dynamic}を揺らす同行者`
          : `${roleBias}（${atmosphere}担当）`;

    return {
      id: `char_${no}`,
      name,
      role,
      must_appear: primary,
      goal:
        no === 1
          ? clean(input.season_goal) || `${continuationNeed}の核心へ到達する`
          : no === 2
            ? `${continuationNeed}の代償を背負い、主役を前進させる`
            : `${input.concept_seed.return_reason}を阻害/加速する選択を突き付ける`,
      arc_start: primary
        ? `${dynamic}は成立しておらず、利害優先で動く`
        : `${roleBias}として距離を保つ`,
      arc_end: primary
        ? `${input.concept_seed.ending_flavor}に向けて関係の前提を書き換える`
        : `主軸との対立を残したまま共闘の条件を提示する`,
      personality: primary
        ? `${emotion}に敏感で、観察を行動へ変える`
        : `${atmosphere}の事情に精通し、合理と情の間で揺れる`,
      appearance: primary
        ? `${atmosphere}を歩く実用装備に、識別しやすい一点色を持つ`
        : `${roleBias}を示すシルエットと小物を固定する`,
      dialogue_style: primary
        ? `${emotion}が高まると短文で核心を突く`
        : "婉曲に問いを返し、相手の選択を促す",
      worldview: primary
        ? `${input.concept_seed.worldview_core}では「歩いて確かめること」が真実への条件`
        : `${input.concept_seed.worldview_core}は均衡で保たれるが、必要なら破る`,
      desire: primary ? `${input.season_goal}の達成` : `${continuationNeed}を自分の条件で制御する`,
      fear: primary ? "関係の破断で手がかりを失うこと" : "存在意義を失い物語から退場すること",
      hidden_need: primary ? "弱さを共有できる相手を認めること" : "自分の正しさ以外の価値を受け入れること",
      relation_to_user: dynamic,
      relation_arc: `${dynamic}を「距離→共闘→再定義」で更新し、次話の感情回収点を残す`,
      place_reaction_style: `${atmosphere}の痕跡を感情語と実利語の両方で読み解く`,
      must_never_break: dedupe([
        `${roleBias}の役割を放棄しない`,
        "価値観の転換には明示的な因果を置く",
      ]).slice(0, 6),
      may_evolve: dedupe([
        `${dynamic}の距離感`,
        "信頼度に応じた発話温度",
        "役割境界の踏み越え方",
      ]).slice(0, 6),
      relationship_hooks: normalizeRelationHooks(
        no === 1
          ? [
              {
                target_id: "char_2",
                target_name: "相棒",
                relation: `${dynamic}を軸に共同で仮説を更新する。`,
              },
            ]
          : no === 2
            ? [
                {
                  target_id: "char_1",
                  target_name: "主人公",
                  relation: `${continuationNeed}へ繋がる観察補助を担う。`,
                },
              ]
            : [
                {
                  target_id: "char_1",
                  target_name: "主人公",
                  relation: `${dynamic}の解釈を揺らし、再検証を促す。`,
                },
                {
                  target_id: "char_2",
                  target_name: "相棒",
                  relation: "役割分担を通じて捜査の視点を補完する。",
                },
              ]
      ),
    };
  });
};

const normalizeRichCharacters = (
  input: SeriesRichCharacterAgentInput,
  raw: unknown
): RichCharacterSheet[] | null => {
  const parsed = seriesRichCharacterAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;

  const fallback = fallbackRichCharacters(input);
  const seenNames = new Set<string>();

  return parsed.data.rich_characters
    .slice(0, Math.max(2, Math.min(5, input.target_count)))
    .map((character, index) => {
      const fallbackRow = fallback[Math.min(index, fallback.length - 1)];
      const mustNeverBreak = dedupe(character.must_never_break).slice(0, 6);
      const mayEvolve = dedupe(character.may_evolve).slice(0, 6);
      const relationHooks = normalizeRelationHooks(character.relationship_hooks);
      let name = clean(character.name) || fallbackRow.name;
      if (seenNames.has(name.toLowerCase())) {
        name = `${name}${index + 1}`;
      }
      seenNames.add(name.toLowerCase());

      return {
        id: `char_${index + 1}`,
        name,
        role: clean(character.role) || fallbackRow.role,
        must_appear: Boolean(character.must_appear),
        goal: clean(character.goal) || fallbackRow.goal,
        arc_start: clean(character.arc_start) || fallbackRow.arc_start,
        arc_end: clean(character.arc_end) || fallbackRow.arc_end,
        personality: clean(character.personality) || fallbackRow.personality,
        appearance: clean(character.appearance) || fallbackRow.appearance,
        dialogue_style: clean(character.dialogue_style) || fallbackRow.dialogue_style,
        worldview: clean(character.worldview) || fallbackRow.worldview,
        desire: clean(character.desire) || fallbackRow.desire,
        fear: clean(character.fear) || fallbackRow.fear,
        hidden_need: clean(character.hidden_need) || fallbackRow.hidden_need,
        relation_to_user: clean(character.relation_to_user) || fallbackRow.relation_to_user,
        relation_arc: clean(character.relation_arc) || fallbackRow.relation_arc,
        place_reaction_style:
          clean(character.place_reaction_style) || fallbackRow.place_reaction_style,
        must_never_break: mustNeverBreak.length > 0 ? mustNeverBreak : fallbackRow.must_never_break,
        may_evolve: mayEvolve.length > 0 ? mayEvolve : fallbackRow.may_evolve,
        relationship_hooks: relationHooks.length > 0 ? relationHooks : fallbackRow.relationship_hooks,
      };
    });
};

const toSeriesCharacter = (
  input: SeriesRichCharacterAgentInput,
  row: RichCharacterSheet,
  index: number
): z.infer<typeof seriesCharacterSchema> => {
  const portraitPrompt = buildCharacterPortraitPrompt({
    seriesTitle: input.title,
    genre: input.genre,
    tone: input.tone,
    name: row.name,
    role: row.role,
    personality: row.personality,
    appearance: row.appearance,
    setting: input.premise,
    styleGuide: input.style_guide,
  });

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    must_appear: row.must_appear,
    goal: row.goal,
    arc_start: row.arc_start,
    arc_end: row.arc_end,
    personality: row.personality,
    appearance: row.appearance,
    portrait_prompt: portraitPrompt,
    portrait_image_url: buildSeriesImageUrl({
      prompt: portraitPrompt,
      seedKey: `${input.title}:rich-char:${index + 1}:${row.name}`,
      width: 768,
      height: 1024,
      purpose: "character_portrait",
      styleReference: input.style_guide,
    }),
    relationship_hooks: row.relationship_hooks.map((relation) => ({
      target_id: clean(relation.target_id),
      target_name: clean(relation.target_name),
      relation: clean(relation.relation),
    })),
    drive: row.desire,
    dilemma: row.hidden_need,
    arc_trigger: row.relation_arc,
    backstory: row.worldview,
    speech_pattern: row.dialogue_style,
    core_fear: row.fear,
    core_desire: row.desire,
    quirks: row.must_never_break.slice(0, 4),
  };
};

export const generateSeriesRichCharacters = async (input: SeriesRichCharacterAgentInput) => {
  if (!hasModelApiKey()) {
    throw new Error("キャラクター詳細化に失敗しました。利用可能なAIモデルがありません。");
  }

  const prompt = `
シリーズ「${input.title}」の固定キャラクターを ${Math.max(2, Math.min(5, input.target_count))} 人設計してください。

## シリーズ文脈
- generation_angle: ${input.concept_seed.generation_angle}
- one_line_hook: ${input.concept_seed.one_line_hook}
- premise: ${input.concept_seed.premise}
- central_relationship_dynamic: ${input.concept_seed.central_relationship_dynamic}
- ending_flavor: ${input.concept_seed.ending_flavor}

## ユーザー意図
- emotional_rewards: ${input.preference_sheet.emotional_rewards.join(" / ")}
- desired_relationship_dynamics: ${input.preference_sheet.desired_relationship_dynamics.join(" / ")}
- continuation_needs: ${input.preference_sheet.continuation_needs.join(" / ")}

## 必須
- must_appear=true の核キャラと補助キャラの役割差を明確にする
- 役割重複を避ける
- must_never_break / may_evolve を具体化
- relationship_hooks は { target_id, target_name, relation } 形式で返す

seriesRichCharacterAgentOutputSchema を満たす JSON のみ返してください。
`;

  const maxAttempts = 2;
  const timeoutMs = 90_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await Promise.race([
        seriesRichCharacterAgent.generate(prompt, {
          structuredOutput: { schema: seriesRichCharacterAgentOutputSchema },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${timeoutMs / 1000}秒タイムアウト`)), timeoutMs)
        ),
      ]);

      const normalized = normalizeRichCharacters(input, result.object);
      if (normalized && normalized.length >= Math.max(2, Math.min(5, input.target_count))) {
        return {
          rich_characters: normalized,
          characters: normalized.map((row, index) => toSeriesCharacter(input, row, index)),
        };
      }
    } catch (error: any) {
      console.warn("[series-rich-character-agent] attempt失敗:", error?.message ?? error);
    }
  }

  console.error("[series-rich-character-agent] 全試行失敗");
  throw new Error("キャラクター詳細化に失敗しました。外部AIの生成結果を取得できませんでした。");
};
