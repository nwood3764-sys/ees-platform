-- ===========================================================================
-- page_layout_actions — per-layout action tier configuration
--
-- Today the RecordDetail topbar hardcodes a fan of conditionally-rendered
-- action buttons (Edit / Clone / Delete / Generate Report / Schedule /
-- Reschedule / Send for Signature / Publish / Unpublish / Restore / etc).
-- The list grows every release and the topbar is getting cluttered.
--
-- This table records, per page layout, which actions appear and at what
-- tier — `primary` renders as a visible button, `menu` collapses into an
-- "Actions" overflow dropdown. Actions not present at all in a layout's
-- rows are hidden (effectively a third tier of "hidden").
--
-- `pla_action_key` is a stable identifier matched against an in-code
-- action registry that owns the icon, label, handler, and runtime
-- availability predicate. The registry decides whether an action is
-- *applicable* to the current record (e.g. send_for_signature requires
-- an active document template, schedule_work_order requires
-- status='To Be Scheduled') — the table decides whether an applicable
-- action is *promoted* to the primary tier or *demoted* to the menu.
-- ===========================================================================

CREATE SEQUENCE IF NOT EXISTS public.seq_page_layout_actions;

CREATE TABLE IF NOT EXISTS public.page_layout_actions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pla_record_number           text NOT NULL DEFAULT '',
  pla_page_layout_id          uuid NOT NULL REFERENCES public.page_layouts(id) ON DELETE CASCADE,
  pla_action_key              text NOT NULL,        -- matches recordActions.js registry key
  pla_label_override          text,                 -- optional UI label override
  pla_display_tier            text NOT NULL DEFAULT 'menu'
                              CHECK (pla_display_tier IN ('primary','menu')),
  pla_sort_order              integer NOT NULL DEFAULT 100,
  pla_visibility_role_id      uuid REFERENCES public.roles(id),  -- nullable = visible to all roles permitted to use the layout
  pla_owner                   uuid NOT NULL REFERENCES public.users(id),
  pla_created_by              uuid REFERENCES public.users(id),
  pla_created_at              timestamptz NOT NULL DEFAULT now(),
  pla_updated_by              uuid REFERENCES public.users(id),
  pla_updated_at              timestamptz NOT NULL DEFAULT now(),
  pla_is_deleted              boolean NOT NULL DEFAULT false,
  pla_deleted_at              timestamptz,
  pla_deleted_by              uuid REFERENCES public.users(id),
  pla_deletion_reason         text,
  is_seed_data                boolean NOT NULL DEFAULT false,
  CONSTRAINT pla_unique_action_per_layout UNIQUE (pla_page_layout_id, pla_action_key)
);

CREATE INDEX IF NOT EXISTS ix_pla_layout
  ON public.page_layout_actions (pla_page_layout_id) WHERE NOT pla_is_deleted;
CREATE INDEX IF NOT EXISTS ix_pla_action_key
  ON public.page_layout_actions (pla_action_key) WHERE NOT pla_is_deleted;
CREATE INDEX IF NOT EXISTS ix_pla_seed
  ON public.page_layout_actions (is_seed_data) WHERE is_seed_data;

-- Auto-numbering trigger — PLA-####
CREATE OR REPLACE FUNCTION public.set_pla_record_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.pla_record_number IS NULL OR NEW.pla_record_number = '' THEN
    NEW.pla_record_number := generate_record_number('PLA-', 'seq_page_layout_actions');
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_pla_record_number ON public.page_layout_actions;
CREATE TRIGGER trg_pla_record_number
BEFORE INSERT ON public.page_layout_actions
FOR EACH ROW EXECUTE FUNCTION public.set_pla_record_number();

-- updated_at trigger — match the platform convention
CREATE OR REPLACE FUNCTION public.touch_pla_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.pla_updated_at := now();
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_pla_touch ON public.page_layout_actions;
CREATE TRIGGER trg_pla_touch
BEFORE UPDATE ON public.page_layout_actions
FOR EACH ROW EXECUTE FUNCTION public.touch_pla_updated_at();

-- RLS — mirror the outbound_mailboxes pattern (admin-configured config table)
ALTER TABLE public.page_layout_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_select_page_layout_actions
  ON public.page_layout_actions FOR SELECT TO authenticated
  USING (app_user_can('page_layout_actions', 'read'));

CREATE POLICY app_insert_page_layout_actions
  ON public.page_layout_actions FOR INSERT TO authenticated
  WITH CHECK (app_user_can('page_layout_actions', 'create'));

CREATE POLICY app_update_page_layout_actions
  ON public.page_layout_actions FOR UPDATE TO authenticated
  USING (app_user_can('page_layout_actions', 'update'));

CREATE POLICY app_delete_page_layout_actions
  ON public.page_layout_actions FOR DELETE TO authenticated
  USING (app_user_can('page_layout_actions', 'delete'));
