-- ============================================================================
-- Help: photo capture on a work step, and two articles corrected in place.
--
--   NEW  HA — "Taking Photos on a Work Step" — what to do about the steps that
--        were marked Not Applicable while the upload was broken, which is the
--        part that costs money if nobody says it.
--
--   HA-00197 (videos) told technicians that "Every work step has a Video
--        button". As of 2026-09-02 it does not — video capture belongs to steps
--        whose evidence type IS Video. An instruction that no longer matches the
--        screen is worse than a missing one, so it is CORRECTED, not appended to.
--
--   HA-00124 (building access) described Checked Out From as "Lockbox, or
--        Person", which is what the chips say — but a technician who has already
--        tapped Person now finds Lockbox in the list too.
-- ============================================================================

-- ─── New article ────────────────────────────────────────────────────────────
INSERT INTO public.help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary,
  ha_category, ha_audience, ha_is_published, ha_is_deleted, ha_body_markdown
) VALUES (
  '', 'taking-photos-on-a-work-step',
  'Taking Photos on a Work Step',
  'How photo capture works on a work step, what the messages mean, and what to do about steps marked "Photo does not upload".',
  'Field Service', 'internal', true, false,
$md$# Taking Photos on a Work Step

## If you marked a step "Photo does not upload" — please read this

Between **22 August and 2 September 2026** the photo buttons on a work step
card were broken. Tapping **Photo**, choosing a picture, and getting nothing —
no upload, no error, no spinner — was the bug, not anything you did. Several
steps were closed as **Not Applicable** with reasons like *"Photo does not
upload"* to get past a **Complete Step** button that would never turn on.

That was the right call at the time. Now that capture works again, those steps
need their evidence:

1. Open the work order and find any step marked **Not Applicable** whose reason
   mentions the photo not uploading.
2. If the work can still be photographed, take the photo now and ask your
   Project Coordinator to reopen the step so it can be completed properly.
3. If the moment has passed — the attic is closed, the dumpster is gone —
   leave it and say so. **Not Applicable** with an honest reason is a real
   record. Do not photograph something else and file it as though it were the
   original.

Never close a step as Not Applicable to escape a screen that is misbehaving.
Report it instead: a step closed with no evidence is a hole in the file that
somebody finds months later, during a program audit.

## Taking a photo

On the step you are working, LEAP shows the capture buttons the step needs:

- **Photo** — the general capture, used when the step asks for a count
  ("Photos: 0/3").
- **Before** / **After** — shown only when the step asks for that leg.
- The **folder icon** beside each button opens your library instead of the
  camera, for a photo already taken — offline, on another device, or pulled off
  a camera card at a desk. It takes **several at once**, which is how a
  Front / Side / Back step is filled in one go.

Photo controls appear on the step that is **actionable** — the one the plan has
reached. A step further down says *"Complete the previous step first."* That is
the work plan doing its job, not a fault.

**Video** appears only on steps whose evidence type is Video. To file footage
against a step that asks for photos, drop it on the **Photos / Files** card on
the work order itself — see *Recording and Viewing Videos on a Work Order*.

## What the messages mean

| What you see | What happened |
|---|---|
| *Photo captured (general) · &lt;step&gt;* | Saved, and it counts toward the step. |
| *3 photos uploaded* | The whole batch landed. |
| *1 skipped (not an image)* | A PDF or similar was chosen. Nothing was uploaded. |
| *No photo was selected — nothing was uploaded.* | The picker was cancelled, or returned nothing. |
| *… did not finish within 3 minutes.* | The upload timed out — usually signal. Nothing was lost; try again. |
| *Photo saved, but it has NO location data.* | Saved, but your camera's Location Services is off. Turn it on and retake. |

**You will always get one of these.** A capture that neither succeeds nor says
why is a defect — report it rather than working around it.

## Photos on the desktop

The **Work Plan** tab on a work order record page runs the same steps, the same
evidence rules and the same upload as LEAP Pad — deliberately, so office staff
loading photos off a camera card and technicians in the field cannot drift
apart. On a photo step you can also drag photos straight onto the prompt.

## Why a step still will not complete

**Complete Step** stays off until the step's evidence is actually there, and the
message under it says what is missing ("requires 3 photo(s); 1 captured"). That
count comes from the server, not the screen, so refreshing will not change it —
only the missing photo will.

## Slow uploads

A photo is shrunk on your phone before it is sent, so a full-size camera image
does not cross a job-site connection at full weight; the GPS and timestamp are
preserved exactly as the camera wrote them. iPhone HEIC photos are converted on
the device as well. If any of that is taking too long, LEAP gives up on it and
sends the original photo instead — the picture still lands.
$md$
);

-- ─── HA-00197: corrected in place ───────────────────────────────────────────
UPDATE public.help_articles
   SET ha_body_markdown = replace(
         ha_body_markdown,
E'Every work step has a **Video** button, next to Before / After / Photo. You do\nnot need a step whose evidence type is Video.',
E'Video capture appears on steps whose **evidence type is Video** (changed\n2026-09-02 — it used to sit beside Photo on every step). Those steps show:'
       ),
       ha_updated_at = now()
 WHERE ha_record_number = 'HA-00197' AND ha_is_deleted = false;

UPDATE public.help_articles
   SET ha_body_markdown = replace(
         ha_body_markdown,
E'A step whose evidence type *is* Video leads with **Record Video**, because that\nis the evidence it is waiting on and the step will not complete without it.\nEvery other step simply lets you add one.',
E'The step leads with **Record Video**, because that is the evidence it is\nwaiting on and it will not complete without one. A Video step accepts its\nfootage at any point — including after it is complete, and before the plan has\nreached it — because a video is a record of the building rather than something\nthe step is judged on.\n\n**To file a video against a step that asks for photos**, drop it on the\n**Photos / Files** card on the work order, as described in the next section. It\nis stored on the same record either way; it simply is not captured from the\nstep card.'
       ),
       ha_updated_at = now()
 WHERE ha_record_number = 'HA-00197' AND ha_is_deleted = false;

-- ─── HA-00124: Lockbox is in the person list too ────────────────────────────
UPDATE public.help_articles
   SET ha_body_markdown = replace(
         ha_body_markdown,
'record **Checked Out From**: Lockbox, or Person (pick the account contact who handed them over — e.g. the property manager — or type a name).',
'record **Checked Out From**: Lockbox, or Person (pick the account contact who handed them over — e.g. the property manager — or type a name). **Lockbox also appears inside the "Who provided the keys?" list**, as *"Lockbox — nobody handed them over"*, so if you have already tapped Person you do not have to back out; picking it records exactly the same thing as the Lockbox chip.'
       ),
       ha_updated_at = now()
 WHERE ha_record_number = 'HA-00124' AND ha_is_deleted = false;

-- ─── Assert every correction actually landed ────────────────────────────────
-- A replace() whose search string has drifted is a silent no-op, which would
-- leave a wrong instruction on screen while this migration reported success.
DO $do$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(ha_record_number, ', ') INTO v_bad FROM public.help_articles
  WHERE ha_is_deleted = false AND (
       (ha_record_number = 'HA-00197' AND (
            ha_body_markdown LIKE '%Every work step has a **Video** button%'
         OR ha_body_markdown NOT LIKE '%evidence type is Video%'))
    OR (ha_record_number = 'HA-00124' AND ha_body_markdown NOT LIKE '%nobody handed them over%')
  );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Help correction did not land for: %', v_bad;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.help_articles
                 WHERE ha_slug = 'taking-photos-on-a-work-step' AND ha_is_deleted = false) THEN
    RAISE EXCEPTION 'The new photo-capture help article was not created';
  END IF;
END
$do$;
