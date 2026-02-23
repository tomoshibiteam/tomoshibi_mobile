const DEFAULT_TIMEOUT_MS = 4500;
const DEFAULT_MIN_CHARS = 40;
const DEFAULT_MAX_CHARS = 140;

const cache = new Map<string, string | null>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (url: string, timeoutMs: number) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "tomoshibi-mastra/1.0" },
  });
  if (!response.ok) return null;
  return response.json();
};

const sanitizeSummary = (text: string, maxChars: number) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars).replace(/[、。,.!！?？・\-–—]+$/, "") + "…";
};

const shouldSkipSummary = (text: string) => {
  if (!text) return true;
  if (text.includes("曖昧さ回避")) return true;
  if (text.includes("may refer to")) return true;
  return false;
};

const buildQuery = (name: string, address?: string) => {
  const parts = [name];
  if (address) {
    const trimmed = address.replace(/[0-9\-−−丁目番地号]+/g, "").trim();
    if (trimmed) parts.push(trimmed.split(/[、,]/)[0]);
  }
  return parts.join(" ");
};

export const fetchWikipediaSummary = async (params: {
  name: string;
  address?: string;
  lang?: string;
  timeoutMs?: number;
  minChars?: number;
  maxChars?: number;
  retries?: number;
}): Promise<string | null> => {
  const name = params.name.trim();
  if (!name) return null;
  const key = `${name}:${params.address || ""}`;
  if (cache.has(key)) return cache.get(key) || null;

  const lang = params.lang || "ja";
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const minChars = params.minChars ?? DEFAULT_MIN_CHARS;
  const maxChars = params.maxChars ?? DEFAULT_MAX_CHARS;
  const retries = params.retries ?? 1;

  const query = buildQuery(name, params.address);
  const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query
  )}&format=json&utf8=1&srlimit=1`;

  let lastError: string | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const search = await fetchJson(searchUrl, timeoutMs);
      const title = search?.query?.search?.[0]?.title;
      if (!title || typeof title !== "string") {
        cache.set(key, null);
        return null;
      }
      const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
        title
      )}`;
      const summary = await fetchJson(summaryUrl, timeoutMs);
      const extract = summary?.extract;
      if (typeof extract !== "string" || shouldSkipSummary(extract)) {
        cache.set(key, null);
        return null;
      }
      const sanitized = sanitizeSummary(extract, maxChars);
      if (sanitized.length < minChars) {
        cache.set(key, null);
        return null;
      }
      cache.set(key, sanitized);
      return sanitized;
    } catch (err: any) {
      lastError = err?.message || "fetch failed";
      if (attempt < retries) await sleep(150);
    }
  }
  console.warn("[Wikipedia] fetch failed:", lastError);
  cache.set(key, null);
  return null;
};

