import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RawSeriesGenerationRequest } from "../schemas/series-runtime-v2";

const clean = (value?: unknown) => (typeof value === "string" ? value : String(value ?? "")).replace(/\s+/g, " ").trim();
const normalize = (value?: string | null) => clean(value).toLowerCase();
const dedupe = (values: Array<string | undefined | null>) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = clean(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
};
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asRecordArray = (value: unknown) => (Array.isArray(value) ? value.map((item) => asRecord(item)) : []);
const asStringArray = (value: unknown) =>
  (Array.isArray(value) ? value : []).map((item) => clean(item)).filter(Boolean);

type SeriesGenerationContextDecision =
  | { action: "allow"; reason: string }
  | {
      action: "reject";
      reason: "existing_draft_conflict" | "too_many_drafts";
      title?: string;
      questId?: string;
      seriesId?: string;
    };

export type SeriesGenerationUserContext = {
  recentContext: Partial<RawSeriesGenerationRequest>;
  draftCount: number;
  decision: SeriesGenerationContextDecision;
};

let cachedSupabase: SupabaseClient | null | undefined;

const resolveSupabaseUrl = () =>
  clean(process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "");
const resolveSupabaseKey = () =>
  clean(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
      ""
  );

const getSupabase = () => {
  if (cachedSupabase !== undefined) return cachedSupabase;
  const url = resolveSupabaseUrl();
  const key = resolveSupabaseKey();
  if (!url || !key) {
    cachedSupabase = null;
    return cachedSupabase;
  }
  cachedSupabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "tomoshibi-mastra-series-context" } },
  });
  return cachedSupabase;
};

const limitRecentContext = (values: string[], limit = 8) => dedupe(values).slice(0, limit);

export const loadSeriesGenerationUserContext = async (params: {
  userId?: string;
  sourcePrompt: string;
  recentLimit?: number;
  maxDrafts?: number;
}): Promise<SeriesGenerationUserContext> => {
  const userId = clean(params.userId);
  const sourcePrompt = clean(params.sourcePrompt);
  const supabase = getSupabase();
  if (!sourcePrompt) {
    throw new Error("series_generation_source_prompt_missing");
  }
  if (!userId) {
    return {
      recentContext: {},
      draftCount: 0,
      decision: { action: "allow", reason: "user_id_missing" },
    };
  }
  if (!supabase) {
    throw new Error("series_generation_context_store_unavailable");
  }

  const questLimit = Math.max(1, params.recentLimit ?? 6);
  const maxDrafts = Math.max(1, params.maxDrafts ?? 10);

  const { data: questRows, error: questError } = await supabase
    .from("quests")
    .select("id, series_id, title, area_name, status, created_at")
    .eq("creator_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.max(questLimit, maxDrafts));

  if (questError) {
    throw questError;
  }

  if (!questRows || questRows.length === 0) {
    return {
      recentContext: {},
      draftCount: 0,
      decision: { action: "allow", reason: "no_existing_series" },
    };
  }

  const normalizedPrompt = normalize(sourcePrompt);
  const questIds = questRows
    .map((row) => clean((row as { id?: string | null }).id || ""))
    .filter(Boolean);
  const draftQuestRows = (questRows as Array<Record<string, unknown>>).filter(
    (row) => normalize(typeof row.status === "string" ? row.status : "") === "draft"
  );

  const bibleByQuestId = new Map<string, Record<string, unknown>>();
  try {
    const bibleQuery = await supabase
      .from("series_bibles")
      .select(
        "quest_id, title, overview, genre, tone, premise, season_goal, source_prompt, world, continuity, first_episode_seed, series_blueprint"
      )
      .in("quest_id", questIds)
      .eq("creator_id", userId);
    if (bibleQuery.error) throw bibleQuery.error;
    for (const row of (bibleQuery.data || []) as Array<Record<string, unknown>>) {
      const questId = clean(typeof row.quest_id === "string" ? row.quest_id : "");
      if (questId) bibleByQuestId.set(questId, row);
    }
  } catch (error) {
    const coded = error as { code?: string };
    const message = clean((error as { message?: string }).message);
    if (coded?.code !== "42P01" && !/column/i.test(message)) {
      throw error;
    }
  }

  const characterRowsByQuestId = new Map<string, Array<Record<string, unknown>>>();
  try {
    const characterQuery = await supabase
      .from("series_characters")
      .select("quest_id, role, personality, arc_start, arc_end")
      .in("quest_id", questIds)
      .eq("creator_id", userId);
    if (characterQuery.error) throw characterQuery.error;
    for (const row of (characterQuery.data || []) as Array<Record<string, unknown>>) {
      const questId = clean(typeof row.quest_id === "string" ? row.quest_id : "");
      if (!questId) continue;
      const rows = characterRowsByQuestId.get(questId) || [];
      rows.push(row);
      characterRowsByQuestId.set(questId, rows);
    }
  } catch (error) {
    const coded = error as { code?: string };
    const message = clean((error as { message?: string }).message);
    if (coded?.code !== "42P01" && !/column/i.test(message)) {
      throw error;
    }
  }

  const duplicateDraft = draftQuestRows.find((row) => {
    const questId = clean(typeof row.id === "string" ? row.id : "");
    const bible = bibleByQuestId.get(questId);
    const storedPrompt = clean(typeof bible?.source_prompt === "string" ? bible.source_prompt : "");
    return storedPrompt && normalize(storedPrompt) === normalizedPrompt;
  });

  if (duplicateDraft) {
    const questId = clean(typeof duplicateDraft.id === "string" ? duplicateDraft.id : "");
    const title =
      clean(typeof duplicateDraft.title === "string" ? duplicateDraft.title : "") ||
      clean(typeof bibleByQuestId.get(questId)?.title === "string" ? bibleByQuestId.get(questId)?.title : "");
    return {
      recentContext: {},
      draftCount: draftQuestRows.length,
      decision: {
        action: "reject",
        reason: "existing_draft_conflict",
        title: title || undefined,
        questId: questId || undefined,
        seriesId: clean(typeof duplicateDraft.series_id === "string" ? duplicateDraft.series_id : "") || undefined,
      },
    };
  }

  if (draftQuestRows.length >= maxDrafts) {
    return {
      recentContext: {},
      draftCount: draftQuestRows.length,
      decision: { action: "reject", reason: "too_many_drafts" },
    };
  }

  const recentTitles: string[] = [];
  const recentCaseMotifs: string[] = [];
  const recentCharacterArchetypes: string[] = [];
  const recentRelationshipPatterns: string[] = [];
  const recentVisualMotifs: string[] = [];
  const recentTruthPatterns: string[] = [];
  const recentCheckpointPatterns: string[] = [];
  const recentFirstEpisodePatterns: string[] = [];
  const recentEnvironmentPatterns: string[] = [];
  const recentAppearancePatterns: string[] = [];

  for (const questRow of (questRows as Array<Record<string, unknown>>).slice(0, questLimit)) {
    const questId = clean(typeof questRow.id === "string" ? questRow.id : "");
    const bible = bibleByQuestId.get(questId) || {};
    const world = asRecord(bible.world);
    const continuity = asRecord(bible.continuity);
    const firstEpisodeSeed = asRecord(bible.first_episode_seed);
    const seriesBlueprint = asRecord(bible.series_blueprint);
    const frameworkBrief = asRecord(seriesBlueprint.frameworkBrief);
    const seriesDesign = asRecord(frameworkBrief.seriesDesign);
    const continuityAxes = asRecord(seriesBlueprint.continuityAxes);
    const identityPack = asRecord(seriesBlueprint.identityPack);
    const seriesCoreAnchors = asRecord(identityPack.seriesCoreAnchors);
    const characterRows = characterRowsByQuestId.get(questId) || [];

    recentTitles.push(
      clean(typeof bible.title === "string" ? bible.title : "") ||
        clean(typeof questRow.title === "string" ? questRow.title : "")
    );
    recentCaseMotifs.push(
      clean(typeof continuity.global_mystery === "string" ? continuity.global_mystery : ""),
      clean(typeof bible.premise === "string" ? bible.premise : ""),
      clean(typeof bible.overview === "string" ? bible.overview : "")
    );
    recentTruthPatterns.push(
      clean(typeof continuity.finale_payoff === "string" ? continuity.finale_payoff : ""),
      clean(typeof continuity.mid_season_twist === "string" ? continuity.mid_season_twist : ""),
      clean(typeof bible.season_goal === "string" ? bible.season_goal : "")
    );
    recentEnvironmentPatterns.push(
      clean(typeof world.setting === "string" ? world.setting : ""),
      clean(typeof questRow.area_name === "string" ? questRow.area_name : "")
    );
    recentFirstEpisodePatterns.push(
      clean(typeof firstEpisodeSeed.opening_scene === "string" ? firstEpisodeSeed.opening_scene : ""),
      clean(typeof firstEpisodeSeed.completion_condition === "string" ? firstEpisodeSeed.completion_condition : ""),
      clean(typeof firstEpisodeSeed.route_style === "string" ? firstEpisodeSeed.route_style : "")
    );
    recentRelationshipPatterns.push(
      clean(typeof seriesDesign.relationshipPromise === "string" ? seriesDesign.relationshipPromise : ""),
      clean(typeof seriesDesign.fixedCastPolicy === "string" ? seriesDesign.fixedCastPolicy : "")
    );
    recentVisualMotifs.push(
      ...asStringArray(world.recurringMotifs),
      ...asStringArray(seriesCoreAnchors.nonNegotiableMood),
      ...asStringArray(seriesCoreAnchors.nonNegotiableTheme)
    );
    recentCheckpointPatterns.push(
      ...asRecordArray(continuityAxes.axes).map((row) => clean(typeof row.label === "string" ? row.label : "")),
      ...asRecordArray(continuityAxes.axes).map((row) =>
        clean(typeof row.carryOverRule === "string" ? row.carryOverRule : "")
      )
    );

    for (const row of characterRows) {
      recentCharacterArchetypes.push(
        clean(typeof row.role === "string" ? row.role : ""),
        clean(typeof row.personality === "string" ? row.personality : "")
      );
      recentAppearancePatterns.push(
        clean(typeof row.personality === "string" ? row.personality : ""),
        clean(typeof row.arc_start === "string" ? row.arc_start : ""),
        clean(typeof row.arc_end === "string" ? row.arc_end : "")
      );
    }
  }

  return {
    recentContext: {
      recentTitles: limitRecentContext(recentTitles),
      recentCaseMotifs: limitRecentContext(recentCaseMotifs),
      recentCharacterArchetypes: limitRecentContext(recentCharacterArchetypes),
      recentRelationshipPatterns: limitRecentContext(recentRelationshipPatterns),
      recentVisualMotifs: limitRecentContext(recentVisualMotifs),
      recentTruthPatterns: limitRecentContext(recentTruthPatterns),
      recentCheckpointPatterns: limitRecentContext(recentCheckpointPatterns),
      recentFirstEpisodePatterns: limitRecentContext(recentFirstEpisodePatterns),
      recentEnvironmentPatterns: limitRecentContext(recentEnvironmentPatterns),
      recentAppearancePatterns: limitRecentContext(recentAppearancePatterns),
    },
    draftCount: draftQuestRows.length,
    decision: { action: "allow", reason: "allowed" },
  };
};
