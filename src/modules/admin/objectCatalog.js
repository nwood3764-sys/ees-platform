// Static catalog that categorizes every public table in the database
// into a module group with a human-readable label. This powers the Object
// Manager list view — without it, admins would just see a flat list of
// raw table names, which is useless for a 89-table schema.
//
// Each entry: { table, label, pluralLabel, module, description }
// `table` is the PostgreSQL table name (exact match)
// `module` groups objects in the Object Manager list
// `label` / `pluralLabel` are display names (like Salesforce Object Label / Plural)

const OBJECT_CATALOG_RAW = [
  // ─── ACCOUNTS, PROPERTIES & ENROLLMENT ─────────────────────────────────
  { table: 'accounts',                      label: 'Account',                     pluralLabel: 'Accounts',        description: 'Organization or household — record types: Property Owner, PMC, Partner Org, Customer Household, EES-WI Internal, etc.' },
  { table: 'account_contact_relations',     label: 'Account Contact Role',        pluralLabel: 'Account Contact Roles',        description: 'Junction — secondary contact relationships beyond a contact\'s primary account.' },
  { table: 'properties',                    label: 'Property',                    pluralLabel: 'Properties',        description: 'Physical site with one or more buildings.' },
  { table: 'buildings',                     label: 'Building',                    pluralLabel: 'Buildings',        description: 'Structure within a property — contains units.' },
  { table: 'units',                         label: 'Unit',                        pluralLabel: 'Units',        description: 'Individual dwelling within a building.' },
  { table: 'contacts',                      label: 'Contact',                     pluralLabel: 'Contacts',        description: 'Person associated with an account — internal staff, property owner contact, partner tech, tenant, etc.' },
  { table: 'enrollments',                   label: 'Enrollment',                  pluralLabel: 'Enrollments',        description: 'A property\'s enrollment into a program — record types are state-scoped programs.' },
  { table: 'opportunities',                 label: 'Opportunity',                 pluralLabel: 'Opportunities',        description: 'Pipeline record — potential project at a property.' },
  { table: 'opportunity_contact_roles',     label: 'Contact Role',    pluralLabel: 'Contact Roles',        description: 'Stakeholder role on an opportunity.' },
  { table: 'opportunity_line_items',        label: 'Opportunity Line Item',       pluralLabel: 'Opportunity Line Items',        description: 'Charge line on an opportunity — a program measure or incentive, priced through a price book entry.' },
  { table: 'price_books',                   label: 'Price Book',                  pluralLabel: 'Price Books',        description: 'Program price book — the set of items sellable on an opportunity of a given record type.' },
  { table: 'price_book_entries',            label: 'Price Book Entry',            pluralLabel: 'Price Book Entries',        description: 'A product priced into a price book; pricing a product here is what makes it chargeable.' },
  { table: 'opportunity_record_type_price_books', label: 'Record Type Price Book', pluralLabel: 'Record Type Price Books',        description: 'Maps an opportunity record type to its price book — the record type dictates the price book.' },
  { table: 'program_rebate_caps',           label: 'Program Rebate Cap',          pluralLabel: 'Program Rebate Caps',        description: 'The most a single dwelling unit may receive from a program across all measures (IRA HEAR: $14,000). Warns on the opportunity when the line items exceed it.' },

  // ─── SERVICE PROVIDERS ─────────────────────────────────────────────────
  { table: 'service_provider_applications',  label: 'Service Provider Application', pluralLabel: 'Service Provider Applications',      description: 'Subcontractor / service-provider signup application with an approval stage lifecycle.' },
  { table: 'service_provider_service_areas', label: 'Service Provider Service Area',pluralLabel: 'Service Provider Service Areas',      description: 'ZIP-code area of operation for a service-provider account.' },
  { table: 'service_provider_trades',        label: 'Service Provider Trade',      pluralLabel: 'Service Provider Trades',      description: 'A trade a service-provider account performs (multi-select; one row per trade, one marked primary).' },
  { table: 'service_provider_onboarding_step_templates', label: 'Onboarding Step Template', pluralLabel: 'Onboarding Step Templates', description: 'Configurable default onboarding steps (documents, interview, training) instantiated on each application.' },
  { table: 'service_provider_onboarding_steps', label: 'Onboarding Step',           pluralLabel: 'Onboarding Steps',      description: 'Per-application onboarding checklist step; the portal invite is gated on required steps being complete.' },
  { table: 'sp_payout_price_books',          label: 'Payout Price Book',           pluralLabel: 'Payout Price Books',      description: 'State-specific payout rate book; optional per-provider override book.' },
  { table: 'sp_payout_price_book_entries',   label: 'Payout Price Book Entry',     pluralLabel: 'Payout Price Book Entries',      description: 'Per-measure payout unit rate within a payout price book.' },
  { table: 'service_provider_proposals',     label: 'Service Provider Proposal',   pluralLabel: 'Service Provider Proposals',      description: 'Priced proposal issued to a provider for a work order / project; accepted or rejected.' },
  { table: 'service_provider_proposal_lines',label: 'Proposal Line',               pluralLabel: 'Proposal Lines',      description: 'Priced installed-measure line on a proposal (quantity x payout rate).' },
  { table: 'service_provider_invoices',      label: 'Service Provider Invoice',    pluralLabel: 'Service Provider Invoices',      description: 'Payable to a service provider, generated from an accepted proposal.' },
  { table: 'service_provider_invoice_line_items', label: 'Invoice Line',           pluralLabel: 'Invoice Lines',      description: 'Line item on a service-provider invoice.' },
  { table: 'service_provider_payments',      label: 'Service Provider Payment',    pluralLabel: 'Service Provider Payments',      description: 'Payment recorded against a service-provider invoice.' },

  // ─── QUALIFICATION ─────────────────────────────────────────────────────
  { table: 'assessments',                   label: 'Assessment',                  pluralLabel: 'Assessments',         description: 'Energy audit / ASHRAE Level 2 assessment.' },
  { table: 'diagnostic_tests',              label: 'Diagnostic Test',             pluralLabel: 'Diagnostic Tests',         description: 'Blower door, duct leakage, combustion safety test.' },
  { table: 'income_qualifications',         label: 'Income Qualification',        pluralLabel: 'Income Qualifications',         description: 'Per-unit income qualification record.' },
  { table: 'incentive_applications',        label: 'Incentive Application',       pluralLabel: 'Incentive Applications',         description: 'Program application submitted to an administering body.' },
  { table: 'property_programs',             label: 'Property Program',            pluralLabel: 'Property Programs',         description: 'Junction — which programs a property qualifies for.' },
  { table: 'efr_reports',                   label: 'EFR Report',                  pluralLabel: 'EFR Reports',         description: 'Electrification Feasibility Report (Denver).' },
  { table: 'mechanical_equipment',          label: 'Mechanical Equipment',        pluralLabel: 'Mechanical Equipment',         description: 'Existing equipment observed during audit.' },
  { table: 'ahri_equipment',                label: 'AHRI Equipment',              pluralLabel: 'AHRI Equipment',         description: 'AHRI-matched equipment proposal.' },
  { table: 'ahri_certificates',             label: 'AHRI Certificate',            pluralLabel: 'AHRI Certificates',         description: 'AHRI rating certificate for a matched system.' },
  { table: 'project_reservations',          label: 'Project Reservation',         pluralLabel: 'Project Reservations',         description: 'Program-issued reservation triggering scheduling.' },

  // ─── FIELD OPERATIONS ─────────────────────────────────────────────────
  { table: 'projects',                      label: 'Project',                     pluralLabel: 'Projects',      description: 'Active installation project.' },
  { table: 'work_orders',                   label: 'Work Order',                  pluralLabel: 'Work Orders',      description: 'Executable unit of field work.' },
  { table: 'work_plans',                    label: 'Work Plan',                   pluralLabel: 'Work Plans',      description: 'Step-by-step instructions attached to a work order.' },
  { table: 'work_steps',                    label: 'Work Step',                   pluralLabel: 'Work Steps',      description: 'Individual task within a work plan.' },
  { table: 'work_types',                    label: 'Work Type',                   pluralLabel: 'Work Types',      description: 'Named task with BOM and work plan (e.g. HP Install).' },
  { table: 'service_appointments',          label: 'Service Appointment',         pluralLabel: 'Service Appointments',      description: 'Scheduled on-site appointment for a work order.' },
  { table: 'service_appointment_assignments', label: 'Appointment Assignment',    pluralLabel: 'Appointment Assignments',      description: 'Crew-member-to-appointment assignment.' },
  { table: 'service_territories',           label: 'Service Territory',           pluralLabel: 'Service Territories',      description: 'Geographic region served.' },
  { table: 'locations',                     label: 'Location',                    pluralLabel: 'Locations',      description: 'Physical location (shop, warehouse, site).' },
  { table: 'gps_points',                    label: 'GPS Point',                   pluralLabel: 'GPS Points',      description: 'GPS coordinate captured during a field activity.' },
  { table: 'photos',                        label: 'Photo',                       pluralLabel: 'Photos',      description: 'Photo evidence attached to a work step.' },
  { table: 'documents',                     label: 'Document',                    pluralLabel: 'Documents',      description: 'File attached to any record.' },

  // ─── INCENTIVES ────────────────────────────────────────────────────────
  { table: 'project_payment_requests',      label: 'Payment Request',             pluralLabel: 'Payment Requests',            description: 'Invoice submitted to program administrator.' },
  { table: 'payment_receipts',              label: 'Payment Receipt',             pluralLabel: 'Payment Receipts',            description: 'Received payment matched to a request.' },

  // ─── STOCK ─────────────────────────────────────────────────────────────
  { table: 'products',                      label: 'Product',                     pluralLabel: 'Products',                 description: 'Catalog SKU — material, equipment, or assembly.' },
  { table: 'product_items',                 label: 'Product Item',                pluralLabel: 'Product Items',                 description: 'On-hand inventory row at a location.' },
  { table: 'product_assemblies',            label: 'Product Assembly',            pluralLabel: 'Product Assemblies',                 description: 'BOM — components that make up an assembly.' },
  { table: 'product_transfers',             label: 'Product Transfer',            pluralLabel: 'Product Transfers',                 description: 'Inventory movement between locations / vehicles.' },
  { table: 'materials_requests',            label: 'Materials Request',           pluralLabel: 'Materials Requests',                 description: 'Request from field for materials.' },
  { table: 'materials_request_line_items',  label: 'Materials Request Line',      pluralLabel: 'Materials Request Lines',                 description: 'Individual SKU line on a materials request.' },
  { table: 'price_books',                   label: 'Price Book',                  pluralLabel: 'Price Books',                 description: 'Named pricing list (wholesale, contract, program).' },
  { table: 'price_book_entries',            label: 'Price Book Entry',            pluralLabel: 'Price Book Entries',                 description: 'Product priced within a price book.' },
  { table: 'job_kits',                      label: 'Job Kit',                     pluralLabel: 'Job Kits',                 description: 'Pre-built bundle of materials for a work type.' },
  { table: 'job_kit_line_items',            label: 'Job Kit Line',                pluralLabel: 'Job Kit Lines',                 description: 'SKU line within a job kit.' },
  { table: 'equipment',                     label: 'Equipment',                   pluralLabel: 'Equipment',                 description: 'Non-consumable tool or gear.' },
  { table: 'equipment_activities',          label: 'Equipment Activity',          pluralLabel: 'Equipment Activities',                 description: 'Check-out, return, maintenance, inspection event.' },
  { table: 'equipment_containers',          label: 'Equipment Container',         pluralLabel: 'Equipment Containers',                 description: 'Toolbox, shelf, or rack — nests equipment.' },
  { table: 'equipment_information',         label: 'Equipment Info',              pluralLabel: 'Equipment Info',                 description: 'Reference data for a piece of equipment.' },

  // ─── FLEET ─────────────────────────────────────────────────────────────
  { table: 'vehicles',                      label: 'Vehicle',                     pluralLabel: 'Vehicles',                 description: 'Company vehicle — truck, van, trailer.' },
  { table: 'vehicle_activities',            label: 'Vehicle Activity',            pluralLabel: 'Vehicle Activities',                 description: 'Pre-trip, post-trip, fuel, maintenance, mileage log.' },
  { table: 'asset_assignments',             label: 'Asset Assignment',            pluralLabel: 'Asset Assignments',                 description: 'Who currently has this vehicle / equipment / phone.' },

  // ─── PEOPLE ────────────────────────────────────────────────────────────
  { table: 'users',                         label: 'User',                        pluralLabel: 'Users',                description: 'Energy Efficiency Services login account — auth + role + permissions. Linked to a contact via contacts.contact_user_id.' },
  { table: 'skills',                        label: 'Skill',                       pluralLabel: 'Skills',                description: 'Master catalog of skills. E.g., BPI Building Analyst, EPA 608, OSHA 30.' },
  { table: 'contact_skills',                label: 'Contact Skill',               pluralLabel: 'Contact Skills',                description: 'Junction (FSL ServiceResourceSkill) — a contact has a skill, with effective dates that handle cert expiry.' },
  { table: 'work_type_skill_requirements',  label: 'Work Type Skill Requirement', pluralLabel: 'Work Type Skill Requirements',                description: 'Junction (FSL SkillRequirement) — skills required to perform a Work Type. Drives the assignment matching engine.' },
  { table: 'time_sheets',                   label: 'Time Sheet',                  pluralLabel: 'Time Sheets',                description: 'Weekly time sheet header.' },
  { table: 'time_sheet_entries',            label: 'Time Sheet Entry',            pluralLabel: 'Time Sheet Entries',                description: 'Individual clock-in / clock-out entry.' },
  { table: 'occurrences',                   label: 'Occurrence',                  pluralLabel: 'Occurrences',                description: 'HR incident, safety event, disciplinary record.' },
  { table: 'occurrence_participants',       label: 'Occurrence Participant',      pluralLabel: 'Occurrence Participants',                description: 'Contact involved in an occurrence.' },
  { table: 'crew_phones',                   label: 'Crew Phone',                  pluralLabel: 'Crew Phones',                description: 'Company-issued phone tracked by named owner.' },

  // ─── CONFIGURATION / BUILDERS ─────────────────────────────────────────
  { table: 'programs',                      label: 'Program',                     pluralLabel: 'Programs',         description: 'Incentive program configuration.' },
  { table: 'program_stages',                label: 'Program Stage',               pluralLabel: 'Program Stages',         description: 'Lifecycle stage within a program.' },
  { table: 'program_document_requirements', label: 'Program Doc Requirement',     pluralLabel: 'Program Doc Requirements',         description: 'Documents required at a program stage.' },
  { table: 'email_templates',               label: 'Email Template',              pluralLabel: 'Email Templates',         description: 'Outbound email template with merge fields.' },
  { table: 'document_templates',            label: 'Document Template',           pluralLabel: 'Document Templates',         description: 'Rendered PDF / e-sign template.' },
  { table: 'submittal_document_text_blocks', label: 'Submittal Document Wording',  pluralLabel: 'Submittal Document Wording',         description: 'Program wording used on submittal documents (measure descriptions, acknowledgments, footers). Scope a block to an opportunity record type to override it for that program.' },
  { table: 'submittal_document_templates', label: 'Submittal Document Template', pluralLabel: 'Submittal Document Templates',         description: 'A submittal document as an ordered list of sections. Copy one to build another program\'s version.' },
  { table: 'submittal_document_template_sections', label: 'Submittal Document Section', pluralLabel: 'Submittal Document Sections',   description: 'One section of a submittal document template, with its editable content in Config.' },
  { table: 'stage_document_requirements',  label: 'Stage Document Requirement', pluralLabel: 'Stage Document Requirements',         description: 'Which documents a record needs at a given stage. Object-agnostic: point it at any table plus one of that object\'s status/stage values.' },
  { table: 'work_plan_templates',           label: 'Work Plan Template',          pluralLabel: 'Work Plan Templates',         description: 'Reusable work plan attached to work types.' },
  { table: 'work_plan_template_entries',    label: 'Work Plan Template Entry',    pluralLabel: 'Work Plan Template Entries',         description: 'Ordered step in a work plan template.' },
  { table: 'work_step_templates',           label: 'Work Step Template',          pluralLabel: 'Work Step Templates',         description: 'Reusable work step (guidance, evidence, verifier).' },
  { table: 'project_report_templates',                          label: 'Project Report Template',     pluralLabel: 'Project Report Templates',         description: 'Reusable layout for generated PDF project reports.' },
  { table: 'project_report_template_sections',                  label: 'Report Section',              pluralLabel: 'Report Sections',         description: 'Ordered section within a project report template.' },
  { table: 'project_report_template_record_type_assignments',   label: 'Report Template Assignment',  pluralLabel: 'Report Template Assignments',         description: 'Maps a project record type to a report template.' },
  { table: 'automation_rules',              label: 'Automation Rule',             pluralLabel: 'Automation Rules',         description: 'Trigger-based action (automation flow).' },
  { table: 'validation_rules',              label: 'Validation Rule',             pluralLabel: 'Validation Rules',         description: 'Pre-save rule that blocks with an error message.' },
  { table: 'picklist_values',               label: 'Picklist Value',              pluralLabel: 'Picklist Values',         description: 'Central picklist dictionary for every dropdown.' },

  // ─── PORTAL ────────────────────────────────────────────────────────────
  { table: 'portal_users',                  label: 'Portal User',                 pluralLabel: 'Portal Users',                description: 'External user with portal access.' },
  { table: 'comments',                      label: 'Comment',                     pluralLabel: 'Comments',                description: 'Record-level comment thread.' },
  { table: 'tasks',                         label: 'Task',                        pluralLabel: 'Tasks',                description: 'Action item assigned to a user.' },

  // ─── SYSTEM / SECURITY ────────────────────────────────────────────────
  { table: 'roles',                         label: 'Role',                        pluralLabel: 'Roles',              description: 'User role for row-level and field-level security.' },
  { table: 'permissions',                   label: 'Permission',                  pluralLabel: 'Permissions',              description: 'Named permission (module / object / action).' },
  { table: 'role_permissions',              label: 'Role Permission',             pluralLabel: 'Role Permissions',              description: 'Junction — which permissions a role has.' },
  { table: 'field_permissions',             label: 'Field Permission',            pluralLabel: 'Field Permissions',              description: 'Per-role, per-field visibility.' },

  // ─── USER INTERFACE (page layouts, list views, widgets) ───────────────
  { table: 'page_layouts',                  label: 'Page Layout',                 pluralLabel: 'Page Layouts',        description: 'Record detail layout — sections and widgets.' },
  { table: 'page_layout_sections',          label: 'Layout Section',              pluralLabel: 'Layout Sections',        description: 'Section within a page layout.' },
  { table: 'page_layout_widgets',           label: 'Layout Widget',               pluralLabel: 'Layout Widgets',        description: 'Field-group or related-list widget.' },
  { table: 'user_page_layout_overrides',    label: 'User Layout Override',        pluralLabel: 'User Layout Overrides',        description: 'Per-user customization on top of a page layout.' },
  { table: 'saved_list_views',              label: 'Saved List View',             pluralLabel: 'Saved List Views',        description: 'Named list view with filters and sort.' },
  { table: 'widget_types',                  label: 'Widget Type',                 pluralLabel: 'Widget Types',        description: 'Registered widget type available to page layouts.' },

  // ─── REPORTS & SCHEDULING ─────────────────────────────────────────────
  { table: 'reports',                       label: 'Report',                      pluralLabel: 'Reports',  description: 'Saved report definition.' },
  { table: 'scheduled_reports',             label: 'Scheduled Report',            pluralLabel: 'Scheduled Reports',  description: 'Report scheduled for automatic email delivery.' },

  // ─── DATA / AUDIT ─────────────────────────────────────────────────────
  { table: 'audit_log',                     label: 'Audit Log Entry',             pluralLabel: 'Audit Log',                  description: 'Append-only log of destructive / sensitive actions.' },
  { table: 'field_history',                 label: 'Field History Entry',         pluralLabel: 'Field History',                  description: 'Per-field change tracking.' },
  { table: 'activities',                    label: 'Activity',                    pluralLabel: 'Activities',                  description: 'Call, email, meeting, or status change activity.' },
  { table: 'notifications',                 label: 'Notification',                pluralLabel: 'Notifications',                  description: 'User-facing notification.' },
  { table: 'record_audit_column_overrides', label: 'Record Audit Column Override', pluralLabel: 'Record Audit Column Overrides',                 description: 'Which columns hold an object\'s created / last-modified stamps when they are not named by convention. Only objects that need an exception have a row; everything else resolves automatically.' },
  // Registered 2026-08-31: both are real objects that were missing here, and
  // the omission only surfaced when the report picker stopped keeping its own
  // hand-written list and started reading this catalog. Anything absent here is
  // absent from Object Manager, from module tabs, and now from reports.
  { table: 'envelopes',                     label: 'Envelope',                    pluralLabel: 'Envelopes',                  description: 'E-signature envelope — a document sent for signature, with its recipients and signing status.' },
  { table: 'chat_threads',                  label: 'Chat Thread',                 pluralLabel: 'Chat Threads',                  description: 'Internal chat conversation.' },
  { table: 'chat_messages',                 label: 'Chat Message',                pluralLabel: 'Chat Messages',                  description: 'One message within a chat thread.' },
]

// ─── Which group an object shows under ────────────────────────────────────
//
// These groups used to be hand-written on every entry: "CRM & Enrollment",
// "Field Operations", "People", "Data". They were Salesforce's vocabulary, not
// this platform's — Nicholas, 2026-08-31: "Why do you have CRM ever in here?
// That's just a weird thing. We would never do that." LEAP has no CRM module,
// no People module and no Data module; it has the modules in its sidebar.
//
// So the group is DERIVED from src/lib/objectNav.js, which already knows each
// object's real host module because navigation needs the same fact. One answer
// to "where does this object live", not two that can disagree — the same rule
// the nav registry itself was built on.
//
// An object the registry does not name has no module home, and says so rather
// than borrowing objectNav's navigation fallback, which would file every
// configuration table under Field.
import { objectNavFor } from '../../lib/objectNav.js'

export const UNGROUPED_OBJECTS = 'Setup & configuration'

export function objectGroupFor(table) {
  const nav = objectNavFor(table)
  return (nav?.isRegistered && nav.moduleLabel) ? nav.moduleLabel : UNGROUPED_OBJECTS
}

export const OBJECT_CATALOG = OBJECT_CATALOG_RAW.map(o => ({ ...o, module: objectGroupFor(o.table) }))

// Group order — the order the modules appear in the sidebar, so a grouped list
// reads the way the reader already navigates.
export const MODULE_ORDER = [
  'Outreach', 'Enrollment', 'Qualification', 'Project Planning',
  'Project Implementation', 'Field', 'Dispatch', 'Incentives', 'Stock', 'Fleet',
  'Service Providers', 'Portal', 'Reports', 'Tasks', 'Admin',
  UNGROUPED_OBJECTS,
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
