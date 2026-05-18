-- =========================================================================
-- object_lifecycle_config — per-object primary lifecycle declaration.
--
-- Resolves the multi-status-field ambiguity in StatusTransitionsBar.
-- Today, the bar self-suppresses on any table where status_transitions
-- has rows on more than one st_status_field. After this migration, an
-- object can declare which of its status fields is the "primary"
-- lifecycle (the one that gets the prominent record-detail bar). Other
-- secondary statuses still have their own configured transitions and
-- still appear in the Activity Timeline via status_change_events; they
-- just don't drive the headline UI.
--
-- Patterned on object_chat_enabled — single-row-per-object lookup table.
-- olc_object is UNIQUE so there's one declaration per object.
-- =========================================================================

CREATE TABLE public.object_lifecycle_config (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  olc_object                  text NOT NULL UNIQUE,
  olc_primary_status_field    text NOT NULL,
  olc_notes                   text,
  olc_is_deleted              boolean NOT NULL DEFAULT false,
  olc_deleted_at              timestamptz,
  olc_deleted_by              uuid REFERENCES public.users(id),
  olc_deletion_reason         text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES public.users(id),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid REFERENCES public.users(id)
);

COMMENT ON TABLE public.object_lifecycle_config IS
  'Per-object declaration of which status field is the primary lifecycle. Resolves multi-status-field ambiguity for StatusTransitionsBar. One row per object (olc_object UNIQUE).';

COMMENT ON COLUMN public.object_lifecycle_config.olc_object IS
  'Table name (e.g. work_orders, opportunities). UNIQUE — one primary declaration per object.';

COMMENT ON COLUMN public.object_lifecycle_config.olc_primary_status_field IS
  'Column name on the object that holds the primary lifecycle status. StatusTransitionsBar uses this to disambiguate when status_transitions has transitions configured on more than one column.';

ALTER TABLE public.object_lifecycle_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY authenticated_read ON public.object_lifecycle_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY authenticated_insert ON public.object_lifecycle_config
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY authenticated_update ON public.object_lifecycle_config
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY authenticated_delete ON public.object_lifecycle_config
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_object_lifecycle_config_updated_at
  BEFORE UPDATE ON public.object_lifecycle_config
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
