import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import MapView, { Marker, Polyline } from "react-native-maps";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RootStackParamList } from "@/navigation/types";
import { fonts } from "@/theme/fonts";
import {
  fetchGameplayQuest,
  type GameplayCharacter,
  type GameplayMessage,
  type GameplayQuest,
} from "@/services/gameplay";
import { getSupabaseOrThrow, isSupabaseConfigured } from "@/lib/supabase";
import { useSessionUserId } from "@/hooks/useSessionUser";

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

const CHOICE_LINE_PATTERN = /^\s*([A-Za-zＡ-Ｚａ-ｚ0-9０-９])[\.．:：\)）]\s*(.+)$/;
const AUTO_CHOICE_LABELS = ["A", "B", "C", "D"] as const;
const NEAR_THRESHOLD_M = 120;
const DEFAULT_MAP_CENTER = { lat: 35.681236, lng: 139.767125 };

const normalizeText = (value?: string | null) =>
  (value || "").replace(/\s+/g, " ").trim();

const splitToNarrationLines = (raw?: string | null): string[] => {
  const normalized = normalizeText(raw);
  if (!normalized) return [];

  const byNewline = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const sentenceList = byNewline.flatMap((line) => {
    const chunks = line
      .split(/(?<=[。！？!?])/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
    return chunks.length > 0 ? chunks : [line];
  });

  return sentenceList;
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

  return normalizedMessages.map((message, index) => {
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

    return {
      id: message.id || `msg-${index}`,
      speakerType,
      characterId,
      characterName: message.name || null,
      avatarUrl: message.avatarUrl || null,
      text: normalizeText(message.text) || fallbackText,
    } satisfies DialogueLine;
  });
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

const TypewriterDialogueOverlay = ({
  line,
  isLast,
  resolveCharacter,
  onComplete,
}: {
  line: DialogueLine;
  isLast: boolean;
  resolveCharacter: (line: DialogueLine) => DialogueCharacter | null;
  onComplete: () => void;
}) => {
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    setDisplayedText("");
    setIsTyping(true);

    let index = 0;
    const timer = setInterval(() => {
      if (index < line.text.length) {
        setDisplayedText(line.text.slice(0, index + 1));
        index += 1;
      } else {
        setIsTyping(false);
        clearInterval(timer);
      }
    }, 24);

    return () => {
      clearInterval(timer);
    };
  }, [line.id, line.text]);

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

  return (
    <Pressable
      className="absolute inset-0 z-30 justify-end px-4 pb-6"
      onPress={handlePress}
    >
      {character ? (
        <View className="mb-3 flex-row items-end gap-3">
          <View className="w-16 h-16 rounded-full border border-[#E7C7A0]/55 overflow-hidden bg-[#1E1711] items-center justify-center">
            {character.avatarUrl ? (
              <Image
                source={{ uri: character.avatarUrl }}
                className="w-full h-full"
                resizeMode="cover"
              />
            ) : (
              <Ionicons name="person" size={24} color="#F6B76F" />
            )}
          </View>
          <View className="px-2 py-1 rounded-full bg-black/45 border border-white/15">
            <Text className="text-[11px] text-white/85" style={{ fontFamily: fonts.displayBold }}>
              {character.name}
            </Text>
          </View>
        </View>
      ) : null}

      <View
        className={`rounded-2xl border px-4 py-4 ${
          isNarrator
            ? "bg-black/55 border-white/10"
            : "bg-[#1F1A16]/80 border-[#EE8C2B]/30"
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
          >
            <Ionicons
              name={
                tone === "character"
                  ? "person"
                  : tone === "system"
                    ? "flash-outline"
                    : "book-outline"
              }
              size={12}
              color={tone === "character" ? "#EE8C2B" : "#D8D3CD"}
            />
          </View>

          <Text
            className="text-xs text-[#E9E3DC] flex-1"
            style={{ fontFamily: fonts.displayBold }}
            numberOfLines={1}
          >
            {character
              ? `${character.name}${character.role ? ` · ${character.role}` : ""}`
              : tone === "narrator"
                ? "Narration"
                : "System"}
          </Text>

          {!isTyping ? (
            <Text className="text-[10px] text-[#C6BEB4]" style={{ fontFamily: fonts.bodyRegular }}>
              {isLast ? "完了" : "次へ"}
            </Text>
          ) : null}
        </View>

        <Text
          className={`text-[15px] leading-7 ${tone === "narrator" ? "text-white/85" : "text-white"}`}
          style={{ fontFamily: fonts.bodyRegular }}
        >
          {displayedText}
          {isTyping ? "|" : ""}
        </Text>
      </View>
    </Pressable>
  );
};

export const GamePlayScreen = ({ navigation, route }: Props) => {
  const { questId, startEpisodeNo } = route.params;
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
  const [playerAvatarUrl, setPlayerAvatarUrl] = useState<string | null>(null);
  const [playerInitial, setPlayerInitial] = useState("U");
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [distance, setDistance] = useState<number | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>(
    "locationUnavailable"
  );

  const startedAtRef = useRef<number>(Date.now());
  const choiceFlowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrivalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consequenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);

  const currentSpot = quest?.spots[currentSpotIndex] || null;
  const nextSpot = quest?.spots[currentSpotIndex + 1] || null;
  const isLastSpot = Boolean(quest && currentSpotIndex >= quest.spots.length - 1);
  const activeDialogue = dialogues[dialogueIndex] || null;

  const characterNameMap = useMemo(() => {
    const map = new Map<string, string>();
    (quest?.characters || []).forEach((character) => {
      const key = normalizeSpeakerName(character.name);
      if (key) {
        map.set(key, character.id);
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

      if (byId) {
        return {
          id: byId.id,
          name: byId.name,
          role: byId.role,
          avatarUrl: line.avatarUrl || byId.avatarUrl || null,
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
      setMode("travel");
    });
  }, [requestGpsPermission]);

  const handleDialogueComplete = useCallback(() => {
    const isLast = dialogueIndex >= dialogues.length - 1;

    if (!isLast) {
      setDialogueIndex((prev) => prev + 1);
      return;
    }

    if (mode === "prologue") {
      if (prologueNextMode === "story_pre") {
        setHasPlayedOpeningPrologue(true);
        beginPreStory();
        return;
      }
      beginTravelMode();
      return;
    }

    if (mode === "story_pre") {
      setMode("puzzle");
      return;
    }

    if (mode === "story_post") {
      if (isLastSpot) {
        beginEpilogue();
      } else {
        setCurrentSpotIndex((prev) => prev + 1);
        beginTravelMode();
      }
      return;
    }

    if (mode === "epilogue") {
      setMode("completed");
    }
  }, [
    dialogueIndex,
    dialogues.length,
    mode,
    prologueNextMode,
    beginPreStory,
    beginTravelMode,
    isLastSpot,
    beginEpilogue,
  ]);

  const canArrive =
    mode === "travel" &&
    gpsEnabled &&
    (currentSpot?.lat == null || currentSpot?.lng == null || locationStatus === "nearTarget" || __DEV__);

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

    beginPreStory();
  }, [
    canArrive,
    currentSpotIndex,
    hasPlayedOpeningPrologue,
    prologueDialogues.length,
    beginPreStory,
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
  ]);

  const handleRevealHint = useCallback(() => {
    if (!currentSpot) return;

    if (hasChoicePuzzle) {
      if (!primaryChoiceHint) return;
      setShowChoiceHint((prev) => !prev);
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
        const loaded = await fetchGameplayQuest(questId);
        if (!active) return;

        if (!loaded || loaded.spots.length === 0) {
          setQuest(null);
          setLoadError("プレイ可能なスポットが見つかりません。");
          return;
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
          const key = normalizeSpeakerName(character.name);
          if (key) {
            loadedCharacterNameMap.set(key, character.id);
          }
        });

        const loadedPrimaryCharacterId = loaded.characters?.[0]?.id || null;
        const loadedSecondaryCharacterId =
          loaded.characters?.[1]?.id || loadedPrimaryCharacterId;
        const loadedPrimaryCharacterName =
          loaded.characters?.[0]?.name || "案内人";
        const loadedSecondaryCharacterName =
          loaded.characters?.[1]?.name || loadedPrimaryCharacterName;

        const builtPrologue = ensureCharacterPresence(
          toDialogues(
            prologueSeed.map((line, index) => ({
              id: `prologue-${index}`,
              speakerType: "narrator",
              text: line,
            })),
            "物語の導入",
            {
              nameToCharacterId: loadedCharacterNameMap,
              defaultCharacterId: loadedPrimaryCharacterId,
            }
          ),
          loadedPrimaryCharacterId,
          loadedPrimaryCharacterName,
          `${loadedPrimaryCharacterName}です。準備ができたら、最初のスポットへ向かいましょう。`
        );

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
        startedAtRef.current = Date.now();
      } catch (error) {
        console.error("GamePlayScreen: failed to load gameplay quest", error);
        if (active) {
          setLoadError("ゲームプレイデータの読み込みに失敗しました。");
          setQuest(null);
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

    if (!currentSpot || currentSpot.lat == null || currentSpot.lng == null) {
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
              currentSpot.lat as number,
              currentSpot.lng as number
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
  }, [gpsEnabled, currentSpot?.id, currentSpot?.lat, currentSpot?.lng]);

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

  const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
  const gpsStatusText = gpsRequesting ? "..." : gpsEnabled ? "ON" : "OFF";
  const travelPhaseLabel =
    mode === "travel" && currentSpotIndex === 0 && !hasPlayedOpeningPrologue
      ? "START POINT"
      : "NEXT SPOT";
  const travelHeadline =
    mode === "travel" && currentSpotIndex === 0 && !hasPlayedOpeningPrologue
      ? "最初のスポットに向かいましょう"
      : "次のスポットに移動";
  const travelGuideText =
    mode === "travel" && currentSpotIndex === 0 && !hasPlayedOpeningPrologue
      ? "この到着でゲーム開始。到着後にプロローグと第1章へ進みます。"
      : "到着後に会話と謎解きが始まり、次の章へ進行します。";

  const travelPrimaryCtaText = canArrive
    ? mode === "travel" && currentSpotIndex === 0 && !hasPlayedOpeningPrologue
      ? "到着してゲーム開始"
      : "到着して次のミッション開始"
    : mode === "travel" && currentSpotIndex === 0 && !hasPlayedOpeningPrologue
      ? "最初のスポット付近で開始可能"
      : "目的地付近で有効になります";

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
        <Text className="text-white/70 text-sm text-center mb-5" style={{ fontFamily: fonts.bodyRegular }}>
          {loadError || "必要なスポット情報が不足しています。"}
        </Text>
        <Pressable
          className="h-11 px-6 rounded-xl bg-[#EE8C2B] items-center justify-center"
          onPress={() => navigation.goBack()}
        >
          <Text className="text-white text-sm" style={{ fontFamily: fonts.displayBold }}>
            戻る
          </Text>
        </Pressable>
      </View>
    );
  }

  const hasSpotCoordinates = currentSpot.lat != null && currentSpot.lng != null;
  const mapCenter = hasSpotCoordinates
    ? { lat: currentSpot.lat as number, lng: currentSpot.lng as number }
    : userLocation || DEFAULT_MAP_CENTER;

  const routeCoordinates =
    userLocation && hasSpotCoordinates
      ? [
          { latitude: userLocation.lat, longitude: userLocation.lng },
          {
            latitude: currentSpot.lat as number,
            longitude: currentSpot.lng as number,
          },
        ]
      : null;

  return (
    <View className="flex-1 bg-black">
      {mode === "travel" && hasSpotCoordinates ? (
        <View className="absolute inset-0">
          <MapView
            key={currentSpot.id}
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

            <Marker
              coordinate={{
                latitude: currentSpot.lat as number,
                longitude: currentSpot.lng as number,
              }}
              title={currentSpot.name}
              pinColor="#EE8C2B"
            />

            {nextSpot && nextSpot.lat != null && nextSpot.lng != null ? (
              <Marker
                coordinate={{
                  latitude: nextSpot.lat,
                  longitude: nextSpot.lng,
                }}
                title={nextSpot.name}
                pinColor="#B6ADA3"
              />
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
      ) : (
        <Image
          source={{ uri: currentSpot.backgroundImage || quest.coverImageUrl || undefined }}
          className="absolute inset-0 w-full h-full"
          resizeMode="cover"
        />
      )}
      <View className={`absolute inset-0 ${mode === "travel" ? "bg-black/38" : "bg-black/62"}`} />

      {mode !== "opening_prologue" ? (
        <SafeAreaView edges={["top"]} className="absolute top-0 left-0 right-0 z-20 px-4 pt-1">
          <View className="flex-row items-center justify-between">
            <Pressable
              className="w-9 h-9 rounded-full bg-black/45 items-center justify-center"
              onPress={() => navigation.goBack()}
            >
              <Ionicons name="close" size={16} color="#FFFFFF" />
            </Pressable>

            <View className="px-3 py-1.5 rounded-full bg-black/45 flex-row items-center gap-1.5">
              {quest.spots.map((spot, index) => (
                <View
                  key={spot.id}
                  className={`h-1 rounded-full ${
                    index < currentSpotIndex
                      ? "w-4 bg-[#EE8C2B]"
                      : index === currentSpotIndex
                        ? "w-6 bg-[#F6B76F]"
                        : "w-2 bg-white/25"
                  }`}
                />
              ))}
            </View>

            <View
              className={`h-8 rounded-full border px-2.5 flex-row items-center gap-1.5 ${
                gpsRequesting
                  ? "border-[#F2D2A6]/60 bg-[#EE8C2B]/25"
                  : gpsEnabled
                    ? "border-[#9FE1B0]/70 bg-[#4AAE6A]/25"
                    : "border-[#E5B2AE]/70 bg-[#BF5349]/25"
              }`}
            >
              <Ionicons
                name="locate-outline"
                size={12}
                color={gpsRequesting ? "#FDE7C8" : gpsEnabled ? "#D5F6DE" : "#FFE2E0"}
              />
              <Text className="text-[10px] text-white" style={{ fontFamily: fonts.displayBold }}>
                {gpsStatusText}
              </Text>
            </View>
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

      {mode === "location_gate" ? (
        <View className="absolute inset-0 z-40 items-center justify-center bg-black/70 px-6">
          <View className="w-full rounded-2xl border border-[#EE8C2B]/35 bg-black/72 px-5 py-5">
            <View className="mb-3 flex-row items-center gap-2">
              <Ionicons name="location-outline" size={16} color="#EE8C2B" />
              <Text className="text-[11px] text-[#F5D7B0] tracking-[1.5px]" style={{ fontFamily: fonts.displayBold }}>
                LOCATION REQUIRED
              </Text>
            </View>
            <Text className="text-white text-lg mb-2" style={{ fontFamily: fonts.displayBold }}>
              現在地を有効化してください
            </Text>
            <Text className="text-white/80 text-sm leading-6 mb-4" style={{ fontFamily: fonts.bodyRegular }}>
              ゲーム開始前に位置情報の許可が必要です。許可後に移動フェーズへ進みます。
            </Text>

            {gpsError ? (
              <Text className="text-[#FFC7C3] text-xs mb-3" style={{ fontFamily: fonts.bodyRegular }}>
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
          </View>
        </View>
      ) : null}

      {mode === "opening_prologue" ? (
        <View className="absolute inset-0 z-40 bg-[#0A0807]">
          <Image
            source={{ uri: currentSpot.backgroundImage || quest.coverImageUrl || undefined }}
            className="absolute inset-0 w-full h-full"
            resizeMode="cover"
          />
          <View className="absolute inset-0 bg-black/45" />
          <View className="absolute inset-0 bg-[#FA7C33]/12" />

          <SafeAreaView edges={["top", "bottom"]} className="flex-1 px-6 py-3 justify-between">
            <View className="items-start">
              <Pressable
                className="w-10 h-10 rounded-full border border-white/20 bg-black/30 items-center justify-center"
                onPress={() => navigation.goBack()}
              >
                <Ionicons name="close" size={16} color="#FFFFFF" />
              </Pressable>
            </View>

            <View className="items-center pb-2">
              <Pressable className="px-3 py-2" onPress={beginOpeningPrologueFlow}>
                <Text className="text-[#F5D7B0] text-[11px] tracking-[2px]" style={{ fontFamily: fonts.displayBold }}>
                  ▼ タップで開始
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      ) : null}

      {mode === "travel" ? (
        <SafeAreaView edges={["bottom"]} className="absolute bottom-0 left-0 right-0 z-30 px-4 pb-3">
          <View className="rounded-2xl border border-[#EE8C2B]/28 bg-black/72 px-4 py-4">
            <View className="flex-row items-start justify-between mb-3">
              <View className="flex-1 pr-4">
                <Text className="text-[#F5D7B0] text-[11px] tracking-[2px]" style={{ fontFamily: fonts.displayBold }}>
                  {travelPhaseLabel}
                </Text>
                <Text className="text-white text-lg mt-1" style={{ fontFamily: fonts.displayBold }}>
                  {currentSpot.name}
                </Text>
                <Text className="text-white/70 text-xs mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                  {travelHeadline}
                </Text>
              </View>

              <View className="items-end">
                <Text className="text-white/60 text-[11px]" style={{ fontFamily: fonts.bodyRegular }}>
                  距離
                </Text>
                <Text className="text-[#F6B76F] text-sm" style={{ fontFamily: fonts.displayBold }}>
                  {formatDistance(distance)}
                </Text>
              </View>
            </View>

            <View className="flex-row items-start gap-2 mb-3">
              <Ionicons name="compass-outline" size={14} color="#F6B76F" style={{ marginTop: 1 }} />
              <Text className="text-white/72 text-xs flex-1" style={{ fontFamily: fonts.bodyRegular }}>
                {travelGuideText}
              </Text>
            </View>

            {distance != null ? (
              <Text className="text-white/60 text-[11px] mb-3" style={{ fontFamily: fonts.bodyRegular }}>
                徒歩の目安: 約{Math.ceil((distance / 1000 / 5) * 60)}分
              </Text>
            ) : null}

            {gpsError ? (
              <Text className="text-[#FFC7C3] text-[11px] mb-2" style={{ fontFamily: fonts.bodyRegular }}>
                {gpsError}
              </Text>
            ) : null}

            <Pressable
              onPress={handleArrive}
              disabled={!canArrive}
              className={`h-11 rounded-xl items-center justify-center ${
                canArrive ? "bg-[#EE8C2B]" : "bg-[#6B625A]"
              }`}
            >
              <Text className="text-white text-sm" style={{ fontFamily: fonts.displayBold }}>
                {travelPrimaryCtaText}
              </Text>
            </Pressable>

            {!canArrive && gpsEnabled && locationStatus === "tooFar" && nextSpot ? (
              <Text className="text-white/50 text-[10px] mt-2" style={{ fontFamily: fonts.bodyRegular }}>
                次の候補: {nextSpot.name}
              </Text>
            ) : null}
          </View>
        </SafeAreaView>
      ) : null}

      {(mode === "prologue" ||
        mode === "story_pre" ||
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
        />
      ) : null}

      {mode === "puzzle" && !consequence ? (
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
          <SafeAreaView
            edges={["bottom"]}
            className="absolute bottom-0 left-0 right-0 z-30 px-4 pb-3"
          >
            <View className="rounded-2xl border border-[#EE8C2B]/28 bg-black/72 px-4 py-4">
              <View className="flex-row items-center gap-3 mb-4">
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
        )
      ) : null}

      {mode === "completed" ? (
        <View className="absolute inset-0 z-40 items-center justify-center bg-black/70 px-6">
          <View className="w-full rounded-2xl border border-[#EE8C2B]/35 bg-black/65 px-6 py-6">
            <View className="w-14 h-14 rounded-full bg-[#EE8C2B] items-center justify-center self-center mb-4">
              <Ionicons name="sparkles" size={24} color="#FFFFFF" />
            </View>
            <Text className="text-white text-lg text-center mb-1" style={{ fontFamily: fonts.displayBold }}>
              エピソード完了
            </Text>
            <Text className="text-white/70 text-sm text-center mb-4" style={{ fontFamily: fonts.bodyRegular }}>
              この旅の選択は、次のシリーズに引き継がれます。
            </Text>

            <View className="rounded-xl bg-white/8 border border-white/15 px-4 py-3 mb-4">
              <Text className="text-xs text-white/75" style={{ fontFamily: fonts.bodyRegular }}>
                所要時間: {formatDuration(durationSeconds)}
              </Text>
              <Text className="text-xs text-white/75 mt-1" style={{ fontFamily: fonts.bodyRegular }}>
                ミス: {wrongAnswers} / ヒント使用: {hintsUsed}
              </Text>
            </View>

            <View className="flex-row items-center gap-2">
              <Pressable
                className="flex-1 h-10 rounded-xl border border-white/20 bg-white/5 items-center justify-center"
                onPress={() => navigation.goBack()}
              >
                <Text className="text-white/90 text-sm" style={{ fontFamily: fonts.displayBold }}>
                  戻る
                </Text>
              </Pressable>

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

      {mode === "puzzle" && !hasChoicePuzzle ? (
        <View className="absolute left-4 top-[110px] z-20 rounded-xl bg-black/38 px-3 py-2">
          <Text className="text-[11px] text-white/75" style={{ fontFamily: fonts.bodyRegular }}>
            ミス: {wrongAnswers} / 試行: {attemptCount} / ヒント: {hintsUsed}
          </Text>
        </View>
      ) : null}

      {mode !== "travel" && mode !== "location_gate" ? (
        <View className="absolute left-4 bottom-4 z-10 rounded-full bg-black/35 px-3 py-1.5">
          <Text className="text-[10px] text-white/80" style={{ fontFamily: fonts.displayBold }}>
            {quest.title}
          </Text>
        </View>
      ) : null}
    </View>
  );
};
