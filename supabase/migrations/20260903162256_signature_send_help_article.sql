-- Sending a generated document for signature — the help for the two actions
-- shipped in this branch, and the correction to the one article that now
-- states something untrue.
--
-- Two things this migration takes seriously, both learned on 2026-09-03:
--
--   1. Writing an article is not INDEXING it. LEAP's help panel surfaces
--      articles by ANCHOR, so an article with none is reachable only by a
--      person who already knows to search for it — which is nobody standing on
--      the record wondering what the button does. HA-00152 has had zero
--      anchors since it shipped on 2026-07-27.
--
--   2. A help article is CORRECTED in place, never appended to. HA-00152 says
--      "Only the HOMES Project Invoice offers this today". That was true when
--      it was written and is not true now, and a wrong instruction is worse
--      than a missing one.
--
-- No DDL.

DO $$
DECLARE
  v_article uuid;
  v_body    text;
  v_n       int;
BEGIN
  -- ─────────────────────────────────────────────────────────────────────────
  -- The new article.
  -- ─────────────────────────────────────────────────────────────────────────
  INSERT INTO public.help_articles (ha_record_number, ha_slug, ha_title, ha_summary,
                                    ha_category, ha_audience, ha_is_published, ha_body_markdown)
  VALUES (
    '', 'send-a-generated-document-for-signature',
    'Sending a generated document for signature',
    'How to send the WI HEAR proposal or the WI HOMES payment request invoice to a property owner for an e-signature, what moves when it comes back, and how to test one safely first.',
    'Communications', 'internal', true,
$md$# Sending a generated document for signature

Two documents LEAP builds for you can be sent straight to a property owner for
an electronic signature, from the record they belong to. You do not download
them, attach them to an email and hope.

| Document | Where the button is | What it says |
|---|---|---|
| **IRA Multifamily HEAR Proposal** | The **enrollment**, record type `WI-IRA-MF-HEAR-Project-Reservation` | **Send Proposal for Signature** |
| **IRA Multifamily HOMES Payment Request Invoice** | The **incentive** record, record type `WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST` | **Send Invoice for Signature** |

Both are under **Actions**. The invoice is on the incentive record, not the
project — that is where the Payment Request itself lives, and where
**Generate Payment Request Invoice** already sits.

**Wisconsin only.** North Carolina and Michigan carry the same record types but
no live records under them, so the actions do not appear there yet.

## How to send one

1. Open the record and choose the action from the **Actions** menu.
2. LEAP builds the document first, so if the record is not ready you are told
   exactly what is missing — before anything is sent, and before anything is
   filed on the record.
3. Check the **recipient's name and email**. They are pre-filled from the
   record, so read them: an address that arrived from somewhere else is still
   an address a real person receives mail at. Edit the subject if you like.
4. Press **Send for Signature**.

You will be asked to confirm the recipient once more, with the address spelled
out. That gate is deliberate and applies to every outgoing message in LEAP —
nothing leaves the building until a person has read who it is going to.

## Where the signature lands

On the document's own **Acknowledgment and Acceptance** block: a signature on
the Property Owner line and a date beside it. The boxes are placed from the
same measurements that draw the lines, so they cannot drift apart.

## What happens when it comes back

- **The HEAR proposal moves the enrollment.** Sending it sets the status to
  **Proposal Signature Requested**; the completed signature sets it to
  **Enrollment To Be Submitted**. You do not move it by hand.
- **The invoice moves nothing.** Signing it is a record of the owner's
  acceptance; what happens next on the payment request is a person's decision.

Either way the signed PDF and every step — sent, viewed, signed — are recorded
on the envelope, the same as any other LEAP signature request.

## Testing one safely first

If company email (Outlook) is not connected, **no email is sent** and the
dialog hands you a signing link instead. That is also the safe way to try one:

1. Run the action and set the recipient to **your own address**.
2. Open the link, check the signature box sits on the Property Owner line, and
   sign it.
3. Look at the signed PDF.

Only then send one to an actual property owner.

## If the action is not there

- The record type is not one of the two above, or the record is in edit mode.
- For the invoice: the incentive record is not
  `WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST`.

## Related

- **Generating Program Submittal Documents** covers the submittal package built
  on the *project*, which is a different document with its own signing route.
- **Envelopes and e-signature** covers what happens to an envelope after it is
  sent — resending, voiding, and the audit trail.
$md$
  ) RETURNING id INTO v_article;

  -- The anchors are the whole point: press ? on either record and this comes up.
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order)
  VALUES (v_article, 'object', 'enrollments', 1),
         (v_article, 'object', 'incentive_applications', 2);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order)
  VALUES (v_article, 'concept', 'send for signature', 3);

  -- ─────────────────────────────────────────────────────────────────────────
  -- HA-00152's "only" claim, corrected in place.
  -- ─────────────────────────────────────────────────────────────────────────
  SELECT ha_body_markdown INTO v_body FROM public.help_articles WHERE ha_record_number = 'HA-00152';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'HA-00152 not found — the correction below was written against it';
  END IF;
  IF position('Only the HOMES Project Invoice offers this today' IN v_body) = 0 THEN
    RAISE EXCEPTION 'HA-00152 no longer carries the sentence this migration corrects; re-read it before assuming';
  END IF;

  v_body := replace(v_body,
    'Only the HOMES Project Invoice offers this today — it''s the document the program marks as requiring a signature. Other documents download only.',
    'On the PROJECT''s submittal package, only the HOMES Project Invoice offers this — it''s the document the program marks as requiring a signature, and the other submittal documents download only. The payment request invoice on the **incentive** record has its own **Send Invoice for Signature** action; see *Sending a generated document for signature*.');

  UPDATE public.help_articles SET ha_body_markdown = v_body WHERE ha_record_number = 'HA-00152';

  -- HA-00152 has never had an anchor, so the correction above would have been
  -- unreachable from the screen it describes. One anchor, on that screen.
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order)
  SELECT id, 'object', 'projects', 1 FROM public.help_articles WHERE ha_record_number = 'HA-00152';

  -- ─────────────────────────────────────────────────────────────────────────
  -- Assertions. An article nobody can reach is not shipped.
  -- ─────────────────────────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.help_article_anchors
   WHERE haa_article_id = v_article AND haa_anchor_type = 'object'
     AND haa_object IN ('enrollments','incentive_applications');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'the new article is anchored to % of its 2 objects', v_n;
  END IF;

  -- It must actually come back for the words a person would type.
  SELECT count(*) INTO v_n FROM public.help_articles
   WHERE ha_is_published AND ha_is_deleted IS NOT TRUE
     AND ha_search @@ websearch_to_tsquery('english', 'send for signature invoice')
     AND id = v_article;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'the new article does not answer a search for "send for signature invoice"';
  END IF;

  -- CONTROL: the correction really landed, and the untrue sentence is gone.
  SELECT count(*) INTO v_n FROM public.help_articles
   WHERE ha_record_number = 'HA-00152'
     AND ha_body_markdown LIKE '%Only the HOMES Project Invoice offers this today%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'HA-00152 still carries the sentence that is no longer true';
  END IF;

  RAISE NOTICE 'help article % created and anchored; HA-00152 corrected',
    (SELECT ha_record_number FROM public.help_articles WHERE id = v_article);
END $$;
