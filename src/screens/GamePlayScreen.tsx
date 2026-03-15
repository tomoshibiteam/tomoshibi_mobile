import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import MapView, { Marker, Polyline } from "react-native-maps";
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
import { getSupabaseOrThrow, isSupabaseConfigured } from "@/lib/supabase";
import { useSessionUserId } from "@/hooks/useSessionUser";

type Props = NativeStackScreenProps<RootStackParamList, "GamePlay">;

type Mode =
  | "briefing"
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

type PuzzleChoice = {
  id: string;
  label: string;
  text: string;
};

type DialogueLine = {
  id: string;
  speakerType: "narrator" | "character" | "system";
  characterId?: string | null;
  characterName?: string | null;
  avatarUrl?: string | null;
  text: string;
};

type DialogueCharacter = {
  id: string;
  name: string;
  role: string;
  avatarUrl: string | null;
};

type ConsequenceTone = "success" | "error";

type LocationStatus = "locationUnavailable" | "tooFar" | "nearTarget";
type JourneyRank = "S" | "A" | "B" | "C";

const CHOICE_LINE_PATTERN = /^\s*([A-Za-zＡ-Ｚａ-ｚ0-9０-９])[\.．:：\)）]\s*(.+)$/;
const AUTO_CHOICE_LABELS = ["A", "B", "C", "D"] as const;
const NEAR_THRESHOLD_M = 120;
const DEFAULT_MAP_CENTER = { lat: 35.681236, lng: 139.767125 };
const DIALOGUE_CHUNK_MAX_CHARS = 66;
const DIALOGUE_CHUNK_MAX_LINES = 3;
const DIALOGUE_CHARS_PER_LINE_ESTIMATE = 22;
const OPENING_PROLOGUE_AUTO_ADVANCE_MS = 1800;

const buildGoogleSearchUrl = (query: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || "日本")}`;

const toCoordinate = (
  lat?: number | null,
  lng?: number | null
): { lat: number; lng: number } | null => {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const normalizeText = (value?: string | null) =>
  (value || "").replace(/\s+/g, " ").trim();

const splitToNarrationLines = (raw?: string | null): string[] => {
  const normalized = normalizeText(raw);
  if (!normalized) return [];
  return splitDialogueText(normalized, DIALOGUE_CHUNK_MAX_CHARS);
};

const normalizeSpeakerName = (value?: string | null) =>
  normalizeText(value).toLowerCase();

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractSpeakerFromText = (raw: string) => {
  const text = raw.trim();
  if (!text) return null;

  const quoteMatch = text.match(/^\s*([^\s「」『』"“”]{1,20})[「『"“]([\s\S]+)[」』"”]\s*$/);
  if (quoteMatch) {
    return { name: quoteMatch[1].trim(), text: quoteMatch[2].trim() };
  }

  const colonMatch = text.match(/^\s*([^\s:：]{1,20})[:：]\s*([\s\S]+)$/);
  if (colonMatch) {
    return { name: colonMatch[1].trim(), text: colonMatch[2].trim() };
  }

  return null;
};

const inferCharacterId = (name?: string | null): string | null => {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (name.includes("蓮") || lower.includes("ren")) return "ren";
  if (name.includes("遥") || lower.includes("haruka")) return "haruka";
  return null;
};

const normalizeStoryMessages = (messages: GameplayMessage[]) => {
  const nameToAvatar = new Map<string, string>();

  messages.forEach((message) => {
    const speakerName = normalizeSpeakerName(message.name);
    if (speakerName && message.avatarUrl) {
      nameToAvatar.set(speakerName, message.avatarUrl);
    }
  });

  return messages.map((message) => {
    if (message.speakerType === "system") return message;

    const next: GameplayMessage = { ...message };
    const parsed = extractSpeakerFromText(message.text || "");

    if (parsed) {
      if (!next.name || next.speakerType !== "character") {
        next.name = parsed.name;
        next.speakerType = "character";
      }
      next.text = parsed.text;
    } else if (next.name) {
      const escapedName = escapeRegExp(next.name.trim());
      const quoted = (message.text || "").match(
        new RegExp(`^\\s*${escapedName}\\s*[「『"“]([\\s\\S]+)[」』"”]\\s*$`)
      );
      if (quoted) {
        next.text = quoted[1].trim();
      } else {
        const coloned = (message.text || "").match(
          new RegExp(`^\\s*${escapedName}\\s*[:：]\\s*([\\s\\S]+)$`)
        );
        if (coloned) {
          next.text = coloned[1].trim();
        }
      }
    }

    const speakerName = normalizeSpeakerName(next.name);
    if (!next.avatarUrl && speakerName) {
      next.avatarUrl = nameToAvatar.get(speakerName) || null;
    }

    return next;
  });
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

const isAsciiWord = (value: string) => /^[a-z0-9]+$/i.test(value);

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

const formatDuration = (seconds: number) => {
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}分${remain}秒`;
};

const formatDistance = (value: number | null) => {
  if (value == null) return "—";
  if (value < 1000) return `${Math.round(value)}m`;
  return `${(value / 1000).toFixed(1)}km`;
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
    case "briefing":
      return "SAFETY BRIEF";
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
    case "briefing":
      return "安全事項を確認して、街歩きの準備を完了してください。";
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

  const leftName = normalizeSpeakerName(left.characterName);
  const rightName = normalizeSpeakerName(right.characterName);

  if (left.speakerType === "character") {
    if (left.characterId && right.characterId && left.characterId !== right.characterId) return false;
    if (leftName && rightName && leftName !== rightName) return false;
    return true;
  }

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
      characterId: prev.characterId || line.characterId || null,
      characterName: prev.characterName || line.characterName || null,
      avatarUrl: prev.avatarUrl || line.avatarUrl || null,
      text: mergedText,
    };
  });

  return compacted;
};

const toDialogues = (
  messages: GameplayMessage[],
  fallbackText: string,
  options?: {
    nameToCharacterId?: Map<string, string>;
    defaultCharacterId?: string | null;
  }
): DialogueLine[] => {
  if (!messages.length) {
    return [
      {
        id: "fallback",
        speakerType: "narrator",
        characterId: null,
        characterName: null,
        text: fallbackText,
      },
    ];
  }

  const normalizedMessages = normalizeStoryMessages(messages);
  const mapped: DialogueLine[] = [];

  normalizedMessages.forEach((message, index) => {
    const speakerType =
      message.speakerType === "character"
        ? "character"
        : message.speakerType === "system"
          ? "system"
          : "narrator";

    const speakerName = normalizeSpeakerName(message.name);
    const mappedCharacterId = speakerName
      ? options?.nameToCharacterId?.get(speakerName)
      : null;

    const characterId =
      speakerType === "character"
        ? mappedCharacterId ||
          inferCharacterId(message.name) ||
          options?.defaultCharacterId ||
          null
        : null;

    const baseText = normalizeText(message.text) || fallbackText;
    const textChunks = splitDialogueText(baseText);
    const sourceId = message.id || `msg-${index}`;

    textChunks.forEach((text, chunkIndex) => {
      mapped.push({
        id: `${sourceId}-${chunkIndex}`,
        speakerType,
        characterId,
        characterName: message.name || null,
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
          characterId: null,
          characterName: null,
          avatarUrl: null,
          text: fallbackText,
        },
      ];
};

const ensureCharacterPresence = (
  lines: DialogueLine[],
  fallbackCharacterId: string | null,
  fallbackCharacterName: string,
  fallbackText: string
): DialogueLine[] => {
  if (lines.some((line) => line.characterId || line.speakerType === "character")) return lines;
  return [
    ...lines,
    {
      id: "fallback-character",
      speakerType: "character",
      characterId: fallbackCharacterId,
      characterName: fallbackCharacterName || "案内人",
      avatarUrl: null,
      text: fallbackText,
    },
  ];
};

const FRONTEND_DEMO_IMAGES = [
  "https://images.unsplash.com/photo-1758535540741-de84a7c8ce9a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080",
  "https://images.unsplash.com/photo-1734313237450-d216cd6f5fb2?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080",
  "https://images.unsplash.com/photo-1688616128916-9c4f4a612e33?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080",
  "https://images.unsplash.com/photo-1766050472601-5ccb9fbc13e9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080",
] as const;

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
      lat: DEFAULT_MAP_CENTER.lat,
      lng: DEFAULT_MAP_CENTER.lng,
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
      lat: DEFAULT_MAP_CENTER.lat + 0.0024,
      lng: DEFAULT_MAP_CENTER.lng + 0.0018,
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

const SpotRouteStrip = ({
  spots,
  currentSpotIndex,
  theme = "dark",
}: {
  spots: GameplaySpot[];
  currentSpotIndex: number;
  theme?: "light" | "dark";
}) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={{ paddingRight: 4 }}
  >
    <View className="flex-row items-center gap-2">
      {spots.map((spot, index) => {
        const isCompleted = index < currentSpotIndex;
        const isCurrent = index === currentSpotIndex;
        const toneClass =
          theme === "light"
            ? isCompleted
              ? "border-[#8CC8A4]/80 bg-[#E8F6EE]"
              : isCurrent
                ? "border-[#E7BB8D]/80 bg-[#FFF3E7]"
                : "border-[#E4DCD4] bg-[#FAF7F4]"
            : isCompleted
              ? "border-[#95DFB1]/60 bg-[#2A6B4C]/35"
              : isCurrent
                ? "border-[#F6B76F]/70 bg-[#EE8C2B]/28"
                : "border-white/20 bg-white/10";
        const label = isCompleted ? "CLEAR" : isCurrent ? "NOW" : "NEXT";
        const labelClass =
          theme === "light"
            ? isCompleted
              ? "text-[#33744D]"
              : isCurrent
                ? "text-[#8A5E36]"
                : "text-[#7D6F63]"
            : isCompleted
              ? "text-[#B5F0CA]"
              : isCurrent
                ? "text-[#F8DAB3]"
                : "text-white/65";
        const textClass =
          theme === "light"
            ? isCompleted || isCurrent
              ? "text-[#2E251D]"
              : "text-[#5E5146]"
            : isCompleted || isCurrent
              ? "text-white"
              : "text-white/78";
        const chevronColor = theme === "light" ? "#7D6F63" : "#FFFFFF88";

        return (
          <View key={spot.id} className="flex-row items-center gap-2">
            <View className={`min-w-[98px] rounded-xl border px-2.5 py-1.5 ${toneClass}`}>
              <Text
                className={`text-[9px] tracking-[1.4px] ${labelClass}`}
                style={{ fontFamily: fonts.displayBold }}
              >
                {`SPOT ${index + 1} · ${label}`}
              </Text>
              <Text className={`mt-0.5 text-xs ${textClass}`} style={{ fontFamily: fonts.bodyMedium }} numberOfLines={1}>
                {spot.name}
              </Text>
            </View>
            {index < spots.length - 1 ? (
              <Ionicons name="chevron-forward" size={14} color={chevronColor} />
            ) : null}
          </View>
        );
      })}
    </View>
  </ScrollView>
);

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

  useEffect(() => {
    setDisplayedText("");
    setIsTyping(true);
    cardOpacity.setValue(0);
    cardTranslateY.setValue(16);

    let index = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const startTimer = setTimeout(() => {
      timer = setInterval(() => {
        if (index < line.text.length) {
          setDisplayedText(line.text.slice(0, index + 1));
          index += 1;
        } else {
          setIsTyping(false);
          if (timer) {
            clearInterval(timer);
          }
        }
      }, 32);
    }, 110);

    Animated.parallel([
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(cardTranslateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      clearTimeout(startTimer);
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [line.id, line.text, cardOpacity, cardTranslateY]);

  useEffect(() => {
    dialogueScrollRef.current?.scrollToEnd({ animated: false });
  }, [displayedText]);

  const handlePress = () => {
    if (isTyping) {
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
  const iconGlyphSize = compactWidth ? 11 : 12;

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
            isNarrator
              ? "bg-[#0D0A08]/94 border-white/28"
              : "bg-[#120E0B]/94 border-[#EE8C2B]/52"
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
              <Ionicons
                name={
                  tone === "character"
                    ? "person"
                    : tone === "system"
                      ? "flash-outline"
                    : "book-outline"
                }
                size={iconGlyphSize}
                color={tone === "character" ? "#EE8C2B" : "#D8D3CD"}
              />
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
  const { userId } = useSessionUserId();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [quest, setQuest] = useState<GameplayQuest | null>(null);
  const [currentSpotIndex, setCurrentSpotIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("location_gate");

  const [prologueDialogues, setPrologueDialogues] = useState<DialogueLine[]>([]);
  const [epilogueDialogues, setEpilogueDialogues] = useState<DialogueLine[]>([]);
  const [dialogues, setDialogues] = useState<DialogueLine[]>([]);
  const [dialogueIndex, setDialogueIndex] = useState(0);

  const [hasPlayedOpeningPrologue, setHasPlayedOpeningPrologue] = useState(false);
  const [prologueNextMode, setPrologueNextMode] =
    useState<PrologueNextMode>("travel");

  const [showArrival, setShowArrival] = useState(false);
  const [arrivalName, setArrivalName] = useState<string | null>(null);

  const [consequence, setConsequence] = useState<string | null>(null);
  const [consequenceTone, setConsequenceTone] =
    useState<ConsequenceTone | null>(null);

  const [puzzleInput, setPuzzleInput] = useState("");
  const [puzzleState, setPuzzleState] = useState<PuzzleState>("idle");
  const [puzzleError, setPuzzleError] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);
  const [revealedHintLevel, setRevealedHintLevel] = useState(0);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [revealedCorrectChoiceId, setRevealedCorrectChoiceId] = useState<string | null>(null);
  const [choiceAutoAdvancing, setChoiceAutoAdvancing] = useState(false);
  const [showChoiceHint, setShowChoiceHint] = useState(false);
  const [showPuzzleExplanation, setShowPuzzleExplanation] = useState(false);
  const [explanationAnswerText, setExplanationAnswerText] = useState<string | null>(null);

  const [wrongAnswers, setWrongAnswers] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [sessionSaved, setSessionSaved] = useState(false);

  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [gpsRequesting, setGpsRequesting] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [locationSkipped, setLocationSkipped] = useState(false);
  const [playerAvatarUrl, setPlayerAvatarUrl] = useState<string | null>(null);
  const [playerInitial, setPlayerInitial] = useState("U");
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [resolvedSpotCoords, setResolvedSpotCoords] = useState<
    Record<string, { lat: number; lng: number }>
  >({});
  const [geocodeFailedSpotIds, setGeocodeFailedSpotIds] = useState<
    Record<string, true>
  >({});
  const [distance, setDistance] = useState<number | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>(
    "locationUnavailable"
  );
  const [sceneTransitionVisible, setSceneTransitionVisible] = useState(false);

  const startedAtRef = useRef<number>(Date.now());
  const choiceFlowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrivalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consequenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openingPrologueAutoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneTransitionTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const previousModeRef = useRef<Mode | null>(null);
  const arriveCtaPulse = useRef(new Animated.Value(1)).current;

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

  const resolveSpotCoordinate = useCallback(
    (spot?: GameplaySpot | null) => {
      if (!spot) return null;
      return toCoordinate(spot.lat, spot.lng) || resolvedSpotCoords[spot.id] || null;
    },
    [resolvedSpotCoords]
  );

  const currentSpotCoords = useMemo(
    () => resolveSpotCoordinate(currentSpot),
    [resolveSpotCoordinate, currentSpot]
  );

  const nextSpotCoords = useMemo(
    () => resolveSpotCoordinate(nextSpot),
    [resolveSpotCoordinate, nextSpot]
  );

  const characterNameMap = useMemo(() => {
    const map = new Map<string, string>();
    (quest?.characters || []).forEach((character) => {
      const nameKey = normalizeSpeakerName(character.name);
      if (nameKey) {
        map.set(nameKey, character.id);
      }
      const idKey = normalizeSpeakerName(character.id);
      if (idKey) {
        map.set(idKey, character.id);
      }
    });
    return map;
  }, [quest?.characters]);

  const primaryCharacterId = quest?.characters?.[0]?.id || null;
  const secondaryCharacterId =
    quest?.characters?.[1]?.id || quest?.characters?.[0]?.id || null;

  const resolveCharacter = useCallback(
    (line: DialogueLine): DialogueCharacter | null => {
      if (!line.characterId && !line.characterName) return null;

      const byId =
        line.characterId && quest?.characters
          ? quest.characters.find((character) => character.id === line.characterId) || null
          : null;

      const nameKey = normalizeSpeakerName(line.characterName);
      const byNameOrId =
        !byId && nameKey && quest?.characters
          ? quest.characters.find((character) => {
              const candidateNameKey = normalizeSpeakerName(character.name);
              const candidateIdKey = normalizeSpeakerName(character.id);
              return candidateNameKey === nameKey || candidateIdKey === nameKey;
            }) || null
          : null;

      const resolved = byId || byNameOrId;

      if (resolved) {
        return {
          id: resolved.id,
          name: resolved.name,
          role: resolved.role,
          avatarUrl: line.avatarUrl || resolved.avatarUrl || null,
        };
      }

      const fallbackName = normalizeText(line.characterName) || "旅の同行者";
      return {
        id: line.characterId || `virtual:${fallbackName}`,
        name: fallbackName,
        role: "旅の同行者",
        avatarUrl: line.avatarUrl || null,
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

  const choiceShowResult =
    hasChoicePuzzle && (puzzleState === "correct" || puzzleState === "incorrect");
  const choiceIsCorrect = puzzleState === "correct";

  const puzzlePromptText =
    parsedPuzzle.prompt ||
    currentSpot?.puzzleQuestion ||
    "このスポットには謎が設定されていません。次へ進みましょう。";

  const primaryChoiceHint =
    currentSpot?.puzzleHints && currentSpot.puzzleHints.length > 0
      ? currentSpot.puzzleHints[0]
      : null;

  const visibleHints = useMemo(
    () => (currentSpot?.puzzleHints || []).slice(0, revealedHintLevel),
    [currentSpot?.puzzleHints, revealedHintLevel]
  );

  const clearChoiceFlowTimer = useCallback(() => {
    if (choiceFlowTimerRef.current) {
      clearTimeout(choiceFlowTimerRef.current);
      choiceFlowTimerRef.current = null;
    }
  }, []);

  const clearArrivalTimer = useCallback(() => {
    if (arrivalTimerRef.current) {
      clearTimeout(arrivalTimerRef.current);
      arrivalTimerRef.current = null;
    }
  }, []);

  const clearConsequenceTimer = useCallback(() => {
    if (consequenceTimerRef.current) {
      clearTimeout(consequenceTimerRef.current);
      consequenceTimerRef.current = null;
    }
  }, []);

  const clearOpeningPrologueAutoTimer = useCallback(() => {
    if (openingPrologueAutoTimerRef.current) {
      clearTimeout(openingPrologueAutoTimerRef.current);
      openingPrologueAutoTimerRef.current = null;
    }
  }, []);

  const clearSceneTransitionTimers = useCallback(() => {
    sceneTransitionTimersRef.current.forEach((timer) => clearTimeout(timer));
    sceneTransitionTimersRef.current = [];
  }, []);

  const triggerHaptic = useCallback((type: "soft" | "success" | "error") => {
    try {
      if (type === "success") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }
      if (type === "error") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      console.warn("GamePlayScreen: haptic feedback failed", error);
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
    clearChoiceFlowTimer();
    clearConsequenceTimer();

    setMode("travel");
    setPuzzleInput("");
    setPuzzleState("idle");
    setPuzzleError(null);
    setAttemptCount(0);
    setRevealedHintLevel(0);
    setSelectedChoiceId(null);
    setRevealedCorrectChoiceId(null);
    setChoiceAutoAdvancing(false);
    setShowChoiceHint(false);
    setShowPuzzleExplanation(false);
    setExplanationAnswerText(null);
    setConsequence(null);
    setConsequenceTone(null);
  }, [clearChoiceFlowTimer, clearConsequenceTimer]);

  const beginPrologue = useCallback(() => {
    setPrologueNextMode("travel");
    setDialogues(prologueDialogues);
    setDialogueIndex(0);
    setMode("prologue");
  }, [prologueDialogues]);

  const beginOpeningPrologueFlow = useCallback(() => {
    setPrologueNextMode("story_pre");
    setDialogues(prologueDialogues);
    setDialogueIndex(0);
    setMode("prologue");
  }, [prologueDialogues]);

  const beginEpilogue = useCallback(() => {
    setDialogues(epilogueDialogues);
    setDialogueIndex(0);
    setMode("epilogue");
  }, [epilogueDialogues]);

  const beginPreStory = useCallback(() => {
    if (!currentSpot) return;

    const sequence = (quest?.characters || []).map((character) => character.id);
    const fallbackCharacterId =
      sequence.length > 0
        ? sequence[currentSpotIndex % sequence.length] || primaryCharacterId
        : primaryCharacterId;
    const fallbackCharacter =
      (fallbackCharacterId && quest?.characters
        ? quest.characters.find((character) => character.id === fallbackCharacterId)
        : null) || null;

    clearArrivalTimer();
    setShowArrival(true);
    setArrivalName(currentSpot.name);
    arrivalTimerRef.current = setTimeout(() => {
      setShowArrival(false);
    }, 1800);

    const pre = ensureCharacterPresence(
      toDialogues(
        currentSpot.preMessages,
        currentSpot.description || "この場所の記録を読み解きましょう。",
        {
          nameToCharacterId: characterNameMap,
          defaultCharacterId: fallbackCharacterId,
        }
      ),
      fallbackCharacterId,
      fallbackCharacter?.name || "案内人",
      "この場所の違和感に目を向けると、次の手がかりが見えてきます。"
    );

    setDialogues(pre);
    setDialogueIndex(0);
    setMode("story_pre");
  }, [
    currentSpot,
    currentSpotIndex,
    primaryCharacterId,
    secondaryCharacterId,
    quest?.characters,
    characterNameMap,
    clearArrivalTimer,
  ]);

  const beginPostStory = useCallback(() => {
    if (!currentSpot) return;

    const sequence = (quest?.characters || []).map((character) => character.id);
    const fallbackCharacterId =
      sequence.length > 0
        ? sequence[(currentSpotIndex + 1) % sequence.length] || secondaryCharacterId
        : secondaryCharacterId;
    const fallbackCharacter =
      (fallbackCharacterId && quest?.characters
        ? quest.characters.find((character) => character.id === fallbackCharacterId)
        : null) || null;

    const post = ensureCharacterPresence(
      toDialogues(
        currentSpot.postMessages,
        currentSpot.puzzleSuccessMessage || "謎を解き明かしました。次の章へ進みましょう。",
        {
          nameToCharacterId: characterNameMap,
          defaultCharacterId: fallbackCharacterId,
        }
      ),
      fallbackCharacterId,
      fallbackCharacter?.name || "案内人",
      "この選択は記録されました。次のスポットへ進みましょう。"
    );

    setDialogues(post);
    setDialogueIndex(0);
    setMode("story_post");
  }, [
    currentSpot,
    currentSpotIndex,
    primaryCharacterId,
    secondaryCharacterId,
    quest?.characters,
    characterNameMap,
  ]);

  const openPuzzleExplanation = useCallback(
    (answerText: string | null) => {
      clearChoiceFlowTimer();
      setExplanationAnswerText(answerText ? normalizeText(answerText) : null);
      setShowPuzzleExplanation(true);
    },
    [clearChoiceFlowTimer]
  );

  const handleClosePuzzleExplanation = useCallback(() => {
    clearChoiceFlowTimer();
    setShowPuzzleExplanation(false);
    setChoiceAutoAdvancing(false);
    beginPostStory();
  }, [beginPostStory, clearChoiceFlowTimer]);

  const requestGpsPermission = useCallback(
    async (onGranted?: () => void) => {
      try {
        setGpsRequesting(true);
        setGpsError(null);

        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          setGpsError("位置情報の許可が拒否されています。設定から許可してください。");
          return;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        setLocationSkipped(false);
        setGpsEnabled(true);
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });

        onGranted?.();
      } catch (error) {
        console.warn("GamePlayScreen: failed to request location", error);
        setGpsError("位置情報を取得できませんでした。時間をおいて再度お試しください。");
      } finally {
        setGpsRequesting(false);
      }
    },
    []
  );

  const handleEnableLocationGate = useCallback(() => {
    void requestGpsPermission(() => {
      triggerHaptic("soft");
      runSceneTransition(() => {
        setMode("travel");
      });
    });
  }, [requestGpsPermission, runSceneTransition, triggerHaptic]);

  const handleSkipLocationGate = useCallback(() => {
    setGpsEnabled(false);
    setGpsRequesting(false);
    setGpsError(null);
    setLocationSkipped(true);
    runSceneTransition(() => {
      setMode("travel");
    });
  }, [runSceneTransition]);

  const handleAgreeSafetyBriefing = useCallback(() => {
    if (gpsEnabled || locationSkipped) {
      setMode("travel");
      return;
    }
    setMode("location_gate");
  }, [gpsEnabled, locationSkipped]);

  const handleDialogueComplete = useCallback(() => {
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
        return;
      }
      runSceneTransition(beginTravelMode);
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
    dialogueIndex,
    dialogues.length,
    mode,
    prologueNextMode,
    beginPreStory,
    beginPostStory,
    beginTravelMode,
    isLastSpot,
    beginEpilogue,
    runSceneTransition,
  ]);

  const canArrive =
    mode === "travel" &&
    (locationSkipped ||
      gpsEnabled &&
      (!currentSpotCoords || locationStatus === "nearTarget" || __DEV__));

  const handleArrive = useCallback(() => {
    if (!canArrive) return;
    triggerHaptic("soft");

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
    triggerHaptic,
  ]);

  const handleSubmitPuzzle = useCallback(() => {
    if (!currentSpot) return;
    if (choiceAutoAdvancing) return;

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

      const nextAttemptCount = attemptCount + 1;
      setAttemptCount(nextAttemptCount);

      const isCorrectChoice = selectedChoice
        ? isChoiceAnswerMatch(selectedChoice, currentSpot.puzzleAnswer)
        : false;

      if (!isCorrectChoice) {
        setWrongAnswers((prev) => prev + 1);
        triggerHaptic("error");
      } else {
        triggerHaptic("success");
      }

      setPuzzleState(isCorrectChoice ? "correct" : "incorrect");
      setPuzzleError(null);
      setShowChoiceHint(false);
      setShowPuzzleExplanation(false);
      setExplanationAnswerText(null);
      setConsequence(null);
      setConsequenceTone(null);
      setChoiceAutoAdvancing(true);
      setRevealedCorrectChoiceId(
        resolvedCorrectChoice?.id || selectedChoice?.id || null
      );

      clearChoiceFlowTimer();
      choiceFlowTimerRef.current = setTimeout(() => {
        openPuzzleExplanation(
          resolvedCorrectChoice?.text || currentSpot.puzzleAnswer || null
        );
      }, 900);
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

    const nextAttemptCount = attemptCount + 1;
    setAttemptCount(nextAttemptCount);

    const correct = checkAnswer(puzzleInput, currentSpot.puzzleAnswer);

    if (correct) {
      triggerHaptic("success");
      setPuzzleState("correct");
      setPuzzleError(null);
      setConsequence(currentSpot.puzzleSuccessMessage || "正解。次の章へ進みます。");
      setConsequenceTone("success");

      clearConsequenceTimer();
      consequenceTimerRef.current = setTimeout(() => {
        setConsequence(null);
        setConsequenceTone(null);
        beginPostStory();
      }, 1600);
      return;
    }

    setPuzzleState("incorrect");
    setWrongAnswers((prev) => prev + 1);
    triggerHaptic("error");
    setConsequence("惜しい… もう一度試してみましょう。");
    setConsequenceTone("error");

    clearConsequenceTimer();
    consequenceTimerRef.current = setTimeout(() => {
      setConsequence((prev) =>
        prev === "惜しい… もう一度試してみましょう。" ? null : prev
      );
      setConsequenceTone((prev) => (prev === "error" ? null : prev));
    }, 900);

    if (nextAttemptCount >= 3 && currentSpot.puzzleHints.length > revealedHintLevel) {
      setPuzzleError("ヒントを確認してみましょう。💡");
      return;
    }

    setPuzzleError("答えが違うようです。もう一度試してください。");
  }, [
    currentSpot,
    choiceAutoAdvancing,
    hasChoicePuzzle,
    puzzleState,
    beginPostStory,
    selectedChoiceId,
    puzzleChoices,
    correctChoice,
    attemptCount,
    clearChoiceFlowTimer,
    openPuzzleExplanation,
    puzzleInput,
    clearConsequenceTimer,
    revealedHintLevel,
    triggerHaptic,
  ]);

  const handleRevealHint = useCallback(() => {
    if (!currentSpot) return;

    if (hasChoicePuzzle) {
      if (!primaryChoiceHint) return;
      triggerHaptic("soft");
      setShowChoiceHint((prev) => {
        const next = !prev;
        if (next) {
          setHintsUsed((used) => used + 1);
        }
        return next;
      });
      return;
    }

    if (revealedHintLevel >= currentSpot.puzzleHints.length) return;
    triggerHaptic("soft");
    setHintsUsed((prev) => prev + 1);
    setRevealedHintLevel((prev) => prev + 1);
  }, [currentSpot, hasChoicePuzzle, primaryChoiceHint, revealedHintLevel, triggerHaptic]);

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
    setShowChoiceHint(false);
    setShowPuzzleExplanation(false);
    setExplanationAnswerText(null);
    setConsequence(null);
    setConsequenceTone(null);
  }, [currentSpot?.puzzleAnswer, hasChoicePuzzle, puzzleChoices, correctChoice]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setLoadError(null);

      try {
        const shouldUseFrontendDemo =
          !isSupabaseConfigured || questId === "demo" || questId === "preview";
        let loaded = shouldUseFrontendDemo
          ? createFrontendOnlyDemoQuest(questId)
          : await fetchGameplayQuest(questId);
        if (!active) return;

        if (!loaded || loaded.spots.length === 0) {
          loaded = createFrontendOnlyDemoQuest(questId);
        }

        const safeIndex = Math.min(
          Math.max(0, (startEpisodeNo || 1) - 1),
          loaded.spots.length - 1
        );

        const prologueSeed =
          splitToNarrationLines(loaded.prologue).length > 0
            ? splitToNarrationLines(loaded.prologue)
            : splitToNarrationLines(
                `旅の幕が開く。${loaded.title}の選択は次の章に引き継がれる。`
              );
        const epilogueSeed =
          splitToNarrationLines(loaded.epilogue).length > 0
            ? splitToNarrationLines(loaded.epilogue)
            : splitToNarrationLines(
                "この章は完了。ここでの選択は、次の物語で新しい意味を持つ。"
              );

        const loadedCharacterNameMap = new Map<string, string>();
        (loaded.characters || []).forEach((character) => {
          const nameKey = normalizeSpeakerName(character.name);
          if (nameKey) {
            loadedCharacterNameMap.set(nameKey, character.id);
          }
          const idKey = normalizeSpeakerName(character.id);
          if (idKey) {
            loadedCharacterNameMap.set(idKey, character.id);
          }
        });

        const loadedPrimaryCharacterId = loaded.characters?.[0]?.id || null;
        const loadedSecondaryCharacterId =
          loaded.characters?.[1]?.id || loadedPrimaryCharacterId;
        const loadedSecondaryCharacterName =
          loaded.characters?.[1]?.name || loaded.characters?.[0]?.name || "案内人";

        const builtPrologue = prologueSeed.map((line, index) => ({
          id: `prologue-${index}`,
          speakerType: "narrator" as const,
          characterId: null,
          characterName: null,
          avatarUrl: null,
          text: line,
        }));

        const builtEpilogue = ensureCharacterPresence(
          toDialogues(
            epilogueSeed.map((line, index) => ({
              id: `epilogue-${index}`,
              speakerType: "narrator",
              text: line,
            })),
            "物語の結末",
            {
              nameToCharacterId: loadedCharacterNameMap,
              defaultCharacterId: loadedSecondaryCharacterId,
            }
          ),
          loadedSecondaryCharacterId,
          loadedSecondaryCharacterName,
          `${loadedSecondaryCharacterName}より。ここまでの選択は記録されました。`
        );

        setQuest(loaded);
        setCurrentSpotIndex(safeIndex);
        setResolvedSpotCoords({});
        setGeocodeFailedSpotIds({});
        setPrologueDialogues(builtPrologue);
        setEpilogueDialogues(builtEpilogue);
        setDialogues([]);
        setDialogueIndex(0);

        setHasPlayedOpeningPrologue(false);
        setPrologueNextMode("travel");

        setMode("location_gate");
        setPuzzleInput("");
        setPuzzleState("idle");
        setPuzzleError(null);
        setAttemptCount(0);
        setRevealedHintLevel(0);
        setSelectedChoiceId(null);
        setRevealedCorrectChoiceId(null);
        setChoiceAutoAdvancing(false);
        setShowChoiceHint(false);
        setShowPuzzleExplanation(false);
        setExplanationAnswerText(null);

        setWrongAnswers(0);
        setHintsUsed(0);
        setSessionSaved(false);
        setLocationSkipped(false);
        startedAtRef.current = Date.now();
      } catch (error) {
        console.error("GamePlayScreen: failed to load gameplay quest", error);
        if (active) {
          const fallback = createFrontendOnlyDemoQuest(questId);
          const safeIndex = Math.min(
            Math.max(0, (startEpisodeNo || 1) - 1),
            fallback.spots.length - 1
          );
          const fallbackCharacterNameMap = new Map<string, string>();
          fallback.characters.forEach((character) => {
            const nameKey = normalizeSpeakerName(character.name);
            if (nameKey) fallbackCharacterNameMap.set(nameKey, character.id);
            const idKey = normalizeSpeakerName(character.id);
            if (idKey) fallbackCharacterNameMap.set(idKey, character.id);
          });
          const fallbackPrimaryCharacterId = fallback.characters?.[0]?.id || null;
          const fallbackSecondaryCharacterId =
            fallback.characters?.[1]?.id || fallbackPrimaryCharacterId;
          const fallbackSecondaryCharacterName =
            fallback.characters?.[1]?.name || fallback.characters?.[0]?.name || "案内人";
          const fallbackPrologueSeed =
            splitToNarrationLines(fallback.prologue).length > 0
              ? splitToNarrationLines(fallback.prologue)
              : ["旅の幕が開く。"];
          const fallbackEpilogueSeed =
            splitToNarrationLines(fallback.epilogue).length > 0
              ? splitToNarrationLines(fallback.epilogue)
              : ["この章は完了。次の旅へ進もう。"];
          const builtFallbackPrologue = fallbackPrologueSeed.map((line, index) => ({
            id: `fallback-prologue-${index}`,
            speakerType: "narrator" as const,
            characterId: null,
            characterName: null,
            avatarUrl: null,
            text: line,
          }));
          const builtFallbackEpilogue = ensureCharacterPresence(
            toDialogues(
              fallbackEpilogueSeed.map((line, index) => ({
                id: `fallback-epilogue-${index}`,
                speakerType: "narrator",
                text: line,
              })),
              "物語の結末",
              {
                nameToCharacterId: fallbackCharacterNameMap,
                defaultCharacterId: fallbackSecondaryCharacterId,
              }
            ),
            fallbackSecondaryCharacterId,
            fallbackSecondaryCharacterName,
            `${fallbackSecondaryCharacterName}より。ここまでの選択は記録されました。`
          );
          setQuest(fallback);
          setCurrentSpotIndex(safeIndex);
          setResolvedSpotCoords({});
          setGeocodeFailedSpotIds({});
          setPrologueDialogues(builtFallbackPrologue);
          setEpilogueDialogues(builtFallbackEpilogue);
          setDialogues([]);
          setDialogueIndex(0);
          setHasPlayedOpeningPrologue(false);
          setPrologueNextMode("travel");
          setMode("location_gate");
          setPuzzleInput("");
          setPuzzleState("idle");
          setPuzzleError(null);
          setAttemptCount(0);
          setRevealedHintLevel(0);
          setSelectedChoiceId(null);
          setRevealedCorrectChoiceId(null);
          setChoiceAutoAdvancing(false);
          setShowChoiceHint(false);
          setShowPuzzleExplanation(false);
          setExplanationAnswerText(null);
          setWrongAnswers(0);
          setHintsUsed(0);
          setSessionSaved(false);
          setLocationSkipped(false);
          setLoadError(null);
          startedAtRef.current = Date.now();
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
      clearChoiceFlowTimer();
      clearArrivalTimer();
      clearConsequenceTimer();
      clearOpeningPrologueAutoTimer();
      clearSceneTransitionTimers();
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
        locationSubscriptionRef.current = null;
      }
    };
  }, [
    questId,
    startEpisodeNo,
    clearChoiceFlowTimer,
    clearArrivalTimer,
    clearConsequenceTimer,
    clearOpeningPrologueAutoTimer,
    clearSceneTransitionTimers,
  ]);

  useEffect(() => {
    if (!quest) return;

    const candidates = [currentSpot, nextSpot].filter(
      (spot): spot is GameplaySpot => Boolean(spot)
    );

    const targets = candidates.filter((spot) => {
      if (toCoordinate(spot.lat, spot.lng)) return false;
      if (resolvedSpotCoords[spot.id]) return false;
      if (geocodeFailedSpotIds[spot.id]) return false;
      return true;
    });

    if (targets.length === 0) return;

    let active = true;

    const resolveByGeocoding = async () => {
      for (const spot of targets) {
        const queries = [
          normalizeText(`${spot.name} ${quest.areaName || ""}`),
          normalizeText(spot.name),
          normalizeText(quest.areaName || ""),
        ].filter(Boolean);

        let resolved = false;

        for (const query of queries) {
          try {
            const geocoded = await Location.geocodeAsync(query);
            const first = geocoded.find(
              (item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
            );
            if (!first || !active) continue;

            setResolvedSpotCoords((prev) => {
              if (prev[spot.id]) return prev;
              return {
                ...prev,
                [spot.id]: { lat: first.latitude, lng: first.longitude },
              };
            });
            resolved = true;
            break;
          } catch (error) {
            console.warn("GamePlayScreen: spot geocoding failed", error);
          }
        }

        if (!resolved && active) {
          setGeocodeFailedSpotIds((prev) =>
            prev[spot.id]
              ? prev
              : {
                  ...prev,
                  [spot.id]: true,
                }
          );
        }
      }
    };

    void resolveByGeocoding();

    return () => {
      active = false;
    };
  }, [
    currentSpot?.id,
    currentSpot?.name,
    currentSpot?.lat,
    currentSpot?.lng,
    nextSpot?.id,
    nextSpot?.name,
    nextSpot?.lat,
    nextSpot?.lng,
    quest?.areaName,
    resolvedSpotCoords,
    geocodeFailedSpotIds,
  ]);

  useEffect(() => {
    if (!gpsEnabled) {
      setDistance(null);
      setLocationStatus("locationUnavailable");
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
        locationSubscriptionRef.current = null;
      }
      return;
    }

    if (!currentSpot || !currentSpotCoords) {
      setDistance(null);
      setLocationStatus("locationUnavailable");
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
        locationSubscriptionRef.current = null;
      }
      return;
    }

    let active = true;

    const startWatch = async () => {
      try {
        if (locationSubscriptionRef.current) {
          locationSubscriptionRef.current.remove();
          locationSubscriptionRef.current = null;
        }

        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 5,
            timeInterval: 5000,
          },
          (position) => {
            if (!active) return;
            const nextLocation = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            };
            setUserLocation(nextLocation);
            const d = haversineDistance(
              nextLocation.lat,
              nextLocation.lng,
              currentSpotCoords.lat,
              currentSpotCoords.lng
            );
            setDistance(d);
            setLocationStatus(d <= NEAR_THRESHOLD_M ? "nearTarget" : "tooFar");
          }
        );

        locationSubscriptionRef.current = sub;
      } catch (error) {
        console.warn("GamePlayScreen: location watch failed", error);
        setDistance(null);
        setLocationStatus("locationUnavailable");
      }
    };

    void startWatch();

    return () => {
      active = false;
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
        locationSubscriptionRef.current = null;
      }
    };
  }, [gpsEnabled, currentSpot?.id, currentSpotCoords?.lat, currentSpotCoords?.lng]);

  useEffect(() => {
    let active = true;

    const loadPlayerVisual = async () => {
      if (!userId || !isSupabaseConfigured) {
        if (!active) return;
        setPlayerAvatarUrl(null);
        setPlayerInitial("U");
        return;
      }

      try {
        const supabase = getSupabaseOrThrow();
        const { data, error } = await supabase
          .from("profiles")
          .select("name, profile_picture_url")
          .eq("id", userId)
          .maybeSingle();

        if (!active) return;

        if (error) {
          console.warn("GamePlayScreen: failed to load profile for marker", error);
          setPlayerAvatarUrl(null);
          setPlayerInitial("U");
          return;
        }

        const name = normalizeText((data as { name?: string | null } | null)?.name);
        const initial = name ? name.charAt(0).toUpperCase() : "U";

        setPlayerAvatarUrl(
          normalizeText(
            (data as { profile_picture_url?: string | null } | null)
              ?.profile_picture_url
          ) || null
        );
        setPlayerInitial(initial);
      } catch (error) {
        if (!active) return;
        console.warn("GamePlayScreen: failed to resolve player marker profile", error);
        setPlayerAvatarUrl(null);
        setPlayerInitial("U");
      }
    };

    void loadPlayerVisual();
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (mode !== "completed" || sessionSaved || !quest || !userId || !isSupabaseConfigured) {
      return;
    }

    const persist = async () => {
      try {
        const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const supabase = getSupabaseOrThrow();
        const { error } = await supabase.from("play_sessions").insert({
          user_id: userId,
          quest_id: quest.id,
          ended_at: new Date().toISOString(),
          duration_sec: durationSec,
          wrong_answers: wrongAnswers,
          hints_used: hintsUsed,
        });

        if (error) {
          console.warn("GamePlayScreen: play session insert failed", error);
        }
      } catch (error) {
        console.warn("GamePlayScreen: play session save error", error);
      } finally {
        setSessionSaved(true);
      }
    };

    void persist();
  }, [mode, sessionSaved, quest, userId, wrongAnswers, hintsUsed]);

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

  useEffect(() => {
    if (previousModeRef.current == null) {
      previousModeRef.current = mode;
      return;
    }

    const previousMode = previousModeRef.current;
    if (mode === "completed" && previousMode !== "completed") {
      triggerHaptic("success");
    } else if (mode === "story_pre" && previousMode === "travel") {
      triggerHaptic("soft");
    } else if (mode === "travel" && previousMode === "location_gate") {
      triggerHaptic("soft");
    }

    previousModeRef.current = mode;
  }, [mode, triggerHaptic]);

  useEffect(() => {
    if (mode !== "travel" || !canArrive) {
      arriveCtaPulse.stopAnimation();
      arriveCtaPulse.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(arriveCtaPulse, {
          toValue: 1.03,
          duration: 560,
          useNativeDriver: true,
        }),
        Animated.timing(arriveCtaPulse, {
          toValue: 1,
          duration: 560,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();

    return () => {
      loop.stop();
      arriveCtaPulse.setValue(1);
    };
  }, [mode, canArrive, arriveCtaPulse]);

  const openMapApp = useCallback(() => {
    if (!currentSpot) return;
    const query = currentSpotCoords
      ? `${currentSpotCoords.lat},${currentSpotCoords.lng}`
      : normalizeText(`${currentSpot.name} ${quest?.areaName || ""}`) ||
        normalizeText(currentSpot.name) ||
        "日本";
    void Linking.openURL(buildGoogleSearchUrl(query)).catch((error) => {
      console.warn("GamePlayScreen: failed to open map url", error);
    });
  }, [currentSpot, currentSpotCoords, quest?.areaName]);

  const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
  const isCinematicPrologue = mode === "prologue";
  const hideHudForOpening = mode === "opening_prologue" || isCinematicPrologue;
  const isDemoBadgeVisible =
    !isSupabaseConfigured || questId === "demo" || questId === "preview";

  const travelPhaseLabel =
    mode === "travel" && currentSpotIndex === 0 && !hasPlayedOpeningPrologue
      ? "START POINT"
      : "NEXT SPOT";
  const travelHeadline =
    mode === "travel" && currentSpotIndex === 0 && !hasPlayedOpeningPrologue
      ? "近くに到着しましたか？"
      : "次のスポットへ移動できましたか？";
  const travelGuideText =
    mode === "travel" && currentSpotIndex === 0 && !hasPlayedOpeningPrologue
      ? "最初のスポット近くに到着したら、物語が開始されます。"
      : "次のスポット近くに到着後、続きの物語へ進みます。";
  const isStartPointPhase =
    mode === "travel" && currentSpotIndex === 0 && !hasPlayedOpeningPrologue;

  const travelPrimaryCtaText = canArrive
    ? isStartPointPhase
      ? "到着してゲーム開始"
      : "到着して次の物語へ"
    : isStartPointPhase
      ? "最初のスポット付近で開始可能"
      : "目的地付近で有効になります";
  const isMapMode =
    mode === "briefing" || mode === "travel" || mode === "location_gate";
  const isPuzzleEnabled = false;
  const currentTargetBadgeLabel =
    currentSpotIndex === 0 && !hasPlayedOpeningPrologue ? "START" : "GOAL";
  const mapMaskClass =
    mode === "travel" ||
    mode === "location_gate" ||
    mode === "briefing" ||
    isCinematicPrologue
      ? "bg-transparent"
      : "bg-black/62";
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
    ? "mx-2 h-8 flex-1 rounded-full border border-black/15 bg-white/93"
    : "mx-2 h-8 flex-1 rounded-full border border-white/25 bg-black/72";
  const hudNarrativeTextClass = mapTopControlIsLight
    ? "text-[10px] tracking-[1.8px] text-[#5F4A38]"
    : "text-[10px] tracking-[1.8px] text-[#F7E2C4]";
  const hudProgressInactiveClass = mapTopControlIsLight ? "w-2 bg-black/20" : "w-2 bg-white/25";
  const hudStoryChipClass = mapTopControlIsLight
    ? "h-8 rounded-full border border-black/15 bg-white/93 px-2.5 flex-row items-center gap-1.5"
    : "h-8 rounded-full border border-white/25 bg-black/72 px-2.5 flex-row items-center gap-1.5";
  const hudStoryIconColor = mapTopControlIsLight ? "#A16207" : "#E7C08E";
  const hudStoryTextClass = mapTopControlIsLight
    ? "text-[10px] text-[#6B4B1E]"
    : "text-[10px] text-[#FBE7CC]";
  const gpsStatusText = gpsRequesting ? "..." : gpsEnabled ? "ON" : "OFF";
  const gpsChipClass = mapTopControlIsLight
    ? gpsRequesting
      ? "border-amber-400/45 bg-amber-100/95 text-amber-900"
      : gpsEnabled
        ? "border-emerald-400/45 bg-emerald-100/95 text-emerald-900"
        : "border-rose-400/45 bg-rose-100/95 text-rose-900"
    : gpsRequesting
      ? "border-amber-300/45 bg-amber-500/18 text-amber-100"
      : gpsEnabled
        ? "border-emerald-300/45 bg-emerald-500/18 text-emerald-100"
        : "border-rose-300/45 bg-rose-500/18 text-rose-100";
  const gpsIconColor = mapTopControlIsLight
    ? gpsRequesting
      ? "#92400E"
      : gpsEnabled
        ? "#065F46"
        : "#9F1239"
    : gpsRequesting
      ? "#FCD34D"
      : gpsEnabled
        ? "#86EFAC"
        : "#FCA5A5";
  const travelUseLightPalette = isMapMode || isStartPointPhase;
  const travelStatusText = !gpsEnabled
    ? locationSkipped
      ? "位置情報をスキップして進行中です。到着ボタンで物語を続けられます。"
      : "現在地を有効化すると、あなたの現在地と目的地までのルートを表示します。"
    : locationStatus === "nearTarget"
      ? "スポット付近です。到着ボタンを押して物語を進めてください。"
      : locationStatus === "tooFar"
      ? "スポット付近まで近づくと開始ボタンが有効になります。"
      : "現在地を測位しています…";
  const travelMetaClass = travelUseLightPalette ? "text-[#64748B]" : "text-white/60";
  const travelTitleClass = travelUseLightPalette ? "text-[#2B1E16]" : "text-white";
  const travelSubClass = travelUseLightPalette ? "text-[#64748B]" : "text-white/70";
  const travelBodyClass = travelUseLightPalette ? "text-[#475569]" : "text-white/72";
  const travelStatusClass = travelUseLightPalette ? "text-[#475569]" : "text-white/75";
  const travelSectionLabelClass = travelUseLightPalette ? "text-[#64748B]" : "text-[#F6D4A7]";
  const travelDistanceValueClass = travelUseLightPalette ? "text-[#D97824]" : "text-[#F6B76F]";
  const travelWalkMetaClass = travelUseLightPalette ? "text-[#64748B]" : "text-white/60";
  const travelErrorClass = travelUseLightPalette ? "text-[#B91C1C]" : "text-[#FFC7C3]";
  const travelEstimatedClass = travelUseLightPalette ? "text-[#92400E]" : "text-[#F6D4A7]";
  const travelStoryCardClass = travelUseLightPalette
    ? "mb-3 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2.5"
    : "mb-3 rounded-xl border border-white/15 bg-white/6 px-3 py-2.5";
  const travelStoryLabelClass = travelUseLightPalette ? "text-[#64748B]" : "text-[#F6D4A7]";
  const travelStoryBodyClass = travelUseLightPalette ? "text-[#334155]" : "text-white/82";
  const isNarrativeMode =
    mode === "prologue" || mode === "story_pre" || mode === "story_post" || mode === "epilogue";
  const showImmersionHud =
    false;
  const showTravelStoryLog = false;
  const modePhaseLabel = phaseLabelByMode(mode, currentSpot?.name);
  const objectiveText = objectiveByMode(mode, currentSpot?.name || "次のスポット", nextSpot?.name);
  const companionPreview = (quest?.characters || []).slice(0, 2);
  const previousSpot = quest?.spots[Math.max(0, currentSpotIndex - 1)] || null;
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
    currentSpot?.preMessages?.[0]?.text || currentSpot?.description,
    "次の手がかりへ向かいましょう。",
    58
  );
  const clearedSpots = Math.min(
    currentSpotIndex + (mode === "completed" ? 1 : 0),
    quest?.spots.length || 0
  );
  const journeyScore = computeJourneyScore({
    durationSeconds,
    wrongAnswers,
    hintsUsed,
    totalSpots: quest?.spots.length || 1,
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

  if (loading) {
    return (
      <View className="flex-1 bg-[#12100E] items-center justify-center">
        <View className="w-16 h-16 rounded-full bg-[#EE8C2B]/20 items-center justify-center mb-4">
          <ActivityIndicator color="#EE8C2B" />
        </View>
        <Text className="text-white text-sm" style={{ fontFamily: fonts.displayBold }}>
          プレイデータを読み込んでいます
        </Text>
      </View>
    );
  }

  if (loadError || !quest || !currentSpot) {
    return (
      <View className="flex-1 bg-[#12100E] items-center justify-center px-6">
        <Text className="text-white text-lg mb-2" style={{ fontFamily: fonts.displayBold }}>
          プレイデータが見つかりません
        </Text>
        <Text className="text-white/70 text-sm text-center" style={{ fontFamily: fonts.bodyRegular }}>
          {loadError || "必要なスポット情報が不足しています。"}
        </Text>
      </View>
    );
  }

  const hasSpotCoordinates = Boolean(currentSpotCoords);
  const mapCenter = hasSpotCoordinates
    ? currentSpotCoords!
    : userLocation || DEFAULT_MAP_CENTER;

  const routeCoordinates =
    userLocation && currentSpotCoords
      ? [
          { latitude: userLocation.lat, longitude: userLocation.lng },
          {
            latitude: currentSpotCoords.lat,
            longitude: currentSpotCoords.lng,
          },
        ]
      : null;
  const spotToNextRouteCoordinates =
    currentSpotCoords && nextSpotCoords
      ? [
          { latitude: currentSpotCoords.lat, longitude: currentSpotCoords.lng },
          { latitude: nextSpotCoords.lat, longitude: nextSpotCoords.lng },
        ]
      : null;

  const isUsingEstimatedSpotCoordinate =
    hasSpotCoordinates &&
    (typeof currentSpot.lat !== "number" || typeof currentSpot.lng !== "number");
  const spotBackgroundImage = currentSpot.backgroundImage || quest.coverImageUrl || undefined;

  return (
    <View className="flex-1 bg-black">
      {isMapMode ? (
        <View className="absolute inset-0">
          <MapView
            key={`${currentSpot.id}:${currentSpotCoords?.lat ?? "na"}:${currentSpotCoords?.lng ?? "na"}`}
            style={{ flex: 1 }}
            initialRegion={{
              latitude: mapCenter.lat,
              longitude: mapCenter.lng,
              latitudeDelta: 0.0085,
              longitudeDelta: 0.0085,
            }}
            showsUserLocation={false}
            showsMyLocationButton={false}
            showsCompass={false}
            showsScale={false}
            showsTraffic={false}
            rotateEnabled={false}
            pitchEnabled={false}
          >
            {routeCoordinates ? (
              <Polyline
                coordinates={routeCoordinates}
                strokeColor="#EE8C2B"
                strokeWidth={4}
              />
            ) : null}

            {spotToNextRouteCoordinates ? (
              <Polyline
                coordinates={spotToNextRouteCoordinates}
                strokeColor="#FFFFFF99"
                strokeWidth={2}
                lineDashPattern={[4, 4]}
              />
            ) : null}

            {currentSpotCoords ? (
              <Marker
                coordinate={{
                  latitude: currentSpotCoords.lat,
                  longitude: currentSpotCoords.lng,
                }}
                title={currentSpot.name}
              >
                <View className="items-center">
                  <View className="w-11 h-11 rounded-full border border-[#FFE0B8]/70 bg-[#EE8C2B] items-center justify-center">
                    <Ionicons name="location" size={18} color="#FFFFFF" />
                  </View>
                  <View className="mt-1 rounded-full border border-[#FFE0B8]/60 bg-[#EE8C2B] px-1.5 py-[1px]">
                    <Text className="text-[8px] tracking-[1.5px] text-[#FFE6C8]" style={{ fontFamily: fonts.displayBold }}>
                      {currentTargetBadgeLabel}
                    </Text>
                  </View>
                </View>
              </Marker>
            ) : null}

            {nextSpot && nextSpotCoords ? (
              <Marker
                coordinate={{
                  latitude: nextSpotCoords.lat,
                  longitude: nextSpotCoords.lng,
                }}
                title={nextSpot.name}
              >
                <View className="items-center">
                  <View className="w-9 h-9 rounded-full border border-[#F0ECE7]/70 bg-[#6A5F55]/90 items-center justify-center">
                    <Ionicons name="flag-outline" size={14} color="#F7F1E8" />
                  </View>
                  <View className="mt-1 rounded-full border border-white/25 bg-black/55 px-1.5 py-[1px]">
                    <Text className="text-[8px] tracking-[1.3px] text-white/85" style={{ fontFamily: fonts.displayBold }}>
                      NEXT
                    </Text>
                  </View>
                </View>
              </Marker>
            ) : null}

            {userLocation ? (
              <Marker
                coordinate={{
                  latitude: userLocation.lat,
                  longitude: userLocation.lng,
                }}
                title="YOU"
              >
                <View className="items-center">
                  <View className="w-11 h-11 rounded-full border border-[#6FD7FF]/45 bg-[#071826]/90 overflow-hidden items-center justify-center">
                    {playerAvatarUrl ? (
                      <Image
                        source={{ uri: playerAvatarUrl }}
                        className="w-full h-full"
                        resizeMode="cover"
                      />
                    ) : (
                      <Text className="text-sm text-[#BDEBFF]" style={{ fontFamily: fonts.displayBold }}>
                        {playerInitial}
                      </Text>
                    )}
                  </View>
                  <View className="mt-1 rounded-full border border-[#6FD7FF]/35 bg-black/65 px-1.5 py-[1px]">
                    <Text className="text-[8px] tracking-[1.5px] text-[#BDEBFF]" style={{ fontFamily: fonts.displayBold }}>
                      YOU
                    </Text>
                  </View>
                </View>
              </Marker>
            ) : null}
          </MapView>
        </View>
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
          className="absolute top-0 left-0 right-0 z-30"
          style={{
            paddingHorizontal: topHudHorizontalPadding,
            paddingTop: topHudVerticalPadding,
          }}
        >
          <View className="flex-row items-center justify-between">
            {isNarrativeMode ? (
              <View className={`${hudCenterClass} items-center justify-center`} style={hudSurfaceStyle}>
                <Text className={hudNarrativeTextClass} style={{ fontFamily: fonts.displayBold }}>
                  {modePhaseLabel}
                </Text>
              </View>
            ) : (
              <View className={`${hudCenterClass} px-3 justify-center`} style={hudSurfaceStyle}>
                <View className="flex-row items-center gap-1.5">
                  {quest.spots.map((spot, index) => (
                    <View
                      key={`hud-spot-${spot.id}`}
                      className={`h-1 rounded-full ${
                        index < currentSpotIndex
                          ? "w-4 bg-[#EE8C2B]"
                          : index === currentSpotIndex
                            ? "w-6 bg-[#F6B76F]"
                            : hudProgressInactiveClass
                      }`}
                    />
                  ))}
                </View>
              </View>
            )}

            {!isNarrativeMode ? (
              <View
                className={`h-8 rounded-full border px-2.5 flex-row items-center gap-1.5 ${gpsChipClass}`}
                style={mapTopControlIsLight ? hudSurfaceStyle : undefined}
              >
                <Ionicons name="locate" size={12} color={gpsIconColor} />
                <Text className="text-[10px]" style={{ fontFamily: fonts.displayBold }}>
                  {gpsStatusText}
                </Text>
              </View>
            ) : (
              <View className={hudStoryChipClass} style={hudSurfaceStyle}>
                <Ionicons name="book-outline" size={12} color={hudStoryIconColor} />
                <Text className={hudStoryTextClass} style={{ fontFamily: fonts.displayBold }}>
                  STORY
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
                        key={`hud-companion-${character.id}`}
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

      {isDemoBadgeVisible && !hideHudForOpening ? (
        <SafeAreaView
          edges={["top"]}
          className="absolute top-0 right-0 z-30 pt-12"
          style={{ paddingHorizontal: topHudHorizontalPadding }}
        >
          <View className="rounded-full border border-[#7DD3FC]/40 bg-[#0EA5E9]/20 px-3 py-1">
            <Text className="text-[10px] text-[#D5F4FF]" style={{ fontFamily: fonts.displayBold }}>
              デモ表示
            </Text>
          </View>
        </SafeAreaView>
      ) : null}

      {showArrival && arrivalName ? (
        <View className="absolute inset-0 z-40 items-center justify-center bg-black/60">
          <View className="items-center">
            <View className="w-12 h-12 rounded-full bg-[#EE8C2B]/20 border border-[#EE8C2B]/40 items-center justify-center mb-4">
              <Ionicons name="location" size={20} color="#EE8C2B" />
            </View>
            <Text className="text-[#EE8C2B] text-xs tracking-[2px] mb-2" style={{ fontFamily: fonts.displayBold }}>
              到着
            </Text>
            <Text className="text-white text-xl" style={{ fontFamily: fonts.displayBold }}>
              {arrivalName}
            </Text>
          </View>
        </View>
      ) : null}

      {consequence ? (
        <View className="absolute inset-0 z-40 items-center justify-center bg-black/70 px-6">
          <View
            className={`w-full rounded-2xl border px-6 py-6 ${
              consequenceTone === "success"
                ? "bg-[#2A6B4C]/45 border-[#95DFB1]/45"
                : "bg-[#7C3D3D]/45 border-[#EBAAAA]/45"
            }`}
          >
            <View
              className={`w-14 h-14 rounded-full border items-center justify-center mb-3 self-center ${
                consequenceTone === "success"
                  ? "bg-[#2A6B4C]/70 border-[#95DFB1]/45"
                  : "bg-[#7C3D3D]/70 border-[#EBAAAA]/45"
              }`}
            >
              <Ionicons
                name={consequenceTone === "success" ? "checkmark-circle" : "close-circle"}
                size={24}
                color={consequenceTone === "success" ? "#D5F6DE" : "#FFE2E0"}
              />
            </View>
            <Text className="text-white text-center text-xl mb-2" style={{ fontFamily: fonts.displayBold }}>
              {consequenceTone === "success" ? "✨ 正解！" : "惜しい…"}
            </Text>
            <Text className="text-white/90 text-center text-sm leading-6" style={{ fontFamily: fonts.bodyRegular }}>
              {consequence}
            </Text>
          </View>
        </View>
      ) : null}

      {mode === "briefing" ? (
        <View className="absolute inset-0 z-40 items-center justify-center bg-black/72 px-6">
          <View className="w-full rounded-2xl border border-[#E5DED7] bg-white px-5 py-5">
            <View className="mb-3 flex-row items-center gap-2">
              <Ionicons name="shield-checkmark-outline" size={16} color="#EE8C2B" />
              <Text className="text-[11px] text-[#8A6C54] tracking-[1.5px]" style={{ fontFamily: fonts.displayBold }}>
                街歩きの注意事項
              </Text>
            </View>
            <Text className="text-[#2B2118] text-lg mb-2" style={{ fontFamily: fonts.displayBold }}>
              ゲーム開始前にご確認ください
            </Text>
            <Text className="text-[#5A4B3F] text-sm leading-6 mb-4" style={{ fontFamily: fonts.bodyRegular }}>
              交通ルールを守り、安全な場所で画面を確認してください。物語進行は到着確認を押すまで進みません。
            </Text>

            <View className="rounded-xl border border-[#E9E1D9] bg-[#F8F5F2] px-3 py-3 mb-3">
              <Text className="text-[#8A6C54] text-[10px] tracking-[1.5px] mb-2" style={{ fontFamily: fonts.displayBold }}>
                今回の開始スポット
              </Text>
              <Text className="text-[#2B2118] text-sm mb-2" style={{ fontFamily: fonts.displayBold }}>
                {currentSpot.name}
              </Text>
              <SpotRouteStrip spots={quest.spots} currentSpotIndex={currentSpotIndex} theme="light" />
            </View>

            <Pressable
              className="h-11 rounded-xl bg-[#EE8C2B] items-center justify-center"
              onPress={handleAgreeSafetyBriefing}
            >
              <Text className="text-white text-sm" style={{ fontFamily: fonts.displayBold }}>
                承知して開始する
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {mode === "location_gate" ? (
        <View className="absolute inset-0 z-40 items-center justify-center bg-black/70 px-6">
          <View className="w-full rounded-2xl border border-[#E5DED7] bg-white px-5 py-5">
            <View className="mb-3 flex-row items-center gap-2">
              <Ionicons name="location-outline" size={16} color="#EE8C2B" />
              <Text className="text-[11px] text-[#8A6C54] tracking-[1.5px]" style={{ fontFamily: fonts.displayBold }}>
                LOCATION REQUIRED
              </Text>
            </View>
            <Text className="text-[#2B2118] text-lg mb-2" style={{ fontFamily: fonts.displayBold }}>
              現在地を有効化してください
            </Text>
            <Text className="text-[#5A4B3F] text-sm leading-6 mb-4" style={{ fontFamily: fonts.bodyRegular }}>
              ゲーム開始前に位置情報の許可が必要です。許可後に移動フェーズへ進みます。
            </Text>

            <View className="rounded-xl border border-[#E9E1D9] bg-[#F8F5F2] px-3 py-2 mb-3">
              <Text className="text-[#8A6C54] text-[10px] tracking-[1.5px] mb-1" style={{ fontFamily: fonts.displayBold }}>
                開始スポット
              </Text>
              <Text className="text-[#2B2118] text-sm mb-2" style={{ fontFamily: fonts.displayBold }}>
                {currentSpot.name}
              </Text>
              <SpotRouteStrip
                spots={quest.spots}
                currentSpotIndex={currentSpotIndex}
                theme="light"
              />
            </View>

            {gpsError ? (
              <Text className="text-[#B33B2F] text-xs mb-3" style={{ fontFamily: fonts.bodyRegular }}>
                {gpsError}
              </Text>
            ) : null}

            <Pressable
              className="h-11 rounded-xl bg-[#EE8C2B] items-center justify-center"
              onPress={handleEnableLocationGate}
              disabled={gpsRequesting}
            >
              <Text className="text-white text-sm" style={{ fontFamily: fonts.displayBold }}>
                {gpsRequesting ? "現在地を取得中..." : "現在地を有効化して開始"}
              </Text>
            </Pressable>

            <Pressable
              className="h-10 rounded-xl border border-[#DDD5CC] bg-white items-center justify-center mt-2"
              onPress={handleSkipLocationGate}
              disabled={gpsRequesting}
            >
              <Text className="text-[#3E332B] text-sm" style={{ fontFamily: fonts.displayBold }}>
                デモとして開始（位置情報スキップ）
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {mode === "opening_prologue" ? (
        <View className="absolute inset-0 z-40 bg-[#0A0807]">
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
            <View className="flex-row items-start justify-between mb-3">
              <View className="flex-1 pr-4">
                <Text className={`text-[11px] tracking-[2px] ${travelSectionLabelClass}`} style={{ fontFamily: fonts.displayBold }}>
                  {travelPhaseLabel}
                </Text>
                <Text className={`text-lg mt-1 ${travelTitleClass}`} style={{ fontFamily: fonts.displayBold }}>
                  {currentSpot.name}
                </Text>
                <Text className={`text-xs mt-1 ${travelSubClass}`} style={{ fontFamily: fonts.bodyRegular }}>
                  {travelHeadline}
                </Text>
              </View>

              <View className="items-end">
                <Text className={`text-[11px] ${travelMetaClass}`} style={{ fontFamily: fonts.bodyRegular }}>
                  距離
                </Text>
                <Text className={`text-sm ${travelDistanceValueClass}`} style={{ fontFamily: fonts.displayBold }}>
                  {formatDistance(distance)}
                </Text>
              </View>
            </View>

            <View className="flex-row items-start gap-2 mb-3">
              <Ionicons name="compass-outline" size={14} color="#EE8C2B" style={{ marginTop: 1 }} />
              <Text className={`text-xs flex-1 ${travelBodyClass}`} style={{ fontFamily: fonts.bodyRegular }}>
                {travelGuideText}
              </Text>
            </View>

            <Text className={`text-[11px] mb-2 ${travelStatusClass}`} style={{ fontFamily: fonts.bodyRegular }}>
              {travelStatusText}
            </Text>

            {showTravelStoryLog ? (
              <View className={travelStoryCardClass}>
                <Text className={`text-[10px] tracking-[1.6px] ${travelStoryLabelClass}`} style={{ fontFamily: fonts.displayBold }}>
                  STORY LOG
                </Text>
                <Text className={`mt-1 text-[11px] ${travelStoryBodyClass}`} style={{ fontFamily: fonts.bodyRegular }}>
                  前章: {previousMemoryText}
                </Text>
                <Text className={`mt-1 text-[11px] ${travelStoryBodyClass}`} style={{ fontFamily: fonts.bodyRegular }}>
                  次の導入: {nextCueText}
                </Text>
                <Text className={`mt-1 text-[10px] ${travelStoryLabelClass}`} style={{ fontFamily: fonts.bodyRegular }}>
                  記録進行 {clearedSpots}/{quest.spots.length}
                </Text>
              </View>
            ) : null}

            <View className="mb-3">
              <Text className={`text-[10px] tracking-[1.8px] mb-1.5 ${travelSectionLabelClass}`} style={{ fontFamily: fonts.displayBold }}>
                SPOT ROUTE
              </Text>
              <SpotRouteStrip
                spots={quest.spots}
                currentSpotIndex={currentSpotIndex}
                theme="light"
              />
            </View>

            {distance != null ? (
              <Text className={`text-[11px] mb-3 ${travelWalkMetaClass}`} style={{ fontFamily: fonts.bodyRegular }}>
                徒歩の目安: 約{Math.ceil((distance / 1000 / 5) * 60)}分
              </Text>
            ) : null}

            {gpsError ? (
              <Text className={`text-[11px] mb-2 ${travelErrorClass}`} style={{ fontFamily: fonts.bodyRegular }}>
                {gpsError}
              </Text>
            ) : null}

            {locationSkipped ? (
              <Text className={`text-[11px] mb-2 ${travelEstimatedClass}`} style={{ fontFamily: fonts.bodyRegular }}>
                位置情報スキップ中: 「到着して次へ」でフロントエンド挙動を確認できます。
              </Text>
            ) : null}

            {isUsingEstimatedSpotCoordinate ? (
              <Text className={`text-[11px] mb-2 ${travelEstimatedClass}`} style={{ fontFamily: fonts.bodyRegular }}>
                スポット座標を推定して地図を表示しています。
              </Text>
            ) : null}

            <View className="flex-row items-center gap-2 mb-2">
              {!gpsEnabled && !locationSkipped ? (
                <Pressable
                  onPress={handleEnableLocationGate}
                  disabled={gpsRequesting}
                  className={`flex-1 h-10 rounded-xl border items-center justify-center ${
                    gpsRequesting
                      ? "border-[#E5E7EB] bg-[#EEF2F7]"
                      : "border-[#E5E7EB] bg-[#F8FAFC]"
                  }`}
                >
                  <Text className="text-[#475569] text-sm" style={{ fontFamily: fonts.bodyMedium }}>
                    {gpsRequesting ? "現在地を取得中..." : "現在地を有効化"}
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
            </View>

            <Animated.View
              className="w-full"
              style={canArrive ? { transform: [{ scale: arriveCtaPulse }] } : undefined}
            >
              <Pressable
                onPress={handleArrive}
                disabled={!canArrive}
                className={`h-11 rounded-xl items-center justify-center ${
                  canArrive ? "bg-[#EE8C2B]" : "bg-[#CBD5E1]"
                }`}
              >
                <Text className="text-white text-sm" style={{ fontFamily: fonts.displayBold }}>
                  {travelPrimaryCtaText}
                </Text>
              </Pressable>
            </Animated.View>

            {!canArrive && gpsEnabled && locationStatus === "tooFar" && nextSpot ? (
              <Text
                className={`${travelUseLightPalette ? "text-[#64748B]" : "text-white/50"} text-[10px] mt-2`}
                style={{ fontFamily: fonts.bodyRegular }}
              >
                次の候補: {nextSpot.name}
              </Text>
            ) : null}
            </ScrollView>
          </View>
        </SafeAreaView>
      ) : null}

      {mode === "prologue" && activeDialogue && !showArrival && !consequence ? (
        <PrologueCinematicOverlay
          line={activeDialogue}
          isLast={dialogueIndex >= dialogues.length - 1}
          onComplete={handleDialogueComplete}
        />
      ) : null}

      {(mode === "story_pre" ||
        mode === "story_post" ||
        mode === "epilogue") &&
      activeDialogue &&
      !showArrival &&
      !consequence ? (
        <TypewriterDialogueOverlay
          line={activeDialogue}
          isLast={dialogueIndex >= dialogues.length - 1}
          resolveCharacter={resolveCharacter}
          onComplete={handleDialogueComplete}
          topShadeHeight={topShadeHeight}
          bottomShadeHeight={bottomShadeHeight}
        />
      ) : null}

      {mode === "puzzle" && isPuzzleEnabled && !consequence ? (
        hasChoicePuzzle ? (
          <View className="absolute inset-0 z-30 bg-black/85">
            <SafeAreaView edges={["top", "bottom"]} className="flex-1">
              <View className="pt-5 pb-3 px-4 items-center">
                <View className="w-14 h-14 rounded-2xl bg-[#EE8C2B]/15 border border-[#F6B76F]/35 items-center justify-center mb-3">
                  <Ionicons name="help-circle-outline" size={28} color="#F6B76F" />
                </View>
                <Text className="text-[#FBEEDB] text-lg" style={{ fontFamily: fonts.displayBold }}>
                  {currentSpot.name}の謎
                </Text>
                <Text className="text-white/65 text-xs mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                  手がかりを選んで答えを導いてください
                </Text>
              </View>

              {showPuzzleExplanation ? (
                <View className="flex-1 px-4 justify-between pb-5">
                  <View className="p-4 bg-white/10 rounded-xl border border-white/20">
                    <Text className="text-[11px] tracking-[2px] text-[#F6D4A7] mb-2" style={{ fontFamily: fonts.displayBold }}>
                      解説
                    </Text>
                    {explanationAnswerText ? (
                      <Text className="text-sm text-[#B5F0CA] mb-2" style={{ fontFamily: fonts.bodyMedium }}>
                        正解: <Text style={{ fontFamily: fonts.displayBold }}>{explanationAnswerText}</Text>
                      </Text>
                    ) : null}
                    <Text className="text-white/90 text-sm leading-6" style={{ fontFamily: fonts.bodyRegular }}>
                      {currentSpot.puzzleSuccessMessage || "謎の解説は準備中です。"}
                    </Text>
                  </View>

                  <Pressable
                    className="h-12 rounded-xl bg-[#EE8C2B] items-center justify-center mt-4"
                    onPress={handleClosePuzzleExplanation}
                  >
                    <Text className="text-white text-base" style={{ fontFamily: fonts.displayBold }}>
                      次へ進む
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <ScrollView
                    className="flex-1 px-4"
                    contentContainerStyle={{ paddingBottom: 10 }}
                    showsVerticalScrollIndicator={false}
                  >
                    <View className="p-4 bg-white/10 rounded-xl border border-white/20 mb-4">
                      <Text className="text-white text-sm leading-6" style={{ fontFamily: fonts.bodyRegular }}>
                        {puzzlePromptText}
                      </Text>
                    </View>

                    <View className="gap-2.5">
                      {puzzleChoices.map((choice) => {
                        const isSelected = selectedChoiceId === choice.id;
                        const isAnswer =
                          choiceShowResult && revealedCorrectChoiceId === choice.id;
                        const isWrong = choiceShowResult && isSelected && !isAnswer;

                        return (
                          <Pressable
                            key={choice.id}
                            className={`w-full rounded-xl border px-3 py-3 flex-row items-center gap-3 ${
                              isAnswer
                                ? "border-[#8FDEAF] bg-[#3B7E5D]/25"
                                : isWrong
                                  ? "border-[#EBAAAA] bg-[#7C3D3D]/25"
                                  : isSelected
                                    ? "border-[#F6B76F]/65 bg-[#EE8C2B]/18"
                                    : "border-white/20 bg-white/8"
                            }`}
                            onPress={() => {
                              if (choiceAutoAdvancing) return;
                              if (
                                puzzleState === "correct" ||
                                puzzleState === "incorrect" ||
                                puzzleState === "revealedAnswer"
                              ) {
                                return;
                              }
                              setSelectedChoiceId(choice.id);
                              setPuzzleError(null);
                            }}
                          >
                            <View
                              className={`w-7 h-7 rounded-full items-center justify-center ${
                                isAnswer
                                  ? "bg-[#8FDEAF]/25"
                                  : isWrong
                                    ? "bg-[#EBAAAA]/25"
                                    : isSelected
                                      ? "bg-[#F6B76F]/25"
                                      : "bg-white/15"
                              }`}
                            >
                              {isAnswer ? (
                                <Ionicons name="checkmark" size={14} color="#B5F0CA" />
                              ) : isWrong ? (
                                <Ionicons name="close" size={14} color="#FFC7C3" />
                              ) : (
                                <Text
                                  className="text-xs text-white/90"
                                  style={{ fontFamily: fonts.displayBold }}
                                >
                                  {choice.label}
                                </Text>
                              )}
                            </View>

                            <Text
                              className="text-sm text-white flex-1 leading-6"
                              style={{ fontFamily: fonts.bodyRegular }}
                            >
                              {choice.text}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {puzzleError ? (
                      <Text className="text-[12px] text-[#FFC7C3] mt-2" style={{ fontFamily: fonts.bodyRegular }}>
                        {puzzleError}
                      </Text>
                    ) : null}

                    {primaryChoiceHint && !choiceShowResult ? (
                      <Pressable
                        onPress={handleRevealHint}
                        className="flex-row items-center gap-2 mt-3 mb-1"
                      >
                        <Ionicons name="bulb-outline" size={14} color="#FFFFFFB3" />
                        <Text className="text-xs text-white/70" style={{ fontFamily: fonts.bodyRegular }}>
                          {showChoiceHint ? primaryChoiceHint : "ヒントを見る"}
                        </Text>
                      </Pressable>
                    ) : null}
                  </ScrollView>

                  <View className="px-4 pb-4 pt-2">
                    <Pressable
                      className={`h-12 rounded-xl items-center justify-center ${
                        selectedChoiceId && !choiceShowResult && !choiceAutoAdvancing
                          ? "bg-[#EE8C2B]"
                          : "bg-white/15"
                      }`}
                      onPress={handleSubmitPuzzle}
                      disabled={
                        !selectedChoiceId || choiceShowResult || choiceAutoAdvancing
                      }
                    >
                      <Text
                        className={`text-base ${
                          selectedChoiceId && !choiceShowResult && !choiceAutoAdvancing
                            ? "text-white"
                            : "text-white/50"
                        }`}
                        style={{ fontFamily: fonts.displayBold }}
                      >
                        {choiceAutoAdvancing
                          ? "次へ進みます..."
                          : choiceShowResult
                            ? choiceIsCorrect
                              ? "正解！"
                              : "次へ進む"
                            : "回答する"}
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}

              {choiceShowResult && !showPuzzleExplanation ? (
                <View className="absolute inset-0 items-center justify-center pointer-events-none">
                  <View
                    className={`px-8 py-4 rounded-2xl ${
                      choiceIsCorrect ? "bg-[#3B7E5D]/45" : "bg-[#7C3D3D]/45"
                    }`}
                  >
                    <Text
                      className={`text-2xl ${
                        choiceIsCorrect ? "text-[#B5F0CA]" : "text-[#FFC7C3]"
                      }`}
                      style={{ fontFamily: fonts.displayBold }}
                    >
                      {choiceIsCorrect ? "✨ 正解！" : "惜しい…"}
                    </Text>
                  </View>
                </View>
              ) : null}
            </SafeAreaView>
          </View>
        ) : (
          <View className="absolute inset-0 z-30 bg-[#0E0C0A]">
            <SafeAreaView edges={["top", "bottom"]} className="flex-1">
              <View className="pt-5 pb-3 px-4">
                <View className="flex-row items-center gap-3 mb-3">
                  <View className="w-11 h-11 rounded-xl border border-[#F6B76F]/35 bg-[#EE8C2B]/15 items-center justify-center">
                    <Ionicons name="help-circle-outline" size={20} color="#F6B76F" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[#F6D4A7] text-[10px] tracking-[2px]" style={{ fontFamily: fonts.displayBold }}>
                      MISSION
                    </Text>
                    <Text className="text-white text-base" style={{ fontFamily: fonts.displayBold }}>
                      {currentSpot.name}の謎
                    </Text>
                  </View>
                </View>

                <View className="rounded-xl border border-white/15 bg-white/8 px-3 py-2">
                  <Text className="text-[11px] text-white/75" style={{ fontFamily: fonts.bodyRegular }}>
                    ミス: {wrongAnswers} / 試行: {attemptCount} / ヒント: {hintsUsed}
                  </Text>
                </View>
              </View>

              <ScrollView
                className="flex-1 px-4"
                contentContainerStyle={{ paddingBottom: 10 }}
                showsVerticalScrollIndicator={false}
              >
                <View className="mb-3 rounded-xl border border-white/15 bg-white/8 px-4 py-3">
                  <Text className="text-white text-[15px] leading-6" style={{ fontFamily: fonts.bodyRegular }}>
                    {puzzlePromptText}
                  </Text>
                </View>

                {visibleHints.length > 0 ? (
                  <View className="mb-3 gap-1.5">
                    {visibleHints.map((hint, index) => (
                      <View
                        key={`${currentSpot.id}-hint-${index}`}
                        className="rounded-lg border border-[#F6B76F]/28 bg-[#EE8C2B]/12 px-2.5 py-1.5"
                      >
                        <Text className="text-[12px] text-[#FBE9D3]" style={{ fontFamily: fonts.bodyRegular }}>
                          ヒント{index + 1}: {hint}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <TextInput
                  value={puzzleInput}
                  onChangeText={setPuzzleInput}
                  placeholder="答えを入力"
                  placeholderTextColor="#FFFFFF66"
                  className={`h-11 rounded-xl border bg-white/10 px-3 text-sm text-white mb-2 ${
                    puzzleState === "correct"
                      ? "border-[#95DFB1]/60"
                      : puzzleState === "incorrect"
                        ? "border-[#EBAAAA]/60"
                        : "border-white/20"
                  }`}
                  style={{ fontFamily: fonts.bodyRegular }}
                />

                {puzzleError ? (
                  <Text className="text-[12px] text-[#FFC7C3] mb-2" style={{ fontFamily: fonts.bodyRegular }}>
                    {puzzleError}
                  </Text>
                ) : null}
              </ScrollView>

              <View className="px-4 pb-4 pt-2">
                <View className="flex-row items-center gap-2 mb-2">
                  <Pressable
                    onPress={handleRevealHint}
                    disabled={revealedHintLevel >= (currentSpot.puzzleHints || []).length}
                    className="flex-1 h-10 rounded-xl border border-white/20 bg-white/5 items-center justify-center flex-row gap-1.5"
                  >
                    <Ionicons name="bulb-outline" size={14} color="#FFFFFFE0" />
                    <Text className="text-white/90 text-sm" style={{ fontFamily: fonts.bodyMedium }}>
                      ヒントを見る
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={handleRevealAnswer}
                    disabled={attemptCount < 3 || !currentSpot.puzzleAnswer}
                    className="flex-1 h-10 rounded-xl border border-white/20 bg-white/5 items-center justify-center"
                  >
                    <Text className="text-white/90 text-sm" style={{ fontFamily: fonts.bodyMedium }}>
                      答えを見る
                    </Text>
                  </Pressable>
                </View>

                <Pressable
                  onPress={handleSubmitPuzzle}
                  className="h-11 rounded-xl bg-[#EE8C2B] items-center justify-center"
                >
                  <Text className="text-white text-sm" style={{ fontFamily: fonts.displayBold }}>
                    {puzzleState === "correct" || puzzleState === "revealedAnswer"
                      ? "次へ進む"
                      : "回答する"}
                  </Text>
                </Pressable>
              </View>
            </SafeAreaView>
          </View>
        )
      ) : null}

      {mode === "completed" ? (
        <View className="absolute inset-0 z-40 items-center justify-center bg-black/70 px-6">
          <View className="w-full rounded-2xl border border-[#EE8C2B]/35 bg-black/65 px-6 py-6">
            <View className={`w-16 h-16 rounded-full border items-center justify-center self-center mb-3 ${journeyRankToneClass}`}>
              <Text className={`text-2xl ${journeyRankTextClass}`} style={{ fontFamily: fonts.displayBold }}>
                {journeyRank.rank}
              </Text>
            </View>
            <Text className="text-white text-lg text-center mb-1" style={{ fontFamily: fonts.displayBold }}>
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

            <View className="flex-row items-center gap-2">
              <Pressable
                className="flex-1 h-10 rounded-xl bg-[#EE8C2B] items-center justify-center"
                onPress={beginPrologue}
              >
                <Text className="text-white text-sm" style={{ fontFamily: fonts.displayBold }}>
                  もう一度見る
                </Text>
              </Pressable>
            </View>

          </View>
        </View>
      ) : null}

    </View>
  );
};
