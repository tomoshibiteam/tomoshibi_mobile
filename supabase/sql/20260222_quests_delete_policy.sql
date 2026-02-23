-- Allow creators to delete their own quests.
-- Run this in Supabase SQL editor if draft deletion fails due RLS.

ALTER TABLE IF EXISTS public.quests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Creators can delete own quests" ON public.quests;
CREATE POLICY "Creators can delete own quests"
ON public.quests
FOR DELETE
TO authenticated
USING (auth.uid() = creator_id);
