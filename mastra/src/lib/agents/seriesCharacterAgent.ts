import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SERIES_CHARACTER_MODEL } from "../modelConfig";
import {
  seriesCharacterSchema,
  seriesDeviceServiceDesignBriefSchema,
  seriesMysteryProfileSchema,
  seriesRecentGenerationContextSchema,
} from "../../schemas/series";
import { buildCharacterPortraitPrompt, buildSeriesImageUrl } from "../seriesVisuals";

export const seriesCharacterAgentInputSchema = z.object({
  title: z.string(),
  genre: z.string(),
  tone: z.string(),
  premise: z.string(),
  world_setting: z.string().optional(),
  season_goal: z.string(),
  design_brief: seriesDeviceServiceDesignBriefSchema.optional(),
  protagonist_name: z.string().optional(),
  protagonist_position: z.string(),
  partner_description: z.string(),
  style_guide: z.string().optional(),
  target_count: z.number().int().min(2).max(8).default(2),
  mystery_profile: seriesMysteryProfileSchema.optional(),
  recent_generation_context: seriesRecentGenerationContextSchema.optional(),
});

export const seriesCharacterAgentOutputSchema = z.object({
  characters: z.array(seriesCharacterSchema).min(3).max(8),
});

/** LLM に渡す軽量スキーマ（必須フィールドのみ） */
const lightRelationshipHookSchema = z.object({
  target_id: z.string().optional().default(""),
  target_name: z.string().optional().default(""),
  relation: z.string().optional().default(""),
});

const lightCharacterSchema = z.object({
  id: z.string().optional().default(""),
  name: z.string().optional().default(""),
  role: z.string().optional().default(""),
  must_appear: z.boolean().optional(),
  is_protagonist: z.boolean().optional(),
  is_partner: z.boolean().optional(),
  goal: z.string().optional().default(""),
  arc_start: z.string().optional().default(""),
  arc_end: z.string().optional().default(""),
  personality: z.string().optional().default(""),
  appearance: z.string().optional().default(""),
  relationship_hooks: z.array(lightRelationshipHookSchema).optional().default([]),
  investigation_function: z.string().optional(),
});

const lightOutputSchema = z.object({
  characters: z.array(lightCharacterSchema).min(1),
});

export type SeriesCharacterAgentInput = z.infer<typeof seriesCharacterAgentInputSchema>;
export type SeriesCharacterAgentOutput = z.infer<typeof seriesCharacterAgentOutputSchema>;

// ─── スキーマと一致した簡潔な指示（応答の安定化・高速化のため） ─────
const SERIES_CHARACTER_AGENT_INSTRUCTIONS = `
あなたはシリーズ用のキャラクター一覧を出力するエージェントです。

## 出力ルール（厳守）
- 指定されたスキーマの型とフィールド名をそのまま使うこと。
- 各文字列は簡潔にし、同じ語句の反復で文字数を稼がないこと。
- personality は**文字列1つ**（性格の一文要約）。オブジェクトは出さない。
- 各キャラクター: id(char_1〜), name, role, goal, arc_start, arc_end, personality, appearance は必須。
- role / goal / arc_start / arc_end は、事件・舞台・立場に結びつけた具体文にする（一般論の定型文は禁止）。
- must_appear は常時登場が必要なキャラのみ true。
- is_protagonist は主人公本人のみ true（原則1人）にする。
- is_partner は相棒本人のみ true（原則1人）にする。
- portrait_prompt: 画像生成用の短い英語説明（1文）。portrait_image_url: 空文字 "" でよい。
- relationship_hooks は配列で、各要素は { target_id, target_name, relation } とする。
- relationship_hooks.relation には必ず以下4要素を含めること:
  - 関係性タイプ
  - 距離感（0〜10）
  - 感情（相手に抱いている感情）
  - 補足（物語上の具体的な関係説明）
- 拡張フィールドは必要最小限に限定し、冗長な背景説明を避ける。

## ジャンル契約
- 本シリーズは「現実拡張型・外出周遊ミステリー」である。
- 超常は雰囲気演出までで、真相解決の主因にはしない。
- 固定キャラクターは「雰囲気」ではなく「捜査構造の役割」で差分を作る。
- primary 同士は investigation_function を被らせない。
- 相棒は有能すぎて全てを解決しない。ユーザーが観察・推理に参加できる余白を残す。
- 少なくとも1人は「真相に近いが全部は知らない立場」にする。
- 少なくとも1人は「ユーザーの仮説を揺らす立場」にする。
- 各キャラは signature_prop と environment_residue を持ち、事件世界の住人として視覚的に識別できるようにする。

## 固定キャラ配置契約（重要）
- target_count は「固定キャラ数（主人公を除く）」として扱う。
- 出力には主人公を明示的に含める（is_protagonist=true のキャラを必ず1人）。
- 主人公以外として「相棒」と「主要キャラ（相棒ではない）」を必ず含める。
- 3者（主人公・相棒・主要キャラ）は同じグループ/文脈に属するように設計する（孤立キャラを作らない）。
- relationship_hooks には、各キャラごとに「主人公との関係」と「もう一人の固定キャラとの関係」を最低1つずつ含める。
- protagonist_name が与えられた場合、主人公の name は必ず protagonist_name を採用する。
- Step2（world_setting / season_goal / case_core）を最優先に反映し、Step1は補助ガードレールとして使う。

## 差別化
- キャラ総数は3〜6（主人公1 + 固定キャラ2〜5）。名前・口癖・dominant_colorは互いに被らせない。
- name は原則固有名詞で命名する。is_protagonist=true の場合のみ「あなた」等の自己参照名を許容する。
- must_appear の有無を問わず、少なくとも以下3点で差分を作る。
  - duo_dynamic
  - investigation_function
  - emotional_temperature
- 「謎多き美形相棒」「少し皮肉」「過去に傷」という generic な安全テンプレへ寄せない。
`;

export const seriesCharacterAgent = new Agent({
  id: "series-character-agent",
  name: "series-character-agent",
  model: MASTRA_SERIES_CHARACTER_MODEL,
  instructions: SERIES_CHARACTER_AGENT_INSTRUCTIONS,
});

const clean = (value?: string) =>
  (value || "")
    .replace(/(?:\\n|\/n)+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
const cleanBounded = (value: string | undefined, maxChars: number) => {
  const normalized = clean(value);
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trimEnd()}…`;
};
const resolveFixedCharacterCount = (input: SeriesCharacterAgentInput) =>
  Math.max(2, Math.min(5, input.target_count));
const resolveTotalCharacterCount = (input: SeriesCharacterAgentInput) =>
  Math.max(3, Math.min(8, resolveFixedCharacterCount(input) + 1));
const isProtagonistRoleText = (role: string) =>
  /(主人公|主役|視点|プレイヤー|語り手|lead|user|ユーザー本人|あなた)/i.test(clean(role));
const isPartnerRoleText = (role: string) =>
  /(相棒|パートナー|バディ|助手|補佐|同行|partner)/i.test(clean(role));
const hasProtagonistIdentity = (
  character: Partial<SeriesCharacterAgentOutput["characters"][number]>
) => {
  if (character.is_protagonist === true) return true;
  const name = clean(character.name);
  if (isSelfReferenceName(name) || /(あなた|ユーザー本人|プレイヤー)/i.test(name)) return true;
  const role = clean(character.role);
  return /^(?:主人公|主役|プレイヤー|ユーザー本人|新入生のあなた)/i.test(role);
};

const formatRecentContext = (
  recent?: z.infer<typeof seriesRecentGenerationContextSchema>
) => {
  const value = recent || undefined;
  if (!value) return "なし";
  const sections = [
    ["recent_character_archetypes", value.recent_character_archetypes],
    ["recent_relationship_patterns", value.recent_relationship_patterns],
    ["recent_appearance_patterns", value.recent_appearance_patterns],
    ["recent_visual_motifs", value.recent_visual_motifs],
  ] as const;
  const lines = sections
    .map(([label, items]) => {
      const joined = (items || []).map((item) => clean(item)).filter(Boolean).join(" / ");
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

// ─── Visual design helpers ─────────────────────────────────────────────
const DOMINANT_COLORS = ["深紅", "群青", "翡翠", "金", "銀灰", "紫紺", "珊瑚", "墨黒"];
const BODY_TYPES = ["長身で引き締まった", "小柄で俊敏な", "がっしりとした", "華奢ながら芯のある"];
const SILHOUETTES = ["鋭角的", "流線型", "角ばった", "柔らかく丸みのある"];
const FEATURES = [
  "右目の下に古い傷痕",
  "左手首に革の腕輪",
  "常にヘッドフォンを首にかけている",
  "片眉の中に白い一筋",
  "右手の甲に小さな刺青",
  "常に手袋を外さない",
  "額にかかる長い前髪",
  "左耳に3つ並んだピアス",
];
const dedupeCharacters = (characters: SeriesCharacterAgentOutput["characters"]) => {
  const seen = new Set<string>();
  return characters.filter((character) => {
    const key = clean(character.name).toLowerCase();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const SELF_REFERENCE_NAME_PATTERN = /^(?:あなた|アナタ|you|君|きみ|プレイヤー|player|主人公|protagonist|ユーザー|self)$/i;

const isSelfReferenceName = (name?: string | null) => SELF_REFERENCE_NAME_PATTERN.test(clean(name ?? undefined));
const hasSelfReferenceToken = (name?: string | null) =>
  /(あなた|アナタ|you|プレイヤー|player|主人公|protagonist|ユーザー|self)/i.test(clean(name ?? undefined));

const enforceCharacterNamePolicy = (characters: SeriesCharacterAgentOutput["characters"]) => {
  const used = new Set<string>();

  return characters.map((character, index) => {
    let name = clean(character.name);
    const allowSelfReference = hasProtagonistIdentity(character);
    if (!name) {
      throw new Error(`character_name_missing:${index + 1}`);
    }
    if (!allowSelfReference && (isSelfReferenceName(name) || hasSelfReferenceToken(name))) {
      throw new Error(`character_name_invalid_self_reference:${name}`);
    }
    if (used.has(name.toLowerCase())) {
      throw new Error(`character_name_duplicate:${name}`);
    }
    used.add(name.toLowerCase());
    return {
      ...character,
      name,
      role: clean(character.role).replace(/プレイヤー本人|ユーザー本人/g, "主人公"),
    };
  });
};

const applyProtagonistNamePolicy = (
  input: SeriesCharacterAgentInput,
  characters: SeriesCharacterAgentOutput["characters"]
) => {
  const protagonistName = cleanBounded(input.protagonist_name, 64);
  if (!protagonistName) {
    return characters.map((character) => {
      if (!character.is_protagonist) return character;
      const normalizedName = clean(character.name);
      if (
        isSelfReferenceName(normalizedName) ||
        /(新入生のあなた|あなた|ユーザー本人|プレイヤー本人)/i.test(normalizedName)
      ) {
        return {
          ...character,
          name: "主人公",
        };
      }
      return character;
    });
  }
  return characters.map((character) =>
    character.is_protagonist
      ? {
          ...character,
          name: protagonistName,
        }
      : character
  );
};

const normalizeCharacter = (
  input: SeriesCharacterAgentInput,
  raw: Partial<SeriesCharacterAgentOutput["characters"][number]> & Record<string, any>,
  index: number
): SeriesCharacterAgentOutput["characters"][number] => {
  const relationshipHooks = Array.isArray(raw.relationship_hooks)
    ? raw.relationship_hooks
        .map((item: any) => {
          if (!item || typeof item !== "object") return null;
          const targetId = cleanBounded(item.target_id, 64);
          const targetName = cleanBounded(item.target_name, 64);
          const relation = cleanBounded(item.relation, 180);
          if (!targetId && !targetName) return null;
          if (!relation) return null;
          return {
            target_id: targetId || "",
            target_name: targetName || "",
            relation,
          };
        })
        .filter((item): item is { target_id: string; target_name: string; relation: string } => Boolean(item))
    : [];

  const baseCase =
    cleanBounded(input.mystery_profile?.case_core, 160) ||
    cleanBounded(input.premise, 160) ||
    "事件の真相";
  const baseSetting =
    cleanBounded(input.world_setting, 160) ||
    cleanBounded(input.design_brief?.target_user_context, 160) ||
    "現地";
  const name = cleanBounded(raw.name, 64) || `キャラクター${index + 1}`;
  const roleRaw = cleanBounded(raw.role, 180);
  const goalRaw = cleanBounded(raw.goal, 180);
  const arcStartRaw = cleanBounded(raw.arc_start, 180);
  const arcEndRaw = cleanBounded(raw.arc_end, 180);
  const personalityRaw = cleanBounded(raw.personality, 180);
  const appearanceRaw = cleanBounded(raw.appearance, 260);
  const isThinRole = !roleRaw || /(同行者|参加者|サポート役|メンバー)$/i.test(roleRaw);
  const isThinGoal = !goalRaw || /(物語の目的に向かって行動する|真相に迫る|事件を解決する)$/i.test(goalRaw);
  const isThinArcStart = !arcStartRaw || /(導入段階にある|まだ不明な点が多い|状況を把握していない)$/i.test(arcStartRaw);
  const isThinArcEnd = !arcEndRaw || /(最終盤で理解を深める|成長する|問題を解決する)$/i.test(arcEndRaw);
  const isThinPersonality = !personalityRaw || /(観察力が高く、状況判断に優れる|冷静で論理的|誠実で努力家)$/i.test(personalityRaw);
  const isThinAppearance = !appearanceRaw || /(印象に残る佇まい|落ち着いた装い|実務的な服装)$/i.test(appearanceRaw);
  const role = isThinRole ? `${baseSetting}で${baseCase}の解明に関わる調査チームの一員` : roleRaw;
  const goal = isThinGoal ? `${baseCase}に関する事実を集め、次の判断材料を確保する。` : goalRaw;
  const arcStart = isThinArcStart ? `${baseSetting}の事情を把握しきれず、判断に迷いがある。` : arcStartRaw;
  const arcEnd = isThinArcEnd ? `${baseCase}の因果を説明できる状態になり、自分で行動を選択できる。` : arcEndRaw;
  const personality = isThinPersonality
    ? "観察で得た事実を優先しつつ、対話で仮説を更新する実践型。"
    : personalityRaw;
  const appearance = isThinAppearance ? `${baseSetting}での移動・調査に適した、役割が伝わる装い。` : appearanceRaw;
  const selfId = `char_${index + 1}`;
  const sanitizedRelationshipHooks = relationshipHooks.filter((hook) => {
    const sameTargetId = clean(hook.target_id).toLowerCase() === selfId.toLowerCase();
    const sameTargetName = clean(hook.target_name).toLowerCase() === clean(name).toLowerCase();
    return !(sameTargetId || sameTargetName);
  });
  const investigationFunction = cleanBounded(raw.investigation_function, 140);
  const emotionalTemperature = cleanBounded(raw.emotional_temperature, 120);
  const relationshipTemperature = cleanBounded(raw.relationship_temperature, 120);
  const signatureProp = cleanBounded(raw.signature_prop, 160);
  const environmentResidue = cleanBounded(raw.environment_residue, 180);
  const postureGrammar = cleanBounded(raw.posture_grammar, 180);
  const truthProximity = cleanBounded(raw.truth_proximity, 200);
  const hypothesisPressure = cleanBounded(raw.hypothesis_pressure, 200);
  const drive = cleanBounded(raw.drive, 220);
  const dilemma = cleanBounded(raw.dilemma, 220);
  const arcMidpoint = cleanBounded(raw.arc_midpoint, 220);
  const arcTrigger = cleanBounded(raw.arc_trigger, 220);
  const backstory = cleanBounded(raw.backstory, 500);
  const coreFear = cleanBounded(raw.core_fear, 120);
  const coreDesire = cleanBounded(raw.core_desire, 120);
  const speechPattern = cleanBounded(raw.speech_pattern, 140);
  const catchphrase = cleanBounded(raw.catchphrase, 100);
  const archetype = cleanBounded(raw.archetype, 64);
  const quirks =
    Array.isArray(raw.quirks) && raw.quirks.length > 0
      ? raw.quirks.map((q) => cleanBounded(q, 100)).filter(Boolean).slice(0, 4)
      : undefined;
  const visualDesign = raw.visual_design || {
    dominant_color: DOMINANT_COLORS[index % DOMINANT_COLORS.length],
    body_type: BODY_TYPES[index % BODY_TYPES.length],
    silhouette_keyword: SILHOUETTES[index % SILHOUETTES.length],
    distinguishing_feature: FEATURES[index % FEATURES.length],
  };

  return {
    id: `char_${index + 1}`,
    name,
    role,
    must_appear: Boolean(raw.must_appear),
    is_protagonist:
      typeof raw.is_protagonist === "boolean"
        ? raw.is_protagonist
        : isProtagonistRoleText(role),
    is_partner:
      typeof raw.is_partner === "boolean"
        ? raw.is_partner
        : isPartnerRoleText(role),
    goal,
    arc_start: arcStart,
    arc_end: arcEnd,
    personality,
    appearance,
    portrait_prompt: clean(raw.portrait_prompt),
    portrait_image_url: clean(raw.portrait_image_url),
    relationship_hooks: sanitizedRelationshipHooks,
    ...(investigationFunction ? { investigation_function: investigationFunction } : {}),
    ...(emotionalTemperature ? { emotional_temperature: emotionalTemperature } : {}),
    ...(relationshipTemperature ? { relationship_temperature: relationshipTemperature } : {}),
    ...(signatureProp ? { signature_prop: signatureProp } : {}),
    ...(environmentResidue ? { environment_residue: environmentResidue } : {}),
    ...(postureGrammar ? { posture_grammar: postureGrammar } : {}),
    ...(truthProximity ? { truth_proximity: truthProximity } : {}),
    ...(hypothesisPressure ? { hypothesis_pressure: hypothesisPressure } : {}),
    ...(archetype ? { archetype } : {}),
    ...(drive ? { drive } : {}),
    ...(dilemma ? { dilemma } : {}),
    ...(arcMidpoint ? { arc_midpoint: arcMidpoint } : {}),
    ...(arcTrigger ? { arc_trigger: arcTrigger } : {}),
    ...(backstory ? { backstory } : {}),
    ...(raw.big_five ? { big_five: raw.big_five } : {}),
    ...(raw.enneagram_type ? { enneagram_type: raw.enneagram_type } : {}),
    ...(coreFear ? { core_fear: coreFear } : {}),
    ...(coreDesire ? { core_desire: coreDesire } : {}),
    ...(speechPattern ? { speech_pattern: speechPattern } : {}),
    ...(catchphrase ? { catchphrase } : {}),
    ...(quirks && quirks.length > 0 ? { quirks } : {}),
    ...(Array.isArray(raw.relationships) ? { relationships: raw.relationships } : {}),
    ...(visualDesign ? { visual_design: visualDesign } : {}),
  };
};

const applyMustAppearPolicy = (
  characters: SeriesCharacterAgentOutput["characters"]
): SeriesCharacterAgentOutput["characters"] => {
  if (characters.length === 0) return characters;
  const capped = characters.slice(0, 8);
  const protagonistIndex = capped.findIndex((character) => hasProtagonistIdentity(character));
  const resolvedProtagonistIndex = protagonistIndex >= 0 ? protagonistIndex : 0;
  const partnerIndex = capped.findIndex(
    (character, index) =>
      index !== resolvedProtagonistIndex &&
      (character.is_partner === true || isPartnerRoleText(character.role))
  );
  const resolvedPartnerIndex = partnerIndex >= 0 ? partnerIndex : Math.min(1, capped.length - 1);

  return capped.map((character, index) => ({
    ...character,
    must_appear: index === resolvedProtagonistIndex || index === resolvedPartnerIndex,
    is_protagonist: index === resolvedProtagonistIndex,
  }));
};

const applyPartnerFlagPolicy = (
  characters: SeriesCharacterAgentOutput["characters"]
): SeriesCharacterAgentOutput["characters"] => {
  if (characters.length === 0) return characters;

  const protagonistIndex = characters.findIndex((character) => hasProtagonistIdentity(character));
  const resolvedProtagonistIndex = protagonistIndex >= 0 ? protagonistIndex : 0;

  let partnerIndex = characters.findIndex(
    (character, index) => index !== resolvedProtagonistIndex && character.is_partner === true
  );
  if (partnerIndex < 0) {
    partnerIndex = characters.findIndex(
      (character, index) => index !== resolvedProtagonistIndex && isPartnerRoleText(character.role)
    );
  }
  if (partnerIndex < 0) {
    partnerIndex = characters.findIndex(
      (character, index) => index !== resolvedProtagonistIndex && character.must_appear
    );
  }
  if (partnerIndex < 0) {
    partnerIndex = characters.length > 1 ? (resolvedProtagonistIndex === 0 ? 1 : 0) : 0;
  }

  return characters.map((character, index) => ({
    ...character,
    is_protagonist: index === resolvedProtagonistIndex,
    is_partner: index === partnerIndex && index !== resolvedProtagonistIndex,
  }));
};

type RelationshipHookRow = SeriesCharacterAgentOutput["characters"][number]["relationship_hooks"][number];

const hasRelationForTarget = (hooks: RelationshipHookRow[] | undefined, targetName: string) => {
  if (!Array.isArray(hooks)) return false;
  const normalizedTarget = clean(targetName).toLowerCase();
  return hooks.some((hook) => clean(hook.target_name).toLowerCase() === normalizedTarget);
};

const buildRelationSentence = ({
  relationType,
  distance,
  emotion,
  detail,
}: {
  relationType: string;
  distance: number;
  emotion: string;
  detail: string;
}) =>
  cleanBounded(
    `関係性: ${relationType} / 距離感: ${Math.max(0, Math.min(10, distance))}/10 / 感情: ${emotion} / 補足: ${detail}`,
    180
  );

const pushRelationIfMissing = (
  hooks: RelationshipHookRow[] | undefined,
  target: { id: string; name: string },
  relation: string
) => {
  const base = Array.isArray(hooks)
    ? hooks
        .map((row) => ({
          target_id: cleanBounded(row.target_id, 64),
          target_name: cleanBounded(row.target_name, 64),
          relation: cleanBounded(row.relation, 180),
        }))
        .filter((row) => row.target_name && row.relation)
    : [];
  if (!hasRelationForTarget(base, target.name)) {
    base.push({
      target_id: cleanBounded(target.id, 64),
      target_name: cleanBounded(target.name, 64),
      relation: cleanBounded(relation, 180),
    });
  }
  return base.slice(0, 4);
};

const appendRoleIfMissing = (role: string, suffix: string, pattern: RegExp) => {
  const normalizedRole = (cleanBounded(role, 180) || "同行者").replace(/[。.!?]+$/g, "");
  if (pattern.test(normalizedRole)) return normalizedRole;
  return cleanBounded(`${normalizedRole}。${suffix}`, 180);
};

const enforceCoreCastCohesion = (
  input: SeriesCharacterAgentInput,
  characters: SeriesCharacterAgentOutput["characters"]
): SeriesCharacterAgentOutput["characters"] => {
  if (characters.length < 2) return characters;

  const protagonistIndex = characters.findIndex((character) => character.is_protagonist);
  const resolvedProtagonistIndex = protagonistIndex >= 0 ? protagonistIndex : 0;
  const partnerIndex = characters.findIndex(
    (character, index) => index !== resolvedProtagonistIndex && character.is_partner
  );
  const resolvedPartnerIndex = partnerIndex >= 0 ? partnerIndex : Math.min(1, characters.length - 1);
  const majorIndex = characters.findIndex(
    (_, index) => index !== resolvedProtagonistIndex && index !== resolvedPartnerIndex
  );
  const resolvedMajorIndex = majorIndex;

  const partner = characters[resolvedPartnerIndex];
  const protagonist = characters[resolvedProtagonistIndex];
  const major = resolvedMajorIndex >= 0 ? characters[resolvedMajorIndex] : undefined;
  const protagonistName = clean(protagonist?.name) || "主人公";
  const partnerName = clean(partner?.name) || "相棒";
  const majorName = clean(major?.name) || "主要キャラ";
  const groupSuffix = "同一調査チームの中核メンバー";
  const protagonistPosition = "主人公（ユーザー本人）";

  return characters.map((character, index) => {
    const isProtagonist = index === resolvedProtagonistIndex;
    const isPartner = index === resolvedPartnerIndex;
    const otherFixed = isPartner
      ? {
          id: major?.id || `char_${resolvedMajorIndex + 1}`,
          name: majorName,
        }
      : {
          id: partner?.id || `char_${resolvedPartnerIndex + 1}`,
          name: partnerName,
        };

    const protagonistHook = isProtagonist
      ? buildRelationSentence({
          relationType: "相棒",
          distance: 8,
          emotion: "頼もしさが強いが、先走りには少し警戒している",
          detail: `${partnerName}の行動力を信頼し、観察結果の検証を一緒に進める`,
        })
      : isPartner
        ? buildRelationSentence({
            relationType: "保護的な相棒",
            distance: 8,
            emotion: "主人公の成長を期待しつつ、危うさには不安を感じる",
            detail: `${protagonistName}の判断を補助し、現地行動の安全と推理精度を支える`,
          })
        : buildRelationSentence({
            relationType: "協力者",
            distance: 6,
            emotion: "慎重な信頼と、結果を見極めたい気持ちが混在している",
            detail: `${protagonistName}の観察を評価しつつ、証拠の裏取りで関係を深める`,
          });
    const fixedCastHook = isProtagonist
      ? resolvedMajorIndex >= 0
        ? buildRelationSentence({
            relationType: "情報協力者",
            distance: 6,
            emotion: "頼りたいが、まだ完全には信用しきれていない",
            detail: `${majorName}の証言を仮説更新に使い、矛盾点を一緒に精査する`,
          })
        : buildRelationSentence({
            relationType: "相棒",
            distance: 8,
            emotion: "信頼が厚く、判断を預けられる安心感がある",
            detail: `${partnerName}との対話を通じて次の行動を決める`,
          })
      : isPartner
        ? buildRelationSentence({
            relationType: "同僚",
            distance: 5,
            emotion: "相互に必要性を認めるが、判断の差には緊張もある",
            detail: `${otherFixed.name}と役割分担し、主人公の仮説検証を多面的に支える`,
          })
        : buildRelationSentence({
            relationType: "実務協力者",
            distance: 5,
            emotion: "有能さは認めるが、主導権には牽制もある",
            detail: `相棒の${partnerName}と情報を突き合わせ、主人公の推理を現実条件に接続する`,
          });

    const protagonistRelationTarget = isProtagonist
      ? {
          id: partner?.id || `char_${resolvedPartnerIndex + 1}`,
          name: partnerName,
        }
      : {
          id: protagonist?.id || `char_${resolvedProtagonistIndex + 1}`,
          name: protagonistName,
        };

    return {
      ...character,
      role: (() => {
        const groupAlignedRole = appendRoleIfMissing(
          character.role,
          groupSuffix,
          /(チーム|グループ|同一|所属|委員会|ゼミ|サークル|プロジェクト)/
        );
        if (!isProtagonist) return groupAlignedRole;
        return appendRoleIfMissing(
          groupAlignedRole,
          protagonistPosition,
          /(主人公|ユーザー本人|プレイヤー|視点|あなた)/
        );
      })(),
      is_protagonist: isProtagonist,
      is_partner: isPartner && !isProtagonist,
      relationship_hooks: pushRelationIfMissing(
        pushRelationIfMissing(
          character.relationship_hooks,
          protagonistRelationTarget,
          protagonistHook
        ),
        isProtagonist
          ? {
              id: major?.id || `char_${resolvedMajorIndex + 1}`,
              name: resolvedMajorIndex >= 0 ? majorName : partnerName,
            }
          : otherFixed,
        fixedCastHook
      ),
    };
  });
};

const normalizeCharacterOutput = (
  input: SeriesCharacterAgentInput,
  raw: unknown
): SeriesCharacterAgentOutput | null => {
  const parsed = lightOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const deduped = dedupeCharacters(parsed.data.characters as any);

  const targetCount = resolveTotalCharacterCount(input);
  const sourceCharacters = deduped.slice(0, targetCount);
  if (sourceCharacters.length !== targetCount) {
    return null;
  }
  const hasIncompleteRequiredField = sourceCharacters.some((character) =>
    [
      character.name,
      character.role,
      character.goal,
      character.arc_start,
      character.arc_end,
      character.personality,
      character.appearance,
    ].some((field) => !cleanBounded(field, 260))
  );
  if (hasIncompleteRequiredField) return null;
  const normalizedCharacters = sourceCharacters
    .map((character, index) => normalizeCharacter(input, character, index));
  const namePolicyAppliedCharacters = enforceCharacterNamePolicy(normalizedCharacters);
  const rolePolicyAppliedCharacters = applyPartnerFlagPolicy(namePolicyAppliedCharacters);
  const mustAppearPolicyAppliedCharacters = applyMustAppearPolicy(rolePolicyAppliedCharacters);
  const protagonistNamedCharacters = applyProtagonistNamePolicy(input, mustAppearPolicyAppliedCharacters);
  const coreCastAlignedCharacters = enforceCoreCastCohesion(input, protagonistNamedCharacters);
  if (coreCastAlignedCharacters.length !== targetCount) return null;

  return {
    characters: coreCastAlignedCharacters.map((normalized, index) => {
        const portraitPrompt =
          clean(normalized.portrait_prompt) ||
          buildCharacterPortraitPrompt({
            seriesTitle: input.title,
            genre: input.genre,
            tone: input.tone,
            name: normalized.name,
            role: normalized.role,
            personality: normalized.personality,
            appearance: normalized.appearance,
            setting:
              clean(input.world_setting) ||
              clean(input.mystery_profile?.environment_layer) ||
              input.premise,
            caseCore: clean(input.mystery_profile?.case_core),
            environmentLayer: clean(input.mystery_profile?.environment_layer),
            investigationFunction: normalized.investigation_function,
            relationshipTemperature: normalized.relationship_temperature || normalized.emotional_temperature,
            signatureProp: normalized.signature_prop,
            environmentResidue: normalized.environment_residue,
            dominantColor: normalized.visual_design?.dominant_color,
            bodyType: normalized.visual_design?.body_type,
            distinguishingFeature: normalized.visual_design?.distinguishing_feature,
            styleGuide: input.style_guide,
          });

        return {
          ...normalized,
          portrait_prompt: portraitPrompt,
          portrait_image_url: buildSeriesImageUrl({
            prompt: portraitPrompt,
            seedKey: `${input.title}:char:${index + 1}:${normalized.name}`,
            width: 768,
            height: 1024,
          }),
        };
      }),
  };
};

const CHARACTER_GENERATION_TIMEOUT_MS = Math.max(
  45_000,
  Number.parseInt(clean(process.env.SERIES_CHARACTER_GENERATION_TIMEOUT_MS) || "120000", 10) || 120_000
);
const CHARACTER_GENERATION_MAX_ATTEMPTS = 1;
const CHARACTER_GENERATION_TIMEOUT_GROWTH = Math.max(
  1,
  Number.parseFloat(clean(process.env.SERIES_CHARACTER_GENERATION_TIMEOUT_GROWTH) || "1.15") || 1.15
);
const CHARACTER_GENERATION_MAX_TOKENS = Math.max(
  1000,
  Math.min(5000, Number.parseInt(clean(process.env.SERIES_CHARACTER_GENERATION_MAX_TOKENS) || "3200", 10) || 3200)
);

export const generateSeriesCharacters = async (
  input: SeriesCharacterAgentInput
): Promise<SeriesCharacterAgentOutput> => {
  const logPrefix = "[series-character-agent]";
  console.log(`${logPrefix} 開始 — title: ${input.title}, target_count: ${input.target_count}`);

  if (!hasModelApiKey()) {
    throw new Error("キャラクター生成に失敗しました。利用可能なAIモデルがありません。");
  }

  const fixedCharacterCount = resolveFixedCharacterCount(input);
  const totalCharacterCount = resolveTotalCharacterCount(input);
  const prompt = `
シリーズ「${input.title}」のキャラクターを ${totalCharacterCount} 人分、JSON で出力してください。
（内訳: 主人公1人 + 固定キャラ${fixedCharacterCount}人）
ジャンル: ${input.genre} / トーン: ${input.tone} / 前提: ${input.premise}
コンセプト世界観（Step2）:
- world_setting: ${clean(input.world_setting) || "未指定"}
- season_goal: ${input.season_goal}
デバイスサービスデザインブリーフ（Step1）:
- experience_objective: ${clean(input.design_brief?.experience_objective) || "未指定"}
- target_user_context: ${clean(input.design_brief?.target_user_context) || "未指定"}
- usage_scene: ${clean(input.design_brief?.usage_scene) || "未指定"}
- emotional_outcome: ${clean(input.design_brief?.emotional_outcome) || "未指定"}
- tone_guardrail: ${clean(input.design_brief?.tone_guardrail) || "未指定"}
- role_design_direction: ${clean(input.design_brief?.role_design_direction) || "未指定"}
- spatial_behavior_policy: ${clean(input.design_brief?.spatial_behavior_policy) || "未指定"}
- ux_guidance_style: ${clean(input.design_brief?.ux_guidance_style) || "未指定"}
主人公: ${input.protagonist_position} / 相棒像: ${input.partner_description} / シーズン目標: ${input.season_goal}
主人公名（指定がある場合は必ず採用）: ${clean(input.protagonist_name) || "未指定"}
ミステリープロファイル:
- case_core: ${clean(input.mystery_profile?.case_core) || "未指定"}
- investigation_style: ${clean(input.mystery_profile?.investigation_style) || "未指定"}
- emotional_tone: ${clean(input.mystery_profile?.emotional_tone) || "未指定"}
- duo_dynamic: ${clean(input.mystery_profile?.duo_dynamic) || "未指定"}
- truth_nature: ${clean(input.mystery_profile?.truth_nature) || "未指定"}
- visual_language: ${clean(input.mystery_profile?.visual_language) || "未指定"}
- environment_layer: ${clean(input.mystery_profile?.environment_layer) || "未指定"}

優先順位ルール:
- Step2（world_setting / season_goal / case_core）を最優先で反映する。
- Step1（design_brief）は逸脱防止の補助ルールとして使う。

固定キャラ契約:
- 主人公を明示的に1人出力する（is_protagonist=true）。
- 固定キャラとして「相棒」と「主要キャラ（相棒ではない）」を必ず含める。
- 3者（主人公・相棒・主要キャラ）は同じグループ/文脈に属するように設計する。

Variation reference:
- 直近との差分を最低3点作ること
${formatRecentContext(input.recent_generation_context)}

各キャラクターで「必須フィールド」は必ず埋めてください:
- id: "char_1" から連番
- name: キャラ名
- role: 物語上の役割（1文）
- must_appear: boolean（毎話の継続登場が必要なら true）
- is_protagonist: boolean（主人公本人のみ true）
- is_partner: boolean（相棒本人のみ true）
- goal: 目標（1文）
- arc_start: シリーズ開始時の状態（1文）
- arc_end: シリーズ終盤の状態（1文）
- personality: 性格（1文）
- appearance: 外見（1〜2文）
- relationship_hooks: 関係性フックの配列
  - 各要素は { target_id, target_name, relation } のオブジェクトにする
  - relation は「誰に対してどういう関係か」がわかる短文にする
  - 主人公以外は「主人公との関係」1つ + 「もう一人の固定キャラとの関係」1つを必ず含める
  - 主人公は「相棒との関係」1つ + 「主要キャラとの関係」1つを必ず含める

以下は「任意フィールド」（埋める場合は1文・短文）:
- investigation_function: 捜査上の担当機能（観察/聞き込み/記録照合/地理把握/矛盾検知など）

各文字列は簡潔にしてください（同じ語句の反復は禁止）。
1キャラクターあたりの出力は短く保ち、冗長な背景説明は書かないでください。

名前・性格・外見が互いに被らないようにしてください。
name には「あなた」「アナタ」「プレイヤー」「主人公」「You」など自己参照語を使わず、全員を固有名詞で命名してください。
ただし is_protagonist=true のキャラのみ、自己参照語を許容します。
must_appear=true の固定キャラ同士で investigation_function を被らせないでください。
少なくとも1人は「真相に近いが全部は知らない立場」にしてください。
少なくとも1人は「ユーザーの仮説を揺らす立場」にしてください。
generic な「謎多き美形相棒」へ逃げないでください。
`;

  const maxAttempts = CHARACTER_GENERATION_MAX_ATTEMPTS;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const abortController = new AbortController();
    let activeTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutMs = Math.round(
      CHARACTER_GENERATION_TIMEOUT_MS *
        Math.pow(CHARACTER_GENERATION_TIMEOUT_GROWTH, Math.max(0, attempt - 1))
    );
    try {
      activeTimeoutHandle = setTimeout(() => abortController.abort("series_character_timeout"), timeoutMs);
      console.log(
        `${logPrefix} attempt ${attempt}/${maxAttempts} — LLM呼び出し中 (軽量スキーマ, ${Math.round(timeoutMs / 1000)}秒でタイムアウト)`
      );
      const response = await seriesCharacterAgent.generate(prompt, {
        structuredOutput: { schema: lightOutputSchema },
        modelSettings: {
          maxRetries: 0,
          maxOutputTokens: CHARACTER_GENERATION_MAX_TOKENS,
        },
        abortSignal: abortController.signal,
      });
      console.log(`${logPrefix} attempt ${attempt} — LLM応答受信`);

      const lightParsed = lightOutputSchema.safeParse(response.object);
      if (!lightParsed.success) {
        console.warn(`${logPrefix} attempt ${attempt} — 軽量スキーマのパース失敗:`, lightParsed.error.message);
        continue;
      }

      const enriched = lightParsed.data.characters.map((ch) => ({
        ...ch,
        portrait_prompt: "",
        portrait_image_url: "",
      }));
      const normalized = normalizeCharacterOutput(input, { characters: enriched });
      if (normalized) {
        console.log(`${logPrefix} 完了 — ${normalized.characters.length}人を生成`);
        return normalized;
      }
      console.warn(`${logPrefix} attempt ${attempt} — normalizeCharacterOutput 失敗`);
    } catch (error: any) {
      if (abortController.signal.aborted) {
        console.warn(
          `${logPrefix} attempt ${attempt} 失敗: キャラクター生成がタイムアウトしました（${Math.round(
            CHARACTER_GENERATION_TIMEOUT_MS *
              Math.pow(CHARACTER_GENERATION_TIMEOUT_GROWTH, Math.max(0, attempt - 1))
          )}ms）`
        );
        console.warn(`${logPrefix} タイムアウト後の追加課金を避けるため、追加リトライしません`);
        break;
      } else {
        console.warn(`${logPrefix} attempt ${attempt} 失敗:`, error?.message ?? error);
      }
    } finally {
      if (activeTimeoutHandle) clearTimeout(activeTimeoutHandle);
    }
  }

  console.error(`${logPrefix} 全試行失敗`);
  throw new Error("キャラクター生成に失敗しました。外部AIの生成結果を取得できませんでした。");
};
