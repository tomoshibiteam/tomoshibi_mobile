import { SpotCandidate } from "./spotTypes";
import { haversineKm } from "./geo";
import {
  buildQuestOverpassFilters,
  extractQuestSpotKindLabelsJaFromTags,
} from "./questSpotCategories";

export interface OverpassFetchOptions {
  center: { lat: number; lng: number };
  radiusKm: number;
  includeConvenience?: boolean;
  maxCandidates?: number;
  elementTypes?: Array<"node" | "way" | "relation">;
  timeoutSec?: number;
  endpoint?: string;
  endpoints?: string[];
  timeoutMs?: number;
}

export interface OverpassBboxFetchOptions {
  bbox: { south: number; north: number; west: number; east: number };
  includeConvenience?: boolean;
  maxCandidates?: number;
  elementTypes?: Array<"node" | "way" | "relation">;
  timeoutSec?: number;
  endpoint?: string;
  endpoints?: string[];
  timeoutMs?: number;
  distanceCenter?: { lat: number; lng: number };
}

const DEFAULT_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const buildFilterList = (options?: { includeConvenience?: boolean }) =>
  buildQuestOverpassFilters({ includeConvenience: Boolean(options?.includeConvenience) });

const resolveEndpointList = (options: {
  endpoint?: string;
  endpoints?: string[];
}) => {
  let endpointList =
    options.endpoints && options.endpoints.length > 0
      ? options.endpoints
      : options.endpoint
        ? [options.endpoint]
        : DEFAULT_ENDPOINTS;

  // Prefer stable endpoints first and avoid known flaky ones.
  endpointList = endpointList.filter((item) => !item.includes("overpass.nchc.org.tw"));
  endpointList = endpointList.sort((a, b) => {
    const weight = (url: string) => {
      if (url.includes("overpass-api.de")) return 0;
      if (url.includes("overpass.openstreetmap.fr")) return 1;
      if (url.includes("overpass.kumi.systems")) return 2;
      return 3;
    };
    return weight(a) - weight(b);
  });
  return endpointList;
};

const fetchOverpassElements = async (options: {
  query: string;
  endpoint?: string;
  endpoints?: string[];
  timeoutSec?: number;
  timeoutMs?: number;
}) => {
  const { query, timeoutSec = 25, timeoutMs, endpoint, endpoints } = options;

  const resolvedTimeoutMs =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
      ? timeoutMs
      : Math.max((timeoutSec + 5) * 1000, 20000);
  const endpointList = resolveEndpointList({ endpoint, endpoints });

  let lastError: unknown = null;
  let data: any = null;

  for (const candidateEndpoint of endpointList) {
    try {
      const response = await fetch(candidateEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(resolvedTimeoutMs),
      });
      if (!response.ok) {
        let body = "";
        try {
          body = await response.text();
        } catch {
          body = "";
        }
        throw new Error(`Overpass error ${response.status}: ${body.slice(0, 200)}`);
      }
      data = await response.json();
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  if (lastError) {
    throw lastError;
  }
  if (!data || !Array.isArray(data.elements)) {
    return [];
  }
  return data.elements as any[];
};

const mapElementsToCandidates = (params: {
  elements: any[];
  maxCandidates?: number;
  distanceCenter?: { lat: number; lng: number };
}): { candidates: SpotCandidate[]; totalFetched: number } => {
  const { elements, maxCandidates, distanceCenter } = params;

  const candidateLimit =
    typeof maxCandidates === "number" && Number.isFinite(maxCandidates) && maxCandidates > 0
      ? Math.floor(maxCandidates)
      : undefined;
  const candidates: SpotCandidate[] = [];

  elements.forEach((item: any) => {
    const tags = item?.tags || {};
    const lat = typeof item.lat === "number" ? item.lat : item.center?.lat;
    const lng = typeof item.lon === "number" ? item.lon : item.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number") return;

    const kinds = extractQuestSpotKindLabelsJaFromTags(tags).join(",");
    if (!kinds) return;
    const rawName = tags["name:ja"] || tags.name || tags["name:en"];
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) return;

    const addrParts = [
      tags["addr:full"],
      tags["addr:prefecture"],
      tags["addr:city"],
      tags["addr:ward"],
      tags["addr:street"],
      tags["addr:housenumber"],
    ]
      .filter((part) => typeof part === "string" && part.trim())
      .map((part) => String(part).trim());
    const address = addrParts.length > 0 ? addrParts.join("") : undefined;

    candidates.push({
      id: `${item.type}:${item.id}`,
      name: name.trim(),
      lat,
      lng,
      kinds: kinds || undefined,
      address,
      distance_km: distanceCenter ? haversineKm(distanceCenter, { lat, lng }) : undefined,
      source: "overpass",
    });
  });

  const sorted = distanceCenter
    ? candidates.sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0))
    : candidates;

  return {
    candidates: candidateLimit ? sorted.slice(0, candidateLimit) : sorted,
    totalFetched: candidates.length,
  };
};

export const fetchOverpassCandidates = async (
  options: OverpassFetchOptions
): Promise<{ candidates: SpotCandidate[]; totalFetched: number }> => {
  const {
    center,
    radiusKm,
    includeConvenience,
    maxCandidates,
    elementTypes,
    timeoutSec = 25,
    endpoint,
    endpoints,
    timeoutMs,
  } = options;
  const radiusMeters = Math.max(200, Math.round(radiusKm * 1000));
  const filterList = buildFilterList({ includeConvenience });
  const resolvedElements =
    elementTypes && elementTypes.length > 0 ? elementTypes : (["node"] as const);
  const filterBlocks = filterList
    .map((filter) => {
      const clause = filter.trim();
      if (!clause) return "";
      return resolvedElements
        .map(
          (element) =>
            `${element}(around:${radiusMeters},${center.lat},${center.lng})[${clause}];`
        )
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");

  const query = [
    `[out:json][timeout:${timeoutSec}];`,
    "(",
    filterBlocks,
    ");",
    "out center tags;",
  ].join("\n");
  const elements = await fetchOverpassElements({
    query,
    endpoint,
    endpoints,
    timeoutSec,
    timeoutMs,
  });
  return mapElementsToCandidates({ elements, maxCandidates, distanceCenter: center });
};

export const fetchOverpassCandidatesInBbox = async (
  options: OverpassBboxFetchOptions
): Promise<{ candidates: SpotCandidate[]; totalFetched: number }> => {
  const {
    bbox,
    includeConvenience,
    maxCandidates,
    elementTypes,
    timeoutSec = 25,
    endpoint,
    endpoints,
    timeoutMs,
    distanceCenter,
  } = options;
  const filterList = buildFilterList({ includeConvenience });
  const resolvedElements =
    elementTypes && elementTypes.length > 0
      ? elementTypes
      : (["node", "way", "relation"] as const);
  const filterBlocks = filterList
    .map((filter) => {
      const clause = filter.trim();
      if (!clause) return "";
      return resolvedElements
        .map(
          (element) =>
            `${element}(${bbox.south},${bbox.west},${bbox.north},${bbox.east})[${clause}];`
        )
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");
  const query = [
    `[out:json][timeout:${timeoutSec}];`,
    "(",
    filterBlocks,
    ");",
    "out center tags;",
  ].join("\n");
  const elements = await fetchOverpassElements({
    query,
    endpoint,
    endpoints,
    timeoutSec,
    timeoutMs,
  });
  return mapElementsToCandidates({ elements, maxCandidates, distanceCenter });
};
