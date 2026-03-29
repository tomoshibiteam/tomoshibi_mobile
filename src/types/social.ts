export type ConnectionTab = "followers" | "following";

export type ProfileRow = {
  id: string;
  name: string | null;
  handle?: string | null;
  bio: string | null;
  profile_picture_url: string | null;
};

export type FriendshipRow = {
  id: string;
  requester_id: string;
  receiver_id: string;
  status: string;
  created_at: string | null;
};

export type UserSeriesRow = {
  id: string;
  title: string | null;
  description: string | null;
  area_name: string | null;
  cover_image_url: string | null;
  tags: string[] | null;
  status: string | null;
  created_at: string | null;
};

export type AchievementRow = {
  id: string;
  name: string;
  icon: string | null;
  earned_at: string | null;
};

export type QuestSocialStats = {
  ratingByQuestId: Record<string, number>;
  playCountByQuestId: Record<string, number>;
};

export const FALLBACK_BIO = "プロフィール情報を準備中です。";
