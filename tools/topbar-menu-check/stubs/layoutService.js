// Stub for tools/topbar-menu-check. The gear renders nothing for a non-admin,
// so the harness needs an Admin profile; nothing else here is exercised.
export async function getCurrentUserProfile() {
  return { roleName: 'Admin', displayName: 'Harness Admin', email: 'harness@ees-wi.org' }
}
export function getRecordTypeColumn() { return 'property_record_type' }
export async function fetchPageLayout() { return null }
export default { getCurrentUserProfile, getRecordTypeColumn, fetchPageLayout }
