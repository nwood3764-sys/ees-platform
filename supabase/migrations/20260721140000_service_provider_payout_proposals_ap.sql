-- ============================================================================
-- Service Provider Portal + Intake — Phase 2: payout price book, proposals, AP
-- ----------------------------------------------------------------------------
-- Pricing rides on the work order as a PROPOSAL the provider accepts/rejects.
-- When EES issues work to a provider, a proposal is generated with priced lines
-- (installed measure x resolved payout rate). The provider accepts or rejects.
-- Acceptance locks the agreed payout; that amount flows into an invoice + the
-- payment section after the work is verified complete.
--
-- Payout rates are STATE-SPECIFIC (not regional) with an optional per-provider
-- override book layered on top of the state standard book.
--
-- New objects:
--   sp_payout_price_books            (SPPB-)  state / per-provider payout books
--   sp_payout_price_book_entries     (SPPE-)  per-measure payout unit rate
--   service_provider_proposals       (SPRO-)  proposal header (may span WOs)
--   service_provider_proposal_lines  (SPRL-)  priced measure line -> work order
--   service_provider_invoices        (SPI-)   payable generated from acceptance
--   service_provider_invoice_line_items (SPIL-) invoice line
--   service_provider_payments        (SPP-)   payment against an invoice
-- Plus work_orders assignment/acceptance columns and resolve_payout_rate().
--
-- Additive only. Follows LEAP new-object conventions. See
-- docs/leap-service-provider-portal.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Payout price books (state-specific + per-provider override)
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.seq_sp_payout_price_books;
CREATE SEQUENCE IF NOT EXISTS public.seq_sp_payout_price_book_entries;
GRANT USAGE ON SEQUENCE public.seq_sp_payout_price_books        TO authenticated, service_role;
GRANT USAGE ON SEQUENCE public.seq_sp_payout_price_book_entries TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.sp_payout_price_books (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sppb_record_number              text NOT NULL DEFAULT '',
  sppb_name                       text NOT NULL DEFAULT '',
  sppb_state                      text NOT NULL,                 -- 'NC','WI',...
  sppb_service_provider_account_id uuid REFERENCES public.accounts(id), -- null = state standard book
  sppb_is_standard                boolean NOT NULL DEFAULT false, -- the state's default book
  sppb_is_active                  boolean NOT NULL DEFAULT true,
  sppb_effective_date             date,
  sppb_description                text,
  sppb_owner                      uuid NOT NULL REFERENCES public.users(id),
  sppb_created_by                 uuid REFERENCES public.users(id),
  sppb_created_at                 timestamptz NOT NULL DEFAULT now(),
  sppb_updated_by                 uuid REFERENCES public.users(id),
  sppb_updated_at                 timestamptz NOT NULL DEFAULT now(),
  sppb_is_deleted                 boolean NOT NULL DEFAULT false,
  sppb_deleted_at                 timestamptz,
  sppb_deleted_by                 uuid REFERENCES public.users(id),
  sppb_deletion_reason            text,
  is_seed_data                    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_sppb_state    ON public.sp_payout_price_books (sppb_state);
CREATE INDEX IF NOT EXISTS idx_sppb_provider ON public.sp_payout_price_books (sppb_service_provider_account_id);

CREATE TABLE IF NOT EXISTS public.sp_payout_price_book_entries (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sppe_record_number       text NOT NULL DEFAULT '',
  sppe_name                text NOT NULL DEFAULT '',
  sppe_price_book_id        uuid NOT NULL REFERENCES public.sp_payout_price_books(id),
  sppe_product_id          uuid REFERENCES public.products(id),
  sppe_measure_label       text,                                 -- for non-catalog measures
  sppe_payout_unit_rate    numeric(16,2) NOT NULL,
  sppe_uom                 text,
  sppe_is_active           boolean NOT NULL DEFAULT true,
  sppe_owner               uuid NOT NULL REFERENCES public.users(id),
  sppe_created_by          uuid REFERENCES public.users(id),
  sppe_created_at          timestamptz NOT NULL DEFAULT now(),
  sppe_updated_by          uuid REFERENCES public.users(id),
  sppe_updated_at          timestamptz NOT NULL DEFAULT now(),
  sppe_is_deleted          boolean NOT NULL DEFAULT false,
  sppe_deleted_at          timestamptz,
  sppe_deleted_by          uuid REFERENCES public.users(id),
  sppe_deletion_reason     text,
  is_seed_data             boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_sppe_book    ON public.sp_payout_price_book_entries (sppe_price_book_id);
CREATE INDEX IF NOT EXISTS idx_sppe_product ON public.sp_payout_price_book_entries (sppe_product_id);

-- ----------------------------------------------------------------------------
-- 2. Proposals (header + priced lines)
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.seq_service_provider_proposals;
CREATE SEQUENCE IF NOT EXISTS public.seq_service_provider_proposal_lines;
GRANT USAGE ON SEQUENCE public.seq_service_provider_proposals       TO authenticated, service_role;
GRANT USAGE ON SEQUENCE public.seq_service_provider_proposal_lines  TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.service_provider_proposals (
  id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spro_record_number               text NOT NULL DEFAULT '',
  spro_name                        text NOT NULL DEFAULT '',
  spro_service_provider_account_id uuid NOT NULL REFERENCES public.accounts(id),
  spro_project_id                  uuid REFERENCES public.projects(id),     -- grouping ("project proposal")
  spro_property_id                 uuid REFERENCES public.properties(id),
  spro_state                       text,
  spro_status                      uuid REFERENCES public.picklist_values(id),
  spro_version                     integer NOT NULL DEFAULT 1,
  spro_supersedes_proposal_id      uuid REFERENCES public.service_provider_proposals(id),
  spro_total_amount                numeric(16,2) NOT NULL DEFAULT 0,
  spro_issued_by                   uuid REFERENCES public.users(id),
  spro_issued_at                   timestamptz,
  spro_responded_at                timestamptz,
  spro_declined_reason             text,
  spro_notes                       text,
  spro_owner                       uuid NOT NULL REFERENCES public.users(id),
  spro_created_by                  uuid REFERENCES public.users(id),
  spro_created_at                  timestamptz NOT NULL DEFAULT now(),
  spro_updated_by                  uuid REFERENCES public.users(id),
  spro_updated_at                  timestamptz NOT NULL DEFAULT now(),
  spro_is_deleted                  boolean NOT NULL DEFAULT false,
  spro_deleted_at                  timestamptz,
  spro_deleted_by                  uuid REFERENCES public.users(id),
  spro_deletion_reason             text,
  is_seed_data                     boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_spro_provider ON public.service_provider_proposals (spro_service_provider_account_id);
CREATE INDEX IF NOT EXISTS idx_spro_project  ON public.service_provider_proposals (spro_project_id);
CREATE INDEX IF NOT EXISTS idx_spro_status   ON public.service_provider_proposals (spro_status);

CREATE TABLE IF NOT EXISTS public.service_provider_proposal_lines (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprl_record_number       text NOT NULL DEFAULT '',
  sprl_name                text NOT NULL DEFAULT '',
  sprl_proposal_id         uuid NOT NULL REFERENCES public.service_provider_proposals(id),
  sprl_work_order_id       uuid REFERENCES public.work_orders(id),
  sprl_product_id          uuid REFERENCES public.products(id),
  sprl_price_book_entry_id uuid REFERENCES public.sp_payout_price_book_entries(id),
  sprl_measure_description text,
  sprl_quantity            numeric(10,2) NOT NULL DEFAULT 1,
  sprl_payout_unit_rate    numeric(16,2) NOT NULL DEFAULT 0,
  sprl_amount              numeric(16,2) NOT NULL DEFAULT 0,
  sprl_sort_order          integer,
  sprl_owner               uuid NOT NULL REFERENCES public.users(id),
  sprl_created_by          uuid REFERENCES public.users(id),
  sprl_created_at          timestamptz NOT NULL DEFAULT now(),
  sprl_updated_by          uuid REFERENCES public.users(id),
  sprl_updated_at          timestamptz NOT NULL DEFAULT now(),
  sprl_is_deleted          boolean NOT NULL DEFAULT false,
  sprl_deleted_at          timestamptz,
  sprl_deleted_by          uuid REFERENCES public.users(id),
  sprl_deletion_reason     text,
  is_seed_data             boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_sprl_proposal   ON public.service_provider_proposal_lines (sprl_proposal_id);
CREATE INDEX IF NOT EXISTS idx_sprl_work_order ON public.service_provider_proposal_lines (sprl_work_order_id);

-- ----------------------------------------------------------------------------
-- 3. Invoices (header + lines) + payments  — the portal payment section
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.seq_service_provider_invoices;
CREATE SEQUENCE IF NOT EXISTS public.seq_service_provider_invoice_line_items;
CREATE SEQUENCE IF NOT EXISTS public.seq_service_provider_payments;
GRANT USAGE ON SEQUENCE public.seq_service_provider_invoices           TO authenticated, service_role;
GRANT USAGE ON SEQUENCE public.seq_service_provider_invoice_line_items TO authenticated, service_role;
GRANT USAGE ON SEQUENCE public.seq_service_provider_payments           TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.service_provider_invoices (
  id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spi_record_number                text NOT NULL DEFAULT '',
  spi_name                         text NOT NULL DEFAULT '',
  spi_service_provider_account_id  uuid NOT NULL REFERENCES public.accounts(id),
  spi_proposal_id                  uuid REFERENCES public.service_provider_proposals(id),
  spi_project_id                   uuid REFERENCES public.projects(id),
  spi_status                       uuid REFERENCES public.picklist_values(id),
  spi_total_amount                 numeric(16,2) NOT NULL DEFAULT 0,
  spi_amount_paid                  numeric(16,2) NOT NULL DEFAULT 0,
  spi_invoice_date                 date,
  spi_due_date                     date,
  spi_approved_by                  uuid REFERENCES public.users(id),
  spi_approved_at                  timestamptz,
  spi_rejected_reason              text,
  spi_notes                        text,
  spi_owner                        uuid NOT NULL REFERENCES public.users(id),
  spi_created_by                   uuid REFERENCES public.users(id),
  spi_created_at                   timestamptz NOT NULL DEFAULT now(),
  spi_updated_by                   uuid REFERENCES public.users(id),
  spi_updated_at                   timestamptz NOT NULL DEFAULT now(),
  spi_is_deleted                   boolean NOT NULL DEFAULT false,
  spi_deleted_at                   timestamptz,
  spi_deleted_by                   uuid REFERENCES public.users(id),
  spi_deletion_reason              text,
  is_seed_data                     boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_spi_provider ON public.service_provider_invoices (spi_service_provider_account_id);
CREATE INDEX IF NOT EXISTS idx_spi_proposal ON public.service_provider_invoices (spi_proposal_id);
CREATE INDEX IF NOT EXISTS idx_spi_status   ON public.service_provider_invoices (spi_status);

CREATE TABLE IF NOT EXISTS public.service_provider_invoice_line_items (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spil_record_number       text NOT NULL DEFAULT '',
  spil_name                text NOT NULL DEFAULT '',
  spil_invoice_id          uuid NOT NULL REFERENCES public.service_provider_invoices(id),
  spil_work_order_id       uuid REFERENCES public.work_orders(id),
  spil_proposal_line_id    uuid REFERENCES public.service_provider_proposal_lines(id),
  spil_product_id          uuid REFERENCES public.products(id),
  spil_description         text,
  spil_quantity            numeric(10,2) NOT NULL DEFAULT 1,
  spil_unit_rate           numeric(16,2) NOT NULL DEFAULT 0,
  spil_amount              numeric(16,2) NOT NULL DEFAULT 0,
  spil_sort_order          integer,
  spil_owner               uuid NOT NULL REFERENCES public.users(id),
  spil_created_by          uuid REFERENCES public.users(id),
  spil_created_at          timestamptz NOT NULL DEFAULT now(),
  spil_updated_by          uuid REFERENCES public.users(id),
  spil_updated_at          timestamptz NOT NULL DEFAULT now(),
  spil_is_deleted          boolean NOT NULL DEFAULT false,
  spil_deleted_at          timestamptz,
  spil_deleted_by          uuid REFERENCES public.users(id),
  spil_deletion_reason     text,
  is_seed_data             boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_spil_invoice    ON public.service_provider_invoice_line_items (spil_invoice_id);
CREATE INDEX IF NOT EXISTS idx_spil_work_order ON public.service_provider_invoice_line_items (spil_work_order_id);

CREATE TABLE IF NOT EXISTS public.service_provider_payments (
  id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spp_record_number                text NOT NULL DEFAULT '',
  spp_name                         text NOT NULL DEFAULT '',
  spp_invoice_id                   uuid NOT NULL REFERENCES public.service_provider_invoices(id),
  spp_service_provider_account_id  uuid NOT NULL REFERENCES public.accounts(id),
  spp_status                       uuid REFERENCES public.picklist_values(id),
  spp_amount                       numeric(16,2) NOT NULL DEFAULT 0,
  spp_payment_date                 date,
  spp_payment_method               text,
  spp_payment_reference            text,
  spp_notes                        text,
  spp_owner                        uuid NOT NULL REFERENCES public.users(id),
  spp_created_by                   uuid REFERENCES public.users(id),
  spp_created_at                   timestamptz NOT NULL DEFAULT now(),
  spp_updated_by                   uuid REFERENCES public.users(id),
  spp_updated_at                   timestamptz NOT NULL DEFAULT now(),
  spp_is_deleted                   boolean NOT NULL DEFAULT false,
  spp_deleted_at                   timestamptz,
  spp_deleted_by                   uuid REFERENCES public.users(id),
  spp_deletion_reason              text,
  is_seed_data                     boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_spp_invoice  ON public.service_provider_payments (spp_invoice_id);
CREATE INDEX IF NOT EXISTS idx_spp_provider ON public.service_provider_payments (spp_service_provider_account_id);

-- ----------------------------------------------------------------------------
-- 4. work_orders — assignment + acceptance + agreed pricing
-- ----------------------------------------------------------------------------
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS work_order_service_provider_account_id uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS work_order_active_proposal_id          uuid REFERENCES public.service_provider_proposals(id),
  ADD COLUMN IF NOT EXISTS work_order_provider_acceptance_status  uuid REFERENCES public.picklist_values(id),
  ADD COLUMN IF NOT EXISTS work_order_provider_responded_at       timestamptz,
  ADD COLUMN IF NOT EXISTS work_order_provider_declined_reason    text,
  ADD COLUMN IF NOT EXISTS work_order_agreed_payout_amount        numeric(16,2);
CREATE INDEX IF NOT EXISTS idx_work_order_service_provider ON public.work_orders (work_order_service_provider_account_id);

-- ----------------------------------------------------------------------------
-- 5. Record-number, audit, amount-maintenance triggers
-- ----------------------------------------------------------------------------
-- record number setters (one per table)
CREATE OR REPLACE FUNCTION public.set_sppb_record_number() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN IF NEW.sppb_record_number IS NULL OR NEW.sppb_record_number = '' THEN
  NEW.sppb_record_number := public.generate_record_number('SPPB-', 'seq_sp_payout_price_books'); END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.set_sppe_record_number() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN IF NEW.sppe_record_number IS NULL OR NEW.sppe_record_number = '' THEN
  NEW.sppe_record_number := public.generate_record_number('SPPE-', 'seq_sp_payout_price_book_entries'); END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.set_spro_record_number() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN IF NEW.spro_record_number IS NULL OR NEW.spro_record_number = '' THEN
  NEW.spro_record_number := public.generate_record_number('SPRO-', 'seq_service_provider_proposals'); END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.set_sprl_record_number() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN IF NEW.sprl_record_number IS NULL OR NEW.sprl_record_number = '' THEN
  NEW.sprl_record_number := public.generate_record_number('SPRL-', 'seq_service_provider_proposal_lines'); END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.set_spi_record_number() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN IF NEW.spi_record_number IS NULL OR NEW.spi_record_number = '' THEN
  NEW.spi_record_number := public.generate_record_number('SPI-', 'seq_service_provider_invoices'); END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.set_spil_record_number() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN IF NEW.spil_record_number IS NULL OR NEW.spil_record_number = '' THEN
  NEW.spil_record_number := public.generate_record_number('SPIL-', 'seq_service_provider_invoice_line_items'); END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.set_spp_record_number() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN IF NEW.spp_record_number IS NULL OR NEW.spp_record_number = '' THEN
  NEW.spp_record_number := public.generate_record_number('SPP-', 'seq_service_provider_payments'); END IF; RETURN NEW; END $$;

-- proposal line amount + header total
CREATE OR REPLACE FUNCTION public.set_sprl_amount() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.sprl_amount := COALESCE(NEW.sprl_quantity,0) * COALESCE(NEW.sprl_payout_unit_rate,0); RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.recompute_spro_total() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_pid uuid;
BEGIN
  v_pid := COALESCE(NEW.sprl_proposal_id, OLD.sprl_proposal_id);
  UPDATE public.service_provider_proposals p
     SET spro_total_amount = COALESCE((
       SELECT SUM(l.sprl_amount) FROM public.service_provider_proposal_lines l
        WHERE l.sprl_proposal_id = v_pid AND l.sprl_is_deleted IS NOT TRUE), 0)
   WHERE p.id = v_pid;
  RETURN COALESCE(NEW, OLD);
END $$;

-- invoice line amount + header total
CREATE OR REPLACE FUNCTION public.set_spil_amount() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.spil_amount := COALESCE(NEW.spil_quantity,0) * COALESCE(NEW.spil_unit_rate,0); RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.recompute_spi_total() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_iid uuid;
BEGIN
  v_iid := COALESCE(NEW.spil_invoice_id, OLD.spil_invoice_id);
  UPDATE public.service_provider_invoices i
     SET spi_total_amount = COALESCE((
       SELECT SUM(l.spil_amount) FROM public.service_provider_invoice_line_items l
        WHERE l.spil_invoice_id = v_iid AND l.spil_is_deleted IS NOT TRUE), 0)
   WHERE i.id = v_iid;
  RETURN COALESCE(NEW, OLD);
END $$;

-- attach triggers (record number + audit + no-hard-delete) per table
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('sp_payout_price_books','sppb'),
    ('sp_payout_price_book_entries','sppe'),
    ('service_provider_proposals','spro'),
    ('service_provider_proposal_lines','sprl'),
    ('service_provider_invoices','spi'),
    ('service_provider_invoice_line_items','spil'),
    ('service_provider_payments','spp')
  ) AS x(tbl, pfx) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_rn ON public.%I', t.tbl, t.tbl);
    EXECUTE format('CREATE TRIGGER trg_%s_rn BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_%s_record_number()', t.tbl, t.tbl, t.pfx);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%s ON public.%I', t.tbl, t.tbl);
    EXECUTE format('CREATE TRIGGER trg_audit_%s AFTER INSERT OR DELETE OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history()', t.tbl, t.tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_no_hard_delete ON public.%I', t.tbl, t.tbl);
    EXECUTE format('CREATE TRIGGER trg_%s_no_hard_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION block_hard_delete()', t.tbl, t.tbl);
  END LOOP;
END $$;

-- amount maintenance triggers
DROP TRIGGER IF EXISTS trg_sprl_amount ON public.service_provider_proposal_lines;
CREATE TRIGGER trg_sprl_amount BEFORE INSERT OR UPDATE ON public.service_provider_proposal_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_sprl_amount();
DROP TRIGGER IF EXISTS trg_sprl_recompute ON public.service_provider_proposal_lines;
CREATE TRIGGER trg_sprl_recompute AFTER INSERT OR UPDATE OR DELETE ON public.service_provider_proposal_lines
  FOR EACH ROW EXECUTE FUNCTION public.recompute_spro_total();
DROP TRIGGER IF EXISTS trg_spil_amount ON public.service_provider_invoice_line_items;
CREATE TRIGGER trg_spil_amount BEFORE INSERT OR UPDATE ON public.service_provider_invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.set_spil_amount();
DROP TRIGGER IF EXISTS trg_spil_recompute ON public.service_provider_invoice_line_items;
CREATE TRIGGER trg_spil_recompute AFTER INSERT OR UPDATE OR DELETE ON public.service_provider_invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.recompute_spi_total();

-- ----------------------------------------------------------------------------
-- 6. Picklists (statuses)
-- ----------------------------------------------------------------------------
INSERT INTO public.picklist_values (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order)
SELECT gen_random_uuid(), v.obj, v.fld, v.val, v.val, true, v.ord
FROM (VALUES
  ('work_orders','provider_acceptance_status','Work Order Issued to Provider',   10),
  ('work_orders','provider_acceptance_status','Work Order Accepted by Provider', 20),
  ('work_orders','provider_acceptance_status','Work Order Declined by Provider', 30),
  ('service_provider_proposals','status','Proposal Issued',     10),
  ('service_provider_proposals','status','Proposal Accepted',   20),
  ('service_provider_proposals','status','Proposal Declined',   30),
  ('service_provider_proposals','status','Proposal Revised',    40),
  ('service_provider_proposals','status','Proposal Superseded', 50),
  ('service_provider_invoices','status','Invoice Draft',            10),
  ('service_provider_invoices','status','Invoice Pending Approval',  20),
  ('service_provider_invoices','status','Invoice Approved',          30),
  ('service_provider_invoices','status','Invoice Paid',              40),
  ('service_provider_invoices','status','Invoice Rejected',          50),
  ('service_provider_invoices','status','Invoice Void',              60),
  ('service_provider_payments','status','Payment Scheduled', 10),
  ('service_provider_payments','status','Payment Sent',      20),
  ('service_provider_payments','status','Payment Cleared',   30),
  ('service_provider_payments','status','Payment Failed',    40)
) AS v(obj,fld,val,ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object=v.obj AND p.picklist_field=v.fld AND p.picklist_value=v.val
);

-- ----------------------------------------------------------------------------
-- 7. RLS + grants + role access (mirror accounts for internal staff)
-- ----------------------------------------------------------------------------
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'sp_payout_price_books','sp_payout_price_book_entries',
    'service_provider_proposals','service_provider_proposal_lines',
    'service_provider_invoices','service_provider_invoice_line_items',
    'service_provider_payments'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS app_select_%s ON public.%I', tbl, tbl);
    EXECUTE format('CREATE POLICY app_select_%s ON public.%I FOR SELECT TO authenticated USING ((SELECT app_user_can(%L,''read'')))', tbl, tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS app_insert_%s ON public.%I', tbl, tbl);
    EXECUTE format('CREATE POLICY app_insert_%s ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT app_user_can(%L,''create'')))', tbl, tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS app_update_%s ON public.%I', tbl, tbl);
    EXECUTE format('CREATE POLICY app_update_%s ON public.%I FOR UPDATE TO authenticated USING ((SELECT app_user_can(%L,''update''))) WITH CHECK ((SELECT app_user_can(%L,''update'')))', tbl, tbl, tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS app_delete_%s ON public.%I', tbl, tbl);
    EXECUTE format('CREATE POLICY app_delete_%s ON public.%I FOR DELETE TO authenticated USING ((SELECT app_user_can(%L,''delete'')))', tbl, tbl, tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', tbl);
  END LOOP;
END $$;

INSERT INTO public.role_object_access (id, roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
SELECT gen_random_uuid(), roa.roa_role_id, obj.new_object, roa.roa_read, roa.roa_create, roa.roa_update, false
FROM public.role_object_access roa
JOIN public.roles r ON r.id = roa.roa_role_id
CROSS JOIN (VALUES
  ('sp_payout_price_books'),('sp_payout_price_book_entries'),
  ('service_provider_proposals'),('service_provider_proposal_lines'),
  ('service_provider_invoices'),('service_provider_invoice_line_items'),
  ('service_provider_payments')
) AS obj(new_object)
WHERE roa.roa_object_name = 'accounts'
  AND r.role_name NOT IN ('Property Owner', 'Property Manager', 'Service Provider Partner')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_object_access x
    WHERE x.roa_role_id = roa.roa_role_id AND x.roa_object_name = obj.new_object
  );

-- ----------------------------------------------------------------------------
-- 8. resolve_payout_rate(provider, state, product)
--    Provider-specific active book entry first, else state standard book.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_payout_rate(
  p_provider_account_id uuid, p_state text, p_product_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT e.sppe_payout_unit_rate
  FROM public.sp_payout_price_book_entries e
  JOIN public.sp_payout_price_books b ON b.id = e.sppe_price_book_id
  WHERE e.sppe_is_deleted IS NOT TRUE AND e.sppe_is_active IS TRUE
    AND b.sppb_is_deleted IS NOT TRUE AND b.sppb_is_active IS TRUE
    AND b.sppb_state = p_state
    AND e.sppe_product_id = p_product_id
    AND (
      b.sppb_service_provider_account_id = p_provider_account_id
      OR (b.sppb_service_provider_account_id IS NULL AND b.sppb_is_standard IS TRUE)
    )
  ORDER BY (b.sppb_service_provider_account_id = p_provider_account_id) DESC,  -- provider override wins
           b.sppb_effective_date DESC NULLS LAST
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.resolve_payout_rate(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_payout_rate(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_payout_rate(uuid, text, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
