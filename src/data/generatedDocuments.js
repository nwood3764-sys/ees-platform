// ---------------------------------------------------------------------------
// generatedDocuments — the registry of documents LEAP builds from a record and
// shows in GeneratedDocumentModal: what each is called, and which service
// produces and files it.
//
// One registry rather than a modal per programme. The chrome is identical for
// every one of these — generate on open, preview inline, Download, Save to the
// record's Documents, and say exactly what is missing when the record isn't
// ready — so a new programme's document is an entry here plus its own service,
// never another copy of the modal.
//
// A `kind` here is what the record action passes; each entry names the object(s)
// its document belongs to, and the action itself is what gates the record type.
// ---------------------------------------------------------------------------

import { generateHomesDocument, saveHomesDocument } from './homesProposalService'
import { generateHearProposal, saveHearProposal } from './hearProposalService'

export const GENERATED_DOCUMENTS = {
  // WI IRA Multifamily HOMES — built from the two Asset Score reports.
  proposal: {
    title: 'Generate Proposal', noun: 'proposal',
    objects: ['enrollments'],
    generate: ({ object, id }) => generateHomesDocument({ object, id, kind: 'proposal' }),
    save: saveHomesDocument,
  },
  invoice: {
    title: 'Generate Payment Request Invoice', noun: 'invoice',
    objects: ['incentive_applications'],
    generate: ({ object, id }) => generateHomesDocument({ object, id, kind: 'invoice' }),
    save: saveHomesDocument,
  },
  audit: {
    title: 'Generate Assessment Invoice', noun: 'invoice',
    objects: ['enrollments'],
    generate: ({ object, id }) => generateHomesDocument({ object, id, kind: 'audit' }),
    save: saveHomesDocument,
  },
  // IRA Multifamily HEAR — built from the opportunity's line items. No Asset
  // Score is read: a HEAR project is a list of equipment, not a modelled saving.
  hear_proposal: {
    title: 'Generate Proposal', noun: 'proposal',
    objects: ['enrollments'],
    generate: ({ id }) => generateHearProposal(id),
    save: saveHearProposal,
  },
}

export function generatedDocumentSpec(kind) {
  return GENERATED_DOCUMENTS[kind] || null
}
