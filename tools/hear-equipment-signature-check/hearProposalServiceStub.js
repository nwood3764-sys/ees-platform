// Network only. SignatureSendModal's own loading, prefill, gating and result
// rendering are the shipped ones.
export const captured = { sent: [] }

// The real context shape, from a live HEAR reservation: the recipient is
// PRE-FILLED FROM THE RECORD, which is exactly why the modal shows it rather
// than sending quietly.
export async function loadHearProposalContext() {
  return {
    enr: { enrollment_name: '570 South Clark Street - Whitewater - 570 - WI-IRA-MF-HEAR-Project-Reservation' },
    fields: { pjContact: 'Dennis Hanson', pjEmail: 'dennis.hanson@example.org', pjPropName: 'Green Valley Estates' },
    units: 8, rows: [{ cost: 12800 }], contractor: 'EES',
  }
}
export function hearProposalMissing() { return [] }
export async function sendHearProposalForSignature(id, args) {
  captured.sent.push(args)
  return { document: { id: 'doc-1' }, envelope: 'env-1', signingUrl: 'https://leap.example/sign/abc', emailed: true }
}
