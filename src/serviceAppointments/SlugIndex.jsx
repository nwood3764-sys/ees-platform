// ─── SlugIndex.jsx ───────────────────────────────────────────────────────────
// Landing page at /sa — lists the 4 customer-schedulable assessment types and
// links to each scheduling flow. Hardcoded to match WT-00072..00075. When the
// catalog grows, this should fetch from compute-availability's work_types
// catalog or an /api/work-types endpoint.

import { C, card, RADIUS } from './styles'

const SERVICES = [
  {
    slug:        'single-family-assessment',
    title:       'Single-Family Energy Assessment',
    description: 'A 90-minute home energy assessment for single-family residences. A BPI-certified auditor inspects insulation, air sealing, HVAC, and appliances and identifies eligible incentives.',
    duration:    '90 minutes',
  },
  {
    slug:        'townhome-assessment',
    title:       'Townhome Energy Assessment',
    description: 'A 90-minute energy assessment for attached townhome residences. Same scope as single-family with attention to shared-wall conditions.',
    duration:    '90 minutes',
  },
  {
    slug:        'multifamily-energy-assessment',
    title:       'Multifamily Energy Assessment',
    description: 'A scoping walk-through for multifamily properties (60 minutes per building). A multifamily-certified auditor evaluates common-area systems and a representative unit sample.',
    duration:    '60 minutes per building',
  },
  {
    slug:        'multifamily-diagnostic-assessment',
    title:       'Multifamily Diagnostic Assessment',
    description: 'A deep diagnostic for multifamily properties (120 minutes per building) including blower-door testing and detailed envelope analysis.',
    duration:    '120 minutes per building',
  },
]

export default function SlugIndex() {
  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        Schedule a home energy assessment
      </h1>
      <p style={{ color: C.textSecondary, marginBottom: 24, fontSize: 15, lineHeight: 1.5 }}>
        Choose the service that matches your property. A BPI-certified auditor will visit
        your home, evaluate efficiency opportunities, and identify rebate-eligible upgrades.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {SERVICES.map(s => (
          <a key={s.slug}
             href={`/sa/${s.slug}`}
             style={{
               ...card,
               textDecoration:  'none',
               color:           'inherit',
               display:         'block',
               transition:      'border-color 0.15s ease, transform 0.05s ease',
             }}
             onMouseEnter={e => e.currentTarget.style.borderColor = C.emerald}
             onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
          >
            <div style={{
              display:        'flex',
              justifyContent: 'space-between',
              alignItems:     'flex-start',
              gap:            16,
              flexWrap:       'wrap',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>
                  {s.title}
                </div>
                <div style={{ color: C.textSecondary, fontSize: 14, lineHeight: 1.5 }}>
                  {s.description}
                </div>
              </div>
              <div style={{
                fontSize:     12,
                fontWeight:   600,
                color:        C.emeraldMid,
                background:   C.emeraldBg,
                padding:      '6px 10px',
                borderRadius: RADIUS / 2,
                whiteSpace:   'nowrap',
              }}>
                {s.duration}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
