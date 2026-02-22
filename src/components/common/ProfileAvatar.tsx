import React from "react";
import { View, Text, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fonts } from "@/theme/fonts";

type ProfileAvatarProps = {
  name: string | null;
  imageUrl: string | null;
  size?: number;
  showBorder?: boolean;
};

export const ProfileAvatar = ({ name, imageUrl, size = 48, showBorder = true }: ProfileAvatarProps) => {
  const initial = (name || "旅").slice(0, 1);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderWidth: showBorder ? 1 : 0,
        borderColor: "#E7D9C7",
      }}
      className="rounded-full overflow-hidden bg-[#E3D8CA] items-center justify-center"
    >
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={{ width: size, height: size }} resizeMode="cover" />
      ) : (
        <>
          <Ionicons name="person" size={Math.max(18, size * 0.38)} color="#9F958A" />
          <Text
            className="absolute bottom-0.5 right-1 text-[10px] text-[#7A4E2D]"
            style={{ fontFamily: fonts.displayBold }}
          >
            {initial}
          </Text>
        </>
      )}
    </View>
  );
};
