-- Add identity persistence and cover consistency fields for series generation.

ALTER TABLE public.series_characters
  ADD COLUMN IF NOT EXISTS is_key_person BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS identity_anchor_tokens JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.series_bibles
  ADD COLUMN IF NOT EXISTS identity_pack JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cover_consistency_report JSONB DEFAULT '{}'::jsonb;
