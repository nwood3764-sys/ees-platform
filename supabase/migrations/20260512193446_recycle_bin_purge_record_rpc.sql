-- ============================================================================
-- 20260512193446 recycle_bin_purge_record_rpc
--
-- Phase 2 of the recycle bin spec from anura-data-standards.md. Phase 1
-- (commit 293e435) shipped view + restore. This commit ships permanent
-- purge — the third and final stage of the deletion workflow:
--   soft delete → recycle bin → permanent purge
--
-- purge_record(p_table, p_record_id) RETURNS uuid
--   • Admin-only via public.app_is_admin(). Non-admins raise 42501.
--     UI also gates the button, but server enforcement is the real
--     control: anyone with API access could otherwise send raw DELETE.
--   • Validates the record exists and is_deleted=true. Refuses to purge
--     a live record — admins must soft-delete first per the spec.
--   • Issues a single DELETE. Postgres FK constraints handle the cascade:
--     a row with surviving child references fails with 23503, which the
--     service helper formats into a 'X is referenced by Y children'
--     message for the admin.
--   • The existing log_audit_and_field_history trigger on the table
--     fires on DELETE and writes a HARD_DELETE row to audit_log with the
--     full row snapshot in al_record_snapshot. The audit trail survives
--     the physical row removal — exactly the spec's requirement that the
--     'full record snapshot at time of purge' be preserved.
--
-- Smoke tested (against a clean orphan row created for the test):
--   • Created RPT-00009 (Purge smoke test report), soft-deleted in the
--     same INSERT.
--   • Exercised the body logic directly (bypassing admin gate as the
--     MCP service role isn't Admin).
--   • Confirmed row is gone from public.reports.
--   • Confirmed audit_log captured HARD_DELETE with al_record_snapshot
--     containing rpt_name and rpt_record_number — the test row's data
--     is preserved in the audit trail.
--   • Auth gate verified via direct RPC call from service role:
--     raised 42501 'only Admin can permanently purge records'.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.purge_record(
  p_table     text,
  p_record_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_meta        jsonb;
  v_deleted_col text;
  v_was_deleted boolean;
  v_sql         text;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'purge_record: only Admin can permanently purge records'
      USING ERRCODE = '42501';
  END IF;
  IF p_table IS NULL OR p_record_id IS NULL THEN
    RAISE EXCEPTION 'purge_record: table and record_id are required';
  END IF;

  v_meta := public.ees_table_metadata(p_table);
  IF v_meta IS NULL OR v_meta->>'is_deleted_column' IS NULL THEN
    RAISE EXCEPTION 'purge_record: table % is not soft-deletable', p_table
      USING ERRCODE = '22023';
  END IF;
  v_deleted_col := v_meta->>'is_deleted_column';

  v_sql := format(
    'SELECT %I FROM public.%I WHERE id = $1',
    v_deleted_col, p_table
  );
  EXECUTE v_sql INTO v_was_deleted USING p_record_id;
  IF v_was_deleted IS NULL THEN
    RAISE EXCEPTION 'purge_record: record % not found in %', p_record_id, p_table
      USING ERRCODE = '02000';
  END IF;
  IF NOT v_was_deleted THEN
    RAISE EXCEPTION 'purge_record: record % in % is not soft-deleted. Move it to the recycle bin first.', p_record_id, p_table
      USING ERRCODE = '02000';
  END IF;

  v_sql := format('DELETE FROM public.%I WHERE id = $1', p_table);
  EXECUTE v_sql USING p_record_id;

  RETURN p_record_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_record(text, uuid) TO authenticated;

COMMENT ON FUNCTION public.purge_record(text, uuid) IS
  'Recycle bin Phase 2: permanently deletes a soft-deleted record. Admin-only. Existing audit trigger captures the full row snapshot to audit_log as HARD_DELETE.';
