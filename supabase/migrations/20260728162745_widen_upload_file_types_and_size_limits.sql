-- Widen storage upload policy so staff stop hitting "mime type X is not
-- supported" on legitimate business/field files.
--
-- Context: internal document buckets carried tight allowed_mime_types lists and
-- a 50 MB cap, which blocked video, HEIC (iPhone) photos, PowerPoint, archives,
-- AutoCAD (.dwg/.dxf), Matterport/point-cloud exports, and energy-model files.
-- Many of those exotic-but-legitimate formats reach the browser as a generic
-- binary type (application/octet-stream or an empty type), so an allowlist
-- cannot reliably pass them without effectively allowing everything. Three
-- buckets (communications-attachments, fleet-evidence, service-provider-
-- documents) already accept any type, so this brings the internal document and
-- field-evidence buckets in line with that precedent. Files are only ever served
-- back as downloads via signed URLs, never executed.
--
-- Size: raised to 5 GiB on the internal buckets because 360 / 4K / drone video
-- and 3D scans routinely exceed 50 MB. NOTE: the project-level Storage upload
-- limit (Supabase Dashboard -> Storage -> Settings) is the hard ceiling and
-- caps the effective per-file size; it must be raised there too and cannot be
-- set from a migration.

-- Internal staff buckets: accept any file type; 5 GiB cap.
update storage.buckets
set allowed_mime_types = null,
    file_size_limit = 5368709120
where id in ('property-documents', 'program-applications', 'work-evidence');

-- External customer portal: curated allowlist (no executables), broadened to
-- the common real-world set; 500 MiB cap.
update storage.buckets
set allowed_mime_types = array[
      'application/pdf',
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/tiff',
      'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain', 'text/csv', 'text/xml', 'application/xml',
      'application/zip', 'application/x-zip-compressed'
    ],
    file_size_limit = 524288000
where id = 'portal-uploads';
