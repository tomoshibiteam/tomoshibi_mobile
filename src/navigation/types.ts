import type { NavigatorScreenParams } from "@react-navigation/native";
import type { ConnectionTab } from "@/types/social";

export type MainTabParamList = {
  Home: undefined;
  Search: undefined;
  Create: undefined;
  Notifications: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Auth: undefined;
  ProfileEdit: undefined;
  Settings: undefined;
  CreateSeries:
    | {
        prefillPrompt?: string;
      }
    | undefined;
  AddEpisode:
    | {
        prefillSeriesId?: string;
        prefillSeriesTitle?: string;
      }
    | undefined;
  SeriesDetail: { questId: string };
  UserProfile: { userId: string };
  UserConnections: { userId: string; tab?: ConnectionTab };
};
