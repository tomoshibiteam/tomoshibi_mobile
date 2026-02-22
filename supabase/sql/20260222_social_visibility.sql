-- Social visibility policies for search/profile/followers screens
-- Run this in Supabase SQL editor if search or other-user connections are not fully visible.

-- 1) Profiles: authenticated users can search/view basic profile rows.
DROP POLICY IF EXISTS "Authenticated users can view basic profile info of other users" ON public.profiles;
CREATE POLICY "Authenticated users can view basic profile info of other users"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- 2) Friendships: allow authenticated users to read accepted relations
-- so follower/following counts and lists on other profiles can be resolved.
DROP POLICY IF EXISTS "Authenticated users can view accepted friendships" ON public.friendships;
CREATE POLICY "Authenticated users can view accepted friendships"
ON public.friendships
FOR SELECT
TO authenticated
USING (
  status = 'accepted'
  OR auth.uid() = requester_id
  OR auth.uid() = receiver_id
);

-- 3) Helpful indexes for follower/following queries.
CREATE INDEX IF NOT EXISTS idx_friendships_status_requester
  ON public.friendships(status, requester_id);

CREATE INDEX IF NOT EXISTS idx_friendships_status_receiver
  ON public.friendships(status, receiver_id);
