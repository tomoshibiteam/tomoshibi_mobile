-- series_characters に series_id を追加（quests.series_id 経由で参照）
-- 実行後、Supabase ダッシュボードの SQL Editor で以下を実行してスキーマキャッシュを更新してください:
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE public.series_characters
  ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES public.series(id) ON DELETE CASCADE;

-- 既存行を quests から series_id でバックフィル
UPDATE public.series_characters sc
SET series_id = q.series_id
FROM public.quests q
WHERE sc.quest_id = q.id
  AND sc.series_id IS NULL;

-- NOT NULL 制約を付与（既に付いている場合はスキップ）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'series_characters' AND column_name = 'series_id'
    AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.series_characters ALTER COLUMN series_id SET NOT NULL;
  END IF;
END $$;

-- PostgREST スキーマキャッシュをリロード（必須: Supabase SQL Editor で実行）
NOTIFY pgrst, 'reload schema';
