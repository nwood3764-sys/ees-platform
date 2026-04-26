ALTER TABLE public.gps_points
  ADD COLUMN IF NOT EXISTS gps_accuracy_in_meters                                  numeric(6,2),
  ADD COLUMN IF NOT EXISTS gps_anura_time_sheet_entry                              uuid,
  ADD COLUMN IF NOT EXISTS gps_employee                                            uuid,
  ADD COLUMN IF NOT EXISTS gps_geolocation                                         jsonb,
  ADD COLUMN IF NOT EXISTS gps_map                                                 uuid,
  ADD COLUMN IF NOT EXISTS gps_technician                                          uuid,
  ADD COLUMN IF NOT EXISTS gps_time_stamp                                          timestamp with time zone;
