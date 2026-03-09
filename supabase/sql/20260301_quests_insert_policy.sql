-- Ensure the quests table exists and has the required columns and RLS policies
-- for series creation to work (insert + select).
-- Run this in the Supabase SQL editor.

-- 1. Create quests table if it does not exist.
CREATE TABLE IF NOT EXISTS public.quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  description TEXT,
  area_name TEXT,
  cover_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  mode TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Ensure required columns exist (safe idempotent ADD COLUMN IF NOT EXISTS).
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS creator_id UUID;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS area_name TEXT;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS mode TEXT;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 3. Indexes.
CREATE INDEX IF NOT EXISTS idx_quests_creator_id_created_at
  ON public.quests(creator_id, created_at DESC);

-- 4. Enable RLS.
ALTER TABLE public.quests ENABLE ROW LEVEL SECURITY;

-- 5. INSERT policy: authenticated users can insert their own quests.
DROP POLICY IF EXISTS "Creators can insert own quests" ON public.quests;
CREATE POLICY "Creators can insert own quests"
ON public.quests
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = creator_id);

-- 6. SELECT policy: creators can always read their own quests.
DROP POLICY IF EXISTS "Creators can read own quests" ON public.quests;
CREATE POLICY "Creators can read own quests"
ON public.quests
FOR SELECT
TO authenticated
USING (auth.uid() = creator_id);

-- 7. UPDATE policy: creators can update their own quests.
DROP POLICY IF EXISTS "Creators can update own quests" ON public.quests;
CREATE POLICY "Creators can update own quests"
ON public.quests
FOR UPDATE
TO authenticated
USING (auth.uid() = creator_id)
WITH CHECK (auth.uid() = creator_id);

-- 8. DELETE policy: creators can delete their own quests.
DROP POLICY IF EXISTS "Creators can delete own quests" ON public.quests;
CREATE POLICY "Creators can delete own quests"
ON public.quests
FOR DELETE
TO authenticated
USING (auth.uid() = creator_id);

-- 9. Public SELECT for published quests (so other users can view them).
DROP POLICY IF EXISTS "Anyone can view published quests" ON public.quests;
CREATE POLICY "Anyone can view published quests"
ON public.quests
FOR SELECT
TO authenticated
USING (status = 'published');
