// Drives the REAL filter editor against the shape describeDashboardFilterObjects
// returns, so the picker, the coverage line and the per-object mapping can be
// checked by looking at them rather than by reading the JSX.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DashboardFilterEditor } from '../../src/modules/DashboardCanvasEditor'

// The real Outreach dashboard: four widgets on properties, one on
// opportunities — the mix whose filter silently reached only four of five.
const OBJECTS = [
  { table: 'properties', label: 'Properties', columns: [
    { name: 'property_name', label: 'Name', type: 'text' },
    { name: 'property_state', label: 'State', type: 'text' },
    { name: 'property_status', label: 'Status', type: 'uuid' },
  ] },
  { table: 'opportunities', label: 'Opportunities', columns: [
    { name: 'opportunity_name', label: 'Name', type: 'text' },
    { name: 'opportunity_state', label: 'State', type: 'text' },
    { name: 'opportunity_stage', label: 'Stage', type: 'uuid' },
  ] },
  // An object with no equivalent at all — the case the coverage line has to name.
  { table: 'work_orders', label: 'Work Orders', columns: [
    { name: 'work_order_name', label: 'Name', type: 'text' },
    { name: 'work_order_status', label: 'Status', type: 'uuid' },
  ] },
]

const OPS = ['equals', 'not_equals', 'in', 'contains', 'is_null']

function Case({ id, title, initial, objects = OBJECTS }) {
  const [f, setF] = useState(initial)
  return (
    <div data-case={id} style={{ width: 300, background: '#fff', border: '1px solid #e4e9f2', borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#8fa0b8', textTransform: 'uppercase', marginBottom: 8 }}>{title}</div>
      <DashboardFilterEditor
        filter={f} ops={OPS} objects={objects}
        onUpdate={(_id, patch) => setF(prev => ({ ...prev, ...patch }))}
        onRemove={() => {}} dragHandleProps={{}} />
      <pre data-state style={{ fontSize: 10, background: '#f7f9fc', padding: 6, overflow: 'auto', margin: '8px 0 0' }}>
        {JSON.stringify({ field_name: f.field_name, field_map: f.field_map, options: f.options }, null, 1)}
      </pre>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: 16 }}>
    <Case id="fresh" title="New filter — nothing picked yet"
      initial={{ id: 'f1', label: '', field_name: '', operator: 'equals', default_value: '', options: [] }} />
    <Case id="mapped" title="State, mapped across objects"
      initial={{ id: 'f2', label: 'State', field_name: 'property_state', operator: 'equals', default_value: 'NC',
        options: { source: 'distinct', object: 'properties', field: 'property_state' },
        field_map: { properties: 'property_state', opportunities: 'opportunity_state' } }} />
    <Case id="legacy" title="Saved before the map existed"
      initial={{ id: 'f3', label: 'State', field_name: 'property_state', operator: 'equals', default_value: 'NC', options: [] }} />
    <Case id="orphan" title="Names a column no widget has"
      initial={{ id: 'f4', label: 'Program', field_name: 'enrollment_program_id', operator: 'equals', default_value: '', options: [] }} />
  </div>
)
