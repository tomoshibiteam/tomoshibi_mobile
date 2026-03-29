import type { NavigatorScreenParams } from "@react-navigation/native";
import type { ConnectionTab } from "@/types/social";
import type {
  GeneratedRuntimeEpisode,
  GeneratedSeriesDraft,
} from "@/services/seriesAi";

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
  OnboardingSurvey: undefined;
  FeaturedCampaign:
    | {
        campaignId?: string;
      }
    | undefined;
  ProfileEdit: undefined;
  Settings: undefined;
  CreateSeries:
    | {
        prefillPrompt?: string;
      }
    | undefined;
  SeriesGenerationResult: {
    generated: GeneratedSeriesDraft;
    sourcePrompt: string;
    imagesPreloaded?: boolean;
  };
  AddEpisode:
    | {
        prefillSeriesId?: string;
        prefillSeriesTitle?: string;
      }
    | undefined;
  EpisodeGenerationResult: {
    runtimeEpisode: GeneratedRuntimeEpisode;
    seriesId: string;
    seriesTitle: string;
    coverImageUrl?: string | null;
    episodeNo?: number;
    stageLocation?: string;
    stageCoords?: { lat: number; lng: number } | null;
  };
  SeriesDetail: { questId: string };
  GamePlay: {
    questId: string;
    startEpisodeNo?: number;
  };
  UserProfile: { userId: string };
  UserConnections: { userId: string; tab?: ConnectionTab };
};
