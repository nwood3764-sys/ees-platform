// Stub for src/data/layoutService — used ONLY by tools/record-header-check.
//
// The harness mounts the REAL RecordDetail; this is what stops it reaching for
// a database. Everything the component imports is exported, and every call that
// would be a query answers with the fixture below or a harmless empty result.

const FIELD_LABELS = [
  "I'm applying for a(n)", 'Building type?', 'Building project type?',
  'Primary contractor business name', 'Primary contractor contact name',
  'Primary contractor email', 'Primary contractor phone number',
  'Primary contractor address', 'City', 'State', 'ZIP code',
  'Program', 'Application submitted date', 'Reviewer', 'Reviewed date',
]

function fieldGroup(prefix, n) {
  return {
    id: `wg-${prefix}`,
    widget_type: 'field_group',
    widget_config: {
      columns: 2,
      fields: Array.from({ length: n }, (_, i) => ({
        name: `${prefix}_field_${i}`,
        label: FIELD_LABELS[i % FIELD_LABELS.length],
        type: 'text',
      })),
    },
  }
}

// Long enough that the page genuinely scrolls — the defect only exists below
// the fold.
const SECTIONS = Array.from({ length: 8 }, (_, s) => ({
  id: `sec-${s}`,
  section_label: ['Application', 'Primary Contractor Information', 'Property', 'Building',
    'Measures', 'Incentive', 'Review', 'System Information'][s],
  section_tab: 'Details',
  section_placement: 'main',
  section_order: s,
  section_is_collapsible: true,
  widgets: [fieldGroup(`s${s}`, 10)],
}))

const RECORD = { id: 'rec-1' }
for (const sec of SECTIONS) {
  for (const f of sec.widgets[0].widget_config.fields) RECORD[f.name] = 'Energy Efficiency Services of Wisconsin'
}
RECORD.ia_name = '1226 West Florence Street - Whitewater - 1226 - WI-IRA-MF-HOMES - WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST'
RECORD.ia_record_number = 'IA-00030'
RECORD.ia_record_type = 'rt-1'
RECORD.ia_status = 'Incentive Application To Be Prepared'

const picklists = {
  byId: new Map([['rt-1', 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST']]),
  valueById: new Map([['rt-1', 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST']]),
  metaById: new Map([['rt-1', {
    label: 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST',
    value: 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST',
    object: 'incentive_applications', field: 'record_type',
    icon: null, color: null, incomeQualification: false,
  }]]),
  byField: new Map(),
}

export async function loadRecordDetailData() {
  return {
    record: { ...RECORD },
    layout: { id: 'layout-1', layout_name: 'Incentive Application Layout' },
    sections: SECTIONS.map(s => ({ ...s })),
    picklists,
    lookups: new Map(),
    actionOverrides: [],
  }
}

export async function fetchPageLayout() { return { layout: null, sections: SECTIONS.map(s => ({ ...s })), actionOverrides: [] } }
export async function loadPicklists() { return picklists }
export async function fetchTableMetadata() { return { columns: [], requiredColumns: [] } }
export async function fetchPicklistOptions() { return [] }
export async function fetchLookupOptions() { return [] }
export async function fetchDependentLookupOptions() { return [] }
export async function fetchRelatedRecords() { const rows = []; rows._total = 0; return rows }
export async function resolveLookups() { return new Map() }
export async function fetchPickerCandidates() { return [] }
export async function fetchAvailableRecordTypes() { return [] }
export async function fetchConstrainingParentForCreate() { return null }
export async function fetchConstrainingParentCandidates() { return [] }
export async function fetchOpportunityInheritedFields() { return {} }
export async function fetchProgramStateForCreate() { return null }
export async function getCurrentUserId() { return 'user-1' }
export async function getCurrentUserProfile() { return { id: 'user-1', user_first_name: 'Nicholas', user_last_name: 'Wood', role_name: 'Admin' } }
export async function saveRecord() { return { ...RECORD } }
export async function insertRecord() { return { ...RECORD } }
export async function deleteRecord() { return true }
export async function reorderJunctionRows() { return true }
export async function addJunctionRow() { return true }
export async function removeJunctionRow() { return true }
export function applyInsertDefaults(_t, draft) { return draft }
export function getRecordTypeColumn() { return 'ia_record_type' }
export function getRecordTypeValue(record) { return record?.ia_record_type || null }
