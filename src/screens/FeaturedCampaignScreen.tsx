import React from "react";
import { Alert, Image, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { fonts } from "@/theme/fonts";
import type { RootStackParamList } from "@/navigation/types";
import { featuredCampaign } from "@/lib/featuredCampaign";

const PREVIEW_UI_BG =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuCIGppxff8Pn-Do5bFeX09yJrJByLosbb_A8eVOlv2lPCgRmrunT8anoZJeeOyYKXuAIoRZZ0CyPYKKkUoq7nKI3rRRLFlovT1-04AIA_XmkbPv-tbIO9fQMUZYHInGOjdhihCaPxeLG5iJ85pdxvm9NPDo20Y7gUCxTE0JGfG3GDxGTTcoK4sibaCR5oaEcCV1tyP51ZrbpxGd8Zoh467Qsz9vO3EseBZVA1YLXHPmPZ7vbV2snME59x9fGBIU9fBgm-zVZcYnRoSL";

type BenefitCard = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
};

const BENEFIT_CARDS: BenefitCard[] = [
  {
    icon: "map-outline",
    title: "主要スポットの\n意味がわかる",
    body: "施設名だけでなく、そこにある歴史や役割を理解できます。",
  },
  {
    icon: "shield-checkmark-outline",
    title: "初めてでも\n安心して巡れる",
    body: "スマホが道しるべになり、広大なキャンパスも迷わず歩けます。",
  },
  {
    icon: "book-outline",
    title: "物語だから\n記憶に残る",
    body: "体験とストーリーが結びつき、キャンパスが身近な場所に。",
  },
  {
    icon: "sparkles-outline",
    title: "新生活の\n最初のきっかけ",
    body: "これからの大学生活をワクワクさせる体験が待っています。",
  },
];

type StoryBeat = {
  chapter: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
};

const STORY_BEATS: StoryBeat[] = [
  {
    chapter: "CHAPTER 01",
    icon: "mail-open-outline",
    title: "入学初日の違和感",
    body: "オリエンテーションの日、届いた一通の匿名メッセージから物語が始まる。まずはキャンパスの導線と場所の関係を読み解く。",
  },
  {
    chapter: "CHAPTER 02",
    icon: "trail-sign-outline",
    title: "スポットを辿って追跡",
    body: "図書館、食堂、講義棟などを順に巡り、証言と現場のズレを確認。歩くごとにキャンパスの使い方も自然に身につく。",
  },
  {
    chapter: "CHAPTER 03",
    icon: "sparkles-outline",
    title: "真相と生活導線がつながる",
    body: "最後に事件の真相と、これからの大学生活で役立つ移動感覚がひとつに繋がる。初日の不安を解くための体験になっている。",
  },
];

type Step = {
  title: string;
  body: string;
};

const PARTICIPATION_STEPS: Step[] = [
  {
    title: "シリーズに参加する",
    body: "まずはこのページ下のボタンから。あなたの冒険が登録されます。",
  },
  {
    title: "物語が始まる",
    body: "スマホに届くプロローグを読み、最初の目的地へ向かいましょう。",
  },
  {
    title: "スポットを巡る",
    body: "地図とガイドに従って歩き、キャンパスの空気を感じます。",
  },
  {
    title: "発見しながら進める",
    body: "到着すると新たな話が解放。場所の秘密が明らかになります。",
  },
];

const SectionHeading = ({ title, subtitle }: { title: string; subtitle?: string }) => (
  <View className="items-center">
    <Text className="text-[31px] leading-[38px] text-[#231A11] text-center" style={{ fontFamily: fonts.storySerifSemiBold }}>
      {title}
    </Text>
    {subtitle ? (
      <Text
        className="mt-2 text-sm text-[#554336] text-center"
        style={{ fontFamily: fonts.bodyRegular, lineHeight: 21 }}
      >
        {subtitle}
      </Text>
    ) : null}
  </View>
);

const MetaChip = ({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) => (
  <View className="px-3 py-1.5 rounded-full bg-[#F7E5D6] flex-row items-center gap-1.5">
    <Ionicons name={icon} size={12} color="#554336" />
    <Text className="text-[10px] text-[#554336]" style={{ fontFamily: fonts.displayBold }}>
      {label}
    </Text>
  </View>
);

export const FeaturedCampaignScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const handleJoin = () => {
    Alert.alert("参加導線", "シリーズ参加の本接続は次の実装で接続します。");
  };

  return (
    <View className="flex-1 bg-[#FFF8F4]">
      <SafeAreaView edges={["top"]} className="bg-[#FFF8F4]/95 border-b border-[#DBC2B0]/30">
        <View className="h-14 px-4 flex-row items-center justify-between">
          <Pressable
            className="w-10 h-10 rounded-full items-center justify-center"
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={21} color="#231A11" />
          </Pressable>

          <Text className="text-xs tracking-[2px] text-[#231A11]" style={{ fontFamily: fonts.displayExtraBold }}>
            イベント詳細
          </Text>

          <View className="flex-row items-center">
            <Pressable
              className="w-10 h-10 rounded-full items-center justify-center"
              onPress={() => Alert.alert("準備中", "共有機能は次の実装で接続します。")}
            >
              <Ionicons name="share-social-outline" size={18} color="#231A11" />
            </Pressable>
            <Pressable
              className="w-10 h-10 rounded-full items-center justify-center"
              onPress={() => Alert.alert("準備中", "保存機能は次の実装で接続します。")}
            >
              <Ionicons name="bookmark-outline" size={18} color="#231A11" />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 210 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="px-6 pt-8 pb-16 relative overflow-hidden">
          <View className="absolute inset-0">
            <Image
              source={{ uri: featuredCampaign.heroImageUrl }}
              className="w-full h-full opacity-80"
              resizeMode="cover"
              blurRadius={2}
            />
            <LinearGradient
              colors={["rgba(255,248,244,0.02)", "rgba(255,248,244,0.22)", "rgba(255,248,244,0.62)"]}
              className="absolute inset-0"
            />
          </View>

          <View className="items-center relative z-10">
            <View className="px-4 py-1.5 rounded-full bg-[#904D00]/5 border border-[#904D00]/10 flex-row items-center mb-6">
              <View className="w-1.5 h-1.5 rounded-full bg-[#904D00] mr-2" />
              <Text className="text-[10px] tracking-[2px] text-[#904D00]" style={{ fontFamily: fonts.displayExtraBold }}>
                九州大学オリエンテーション
              </Text>
            </View>

            <Text
              className="text-[28px] leading-[36px] text-[#231A11] text-center mb-6"
              style={{ fontFamily: fonts.storySerifSemiBold }}
            >
              物語でめぐる、{"\n"}
              <Text className="text-[#904D00]">九州大学</Text>はじめての冒険
            </Text>

            <View className="flex-row flex-wrap justify-center gap-2 mb-8">
              <MetaChip icon="school-outline" label="新入生向け" />
              <MetaChip icon="time-outline" label="約60分" />
              <MetaChip icon="person-outline" label="1人でもOK" />
              <MetaChip icon="phone-portrait-outline" label="スマホで参加" />
            </View>

            <Text
              className="text-sm text-[#554336] text-center mb-10 max-w-[330px]"
              style={{ fontFamily: fonts.bodyRegular, lineHeight: 23 }}
            >
              ただ地図を見るだけではわからない、場所の記憶と魅力を「物語」として体験。あなたの大学生活を彩る最初の1ページを始めましょう。
            </Text>

            <Pressable onPress={handleJoin} className="w-full max-w-[340px]">
              <LinearGradient
                colors={["#904D00", "#EE8C2B"]}
                start={{ x: 0.1, y: 0.2 }}
                end={{ x: 1, y: 1 }}
                className="h-14 rounded-full flex-row items-center justify-center gap-2"
              >
                <Text className="text-white" style={{ fontFamily: fonts.displayExtraBold }}>
                  物語を始める
                </Text>
                <Ionicons name="play" size={17} color="#FFFFFF" />
              </LinearGradient>
            </Pressable>
          </View>

          <View className="absolute inset-x-6 bottom-0 h-px bg-[#DBC2B0]/80" />
        </View>

        <View className="px-6 py-16 bg-[#FFF1E7] border-t border-[#DBC2B0]/45">
          <SectionHeading title="この特集はどんな物語？" />
          <Text
            className="mt-4 text-sm text-[#554336] text-center"
            style={{ fontFamily: fonts.bodyRegular, lineHeight: 23 }}
          >
            新入生の最初の1日を舞台にした、現地周遊型のキャンパスミステリーです。場所を巡るほど「何が起きたか」と「どこをどう使うか」が同時に見えてきます。
          </Text>

          <View className="mt-8">
            {STORY_BEATS.map((beat, index) => (
              <View
                key={beat.chapter}
                className={`rounded-2xl border border-[#DBC2B0]/45 bg-[#FFF1E7] px-4 py-4 ${index > 0 ? "mt-4" : ""}`}
              >
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-row items-center gap-2">
                    <View className="w-8 h-8 rounded-xl bg-[#904D00] items-center justify-center">
                      <Ionicons name={beat.icon} size={14} color="#FFFFFF" />
                    </View>
                    <Text className="text-[10px] tracking-[1.2px] text-[#904D00]" style={{ fontFamily: fonts.displayExtraBold }}>
                      {beat.chapter}
                    </Text>
                  </View>
                </View>

                <Text className="text-base text-[#231A11] mb-1.5" style={{ fontFamily: fonts.displayExtraBold }}>
                  {beat.title}
                </Text>
                <Text className="text-xs text-[#554336]" style={{ fontFamily: fonts.bodyRegular, lineHeight: 19 }}>
                  {beat.body}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View className="bg-[#FFF1E7] px-6 py-16">
          <SectionHeading title="このシリーズでできること" />
          <View className="mt-10 flex-row flex-wrap justify-between">
            {BENEFIT_CARDS.map((card) => (
              <View key={card.title} className="w-[48%] bg-white rounded-2xl border border-[#DBC2B0]/35 p-4 mb-4">
                <Ionicons name={card.icon} size={19} color="#904D00" style={{ marginBottom: 11 }} />
                <Text className="text-sm text-[#231A11] mb-2" style={{ fontFamily: fonts.displayExtraBold, lineHeight: 21 }}>
                  {card.title}
                </Text>
                <Text className="text-[11px] text-[#554336]" style={{ fontFamily: fonts.bodyRegular, lineHeight: 17 }}>
                  {card.body}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View className="px-6 py-20">
          <SectionHeading title="体験プレビュー" subtitle="スマホを片手に、物語の主人公になる" />

          <View className="items-center mt-14">
            <View className="w-[280px] rounded-[48px] bg-[#392E24] p-[11px] shadow-2xl">
              <View className="rounded-[42px] overflow-hidden border border-[#887364]/40" style={{ aspectRatio: 9 / 19 }}>
                <Image source={{ uri: PREVIEW_UI_BG }} className="absolute inset-0 w-full h-full" resizeMode="cover" />
                <LinearGradient
                  colors={["rgba(57,46,36,0.15)", "rgba(57,46,36,0.65)"]}
                  className="absolute inset-0"
                />
                <View className="absolute inset-0 p-5">
                  <View className="mt-8 rounded-xl bg-[#FDEBDB]/18 border border-white/10 p-3">
                    <Text className="text-[10px] text-white/70 mb-1" style={{ fontFamily: fonts.displayBold }}>
                      STORY
                    </Text>
                    <Text className="text-xs text-white leading-5" style={{ fontFamily: fonts.storySerifRegular }}>
                      「並木道を抜けた先、風が吹き抜ける図書館の入口が見えてくるはずだ...」
                    </Text>
                  </View>

                  <View className="mt-4 rounded-xl bg-[#904D00]/90 px-3 py-3 flex-row items-center justify-between">
                    <View>
                      <Text className="text-[10px] text-white/70 mb-0.5" style={{ fontFamily: fonts.displayBold }}>
                        NEXT SPOT
                      </Text>
                      <Text className="text-xs text-white" style={{ fontFamily: fonts.displayExtraBold }}>
                        中央図書館 前
                      </Text>
                    </View>
                    <Ionicons name="navigate-outline" size={16} color="#FFFFFF" />
                  </View>
                </View>
              </View>
            </View>

            <View className="absolute top-8 left-0 bg-white rounded-2xl border border-[#DBC2B0]/30 px-3 py-2 shadow-lg">
              <View className="flex-row items-center gap-1.5">
                <Ionicons name="chatbubble-ellipses-outline" size={14} color="#904D00" />
                <Text className="text-[11px] text-[#231A11]" style={{ fontFamily: fonts.displayBold }}>
                  物語が届く
                </Text>
              </View>
            </View>
            <View className="absolute top-40 right-0 bg-white rounded-2xl border border-[#DBC2B0]/30 px-3 py-2 shadow-lg">
              <View className="flex-row items-center gap-1.5">
                <Ionicons name="location-outline" size={14} color="#904D00" />
                <Text className="text-[11px] text-[#231A11]" style={{ fontFamily: fonts.displayBold }}>
                  スポットを提示
                </Text>
              </View>
            </View>
            <View className="absolute bottom-10 left-3 bg-white rounded-2xl border border-[#DBC2B0]/30 px-3 py-2 shadow-lg">
              <View className="flex-row items-center gap-1.5">
                <Ionicons name="eye-outline" size={14} color="#904D00" />
                <Text className="text-[11px] text-[#231A11]" style={{ fontFamily: fonts.displayBold }}>
                  現地で発見
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View className="px-6 py-20 bg-[#FFF1E7]">
          <SectionHeading title="参加の流れ" />

          <View className="mt-12">
            {PARTICIPATION_STEPS.map((step, index) => (
              <View key={step.title} className={`flex-row gap-4 ${index > 0 ? "mt-8" : ""}`}>
                <View className="w-10 h-10 rounded-full bg-[#904D00] items-center justify-center mt-0.5">
                  <Text className="text-white text-lg" style={{ fontFamily: fonts.storySerifSemiBold }}>
                    {index + 1}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-base text-[#231A11] mb-1.5" style={{ fontFamily: fonts.displayExtraBold }}>
                    {step.title}
                  </Text>
                  <Text className="text-xs text-[#554336]" style={{ fontFamily: fonts.bodyRegular, lineHeight: 19 }}>
                    {step.body}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View className="px-6 py-20">
          <SectionHeading title="はじめる前に" />

          <View className="mt-10 gap-4">
            <View className="rounded-2xl border border-[#DBC2B0]/50 bg-[#F7E5D6]/40 p-4 flex-row gap-3">
              <Ionicons name="phone-portrait-outline" size={18} color="#904D00" />
              <View className="flex-1">
                <Text className="text-sm text-[#231A11] mb-1" style={{ fontFamily: fonts.displayExtraBold }}>
                  何が必要？
                </Text>
                <Text className="text-[11px] text-[#554336]" style={{ fontFamily: fonts.bodyRegular, lineHeight: 17 }}>
                  ネットに繋がるスマホが必要です。十分に充電してお越しください。
                </Text>
              </View>
            </View>

            <View className="rounded-2xl border border-[#DBC2B0]/50 bg-[#F7E5D6]/40 p-4 flex-row gap-3">
              <Ionicons name="walk-outline" size={18} color="#904D00" />
              <View className="flex-1">
                <Text className="text-sm text-[#231A11] mb-1" style={{ fontFamily: fonts.displayExtraBold }}>
                  所要時間は？
                </Text>
                <Text className="text-[11px] text-[#554336]" style={{ fontFamily: fonts.bodyRegular, lineHeight: 17 }}>
                  約60分を想定していますが、自分のペースでいつでも中断・再開できます。
                </Text>
              </View>
            </View>

            <View className="rounded-2xl border border-[#DBC2B0]/50 bg-[#F7E5D6]/40 p-4 flex-row gap-3">
              <Ionicons name="sunny-outline" size={18} color="#904D00" />
              <View className="flex-1">
                <Text className="text-sm text-[#231A11] mb-1" style={{ fontFamily: fonts.displayExtraBold }}>
                  おすすめの時間は？
                </Text>
                <Text className="text-[11px] text-[#554336]" style={{ fontFamily: fonts.bodyRegular, lineHeight: 17 }}>
                  景色がよく見える日中、または夕暮れ時が最もシネマティックです。
                </Text>
              </View>
            </View>
          </View>
        </View>

      </ScrollView>

      <SafeAreaView edges={["bottom"]} className="absolute left-0 right-0 bottom-0">
        <LinearGradient
          colors={["rgba(255,248,244,0)", "rgba(255,248,244,0.95)", "#FFF8F4"]}
          className="px-4 pt-7 pb-2"
        >
          <View className="bg-white/90 rounded-[24px] border border-[#DBC2B0]/45 p-4">
            <View className="flex-row items-center justify-between px-1 mb-3">
              <View className="flex-row items-center gap-3">
                <View className="flex-row items-center gap-1">
                  <Ionicons name="time-outline" size={12} color="#55433699" />
                  <Text className="text-[10px] text-[#55433699]" style={{ fontFamily: fonts.displayBold }}>
                    約60分
                  </Text>
                </View>
                <View className="flex-row items-center gap-1">
                  <Ionicons name="phone-portrait-outline" size={12} color="#55433699" />
                  <Text className="text-[10px] text-[#55433699]" style={{ fontFamily: fonts.displayBold }}>
                    スマホ参加
                  </Text>
                </View>
              </View>
              <Text className="text-[10px] text-[#904D00]" style={{ fontFamily: fonts.displayExtraBold }}>
                参加無料
              </Text>
            </View>

            <Pressable onPress={handleJoin} className="h-12 rounded-full bg-[#904D00] flex-row items-center justify-center gap-2">
              <Text className="text-white" style={{ fontFamily: fonts.displayExtraBold }}>
                シリーズに参加する
              </Text>
              <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
            </Pressable>
          </View>
        </LinearGradient>
      </SafeAreaView>
    </View>
  );
};
