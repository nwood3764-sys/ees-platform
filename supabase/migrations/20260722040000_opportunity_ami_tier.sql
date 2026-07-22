-- AMI Tier on the opportunity. Single-family HOMES reimbursement (and therefore
-- which price book applies) is driven by the household's Area Median Income
-- band: < 80% AMI vs 80–150% AMI carry different HOMES incentive schedules.
-- Staff need this visible on the opportunity to select the correct price book;
-- a later validation rule will enforce price-book-to-tier matching.
--
-- Data-driven, admin-manageable: the tier is a uuid FK to picklist_values
-- (same pattern as opportunity_record_type), not a hardcoded enum.

-- 1. Column (uuid FK to picklist_values, nullable — staff set it during review).
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS opportunity_ami_tier uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'opportunities_ami_tier_fkey'
      AND table_name = 'opportunities'
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_ami_tier_fkey
      FOREIGN KEY (opportunity_ami_tier) REFERENCES public.picklist_values(id);
  END IF;
END $$;

COMMENT ON COLUMN public.opportunities.opportunity_ami_tier IS
  'Household Area Median Income band (FK to picklist_values, field opportunity_ami_tier). Drives which HOMES price book applies for single-family opportunities.';

-- 2. Picklist values (global — HOMES AMI bands are federal, not state-specific).
INSERT INTO public.picklist_values
  (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_at, picklist_created_by, picklist_state, picklist_description, picklist_show_in_path)
VALUES
  (gen_random_uuid(), 'opportunities', 'opportunity_ami_tier', 'Not Yet Determined',        'Not Yet Determined',        true, 1, now(), 'c5a01ec8-960f-42ab-8a9e-a49822de89af', NULL, 'Income qualification not yet established.', false),
  (gen_random_uuid(), 'opportunities', 'opportunity_ami_tier', '< 80% AMI',                 '< 80% AMI',                 true, 2, now(), 'c5a01ec8-960f-42ab-8a9e-a49822de89af', NULL, 'Household income below 80% of Area Median Income — higher HOMES incentive tier.', false),
  (gen_random_uuid(), 'opportunities', 'opportunity_ami_tier', '80–150% AMI',               '80–150% AMI',               true, 3, now(), 'c5a01ec8-960f-42ab-8a9e-a49822de89af', NULL, 'Household income between 80% and 150% of Area Median Income — standard HOMES incentive tier.', false),
  (gen_random_uuid(), 'opportunities', 'opportunity_ami_tier', '> 150% AMI (Not Eligible)', '> 150% AMI (Not Eligible)', true, 4, now(), 'c5a01ec8-960f-42ab-8a9e-a49822de89af', NULL, 'Household income above 150% of Area Median Income — not eligible for HOMES incentives.', false)
ON CONFLICT DO NOTHING;

-- 3. Place the field on the default Opportunity Layout, in the Opportunity
--    Information field group, right after Amount.
UPDATE public.page_layout_widgets
   SET widget_config = jsonb_set(
         widget_config,
         '{fields}',
         (widget_config->'fields')
           || '[{"name":"opportunity_ami_tier","type":"picklist","label":"AMI Tier","column":2}]'::jsonb
       ),
       updated_at = now()
 WHERE id = '9f74307d-4c62-4549-a090-d31b77a16973'
   AND NOT (widget_config->'fields' @> '[{"name":"opportunity_ami_tier"}]'::jsonb);
