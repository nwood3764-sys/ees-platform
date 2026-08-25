-- IRA Income Code is the building's LEA. Confirmed by Nicholas, 2026-08-25:
-- "The income code comes from the LEA from the building."
--
-- The column comment and the help article both carried a "confirm this before
-- relying on it" hedge, written when it was an inference. It is now a stated
-- fact, so the hedge is removed rather than left to make staff re-check
-- something already settled.

COMMENT ON COLUMN public.incentive_applications.ia_ira_income_code IS
  'Live assessment application: "IRA Income Code". The building''s IRA confirmation code (buildings.ira_confirmation_code_lea), reaching the application through the enrollment''s Property LEA#s. Confirmed by Nicholas 2026-08-25.';

UPDATE public.help_articles
   SET ha_body_markdown = replace(
         ha_body_markdown,
E'## Worth confirming\n\n**IRA Income Code** is inherited from the enrollment''s Property LEA#s, which LEAP takes from the building''s IRA confirmation code (LEA). If the program means a different code by "IRA Income Code", clear that mapping in *Incentive Application Enrollment Field Map* and enter the code by hand.\n\n',
E'## Where the IRA Income Code comes from\n\n**IRA Income Code is the building''s LEA.** It reaches the application through the enrollment''s Property LEA#s, which LEAP reads from the building''s IRA confirmation code — so it is set once on the building and flows the whole way down. If a particular building has no LEA recorded, the field arrives blank and you enter it by hand.\n\n'),
       ha_updated_at = now()
 WHERE ha_slug = 'ira-audit-incentive-application';

DO $$
DECLARE v_ok boolean;
BEGIN
  SELECT ha_body_markdown LIKE '%Where the IRA Income Code comes from%'
     AND ha_body_markdown NOT LIKE '%Worth confirming%'
    INTO v_ok
    FROM public.help_articles WHERE ha_slug = 'ira-audit-incentive-application';
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'Help article IRA Income Code section was not replaced';
  END IF;
END $$;
