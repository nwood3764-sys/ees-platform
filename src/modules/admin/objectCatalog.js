// Static catalog that categorizes every public table in the database
// into a module group with a human-readable label. This powers the Object
// Manager list view — without it, admins would just see a flat list of
// raw table names, which is useless for a 89-table schema.
//
// Each entry: { table, label, pluralLabel, module, description }
// `table` is the PostgreSQL table name (exact match)
// `module` groups objects in the Object Manager list
// `label` / `pluralLabel` are display names (like Salesforce Object Label / Plural)

export const OBJECT_CATALOG = [
  // ─── CRM & OUTREACH ────────────────────────────────────────────────────
  { table: 'accounts',                      label: 'Account',                     pluralLabel: 'Accounts',                     module: 'CRM & Outreach',        description: 'Organization or household — record types: Property Owner, PMC, Partner Org, Customer Household, EES-WI Internal, etc.' },
  { table: 'account_contact_relations',     label: 'Account Contact Role',        pluralLabel: 'Account Contact Roles',        module: 'CRM & Outreach',        description: 'Junction — secondary contact relationships beyond a contact\'s primary account.' },
  { table: 'properties',                    label: 'Property',                    pluralLabel: 'Properties',                   module: 'CRM & Outreach',        description: 'Physical site with one or more buildings.' },
  { table: 'buildings',                     label: 'Building',                    pluralLabel: 'Buildings',                    module: 'CRM & Outreach',        description: 'Structure within a property — contains units.' },
  { table: 'units',                         label: 'Unit',                        pluralLabel: 'Units',                        module: 'CRM & Outreach',        description: 'Individual dwelling within a building.' },
  { table: 'contacts',                      label: 'Contact',                     pluralLabel: 'Contacts',                     module: 'CRM & Outreach',        description: 'Person associated with an account — internal staff, property owner contact, partner tech, tenant, etc.' },
  { table: 'opportunities',                 label: 'Opportunity',                 pluralLabel: 'Opportunities',                module: 'CRM & Outreach',        description: 'Pipeline record — potential project at a property.' },
  { table: 'opportunity_contact_roles',     label: 'Opportunity Contact Role',    pluralLabel: 'Opportunity Contact Roles',    module: 'CRM & Outreach',        description: 'Stakeholder role on an opportunity.' },
  { table: 'opportunity_line_items',        label: 'Opportunity Line Item',       pluralLabel: 'Opportunity Line Items',       module: 'CRM & Outreach',        description: 'Scope-of-work line on an opportunity.' },

  // ─── QUALIFICATION ─────────────────────────────────────────────────────
  { table: 'assessments',                   label: 'Assessment',                  pluralLabel: 'Assessments',                  module: 'Qualification',         description: 'Energy audit / ASHRAE Level 2 assessment.' },
  { table: 'diagnostic_tests',              label: 'Diagnostic Test',             pluralLabel: 'Diagnostic Tests',             module: 'Qualification',         description: 'Blower door, duct leakage, combustion safety test.' },
  { table: 'income_qualifications',         label: 'Income Qualification',        pluralLabel: 'Income Qualifications',        module: 'Qualification',         description: 'Per-unit income qualification record.' },
  { table: 'incentive_applications',        label: 'Incentive Application',       pluralLabel: 'Incentive Applications',       module: 'Qualification',         description: 'Program application submitted to an administering body.' },
  { table: 'property_programs',             label: 'Property Program',            pluralLabel: 'Property Programs',            module: 'Qualification',         description: 'Junction — which programs a property qualifies for.' },
  { table: 'efr_reports',                   label: 'EFR Report',                  pluralLabel: 'EFR Reports',                  module: 'Qualification',         description: 'Electrification Feasibility Report (Denver).' },
  { table: 'mechanical_equipment',          label: 'Mechanical Equipment',        pluralLabel: 'Mechanical Equipment',         module: 'Qualification',         description: 'Existing equipment observed during audit.' },
  { table: 'ahri_equipment',                label: 'AHRI Equipment',              pluralLabel: 'AHRI Equipment',               module: 'Qualification',         description: 'AHRI-matched equipment proposal.' },
  { table: 'ahri_certificates',             label: 'AHRI Certificate',            pluralLabel: 'AHRI Certificates',            module: 'Qualification',         description: 'AHRI rating certificate for a matched system.' },
  { table: 'project_reservations',          label: 'Project Reservation',         pluralLabel: 'Project Reservations',         module: 'Qualification',         description: 'Program-issued reservation triggering scheduling.' },

  // ─── FIELD OPERATIONS ─────────────────────────────────────────────────
  { table: 'projects',                      label: 'Project',                     pluralLabel: 'Projects',                     module: 'Field Operations',      description: 'Active installation project.' },
  { table: 'work_orders',                   label: 'Work Order',                  pluralLabel: 'Work Orders',                  module: 'Field Operations',      description: 'Executable unit of field work.' },
  { table: 'work_plans',                    label: 'Work Plan',                   pluralLabel: 'Work Plans',                   module: 'Field Operations',      description: 'Step-by-step instructions attached to a work order.' },
  { table: 'work_steps',                    label: 'Work Step',                   pluralLabel: 'Work Steps',                   module: 'Field Operations',      description: 'Individual task within a work plan.' },
  { table: 'work_types',                    label: 'Work Type',                   pluralLabel: 'Work Types',                   module: 'Field Operations',      description: 'Named task with BOM and work plan (e.g. HP Install).' },
  { table: 'service_appointments',          label: 'Service Appointment',         pluralLabel: 'Service Appointments',         module: 'Field Operations',      description: 'Scheduled on-site appointment for a work order.' },
  { table: 'service_appointment_assignments', label: 'Appointment Assignment',    pluralLabel: 'Appointment Assignments',      module: 'Field Operations',      description: 'Crew-member-to-appointment assignment.' },
  { table: 'service_territories',           label: 'Service Territory',           pluralLabel: 'Service Territories',          module: 'Field Operations',      description: 'Geographic region served.' },
  { table: 'locations',                     label: 'Location',                    pluralLabel: 'Locations',                    module: 'Field Operations',      description: 'Physical location (shop, warehouse, site).' },
  { table: 'gps_points',                    label: 'GPS Point',                   pluralLabel: 'GPS Points',                   module: 'Field Operations',      description: 'GPS coordinate captured during a field activity.' },
  { table: 'photos',                        label: 'Photo',                       pluralLabel: 'Photos',                       module: 'Field Operations',      description: 'Photo evidence attached to a work step.' },
  { table: 'documents',                     label: 'Document',                    pluralLabel: 'Documents',                    module: 'Field Operations',      description: 'File attached to any record.' },

  // ─── INCENTIVES ────────────────────────────────────────────────────────
  { table: 'incentives',                    label: 'Incentive',                   pluralLabel: 'Incentives',                   module: 'Incentives',            description: 'Individual incentive amount earned on a project.' },
  { table: 'project_payment_requests',      label: 'Payment Request',             pluralLabel: 'Payment Requests',             module: 'Incentives',            description: 'Invoice submitted to program administrator.' },
  { table: 'payment_receipts',              label: 'Payment Receipt',             pluralLabel: 'Payment Receipts',             module: 'Incentives',            description: 'Received payment matched to a request.' },

  // ─── STOCK ─────────────────────────────────────────────────────────────
  { table: 'products',                      label: 'Product',                     pluralLabel: 'Products',                     module: 'Stock',                 description: 'Catalog SKU — material, equipment, or assembly.' },
  { table: 'product_items',                 label: 'Product Item',                pluralLabel: 'Product Items',                module: 'Stock',                 description: 'On-hand inventory row at a location.' },
  { table: 'product_assemblies',            label: 'Product Assembly',            pluralLabel: 'Product Assemblies',           module: 'Stock',                 description: 'BOM — components that make up an assembly.' },
  { table: 'product_transfers',             label: 'Product Transfer',            pluralLabel: 'Product Transfers',            module: 'Stock',                 description: 'Inventory movement between locations / vehicles.' },
  { table: 'materials_requests',            label: 'Materials Request',           pluralLabel: 'Materials Requests',           module: 'Stock',                 description: 'Request from field for materials.' },
  { table: 'materials_request_line_items',  label: 'Materials Request Line',      pluralLabel: 'Materials Request Lines',      module: 'Stock',                 description: 'Individual SKU line on a materials request.' },
  { table: 'price_books',                   label: 'Price Book',                  pluralLabel: 'Price Books',                  module: 'Stock',                 description: 'Named pricing list (wholesale, contract, program).' },
  { table: 'price_book_entries',            label: 'Price Book Entry',            pluralLabel: 'Price Book Entries',           module: 'Stock',                 description: 'Product priced within a price book.' },
  { table: 'job_kits',                      label: 'Job Kit',                     pluralLabel: 'Job Kits',                     module: 'Stock',                 description: 'Pre-built bundle of materials for a work type.' },
  { table: 'job_kit_line_items',            label: 'Job Kit Line',                pluralLabel: 'Job Kit Lines',                module: 'Stock',                 description: 'SKU line within a job kit.' },
  { table: 'equipment',                     label: 'Equipment',                   pluralLabel: 'Equipment',                    module: 'Stock',                 description: 'Non-consumable tool or gear.' },
  { table: 'equipment_activities',          label: 'Equipment Activity',          pluralLabel: 'Equipment Activities',         module: 'Stock',                 description: 'Check-out, return, maintenance, inspection event.' },
  { table: 'equipment_containers',          label: 'Equipment Container',         pluralLabel: 'Equipment Containers',         module: 'Stock',                 description: 'Toolbox, shelf, or rack — nests equipment.' },
  { table: 'equipment_information',         label: 'Equipment Info',              pluralLabel: 'Equipment Info',               module: 'Stock',                 description: 'Reference data for a piece of equipment.' },

  // ─── FLEET ─────────────────────────────────────────────────────────────
  { table: 'vehicles',                      label: 'Vehicle',                     pluralLabel: 'Vehicles',                     module: 'Fleet',                 description: 'Company vehicle — truck, van, trailer.' },
  { table: 'vehicle_activities',            label: 'Vehicle Activity',            pluralLabel: 'Vehicle Activities',           module: 'Fleet',                 description: 'Pre-trip, post-trip, fuel, maintenance, mileage log.' },
  { table: 'asset_assignments',             label: 'Asset Assignment',            pluralLabel: 'Asset Assignments',            module: 'Fleet',                 description: 'Who currently has this vehicle / equipment / phone.' },

  // ─── PEOPLE ────────────────────────────────────────────────────────────
  { table: 'users',                         label: 'User',                        pluralLabel: 'Users',                        module: 'People',                description: 'Energy Efficiency Services login account — auth + role + permissions. Linked to a contact via contacts.contact_user_id.' },
  { table: 'skills',                        label: 'Skill',                       pluralLabel: 'Skills',                       module: 'People',                description: 'Master catalog of skills (Salesforce Field Service: Skill). E.g., BPI Building Analyst, EPA 608, OSHA 30.' },
  { table: 'contact_skills',                label: 'Contact Skill',               pluralLabel: 'Contact Skills',               module: 'People',                description: 'Junction (FSL ServiceResourceSkill) — a contact has a skill, with effective dates that handle cert expiry.' },
  { table: 'work_type_skill_requirements',  label: 'Work Type Skill Requirement', pluralLabel: 'Work Type Skill Requirements', module: 'People',                description: 'Junction (FSL SkillRequirement) — skills required to perform a Work Type. Drives the assignment matching engine.' },
  { table: 'time_sheets',                   label: 'Time Sheet',                  pluralLabel: 'Time Sheets',                  module: 'People',                description: 'Weekly time sheet header.' },
  { table: 'time_sheet_entries',            label: 'Time Sheet Entry',            pluralLabel: 'Time Sheet Entries',           module: 'People',                description: 'Individual clock-in / clock-out entry.' },
  { table: 'occurrences',                   label: 'Occurrence',                  pluralLabel: 'Occurrences',                  module: 'People',                description: 'HR incident, safety event, disciplinary record.' },
  { table: 'occurrence_participants',       label: 'Occurrence Participant',      pluralLabel: 'Occurrence Participants',      module: 'People',                description: 'Contact involved in an occurrence.' },
  { table: 'crew_phones',                   label: 'Crew Phone',                  pluralLabel: 'Crew Phones',                  module: 'People',                description: 'Company-issued phone tracked by named owner.' },

  // ─── CONFIGURATION / BUILDERS ─────────────────────────────────────────
  { table: 'programs',                      label: 'Program',                     pluralLabel: 'Programs',                     module: 'Configuration',         description: 'Incentive program configuration.' },
  { table: 'program_stages',                label: 'Program Stage',               pluralLabel: 'Program Stages',               module: 'Configuration',         description: 'Lifecycle stage within a program.' },
  { table: 'program_document_requirements', label: 'Program Doc Requirement',     pluralLabel: 'Program Doc Requirements',     module: 'Configuration',         description: 'Documents required at a program stage.' },
  { table: 'email_templates',               label: 'Email Template',              pluralLabel: 'Email Templates',              module: 'Configuration',         description: 'Outbound email template with merge fields.' },
  { table: 'document_templates',            label: 'Document Template',           pluralLabel: 'Document Templates',           module: 'Configuration',         description: 'Rendered PDF / e-sign template.' },
  { table: 'work_plan_templates',           label: 'Work Plan Template',          pluralLabel: 'Work Plan Templates',          module: 'Configuration',         description: 'Reusable work plan attached to work types.' },
  { table: 'work_plan_template_entries',    label: 'Work Plan Template Entry',    pluralLabel: 'Work Plan Template Entries',   module: 'Configuration',         description: 'Ordered step in a work plan template.' },
  { table: 'work_step_templates',           label: 'Work Step Template',          pluralLabel: 'Work Step Templates',          module: 'Configuration',         description: 'Reusable work step (guidance, evidence, verifier).' },
  { table: 'project_report_templates',                          label: 'Project Report Template',     pluralLabel: 'Project Report Templates',     module: 'Configuration',         description: 'Reusable layout for generated PDF project reports.' },
  { table: 'project_report_template_sections',                  label: 'Report Section',              pluralLabel: 'Report Sections',              module: 'Configuration',         description: 'Ordered section within a project report template.' },
  { table: 'project_report_template_record_type_assignments',   label: 'Report Template Assignment',  pluralLabel: 'Report Template Assignments',  module: 'Configuration',         description: 'Maps a project record type to a report template.' },
  { table: 'automation_rules',              label: 'Automation Rule',             pluralLabel: 'Automation Rules',             module: 'Configuration',         description: 'Trigger-based action (Salesforce Flow equivalent).' },
  { table: 'validation_rules',              label: 'Validation Rule',             pluralLabel: 'Validation Rules',             module: 'Configuration',         description: 'Pre-save rule that blocks with an error message.' },
  { table: 'picklist_values',               label: 'Picklist Value',              pluralLabel: 'Picklist Values',              module: 'Configuration',         description: 'Central picklist dictionary for every dropdown.' },

  // ─── PORTAL ────────────────────────────────────────────────────────────
  { table: 'portal_users',                  label: 'Portal User',                 pluralLabel: 'Portal Users',                 module: 'Portal',                description: 'External user with portal access.' },
  { table: 'comments',                      label: 'Comment',                     pluralLabel: 'Comments',                     module: 'Portal',                description: 'Record-level comment thread.' },
  { table: 'tasks',                         label: 'Task',                        pluralLabel: 'Tasks',                        module: 'Portal',                description: 'Action item assigned to a user.' },

  // ─── SYSTEM / SECURITY ────────────────────────────────────────────────
  { table: 'roles',                         label: 'Role',                        pluralLabel: 'Roles',                        module: 'Security',              description: 'User role for row-level and field-level security.' },
  { table: 'permissions',                   label: 'Permission',                  pluralLabel: 'Permissions',                  module: 'Security',              description: 'Named permission (module / object / action).' },
  { table: 'role_permissions',              label: 'Role Permission',             pluralLabel: 'Role Permissions',             module: 'Security',              description: 'Junction — which permissions a role has.' },
  { table: 'field_permissions',             label: 'Field Permission',            pluralLabel: 'Field Permissions',            module: 'Security',              description: 'Per-role, per-field visibility (Salesforce FLS).' },

  // ─── USER INTERFACE (page layouts, list views, widgets) ───────────────
  { table: 'page_layouts',                  label: 'Page Layout',                 pluralLabel: 'Page Layouts',                 module: 'User Interface',        description: 'Record detail layout — sections and widgets.' },
  { table: 'page_layout_sections',          label: 'Layout Section',              pluralLabel: 'Layout Sections',              module: 'User Interface',        description: 'Section within a page layout.' },
  { table: 'page_layout_widgets',           label: 'Layout Widget',               pluralLabel: 'Layout Widgets',               module: 'User Interface',        description: 'Field-group or related-list widget.' },
  { table: 'user_page_layout_overrides',    label: 'User Layout Override',        pluralLabel: 'User Layout Overrides',        module: 'User Interface',        description: 'Per-user customization on top of a page layout.' },
  { table: 'saved_list_views',              label: 'Saved List View',             pluralLabel: 'Saved List Views',             module: 'User Interface',        description: 'Named list view with filters and sort.' },
  { table: 'widget_types',                  label: 'Widget Type',                 pluralLabel: 'Widget Types',                 module: 'User Interface',        description: 'Registered widget type available to page layouts.' },

  // ─── REPORTS & SCHEDULING ─────────────────────────────────────────────
  { table: 'reports',                       label: 'Report',                      pluralLabel: 'Reports',                      module: 'Reports & Dashboards',  description: 'Saved report definition.' },
  { table: 'scheduled_reports',             label: 'Scheduled Report',            pluralLabel: 'Scheduled Reports',            module: 'Reports & Dashboards',  description: 'Report scheduled for automatic email delivery.' },

  // ─── DATA / AUDIT ─────────────────────────────────────────────────────
  { table: 'audit_log',                     label: 'Audit Log Entry',             pluralLabel: 'Audit Log',                    module: 'Data',                  description: 'Append-only log of destructive / sensitive actions.' },
  { table: 'field_history',                 label: 'Field History Entry',         pluralLabel: 'Field History',                module: 'Data',                  description: 'Per-field change tracking.' },
  { table: 'activities',                    label: 'Activity',                    pluralLabel: 'Activities',                   module: 'Data',                  description: 'Call, email, meeting, or status change activity.' },
  { table: 'notifications',                 label: 'Notification',                pluralLabel: 'Notifications',                module: 'Data',                  description: 'User-facing notification.' },
]

// Module order for sidebar / list grouping
export const MODULE_ORDER = [
  'CRM & Outreach',
  'Qualification',
  'Field Operations',
  'Incentives',
  'Stock',
  'Fleet',
  'People',
  'Configuration',
  'Portal',
  'User Interface',
  'Security',
  'Reports & Dashboards',
  'Data',
]

// Lookup helper
export function getObject(tableName) {
  return OBJECT_CATALOG.find(o => o.table === tableName)
}

// Grouped by module for rendering
export function getObjectsGrouped() {
  const byModule = {}
  for (const m of MODULE_ORDER) byModule[m] = []
  for (const o of OBJECT_CATALOG) {
    if (!byModule[o.module]) byModule[o.module] = []
    byModule[o.module].push(o)
  }
  for (const m of Object.keys(byModule)) {
    byModule[m].sort((a, b) => a.label.localeCompare(b.label))
  }
  return byModule
}
