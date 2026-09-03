// The two screens shipped today that had never been opened in a browser:
// the opportunity Products card's equipment step, and Send Proposal for
// Signature. Both are the REAL components; only their service modules are
// swapped for the network.

import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { ToastProvider } from '../../src/components/Toast'
import OpportunityProductsWidget from '../../src/components/OpportunityProductsWidget'
import SendHearProposalModal from '../../src/components/SendHearProposalModal'
import { captured as productsCaptured } from './opportunityProductsServiceStub'
import { captured as proposalCaptured } from './hearProposalServiceStub'

window.__products = productsCaptured
window.__proposal = proposalCaptured

function Harness() {
  const [showModal, setShowModal] = useState(false)
  window.__openModal = () => setShowModal(true)
  return (
    <ToastProvider>
      <div data-test="products" style={{ padding: 16 }}>
        <OpportunityProductsWidget
          widget={{ id: 'w1', widget_config: { table: 'opportunity_line_items', fk: 'opportunity_id' } }}
          opportunityId="opp-199"
          onNavigateToRecord={() => {}}
        />
      </div>
      <button data-test="open-modal" onClick={() => setShowModal(true)}>Send Proposal for Signature</button>
      {showModal && (
        <SendHearProposalModal
          enrollmentId="enr-77"
          onClose={() => setShowModal(false)}
          onSent={() => {}}
        />
      )}
    </ToastProvider>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)
