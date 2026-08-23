-- ============================================================================
-- James's user record: active, still uninvited
--
-- The record was created inactive on the reasoning that an uninvited user
-- should not be active. That is wrong in LEAP: app_current_role_name() resolves
-- a role only for a user whose user_is_active is true, so an inactive James had
-- NO role — app_is_office_side() returned false and work orders, work steps and
-- everything else gated on office-side access were invisible to him for a
-- reason that had nothing to do with North Carolina. It made his previewed
-- access look far narrower than it will be.
--
-- What actually keeps him out is auth_user_id being NULL: there is no login
-- attached to the record, so there is nothing to sign in with until the
-- invitation is deliberately sent.
-- ============================================================================

UPDATE public.users
SET user_is_active = true
WHERE user_first_name = 'James'
  AND auth_user_id IS NULL
  AND COALESCE(user_is_deleted, false) = false;
