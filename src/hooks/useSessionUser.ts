import { useEffect, useState } from "react";
import { getSupabaseOrThrow, isSupabaseConfigured } from "@/lib/supabase";

export const useSessionUserId = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setUserId(null);
      setLoading(false);
      return;
    }

    const supabase = getSupabaseOrThrow();

    let isMounted = true;

    const hydrate = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) return;
      if (error) {
        console.warn("useSessionUserId: failed to get session", error);
      }
      setUserId(data.session?.user.id ?? null);
      setLoading(false);
    };

    void hydrate();

    const { data: subscription } = supabase.auth.onAuthStateChange((_, session) => {
      if (!isMounted) return;
      setUserId(session?.user.id ?? null);
    });

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return { userId, loading };
};
