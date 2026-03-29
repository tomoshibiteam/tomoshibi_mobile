import dotenv from "dotenv";
import { deriveSeriesDeviceServiceDesignBrief } from "../src/lib/serviceDesignBrief";
import { generateSeriesConcept } from "../src/lib/agents/seriesConceptAgent";

dotenv.config({ path: "../.env" });

const interview = {
  genre_world: "ユーザー入力の自由プロンプトを最優先で反映",
  desired_emotion: "面白さ・ワクワク・ハラハラを体験しながら、最終的に行動したくなる感情",
  companion_preference: "固定キャラクターと継続対話したい",
  continuation_trigger: "前話の伏線が次話で進むこと",
  avoidance_preferences: "説教臭さ、押し付け説明、超常解決",
  additional_notes: "事件ミステリーとして楽しさを主軸に、海洋ゴミの理解と回収行動を自然接続",
  visual_style_preset: "cinematic-anime",
  visual_style_notes: "土地性と情緒を両立",
};

const prompt =
  "福島を舞台に、海洋ゴミの深刻性を体験的に理解し、自律的に海洋ゴミ回収の行動につながる事件ミステリークエスト";

const main = async () => {
  const step1 = await deriveSeriesDeviceServiceDesignBrief({ interview, prompt });

  const step2Input = {
    design_brief: step1,
    desiredEpisodeCount: 3,
    language: "ja" as const,
    recent_generation_context: undefined,
  };

  console.log("=== STEP1_OUTPUT ===");
  console.log(JSON.stringify(step1, null, 2));

  console.log("=== STEP2_INPUT ===");
  console.log(JSON.stringify(step2Input, null, 2));

  const step2 = await generateSeriesConcept(step2Input);

  console.log("=== STEP2_OUTPUT ===");
  console.log(JSON.stringify(step2, null, 2));
};

main().catch((error) => {
  console.error("STEP2_RUN_FAILED");
  console.error(error);
  process.exitCode = 1;
});
