import React, { useEffect, useMemo, useState } from "react";
import { Animated, Easing, Image, Modal, Pressable, Text, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts } from "@/theme/fonts";
import type { MainTabParamList, RootStackParamList } from "@/navigation/types";
import { useSessionUserId } from "@/hooks/useSessionUser";
import { fetchUserProfile } from "@/services/social";
import { subscribeOpenCreateSheet } from "@/lib/createSheetBus";

type NavItem = {
  route: keyof MainTabParamList;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
};

const navItems: NavItem[] = [
  { route: "Home", icon: "home-outline", iconActive: "home" },
  { route: "Search", icon: "search-outline", iconActive: "search" },
  { route: "Notifications", icon: "trophy-outline", iconActive: "trophy" },
  { route: "Profile", icon: "person-outline", iconActive: "person" },
];

const NAV_ACCENT = "#FF6A1A";
const NAV_MUTED = "rgba(108, 86, 71, 0.65)";
const CREATE_ACTIVE = "#FF6A1A";
const CREATE_IDLE = "#F39A5C";

export const MainBottomBar = ({ state, navigation }: BottomTabBarProps) => {
  const insets = useSafeAreaInsets();
  const { userId } = useSessionUserId();

  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [profileInitial, setProfileInitial] = useState<string>("G");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const createSheetTranslateY = useMemo(() => new Animated.Value(420), []);

  const currentRoute = state.routes[state.index]?.name as keyof MainTabParamList | undefined;
  const isCreateActive = currentRoute === "Create";

  useEffect(() => {
    setCreateModalOpen(false);
  }, [currentRoute]);

  useEffect(() => {
    if (!createModalOpen) return;
    createSheetTranslateY.setValue(420);
    Animated.timing(createSheetTranslateY, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [createModalOpen, createSheetTranslateY]);

  useEffect(() => {
    const unsubscribe = subscribeOpenCreateSheet(() => {
      setCreateModalOpen(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadProfile = async () => {
      if (!userId) {
        if (!mounted) return;
        setProfileImageUrl(null);
        setProfileInitial("G");
        return;
      }

      try {
        const profile = await fetchUserProfile(userId);
        if (!mounted) return;
        setProfileImageUrl(profile?.profile_picture_url || null);
        setProfileInitial((profile?.name || "G").slice(0, 1).toUpperCase());
      } catch {
        if (!mounted) return;
        setProfileImageUrl(null);
        setProfileInitial("G");
      }
    };

    void loadProfile();
    return () => {
      mounted = false;
    };
  }, [userId]);

  const getIconColor = (active: boolean) => (active ? NAV_ACCENT : NAV_MUTED);
  const iconStrokeSize = (active: boolean) => (active ? 23 : 22);

  const navigateToTab = (route: keyof MainTabParamList) => {
    navigation.navigate(route);
  };

  const navigateRoot = (screen: keyof RootStackParamList) => {
    const parent = navigation.getParent();
    if (!parent) return;
    parent.navigate(screen as never);
  };

  const leftItems = useMemo(() => navItems.slice(0, 2), []);
  const rightItems = useMemo(() => navItems.slice(2), []);

  return (
    <>
      <View
        style={{ paddingBottom: Math.max(8, insets.bottom), backgroundColor: "#F6F0E8" }}
        className="border-t border-[#E3D6C9]"
      >
        <View className="h-[72px] px-2 flex-row items-center justify-between">
          {leftItems.map((item) => {
            const active = currentRoute === item.route;

            return (
              <Pressable
                key={item.route}
                className="flex-1 items-center justify-center"
                onPress={() => navigateToTab(item.route)}
              >
                <Ionicons
                  name={active ? item.iconActive : item.icon}
                  size={iconStrokeSize(active)}
                  color={getIconColor(active)}
                />
              </Pressable>
            );
          })}

          <View className="w-[86px]" />

          {rightItems.map((item) => {
            const active = currentRoute === item.route;

            if (item.route === "Profile") {
              return (
                <Pressable
                  key={item.route}
                  className="flex-1 items-center justify-center"
                  onPress={() => navigateToTab(item.route)}
                >
                  <View
                    className={`w-6 h-6 rounded-full overflow-hidden border ${
                      active ? "border-[#FF6A1A]" : "border-[#E3D6C9]"
                    }`}
                    style={
                      active
                        ? {
                            shadowColor: "#FF6A1A",
                            shadowOffset: { width: 0, height: 1 },
                            shadowOpacity: 0.25,
                            shadowRadius: 3,
                            elevation: 2,
                          }
                        : undefined
                    }
                  >
                    {profileImageUrl ? (
                      <Image source={{ uri: profileImageUrl }} className="w-full h-full" resizeMode="cover" />
                    ) : (
                      <View className="w-full h-full bg-[#EFE2D3] items-center justify-center">
                        <Text
                          className="text-[10px] text-[#7A4E2D]"
                          style={{ fontFamily: fonts.displayBold }}
                        >
                          {profileInitial}
                        </Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            }

            return (
              <Pressable
                key={item.route}
                className="flex-1 items-center justify-center"
                onPress={() => navigateToTab(item.route)}
              >
                <Ionicons
                  name={active ? item.iconActive : item.icon}
                  size={iconStrokeSize(active)}
                  color={getIconColor(active)}
                />
              </Pressable>
            );
          })}

          <Pressable
            onPress={() => setCreateModalOpen(true)}
            className="absolute w-[80px] h-[80px] rounded-full items-center justify-center"
            style={{
              left: "50%",
              marginLeft: -40,
              top: -34,
              backgroundColor: isCreateActive ? CREATE_ACTIVE : CREATE_IDLE,
              borderWidth: 6,
              borderColor: "#F6F0E8",
              shadowColor: "#FF6A1A",
              shadowOffset: { width: 0, height: 12 },
              shadowOpacity: 0.42,
              shadowRadius: 20,
              elevation: 12,
            }}
          >
            <Ionicons name="add" size={34} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      <Modal animationType="none" transparent visible={createModalOpen} onRequestClose={() => setCreateModalOpen(false)}>
        <View className="flex-1 items-center justify-end bg-black/60">
          <Pressable className="absolute inset-0" onPress={() => setCreateModalOpen(false)} />
          <Animated.View
            style={{
              transform: [{ translateY: createSheetTranslateY }],
              width: "100%",
              alignSelf: "stretch",
              backgroundColor: "#FFFFFF",
              opacity: 1,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderTopWidth: 1,
              borderTopColor: "#E5E7EB",
              paddingHorizontal: 24,
              paddingTop: 24,
              paddingBottom: Math.max(48, insets.bottom + 28),
              shadowColor: "#000000",
              shadowOffset: { width: 0, height: -8 },
              shadowOpacity: 0.2,
              shadowRadius: 16,
              elevation: 14,
            }}
          >
            <View className="items-center mb-6">
              <View className="w-12 h-1.5 bg-[#E5E7EB] rounded-full mb-6" />
              <View className="w-full flex-row items-center justify-between">
                <Text className="text-xl text-[#2B1E16]" style={{ fontFamily: fonts.displayBold }}>
                  作成する
                </Text>
                <Pressable
                  className="p-2 -mr-2"
                  onPress={() => setCreateModalOpen(false)}
                >
                  <Ionicons name="close" size={22} color="#94A3B8" />
                </Pressable>
              </View>
            </View>

            <View className="gap-4">
              <Pressable
                className="w-full rounded-2xl border-2 border-transparent bg-[#F8FAFC] px-4 py-4 flex-row items-start gap-4"
                style={({ pressed }) => ({
                  borderColor: pressed ? "rgba(238, 140, 43, 0.2)" : "transparent",
                  backgroundColor: pressed ? "#FFF7ED" : "#F8FAFC",
                })}
                onPress={() => {
                  setCreateModalOpen(false);
                  navigateRoot("CreateSeries");
                }}
              >
                <View className="p-3 bg-white rounded-xl border border-[#E5E7EB] items-center justify-center">
                  <Ionicons name="book-outline" size={30} color="#EE8C2B" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm text-[#2B1E16] mb-1" style={{ fontFamily: fonts.displayBold }}>
                    新しいシリーズを作る
                  </Text>
                  <Text className="text-xs text-[#64748B] leading-5" style={{ fontFamily: fonts.bodyRegular }}>
                    世界観やキャラクターをゼロから構築し、物語の骨格を作ります
                  </Text>
                </View>
                <View className="self-center">
                  <Ionicons name="chevron-forward" size={22} color="#CBD5E1" />
                </View>
              </Pressable>

              <Pressable
                className="w-full rounded-2xl border-2 border-transparent bg-[#F8FAFC] px-4 py-4 flex-row items-start gap-4"
                style={({ pressed }) => ({
                  borderColor: pressed ? "rgba(238, 140, 43, 0.2)" : "transparent",
                  backgroundColor: pressed ? "#FFF7ED" : "#F8FAFC",
                })}
                onPress={() => {
                  setCreateModalOpen(false);
                  navigateRoot("AddEpisode");
                }}
              >
                <View className="p-3 bg-white rounded-xl border border-[#E5E7EB] items-center justify-center">
                  <Ionicons name="document-text-outline" size={30} color="#EE8C2B" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm text-[#2B1E16] mb-1" style={{ fontFamily: fonts.displayBold }}>
                    エピソードを追加する
                  </Text>
                  <Text className="text-xs text-[#64748B] leading-5" style={{ fontFamily: fonts.bodyRegular }}>
                    既存のシリーズに、新しい場所や物語の続きを追加します
                  </Text>
                </View>
                <View className="self-center">
                  <Ionicons name="chevron-forward" size={22} color="#CBD5E1" />
                </View>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
};
