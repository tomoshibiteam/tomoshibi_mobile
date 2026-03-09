import React from "react";
import { Pressable, Text, View, ActivityIndicator } from "react-native";
import { ProfileAvatar } from "@/components/common/ProfileAvatar";
import { FALLBACK_BIO, type ProfileRow } from "@/types/social";
import { fonts } from "@/theme/fonts";

type UserListItemProps = {
  profile: ProfileRow;
  isSelf: boolean;
  isFollowing: boolean;
  loading?: boolean;
  onPressProfile: () => void;
  onToggleFollow: () => void;
};

export const UserListItem = ({
  profile,
  isSelf,
  isFollowing,
  loading,
  onPressProfile,
  onToggleFollow,
}: UserListItemProps) => {
  const isDisabled = isSelf || loading;
  const followingTone = isFollowing || isSelf;

  return (
    <View className="flex-row items-center gap-3">
      <Pressable className="flex-1 min-w-0 flex-row items-center gap-3" onPress={onPressProfile}>
        <ProfileAvatar name={profile.name} imageUrl={profile.profile_picture_url} />

        <View className="flex-1 min-w-0">
          <Text className="text-sm text-[#221910]" numberOfLines={1} style={{ fontFamily: fonts.displayBold }}>
            {profile.name || "旅人"}
          </Text>
          <Text className="text-xs text-[#6C5647]" numberOfLines={1} style={{ fontFamily: fonts.bodyRegular }}>
            {profile.bio || FALLBACK_BIO}
          </Text>
        </View>
      </Pressable>

      <Pressable
        className={`min-w-[74px] px-3 py-1.5 rounded-lg items-center justify-center ${
          followingTone ? "border border-[#D8CEC3] bg-white" : "bg-[#EE8C2B]"
        }`}
        onPress={onToggleFollow}
        disabled={isDisabled}
        style={
          followingTone
            ? undefined
            : {
                shadowColor: "#EE8C2B",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.2,
                shadowRadius: 6,
                elevation: 2,
              }
        }
      >
        {loading ? (
          <View className="flex-row items-center gap-1">
            <ActivityIndicator size={10} color={followingTone ? "#7A6F63" : "#FFFFFF"} />
            <Text
              className={`text-[11px] ${followingTone ? "text-[#7A6F63]" : "text-white"}`}
              style={{ fontFamily: fonts.displayBold }}
            >
              処理中
            </Text>
          </View>
        ) : (
          <Text
            className={`text-xs ${followingTone ? "text-[#7A6F63]" : "text-white"}`}
            style={{ fontFamily: fonts.displayBold }}
          >
            {isSelf ? "あなた" : isFollowing ? "フォロー中" : "フォロー"}
          </Text>
        )}
      </Pressable>
    </View>
  );
};
