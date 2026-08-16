// Fixture test for the create pop-up's field selection.
//
// The rule the whole "New = pop-up, required fields only" behavior rests on:
// which of a page layout's fields the pop-up asks for. Run with
//   node scripts/create-modal-fields-fixture.mjs
//
// Modeled on a real Buildings layout created from a Property, which is the case
// that started this (Nicholas, 2026-08-16: the full-page create form showed
// dozens of fields and an empty Type dropdown).

import {
  buildCreateModalGroups,
  listUnlaidOutRequiredColumns,
} from '../src/lib/createRecordFields.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures += 1
    console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`)
  }
}

// A buildings page layout: two sections, mixed field types, one field an admin
// marked required on the layout, one computed field, one spacer, one column-
// pinned field, and one field the user has no write permission for.
const sections = [
  {
    id: 'sec-1',
    section_label: 'Building Information',
    widgets: [{
      widget_type: 'field_group',
      widget_config: {
        fields: [
          { name: 'property_id', label: 'Property', type: 'lookup', column: 1 },
          { name: 'building_number_or_name', label: 'Building Number or Name', type: 'text', column: 1 },
          { name: 'building_name', label: 'Name', type: 'text' },              // trigger-derived
          { name: 'building_address', label: 'Building Address', type: 'text', column: 2 },
          { name: 'building_type', label: 'Type', type: 'picklist', column: 3 },
          { name: 'building_year_built', label: 'Year Built', type: 'number', required: true },
          { name: 'building_record_number', label: 'Building Number', type: 'text' },   // system
          { name: 'building_created_by', label: 'Created By', type: 'lookup' },         // system
          { type: 'spacer', spacer_id: 'sp-1' },
        ],
      },
    }],
  },
  {
    id: 'sec-2',
    section_label: 'Energy',
    widgets: [
      {
        widget_type: 'field_group',
        widget_config: {
          fields: [
            { name: 'building_total_units', label: 'Total Units', type: 'rollup' },       // computed
            { name: 'property_id.property_state', label: 'State', type: 'related_field' },// cross-object
            { name: 'building_notes', label: 'Notes', type: 'textarea' },
            { name: 'building_electric_utility', label: 'Electric Utility', type: 'text', _editable: false },
          ],
        },
      },
      // Related lists are cards, never create-form fields.
      { widget_type: 'related_list', widget_config: { table: 'units', fk: 'building_id' } },
    ],
  },
]

const requiredFields = new Set([
  'building_created_by', 'building_name', 'building_number_or_name',
  'building_owner', 'building_record_number', 'property_id',
])
const neverAsk = new Set(['building_name'])   // trg_building_name composes it

// ── Required-only (the default pop-up) ────────────────────────────────────────
const req = buildCreateModalGroups(sections, { requiredFields, showAll: false, neverAsk })
check('required-only: one section kept',
  req.groups.map(g => g.title), ['Building Information'])
check('required-only: fields, in layout order',
  req.groups[0].fields.map(f => f.name),
  ['property_id', 'building_number_or_name', 'building_year_built'])
check('required-only: layout-required field is marked required',
  req.groups[0].fields.find(f => f.name === 'building_year_built').required, true)
check('required-only: column pinning dropped',
  req.groups[0].fields.every(f => !('column' in f)), true)

// ── Show all fields (the pop-up's expander) ───────────────────────────────────
const all = buildCreateModalGroups(sections, { requiredFields, showAll: true, neverAsk })
check('show-all: both sections kept',
  all.groups.map(g => g.title), ['Building Information', 'Energy'])
check('show-all: every editable field, no system/derived/computed/spacer',
  all.groups.flatMap(g => g.fields.map(f => f.name)),
  ['property_id', 'building_number_or_name', 'building_address', 'building_type',
    'building_year_built', 'building_notes'])
check('show-all: Type (the empty-dropdown field) is offered',
  all.groups[0].fields.some(f => f.name === 'building_type'), true)

// ── Required columns the layout doesn't carry ────────────────────────────────
check('unlaid-out: only building_owner is missing, and it is a system column',
  listUnlaidOutRequiredColumns(requiredFields, all.covered, {
    neverAsk, recordTypeColumn: 'building_record_type',
  }), [])

const sparseRequired = new Set(['property_id', 'building_number_or_name', 'work_type_id', 'building_record_type'])
check('unlaid-out: a required column absent from the layout is surfaced',
  listUnlaidOutRequiredColumns(sparseRequired, all.covered, {
    neverAsk, recordTypeColumn: 'building_record_type',
  }), ['work_type_id'])

// ── No layout at all (the pop-up still has to work) ──────────────────────────
const none = buildCreateModalGroups([], { requiredFields, showAll: false, neverAsk })
check('no layout: no groups', none.groups, [])
check('no layout: every non-system required column is asked for',
  listUnlaidOutRequiredColumns(requiredFields, none.covered, {
    neverAsk, recordTypeColumn: 'building_record_type',
  }), ['building_number_or_name', 'property_id'])

console.log(failures === 0
  ? `create-modal-fields fixture: ${checks} checks passed`
  : `create-modal-fields fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
