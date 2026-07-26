-- Per-user default list views.
-- Nicholas (2026-07-26): "If I select default view, that should be my default view."
--
-- Root cause of the double-star / default-not-sticking bug: the default flag lived
-- on saved_list_views.list_view_is_default — a column ON the (often shared) view row.
-- Deduping on save only cleared rows with list_view_owner = the current user, so a
-- default-flagged row owned by anyone else (e.g. the seed "All Opportunities" view,
-- owned by the legacy user record) could never be un-defaulted by the person setting
-- a new default — two stars. And because the flag was global to the row, one user
-- setting a shared view as "their" default changed it for everybody.
--
-- Correct structure (Salesforce pinned-list-view parity): the default is a property
-- of the USER, not of the view. This table stores one pointer per (user, object):
-- "when this user opens this object's list, open this saved view."
--
-- The legacy saved_list_views.list_view_is_default column is deprecated as of this
-- migration: existing flags are backfilled here (latest-updated row wins per
-- owner+object) and then cleared so the flag can never disagree with this table.

CREATE TABLE IF NOT EXISTS public.list_view_user_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_view_default_user_id uuid NOT NULL REFERENCES public.users(id),
  list_view_default_object  text NOT NULL,
  saved_list_view_id        uuid NOT NULL REFERENCES public.saved_list_views(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT list_view_user_defaults_one_per_user_object
    UNIQUE (list_view_default_user_id, list_view_default_object)
);

CREATE INDEX IF NOT EXISTS list_view_user_defaults_saved_view_idx
  ON public.list_view_user_defaults (saved_list_view_id);

ALTER TABLE public.list_view_user_defaults ENABLE ROW LEVEL SECURITY;

-- A default is a personal preference: each user reads and manages ONLY their own
-- rows. current_app_user_id() translates auth.users.id -> public.users.id.
DROP POLICY IF EXISTS list_view_user_defaults_select ON public.list_view_user_defaults;
CREATE POLICY list_view_user_defaults_select ON public.list_view_user_defaults
  FOR SELECT TO authenticated
  USING (list_view_default_user_id = current_app_user_id());

DROP POLICY IF EXISTS list_view_user_defaults_insert ON public.list_view_user_defaults;
CREATE POLICY list_view_user_defaults_insert ON public.list_view_user_defaults
  FOR INSERT TO authenticated
  WITH CHECK (list_view_default_user_id = current_app_user_id());

DROP POLICY IF EXISTS list_view_user_defaults_update ON public.list_view_user_defaults;
CREATE POLICY list_view_user_defaults_update ON public.list_view_user_defaults
  FOR UPDATE TO authenticated
  USING (list_view_default_user_id = current_app_user_id())
  WITH CHECK (list_view_default_user_id = current_app_user_id());

DROP POLICY IF EXISTS list_view_user_defaults_delete ON public.list_view_user_defaults;
CREATE POLICY list_view_user_defaults_delete ON public.list_view_user_defaults
  FOR DELETE TO authenticated
  USING (list_view_default_user_id = current_app_user_id());

REVOKE ALL ON public.list_view_user_defaults FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.list_view_user_defaults TO authenticated;
GRANT ALL ON public.list_view_user_defaults TO service_role;

-- Backfill: carry each owner's existing default flags over as per-user pointers.
-- Where an owner had MORE than one active default-flagged view on the same object
-- (the bug this migration fixes), the most recently updated row wins — that is the
-- one the user set last, i.e. their actual intent.
INSERT INTO public.list_view_user_defaults
  (list_view_default_user_id, list_view_default_object, saved_list_view_id)
SELECT DISTINCT ON (slv.list_view_owner, slv.list_view_object)
       slv.list_view_owner, slv.list_view_object, slv.id
FROM public.saved_list_views slv
WHERE slv.list_view_is_default IS TRUE
  AND slv.is_deleted IS NOT TRUE
ORDER BY slv.list_view_owner, slv.list_view_object,
         slv.updated_at DESC NULLS LAST, slv.created_at DESC
ON CONFLICT ON CONSTRAINT list_view_user_defaults_one_per_user_object DO NOTHING;

-- Retire the legacy row-level flag so it can never contradict the new table.
UPDATE public.saved_list_views
SET list_view_is_default = false
WHERE list_view_is_default IS TRUE;

NOTIFY pgrst, 'reload schema';
