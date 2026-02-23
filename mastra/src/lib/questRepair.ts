import { QuestOutput } from "../schemas/quest";
import { deriveRouteConstraints, haversineKm } from "./geo";

export const normalizePlayerName = (quest: QuestOutput, playerName?: string) => {
  if (!playerName) return quest;
  const replaceValue = (value: any): any => {
    if (typeof value === "string") {
      return value.replace(/<<PLAYER_NAME>>/g, playerName);
    }
    if (Array.isArray(value)) return value.map(replaceValue);
    if (value && typeof value === "object") {
      const next: any = Array.isArray(value) ? [] : {};
      Object.entries(value).forEach(([key, entry]) => {
        next[key] = replaceValue(entry);
      });
      return next;
    }
    return value;
  };
  return replaceValue(quest);
};

export const ensureDialogueArrays = (quest: QuestOutput) => {
  const next = JSON.parse(JSON.stringify(quest)) as QuestOutput;
  let updated = false;
  next.creator_payload.spots.forEach((spot) => {
    if (!Array.isArray(spot.pre_mission_dialogue)) {
      spot.pre_mission_dialogue = [];
      updated = true;
    }
    if (!Array.isArray(spot.post_mission_dialogue)) {
      spot.post_mission_dialogue = [];
      updated = true;
    }
  });
  return { output: next, updated };
};

export const applyRouteOptimization = (quest: QuestOutput) => {
  const spots = quest.creator_payload.spots;
  if (!Array.isArray(spots) || spots.length <= 2) {
    return { output: quest, updated: false };
  }

  const coords = spots.map((spot) => ({ lat: spot.lat, lng: spot.lng }));
  const center = coords[0];
  if (!center) return { output: quest, updated: false };

  const constraints = deriveRouteConstraints(3, spots.length);
  const order = coords
    .map((coord, idx) => ({ idx, dist: haversineKm(center, coord) }))
    .sort((a, b) => a.dist - b.dist)
    .map((item) => item.idx);

  const reordered = order.map((idx) => spots[idx]);
  const updated = JSON.stringify(reordered) !== JSON.stringify(spots);
  if (!updated) return { output: quest, updated: false };

  return {
    output: {
      ...quest,
      creator_payload: {
        ...quest.creator_payload,
        spots: reordered,
      },
    },
    updated: true,
  };
};

export const buildFallbackQuest = (quest: QuestOutput) => quest;
