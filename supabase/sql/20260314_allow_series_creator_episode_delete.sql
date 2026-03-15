-- Allow series creators to delete episodes in their own quests.
-- Run this in Supabase SQL editor.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'quest_episodes'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'quest_episodes'
        AND policyname = 'Series creators can delete episodes in own quests'
    ) THEN
      EXECUTE $sql$
        CREATE POLICY "Series creators can delete episodes in own quests"
        ON public.quest_episodes
        FOR DELETE
        TO authenticated
        USING (
          EXISTS (
            SELECT 1
            FROM public.quests q
            WHERE q.id = quest_episodes.quest_id
              AND q.creator_id = auth.uid()
          )
        )
      $sql$;
    END IF;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'quest_posts'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'quest_posts'
        AND policyname = 'Series creators can delete posts in own quests'
    ) THEN
      EXECUTE $sql$
        CREATE POLICY "Series creators can delete posts in own quests"
        ON public.quest_posts
        FOR DELETE
        TO authenticated
        USING (
          EXISTS (
            SELECT 1
            FROM public.quests q
            WHERE q.id = quest_posts.quest_id
              AND q.creator_id = auth.uid()
          )
        )
      $sql$;
    END IF;
  END IF;
END
$$;

