-- Helpers the in-app NotificationBell calls. SECURITY DEFINER so they work
-- even before proper RLS rules land on notifications. Each function scopes
-- to the caller via auth.uid() → public.users lookup, never trusting a
-- passed-in user id.

CREATE OR REPLACE FUNCTION public._current_app_user_id() RETURNS uuid AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.notifications_unread_count() RETURNS int AS $$
DECLARE v_uid uuid; v_cnt int;
BEGIN
  v_uid := public._current_app_user_id();
  IF v_uid IS NULL THEN RETURN 0; END IF;
  SELECT count(*)::int INTO v_cnt
    FROM notifications
   WHERE recipient_id = v_uid AND NOT is_read;
  RETURN coalesce(v_cnt, 0);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.notifications_list_recent(p_limit int DEFAULT 30)
RETURNS TABLE (
  id uuid, notification_type text, title text, body text,
  related_object text, related_id uuid,
  is_read boolean, read_at timestamptz,
  is_automated boolean, triggered_by uuid,
  created_at timestamptz
) AS $$
DECLARE v_uid uuid; v_lim int;
BEGIN
  v_uid := public._current_app_user_id();
  IF v_uid IS NULL THEN RETURN; END IF;
  v_lim := LEAST(GREATEST(coalesce(p_limit, 30), 1), 100);
  RETURN QUERY
    SELECT n.id, n.notification_type, n.title, n.body,
           n.related_object, n.related_id,
           n.is_read, n.read_at,
           n.is_automated, n.triggered_by,
           n.created_at
      FROM notifications n
     WHERE n.recipient_id = v_uid
     ORDER BY n.created_at DESC
     LIMIT v_lim;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.notifications_mark_read(p_notification_id uuid)
RETURNS int AS $$
DECLARE v_uid uuid; v_n int;
BEGIN
  v_uid := public._current_app_user_id();
  IF v_uid IS NULL THEN RETURN 0; END IF;
  UPDATE notifications
     SET is_read = true,
         read_at = COALESCE(read_at, now())
   WHERE id = p_notification_id
     AND recipient_id = v_uid
     AND NOT is_read;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.notifications_mark_all_read() RETURNS int AS $$
DECLARE v_uid uuid; v_n int;
BEGIN
  v_uid := public._current_app_user_id();
  IF v_uid IS NULL THEN RETURN 0; END IF;
  UPDATE notifications
     SET is_read = true,
         read_at = COALESCE(read_at, now())
   WHERE recipient_id = v_uid AND NOT is_read;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
