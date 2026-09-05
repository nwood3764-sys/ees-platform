// Harness for tools/page-layout-alignment-check/run.mjs.
//
// Mounts the REAL FieldGroupWidget from RecordDetail with the REAL field
// configs prod stores, at the widths the record page actually gives a section,
// and puts the PRE-FIX grid on the same page as a positive control.
//
// Nicholas, 2026-09-03: "There's only one field on each side, but they're
// staggered. This can't happen." Two separate things make a section look
// staggered and only a browser can see either: an empty grid slot, and a
// separator that stops halfway across because the cell beside it was shorter.

import { createRoot } from 'react-dom/client'
import { DndContext } from '@dnd-kit/core'
import { FieldGroupWidget } from '../../src/components/RecordDetail'
import { FieldRowGrid } from '../../src/modules/admin/LayoutCanvasEditor'
import { C } from '../../src/data/constants'

const params = new URLSearchParams(location.search)
const WIDTH = Number(params.get('width')) || 1180

// ── The reported section, exactly as prod stores it now ─────────────────────
const SERVICE_PROVIDER = {
  cols: 2,
  fields: [
    { name: 'account_tax_classification', type: 'text', label: 'Tax Classification' },
    { name: 'account_fein', type: 'text', label: 'Tax Identification FEIN' },
  ],
}

// ...and exactly as it stored it BEFORE the migration. The control below
// renders this through the pre-fix placement.
const SERVICE_PROVIDER_LEGACY = [
  { name: 'account_fein', type: 'text', label: 'Tax Identification FEIN', column: 2 },
  { name: 'account_tax_classification', type: 'text', label: 'Tax Classification', column: 1 },
]

// ── A whole three-column section, spacers and all ───────────────────────────
const ACCOUNT_INFORMATION = {
  cols: 3,
  fields: [
    { name: 'account_name', type: 'text', label: 'Name', required: true },
    { name: 'account_phone', type: 'phone', label: 'Phone' },
    { name: 'parent_account_id', type: 'lookup', label: 'Parent Account', lookup_field: 'account_name', lookup_table: 'accounts' },
    { name: 'billing_street', label: 'Billing Street' },
    { name: 'account_email', label: 'Email' },
    { name: 'account_contact_id', type: 'lookup', label: 'Account Contact', lookup_field: 'contact_name', lookup_table: 'contacts' },
    { name: 'billing_city', label: 'Billing City' },
    { name: 'account_website', type: 'text', label: 'Website' },
    { type: 'spacer' },
    { name: 'billing_state', label: 'Billing State' },
    { type: 'spacer' },
    { type: 'spacer' },
    { name: 'billing_zip', label: 'Billing Zip' },
  ],
}

// ── A section whose values are of wildly different heights ──────────────────
// "If something's like two or three lines, the other ones just need to adjust."
// One value here wraps to three lines and its neighbour is a single word: the
// separator under that row must still be one straight line.
const UNEVEN = {
  cols: 2,
  fields: [
    { name: 'long_one', type: 'text', label: 'Property Owner Legal Entity Name' },
    { name: 'short_one', type: 'text', label: 'State' },
    { name: 'short_two', type: 'text', label: 'Zip' },
    { name: 'long_two', type: 'text', label: 'Management Agent Mailing Address' },
    { name: 'odd_one_out', type: 'text', label: 'Units' },
  ],
}

const RECORD = {
  id: '97ea0f0b-f34c-4f8e-95b8-3e769c07791e',
  account_tax_classification: 'C Corporation',
  account_fein: '39-1234567',
  account_name: 'Community Management Corporation',
  account_phone: '6085551234',
  parent_account_id: null,
  billing_street: '2801 International Lane, Suite 210',
  account_email: 'accounting@example.org',
  account_contact_id: null,
  billing_city: 'Madison',
  account_website: 'https://example.org',
  billing_state: 'WI',
  billing_zip: '53704',
  long_one: 'Wisconsin Housing Preservation Corporation Limited Partnership Number Seventeen of Dane County',
  short_one: 'WI',
  short_two: '53704',
  long_two: '2801 International Lane, Suite 210, Madison, Wisconsin 53704, United States of America',
  odd_one_out: '17',
}

const PICKLISTS = { byId: new Map(), valueById: new Map(), metaById: new Map() }

function Group({ label, spec, testId }) {
  return (
    <div data-test={testId} style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      marginBottom: 16, overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, background: '#fafbfd', fontSize: 13, fontWeight: 600 }}>
        {label}
      </div>
      <FieldGroupWidget
        widget={{ id: testId, widget_config: { fields: spec.fields } }}
        record={RECORD}
        picklists={PICKLISTS}
        lookups={new Map()}
        editing={false}
        draft={{}}
        onChange={() => {}}
        allPicklistOpts={{}}
        allLookupOpts={{}}
        onRefreshRecord={() => {}}
        recordId={RECORD.id}
        fieldDisabledReasons={null}
        onNavigateToRecord={() => {}}
        requiredFields={new Set()}
        tableName="accounts"
        createRelatedValues={null}
        sectionColumns={spec.cols}
      />
    </div>
  )
}

// ── POSITIVE CONTROL — the placement as it shipped before 2026-09-03 ────────
// A 2-column CSS grid, auto-flow row, every field carrying an explicit
// grid-column-start read off its stored `column`, cells top-aligned, and the
// separator on each CELL. If the checks below pass this too, they are
// measuring nothing.
function LegacyGroup({ label, fields, testId }) {
  return (
    <div data-test={testId} style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      marginBottom: 16, overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, background: '#fafbfd', fontSize: 13, fontWeight: 600 }}>
        {label}
      </div>
      <div data-legacy-grid style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gridAutoFlow: 'row', alignItems: 'start',
      }}>
        {fields.map((f, i) => (
          <div key={f.name} data-legacy-cell style={{ gridColumnStart: f.column === 2 ? 2 : 1 }}>
            <div style={{
              padding: '12px 16px', borderBottom: `1px solid ${C.border}`,
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                {f.label}
              </span>
              <span style={{ fontSize: 13, color: C.textPrimary, wordBreak: 'break-word' }}>
                {RECORD[f.name] || '—'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── WYSIWYG — the page-layout editor's own grid, same rule, same fields ─────
// The editor and the record page disagreeing about placement is the defect
// this whole change is about, so the check renders both and requires the rows
// to match. The editor's tiles are labelled, so the runner can read the order
// straight off them.
function EditorGrid({ label, spec, testId }) {
  return (
    <div data-test={testId} style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      marginBottom: 16, overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, background: '#fafbfd', fontSize: 13, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ padding: 12 }}>
        <DndContext>
          <FieldRowGrid
            cols={spec.cols}
            fields={spec.fields}
            object="accounts"
            sectionKey={testId}
            onChange={() => {}}
          />
        </DndContext>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <div style={{ padding: 16 }}>
    <div data-test="main-column" style={{ width: WIDTH }}>
      <Group testId="service-provider" label="Service Provider Information" spec={SERVICE_PROVIDER} />
      <Group testId="account-information" label="Account Information" spec={ACCOUNT_INFORMATION} />
      <Group testId="uneven" label="Uneven Values" spec={UNEVEN} />
      <EditorGrid testId="editor-account-information"
        label="Page layout editor — Account Information" spec={ACCOUNT_INFORMATION} />
      <EditorGrid testId="editor-service-provider"
        label="Page layout editor — Service Provider Information" spec={SERVICE_PROVIDER} />
      <LegacyGroup testId="legacy-service-provider"
        label="CONTROL — Service Provider Information, pre-fix placement"
        fields={SERVICE_PROVIDER_LEGACY} />
      <LegacyGroup testId="legacy-uneven"
        label="CONTROL — Uneven Values, pre-fix placement"
        fields={UNEVEN.fields.map((f, i) => ({ ...f, column: (i % 2) + 1 }))} />
    </div>
  </div>
)
