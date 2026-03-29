import { useEffect, useState } from "react";
import { getSupabaseOrThrow, isSupabaseConfigured } from "@/lib/supabase";

export const useSessionUserId = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setUserId(null);
      setUserName(null);
      setLoading(false);
      return;
    }

    const supabase = getSupabaseOrThrow();

    let isMounted = true;

    const resolveUserName = (session: { user?: { user_metadata?: Record<string, unknown> } } | null | undefined) => {
      const metadata = session?.user?.user_metadata || {};
      const candidates = [
        metadata.name,
        metadata.full_name,
        metadata.preferred_username,
        metadata.nickname,
      ];
      for (const candidate of candidates) {
        if (typeof candidate !== "string") continue;
        const normalized = candidate.trim();
        if (normalized) return normalized;
      }
      return null;
    };

    const hydrate = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) return;
      if (error) {
        console.warn("useSessionUserId: failed to get session", error);
      }
      setUserId(data.session?.user.id ?? null);
      setUserName(resolveUserName(data.session));
      setLoading(false);
    };

    void hydrate();

    const { data: subscription } = supabase.auth.onAuthStateChange((_, session) => {
      if (!isMounted) return;
      setUserId(session?.user.id ?? null);
      setUserName(resolveUserName(session));
    });

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return { userId, userName, loading };
};
