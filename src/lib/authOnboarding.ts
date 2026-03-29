import type { User } from "@supabase/supabase-js";

export const ONBOARDING_REQUIRED_KEY = "onboarding_required";
export const ONBOARDING_COMPLETED_AT_KEY = "onboarding_completed_at";
export const ONBOARDING_ANSWERS_KEY = "onboarding_answers";

export type OnboardingAnswerValue = {
  id: string;
  label: string;
};

export type OnboardingSurveyAnswers = {
  currentLifestyle: OnboardingAnswerValue;
  outingFrequency: OnboardingAnswerValue;
  leisureStyle: OnboardingAnswerValue;
};

type AuthMetadata = Record<string, unknown>;

const FIRST_SESSION_WINDOW_MS = 5 * 60 * 1000;

const getMetadata = (user: Pick<User, "user_metadata"> | null | undefined): AuthMetadata => {
  if (!user?.user_metadata || typeof user.user_metadata !== "object") {
    return {};
  }
  return user.user_metadata as AuthMetadata;
};

const getStringMetadata = (metadata: AuthMetadata, key: string) => {
  const value = metadata[key];
  return typeof value === "string" ? value : "";
};

const isLikelyFirstSession = (user: User) => {
  if (!user.created_at || !user.last_sign_in_at) return false;

  const createdAt = new Date(user.created_at).getTime();
  const lastSignInAt = new Date(user.last_sign_in_at).getTime();
  if (Number.isNaN(createdAt) || Number.isNaN(lastSignInAt)) return false;

  return Math.abs(lastSignInAt - createdAt) <= FIRST_SESSION_WINDOW_MS;
};

export const shouldShowOnboarding = (user: User) => {
  const metadata = getMetadata(user);
  const completedAt = getStringMetadata(metadata, ONBOARDING_COMPLETED_AT_KEY);
  if (completedAt) return false;

  if (metadata[ONBOARDING_REQUIRED_KEY] === true) return true;
  if (metadata[ONBOARDING_REQUIRED_KEY] === false) return false;

  return isLikelyFirstSession(user);
};

export const buildOnboardingMetadataUpdate = (
  currentUser: User | null,
  answers: OnboardingSurveyAnswers
): AuthMetadata => {
  const existingMetadata = getMetadata(currentUser);

  return {
    ...existingMetadata,
    [ONBOARDING_REQUIRED_KEY]: false,
    [ONBOARDING_COMPLETED_AT_KEY]: new Date().toISOString(),
    [ONBOARDING_ANSWERS_KEY]: answers,
  };
};
