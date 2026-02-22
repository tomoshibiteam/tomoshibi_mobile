-- Quest episodes table for serialized story posts.
-- Run this in Supabase SQL editor if you want AddEpisode to save into quest_episodes.

CREATE TABLE IF NOT EXISTS public.quest_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quest_id UUID NOT NULL REFERENCES public.quests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  episode_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (quest_id, episode_no)
);

ALTER TABLE public.quest_episodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view published quest episodes" ON public.quest_episodes;
CREATE POLICY "Anyone can view published quest episodes"
ON public.quest_episodes
FOR SELECT
TO authenticated
USING (status = 'published' OR auth.uid() = user_id);

DROP POLICY IF EXISTS "Creators can insert own quest episodes" ON public.quest_episodes;
CREATE POLICY "Creators can insert own quest episodes"
ON public.quest_episodes
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.quests q
    WHERE q.id = quest_id
      AND q.creator_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Creators can update own quest episodes" ON public.quest_episodes;
CREATE POLICY "Creators can update own quest episodes"
ON public.quest_episodes
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Creators can delete own quest episodes" ON public.quest_episodes;
CREATE POLICY "Creators can delete own quest episodes"
ON public.quest_episodes
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_quest_episodes_quest_id_created_at
  ON public.quest_episodes(quest_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quest_episodes_user_id
  ON public.quest_episodes(user_id);
