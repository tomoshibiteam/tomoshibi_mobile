import dotenv from "dotenv";
import { generateSeriesCharacters } from "../src/lib/agents/seriesCharacterAgent";

dotenv.config({ path: "/Users/wataru/tomoshibi_mobile/mastra/.env" });

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

const step3Input = {
  title: "伊都新歓機材消失：迷宮の搬入ルート",
  genre: "新入生オリエンテーション事件ミステリー",
  tone: "知的で明るく、新生活への不安を減らす参加型トーン",
  premise:
    "現地経験のある先輩と、観察に長けた新入生が補完し合うバディの二人が、新入生向けの重要資料が消えた一件を追い、誰が・なぜ隠したのかを追い、一人の隠し行動と小さな誤解が重なって起きた、現実的な人間要因の真相へ迫っていく。",
  world_setting:
    "九州大学伊都キャンパス。広大な敷地に最新の講義棟と複雑な物流ルートが入り交じる、迷路のような巨大な学術拠点。",
  season_goal:
    "最終話までに事件の主因である引き継ぎ漏れと誤配置の連鎖を解明し、新生活を始めたばかりの新入生が新生活で必要な導線を理解し、迷わず行動を始められる状態にする状態で物語を終える。事件解決の達成感と「次に何をすべきか」が同時に残る着地を目指す。",
  design_brief: step1Output,
  protagonist_position:
    "主人公はユーザー本人。九州大学伊都キャンパスに入学した新入生として物語に参加し、現地で観察・推理しながら意思決定する。",
  partner_description: "常にユーザーと行動を共にする謎の先輩バディ",
  style_guide:
    "style preset: シネマティックアニメ, style canon: cinematic anime illustration, clean line art, cel-shaded coloring, controlled warm lighting, high readability silhouettes, user style direction: 知的好奇心を刺激するアカデミック・ミステリーのトーンを維持する, for series 伊都新歓機材消失：迷宮の搬入ルート",
  target_count: 2,
  mystery_profile: {
    case_core: "新歓イベント機材が行方不明になった一件を追い、消失経路と回収方法を解く",
    investigation_style: "現場観察・聞き込み・記録照合で手掛かりを一つずつつなぎ、推理で絞り込む",
    emotional_tone: "知的で明るく、新生活への不安を減らす参加型トーン",
    duo_dynamic: "現地経験のある先輩と、観察に長けた新入生が補完し合うバディ",
    truth_nature: "引き継ぎ漏れと誤配置の連鎖",
    visual_language:
      "知的好奇心を刺激するアカデミック・ミステリーのトーンを維持する。単なるスタンプラリーのような作業感や、過度に子供っぽい演出は排除する。",
    environment_layer:
      "九州大学伊都キャンパスに入学したばかりの新入生。広すぎるキャンパスに戸惑いを感じつつ、新しい友人や刺激的な体験を求めている。",
    differentiation_axes: ["case_core", "duo_dynamic", "visual_language", "environment_layer"],
    banned_templates_avoided: [
      "謎多き美形相棒 + 都市伝説 + 青系ネオン + 記憶の欠落",
      "意味深な案内役 + エリア全体の秘密",
      "レトロ景観 + 失踪 + ノスタルジー",
      "雨 + 裏路地 + 曖昧な真相 + 静かな不穏だけで押す構成",
    ],
  },
  recent_generation_context: undefined,
} as const;

const main = async () => {
  console.log("=== STEP3_INPUT ===");
  console.log(JSON.stringify(step3Input, null, 2));

  const step3Output = await generateSeriesCharacters(step3Input);

  console.log("=== STEP3_OUTPUT ===");
  console.log(JSON.stringify(step3Output, null, 2));
};

main().catch((error) => {
  console.error("STEP3_ONLY_RUN_FAILED");
  console.error(error);
  process.exitCode = 1;
});

