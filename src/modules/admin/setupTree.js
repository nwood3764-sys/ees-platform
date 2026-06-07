// Setup Home tree — mirrors Salesforce Setup's left navigation tree.
// Each leaf node has a `nodeId` that maps to a content renderer in SetupHome.jsx.
// Groups collapse / expand. Placeholder leaves show a "coming soon" stub.

export const SETUP_TREE = [
  {
    id: 'administration',
    label: 'Administration',
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    children: [
      { id: 'users',            label: 'Users' },
      { id: 'roles',            label: 'Roles' },
      { id: 'permission_sets',  label: 'Permission Sets' },
      { id: 'help_articles',    label: 'Help Articles' },
      { id: 'client_errors',    label: 'Client Errors' },
    ],
  },
  {
    id: 'objects_and_fields',
    label: 'Objects and Fields',
    icon: 'M4 7v10a2 2 0 002 2h12a2 2 0 002-2V7M4 7a2 2 0 012-2h12a2 2 0 012 2M4 7l2 3h12l2-3M8 13h8M8 17h5',
    children: [
      { id: 'object_manager',  label: 'Object Manager' },
      { id: 'record_types',    label: 'Record Types' },
      { id: 'picklist_values', label: 'All Picklist Values (reference)' },
    ],
  },
  {
    id: 'process_automation',
    label: 'Process Automation',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    children: [
      { id: 'lifecycle_builder', label: 'Lifecycle Builder' },
      { id: 'automation_rules', label: 'Flows (Automation Rules)' },
      { id: 'automation_run_log', label: 'Automation Run Log' },
      { id: 'validation_rules', label: 'Validation Rules' },
    ],
  },
  {
    id: 'user_interface',
    label: 'User Interface',
    icon: 'M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2',
    children: [
      { id: 'page_layouts',      label: 'Page Layouts' },
      { id: 'module_sections',   label: 'Module Tabs' },
      { id: 'saved_list_views',  label: 'Saved List Views' },
    ],
  },
  {
    id: 'communication_templates',
    label: 'Communication Templates',
    icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
    children: [
      { id: 'email_templates',    label: 'Email Templates' },
      { id: 'document_templates', label: 'Document Templates' },
      { id: 'envelopes',          label: 'Envelopes' },
      { id: 'outbound_mailboxes', label: 'Outbound Mailboxes' },
      { id: 'unmatched_inbox',    label: 'Unmatched Inbox' },
    ],
  },
  {
    id: 'business_config',
    label: 'Business Configuration',
    icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
    children: [
      { id: 'programs',                  label: 'Programs' },
      { id: 'work_types',                label: 'Work Types' },
      { id: 'work_plan_templates',       label: 'Work Plan Templates' },
      { id: 'work_step_templates',       label: 'Work Step Templates' },
      { id: 'project_report_templates',  label: 'Project Report Templates' },
      { id: 'work_type_skill_requirements', label: 'Work Type Skill Requirements' },
      { id: 'service_territories',       label: 'Service Territories' },
      { id: 'service_territory_members', label: 'Scheduling Resources' },
      { id: 'resource_absences',         label: 'Resource Absences' },
      { id: 'skills',                    label: 'Skills' },
    ],
  },
  {
    id: 'portals',
    label: 'Portals',
    icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    children: [
      { id: 'portals',                 label: 'Portals' },
      { id: 'portal_role_assignments', label: 'Portal Role Assignments' },
      { id: 'object_chat_enabled',     label: 'Object Chat Settings' },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4',
    children: [
      { id: 'bulk_property_import', label: 'Bulk Property Import' },
      { id: 'audit_log',            label: 'Audit Log' },
      { id: 'recycle_bin',          label: 'Recycle Bin' },
      { id: 'seed_data_purge',      label: 'Seed Data Purge' },
    ],
  },
]
