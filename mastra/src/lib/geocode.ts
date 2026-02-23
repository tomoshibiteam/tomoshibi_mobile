export interface GeocodeResult {
  lat: number;
  lng: number;
  name?: string;
  bbox?: {
    south: number;
    north: number;
    west: number;
    east: number;
  };
}

const normalizeLang = (value?: string) => {
  const lang = (value || "").toLowerCase();
  return lang || "ja";
};

export const geocodeWithNominatim = async (options: {
  query: string;
  endpoint?: string;
  lang?: string;
  timeoutMs?: number;
  userAgent?: string;
  countryCodes?: string[];
}): Promise<GeocodeResult | null> => {
  const query = options.query.trim();
  if (!query) return null;

  const rawEndpoint = (options.endpoint || "https://nominatim.openstreetmap.org/search").trim();
  const endpoint = /\/search$/i.test(rawEndpoint)
    ? rawEndpoint
    : `${rawEndpoint.replace(/\/+$/, "")}/search`;
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "1",
    addressdetails: "0",
  });
  if (Array.isArray(options.countryCodes) && options.countryCodes.length > 0) {
    const normalized = options.countryCodes
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
      .join(",");
    if (normalized) params.set("countrycodes", normalized);
  }
  const url = `${endpoint}?${params.toString()}`;
  const timeoutMs = options.timeoutMs ?? 8000;
  const lang = normalizeLang(options.lang);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Accept-Language": lang,
        "User-Agent": options.userAgent || "tomoshibi-mastra/1.0",
      },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;
  const item = data[0];
  const lat = parseFloat(item?.lat);
  const lng = parseFloat(item?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const bboxRaw = Array.isArray(item?.boundingbox) ? item.boundingbox : undefined;
  const south = bboxRaw ? parseFloat(bboxRaw[0]) : Number.NaN;
  const north = bboxRaw ? parseFloat(bboxRaw[1]) : Number.NaN;
  const west = bboxRaw ? parseFloat(bboxRaw[2]) : Number.NaN;
  const east = bboxRaw ? parseFloat(bboxRaw[3]) : Number.NaN;
  const bbox =
    Number.isFinite(south) &&
    Number.isFinite(north) &&
    Number.isFinite(west) &&
    Number.isFinite(east)
      ? {
          south: Math.min(south, north),
          north: Math.max(south, north),
          west: Math.min(west, east),
          east: Math.max(west, east),
        }
      : undefined;
  return {
    lat,
    lng,
    name: typeof item.display_name === "string" ? item.display_name : undefined,
    bbox,
  };
};
