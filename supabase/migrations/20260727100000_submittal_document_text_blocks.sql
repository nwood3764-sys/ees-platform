-- ===========================================================================
-- Submittal Document Text Blocks
--
-- The wording that appears on program submittal documents (measure
-- descriptions, acknowledgment paragraphs, footer lines, document titles) is
-- contractual program language, not application logic. It was hardcoded in
-- src/data/paperworkModel.js; this moves it into the database so it is
-- editable through LEAP Admin without a deploy.
--
-- What stays in code: the program MATH (HOMES tier, Focus on Energy rate
-- bands, breakout fractions, the rounding reconciliation that forces
-- TOTAL DUE to $0.00) and the vector layout engine. Those are business rules
-- and pixel geometry, not content.
--
-- Scoping: each block is keyed by a stable `sdtb_key` and optionally scoped to
-- one opportunity record type (= the program). A row with a NULL record type
-- is the default used by every program; a row carrying a record type overrides
-- the default for that program only. This is what makes "build it out record
-- type by record type" a data edit.
--
-- Tokens: bodies may contain {{baseline_r}} and {{improved_r}}, substituted at
-- render time from the Asset Score reports.
-- ===========================================================================

CREATE SEQUENCE IF NOT EXISTS seq_submittal_document_text_blocks;

CREATE TABLE public.submittal_document_text_blocks (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sdtb_record_number              text NOT NULL,
  sdtb_name                       text NOT NULL,
  sdtb_key                        text NOT NULL,
  sdtb_body                       text NOT NULL,
  -- NULL = the default for every program; set = overrides for that program.
  sdtb_opportunity_record_type    uuid REFERENCES picklist_values(id),
  sdtb_sort_order                 integer NOT NULL DEFAULT 100,
  sdtb_is_active                  boolean NOT NULL DEFAULT true,
  sdtb_notes                      text,
  sdtb_owner                      uuid NOT NULL REFERENCES users(id),
  sdtb_created_by                 uuid NOT NULL REFERENCES users(id),
  sdtb_created_at                 timestamptz NOT NULL DEFAULT now(),
  sdtb_updated_by                 uuid REFERENCES users(id),
  sdtb_updated_at                 timestamptz,
  sdtb_is_deleted                 boolean NOT NULL DEFAULT false,
  sdtb_deleted_at                 timestamptz,
  sdtb_deleted_by                 uuid REFERENCES users(id),
  sdtb_deletion_reason            text,
  is_seed_data                    boolean NOT NULL DEFAULT false
);

-- One block per key per program (and one global default per key).
CREATE UNIQUE INDEX uq_sdtb_key_record_type
  ON public.submittal_document_text_blocks (sdtb_key, sdtb_opportunity_record_type)
  WHERE sdtb_is_deleted = false AND sdtb_opportunity_record_type IS NOT NULL;
CREATE UNIQUE INDEX uq_sdtb_key_default
  ON public.submittal_document_text_blocks (sdtb_key)
  WHERE sdtb_is_deleted = false AND sdtb_opportunity_record_type IS NULL;
CREATE INDEX idx_sdtb_record_type
  ON public.submittal_document_text_blocks (sdtb_opportunity_record_type)
  WHERE sdtb_is_deleted = false;

CREATE OR REPLACE FUNCTION public.set_sdtb_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $fn$
BEGIN
  NEW.sdtb_record_number := generate_record_number('SDTB-', 'seq_submittal_document_text_blocks');
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_sdtb_rn BEFORE INSERT ON public.submittal_document_text_blocks
  FOR EACH ROW EXECUTE FUNCTION set_sdtb_record_number();
CREATE TRIGGER trg_audit_sdtb AFTER INSERT OR UPDATE OR DELETE ON public.submittal_document_text_blocks
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_sdtb_no_hard_delete BEFORE DELETE ON public.submittal_document_text_blocks
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

ALTER TABLE public.submittal_document_text_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY sdtb_select ON public.submittal_document_text_blocks
  FOR SELECT TO authenticated USING (true);
CREATE POLICY sdtb_insert ON public.submittal_document_text_blocks
  FOR INSERT TO authenticated WITH CHECK (app_user_can('submittal_document_text_blocks','create'));
CREATE POLICY sdtb_update ON public.submittal_document_text_blocks
  FOR UPDATE TO authenticated USING (app_user_can('submittal_document_text_blocks','update'))
  WITH CHECK (app_user_can('submittal_document_text_blocks','update'));
CREATE POLICY sdtb_delete ON public.submittal_document_text_blocks
  FOR DELETE TO authenticated USING (app_user_can('submittal_document_text_blocks','delete'));

-- ---------------------------------------------------------------------------
-- Seed: the current wording, lifted verbatim from paperworkModel.js, as the
-- global defaults (no record type). Programs override by adding a scoped row.
-- ---------------------------------------------------------------------------
INSERT INTO public.submittal_document_text_blocks
  (sdtb_record_number, sdtb_name, sdtb_key, sdtb_body, sdtb_sort_order,
   sdtb_owner, sdtb_created_by, is_seed_data)
SELECT '', v.name, v.key, v.body, v.sort_order, u.id, u.id, true
FROM (SELECT id FROM public.users
      WHERE user_is_deleted IS NOT TRUE
      ORDER BY (user_email = 'nicholas.wood@ees-wi.org') DESC, user_created_at
      LIMIT 1) u
CROSS JOIN (VALUES
  ('Measure Description — Attic Insulation', 'measure.attic_insulation', 10,
$b$Upgrade existing attic insulation levels from approximately R-{{baseline_r}} to R-{{improved_r}} in accordance with applicable PNNL building science standards and program requirements to improve thermal performance, reduce energy consumption, and enhance occupant comfort. Work will include preparation of attic areas to support proper airflow, insulation depth consistency, and long-term system performance.

Install eave baffles with 48-inch extensions in each accessible attic bay to maintain ventilation pathways and allow full insulation coverage above exterior wall top plates.

Install insulation rulers in each attic bay on both sides to verify uniform insulation depth and ensure consistent installed R-values throughout the attic plane.

Install blown-in fiberglass insulation to achieve a minimum final attic insulation value of R-{{improved_r}} across all accessible attic areas.

Custom build and install insulated attic access hatches including insulation damming, insulated access covers, and weatherstripping to minimize thermal bypass and air leakage.

All insulation materials and installation methods will comply with applicable code requirements, manufacturer specifications, and accepted energy efficiency best practices.$b$),

  ('Measure Description — Attic Air Sealing', 'measure.attic_air_sealing', 20,
$b$Perform attic air sealing to reduce uncontrolled air leakage between conditioned spaces and unconditioned attic areas in accordance with PNNL air barrier and weatherization best practices. Removal and disposal of existing R-{{baseline_r}} insulation material will prepare the attic space for proper air sealing. Air sealing work will be completed prior to insulation installation to maximize thermal effectiveness and moisture control performance.

Scope of work includes identification and sealing of accessible air leakage pathways including, but not limited to:

Plumbing penetrations
Electrical penetrations
Top plates
Mechanical and duct penetrations
Soffits and open chases
Attic access openings
Miscellaneous bypasses and framing gaps
Fabricated isolation boxes for exhaust fans and recessed lights

Approved sealants, foam products, sheet materials, and weatherstripping will be utilized as appropriate for each application to improve building envelope tightness, reduce heating and cooling loads, and improve overall occupant comfort and building durability.$b$),

  ('Measure Description — Bath Aerators', 'measure.bath_aerators', 30,
$b$Installation of low flow faucet aerators in tenant bathrooms for water and energy savings. Model: Niagara 0.5 GPM Aerator N3205N$b$),

  ('Measure Description — Kitchen Aerators', 'measure.kitchen_aerators', 40,
$b$Installation of low flow faucet aerators in tenant kitchens for water and energy savings. Model: Niagara 0.5 GPM Aerator N3205N$b$),

  ('Measure Description — Showerheads', 'measure.showerheads', 50,
$b$Installation of low flow handheld showerheads in tenant bathrooms for water and energy savings. Model: Niagara Earth Handheld Showerhead N2945CH$b$),

  ('Acknowledgment — Invoice', 'acknowledgment.invoice', 60,
$b$Receipt of this invoice constitutes acknowledgment of the services delivered. The property owner confirms the work performed and authorizes EES-WI to submit for and receive the corresponding program incentive on their behalf.$b$),

  ('Acknowledgment — Proposal', 'acknowledgment.proposal', 70,
$b$Signed receipt of this proposal constitutes acceptance of the proposed scope of work. The property owner authorizes EES-WI to submit the project for rebate/incentive program preapproval and to begin project planning activities.$b$),

  ('Proposal Title', 'title.proposal', 80,
$b$Wisconsin Inflation Reduction Act HOMES Program Project Proposal$b$),

  ('Company Header Name', 'header.company_name', 90,
$b$ENERGY EFFICIENCY SERVICES of WISCONSIN$b$),

  ('Footer — Company Address Line', 'footer.company_line', 100,
$b$Energy Efficiency Services of Wisconsin  |  112 Owen Rd. PO Box 6141, Monona, WI 53716$b$),

  ('Footer — Contact Line', 'footer.contact_line', 110,
$b$ira@ees-wi.org  |  608-460-7419$b$)
) AS v(name, key, sort_order, body);

NOTIFY pgrst, 'reload schema';
