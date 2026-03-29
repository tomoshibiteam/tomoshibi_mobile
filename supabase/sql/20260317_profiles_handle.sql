ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS handle TEXT;

UPDATE public.profiles
SET handle = NULL
WHERE handle = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_handle_format_check'
  ) THEN
    ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_handle_format_check
    CHECK (
      handle IS NULL
      OR handle ~ '^[a-z0-9_.\-ぁ-んァ-ヶ一-龠]{1,30}$'
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle_unique
ON public.profiles (LOWER(handle))
WHERE handle IS NOT NULL;
