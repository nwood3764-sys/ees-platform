// Harness for tools/layout-card-check/run.mjs — mounts the REAL card palette
// and the REAL copy-to-placement picker over the REAL canvas state shape, and
// wires them to the REAL pure transform (copyCardTo). No stubs of the thing
// under test: only the layout is fixture data.
//
// The canvas state is the live WI-IRA-MF-HOMES-PR — Enrollments layout as the
// page-layout adapter loads it — the layout that offered no way to place a
// Documents card, which is what this proves is fixed.

import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CardPaletteModal, CopyCardModal } from '../../src/modules/admin/widgets/CardPaletteModal'
import { buildCardWidget, cardCopyTargets, copyCardTo } from '../../src/lib/layoutCards.js'

const INITIAL = [
  {
    key: 'sec-1', label: 'Supporting Documentation', tab: 'Details', placement: 'main', columns: 2,
    widgets: [
      { key: 'w-fg', type: 'field_group', title: 'Fields', config: { fields: [] } },
      { key: 'w-hpxml', type: 'file_gallery', title: 'Reservation HPXMLv4 / BuildingSync File',
        config: { target: 'documents', document_type: 'reservation_hpxml' } },
    ],
  },
  {
    key: 'sec-rail', label: 'Documents', tab: 'Details', placement: 'right', columns: 1,
    widgets: [
      { key: 'w-assess', type: 'related_list', title: 'Assessments',
        config: { table: 'assessments', fk: 'building_id', columns: [{ name: 'assessment_name' }] } },
    ],
  },
  {
    key: 'sec-rel', label: 'New Section', tab: 'Related', placement: 'main', columns: 2,
    widgets: [
      { key: 'w-docs', type: 'related_list', title: 'Documents',
        config: { table: 'documents', fk: 'related_id', columns: [{ name: 'name' }] } },
    ],
  },
]

let seq = 0
const nextKey = () => String(++seq)

function Harness() {
  const [sections, setSections] = useState(INITIAL)
  const [palette, setPalette] = useState(false)
  const [copying, setCopying] = useState(null)

  // What the record page would show: every card, under the surface it renders
  // on. The check reads this, so it is asserting placement, not markup.
  const rows = []
  for (const s of sections) {
    const surface = (s.placement || 'main') === 'right' ? 'Right sidebar' : (s.tab || 'Details')
    for (const w of s.widgets) {
      if (w.type === 'field_group') continue
      rows.push({ surface, section: s.label, type: w.type, title: w.title,
        docType: w.config?.document_type || '', target: w.config?.target || '' })
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <button data-test="open-palette" onClick={() => setPalette(true)}>+ Add Card</button>
      <button data-test="copy-docs" onClick={() => setCopying({ sectionKey: 'sec-rel', widgetKey: 'w-docs' })}>
        Copy Documents
      </button>
      <button data-test="copy-new" onClick={() => setCopying({ sectionKey: 'sec-1', widgetKey: 'w-hpxml' })}>
        Copy HPXML
      </button>

      <div data-test="placements">
        {rows.map((r, i) => (
          <div key={i} data-placement
            data-surface={r.surface} data-type={r.type} data-title={r.title}
            data-doctype={r.docType} data-target={r.target}>
            {r.surface} · {r.section} · {r.type} · {r.title}
          </div>
        ))}
      </div>

      {palette && (
        <CardPaletteModal
          object="enrollments"
          objectLabel="Enrollment"
          sections={sections}
          sectionLabel="New Section"
          onPick={(cardId) => {
            setPalette(false)
            const w = buildCardWidget(cardId, 'enrollments', `w-new-${nextKey()}`)
            if (!w) return
            setSections(prev => prev.map(s => s.key !== 'sec-rel' ? s : { ...s, widgets: [...s.widgets, w] }))
          }}
          onClose={() => setPalette(false)}
        />
      )}

      {copying && (
        <CopyCardModal
          widget={sections.flatMap(s => s.widgets).find(w => w.key === copying.widgetKey)}
          targets={cardCopyTargets(sections, copying.sectionKey, [])}
          onCopy={(target) => {
            const keys = { widgetKey: `w-new-${nextKey()}`, sectionKey: `sec-new-${nextKey()}` }
            setSections(prev => copyCardTo(prev, copying.widgetKey, target, keys))
            setCopying(null)
          }}
          onClose={() => setCopying(null)}
        />
      )}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)
