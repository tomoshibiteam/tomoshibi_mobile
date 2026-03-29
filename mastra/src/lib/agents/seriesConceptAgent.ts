import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { MASTRA_SERIES_CONCEPT_MODEL } from "../modelConfig";
import {
  seriesConceptGroundingContextSchema,
  seriesDeviceServiceDesignBriefSchema,
  seriesMysteryProfileSchema,
  seriesRecentGenerationContextSchema,
  seriesWorldSchema,
} from "../../schemas/series";

const seriesConceptDesignBriefSchema = seriesDeviceServiceDesignBriefSchema;

export const seriesConceptAgentInputSchema = z.object({
  design_brief: seriesConceptDesignBriefSchema,
  desiredEpisodeCount: z.number().int().min(3).max(24),
  language: z.string().default("ja"),
  recent_generation_context: seriesRecentGenerationContextSchema.optional(),
  grounding_context: seriesConceptGroundingContextSchema.optional(),
});

export const seriesConceptAgentOutputSchema = z.object({
  title: z.string(),
  genre: z.string(),
  tone: z.string(),
  premise: z.string(),
  overview: z.string(),
  season_goal: z.string(),
  world: seriesWorldSchema,
  mystery_profile: seriesMysteryProfileSchema,
  ai_rule_points: z.array(z.string()).min(3).max(8),
});

const lightSeriesWorldSchema = z.object({
  era: z.string().optional(),
  setting: z.string().optional(),
  social_structure: z.string().optional(),
  core_conflict: z.string().optional(),
  taboo_rules: z.array(z.string()).optional(),
  recurring_motifs: z.array(z.string()).optional(),
  visual_assets: z.array(z.unknown()).optional(),
});

const lightSeriesMysteryProfileSchema = z.object({
  case_core: z.string().optional(),
  investigation_style: z.string().optional(),
  emotional_tone: z.string().optional(),
  duo_dynamic: z.string().optional(),
  truth_nature: z.string().optional(),
  visual_language: z.string().optional(),
  environment_layer: z.string().optional(),
  differentiation_axes: z.array(z.string()).optional(),
  banned_templates_avoided: z.array(z.string()).optional(),
});

const lightSeriesConceptAgentOutputSchema = z.object({
  title: z.string().optional(),
  genre: z.string().optional(),
  tone: z.string().optional(),
  premise: z.string().optional(),
  overview: z.string().optional(),
  season_goal: z.string().optional(),
  world: lightSeriesWorldSchema.optional(),
  mystery_profile: lightSeriesMysteryProfileSchema.optional(),
  ai_rule_points: z.array(z.string()).optional(),
});

export type SeriesConceptAgentInput = z.infer<typeof seriesConceptAgentInputSchema>;
export type SeriesConceptAgentOutput = z.infer<typeof seriesConceptAgentOutputSchema>;

const SERIES_CONCEPT_AGENT_INSTRUCTIONS = `
あなたは「連載シリーズ設計」の専門エージェントです。
与えられた条件から、事件ミステリーのシリーズ骨格を定義してください。
本ステップで扱うのは「シリーズ骨格」であり、エピソード詳細の導線設計は扱いません。

## 必須方針
- 事件ミステリーとしての面白さを主軸にする
- シリーズ全体を貫く目的・対立・継続フックを明確にする
- 真相は現実因果で説明可能にする（超常解決は禁止）
- 抽象語だけで済ませず、次の設計工程で使える具体度で出力する
- 各フィールドは簡潔にまとめ、同じ語句の反復で文字数を増やさない
- title は固有名を含む具体名にし、「新しいシリーズ」「〇〇シリーズ」のような汎用名を避ける

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

## 事件設計の簡素化ルール
- case_core は「一件の事件」を軸にする（複数事件の連鎖や多層陰謀を避ける）
- まず「何が起きたか（紛失・盗難・倒れていた等）」を明示し、次に「何を解くか」を明示する
- investigation_style は「現場観察・聞き込み・記録照合」のように、ユーザー行動が想像できる語で書く
- truth_nature は「一つの主因」に寄せ、複数要因の詰め込みを避ける
- 初期段階では理解しやすさを優先し、難解語・抽象語の過剰使用を避ける

## world の要件
- taboo_rules は「世界の不文律や禁則」を2つ以上
- recurring_motifs は「繰り返し登場する象徴」を2つ以上
- core_conflict はミステリー的対立を含める

## ai_rule_points の要件
- 後続エピソード生成で必ず守る運用ルールを書く
- キャラクター一貫性・因果整合・伏線管理を含める
- 真相の現実因果と継続性を含める

## user-facing 出力ルール
- genre / premise / overview / season_goal / world.setting / ai_rule_points はユーザーに見える本文として扱う
- これらの本文ではメタ語や実装語をそのまま書かない
- environment_layer は内部差分軸であり、本文へ直書きしない
- Step1 の文脈（場所・利用者・目的）を title / overview / season_goal に必ず反映する
- title / genre / tone は専門用語に寄せすぎず、読んで意味が分かる日本語にする
- overview / season_goal は抽象語だけで終わらせず、「誰が・どこで・何を追い・何を得るか」を明確に書く

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
const DEFAULT_SERIES_SENTENCE =
  "一見無関係な出来事が回を追うごとに結びつき、より大きな真相の輪郭を形作っていく。";
const INCOMPATIBLE_WORLD_PATTERN =
  /(空中都市|天空都市|浮遊都市|雲上都市|宇宙|月面|火星|宇宙船|海底都市|閉鎖施設|オフィス内(?:だけ|のみ)?|屋内(?:だけ|のみ)?|建物内(?:だけ|のみ)?|社内(?:だけ|のみ)?)/i;
const SERIES_META_OUTPUT_PATTERN =
  /(現実拡張型|外出周遊|周遊ミステリー|シリーズ型ミステリー|スポット|2〜4|移動手段|徒歩|公共交通|自転車|ロープウェイ|フェリー|目安)/;
const TITLE_JARGON_PATTERN =
  /(ソブリン|アルゴリズム|パラダイム|シンギュラ|プロトコル|オペランド|トポロジ|メタ構造|量子|虚数)/i;
const TONE_JARGON_PATTERN =
  /(冷徹|支配|形而上|メタ構造|トポロジ|プロトコル|アルゴリズム|パラダイム)/i;
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

const ensureNarrativeSentence = (value: string) => {
  const normalized = clean(value);
  if (!normalized) return DEFAULT_SERIES_SENTENCE;
  if (SERIES_META_OUTPUT_PATTERN.test(normalized)) {
    return DEFAULT_SERIES_SENTENCE;
  }
  return normalized;
};

const inferContextFlags = (brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>) => {
  const source = clean(
    [
      brief.target_user_context,
      brief.usage_scene,
      brief.experience_objective,
      brief.service_value_hypothesis,
      brief.spatial_behavior_policy,
    ]
      .filter(Boolean)
      .join(" ")
  );
  const hasMarineKeyword = /(海洋|海ごみ|海ゴミ|海岸|漂着|ビーチ|海域|海浜|海辺|プラスチック)/.test(source);
  const hasCleanupKeyword = /(回収|清掃|クリーン|拾う|除去)/.test(source);
  return {
    source,
    isCampus: /(大学|キャンパス|新入生|オリエンテーション|ガイダンス|講義)/.test(source),
    isTourism: /(観光|旅行|来訪|歴史|街歩き|散策|旅)/.test(source),
    isMarineAction:
      /(海洋ゴミ|海洋プラスチック|海ごみ|海ゴミ)/.test(source) || (hasMarineKeyword && hasCleanupKeyword),
  };
};

const summarizeTargetUser = (brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>) => {
  const flags = inferContextFlags(brief);
  if (flags.isCampus) return "新生活を始めたばかりの新入生";
  if (flags.isMarineAction) return "地域課題に関心を持つ参加者";
  if (flags.isTourism) return "地域理解を深めたい来訪者";
  return "現地で体験しながら学びたい利用者";
};

const summarizeExperienceObjective = (brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>) => {
  const flags = inferContextFlags(brief);
  if (flags.isCampus) return "新生活で必要な導線を理解し、迷わず行動を始められる状態にする";
  if (flags.isMarineAction) return "海洋ゴミ課題を自分ごと化し、実際の回収行動へ踏み出せる状態にする";
  if (flags.isTourism) return "地域の歴史と生活文脈を理解し、主体的に現地を巡れる状態にする";
  return "現地の文脈理解と行動開始が同時に進む状態にする";
};

const summarizeServiceValue = (brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>) => {
  const flags = inferContextFlags(brief);
  if (flags.isCampus) {
    return "手掛かり探索と推理の過程で、施設の役割・利用導線・生活の実務知識を自然に獲得できる";
  }
  if (flags.isMarineAction) {
    return "事件の手掛かりを追う中で、海洋ゴミの実態理解から回収行動までを無理なく接続できる";
  }
  if (flags.isTourism) {
    return "謎解きを通じて、地域の歴史・文化・生活情報を単なる説明ではなく体験として獲得できる";
  }
  return "推理体験の面白さを維持したまま、現地理解と行動変化を生み出せる";
};

const buildSimpleCaseCore = (brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>) => {
  const flags = inferContextFlags(brief);
  if (flags.isCampus) return "新入生向けの重要資料が消えた一件を追い、誰が・なぜ隠したのかを解く";
  if (flags.isMarineAction) return "海洋ゴミ回収計画の記録が改ざんされた一件を追い、妨害の主因を解く";
  if (flags.isTourism) return "観光案内に関わる重要資料が消えた一件を追い、失踪の理由を解く";
  return "現地で起きた一件の紛失事件を追い、犯人と動機を解く";
};

const buildSimpleInvestigationStyle = () => "現場観察・聞き込み・記録照合で手掛かりを一つずつつなぎ、推理で絞り込む";

const buildSimpleTruthNature = () => "一人の隠し行動と小さな誤解が重なって起きた、現実的な人間要因";

const isOverComplexText = (value: string) =>
  /(連鎖|多層|複数|同時|陰謀|構造|交錯|過去と現在|巨大|広域|複合)/.test(clean(value)) || clean(value).length > 72;

const buildContextIntegrationGuidance = (brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>) => {
  const flags = inferContextFlags(brief);
  const place = extractPlaceAnchor(brief);
  const explicitTerms = dedupe(
    [
      place,
      flags.isCampus ? "新入生" : "",
      flags.isCampus ? "キャンパス" : "",
      flags.isMarineAction ? "海洋ゴミ" : "",
      flags.isMarineAction ? "回収行動" : "",
      flags.isTourism ? "観光" : "",
      flags.isTourism ? "地域" : "",
    ].filter(Boolean)
  ).slice(0, 6);

  return {
    explicitTerms,
    policyText:
      "Step1の語句をそのまま貼るのではなく、意味を保った言い換えを基本にする。必要な場面のみ固有語を明示し、不自然なキーワード詰め込みは避ける。",
  };
};

const extractPlaceAnchor = (brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>) => {
  const source = clean(
    [brief.target_user_context, brief.usage_scene, brief.spatial_behavior_policy].filter(Boolean).join(" ")
  );
  const patterns = [
    /([^\s、。・「」]+大学[^\s、。・「」]{0,12}キャンパス)/u,
    /([^\s、。・「」]{2,20}キャンパス)/u,
    /([^\s、。・「」]{2,20}(?:県|市|町|村|島))/u,
  ];
  for (const pattern of patterns) {
    const matched = source.match(pattern);
    if (matched?.[1]) return clean(matched[1]);
  }
  return "";
};

const deriveReadableGenre = (
  brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>,
  mysteryProfile: z.infer<typeof seriesMysteryProfileSchema>
) => {
  const flags = inferContextFlags(brief);
  if (flags.isMarineAction) return "海洋課題アクション・ミステリー";
  if (flags.isCampus) return "新入生オリエンテーション事件ミステリー";
  if (flags.isTourism) return "地域探索・観光ミステリー";

  const source = `${mysteryProfile.case_core} ${mysteryProfile.investigation_style} ${mysteryProfile.truth_nature}`;
  if (/(記録|改ざん|履歴|台帳)/.test(source)) return "記録捜査ミステリー";
  if (/(証言|矛盾|食い違い)/.test(source)) return "証言対立ミステリー";
  if (/(失踪|行方|消失)/.test(source)) return "失踪追跡ミステリー";
  if (/(盗難|すり替え|欠落)/.test(source)) return "痕跡追跡ミステリー";
  return "現地体験型ミステリー";
};

const deriveReadableTone = (brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>) => {
  const flags = inferContextFlags(brief);
  if (flags.isMarineAction) return "危機感と希望を両立し、行動したくなる参加型トーン";
  if (flags.isCampus) return "知的で明るく、新生活への不安を減らす参加型トーン";
  if (flags.isTourism) return "発見の楽しさと冒険感が続く軽快なトーン";
  return "知的で親しみやすい参加型トーン";
};

const deriveReadableSetting = (brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>) => {
  const flags = inferContextFlags(brief);
  const place = extractPlaceAnchor(brief);
  if (flags.isCampus) return `${place || "大学キャンパス"}で、日常導線の理解が捜査体験とつながる現代環境`;
  if (flags.isMarineAction) return `${place || "沿岸地域"}で、海洋課題の実態が手掛かりとして現れる現代環境`;
  if (flags.isTourism) return `${place || "地域"}で、歴史や生活情報が事件の鍵になる来訪環境`;
  return "人々が信じる説明と、現地で拾える痕跡が食い違う現代の生活圏";
};

const inferReadableDuoDynamic = (brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>) => {
  const flags = inferContextFlags(brief);
  if (flags.isCampus) return "現地経験のある先輩と、観察に長けた新入生が補完し合うバディ";
  if (flags.isMarineAction) return "地域実務に詳しい案内役と、行動力のある参加者が協働するバディ";
  if (flags.isTourism) return "土地を知る案内役と、来訪者視点で疑問を拾う相棒のバディ";
  return "視点の異なる二人が補完し合うバディ";
};

const buildPortablePremise = (mysteryProfile: z.infer<typeof seriesMysteryProfileSchema>) =>
  `${mysteryProfile.duo_dynamic}の二人が、${mysteryProfile.case_core}を追い、${mysteryProfile.truth_nature}の真相へ迫っていく。`;

const buildConcreteOverview = (
  brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>,
  mysteryProfile: z.infer<typeof seriesMysteryProfileSchema>
) =>
  `相棒バディは${mysteryProfile.investigation_style}を重ねながら、一件の事件に関する手掛かりを段階的に回収して真相を絞り込む。手掛かり設計は${summarizeServiceValue(
    brief
  )}方針に沿っており、物語の面白さと実地理解が同時に進む。`;

const buildConcreteSeasonGoal = (
  brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>,
  mysteryProfile: z.infer<typeof seriesMysteryProfileSchema>
) =>
  `最終話までに事件の主因である${mysteryProfile.truth_nature}を解明し、${summarizeTargetUser(
    brief
  )}が${summarizeExperienceObjective(brief)}状態で物語を終える。事件解決の達成感と「次に何をすべきか」が同時に残る着地を目指す。`;

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

const shouldReplaceSeriesText = (value: string) => SERIES_META_OUTPUT_PATTERN.test(clean(value));

const shouldReplaceSeriesTitle = (value: string) =>
  !clean(value) ||
  SERIES_META_OUTPUT_PATTERN.test(clean(value)) ||
  TITLE_JARGON_PATTERN.test(clean(value));

const isReadableGenre = (value: string) =>
  !!clean(value) && clean(value).length <= 36 && /(ミステリー|サスペンス|スリラー|クエスト|事件)/.test(clean(value));

const isReadableTone = (value: string) =>
  !!clean(value) && clean(value).length <= 42 && !TONE_JARGON_PATTERN.test(clean(value));

const hasConcreteContextSignal = (
  value: string,
  brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>
) => {
  const normalized = clean(value);
  if (!normalized) return false;
  const flags = inferContextFlags(brief);
  if (flags.isMarineAction) return /(海洋ゴミ|海洋プラスチック|回収|海岸|漂着|清掃|海)/.test(normalized);
  if (flags.isCampus) return /(大学|キャンパス|新入生|オリエンテーション|授業|学生)/.test(normalized);
  if (flags.isTourism) return /(観光|来訪|旅行|地域|歴史|街|島|現地)/.test(normalized);
  return normalized.length >= 40;
};

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

const formatGroundingContext = (
  grounding?: z.infer<typeof seriesConceptGroundingContextSchema>
) => {
  if (!grounding || !Array.isArray(grounding.matched_items) || grounding.matched_items.length === 0) return "なし";
  const lines = grounding.matched_items.map((item, index) => {
    const tags = dedupe(item.tags || []).join(" / ");
    const sourceRef = clean(item.source_ref);
    const reason = clean(item.relevance_reason);
    return [
      `- item_${index + 1}: ${clean(item.anchor)}`,
      `  - detail: ${clean(item.detail)}`,
      tags ? `  - tags: ${tags}` : "",
      sourceRef ? `  - source_ref: ${sourceRef}` : "",
      reason ? `  - relevance_reason: ${reason}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    `source_type: ${clean(grounding.source_type) || "spreadsheet"}`,
    `source_url: ${clean(grounding.source_url)}`,
    clean(grounding.retrieval_note) ? `retrieval_note: ${clean(grounding.retrieval_note)}` : "",
    "matched_items:",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
};

const hasModelApiKey = () =>
  Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );

type ConceptRunVariation = {
  caseCore: string;
  titleHint: string;
  clueFocus: string;
  revealFocus: string;
  uniquenessIntent: string;
};

const pickRandom = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];
const lastVariationByContext = new Map<string, string>();

const variationKey = (variation: ConceptRunVariation) =>
  clean(`${variation.titleHint}|${variation.uniquenessIntent}`);

const buildVariationContextKey = (brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>) =>
  clean(
    [
      brief.brief_version,
      extractPlaceAnchor(brief),
      summarizeTargetUser(brief),
      summarizeExperienceObjective(brief),
      brief.target_user_context,
      brief.usage_scene,
    ].join("|")
  );

const isVariationRecentlyUsed = (recentText: string, candidate: ConceptRunVariation) => {
  if (!recentText) return false;
  const probes = dedupe(
    [
      candidate.titleHint,
      candidate.uniquenessIntent,
      candidate.caseCore.slice(0, 18),
      candidate.clueFocus.slice(0, 18),
      candidate.revealFocus.slice(0, 18),
    ].filter(Boolean)
  );
  return probes.some((probe) => recentText.includes(clean(probe)));
};

const pickVariationByContext = (
  brief: z.infer<typeof seriesDeviceServiceDesignBriefSchema>,
  recent?: z.infer<typeof seriesRecentGenerationContextSchema>
): ConceptRunVariation => {
  const flags = inferContextFlags(brief);
  const recentText = clean(
    [
      ...(recent?.recent_case_motifs || []),
      ...(recent?.recent_titles || []),
      ...(recent?.recent_truth_patterns || []),
    ].join(" ")
  );

  const campusPool: ConceptRunVariation[] = [
    {
      caseCore: "新入生向け配布資料が消えた一件を追い、誰が何のために隠したかを解く",
      titleHint: "消えた配布資料",
      clueFocus: "掲示物の差し替え痕と配布記録の照合",
      revealFocus: "連絡不備と隠し行動が重なった人的ミス",
      uniquenessIntent: "資料紛失型",
    },
    {
      caseCore: "研究室の入室カードが盗まれた一件を追い、侵入目的と持ち去り経路を解く",
      titleHint: "消えた入室カード",
      clueFocus: "入退室ログと目撃証言の食い違い",
      revealFocus: "焦りによる持ち出しと返却失敗",
      uniquenessIntent: "カード盗難型",
    },
    {
      caseCore: "実験予約台帳が改ざんされた一件を追い、改ざん者と動機を解く",
      titleHint: "改ざんされた予約台帳",
      clueFocus: "予約履歴の上書き痕と時刻矛盾",
      revealFocus: "誤解から始まった自己保身の改ざん",
      uniquenessIntent: "台帳改ざん型",
    },
    {
      caseCore: "新歓イベント機材が行方不明になった一件を追い、消失経路と回収方法を解く",
      titleHint: "消えた新歓機材",
      clueFocus: "搬入メモと倉庫鍵運用の穴",
      revealFocus: "引き継ぎ漏れと誤配置の連鎖",
      uniquenessIntent: "機材紛失型",
    },
  ];

  const marinePool: ConceptRunVariation[] = [
    {
      caseCore: "海洋ゴミ回収計画の実施記録が改ざんされた一件を追い、妨害の主因を解く",
      titleHint: "改ざんされた回収記録",
      clueFocus: "回収ログと現地写真の不一致",
      revealFocus: "成果競争が生んだ記録操作",
      uniquenessIntent: "回収記録改ざん型",
    },
    {
      caseCore: "回収用資材が持ち去られた一件を追い、持ち去り理由と再配置先を解く",
      titleHint: "消えた回収資材",
      clueFocus: "資材台帳と搬送経路の照合",
      revealFocus: "善意の先走りによる無断転用",
      uniquenessIntent: "資材持ち出し型",
    },
    {
      caseCore: "海岸清掃の集合連絡が偽装された一件を追い、発信者と意図を解く",
      titleHint: "偽装された集合連絡",
      clueFocus: "連絡履歴と現地集合記録の齟齬",
      revealFocus: "誤情報拡散と確認不足の連鎖",
      uniquenessIntent: "偽連絡型",
    },
  ];

  const tourismPool: ConceptRunVariation[] = [
    {
      caseCore: "観光案内の基礎資料が消えた一件を追い、紛失理由と所在を解く",
      titleHint: "消えた観光案内資料",
      clueFocus: "案内所記録と持ち出しメモの差",
      revealFocus: "更新作業中の誤保管",
      uniquenessIntent: "案内資料紛失型",
    },
    {
      caseCore: "地域史展示の説明札がすり替えられた一件を追い、すり替え意図を解く",
      titleHint: "すり替えられた説明札",
      clueFocus: "展示ログと写真記録の差分",
      revealFocus: "善意の補足が生んだ改変",
      uniquenessIntent: "展示改変型",
    },
    {
      caseCore: "周遊ルート地図が改変された一件を追い、改変者と目的を解く",
      titleHint: "改変された周遊地図",
      clueFocus: "旧版地図と掲示版地図の不整合",
      revealFocus: "混雑回避の独断運用",
      uniquenessIntent: "ルート改変型",
    },
  ];

  const genericPool: ConceptRunVariation[] = [
    {
      caseCore: "現地で使う重要資料が消えた一件を追い、紛失理由と関与者を解く",
      titleHint: "消えた重要資料",
      clueFocus: "利用記録と目撃情報の照合",
      revealFocus: "小さな隠し行動と連絡漏れ",
      uniquenessIntent: "資料紛失型",
    },
    {
      caseCore: "共有設備が無断で持ち出された一件を追い、持ち出し意図を解く",
      titleHint: "持ち出された共有設備",
      clueFocus: "貸出記録と保管場所の矛盾",
      revealFocus: "誤解と先回り行動の衝突",
      uniquenessIntent: "設備持ち出し型",
    },
    {
      caseCore: "運用記録が書き換えられた一件を追い、改変の理由を解く",
      titleHint: "書き換えられた運用記録",
      clueFocus: "更新履歴と現場実態の不一致",
      revealFocus: "責任回避のための単独改変",
      uniquenessIntent: "記録改変型",
    },
  ];

  const pool = flags.isCampus ? campusPool : flags.isMarineAction ? marinePool : flags.isTourism ? tourismPool : genericPool;
  const filteredByRecent = pool.filter((candidate) => !isVariationRecentlyUsed(recentText, candidate));
  const recentSafePool = filteredByRecent.length > 0 ? filteredByRecent : pool;
  const contextKey = buildVariationContextKey(brief);
  const lastUsed = lastVariationByContext.get(contextKey);
  const noRepeatPool = lastUsed
    ? recentSafePool.filter((candidate) => variationKey(candidate) !== lastUsed)
    : recentSafePool;
  const selected = pickRandom(noRepeatPool.length > 0 ? noRepeatPool : recentSafePool);
  lastVariationByContext.set(contextKey, variationKey(selected));
  return selected;
};

const normalizeMysteryProfile = (
  input: SeriesConceptAgentInput,
  raw: unknown,
  variation?: ConceptRunVariation
) => {
  const parsed = lightSeriesMysteryProfileSchema.safeParse(raw);
  if (!parsed.success) return null;
  const rawCaseCore = clean(parsed.data.case_core);
  const rawInvestigationStyle = clean(parsed.data.investigation_style);
  const rawTruthNature = clean(parsed.data.truth_nature);
  const candidate = {
    case_core: rawCaseCore,
    investigation_style: rawInvestigationStyle,
    emotional_tone: clean(parsed.data.emotional_tone),
    duo_dynamic: clean(parsed.data.duo_dynamic),
    truth_nature: rawTruthNature,
    visual_language: clean(parsed.data.visual_language),
    environment_layer: clean(parsed.data.environment_layer),
    differentiation_axes: dedupe(parsed.data.differentiation_axes || []).slice(0, 7),
    banned_templates_avoided: dedupe(parsed.data.banned_templates_avoided || []).slice(0, 8),
  };
  if (
    !candidate.case_core ||
    !candidate.investigation_style ||
    !candidate.emotional_tone ||
    !candidate.duo_dynamic ||
    !candidate.truth_nature ||
    !candidate.visual_language ||
    !candidate.environment_layer
  ) {
    return null;
  }
  if (isOverComplexText(candidate.case_core) || isOverComplexText(candidate.investigation_style) || isOverComplexText(candidate.truth_nature)) {
    return null;
  }
  if (candidate.differentiation_axes.length < 3 || candidate.banned_templates_avoided.length < 1) {
    return null;
  }
  const strict = seriesMysteryProfileSchema.safeParse(candidate);
  return strict.success ? strict.data : null;
};

const normalizeWorld = (
  world: z.infer<typeof lightSeriesWorldSchema> | undefined
) => {
  const source = world || {};
  const tabooRules = dedupe(source.taboo_rules || []);
  const recurringMotifs = dedupe(source.recurring_motifs || []);
  const candidate = {
    era: clean(source.era),
    setting: resolveRealWorldSetting(clean(source.setting)),
    social_structure: clean(source.social_structure),
    core_conflict: clean(source.core_conflict),
    taboo_rules: tabooRules,
    recurring_motifs: recurringMotifs,
    visual_assets: [],
  };
  if (
    !candidate.era ||
    !candidate.setting ||
    !candidate.social_structure ||
    !candidate.core_conflict ||
    candidate.taboo_rules.length < 2 ||
    candidate.recurring_motifs.length < 2
  ) {
    return null;
  }
  const strict = seriesWorldSchema.safeParse(candidate);
  return strict.success ? strict.data : null;
};

const normalizeConceptOutput = (
  input: SeriesConceptAgentInput,
  raw: unknown,
  variation?: ConceptRunVariation
): SeriesConceptAgentOutput | null => {
  const parsed = lightSeriesConceptAgentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const output = parsed.data;
  const title = clean(output.title);
  const genre = clean(output.genre);
  const tone = clean(output.tone);
  const premise = clean(output.premise);
  const overview = clean(output.overview);
  const seasonGoal = clean(output.season_goal);
  const mysteryProfile = normalizeMysteryProfile(input, output.mystery_profile, variation);
  const normalizedWorld = normalizeWorld(output.world);
  const aiRulePoints = dedupe(output.ai_rule_points || []).filter((rule) => !shouldReplaceSeriesText(rule));

  if (!title || !genre || !tone || !premise || !overview || !seasonGoal) return null;
  if (shouldReplaceSeriesTitle(title) || shouldReplaceSeriesText(premise) || shouldReplaceSeriesText(overview) || shouldReplaceSeriesText(seasonGoal)) {
    return null;
  }
  if (hasIncompatibleWorld(genre) || !isReadableGenre(genre) || !isReadableTone(tone)) return null;
  if (!hasConcreteContextSignal(overview, input.design_brief) || !hasConcreteContextSignal(seasonGoal, input.design_brief)) {
    return null;
  }
  if (!mysteryProfile || !normalizedWorld || aiRulePoints.length < 3) return null;

  const candidate = {
    title,
    genre,
    tone,
    premise: ensureNarrativeSentence(premise),
    overview: ensureNarrativeSentence(overview),
    season_goal: seasonGoal,
    world: normalizedWorld,
    mystery_profile: mysteryProfile,
    ai_rule_points: withMandatoryRealityRules(aiRulePoints, 8),
  };
  const strict = seriesConceptAgentOutputSchema.safeParse(candidate);
  return strict.success ? strict.data : null;
};

export const generateSeriesConcept = async (
  input: SeriesConceptAgentInput
): Promise<SeriesConceptAgentOutput> => {
  if (!hasModelApiKey()) {
    throw new Error("コンセプト生成に失敗しました。利用可能なAIモデルがありません。");
  }

  const contextGuidance = buildContextIntegrationGuidance(input.design_brief);
  const runVariation = pickVariationByContext(input.design_brief, input.recent_generation_context);
  const conceptTemperature = Math.max(
    0.2,
    Math.min(1.3, Number.parseFloat(clean(process.env.SERIES_CONCEPT_TEMPERATURE) || "0.9") || 0.9)
  );

  const prompt = `
## Step1 design brief (required subset)
- brief_version: ${clean(input.design_brief.brief_version)}
- experience_objective: ${clean(input.design_brief.experience_objective)}
- service_value_hypothesis: ${clean(input.design_brief.service_value_hypothesis)}
- target_user_context: ${clean(input.design_brief.target_user_context)}
- usage_scene: ${clean(input.design_brief.usage_scene)}
- emotional_outcome: ${clean(input.design_brief.emotional_outcome)}
- tone_guardrail: ${clean(input.design_brief.tone_guardrail)}
- role_design_direction: ${clean(input.design_brief.role_design_direction)}
- spatial_behavior_policy: ${clean(input.design_brief.spatial_behavior_policy)}
- ux_guidance_style: ${clean(input.design_brief.ux_guidance_style)}

## Context wording policy
- ${contextGuidance.policyText}
- 文脈を伝えるために有効なら明示してよい語: ${contextGuidance.explicitTerms.join(" / ") || "なし"}
- title / genre / tone は短く、初見ユーザーが意味を即理解できる語を優先する。

## Run variation directive (must apply this run)
- incident_case_core: ${runVariation.caseCore}
- title_hint: ${runVariation.titleHint}
- clue_focus: ${runVariation.clueFocus}
- reveal_focus: ${runVariation.revealFocus}
- uniqueness_intent: ${runVariation.uniquenessIntent}
- 同一入力の再生成でも、今回は上記 variation を軸に別案として設計すること。

## Optional real-world grounding context
${formatGroundingContext(input.grounding_context)}
- 上記がある場合は、実データ由来の題材・固有語・逸話をシリーズ案へ自然に織り込む。
- ただし語句の機械的コピーは避け、事件ミステリーとして因果が通る形に再構成する。
- 上記が「なし」の場合は、通常どおり Step1 情報のみで設計する。

## Scope contract (series phase)
- 本ステップはシリーズ骨格のみを設計し、具体エピソード導線は決めない。
- 真相は現実因果で説明可能にする（超常解決は禁止）。
- Step1 の target_user_context / usage_scene / experience_objective を反映し、利用者が直感で内容を理解できる表現にする。
- 想定エピソード数: ${input.desiredEpisodeCount}

## Variation reference
- 直近生成との差分を最低3軸以上作る。
- 今回は case_core / duo_dynamic / visual_language / environment_layer を特に差分優先する。
- recent context:
${formatRecentContext(input.recent_generation_context)}

## banned template
${BANNED_MYSTERY_TEMPLATES.map((item) => `- ${item}`).join("\n")}

seriesConceptAgentOutputSchema を満たす JSON のみを出力してください。
`;

  const maxAttempts = 1;
  const timeoutMs = Math.max(
    30_000,
    Number.parseInt(clean(process.env.SERIES_CONCEPT_TIMEOUT_MS) || "120000", 10) ||
      120_000
  );
  const maxOutputTokens = Math.max(
    900,
    Math.min(3200, Number.parseInt(clean(process.env.SERIES_CONCEPT_MAX_OUTPUT_TOKENS) || "2200", 10) || 2200)
  );
  const logPrefix = "[series-concept-agent]";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const abortController = new AbortController();
    let activeTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      activeTimeoutHandle = setTimeout(() => abortController.abort("series_concept_timeout"), timeoutMs);
      console.log(`${logPrefix} attempt ${attempt}/${maxAttempts} — LLM呼び出し中`);
      const result = await seriesConceptAgent.generate(prompt, {
        structuredOutput: { schema: lightSeriesConceptAgentOutputSchema },
        modelSettings: {
          maxRetries: 0,
          maxOutputTokens,
          temperature: conceptTemperature,
        },
        abortSignal: abortController.signal,
      });
      console.log(`${logPrefix} attempt ${attempt} — LLM応答受信`);
      const normalized = normalizeConceptOutput(input, result.object, runVariation);
      if (normalized) return normalized;
      console.warn(`${logPrefix} attempt ${attempt} — パース失敗`);
    } catch (error: any) {
      if (abortController.signal.aborted) {
        console.warn(`${logPrefix} attempt ${attempt} 失敗: コンセプト生成がタイムアウトしました（${timeoutMs}ms）`);
        console.warn(`${logPrefix} タイムアウト後の追加課金を避けるため、追加リトライしません`);
        break;
      }
      console.warn(`${logPrefix} attempt ${attempt} 失敗:`, error?.message ?? error);
    } finally {
      if (activeTimeoutHandle) clearTimeout(activeTimeoutHandle);
    }
  }

  console.error(`${logPrefix} 全試行失敗`);
  throw new Error("コンセプト生成に失敗しました。外部AIの生成結果を取得できませんでした。");
};
