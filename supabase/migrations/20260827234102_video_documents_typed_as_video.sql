-- ---------------------------------------------------------------------------
-- Every video already in LEAP is typed as a video.
--
-- documents.document_type names the SLOT a file was filed into. The generic
-- default is 'attachment', and until 2026-08-27 a video that came in through a
-- Documents card took it — so a 360 pan of a roof was stored indistinguishably
-- from a spec sheet. Nothing could count videos, find them, or offer them to a
-- report.
--
-- Two such rows exist, both filed by hand on 2026-08-27 onto "Roof / Ceiling"
-- work steps (a 430 MB iPhone .MOV and a 90 MB .mp4), because the step that
-- wanted a video offered no way to attach one. The client now types a video at
-- the single upload door (uploadDocument in src/data/storageService.js); this
-- corrects what is already stored.
--
-- The 'video' value and its "Video" label already exist in picklist_values
-- (documents · document_type, sort 210) — captureStepVideo has always used it.
-- Nothing is added here; this is a data correction only.
--
-- Scope is deliberately narrow: ONLY rows still carrying the generic
-- 'attachment'. A video filed into a NAMED slot is that slot's file and is left
-- exactly as it is.
--
-- Run as an ordinary UPDATE, not under session_replication_role = 'replica'
-- (the migration role cannot set it, and the Supabase runner refuses). Two rows
-- is not audit noise worth working around, and unlike a backfill of a value
-- that was never written, this IS a change of the stored type — the audit entry
-- is true.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_before  int;
  v_updated int;
  v_left    int;
BEGIN
  SELECT count(*) INTO v_before
  FROM public.documents
  WHERE is_deleted IS NOT TRUE
    AND document_type = 'attachment'
    AND mime_type ILIKE 'video/%';

  RAISE NOTICE 'video documents still typed as a generic attachment: %', v_before;

  UPDATE public.documents
     SET document_type = 'video'
   WHERE is_deleted IS NOT TRUE
     AND document_type = 'attachment'
     AND mime_type ILIKE 'video/%';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT count(*) INTO v_left
  FROM public.documents
  WHERE is_deleted IS NOT TRUE
    AND document_type = 'attachment'
    AND mime_type ILIKE 'video/%';

  RAISE NOTICE 're-typed % video document(s); % remain', v_updated, v_left;

  IF v_left > 0 THEN
    RAISE EXCEPTION 'video documents still typed as attachment after the backfill: %', v_left;
  END IF;
END $$;
