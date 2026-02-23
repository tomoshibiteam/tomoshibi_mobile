import type { QuestOutput } from "../../schemas/quest";
import type { QuestContext } from "../context/questContext";

const MAX_RECENT_ADJECTIVES = 40;
const MAX_RECENT_STARTERS = 30;

const normalizeToken = (token: string) =>
  token.replace(/[、。,.!！?？・\-–—「」『』（）()]/g, "").trim();

const extractSentenceStarters = (text: string): string[] => {
  const starters: string[] = [];
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const starter = line.slice(0, Math.min(6, line.length));
    if (starter.length >= 2) starters.push(starter);
  }
  return starters;
};

const extractAdjectives = (text: string): string[] => {
  const tokens = text
    .split(/[\s　、。,.!！?？・\-–—「」『』（）()]/)
    .map((token) => normalizeToken(token))
    .filter(Boolean);

  const adjectives: string[] = [];
  for (const token of tokens) {
    if (token.length < 2) continue;
    if (token.endsWith("的") || token.endsWith("らしい") || token.endsWith("っぽい")) {
      adjectives.push(token);
      continue;
    }
    if (token.endsWith("い") || token.endsWith("な")) {
      adjectives.push(token);
    }
  }
  return adjectives;
};

export const updateUsageHistoryFromQuest = (
  ctx: QuestContext,
  quest: QuestOutput
): QuestContext => {
  const spots = quest.creator_payload?.spots || [];
  const lines: string[] = [];

  for (const spot of spots) {
    if (typeof (spot as any)?.scene_narration === "string") {
      lines.push(String((spot as any).scene_narration));
    }
    const pre = Array.isArray(spot.pre_mission_dialogue)
      ? spot.pre_mission_dialogue
      : [];
    const post = Array.isArray(spot.post_mission_dialogue)
      ? spot.post_mission_dialogue
      : [];
    for (const line of [...pre, ...post]) {
      if (line?.text) lines.push(String(line.text));
    }
  }

  const starters = lines.flatMap((line) => extractSentenceStarters(line));
  const adjectives = lines.flatMap((line) => extractAdjectives(line));

  const mergedStarters = [...ctx.usageHistory.recentSentenceStarters, ...starters].slice(-MAX_RECENT_STARTERS);
  const mergedAdjectives = [...ctx.usageHistory.recentAdjectives, ...adjectives].slice(-MAX_RECENT_ADJECTIVES);

  return {
    ...ctx,
    usageHistory: {
      ...ctx.usageHistory,
      recentSentenceStarters: mergedStarters,
      recentAdjectives: mergedAdjectives,
    },
  };
};

export const getForbiddenPhrases = (ctx: QuestContext): string[] => {
  const counts = new Map<string, number>();

  const bump = (token: string) => {
    const normalized = normalizeToken(token);
    if (!normalized) return;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  };

  ctx.usageHistory.recentAdjectives.forEach(bump);
  ctx.usageHistory.recentSentenceStarters.forEach(bump);

  const repeated = Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .map(([word]) => word);

  return Array.from(
    new Set([
      ...Array.from(ctx.usageHistory.globalForbidden),
      ...repeated,
    ])
  );
};
