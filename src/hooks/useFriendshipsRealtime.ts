import { useEffect } from "react";
import { getSupabaseOrThrow, isSupabaseConfigured } from "@/lib/supabase";

type FriendshipRealtimeRow = {
  requester_id?: string | null;
  receiver_id?: string | null;
  status?: string | null;
};

const hasRelatedUser = (row: FriendshipRealtimeRow | null, userIds: string[]) => {
  if (!row) return false;
  return userIds.some((userId) => row.requester_id === userId || row.receiver_id === userId);
};

export const useFriendshipsRealtime = (
  userIds: Array<string | null | undefined>,
  onFriendshipsChanged: () => void
) => {
  const userIdsKey = userIds.join(":");

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const watchIds = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
    if (watchIds.length === 0) return;

    const supabase = getSupabaseOrThrow();
    const channel = supabase.channel(`friendships-watch:${watchIds.join(":")}:${Date.now()}`);

    channel
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, (payload) => {
        const next = (payload.new || null) as FriendshipRealtimeRow | null;
        const prev = (payload.old || null) as FriendshipRealtimeRow | null;

        const touchedAccepted =
          (typeof next?.status === "string" && next.status === "accepted") ||
          (typeof prev?.status === "string" && prev.status === "accepted");

        if (!touchedAccepted) return;
        if (!hasRelatedUser(next, watchIds) && !hasRelatedUser(prev, watchIds)) return;

        onFriendshipsChanged();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [onFriendshipsChanged, userIdsKey]);
};
