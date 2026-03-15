import React, {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { RootStackParamList } from "@/navigation/types";
import { fonts } from "@/theme/fonts";
import {
  fetchGameplayQuest,
  type GameplayCharacter,
  type GameplayMessage,
  type GameplayQuest,
  type GameplaySpot,
} from "@/services/gameplay";

type Props = NativeStackScreenProps<RootStackParamList, "GamePlay">;

type Mode =
  | "location_gate"
  | "opening_prologue"
  | "prologue"
  | "travel"
  | "story_pre"
  | "puzzle"
  | "story_post"
  | "epilogue"
  | "completed";

type PrologueNextMode = "travel" | "story_pre";

type PuzzleState = "idle" | "incorrect" | "correct" | "revealedAnswer";

type LocationStatus = "locationUnavailable" | "tooFar" | "nearTarget";
type JourneyRank = "S" | "A" | "B" | "C";

type PuzzleChoice = {
  id: string;
  label: string;
  text: string;
};

type DialogueLine = {
  id: string;
  speakerType: "narrator" | "character" | "system";
  name?: string | null;
  avatarUrl?: string | null;
  text: string;
};

type DialogueCharacter = {
  id: string;
  name: string;
  role?: string | null;
  avatarUrl?: string | null;
};

const GOOGLE_MAPS_WEB_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY ??
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ??
  "";
const DEFAULT_CENTER = { lat: 35.681236, lng: 139.767125 };
const NEAR_THRESHOLD_M = 120;
const CHOICE_LINE_PATTERN = /^\s*([A-Za-zＡ-Ｚａ-ｚ0-9０-９])[\.．:：\)）]\s*(.+)$/;
const AUTO_CHOICE_LABELS = ["A", "B", "C", "D"] as const;
const DIALOGUE_CHUNK_MAX_CHARS = 66;
const DIALOGUE_CHUNK_MAX_LINES = 3;
const DIALOGUE_CHARS_PER_LINE_ESTIMATE = 22;
const OPENING_PROLOGUE_AUTO_ADVANCE_MS = 1800;

const FRONTEND_DEMO_IMAGES = [
  "https://images.unsplash.com/photo-1758535540741-de84a7c8ce9a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080",
  "https://images.unsplash.com/photo-1734313237450-d216cd6f5fb2?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080",
  "https://images.unsplash.com/photo-1688616128916-9c4f4a612e33?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080",
  "https://images.unsplash.com/photo-1766050472601-5ccb9fbc13e9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080",
] as const;

let googleMapsJsLoader: Promise<void> | null = null;

const normalizeText = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();

const splitToNarrationLines = (raw?: string | null): string[] => {
  const normalized = normalizeText(raw);
  if (!normalized) return [];
  return splitDialogueText(normalized, DIALOGUE_CHUNK_MAX_CHARS);
};

const normalizeChoiceLabel = (value: string) =>
  value
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .toUpperCase();

const parsePuzzleQuestion = (questionText?: string | null) => {
  const normalized = (questionText || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  if (!normalized) return { prompt: "", choices: [] as PuzzleChoice[] };

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return { prompt: normalized, choices: [] as PuzzleChoice[] };

  const firstChoiceIndex = lines.findIndex((line) => CHOICE_LINE_PATTERN.test(line));
  if (firstChoiceIndex < 0) return { prompt: normalized, choices: [] as PuzzleChoice[] };

  const candidateChoiceLines = lines.slice(firstChoiceIndex);
  if (
    candidateChoiceLines.length < 2 ||
    !candidateChoiceLines.every((line) => CHOICE_LINE_PATTERN.test(line))
  ) {
    return { prompt: normalized, choices: [] as PuzzleChoice[] };
  }

  const prompt = lines.slice(0, firstChoiceIndex).join("\n").trim() || normalized;
  const choices = candidateChoiceLines
    .map((line, index) => {
      const match = line.match(CHOICE_LINE_PATTERN);
      if (!match) return null;
      return {
        id: `choice-${index}`,
        label: normalizeChoiceLabel(match[1]),
        text: match[2].trim(),
      } satisfies PuzzleChoice;
    })
    .filter((choice): choice is PuzzleChoice => Boolean(choice));

  return { prompt, choices };
};

const nextAlphaChar = (char: string, delta: number) => {
  const lower = char.toLowerCase();
  if (lower < "a" || lower > "z") return char;
  const start = "a".charCodeAt(0);
  const code = lower.charCodeAt(0) - start;
  const nextCode = (code + delta + 26) % 26;
  const next = String.fromCharCode(start + nextCode);
  return char === lower ? next : next.toUpperCase();
};

const nextDigitChar = (char: string, delta: number) => {
  if (char < "0" || char > "9") return char;
  const code = Number(char);
  return String((code + delta + 10) % 10);
};

const mutateToken = (value: string, salt: number): string => {
  if (!value) return value;
  const chars = value.split("");
  const idx = Math.abs(salt) % chars.length;
  const ch = chars[idx];

  if (/[a-z]/i.test(ch)) {
    chars[idx] = nextAlphaChar(ch, (Math.abs(salt) % 5) + 1);
    return chars.join("");
  }

  if (/[0-9]/.test(ch)) {
    chars[idx] = nextDigitChar(ch, (Math.abs(salt) % 3) + 1);
    return chars.join("");
  }

  const hiraganaStart = 0x3041;
  const hiraganaEnd = 0x3096;
  const code = ch.charCodeAt(0);
  if (code >= hiraganaStart && code <= hiraganaEnd) {
    const span = hiraganaEnd - hiraganaStart + 1;
    const nextCode =
      hiraganaStart + ((code - hiraganaStart + (Math.abs(salt) % 7) + 1) % span);
    chars[idx] = String.fromCharCode(nextCode);
    return chars.join("");
  }

  chars[idx] = "x";
  return chars.join("");
};

const isAsciiWord = (value: string) => /^[a-z0-9]+$/i.test(value);

const normalizeAnswer = (value?: string | null) => {
  let text = (value || "").toString().trim().toLowerCase();
  text = text.replace(/[\s　]+/g, "");
  text = text.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  text = text.replace(/[。、．，！？!?,\.・ー−\-]/g, "");
  text = text.normalize("NFKC");
  return text;
};

const toHiragana = (value: string) =>
  value.replace(/[\u30A1-\u30F6]/g, (m) => String.fromCharCode(m.charCodeAt(0) - 0x60));

const normalizeLooseAnswer = (value?: string | null) =>
  toHiragana(normalizeAnswer(value))
    .replace(/[のがをはにへでと]/g, "")
    .replace(/(こと|もの|です|でした|だ)$/g, "")
    .trim();

const checkAnswer = (userInput: string, correctAnswer: string): boolean => {
  const userNorm = normalizeAnswer(userInput);
  const correctNorm = normalizeAnswer(correctAnswer);

  if (!userNorm || !correctNorm) return false;
  if (userNorm === correctNorm) return true;
  if (toHiragana(userNorm) === toHiragana(correctNorm)) return true;

  const userLoose = normalizeLooseAnswer(userInput);
  const correctLoose = normalizeLooseAnswer(correctAnswer);
  if (userLoose && userLoose === correctLoose) return true;

  if (userLoose.length >= 3 && correctLoose.length >= 3) {
    if (
      (userLoose.includes(correctLoose) || correctLoose.includes(userLoose)) &&
      Math.abs(userLoose.length - correctLoose.length) <= 2
    ) {
      return true;
    }
  }

  return false;
};

const isChoiceAnswerMatch = (choice: PuzzleChoice, correctAnswer: string) => {
  const answerNorm = normalizeAnswer(correctAnswer || "");
  if (!answerNorm) return false;

  const labelNorm = normalizeAnswer(choice.label);
  const textNorm = normalizeAnswer(choice.text);
  if (answerNorm === labelNorm || answerNorm === textNorm) return true;

  if (answerNorm.length >= 3 && textNorm.length >= 3) {
    if (answerNorm.includes(textNorm) || textNorm.includes(answerNorm)) return true;
  }

  const answerLoose = normalizeLooseAnswer(correctAnswer || "");
  const textLoose = normalizeLooseAnswer(choice.text);
  if (answerLoose && textLoose && answerLoose === textLoose) return true;

  return checkAnswer(choice.text, correctAnswer);
};

const findCorrectChoice = (choices: PuzzleChoice[], correctAnswer?: string | null) => {
  if (!correctAnswer) return null;
  return choices.find((choice) => isChoiceAnswerMatch(choice, correctAnswer)) || null;
};

const createAutoChoices = (
  answerRaw?: string | null,
  questionRaw?: string | null,
  hints: string[] = []
): PuzzleChoice[] => {
  const answer = normalizeText(answerRaw);
  if (!answer) return [];

  const candidateDistractors = new Set<string>();
  const seeds = [
    mutateToken(answer, 1),
    mutateToken(answer, 3),
    mutateToken(answer, 7),
    answer.length > 2 ? answer.slice(0, -1) : "",
    answer.length > 2 ? answer.slice(1) : "",
    answer.length > 1 ? answer.split("").reverse().join("") : "",
  ];

  seeds.forEach((candidate) => {
    const next = normalizeText(candidate);
    if (!next) return;
    if (normalizeAnswer(next) === normalizeAnswer(answer)) return;
    if (checkAnswer(next, answer) || checkAnswer(answer, next)) return;
    candidateDistractors.add(next);
  });

  hints.forEach((hint) => {
    const compact = normalizeText(hint)
      .replace(/^ヒント\d*[:：]?\s*/i, "")
      .replace(/[「」『』"']/g, "");
    if (!compact) return;
    if (compact.length > 16) return;
    if (normalizeAnswer(compact) === normalizeAnswer(answer)) return;
    if (checkAnswer(compact, answer) || checkAnswer(answer, compact)) return;
    candidateDistractors.add(compact);
  });

  const fallbackDistractors = isAsciiWord(answer)
    ? ["memory", "history", "signal", "archive", "legend", "harbor"]
    : ["ひかり", "きぼう", "こたえ", "しんじつ", "きせき", "たび"];

  fallbackDistractors.forEach((candidate) => {
    if (candidateDistractors.size >= 8) return;
    if (normalizeAnswer(candidate) === normalizeAnswer(answer)) return;
    if (checkAnswer(candidate, answer) || checkAnswer(answer, candidate)) return;
    candidateDistractors.add(candidate);
  });

  const distractors = Array.from(candidateDistractors).slice(0, 3);
  if (distractors.length < 3) {
    const filler = isAsciiWord(answer)
      ? ["route", "secret", "clue", "origin"]
      : ["しるし", "おもい", "なぞ", "きろく"];
    filler.forEach((candidate) => {
      if (distractors.length >= 3) return;
      if (normalizeAnswer(candidate) === normalizeAnswer(answer)) return;
      if (checkAnswer(candidate, answer) || checkAnswer(answer, candidate)) return;
      if (!distractors.includes(candidate)) distractors.push(candidate);
    });
  }

  const baseOptions = [answer, ...distractors.slice(0, 3)];
  const seedText = `${normalizeText(questionRaw)}|${normalizeAnswer(answer)}`;
  const seed = seedText
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const sorted = [...baseOptions].sort((a, b) => {
    const scoreA = (a.length * 17 + seed) % 97;
    const scoreB = (b.length * 17 + seed) % 97;
    return scoreA - scoreB;
  });

  return sorted.slice(0, 4).map((text, index) => ({
    id: `auto-choice-${index}`,
    label: AUTO_CHOICE_LABELS[index] || String(index + 1),
    text,
  }));
};

const splitDialogueText = (raw: string, maxChars = DIALOGUE_CHUNK_MAX_CHARS): string[] => {
  const normalized = normalizeText(raw);
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const sentenceUnits = normalized
    .split(/(?<=[。！？!?])/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const baseUnits = sentenceUnits.length > 1 ? sentenceUnits : [normalized];

  const minSplitIndex = Math.floor(maxChars * 0.35);
  const softWrapUnit = (unit: string): string[] => {
    if (unit.length <= maxChars) return [unit];
    const wrapped: string[] = [];
    let rest = unit;
    while (rest.length > maxChars) {
      const preview = rest.slice(0, maxChars);
      const punctIndex = Math.max(
        preview.lastIndexOf("。"),
        preview.lastIndexOf("、"),
        preview.lastIndexOf("！"),
        preview.lastIndexOf("？"),
        preview.lastIndexOf(" "),
        preview.lastIndexOf("."),
        preview.lastIndexOf(",")
      );
      const splitIndex = punctIndex >= minSplitIndex ? punctIndex + 1 : maxChars;
      wrapped.push(rest.slice(0, splitIndex).trim());
      rest = rest.slice(splitIndex).trim();
    }
    if (rest) wrapped.push(rest);
    return wrapped;
  };

  const joinUnit = (left: string, right: string) =>
    /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right)
      ? `${left} ${right}`
      : `${left}${right}`;

  const chunks: string[] = [];
  baseUnits.forEach((unit) => {
    const wrappedUnits = softWrapUnit(unit);
    wrappedUnits.forEach((segment) => {
      const last = chunks[chunks.length - 1];
      if (!last) {
        chunks.push(segment);
        return;
      }
      const merged = joinUnit(last, segment);
      if (merged.length <= maxChars) {
        chunks[chunks.length - 1] = merged;
        return;
      }
      chunks.push(segment);
    });
  });

  return chunks.filter(Boolean);
};

const estimateDialogueLineCount = (text: string) =>
  text
    .split("\n")
    .reduce(
      (sum, line) => sum + Math.max(1, Math.ceil(line.length / DIALOGUE_CHARS_PER_LINE_ESTIMATE)),
      0
    );

const canMergeDialogueLine = (left: DialogueLine, right: DialogueLine) => {
  if (left.speakerType !== right.speakerType) return false;
  if (left.avatarUrl && right.avatarUrl && left.avatarUrl !== right.avatarUrl) return false;

  const leftName = normalizeText(left.name).toLowerCase();
  const rightName = normalizeText(right.name).toLowerCase();
  if (leftName && rightName && leftName !== rightName) return false;
  return true;
};

const compactDialogueLines = (lines: DialogueLine[]) => {
  const compacted: DialogueLine[] = [];

  lines.forEach((line) => {
    if (!line.text) return;
    const prev = compacted[compacted.length - 1];
    if (!prev || !canMergeDialogueLine(prev, line)) {
      compacted.push(line);
      return;
    }

    const mergedText = `${prev.text}\n${line.text}`;
    if (
      mergedText.length > DIALOGUE_CHUNK_MAX_CHARS ||
      estimateDialogueLineCount(mergedText) > DIALOGUE_CHUNK_MAX_LINES
    ) {
      compacted.push(line);
      return;
    }

    compacted[compacted.length - 1] = {
      ...prev,
      name: prev.name || line.name || null,
      avatarUrl: prev.avatarUrl || line.avatarUrl || null,
      text: mergedText,
    };
  });

  return compacted;
};

const toDialogues = (messages: GameplayMessage[], fallbackText: string): DialogueLine[] => {
  if (!messages.length) {
    return [
      {
        id: "fallback",
        speakerType: "narrator",
        name: null,
        avatarUrl: null,
        text: fallbackText,
      },
    ];
  }

  const mapped: DialogueLine[] = [];
  messages.forEach((message, index) => {
    const baseText = normalizeText(message.text);
    if (!baseText) return;

    const sourceId = message.id || `msg-${index}`;
    const speakerType =
      message.speakerType === "character"
        ? "character"
        : message.speakerType === "system"
          ? "system"
          : "narrator";
    const chunks = splitDialogueText(baseText);

    chunks.forEach((text, chunkIndex) => {
      mapped.push({
        id: `${sourceId}-${chunkIndex}`,
        speakerType,
        name: normalizeText(message.name) || null,
        avatarUrl: message.avatarUrl || null,
        text,
      });
    });
  });

  const compacted = compactDialogueLines(mapped);
  return compacted.length > 0
    ? compacted
    : [
        {
          id: "fallback",
          speakerType: "narrator",
          name: null,
          avatarUrl: null,
          text: fallbackText,
        },
      ];
};

const toCoords = (spot?: GameplaySpot | null): { lat: number; lng: number } | null => {
  if (!spot) return null;
  if (typeof spot.lat !== "number" || typeof spot.lng !== "number") return null;
  if (!Number.isFinite(spot.lat) || !Number.isFinite(spot.lng)) return null;
  return { lat: spot.lat, lng: spot.lng };
};

const buildGoogleDirectionsEmbedUrl = (
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
) => {
  if (!GOOGLE_MAPS_WEB_API_KEY) return "";
  const params = new URLSearchParams({
    key: GOOGLE_MAPS_WEB_API_KEY,
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    mode: "walking",
  });
  return `https://www.google.com/maps/embed/v1/directions?${params.toString()}`;
};

const buildGooglePlaceEmbedUrl = (query: string) => {
  if (!GOOGLE_MAPS_WEB_API_KEY) return "";
  const params = new URLSearchParams({
    key: GOOGLE_MAPS_WEB_API_KEY,
    q: query || "日本",
    zoom: "15",
  });
  return `https://www.google.com/maps/embed/v1/place?${params.toString()}`;
};

const buildGoogleSearchUrl = (query: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || "日本")}`;

const buildOsmEmbedUrl = (coords?: { lat: number; lng: number } | null) => {
  const center = coords || DEFAULT_CENTER;
  const span = 0.01;
  const bbox = [
    center.lng - span,
    center.lat - span,
    center.lng + span,
    center.lat + span,
  ].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${center.lat}%2C${center.lng}`;
};

const formatDistance = (value: number | null) => {
  if (value == null) return "—";
  if (value < 1000) return `${Math.round(value)}m`;
  return `${(value / 1000).toFixed(1)}km`;
};

const formatDuration = (seconds: number) => {
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}分${remain}秒`;
};

const haversineDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) => {
  const R = 6371e3;
  const f1 = (lat1 * Math.PI) / 180;
  const f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(df / 2) * Math.sin(df / 2) +
    Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const trimUiLine = (value: string, maxLength = 72) => {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
};

const pickNarrativePreview = (
  value?: string | null,
  fallback = "次の手がかりを探して、物語を進めましょう。",
  maxLength = 72
) => {
  const lines = splitToNarrationLines(value);
  if (lines.length > 0) {
    return trimUiLine(lines[0], maxLength);
  }
  return trimUiLine(normalizeText(value) || fallback, maxLength);
};

const phaseLabelByMode = (mode: Mode, currentSpotName?: string | null) => {
  switch (mode) {
    case "location_gate":
      return "LOCATION CHECK";
    case "opening_prologue":
      return "OPENING";
    case "prologue":
      return "PROLOGUE";
    case "travel":
      return "TRAVEL";
    case "story_pre":
      return normalizeText(currentSpotName) || "SCENE";
    case "puzzle":
      return "PUZZLE";
    case "story_post":
      return normalizeText(currentSpotName) || "SCENE";
    case "epilogue":
      return "EPILOGUE";
    case "completed":
      return "COMPLETE";
    default:
      return "GAMEPLAY";
  }
};

const objectiveByMode = (
  mode: Mode,
  currentSpotName: string,
  nextSpotName?: string | null
) => {
  switch (mode) {
    case "location_gate":
      return "現在地を有効化して、最初のスポットへ向かいましょう。";
    case "opening_prologue":
      return "オープニングを開始して、物語世界に入ります。";
    case "prologue":
      return "導入会話を進めて、今回の目的を掴みましょう。";
    case "travel":
      return `「${currentSpotName}」へ到着して次の展開を解放してください。`;
    case "story_pre":
      return `「${currentSpotName}」の手がかりを読み取りましょう。`;
    case "puzzle":
      return `「${currentSpotName}」の謎を解いて物語を前進させてください。`;
    case "story_post":
      return nextSpotName
        ? `結果を受け取り、次の舞台「${nextSpotName}」へ備えましょう。`
        : "結果を受け取り、エピローグへ進みましょう。";
    case "epilogue":
      return "今回の旅路の余韻を受け取り、次話への記憶を確定します。";
    case "completed":
      return "今回の選択は完了しました。次のエピソードへ進めます。";
    default:
      return "物語を進めましょう。";
  }
};

const computeJourneyScore = ({
  durationSeconds,
  wrongAnswers,
  hintsUsed,
  totalSpots,
  clearedSpots,
}: {
  durationSeconds: number;
  wrongAnswers: number;
  hintsUsed: number;
  totalSpots: number;
  clearedSpots: number;
}) => {
  const safeTotal = Math.max(1, totalSpots);
  const completionRate = clampNumber(clearedSpots / safeTotal, 0, 1);
  const targetDuration = Math.max(420, safeTotal * 480);
  const delayPenalty =
    durationSeconds > targetDuration
      ? Math.min(16, Math.floor((durationSeconds - targetDuration) / 120) * 2)
      : 0;
  const missPenalty = wrongAnswers * 8;
  const hintPenalty = hintsUsed * 6;
  const completionBonus = Math.round(completionRate * 12);
  const score = clampNumber(
    Math.round(100 - missPenalty - hintPenalty - delayPenalty + completionBonus),
    35,
    100
  );
  return score;
};

const journeyRankMeta = (score: number): { rank: JourneyRank; comment: string } => {
  if (score >= 92) {
    return { rank: "S", comment: "世界観と導線を高密度に体験しました。" };
  }
  if (score >= 80) {
    return { rank: "A", comment: "良いテンポで物語を追えていました。" };
  }
  if (score >= 68) {
    return { rank: "B", comment: "安定して進行。次は演出回収を増やせます。" };
  }
  return { rank: "C", comment: "次回はヒントを抑えると没入度が上がります。" };
};

const createFrontendOnlyDemoQuest = (questId: string): GameplayQuest => {
  const characters: GameplayCharacter[] = [
    {
      id: "haruka",
      name: "遥",
      role: "記憶を辿る案内人",
      avatarUrl: null,
    },
    {
      id: "ren",
      name: "蓮",
      role: "風を読む語り部",
      avatarUrl: null,
    },
  ];

  const spots: GameplaySpot[] = [
    {
      id: "demo-spot-1",
      orderIndex: 1,
      name: "港の入口",
      description: "潮の匂いが漂う。ここから旅の章が始まる。",
      lat: DEFAULT_CENTER.lat,
      lng: DEFAULT_CENTER.lng,
      backgroundImage: FRONTEND_DEMO_IMAGES[0],
      puzzleQuestion: "この旅で最初に大切にするものは？（ひらがなで『きおく』）",
      puzzleAnswer: "きおく",
      puzzleHints: ["旅のテーマは過去の痕跡", "4文字のひらがな", "き○○○"],
      puzzleSuccessMessage: "正解。物語の鍵は、記憶にあった。",
      preMessages: [
        {
          id: "demo-pre-1",
          speakerType: "character",
          name: "遥",
          avatarUrl: null,
          text: "ここが最初の地点。景色だけじゃなく、残された痕跡にも目を向けて。",
        },
      ],
      postMessages: [
        {
          id: "demo-post-1",
          speakerType: "narrator",
          name: null,
          avatarUrl: null,
          text: "選択は記録され、次の章に引き継がれる。",
        },
      ],
    },
    {
      id: "demo-spot-2",
      orderIndex: 2,
      name: "古い鳥居の前",
      description: "風が抜けるたびに、時代の層が揺れる。",
      lat: DEFAULT_CENTER.lat + 0.0024,
      lng: DEFAULT_CENTER.lng + 0.0018,
      backgroundImage: FRONTEND_DEMO_IMAGES[2],
      puzzleQuestion: "灯火をローマ字で（小文字）",
      puzzleAnswer: "tomoshibi",
      puzzleHints: ["英字9文字", "to から始まる"],
      puzzleSuccessMessage: "正解。次の旅路に灯がともった。",
      preMessages: [
        {
          id: "demo-pre-2",
          speakerType: "character",
          name: "蓮",
          avatarUrl: null,
          text: "ここでは直感よりも、観察が効く。見落としを拾ってみよう。",
        },
      ],
      postMessages: [
        {
          id: "demo-post-2",
          speakerType: "character",
          name: "遥",
          avatarUrl: null,
          text: "これでこの話は一区切り。でも、あなたの選択は次話へ残る。",
        },
      ],
    },
  ];

  return {
    id: questId || "demo",
    title: "TOMOSHIBI Demo Episode",
    areaName: "横浜みなとみらい",
    coverImageUrl: FRONTEND_DEMO_IMAGES[0],
    prologue:
      "旅の幕が開く。ここから先は、あなたの選択で物語が変わる。遥と蓮が、次の手がかりへと導いてくれる。",
    epilogue:
      "この章は完了した。ここでの選択は次の旅路へ受け継がれる。続きのエピソードで新しい選択を重ねよう。",
    characters,
    spots,
  } satisfies GameplayQuest;
};

const loadGoogleMapsJs = async () => {
  const hasGoogle = Boolean((globalThis as any)?.google?.maps);
  if (hasGoogle) return;

  if (!GOOGLE_MAPS_WEB_API_KEY) {
    throw new Error("GOOGLE_MAPS_WEB_API_KEY is missing");
  }

  if (!googleMapsJsLoader) {
    googleMapsJsLoader = new Promise<void>((resolve, reject) => {
      const scriptId = "tomoshibi-google-maps-js";
      const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
      if (existing) {
        if ((globalThis as any)?.google?.maps) {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("Google Maps script load failed")),
          { once: true }
        );
        return;
      }

      const script = document.createElement("script");
      script.id = scriptId;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_WEB_API_KEY}`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Google Maps script load failed"));
      document.head.appendChild(script);
    });
  }

  await googleMapsJsLoader;
};

function WebGameMap({
  spots,
  currentSpotIndex,
  fallbackEmbedUrl,
}: {
  spots: GameplaySpot[];
  currentSpotIndex: number;
  fallbackEmbedUrl: string;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const routePoints = useMemo(
    () =>
      spots
        .map((spot, index) => {
          const coords = toCoords(spot);
          if (!coords) return null;
          return {
            index,
            name: normalizeText(spot.name) || `スポット${index + 1}`,
            lat: coords.lat,
            lng: coords.lng,
          };
        })
        .filter((row): row is { index: number; name: string; lat: number; lng: number } => Boolean(row)),
    [spots]
  );

  useEffect(() => {
    let cancelled = false;

    const renderMap = async () => {
      try {
        await loadGoogleMapsJs();
        if (cancelled) return;

        const googleApi = (globalThis as any)?.google;
        const maps = googleApi?.maps;
        const host = mapContainerRef.current;
        if (!maps || !host) {
          setLoadFailed(true);
          setMapReady(false);
          return;
        }

        if (!mapRef.current) {
          mapRef.current = new maps.Map(host, {
            center: { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng },
            zoom: 13,
            gestureHandling: "greedy",
            disableDefaultUI: true,
            clickableIcons: false,
          });
        }

        const map = mapRef.current;

        overlaysRef.current.forEach((overlay) => {
          if (overlay && typeof overlay.setMap === "function") {
            overlay.setMap(null);
          }
        });
        overlaysRef.current = [];

        if (routePoints.length > 0) {
          const bounds = new maps.LatLngBounds();
          routePoints.forEach((point) => {
            bounds.extend({ lat: point.lat, lng: point.lng });
          });
          map.fitBounds(bounds, 52);
          if (routePoints.length === 1) {
            map.setZoom(15);
          }

          const polyline = new maps.Polyline({
            map,
            path: routePoints.map((point) => ({ lat: point.lat, lng: point.lng })),
            strokeColor: "#EE8C2B",
            strokeOpacity: 0.9,
            strokeWeight: 4,
          });
          overlaysRef.current.push(polyline);
        }

        routePoints.forEach((point, pointIndex) => {
          const isVisited = point.index < currentSpotIndex;
          const isCurrent = point.index === currentSpotIndex;
          const isNext = point.index === currentSpotIndex + 1;
          const marker = new maps.Marker({
            map,
            position: { lat: point.lat, lng: point.lng },
            title: `${point.index + 1}. ${point.name}`,
            label: {
              text: String(point.index + 1),
              color: "#FFFFFF",
              fontWeight: "700",
            },
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: isCurrent ? 11 : 9.5,
              fillColor: isCurrent
                ? "#EE8C2B"
                : isNext
                  ? "#6A5F55"
                  : isVisited
                    ? "#9BA3AE"
                    : "#7C6C5E",
              fillOpacity: 1,
              strokeColor: "#FFFFFF",
              strokeWeight: 2,
            },
            zIndex: isCurrent ? 99 : isNext ? 80 : 40 - pointIndex,
          });
          overlaysRef.current.push(marker);
        });

        setLoadFailed(false);
        setMapReady(true);
      } catch {
        if (!cancelled) {
          setLoadFailed(true);
          setMapReady(false);
        }
      }
    };

    setMapReady(false);
    void renderMap();

    return () => {
      cancelled = true;
    };
  }, [currentSpotIndex, routePoints]);

  return (
    <View className="absolute inset-0">
      {loadFailed ? (
        createElement("iframe", {
          src: fallbackEmbedUrl,
          loading: "eager",
          allowFullScreen: true,
          referrerPolicy: "no-referrer-when-downgrade",
          style: {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            height: "100%",
            border: "none",
            pointerEvents: "auto",
          },
        })
      ) : (
        createElement("div", {
          ref: mapContainerRef,
          style: {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            height: "100%",
          },
        })
      )}

      {!mapReady ? (
        <View className="absolute right-4 top-14 rounded-full bg-white/90 px-3 py-1.5 flex-row items-center gap-2">
          <ActivityIndicator size="small" color="#EE8C2B" />
          <Text className="text-[11px] text-[#6C5647]" style={{ fontFamily: fonts.bodyRegular }}>
            地図を準備中
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const TypewriterDialogueOverlay = ({
  line,
  isLast,
  resolveCharacter,
  onComplete,
  topShadeHeight,
  bottomShadeHeight,
}: {
  line: DialogueLine;
  isLast: boolean;
  resolveCharacter: (line: DialogueLine) => DialogueCharacter | null;
  onComplete: () => void;
  topShadeHeight: number;
  bottomShadeHeight: number;
}) => {
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(true);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(16)).current;
  const dialogueScrollRef = useRef<ScrollView | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTypingTimers = useCallback(() => {
    if (typingStartTimerRef.current) {
      clearTimeout(typingStartTimerRef.current);
      typingStartTimerRef.current = null;
    }
    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearTypingTimers();
    setDisplayedText("");
    setIsTyping(true);
    cardOpacity.setValue(0);
    cardTranslateY.setValue(16);

    let index = 0;
    typingStartTimerRef.current = setTimeout(() => {
      typingTimerRef.current = setInterval(() => {
        if (index < line.text.length) {
          setDisplayedText(line.text.slice(0, index + 1));
          index += 1;
          return;
        }
        clearTypingTimers();
        setIsTyping(false);
      }, 30);
    }, 110);

    Animated.parallel([
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 190,
        useNativeDriver: true,
      }),
      Animated.timing(cardTranslateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();

    return clearTypingTimers;
  }, [line.id, line.text, cardOpacity, cardTranslateY, clearTypingTimers]);

  useEffect(() => {
    dialogueScrollRef.current?.scrollToEnd({ animated: false });
  }, [displayedText]);

  const handlePress = () => {
    if (isTyping) {
      clearTypingTimers();
      setDisplayedText(line.text);
      setIsTyping(false);
      return;
    }
    onComplete();
  };

  const tone =
    line.speakerType === "character"
      ? "character"
      : line.speakerType === "system"
        ? "system"
        : "narrator";
  const character = resolveCharacter(line);
  const isNarrator = !character;
  const hasCharacterPresence = Boolean(
    character &&
    line.speakerType === "character" &&
    character.avatarUrl
  );
  const compactWidth = windowWidth <= 360;
  const compactScale = clampNumber(windowWidth / 390, 0.78, 1);
  const overlayInset = clampNumber(Math.round(windowWidth * 0.045), 10, 20);
  const dialogueAnchorBottom = clampNumber(
    Math.round(windowHeight * (compactWidth ? 0.06 : 0.05)),
    14,
    44
  );
  const dialogueCardMaxHeight = clampNumber(
    Math.round(windowHeight * (compactWidth ? 0.34 : 0.32)),
    150,
    compactWidth ? 212 : 248
  );
  const dialogueCardMinHeight = clampNumber(Math.round(dialogueCardMaxHeight * 0.72), 128, 182);
  const baseImageSafeTop = clampNumber(
    Math.round(windowHeight * (compactWidth ? 0.12 : 0.1)),
    44,
    120
  );
  const minImageHeight = compactWidth ? 108 : 124;
  const availableImageBottom = Math.min(
    windowHeight - bottomShadeHeight - (compactWidth ? 8 : 12),
    windowHeight -
      dialogueAnchorBottom -
      dialogueCardMaxHeight -
      Math.round(windowHeight * (compactWidth ? 0.03 : 0.04))
  );
  const imageSafeTop = clampNumber(
    Math.max(baseImageSafeTop, topShadeHeight + (compactWidth ? 8 : 12)),
    44,
    Math.max(44, availableImageBottom - minImageHeight)
  );
  const imageSafeHeight = clampNumber(
    availableImageBottom - imageSafeTop,
    minImageHeight,
    Math.round(windowHeight * 0.52)
  );
  const avatarCardWidth = clampNumber(
    Math.round(windowWidth * (compactWidth ? 0.8 : 0.74)),
    220,
    500
  );
  const titleFontSize = compactWidth ? 11 : 12;
  const bodyFontSize = compactWidth ? 14 : 15;
  const bodyLineHeight = compactWidth ? 22 : 24;
  const hintFontSize = compactWidth ? 10 : 11;
  const cardPaddingHorizontal = compactWidth ? 12 : 16;
  const cardPaddingVertical = compactWidth ? 12 : 16;
  const iconSize = compactWidth ? 22 : 24;
  const iconGlyphSize = compactWidth ? 9 : 10;

  return (
    <Pressable
      className="absolute inset-0 z-30"
      style={{ paddingHorizontal: overlayInset }}
      onPress={handlePress}
    >
      <View className="absolute inset-0 bg-black/58" pointerEvents="none" />
      {hasCharacterPresence && character?.avatarUrl ? (
        <View className="absolute inset-0 pointer-events-none">
          <View
            className="absolute items-center justify-end"
            style={{
              left: overlayInset,
              right: overlayInset,
              top: imageSafeTop,
              height: imageSafeHeight,
            }}
          >
            <View
              className="items-center justify-center overflow-hidden border border-[#EED8C0]/28 bg-[#2A2018]/24"
              style={{
                width: avatarCardWidth,
                height: imageSafeHeight,
                borderRadius: compactWidth ? 16 : 20,
                shadowColor: "#000000",
                shadowOpacity: 0.12,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 4 },
                elevation: 4,
              }}
            >
              <Image
                source={{ uri: character.avatarUrl }}
                className="w-full h-full"
                resizeMode="cover"
                style={{ transform: [{ scale: 1.08 }] }}
              />
            </View>
          </View>
        </View>
      ) : null}
      <View
        className="absolute"
        style={{ left: overlayInset, right: overlayInset, bottom: dialogueAnchorBottom }}
      >
        <Animated.View
          style={{
            opacity: cardOpacity,
            transform: [{ translateY: cardTranslateY }],
            minHeight: dialogueCardMinHeight,
            maxHeight: dialogueCardMaxHeight,
            paddingHorizontal: cardPaddingHorizontal,
            paddingVertical: cardPaddingVertical,
          }}
          className={`rounded-2xl border ${
            isNarrator ? "bg-[#0D0A08]/94 border-white/28" : "bg-[#120E0B]/94 border-[#EE8C2B]/52"
          }`}
        >
          <View className="flex-row items-center gap-2 mb-2">
            <View
              className={`w-6 h-6 rounded-full items-center justify-center ${
                tone === "character"
                  ? "bg-[#EE8C2B]/25"
                  : tone === "system"
                    ? "bg-[#DDD5CC]/25"
                    : "bg-white/15"
              }`}
              style={{ width: iconSize, height: iconSize }}
            >
              <Text
                className="text-[#E7DDD1]"
                style={{ fontFamily: fonts.displayBold, fontSize: iconGlyphSize }}
              >
                {tone === "character" ? "C" : tone === "system" ? "S" : "N"}
              </Text>
            </View>

            <Text
              className="text-[#E9E3DC] flex-1"
              style={{ fontFamily: fonts.displayBold, fontSize: titleFontSize }}
              numberOfLines={1}
            >
              {character
                ? character.name
                : tone === "narrator"
                  ? "Narration"
                  : "System"}
            </Text>

          </View>

          <View className="mt-1 flex-1">
            <ScrollView
              ref={dialogueScrollRef}
              scrollEnabled={false}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => {
                dialogueScrollRef.current?.scrollToEnd({ animated: false });
              }}
            >
              <Text
                className={tone === "narrator" ? "text-white/95" : "text-white"}
                style={{
                  fontFamily: fonts.bodyRegular,
                  fontSize: bodyFontSize,
                  lineHeight: bodyLineHeight,
                  textShadowColor: "rgba(0,0,0,0.78)",
                  textShadowOffset: { width: 0, height: 1 },
                  textShadowRadius: 2,
                }}
              >
                {displayedText}
                {isTyping ? "|" : ""}
              </Text>
            </ScrollView>
          </View>

          <View className="mt-2 flex-row justify-end" style={{ minHeight: Math.max(14, Math.round(18 * compactScale)) }}>
            {!isTyping ? (
              <Text
                className="text-[#E7C08E]/85"
                style={{ fontFamily: fonts.bodyRegular, fontSize: hintFontSize }}
              >
                {isLast ? "▼ 完了" : "▼ タップして次へ"}
              </Text>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Pressable>
  );
};

const PrologueCinematicOverlay = ({
  line,
  isLast,
  onComplete,
}: {
  line: DialogueLine;
  isLast: boolean;
  onComplete: () => void;
}) => {
  const [isRevealing, setIsRevealing] = useState(true);
  const { width: windowWidth } = useWindowDimensions();
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateY = useRef(new Animated.Value(14)).current;
  const compactWidth = windowWidth <= 360;

  useEffect(() => {
    setIsRevealing(true);
    textOpacity.setValue(0);
    textTranslateY.setValue(14);

    const revealAnimation = Animated.sequence([
      Animated.delay(180),
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 980,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(textTranslateY, {
          toValue: 0,
          duration: 980,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ]),
    ]);

    revealAnimation.start(({ finished }) => {
      if (finished) {
        setIsRevealing(false);
      }
    });

    return () => {
      revealAnimation.stop();
    };
  }, [line.id, line.text, textOpacity, textTranslateY]);

  const handlePress = () => {
    if (isRevealing) {
      textOpacity.stopAnimation();
      textTranslateY.stopAnimation();
      textOpacity.setValue(1);
      textTranslateY.setValue(0);
      setIsRevealing(false);
      return;
    }
    onComplete();
  };

  const textFontSize = compactWidth ? 15 : 17;
  const textLineHeight = compactWidth ? 25 : 29;
  const topGuideOffset = 18;

  return (
    <Pressable
      className="absolute inset-0 z-40 items-center justify-center bg-black px-7"
      onPress={handlePress}
    >
      <View
        className="absolute left-5 right-5 items-center"
        style={{ top: topGuideOffset }}
        pointerEvents="none"
      >
        <View className="rounded-full border border-[#E7C08E]/55 bg-[#2A2118] px-3 py-1">
          <Text className="text-[10px] tracking-[1.6px] text-[#F6D4A7]" style={{ fontFamily: fonts.displayBold }}>
            PROLOGUE
          </Text>
        </View>
      </View>

      <Animated.View
        style={{
          opacity: textOpacity,
          transform: [{ translateY: textTranslateY }],
        }}
      >
        <Text
          className="text-center text-[#F2E8D8]"
          style={{
            fontFamily: fonts.displayBold,
            fontSize: textFontSize,
            lineHeight: textLineHeight,
            textShadowColor: "rgba(0,0,0,0.75)",
            textShadowOffset: { width: 0, height: 2 },
            textShadowRadius: 6,
          }}
        >
          {line.text}
        </Text>
      </Animated.View>

      {!isRevealing ? (
        <View className="absolute bottom-14 left-0 right-0 items-center px-6">
          <Text
            className="text-[#E7C08E]/90"
            style={{ fontFamily: fonts.bodyRegular, fontSize: compactWidth ? 11 : 12 }}
          >
            {isLast ? "▼ 完了" : "▼ タップして次へ"}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
};

export const GamePlayScreen = ({ route }: Props) => {
  const { questId, startEpisodeNo } = route.params;
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quest, setQuest] = useState<GameplayQuest | null>(null);
  const [currentSpotIndex, setCurrentSpotIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("location_gate");

  const [dialogues, setDialogues] = useState<DialogueLine[]>([]);
  const [dialogueIndex, setDialogueIndex] = useState(0);
  const [hasPlayedOpeningPrologue, setHasPlayedOpeningPrologue] = useState(false);
  const [prologueNextMode, setPrologueNextMode] =
    useState<PrologueNextMode>("travel");
  const [sceneTransitionVisible, setSceneTransitionVisible] = useState(false);

  const [puzzleInput, setPuzzleInput] = useState("");
  const [puzzleState, setPuzzleState] = useState<PuzzleState>("idle");
  const [puzzleError, setPuzzleError] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);
  const [revealedHintLevel, setRevealedHintLevel] = useState(0);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [revealedCorrectChoiceId, setRevealedCorrectChoiceId] = useState<string | null>(
    null
  );
  const [consequence, setConsequence] = useState<string | null>(null);
  const [wrongAnswers, setWrongAnswers] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);

  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [gpsRequesting, setGpsRequesting] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [locationSkipped, setLocationSkipped] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [distance, setDistance] = useState<number | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>(
    "locationUnavailable"
  );

  const watchIdRef = useRef<number | null>(null);
  const openingPrologueAutoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneTransitionTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const startedAtRef = useRef<number>(Date.now());

  const currentSpot = quest?.spots[currentSpotIndex] || null;
  const nextSpot = quest?.spots[currentSpotIndex + 1] || null;
  const isLastSpot = Boolean(quest && currentSpotIndex >= quest.spots.length - 1);
  const activeDialogue = dialogues[dialogueIndex] || null;

  useEffect(() => {
    if (!quest) return;

    const imageUris = new Set<string>();
    const collect = (value?: string | null) => {
      const uri = normalizeText(value);
      if (!uri) return;
      imageUris.add(uri);
    };

    collect(quest.coverImageUrl);
    quest.characters.forEach((character) => {
      collect(character.avatarUrl);
    });
    quest.spots.forEach((spot) => {
      collect(spot.backgroundImage);
      spot.preMessages.forEach((message) => collect(message.avatarUrl));
      spot.postMessages.forEach((message) => collect(message.avatarUrl));
    });

    imageUris.forEach((uri) => {
      void Image.prefetch(uri).catch(() => false);
    });
  }, [quest]);

  const prologueDialogues = useMemo(() => {
    if (!quest) return [];
    const lines = splitToNarrationLines(quest.prologue);
    const source =
      lines.length > 0
        ? lines
        : splitToNarrationLines(`旅の幕が開く。${quest.title}の物語を始めよう。`);
    return source.map((text, index) => ({
      id: `prologue-${index}`,
      speakerType: "narrator" as const,
      name: null,
      avatarUrl: null,
      text,
    }));
  }, [quest]);

  const epilogueDialogues = useMemo(() => {
    if (!quest) return [];
    const lines = splitToNarrationLines(quest.epilogue);
    const source =
      lines.length > 0
        ? lines
        : splitToNarrationLines("この章は完了。次のエピソードへ記憶が引き継がれる。");
    return source.map((text, index) => ({
      id: `epilogue-${index}`,
      speakerType: "narrator" as const,
      name: null,
      avatarUrl: null,
      text,
    }));
  }, [quest]);

  const currentCoords = useMemo(() => toCoords(currentSpot), [currentSpot]);
  const nextCoords = useMemo(() => toCoords(nextSpot), [nextSpot]);

  const resolveCharacter = useCallback(
    (line: DialogueLine): DialogueCharacter | null => {
      if (line.speakerType !== "character") return null;

      const fallbackName = normalizeText(line.name);
      const speakerKey = fallbackName.toLowerCase();
      const matched =
        speakerKey && quest?.characters
          ? quest.characters.find((character) => {
              const candidateName = normalizeText(character.name).toLowerCase();
              const candidateId = normalizeText(character.id).toLowerCase();
              return candidateName === speakerKey || candidateId === speakerKey;
            }) || null
          : null;

      if (matched) {
        return {
          id: matched.id,
          name: matched.name,
          role: matched.role || null,
          avatarUrl: line.avatarUrl || matched.avatarUrl || null,
        };
      }

      if (fallbackName || line.avatarUrl) {
        return {
          id: fallbackName ? `virtual:${fallbackName}` : "virtual:character",
          name: fallbackName || "旅の同行者",
          role: null,
          avatarUrl: line.avatarUrl || null,
        };
      }

      const primary = quest?.characters?.[0];
      if (!primary) return null;

      return {
        id: primary.id,
        name: primary.name,
        role: primary.role || null,
        avatarUrl: line.avatarUrl || primary.avatarUrl || null,
      };
    },
    [quest?.characters]
  );

  const parsedPuzzle = useMemo(
    () => parsePuzzleQuestion(currentSpot?.puzzleQuestion),
    [currentSpot?.puzzleQuestion]
  );

  const puzzleChoices = useMemo(() => {
    if (parsedPuzzle.choices.length >= 2) {
      return parsedPuzzle.choices;
    }

    if (!currentSpot?.puzzleAnswer) {
      return [];
    }

    return createAutoChoices(
      currentSpot.puzzleAnswer,
      currentSpot.puzzleQuestion,
      currentSpot.puzzleHints || []
    );
  }, [
    parsedPuzzle.choices,
    currentSpot?.puzzleAnswer,
    currentSpot?.puzzleQuestion,
    currentSpot?.puzzleHints,
  ]);

  const hasChoicePuzzle = puzzleChoices.length >= 2;

  const correctChoice = useMemo(
    () => findCorrectChoice(puzzleChoices, currentSpot?.puzzleAnswer),
    [puzzleChoices, currentSpot?.puzzleAnswer]
  );

  const visibleHints = useMemo(
    () => (currentSpot?.puzzleHints || []).slice(0, revealedHintLevel),
    [currentSpot?.puzzleHints, revealedHintLevel]
  );

  const puzzlePromptText =
    parsedPuzzle.prompt ||
    currentSpot?.puzzleQuestion ||
    "このスポットには謎が設定されていません。次へ進みましょう。";

  const primaryChoiceHint =
    currentSpot?.puzzleHints && currentSpot.puzzleHints.length > 0
      ? currentSpot.puzzleHints[0]
      : null;

  const canArrive =
    mode === "travel" &&
    (locationSkipped ||
      !currentCoords ||
      (gpsEnabled && locationStatus === "nearTarget"));

  const mapEmbedUrl = useMemo(() => {
    if (currentCoords && nextCoords) {
      const directions = buildGoogleDirectionsEmbedUrl(currentCoords, nextCoords);
      if (directions) return directions;
    }

    const query =
      currentCoords
        ? `${currentCoords.lat},${currentCoords.lng}`
        : normalizeText(currentSpot?.name) || "日本";
    const place = buildGooglePlaceEmbedUrl(query);
    if (place) return place;
    return buildOsmEmbedUrl(currentCoords);
  }, [currentCoords, nextCoords, currentSpot?.name]);

  const mapFallbackEmbedUrl = useMemo(() => {
    if (mapEmbedUrl) return mapEmbedUrl;
    return buildOsmEmbedUrl(currentCoords);
  }, [mapEmbedUrl, currentCoords]);

  const openMapApp = useCallback(() => {
    if (!currentSpot) return;
    const query =
      currentCoords
        ? `${currentCoords.lat},${currentCoords.lng}`
        : normalizeText(currentSpot.name) || "日本";
    void Linking.openURL(buildGoogleSearchUrl(query));
  }, [currentCoords, currentSpot]);

  const clearSceneTransitionTimers = useCallback(() => {
    sceneTransitionTimersRef.current.forEach((timer) => clearTimeout(timer));
    sceneTransitionTimersRef.current = [];
  }, []);

  const clearOpeningPrologueAutoTimer = useCallback(() => {
    if (openingPrologueAutoTimerRef.current) {
      clearTimeout(openingPrologueAutoTimerRef.current);
      openingPrologueAutoTimerRef.current = null;
    }
  }, []);

  const runSceneTransition = useCallback(
    (action: () => void) => {
      clearSceneTransitionTimers();
      setSceneTransitionVisible(true);

      const beforeTimer = setTimeout(() => {
        action();
        const afterTimer = setTimeout(() => {
          setSceneTransitionVisible(false);
        }, 170);
        sceneTransitionTimersRef.current.push(afterTimer);
      }, 130);

      sceneTransitionTimersRef.current.push(beforeTimer);
    },
    [clearSceneTransitionTimers]
  );

  const beginTravelMode = useCallback(() => {
    setMode("travel");
    setPuzzleInput("");
    setPuzzleState("idle");
    setPuzzleError(null);
    setAttemptCount(0);
    setRevealedHintLevel(0);
    setSelectedChoiceId(null);
    setRevealedCorrectChoiceId(null);
    setConsequence(null);
  }, []);

  const beginPreStory = useCallback(() => {
    if (!currentSpot) return;
    const pre = toDialogues(
      currentSpot.preMessages,
      currentSpot.description || "この場所で物語が始まります。"
    );
    setDialogues(pre);
    setDialogueIndex(0);
    setMode("story_pre");
  }, [currentSpot]);

  const beginPostStory = useCallback(() => {
    if (!currentSpot) return;
    const post = toDialogues(
      currentSpot.postMessages,
      currentSpot.puzzleSuccessMessage || "この場所で得た記憶を胸に、次の地点へ進みましょう。"
    );
    setDialogues(post);
    setDialogueIndex(0);
    setMode("story_post");
  }, [currentSpot]);

  const beginPrologue = useCallback(
    (nextMode: PrologueNextMode) => {
      if (prologueDialogues.length === 0) {
        if (nextMode === "story_pre") {
          beginPreStory();
        } else {
          beginTravelMode();
        }
        return;
      }

      setPrologueNextMode(nextMode);
      setDialogues(prologueDialogues);
      setDialogueIndex(0);
      setMode("prologue");
    },
    [prologueDialogues, beginPreStory, beginTravelMode]
  );

  const beginEpilogue = useCallback(() => {
    if (epilogueDialogues.length === 0) {
      setMode("completed");
      return;
    }
    setDialogues(epilogueDialogues);
    setDialogueIndex(0);
    setMode("epilogue");
  }, [epilogueDialogues]);

  const requestGpsPermission = useCallback(
    async (onGranted?: () => void) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setGpsError("この環境では位置情報が利用できません。デモ開始で進めてください。");
        return;
      }

      setGpsRequesting(true);
      setGpsError(null);

      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const nextLocation = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            };
            setGpsEnabled(true);
            setLocationSkipped(false);
            setUserLocation(nextLocation);
            if (currentCoords) {
              const d = haversineDistance(
                nextLocation.lat,
                nextLocation.lng,
                currentCoords.lat,
                currentCoords.lng
              );
              setDistance(d);
              setLocationStatus(d <= NEAR_THRESHOLD_M ? "nearTarget" : "tooFar");
            } else {
              setDistance(null);
              setLocationStatus("locationUnavailable");
            }
            onGranted?.();
            resolve();
          },
          () => {
            setGpsEnabled(false);
            setGpsError("位置情報の取得に失敗しました。設定を確認して再試行してください。");
            resolve();
          },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 3000 }
        );
      });

      setGpsRequesting(false);
    },
    [currentCoords]
  );

  const handleEnableLocationGate = useCallback(() => {
    void requestGpsPermission(() => {
      runSceneTransition(() => {
        setMode("travel");
      });
    });
  }, [requestGpsPermission, runSceneTransition]);

  const handleSkipLocationGate = useCallback(() => {
    setGpsEnabled(false);
    setGpsRequesting(false);
    setGpsError(null);
    setLocationSkipped(true);
    setLocationStatus("locationUnavailable");
    runSceneTransition(() => {
      setMode("travel");
    });
  }, [runSceneTransition]);

  const handleArrive = useCallback(() => {
    if (!canArrive) return;
    if (
      currentSpotIndex === 0 &&
      !hasPlayedOpeningPrologue &&
      prologueDialogues.length > 0
    ) {
      setPrologueNextMode("story_pre");
      setMode("opening_prologue");
      return;
    }
    runSceneTransition(beginPreStory);
  }, [
    canArrive,
    currentSpotIndex,
    hasPlayedOpeningPrologue,
    prologueDialogues.length,
    beginPreStory,
    runSceneTransition,
  ]);

  const beginOpeningPrologueFlow = useCallback(() => {
    runSceneTransition(() => {
      beginPrologue("story_pre");
    });
  }, [beginPrologue, runSceneTransition]);

  const handleDialogueNext = useCallback(() => {
    if (!activeDialogue) return;
    const isLast = dialogueIndex >= dialogues.length - 1;
    if (!isLast) {
      setDialogueIndex((prev) => prev + 1);
      return;
    }

    if (mode === "prologue") {
      if (prologueNextMode === "story_pre") {
        runSceneTransition(() => {
          setHasPlayedOpeningPrologue(true);
          beginPreStory();
        });
      } else {
        runSceneTransition(beginTravelMode);
      }
      return;
    }

    if (mode === "story_pre") {
      runSceneTransition(beginPostStory);
      return;
    }

    if (mode === "story_post") {
      if (isLastSpot) {
        runSceneTransition(beginEpilogue);
      } else {
        runSceneTransition(() => {
          setCurrentSpotIndex((prev) => prev + 1);
          beginTravelMode();
        });
      }
      return;
    }

    if (mode === "epilogue") {
      runSceneTransition(() => {
        setMode("completed");
      });
    }
  }, [
    activeDialogue,
    dialogueIndex,
    dialogues.length,
    mode,
    prologueNextMode,
    beginPreStory,
    beginTravelMode,
    beginPostStory,
    isLastSpot,
    beginEpilogue,
    runSceneTransition,
  ]);

  const handleSubmitPuzzle = useCallback(() => {
    if (!currentSpot) return;

    if (hasChoicePuzzle && (puzzleState === "correct" || puzzleState === "revealedAnswer")) {
      beginPostStory();
      return;
    }

    if (!hasChoicePuzzle && (puzzleState === "correct" || puzzleState === "revealedAnswer")) {
      beginPostStory();
      return;
    }

    if (hasChoicePuzzle) {
      if (!currentSpot.puzzleAnswer) {
        beginPostStory();
        return;
      }

      if (!selectedChoiceId) {
        setPuzzleError("選択肢を選んでください。");
        return;
      }

      const selectedChoice =
        puzzleChoices.find((choice) => choice.id === selectedChoiceId) || null;
      const resolvedCorrectChoice =
        correctChoice || findCorrectChoice(puzzleChoices, currentSpot.puzzleAnswer);

      const isCorrectChoice = selectedChoice
        ? isChoiceAnswerMatch(selectedChoice, currentSpot.puzzleAnswer)
        : false;

      setAttemptCount((prev) => prev + 1);
      if (!isCorrectChoice) {
        setWrongAnswers((prev) => prev + 1);
      }
      setPuzzleState(isCorrectChoice ? "correct" : "incorrect");
      setPuzzleError(
        isCorrectChoice
          ? null
          : "不正解です。ヒントを確認して、もう一度試してみてください。"
      );
      setConsequence(
        isCorrectChoice
          ? currentSpot.puzzleSuccessMessage || "正解です。次へ進みます。"
          : null
      );
      setRevealedCorrectChoiceId(
        resolvedCorrectChoice?.id || selectedChoice?.id || null
      );

      if (isCorrectChoice) {
        setPuzzleInput(selectedChoice?.text || currentSpot.puzzleAnswer || "");
      }
      return;
    }

    if (!currentSpot.puzzleAnswer) {
      beginPostStory();
      return;
    }

    if (!puzzleInput.trim()) {
      setPuzzleError("答えを入力してください。");
      return;
    }

    setAttemptCount((prev) => prev + 1);
    const correct = checkAnswer(puzzleInput, currentSpot.puzzleAnswer);
    if (correct) {
      setPuzzleState("correct");
      setPuzzleError(null);
      setConsequence(currentSpot.puzzleSuccessMessage || "正解です。次へ進みます。");
      return;
    }

    setPuzzleState("incorrect");
    setWrongAnswers((prev) => prev + 1);
    setConsequence(null);
    if (attemptCount + 1 >= 3 && currentSpot.puzzleHints.length > revealedHintLevel) {
      setPuzzleError("ヒントを確認してみましょう。💡");
      return;
    }

    setPuzzleError("答えが違うようです。もう一度試してください。");
  }, [
    currentSpot,
    hasChoicePuzzle,
    puzzleState,
    beginPostStory,
    selectedChoiceId,
    puzzleChoices,
    correctChoice,
    puzzleInput,
    attemptCount,
    revealedHintLevel,
  ]);

  const handleRevealHint = useCallback(() => {
    if (!currentSpot) return;

    if (hasChoicePuzzle) {
      if (!primaryChoiceHint) return;
      setRevealedHintLevel((prev) => {
        if (prev > 0) return 0;
        setHintsUsed((used) => used + 1);
        return 1;
      });
      return;
    }

    if (revealedHintLevel >= currentSpot.puzzleHints.length) return;
    setHintsUsed((prev) => prev + 1);
    setRevealedHintLevel((prev) => prev + 1);
  }, [currentSpot, hasChoicePuzzle, primaryChoiceHint, revealedHintLevel]);

  const handleRevealAnswer = useCallback(() => {
    if (!currentSpot?.puzzleAnswer) return;

    if (hasChoicePuzzle) {
      const resolvedCorrectChoice =
        correctChoice || findCorrectChoice(puzzleChoices, currentSpot.puzzleAnswer);
      if (resolvedCorrectChoice) {
        setSelectedChoiceId(resolvedCorrectChoice.id);
        setRevealedCorrectChoiceId(resolvedCorrectChoice.id);
        setPuzzleInput(resolvedCorrectChoice.text);
      }
    }

    setPuzzleInput(currentSpot.puzzleAnswer);
    setPuzzleState("revealedAnswer");
    setPuzzleError(null);
    setConsequence("答えを開示しました。次へ進めます。");
  }, [currentSpot?.puzzleAnswer, hasChoicePuzzle, puzzleChoices, correctChoice]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!questId) {
        setLoadError("クエスト情報が見つかりません。");
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);

      try {
        const shouldUseFrontendDemo = questId === "demo" || questId === "preview";
        let loaded = shouldUseFrontendDemo
          ? createFrontendOnlyDemoQuest(questId)
          : await fetchGameplayQuest(questId);

        if (cancelled) return;

        if (!loaded || loaded.spots.length === 0) {
          loaded = createFrontendOnlyDemoQuest(questId);
        }

        const safeIndex = Math.min(
          Math.max(0, (startEpisodeNo || 1) - 1),
          loaded.spots.length - 1
        );

        setQuest(loaded);
        setCurrentSpotIndex(safeIndex);
        setMode("location_gate");
        setDialogues([]);
        setDialogueIndex(0);
        setHasPlayedOpeningPrologue(safeIndex > 0);
        setPrologueNextMode("travel");
        setPuzzleInput("");
        setPuzzleState("idle");
        setPuzzleError(null);
        setAttemptCount(0);
        setRevealedHintLevel(0);
        setSelectedChoiceId(null);
        setRevealedCorrectChoiceId(null);
        setConsequence(null);
        setWrongAnswers(0);
        setHintsUsed(0);
        setGpsEnabled(false);
        setGpsError(null);
        setGpsRequesting(false);
        setLocationSkipped(false);
        setUserLocation(null);
        setDistance(null);
        setLocationStatus("locationUnavailable");
        startedAtRef.current = Date.now();
      } catch (error) {
        if (!cancelled) {
          console.error("GamePlayScreen.web: failed to load gameplay quest", error);
          const fallback = createFrontendOnlyDemoQuest(questId);
          const safeIndex = Math.min(
            Math.max(0, (startEpisodeNo || 1) - 1),
            fallback.spots.length - 1
          );
          setQuest(fallback);
          setCurrentSpotIndex(safeIndex);
          setMode("location_gate");
          setDialogues([]);
          setDialogueIndex(0);
          setHasPlayedOpeningPrologue(safeIndex > 0);
          setPrologueNextMode("travel");
          setPuzzleInput("");
          setPuzzleState("idle");
          setPuzzleError(null);
          setAttemptCount(0);
          setRevealedHintLevel(0);
          setSelectedChoiceId(null);
          setRevealedCorrectChoiceId(null);
          setConsequence(null);
          setWrongAnswers(0);
          setHintsUsed(0);
          setGpsEnabled(false);
          setGpsError(null);
          setGpsRequesting(false);
          setLocationSkipped(false);
          setUserLocation(null);
          setDistance(null);
          setLocationStatus("locationUnavailable");
          setLoadError(null);
          startedAtRef.current = Date.now();
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [questId, startEpisodeNo]);

  useEffect(() => {
    if (!gpsEnabled) {
      setDistance(null);
      setLocationStatus("locationUnavailable");
      if (watchIdRef.current != null && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!currentCoords || typeof navigator === "undefined" || !navigator.geolocation) {
      setDistance(null);
      setLocationStatus("locationUnavailable");
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const nextLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setUserLocation(nextLocation);

        const d = haversineDistance(
          nextLocation.lat,
          nextLocation.lng,
          currentCoords.lat,
          currentCoords.lng
        );
        setDistance(d);
        setLocationStatus(d <= NEAR_THRESHOLD_M ? "nearTarget" : "tooFar");
      },
      () => {
        setLocationStatus("locationUnavailable");
      },
      { enableHighAccuracy: false, maximumAge: 3000, timeout: 10000 }
    );

    return () => {
      if (watchIdRef.current != null && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [gpsEnabled, currentCoords?.lat, currentCoords?.lng]);

  useEffect(() => {
    return () => {
      clearSceneTransitionTimers();
      clearOpeningPrologueAutoTimer();
    };
  }, [clearSceneTransitionTimers, clearOpeningPrologueAutoTimer]);

  useEffect(() => {
    clearOpeningPrologueAutoTimer();
    if (mode !== "opening_prologue") return;

    openingPrologueAutoTimerRef.current = setTimeout(() => {
      beginOpeningPrologueFlow();
    }, OPENING_PROLOGUE_AUTO_ADVANCE_MS);

    return () => {
      clearOpeningPrologueAutoTimer();
    };
  }, [mode, beginOpeningPrologueFlow, clearOpeningPrologueAutoTimer]);

  useEffect(() => {
    if (mode === "puzzle") {
      beginPostStory();
    }
  }, [mode, beginPostStory]);

  const travelStatusText = !gpsEnabled
    ? locationSkipped
      ? "位置情報をスキップして進行中です。到着ボタンで物語を続けられます。"
      : "現在地を有効化すると、目的地への到着判定が利用できます。"
    : locationStatus === "nearTarget"
      ? "スポット付近です。到着ボタンを押して物語を進めてください。"
      : locationStatus === "tooFar"
        ? "スポット付近まで近づくと開始ボタンが有効になります。"
        : "現在地を測位しています…";

  if (loading) {
    return (
      <View className="flex-1 bg-[#12100E] items-center justify-center">
        <ActivityIndicator color="#EE8C2B" />
        <Text className="mt-3 text-sm text-white" style={{ fontFamily: fonts.displayBold }}>
          プレイデータを読み込んでいます
        </Text>
      </View>
    );
  }

  if (loadError || !quest || !currentSpot) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-[#F8F7F6]">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-xl text-[#221910] mb-3 text-center" style={{ fontFamily: fonts.displayBold }}>
            ゲームプレイを開始できません
          </Text>
          <Text className="text-sm text-[#6C5647] text-center" style={{ fontFamily: fonts.bodyRegular }}>
            {loadError || "必要なデータが不足しています。"}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const isCinematicPrologue = mode === "prologue";
  const hideHudForOpening = mode === "opening_prologue" || isCinematicPrologue;
  const isPuzzleEnabled = false;
  const isMapMode = mode === "travel" || mode === "location_gate";
  const spotBackgroundImage = currentSpot.backgroundImage || quest.coverImageUrl || undefined;
  const isStartPointPhase = currentSpotIndex === 0 && !hasPlayedOpeningPrologue;
  const mapMaskClass = isMapMode || isCinematicPrologue ? "bg-transparent" : "bg-black/62";
  const compactViewport = viewportWidth <= 390;
  const narrowViewport = viewportWidth <= 360;
  const topShadeHeight = clampNumber(
    Math.round(viewportHeight * (narrowViewport ? 0.11 : 0.13)),
    68,
    136
  );
  const isNarrativeShadeMode =
    mode === "prologue" || mode === "story_pre" || mode === "story_post" || mode === "epilogue";
  const bottomShadeHeight = clampNumber(
    Math.round(
      viewportHeight *
        (isNarrativeShadeMode
          ? narrowViewport
            ? 0.27
            : 0.30
          : narrowViewport
            ? 0.2
            : 0.23)
    ),
    isNarrativeShadeMode ? 132 : 112,
    isNarrativeShadeMode ? 280 : 220
  );
  const topHudHorizontalPadding = narrowViewport ? 12 : 16;
  const topHudVerticalPadding = clampNumber(
    (insets.top || 0) + (narrowViewport ? 8 : 10),
    16,
    72
  );
  const travelCardMaxHeight = clampNumber(
    Math.round(viewportHeight * (compactViewport ? 0.64 : 0.6)),
    270,
    narrowViewport ? 420 : 500
  );
  const mapTopControlIsLight = isMapMode;
  const hudSurfaceStyle = mapTopControlIsLight
    ? {
        shadowColor: "#000000",
        shadowOpacity: 0.16,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      }
    : undefined;
  const hudCenterClass = mapTopControlIsLight
    ? "mx-2 flex-1 rounded-full bg-white/93 px-3 py-1 border border-black/15 items-center"
    : "mx-2 flex-1 rounded-full bg-black/72 px-3 py-1 border border-white/25 items-center";
  const hudNarrativeTextClass = mapTopControlIsLight
    ? "text-[10px] tracking-[1.6px] text-[#5F4A38]"
    : "text-[10px] tracking-[1.6px] text-[#F7E2C4]";
  const hudSpotChipClass = mapTopControlIsLight
    ? "rounded-full bg-white/93 px-3 py-1 border border-black/15"
    : "rounded-full bg-black/72 px-3 py-1 border border-white/25";
  const hudSpotTextClass = mapTopControlIsLight
    ? "text-[10px] text-[#2A231C]"
    : "text-[10px] text-white/85";
  const travelUseLightPalette = isMapMode || isStartPointPhase;
  const travelTitleClass = travelUseLightPalette ? "text-[#2B1E16]" : "text-white";
  const travelStatusClass = travelUseLightPalette ? "text-[#475569]" : "text-white/75";
  const travelSectionLabelClass = travelUseLightPalette ? "text-[#64748B]" : "text-[#F6D4A7]";
  const travelWalkMetaClass = travelUseLightPalette ? "text-[#64748B]" : "text-white/70";
  const travelStoryCardClass = travelUseLightPalette
    ? "mt-2 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2"
    : "mt-2 rounded-xl border border-white/15 bg-white/6 px-3 py-2";
  const travelStoryLabelClass = travelUseLightPalette ? "text-[#64748B]" : "text-[#F6D4A7]";
  const travelStoryBodyClass = travelUseLightPalette ? "text-[#334155]" : "text-white/82";

  const isPuzzleSolved =
    puzzleState === "correct" || puzzleState === "revealedAnswer";
  const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
  const isNarrativeMode =
    mode === "prologue" || mode === "story_pre" || mode === "story_post" || mode === "epilogue";
  const showImmersionHud =
    false;
  const showTravelStoryLog = false;
  const modePhaseLabel = phaseLabelByMode(mode, currentSpot.name);
  const objectiveText = objectiveByMode(mode, currentSpot.name, nextSpot?.name);
  const companionPreview = (quest.characters || []).slice(0, 2);
  const previousSpot = quest.spots[Math.max(0, currentSpotIndex - 1)] || null;
  const previousMemoryText = previousSpot
    ? pickNarrativePreview(
        previousSpot.postMessages?.[0]?.text ||
          previousSpot.description ||
          "この地点での選択は記録されました。",
        "この地点での選択は記録されました。",
        54
      )
    : "まだ記録はありません。最初の選択を作りましょう。";
  const nextCueText = pickNarrativePreview(
    currentSpot.preMessages?.[0]?.text || currentSpot.description,
    "次の手がかりへ向かいましょう。",
    58
  );
  const clearedSpots = Math.min(
    currentSpotIndex + (mode === "completed" ? 1 : 0),
    quest.spots.length
  );
  const journeyScore = computeJourneyScore({
    durationSeconds,
    wrongAnswers,
    hintsUsed,
    totalSpots: quest.spots.length,
    clearedSpots,
  });
  const journeyRank = journeyRankMeta(journeyScore);
  const journeyRankToneClass =
    journeyRank.rank === "S"
      ? "bg-[#2A6B4C] border-[#95DFB1]/60 text-[#D5F6DE]"
      : journeyRank.rank === "A"
        ? "bg-[#2B4B75] border-[#8FC6FF]/50 text-[#D9EEFF]"
        : journeyRank.rank === "B"
          ? "bg-[#5E4A2E] border-[#F1CB95]/55 text-[#FDE7C8]"
          : "bg-[#5A2E2E] border-[#F0A9A9]/55 text-[#FFDCDC]";
  const journeyRankTextClass =
    journeyRank.rank === "S"
      ? "text-[#D5F6DE]"
      : journeyRank.rank === "A"
        ? "text-[#D9EEFF]"
        : journeyRank.rank === "B"
          ? "text-[#FDE7C8]"
          : "text-[#FFDCDC]";

  return (
    <View className="flex-1 bg-black">
      {isMapMode ? (
        <WebGameMap
          spots={quest.spots}
          currentSpotIndex={currentSpotIndex}
          fallbackEmbedUrl={mapFallbackEmbedUrl}
        />
      ) : isCinematicPrologue ? (
        <View className="absolute inset-0 bg-black" />
      ) : (
        <Image
          source={{ uri: spotBackgroundImage }}
          className="absolute inset-0 w-full h-full"
          resizeMode="cover"
        />
      )}

      <View className={`absolute inset-0 ${mapMaskClass}`} pointerEvents="none" />
      {!isMapMode && !isCinematicPrologue ? (
        <>
          <View
            className="absolute top-0 left-0 right-0 bg-black/45"
            style={{ height: topShadeHeight }}
            pointerEvents="none"
          />
          <View
            className="absolute bottom-0 left-0 right-0 bg-black/55"
            style={{ height: bottomShadeHeight }}
            pointerEvents="none"
          />
        </>
      ) : null}

      {sceneTransitionVisible ? (
        <View className="absolute inset-0 z-40 bg-black/30" pointerEvents="none" />
      ) : null}

      {!hideHudForOpening ? (
        <View
          className="absolute top-0 left-0 right-0 z-40"
          style={{
            paddingHorizontal: topHudHorizontalPadding,
            paddingTop: topHudVerticalPadding,
          }}
        >
          <View className="flex-row items-center justify-center">
            {isNarrativeMode ? (
              <View className={hudCenterClass} style={hudSurfaceStyle}>
                <Text className={hudNarrativeTextClass} style={{ fontFamily: fonts.displayBold }}>
                  {modePhaseLabel}
                </Text>
              </View>
            ) : (
              <View className={hudSpotChipClass} style={hudSurfaceStyle}>
                <Text className={hudSpotTextClass} style={{ fontFamily: fonts.displayBold }}>
                  SPOT {Math.min(currentSpotIndex + 1, quest.spots.length)} / {quest.spots.length}
                </Text>
              </View>
            )}
          </View>

          {showImmersionHud ? (
            <View className="mt-2 rounded-2xl border border-[#E7BE8C]/30 bg-black/62 px-3.5 py-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-[10px] tracking-[1.8px] text-[#F6D4A7]" style={{ fontFamily: fonts.displayBold }}>
                  {modePhaseLabel}
                </Text>
                <Text className="text-[10px] text-white/70" style={{ fontFamily: fonts.bodyRegular }}>
                  SPOT {Math.min(currentSpotIndex + 1, quest.spots.length)} / {quest.spots.length}
                </Text>
              </View>

              <Text className="mt-1 text-[13px] leading-5 text-white" style={{ fontFamily: fonts.bodyMedium }}>
                {objectiveText}
              </Text>

              <View className="mt-2 flex-row items-start">
                <View className="flex-1 pr-2">
                  <Text className="text-[10px] tracking-[1.6px] text-[#EBC28F]" style={{ fontFamily: fonts.displayBold }}>
                    次の導入
                  </Text>
                  <Text className="mt-1 text-[11px] leading-5 text-white/82" style={{ fontFamily: fonts.bodyRegular }}>
                    {nextCueText}
                  </Text>
                </View>

                <View className="max-w-[44%] items-end">
                  <Text className="text-[10px] tracking-[1.6px] text-[#EBC28F]" style={{ fontFamily: fonts.displayBold }}>
                    同行キャラ
                  </Text>
                  <View className="mt-1 flex-row flex-wrap justify-end gap-1.5">
                    {companionPreview.map((character) => (
                      <View
                        key={`web-hud-companion-${character.id}`}
                        className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5"
                      >
                        <Text className="text-[10px] text-white/90" style={{ fontFamily: fonts.displayBold }}>
                          {character.name}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>

              <View className="mt-2 rounded-xl border border-white/12 bg-white/8 px-2.5 py-2">
                <Text className="text-[10px] tracking-[1.4px] text-white/65" style={{ fontFamily: fonts.displayBold }}>
                  前章の記録
                </Text>
                <Text className="mt-1 text-[11px] leading-5 text-white/82" style={{ fontFamily: fonts.bodyRegular }}>
                  {previousMemoryText}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {mode === "location_gate" ? (
        <View className="absolute inset-0 z-30 items-center justify-center px-6">
          <View className="w-full rounded-2xl border border-[#E5DED7] bg-white px-5 py-5">
            <Text className="text-[11px] text-[#8A6C54] tracking-[1.5px] mb-2" style={{ fontFamily: fonts.displayBold }}>
              LOCATION CHECK
            </Text>
            <Text className="text-[#2B2118] text-lg mb-2" style={{ fontFamily: fonts.displayBold }}>
              位置情報を有効化して開始
            </Text>
            <Text className="text-[#5A4B3F] text-sm leading-6 mb-4" style={{ fontFamily: fonts.bodyRegular }}>
              現在地の到着判定を使って、より実際の街歩きに近い体験で進行します。デモ確認の場合はスキップ開始も可能です。
            </Text>
            <View className="rounded-xl border border-[#E9E1D9] bg-[#F8F5F2] px-3 py-3 mb-4">
              <Text className="text-[#8A6C54] text-[10px] tracking-[1.5px] mb-1" style={{ fontFamily: fonts.displayBold }}>
                現在のスポット
              </Text>
              <Text className="text-[#2B2118] text-sm" style={{ fontFamily: fonts.displayBold }}>
                {currentSpot.name}
              </Text>
            </View>

            {gpsError ? (
              <Text className="text-xs text-[#B33B2F] mb-3" style={{ fontFamily: fonts.bodyRegular }}>
                {gpsError}
              </Text>
            ) : null}

            <Pressable
              onPress={handleEnableLocationGate}
              disabled={gpsRequesting}
              className={`h-11 rounded-xl items-center justify-center ${
                gpsRequesting ? "bg-[#EE8C2B]/60" : "bg-[#EE8C2B]"
              }`}
            >
              <Text className="text-white text-sm" style={{ fontFamily: fonts.displayBold }}>
                {gpsRequesting ? "位置情報を取得中…" : "位置情報を有効化して開始"}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleSkipLocationGate}
              className="mt-2 h-11 rounded-xl border border-[#DDD1C4] bg-[#FBF8F5] items-center justify-center"
            >
              <Text className="text-[#6A5746] text-sm" style={{ fontFamily: fonts.displayBold }}>
                デモとして開始（位置情報スキップ）
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {mode === "opening_prologue" ? (
        <View className="absolute inset-0 z-50 bg-[#0A0807]">
          <Image
            source={{ uri: spotBackgroundImage }}
            className="absolute inset-0 w-full h-full"
            resizeMode="cover"
          />
          <View className="absolute inset-0 bg-black/45" />
          <View className="absolute inset-0 bg-[#FA7C33]/12" />

          <SafeAreaView edges={["top", "bottom"]} className="relative flex-1 px-6 py-3">
            <View className="absolute inset-0 items-center justify-center px-8">
              <Text
                className="text-[#F5D7B0] text-[32px] tracking-[3px]"
                style={{
                  fontFamily: fonts.displayBold,
                  textShadowColor: "rgba(0,0,0,0.65)",
                  textShadowOffset: { width: 0, height: 2 },
                  textShadowRadius: 8,
                }}
              >
                まもなく開始…
              </Text>
            </View>
          </SafeAreaView>
        </View>
      ) : null}

      {mode === "travel" ? (
        <SafeAreaView
          edges={["bottom"]}
          className="absolute bottom-0 left-0 right-0 z-30 bg-transparent"
        >
          <View
            className="bg-white px-4 pt-4"
            style={{
              maxHeight: travelCardMaxHeight,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              shadowColor: "#000000",
              shadowOpacity: 0.2,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: -8 },
              elevation: 14,
            }}
          >
            <View className="items-center mb-4">
              <View className="w-12 h-1.5 rounded-full bg-[#E5E7EB]" />
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={{ paddingBottom: 10 }}
            >
            <Text
              className={`text-[11px] tracking-[2px] ${travelSectionLabelClass}`}
              style={{ fontFamily: fonts.displayBold }}
            >
              {isStartPointPhase ? "START POINT" : "NEXT SPOT"}
            </Text>
            <Text
              className={`text-lg mt-1 ${travelTitleClass}`}
              style={{ fontFamily: fonts.displayBold }}
            >
              {currentSpot.name}
            </Text>

            <Text
              className={`text-xs mt-1 ${travelStatusClass}`}
              style={{ fontFamily: fonts.bodyRegular }}
            >
              {travelStatusText}
            </Text>

            {showTravelStoryLog ? (
              <View className={travelStoryCardClass}>
                <Text
                  className={`text-[10px] tracking-[1.6px] ${travelStoryLabelClass}`}
                  style={{ fontFamily: fonts.displayBold }}
                >
                  STORY LOG
                </Text>
                <Text
                  className={`mt-1 text-[11px] ${travelStoryBodyClass}`}
                  style={{ fontFamily: fonts.bodyRegular }}
                >
                  前章: {previousMemoryText}
                </Text>
                <Text
                  className={`mt-1 text-[11px] ${travelStoryBodyClass}`}
                  style={{ fontFamily: fonts.bodyRegular }}
                >
                  次の導入: {nextCueText}
                </Text>
              </View>
            ) : null}

            <Text
              className={`text-xs mt-1 ${travelWalkMetaClass}`}
              style={{ fontFamily: fonts.bodyRegular }}
            >
              目的地まで: {formatDistance(distance)}
              {nextSpot ? ` / 次のスポット: ${nextSpot.name}` : " / 最終スポット"}
            </Text>

            <View className="mt-3 flex-row items-center gap-2">
              {!gpsEnabled && !locationSkipped ? (
                <Pressable
                  onPress={() => {
                    void requestGpsPermission();
                  }}
                  className="flex-1 h-10 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] items-center justify-center"
                >
                  <Text className="text-[#475569] text-sm" style={{ fontFamily: fonts.bodyMedium }}>
                    現在地を有効化
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={openMapApp}
                className={`h-10 rounded-xl items-center justify-center ${
                  !gpsEnabled && !locationSkipped
                    ? "px-4 border border-[#E5E7EB] bg-[#F8FAFC]"
                    : travelUseLightPalette
                    ? "px-4 border border-[#E5E7EB] bg-[#F8FAFC]"
                    : "flex-1 border border-[#E5E7EB] bg-[#F8FAFC]"
                }`}
              >
                <Text className="text-sm text-[#475569]" style={{ fontFamily: fonts.bodyMedium }}>
                  地図を開く
                </Text>
              </Pressable>

              <Pressable
                onPress={handleArrive}
                disabled={!canArrive}
                className={`flex-1 h-10 rounded-xl items-center justify-center ${
                  canArrive ? "bg-[#EE8C2B]" : "bg-[#CBD5E1]"
                }`}
              >
                <Text className="text-white text-sm" style={{ fontFamily: fonts.displayBold }}>
                  {isStartPointPhase ? "到着してゲーム開始" : "到着して次の物語へ"}
                </Text>
              </Pressable>
            </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      ) : null}

      {mode === "prologue" && activeDialogue ? (
        <PrologueCinematicOverlay
          line={activeDialogue}
          isLast={dialogueIndex >= dialogues.length - 1}
          onComplete={handleDialogueNext}
        />
      ) : null}

      {(mode === "story_pre" || mode === "story_post" || mode === "epilogue") && activeDialogue ? (
        <TypewriterDialogueOverlay
          line={activeDialogue}
          isLast={dialogueIndex >= dialogues.length - 1}
          resolveCharacter={resolveCharacter}
          onComplete={handleDialogueNext}
          topShadeHeight={topShadeHeight}
          bottomShadeHeight={bottomShadeHeight}
        />
      ) : null}

      {mode === "puzzle" && isPuzzleEnabled ? (
        <SafeAreaView edges={["bottom"]} className="absolute inset-0 z-30 justify-end px-4 pb-4">
          <View className="rounded-2xl border border-[#EE8C2B]/30 bg-[#1F1A16]/92 px-4 py-4">
            <Text className="text-[11px] text-[#F6D4A7] tracking-[1.8px]" style={{ fontFamily: fonts.displayBold }}>
              PUZZLE
            </Text>
            <Text className="mt-2 text-white text-[15px] leading-7" style={{ fontFamily: fonts.bodyRegular }}>
              {puzzlePromptText}
            </Text>

            {hasChoicePuzzle ? (
              <View className="mt-3 gap-2">
                {puzzleChoices.map((choice) => {
                  const isSelected = selectedChoiceId === choice.id;
                  const isCorrectReveal =
                    revealedCorrectChoiceId === choice.id &&
                    (puzzleState === "correct" || puzzleState === "revealedAnswer");

                  const toneClass = isCorrectReveal
                    ? "border-[#7CD7A0] bg-[#1A3A2A]"
                    : isSelected
                      ? "border-[#EE8C2B] bg-[#2B2118]"
                      : "border-white/20 bg-white/5";

                  return (
                    <Pressable
                      key={choice.id}
                      onPress={() => {
                        if (isPuzzleSolved) return;
                        setSelectedChoiceId(choice.id);
                        setPuzzleInput(choice.text);
                        setPuzzleError(null);
                      }}
                      className={`rounded-xl border px-3 py-3 ${toneClass}`}
                    >
                      <Text className="text-[#F6D4A7] text-xs mb-1" style={{ fontFamily: fonts.displayBold }}>
                        {choice.label}
                      </Text>
                      <Text className="text-white text-sm" style={{ fontFamily: fonts.bodyRegular }}>
                        {choice.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <TextInput
                value={puzzleInput}
                onChangeText={(value) => {
                  setPuzzleInput(value);
                  setPuzzleError(null);
                  if (puzzleState !== "idle") {
                    setPuzzleState("idle");
                    setConsequence(null);
                  }
                }}
                editable={!isPuzzleSolved}
                placeholder="答えを入力"
                placeholderTextColor="#B7AA9B"
                className="mt-3 h-11 rounded-xl border border-white/20 bg-black/20 px-3 text-white"
                style={{ fontFamily: fonts.bodyRegular }}
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}

            {primaryChoiceHint && revealedHintLevel > 0 && hasChoicePuzzle ? (
              <View className="mt-3 rounded-xl border border-[#E5D2BC]/40 bg-[#2E241B] px-3 py-2">
                <Text className="text-[11px] text-[#F6D4A7]" style={{ fontFamily: fonts.displayBold }}>
                  ヒント
                </Text>
                <Text className="text-sm text-white/90 mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                  {primaryChoiceHint}
                </Text>
              </View>
            ) : null}

            {!hasChoicePuzzle && visibleHints.length > 0 ? (
              <View className="mt-3 gap-2">
                {visibleHints.map((hint, index) => (
                  <View
                    key={`hint-${index}`}
                    className="rounded-xl border border-[#E5D2BC]/40 bg-[#2E241B] px-3 py-2"
                  >
                    <Text className="text-[11px] text-[#F6D4A7]" style={{ fontFamily: fonts.displayBold }}>
                      ヒント {index + 1}
                    </Text>
                    <Text className="text-sm text-white/90 mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                      {hint}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {puzzleError ? (
              <Text className="mt-3 text-xs text-[#FFC7C3]" style={{ fontFamily: fonts.bodyRegular }}>
                {puzzleError}
              </Text>
            ) : null}

            {consequence ? (
              <Text className="mt-3 text-xs text-[#D7F1DF]" style={{ fontFamily: fonts.bodyRegular }}>
                {consequence}
              </Text>
            ) : null}

            <View className="mt-3 flex-row items-center gap-2">
              <Pressable
                onPress={handleRevealHint}
                className="h-10 px-4 rounded-xl border border-white/20 bg-white/10 items-center justify-center"
              >
                <Text className="text-white/90 text-sm" style={{ fontFamily: fonts.bodyMedium }}>
                  ヒント
                </Text>
              </Pressable>
              <Pressable
                onPress={handleRevealAnswer}
                className="h-10 px-4 rounded-xl border border-white/20 bg-white/10 items-center justify-center"
              >
                <Text className="text-white/90 text-sm" style={{ fontFamily: fonts.bodyMedium }}>
                  答えを見る
                </Text>
              </Pressable>
              <Pressable
                onPress={handleSubmitPuzzle}
                className="flex-1 h-10 rounded-xl bg-[#EE8C2B] items-center justify-center"
              >
                <Text className="text-white text-sm" style={{ fontFamily: fonts.displayBold }}>
                  {isPuzzleSolved ? "次へ進む" : "回答する"}
                </Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      ) : null}

      {mode === "completed" ? (
        <View className="absolute inset-0 z-40 items-center justify-center bg-black/70 px-6">
          <View className="w-full rounded-2xl border border-[#EE8C2B]/35 bg-black/65 px-6 py-6">
            <View className={`w-16 h-16 rounded-full border items-center justify-center self-center mb-3 ${journeyRankToneClass}`}>
              <Text className={`text-2xl ${journeyRankTextClass}`} style={{ fontFamily: fonts.displayBold }}>
                {journeyRank.rank}
              </Text>
            </View>
            <Text className="text-white text-lg text-center mb-2" style={{ fontFamily: fonts.displayBold }}>
              エピソード完了
            </Text>
            <Text className="text-[#F6D4A7] text-sm text-center mb-1" style={{ fontFamily: fonts.displayBold }}>
              記憶ランク {journeyRank.rank} · スコア {journeyScore}
            </Text>
            <Text className="text-white/70 text-sm text-center mb-4" style={{ fontFamily: fonts.bodyRegular }}>
              {journeyRank.comment}
            </Text>
            <View className="rounded-xl bg-white/8 border border-white/15 px-4 py-3 mb-4">
              <Text className="text-xs text-white/75" style={{ fontFamily: fonts.bodyRegular }}>
                所要時間: {formatDuration(durationSeconds)}
              </Text>
              <Text className="text-xs text-white/75 mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                訪問スポット: {currentSpotIndex + 1}/{quest.spots.length}
              </Text>
              <Text className="text-xs text-white/75 mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                ミス回答: {wrongAnswers} / ヒント使用: {hintsUsed}
              </Text>
            </View>
            <View>
              <Pressable
                className="h-10 rounded-xl bg-[#EE8C2B] items-center justify-center"
                onPress={() => {
                  setCurrentSpotIndex(0);
                  setMode("location_gate");
                  setDialogues([]);
                  setDialogueIndex(0);
                  setHasPlayedOpeningPrologue(false);
                  setPuzzleInput("");
                  setPuzzleState("idle");
                  setPuzzleError(null);
                  setAttemptCount(0);
                  setRevealedHintLevel(0);
                  setSelectedChoiceId(null);
                  setRevealedCorrectChoiceId(null);
                  setConsequence(null);
                  setWrongAnswers(0);
                  setHintsUsed(0);
                  setGpsEnabled(false);
                  setLocationSkipped(false);
                  setGpsError(null);
                  setDistance(null);
                  setLocationStatus("locationUnavailable");
                  startedAtRef.current = Date.now();
                }}
              >
                <Text className="text-white text-sm" style={{ fontFamily: fonts.displayBold }}>
                  もう一度
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
};
