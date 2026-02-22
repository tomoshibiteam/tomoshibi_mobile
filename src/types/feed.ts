export type QuestHighlight = {
  id: string;
  title: string;
  areaName: string | null;
  coverImageUrl: string | null;
  creatorId: string | null;
  creatorName: string | null;
  createdAt?: string | null;
};

export type CreatorTrend = {
  id: string;
  name: string;
  bio: string | null;
  profilePictureUrl: string | null;
  questCount: number;
};

export type NotificationItem = {
  id: string;
  type: "follow" | "report";
  actorId: string;
  actorName: string;
  actorAvatar: string | null;
  message: string;
  createdAt: string | null;
};

export type ExploreQuest = {
  id: string;
  title: string;
  areaName: string | null;
  coverImageUrl: string | null;
  creatorId: string | null;
  creatorName: string | null;
  startLocation: { lat: number; lng: number } | null;
};

export type ExploreCreator = {
  id: string;
  name: string;
  profilePictureUrl: string | null;
  questCount: number;
};

export type ExplorePayload = {
  quests: ExploreQuest[];
  creators: ExploreCreator[];
  allCreators: ExploreCreator[];
  questCountByCreatorId: Record<string, number>;
  purchasedQuestIds: string[];
};
