-- The values that were still shouting a word the vocabulary had wrongly kept.
-- Idempotent: rewrites only what the corrected rule would still change.
do $$
DECLARE v_rows bigint; v_bad text; v_probe text;
BEGIN
  PERFORM set_config('statement_timeout', '900s', true);

  v_rows := public.run_text_case_backfill(
    array['properties','accounts','contacts','enrollments','buildings',
          'opportunities','incentive_applications']);
  RAISE NOTICE 'text case: % values rewritten after retiring the ordinary words', v_rows;

  SELECT string_agg(finding || ' -- ' || detail, '; ') INTO v_bad
  FROM public.verify_text_case_normalization(
    array['properties','accounts','contacts','enrollments','buildings',
          'opportunities','incentive_applications']);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'text case incomplete: %', v_bad;
  END IF;

  -- THE CONTROLS, on live data rather than on literals: the ordinary word came
  -- down, the legal suffix stayed up, and the lone capital A in a legal entity
  -- name was not lowercased again.
  IF EXISTS (SELECT 1 FROM public.accounts
             WHERE account_is_deleted IS NOT TRUE AND account_name LIKE '% TEAM') THEN
    RAISE EXCEPTION 'an account name still ends in a shouted TEAM';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts
                 WHERE account_is_deleted IS NOT TRUE AND account_name LIKE '%LLC%') THEN
    RAISE EXCEPTION 'LLC did not survive -- the legal suffix seed is not holding';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts
                 WHERE account_is_deleted IS NOT TRUE
                   AND account_name LIKE '%, A Minnesota Limited Partnership') THEN
    RAISE EXCEPTION 'the lone capital A in a legal entity name was lowercased again';
  END IF;

  SELECT enrollment_owner_address INTO v_probe FROM public.enrollments
   WHERE enrollment_record_number = 'ENR-00059';
  IF v_probe IS DISTINCT FROM 'PO Box 304, Waukesha, WI 53187, Alexandria, VA 22314' THEN
    RAISE EXCEPTION 'ENR-00059 owner address reads %L', v_probe;
  END IF;
END $$;
