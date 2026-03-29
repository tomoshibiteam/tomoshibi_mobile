const HANDLE_ALLOWED_CHARS = /[^a-z0-9_\-.ぁ-んァ-ヶ一-龠]/g;

export const normalizeProfileHandle = (value: string | null | undefined) =>
  (value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(HANDLE_ALLOWED_CHARS, "")
    .slice(0, 30);

export const formatProfileHandle = (
  handle: string | null | undefined,
  fallbackName: string | null | undefined,
  userId: string | null | undefined,
) => {
  const normalizedHandle = normalizeProfileHandle(handle);
  if (normalizedHandle) return `@${normalizedHandle}`;

  const fallbackBase = normalizeProfileHandle(fallbackName || "traveler");
  if (fallbackBase) return `@${fallbackBase}`;

  if (userId) return `@user_${userId.slice(0, 6)}`;
  return "@traveler";
};
