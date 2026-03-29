import React from "react";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/types";
import { MainTabs } from "@/navigation/MainTabs";
import { AuthScreen } from "@/screens/AuthScreen";
import { OnboardingSurveyScreen } from "@/screens/OnboardingSurveyScreen";
import { CreateSeriesScreen } from "@/screens/CreateSeriesScreen";
import { SeriesGenerationResultScreen } from "@/screens/SeriesGenerationResultScreen";
import { AddEpisodeScreen } from "@/screens/AddEpisodeScreen";
import { EpisodeGenerationResultScreen } from "@/screens/EpisodeGenerationResultScreen";
import { ProfileEditScreen } from "@/screens/ProfileEditScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { UserProfileScreen } from "@/screens/UserProfileScreen";
import { UserConnectionsScreen } from "@/screens/UserConnectionsScreen";
import { SeriesDetailScreen } from "@/screens/SeriesDetailScreen";
import { FeaturedCampaignScreen } from "@/screens/FeaturedCampaignScreen";
import { GamePlayScreen } from "@/screens/GamePlayEntry";

const Stack = createNativeStackNavigator<RootStackParamList>();

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#F8F7F6",
  },
};

export const RootNavigator = () => {
  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: "slide_from_right",
          contentStyle: { backgroundColor: "#F8F7F6" },
        }}
      >
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen name="Auth" component={AuthScreen} />
        <Stack.Screen name="OnboardingSurvey" component={OnboardingSurveyScreen} />
        <Stack.Screen name="FeaturedCampaign" component={FeaturedCampaignScreen} />
        <Stack.Screen name="CreateSeries" component={CreateSeriesScreen} />
        <Stack.Screen name="SeriesGenerationResult" component={SeriesGenerationResultScreen} />
        <Stack.Screen name="AddEpisode" component={AddEpisodeScreen} />
        <Stack.Screen name="EpisodeGenerationResult" component={EpisodeGenerationResultScreen} />
        <Stack.Screen name="ProfileEdit" component={ProfileEditScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="SeriesDetail" component={SeriesDetailScreen} />
        <Stack.Screen name="GamePlay" component={GamePlayScreen} />
        <Stack.Screen name="UserProfile" component={UserProfileScreen} />
        <Stack.Screen name="UserConnections" component={UserConnectionsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
