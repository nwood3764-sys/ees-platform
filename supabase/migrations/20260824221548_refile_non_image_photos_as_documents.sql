-- ─────────────────────────────────────────────────────────────────────────────
-- Move files that are not photographs out of `photos` and into `documents`.
--
-- Two files were uploaded through a work step's Photos card: a .dwg and a .pdf.
-- Neither can ever be displayed as a picture, so each sat as a dark tile
-- reading "Could not render", and the automatic render pass retried them every
-- session to fail the same way.
--
-- They were never photographs. A PDF floor plan attached to a work step is a
-- DOCUMENT (Nicholas, 2026-08-24: "There's no sense tagging and geolocating and
-- watermarking a document"), and both work step layouts already carry a
-- Documents card — the Photos card simply accepted a file it should have
-- routed. The client now files a non-image as a document at upload; this moves
-- the two that got in before that.
--
-- The storage object is NOT moved. The bytes stay exactly where they were
-- written and the documents row points at the same key, so nothing has to be
-- re-uploaded and no upload can be lost by this running twice.
-- ─────────────────────────────────────────────────────────────────────────────

with misfiled as (
  select p.*
  from public.photos p
  where p.is_deleted is not true
    and p.storage_path_original is not null
    and lower(regexp_replace(p.storage_path_original, '^.*\.', '')) not in
        ('jpg','jpeg','png','gif','webp','bmp','svg','avif','ico','heic','heif','tif','tiff')
),
moved as (
  insert into public.documents
    (name, document_type, file_url, file_size_bytes, mime_type,
     related_object, related_id, storage_bucket, storage_path, requires_signature)
  select
    coalesce(m.caption, m.photo_number) || '.' ||
      lower(regexp_replace(m.storage_path_original, '^.*\.', '')),
    'attachment',
    m.storage_path_original,
    m.file_size_bytes,
    m.mime_type,
    m.related_object,
    m.related_id,
    m.storage_bucket,
    m.storage_path_original,
    false
  from misfiled m
  -- Idempotent: never file the same storage object twice.
  where not exists (
    select 1 from public.documents d
    where d.storage_path = m.storage_path_original and d.is_deleted is not true
  )
  returning storage_path
)
update public.photos p
-- `photos` carries no deletion_reason column; the documents row it moved to
-- points at the same storage key, which is the trail.
set is_deleted = true,
    deleted_at = now()
where p.id in (select id from misfiled)
  and exists (
    select 1 from public.documents d
    where d.storage_path = p.storage_path_original and d.is_deleted is not true
  );
