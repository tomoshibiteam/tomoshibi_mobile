-- Multi-agent series blueprint schema for TOMOSHIBI mobile.
-- Run this in Supabase SQL editor before using Mastra-based series generation.

CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.series_bibles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quest_id UUID NOT NULL UNIQUE REFERENCES public.quests(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  overview TEXT,
  genre TEXT,
  tone TEXT,
  premise TEXT,
  season_goal TEXT,
  ai_rules TEXT,
  cover_image_prompt TEXT,
  cover_image_url TEXT,
  world JSONB NOT NULL DEFAULT '{}'::jsonb,
  continuity JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_prompt TEXT,
  workflow_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.series_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bible_id UUID NOT NULL REFERENCES public.series_bibles(id) ON DELETE CASCADE,
  quest_id UUID NOT NULL REFERENCES public.quests(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  character_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  goal TEXT,
  arc_start TEXT,
  arc_end TEXT,
  personality TEXT,
  appearance TEXT,
  portrait_prompt TEXT,
  portrait_image_url TEXT,
  secrets TEXT[] NOT NULL DEFAULT '{}',
  relationship_hooks TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bible_id, character_order)
);

CREATE TABLE IF NOT EXISTS public.series_episode_blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bible_id UUID NOT NULL REFERENCES public.series_bibles(id) ON DELETE CASCADE,
  quest_id UUID NOT NULL REFERENCES public.quests(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  episode_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  objective TEXT,
  synopsis TEXT,
  key_location TEXT,
  emotional_beat TEXT,
  required_setups TEXT[] NOT NULL DEFAULT '{}',
  payoff_targets TEXT[] NOT NULL DEFAULT '{}',
  cliffhanger TEXT,
  continuity_notes TEXT,
  suggested_mission TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bible_id, episode_no)
);

-- Compatibility repair: if tables were created earlier with missing columns,
-- ensure required columns exist before creating indexes/policies.
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS quest_id UUID;
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS creator_id UUID;
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS overview TEXT;
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS genre TEXT;
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS tone TEXT;
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS premise TEXT;
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS season_goal TEXT;
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS ai_rules TEXT;
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS cover_image_prompt TEXT;
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS world JSONB;
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS continuity JSONB;
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS source_prompt TEXT;
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS workflow_version TEXT;
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.series_bibles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.series_bibles ALTER COLUMN world SET DEFAULT '{}'::jsonb;
ALTER TABLE public.series_bibles ALTER COLUMN continuity SET DEFAULT '{}'::jsonb;

ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS bible_id UUID;
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS quest_id UUID;
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS creator_id UUID;
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS character_order INTEGER;
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS goal TEXT;
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS arc_start TEXT;
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS arc_end TEXT;
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS personality TEXT;
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS appearance TEXT;
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS portrait_prompt TEXT;
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS portrait_image_url TEXT;
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS secrets TEXT[];
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS relationship_hooks TEXT[];
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.series_characters ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.series_characters ALTER COLUMN secrets SET DEFAULT '{}';
ALTER TABLE public.series_characters ALTER COLUMN relationship_hooks SET DEFAULT '{}';

ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS bible_id UUID;
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS quest_id UUID;
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS creator_id UUID;
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS episode_no INTEGER;
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS objective TEXT;
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS synopsis TEXT;
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS key_location TEXT;
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS emotional_beat TEXT;
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS required_setups TEXT[];
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS payoff_targets TEXT[];
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS cliffhanger TEXT;
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS continuity_notes TEXT;
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS suggested_mission TEXT;
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.series_episode_blueprints ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.series_episode_blueprints ALTER COLUMN required_setups SET DEFAULT '{}';
ALTER TABLE public.series_episode_blueprints ALTER COLUMN payoff_targets SET DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS uq_series_bibles_quest_id
  ON public.series_bibles(quest_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_series_characters_bible_order
  ON public.series_characters(bible_id, character_order);

CREATE UNIQUE INDEX IF NOT EXISTS uq_series_episode_blueprints_bible_episode
  ON public.series_episode_blueprints(bible_id, episode_no);

CREATE INDEX IF NOT EXISTS idx_series_bibles_creator_id_created_at
  ON public.series_bibles(creator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_series_characters_bible_id_order
  ON public.series_characters(bible_id, character_order);

CREATE INDEX IF NOT EXISTS idx_series_episode_blueprints_bible_id_episode_no
  ON public.series_episode_blueprints(bible_id, episode_no);

ALTER TABLE public.series_bibles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_episode_blueprints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Series bibles readable by owner or published quest viewers" ON public.series_bibles;
CREATE POLICY "Series bibles readable by owner or published quest viewers"
ON public.series_bibles
FOR SELECT
TO authenticated
USING (
  auth.uid() = creator_id
  OR EXISTS (
    SELECT 1
    FROM public.quests q
    WHERE q.id = series_bibles.quest_id
      AND q.status = 'published'
  )
);

DROP POLICY IF EXISTS "Series bibles insert by owner" ON public.series_bibles;
CREATE POLICY "Series bibles insert by owner"
ON public.series_bibles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Series bibles update by owner" ON public.series_bibles;
CREATE POLICY "Series bibles update by owner"
ON public.series_bibles
FOR UPDATE
TO authenticated
USING (auth.uid() = creator_id)
WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Series bibles delete by owner" ON public.series_bibles;
CREATE POLICY "Series bibles delete by owner"
ON public.series_bibles
FOR DELETE
TO authenticated
USING (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Series characters readable by owner or published quest viewers" ON public.series_characters;
CREATE POLICY "Series characters readable by owner or published quest viewers"
ON public.series_characters
FOR SELECT
TO authenticated
USING (
  auth.uid() = creator_id
  OR EXISTS (
    SELECT 1
    FROM public.quests q
    WHERE q.id = series_characters.quest_id
      AND q.status = 'published'
  )
);

DROP POLICY IF EXISTS "Series characters insert by owner" ON public.series_characters;
CREATE POLICY "Series characters insert by owner"
ON public.series_characters
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Series characters update by owner" ON public.series_characters;
CREATE POLICY "Series characters update by owner"
ON public.series_characters
FOR UPDATE
TO authenticated
USING (auth.uid() = creator_id)
WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Series characters delete by owner" ON public.series_characters;
CREATE POLICY "Series characters delete by owner"
ON public.series_characters
FOR DELETE
TO authenticated
USING (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Series episodes readable by owner or published quest viewers" ON public.series_episode_blueprints;
CREATE POLICY "Series episodes readable by owner or published quest viewers"
ON public.series_episode_blueprints
FOR SELECT
TO authenticated
USING (
  auth.uid() = creator_id
  OR EXISTS (
    SELECT 1
    FROM public.quests q
    WHERE q.id = series_episode_blueprints.quest_id
      AND q.status = 'published'
  )
);

DROP POLICY IF EXISTS "Series episodes insert by owner" ON public.series_episode_blueprints;
CREATE POLICY "Series episodes insert by owner"
ON public.series_episode_blueprints
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Series episodes update by owner" ON public.series_episode_blueprints;
CREATE POLICY "Series episodes update by owner"
ON public.series_episode_blueprints
FOR UPDATE
TO authenticated
USING (auth.uid() = creator_id)
WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Series episodes delete by owner" ON public.series_episode_blueprints;
CREATE POLICY "Series episodes delete by owner"
ON public.series_episode_blueprints
FOR DELETE
TO authenticated
USING (auth.uid() = creator_id);

DROP TRIGGER IF EXISTS trg_series_bibles_updated_at ON public.series_bibles;
CREATE TRIGGER trg_series_bibles_updated_at
BEFORE UPDATE ON public.series_bibles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_series_characters_updated_at ON public.series_characters;
CREATE TRIGGER trg_series_characters_updated_at
BEFORE UPDATE ON public.series_characters
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_series_episode_blueprints_updated_at ON public.series_episode_blueprints;
CREATE TRIGGER trg_series_episode_blueprints_updated_at
BEFORE UPDATE ON public.series_episode_blueprints
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();
