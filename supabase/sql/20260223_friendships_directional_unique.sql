-- Allow mutual follows by keeping uniqueness per direction.
-- Run this in Supabase SQL editor.

BEGIN;

-- Legacy schema blocks reverse-direction rows for the same two users.
ALTER TABLE IF EXISTS public.friendships
  DROP CONSTRAINT IF EXISTS friendships_unique_pair;

-- Enforce directional uniqueness only.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'friendships_unique_direction'
  ) THEN
    ALTER TABLE public.friendships
      ADD CONSTRAINT friendships_unique_direction UNIQUE (requester_id, receiver_id);
  END IF;
END
$$;

-- Keep self-follow prevention explicit and idempotent.
ALTER TABLE IF EXISTS public.friendships
  DROP CONSTRAINT IF EXISTS friendships_no_self_follow;

ALTER TABLE IF EXISTS public.friendships
  ADD CONSTRAINT friendships_no_self_follow CHECK (requester_id <> receiver_id);

COMMIT;
