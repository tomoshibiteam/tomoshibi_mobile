-- Ensure episode cover assets can be persisted.
-- Run this in Supabase SQL editor.

ALTER TABLE public.quest_episodes
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

ALTER TABLE public.quest_posts
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] DEFAULT '{}'::TEXT[];

