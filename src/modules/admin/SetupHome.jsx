import { useState, useMemo, useEffect } from 'react'
import { C } from '../../data/constants'
import { Icon, LoadingState, ErrorState } from '../../components/UI'
import { ListView } from '../../components/ListView'
import { useIsMobile } from '../../lib/useMediaQuery'
import { SETUP_TREE } from './setupTree'
import UsersPane from './UsersPane'
import {
  fetchRoles, fetchPrograms, fetchWorkTypes,
  fetchEmailTemplates, fetchDocumentTemplates, fetchEnvelopes,
  fetchAutomationRules, fetchValidationRules,
  fetchPicklistValues, fetchAuditLog,
  fetchAllPageLayouts,
  fetchWorkPlanTemplates,
  fetchWorkStepTemplates,
  fetchProjectReportTemplates,
  fetchSkills,
  fetchWorkTypeSkillRequirements,
} from '../../data/adminService'

// ---------------------------------------------------------------------------
// Setup Home — Salesforce-style left tree nav + right content pane.
// The tree (from setupTree.js) is a shallow two-level structure. Leaf nodes
// carry a `nodeId` that maps to a renderer in NODE_RENDERERS below.
// ---------------------------------------------------------------------------

export default function SetupHome({ onOpenObjectManager, onOpenRecord }) {
  const [selectedId, setSelectedId] = useState(null)    // e.g. 'users', 'automation_rules'
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(() =>
    Object.fromEntries(SETUP_TREE.map(g => [g.id, true]))
  )
  // On mobile we treat the two panes as a drill-in navigation stack rather
  // than a side-by-side layout. Desktop keeps the classic Salesforce-style
  // left tree + right detail.
  const isMobile = useIsMobile()

  // Search filter — matches leaf labels, returns which groups contain matches
  const filteredTree = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return SETUP_TREE
    return SETUP_TREE.map(g => ({
      ...g,
      children: g.children.filter(c => c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)),
    })).filter(g => g.children.length > 0)
  }, [search])

  // Auto-expand all groups when searching
  useEffect(() => {
    if (search.trim()) {
      setExpanded(Object.fromEntries(SETUP_TREE.map(g => [g.id, true])))
    }
  }, [search])

  const handleSelect = (nodeId) => {
    if (nodeId === 'object_manager') {
      onOpenObjectManager()
      return
    }
    setSelectedId(nodeId)
  }

  // Look up the label for the current node so the mobile back header can
  // show "< Setup Home / <Label>" while the detail is open.
  const selectedLabel = useMemo(() => {
    if (!selectedId) return null
    for (const g of SETUP_TREE) {
      const hit = g.children.find(c => c.id === selectedId)
      if (hit) return hit.label
    }
    return null
  }, [selectedId])

  // Mobile drill-in: when a node is selected, show only the detail pane with
  // a back affordance. When nothing is selected, show only the tree.
  if (isMobile) {
    if (selectedId) {
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Back header — tapping returns to the tree */}
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            style={{
              flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 14px',
              background: C.card, border: 'none',
              borderBottom: `1px solid ${C.border}`,
              color: C.textSecondary, fontSize: 13, fontWeight: 500,
              cursor: 'pointer', textAlign: 'left', minHeight: 44,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span style={{ color: C.textMuted }}>Setup</span>
            <span style={{ color: C.textMuted }}>/</span>
            <span style={{ color: C.textPrimary }}>{selectedLabel || 'Detail'}</span>
          </button>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <NodeContent
              nodeId={selectedId}
              onOpenRecord={onOpenRecord}
              onOpenObjectManager={onOpenObjectManager}
            />
          </div>
        </div>
      )
    }

    // Mobile tree view — full width, no detail pane.
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.card }}>
        <TreePane
          search={search}
          setSearch={setSearch}
          filteredTree={filteredTree}
          expanded={expanded}
          setExpanded={setExpanded}
          selectedId={selectedId}
          onSelect={handleSelect}
          isMobile
        />
      </div>
    )
  }

  // Desktop: classic side-by-side. Tree on the left, detail on the right.
  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* ─── Left tree nav ─────────────────────────────────────────── */}
      <div style={{
        width: 260, flexShrink: 0,
        background: C.card, borderRight: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <TreePane
          search={search}
          setSearch={setSearch}
          filteredTree={filteredTree}
          expanded={expanded}
          setExpanded={setExpanded}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </div>

      {/* ─── Right content pane ────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {selectedId
          ? <NodeContent nodeId={selectedId} onOpenRecord={onOpenRecord} onOpenObjectManager={onOpenObjectManager} />
          : <WelcomePane onOpenObjectManager={onOpenObjectManager} />}
      </div>
    </div>
  )
}

// ─── Tree pane — shared between desktop (left column) and mobile (full width).
// Search at the top, scrollable group/leaf list below. Leaf taps fire onSelect.
// Padding and font sizing nudged up a touch on mobile so leaves hit the 40px+
// tap-target guideline without surgery on the desktop look.
// ─────────────────────────────────────────────────────────────────────────────
function TreePane({ search, setSearch, filteredTree, expanded, setExpanded, selectedId, onSelect, isMobile = false }) {
  return (
    <>
      {/* Search bar at top of tree */}
      <div style={{ padding: isMobile ? '14px 14px' : '12px 14px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ position: 'relative' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Quick Find"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: isMobile ? '10px 10px 10px 30px' : '6px 10px 6px 30px',
              border: `1px solid ${C.border}`, borderRadius: 5,
              fontSize: isMobile ? 14 : 12.5, background: C.page,
              color: C.textPrimary, outline: 'none', boxSizing: 'border-box',
            }}
            onFocus={e => e.currentTarget.style.borderColor = C.emerald}
            onBlur={e => e.currentTarget.style.borderColor = C.border}
          />
        </div>
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {filteredTree.map(group => {
          const isOpen = !!expanded[group.id]
          return (
            <div key={group.id}>
              <div
                onClick={() => setExpanded(prev => ({ ...prev, [group.id]: !prev[group.id] }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: isMobile ? '12px 14px' : '7px 14px',
                  cursor: 'pointer',
                  fontSize: isMobile ? 12 : 12, fontWeight: 600, color: C.textSecondary,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                  userSelect: 'none',
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                  <path d="M9 5l7 7-7 7" />
                </svg>
                <Icon path={group.icon} size={13} color={C.textMuted} />
                <span>{group.label}</span>
              </div>
              {isOpen && group.children.map(node => {
                const isActive = selectedId === node.id
                return (
                  <div
                    key={node.id}
                    onClick={() => onSelect(node.id)}
                    style={{
                      padding: isMobile ? '12px 14px 12px 40px' : '6px 14px 6px 40px',
                      fontSize: isMobile ? 14.5 : 12.5,
                      color: isActive ? C.textPrimary : C.textSecondary,
                      fontWeight: isActive ? 500 : 400,
                      background: isActive ? '#f0f9f5' : 'transparent',
                      borderLeft: isActive ? `3px solid ${C.emerald}` : '3px solid transparent',
                      cursor: 'pointer',
                      transition: 'all 0.1s',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f7f9fc' }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                  >
                    {node.label}
                  </div>
                )
              })}
            </div>
          )
        })}

        {filteredTree.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: C.textMuted, fontSize: 12 }}>
            No matches for "{search}".
          </div>
        )}
      </div>
    </>
  )
}

// ─── Welcome pane (shown on initial load) ──────────────────────────────

function WelcomePane({ onOpenObjectManager }) {
  const quickLinks = [
    { label: 'Object Manager',    hint: 'Manage tables, fields, page layouts',        onClick: onOpenObjectManager,  highlight: true },
    { label: 'Users',             hint: 'Anura user accounts',                        nodeId: 'users' },
    { label: 'Roles',             hint: 'Row-level and field-level security roles',   nodeId: 'roles' },
    { label: 'Picklist Value Sets', hint: 'Central dictionary for every dropdown',    nodeId: 'picklist_values' },
    { label: 'Page Layouts',      hint: 'Record detail layouts',                      nodeId: 'page_layouts' },
    { label: 'Flows',             hint: 'Automation rules that trigger on records',   nodeId: 'automation_rules' },
    { label: 'Validation Rules',  hint: 'Pre-save rules that block with error msgs',  nodeId: 'validation_rules' },
    { label: 'Email Templates',   hint: 'Outbound email templates with merge fields', nodeId: 'email_templates' },
  ]

  return (
    <div style={{ padding: '28px 32px', overflow: 'auto', flex: 1 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary }}>Setup</div>
      <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 4, marginBottom: 24 }}>
        System configuration, automation, security, and metadata. Manage everything Anura Admin controls from here.
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 10 }}>Most Visited</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {quickLinks.map(link => (
          <div key={link.label}
            onClick={link.onClick}
            style={{
              background: link.highlight ? '#f0f9f5' : C.card,
              border: `1px solid ${link.highlight ? C.emerald : C.border}`,
              borderRadius: 8, padding: '12px 14px',
              cursor: link.onClick ? 'pointer' : 'default',
            }}
            onMouseEnter={e => { if (link.onClick) e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)' }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: link.highlight ? '#1a7a4e' : C.textPrimary, marginBottom: 3 }}>
              {link.label}
            </div>
            <div style={{ fontSize: 11.5, color: C.textMuted }}>{link.hint}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 28, fontSize: 12, color: C.textMuted }}>
        Select any item from the left nav to view or edit configuration.
      </div>
    </div>
  )
}

// ─── Node content — renders whichever setup item is selected ───────────

function NodeContent({ nodeId, onOpenRecord, onOpenObjectManager }) {
  // Each node is rendered by a dedicated component that loads its own data.
  switch (nodeId) {
    case 'users':             return <UsersPane onOpenRecord={onOpenRecord} />
    case 'roles':             return <NodePage title="Roles"                   table="roles"             fetcher={fetchRoles}             columns={ROLE_COLS}           newLabel="Role"             onOpenRecord={onOpenRecord} />
    case 'permissions':       return <PermissionsPane onOpenObjectManager={onOpenObjectManager} />
    case 'field_permissions': return <FieldPermissionsPane onOpenObjectManager={onOpenObjectManager} />
    case 'picklist_values':   return <NodePage title="Picklist Value Sets"     table="picklist_values"   fetcher={fetchPicklistValues}    columns={PL_COLS}             newLabel="Picklist Value"   onOpenRecord={onOpenRecord} />
    case 'record_types':      return <RecordTypesNodePane onOpenObjectManager={onOpenObjectManager} />
    case 'automation_rules':  return <NodePage title="Flows (Automation Rules)" table="automation_rules" fetcher={fetchAutomationRules}   columns={AR_COLS}             newLabel="Automation Rule"  onOpenRecord={onOpenRecord} />
    case 'validation_rules':  return <NodePage title="Validation Rules"        table="validation_rules"  fetcher={fetchValidationRules}   columns={VR_COLS}             newLabel="Validation Rule"  onOpenRecord={onOpenRecord} />
    case 'page_layouts':      return <NodePage title="Page Layouts"            table="page_layouts"      fetcher={fetchAllPageLayouts}    columns={PAGELAYOUT_COLS}     newLabel="Page Layout"      onOpenRecord={onOpenRecord} />
    case 'saved_list_views':  return <ComingSoonPane label="Saved List Views" />
    case 'email_templates':   return <NodePage title="Email Templates"         table="email_templates"   fetcher={fetchEmailTemplates}    columns={ET_COLS}             newLabel="Email Template"   onOpenRecord={onOpenRecord} />
    case 'document_templates':return <NodePage title="Document Templates"      table="document_templates" fetcher={fetchDocumentTemplates} columns={DT_COLS}            newLabel="Document Template" onOpenRecord={onOpenRecord} />
    case 'envelopes':         return <NodePage title="Envelopes"               table="envelopes"         fetcher={fetchEnvelopes}         columns={ENV_COLS}            newLabel={null}             onOpenRecord={onOpenRecord} />
    case 'programs':          return <NodePage title="Programs"                table="programs"          fetcher={fetchPrograms}          columns={PROG_COLS}           newLabel="Program"          onOpenRecord={onOpenRecord} />
    case 'work_types':        return <NodePage title="Work Types"              table="work_types"        fetcher={fetchWorkTypes}         columns={WT_COLS}             newLabel="Work Type"        onOpenRecord={onOpenRecord} />
    case 'work_plan_templates': return <WorkPlanTemplatesPane onOpenRecord={onOpenRecord} />
    case 'work_step_templates': return <NodePage title="Work Step Templates"   table="work_step_templates" fetcher={fetchWorkStepTemplates} columns={WST_COLS}            newLabel="Work Step Template" onOpenRecord={onOpenRecord} />
    case 'project_report_templates': return <NodePage title="Project Report Templates" table="project_report_templates" fetcher={fetchProjectReportTemplates} columns={PRT_COLS} newLabel="Project Report Template" onOpenRecord={onOpenRecord} />
    case 'service_territories': return <ComingSoonPane label="Service Territories" />
    case 'skills':              return <NodePage title="Skills"                  table="skills"                       fetcher={fetchSkills}                       columns={SKILL_COLS} newLabel="Skill"                       onOpenRecord={onOpenRecord} />
    case 'work_type_skill_requirements': return <NodePage title="Work Type Skill Requirements" table="work_type_skill_requirements" fetcher={fetchWorkTypeSkillRequirements} columns={WTSR_COLS}  newLabel="Skill Requirement"           onOpenRecord={onOpenRecord} />
    case 'audit_log':         return <NodePage title="Audit Log"               table="audit_log"         fetcher={fetchAuditLog}          columns={AL_COLS}             newLabel={null}             onOpenRecord={null} />
    default:                  return <ComingSoonPane label={nodeId} />
  }
}

// ─── NodePage — generic wrapper that loads data + renders a ListView ───

function NodePage({ title, table, fetcher, columns, newLabel, onOpenRecord }) {
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetcher()
      .then(d => { if (!cancelled) setData(d) })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetcher])

  const systemViews = [{ id: 'AV', name: 'All', filters: [], sortField: columns[0]?.field, sortDir: 'asc' }]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>{title}</div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          {loading ? 'Loading…' : `${data.length} record${data.length === 1 ? '' : 's'}`}
        </div>
      </div>
      {loading && <LoadingState />}
      {error && !loading && <ErrorState error={error} />}
      {!loading && !error && (
        <ListView
          data={data}
          columns={columns}
          systemViews={systemViews}
          defaultViewId="AV"
          newLabel={newLabel}
          onNew={newLabel && onOpenRecord ? () => onOpenRecord({ table, id: null, mode: 'create' }) : undefined}
          onOpenRecord={onOpenRecord ? row => row?._id && onOpenRecord({ table, id: row._id, name: row.name || row.id }) : undefined}
        />
      )}
    </div>
  )
}

function PermissionsPane({ onOpenObjectManager }) {
  return (
    <div style={{ padding: '28px 32px', overflow: 'auto', flex: 1 }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Permissions</div>
      <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 6, maxWidth: 640, lineHeight: 1.5 }}>
        Named permissions (module / object / action) assigned to roles via the role_permissions
        junction table. Permission editing UI is in the build queue — for now, view the underlying
        table in Object Manager.
      </div>
      <button onClick={onOpenObjectManager} style={{
        marginTop: 18, background: C.emerald, color: '#fff', border: 'none',
        padding: '8px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
      }}>Open in Object Manager</button>
    </div>
  )
}

function FieldPermissionsPane({ onOpenObjectManager }) {
  return (
    <div style={{ padding: '28px 32px', overflow: 'auto', flex: 1 }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Field-Level Security</div>
      <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 6, maxWidth: 640, lineHeight: 1.5 }}>
        Per-role, per-field visibility and edit permissions. The financial tier (Tier 1, 2, 3)
        system is implemented through this table. A dedicated per-object permission matrix editor
        is in the build queue.
      </div>
      <button onClick={onOpenObjectManager} style={{
        marginTop: 18, background: C.emerald, color: '#fff', border: 'none',
        padding: '8px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
      }}>Open field_permissions in Object Manager</button>
    </div>
  )
}

function RecordTypesNodePane({ onOpenObjectManager }) {
  return (
    <div style={{ padding: '28px 32px', overflow: 'auto', flex: 1 }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Record Types</div>
      <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 6, maxWidth: 640, lineHeight: 1.5 }}>
        Record types in Anura are defined per-object via picklist values with{' '}
        <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, background: C.page, padding: '1px 5px', borderRadius: 3 }}>picklist_field = 'record_type'</code>.
        To view or manage record types for a specific object, open that object in the Object Manager
        and go to the Record Types sub-tab.
      </div>
      <button onClick={onOpenObjectManager} style={{
        marginTop: 18, background: C.emerald, color: '#fff', border: 'none',
        padding: '8px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
      }}>Open Object Manager</button>
    </div>
  )
}

// ─── Work Plan Templates pane (Work Plan Builder) ──────────────────────
//
// Bespoke pane (rather than NodePage) so we can tailor the pluralization
// ("templates" vs "records") and the click-to-open hint. Clicking a row
// opens RecordDetail in view mode; the New button opens RecordDetail in
// insert mode. The detail page itself is rendered by the standard
// dynamic page_layout system — the bespoke piece is only the list shell.

function WorkPlanTemplatesPane({ onOpenRecord }) {
  const [plans, setPlans]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchWorkPlanTemplates()
      .then(d => { if (!cancelled) setPlans(d) })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const systemViews = [{ id: 'AV', name: 'All', filters: [], sortField: 'id', sortDir: 'asc' }]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Work Plan Templates</div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          {loading ? 'Loading…' : `${plans.length} template${plans.length === 1 ? '' : 's'}`}
          {!loading && ' — click a row to open the record'}
        </div>
      </div>
      {loading && <LoadingState />}
      {error && !loading && <ErrorState error={error} />}
      {!loading && !error && (
        <ListView
          data={plans}
          columns={WPT_COLS}
          systemViews={systemViews}
          defaultViewId="AV"
          newLabel="Work Plan Template"
          onNew={onOpenRecord ? () => onOpenRecord({ table: 'work_plan_templates', id: null, mode: 'create' }) : undefined}
          onOpenRecord={row => {
            if (!row?._id || !onOpenRecord) return
            onOpenRecord({
              table: 'work_plan_templates',
              id: row._id,
              name: row.name || row.id,
            })
          }}
        />
      )}
    </div>
  )
}

function ComingSoonPane({ label }) {
  return (
    <div style={{ padding: '60px 32px', textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: 15, fontWeight: 500, color: C.textPrimary, marginBottom: 6 }}>
        {label} — coming soon
      </div>
      <div style={{ fontSize: 12, color: C.textMuted, maxWidth: 520, margin: '0 auto' }}>
        This configuration surface is on the roadmap. Underlying data is accessible via the
        Object Manager in the meantime.
      </div>
    </div>
  )
}

// ─── Column definitions for each list view ─────────────────────────────
// Note: Users columns live with UsersPane (their own pane handles invite
// flow and an extra Sign-In column), so they're not declared here.

const ROLE_COLS = [
  { field: 'id',          label: 'Record #',    type: 'text',   sortable: true, filterable: false },
  { field: 'name',        label: 'Role',        type: 'text',   sortable: true, filterable: true },
  { field: 'description', label: 'Description', type: 'text',   sortable: false, filterable: true },
  { field: 'status',      label: 'Status',      type: 'select', sortable: true, filterable: true, options: ['Active', 'Inactive'] },
]

const PROG_COLS = [
  { field: 'id',                label: 'Short Name',     type: 'text', sortable: true, filterable: false },
  { field: 'name',              label: 'Program',        type: 'text', sortable: true, filterable: true },
  { field: 'state',             label: 'State',          type: 'select', sortable: true, filterable: true, options: ['WI', 'NC', 'CO', 'MI', 'IN', 'All'] },
  { field: 'programType',       label: 'Type',           type: 'text', sortable: true, filterable: true },
  { field: 'housingType',       label: 'Housing',        type: 'text', sortable: true, filterable: true },
  { field: 'roleType',          label: 'Our Role',       type: 'text', sortable: true, filterable: true },
  { field: 'administeringBody', label: 'Administered By',type: 'text', sortable: true, filterable: true },
  { field: 'year',              label: 'Year',           type: 'text', sortable: true, filterable: false },
  { field: 'version',           label: 'Version',        type: 'text', sortable: true, filterable: false },
  { field: 'status',            label: 'Status',         type: 'text', sortable: true, filterable: true },
]

const WT_COLS = [
  { field: 'id',          label: 'Record #',    type: 'text', sortable: true, filterable: false },
  { field: 'name',        label: 'Work Type',   type: 'text', sortable: true, filterable: true },
  { field: 'description', label: 'Description', type: 'text', sortable: false, filterable: true },
  { field: 'estDuration', label: 'Est. Duration', type: 'text', sortable: true, filterable: false },
  { field: 'minCrew',     label: 'Min Crew',    type: 'text', sortable: true, filterable: false },
  { field: 'recCrew',     label: 'Rec Crew',    type: 'text', sortable: true, filterable: false },
  { field: 'status',      label: 'Status',      type: 'select', sortable: true, filterable: true, options: ['Active', 'Inactive'] },
]

const WPT_COLS = [
  { field: 'id',            label: 'Record #',       type: 'text',   sortable: true, filterable: false },
  { field: 'name',          label: 'Work Plan',      type: 'text',   sortable: true, filterable: true },
  { field: 'description',   label: 'Description',    type: 'text',   sortable: false, filterable: true },
  { field: 'stepCount',     label: 'Steps',          type: 'text',   sortable: true, filterable: false },
  { field: 'totalDuration', label: 'Total Duration', type: 'text',   sortable: true, filterable: false },
  { field: 'status',        label: 'Status',         type: 'select', sortable: true, filterable: true, options: ['Active', 'Inactive'] },
]

const WST_COLS = [
  { field: 'id',           label: 'Record #',      type: 'text',   sortable: true, filterable: false },
  { field: 'name',         label: 'Step Template', type: 'text',   sortable: true, filterable: true },
  { field: 'description',  label: 'Description',   type: 'text',   sortable: false, filterable: true },
  { field: 'duration',     label: 'Est. Duration', type: 'text',   sortable: true, filterable: false },
  { field: 'evidenceType', label: 'Evidence',      type: 'text',   sortable: true, filterable: true },
  { field: 'ownerRole',    label: 'Owner Role',    type: 'text',   sortable: true, filterable: true },
  { field: 'status',       label: 'Status',        type: 'select', sortable: true, filterable: true, options: ['Active', 'Inactive'] },
]

const PRT_COLS = [
  { field: 'id',                   label: 'Record #',     type: 'text',   sortable: true, filterable: false },
  { field: 'name',                 label: 'Template',     type: 'text',   sortable: true, filterable: true  },
  { field: 'description',          label: 'Description',  type: 'text',   sortable: false, filterable: true },
  { field: 'status',               label: 'Status',       type: 'select', sortable: true, filterable: true, options: ['Draft', 'Active', 'Archived'] },
  { field: 'orientation',          label: 'Orient.',      type: 'select', sortable: true, filterable: true, options: ['Portrait', 'Landscape'] },
  { field: 'paperSize',            label: 'Paper',        type: 'text',   sortable: true, filterable: true  },
  { field: 'sectionCount',         label: 'Sections',     type: 'text',   sortable: true, filterable: false },
  { field: 'assignmentCount',      label: 'Assignments',  type: 'text',   sortable: true, filterable: false },
  { field: 'isDefaultForUnmapped', label: 'Fallback',     type: 'select', sortable: true, filterable: true, options: ['Yes', 'No'] },
  { field: 'version',              label: 'Version',      type: 'text',   sortable: true, filterable: false },
]

const SKILL_COLS = [
  { field: 'id',             label: 'Record #',     type: 'text',   sortable: true, filterable: false },
  { field: 'name',           label: 'Skill',        type: 'text',   sortable: true, filterable: true  },
  { field: 'category',       label: 'Category',     type: 'text',   sortable: true, filterable: true  },
  { field: 'issuingBody',    label: 'Issuing Body', type: 'text',   sortable: true, filterable: true  },
  { field: 'requiresCert',   label: 'Cert Backed',  type: 'select', sortable: true, filterable: true, options: ['Yes', 'No'] },
  { field: 'validityMonths', label: 'Validity (mo)',type: 'text',   sortable: true, filterable: false },
]

const WTSR_COLS = [
  { field: 'id',             label: 'Record #',  type: 'text', sortable: true, filterable: false },
  { field: 'workType',       label: 'Work Type', type: 'text', sortable: true, filterable: true  },
  { field: 'workTypeNumber', label: 'WT #',      type: 'text', sortable: true, filterable: false },
  { field: 'skill',          label: 'Skill',     type: 'text', sortable: true, filterable: true  },
  { field: 'skillNumber',    label: 'Skill #',   type: 'text', sortable: true, filterable: false },
  { field: 'minLevel',       label: 'Min Level', type: 'text', sortable: true, filterable: false },
]

const ET_COLS = [
  { field: 'id',            label: 'Record #',      type: 'text', sortable: true, filterable: false },
  { field: 'name',          label: 'Template',      type: 'text', sortable: true, filterable: true },
  { field: 'subject',       label: 'Subject',       type: 'text', sortable: true, filterable: true },
  { field: 'relatedObject', label: 'Object',        type: 'text', sortable: true, filterable: true },
  { field: 'state',         label: 'State',         type: 'select', sortable: true, filterable: true, options: ['WI', 'NC', 'CO', 'MI', 'IN', '—'] },
  { field: 'triggerStatus', label: 'Trigger Status',type: 'text', sortable: true, filterable: true },
  { field: 'automated',     label: 'Auto',          type: 'select', sortable: true, filterable: true, options: ['Yes', 'No'] },
  { field: 'version',       label: 'Version',       type: 'number', sortable: true, filterable: false },
  { field: 'status',        label: 'Status',        type: 'select', sortable: true, filterable: true, options: ['Draft', 'Active', 'Archived', '—'] },
]

const DT_COLS = [
  { field: 'id',                label: 'Record #',         type: 'text', sortable: true, filterable: false },
  { field: 'name',              label: 'Document Template',type: 'text', sortable: true, filterable: true },
  { field: 'templateType',      label: 'Type',             type: 'text', sortable: true, filterable: true },
  { field: 'relatedObject',     label: 'Object',           type: 'text', sortable: true, filterable: true },
  { field: 'requiresSignature', label: 'Signature',        type: 'select', sortable: true, filterable: true, options: ['Yes', 'No'] },
  { field: 'signerRole',        label: 'Signer Role',      type: 'text', sortable: true, filterable: true },
  { field: 'automated',         label: 'Auto',             type: 'select', sortable: true, filterable: true, options: ['Yes', 'No'] },
  { field: 'version',           label: 'Version',          type: 'number', sortable: true, filterable: false },
  { field: 'status',            label: 'Status',           type: 'select', sortable: true, filterable: true, options: ['Draft', 'Active', 'Archived', '—'] },
]

const ENV_COLS = [
  { field: 'id',                 label: 'Record #',     type: 'text', sortable: true, filterable: false },
  { field: 'name',               label: 'Envelope',     type: 'text', sortable: true, filterable: true },
  { field: 'template',           label: 'Template',     type: 'text', sortable: true, filterable: true },
  { field: 'parentObject',       label: 'Parent',       type: 'text', sortable: true, filterable: true },
  { field: 'sentAt',             label: 'Sent',         type: 'text', sortable: true, filterable: false },
  { field: 'completedAt',        label: 'Completed',    type: 'text', sortable: true, filterable: false },
  { field: 'status',             label: 'Status',       type: 'select', sortable: true, filterable: true, options: ['Draft','Sent — Awaiting Signature','Delivered to First Signer','Completed — All Signed','Declined','Voided','Failed to Send','—'] },
]

const AR_COLS = [
  { field: 'id',             label: 'Record #',      type: 'text', sortable: true, filterable: false },
  { field: 'name',           label: 'Rule',          type: 'text', sortable: true, filterable: true },
  { field: 'triggerObject',  label: 'Trigger Object',type: 'text', sortable: true, filterable: true },
  { field: 'triggerEvent',   label: 'Event',         type: 'text', sortable: true, filterable: true },
  { field: 'triggerStatus',  label: 'Status',        type: 'text', sortable: true, filterable: true },
  { field: 'actionType',     label: 'Action',        type: 'text', sortable: true, filterable: true },
  { field: 'executionOrder', label: 'Order',         type: 'text', sortable: true, filterable: false },
  { field: 'status',         label: 'Active?',       type: 'select', sortable: true, filterable: true, options: ['Active', 'Inactive'] },
]

const VR_COLS = [
  { field: 'id',             label: 'Record #',      type: 'text', sortable: true, filterable: false },
  { field: 'name',           label: 'Rule',          type: 'text', sortable: true, filterable: true },
  { field: 'relatedObject',  label: 'Object',        type: 'text', sortable: true, filterable: true },
  { field: 'blockOnEvent',   label: 'Blocks On',     type: 'text', sortable: true, filterable: true },
  { field: 'blockOnStatus',  label: 'At Status',     type: 'text', sortable: true, filterable: true },
  { field: 'errorMessage',   label: 'Error Message', type: 'text', sortable: false, filterable: false },
  { field: 'status',         label: 'Active?',       type: 'select', sortable: true, filterable: true, options: ['Active', 'Inactive'] },
]

const PL_COLS = [
  { field: 'id',        label: 'Record #', type: 'text', sortable: true, filterable: false },
  { field: 'object',    label: 'Object',   type: 'text', sortable: true, filterable: true },
  { field: 'field',     label: 'Field',    type: 'text', sortable: true, filterable: true },
  { field: 'value',     label: 'Value',    type: 'text', sortable: true, filterable: true },
  { field: 'label',     label: 'Label',    type: 'text', sortable: true, filterable: true },
  { field: 'sortOrder', label: 'Order',    type: 'text', sortable: true, filterable: false },
  { field: 'status',    label: 'Status',   type: 'select', sortable: true, filterable: true, options: ['Active', 'Inactive'] },
]

const PAGELAYOUT_COLS = [
  { field: 'id',        label: 'Record #',  type: 'text', sortable: true, filterable: false },
  { field: 'name',      label: 'Name',      type: 'text', sortable: true, filterable: true },
  { field: 'object',    label: 'Object',    type: 'text', sortable: true, filterable: true },
  { field: 'type',      label: 'Type',      type: 'text', sortable: true, filterable: true },
  { field: 'isDefault', label: 'Default',   type: 'select', sortable: true, filterable: true, options: ['Yes', 'No'] },
  { field: 'updatedAt', label: 'Updated',   type: 'text', sortable: true, filterable: false },
]

const AL_COLS = [
  { field: 'timestamp', label: 'Timestamp', type: 'text', sortable: true, filterable: false },
  { field: 'action',    label: 'Action',    type: 'text', sortable: true, filterable: true },
  { field: 'object',    label: 'Object',    type: 'text', sortable: true, filterable: true },
  { field: 'recordId',  label: 'Record',    type: 'text', sortable: false, filterable: false },
  { field: 'notes',     label: 'Notes',     type: 'text', sortable: false, filterable: false },
]
