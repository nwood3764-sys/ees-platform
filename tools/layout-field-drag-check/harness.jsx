// Harness for tools/layout-field-drag-check/run.mjs.
//
// Mounts the REAL FieldRowGrid from the page-layout editor, inside a REAL
// DndContext using the editor's own sensors and its own collision detection,
// over the REAL field array production stores for the layout Nicholas
// reported: assessments · WI-IRA-MF-HOMES-AUDIT · "Information", 2 columns.
//
// Which droppable a given pixel belongs to is not a fact anyone can read off
// the source — the insertion line is 14px of gutter overlaying two tiles, and
// whether the pointer lands on it or on the tile is decided by the browser's
// layout. So the runner performs real mouse drags on this page.
//
// The CONTROL grid beside it is identical in every respect except that it
// resolves the drop the way the editor did before 2026-09-05: remove the
// dragged field, find the drop target BY NAME in what is left, insert before
// it. The same drag must come back a no-op there. If it ever stops being one,
// this check has stopped reproducing the reported bug.

import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { FieldRowGrid, canvasCollisionDetection, applyFieldDropToSections } from '../../src/modules/admin/LayoutCanvasEditor'
import { legacyInsertBeforeByName, parseFieldDropId } from '../../src/lib/fieldGroupPlacement'
import { C } from '../../src/data/constants'

const f = (name, label) => ({ name, type: 'text', label })

// Read off page_layout_widgets.widget_config on production, 2026-09-05.
const INFORMATION = [
  f('assessment_name', 'Name'),
  f('opportunity_id', 'Opportunity'),
  f('building_id', 'Building'),
  f('project_id', 'Project'),
  f('assessment_property_contact_for_iq_assessment', 'Property Contact for IQ Assessment'),
  f('property_id', 'Property'),
  f('assessment_gas_fuel_provider', 'Gas Fuel Provider'),
  f('assessment_assessor_name', 'Assessor Name'),
  f('assessment_date_of_iq_assessment', 'Date Of Iq Assessment'),
  { type: 'spacer' },
  f('assessment_start_time_of_iq_assessment', 'Start Time Of Iq Assessment'),
  { type: 'spacer' },
  f('assessment_end_time_of_iq_assessment', 'End Time Of Iq Assessment'),
]

const OCCUPANCY = [
  f('assessment_building_sq_ft', 'Building Sq Ft'),
  f('assessment_number_of_units', 'Number Of Units'),
]

const section = (key, label, columns, fields) => ({
  key, label, columns, tab: 'Details', placement: 'main',
  widgets: [{ key: `w-${key}`, type: 'field_group', title: 'Fields', config: { fields } }],
})

const INITIAL = [
  section('information', 'Information', 2, INFORMATION),
  section('occupancy', 'Occupancy', 2, OCCUPANCY),
]

function Grid({ testId, section: sec }) {
  return (
    <div data-test={testId} style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 14,
    }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 600 }}>
        {sec.label}
      </div>
      <div style={{ padding: 12 }}>
        <FieldRowGrid
          cols={sec.columns}
          fields={sec.widgets[0].config.fields}
          object="assessments"
          sectionKey={sec.key}
          onChange={() => {}}
        />
      </div>
    </div>
  )
}

// The editor as it ships.
function Live() {
  const [sections, setSections] = useState(INITIAL)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  window.__liveSections = sections
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={canvasCollisionDetection}
      onDragEnd={({ active, over }) => {
        window.__lastOver = over ? String(over.id) : null
        if (!over || active.id === over.id) return
        setSections(prev => applyFieldDropToSections(prev, String(active.id), String(over.id)))
      }}>
      <div style={{ width: 900 }}>
        {sections.map(s => <Grid key={s.key} testId={`live-${s.key}`} section={s} />)}
      </div>
    </DndContext>
  )
}

// CONTROL — the same grid, the same drags, the pre-2026-09-05 resolution.
function Control() {
  const [fields, setFields] = useState(INFORMATION)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={canvasCollisionDetection}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return
        const from = parseFieldDropId(String(active.id))
        const to = parseFieldDropId(String(over.id))
        if (!from || from.kind !== 'cell' || !to) return
        const activeName = fields[from.index]?.name
        const overName = to.kind === 'cell' ? fields[to.index]?.name : null
        setFields(prev => legacyInsertBeforeByName(prev, activeName, overName))
      }}>
      <div style={{ width: 900 }}>
        <Grid testId="control-information"
          section={section('control', 'CONTROL — Information, pre-fix drop resolution', 2, fields)} />
      </div>
    </DndContext>
  )
}

createRoot(document.getElementById('root')).render(
  <div style={{ padding: 16 }}>
    <Live />
    <Control />
  </div>
)
