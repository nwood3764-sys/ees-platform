-- The HEAR proposal's signature moves the enrollment by itself.
--
-- Nicholas: "When we make the proposal for the HEAR project reservation, we need
-- to send it out for signature and then through the LEAP software. Then it comes
-- back when it's signed... When it comes back, it needs to be changed from
-- Status of Enrollment to Enrollment to be submitted." And, on the naming:
-- "it's only one status. It's when after we send it for signature" — so
-- Proposal Signature Requested, and no separate "sent" state.
--
-- ── Two statuses, because the return state did not exist either ──────────
--
-- The HEAR reservation lifecycle ran To Be Prepared -> To Be Verified ->
-- Verified -> Submitted (Awaiting Program Response) -> Approved / Corrections /
-- Denied / Withdrawn. Neither the waiting-on-a-signature state nor the
-- ready-to-file state had anywhere to live, so a packet sitting on an owner's
-- desk for a week was indistinguishable from one nobody had touched.
--
--   Proposal Signature Requested (34) — the proposal has gone out; we are
--   waiting on the property owner.
--   Enrollment To Be Submitted (37)   — it came back signed; ours to file.
--
-- ── Where they sit, and why that is a guess worth stating ────────────────
--
-- Placed AFTER Verified and BEFORE Submitted: the packet is checked internally,
-- then the owner signs, then it is filed. That reading comes from Nicholas's own
-- sequence — signature returns straight to "to be submitted", with no
-- verification after it. Every existing sort order is untouched, so if the
-- proposal actually goes out before verification this is a one-row reorder and
-- nothing else moves.
--
-- Scoped to the HEAR Project Reservation record type only, with the assignments
-- made explicitly so the intent is recorded rather than implied.
--
-- ── Why a trigger and not a callback in the signing code ─────────────────
--
-- send-envelope is an edge function and the signing portal writes back through
-- its own path; a completion can also be recorded by hand when a signed PDF
-- arrives by email. Hanging the status move off any one of those routes means
-- the other two silently do not move the record. The envelope's OWN status is
-- the single fact every route already writes, so the move rides on that.

BEGIN;

-- ── 1. The two statuses ──────────────────────────────────────────────────
INSERT INTO public.picklist_values (
  picklist_object, picklist_field, picklist_value, picklist_label,
  picklist_is_active, picklist_sort_order, picklist_show_in_path, picklist_description
)
SELECT 'enrollments', 'enrollment_status', v.val, v.val, true, v.ord, true, v.descr
FROM (VALUES
  ('Proposal Signature Requested', 34,
   'The proposal has been sent to the property owner for signature and LEAP is waiting on it. Set automatically when the signing envelope is sent.'),
  ('Enrollment To Be Submitted', 37,
   'The signed proposal has come back and the packet is ready to file with the programme. Set automatically when the signing envelope completes.')
) AS v(val, ord, descr)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
   WHERE p.picklist_object = 'enrollments' AND p.picklist_field = 'enrollment_status'
     AND p.picklist_value = v.val
);

INSERT INTO public.picklist_value_record_type_assignments (pvrta_picklist_value_id, pvrta_record_type_id)
SELECT pv.id, rt.id
  FROM public.picklist_values pv
  CROSS JOIN public.picklist_values rt
 WHERE pv.picklist_object = 'enrollments' AND pv.picklist_field = 'enrollment_status'
   AND pv.picklist_value IN ('Proposal Signature Requested', 'Enrollment To Be Submitted')
   AND rt.picklist_object = 'enrollments' AND rt.picklist_field = 'record_type'
   AND rt.picklist_value = 'WI-IRA-MF-HEAR-Project-Reservation'
   AND NOT EXISTS (
     SELECT 1 FROM public.picklist_value_record_type_assignments a
      WHERE a.pvrta_picklist_value_id = pv.id AND a.pvrta_record_type_id = rt.id);

COMMIT;

BEGIN;

-- ── 2. The transitions the status path offers ────────────────────────────
INSERT INTO public.status_transitions (
  st_record_number, st_object, st_status_field, st_from_status_id, st_to_status_id,
  st_transition_label, st_description, st_sort_order, st_is_active, st_owner, st_created_by
)
SELECT '', 'enrollments', 'enrollment_status', f.id, t.id, v.label, v.descr, v.ord, true,
       (SELECT st_owner FROM public.status_transitions WHERE st_object='enrollments' LIMIT 1),
       (SELECT st_created_by FROM public.status_transitions WHERE st_object='enrollments' LIMIT 1)
FROM (VALUES
  ('Enrollment Verified', 'Proposal Signature Requested', 'Send Proposal for Signature',
   'The proposal goes to the property owner. Normally set automatically when the envelope is sent.', 34),
  ('Proposal Signature Requested', 'Enrollment To Be Submitted', 'Signed Proposal Received',
   'The owner has signed. Normally set automatically when the envelope completes.', 35),
  ('Proposal Signature Requested', 'Enrollment Corrections Needed', 'Proposal Declined or Withdrawn',
   'The owner declined or the proposal needs rework before it goes out again.', 36),
  ('Enrollment To Be Submitted', 'Enrollment Submitted — Awaiting Program Response', 'Submit to Program',
   'The packet has been filed with the programme.', 37)
) AS v(from_val, to_val, label, descr, ord)
JOIN public.picklist_values f ON f.picklist_object='enrollments' AND f.picklist_field='enrollment_status' AND f.picklist_value = v.from_val
JOIN public.picklist_values t ON t.picklist_object='enrollments' AND t.picklist_field='enrollment_status' AND t.picklist_value = v.to_val
WHERE NOT EXISTS (
  SELECT 1 FROM public.status_transitions s
   WHERE s.st_object='enrollments' AND s.st_status_field='enrollment_status'
     AND s.st_from_status_id = f.id AND s.st_to_status_id = t.id
     AND s.st_is_deleted IS NOT TRUE);

COMMIT;

BEGIN;

-- ── 3. The envelope moves the enrollment ─────────────────────────────────
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

  -- Only the two events Nicholas named. A Delivered or Voided envelope does not
  -- touch the enrollment: "delivered" is the mail system's word, not a stage of
  -- the filing, and a voided envelope leaves the enrollment where it was so a
  -- person decides what happens next.
  v_target := CASE v_to
    WHEN 'Sent'      THEN (SELECT id FROM public.picklist_values
                            WHERE picklist_object='enrollments' AND picklist_field='enrollment_status'
                              AND picklist_value='Proposal Signature Requested')
    WHEN 'Completed' THEN (SELECT id FROM public.picklist_values
                            WHERE picklist_object='enrollments' AND picklist_field='enrollment_status'
                              AND picklist_value='Enrollment To Be Submitted')
    ELSE NULL
  END;

  IF v_target IS NULL THEN
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

REVOKE ALL ON FUNCTION public.sync_enrollment_status_from_envelope()
  FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zzz_enrollment_status_from_envelope ON public.envelopes;
CREATE TRIGGER trg_zzz_enrollment_status_from_envelope
  AFTER UPDATE OF env_status ON public.envelopes
  FOR EACH ROW EXECUTE FUNCTION public.sync_enrollment_status_from_envelope();

COMMIT;

-- ── Assertions ───────────────────────────────────────────────────────────
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.picklist_values
   WHERE picklist_object='enrollments' AND picklist_field='enrollment_status'
     AND picklist_value IN ('Proposal Signature Requested','Enrollment To Be Submitted')
     AND picklist_is_active;
  IF v_n <> 2 THEN RAISE EXCEPTION 'Expected both new statuses; found %', v_n; END IF;

  SELECT count(*) INTO v_n
    FROM public.picklist_value_record_type_assignments a
    JOIN public.picklist_values pv ON pv.id = a.pvrta_picklist_value_id
    JOIN public.picklist_values rt ON rt.id = a.pvrta_record_type_id
   WHERE pv.picklist_value IN ('Proposal Signature Requested','Enrollment To Be Submitted')
     AND rt.picklist_value = 'WI-IRA-MF-HEAR-Project-Reservation';
  IF v_n <> 2 THEN RAISE EXCEPTION 'The new statuses are not on the HEAR reservation record type (% of 2)', v_n; END IF;

  -- The negative control: another record type's lifecycle must be untouched.
  SELECT count(*) INTO v_n
    FROM public.picklist_value_record_type_assignments a
    JOIN public.picklist_values pv ON pv.id = a.pvrta_picklist_value_id
    JOIN public.picklist_values rt ON rt.id = a.pvrta_record_type_id
   WHERE pv.picklist_value IN ('Proposal Signature Requested','Enrollment To Be Submitted')
     AND rt.picklist_value <> 'WI-IRA-MF-HEAR-Project-Reservation';
  IF v_n > 0 THEN RAISE EXCEPTION 'The new statuses leaked onto % other record type assignment(s)', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.status_transitions s
    JOIN public.picklist_values t ON t.id = s.st_to_status_id
   WHERE s.st_object='enrollments' AND s.st_is_deleted IS NOT TRUE
     AND t.picklist_value IN ('Proposal Signature Requested','Enrollment To Be Submitted');
  IF v_n < 2 THEN RAISE EXCEPTION 'The new statuses are unreachable — only % transition(s) lead to them', v_n; END IF;

  IF EXISTS (SELECT 1 FROM public.find_trigger_function_privilege_gaps()) THEN
    RAISE EXCEPTION 'A trigger function now depends on an EXECUTE grant that is revoked';
  END IF;
END $$;
