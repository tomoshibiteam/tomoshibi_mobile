-- Extend series_bibles to store long-running series state and first episode seed.

ALTER TABLE public.series_bibles
  ADD COLUMN IF NOT EXISTS progress_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS first_episode_seed JSONB NOT NULL DEFAULT '{}'::jsonb;

