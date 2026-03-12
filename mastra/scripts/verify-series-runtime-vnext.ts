import fs from "node:fs";
import dotenv from "dotenv";
import {
  applyEpisodeContinuityPatch,
  buildSeriesGenerationResultVNextFromLegacyOutput,
  generateEpisodeRuntimeVNext,
} from "../src/lib/runtime/seriesRuntimeVNext";
import { generateSeriesWorkflowWithProgress } from "../src/workflows/series-workflow";
import { seriesWorkflowOutputSchema } from "../src/schemas/series";

dotenv.config({ override: true });

type Check = {
  name: string;
  pass: boolean;
  detail?: string;
};

const clean = (value?: unknown) =>
  (typeof value === "string" ? value : String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim();

const VERIFY_TIMEOUT_MS = Math.max(
  60_000,
  Number.parseInt(process.env.TOMOSHIBI_VERIFY_TIMEOUT_MS || "360000", 10)
);

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

const toCheck = (name: string, pass: boolean, detail?: string): Check => ({
  name,
  pass,
  detail,
});

const ensureAnyApiKey = () => {
  const hasKey =
    Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY) ||
    Boolean(process.env.OPENAI_API_KEY) ||
    Boolean(process.env.ANTHROPIC_API_KEY);
  if (!hasKey) {
    throw new Error(
      "AI API key missing. Set GOOGLE_GENERATIVE_AI_API_KEY or OPENAI_API_KEY or ANTHROPIC_API_KEY."
    );
  }
};

const verify = async () => {
  ensureAnyApiKey();

  const vNextRawSeriesInput = {
    userId: "verify-user-vnext",
    interview:
      "現代日本の港町と路地裏を歩くミステリー。固定キャラとの関係が少しずつ進み、次話で伏線回収される体験がほしい。",
    prompt: "夕景の街歩きで、関係性と回収を重視したシリーズを生成してください。",
    desiredEpisodeLimit: 6,
    explicitGenreHints: ["ミステリー", "街歩き", "人間ドラマ"],
    excludedDirections: ["過度にグロテスクな描写"],
    safetyPreferences: ["現実の公共空間で成立する導線を優先"],
  };

  const legacySeriesInput = {
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

  const legacySeriesResult = await withTimeout(
    generateSeriesWorkflowWithProgress(legacySeriesInput, {
      onProgress: (event) => {
        const phase = clean(event.phase);
        if (!phase) return;
        console.error(`[verify-vnext][series] phase=${phase} detail=${clean(event.detail)}`);
      },
    }),
    VERIFY_TIMEOUT_MS,
    "legacy proposal series generation"
  );
  const legacySeriesParsed = seriesWorkflowOutputSchema.safeParse(legacySeriesResult);
  if (!legacySeriesParsed.success) {
    throw new Error("legacy series output schema validation failed");
  }

  const seriesGeneration = await withTimeout(
    Promise.resolve(
      buildSeriesGenerationResultVNextFromLegacyOutput(vNextRawSeriesInput, legacySeriesParsed.data)
    ),
    Math.min(VERIFY_TIMEOUT_MS, 30_000),
    "vNext series conversion"
  );

  const vNextEvents: string[] = [];
  let lastPhase = "";

  const episodeRuntime = await withTimeout(
    generateEpisodeRuntimeVNext(
      {
        request: {
          userId: vNextRawSeriesInput.userId,
          seriesBlueprintId: seriesGeneration.seriesBlueprint.id,
          userSeriesStateId: `${vNextRawSeriesInput.userId}:${seriesGeneration.seriesBlueprint.id}`,
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
            maxSpots: 3,
            minSpots: 3,
            fallbackAllowed: true,
            plannerRetries: 2,
          },
        },
        seriesBlueprint: seriesGeneration.seriesBlueprint,
        userSeriesState: {
          id: `${vNextRawSeriesInput.userId}:${seriesGeneration.seriesBlueprint.id}`,
          userId: vNextRawSeriesInput.userId,
          seriesBlueprintId: seriesGeneration.seriesBlueprint.id,
          referencedBlueprintVersion: seriesGeneration.seriesBlueprint.version,
          stateVersion: 1,
          ...seriesGeneration.initialUserSeriesStateTemplate,
        },
      },
      {
        onProgress: (event) => {
          const phase = clean(event.phase);
          if (!phase) return;
          vNextEvents.push(phase);
          if (phase !== lastPhase) {
            lastPhase = phase;
            console.error(`[verify-vnext] phase=${phase} detail=${clean(event.detail)}`);
          }
        },
      }
    ),
    VERIFY_TIMEOUT_MS,
    "vNext episode runtime"
  );

  const episode = episodeRuntime.episodeOutput;
  const patchedState = applyEpisodeContinuityPatch(
    {
      id: `${vNextRawSeriesInput.userId}:${seriesGeneration.seriesBlueprint.id}`,
      userId: vNextRawSeriesInput.userId,
      seriesBlueprintId: seriesGeneration.seriesBlueprint.id,
      referencedBlueprintVersion: seriesGeneration.seriesBlueprint.version,
      stateVersion: 1,
      ...seriesGeneration.initialUserSeriesStateTemplate,
    },
    episode.continuityPatch
  );

  const checks: Check[] = [
    toCheck(
      "series.characters >=2",
      seriesGeneration.seriesBlueprint.characters.length >= 2,
      `characters=${seriesGeneration.seriesBlueprint.characters.length}`
    ),
    toCheck(
      "series.checkpoints >=2",
      seriesGeneration.seriesBlueprint.checkpoints.length >= 2,
      `checkpoints=${seriesGeneration.seriesBlueprint.checkpoints.length}`
    ),
    toCheck(
      "series.has firstEpisodeSeed",
      clean(seriesGeneration.seriesBlueprint.firstEpisodeSeed.purpose).length > 0
    ),
    toCheck("episode.fixedCharactersAppeared > 0", episode.fixedCharactersAppeared.length > 0),
    toCheck(
      "episode.all scenes have fixedCharacters",
      episode.scenes.every((scene) => scene.fixedCharacters.length > 0)
    ),
    toCheck(
      "episode.local characters introduced",
      episode.localCharactersIntroduced.length > 0,
      `local=${episode.localCharactersIntroduced.length}`
    ),
    toCheck(
      "episode.past references exist",
      episode.scenes.some(
        (scene) =>
          scene.continuity.callbacksToPastEpisodes.length > 0 ||
          scene.continuity.memoryReferences.length > 0
      )
    ),
    toCheck(
      "episode.relationship movement exists",
      episode.continuityPatch.relationshipPatch.length > 0,
      `relationshipPatch=${episode.continuityPatch.relationshipPatch.length}`
    ),
    toCheck(
      "episode.foreshadowing motion exists",
      episode.continuityPatch.payoffPatch.resolvedForeshadowing.length > 0 ||
        episode.continuityPatch.payoffPatch.newlySeededForeshadowing.length > 0
    ),
    toCheck(
      "episode.nextSpotReason all scenes",
      episode.scenes.every((scene) => clean(scene.progression.nextSpotReason).length > 0)
    ),
    toCheck("episode.nextEpisodeHook exists", clean(episode.ending.nextEpisodeHook).length > 0),
    toCheck("episode.continuityPatch exists", Boolean(episode.continuityPatch)),
    toCheck(
      "validator summary trace exists",
      episode.generationTrace.some((row) => row.startsWith("validator_summary:"))
    ),
    toCheck(
      "validator issue trace absent",
      !episode.generationTrace.some((row) => row.startsWith("validator_issue:"))
    ),
    toCheck(
      "patched stateVersion incremented",
      patchedState.stateVersion === 2,
      `stateVersion=${patchedState.stateVersion}`
    ),
    toCheck(
      "patched episodeCount incremented",
      patchedState.currentProgress.episodeCountCompleted === 1,
      `episodeCount=${patchedState.currentProgress.episodeCountCompleted}`
    ),
    toCheck(
      "vnext phases include core",
      ["request_received", "input_validated", "series_context_loaded", "continuity_context_built", "completed"].every(
        (phase) => vNextEvents.includes(phase)
      ),
      `phases=${Array.from(new Set(vNextEvents)).join(",")}`
    ),
  ];

  const failed = checks.filter((check) => !check.pass);
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
    series: {
      id: seriesGeneration.seriesBlueprint.id,
      title: seriesGeneration.seriesBlueprint.concept.title,
      checkpoints: seriesGeneration.seriesBlueprint.checkpoints.length,
      characters: seriesGeneration.seriesBlueprint.characters.length,
    },
    episode: {
      id: episode.episodeId,
      title: episode.episodeMeta.title,
      scene_count: episode.scenes.length,
      fixed_character_count: episode.fixedCharactersAppeared.length,
      local_character_count: episode.localCharactersIntroduced.length,
      next_episode_hook: episode.ending.nextEpisodeHook,
      generation_trace: episode.generationTrace,
    },
    patched_state: {
      state_version: patchedState.stateVersion,
      episode_count_completed: patchedState.currentProgress.episodeCountCompleted,
      unresolved_threads: patchedState.currentProgress.unresolvedThreads.length,
      active_foreshadowing: patchedState.currentProgress.activeForeshadowing.length,
    },
    phases: Array.from(new Set(vNextEvents)),
    checks,
  };

  const explicitOutputPath = clean(process.env.TOMOSHIBI_VERIFY_OUTPUT_PATH);
  if (explicitOutputPath) {
    fs.writeFileSync(explicitOutputPath, JSON.stringify(report, null, 2), "utf8");
    console.error(`[verify-vnext] report_written=${explicitOutputPath}`);
  }

  console.log(JSON.stringify(report, null, 2));

  if (failed.length > 0) {
    throw new Error(`vNext verification failed (${failed.length} checks)`);
  }
};

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
