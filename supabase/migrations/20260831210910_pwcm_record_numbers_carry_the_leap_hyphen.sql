-- generate_record_number() concatenates the prefix straight onto the padded
-- number, so every LEAP prefix passed to it already ends in a hyphen ('IA-',
-- 'RSSS-'). Passing 'PWCM' produced PWCM00001 instead of PWCM-00001.
--
-- (The table this corrects is removed by the next migration; the fix is kept
-- so a replay reproduces the same history rather than a tidied version of it.)
CREATE OR REPLACE FUNCTION public.set_pwcm_record_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog' AS $function$
BEGIN
  IF NEW.pwcm_record_number IS NULL OR NEW.pwcm_record_number = '' THEN
    NEW.pwcm_record_number := public.generate_record_number(
      'PWCM-', 'product_work_completed_measure_seq');
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.set_pwcm_record_number() FROM PUBLIC, anon, authenticated;

SET session_replication_role = replica;
UPDATE public.product_work_completed_measures
SET pwcm_record_number = 'PWCM-' || substring(pwcm_record_number from '[0-9]+$')
WHERE pwcm_record_number !~ '^PWCM-';
SET session_replication_role = origin;

DO $$
DECLARE v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad FROM public.product_work_completed_measures
   WHERE pwcm_record_number !~ '^PWCM-[0-9]{5}$';
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% product work-completed measure rows carry a malformed record number', v_bad;
  END IF;
END $$;
