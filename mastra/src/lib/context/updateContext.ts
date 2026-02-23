import type { QuestContext, NarrativePromise, RelationshipState } from "./questContext";

export const updateRelationships = (
  ctx: QuestContext,
  action: { actors: [string, string]; change: number; reason: string }
): QuestContext => {
  const [sourceId, targetId] = action.actors;
  const key = `${sourceId}:${targetId}`;
  const current = ctx.relationshipMap.get(key);
  if (!current) return ctx;

  const nextValue = Math.max(-10, Math.min(10, current.value + action.change));
  const nextState: RelationshipState = {
    ...current,
    value: nextValue,
    dynamic: current.dynamic || "neutral",
    history: [...current.history, `${action.reason} (${action.change >= 0 ? "+" : ""}${action.change})`],
  };

  const nextMap = new Map(ctx.relationshipMap);
  nextMap.set(key, nextState);

  return {
    ...ctx,
    relationshipMap: nextMap,
  };
};

export const resolvePromise = (
  ctx: QuestContext,
  promiseId: string,
  spotIndex: number
): QuestContext => {
  const nextPromises = ctx.narrativePromises.map((promise) => {
    if (promise.id !== promiseId) return promise;
    return {
      ...promise,
      status: "resolved" as NarrativePromise["status"],
      setupSpotIndex: promise.setupSpotIndex,
    };
  });

  return {
    ...ctx,
    narrativePromises: nextPromises,
  };
};
