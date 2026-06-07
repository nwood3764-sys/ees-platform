// Shared definitions for the home/app page builder and renderer.
//
// TEMPLATES define column/region structures. Each region has a key (stored on
// components as hpc_region) and a flex weight used to lay out the row.
export const HOME_TEMPLATES = [
  {
    id: 'single',
    label: 'Single Column',
    regions: [{ key: 'main', label: 'Main', flex: 1 }],
  },
  {
    id: 'two_thirds_one_third',
    label: 'Main + Sidebar (2/3 + 1/3)',
    regions: [
      { key: 'main', label: 'Main', flex: 2 },
      { key: 'sidebar', label: 'Sidebar', flex: 1 },
    ],
  },
  {
    id: 'two_equal',
    label: 'Two Equal Columns',
    regions: [
      { key: 'left', label: 'Left', flex: 1 },
      { key: 'right', label: 'Right', flex: 1 },
    ],
  },
  {
    id: 'three_equal',
    label: 'Three Equal Columns',
    regions: [
      { key: 'left', label: 'Left', flex: 1 },
      { key: 'center', label: 'Center', flex: 1 },
      { key: 'right', label: 'Right', flex: 1 },
    ],
  },
]

export function getTemplate(id) {
  return HOME_TEMPLATES.find(t => t.id === id) || HOME_TEMPLATES[1]
}

// COMPONENT TYPES available in the palette. `source` indicates which catalog
// the component draws from (so the properties panel knows which picker to show).
export const COMPONENT_TYPES = [
  { id: 'dashboard',       label: 'Dashboard',        source: 'dashboard', icon: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z' },
  { id: 'report_chart',    label: 'Report Chart',     source: 'report',    icon: 'M3 3v18h18M9 17V9m4 8V5m4 12v-6' },
  { id: 'list_view',       label: 'List View',        source: 'list_view', icon: 'M4 6h16M4 12h16M4 18h16' },
  { id: 'task_list',       label: 'Task List',        source: null,        icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11' },
  { id: 'metric_card',     label: 'Metric Card',      source: null,        icon: 'M3 3h18v18H3zM9 9h6v6H9z' },
  { id: 'gauge',           label: 'Gauge',            source: null,        icon: 'M12 14l4-4M4 14a8 8 0 1116 0' },
  { id: 'percentage_card', label: 'Percentage Card',  source: null,        icon: 'M19 5L5 19M6.5 6.5h.01M17.5 17.5h.01' },
  { id: 'rich_text',       label: 'Rich Text',        source: null,        icon: 'M4 6h16M4 12h10M4 18h7' },
]

export function getComponentType(id) {
  return COMPONENT_TYPES.find(c => c.id === id) || null
}
