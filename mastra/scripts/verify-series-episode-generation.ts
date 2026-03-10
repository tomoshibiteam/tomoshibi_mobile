import dotenv from "dotenv";
import { generateSeriesWorkflowWithProgress } from "../src/workflows/series-workflow";
import {
  generateSeriesRuntimeEpisode,
  seriesRuntimeEpisodeOutputSchema,
} from "../src/lib/agents/seriesRuntimeEpisodeAgent";
import { seriesWorkflowOutputSchema } from "../src/schemas/series";

dotenv.config({ override: true });

type Check = {
  name: string;
  pass: boolean;
  detail?: string;
};

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();

const toCheck = (name: string, pass: boolean, detail?: string): Check => ({ name, pass, detail });

const must = (condition: unknown, message: string): asserts condition => {
  if (!condition) {
    throw new Error(message);
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
  must(seriesParsed.success, "series output schema validation failed");
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
  const episodeResult = await generateSeriesRuntimeEpisode(
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
  );

  const episodeParsed = seriesRuntimeEpisodeOutputSchema.safeParse(episodeResult);
  must(episodeParsed.success, "episode output schema validation failed");
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

  const allChecks = [...seriesChecks, ...episodeChecks];
  const failed = allChecks.filter((check) => !check.pass);

  const report = {
    timestamp: new Date().toISOString(),
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
