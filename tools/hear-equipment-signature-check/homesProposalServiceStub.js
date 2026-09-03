// Network only. The shared SignatureSendModal's own loading, prefill, gating
// and result rendering are the shipped ones.
//
// The Project Payment Request lives on incentive_applications, record type
// WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST (Nicholas: "those are on incentive
// objects, right?"), so the context shape is the HOMES one, not the HEAR one.
export const captured = { sent: [] }

export async function loadPaymentRequestSignatureContext() {
  return { fields: { pjPropName: 'Green Valley Estates', pjContact: 'Dennis Hanson', pjEmail: 'dennis.hanson@example.org' }, units: 8 }
}
export function paymentRequestSignatureMissing() { return [] }
export async function sendPaymentRequestForSignature(id, args) {
  captured.sent.push(args)
  return { document: { id: 'doc-2' }, envelope: 'env-2', signingUrl: 'https://leap.example/sign/inv', emailed: true }
}
