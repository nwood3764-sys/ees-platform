-- Wire the photo-prompt illustrations for the exterior/room assessment sections.
-- Screen-flow photo fields use wstf_illustration_url; the simple photo/video
-- steps (Front Door, Thermostat, Exterior 360 Video) use wst_reference_photo_url.
-- All four exterior faces share one building-elevation illustration.

-- Screen-flow photo fields.
UPDATE public.work_step_template_fields AS f
SET wstf_illustration_url = m.url, wstf_updated_at = now()
FROM (VALUES
  ('exterior_face_north', '/illustrations/assessment/exterior-face.svg'),
  ('exterior_face_east',  '/illustrations/assessment/exterior-face.svg'),
  ('exterior_face_south', '/illustrations/assessment/exterior-face.svg'),
  ('exterior_face_west',  '/illustrations/assessment/exterior-face.svg'),
  ('utility_electric_meter_photo', '/illustrations/assessment/electric-meter.svg'),
  ('utility_gas_meter_photo', '/illustrations/assessment/gas-meter.svg'),
  ('kitchen_overall_photo', '/illustrations/assessment/kitchen-overall.svg'),
  ('kitchen_range_photo', '/illustrations/assessment/range-stove.svg'),
  ('kitchen_range_vent_photo', '/illustrations/assessment/range-vent.svg'),
  ('kitchen_refrigerator_photo', '/illustrations/assessment/refrigerator.svg'),
  ('kitchen_refrigerator_nameplate_photo', '/illustrations/assessment/refrigerator-nameplate.svg'),
  ('kitchen_dishwasher_nameplate_photo', '/illustrations/assessment/dishwasher-nameplate.svg'),
  ('bathroom_overall_photo', '/illustrations/assessment/bathroom-overall.svg'),
  ('bathroom_exhaust_fan_photo', '/illustrations/assessment/bath-exhaust-fan.svg'),
  ('bathroom_sink_photo', '/illustrations/assessment/sink.svg'),
  ('bathroom_faucet_aerator_photo', '/illustrations/assessment/faucet-aerator.svg'),
  ('bathroom_shower_head_photo', '/illustrations/assessment/shower-head.svg'),
  ('bathroom_toilet_photo', '/illustrations/assessment/toilet.svg')
) AS m(field_name, url)
WHERE f.wstf_field_name = m.field_name AND f.wstf_is_deleted IS NOT TRUE;

-- Simple photo/video steps (matched within the assessment plan).
UPDATE public.work_step_templates AS st
SET wst_reference_photo_url = m.url, wst_updated_at = now()
FROM (VALUES
  ('Front Door Photo', '/illustrations/assessment/front-door.svg'),
  ('Thermostat', '/illustrations/assessment/thermostat.svg'),
  ('Exterior 360 Video', '/illustrations/assessment/exterior-360.svg')
) AS m(step_name, url)
WHERE st.wst_name = m.step_name AND st.wst_is_deleted IS NOT TRUE
  AND EXISTS (
    SELECT 1 FROM public.work_plan_template_entries e
    WHERE e.work_step_template_id = st.id
      AND e.work_plan_template_id = 'b122ffcf-b0e5-4ac0-8d17-d1f063f12ac5'
      AND e.wpte_is_deleted IS NOT TRUE
  );
