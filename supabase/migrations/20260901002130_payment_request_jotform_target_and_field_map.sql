-- The Project Payment Request Jotform, declared like the other two forms.
--
-- Provider 'jotform', not formstack: the prefill convention is ?q65_doesThe65=
-- rather than ?field188466720=, which is a difference in the stored param names
-- only. The query-string builder is unchanged.
--
-- Mapped: exactly the fields LEAP already populates, and nothing else. The form
-- also carries Focus On Energy's own processing fields (PM Review Approver,
-- SPECTRUM numbers, Exception Messages) which are theirs to fill, not ours.
--
-- Every option value was read from the form itself and matches LEAP's picklist
-- values character for character -- Passed/Warning/Failed/N/A, the lower-case
-- yes/no on ASHRAE 62.2, Energy Plus, Registered Contractor, S Corporation --
-- so NOT ONE field needs an option_value_map. That is also an independent check
-- on the defaults set earlier: they are the form's own vocabulary.

WITH me AS (SELECT id FROM public.users WHERE id = 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
ins AS (
  INSERT INTO public.external_form_targets
    (eft_record_number, eft_key, eft_name, eft_base_url, eft_form_provider, eft_external_form_id,
     eft_object, eft_record_type, eft_submit_note, eft_owner, eft_created_by)
  SELECT '', 'wi_ira_mf_homes_project_payment_request',
         'Focus On Energy - IRA HOMES Multifamily Project Submittal Form',
         'https://focusonenergy.jotform.com/250306438751960',
         'jotform', '250306438751960',
         'incentive_applications',
         public.picklist_id_for_value('incentive_applications','record_type','WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST'),
         'Attach the supporting documents on the form itself, review every field, then submit.',
         me.id, me.id
  FROM me
  WHERE NOT EXISTS (SELECT 1 FROM public.external_form_targets
                     WHERE eft_key = 'wi_ira_mf_homes_project_payment_request'
                       AND eft_is_deleted IS NOT TRUE)
  RETURNING id
),
tgt AS (
  SELECT id FROM ins
  UNION ALL
  SELECT id FROM public.external_form_targets
   WHERE eft_key='wi_ira_mf_homes_project_payment_request' AND eft_is_deleted IS NOT TRUE
  LIMIT 1
)
INSERT INTO public.external_form_field_map
  (efm_record_number, efm_target_id, efm_leap_field, efm_external_param,
   efm_field_label, efm_is_required, efm_sort_order, efm_owner, efm_created_by)
SELECT '', tgt.id, m.leap, m.param, m.label, m.req, m.ord, u.id, u.id
FROM tgt, (SELECT id FROM public.users WHERE id='c5a01ec8-960f-42ab-8a9e-a49822de89af') u,
(VALUES
  ('ia_application_for',                 'q61_imApplying',                  'I''m Applying for a(n)',              true,  10),
  ('ia_building_type',                   'q255_buildingType255',            'Building Type',                       true,  20),
  ('ia_building_project_type',           'q261_buildingProject261',         'Building Project Type',               true,  30),
  ('contractor_business_name',           'q28_primaryContractor28',         'Primary Contractor Business Name',    true,  40),
  ('contractor_contact_first_name',      'q80_primaryContractor[first]',    'Primary Contractor First Name',       true,  50),
  ('contractor_contact_last_name',       'q80_primaryContractor[last]',     'Primary Contractor Last Name',        true,  60),
  ('contractor_email',                   'q45_email45',                     'Primary Contractor Email',            true,  70),
  ('contractor_phone',                   'q46_phoneNumber46[full]',         'Primary Contractor Phone Number',     true,  80),
  ('contractor_street',                  'q116_primaryContractor116[addr_line1]', 'Primary Contractor Address',    true,  90),
  ('contractor_city',                    'q116_primaryContractor116[city]', 'Primary Contractor City',             true,  100),
  ('contractor_state',                   'q116_primaryContractor116[state]','Primary Contractor State',            true,  110),
  ('contractor_zip',                     'q116_primaryContractor116[postal]','Primary Contractor ZIP',             true,  120),
  ('has_support_contractor',             'q78_willA78',                     'Will a Support Contractor work on this project?', true, 130),
  ('business_entity_name',               'q268_businessEntity268',          'Business Entity Name',                true,  140),
  ('signer_contact_name',                'q269_contactName',                'Contact Name',                        true,  150),
  ('signer_contact_email',               'q198_email',                      'Email',                               true,  160),
  ('signer_contact_phone',               'q199_phoneNumber[full]',          'Phone Number',                        true,  170),
  ('installation_street',                'q10_installationAddress[addr_line1]', 'Installation Address',            true,  180),
  ('installation_city',                  'q10_installationAddress[city]',   'Installation City',                   true,  190),
  ('installation_state',                 'q10_installationAddress[state]',  'Installation State',                  true,  200),
  ('installation_zip',                   'q10_installationAddress[postal]', 'Installation ZIP',                    true,  210),
  ('ia_total_project_cost',              'q351_totalProject',               'Total Project Cost',                  true,  220),
  ('ia_who_gets_paid',                   'q280_whoGets',                    'Who gets paid?',                      true,  230),
  ('ia_tax_classification_type',         'q163_taxClassification',          'Tax Classification',                  true,  240),
  ('ia_tax_identification_fein',         'q118_taxIdentification',          'Tax Identification FEIN',             true,  250),
  ('payment_mailing_street',             'q264_mailingAddress264[addr_line1]', 'Mailing Address',                  true,  260),
  ('payment_mailing_city',               'q264_mailingAddress264[city]',    'Mailing City',                        true,  270),
  ('payment_mailing_state',              'q264_mailingAddress264[state]',   'Mailing State',                       true,  280),
  ('payment_mailing_zip',                'q264_mailingAddress264[postal]',  'Mailing ZIP',                         true,  290),
  ('ia_has_combustion_appliances',       'q64_doesThe',                     'Combustion appliances at test-out?',  true,  300),
  ('ia_venting_test',                    'q65_doesThe65',                   'Does the venting test pass?',         true,  310),
  ('ia_spilling_test',                   'q66_doesThe66',                   'Does the spilling test(s) pass?',     true,  320),
  ('ia_gas_leak_test',                   'q67_doesThe67',                   'Does the gas leak detection test pass?', true, 330),
  ('ia_undiluted_co_test',               'q230_doesThe230',                 'Does the undiluted CO test pass?',    true,  340),
  ('ia_ambient_co_test',                 'q68_doesThe68',                   'Does the ambient CO test pass?',      true,  350),
  ('ia_mold_moisture',                   'q69_areThere',                    'Signs of mold or moisture?',          true,  360),
  ('ia_roof_condition',                  'q70_whatIs',                      'What is the roof condition?',         true,  370),
  ('ia_ashrae_62_2',                     'q72_hasAn',                       'ASHRAE 62.2 calculation performed?',  true,  380),
  ('ia_drainage_condition',              'q71_whatIs71',                    'What is the drainage system condition?', true, 390),
  ('ia_disclosed_to_homeowner',          'q73_haveThe',                     'Disclosed to the homeowner?',         true,  400),
  ('ia_modeling_software',               'q240_modelingSoftware',           'Modeling Software Used',              false, 410)
) AS m(leap, param, label, req, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.external_form_field_map x
   WHERE x.efm_target_id = tgt.id AND x.efm_leap_field = m.leap AND x.efm_is_deleted IS NOT TRUE);

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n
  FROM public.external_form_field_map m
  JOIN public.external_form_targets t ON t.id=m.efm_target_id
  WHERE t.eft_key='wi_ira_mf_homes_project_payment_request' AND m.efm_is_deleted IS NOT TRUE;
  IF v_n <> 41 THEN
    RAISE EXCEPTION 'Expected 41 mapped fields, found %', v_n;
  END IF;
END $$;
