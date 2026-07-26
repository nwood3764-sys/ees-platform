import { C } from '../data/constants'
import { Icon } from './UI'
import RecordLink from './RecordLink'

// ─── Duplicate Check Panel ─────────────────────────────────────────────────
//
// Create-time duplicate warning for accounts, properties, and buildings
// (Nicholas, 2026-07-26: "There has to be something that warns the user if
// there's a duplicate or even a close match"). RecordDetail's create form
// debounce-probes the find_duplicate_candidates RPC as the user types the
// name / address fields and renders this panel with whatever comes back.
//
// The warning never blocks outright — the first Save press with unreviewed
// matches asks the user to confirm; pressing Save again creates the record.
// One account per real-world company: if the record already exists, open it
// from the link here instead of creating a second one.

export const DUPLICATE_CHECK_TABLES = ['accounts', 'properties', 'buildings']

// Builds the find_duplicate_candidates RPC params from the create-form
// draft, or returns null when the draft has nothing worth probing yet.
export function buildDuplicateProbe(tableName, draft) {
  if (!draft) return null
  const clean = (v) => {
    const s = (v == null ? '' : String(v)).trim()
    return s.length >= 3 ? s : null
  }
  if (tableName === 'accounts') {
    const name = clean(draft.account_name) || clean(draft.account_organization_name)
    if (!name) return null
    return { p_object: 'accounts', p_name: name }
  }
  if (tableName === 'properties') {
    const name = clean(draft.property_name)
    const street = clean(draft.property_street)
    if (!name && !street) return null
    return {
      p_object: 'properties',
      p_name:   name,
      p_street: street,
      p_city:   clean(draft.property_city),
      p_state:  clean(draft.property_state),
      p_zip:    (draft.property_zip == null ? null : String(draft.property_zip).trim()) || null,
    }
  }
  if (tableName === 'buildings') {
    const name = (draft.building_number_or_name == null ? '' : String(draft.building_number_or_name)).trim()
    if (!name || !draft.property_id) return null
    return { p_object: 'buildings', p_name: name, p_property_id: draft.property_id }
  }
  return null
}

const OBJECT_LABELS = {
  accounts:   'account',
  properties: 'property',
  buildings:  'building',
}

export default function DuplicateCheckPanel({ tableName, matches, confirming, onNavigateToRecord }) {
  if (!matches || matches.length === 0) return null
  const objectLabel = OBJECT_LABELS[tableName] || 'record'
  const exact = matches.some(m => m.match_type === 'exact_name' || m.match_type === 'same_address')

  return (
    <div style={{
      background: '#e8f1fb', border: '1px solid #bcd9f2', borderRadius: 8,
      padding: '12px 16px', marginBottom: 16, fontSize: 12, color: '#1e466b',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
        <Icon path="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" size={14} color="#1e466b" />
        {exact
          ? `A matching ${objectLabel} may already exist`
          : `Similar ${objectLabel} records found`}
      </div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {matches.map(m => (
          <div key={m.record_id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <RecordLink
              table={tableName}
              id={m.record_id}
              title={`Open ${m.record_name} in a new tab`}
              onActivate={() => onNavigateToRecord?.({ table: tableName, id: m.record_id, mode: 'view' })}
              style={{ color: '#1a5a8a', fontWeight: 600 }}
            >
              {m.record_name}
            </RecordLink>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.textSecondary }}>
              {m.record_number}
            </span>
            <span style={{ color: C.textSecondary }}>— {m.match_detail}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, color: C.textSecondary }}>
        {confirming
          ? `Press Save again to create this ${objectLabel} anyway.`
          : `One ${objectLabel} per real-world ${tableName === 'accounts' ? 'company' : objectLabel} — if it already exists, open it from the link above instead of creating a new record. Tip: Ctrl/Cmd-click opens it in a new tab so this form is kept.`}
      </div>
    </div>
  )
}
