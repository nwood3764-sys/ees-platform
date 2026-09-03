// The two screens shipped today that had never been opened in a browser:
// the opportunity Products card's equipment step, and Send Proposal for
// Signature. Both are the REAL components; only their service modules are
// swapped for the network.

import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { ToastProvider } from '../../src/components/Toast'
import OpportunityProductsWidget from '../../src/components/OpportunityProductsWidget'
import SignatureSendModal from '../../src/components/SignatureSendModal'
import { captured as productsCaptured } from './opportunityProductsServiceStub'
import { captured as proposalCaptured } from './hearProposalServiceStub'
import { captured as invoiceCaptured } from './homesProposalServiceStub'

window.__products = productsCaptured
window.__proposal = proposalCaptured
window.__invoice = invoiceCaptured

function Harness() {
  // null | 'hear_proposal' | 'payment_request' — the same modal, both documents.
  const [kind, setKind] = useState(null)
  return (
    <ToastProvider>
      <div data-test="products" style={{ padding: 16 }}>
        <OpportunityProductsWidget
          widget={{ id: 'w1', widget_config: { table: 'opportunity_line_items', fk: 'opportunity_id' } }}
          opportunityId="opp-199"
          onNavigateToRecord={() => {}}
        />
      </div>
      <button data-test="open-modal" onClick={() => setKind('hear_proposal')}>Send Proposal for Signature</button>
      <button data-test="open-invoice" onClick={() => setKind('payment_request')}>Send Invoice for Signature</button>
      {kind && (
        <SignatureSendModal
          kind={kind}
          recordId={kind === 'hear_proposal' ? 'enr-77' : 'ia-6'}
          onClose={() => setKind(null)}
          onSent={() => {}}
        />
      )}
    </ToastProvider>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)
