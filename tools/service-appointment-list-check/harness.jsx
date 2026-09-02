// The REAL ListView, rendering the REAL seeded service-appointment views over
// real service-appointment data shapes.
//
// What a browser has to answer that a Node test cannot: does the tab actually
// SHOW past appointments? The complaint was never about a function's return
// value — it was that a screen displayed nothing. So this mounts the shipped
// component, hands it the four views exactly as the migration wrote them into
// saved_list_views, and the run script reads the rows off the rendered table.
import { createRoot } from 'react-dom/client'
import { ListView } from '../../src/components/ListView'

// Real rows, shaped the way fetchObjectRecords shapes them. The instants are
// the real spread on prod: every appointment in the past, none in the future.
// SA-00299 is 13:00Z, which is 8:00 AM in Appleton.
const YEAR = new Date().getFullYear()
const iso = (d) => d.toISOString()
const dayOffset = (n, hour = 13) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(hour, 0, 0, 0)
  return iso(d)
}

const DATA = [
  { _id: '1', id: 'SA-00299', name: '3002 West Darling Street - Appleton',
    sa_status__label: 'Completed', sa_scheduled_start_time: dayOffset(-21, 8),
    sa_scheduled_end_time: dayOffset(-21, 12), sa_owner__label: 'Roman Rufino',
    work_type_id__rel__work_type_name: 'Insulation - Attic',
    work_order_id__rel__work_order_name: 'WO-00243 - Building Access' },
  { _id: '2', id: 'SA-00300', name: '1837 Alden Rd - Janesville',
    sa_status__label: 'Completed', sa_scheduled_start_time: dayOffset(-3, 9),
    sa_scheduled_end_time: dayOffset(-3, 15), sa_owner__label: 'Logan Wood',
    work_type_id__rel__work_type_name: 'Air Sealing - Multifamily',
    work_order_id__rel__work_order_name: 'WO-00244 - Insulation' },
  { _id: '3', id: 'SA-00305', name: '931 Tessie Street - Rocky Mount',
    sa_status__label: 'Scheduled', sa_scheduled_start_time: dayOffset(0, 10),
    sa_scheduled_end_time: dayOffset(0, 14), sa_owner__label: 'Lucas Wood',
    work_type_id__rel__work_type_name: 'Blower Door Diagnostic',
    work_order_id__rel__work_order_name: 'WO-00245 - Assessment' },
  { _id: '4', id: 'SA-00306', name: '5513 N Hopkins - Milwaukee',
    sa_status__label: 'Scheduled', sa_scheduled_start_time: dayOffset(6, 8),
    sa_scheduled_end_time: dayOffset(6, 16), sa_owner__label: 'Priya Nair',
    work_type_id__rel__work_type_name: 'ASHRAE Level 2',
    work_order_id__rel__work_order_name: 'WO-00246 - Audit' },
  // Two live appointments carry no scheduled time at all. Neither Past nor
  // Upcoming may claim them.
  { _id: '5', id: 'SA-00301', name: 'Unscheduled - no time recorded',
    sa_status__label: 'Scheduled', sa_scheduled_start_time: null,
    sa_scheduled_end_time: null, sa_owner__label: 'Priya Nair',
    work_type_id__rel__work_type_name: 'Material Delivery',
    work_order_id__rel__work_order_name: 'WO-00247 - Delivery' },
]

// The column catalog as buildObjectColumnCatalog derives it for
// service_appointments — including the prefix-stripped labels, which is the
// other thing only a browser shows ("Status", not "Sa Status").
const COLUMNS = [
  { field: 'id',   label: 'Record #', type: 'text', group: 'Service Appointment' },
  { field: 'name', label: 'Service Appointment Name', type: 'text', group: 'Service Appointment' },
  { field: 'sa_status__label', label: 'Status', type: 'text', group: 'Service Appointment', columnName: 'sa_status' },
  { field: 'sa_scheduled_start_time', label: 'Scheduled Start Time', type: 'date', group: 'Service Appointment', columnName: 'sa_scheduled_start_time' },
  { field: 'sa_scheduled_end_time',   label: 'Scheduled End Time',   type: 'date', group: 'Service Appointment', columnName: 'sa_scheduled_end_time' },
  { field: 'work_type_id__rel__work_type_name', label: 'Work Type Name', type: 'text', group: 'Work Type' },
  { field: 'work_order_id__rel__work_order_name', label: 'Work Order Name', type: 'text', group: 'Work Order' },
  { field: 'sa_owner__label', label: 'Record Owner', type: 'text', group: 'Service Appointment', columnName: 'sa_owner' },
]

// Verbatim from the migration.
const VIEW_COLUMNS = [
  'id', 'name', 'sa_status__label', 'sa_scheduled_start_time',
  'sa_scheduled_end_time', 'work_type_id__rel__work_type_name',
  'work_order_id__rel__work_order_name', 'sa_owner__label',
]
const VIEWS = [
  { id: 'LV-00122', name: 'All Service Appointments', filters: [],
    sortField: 'sa_scheduled_start_time', sortDir: 'desc', visibleColumns: VIEW_COLUMNS },
  { id: 'LV-00123', name: 'Past Service Appointments',
    filters: [{ field: 'sa_scheduled_start_time', label: 'Scheduled Start Time', op: 'lt', value: 'TODAY' }],
    sortField: 'sa_scheduled_start_time', sortDir: 'desc', visibleColumns: VIEW_COLUMNS },
  { id: 'LV-00124', name: "Today's Service Appointments",
    filters: [{ field: 'sa_scheduled_start_time', label: 'Scheduled Start Time', op: 'equals', value: 'TODAY' }],
    sortField: 'sa_scheduled_start_time', sortDir: 'asc', visibleColumns: VIEW_COLUMNS },
  { id: 'LV-00125', name: 'Upcoming Service Appointments',
    filters: [{ field: 'sa_scheduled_start_time', label: 'Scheduled Start Time', op: 'from', value: 'TODAY' }],
    sortField: 'sa_scheduled_start_time', sortDir: 'asc', visibleColumns: VIEW_COLUMNS },
]

function Harness() {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ListView
        data={DATA}
        columns={COLUMNS}
        columnCatalog={COLUMNS}
        columnGroups={['Service Appointment', 'Work Type', 'Work Order']}
        systemViews={VIEWS}
        listObject="service_appointments"
        listModule="field"
        onOpenRecord={() => {}}
      />
    </div>
  )
}
createRoot(document.getElementById('root')).render(<Harness />)
