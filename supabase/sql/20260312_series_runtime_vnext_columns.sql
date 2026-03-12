-- Add continuity-first vNext payload columns to series_bibles.
-- This keeps shared blueprint payloads and per-user continuity state separate.

ALTER TABLE public.series_bibles
  ADD COLUMN IF NOT EXISTS series_blueprint JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS initial_user_series_state_template JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS episode_runtime_bootstrap_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS user_series_state JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Minimal backfill to avoid empty user continuity state on existing rows.
UPDATE public.series_bibles
SET user_series_state = jsonb_build_object(
  'id', concat(quest_id::text, ':', creator_id::text),
  'userId', creator_id::text,
  'seriesBlueprintId', quest_id::text,
  'referencedBlueprintVersion', 1,
  'stateVersion', 1,
  'currentProgress', jsonb_build_object(
    'episodeCountCompleted', COALESCE((progress_state->>'last_completed_episode_no')::int, 0),
    'currentCheckpointIndex', 0,
    'currentArcSummary', COALESCE(NULLIF(progress_state->>'relationship_state_summary', ''), '導入段階'),
    'unresolvedThreads', COALESCE(progress_state->'unresolved_threads', '[]'::jsonb),
    'resolvedThreads', COALESCE(progress_state->'revealed_facts', '[]'::jsonb),
    'activeForeshadowing',
      CASE
        WHEN COALESCE(NULLIF(progress_state->>'next_hook', ''), '') <> ''
          THEN jsonb_build_array(progress_state->>'next_hook')
        ELSE '[]'::jsonb
      END,
    'completedEpisodeIds', '[]'::jsonb
  ),
  'rememberedExperience', jsonb_build_object(
    'visitedLocations', '[]'::jsonb,
    'keyEvents', '[]'::jsonb,
    'importantConversations', '[]'::jsonb,
    'playerChoices', '[]'::jsonb,
    'emotionalMoments', '[]'::jsonb,
    'relationshipTurningPoints', '[]'::jsonb
  ),
  'relationshipState', '[]'::jsonb,
  'continuityState', jsonb_build_object(
    'callbackCandidates', COALESCE(progress_state->'revealed_facts', '[]'::jsonb),
    'motifsInUse', '[]'::jsonb,
    'blockedLines', '[]'::jsonb,
    'promisedPayoffs',
      CASE
        WHEN COALESCE(NULLIF(progress_state->>'next_hook', ''), '') <> ''
          THEN jsonb_build_array(progress_state->>'next_hook')
        ELSE '[]'::jsonb
      END,
    'episodeLocalCharacterCarryovers', '[]'::jsonb
  ),
  'monetizationState', jsonb_build_object(
    'episodeLimit', 3,
    'extensionUnlocked', false
  )
)
WHERE user_series_state IS NULL
   OR user_series_state = '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
