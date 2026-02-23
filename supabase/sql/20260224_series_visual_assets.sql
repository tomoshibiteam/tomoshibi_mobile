-- Add visual asset columns for Mastra-generated series cover and character portraits.

ALTER TABLE public.series_bibles
  ADD COLUMN IF NOT EXISTS cover_image_prompt TEXT,
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

ALTER TABLE public.series_characters
  ADD COLUMN IF NOT EXISTS appearance TEXT,
  ADD COLUMN IF NOT EXISTS portrait_prompt TEXT,
  ADD COLUMN IF NOT EXISTS portrait_image_url TEXT;
