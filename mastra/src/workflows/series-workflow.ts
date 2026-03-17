import { createStep, createWorkflow } from "@mastra/core/workflows";
import { createHash } from "crypto";
import { z } from "zod";
import {
  seriesAntiBriefSchema,
  seriesCheckpointSchema,
  seriesCharacterIdentityAnchorTokensSchema,
  seriesCharacterSchema,
  seriesConceptSeedSchema,
  seriesCoverConsistencyReportSchema,
  seriesEpisodeSeedSchema,
  seriesFirstEpisodeSeedEvalSchema,
  seriesGenerationRequestSchema,
  seriesIdentityPackSchema,
  seriesInterviewSchema,
  seriesRecentGenerationContextSchema,
  seriesPreferenceSheetSchema,
  seriesTextJudgeScoreSchema,
  userSeriesRubricSchema,
  seriesWorkflowOutputSchema,
} from "../schemas/series";
import {
  generateSeriesConcept,
  seriesConceptAgentOutputSchema,
} from "../lib/agents/seriesConceptAgent";
import { generateSeriesCharacters } from "../lib/agents/seriesCharacterAgent";
import { generateSeriesEpisodePlan } from "../lib/agents/seriesEpisodePlannerAgent";
import { generateSeriesConsistency } from "../lib/agents/seriesConsistencyAgent";
import { dryRunFirstEpisodeSeedRoute } from "../lib/agents/seriesRuntimeEpisodeAgent";
import { generateSeriesPreferenceBundle } from "../lib/agents/seriesPreferenceAgent";
import {
  generateSeriesConceptSeeds,
  judgeSeriesSeedSemanticSimilarity,
} from "../lib/agents/seriesConceptSeedAgent";
import { generateSeriesRichCharacters, richCharacterSheetSchema } from "../lib/agents/seriesRichCharacterAgent";
import { generateSeriesCheckpoints } from "../lib/agents/seriesCheckpointAgent";
import {
  evaluateFirstEpisodeSeed,
  generateFirstEpisodeSeed,
} from "../lib/agents/seriesFirstEpisodeSeedAgent";
import {
  compareSeriesTextCandidatesPairwise,
  evaluateSeriesTextCandidate,
  seriesTextJudgeCandidateSchema,
} from "../lib/agents/seriesTextJudgeAgent";
import {
  buildCharacterPortraitPrompt,
  buildCoverImagePrompt,
  buildSeriesImageUrl,
  buildSeriesVisualStyleGuide,
  buildWorldVisualPrompt,
} from "../lib/seriesVisuals";

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();
const dedupeStrings = (values: Array<string | undefined | null>) => {
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

const dedupeIds = (values: Array<string | undefined | null>) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = clean(value);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const toTitleCaseReason = (bucket: "protagonist" | "partner" | "antagonist" | "support") =>
  bucket === "protagonist"
    ? "物語の視点と感情導線を担う主軸人物"
    : bucket === "partner"
      ? "主人公と並走し、展開を動かす相棒ポジション"
      : bucket === "antagonist"
        ? "シリーズの対立軸を象徴する対抗勢力"
        : "物語の節目で鍵を握るキーパーソン";

type WorkflowCharacter = z.infer<typeof seriesCharacterSchema>;
type WorkflowIdentityAnchorTokens = z.infer<typeof seriesCharacterIdentityAnchorTokensSchema>;
type WorkflowIdentityPack = z.infer<typeof seriesIdentityPackSchema>;
type WorkflowCoverConsistencyReport = z.infer<typeof seriesCoverConsistencyReportSchema>;
type WorkflowPreferenceSheet = z.infer<typeof seriesPreferenceSheetSchema>;
type WorkflowAntiBrief = z.infer<typeof seriesAntiBriefSchema>;
type WorkflowUserRubric = z.infer<typeof userSeriesRubricSchema>;
type WorkflowConceptSeed = z.infer<typeof seriesConceptSeedSchema>;
type WorkflowFirstEpisodeSeedEval = z.infer<typeof seriesFirstEpisodeSeedEvalSchema>;
type WorkflowTextJudgeScore = z.infer<typeof seriesTextJudgeScoreSchema>;
type WorkflowRichCharacterSheet = z.infer<typeof richCharacterSheetSchema>;

type CoverFocusCharacter = {
  character_id: string;
  name: string;
  role: string;
  focus_reason: string;
  visual_anchor: string;
};

const getGeminiApiKey = () =>
  clean(process.env.GOOGLE_GENERATIVE_AI_API_KEY) || clean(process.env.GEMINI_API_KEY);
const getGeminiVisionModel = () => clean(process.env.SERIES_IMAGE_EVAL_MODEL) || "gemini-2.0-flash";

type VisionInlineData = {
  mimeType: string;
  data: string;
};

type VisionImagePayload = {
  inlineData: VisionInlineData;
  provider?: string;
};

type VisionWorldCoverEvaluation = {
  provider?: string;
  styleSimilarity: number;
  worldSimilarity: number;
  peopleScore: number;
  summary: string;
};

type VisionPortraitComparison = {
  samePersonProbability: number;
  summary: string;
};

const normalizeImageMimeType = (value?: string | null) => {
  const normalized = clean(value).toLowerCase();
  if (normalized === "image/jpg") return "image/jpeg";
  if (!normalized) return "image/png";
  return normalized.startsWith("image/") ? normalized : "image/png";
};

const guessImageMimeType = (url: string) => {
  const normalized = clean(url).toLowerCase();
  if (normalized.includes(".jpg") || normalized.includes(".jpeg")) return "image/jpeg";
  if (normalized.includes(".webp")) return "image/webp";
  return "image/png";
};

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const toScore = (value: unknown, fallback = 0) => {
  const num = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(num)) return fallback;
  return clamp01(num);
};

const VISION_IMAGE_FETCH_TIMEOUT_MS = Math.max(
  5_000,
  Number.parseInt(clean(process.env.SERIES_VISION_IMAGE_FETCH_TIMEOUT_MS) || "45000", 10) || 45_000
);
const VISION_EVAL_TIMEOUT_MS = Math.max(
  8_000,
  Number.parseInt(clean(process.env.SERIES_VISION_EVAL_TIMEOUT_MS) || "45000", 10) || 45_000
);
const isAbortLikeError = (error: unknown) => {
  const message = clean(error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return true;
  return /abort|aborted|timeout|timed out/.test(message);
};

const fetchImageForVision = async (url: string): Promise<VisionImagePayload> => {
  const normalized = clean(url);
  if (!normalized) {
    throw new Error("vision_image_url_missing");
  }

  let response: Response;
  try {
    response = await fetch(normalized, {
      headers: {
        "User-Agent": "tomoshibi-mastra/cover-identity-eval",
      },
      signal: AbortSignal.timeout(VISION_IMAGE_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new Error(`vision_image_fetch_timeout:${Math.floor(VISION_IMAGE_FETCH_TIMEOUT_MS / 1000)}s`);
    }
    throw new Error(`vision_image_fetch_error:${clean(error instanceof Error ? error.message : String(error ?? "")) || "unknown"}`);
  }
  if (!response.ok) {
    throw new Error(`vision_image_fetch_failed:${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error("vision_image_bytes_empty");
  }
  const base64 = Buffer.from(bytes).toString("base64");
  if (!base64) {
    throw new Error("vision_image_base64_empty");
  }
  return {
    inlineData: {
      mimeType: normalizeImageMimeType(response.headers.get("content-type")) || guessImageMimeType(normalized),
      data: base64,
    },
    provider: clean(response.headers.get("x-series-image-provider")) || undefined,
  };
};

const extractGeminiTextCandidates = (payload: unknown): string[] => {
  const root = asObject(payload);
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  const outputs: string[] = [];

  for (const candidate of candidates) {
    const row = asObject(candidate);
    const content = asObject(row.content);
    const parts = Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      const partRow = asObject(part);
      const text = clean(typeof partRow.text === "string" ? partRow.text : "");
      if (text) outputs.push(text);
    }
  }

  const directText = clean(typeof root.text === "string" ? root.text : "");
  if (directText) outputs.push(directText);
  return outputs;
};

const parseJsonObject = (text: string): Record<string, unknown> | null => {
  const normalized = clean(text);
  if (!normalized) return null;

  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = clean(fenced?.[1] || normalized);
  if (!candidate) return null;

  try {
    const parsed = JSON.parse(candidate);
    return asObject(parsed);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      return asObject(parsed);
    } catch {
      return null;
    }
  }
};

const runVisionJsonEvaluation = async (parts: Array<Record<string, unknown>>) => {
  const geminiApiKey = getGeminiApiKey();
  if (!geminiApiKey) {
    throw new Error("cover_identity_eval_api_key_missing");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    getGeminiVisionModel()
  )}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts,
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(VISION_EVAL_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new Error(`cover_identity_eval_timeout:${Math.floor(VISION_EVAL_TIMEOUT_MS / 1000)}s`);
    }
    throw new Error(
      `cover_identity_eval_network_error:${clean(error instanceof Error ? error.message : String(error ?? "")) || "unknown"}`
    );
  }

  if (!response.ok) {
    const errText = clean(await response.text()).slice(0, 400);
    throw new Error(`cover_identity_eval_failed:${response.status}:${errText || "unknown"}`);
  }

  const payload = await response.json();
  const jsonCandidates = extractGeminiTextCandidates(payload)
    .map((item) => parseJsonObject(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  if (jsonCandidates.length === 0) {
    throw new Error("cover_identity_eval_json_missing");
  }
  return jsonCandidates[0];
};

const buildWorldCoverEvalInstruction = (input: {
  title: string;
  genre: string;
  tone: string;
  premise: string;
  setting: string;
  recurringMotifs: string[];
  styleGuide: string;
}) =>
  [
    "あなたはシリーズのカバー画像監査者です。",
    "このカバーは事件ミステリーのキーアート用途です。人物・キャラクター・人型シルエットを出してはいけません。",
    "人の痕跡・物証・不在の緊張で事件性を表現できているかを評価してください。",
    `title: ${clean(input.title)}`,
    `genre: ${clean(input.genre)}`,
    `tone: ${clean(input.tone)}`,
    `premise: ${clean(input.premise)}`,
    `setting: ${clean(input.setting)}`,
    input.recurringMotifs.length > 0 ? `motifs: ${input.recurringMotifs.map((m) => clean(m)).filter(Boolean).join(" / ")}` : "",
    `style_bible: ${clean(input.styleGuide)}`,
    "厳密なJSONのみ返してください。",
    "output_json_schema:",
    "{\"people_score\":0.0,\"world_similarity\":0.0,\"style_similarity\":0.0,\"summary\":\"...\"}",
  ]
    .map((line) => clean(line))
    .filter(Boolean)
    .join("\n");

const evaluateWorldCoverWithVision = async (input: {
  coverImageUrl: string;
  title: string;
  genre: string;
  tone: string;
  premise: string;
  setting: string;
  recurringMotifs: string[];
  styleGuide: string;
}): Promise<VisionWorldCoverEvaluation> => {
  const coverImage = await fetchImageForVision(input.coverImageUrl);

  const best = await runVisionJsonEvaluation([
    {
      text: buildWorldCoverEvalInstruction(input),
    },
    { text: "cover_image" },
    {
      inlineData: {
        mimeType: coverImage.inlineData.mimeType,
        data: coverImage.inlineData.data,
      },
    },
  ]);

  const peopleScore = toScore(
    best.people_score ??
      best.character_presence_score ??
      best.human_presence_score ??
      (best.contains_people === true ? 1 : 0),
    1
  );

  return {
    provider: clean(coverImage.provider) || "unknown",
    styleSimilarity: toScore(best.style_similarity ?? best.style_match ?? best.style_score, 0),
    worldSimilarity: toScore(best.world_similarity ?? best.setting_similarity ?? best.theme_similarity, 0),
    peopleScore,
    summary: clean(typeof best.summary === "string" ? best.summary : "") || "",
  };
};

const evaluatePortraitSamePersonProbability = async (input: {
  leftName: string;
  leftImageUrl: string;
  rightName: string;
  rightImageUrl: string;
}): Promise<VisionPortraitComparison> => {
  const left = await fetchImageForVision(input.leftImageUrl);
  const right = await fetchImageForVision(input.rightImageUrl);
  const best = await runVisionJsonEvaluation([
    {
      text: [
        "2枚のキャラクターポートレート画像を比較し、同一人物確率を推定してください。",
        "厳密なJSONのみ返してください。",
        "output_json_schema:",
        "{\"same_person_probability\":0.0,\"summary\":\"...\"}",
      ].join("\n"),
    },
    { text: `portrait_left name=${clean(input.leftName)}` },
    {
      inlineData: {
        mimeType: left.inlineData.mimeType,
        data: left.inlineData.data,
      },
    },
    { text: `portrait_right name=${clean(input.rightName)}` },
    {
      inlineData: {
        mimeType: right.inlineData.mimeType,
        data: right.inlineData.data,
      },
    },
  ]);

  return {
    samePersonProbability: toScore(
      best.same_person_probability ?? best.identity_overlap ?? best.identity_similarity ?? 0,
      0
    ),
    summary: clean(typeof best.summary === "string" ? best.summary : "") || "",
  };
};

const detectRoleBucket = (character: WorkflowCharacter): "protagonist" | "partner" | "antagonist" | "support" => {
  const role = clean(character.role);
  if (/(主人公|主役|視点|プレイヤー|語り手)/.test(role)) return "protagonist";
  if (/(相棒|パートナー|バディ|助手|補佐|同行)/.test(role)) return "partner";
  if (/(ボス|黒幕|敵|対抗|ライバル|宿敵|首領|支配|追跡者)/.test(role)) return "antagonist";
  return "support";
};

const extractVisualAnchor = (character: WorkflowCharacter) => {
  const anchors = dedupeStrings([
    character.identity_anchor_tokens?.dominant_color,
    character.identity_anchor_tokens?.distinguishing_feature,
    character.identity_anchor_tokens?.silhouette,
    character.visual_design?.dominant_color,
    character.visual_design?.distinguishing_feature,
    character.visual_design?.silhouette_keyword,
    clean(character.appearance).split(/[。.!?]/)[0],
  ]);
  return anchors.join(" / ").slice(0, 120) || "印象的なシルエット";
};

const scoreCharacterForCover = (character: WorkflowCharacter, index: number) => {
  const bucket = detectRoleBucket(character);
  const base = Math.max(8, 40 - index * 4);
  const bucketBonus =
    bucket === "protagonist" ? 54 : bucket === "partner" ? 48 : bucket === "antagonist" ? 46 : 24;
  const relationBonus = (character.relationships?.length || 0) > 0 ? 8 : 0;
  const arcBonus = clean(character.arc_start) && clean(character.arc_end) ? 8 : 0;
  const keyPersonBonus = character.is_key_person ? 14 : 0;
  return base + bucketBonus + relationBonus + arcBonus + keyPersonBonus;
};

const selectCoverFocusCharacters = (characters: WorkflowCharacter[]): CoverFocusCharacter[] => {
  if (!Array.isArray(characters) || characters.length === 0) return [];
  const scored = characters
    .map((character, index) => ({
      character,
      bucket: detectRoleBucket(character),
      score: scoreCharacterForCover(character, index),
    }))
    .sort((a, b) => b.score - a.score);

  const selected: CoverFocusCharacter[] = [];
  const selectedIds = new Set<string>();
  const trySelect = (bucket: "protagonist" | "partner" | "antagonist" | "support") => {
    const hit = scored.find((row) => row.bucket === bucket && !selectedIds.has(row.character.id));
    if (!hit) return;
    selectedIds.add(hit.character.id);
    selected.push({
      character_id: hit.character.id,
      name: clean(hit.character.name) || `人物${selected.length + 1}`,
      role: clean(hit.character.role) || "キーパーソン",
      focus_reason: toTitleCaseReason(bucket),
      visual_anchor: extractVisualAnchor(hit.character),
    });
  };

  trySelect("protagonist");
  trySelect("partner");
  trySelect("antagonist");
  for (const row of scored) {
    if (selected.length >= 3) break;
    if (selectedIds.has(row.character.id)) continue;
    selectedIds.add(row.character.id);
    selected.push({
      character_id: row.character.id,
      name: clean(row.character.name) || `人物${selected.length + 1}`,
      role: clean(row.character.role) || "キーパーソン",
      focus_reason: "物語の節目で鍵を握るキーパーソン",
      visual_anchor: extractVisualAnchor(row.character),
    });
  }

  return selected.length > 0
    ? selected.slice(0, 3)
    : [
        {
          character_id: characters[0].id,
          name: clean(characters[0].name) || "主人公",
          role: clean(characters[0].role) || "主役",
          focus_reason: "物語の中心人物",
          visual_anchor: extractVisualAnchor(characters[0]),
        },
      ];
};

const collectDominantColors = (characters: WorkflowCharacter[]) =>
  dedupeStrings(characters.map((character) => clean(character.visual_design?.dominant_color)));

const extractFirstMatchedKeyword = (source: string, candidates: string[]) =>
  candidates.find((keyword) => source.includes(keyword)) || "";

const buildIdentityAnchorTokens = (character: WorkflowCharacter): WorkflowIdentityAnchorTokens => {
  const appearance = clean(character.appearance);
  const hair =
    clean(character.identity_anchor_tokens?.hair) ||
    extractFirstMatchedKeyword(appearance, [
      "黒髪",
      "金髪",
      "銀髪",
      "赤髪",
      "青髪",
      "長髪",
      "短髪",
      "ツインテール",
      "ポニーテール",
      "ウェーブ",
      "前髪",
    ]) ||
    "印象的な髪型";
  const silhouette =
    clean(character.identity_anchor_tokens?.silhouette) ||
    clean(character.visual_design?.silhouette_keyword) ||
    "印象的なシルエット";
  const dominantColor =
    clean(character.identity_anchor_tokens?.dominant_color) ||
    clean(character.visual_design?.dominant_color) ||
    "暖色系アクセント";
  const outfitKeyItem =
    clean(character.identity_anchor_tokens?.outfit_key_item) ||
    extractFirstMatchedKeyword(appearance, [
      "コート",
      "ジャケット",
      "マフラー",
      "手袋",
      "帽子",
      "ブーツ",
      "ピアス",
      "ネックレス",
      "腕輪",
      "制服",
      "ローブ",
      "スカーフ",
    ]) ||
    "象徴的な衣装アイテム";
  const distinguishingFeature =
    clean(character.identity_anchor_tokens?.distinguishing_feature) ||
    clean(character.visual_design?.distinguishing_feature) ||
    extractFirstMatchedKeyword(appearance, ["傷", "刺青", "眼帯", "ピアス", "ほくろ", "前髪", "仮面", "手袋"]) ||
    "顔まわりの特徴";

  return {
    hair,
    silhouette,
    dominant_color: dominantColor,
    outfit_key_item: outfitKeyItem,
    distinguishing_feature: distinguishingFeature,
  };
};

const DISTINCT_ANCHOR_COLORS = [
  "深紅",
  "群青",
  "翡翠",
  "琥珀",
  "銀灰",
  "墨黒",
  "紫紺",
  "珊瑚",
];

const DISTINCT_ANCHOR_HAIR = [
  "黒髪ショート",
  "銀髪ロング",
  "赤髪ウェーブ",
  "金髪ボブ",
  "青髪ポニーテール",
  "茶髪ツーブロック",
  "白髪ショート",
  "紫髪ツインテール",
];

const DISTINCT_ANCHOR_SILHOUETTES = [
  "鋭角的シルエット",
  "流線型シルエット",
  "角張ったシルエット",
  "丸みのあるシルエット",
  "縦長シルエット",
  "重心の低いシルエット",
  "肩幅が広いシルエット",
  "細身のシルエット",
];

const DISTINCT_ANCHOR_OUTFITS = [
  "長いコート",
  "短丈ジャケット",
  "大ぶりのマフラー",
  "フード付き外套",
  "片手手袋",
  "装飾ベルト",
  "肩章付き上着",
  "胸元のペンダント",
];

const DISTINCT_ANCHOR_FEATURES = [
  "右頬の小さな傷",
  "左耳の3連ピアス",
  "白いメッシュ前髪",
  "片眉の切れ込み",
  "右手甲の刺青",
  "目元のほくろ",
  "首元の印象的なアクセサリー",
  "片手だけの革手袋",
];

const pickUniqueAnchorValue = (
  current: string,
  seen: Set<string>,
  pool: string[],
  fallbackPrefix: string,
  index: number
) => {
  const normalized = clean(current);
  if (normalized && !seen.has(normalized)) {
    seen.add(normalized);
    return normalized;
  }
  const fromPool = pool.find((candidate) => !seen.has(candidate));
  if (fromPool) {
    seen.add(fromPool);
    return fromPool;
  }
  const base = `${fallbackPrefix}${index + 1}`;
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }
  let suffix = 2;
  while (seen.has(`${base}-${suffix}`)) suffix += 1;
  const resolved = `${base}-${suffix}`;
  seen.add(resolved);
  return resolved;
};

const enforceDistinctIdentityAnchors = (characters: WorkflowCharacter[]): WorkflowCharacter[] => {
  const colorSeen = new Set<string>();
  const hairSeen = new Set<string>();
  const silhouetteSeen = new Set<string>();
  const outfitSeen = new Set<string>();
  const featureSeen = new Set<string>();

  return characters.map((character, index) => {
    const base = buildIdentityAnchorTokens(character);
    const hair = pickUniqueAnchorValue(base.hair, hairSeen, DISTINCT_ANCHOR_HAIR, "髪型", index);
    const silhouette = pickUniqueAnchorValue(
      base.silhouette,
      silhouetteSeen,
      DISTINCT_ANCHOR_SILHOUETTES,
      "シルエット",
      index
    );
    const dominantColor = pickUniqueAnchorValue(
      base.dominant_color,
      colorSeen,
      DISTINCT_ANCHOR_COLORS,
      "アクセントカラー",
      index
    );
    const outfitKeyItem = pickUniqueAnchorValue(
      base.outfit_key_item,
      outfitSeen,
      DISTINCT_ANCHOR_OUTFITS,
      "衣装アイテム",
      index
    );
    const distinguishingFeature = pickUniqueAnchorValue(
      base.distinguishing_feature,
      featureSeen,
      DISTINCT_ANCHOR_FEATURES,
      "識別特徴",
      index
    );

    return {
      ...character,
      visual_design: {
        ...(character.visual_design || {
          dominant_color: "",
          body_type: "",
          silhouette_keyword: "",
          distinguishing_feature: "",
        }),
        dominant_color: dominantColor,
        silhouette_keyword: silhouette,
        distinguishing_feature: distinguishingFeature,
      },
      identity_anchor_tokens: {
        hair,
        silhouette,
        dominant_color: dominantColor,
        outfit_key_item: outfitKeyItem,
        distinguishing_feature: distinguishingFeature,
      },
    };
  });
};

const asIdentityPackCharacter = (character: WorkflowCharacter, isKeyPerson: boolean) => ({
  character_id: character.id,
  name: clean(character.name) || "人物",
  role: clean(character.role) || "キーパーソン",
  is_key_person: isKeyPerson,
  identity_anchor_tokens: buildIdentityAnchorTokens(character),
  portrait_prompt: clean(character.portrait_prompt),
  portrait_image_url: clean(character.portrait_image_url),
});

const buildSeriesIdentityPack = (input: {
  characters: WorkflowCharacter[];
  styleGuide: string;
  existingIdentityPack?: WorkflowIdentityPack;
  identityRetcon?: boolean;
}): { identityPack: WorkflowIdentityPack; characters: WorkflowCharacter[] } => {
  const baseCharacters = (input.characters || []).slice(0, 8);
  if (baseCharacters.length === 0) {
    throw new Error("buildSeriesIdentityPack requires at least one character");
  }

  const shouldReuse = Boolean(input.existingIdentityPack && !input.identityRetcon);
  if (shouldReuse && input.existingIdentityPack) {
    const existing = input.existingIdentityPack;
    const existingById = new Map(existing.characters.map((row) => [row.character_id, row]));
    const existingByName = new Map(existing.characters.map((row) => [clean(row.name).toLowerCase(), row]));

    const existingKeyRows = existing.key_person_character_ids
      .map((id) => existingById.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const keyIdsById = existing.key_person_character_ids.filter((id) =>
      baseCharacters.some((character) => character.id === id)
    );
    const keyIdsByName = existingKeyRows
      .map((row) =>
        baseCharacters.find(
          (character) => clean(character.name).toLowerCase() === clean(row.name).toLowerCase()
        )?.id
      )
      .filter((id): id is string => Boolean(clean(id)));

    let keyIds = dedupeIds([...keyIdsById, ...keyIdsByName]).slice(0, 3);
    if (keyIds.length === 0) {
      keyIds = selectCoverFocusCharacters(baseCharacters)
        .map((row) => row.character_id)
        .slice(0, 3);
    }
    if (keyIds.length === 0) {
      keyIds = [baseCharacters[0].id];
    }

    const keyIdSet = new Set(keyIds);
    const mergedCharacters = baseCharacters.map((character) => {
      const byId = existingById.get(character.id);
      const byName = existingByName.get(clean(character.name).toLowerCase());
      const existingHit = byId || byName;
      const tokens =
        existingHit?.identity_anchor_tokens &&
        Object.values(existingHit.identity_anchor_tokens).some((value) => clean(value).length > 0)
          ? existingHit.identity_anchor_tokens
          : buildIdentityAnchorTokens(character);
      const isKeyPerson = keyIdSet.has(character.id);
      return {
        ...character,
        is_key_person: isKeyPerson,
        identity_anchor_tokens: tokens,
      };
    });
    const anchoredCharacters = enforceDistinctIdentityAnchors(mergedCharacters);

    return {
      characters: anchoredCharacters,
      identityPack: {
        version: Math.max(1, existing.version || 1),
        source: "reused",
        style_bible: clean(existing.style_bible) || clean(input.styleGuide),
        key_person_character_ids: keyIds.slice(0, 3),
        characters: anchoredCharacters.map((character) =>
          asIdentityPackCharacter(character, keyIdSet.has(character.id))
        ),
        locked_at: new Date().toISOString(),
      },
    };
  }

  const focusCharacters = selectCoverFocusCharacters(baseCharacters);
  const keyIds = focusCharacters.map((row) => row.character_id).slice(0, 3);
  const keyIdSet = new Set(keyIds.length > 0 ? keyIds : [baseCharacters[0].id]);
  const nextVersion =
    input.identityRetcon && input.existingIdentityPack
      ? Math.max(1, (input.existingIdentityPack.version || 1) + 1)
      : 1;

  const normalizedCharacters = baseCharacters.map((character) => ({
    ...character,
    is_key_person: keyIdSet.has(character.id),
    identity_anchor_tokens: buildIdentityAnchorTokens(character),
  }));
  const anchoredCharacters = enforceDistinctIdentityAnchors(normalizedCharacters);

  return {
    characters: anchoredCharacters,
    identityPack: {
      version: nextVersion,
      source: "generated",
      style_bible: clean(input.styleGuide),
      key_person_character_ids: [...keyIdSet].slice(0, 3),
      characters: anchoredCharacters.map((character) =>
        asIdentityPackCharacter(character, keyIdSet.has(character.id))
      ),
      locked_at: new Date().toISOString(),
    },
  };
};

const syncIdentityPackWithCharacters = (
  identityPack: WorkflowIdentityPack,
  characters: WorkflowCharacter[]
): { identityPack: WorkflowIdentityPack; characters: WorkflowCharacter[] } => {
  const anchoredCharacters = enforceDistinctIdentityAnchors(characters);
  const keyIds = identityPack.key_person_character_ids.filter((id) =>
    anchoredCharacters.some((character) => character.id === id)
  );
  const keyIdSet = new Set(keyIds.length > 0 ? keyIds : [anchoredCharacters[0]?.id].filter(Boolean));

  const normalizedCharacters = anchoredCharacters.map((character) => ({
    ...character,
    is_key_person: keyIdSet.has(character.id),
    identity_anchor_tokens: buildIdentityAnchorTokens(character),
  }));

  return {
    characters: normalizedCharacters,
    identityPack: {
      ...identityPack,
      key_person_character_ids: [...keyIdSet].slice(0, 3),
      characters: normalizedCharacters.map((character) =>
        asIdentityPackCharacter(character, keyIdSet.has(character.id))
      ),
      locked_at: new Date().toISOString(),
    },
  };
};

const harmonizeCharacterPortraits = (input: {
  title: string;
  genre: string;
  tone: string;
  setting: string;
  styleGuide: string;
  characters: WorkflowCharacter[];
  mysteryProfile?: z.infer<typeof seriesConceptAgentOutputSchema>["mystery_profile"];
}): WorkflowCharacter[] =>
  enforceDistinctIdentityAnchors(input.characters).map((character, index) => {
    const portraitPrompt = buildCharacterPortraitPrompt({
      seriesTitle: input.title,
      genre: input.genre,
      tone: input.tone,
      name: character.name,
      role: character.role,
      personality: character.personality,
      appearance: character.appearance,
      setting: input.setting,
      caseCore: input.mysteryProfile?.case_core,
      environmentLayer: input.mysteryProfile?.environment_layer,
      investigationFunction: character.investigation_function,
      relationshipTemperature: character.relationship_temperature || character.emotional_temperature,
      signatureProp: character.signature_prop,
      environmentResidue: character.environment_residue,
      dominantColor: character.visual_design?.dominant_color || character.identity_anchor_tokens?.dominant_color,
      bodyType: character.visual_design?.body_type,
      distinguishingFeature:
        character.visual_design?.distinguishing_feature || character.identity_anchor_tokens?.distinguishing_feature,
      anchorHair: character.identity_anchor_tokens?.hair,
      anchorSilhouette: character.identity_anchor_tokens?.silhouette,
      anchorOutfitKeyItem: character.identity_anchor_tokens?.outfit_key_item,
      styleGuide: input.styleGuide,
    });
    return {
      ...character,
      portrait_prompt: portraitPrompt,
      portrait_image_url: buildSeriesImageUrl({
        prompt: portraitPrompt,
        seedKey: `${input.title}:char:${index + 1}:${character.name}`,
        width: 768,
        height: 1024,
        purpose: "character_portrait",
      }),
    };
  });

const ensureUniquePortraitUrls = (input: {
  title: string;
  characters: WorkflowCharacter[];
  styleGuide?: string;
}): WorkflowCharacter[] => {
  const seen = new Set<string>();

  return input.characters.map((character, index) => {
    let portraitPrompt = clean(character.portrait_prompt);
    let portraitImageUrl = clean(character.portrait_image_url);

    if (!portraitPrompt) {
      portraitPrompt = `character portrait, ${clean(character.name) || `char_${index + 1}`}`;
    }
    if (!portraitImageUrl) {
      portraitImageUrl = buildSeriesImageUrl({
        prompt: portraitPrompt,
        seedKey: `${input.title}:char:${index + 1}:${character.name}:initial`,
        width: 768,
        height: 1024,
        purpose: "character_portrait",
      });
    }

    let retry = 0;
    while (portraitImageUrl && seen.has(portraitImageUrl) && retry < 3) {
      retry += 1;
      portraitPrompt = `${clean(character.portrait_prompt)}, identity variant token: ${character.id || `char_${index + 1}`}-${retry}`;
      portraitImageUrl = buildSeriesImageUrl({
        prompt: portraitPrompt,
        seedKey: `${input.title}:char:${index + 1}:${character.name}:url-unique:${retry}`,
        width: 768,
        height: 1024,
        purpose: "character_portrait",
      });
    }

    if (portraitImageUrl) {
      seen.add(portraitImageUrl);
    }

    return {
      ...character,
      portrait_prompt: portraitPrompt,
      portrait_image_url: portraitImageUrl || character.portrait_image_url,
    };
  });
};

const PORTRAIT_BINARY_DUPLICATE_RETRY_MAX = Math.max(
  0,
  Number.parseInt(clean(process.env.SERIES_PORTRAIT_BINARY_RETRY_MAX) || "1", 10) || 1
);
const ENABLE_PORTRAIT_BINARY_DEDUP =
  clean(process.env.SERIES_PORTRAIT_BINARY_DEDUP).toLowerCase() === "on";
const PORTRAIT_HASH_FETCH_TIMEOUT_MS = Math.max(
  5_000,
  Number.parseInt(clean(process.env.SERIES_PORTRAIT_HASH_FETCH_TIMEOUT_MS) || "20000", 10) || 20_000
);

const fetchPortraitBinaryHash = async (url?: string | null): Promise<string | null> => {
  const normalized = clean(url);
  if (!normalized) return null;
  try {
    const response = await fetch(normalized, {
      headers: {
        "User-Agent": "tomoshibi-mastra/portrait-hash",
      },
      signal: AbortSignal.timeout(PORTRAIT_HASH_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) return null;
    return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  } catch {
    return null;
  }
};

const enforceUniquePortraitBinaryHashes = async (input: {
  title: string;
  styleGuide: string;
  characters: WorkflowCharacter[];
}) => {
  const warnings: string[] = [];
  const next = input.characters.slice();
  const hashToIndex = new Map<string, number>();

  for (let index = 0; index < next.length; index += 1) {
    let current = next[index];
    let resolved = false;

    for (let attempt = 0; attempt <= PORTRAIT_BINARY_DUPLICATE_RETRY_MAX; attempt += 1) {
      const hash = await fetchPortraitBinaryHash(current.portrait_image_url);
      if (!hash) {
        if (attempt === 0) {
          warnings.push(`portrait_hash_unavailable:${clean(current.name)}`);
        }
        resolved = true;
        break;
      }

      const existing = hashToIndex.get(hash);
      if (existing === undefined || existing === index) {
        hashToIndex.set(hash, index);
        resolved = true;
        break;
      }

      const conflict = next[existing];
      if (attempt >= PORTRAIT_BINARY_DUPLICATE_RETRY_MAX) {
        warnings.push(
          `portrait_binary_collision:${clean(current.name)} vs ${clean(conflict?.name)}`
        );
        resolved = true;
        break;
      }

      const prompt = [
        clean(current.portrait_prompt),
        `identity split: visually distinct from ${clean(conflict?.name) || "another cast member"}`,
        "hard constraint: different face geometry, different hairstyle structure, different silhouette",
        `binary uniqueness token ${clean(current.id) || `char_${index + 1}`}-${attempt + 1}`,
        `style lock: ${clean(input.styleGuide)}`,
      ]
        .map((item) => clean(item))
        .filter(Boolean)
        .join(", ");

      current = {
        ...current,
        portrait_prompt: prompt,
        portrait_image_url: buildSeriesImageUrl({
          prompt,
          seedKey: `${input.title}:char:${index + 1}:${current.name}:binary-distinct:${attempt + 1}:${conflict?.id || existing}`,
          width: 768,
          height: 1024,
          purpose: "character_portrait",
        }),
      };
      next[index] = current;
    }

    if (!resolved) {
      warnings.push(`portrait_binary_unresolved:${clean(current.name)}`);
    }
  }

  return {
    characters: next,
    warnings,
  };
};

const PORTRAIT_DUPLICATE_THRESHOLD = 0.82;
const PORTRAIT_DUPLICATE_RETRY_MAX = 2;
const ENABLE_PORTRAIT_VISION_DEDUP = clean(process.env.SERIES_PORTRAIT_VISION_DEDUP).toLowerCase() === "on";
const PORTRAIT_VISION_COMPARE_BUDGET_MS = Math.max(
  20_000,
  Number.parseInt(clean(process.env.SERIES_PORTRAIT_VISION_COMPARE_BUDGET_MS) || "60000", 10) || 60_000
);

const buildPortraitDistinctPrompt = (input: {
  current: WorkflowCharacter;
  conflict: WorkflowCharacter;
  styleGuide: string;
  seriesTitle: string;
}) => {
  const currentTokens = input.current.identity_anchor_tokens;
  const conflictTokens = input.conflict.identity_anchor_tokens;
  const distinctAnchors = dedupeStrings([
    clean(currentTokens?.hair),
    clean(currentTokens?.silhouette),
    clean(currentTokens?.dominant_color),
    clean(currentTokens?.outfit_key_item),
    clean(currentTokens?.distinguishing_feature),
  ]);
  const conflictAnchors = dedupeStrings([
    clean(conflictTokens?.hair),
    clean(conflictTokens?.silhouette),
    clean(conflictTokens?.dominant_color),
    clean(conflictTokens?.outfit_key_item),
    clean(conflictTokens?.distinguishing_feature),
  ]);
  const parts = [
    clean(input.current.portrait_prompt),
    `identity separation constraint: this character must be visually different from ${clean(input.conflict.name)}.`,
    distinctAnchors.length > 0 ? `preserve unique anchors: ${distinctAnchors.join(" / ")}` : "",
    conflictAnchors.length > 0 ? `avoid conflict anchors from ${clean(input.conflict.name)}: ${conflictAnchors.join(" / ")}` : "",
    "hard constraint: different face geometry, different hairstyle structure, different silhouette",
    `style lock: ${clean(input.styleGuide)}`,
    `from series ${clean(input.seriesTitle)}`,
  ]
    .map((item) => clean(item))
    .filter(Boolean);
  return parts.join(", ");
};

const enforceDistinctCharacterPortraits = async (input: {
  title: string;
  styleGuide: string;
  characters: WorkflowCharacter[];
}) => {
  const warnings: string[] = [];
  const next = input.characters.slice();
  const startedAt = Date.now();

  for (let index = 0; index < next.length; index += 1) {
    if (Date.now() - startedAt > PORTRAIT_VISION_COMPARE_BUDGET_MS) {
      warnings.push("portrait_identity_budget_exceeded");
      break;
    }
    let resolved = false;
    for (let attempt = 0; attempt <= PORTRAIT_DUPLICATE_RETRY_MAX; attempt += 1) {
      const current = next[index];
      if (!clean(current.portrait_image_url)) {
        resolved = true;
        break;
      }
      let conflictIndex = -1;
      let conflictScore = 0;
      for (let prev = 0; prev < index; prev += 1) {
        if (Date.now() - startedAt > PORTRAIT_VISION_COMPARE_BUDGET_MS) {
          warnings.push("portrait_identity_budget_exceeded");
          conflictIndex = -1;
          break;
        }
        const previous = next[prev];
        if (!clean(previous.portrait_image_url)) continue;
        try {
          const comparison = await evaluatePortraitSamePersonProbability({
            leftName: previous.name,
            leftImageUrl: previous.portrait_image_url || "",
            rightName: current.name,
            rightImageUrl: current.portrait_image_url || "",
          });
          if (comparison.samePersonProbability >= PORTRAIT_DUPLICATE_THRESHOLD) {
            conflictIndex = prev;
            conflictScore = comparison.samePersonProbability;
            break;
          }
        } catch {
          // If vision comparison fails, keep current portrait and continue generation.
          conflictIndex = -1;
          break;
        }
      }

      if (conflictIndex < 0) {
        resolved = true;
        break;
      }

      const conflict = next[conflictIndex];
      if (attempt >= PORTRAIT_DUPLICATE_RETRY_MAX) {
        warnings.push(
          `portrait_identity_collision:${clean(current.name)} vs ${clean(conflict.name)} score=${conflictScore.toFixed(2)}`
        );
        break;
      }

      const distinctPrompt = buildPortraitDistinctPrompt({
        current,
        conflict,
        styleGuide: input.styleGuide,
        seriesTitle: input.title,
      });
      const regenerated = {
        ...current,
        portrait_prompt: distinctPrompt,
        portrait_image_url: buildSeriesImageUrl({
          prompt: distinctPrompt,
          seedKey: `${input.title}:char:${index + 1}:${current.name}:distinct:${attempt + 1}:${conflict.id}`,
          width: 768,
          height: 1024,
          purpose: "character_portrait",
        }),
      };
      next[index] = regenerated;
    }

    if (!resolved) {
      warnings.push(`portrait_identity_unresolved:${clean(next[index]?.name)}`);
    }
  }

  return {
    characters: next,
    warnings,
  };
};

const buildCoverFocusFromIdentityPack = (
  characters: WorkflowCharacter[],
  identityPack: WorkflowIdentityPack
): CoverFocusCharacter[] => {
  const byId = new Map(characters.map((character) => [character.id, character]));
  const focused: CoverFocusCharacter[] = [];

  for (const keyId of identityPack.key_person_character_ids.slice(0, 3)) {
    const character = byId.get(keyId);
    if (!character) continue;
    const bucket = detectRoleBucket(character);
    focused.push({
      character_id: character.id,
      name: clean(character.name) || `人物${focused.length + 1}`,
      role: clean(character.role) || "キーパーソン",
      focus_reason: toTitleCaseReason(bucket),
      visual_anchor: extractVisualAnchor(character),
    });
  }

  if (focused.length > 0) return focused;
  return selectCoverFocusCharacters(characters);
};

const COVER_REQUIRED_AXES = 3;
const COVER_MIN_PASS_RATE = 0.75;
const COVER_MIN_STYLE_SIMILARITY = 0.45;
const COVER_MIN_WORLD_SIMILARITY = 0.55;
const COVER_MAX_PEOPLE_SCORE = 0.18;
const COVER_MAX_ROUNDS = Math.max(
  1,
  Number.parseInt(clean(process.env.SERIES_COVER_MAX_ROUNDS) || "2", 10) || 2
);
const COVER_CANDIDATES_PER_ROUND = Math.max(
  1,
  Number.parseInt(clean(process.env.SERIES_COVER_CANDIDATES_PER_ROUND) || "3", 10) || 3
);
const COVER_EVAL_BUDGET_MS = Math.max(
  30_000,
  Number.parseInt(clean(process.env.SERIES_COVER_EVAL_BUDGET_MS) || "240000", 10) || 240_000
);

type CoverCandidateReport = z.infer<typeof seriesCoverConsistencyReportSchema>["candidate_reports"][number];

const buildCandidatePrompt = (basePrompt: string, roundIndex: number, slotIndex: number, feedback?: string) => {
  const parts = [
    basePrompt,
    roundIndex > 1 ? clean(feedback) : "",
    roundIndex > 1 || slotIndex > 1 ? `variant round ${roundIndex} slot ${slotIndex}` : "",
  ]
    .map((item) => clean(item))
    .filter(Boolean);
  return parts.join(", ");
};

const evaluateCoverCandidate = async (input: {
  candidateIndex: number;
  roundIndex: number;
  imageUrl: string;
  prompt: string;
  title: string;
  genre: string;
  tone: string;
  premise: string;
  setting: string;
  recurringMotifs: string[];
  styleGuide: string;
}): Promise<CoverCandidateReport> => {
  let evaluation: VisionWorldCoverEvaluation | null = null;
  let lastEvalError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      evaluation = await evaluateWorldCoverWithVision({
        coverImageUrl: input.imageUrl,
        title: input.title,
        genre: input.genre,
        tone: input.tone,
        premise: input.premise,
        setting: input.setting,
        recurringMotifs: input.recurringMotifs,
        styleGuide: input.styleGuide,
      });
      break;
    } catch (error) {
      lastEvalError = error;
    }
  }
  if (!evaluation) {
    const reason = clean(
      lastEvalError instanceof Error ? lastEvalError.message : String(lastEvalError ?? "cover_identity_eval_failed")
    );
    return {
      candidate_index: input.candidateIndex,
      round_index: input.roundIndex,
      image_url: input.imageUrl,
      provider: "eval-unavailable",
      prompt: input.prompt,
      arcface_avg: 0,
      clip_avg: 0.25,
      vision_anchor_avg: 0.25,
      style_similarity: 0.25,
      pass_rate: 0,
      passed: false,
      character_scores: [],
    };
  }

  const noPeopleScore = clamp01(1 - evaluation.peopleScore);
  const worldSimilarity = clamp01(evaluation.worldSimilarity);
  const styleSimilarity = clamp01(evaluation.styleSimilarity);
  const passedAxes =
    (evaluation.peopleScore <= COVER_MAX_PEOPLE_SCORE ? 1 : 0) +
    (worldSimilarity >= COVER_MIN_WORLD_SIMILARITY ? 1 : 0) +
    (styleSimilarity >= COVER_MIN_STYLE_SIMILARITY ? 1 : 0);
  const passRate = clamp01(passedAxes / 3);
  const passed = passedAxes >= COVER_REQUIRED_AXES;

  return {
    candidate_index: input.candidateIndex,
    round_index: input.roundIndex,
    image_url: input.imageUrl,
    provider: clean(evaluation.provider) || "unknown",
    prompt: input.prompt,
    arcface_avg: noPeopleScore,
    clip_avg: worldSimilarity,
    vision_anchor_avg: styleSimilarity,
    style_similarity: styleSimilarity,
    pass_rate: passRate,
    passed,
    character_scores: [],
  };
};

const buildCoverWithConsistency = async (input: {
  title: string;
  genre: string;
  tone: string;
  premise: string;
  setting: string;
  caseCore?: string;
  truthNature?: string;
  environmentLayer?: string;
  styleGuide: string;
  dominantColors: string[];
  recurringMotifs: string[];
  additionalDirection?: string;
}) => {
  const worldPosterDirection = dedupeStrings([
    clean(input.additionalDirection),
    "series cover key art",
    "grounded mystery illustration",
    "narrative clue composition",
    "traces of human presence without showing people",
    "no people",
    "no human silhouettes",
    "no character portraits",
  ]).join(", ");

  const basePrompt = buildCoverImagePrompt({
    title: input.title,
    genre: input.genre,
    tone: input.tone,
    premise: input.premise,
    setting: input.setting,
    caseCore: input.caseCore,
    truthNature: input.truthNature,
    environmentLayer: input.environmentLayer,
    styleGuide: input.styleGuide,
    dominantColors: input.dominantColors,
    recurringMotifs: input.recurringMotifs,
    focusCharacters: [],
    additionalDirection: worldPosterDirection,
    excludeCharacters: true,
  });

  const prompt = buildCandidatePrompt(basePrompt, 1, 1);
  const imageUrl = buildSeriesImageUrl({
    prompt,
    seedKey: `${input.title}:cover:single`,
    width: 1024,
    height: 1365,
    purpose: "cover",
    styleReference: input.styleGuide,
  });
  const candidate = await evaluateCoverCandidate({
    candidateIndex: 1,
    roundIndex: 1,
    imageUrl,
    prompt,
    title: input.title,
    genre: input.genre,
    tone: input.tone,
    premise: input.premise,
    setting: input.setting,
    recurringMotifs: input.recurringMotifs,
    styleGuide: input.styleGuide,
  });
  const summary = candidate.passed
    ? `単一カバー画像が事件キーアート条件を通過しました（pass_rate=${candidate.pass_rate.toFixed(2)}, style=${candidate.style_similarity.toFixed(2)}）`
    : `単一カバー画像を採用しました（pass_rate=${candidate.pass_rate.toFixed(2)}, style=${candidate.style_similarity.toFixed(2)}）`;
  return {
    coverImagePrompt: candidate.prompt,
    coverImageUrl: candidate.image_url,
    coverConsistencyReport: {
      mode: "single_pass",
      thresholds: {
        required_axes_per_character: COVER_REQUIRED_AXES,
        min_average_pass_rate: COVER_MIN_PASS_RATE,
        min_style_similarity: COVER_MIN_STYLE_SIMILARITY,
      },
      validation_rounds: 1,
      selected_candidate_index: 1,
      selected_cover_image_url: candidate.image_url,
      selected_cover_image_prompt: candidate.prompt,
      selected_provider: clean(candidate.provider) || "unknown",
      passed: candidate.passed,
      summary,
      candidate_reports: [candidate],
    } satisfies WorkflowCoverConsistencyReport,
  };
};

const buildProposalCoverFast = (input: {
  title: string;
  genre: string;
  tone: string;
  premise: string;
  setting: string;
  caseCore?: string;
  truthNature?: string;
  environmentLayer?: string;
  styleGuide: string;
  dominantColors: string[];
  recurringMotifs: string[];
  additionalDirection?: string;
}) => {
  const worldPosterDirection = dedupeStrings([
    clean(input.additionalDirection),
    "series cover key art",
    "grounded mystery illustration",
    "narrative clue composition",
    "traces of human presence without showing people",
    "no people",
    "no human silhouettes",
    "no character portraits",
  ]).join(", ");

  const prompt = buildCoverImagePrompt({
    title: input.title,
    genre: input.genre,
    tone: input.tone,
    premise: input.premise,
    setting: input.setting,
    caseCore: input.caseCore,
    truthNature: input.truthNature,
    environmentLayer: input.environmentLayer,
    styleGuide: input.styleGuide,
    dominantColors: input.dominantColors,
    recurringMotifs: input.recurringMotifs,
    focusCharacters: [],
    additionalDirection: worldPosterDirection,
    excludeCharacters: true,
  });
  const imageUrl = buildSeriesImageUrl({
    prompt,
    seedKey: `${input.title}:cover:proposal:fast`,
    width: 1024,
    height: 1365,
    purpose: "cover",
    styleReference: input.styleGuide,
  });
  const candidate: CoverCandidateReport = {
    candidate_index: 1,
    round_index: 1,
    image_url: imageUrl,
    provider: "fast-proposal",
    prompt,
    arcface_avg: 1,
    clip_avg: 0.72,
    vision_anchor_avg: 0.72,
    style_similarity: 0.72,
    pass_rate: 1,
    passed: true,
    character_scores: [],
  };
  return {
    coverImagePrompt: prompt,
    coverImageUrl: imageUrl,
    coverConsistencyReport: {
      mode: "single_pass",
      thresholds: {
        required_axes_per_character: COVER_REQUIRED_AXES,
        min_average_pass_rate: COVER_MIN_PASS_RATE,
        min_style_similarity: COVER_MIN_STYLE_SIMILARITY,
      },
      validation_rounds: 1,
      selected_candidate_index: 1,
      selected_cover_image_url: imageUrl,
      selected_cover_image_prompt: prompt,
      selected_provider: "fast-proposal",
      passed: true,
      summary: "提案モードのため高速カバー生成を適用しました。",
      candidate_reports: [candidate],
    } satisfies WorkflowCoverConsistencyReport,
  };
};

const resolvedSeriesRequestSchema = z.object({
  interview: seriesInterviewSchema,
  desired_episode_count: z.number().int().min(3).max(24),
  prompt: z.string().optional(),
  creator_id: z.string().uuid().optional(),
  language: z.string(),
  generation_mode: z.enum(["proposal", "full"]).default("full"),
  existing_identity_pack: seriesIdentityPackSchema.optional(),
  identity_retcon: z.boolean().optional(),
  recent_generation_context: seriesRecentGenerationContextSchema.optional(),
});

const sanitizeSeriesRequestInputSchema = z.object({
  interview: seriesInterviewSchema.extend({
    avoidance_preferences: z.string().optional(),
  }),
  desired_episode_count: z.number().int().min(3).max(24).optional(),
  prompt: z.string().optional(),
  creator_id: z.string().uuid().optional(),
  language: z.string().optional(),
  generation_mode: z.enum(["proposal", "full"]).optional(),
  existing_identity_pack: z.unknown().optional(),
  identity_retcon: z.boolean().optional(),
  recent_generation_context: seriesRecentGenerationContextSchema.optional(),
});

const LOG_PREFIX = "[series-workflow]";

const sanitizeRequestStep = createStep({
  id: "sanitize-series-request",
  inputSchema: sanitizeSeriesRequestInputSchema,
  outputSchema: resolvedSeriesRequestSchema,
  execute: async ({ inputData }) => {
    console.log(`${LOG_PREFIX} step 1/7: sanitize-series-request 開始`);
    try {
      const parsedIdentityPack = inputData.existing_identity_pack
        ? seriesIdentityPackSchema.safeParse(inputData.existing_identity_pack)
        : null;
      const resolved: z.infer<typeof resolvedSeriesRequestSchema> = {
        desired_episode_count: inputData.desired_episode_count ?? 8,
        prompt: clean(inputData.prompt),
        language: clean(inputData.language) || "ja",
        generation_mode: inputData.generation_mode === "proposal" ? "proposal" : "full",
        creator_id: inputData.creator_id,
        existing_identity_pack: parsedIdentityPack?.success ? parsedIdentityPack.data : undefined,
        identity_retcon: Boolean(inputData.identity_retcon),
        recent_generation_context: inputData.recent_generation_context,
        interview: {
          genre_world: clean(inputData.interview.genre_world),
          desired_emotion: clean(inputData.interview.desired_emotion),
          companion_preference: clean(inputData.interview.companion_preference),
          continuation_trigger: clean(inputData.interview.continuation_trigger),
          avoidance_preferences: clean(inputData.interview.avoidance_preferences),
          additional_notes: clean(inputData.interview.additional_notes),
          visual_style_preset: clean(inputData.interview.visual_style_preset),
          visual_style_notes: clean(inputData.interview.visual_style_notes),
          main_objective: clean(inputData.interview.main_objective),
          protagonist_position: clean(inputData.interview.protagonist_position),
          partner_description: clean(inputData.interview.partner_description),
        },
      };
      console.log(`${LOG_PREFIX} step 1/7: sanitize-series-request 完了`);
      return resolved;
    } catch (e: any) {
      console.error(`${LOG_PREFIX} step 1/7: sanitize-series-request 失敗`, e?.message ?? e);
      throw e;
    }
  },
});

const conceptStepOutputSchema = z.object({
  request: resolvedSeriesRequestSchema,
  concept: seriesConceptAgentOutputSchema,
});

const generateConceptStep = createStep({
  id: "generate-series-concept",
  inputSchema: resolvedSeriesRequestSchema,
  outputSchema: conceptStepOutputSchema,
  execute: async ({ inputData }) => {
    console.log(`${LOG_PREFIX} step 2/7: generate-series-concept 開始`);
    try {
      const concept = await generateSeriesConcept({
        interview: inputData.interview,
        prompt: inputData.prompt,
        desiredEpisodeCount: inputData.desired_episode_count,
        language: inputData.language,
        recent_generation_context: inputData.recent_generation_context,
      });
      console.log(`${LOG_PREFIX} step 2/7: generate-series-concept 完了 (title: ${concept?.title ?? "—"})`);
      return {
        request: inputData,
        concept,
      };
    } catch (e: any) {
      console.error(`${LOG_PREFIX} step 2/7: generate-series-concept 失敗`, e?.message ?? e);
      throw e;
    }
  },
});

const charactersStepOutputSchema = conceptStepOutputSchema.extend({
  characters: z.array(seriesCharacterSchema).min(3).max(8),
});

const generateCharactersStep = createStep({
  id: "generate-series-characters",
  inputSchema: conceptStepOutputSchema,
  outputSchema: charactersStepOutputSchema,
  execute: async ({ inputData }) => {
    console.log(`${LOG_PREFIX} step 3/7: generate-series-characters 開始`);
    try {
      const targetCount = Math.max(3, Math.min(5, Math.ceil(inputData.request.desired_episode_count / 2)));
      const styleGuide = buildSeriesVisualStyleGuide({
        seriesTitle: inputData.concept.title,
        genre: inputData.concept.genre,
        tone: inputData.concept.tone,
        setting: inputData.concept.world.setting,
        recurringMotifs: inputData.concept.world.recurring_motifs,
        stylePreset: inputData.request.interview.visual_style_preset,
        styleDirection: inputData.request.interview.visual_style_notes,
      });
      const characterResult = await generateSeriesCharacters({
        title: inputData.concept.title,
        genre: inputData.concept.genre,
        tone: inputData.concept.tone,
        premise: inputData.concept.premise,
        season_goal: inputData.concept.season_goal,
        protagonist_position: "シリーズ内で独立して行動する主人公（ユーザー本人ではない）",
        partner_description:
          clean(inputData.request.interview.companion_preference) ||
          clean(inputData.request.interview.partner_description) ||
          "信頼できる相棒",
        style_guide: styleGuide,
        target_count: targetCount,
        mystery_profile: inputData.concept.mystery_profile,
        recent_generation_context: inputData.request.recent_generation_context,
      });
      const count = characterResult?.characters?.length ?? 0;
      console.log(`${LOG_PREFIX} step 3/7: generate-series-characters 完了 (${count}人)`);
      return {
        ...inputData,
        characters: characterResult.characters,
      };
    } catch (e: any) {
      console.error(`${LOG_PREFIX} step 3/7: generate-series-characters 失敗`, e?.message ?? e);
      throw e;
    }
  },
});

const identityStepOutputSchema = charactersStepOutputSchema.extend({
  characters: z.array(seriesCharacterSchema).min(3).max(8),
  identity_pack: seriesIdentityPackSchema,
});

const buildIdentityPackStep = createStep({
  id: "build-series-identity-pack",
  inputSchema: charactersStepOutputSchema,
  outputSchema: identityStepOutputSchema,
  execute: async ({ inputData }) => {
    console.log(`${LOG_PREFIX} step 4/7: build-series-identity-pack 開始`);
    try {
      const styleGuide =
        clean(inputData.request.existing_identity_pack?.style_bible) ||
        buildSeriesVisualStyleGuide({
          seriesTitle: inputData.concept.title,
          genre: inputData.concept.genre,
          tone: inputData.concept.tone,
          setting: inputData.concept.world.setting,
          recurringMotifs: inputData.concept.world.recurring_motifs,
          dominantColors: collectDominantColors(inputData.characters),
          stylePreset: inputData.request.interview.visual_style_preset,
          styleDirection: inputData.request.interview.visual_style_notes,
        });
      const identity = buildSeriesIdentityPack({
        characters: inputData.characters,
        styleGuide,
        existingIdentityPack: inputData.request.existing_identity_pack,
        identityRetcon: inputData.request.identity_retcon,
      });
      console.log(`${LOG_PREFIX} step 4/7: build-series-identity-pack 完了 (key: ${identity.identityPack.key_person_character_ids.join(",")})`);
      return {
        ...inputData,
        characters: identity.characters,
        identity_pack: identity.identityPack,
      };
    } catch (e: any) {
      console.error(`${LOG_PREFIX} step 4/7: build-series-identity-pack 失敗`, e?.message ?? e);
      throw e;
    }
  },
});

const episodeStepOutputSchema = identityStepOutputSchema.extend({
  checkpoints: z.array(seriesCheckpointSchema).min(4).max(8),
  first_episode_seed: seriesEpisodeSeedSchema,
});

const seedRouteMetricsSchema = z.object({
  optimizer: z.string(),
  total_estimated_walk_minutes: z.number().int().min(0),
  transfer_minutes: z.number().int().min(0),
  max_leg_minutes: z.number().int().min(0),
  max_total_walk_minutes: z.number().int().min(0),
  feasible: z.boolean(),
  failure_reasons: z.array(z.string()).max(20),
  optimized_order_indices: z.array(z.number().int().min(0)).max(6),
  optimized_order_spot_names: z.array(z.string()).max(6),
});

const seedRouteDryRunSchema = z.object({
  feasible: z.boolean(),
  selected_spots: z.array(z.string()).max(4),
  failure_reasons: z.array(z.string()).max(20),
  route_metrics: seedRouteMetricsSchema,
  route_score: z.number().min(0).max(1),
  continuity_score: z.number().min(0).max(1),
});

const seedDryRunStepOutputSchema = episodeStepOutputSchema.extend({
  seed_route_dry_run: seedRouteDryRunSchema,
});

const generateEpisodesStep = createStep({
  id: "generate-series-checkpoints",
  inputSchema: identityStepOutputSchema,
  outputSchema: episodeStepOutputSchema,
  execute: async ({ inputData }) => {
    console.log(`${LOG_PREFIX} step 5/7: generate-series-checkpoints 開始`);
    try {
      const plan = await generateSeriesEpisodePlan({
        title: inputData.concept.title,
        premise: inputData.concept.premise,
        season_goal: inputData.concept.season_goal,
        genre: inputData.concept.genre,
        tone: inputData.concept.tone,
        world: inputData.concept.world,
        characters: inputData.characters,
        desired_episode_count: inputData.request.desired_episode_count,
        mystery_profile: inputData.concept.mystery_profile,
        recent_generation_context: inputData.request.recent_generation_context,
      });
      const cpCount = plan?.checkpoints?.length ?? 0;
      console.log(`${LOG_PREFIX} step 5/7: generate-series-checkpoints 完了 (checkpoints: ${cpCount})`);
      return {
        ...inputData,
        checkpoints: plan.checkpoints,
        first_episode_seed: plan.first_episode_seed,
      };
    } catch (e: any) {
      console.error(`${LOG_PREFIX} step 5/7: generate-series-checkpoints 失敗`, e?.message ?? e);
      throw e;
    }
  },
});

const dryRunFirstEpisodeSeedStep = createStep({
  id: "dry-run-first-episode-seed-route",
  inputSchema: episodeStepOutputSchema,
  outputSchema: seedDryRunStepOutputSchema,
  execute: async ({ inputData }) => {
    console.log(`${LOG_PREFIX} step 6/7: dry-run-first-episode-seed-route 開始`);
    const defaultDryRun = {
      feasible: false,
      selected_spots: [] as string[],
      failure_reasons: ["seed_route_dry_run_not_executed"],
      route_metrics: {
        optimizer: "seed_dry_run_unavailable",
        total_estimated_walk_minutes: 0,
        transfer_minutes: 0,
        max_leg_minutes: 0,
        max_total_walk_minutes: 0,
        feasible: false,
        failure_reasons: ["seed_route_dry_run_not_executed"],
        optimized_order_indices: [] as number[],
        optimized_order_spot_names: [] as string[],
      },
      route_score: 0,
      continuity_score: 0,
    };

    try {
      const dryRun = await dryRunFirstEpisodeSeedRoute({
        stage_location: clean(inputData.concept.world.setting) || clean(inputData.request.interview.genre_world) || "街",
        world_setting: clean(inputData.concept.world.setting),
        purpose: "シリーズ第1話導線の成立性検証",
        expected_duration_minutes: inputData.first_episode_seed.expected_duration_minutes,
        suggested_spots: inputData.first_episode_seed.suggested_spots || [],
        spot_requirements: inputData.first_episode_seed.spot_requirements.map((requirement) => ({
          requirement_id: requirement.requirement_id,
          scene_role: requirement.scene_role,
          spot_role: requirement.spot_role,
          required_attributes: requirement.required_attributes,
          visit_constraints: requirement.visit_constraints,
          tourism_value_type: requirement.tourism_value_type,
        })),
      });
      console.log(
        `${LOG_PREFIX} step 6/7: dry-run-first-episode-seed-route 完了 (feasible=${dryRun.feasible}, selected=${dryRun.selected_spots.length})`
      );
      return {
        ...inputData,
        seed_route_dry_run: {
          feasible: dryRun.feasible,
          selected_spots: dryRun.selected_spots.slice(0, 4),
          failure_reasons: dryRun.failure_reasons.slice(0, 20),
          route_metrics: {
            ...dryRun.route_metrics,
            failure_reasons: dryRun.route_metrics.failure_reasons.slice(0, 20),
            optimized_order_indices: dryRun.route_metrics.optimized_order_indices.slice(0, 6),
            optimized_order_spot_names: dryRun.route_metrics.optimized_order_spot_names.slice(0, 6),
          },
          route_score: dryRun.route_score,
          continuity_score: dryRun.continuity_score,
        },
      };
    } catch (error: any) {
      const reason = clean(error?.message || String(error || "seed_route_dry_run_failed"));
      console.warn(`${LOG_PREFIX} step 6/7: dry-run-first-episode-seed-route 失敗`, reason);
      return {
        ...inputData,
        seed_route_dry_run: {
          ...defaultDryRun,
          failure_reasons: [reason || "seed_route_dry_run_failed"],
          route_metrics: {
            ...defaultDryRun.route_metrics,
            failure_reasons: [reason || "seed_route_dry_run_failed"],
          },
        },
      };
    }
  },
});

const assembleSeriesBlueprint = async (input: {
  request: z.infer<typeof resolvedSeriesRequestSchema>;
  concept: z.infer<typeof seriesConceptAgentOutputSchema>;
  characters: WorkflowCharacter[];
  identityPack: WorkflowIdentityPack;
  checkpoints: z.infer<typeof seriesCheckpointSchema>[];
  firstEpisodeSeed: z.infer<typeof seriesEpisodeSeedSchema>;
  seedRouteDryRun: z.infer<typeof seedRouteDryRunSchema>;
  workflowVersion?: string;
  additionalWarnings?: string[];
  onProgress?: SeriesGenerationProgressReporter;
}) => {
  const consistency = await generateSeriesConsistency({
    title: input.concept.title,
    overview: input.concept.overview,
    premise: input.concept.premise,
    season_goal: input.concept.season_goal,
    ai_rule_points: input.concept.ai_rule_points,
    characters: input.characters,
    checkpoints: input.checkpoints,
    first_episode_seed: input.firstEpisodeSeed,
    mystery_profile: input.concept.mystery_profile,
    recent_generation_context: input.request.recent_generation_context,
  });

  const aiRulePoints = consistency.ai_rule_points.slice(0, 12);
  const warnings: string[] = [];
  if (Array.isArray(input.additionalWarnings) && input.additionalWarnings.length > 0) {
    warnings.push(...input.additionalWarnings.map((item) => clean(item)).filter(Boolean));
  }
  if (consistency.warnings && consistency.warnings.length > 0) {
    warnings.push(...consistency.warnings);
  }
  if (!input.seedRouteDryRun.feasible) {
    warnings.push(
      `first_episode_seed_dry_run_unfeasible:${
        input.seedRouteDryRun.failure_reasons.join(",") || "unknown_reason"
      }`
    );
  }

  const dominantColors = collectDominantColors(input.characters);
  const visualStyleGuide =
    clean(input.identityPack.style_bible) ||
    buildSeriesVisualStyleGuide({
      seriesTitle: input.concept.title,
      genre: input.concept.genre,
      tone: input.concept.tone,
      setting: input.concept.world.setting,
      recurringMotifs: input.concept.world.recurring_motifs,
      dominantColors,
      stylePreset: input.request.interview.visual_style_preset,
      styleDirection: input.request.interview.visual_style_notes,
    });
  const isProposalMode = input.request.generation_mode === "proposal";

  const harmonizedCharacters = ensureUniquePortraitUrls({
    title: input.concept.title,
    styleGuide: visualStyleGuide,
    characters: harmonizeCharacterPortraits({
      title: input.concept.title,
      genre: input.concept.genre,
      tone: input.concept.tone,
      setting: input.concept.world.setting || input.concept.premise,
      styleGuide: visualStyleGuide,
      characters: input.characters,
      mysteryProfile: input.concept.mystery_profile,
    }),
  });
  const binaryUniqueInitial = isProposalMode || !ENABLE_PORTRAIT_BINARY_DEDUP
    ? {
      characters: harmonizedCharacters,
      warnings: [] as string[],
    }
    : await enforceUniquePortraitBinaryHashes({
      title: input.concept.title,
      styleGuide: visualStyleGuide,
      characters: harmonizedCharacters,
    });
  if (binaryUniqueInitial.warnings.length > 0) {
    warnings.push(...binaryUniqueInitial.warnings);
  }
  const distinctPortraitResult = !isProposalMode && ENABLE_PORTRAIT_VISION_DEDUP
    ? await enforceDistinctCharacterPortraits({
      title: input.concept.title,
      styleGuide: visualStyleGuide,
      characters: binaryUniqueInitial.characters,
    })
    : {
      characters: binaryUniqueInitial.characters,
      warnings: [] as string[],
    };
  if (distinctPortraitResult.warnings.length > 0) {
    warnings.push(...distinctPortraitResult.warnings);
  }

  const uniquePortraitCharacters = ensureUniquePortraitUrls({
    title: input.concept.title,
    styleGuide: visualStyleGuide,
    characters: distinctPortraitResult.characters,
  });
  const binaryUniqueFinal = isProposalMode || !ENABLE_PORTRAIT_BINARY_DEDUP
    ? {
      characters: uniquePortraitCharacters,
      warnings: [] as string[],
    }
    : await enforceUniquePortraitBinaryHashes({
      title: input.concept.title,
      styleGuide: visualStyleGuide,
      characters: uniquePortraitCharacters,
    });
  if (binaryUniqueFinal.warnings.length > 0) {
    warnings.push(...binaryUniqueFinal.warnings);
  }
  const finalizedPortraitCharacters = ensureUniquePortraitUrls({
    title: input.concept.title,
    styleGuide: visualStyleGuide,
    characters: binaryUniqueFinal.characters,
  });

  const synced = syncIdentityPackWithCharacters(
    {
      ...input.identityPack,
      style_bible: visualStyleGuide,
    },
    finalizedPortraitCharacters
  );

  const coverFocusCharacters = buildCoverFocusFromIdentityPack(synced.characters, synced.identityPack);

  await emitSeriesGenerationProgress(input.onProgress, {
    phase: "generate_series_cover_candidates_start",
    detail: "カバー画像を生成しています",
  });

  const coverBundle = isProposalMode
    ? buildProposalCoverFast({
      title: input.concept.title,
      genre: input.concept.genre,
      tone: input.concept.tone,
      premise: input.concept.premise,
      setting: input.concept.world.setting,
      caseCore: input.concept.mystery_profile?.case_core,
      truthNature: input.concept.mystery_profile?.truth_nature,
      environmentLayer: input.concept.mystery_profile?.environment_layer,
      styleGuide: visualStyleGuide,
      dominantColors,
      recurringMotifs: input.concept.world.recurring_motifs,
    })
    : await buildCoverWithConsistency({
      title: input.concept.title,
      genre: input.concept.genre,
      tone: input.concept.tone,
      premise: input.concept.premise,
      setting: input.concept.world.setting,
      caseCore: input.concept.mystery_profile?.case_core,
      truthNature: input.concept.mystery_profile?.truth_nature,
      environmentLayer: input.concept.mystery_profile?.environment_layer,
      styleGuide: visualStyleGuide,
      dominantColors,
      recurringMotifs: input.concept.world.recurring_motifs,
    });

  await emitSeriesGenerationProgress(input.onProgress, {
    phase: "generate_series_cover_candidates_done",
    detail: "カバー画像の生成が完了しました",
  });

  await emitSeriesGenerationProgress(input.onProgress, {
    phase: "validate_cover_identity_start",
    detail: "カバーが事件キーアートとして成立しているかを検証しています",
  });
  await emitSeriesGenerationProgress(input.onProgress, {
    phase: "validate_cover_identity_done",
    detail: coverBundle.coverConsistencyReport.summary,
  });

  const worldVisualSeeds = [
    {
      id: "upper_area",
      title: "上層エリア",
      description:
        clean(input.concept.world.social_structure) ||
        "表向きの秩序と生活動線が共存し、現地を巡るほど見え方が変わる。",
      atmosphere: clean(input.concept.tone) || "高密度で緊張感のある空気",
    },
    {
      id: "lower_area",
      title: "下層エリア",
      description:
        clean(input.concept.world.core_conflict) ||
        clean(consistency.continuity.global_mystery) ||
        "生活圏と秘密が交差し、地点ごとの観察で認識が更新される。",
      atmosphere: clean(consistency.continuity.mid_season_twist) || "少し不穏な余韻",
    },
  ] as const;

  const worldVisualAssets = worldVisualSeeds.map((seed, index) => {
    const prompt = buildWorldVisualPrompt({
      seriesTitle: input.concept.title,
      genre: input.concept.genre,
      tone: input.concept.tone,
      setting: input.concept.world.setting,
      focusTitle: seed.title,
      focusDescription: seed.description,
      atmosphere: seed.atmosphere,
      styleGuide: visualStyleGuide,
    });

    return {
      id: seed.id,
      title: seed.title,
      description: seed.description,
      prompt,
      image_url: buildSeriesImageUrl({
        prompt,
        seedKey: `${input.concept.title}:world:${seed.id}:${index + 1}`,
        width: 960,
        height: 640,
        purpose: "world_visual",
        styleReference: visualStyleGuide,
      }),
    };
  });

  return {
    output: {
      series: {
        title: input.concept.title,
        overview: consistency.overview_refined || input.concept.overview,
        ai_rules: aiRulePoints.map((rule) => `- ${rule}`).join("\n"),
        genre: input.concept.genre,
        tone: input.concept.tone,
        premise: input.concept.premise,
        season_goal: input.concept.season_goal,
        visual_style_preset: clean(input.request.interview.visual_style_preset) || undefined,
        visual_style_notes: clean(input.request.interview.visual_style_notes) || undefined,
        cover_image_prompt: coverBundle.coverImagePrompt,
        cover_image_url: coverBundle.coverImageUrl,
        world: {
          ...input.concept.world,
          visual_assets: worldVisualAssets,
        },
        characters: synced.characters,
        cover_focus_characters: coverFocusCharacters,
        identity_pack: synced.identityPack,
        cover_consistency_report: coverBundle.coverConsistencyReport,
        checkpoints: input.checkpoints,
        first_episode_seed: input.firstEpisodeSeed,
        mystery_profile: input.concept.mystery_profile,
        progress_state: {
          last_completed_episode_no: 0,
          unresolved_threads: [consistency.continuity.global_mystery].filter((item) => clean(item).length > 0),
          revealed_facts: [],
          relationship_state_summary: "主要キャラクターとの関係は導入段階。",
          relationship_flags: [],
          recent_relation_shift: [],
          companion_trust_level: 40,
          next_hook: clean(input.firstEpisodeSeed.carry_over_hint) || "次回につながる問いが残る。",
        },
        // Keep legacy field for backward compatibility with old clients.
        episode_blueprints: [],
        continuity: consistency.continuity,
      },
      meta: {
        desired_episode_count: input.request.desired_episode_count,
        generated_checkpoint_count: input.checkpoints.length,
        workflow_version: clean(input.workflowVersion) || "series-workflow-v9-single-path",
        warnings,
        first_episode_seed_dry_run: input.seedRouteDryRun,
      },
    } satisfies z.infer<typeof seriesWorkflowOutputSchema>,
    warnings,
  };
};

const finalizeSeriesStep = createStep({
  id: "finalize-series-blueprint",
  inputSchema: seedDryRunStepOutputSchema,
  outputSchema: seriesWorkflowOutputSchema,
  execute: async ({ inputData }) => {
    console.log(`${LOG_PREFIX} step 7/7: finalize-series-blueprint 開始`);
    try {
      const result = await assembleSeriesBlueprint({
        request: inputData.request,
        concept: inputData.concept,
        characters: inputData.characters,
        identityPack: inputData.identity_pack,
        checkpoints: inputData.checkpoints,
        firstEpisodeSeed: inputData.first_episode_seed,
        seedRouteDryRun: inputData.seed_route_dry_run,
        workflowVersion: "series-workflow-v9-single-path",
      });
      console.log(`${LOG_PREFIX} step 7/7: finalize-series-blueprint 完了`);
      return result.output;
    } catch (e: any) {
      console.error(`${LOG_PREFIX} step 7/7: finalize-series-blueprint 失敗`, e?.message ?? e);
      throw e;
    }
  },
});

export const seriesWorkflow = createWorkflow({
  id: "series-workflow",
  inputSchema: seriesGenerationRequestSchema,
  outputSchema: seriesWorkflowOutputSchema,
})
  .then(sanitizeRequestStep)
  .then(generateConceptStep)
  .then(generateCharactersStep)
  .then(buildIdentityPackStep)
  .then(generateEpisodesStep)
  .then(dryRunFirstEpisodeSeedStep)
  .then(finalizeSeriesStep)
  .commit();

export type SeriesGenerationProgressPhase =
  | "sanitize_series_request_start"
  | "sanitize_series_request_done"
  | "build_series_intent_bundle_start"
  | "build_series_intent_bundle_done"
  | "generate_series_concept_seeds_start"
  | "generate_series_concept_seeds_done"
  | "dedupe_series_concept_seeds_start"
  | "dedupe_series_concept_seeds_done"
  | "expand_series_candidates_start"
  | "expand_series_candidates_done"
  | "generate_first_episode_seed_start"
  | "generate_first_episode_seed_done"
  | "evaluate_first_episode_seed_start"
  | "evaluate_first_episode_seed_done"
  | "judge_series_candidates_start"
  | "judge_series_candidates_done"
  | "generate_series_concept_start"
  | "generate_series_concept_done"
  | "generate_series_characters_start"
  | "generate_series_characters_done"
  | "build_series_identity_pack_start"
  | "build_series_identity_pack_done"
  | "generate_series_checkpoints_start"
  | "generate_series_checkpoints_done"
  | "seed_route_dry_run_start"
  | "seed_route_dry_run_done"
  | "finalize_series_blueprint_start"
  | "generate_series_cover_candidates_start"
  | "generate_series_cover_candidates_done"
  | "validate_cover_identity_start"
  | "validate_cover_identity_done"
  | "finalize_series_blueprint_done";

export type SeriesGenerationProgressEvent = {
  phase: SeriesGenerationProgressPhase;
  at: string;
  detail?: string;
};

type SeriesGenerationProgressReporter = (
  event: SeriesGenerationProgressEvent
) => void | Promise<void>;

const emitSeriesGenerationProgress = async (
  reporter: SeriesGenerationProgressReporter | undefined,
  event: Omit<SeriesGenerationProgressEvent, "at">
) => {
  if (!reporter) return;
  await reporter({
    ...event,
    at: new Date().toISOString(),
  });
};

const QUALITY_MODE = clean(process.env.SERIES_WORKFLOW_QUALITY_MODE).toLowerCase();
const QUALITY_STRICT_MODE = clean(process.env.SERIES_WORKFLOW_QUALITY_STRICT).toLowerCase() === "on";
const QUALITY_TEXT_JUDGE_ENABLED = clean(process.env.SERIES_WORKFLOW_TEXT_JUDGE_MODE).toLowerCase() !== "off";
const QUALITY_DEBUG_TRACE = clean(process.env.SERIES_WORKFLOW_DEBUG_TRACE).toLowerCase() === "on";
const QUALITY_SEED_TARGET = Math.max(
  6,
  Math.min(10, Number.parseInt(clean(process.env.SERIES_CONCEPT_SEED_TARGET) || "8", 10) || 8)
);
const QUALITY_EXPAND_TARGET = Math.max(
  2,
  Math.min(3, Number.parseInt(clean(process.env.SERIES_CONCEPT_EXPAND_TARGET) || "3", 10) || 3)
);
const FORCE_SINGLE_PATH_SERIES_GENERATION = true;

const isQualityWorkflowEnabled = () => {
  // Multi-candidate exploration is disabled for cost control; series generation stays single-path.
  if (FORCE_SINGLE_PATH_SERIES_GENERATION) return false;
  if (QUALITY_MODE === "off" || QUALITY_MODE === "legacy") return false;
  return true;
};

const buildSeedFingerprintKey = (seed: WorkflowConceptSeed) =>
  dedupeStrings([
    seed.fingerprint.worldview_archetype,
    seed.fingerprint.emotional_promise,
    seed.fingerprint.fixed_character_dynamic,
    seed.fingerprint.continuation_mode,
    seed.fingerprint.ending_type,
    ...seed.fingerprint.motif_cluster,
  ])
    .join("|")
    .toLowerCase();

const defaultSeedRouteDryRun = (reason: string): z.infer<typeof seedRouteDryRunSchema> => ({
  feasible: false,
  selected_spots: [],
  failure_reasons: [clean(reason) || "seed_route_dry_run_failed"],
  route_metrics: {
    optimizer: "seed_dry_run_unavailable",
    total_estimated_walk_minutes: 0,
    transfer_minutes: 0,
    max_leg_minutes: 0,
    max_total_walk_minutes: 0,
    feasible: false,
    failure_reasons: [clean(reason) || "seed_route_dry_run_failed"],
    optimized_order_indices: [],
    optimized_order_spot_names: [],
  },
  route_score: 0,
  continuity_score: 0,
});

const runSeedRouteDryRunForSeed = async (params: {
  concept: z.infer<typeof seriesConceptAgentOutputSchema>;
  request: z.infer<typeof resolvedSeriesRequestSchema>;
  firstEpisodeSeed: z.infer<typeof seriesEpisodeSeedSchema>;
}): Promise<z.infer<typeof seedRouteDryRunSchema>> => {
  try {
    const dryRun = await dryRunFirstEpisodeSeedRoute({
      stage_location:
        clean(params.concept.world.setting) ||
        clean(params.request.interview.genre_world) ||
        "現実の外出先",
      world_setting: clean(params.concept.world.setting),
      purpose: "シリーズ第1話導線の成立性検証",
      expected_duration_minutes: params.firstEpisodeSeed.expected_duration_minutes,
      suggested_spots: params.firstEpisodeSeed.suggested_spots || [],
      spot_requirements: params.firstEpisodeSeed.spot_requirements.map((requirement) => ({
        requirement_id: requirement.requirement_id,
        scene_role: requirement.scene_role,
        spot_role: requirement.spot_role,
        required_attributes: requirement.required_attributes,
        visit_constraints: requirement.visit_constraints,
        tourism_value_type: requirement.tourism_value_type,
      })),
    });
    return {
      feasible: dryRun.feasible,
      selected_spots: dryRun.selected_spots.slice(0, 4),
      failure_reasons: dryRun.failure_reasons.slice(0, 20),
      route_metrics: {
        ...dryRun.route_metrics,
        failure_reasons: dryRun.route_metrics.failure_reasons.slice(0, 20),
        optimized_order_indices: dryRun.route_metrics.optimized_order_indices.slice(0, 6),
        optimized_order_spot_names: dryRun.route_metrics.optimized_order_spot_names.slice(0, 6),
      },
      route_score: dryRun.route_score,
      continuity_score: dryRun.continuity_score,
    };
  } catch (error: any) {
    return defaultSeedRouteDryRun(clean(error?.message || String(error || "seed_route_dry_run_failed")));
  }
};

const buildFallbackConceptFromSeed = (params: {
  seed: WorkflowConceptSeed;
  request: z.infer<typeof resolvedSeriesRequestSchema>;
}) => {
  const tone =
    clean(params.seed.emotional_core) || clean(params.request.interview.desired_emotion) || "余韻と高揚";
  const truthNature = "現実因果で説明可能な人間サイズの真相";
  const duoDynamic = clean(params.seed.central_relationship_dynamic) || "観察役と補助役の協働";
  const caseCore = "局所事件から大謎へ接続する手掛かり追跡";
  const genre = /(記録|改ざん|履歴|台帳)/.test(`${params.seed.worldview_core} ${params.seed.one_line_hook}`)
    ? "記録反転ミステリー"
    : /(証言|矛盾|食い違い)/.test(`${params.seed.worldview_core} ${params.seed.one_line_hook}`)
      ? "証言対立ミステリー"
      : "連作ミステリー";
  const premise =
    `${duoDynamic}の関係にある二人が、${caseCore}に見える出来事を追ううちに、${truthNature}へとつながる連鎖に巻き込まれていく。`;
  const overview =
    "一見すると個別の案件に見える出来事の背後には、同じ種類の歪みが潜んでいる。残された痕跡と人々の記憶のずれを辿るうちに、物語はより大きな真相へ近づいていく。";
  const seasonGoal =
    clean(params.seed.return_reason) || "積み重なる食い違いの先にあるシリーズ大謎の正体を突き止める";

  return {
    title: clean(params.seed.title) || "新しいシリーズ",
    genre,
    tone,
    premise,
    overview,
    season_goal: seasonGoal,
    cover_image_prompt: "",
    world: {
      era: "現代",
      setting: "人々が信じる説明と、残された痕跡が静かに食い違う現代の生活圏",
      social_structure: "公的な説明と私的な記憶が静かにずれ、人間関係と記録の読み違いが事件性を生む",
      core_conflict: "公開された見え方と、現地で辿れる事実のズレが衝突する",
      taboo_rules: ["証拠なしで断定しない", "同意なく他者の秘密を公開しない"],
      recurring_motifs: dedupeStrings(params.seed.fingerprint.motif_cluster).slice(0, 4),
      visual_assets: [],
    },
    ai_rule_points: dedupeStrings([
      "各話で前話のcarry_overを1つ以上参照する。",
      "固定キャラクターの話し方と価値観の急変を禁止する。",
      "局所事件とシリーズ大謎の接続を毎話1段階進める。",
      "伏線は3話以内に中間回収し、最終話で主回収する。",
    ]).slice(0, 8),
    mystery_profile: {
      case_core: caseCore,
      investigation_style: "観察と記録照合を軸に認識を更新する",
      emotional_tone: tone,
      duo_dynamic: duoDynamic,
      truth_nature: truthNature,
      visual_language:
        dedupeStrings(params.seed.fingerprint.motif_cluster)[0] || "土地の空気感を帯びた現実寄りミステリー",
      environment_layer: clean(params.seed.worldview_core) || "現実の外出先",
      differentiation_axes: dedupeStrings([
        clean(params.seed.worldview_core),
        clean(params.seed.central_relationship_dynamic),
        clean(params.seed.ending_flavor),
      ]).slice(0, 4),
      banned_templates_avoided: [],
    },
  };
};

const buildDetailedConceptFromSeed = async (params: {
  seed: WorkflowConceptSeed;
  request: z.infer<typeof resolvedSeriesRequestSchema>;
  preferenceSheet: WorkflowPreferenceSheet;
  antiBrief: WorkflowAntiBrief;
}): Promise<z.infer<typeof seriesConceptAgentOutputSchema>> => {
  const interview = {
    ...params.request.interview,
    genre_world:
      clean(params.seed.worldview_core) ||
      clean(params.request.interview.genre_world) ||
      "現代日本の現実的な外出先",
    desired_emotion:
      dedupeStrings([
        params.seed.emotional_core,
        ...params.preferenceSheet.emotional_rewards,
        params.request.interview.desired_emotion,
      ]).join(" / ") || "余韻と高揚",
    companion_preference:
      dedupeStrings([
        params.seed.central_relationship_dynamic,
        ...params.preferenceSheet.desired_relationship_dynamics,
        params.request.interview.companion_preference,
      ]).join(" / ") || "信頼できる相棒",
    continuation_trigger:
      clean(params.request.interview.continuation_trigger) ||
      params.preferenceSheet.continuation_needs[0] ||
      clean(params.seed.return_reason),
    avoidance_preferences: dedupeStrings([
      params.request.interview.avoidance_preferences,
      ...params.antiBrief.banned_cliches,
      ...params.antiBrief.banned_generic_patterns,
    ]).join(" / "),
    additional_notes: dedupeStrings([
      clean(params.request.interview.additional_notes),
      `seed_title:${params.seed.title}`,
      `generation_angle:${params.seed.generation_angle}`,
      `ending_flavor:${params.seed.ending_flavor}`,
      `uniqueness:${params.seed.uniqueness_claims.join(" / ")}`,
    ]).join(" / "),
  };

  const prompt = dedupeStrings([
    params.request.prompt,
    `seed_id=${params.seed.seed_id}`,
    `seed_hook=${params.seed.one_line_hook}`,
    `seed_premise=${params.seed.premise}`,
    `seed_return_reason=${params.seed.return_reason}`,
    `seed_fingerprint=${buildSeedFingerprintKey(params.seed)}`,
    `avoid=${params.antiBrief.banned_generic_patterns.join(" / ")}`,
  ]).join("\n");

  try {
    const generated = await generateSeriesConcept({
      interview,
      prompt,
      desiredEpisodeCount: params.request.desired_episode_count,
      language: params.request.language,
      recent_generation_context: params.request.recent_generation_context,
    });
    return {
      ...generated,
      title: clean(generated.title) || clean(params.seed.title) || generated.title,
      premise: clean(generated.premise) || clean(params.seed.premise) || generated.premise,
      overview: clean(generated.overview) || clean(params.seed.one_line_hook) || generated.overview,
      season_goal: clean(generated.season_goal) || clean(params.seed.return_reason) || generated.season_goal,
      ai_rule_points: dedupeStrings([
        ...generated.ai_rule_points,
        "固定キャラのmust-never-breakを最優先する。",
      ]).slice(0, 12),
    };
  } catch {
    return buildFallbackConceptFromSeed({
      seed: params.seed,
      request: params.request,
    });
  }
};

type QualityCandidateMaterial = {
  candidateId: string;
  seed: WorkflowConceptSeed;
  concept: z.infer<typeof seriesConceptAgentOutputSchema>;
  richCharacters: WorkflowRichCharacterSheet[];
  characters: WorkflowCharacter[];
  identityPack: WorkflowIdentityPack;
  checkpoints: z.infer<typeof seriesCheckpointSchema>[];
  firstEpisodeSeed: z.infer<typeof seriesEpisodeSeedSchema>;
  firstEpisodeSeedEval: WorkflowFirstEpisodeSeedEval;
  seedRouteDryRun: z.infer<typeof seedRouteDryRunSchema>;
  textJudge: {
    score: WorkflowTextJudgeScore;
    reject: boolean;
    rejectReasons: string[];
  };
};

const evaluateSeedNovelty = (seed: WorkflowConceptSeed, preferenceSheet: WorkflowPreferenceSheet) => {
  const uniqueness = Math.min(1, (seed.uniqueness_claims.length || 0) / 4);
  const relationFit = preferenceSheet.desired_relationship_dynamics.some((dynamic) =>
    clean(seed.central_relationship_dynamic).includes(clean(dynamic))
  )
    ? 0.85
    : 0.55;
  const continuationFit = preferenceSheet.continuation_needs.some((need) =>
    clean(seed.return_reason + " " + seed.premise).includes(clean(need))
  )
    ? 0.85
    : 0.55;
  return uniqueness * 0.45 + relationFit * 0.25 + continuationFit * 0.3;
};

const weightedScore = (score: WorkflowTextJudgeScore, rubric: WorkflowUserRubric) =>
  score.intent_fit * rubric.intent_fit_weights.intent_fit +
  score.emotional_reward_fit * rubric.intent_fit_weights.emotional_reward_fit +
  score.relationship_fit * rubric.intent_fit_weights.relationship_fit +
  score.world_originality * rubric.intent_fit_weights.world_originality +
  score.character_vividness * rubric.intent_fit_weights.character_vividness +
  score.return_desire * rubric.intent_fit_weights.return_desire -
  score.clone_penalty * rubric.intent_fit_weights.clone_penalty;

const buildExpandedSeedVariant = (
  seed: WorkflowConceptSeed,
  variantIndex: number
): WorkflowConceptSeed => ({
  ...seed,
  seed_id: `${seed.seed_id}_v${variantIndex}`,
  title: `${seed.title}・変奏${variantIndex}`,
  one_line_hook: `${seed.one_line_hook}（変奏${variantIndex}）`,
  uniqueness_claims: dedupeStrings([...seed.uniqueness_claims, `variant-${variantIndex}の差分導線`]).slice(0, 6),
});

const dedupeConceptSeedsByFingerprint = async (seeds: WorkflowConceptSeed[]) => {
  const fingerprintSeen = new Set<string>();
  const deduped: WorkflowConceptSeed[] = [];
  const removed: Array<{ seedId: string; reason: string }> = [];

  for (const seed of seeds) {
    const fingerprintKey = buildSeedFingerprintKey(seed);
    if (fingerprintSeen.has(fingerprintKey)) {
      removed.push({ seedId: seed.seed_id, reason: "fingerprint_exact_duplicate" });
      continue;
    }
    let semanticallyDuplicate = false;
    for (const kept of deduped) {
      const judged = await judgeSeriesSeedSemanticSimilarity({
        left: kept,
        right: seed,
      });
      if (judged.similar && judged.confidence >= 0.72) {
        semanticallyDuplicate = true;
        removed.push({
          seedId: seed.seed_id,
          reason: `semantic_duplicate:${kept.seed_id}:${judged.confidence.toFixed(2)}`,
        });
        break;
      }
    }
    if (semanticallyDuplicate) continue;
    fingerprintSeen.add(fingerprintKey);
    deduped.push(seed);
  }

  return {
    deduped,
    removed,
  };
};

const runQualityWorkflowWithProgress = async (
  rawInput: z.infer<typeof seriesGenerationRequestSchema>,
  options: {
    onProgress?: SeriesGenerationProgressReporter;
  } = {}
): Promise<z.infer<typeof seriesWorkflowOutputSchema>> => {
  const onProgress = options.onProgress;

  await emitSeriesGenerationProgress(onProgress, {
    phase: "sanitize_series_request_start",
    detail: "入力情報を正規化しています",
  });
  const parsedIdentityPack = rawInput.existing_identity_pack
    ? seriesIdentityPackSchema.safeParse(rawInput.existing_identity_pack)
    : null;
  const request: z.infer<typeof resolvedSeriesRequestSchema> = {
    desired_episode_count: rawInput.desired_episode_count ?? 8,
    prompt: clean(rawInput.prompt),
    language: clean(rawInput.language) || "ja",
    generation_mode: rawInput.generation_mode === "proposal" ? "proposal" : "full",
    creator_id: rawInput.creator_id,
    existing_identity_pack: parsedIdentityPack?.success ? parsedIdentityPack.data : undefined,
    identity_retcon: Boolean(rawInput.identity_retcon),
    recent_generation_context: rawInput.recent_generation_context,
    interview: {
      genre_world: clean(rawInput.interview.genre_world),
      desired_emotion: clean(rawInput.interview.desired_emotion),
      companion_preference: clean(rawInput.interview.companion_preference),
      continuation_trigger: clean(rawInput.interview.continuation_trigger),
      avoidance_preferences: clean(rawInput.interview.avoidance_preferences),
      additional_notes: clean(rawInput.interview.additional_notes),
      visual_style_preset: clean(rawInput.interview.visual_style_preset),
      visual_style_notes: clean(rawInput.interview.visual_style_notes),
      main_objective: clean(rawInput.interview.main_objective),
      protagonist_position: clean(rawInput.interview.protagonist_position),
      partner_description: clean(rawInput.interview.partner_description),
    },
  };
  await emitSeriesGenerationProgress(onProgress, {
    phase: "sanitize_series_request_done",
    detail: "入力情報の正規化が完了しました",
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "build_series_intent_bundle_start",
    detail: "ユーザー意図を構造化しています",
  });
  const intentBundle = await generateSeriesPreferenceBundle({
    interview: request.interview,
    prompt: request.prompt,
    desired_episode_count: request.desired_episode_count,
    language: request.language,
  });
  await emitSeriesGenerationProgress(onProgress, {
    phase: "build_series_intent_bundle_done",
    detail: "意図解釈（preference / anti brief / rubric）が完了しました",
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "generate_series_concept_seeds_start",
    detail: "シリーズ候補seedを多角的に生成しています",
  });
  const conceptSeeds = await generateSeriesConceptSeeds({
    prompt: request.prompt,
    desired_episode_count: request.desired_episode_count,
    preference_sheet: intentBundle.preference_sheet,
    anti_brief: intentBundle.anti_brief,
    user_rubric: intentBundle.user_rubric,
    desired_seed_count: QUALITY_SEED_TARGET,
    language: request.language,
  });
  await emitSeriesGenerationProgress(onProgress, {
    phase: "generate_series_concept_seeds_done",
    detail: `seed生成が完了しました（${conceptSeeds.length}案）`,
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "dedupe_series_concept_seeds_start",
    detail: "seedの意味重複を除去しています",
  });
  const dedupeResult = await dedupeConceptSeedsByFingerprint(conceptSeeds);
  let dedupedSeeds = dedupeResult.deduped.slice();
  let variantIndex = 1;
  while (dedupedSeeds.length < QUALITY_EXPAND_TARGET) {
    const source = conceptSeeds[dedupedSeeds.length % conceptSeeds.length];
    if (!source) break;
    dedupedSeeds.push(buildExpandedSeedVariant(source, variantIndex));
    variantIndex += 1;
  }
  await emitSeriesGenerationProgress(onProgress, {
    phase: "dedupe_series_concept_seeds_done",
    detail: `重複排除後 ${dedupedSeeds.length}案（除外 ${dedupeResult.removed.length}案）`,
  });

  const expansionSeeds = dedupedSeeds
    .slice()
    .sort(
      (a, b) =>
        evaluateSeedNovelty(b, intentBundle.preference_sheet) -
        evaluateSeedNovelty(a, intentBundle.preference_sheet)
    )
    .slice(0, QUALITY_EXPAND_TARGET);

  await emitSeriesGenerationProgress(onProgress, {
    phase: "expand_series_candidates_start",
    detail: `上位${expansionSeeds.length}案を詳細化しています`,
  });

  const expandedCandidates: QualityCandidateMaterial[] = [];
  for (let index = 0; index < expansionSeeds.length; index += 1) {
    const seed = expansionSeeds[index];
    await emitSeriesGenerationProgress(onProgress, {
      phase: "generate_series_concept_start",
      detail: `候補${index + 1}/${expansionSeeds.length} コンセプト詳細化`,
    });
    const concept = await buildDetailedConceptFromSeed({
      seed,
      request,
      preferenceSheet: intentBundle.preference_sheet,
      antiBrief: intentBundle.anti_brief,
    });
    await emitSeriesGenerationProgress(onProgress, {
      phase: "generate_series_concept_done",
      detail: `${concept.title} の詳細化が完了`,
    });

    const targetCount = Math.max(3, Math.min(5, Math.ceil(request.desired_episode_count / 2)));
    const styleGuide = buildSeriesVisualStyleGuide({
      seriesTitle: concept.title,
      genre: concept.genre,
      tone: concept.tone,
      setting: concept.world.setting,
      recurringMotifs: concept.world.recurring_motifs,
      stylePreset: request.interview.visual_style_preset,
      styleDirection: request.interview.visual_style_notes,
    });

    await emitSeriesGenerationProgress(onProgress, {
      phase: "generate_series_characters_start",
      detail: `${concept.title} の固定キャラクターを設計しています`,
    });
    const richCharacterResult = await generateSeriesRichCharacters({
      title: concept.title,
      genre: concept.genre,
      tone: concept.tone,
      premise: concept.premise,
      season_goal: concept.season_goal,
      protagonist_position: "シリーズ内で独立して行動する主人公（ユーザー本人ではない）",
      partner_description:
        clean(request.interview.companion_preference) ||
        clean(request.interview.partner_description) ||
        "信頼できる相棒",
      style_guide: styleGuide,
      target_count: targetCount,
      concept_seed: seed,
      preference_sheet: intentBundle.preference_sheet,
    });
    await emitSeriesGenerationProgress(onProgress, {
      phase: "generate_series_characters_done",
      detail: `${concept.title} のキャラクター詳細化が完了（${richCharacterResult.characters.length}人）`,
    });

    await emitSeriesGenerationProgress(onProgress, {
      phase: "build_series_identity_pack_start",
      detail: `${concept.title} のidentity packを固定しています`,
    });
    const identity = buildSeriesIdentityPack({
      characters: richCharacterResult.characters,
      styleGuide: clean(request.existing_identity_pack?.style_bible) || styleGuide,
      existingIdentityPack: request.existing_identity_pack,
      identityRetcon: request.identity_retcon,
    });
    await emitSeriesGenerationProgress(onProgress, {
      phase: "build_series_identity_pack_done",
      detail: `identity pack固定完了（key=${identity.identityPack.key_person_character_ids.join(",")})`,
    });

    await emitSeriesGenerationProgress(onProgress, {
      phase: "generate_series_checkpoints_start",
      detail: `${concept.title} のcheckpointを生成しています`,
    });
    const checkpointResult = await generateSeriesCheckpoints({
      title: concept.title,
      premise: concept.premise,
      season_goal: concept.season_goal,
      genre: concept.genre,
      tone: concept.tone,
      world: concept.world,
      characters: identity.characters,
      desired_episode_count: request.desired_episode_count,
      preference_sheet: intentBundle.preference_sheet,
      continuation_trigger: request.interview.continuation_trigger,
    });
    await emitSeriesGenerationProgress(onProgress, {
      phase: "generate_series_checkpoints_done",
      detail: `${concept.title} のcheckpoint生成完了（${checkpointResult.checkpoints.length}件）`,
    });

    await emitSeriesGenerationProgress(onProgress, {
      phase: "generate_first_episode_seed_start",
      detail: `${concept.title} の第1話seedを生成しています`,
    });
    const firstSeedResult = await generateFirstEpisodeSeed({
      title: concept.title,
      genre: concept.genre,
      tone: concept.tone,
      premise: concept.premise,
      season_goal: concept.season_goal,
      world: concept.world,
      characters: identity.characters,
      checkpoints: checkpointResult.checkpoints,
      preference_sheet: intentBundle.preference_sheet,
      continuation_trigger: request.interview.continuation_trigger,
    });
    await emitSeriesGenerationProgress(onProgress, {
      phase: "generate_first_episode_seed_done",
      detail: `${concept.title} の第1話seed生成完了`,
    });

    await emitSeriesGenerationProgress(onProgress, {
      phase: "evaluate_first_episode_seed_start",
      detail: `${concept.title} の第1話seedを評価しています`,
    });
    const firstSeedEvalResult = await evaluateFirstEpisodeSeed({
      first_episode_seed: firstSeedResult.first_episode_seed,
      preference_sheet: intentBundle.preference_sheet,
      user_rubric: intentBundle.user_rubric,
      continuation_trigger: request.interview.continuation_trigger,
    });
    await emitSeriesGenerationProgress(onProgress, {
      phase: "evaluate_first_episode_seed_done",
      detail: `${concept.title} の第1話seed評価完了(pass=${firstSeedEvalResult.evaluation.pass})`,
    });

    await emitSeriesGenerationProgress(onProgress, {
      phase: "seed_route_dry_run_start",
      detail: `${concept.title} のseed導線ドライランを実施しています`,
    });
    const seedDryRun = await runSeedRouteDryRunForSeed({
      concept,
      request,
      firstEpisodeSeed: firstSeedResult.first_episode_seed,
    });
    await emitSeriesGenerationProgress(onProgress, {
      phase: "seed_route_dry_run_done",
      detail: seedDryRun.feasible
        ? `${concept.title} seed導線成立`
        : `${concept.title} seed導線は要改善`,
    });

    const candidateId = `candidate_${index + 1}_${seed.seed_id}`;
    const textCandidate = seriesTextJudgeCandidateSchema.parse({
      candidate_id: candidateId,
      seed,
      title: concept.title,
      overview: concept.overview,
      premise: concept.premise,
      season_goal: concept.season_goal,
      characters: identity.characters,
      checkpoints: checkpointResult.checkpoints,
      first_episode_seed: firstSeedResult.first_episode_seed,
    });

    const textJudgeResult = QUALITY_TEXT_JUDGE_ENABLED
      ? await evaluateSeriesTextCandidate({
        preference_sheet: intentBundle.preference_sheet,
        anti_brief: intentBundle.anti_brief,
        user_rubric: intentBundle.user_rubric,
        candidate: textCandidate,
      })
      : {
        candidate_id: candidateId,
        score: {
          intent_fit: 0.7,
          emotional_reward_fit: 0.7,
          relationship_fit: 0.7,
          world_originality: 0.7,
          character_vividness: 0.7,
          return_desire: 0.7,
          clone_penalty: 0.3,
          rationale: "text judge disabled",
        } satisfies WorkflowTextJudgeScore,
        reject: false,
        reject_reasons: [],
      };

    expandedCandidates.push({
      candidateId,
      seed,
      concept,
      richCharacters: richCharacterResult.rich_characters,
      characters: identity.characters,
      identityPack: identity.identityPack,
      checkpoints: checkpointResult.checkpoints,
      firstEpisodeSeed: firstSeedResult.first_episode_seed,
      firstEpisodeSeedEval: firstSeedEvalResult.evaluation,
      seedRouteDryRun: seedDryRun,
      textJudge: {
        score: textJudgeResult.score,
        reject: textJudgeResult.reject,
        rejectReasons: textJudgeResult.reject_reasons,
      },
    });
  }

  await emitSeriesGenerationProgress(onProgress, {
    phase: "expand_series_candidates_done",
    detail: `候補詳細化が完了（${expandedCandidates.length}案）`,
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "judge_series_candidates_start",
    detail: "候補の本文評価とrerankを実行しています",
  });

  const pairwiseWins = new Map<string, number>();
  for (const candidate of expandedCandidates) {
    pairwiseWins.set(candidate.candidateId, 0);
  }
  if (QUALITY_TEXT_JUDGE_ENABLED && expandedCandidates.length >= 2) {
    for (let i = 0; i < expandedCandidates.length; i += 1) {
      for (let j = i + 1; j < expandedCandidates.length; j += 1) {
        const left = expandedCandidates[i];
        const right = expandedCandidates[j];
        const outcome = await compareSeriesTextCandidatesPairwise(
          {
            preference_sheet: intentBundle.preference_sheet,
            anti_brief: intentBundle.anti_brief,
            user_rubric: intentBundle.user_rubric,
            left: seriesTextJudgeCandidateSchema.parse({
              candidate_id: left.candidateId,
              seed: left.seed,
              title: left.concept.title,
              overview: left.concept.overview,
              premise: left.concept.premise,
              season_goal: left.concept.season_goal,
              characters: left.characters,
              checkpoints: left.checkpoints,
              first_episode_seed: left.firstEpisodeSeed,
            }),
            right: seriesTextJudgeCandidateSchema.parse({
              candidate_id: right.candidateId,
              seed: right.seed,
              title: right.concept.title,
              overview: right.concept.overview,
              premise: right.concept.premise,
              season_goal: right.concept.season_goal,
              characters: right.characters,
              checkpoints: right.checkpoints,
              first_episode_seed: right.firstEpisodeSeed,
            }),
          },
          left.textJudge.score,
          right.textJudge.score
        );
        pairwiseWins.set(
          outcome.winner_candidate_id,
          (pairwiseWins.get(outcome.winner_candidate_id) || 0) + 1
        );
      }
    }
  }

  const ranked = expandedCandidates
    .map((candidate) => {
      const base = weightedScore(candidate.textJudge.score, intentBundle.user_rubric);
      const pairwiseBonus =
        expandedCandidates.length > 1
          ? (pairwiseWins.get(candidate.candidateId) || 0) /
          Math.max(1, expandedCandidates.length - 1) *
          0.12
          : 0;
      const seedEvalBonus =
        candidate.firstEpisodeSeedEval.pass
          ? 0.08
          : -0.08 + (candidate.firstEpisodeSeedEval.walkability_fit - 0.5) * 0.04;
      const rejectPenalty = candidate.textJudge.reject ? 0.22 : 0;
      const finalScore = base + pairwiseBonus + seedEvalBonus - rejectPenalty;
      const reject =
        candidate.textJudge.reject ||
        !candidate.firstEpisodeSeedEval.pass ||
        candidate.textJudge.score.clone_penalty >= 0.82;
      const rejectReasons = dedupeStrings([
        ...candidate.textJudge.rejectReasons,
        !candidate.firstEpisodeSeedEval.pass ? "first_episode_seed_eval_failed" : "",
        candidate.textJudge.score.clone_penalty >= 0.82 ? "clone_penalty_high" : "",
      ]);
      return {
        candidate,
        finalScore,
        reject,
        rejectReasons,
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore);

  const selectedRanked = ranked.find((row) => !row.reject) || ranked[0];
  if (!selectedRanked) {
    throw new Error("quality_pipeline_no_candidate");
  }

  await emitSeriesGenerationProgress(onProgress, {
    phase: "judge_series_candidates_done",
    detail: `候補評価完了。採用候補=${selectedRanked.candidate.concept.title}`,
  });

  const additionalWarnings = dedupeStrings([
    "quality_pipeline_enabled",
    `quality_seed_generated:${conceptSeeds.length}`,
    `quality_seed_after_dedupe:${dedupedSeeds.length}`,
    `quality_candidate_expanded:${expandedCandidates.length}`,
    `quality_candidate_selected:${selectedRanked.candidate.candidateId}`,
    ...ranked
      .filter((row) => row.reject)
      .map((row) => `quality_candidate_rejected:${row.candidate.candidateId}:${row.rejectReasons.join("|")}`),
  ]);

  if (QUALITY_DEBUG_TRACE) {
    console.log(
      `${LOG_PREFIX} quality_trace ${JSON.stringify({
        preference_sheet: intentBundle.preference_sheet,
        anti_brief: intentBundle.anti_brief,
        user_rubric: intentBundle.user_rubric,
        generated_seed_ids: conceptSeeds.map((row) => row.seed_id),
        deduped_seed_ids: dedupedSeeds.map((row) => row.seed_id),
        removed_seed_entries: dedupeResult.removed,
        ranked_candidates: ranked.map((row) => ({
          candidate_id: row.candidate.candidateId,
          title: row.candidate.concept.title,
          final_score: Number(row.finalScore.toFixed(4)),
          reject: row.reject,
          reject_reasons: row.rejectReasons,
        })),
        selected_candidate: {
          candidate_id: selectedRanked.candidate.candidateId,
          title: selectedRanked.candidate.concept.title,
          final_score: Number(selectedRanked.finalScore.toFixed(4)),
        },
      })}`
    );
  }

  await emitSeriesGenerationProgress(onProgress, {
    phase: "finalize_series_blueprint_start",
    detail: "採用候補を最終統合しています",
  });

  const result = await assembleSeriesBlueprint({
    request,
    concept: selectedRanked.candidate.concept,
    characters: selectedRanked.candidate.characters,
    identityPack: selectedRanked.candidate.identityPack,
    checkpoints: selectedRanked.candidate.checkpoints,
    firstEpisodeSeed: selectedRanked.candidate.firstEpisodeSeed,
    seedRouteDryRun: selectedRanked.candidate.seedRouteDryRun,
    workflowVersion: "series-workflow-v8-quality-pipeline",
    additionalWarnings,
    onProgress,
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "finalize_series_blueprint_done",
    detail: "シリーズ設計の最終統合が完了しました",
  });

  return result.output;
};

export const generateSeriesWorkflowWithProgress = async (
  rawInput: z.infer<typeof seriesGenerationRequestSchema>,
  options: {
    onProgress?: SeriesGenerationProgressReporter;
  } = {}
): Promise<z.infer<typeof seriesWorkflowOutputSchema>> => {
  const onProgress = options.onProgress;

  if (isQualityWorkflowEnabled()) {
    try {
      return await runQualityWorkflowWithProgress(rawInput, options);
    } catch (error: any) {
      const message = clean(error?.message || String(error || "quality_pipeline_failed"));
      console.error(`${LOG_PREFIX} quality pipeline失敗:`, message);
      if (QUALITY_STRICT_MODE) {
        throw error;
      }
      console.warn(`${LOG_PREFIX} quality pipelineからlegacy pipelineへ段階フォールバック`);
    }
  }

  await emitSeriesGenerationProgress(onProgress, {
    phase: "sanitize_series_request_start",
    detail: "入力情報を正規化しています",
  });
  const parsedIdentityPack = rawInput.existing_identity_pack
    ? seriesIdentityPackSchema.safeParse(rawInput.existing_identity_pack)
    : null;
  const request: z.infer<typeof resolvedSeriesRequestSchema> = {
    desired_episode_count: rawInput.desired_episode_count ?? 8,
    prompt: clean(rawInput.prompt),
    language: clean(rawInput.language) || "ja",
    generation_mode: rawInput.generation_mode === "proposal" ? "proposal" : "full",
    creator_id: rawInput.creator_id,
    existing_identity_pack: parsedIdentityPack?.success ? parsedIdentityPack.data : undefined,
    identity_retcon: Boolean(rawInput.identity_retcon),
    recent_generation_context: rawInput.recent_generation_context,
    interview: {
      genre_world: clean(rawInput.interview.genre_world),
      desired_emotion: clean(rawInput.interview.desired_emotion),
      companion_preference: clean(rawInput.interview.companion_preference),
      continuation_trigger: clean(rawInput.interview.continuation_trigger),
      avoidance_preferences: clean(rawInput.interview.avoidance_preferences),
      additional_notes: clean(rawInput.interview.additional_notes),
      visual_style_preset: clean(rawInput.interview.visual_style_preset),
      visual_style_notes: clean(rawInput.interview.visual_style_notes),
      main_objective: clean(rawInput.interview.main_objective),
      protagonist_position: clean(rawInput.interview.protagonist_position),
      partner_description: clean(rawInput.interview.partner_description),
    },
  };
  await emitSeriesGenerationProgress(onProgress, {
    phase: "sanitize_series_request_done",
    detail: "入力情報の正規化が完了しました",
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "generate_series_concept_start",
    detail: "世界観と物語コンセプトを生成しています",
  });
  const concept = await generateSeriesConcept({
    interview: request.interview,
    prompt: request.prompt,
    desiredEpisodeCount: request.desired_episode_count,
    language: request.language,
    recent_generation_context: request.recent_generation_context,
  });
  await emitSeriesGenerationProgress(onProgress, {
    phase: "generate_series_concept_done",
    detail: `コンセプト生成が完了しました（${concept?.title || "タイトル未確定"}）`,
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "generate_series_characters_start",
    detail: "主要キャラクターを設計しています",
  });
      const targetCount = Math.max(3, Math.min(5, Math.ceil(request.desired_episode_count / 2)));
  const styleGuideForCharacters = buildSeriesVisualStyleGuide({
    seriesTitle: concept.title,
    genre: concept.genre,
    tone: concept.tone,
    setting: concept.world.setting,
    recurringMotifs: concept.world.recurring_motifs,
    stylePreset: request.interview.visual_style_preset,
    styleDirection: request.interview.visual_style_notes,
  });
  const characterResult = await generateSeriesCharacters({
    title: concept.title,
    genre: concept.genre,
    tone: concept.tone,
    premise: concept.premise,
    season_goal: concept.season_goal,
    protagonist_position: "シリーズ内で独立して行動する主人公（ユーザー本人ではない）",
    partner_description:
      clean(request.interview.companion_preference) ||
      clean(request.interview.partner_description) ||
      "信頼できる相棒",
    style_guide: styleGuideForCharacters,
    target_count: targetCount,
    mystery_profile: concept.mystery_profile,
    recent_generation_context: request.recent_generation_context,
  });
  const characters = characterResult.characters;
  await emitSeriesGenerationProgress(onProgress, {
    phase: "generate_series_characters_done",
    detail: `キャラクター生成が完了しました（${characters.length}人）`,
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "build_series_identity_pack_start",
    detail: "キーパーソン定義と同一性アンカーを固定しています",
  });
  const styleGuideForIdentity =
    clean(request.existing_identity_pack?.style_bible) ||
    buildSeriesVisualStyleGuide({
      seriesTitle: concept.title,
      genre: concept.genre,
      tone: concept.tone,
      setting: concept.world.setting,
      recurringMotifs: concept.world.recurring_motifs,
      dominantColors: collectDominantColors(characters),
      stylePreset: request.interview.visual_style_preset,
      styleDirection: request.interview.visual_style_notes,
    });
  const identity = buildSeriesIdentityPack({
    characters,
    styleGuide: styleGuideForIdentity,
    existingIdentityPack: request.existing_identity_pack,
    identityRetcon: request.identity_retcon,
  });
  await emitSeriesGenerationProgress(onProgress, {
    phase: "build_series_identity_pack_done",
    detail: `同一性アンカーの固定が完了しました（key: ${identity.identityPack.key_person_character_ids.join(",")})`,
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "generate_series_checkpoints_start",
    detail: "エピソード進行チェックポイントを設計しています",
  });
  const plan = await generateSeriesEpisodePlan({
    title: concept.title,
    premise: concept.premise,
    season_goal: concept.season_goal,
    genre: concept.genre,
    tone: concept.tone,
    world: concept.world,
    characters: identity.characters,
    desired_episode_count: request.desired_episode_count,
    mystery_profile: concept.mystery_profile,
    recent_generation_context: request.recent_generation_context,
  });
  const checkpoints = plan.checkpoints;
  const firstEpisodeSeed = plan.first_episode_seed;
  await emitSeriesGenerationProgress(onProgress, {
    phase: "generate_series_checkpoints_done",
    detail: `チェックポイント生成が完了しました（${checkpoints.length}件）`,
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "seed_route_dry_run_start",
    detail: "第1話seedの候補検索ドライランと適格性検証を行っています",
  });
  let seedRouteDryRun: z.infer<typeof seedRouteDryRunSchema>;
  try {
    const dryRun = await dryRunFirstEpisodeSeedRoute({
      stage_location:
        clean(concept.world.setting) || clean(request.interview.genre_world) || "現実の外出先",
      world_setting: clean(concept.world.setting),
      purpose: "シリーズ第1話導線の成立性検証",
      expected_duration_minutes: firstEpisodeSeed.expected_duration_minutes,
      suggested_spots: firstEpisodeSeed.suggested_spots || [],
      spot_requirements: firstEpisodeSeed.spot_requirements.map((requirement) => ({
        requirement_id: requirement.requirement_id,
        scene_role: requirement.scene_role,
        spot_role: requirement.spot_role,
        required_attributes: requirement.required_attributes,
        visit_constraints: requirement.visit_constraints,
        tourism_value_type: requirement.tourism_value_type,
      })),
    });
    seedRouteDryRun = {
      feasible: dryRun.feasible,
      selected_spots: dryRun.selected_spots.slice(0, 4),
      failure_reasons: dryRun.failure_reasons.slice(0, 20),
      route_metrics: {
        ...dryRun.route_metrics,
        failure_reasons: dryRun.route_metrics.failure_reasons.slice(0, 20),
        optimized_order_indices: dryRun.route_metrics.optimized_order_indices.slice(0, 6),
        optimized_order_spot_names: dryRun.route_metrics.optimized_order_spot_names.slice(0, 6),
      },
      route_score: dryRun.route_score,
      continuity_score: dryRun.continuity_score,
    };
  } catch (error: any) {
    const reason = clean(error?.message || String(error || "seed_route_dry_run_failed"));
    seedRouteDryRun = {
      feasible: false,
      selected_spots: [],
      failure_reasons: [reason || "seed_route_dry_run_failed"],
      route_metrics: {
        optimizer: "seed_dry_run_unavailable",
        total_estimated_walk_minutes: 0,
        transfer_minutes: 0,
        max_leg_minutes: 0,
        max_total_walk_minutes: 0,
        feasible: false,
        failure_reasons: [reason || "seed_route_dry_run_failed"],
        optimized_order_indices: [],
        optimized_order_spot_names: [],
      },
      route_score: 0,
      continuity_score: 0,
    };
  }
  await emitSeriesGenerationProgress(onProgress, {
    phase: "seed_route_dry_run_done",
    detail: seedRouteDryRun.feasible
      ? `seed導線の成立性を確認しました（候補${seedRouteDryRun.selected_spots.length}件）`
      : "seed導線の成立性確認で要改善ポイントを検出しました",
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "finalize_series_blueprint_start",
    detail: "整合性チェックと最終統合を実施しています",
  });

  const result = await assembleSeriesBlueprint({
    request,
    concept,
    characters: identity.characters,
    identityPack: identity.identityPack,
    checkpoints,
    firstEpisodeSeed,
    seedRouteDryRun,
    workflowVersion: "series-workflow-v9-single-path",
    onProgress,
  });

  await emitSeriesGenerationProgress(onProgress, {
    phase: "finalize_series_blueprint_done",
    detail: "シリーズ設計の最終統合が完了しました",
  });

  return result.output;
};

export type SeriesWorkflowInput = z.infer<typeof seriesGenerationRequestSchema>;
export type SeriesWorkflowOutput = z.infer<typeof seriesWorkflowOutputSchema>;
