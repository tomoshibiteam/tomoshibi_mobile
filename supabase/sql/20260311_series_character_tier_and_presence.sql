-- Add character hierarchy fields for series continuity focus.

ALTER TABLE public.series_characters
  ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'secondary',
  ADD COLUMN IF NOT EXISTS must_appear BOOLEAN DEFAULT FALSE;

UPDATE public.series_characters
SET
  tier = CASE
    WHEN COALESCE(is_key_person, FALSE) THEN 'primary'
    ELSE 'secondary'
  END,
  must_appear = CASE
    WHEN COALESCE(is_key_person, FALSE) THEN TRUE
    ELSE FALSE
  END
WHERE tier IS NULL
   OR must_appear IS NULL;

ALTER TABLE public.series_characters
  ALTER COLUMN tier SET DEFAULT 'secondary',
  ALTER COLUMN must_appear SET DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'series_characters_tier_check'
      AND conrelid = 'public.series_characters'::regclass
  ) THEN
    ALTER TABLE public.series_characters
      ADD CONSTRAINT series_characters_tier_check
      CHECK (tier IN ('primary', 'secondary'));
  END IF;
END $$;

-- primary-only must_appear policy (soft-enforced at app layer; hard-enforced with warning query).
-- To keep backward compatibility, we do not add a strict CHECK here.

NOTIFY pgrst, 'reload schema';
