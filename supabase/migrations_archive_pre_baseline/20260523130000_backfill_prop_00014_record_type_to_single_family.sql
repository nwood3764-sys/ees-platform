-- ============================================================================
-- backfill_prop_00014_record_type_to_single_family
--
-- PROP-00014 "789 Cascade Ave" (WI) had property_record_type IS NULL, which
-- broke the RecordDetail page layout resolver and produced the user-facing
-- error "This record can't be displayed right now. The default page layout
-- for this object is missing." Patched in production on 2026-05-23 during
-- the send-email-v1 unblock session because this property was the test
-- target for the WI mailbox send test (PROJ-00009 → PROP-00014).
--
-- Setting record_type to Single_Family based on the property being a single
-- street address with no Buildings/Units in the hierarchy.
--
-- The systemic NULL-record_type problem (2 other properties + an unknown
-- number across other objects) remains open as a TASKS.md follow-on. This
-- migration only covers the one record needed for the email test today.
-- ============================================================================
UPDATE properties
   SET property_record_type = (
     SELECT id FROM picklist_values
      WHERE picklist_object = 'properties'
        AND picklist_field  = 'record_type'
        AND picklist_value  = 'Single_Family'
      LIMIT 1
   ),
   property_updated_at = now()
 WHERE id = '36a0b58b-5936-4660-91cd-45e152a89846'
   AND property_record_type IS NULL;
