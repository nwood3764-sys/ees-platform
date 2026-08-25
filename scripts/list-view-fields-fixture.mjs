// List view referenced fields — pure-logic fixture.
//
// Pins the rule that a list view REFERENCES a field three ways — it displays
// it, it filters on it, or it sorts by it — and that the row fetch must
// resolve all three. The defect this exists to prevent: "WI - Opportunities"
// filtered on property_id__rel__property_state; the moment that column was
// unchecked in the column picker the fetch stopped resolving it, every row
// compared `undefined` against 'WI', and a list of 40 real Wisconsin
// opportunities rendered as "No records match the current filters."
//
// The specific regression to guard is the SHRINKING set: hiding a column must
// not drop a field the filter or the sort still needs.

import {
  isRelatedFieldName,
  collectViewFields,
  collectRelatedFields,
  collectRelatedFieldsForViews,
} from '../src/lib/listViewFields.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures += 1
    console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const STATE = 'property_id__rel__property_state'
const SUBSIDY = 'property_id__rel__property_subsidy_type__label'
const MGMT = 'building_id__rel__building_property_management_company'

// ── isRelatedFieldName ─────────────────────────────────────────────────────
check('related field recognised', isRelatedFieldName(STATE), true)
check('own column is not related', isRelatedFieldName('opportunity_state'), false)
check('picklist __label is not related', isRelatedFieldName('opportunity_stage__label'), false)
check('null is not related', isRelatedFieldName(null), false)
check('non-string is not related', isRelatedFieldName(42), false)

// ── The real "WI - Opportunities" view, as stored ──────────────────────────
const wiView = {
  visibleColumns: [STATE, SUBSIDY, 'opportunity_record_type__label', 'opportunity_homes_application_submitted'],
  filters: [{ op: 'equals', field: STATE, label: 'State', value: 'WI' }],
  sortField: 'close_date',
}
check('view as saved resolves its state column', collectRelatedFields(wiView), [STATE, SUBSIDY])

// THE REGRESSION: the State column is unchecked in the column picker. The
// filter still rides it, so the fetch must still resolve it.
const wiHidden = { ...wiView, visibleColumns: wiView.visibleColumns.filter(f => f !== STATE) }
check('hiding the filtered column keeps the field', collectRelatedFields(wiHidden), [STATE, SUBSIDY])

// Every displayed column hidden — the filter alone still holds the field.
check('filter alone holds the field',
  collectRelatedFields({ visibleColumns: [], filters: wiView.filters, sortField: null }),
  [STATE])

// Sorting on a hidden related column holds it too (the screenshot's "Sort:
// State ↑" — sorting on undefined silently does nothing).
check('sort alone holds the field',
  collectRelatedFields({ visibleColumns: [], filters: [], sortField: STATE }),
  [STATE])

// Removing BOTH the column and the filter genuinely releases it — the set
// must still shrink, or every list would accumulate joins forever.
check('dropping the column and the filter releases it',
  collectRelatedFields({ visibleColumns: [SUBSIDY], filters: [], sortField: 'close_date' }),
  [SUBSIDY])

// ── Filter shapes ──────────────────────────────────────────────────────────
check('multi-value equals row', collectRelatedFields({ filters: [{ op: 'equals', field: STATE, value: ['WI', 'MI'] }] }), [STATE])
check('two filters on two relationships',
  collectRelatedFields({ filters: [{ field: STATE, op: 'equals', value: 'WI' }, { field: MGMT, op: 'contains', value: 'x' }] }),
  [MGMT, STATE].sort())
check('own-column filter contributes nothing to the join set',
  collectRelatedFields({ filters: [{ field: 'opportunity_amount', op: 'greater', value: 5 }] }),
  [])
check('malformed filter rows are ignored',
  collectRelatedFields({ filters: [null, undefined, 'nope', {}, { field: '' }, { field: STATE }] }),
  [STATE])
check('nested filter groups are walked',
  collectRelatedFields({ filters: [{ conditions: [{ field: STATE }] }, { filters: [[{ field: MGMT }]] }] }),
  [MGMT, STATE].sort())
check('a self-referencing filter group terminates',
  (() => { const g = { field: STATE }; g.filters = [g]; return collectRelatedFields({ filters: [g] }) })(),
  [STATE])
check('filters not an array', collectRelatedFields({ filters: 'WI' }), [])

// ── collectViewFields: own columns are returned too, display order first ───
check('every referenced field, display order first',
  collectViewFields({ visibleColumns: ['opportunity_name', STATE], filters: [{ field: 'opportunity_amount' }], sortField: 'close_date' }),
  ['opportunity_name', STATE, 'opportunity_amount', 'close_date'])
check('a field referenced twice appears once',
  collectViewFields({ visibleColumns: [STATE], filters: [{ field: STATE }], sortField: STATE }),
  [STATE])
check('groupField counts as a reference', collectViewFields({ groupField: MGMT }), [MGMT])
check('empty view', collectViewFields({}), [])
check('no argument', collectViewFields(), [])

// ── Seeding across saved views (first paint, before any interaction) ───────
// All four real opportunity views. "NC - IRA - MF" and "WI - Opportunities"
// both filter on state; "All Opportunities" displays three other related
// columns. The seed is the union, so whichever view opens resolves at once.
const savedViews = [
  { name: 'All Opportunities', visibleColumns: ['opportunity_stage__label', 'property_id__rel__property_total_buildings', 'property_id__rel__property_total_units', MGMT], filters: [], sortField: 'close_date' },
  { name: 'NC - IRA - MF', visibleColumns: [STATE, SUBSIDY], filters: [{ op: 'contains', field: STATE, value: 'NC' }], sortField: 'close_date' },
  { name: 'Recent Opportunities', visibleColumns: ['opportunity_name', 'opportunity_stage', 'opportunity_amount'], filters: [], sortField: 'opportunity_updated_at' },
  wiView,
]
check('seed is the union across saved views',
  collectRelatedFieldsForViews(savedViews),
  [MGMT, STATE, 'property_id__rel__property_total_buildings', 'property_id__rel__property_total_units', SUBSIDY].sort())

// A view that ONLY filters on a related field — nothing displays it — still
// seeds it. This is the drill-down / dashboard-filter shape.
check('a filter-only view still seeds its field',
  collectRelatedFieldsForViews([{ visibleColumns: [], filters: [{ field: STATE, op: 'equals', value: 'WI' }] }]),
  [STATE])
check('no views', collectRelatedFieldsForViews(null), [])
check('views with holes', collectRelatedFieldsForViews([null, undefined, {}]), [])

// ── Stability: the key the fetch is de-duplicated on ───────────────────────
// Two orderings of the same references must produce the same key, or the list
// refetches on every unrelated column reorder.
const keyA = collectRelatedFields({ visibleColumns: [STATE, SUBSIDY], filters: [] }).join('|')
const keyB = collectRelatedFields({ visibleColumns: [SUBSIDY], filters: [{ field: STATE }] }).join('|')
check('same references, same key regardless of where they came from', keyA, keyB)

if (failures > 0) {
  console.error(`\nlist-view-fields-fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`list-view-fields-fixture: ${checks} checks passed`)
