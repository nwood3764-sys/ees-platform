-- ─────────────────────────────────────────────────────────────────────────────
-- Clear photos stranded mid-render.
--
-- `watermark_status = 'processing'` is written by process-photo as it starts
-- work and overwritten when it finishes. A row that still says 'processing'
-- long afterwards is one whose render never completed — the worker died, or
-- the tab that started it went away.
--
-- 27 rows were left that way by the auto-render pass shipped earlier today
-- (#539): its effect listed `items` as a dependency and also wrote to `items`,
-- so every pass cancelled itself on its first tick, mid-invocation. The render
-- loop is fixed separately; this clears what it left behind.
--
-- Why it matters beyond tidiness: the gallery tile treats 'processing' as
-- "being rendered right now" and shows a spinner. A permanently stranded row
-- therefore shows a spinner that will never resolve — the app claiming work is
-- under way when nothing is running. Marking them failed is the honest state,
-- and the card's automatic pass picks up anything unrendered on the next open
-- regardless of this column, so this costs no repair.
--
-- Deliberately narrow: only rows that have gone quiet. A photo genuinely being
-- processed right now is left alone.
-- ─────────────────────────────────────────────────────────────────────────────

update public.photos
set watermark_status = 'failed',
    watermark_error  = coalesce(watermark_error,
                                'Rendering was interrupted before it completed. The original capture is unaffected.')
where is_deleted is not true
  and watermark_status = 'processing'
  and storage_path_watermarked is null
  and updated_at < now() - interval '10 minutes';
