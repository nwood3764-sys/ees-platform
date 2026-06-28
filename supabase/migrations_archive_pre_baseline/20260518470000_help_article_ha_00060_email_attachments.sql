-- Communications Module v1, Slice 5
-- HA-00060: Email attachments — uploading, storage, and download

DO $$
DECLARE
  v_admin_id uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_ha_id    uuid;
BEGIN
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_category, ha_audience,
    ha_summary, ha_body_markdown, ha_is_published,
    ha_created_by, ha_updated_by
  ) VALUES (
    '', 'email-attachments',
    'Email attachments — uploading, storage, and download',
    'Communications', 'all',
    'How to attach files when composing an email, what file types are allowed, how large files are handled, and how attachments appear on the message timeline. Covers inline vs signed-link delivery, virus-scan state, and the underlying message_attachments row.',
$body$
# Email attachments

The Compose Email modal accepts file attachments — drag in the **Attach file…** button to stage one or more files, then click Send. Files upload to private Supabase Storage and attach to the outbound `messages` row. They appear on the message bubble below the body and can be re-opened by any authenticated LEAP user with visibility into the conversation.

## Allowed file types

Common business document and image formats — **PDF, DOCX, DOC, XLSX, XLS, PPTX, PPT, PNG, JPG/JPEG, HEIC, HEIF, GIF, WebP, CSV, TSV, TXT, MD, ZIP**.

Blocked outright: **EXE, BAT, SH, PS1, VBS, JS, JAR, DLL, MSI**, and other executable / script formats. Refused with a clear toast at the upload step — the row never lands in the database.

**Hard cap: 100 MB per file.** Anything larger is refused.

## Inline vs signed-link delivery

The 25 MB Microsoft 365 inbound limit drives the routing:

- **≤ 25 MB**: files ride along as **inline attachments** on the outgoing email. The recipient sees them in their normal email client as native attachments.

- **> 25 MB**: files ship as a **signed download link** appended to the email body. The link is valid for 30 days. This avoids the Graph 25 MB ceiling without imposing a hard cap on what coordinators can send.

The modal shows which delivery method each staged file will use before you click Send. No surprises.

## Where the file actually lives

Bucket: `communications-attachments` (non-public). Storage key: `{conversation_id}/{message_id}/{uuid}-{safeName}`. Every download goes through a **5-minute signed URL** minted by the JS client at click time — there are no permanent public URLs for these files.

The `public.message_attachments` row records the storage path, original filename, byte count, MIME type, delivery method, virus-scan status, and (for signed-link mode) the 30-day expiry. The attachment is soft-deletable; deleting the row preserves the storage object for audit-trail completeness until a dedicated cleanup chore reaps both.

## Virus scan

Every attachment lands with `ma_virus_scan_status = 'pending'`. The dedicated ClamAV edge function that flips this to `clean` or `infected` is a follow-up slice. Until it ships:

- Pending attachments display with an amber **SCAN PENDING** badge on the message bubble.
- Downloads are **allowed** for pending attachments — staff need to work in mock mode without ClamAV blocking the loop. Once the scan ships, the badge disappears for `clean`, and `infected` flips the chip to red **BLOCKED** with the download button disabled.

## The signed-link badge

Large attachments display a sky-blue **LINK** badge on the message bubble so it's obvious they shipped as a signed URL rather than inline. This matters when reviewing what the recipient actually got — clicking the chip from LEAP works either way (it always mints a fresh signed URL from the underlying storage path), but the badge tells you what the email itself contained.

## Mock-mode behavior

Production is currently in mock mode for Graph send. Attachments still upload to Supabase Storage and the `message_attachments` rows still land — the only thing skipped is the actual outbound delivery to the recipient. This means you can compose, attach, send, and re-open attachments end-to-end inside LEAP today without any email actually leaving Microsoft 365. The day the Azure AD Application Access Policy lands, the same flow starts delivering inline attachments and signed links to recipients with zero code changes.

## Permissions and visibility

The bucket is RLS-locked to authenticated LEAP users only. Anyone who can see the parent `messages` row through the opportunity-anchored visibility model can mint a download URL for its attachments. Anon clients have no access. Portal users (external) are not in scope for v1; portal attachment access is its own future slice.

## Out of scope in this slice

- **Drag-and-drop onto the modal** — only the explicit Attach button for v1. Drag-drop is a small follow-up.
- **Inline image embedding in the body** — TipTap's inline image flow lands with the rich-text editor slice.
- **Attachment preview** — files open in a new tab via the browser's default handler. In-app PDF / image preview is the existing `display_pdf` interactive tool's slot when we wire it in.
- **Re-scan / re-attach** — once an attachment is on the row, that's it; remove via soft-delete or re-send.
$body$,
    true,
    v_admin_id, v_admin_id
  )
  RETURNING id INTO v_ha_id;

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_created_by) VALUES
    (v_ha_id, 'object', 'message_attachments', v_admin_id),
    (v_ha_id, 'object', 'messages',            v_admin_id),
    (v_ha_id, 'object', 'conversations',       v_admin_id);

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_created_by) VALUES
    (v_ha_id, 'concept', 'email-attachments',          v_admin_id),
    (v_ha_id, 'concept', 'attachment-upload',          v_admin_id),
    (v_ha_id, 'concept', 'attachment-download',        v_admin_id),
    (v_ha_id, 'concept', 'signed-link-attachment',     v_admin_id),
    (v_ha_id, 'concept', 'inline-attachment',          v_admin_id),
    (v_ha_id, 'concept', 'virus-scan',                 v_admin_id),
    (v_ha_id, 'concept', 'clamav',                     v_admin_id),
    (v_ha_id, 'concept', 'communications-attachments-bucket', v_admin_id),
    (v_ha_id, 'concept', 'mock-mode',                  v_admin_id);
END $$;
