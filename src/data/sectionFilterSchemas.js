// ---------------------------------------------------------------------------
// sectionFilterSchemas.js — schemas describing the prts_filter_config jsonb
// field for each project_report_template_sections.prts_section_type.
//
// Same pattern as sectionConfigSchemas.js: each schema is an array of filter
// rule descriptors. The FilterConfigEditor widget reads the schema for the
// row's section_type_value and renders a structured picker. Saving writes
// back to prts_filter_config.
//
// Filter rule descriptor shape:
//   {
//     key:           'work_order_status_in',         // jsonb key written
//     label:         'Work Order Status',            // shown in UI
//     type:          'picklist_multi',               // currently the only type
//     // For picklist_multi:
//     picklist_object: 'work_orders',                // picklist_values.picklist_object
//     picklist_field:  'work_order_status',          // picklist_values.picklist_field
//     description?:   'Help text shown beneath the row',
//   }
//
// The shape of prts_filter_config is a flat object of resolved values:
//   {
//     work_order_status_in:      ['<uuid>', '<uuid>'],
//     work_order_record_type_in: ['<uuid>'],
//     work_step_status_in:       ['<uuid>'],
//   }
//
// The renderer in generate-project-report consumes these keys when iterating
// the project graph. A key missing or empty array means "no constraint."
//
// Section types not listed here have no filter capability and the filter
// configuration UI is hidden entirely on those rows.
// ---------------------------------------------------------------------------

export const SECTION_FILTER_SCHEMAS = {
  work_orders_overview: [
    {
      key: 'work_order_status_in',
      label: 'Work Order Status',
      type: 'picklist_multi',
      picklist_object: 'work_orders',
      picklist_field: 'work_order_status',
      description: 'Only include work orders matching the selected statuses. Leave empty to include all.',
    },
    {
      key: 'work_order_record_type_in',
      label: 'Work Order Record Type',
      type: 'picklist_multi',
      picklist_object: 'work_orders',
      picklist_field: 'record_type',
      description: 'Only include work orders of the selected record types. Leave empty to include all.',
    },
  ],

  work_order_section: [
    {
      key: 'work_order_status_in',
      label: 'Work Order Status',
      type: 'picklist_multi',
      picklist_object: 'work_orders',
      picklist_field: 'work_order_status',
      description: 'Only render work orders matching the selected statuses. Leave empty to render all.',
    },
    {
      key: 'work_order_record_type_in',
      label: 'Work Order Record Type',
      type: 'picklist_multi',
      picklist_object: 'work_orders',
      picklist_field: 'record_type',
      description: 'Only render work orders of the selected record types. Leave empty to render all.',
    },
    {
      key: 'work_step_status_in',
      label: 'Work Step Status',
      type: 'picklist_multi',
      picklist_object: 'work_steps',
      picklist_field: 'work_step_status',
      description: 'Within each work order, only render work steps matching the selected statuses. Leave empty to render all steps.',
    },
  ],
}

export function getSectionFilterSchema(sectionTypeValue) {
  return SECTION_FILTER_SCHEMAS[sectionTypeValue] || null
}

// Returns true when the given section type has at least one filter rule
// available — UI uses this to decide whether to show the Filter
// Configuration card at all.
export function sectionTypeSupportsFilters(sectionTypeValue) {
  const schema = SECTION_FILTER_SCHEMAS[sectionTypeValue]
  return Array.isArray(schema) && schema.length > 0
}
