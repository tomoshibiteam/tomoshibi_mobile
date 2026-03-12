import dotenv from "dotenv";
import { generateSeriesWorkflowWithProgress } from "../src/workflows/series-workflow";
import {
  generateSeriesRuntimeEpisode,
  type SeriesRuntimeEpisodeOutput,
  seriesRuntimeEpisodeOutputSchema,
} from "../src/lib/agents/seriesRuntimeEpisodeAgent";
import { seriesWorkflowOutputSchema } from "../src/schemas/series";
import {
  applyEpisodeContinuityPatch,
  buildSeriesGenerationResultVNextFromLegacyOutput,
  generateEpisodeRuntimeVNext,
  generateSeriesGenerationResultVNext,
} from "../src/lib/runtime/seriesRuntimeVNext";

dotenv.config({ override: true });

type Check = {
  name: string;
  pass: boolean;
  detail?: string;
};

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();
const VERIFY_TIMEOUT_MS = Math.max(
  60_000,
  Number.parseInt(process.env.TOMOSHIBI_VERIFY_TIMEOUT_MS || "240000", 10)
);

const toCheck = (name: string, pass: boolean, detail?: string): Check => ({ name, pass, detail });

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const verify = async () => {
  const seriesEvents: string[] = [];
  const seriesInput = {
    interview: {
      genre_world: "現代日本の港町と路地裏を歩くミステリー",
      desired_emotion: "ワクワクと少しの緊張",
      companion_preference: "信頼できる年上の相棒",
      continuation_trigger: "次話で伏線が回収される感覚",
      avoidance_preferences: "過度にグロテスクな描写は避けたい",
      additional_notes: "地域の歴史と文化を自然に織り込んでほしい",
      visual_style_preset: "cinematic",
      visual_style_notes: "夕景、暖色、ややノスタルジック",
      main_objective: "街歩きで物語を進めたい",
      protagonist_position: "観察者として巻き込まれる立場",
      partner_description: "知的で面倒見のよい案内人",
    },
    desired_episode_count: 6,
    language: "ja",
    generation_mode: "proposal" as const,
  };

  const seriesResult = await generateSeriesWorkflowWithProgress(seriesInput, {
    onProgress: (event) => {
      seriesEvents.push(event.phase);
    },
  });

  const seriesParsed = seriesWorkflowOutputSchema.safeParse(seriesResult);
  if (!seriesParsed.success) {
    throw new Error("series output schema validation failed");
  }
  const series = seriesParsed.data.series;
  const seriesMeta = seriesParsed.data.meta;

  const primaryCount = series.characters.filter((character) => character.tier === "primary").length;
  const secondaryCount = series.characters.filter((character) => character.tier === "secondary").length;
  const seedRequirements = series.first_episode_seed.spot_requirements || [];

  const seriesChecks: Check[] = [
    toCheck("series.title non-empty", clean(series.title).length > 0),
    toCheck("series.checkpoints 4-8", series.checkpoints.length >= 4 && series.checkpoints.length <= 8),
    toCheck(
      "series.primary characters 1-2",
      primaryCount >= 1 && primaryCount <= 2,
      `primary=${primaryCount}`
    ),
    toCheck(
      "series.secondary characters <=3",
      secondaryCount >= 0 && secondaryCount <= 3,
      `secondary=${secondaryCount}`
    ),
    toCheck(
      "series.first_episode_seed.spot_requirements 2-4",
      seedRequirements.length >= 2 && seedRequirements.length <= 4,
      `requirements=${seedRequirements.length}`
    ),
    toCheck(
      "series.progress_state relationship fields present",
      clean(series.progress_state.relationship_state_summary).length > 0 &&
        Array.isArray(series.progress_state.relationship_flags) &&
        Array.isArray(series.progress_state.recent_relation_shift)
    ),
    toCheck(
      "series S6 dry-run meta exists",
      Boolean(seriesMeta.first_episode_seed_dry_run),
      seriesMeta.first_episode_seed_dry_run
        ? `feasible=${seriesMeta.first_episode_seed_dry_run.feasible}`
        : "missing"
    ),
    toCheck(
      "series progress contains S6 phases",
      seriesEvents.includes("seed_route_dry_run_start") && seriesEvents.includes("seed_route_dry_run_done")
    ),
  ];

  seedRequirements.forEach((requirement, index) => {
    seriesChecks.push(
      toCheck(
        `seed requirement[${index}] role fields complete`,
        clean(requirement.spot_role).length > 0 &&
          clean(requirement.tourism_value_type).length > 0 &&
          Array.isArray(requirement.required_attributes) &&
          Array.isArray(requirement.visit_constraints)
      )
    );
  });

  const episodeEvents: string[] = [];
  const forceRuntimeFallback =
    String(process.env.TOMOSHIBI_VERIFY_RUNTIME_FALLBACK || "").toLowerCase() === "1";
  const runtimeApiEnvKeys = [
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
  ] as const;
  const runtimeApiEnvBackup = Object.fromEntries(
    runtimeApiEnvKeys.map((key) => [key, process.env[key]])
  ) as Record<(typeof runtimeApiEnvKeys)[number], string | undefined>;
  const withRuntimeModelFallback = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (!forceRuntimeFallback) return fn();
    runtimeApiEnvKeys.forEach((key) => {
      process.env[key] = "";
    });
    try {
      return await fn();
    } finally {
      runtimeApiEnvKeys.forEach((key) => {
        process.env[key] = runtimeApiEnvBackup[key];
      });
    }
  };

  let episodeResult: SeriesRuntimeEpisodeOutput | undefined;
  episodeResult = await withRuntimeModelFallback(() =>
    generateSeriesRuntimeEpisode(
      {
        series: {
          title: series.title,
          overview: series.overview,
          premise: series.premise,
          season_goal: series.season_goal,
          ai_rules: series.ai_rules,
          world_setting: series.world.setting,
          continuity: series.continuity,
          progress_state: series.progress_state,
          first_episode_seed: series.first_episode_seed,
          checkpoints: series.checkpoints,
          characters: series.characters.map((character) => ({
            name: character.name,
            role: character.role,
            tier: character.tier,
            must_appear: character.must_appear,
            personality: character.personality,
            arc_start: character.arc_start,
            arc_end: character.arc_end,
          })),
          recent_episodes: [],
        },
        episode_request: {
          stage_location: "浅草",
          purpose: "歴史観光と街歩き",
          user_wishes: "レトロな街並みを楽しみつつ、次話が気になる導線にしてほしい",
          desired_spot_count: 5,
          desired_duration_minutes: 20,
          language: "ja",
        },
      },
      {
        onProgress: (event) => {
          episodeEvents.push(event.phase);
        },
      }
    )
  );

  if (!episodeResult) {
    throw new Error("episode generation returned empty result");
  }
  const episodeParsed = seriesRuntimeEpisodeOutputSchema.safeParse(episodeResult);
  if (!episodeParsed.success) {
    throw new Error("episode output schema validation failed");
  }
  const episode = episodeParsed.data;

  const episodeChecks: Check[] = [
    toCheck("episode.title non-empty", clean(episode.title).length > 0),
    toCheck("episode.spots 5-7", episode.spots.length >= 5 && episode.spots.length <= 7),
    toCheck(
      "episode.episode_world fields present",
      clean(episode.episode_world.title).length > 0 &&
        clean(episode.episode_world.mood).length > 0 &&
        clean(episode.episode_world.story_axis).length > 0
    ),
    toCheck(
      "episode.episode_unique_characters 2-3",
      episode.episode_unique_characters.length >= 2 &&
        episode.episode_unique_characters.length <= 3
    ),
    toCheck(
      "episode.progress_patch relationship fields present",
      clean(episode.progress_patch.relationship_state_summary).length > 0 &&
        Array.isArray(episode.progress_patch.relationship_flags_to_add) &&
        Array.isArray(episode.progress_patch.recent_relation_shift)
    ),
    toCheck(
      "episode.generation_trace exists",
      Boolean(episode.generation_trace),
      episode.generation_trace
        ? `optimizer=${episode.generation_trace.route_metrics.optimizer}, feasible=${episode.generation_trace.route_metrics.feasible}`
        : "missing"
    ),
    toCheck(
      "episode progress contains spot resolution phases",
      episodeEvents.includes("spot_resolution_start") && episodeEvents.includes("spot_resolution_done")
    ),
  ];

  episode.spots.forEach((spot, index) => {
    episodeChecks.push(
      toCheck(
        `episode.spot[${index}] puzzle fields non-empty`,
        clean(spot.question_text).length > 0 &&
          clean(spot.answer_text).length > 0 &&
          clean(spot.hint_text).length > 0
      )
    );
  });

  const vNextEvents: string[] = [];
  const vNextRawRequest = {
    userId: "verify-user",
    interview:
      "現代日本の港町と路地裏を歩くミステリー。固定キャラとの関係が少しずつ進み、次話で伏線回収される体験がほしい。",
    prompt: "夕景の街歩きで、関係性と回収を重視したシリーズを生成してください。",
    desiredEpisodeLimit: 6,
    explicitGenreHints: ["ミステリー", "街歩き", "人間ドラマ"],
    excludedDirections: ["過度にグロテスクな描写"],
    safetyPreferences: ["現実の公共空間で成立する導線を優先"],
  };
  const vNextSeries = forceRuntimeFallback
    ? buildSeriesGenerationResultVNextFromLegacyOutput(vNextRawRequest, {
        series,
        meta: seriesMeta,
      })
    : await withTimeout(
        withRuntimeModelFallback(() =>
          generateSeriesGenerationResultVNext(vNextRawRequest)
        ),
        VERIFY_TIMEOUT_MS,
        "vNext series generation"
      );

  let lastVNextPhase = "";
  const vNextEpisodeResult = await withTimeout(
    withRuntimeModelFallback(() =>
      generateEpisodeRuntimeVNext(
      {
        request: {
          userId: "verify-user",
          seriesBlueprintId: vNextSeries.seriesBlueprint.id,
          userSeriesStateId: `verify-user:${vNextSeries.seriesBlueprint.id}`,
          episodeRequest: {
            locationContext: {
              cityOrArea: "浅草",
              transportMode: "walk",
              availableMinutes: 20,
              candidateSpots: ["雷門", "仲見世商店街", "隅田川テラス"],
            },
            tourismGoal: "歴史観光と街歩き",
            desiredMoodToday: ["レトロ", "発見", "少し緊張感"],
          },
          runtimeOptions: {
            maxSpots: 6,
            minSpots: 3,
            fallbackAllowed: true,
            plannerRetries: 2,
          },
        },
        seriesBlueprint: vNextSeries.seriesBlueprint,
        userSeriesState: {
          id: `verify-user:${vNextSeries.seriesBlueprint.id}`,
          userId: "verify-user",
          seriesBlueprintId: vNextSeries.seriesBlueprint.id,
          referencedBlueprintVersion: vNextSeries.seriesBlueprint.version,
          stateVersion: 1,
          ...vNextSeries.initialUserSeriesStateTemplate,
        },
      },
      {
        onProgress: (event) => {
          const phase = clean(event.phase);
          if (!phase) return;
          vNextEvents.push(phase);
          if (phase !== lastVNextPhase) {
            lastVNextPhase = phase;
            console.error(`[verify][vnext] phase=${phase} detail=${clean(event.detail)}`);
          }
        },
      }
    )
    ),
    VERIFY_TIMEOUT_MS,
    "vNext episode runtime"
  );

  const vNextEpisode = vNextEpisodeResult.episodeOutput;
  const vNextPatchedState = applyEpisodeContinuityPatch(
    {
      id: `verify-user:${vNextSeries.seriesBlueprint.id}`,
      userId: "verify-user",
      seriesBlueprintId: vNextSeries.seriesBlueprint.id,
      referencedBlueprintVersion: vNextSeries.seriesBlueprint.version,
      stateVersion: 1,
      ...vNextSeries.initialUserSeriesStateTemplate,
    },
    vNextEpisode.continuityPatch
  );

  const allSceneNextReasonsFilled = vNextEpisode.scenes.every(
    (scene) => clean(scene.progression.nextSpotReason).length > 0
  );
  const hasPastReferences = vNextEpisode.scenes.some(
    (scene) =>
      scene.continuity.callbacksToPastEpisodes.length > 0 ||
      scene.continuity.memoryReferences.length > 0
  );
  const hasForeshadowingMotion =
    vNextEpisode.continuityPatch.payoffPatch.resolvedForeshadowing.length > 0 ||
    vNextEpisode.continuityPatch.payoffPatch.newlySeededForeshadowing.length > 0;
  const validatorSummary = vNextEpisode.generationTrace.find((row) =>
    row.startsWith("validator_summary:")
  );
  const validatorHasIssue = vNextEpisode.generationTrace.some((row) =>
    row.startsWith("validator_issue:")
  );

  const vNextChecks: Check[] = [
    toCheck(
      "vnext.series.characters >=2",
      vNextSeries.seriesBlueprint.characters.length >= 2,
      `characters=${vNextSeries.seriesBlueprint.characters.length}`
    ),
    toCheck(
      "vnext.series.checkpoints >=2",
      vNextSeries.seriesBlueprint.checkpoints.length >= 2,
      `checkpoints=${vNextSeries.seriesBlueprint.checkpoints.length}`
    ),
    toCheck(
      "vnext.series.firstEpisodeSeed exists",
      clean(vNextSeries.seriesBlueprint.firstEpisodeSeed.purpose).length > 0
    ),
    toCheck(
      "vnext.episode.fixed characters appeared",
      vNextEpisode.fixedCharactersAppeared.length > 0,
      `fixed=${vNextEpisode.fixedCharactersAppeared.length}`
    ),
    toCheck(
      "vnext.episode.each scene has fixed character",
      vNextEpisode.scenes.every((scene) => scene.fixedCharacters.length > 0)
    ),
    toCheck(
      "vnext.episode.local characters introduced",
      vNextEpisode.localCharactersIntroduced.length > 0,
      `local=${vNextEpisode.localCharactersIntroduced.length}`
    ),
    toCheck("vnext.episode.past references exist", hasPastReferences),
    toCheck(
      "vnext.episode.relationship movement exists",
      vNextEpisode.continuityPatch.relationshipPatch.length > 0,
      `relationshipPatch=${vNextEpisode.continuityPatch.relationshipPatch.length}`
    ),
    toCheck("vnext.episode.foreshadowing motion exists", hasForeshadowingMotion),
    toCheck("vnext.episode.nextSpotReason all scenes", allSceneNextReasonsFilled),
    toCheck(
      "vnext.episode.nextEpisodeHook exists",
      clean(vNextEpisode.ending.nextEpisodeHook).length > 0
    ),
    toCheck(
      "vnext.episode.continuityPatch exists",
      Boolean(vNextEpisode.continuityPatch)
    ),
    toCheck(
      "vnext.validator summary trace exists",
      Boolean(validatorSummary),
      validatorSummary
    ),
    toCheck(
      "vnext.validator has no issue trace",
      !validatorHasIssue
    ),
    toCheck(
      "vnext.patch apply increments episode count",
      vNextPatchedState.currentProgress.episodeCountCompleted === 1,
      `episodeCount=${vNextPatchedState.currentProgress.episodeCountCompleted}`
    ),
    toCheck(
      "vnext.patch apply updates state version",
      vNextPatchedState.stateVersion === 2,
      `stateVersion=${vNextPatchedState.stateVersion}`
    ),
    toCheck(
      "vnext progress phases include required core",
      ["request_received", "input_validated", "series_context_loaded", "continuity_context_built", "completed"].every(
        (phase) => vNextEvents.includes(phase)
      ),
      `phases=${Array.from(new Set(vNextEvents)).join(",")}`
    ),
  ];

  const allChecks = [...seriesChecks, ...episodeChecks, ...vNextChecks];
  const failed = allChecks.filter((check) => !check.pass);

  const report = {
    timestamp: new Date().toISOString(),
    mode: {
      runtime_fallback: forceRuntimeFallback,
    },
    summary: {
      total: allChecks.length,
      passed: allChecks.length - failed.length,
      failed: failed.length,
    },
    series: {
      title: series.title,
      checkpoints: series.checkpoints.length,
      primary_count: primaryCount,
      secondary_count: secondaryCount,
      spot_requirement_count: seedRequirements.length,
      seed_dry_run: seriesMeta.first_episode_seed_dry_run || null,
      progress_phases: Array.from(new Set(seriesEvents)),
    },
    episode: {
      title: episode.title,
      spot_count: episode.spots.length,
      episode_unique_character_count: episode.episode_unique_characters.length,
      episode_world_title: episode.episode_world.title,
      carry_over_hook: episode.carry_over_hook,
      generation_trace: episode.generation_trace || null,
      progress_phases: Array.from(new Set(episodeEvents)),
    },
    vnext: {
      series_blueprint_id: vNextSeries.seriesBlueprint.id,
      workflow_version: vNextEpisode.workflowVersion,
      fixed_character_count: vNextEpisode.fixedCharactersAppeared.length,
      local_character_count: vNextEpisode.localCharactersIntroduced.length,
      scene_count: vNextEpisode.scenes.length,
      next_episode_hook: vNextEpisode.ending.nextEpisodeHook,
      generation_trace: vNextEpisode.generationTrace,
      progress_phases: Array.from(new Set(vNextEvents)),
      patched_state: {
        state_version: vNextPatchedState.stateVersion,
        episode_count_completed: vNextPatchedState.currentProgress.episodeCountCompleted,
        unresolved_threads: vNextPatchedState.currentProgress.unresolvedThreads.length,
        active_foreshadowing: vNextPatchedState.currentProgress.activeForeshadowing.length,
      },
    },
    raw: {
      series,
      series_meta: seriesMeta,
      episode,
      vnext_series: vNextSeries,
      vnext_episode: vNextEpisode,
      vnext_patched_state: vNextPatchedState,
    },
    checks: allChecks,
  };

  console.log(JSON.stringify(report, null, 2));

  if (failed.length > 0) {
    throw new Error(`verification failed (${failed.length} checks)`);
  }
};

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
