import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { generateSeriesGenerationResultV2 } from "../src/workflows/series-workflow-v2";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

const rawInput = {
  userId: "dev-user-manual-run",
  prompt:
    process.argv[2] ||
    "九州大学の新入生向けに、伊都キャンパスで体験する事件ミステリー型シリーズを作ってください。",
  interview: "事件ミステリーとして面白く、ワクワクしながら学べる体験がよい。",
  explicitGenreHints: ["事件ミステリー", "現実的", "新入生オンボーディング"],
  excludedDirections: ["超常解決", "SF化", "異世界転移"],
  safetyPreferences: ["現実因果", "非暴力"],
  desiredEpisodeLimit: 3,
};

const clean = (v: unknown) =>
  (typeof v === "string" ? v : String(v ?? "")).replace(/\s+/g, " ").trim();

const dedupe = (values: Array<string | null | undefined>) => {
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

const promptSummary =
  rawInput.prompt.length > 200
    ? `${rawInput.prompt.slice(0, 200).trimEnd()}…`
    : rawInput.prompt;

const sanitizedApprox = {
  sourcePrompt: rawInput.prompt,
  normalizedInterview: {
    desiredEmotion: rawInput.interview,
    companionPreference: "固定キャラクターとの継続対話",
    continuationPreference: "関係性と発見の積み上がり",
    avoidancePreferences: dedupe([
      ...(rawInput.excludedDirections || []),
      ...(rawInput.safetyPreferences || []),
    ]),
    stylePreference: "cinematic-anime",
  },
  creatorContext: {
    creatorId: rawInput.userId,
    language: "ja",
  },
  groundingRefs: {},
  requestDigest: {
    promptSummary,
    constraintDigest: dedupe([
      ...(rawInput.explicitGenreHints || []),
      ...(rawInput.excludedDirections || []),
      ...(rawInput.safetyPreferences || []),
    ]),
  },
};

const progress: Array<{ phase: string; at: string; detail?: string }> = [];
const startedAt = new Date().toISOString();

try {
  const result = await generateSeriesGenerationResultV2(rawInput, {
    onProgress: async (event) => {
      progress.push(event);
    },
  });

  const endedAt = new Date().toISOString();

  const steps = [
    {
      step: "step0_sanitize_series_request",
      input: rawInput,
      output: sanitizedApprox,
      status: "passed",
    },
    {
      step: "step1_derive_series_framework_brief",
      input: {
        sanitized: sanitizedApprox,
        seriesLevelGrounding: null,
      },
      output: result.seriesBlueprint.frameworkBrief,
      status: "passed",
    },
    {
      step: "step2_generate_series_core",
      input: {
        frameworkBrief: result.seriesBlueprint.frameworkBrief,
      },
      output: result.seriesBlueprint.concept,
      status: "passed",
    },
    {
      step: "step3_generate_user_role_frame",
      input: {
        frameworkBrief: result.seriesBlueprint.frameworkBrief,
        seriesCore: result.seriesBlueprint.concept,
      },
      output: result.seriesBlueprint.userRoleFrame,
      status: "passed",
    },
    {
      step: "step4_generate_persistent_cast",
      input: {
        frameworkBrief: result.seriesBlueprint.frameworkBrief,
        seriesCore: result.seriesBlueprint.concept,
        userRoleFrame: result.seriesBlueprint.userRoleFrame,
      },
      output: result.seriesBlueprint.persistentCharacters,
      status: "passed",
    },
    {
      step: "step5_build_series_identity_pack",
      input: {
        seriesCore: result.seriesBlueprint.concept,
        userRoleFrame: result.seriesBlueprint.userRoleFrame,
        persistentCast: result.seriesBlueprint.persistentCharacters,
      },
      output: result.seriesBlueprint.identityPack,
      status: "passed",
    },
    {
      step: "step6_build_series_continuity_axes",
      input: {
        frameworkBrief: result.seriesBlueprint.frameworkBrief,
        seriesCore: result.seriesBlueprint.concept,
        userRoleFrame: result.seriesBlueprint.userRoleFrame,
        persistentCast: result.seriesBlueprint.persistentCharacters,
        identityPack: result.seriesBlueprint.identityPack,
      },
      output: result.seriesBlueprint.continuityAxes,
      status: "passed",
    },
    {
      step: "step7_build_episode_generation_contract",
      input: {
        frameworkBrief: result.seriesBlueprint.frameworkBrief,
        seriesCore: result.seriesBlueprint.concept,
        userRoleFrame: result.seriesBlueprint.userRoleFrame,
        persistentCast: result.seriesBlueprint.persistentCharacters,
        continuityAxes: result.seriesBlueprint.continuityAxes,
      },
      output: result.seriesBlueprint.episodeGenerationContract,
      status: "passed",
    },
    {
      step: "step8_generate_series_visual_bundle",
      input: {
        seriesCore: result.seriesBlueprint.concept,
        userRoleFrame: result.seriesBlueprint.userRoleFrame,
        persistentCast: result.seriesBlueprint.persistentCharacters,
        identityPack: result.seriesBlueprint.identityPack,
      },
      output: result.visualBundle,
      status: "passed",
    },
    {
      step: "step9_finalize_series_blueprint_v2",
      input: {
        frameworkBrief: result.seriesBlueprint.frameworkBrief,
        seriesCore: result.seriesBlueprint.concept,
        userRoleFrame: result.seriesBlueprint.userRoleFrame,
        persistentCast: result.seriesBlueprint.persistentCharacters,
        identityPack: result.seriesBlueprint.identityPack,
        continuityAxes: result.seriesBlueprint.continuityAxes,
        episodeGenerationContract: result.seriesBlueprint.episodeGenerationContract,
        visualBundle: result.visualBundle,
      },
      output: {
        workflowVersion: result.workflowVersion,
        seriesBlueprint: result.seriesBlueprint,
        initialUserSeriesStateTemplate: result.initialUserSeriesStateTemplate,
        episodeRuntimeBootstrapPayload: result.episodeRuntimeBootstrapPayload,
        visualBundle: result.visualBundle,
      },
      status: "passed",
    },
  ];

  const report = {
    run: {
      startedAt,
      endedAt,
      prompt: rawInput.prompt,
      accepted: result.seriesBlueprint.generationQuality.accepted,
      generationQuality: result.seriesBlueprint.generationQuality,
    },
    progress,
    steps,
  };

  const outPath = "/tmp/series_v2_run_report.json";
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, outPath }, null, 2));
} catch (error) {
  const endedAt = new Date().toISOString();
  const outPath = "/tmp/series_v2_run_report.json";
  const report = {
    run: {
      startedAt,
      endedAt,
      prompt: rawInput.prompt,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    },
    progress,
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.error(JSON.stringify({ ok: false, outPath, error: report.run.error }, null, 2));
  process.exit(1);
}
