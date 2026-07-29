-- Clean opportunity_stage display LABELS to generic stage names.
--
-- The never-shared model stays exactly as-is: each record type keeps its OWN
-- stage value row (167 scoped 1:1, 0 shared), so a record type's stages remain
-- independently editable. Only the DISPLAY LABEL changes — the program context
-- (HOMES/HEAR) belongs to the record type, not the stage name. The stored
-- value (the unique technical key per record type) and every opportunity
-- record (which references by UUID) are untouched.
--
--   "HOMES Income Qualification" / "HEAR Income Qualification" → "Income Qualification"
--   "Opportunity Closed Won"  → "Closed Won"
--   "Opportunity Closed Lost" → "Closed Lost"
--
-- Duplicate labels across record types are fine now: the editor shows one
-- record type's stages at a time, so the copies never appear side by side.

UPDATE public.picklist_values
   SET picklist_label = regexp_replace(picklist_label, '^(HOMES|HEAR) ', '')
 WHERE picklist_object = 'opportunities'
   AND picklist_field  = 'opportunity_stage'
   AND picklist_label ~ '^(HOMES|HEAR) ';

UPDATE public.picklist_values SET picklist_label = 'Closed Won'
 WHERE picklist_object='opportunities' AND picklist_field='opportunity_stage' AND picklist_label='Opportunity Closed Won';

UPDATE public.picklist_values SET picklist_label = 'Closed Lost'
 WHERE picklist_object='opportunities' AND picklist_field='opportunity_stage' AND picklist_label='Opportunity Closed Lost';
