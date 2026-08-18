-- =============================================================================
-- Storage: private buckets are for INTERNAL STAFF only.
--
-- Found 2026-08-18 while diagnosing broken photos in the Property Owner Portal.
-- Every private bucket carried a blanket policy of the form
--
--     TO authenticated USING (bucket_id = '<bucket>')
--
-- which grants the WHOLE bucket to ANY authenticated user, for all four verbs.
-- Portal users (property owners, service providers) authenticate through the
-- same Supabase Auth instance and therefore hold the `authenticated` role — so
-- once portal login started working (2026-08-18), any portal user could list,
-- download, overwrite, or DELETE every object in work-evidence,
-- property-documents, program-applications, service-provider-documents,
-- templates, signatures, communications-attachments and fleet-evidence,
-- including other owners' properties. Nothing exploited this: until today no
-- external user had ever been able to sign in.
--
-- The fix keeps each policy exactly as it was and adds one condition:
-- current_app_user_id() IS NOT NULL. That function resolves auth.uid() to a
-- public.users row — which every internal staff member has and NO portal user
-- ever has (portal identities live in portal_users). Internal behaviour is
-- unchanged; external users lose direct storage access entirely.
--
-- No portal code path is affected: neither portal client touches
-- supabase.storage at all. Portal media is served exclusively through the
-- purpose-built `portal-photo-urls` edge function, which re-checks the caller's
-- property grants and mints short-lived signed URLs with the service role.
--
-- portal-uploads is locked the same way deliberately. It is unused today; when
-- portal document upload is built it gets its own grant-scoped policy rather
-- than inheriting a blanket one.
--
-- The public buckets (avatars, record-type-icons) are untouched, and
-- knowledge-base already scopes by internal role name.
-- =============================================================================

-- communications-attachments
ALTER POLICY communications_attachments_authenticated_select ON storage.objects
  USING (bucket_id = 'communications-attachments'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY communications_attachments_authenticated_insert ON storage.objects
  WITH CHECK (bucket_id = 'communications-attachments'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY communications_attachments_authenticated_update ON storage.objects
  USING (bucket_id = 'communications-attachments'::text AND public.current_app_user_id() IS NOT NULL)
  WITH CHECK (bucket_id = 'communications-attachments'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY communications_attachments_authenticated_delete ON storage.objects
  USING (bucket_id = 'communications-attachments'::text AND public.current_app_user_id() IS NOT NULL);

-- fleet-evidence
ALTER POLICY fleet_evidence_authenticated_read ON storage.objects
  USING (bucket_id = 'fleet-evidence'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY fleet_evidence_authenticated_insert ON storage.objects
  WITH CHECK (bucket_id = 'fleet-evidence'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY fleet_evidence_authenticated_update ON storage.objects
  USING (bucket_id = 'fleet-evidence'::text AND public.current_app_user_id() IS NOT NULL)
  WITH CHECK (bucket_id = 'fleet-evidence'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY fleet_evidence_authenticated_delete ON storage.objects
  USING (bucket_id = 'fleet-evidence'::text AND public.current_app_user_id() IS NOT NULL);

-- portal-uploads (unused today; portal upload gets its own grant-scoped policy)
ALTER POLICY portal_uploads_authenticated_read ON storage.objects
  USING (bucket_id = 'portal-uploads'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY portal_uploads_authenticated_insert ON storage.objects
  WITH CHECK (bucket_id = 'portal-uploads'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY portal_uploads_authenticated_update ON storage.objects
  USING (bucket_id = 'portal-uploads'::text AND public.current_app_user_id() IS NOT NULL)
  WITH CHECK (bucket_id = 'portal-uploads'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY portal_uploads_authenticated_delete ON storage.objects
  USING (bucket_id = 'portal-uploads'::text AND public.current_app_user_id() IS NOT NULL);

-- program-applications
ALTER POLICY program_applications_authenticated_read ON storage.objects
  USING (bucket_id = 'program-applications'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY program_applications_authenticated_insert ON storage.objects
  WITH CHECK (bucket_id = 'program-applications'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY program_applications_authenticated_update ON storage.objects
  USING (bucket_id = 'program-applications'::text AND public.current_app_user_id() IS NOT NULL)
  WITH CHECK (bucket_id = 'program-applications'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY program_applications_authenticated_delete ON storage.objects
  USING (bucket_id = 'program-applications'::text AND public.current_app_user_id() IS NOT NULL);

-- property-documents
ALTER POLICY property_documents_authenticated_read ON storage.objects
  USING (bucket_id = 'property-documents'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY property_documents_authenticated_insert ON storage.objects
  WITH CHECK (bucket_id = 'property-documents'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY property_documents_authenticated_update ON storage.objects
  USING (bucket_id = 'property-documents'::text AND public.current_app_user_id() IS NOT NULL)
  WITH CHECK (bucket_id = 'property-documents'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY property_documents_authenticated_delete ON storage.objects
  USING (bucket_id = 'property-documents'::text AND public.current_app_user_id() IS NOT NULL);

-- signatures (no delete policy exists)
ALTER POLICY signatures_authenticated_read ON storage.objects
  USING (bucket_id = 'signatures'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY signatures_authenticated_insert ON storage.objects
  WITH CHECK (bucket_id = 'signatures'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY signatures_authenticated_update ON storage.objects
  USING (bucket_id = 'signatures'::text AND public.current_app_user_id() IS NOT NULL)
  WITH CHECK (bucket_id = 'signatures'::text AND public.current_app_user_id() IS NOT NULL);

-- service-provider-documents
ALTER POLICY sp_documents_authenticated_read ON storage.objects
  USING (bucket_id = 'service-provider-documents'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY sp_documents_authenticated_insert ON storage.objects
  WITH CHECK (bucket_id = 'service-provider-documents'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY sp_documents_authenticated_update ON storage.objects
  USING (bucket_id = 'service-provider-documents'::text AND public.current_app_user_id() IS NOT NULL)
  WITH CHECK (bucket_id = 'service-provider-documents'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY sp_documents_authenticated_delete ON storage.objects
  USING (bucket_id = 'service-provider-documents'::text AND public.current_app_user_id() IS NOT NULL);

-- templates
ALTER POLICY templates_authenticated_read ON storage.objects
  USING (bucket_id = 'templates'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY templates_authenticated_insert ON storage.objects
  WITH CHECK (bucket_id = 'templates'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY templates_authenticated_update ON storage.objects
  USING (bucket_id = 'templates'::text AND public.current_app_user_id() IS NOT NULL)
  WITH CHECK (bucket_id = 'templates'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY templates_authenticated_delete ON storage.objects
  USING (bucket_id = 'templates'::text AND public.current_app_user_id() IS NOT NULL);

-- work-evidence
ALTER POLICY work_evidence_authenticated_read ON storage.objects
  USING (bucket_id = 'work-evidence'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY work_evidence_authenticated_insert ON storage.objects
  WITH CHECK (bucket_id = 'work-evidence'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY work_evidence_authenticated_update ON storage.objects
  USING (bucket_id = 'work-evidence'::text AND public.current_app_user_id() IS NOT NULL)
  WITH CHECK (bucket_id = 'work-evidence'::text AND public.current_app_user_id() IS NOT NULL);
ALTER POLICY work_evidence_authenticated_delete ON storage.objects
  USING (bucket_id = 'work-evidence'::text AND public.current_app_user_id() IS NOT NULL);
