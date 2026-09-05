-- =============================================================================
-- A declined proposal has its own status
--
-- Nicholas, 2026-09-05: "we should add another status to all these enrollment
-- proposals: Signature requested is good when it's sent. If it's declined, it
-- needs to be 'Proposal Signature Request Denied' would be better."
--
-- He declined a real signing request (ENV-00015, "TEST Decline") and the
-- enrollment did not move. Two reasons, and only one of them was missing
-- configuration.
--
-- 1. sync_enrollment_status_from_envelope maps exactly two envelope states —
--    Sent and Completed. Declined fell through its ELSE and returned NEW. So
--    the decline was recorded on the envelope and on its event trail, and the
--    enrollment went on claiming "Proposal Signature Requested" as though the
--    property owner had never answered.
--
-- 2. There was nowhere for it to go. The nearest thing was ST-00092
--    "Proposal Declined or Withdrawn" -> Enrollment Corrections Needed, which
--    conflates two different outcomes and names neither: a proposal the owner
--    refused is not a packet with corrections to make. LEAP names a status
--    [Object] [State] and every status implies the next action, so a decline
--    gets its own.
--
-- The new status is placed BETWEEN Proposal Signature Requested (34) and
-- Enrollment To Be Submitted (37) because that is where it happens, and it is
-- assigned to the record types DERIVED from those that already carry
-- "Proposal Signature Requested" — never a hand-written list, so a programme
-- that gains the proposal step gains the decline with it.
--
-- A stale decline may not override a live request. Three envelopes exist on
-- ENR-00077 today (Sent, Declined, Sent) because pressing Send again creates
-- another one, so "the enrollment's proposal was declined" is only true while
-- no OTHER live envelope on it is still out for signature. The trigger checks
-- that rather than trusting event order, which is also why ENR-00077 is NOT
-- backfilled here: its newest envelope, ENV-00016, is Sent.
-- =============================================================================

BEGIN;

-- ── The status ──────────────────────────────────────────────────────────────
INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_sort_order, picklist_is_active, picklist_show_in_path)
VALUES
  ('enrollments','enrollment_status',
   'Proposal Signature Request Denied','Proposal Signature Request Denied',
   35, true, true)
ON CONFLICT DO NOTHING;

-- ── Offered wherever the proposal step itself is offered ────────────────────
INSERT INTO public.picklist_value_record_type_assignments
  (pvrta_picklist_value_id, pvrta_record_type_id)
SELECT d.id, a.pvrta_record_type_id
FROM public.picklist_values d
CROSS JOIN LATERAL (
  SELECT a.pvrta_record_type_id
  FROM public.picklist_value_record_type_assignments a
  JOIN public.picklist_values r
    ON r.id = a.pvrta_picklist_value_id
   AND r.picklist_object='enrollments'
   AND r.picklist_field='enrollment_status'
   AND r.picklist_value='Proposal Signature Requested'
) a
WHERE d.picklist_object='enrollments'
  AND d.picklist_field='enrollment_status'
  AND d.picklist_value='Proposal Signature Request Denied'
  AND NOT EXISTS (
    SELECT 1 FROM public.picklist_value_record_type_assignments x
    WHERE x.pvrta_picklist_value_id = d.id
      AND x.pvrta_record_type_id = a.pvrta_record_type_id);

-- ── The transitions ─────────────────────────────────────────────────────────
-- ST-00092 said "Proposal Declined or Withdrawn" and landed on Corrections
-- Needed. Retired rather than repointed: it answered two questions with one
-- destination, and what replaces it is four purpose-named moves, not a
-- redirected one. Retired, never deleted — audit_log and field_history name it.
UPDATE public.status_transitions
   SET st_is_active = false,
       st_is_deleted = true,
       st_deleted_at = now(),
       st_deletion_reason = 'Replaced by the purpose-named Proposal Signature Request Denied transitions (2026-09-05)'
 WHERE st_object='enrollments'
   AND st_record_number='ST-00092'
   AND coalesce(st_is_deleted,false)=false;

INSERT INTO public.status_transitions
  (st_record_number, st_object, st_status_field,
   st_from_status_id, st_to_status_id, st_transition_label, st_description,
   st_sort_order, st_is_active, st_trigger_type, st_owner, st_created_by)
-- Every record has a named owner. Taken from the enrollment lifecycle's own
-- existing transitions rather than picked, so these belong to whoever the rest
-- of this status path already belongs to. Both columns are supplied explicitly
-- because the record-audit stamping trigger resolves the acting app user, and
-- a migration runs as no app user at all -- it cannot fill a NOT NULL owner.
SELECT '', 'enrollments', 'enrollment_status',
       f.id, t.id, v.label, v.description, v.sort_order, true, 'manual',
       lifecycle_owner.id, lifecycle_owner.id
FROM (VALUES
  ('Proposal Signature Requested','Proposal Signature Request Denied',
   'Proposal Declined by Property Owner',
   'The property owner refused to sign the proposal. Recorded automatically when a signing request is declined.', 36),
  ('Proposal Signature Request Denied','Enrollment Verified',
   'Send the Proposal Again',
   'Return the enrollment to Verified so a fresh proposal can be sent for signature.', 101),
  ('Proposal Signature Request Denied','Enrollment Corrections Needed',
   'Rework the Proposal',
   'The proposal itself needs changing before it goes back out.', 102),
  ('Proposal Signature Request Denied','Enrollment Withdrawn',
   'Withdraw',
   'The property owner is not proceeding.', 155)
) AS v(from_value, to_value, label, description, sort_order)
CROSS JOIN LATERAL (
  SELECT s.st_owner AS id FROM public.status_transitions s
   WHERE s.st_object='enrollments' AND s.st_owner IS NOT NULL
   ORDER BY s.st_record_number LIMIT 1
) lifecycle_owner
JOIN public.picklist_values f
  ON f.picklist_object='enrollments' AND f.picklist_field='enrollment_status'
 AND f.picklist_value = v.from_value
JOIN public.picklist_values t
  ON t.picklist_object='enrollments' AND t.picklist_field='enrollment_status'
 AND t.picklist_value = v.to_value
WHERE NOT EXISTS (
  SELECT 1 FROM public.status_transitions s
  WHERE s.st_object='enrollments' AND s.st_status_field='enrollment_status'
    AND s.st_from_status_id = f.id AND s.st_to_status_id = t.id
    AND coalesce(s.st_is_deleted,false)=false);

-- ── The envelope moves the enrollment on a decline ──────────────────────────
CREATE OR REPLACE FUNCTION public.sync_enrollment_status_from_envelope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_from  text;
  v_to    text;
  v_target uuid;
BEGIN
  IF NEW.env_parent_object IS DISTINCT FROM 'enrollments'
     OR NEW.env_parent_record_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT picklist_value INTO v_from
    FROM public.picklist_values WHERE id = OLD.env_status;
  SELECT picklist_value INTO v_to
    FROM public.picklist_values WHERE id = NEW.env_status;

  IF v_to IS NOT DISTINCT FROM v_from THEN
    RETURN NEW;   -- the envelope's status did not move
  END IF;

  -- A Delivered or Voided envelope still does not touch the enrollment:
  -- "delivered" is the mail system's word, not a stage of the filing, and a
  -- voided envelope leaves the enrollment where it was so a person decides
  -- what happens next. Declined is different — it is the property owner's own
  -- answer, and before this the enrollment went on saying it was waiting for
  -- one (Nicholas, 2026-09-05: "I declined to sign, and nothing has populated
  -- back into LEAP").
  v_target := CASE v_to
    WHEN 'Sent'      THEN (SELECT id FROM public.picklist_values
                            WHERE picklist_object='enrollments' AND picklist_field='enrollment_status'
                              AND picklist_value='Proposal Signature Requested')
    WHEN 'Completed' THEN (SELECT id FROM public.picklist_values
                            WHERE picklist_object='enrollments' AND picklist_field='enrollment_status'
                              AND picklist_value='Enrollment To Be Submitted')
    WHEN 'Declined'  THEN (SELECT id FROM public.picklist_values
                            WHERE picklist_object='enrollments' AND picklist_field='enrollment_status'
                              AND picklist_value='Proposal Signature Request Denied')
    ELSE NULL
  END;

  IF v_target IS NULL THEN
    RETURN NEW;
  END IF;

  -- A decline only speaks for the enrollment while nothing newer is out for
  -- signature. Pressing Send again creates ANOTHER envelope, so a decline
  -- arriving on a superseded one must not pull the enrollment back out of a
  -- live request. Checked against the other envelopes' current state rather
  -- than against event order, which nothing guarantees.
  IF v_to = 'Declined' AND EXISTS (
    SELECT 1
    FROM public.envelopes o
    JOIN public.picklist_values s ON s.id = o.env_status
    WHERE o.env_parent_object = 'enrollments'
      AND o.env_parent_record_id = NEW.env_parent_record_id
      AND o.id <> NEW.id
      AND coalesce(o.is_deleted,false) = false
      AND s.picklist_value IN ('Sent','Delivered','Completed')
  ) THEN
    RETURN NEW;
  END IF;

  -- Only for record types that actually carry these statuses. An enrollment of
  -- another record type is left alone rather than stamped with a status its own
  -- status path does not offer, which would render as a blank chevron.
  UPDATE public.enrollments e
     SET enrollment_status = v_target
   WHERE e.id = NEW.env_parent_record_id
     AND e.enrollment_status IS DISTINCT FROM v_target
     AND EXISTS (
       SELECT 1 FROM public.picklist_value_record_type_assignments a
        WHERE a.pvrta_picklist_value_id = v_target
          AND a.pvrta_record_type_id = e.enrollment_record_type);

  RETURN NEW;
END;
$function$;

-- ── Assertions ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_denied uuid;
  v_req    uuid;
  v_n int;
  v_rt int;
BEGIN
  SELECT id INTO v_denied FROM public.picklist_values
   WHERE picklist_object='enrollments' AND picklist_field='enrollment_status'
     AND picklist_value='Proposal Signature Request Denied';
  SELECT id INTO v_req FROM public.picklist_values
   WHERE picklist_object='enrollments' AND picklist_field='enrollment_status'
     AND picklist_value='Proposal Signature Requested';

  IF v_denied IS NULL THEN RAISE EXCEPTION 'the denied status was not created'; END IF;

  -- It is offered on exactly the record types that offer the request itself.
  SELECT count(*) INTO v_n  FROM public.picklist_value_record_type_assignments WHERE pvrta_picklist_value_id=v_denied;
  SELECT count(*) INTO v_rt FROM public.picklist_value_record_type_assignments WHERE pvrta_picklist_value_id=v_req;
  IF v_n <> v_rt OR v_n = 0 THEN
    RAISE EXCEPTION 'denied is assigned to % record types, the request to % — they must match and be non-zero', v_n, v_rt;
  END IF;

  -- A status nothing can reach and nothing can leave is a dead end on a path.
  SELECT count(*) INTO v_n FROM public.status_transitions
   WHERE st_object='enrollments' AND st_to_status_id=v_denied AND coalesce(st_is_deleted,false)=false;
  IF v_n < 1 THEN RAISE EXCEPTION 'nothing transitions INTO the denied status'; END IF;

  SELECT count(*) INTO v_n FROM public.status_transitions
   WHERE st_object='enrollments' AND st_from_status_id=v_denied AND coalesce(st_is_deleted,false)=false;
  IF v_n < 3 THEN RAISE EXCEPTION 'only % ways out of the denied status', v_n; END IF;

  -- The conflated transition is gone.
  SELECT count(*) INTO v_n FROM public.status_transitions
   WHERE st_object='enrollments' AND st_record_number='ST-00092'
     AND coalesce(st_is_deleted,false)=false;
  IF v_n <> 0 THEN RAISE EXCEPTION 'ST-00092 (Proposal Declined or Withdrawn) is still live'; END IF;

  -- The trigger really does read Declined now. Asserted against the DEPLOYED
  -- definition, because a silent revert is the regression that matters.
  SELECT count(*) INTO v_n FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='sync_enrollment_status_from_envelope'
     AND p.prosrc LIKE '%Proposal Signature Request Denied%'
     AND p.prosrc LIKE '%WHEN ''Declined''%';
  IF v_n <> 1 THEN RAISE EXCEPTION 'the envelope trigger does not map Declined'; END IF;

  -- CONTROL: ENR-00077 is deliberately NOT backfilled. Its newest envelope is
  -- Sent, so it is genuinely awaiting a signature; a decline on the superseded
  -- ENV-00015 must not claim otherwise.
  SELECT count(*) INTO v_n
  FROM public.enrollments e
  JOIN public.picklist_values pv ON pv.id = e.enrollment_status
  WHERE e.enrollment_record_number='ENR-00077'
    AND pv.picklist_value='Proposal Signature Requested';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ENR-00077 should still be awaiting signature (a live Sent envelope stands)';
  END IF;
END $$;

COMMIT;
