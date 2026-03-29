import dotenv from "dotenv";
import { generateSeriesConcept } from "../src/lib/agents/seriesConceptAgent";

dotenv.config({ path: "../.env" });

type DesignBrief = {
  brief_version: string;
  experience_objective: string;
  service_value_hypothesis: string;
  target_user_context: string;
  usage_scene: string;
  emotional_outcome: string;
  tone_guardrail: string;
  role_design_direction: string;
  spatial_behavior_policy: string;
  ux_guidance_style: string;
};

const step1Output: DesignBrief = {
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
};

const step2Input = {
  design_brief: step1Output,
  desiredEpisodeCount: 3,
  language: "ja",
  recent_generation_context: undefined,
};

const main = async () => {
  console.log("=== STEP2_INPUT ===");
  console.log(JSON.stringify(step2Input, null, 2));

  const step2Output = await generateSeriesConcept(step2Input);

  console.log("=== STEP2_OUTPUT ===");
  console.log(JSON.stringify(step2Output, null, 2));
};

main().catch((error) => {
  console.error("STEP2_RUN_FAILED");
  console.error(error);
  process.exitCode = 1;
});
