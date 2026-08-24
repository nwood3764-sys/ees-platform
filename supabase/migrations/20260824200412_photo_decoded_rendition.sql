-- ─────────────────────────────────────────────────────────────────────────────
-- photos.storage_path_rendition — a device-decoded JPEG standing in for an
-- original the server cannot decode.
--
-- Background (2026-08-24): iPhones capture HEIC by default. imagescript, which
-- process-photo draws the watermark with, reads JPEG/PNG/GIF only, so every
-- HEIC upload failed with "Unsupported image type", produced no watermarked
-- variant, and left the gallery pointing an <img> at the .heic original, which
-- no desktop browser can paint. process-photo was taught to decode HEIC with
-- libheif, and that works for light captures, but a 4032x3024 iPhone frame
-- exceeds the edge worker's CPU budget whenever the scene is detailed — so it
-- succeeds or fails by subject matter, which is not something evidence capture
-- can be built on.
--
-- The device has no such ceiling, and the client already re-encodes JPEGs
-- before upload. A HEIC upload now stores two objects:
--
--   storage_path_original   the untouched capture — archival source of truth,
--                           and where the camera EXIF (GPS, timestamp) is read
--   storage_path_rendition  a JPEG decoded in the browser, pixels only
--
-- process-photo takes pixels from the rendition when it exists and metadata
-- from the original either way, so the watermarked evidence file is unchanged
-- in kind: same visible tag, same camera GPS and capture time.
--
-- NULL for every JPEG capture, which is all but the HEIC ones — nothing needs
-- a rendition unless the server cannot read the original.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.photos
  add column if not exists storage_path_rendition text;

comment on column public.photos.storage_path_rendition is
  'Storage key of a device-decoded JPEG rendition of storage_path_original, '
  'written when the original is in a container the server cannot decode (HEIC/HEIF). '
  'Pixels only; camera EXIF is always read from the original. NULL when the '
  'original is directly decodable.';

-- Reprocessing sweeps look for HEIC rows still missing a rendition; keep that
-- lookup cheap without indexing the ~700-row table's decodable majority.
create index if not exists photos_missing_rendition_idx
  on public.photos (created_at)
  where storage_path_rendition is null
    and storage_path_watermarked is null
    and is_deleted is not true;
