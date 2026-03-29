import dotenv from "dotenv";
import { generateSeriesConcept } from "../src/lib/agents/seriesConceptAgent";
import { generateSeriesCharacters } from "../src/lib/agents/seriesCharacterAgent";
import { buildSeriesVisualStyleGuide } from "../src/lib/seriesVisuals";

dotenv.config({ path: "/Users/wataru/tomoshibi_mobile/mastra/.env" });

const firstSentence = (value?: string) => (value || "").split(/[。.!?]/)[0]?.trim() || "";

const step1Output = {
  brief_version: "device-service-design-brief-v1",
  experience_objective:
    "広大な伊都キャンパスを「ただの移動空間」ではなく「謎が眠る冒険の舞台」として捉え、新生活への不安を払拭してキャンパスへの愛着と自信を持った状態にする。",
  service_value_hypothesis:
    "手掛かり提示・現地観察・仮説更新・伏線回収を段階配置することで、事件ミステリーとしての没入感を維持したまま新生活導線の理解を副次獲得できる体験価値を生み出す。",
  target_user_context:
    "九州大学伊都キャンパスに入学したばかりの新入生。広すぎるキャンパスに戸惑いを感じつつ、新しい友人や刺激的な体験を求めている。",
  usage_scene:
    "入学直後のオリエンテーション期間中。スマートフォンを片手に、講義の合間や放課後を利用してキャンパス内を探索する場面。",
  emotional_outcome:
    "最初は広大な敷地への圧倒感があるが、事件に巻き込まれることで好奇心が勝り、謎を解くたびに「この場所を知っている」という優越感と達成感に包まれる。",
  tone_guardrail:
    "知的好奇心を刺激するアカデミック・ミステリーのトーンを維持する。単なるスタンプラリーのような作業感や、過度に子供っぽい演出は排除する。",
  role_design_direction:
    "常にユーザーと行動を共にする「謎の先輩」を相棒として配置。対等なバディとして、時にはヒントを出し、時には共に驚くことで、孤独感を解消し没入感を高める役割を担う。",
  spatial_behavior_policy:
    "センターゾーンからウエストゾーンへの移動など、実際の学生生活で頻繁に使う動線上に手がかりを配置し、移動そのものを物語の進行（捜査）として意味づける。",
  ux_guidance_style:
    "次の目的地を直接指示するのではなく、証言や遺留品から「次に行くべき場所」を推測させる形式。各話の終わりに新たな謎を提示し、翌日の登校が楽しみになるような引きを作る。",
} as const;

const main = async () => {
  const step2Input = {
    design_brief: step1Output,
    desiredEpisodeCount: 3,
    language: "ja" as const,
    recent_generation_context: undefined,
  };

  const step2Output = await generateSeriesConcept(step2Input);

  const styleGuide = buildSeriesVisualStyleGuide({
    seriesTitle: step2Output.title,
    genre: step2Output.genre,
    tone: step2Output.tone,
    setting: step2Output.world.setting,
    recurringMotifs: step2Output.world.recurring_motifs,
    stylePreset: "cinematic-anime",
    styleDirection: firstSentence(step1Output.tone_guardrail) || "土地性と情緒を両立",
  });

  const step3Input = {
    title: step2Output.title,
    genre: step2Output.genre,
    tone: step2Output.tone,
    premise: step2Output.premise,
    world_setting: step2Output.world.setting,
    season_goal: step2Output.season_goal,
    design_brief: step1Output,
    protagonist_position: "シリーズ内で独立して行動する主人公（ユーザー本人ではない）",
    partner_description: firstSentence(step1Output.role_design_direction) || "信頼できる相棒",
    style_guide: styleGuide,
    target_count: 2,
    mystery_profile: step2Output.mystery_profile,
    recent_generation_context: undefined,
  };

  console.log("=== STEP1_OUTPUT ===");
  console.log(JSON.stringify(step1Output, null, 2));

  console.log("=== STEP2_OUTPUT ===");
  console.log(JSON.stringify(step2Output, null, 2));

  console.log("=== STEP3_INPUT (FROM STEP1 + STEP2) ===");
  console.log(JSON.stringify(step3Input, null, 2));

  const step3Output = await generateSeriesCharacters(step3Input);

  console.log("=== STEP3_OUTPUT ===");
  console.log(JSON.stringify(step3Output, null, 2));
};

main().catch((error) => {
  console.error("STEP3_RUN_FAILED");
  console.error(error);
  process.exitCode = 1;
});
