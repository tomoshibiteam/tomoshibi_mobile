import { SpotCandidate } from "./spotTypes";

export const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

export const deriveRouteConstraints = (radiusKm: number, spotCount: number) => {
  const clampLeg = (value: number) => Math.max(0.05, Math.min(0.75, value));
  const envMin = Number.parseFloat(process.env.MASTRA_MIN_LEG_KM || "");
  const envMax = Number.parseFloat(process.env.MASTRA_MAX_LEG_KM || "");
  // Keep minimum leg distance in the practical short-walk range (50m-100m).
  // This avoids stale env values (e.g. 0.3km) from over-constraining dense-area routes.
  const configuredMinLegKm = Number.isFinite(envMin) ? envMin : 0.05;
  const minLegKm = clampLeg(Math.max(0.05, Math.min(0.1, configuredMinLegKm)));
  const defaultMaxLegKm = radiusKm
    ? Math.min(0.75, Math.max(minLegKm, radiusKm * 0.35))
    : 0.75;
  const maxLegKm = Math.max(minLegKm, clampLeg(Number.isFinite(envMax) ? envMax : defaultMaxLegKm));
  const legs = Math.max(1, spotCount - 1);
  const envMaxTotal = Number.parseFloat(process.env.MASTRA_MAX_TOTAL_KM || "");
  const defaultMaxTotalKm = Math.max(1.0, Math.min(6.3, maxLegKm * legs * 1.4));
  const maxTotalKm = Number.isFinite(envMaxTotal)
    ? Math.max(1.0, Math.min(6.3, envMaxTotal))
    : defaultMaxTotalKm;
  return { minLegKm, maxLegKm, maxTotalKm };
};

const toProjectedCoords = (spots: Array<{ lat: number; lng: number }>) => {
  const avgLat = spots.reduce((sum, spot) => sum + spot.lat, 0) / Math.max(1, spots.length);
  const lngScale = Math.max(0.01, Math.cos((avgLat * Math.PI) / 180));
  return spots.map((spot) => ({
    x: spot.lng * 111.32 * lngScale,
    y: spot.lat * 111.32,
  }));
};

type AxisMode = "principal" | "lat" | "lng";

export interface AxisRouteDiagnostics {
  axisMode: AxisMode;
  candidateCount: number;
  sortedCount: number;
  edgeCandidates: number;
  usableEdges: number;
  usableStartRanks: number;
  completePaths: number;
  selected: boolean;
  selectedSpanKm?: number;
  selectedTotalKm?: number;
  selectedMaxLegAngleDeg?: number;
  selectedMaxPointOffsetKm?: number;
  failureReason?: string;
}

export interface RouteSelectionDiagnostics {
  candidateCount: number;
  requestedSpotCount: number;
  minLegKm: number;
  maxLegKm: number;
  selectedAxisMode?: AxisMode;
  selectedSpanKm?: number;
  selectedTotalKm?: number;
  selectedMaxLegAngleDeg?: number;
  selectedMaxPointOffsetKm?: number;
  axisDiagnostics: AxisRouteDiagnostics[];
}

export interface RouteSelectionOptions {
  startNameHints?: string[];
  greedyStepFallbackKm?: number[];
}

const buildAxisProjection = (spots: Array<{ lat: number; lng: number }>, axisMode: AxisMode) => {
  const projected = toProjectedCoords(spots);
  const latValues = projected.map((coord) => coord.y);
  const lngValues = projected.map((coord) => coord.x);
  const latSpan = Math.max(...latValues) - Math.min(...latValues);
  const lngSpan = Math.max(...lngValues) - Math.min(...lngValues);
  const useLng = axisMode === "lng" || (axisMode === "principal" && lngSpan >= latSpan);
  const axisValues = useLng ? lngValues : latValues;
  const sortedIndices = axisValues
    .map((value, index) => ({ index, value }))
    .sort((a, b) => a.value - b.value)
    .map((entry) => entry.index);
  const spanKm = Math.max(0, Math.max(...axisValues) - Math.min(...axisValues));
  return { axisValues, sortedIndices, spanKm };
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

type ProjectedPoint = { x: number; y: number };

const orientation = (a: ProjectedPoint, b: ProjectedPoint, c: ProjectedPoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const within = (value: number, min: number, max: number, eps = 1e-9) =>
  value >= min - eps && value <= max + eps;

const onSegment = (a: ProjectedPoint, b: ProjectedPoint, c: ProjectedPoint) =>
  within(c.x, Math.min(a.x, b.x), Math.max(a.x, b.x)) &&
  within(c.y, Math.min(a.y, b.y), Math.max(a.y, b.y));

const segmentsIntersect = (
  a1: ProjectedPoint,
  a2: ProjectedPoint,
  b1: ProjectedPoint,
  b2: ProjectedPoint
) => {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (Math.abs(o1) <= 1e-9 && onSegment(a1, a2, b1)) return true;
  if (Math.abs(o2) <= 1e-9 && onSegment(a1, a2, b2)) return true;
  if (Math.abs(o3) <= 1e-9 && onSegment(b1, b2, a1)) return true;
  if (Math.abs(o4) <= 1e-9 && onSegment(b1, b2, a2)) return true;
  return false;
};

export interface OneWayLineDiagnostics {
  pass: boolean;
  reason?: string;
  spanKm: number;
  forwardKm: number;
  backwardKm: number;
  maxAllowedBackwardKm: number;
  maxObservedLegAngleDeg: number;
  maxAllowedLegAngleDeg: number;
  maxObservedPointOffsetKm: number;
  maxAllowedPointOffsetKm: number;
}

export const evaluateOneWayLineRoute = (
  spots: Array<{ lat: number; lng: number }>
): OneWayLineDiagnostics => {
  const maxAllowedLegAngleDeg = clamp(
    Number.parseFloat(
      process.env.MASTRA_ROUTE_MAX_TURN_DEG ||
        process.env.MASTRA_ROUTE_MAX_LINE_ANGLE_DEG ||
        "150"
    ),
    80,
    179
  );
  const backtrackRatio = clamp(
    Number.parseFloat(process.env.MASTRA_ROUTE_BACKTRACK_RATIO || "0.45"),
    0.15,
    0.8
  );
  const revisitDistanceKm = clamp(
    Number.parseFloat(process.env.MASTRA_ROUTE_REVISIT_DISTANCE_KM || "0.05"),
    0.02,
    0.2
  );
  if (!Array.isArray(spots) || spots.length <= 2) {
    return {
      pass: true,
      spanKm: 0,
      forwardKm: 0,
      backwardKm: 0,
      maxAllowedBackwardKm: 0,
      maxObservedLegAngleDeg: 0,
      maxAllowedLegAngleDeg,
      maxObservedPointOffsetKm: 0,
      maxAllowedPointOffsetKm: revisitDistanceKm,
    };
  }

  const projected = toProjectedCoords(spots);
  const spanKm = haversineKm(spots[0], spots[spots.length - 1]);

  let forward = 0;
  let backward = 0;
  let maxObservedLegAngleDeg = 0;
  for (let i = 1; i < spots.length; i += 1) {
    forward += haversineKm(spots[i - 1], spots[i]);
  }
  for (let i = 1; i < projected.length - 1; i += 1) {
    const prev = projected[i - 1];
    const curr = projected[i];
    const next = projected[i + 1];
    const vx1 = curr.x - prev.x;
    const vy1 = curr.y - prev.y;
    const vx2 = next.x - curr.x;
    const vy2 = next.y - curr.y;
    const len1 = Math.hypot(vx1, vy1);
    const len2 = Math.hypot(vx2, vy2);
    if (len1 <= 1e-9 || len2 <= 1e-9) continue;

    const dot = (vx1 * vx2 + vy1 * vy2) / (len1 * len2);
    const angleDeg = (Math.acos(clamp(dot, -1, 1)) * 180) / Math.PI;
    if (angleDeg > maxObservedLegAngleDeg) maxObservedLegAngleDeg = angleDeg;
    if (dot < 0) backward += Math.min(len1, len2) * Math.abs(dot);
  }

  const maxAllowedBackwardKm = Math.max(0.03, forward * backtrackRatio);
  if (backward > maxAllowedBackwardKm + 1e-6) {
    return {
      pass: false,
      reason: "backtracking_exceeded",
      spanKm,
      forwardKm: forward,
      backwardKm: backward,
      maxAllowedBackwardKm,
      maxObservedLegAngleDeg,
      maxAllowedLegAngleDeg,
      maxObservedPointOffsetKm: 0,
      maxAllowedPointOffsetKm: revisitDistanceKm,
    };
  }

  if (maxObservedLegAngleDeg > maxAllowedLegAngleDeg + 1e-6) {
    return {
      pass: false,
      reason: "u_turn_detected",
      spanKm,
      forwardKm: forward,
      backwardKm: backward,
      maxAllowedBackwardKm,
      maxObservedLegAngleDeg,
      maxAllowedLegAngleDeg,
      maxObservedPointOffsetKm: 0,
      maxAllowedPointOffsetKm: revisitDistanceKm,
    };
  }

  for (let i = 0; i < projected.length - 1; i += 1) {
    const a1 = projected[i];
    const a2 = projected[i + 1];
    for (let j = i + 2; j < projected.length - 1; j += 1) {
      const b1 = projected[j];
      const b2 = projected[j + 1];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        return {
          pass: false,
          reason: "self_intersection",
          spanKm,
          forwardKm: forward,
          backwardKm: backward,
          maxAllowedBackwardKm,
          maxObservedLegAngleDeg,
          maxAllowedLegAngleDeg,
          maxObservedPointOffsetKm: 0,
          maxAllowedPointOffsetKm: revisitDistanceKm,
        };
      }
    }
  }

  for (let i = 0; i < spots.length; i += 1) {
    for (let j = i + 2; j < spots.length; j += 1) {
      const distanceKm = haversineKm(spots[i], spots[j]);
      if (distanceKm <= revisitDistanceKm + 1e-6) {
        return {
          pass: false,
          reason: "revisit_area",
          spanKm,
          forwardKm: forward,
          backwardKm: backward,
          maxAllowedBackwardKm,
          maxObservedLegAngleDeg,
          maxAllowedLegAngleDeg,
          maxObservedPointOffsetKm: distanceKm,
          maxAllowedPointOffsetKm: revisitDistanceKm,
        };
      }
    }
  }

  return {
    pass: true,
    spanKm,
    forwardKm: forward,
    backwardKm: backward,
    maxAllowedBackwardKm,
    maxObservedLegAngleDeg,
    maxAllowedLegAngleDeg,
    maxObservedPointOffsetKm: 0,
    maxAllowedPointOffsetKm: revisitDistanceKm,
  };
};

export const isOneWayLineRoute = (spots: Array<{ lat: number; lng: number }>) => {
  return evaluateOneWayLineRoute(spots).pass;
};

interface BeamState {
  path: number[];
  lastRank: number;
  totalKm: number;
  score: number;
}

const buildMonotonicPathByAxis = (params: {
  candidates: SpotCandidate[];
  center: { lat: number; lng: number };
  spotCount: number;
  maxLegKm: number;
  minLegKm: number;
  axisMode: AxisMode;
}) => {
  const { candidates, center, spotCount, maxLegKm, minLegKm, axisMode } = params;
  const baseDiagnostics: AxisRouteDiagnostics = {
    axisMode,
    candidateCount: candidates.length,
    sortedCount: 0,
    edgeCandidates: 0,
    usableEdges: 0,
    usableStartRanks: 0,
    completePaths: 0,
    selected: false,
  };
  if (candidates.length < spotCount || spotCount <= 0) {
    return {
      route: [] as SpotCandidate[],
      diagnostics: {
        ...baseDiagnostics,
        failureReason: "insufficient_candidates",
      },
    };
  }

  const { axisValues, sortedIndices } = buildAxisProjection(candidates, axisMode);
  if (sortedIndices.length < spotCount) {
    return {
      route: [] as SpotCandidate[],
      diagnostics: {
        ...baseDiagnostics,
        sortedCount: sortedIndices.length,
        failureReason: "insufficient_sorted_candidates",
      },
    };
  }

  const legTarget = (minLegKm + maxLegKm) / 2;
  const maxBranch = Math.max(6, Math.min(18, spotCount * 3));
  const beamWidth = Math.max(24, Math.min(96, spotCount * 12));
  let edgeCandidates = 0;
  let usableEdges = 0;

  type Edge = { nextRank: number; distanceKm: number; axisDelta: number };
  const forwardEdges: Edge[][] = sortedIndices.map(() => []);

  for (let i = 0; i < sortedIndices.length; i += 1) {
    const fromIdx = sortedIndices[i];
    const from = candidates[fromIdx];
    const edges: Edge[] = [];
    for (let j = i + 1; j < sortedIndices.length; j += 1) {
      const toIdx = sortedIndices[j];
      const to = candidates[toIdx];
      const legKm = haversineKm(from, to);
      edgeCandidates += 1;
      if (legKm + 1e-6 < minLegKm || legKm - 1e-6 > maxLegKm) continue;
      const axisDelta = axisValues[toIdx] - axisValues[fromIdx];
      if (axisDelta <= 0) continue;
      edges.push({ nextRank: j, distanceKm: legKm, axisDelta });
      usableEdges += 1;
    }
    edges.sort((a, b) => {
      const aPenalty = Math.abs(a.distanceKm - legTarget);
      const bPenalty = Math.abs(b.distanceKm - legTarget);
      if (aPenalty !== bPenalty) return aPenalty - bPenalty;
      return b.axisDelta - a.axisDelta;
    });
    forwardEdges[i] = edges.slice(0, maxBranch);
  }

  const startRanks = sortedIndices
    .map((idx, rank) => ({
      rank,
      distanceKm: haversineKm(center, candidates[idx]),
    }))
    .filter((entry) => entry.rank <= sortedIndices.length - spotCount)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map((entry) => entry.rank);
  baseDiagnostics.sortedCount = sortedIndices.length;
  baseDiagnostics.edgeCandidates = edgeCandidates;
  baseDiagnostics.usableEdges = usableEdges;
  baseDiagnostics.usableStartRanks = startRanks.length;

  const complete: BeamState[] = [];

  for (const startRank of startRanks) {
    let beams: BeamState[] = [
      {
        path: [sortedIndices[startRank]],
        lastRank: startRank,
        totalKm: 0,
        score: 0,
      },
    ];

    for (let depth = 1; depth < spotCount; depth += 1) {
      const nextStates: BeamState[] = [];
      beams.forEach((state) => {
        const edges = forwardEdges[state.lastRank] || [];
        edges.forEach((edge) => {
          const nextIndex = sortedIndices[edge.nextRank];
          const nextPath = [...state.path, nextIndex];
          const spanKm = axisValues[nextIndex] - axisValues[nextPath[0]];
          const legPenalty = Math.abs(edge.distanceKm - legTarget);
          const centerPenalty = haversineKm(center, candidates[nextIndex]);
          const totalKm = state.totalKm + edge.distanceKm;
          const score =
            spanKm * 10 - totalKm * 0.15 - legPenalty * 0.8 - centerPenalty * 0.08;
          nextStates.push({
            path: nextPath,
            lastRank: edge.nextRank,
            totalKm,
            score,
          });
        });
      });

      if (nextStates.length === 0) {
        beams = [];
        break;
      }

      nextStates.sort((a, b) => b.score - a.score);
      const dedup = new Map<string, BeamState>();
      nextStates.forEach((state) => {
        const key = `${state.lastRank}:${state.path.length}`;
        const prev = dedup.get(key);
        if (!prev || state.score > prev.score) {
          dedup.set(key, state);
        }
      });
      beams = Array.from(dedup.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, beamWidth);
    }

    beams.forEach((state) => {
      if (state.path.length === spotCount) complete.push(state);
    });
  }
  baseDiagnostics.completePaths = complete.length;

  if (complete.length === 0) {
    return {
      route: [] as SpotCandidate[],
      diagnostics: {
        ...baseDiagnostics,
        failureReason: "no_complete_path",
      },
    };
  }

  complete.sort((a, b) => {
    const aSpan = axisValues[a.path[a.path.length - 1]] - axisValues[a.path[0]];
    const bSpan = axisValues[b.path[b.path.length - 1]] - axisValues[b.path[0]];
    if (bSpan !== aSpan) return bSpan - aSpan;
    if (b.score !== a.score) return b.score - a.score;
    return a.totalKm - b.totalKm;
  });

  const best = complete[0].path.map((idx) => candidates[idx]);
  const totalKm = best.reduce((sum, spot, idx) => {
    if (idx === 0) return sum;
    return sum + haversineKm(best[idx - 1], spot);
  }, 0);
  const spanKm = haversineKm(best[0], best[best.length - 1]);
  const lineCheck = evaluateOneWayLineRoute(best);
  if (!lineCheck.pass) {
    return {
      route: [] as SpotCandidate[],
      diagnostics: {
        ...baseDiagnostics,
        failureReason: lineCheck.reason || "best_path_failed_one_way_check",
      },
    };
  }
  return {
    route: best,
    diagnostics: {
      ...baseDiagnostics,
      selected: true,
      selectedSpanKm: spanKm,
      selectedTotalKm: totalKm,
      selectedMaxLegAngleDeg: lineCheck.maxObservedLegAngleDeg,
      selectedMaxPointOffsetKm: lineCheck.maxObservedPointOffsetKm,
    },
  };
};

const shuffleIndices = (size: number) => {
  const list = Array.from({ length: size }, (_, idx) => idx);
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
};

const unitVector = (x: number, y: number) => {
  const len = Math.hypot(x, y);
  if (len <= 1e-9) return null;
  return { x: x / len, y: y / len, lenKm: len };
};

const routeTotalKm = (route: Array<{ lat: number; lng: number }>) =>
  route.reduce((sum, spot, idx) => {
    if (idx === 0) return sum;
    return sum + haversineKm(route[idx - 1], spot);
  }, 0);

const pickRandomTop = <T>(items: T[], topN: number) => {
  if (items.length === 0) return null;
  const cap = Math.max(1, Math.min(topN, items.length));
  const idx = Math.floor(Math.random() * cap);
  return items[idx];
};

const SYNTHETIC_SPOT_NAME_PATTERN = /\((node|way|relation):\d+\)\s*$/i;
const GENERIC_SPOT_NAMES = new Set([
  "友人",
  "再会",
  "出会い",
  "絆",
  "記憶",
  "希望",
  "未来",
  "過去",
]);

const normalizeRouteHintText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[、。,.!！?？・\-–—()（）\[\]「」『』]/g, "");

const isMeaningfulRouteSpotName = (value: string) => {
  const name = String(value || "").trim();
  if (!name) return false;
  if (SYNTHETIC_SPOT_NAME_PATTERN.test(name)) return false;
  if (GENERIC_SPOT_NAMES.has(name)) return false;
  const normalized = normalizeRouteHintText(name);
  if (!normalized) return false;
  if (normalized.length < 3) return false;
  if (/^[0-9]+$/.test(normalized)) return false;
  return true;
};

const isRouteHintMatch = (candidateName: string, hint: string) => {
  const c = normalizeRouteHintText(candidateName);
  const h = normalizeRouteHintText(hint);
  if (!c || !h) return false;
  return c.includes(h) || h.includes(c);
};

const deriveGreedyStartIndex = (params: {
  candidates: SpotCandidate[];
  center: { lat: number; lng: number };
  startNameHints: string[];
}) => {
  const { candidates, center, startNameHints } = params;
  if (candidates.length === 0) return -1;
  const byDistance = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      distanceKm: haversineKm(center, candidate),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
  if (startNameHints.length > 0) {
    const matched = byDistance
      .filter(({ candidate }) =>
        startNameHints.some((hint) => isRouteHintMatch(candidate.name || "", hint))
      )
      .sort((a, b) => a.distanceKm - b.distanceKm);
    const meaningfulMatched = matched.find(({ candidate }) =>
      isMeaningfulRouteSpotName(candidate.name || "")
    );
    if (meaningfulMatched) return meaningfulMatched.index;
    if (matched.length > 0) return matched[0].index;
  }
  const meaningfulNearest = byDistance.find(({ candidate }) =>
    isMeaningfulRouteSpotName(candidate.name || "")
  );
  if (meaningfulNearest) return meaningfulNearest.index;
  return byDistance[0]?.index ?? 0;
};

const resolveGreedyStepFallbacks = (fallbacks?: number[]) => {
  const raw = Array.isArray(fallbacks) && fallbacks.length > 0 ? fallbacks : [0.1, 0.08, 0.05];
  const values = raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.max(0.02, Math.min(1.5, value)));
  const unique = Array.from(new Set(values));
  return unique.sort((a, b) => b - a);
};

const buildGreedyNearestRoute = (params: {
  candidates: SpotCandidate[];
  center: { lat: number; lng: number };
  spotCount: number;
  maxLegKm: number;
  minLegKm: number;
  startNameHints: string[];
  fallbackStepsKm: number[];
}) => {
  const {
    candidates,
    center,
    spotCount,
    maxLegKm,
    minLegKm,
    startNameHints,
    fallbackStepsKm,
  } = params;
  if (candidates.length < spotCount || spotCount <= 0) {
    return {
      route: [] as SpotCandidate[],
      selectedStartIndex: -1,
      thresholdTrail: [] as number[],
      failureReason: "insufficient_candidates",
      failedAtStep: 0,
    };
  }

  const startIndex = deriveGreedyStartIndex({
    candidates,
    center,
    startNameHints,
  });
  if (startIndex < 0 || startIndex >= candidates.length) {
    return {
      route: [] as SpotCandidate[],
      selectedStartIndex: -1,
      thresholdTrail: [] as number[],
      failureReason: "start_not_found",
      failedAtStep: 0,
    };
  }

  const path: number[] = [startIndex];
  const visited = new Set<number>(path);
  const thresholdTrail: number[] = [];

  while (path.length < spotCount) {
    const currentIndex = path[path.length - 1];
    const current = candidates[currentIndex];

    let pickedIndex = -1;
    let pickedThreshold = 0;
    let pickedDistance = Number.POSITIVE_INFINITY;

    for (const rawThreshold of fallbackStepsKm) {
      const stepThreshold = Math.max(minLegKm, rawThreshold);
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let i = 0; i < candidates.length; i += 1) {
        if (visited.has(i)) continue;
        const legKm = haversineKm(current, candidates[i]);
        if (legKm + 1e-6 < stepThreshold) continue;
        if (legKm - 1e-6 > maxLegKm) continue;
        if (legKm < bestDistance) {
          bestDistance = legKm;
          bestIndex = i;
        }
      }

      if (bestIndex >= 0) {
        pickedIndex = bestIndex;
        pickedThreshold = stepThreshold;
        pickedDistance = bestDistance;
        break;
      }
    }

    if (pickedIndex < 0) {
      return {
        route: [] as SpotCandidate[],
        selectedStartIndex: startIndex,
        thresholdTrail,
        failureReason: "no_next_spot_for_thresholds",
        failedAtStep: path.length,
      };
    }

    path.push(pickedIndex);
    visited.add(pickedIndex);
    thresholdTrail.push(pickedThreshold);
    if (!Number.isFinite(pickedDistance) || pickedDistance <= 0) {
      return {
        route: [] as SpotCandidate[],
        selectedStartIndex: startIndex,
        thresholdTrail,
        failureReason: "invalid_next_leg",
        failedAtStep: path.length,
      };
    }
  }

  const route = path.map((index) => candidates[index]);
  const line = evaluateOneWayLineRoute(route);
  if (!line.pass) {
    return {
      route: [] as SpotCandidate[],
      selectedStartIndex: startIndex,
      thresholdTrail,
      failureReason: line.reason || "line_check_failed",
      failedAtStep: spotCount,
    };
  }

  return {
    route,
    selectedStartIndex: startIndex,
    thresholdTrail,
    failureReason: null as string | null,
    failedAtStep: null as number | null,
    line,
  };
};

export const selectRouteCandidatesWithDiagnostics = (
  candidates: SpotCandidate[],
  center: { lat: number; lng: number },
  spotCount: number,
  maxLegKm: number,
  minLegKm = 0,
  options?: RouteSelectionOptions
) => {
  const rawCandidateCount = candidates.length;
  const meaningfulCandidates = candidates.filter((candidate) =>
    isMeaningfulRouteSpotName(candidate.name || "")
  );
  const nameFilterApplied =
    meaningfulCandidates.length >= spotCount &&
    meaningfulCandidates.length < candidates.length;
  if (nameFilterApplied) {
    candidates = meaningfulCandidates;
  }

  const diagnostics: RouteSelectionDiagnostics = {
    candidateCount: candidates.length,
    requestedSpotCount: spotCount,
    minLegKm,
    maxLegKm,
    axisDiagnostics: [],
  };
  const baseAxisDiagnostics: AxisRouteDiagnostics = {
    axisMode: "principal",
    candidateCount: candidates.length,
    sortedCount: candidates.length,
    edgeCandidates: 0,
    usableEdges: 0,
    usableStartRanks: 0,
    completePaths: 0,
    selected: false,
  };
  (diagnostics as any).candidateFilter = {
    rawCandidateCount,
    meaningfulCandidateCount: meaningfulCandidates.length,
    usedCandidateCount: candidates.length,
    applied: nameFilterApplied,
  };

  if (!candidates.length || spotCount <= 0) {
    diagnostics.axisDiagnostics.push({
      ...baseAxisDiagnostics,
      sortedCount: 0,
      failureReason: "invalid_input",
    });
    return { route: [] as SpotCandidate[], diagnostics };
  }
  if (candidates.length < spotCount) {
    diagnostics.axisDiagnostics.push({
      ...baseAxisDiagnostics,
      failureReason: "insufficient_candidates",
    });
    return { route: [] as SpotCandidate[], diagnostics };
  }

  const startNameHints =
    options?.startNameHints
      ?.map((hint) => String(hint || "").trim())
      .filter(Boolean) || [];
  const fallbackStepsKm = resolveGreedyStepFallbacks(options?.greedyStepFallbackKm);
  const greedy = buildGreedyNearestRoute({
    candidates,
    center,
    spotCount,
    maxLegKm,
    minLegKm,
    startNameHints,
    fallbackStepsKm,
  });
  if (greedy.route.length === spotCount) {
    const selected = greedy.route;
    const selectedTotalKm = routeTotalKm(selected);
    const selectedSpanKm = haversineKm(selected[0], selected[selected.length - 1]);
    diagnostics.selectedAxisMode = "principal";
    diagnostics.selectedSpanKm = selectedSpanKm;
    diagnostics.selectedTotalKm = selectedTotalKm;
    diagnostics.selectedMaxLegAngleDeg = greedy.line?.maxObservedLegAngleDeg;
    diagnostics.selectedMaxPointOffsetKm = greedy.line?.maxObservedPointOffsetKm;
    diagnostics.axisDiagnostics.push({
      ...baseAxisDiagnostics,
      selected: true,
      completePaths: 1,
      failureReason: "greedy_nearest_v1",
      selectedSpanKm,
      selectedTotalKm,
      selectedMaxLegAngleDeg: greedy.line?.maxObservedLegAngleDeg,
      selectedMaxPointOffsetKm: greedy.line?.maxObservedPointOffsetKm,
    });
    (diagnostics as any).greedyStats = {
      planner: "greedy_nearest_v1",
      startNameHints,
      selectedStartIndex: greedy.selectedStartIndex,
      selectedStartName: selected[0]?.name || "",
      minStepFallbackKm: fallbackStepsKm,
      thresholdTrail: greedy.thresholdTrail,
      fallbackUsed: greedy.thresholdTrail.some(
        (threshold: number) => threshold + 1e-9 < fallbackStepsKm[0]
      ),
    };
    return { route: selected, diagnostics };
  }

  const projected = toProjectedCoords(candidates);
  const legTarget = (minLegKm + maxLegKm) / 2;
  const maxTurnDeg = Math.max(
    45,
    Math.min(170, Number.parseFloat(process.env.MASTRA_ROUTE_MAX_TURN_DEG || "125"))
  );
  const rawMinForwardDot = Number.parseFloat(
    process.env.MASTRA_ROUTE_MIN_FORWARD_DOT || process.env.MASTRA_ROUTE_MIN_FORWARD_KM || ""
  );
  const minForwardDot = Number.isFinite(rawMinForwardDot)
    ? clamp(rawMinForwardDot, -0.95, 0.8)
    : -0.2;
  const attemptBudget = Math.max(
    40,
    Math.min(
      1500,
      Number.parseInt(process.env.MASTRA_ROUTE_RANDOM_ATTEMPTS || "", 10) || candidates.length * 10
    )
  );

  let edgeCandidates = 0;
  let usableEdges = 0;
  let usableStartRanks = 0;
  let completePaths = 0;
  let maxReached = 0;
  let lastFailureReason = "no_attempt";
  const failureCounts = new Map<string, number>();
  const bumpFailure = (reason: string) => {
    lastFailureReason = reason;
    failureCounts.set(reason, (failureCounts.get(reason) || 0) + 1);
  };
  bumpFailure(greedy.failureReason || "greedy_failed");

  type CandidateRoute = {
    path: number[];
    score: number;
    line: OneWayLineDiagnostics;
  };
  const successfulRoutes: CandidateRoute[] = [];
  const startOrder = shuffleIndices(candidates.length);

  for (let attempt = 0; attempt < attemptBudget; attempt += 1) {
    const startIdx = startOrder[attempt % startOrder.length];
    const start = projected[startIdx];

    const secondOptions: Array<{
      idx: number;
      score: number;
    }> = [];
    for (let i = 0; i < candidates.length; i += 1) {
      if (i === startIdx) continue;
      const legKm = haversineKm(candidates[startIdx], candidates[i]);
      edgeCandidates += 1;
      if (legKm + 1e-6 < minLegKm || legKm - 1e-6 > maxLegKm) continue;
      const h = unitVector(projected[i].x - start.x, projected[i].y - start.y);
      if (!h) continue;
      usableEdges += 1;
      secondOptions.push({
        idx: i,
        score: Math.abs(legKm - legTarget) + haversineKm(center, candidates[startIdx]) * 0.05,
      });
    }
    if (secondOptions.length === 0) {
      bumpFailure("no_second_spot");
      continue;
    }
    usableStartRanks += 1;
    secondOptions.sort((a, b) => a.score - b.score);
    const second = pickRandomTop(secondOptions, 6);
    if (!second) {
      bumpFailure("no_second_spot");
      continue;
    }

    const path: number[] = [startIdx, second.idx];
    const visited = new Set<number>(path);
    let deadEnd = false;
    if (path.length > maxReached) maxReached = path.length;

    while (path.length < spotCount) {
      const currentIdx = path[path.length - 1];
      const current = projected[currentIdx];
      const prevIdx = path[path.length - 2];
      const previous = projected[prevIdx];
      const previousHeading = unitVector(current.x - previous.x, current.y - previous.y);
      if (!previousHeading) {
        deadEnd = true;
        bumpFailure("invalid_previous_heading");
        break;
      }
      const rawStepCandidates: Array<{
        idx: number;
        angleDeg: number;
        forwardDot: number;
        baseScore: number;
      }> = [];

      for (let i = 0; i < candidates.length; i += 1) {
        if (visited.has(i)) continue;
        const legKm = haversineKm(candidates[currentIdx], candidates[i]);
        edgeCandidates += 1;
        if (legKm + 1e-6 < minLegKm || legKm - 1e-6 > maxLegKm) continue;

        const v = unitVector(projected[i].x - current.x, projected[i].y - current.y);
        if (!v) continue;
        const forwardDot = v.x * previousHeading.x + v.y * previousHeading.y;
        if (forwardDot <= minForwardDot) continue;
        const cosTheta = clamp(forwardDot, -1, 1);
        const angleDeg = (Math.acos(cosTheta) * 180) / Math.PI;
        const centerPenalty = haversineKm(center, candidates[i]) * 0.04;
        usableEdges += 1;
        const baseScore =
          angleDeg * 1.2 +
          Math.abs(legKm - legTarget) * 35 +
          centerPenalty +
          (forwardDot < 0 ? 22 : 0);
        rawStepCandidates.push({
          idx: i,
          angleDeg,
          forwardDot,
          baseScore,
        });
      }

      if (rawStepCandidates.length === 0) {
        deadEnd = true;
        bumpFailure("no_forward_candidate");
        break;
      }

      type StepOption = { idx: number; score: number };
      const buildTier = (angleLimit: number) =>
        rawStepCandidates
          .filter((candidate) => candidate.angleDeg <= angleLimit + 1e-6)
          .map((candidate) => ({
            idx: candidate.idx,
            score: candidate.baseScore - candidate.forwardDot * 3,
          }));

      let stepOptions: StepOption[] = buildTier(maxTurnDeg);
      if (stepOptions.length === 0) {
        stepOptions = buildTier(Math.min(175, maxTurnDeg + 20));
      }
      if (stepOptions.length === 0) {
        stepOptions = buildTier(179);
      }

      if (stepOptions.length === 0) {
        deadEnd = true;
        bumpFailure("dead_end_before_completion");
        break;
      }
      stepOptions.sort((a, b) => a.score - b.score);
      const picked = pickRandomTop(stepOptions, 6);
      if (!picked) {
        deadEnd = true;
        bumpFailure("dead_end_before_completion");
        break;
      }
      path.push(picked.idx);
      visited.add(picked.idx);
      if (path.length > maxReached) maxReached = path.length;
    }

    if (deadEnd || path.length !== spotCount) continue;
    completePaths += 1;
    const route = path.map((idx) => candidates[idx]);
    const line = evaluateOneWayLineRoute(route);
    if (!line.pass) {
      bumpFailure(line.reason || "line_check_failed");
      continue;
    }
    const spanKm = haversineKm(route[0], route[route.length - 1]);
    const totalKm = routeTotalKm(route);
    const backtrackPenalty =
      line.forwardKm > 1e-6 ? line.backwardKm / Math.max(line.forwardKm, 1e-6) : 1;
    const score =
      line.maxObservedLegAngleDeg * 1.5 +
      backtrackPenalty * 140 +
      Math.abs(totalKm / Math.max(spanKm, 0.05) - 1.25) * 3.5;
    successfulRoutes.push({ path, score, line });
  }

  if (successfulRoutes.length === 0) {
    const fallbackAxisModes: AxisMode[] = ["principal", "lat", "lng"];
    let fallbackRoute: SpotCandidate[] = [];
    let fallbackDiag: AxisRouteDiagnostics | undefined;

    for (const axisMode of fallbackAxisModes) {
      const fallback = buildMonotonicPathByAxis({
        candidates,
        center,
        spotCount,
        maxLegKm,
        minLegKm,
        axisMode,
      });
      diagnostics.axisDiagnostics.push(fallback.diagnostics);
      if (fallback.route.length !== spotCount || !fallback.diagnostics.selected) continue;

      if (!fallbackRoute.length) {
        fallbackRoute = fallback.route;
        fallbackDiag = fallback.diagnostics;
        continue;
      }

      const prevSpan = fallbackDiag?.selectedSpanKm || 0;
      const nextSpan = fallback.diagnostics.selectedSpanKm || 0;
      const prevTotal = fallbackDiag?.selectedTotalKm || Number.POSITIVE_INFINITY;
      const nextTotal = fallback.diagnostics.selectedTotalKm || Number.POSITIVE_INFINITY;
      if (nextSpan > prevSpan || (nextSpan === prevSpan && nextTotal < prevTotal)) {
        fallbackRoute = fallback.route;
        fallbackDiag = fallback.diagnostics;
      }
    }

    (diagnostics as any).randomStats = {
      planner: "random_heading_v1",
      attemptBudget,
      maxTurnDeg,
      minForwardDot,
      maxReached,
      failureCounts: Object.fromEntries(failureCounts),
      fallbackUsed: fallbackRoute.length === spotCount,
    };

    if (fallbackRoute.length === spotCount) {
      diagnostics.selectedAxisMode = fallbackDiag?.axisMode || "principal";
      diagnostics.selectedSpanKm = fallbackDiag?.selectedSpanKm;
      diagnostics.selectedTotalKm = fallbackDiag?.selectedTotalKm;
      diagnostics.selectedMaxLegAngleDeg = fallbackDiag?.selectedMaxLegAngleDeg;
      diagnostics.selectedMaxPointOffsetKm = fallbackDiag?.selectedMaxPointOffsetKm;
      return { route: fallbackRoute, diagnostics };
    }

    diagnostics.axisDiagnostics.push({
      ...baseAxisDiagnostics,
      edgeCandidates,
      usableEdges,
      usableStartRanks,
      completePaths,
      selected: false,
      failureReason: lastFailureReason,
    });
    return { route: [] as SpotCandidate[], diagnostics };
  }

  successfulRoutes.sort((a, b) => a.score - b.score);
  const selected = successfulRoutes[0];
  const route = selected.path.map((idx) => candidates[idx]);
  const selectedTotalKm = routeTotalKm(route);
  const selectedSpanKm = haversineKm(route[0], route[route.length - 1]);
  diagnostics.selectedAxisMode = "principal";
  diagnostics.selectedSpanKm = selectedSpanKm;
  diagnostics.selectedTotalKm = selectedTotalKm;
  diagnostics.selectedMaxLegAngleDeg = selected.line.maxObservedLegAngleDeg;
  diagnostics.selectedMaxPointOffsetKm = selected.line.maxObservedPointOffsetKm;
  diagnostics.axisDiagnostics.push({
    ...baseAxisDiagnostics,
    edgeCandidates,
    usableEdges,
    usableStartRanks,
    completePaths,
    selected: true,
    selectedSpanKm,
    selectedTotalKm,
    selectedMaxLegAngleDeg: selected.line.maxObservedLegAngleDeg,
    selectedMaxPointOffsetKm: selected.line.maxObservedPointOffsetKm,
  });
  (diagnostics as any).randomStats = {
    planner: "random_heading_v1",
    attemptBudget,
    maxTurnDeg,
    minForwardDot,
    successCount: successfulRoutes.length,
    maxReached,
    failureCounts: Object.fromEntries(failureCounts),
    selectedRouteScore: selected.score,
  };
  return { route, diagnostics };
};

export const selectRouteCandidates = (
  candidates: SpotCandidate[],
  center: { lat: number; lng: number },
  spotCount: number,
  maxLegKm: number,
  minLegKm = 0,
  options?: RouteSelectionOptions
) => {
  const { route } = selectRouteCandidatesWithDiagnostics(
    candidates,
    center,
    spotCount,
    maxLegKm,
    minLegKm,
    options
  );
  return route;
};
