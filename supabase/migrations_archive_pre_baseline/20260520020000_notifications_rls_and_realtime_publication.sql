-- Enable RLS on notifications and add the table to the supabase_realtime
-- publication so the NotificationBell can subscribe to live INSERT events
-- and pop new notifications without a 60-second poll. The RLS scoping
-- (recipient_id = current_app_user_id) is what makes realtime safe —
-- without it, every signed-in user would see every other user's
-- notifications via the realtime broadcast.

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (
    recipient_id = (
      SELECT id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1
    )
  );

-- We don't grant direct UPDATE/INSERT to authenticated — the existing
-- SECURITY DEFINER RPCs (notifications_mark_read, notifications_mark_all_read)
-- handle every legitimate write path. Server-side triggers and the automation
-- executor bypass RLS via SECURITY DEFINER, so creation still works.
-- Admin (service_role) bypasses RLS by default so no policy needed.

-- REPLICA IDENTITY FULL: makes realtime payloads include the full old + new
-- row for UPDATE and DELETE events, instead of just the primary key. The
-- bell uses INSERT events primarily, but FULL means the client can filter
-- updates (e.g. is_read flip) without an extra round trip.
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- Add to the publication. supabase_realtime is the default publication name
-- Supabase listens on; appending the table here is the standard pattern.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;
