-- Trace logs for episode generation pipeline (retrieval -> eligibility -> MMR -> routing).

CREATE TABLE IF NOT EXISTS public.episode_generation_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quest_id UUID NOT NULL REFERENCES public.quests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  episode_no INTEGER NOT NULL CHECK (episode_no >= 1),
  stage_location TEXT,
  candidate_spots_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_spots_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  route_score DOUBLE PRECISION,
  continuity_score DOUBLE PRECISION,
  eligibility_reject_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  mmr_scores_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  route_metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_episode_generation_traces_quest_episode
  ON public.episode_generation_traces (quest_id, episode_no DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_episode_generation_traces_user_created_at
  ON public.episode_generation_traces (user_id, created_at DESC);

ALTER TABLE public.episode_generation_traces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Episode traces readable by owner or published quest viewers" ON public.episode_generation_traces;
CREATE POLICY "Episode traces readable by owner or published quest viewers"
ON public.episode_generation_traces
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.quests q
    WHERE q.id = episode_generation_traces.quest_id
      AND q.status = 'published'
  )
);

DROP POLICY IF EXISTS "Episode traces insert by owner" ON public.episode_generation_traces;
CREATE POLICY "Episode traces insert by owner"
ON public.episode_generation_traces
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Episode traces delete by owner" ON public.episode_generation_traces;
CREATE POLICY "Episode traces delete by owner"
ON public.episode_generation_traces
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
