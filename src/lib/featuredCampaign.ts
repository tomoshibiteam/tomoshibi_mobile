export type FeaturedCampaign = {
  id: string;
  eyebrow: string;
  seasonLabel: string;
  title: string;
  subtitle: string;
  summary: string;
  heroImageUrl: string;
  primaryCtaLabel: string;
  quickFacts: Array<{ label: string; value: string }>;
  highlights: Array<{ title: string; body: string }>;
  journeySteps: Array<{ title: string; body: string }>;
};

export const featuredCampaign: FeaturedCampaign = {
  id: "kyushu-university-freshers-guidance",
  eyebrow: "FEATURED EVENT",
  seasonLabel: "SPRING 2026",
  title: "九大の最初の1日を物語で歩く",
  subtitle: "九州大学 新入生ガイダンス特集",
  summary:
    "伊都キャンパスを実際に巡りながら、教室棟、図書館、食堂、生活導線を事件調査の流れに織り込み、新生活で最初に必要な情報を物語として理解していく特集です。",
  heroImageUrl:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuCNeh_Iumz39z-IDPBPHqjkP7JwLzo61Yto6yiTTVHr6NfHz4w1FfIvS-yAN-XRE0ayhtQP1yewohrHYlhpgFrjTgpOPoaYDmJ0kLCdZ80HJYwgR4OLvxs4I1WJX7_sicW2W-Dk83cbGtk2kHUDwiTB2YczGnBcARC58ie70oxZqtW6PvlqqUgMUJZJCJljZuBTiuky1MzDK8dsRLo_NGmU8Q0cwlVAjDLKYjltoqlty__TKLL9fqPpaqKt91WTRnujrT4nQBqYWVTS",
  primaryCtaLabel: "参加する",
  quickFacts: [
    { label: "対象", value: "九州大学 新入生" },
    { label: "舞台", value: "伊都キャンパス" },
    { label: "形式", value: "物語ガイダンス" },
  ],
  highlights: [
    {
      title: "歩きながら覚える",
      body: "施設の位置や移動導線を、説明文ではなく現地のストーリー進行の中で自然に覚えられます。",
    },
    {
      title: "情報が頭に残る",
      body: "履修、生活、居場所の見つけ方など、最初に詰まりやすい要点を事件の手掛かりとして受け取れます。",
    },
    {
      title: "会話のきっかけになる",
      body: "ただの案内ではなく共有しやすい体験になるので、友人や先輩との話題にもつながります。",
    },
  ],
  journeySteps: [
    {
      title: "1. キャンパスに入る",
      body: "導入で事件の違和感を受け取り、どこから見て回るべきかの理由が生まれます。",
    },
    {
      title: "2. スポットを巡る",
      body: "学内の主要スポットを順に回りながら、場所ごとの役割や使い方を物語の手掛かりとして知っていきます。",
    },
    {
      title: "3. 真相と導線がつながる",
      body: "最後に事件の解決とキャンパス理解が一つにまとまり、初日の不安を体験ごと整理できます。",
    },
  ],
};
