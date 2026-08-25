-- =============================================================================
-- Program Manager Portal — Phase 1 spine.
--
-- Nicholas, 2026-08-25: Everblue is a Program Implementer. Share only the
-- record IDs we select. They see the Energy Assessment Report, the work steps
-- for the assessment, and the photos. Read-only. Download permission is set
-- per organisation AND per user.
--
-- A program manager owns nothing and is assigned nothing, so neither existing
-- portal's scoping fits: the owner portal scopes by property ownership, the
-- provider portal by work-order assignment. Here the shared thing is a RECORD,
-- so the grant names one. Full plan: docs/leap-program-manager-portal.md.
-- =============================================================================

-- ─── 1. Everblue, and the Program Implementer convention ────────────────────
-- The record type already existed and carried zero accounts; this is the first.
-- account_owner / account_created_by are NOT NULL — every record has a named
-- owner — so they are set rather than left to a default.

INSERT INTO public.accounts (account_record_number, account_name, account_record_type, account_owner, account_created_by, account_updated_by, account_notes)
SELECT '', 'Everblue',
       (SELECT id FROM public.picklist_values
         WHERE picklist_object='accounts' AND picklist_field='record_type'
           AND picklist_value='PROGRAM-IMPLEMENTER'),
       (SELECT id FROM public.users WHERE user_email = 'nicholas.wood@ees-wi.org' AND user_is_deleted IS NOT TRUE LIMIT 1),
       (SELECT id FROM public.users WHERE user_email = 'nicholas.wood@ees-wi.org' AND user_is_deleted IS NOT TRUE LIMIT 1),
       (SELECT id FROM public.users WHERE user_email = 'nicholas.wood@ees-wi.org' AND user_is_deleted IS NOT TRUE LIMIT 1),
       'Program implementer. Reviews the assessments and projects EES shares with them through the Program Manager Portal. Contact details still needed before anyone is invited.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounts WHERE lower(account_name) = 'everblue' AND account_is_deleted IS NOT TRUE
);

-- ─── 2. The third portal user record type, and its roles ────────────────────

INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order, picklist_show_in_path,
   picklist_is_default_record_type, picklist_description)
SELECT 'portal_users', 'record_type', 'Program Manager User', 'Program Manager User',
       true, 30, true, false,
       'External user of the Program Manager Portal — a program implementer or administrator reviewing the specific assessment and project records EES has shared with them.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values
   WHERE picklist_object='portal_users' AND picklist_field='record_type'
     AND picklist_value='Program Manager User');

INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order, picklist_description)
SELECT v.o, v.f, v.val, v.lab, v.act, v.ord, v.descr FROM (VALUES
  ('portal_users','portal_role','program_manager','Program Manager', true, 30,
   'Program Manager Portal: reviews shared records. May download files when both the organisation and the user are permitted.'),
  ('portal_users','portal_role','program_reviewer','Program Reviewer', true, 31,
   'Program Manager Portal: reviews shared records on screen. Downloading is a separate permission.')
) AS v(o,f,val,lab,act,ord,descr)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values
   WHERE picklist_object='portal_users' AND picklist_field='portal_role'
     AND picklist_value = v.val);

-- ─── 3. Download permission — organisation AND user, both explicit ──────────
-- Both default false. Viewing is what a grant buys; taking a copy of the file
-- off the platform is a second, deliberate act, permitted at the organisation
-- and then for the individual. Every download is written to portal_download_log
-- (Phase 2).

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_allow_portal_download boolean NOT NULL DEFAULT false;
ALTER TABLE public.portal_users
  ADD COLUMN IF NOT EXISTS portal_user_allow_download boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.accounts.account_allow_portal_download IS
  'May this organisation''s portal users download files at all? Master switch, off by default. A user also needs portal_user_allow_download.';
COMMENT ON COLUMN public.portal_users.portal_user_allow_download IS
  'May this portal user download files? Off by default, and only effective when their organisation also allows downloads. Every download is written to portal_download_log.';

-- ─── 4. The grants — one row per shared record ──────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.seq_portal_record_grants;

CREATE TABLE IF NOT EXISTS public.portal_record_grants (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prg_record_number     text NOT NULL,
  prg_portal_user_id    uuid NOT NULL REFERENCES public.portal_users(id),
  prg_object            text NOT NULL,
  prg_record_id         uuid NOT NULL,
  prg_owner             uuid REFERENCES public.users(id),
  prg_is_deleted        boolean NOT NULL DEFAULT false,
  prg_deleted_at        timestamptz,
  prg_deleted_by        uuid REFERENCES public.users(id),
  prg_deletion_reason   text,
  prg_created_at        timestamptz NOT NULL DEFAULT now(),
  prg_created_by        uuid REFERENCES public.users(id),
  prg_updated_at        timestamptz NOT NULL DEFAULT now(),
  prg_updated_by        uuid REFERENCES public.users(id),
  is_seed_data          boolean NOT NULL DEFAULT false,
  CONSTRAINT portal_record_grants_object_check
    CHECK (prg_object IN ('assessments', 'projects'))
);

COMMENT ON TABLE public.portal_record_grants IS
  'One row per record explicitly shared with a Program Manager Portal user. Polymorphic on purpose: assessments and projects today, more objects later without a new table each time. There is no implicit access — nothing is visible that is not named here.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_prg_unique_live
  ON public.portal_record_grants (prg_portal_user_id, prg_object, prg_record_id)
  WHERE prg_is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_prg_portal_user ON public.portal_record_grants (prg_portal_user_id);
CREATE INDEX IF NOT EXISTS idx_prg_record ON public.portal_record_grants (prg_object, prg_record_id);

CREATE OR REPLACE FUNCTION public.set_portal_record_grant_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.prg_record_number IS NULL OR NEW.prg_record_number = '' THEN
    NEW.prg_record_number := public.generate_record_number('PRG-', 'seq_portal_record_grants');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prg_record_number ON public.portal_record_grants;
CREATE TRIGGER trg_prg_record_number
  BEFORE INSERT ON public.portal_record_grants
  FOR EACH ROW EXECUTE FUNCTION public.set_portal_record_grant_number();

DROP TRIGGER IF EXISTS trg_prg_updated_at ON public.portal_record_grants;
CREATE TRIGGER trg_prg_updated_at
  BEFORE UPDATE ON public.portal_record_grants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.portal_record_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_select_prg ON public.portal_record_grants;
CREATE POLICY app_select_prg ON public.portal_record_grants
  FOR SELECT TO authenticated
  USING ((SELECT public.app_user_can('portal_record_grants','read')));

DROP POLICY IF EXISTS app_insert_prg ON public.portal_record_grants;
CREATE POLICY app_insert_prg ON public.portal_record_grants
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.app_user_can('portal_record_grants','create')));

DROP POLICY IF EXISTS app_update_prg ON public.portal_record_grants;
CREATE POLICY app_update_prg ON public.portal_record_grants
  FOR UPDATE TO authenticated
  USING ((SELECT public.app_user_can('portal_record_grants','update')))
  WITH CHECK ((SELECT public.app_user_can('portal_record_grants','update')));

DROP POLICY IF EXISTS portal_user_own_record_grants_select ON public.portal_record_grants;
CREATE POLICY portal_user_own_record_grants_select ON public.portal_record_grants
  FOR SELECT TO authenticated
  USING (prg_is_deleted = false AND EXISTS (
    SELECT 1 FROM public.portal_users pu
     WHERE pu.id = portal_record_grants.prg_portal_user_id
       AND pu.auth_user_id = auth.uid()
       AND pu.is_deleted = false));

NOTIFY pgrst, 'reload schema';
