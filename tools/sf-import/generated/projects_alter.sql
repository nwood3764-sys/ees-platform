ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS project_estimated_number_of_bales                       numeric(8,2),
  ADD COLUMN IF NOT EXISTS project_external_id                                     text,
  ADD COLUMN IF NOT EXISTS project_gpm_savings                                     numeric(18,2),
  ADD COLUMN IF NOT EXISTS project_gross_annual_therm_savings                      numeric(18,2),
  ADD COLUMN IF NOT EXISTS project_incentive_amount_ee                             numeric(18,2),
  ADD COLUMN IF NOT EXISTS project_incentive_issue_date                            date,
  ADD COLUMN IF NOT EXISTS project_incentive_processing_time                       numeric(18,0),
  ADD COLUMN IF NOT EXISTS project_incentive_received_date                         date,
  ADD COLUMN IF NOT EXISTS project_incentive_submitted_date                        date,
  ADD COLUMN IF NOT EXISTS project_installation_completion_date                    date,
  ADD COLUMN IF NOT EXISTS project_installed_number_of_bales                       numeric(6,1),
  ADD COLUMN IF NOT EXISTS project_number_of_in_unit_di_ee_measures                numeric(18,2),
  ADD COLUMN IF NOT EXISTS project_number_of_units_in_building                     numeric(18,0),
  ADD COLUMN IF NOT EXISTS project_opportunity                                     uuid,
  ADD COLUMN IF NOT EXISTS project_post_installation_inspection_date               date,
  ADD COLUMN IF NOT EXISTS project_program_name                                    text,
  ADD COLUMN IF NOT EXISTS project_project_co_ordinator                            uuid,
  ADD COLUMN IF NOT EXISTS project_project_cost_pp                                 numeric(18,2),
  ADD COLUMN IF NOT EXISTS project_project_id_pp                                   text,
  ADD COLUMN IF NOT EXISTS project_project_identified_date                         date,
  ADD COLUMN IF NOT EXISTS project_project_implementation_end_date                 date,
  ADD COLUMN IF NOT EXISTS project_project_implementation_start_date               date,
  ADD COLUMN IF NOT EXISTS project_project_owner                                   uuid,
  ADD COLUMN IF NOT EXISTS project_project_record_id_pp                            text,
  ADD COLUMN IF NOT EXISTS project_project_scheduled_time                          time,
  ADD COLUMN IF NOT EXISTS project_project_scheduled                               date,
  ADD COLUMN IF NOT EXISTS project_project_site_lead_user                          uuid,
  ADD COLUMN IF NOT EXISTS project_project_site_lead                               uuid,
  ADD COLUMN IF NOT EXISTS project_project_status_notes                            text,
  ADD COLUMN IF NOT EXISTS project_project_status_pp                               text,
  ADD COLUMN IF NOT EXISTS project_project_status                                  text,
  ADD COLUMN IF NOT EXISTS project_projects_work_days_to_complete_project          integer,
  ADD COLUMN IF NOT EXISTS project_property_sector                                 text,
  ADD COLUMN IF NOT EXISTS project_qaqc                                            uuid,
  ADD COLUMN IF NOT EXISTS project_sq_ft_attic_plane                               numeric(18,0),
  ADD COLUMN IF NOT EXISTS project_test                                            numeric(18,0),
  ADD COLUMN IF NOT EXISTS project_total_project_running_time                      numeric(18,0),
  ADD COLUMN IF NOT EXISTS project_utility_program                                 text,
  ADD COLUMN IF NOT EXISTS project_vendor_project_id_18                            text,
  ADD COLUMN IF NOT EXISTS project_work_order_completed                            date,
  ADD COLUMN IF NOT EXISTS project_work_order_issued                               date;
COMMENT ON COLUMN public.projects.project_gpm_savings IS 'SF formula/rollup field. Populated by future trigger or view.';
COMMENT ON COLUMN public.projects.project_gross_annual_therm_savings IS 'SF formula/rollup field. Populated by future trigger or view.';
COMMENT ON COLUMN public.projects.project_incentive_amount_ee IS 'SF formula/rollup field. Populated by future trigger or view.';
COMMENT ON COLUMN public.projects.project_incentive_processing_time IS 'SF formula/rollup field. Populated by future trigger or view.';
COMMENT ON COLUMN public.projects.project_number_of_in_unit_di_ee_measures IS 'SF formula/rollup field. Populated by future trigger or view.';
COMMENT ON COLUMN public.projects.project_number_of_units_in_building IS 'SF formula/rollup field. Populated by future trigger or view.';
COMMENT ON COLUMN public.projects.project_program_name IS 'SF formula/rollup field. Populated by future trigger or view.';
COMMENT ON COLUMN public.projects.project_property_sector IS 'SF formula/rollup field. Populated by future trigger or view.';
COMMENT ON COLUMN public.projects.project_total_project_running_time IS 'SF formula/rollup field. Populated by future trigger or view.';
COMMENT ON COLUMN public.projects.project_vendor_project_id_18 IS 'SF formula/rollup field. Populated by future trigger or view.';
