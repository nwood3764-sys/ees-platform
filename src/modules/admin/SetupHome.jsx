import { useState, useMemo, useEffect } from 'react'
import { C } from '../../data/constants'
import { Icon, LoadingState, ErrorState } from '../../components/UI'
import { ListView } from '../../components/ListView'
import { useIsMobile } from '../../lib/useMediaQuery'
import { SETUP_TREE } from './setupTree'
import UsersPane from './UsersPane'
import RolesPane from './permissions/RolesPane'
import PermissionSetsPane from './permissions/PermissionSetsPane'
import HelpArticlesPane from './help/HelpArticlesPane'
import LifecycleBuilderPane from './LifecycleBuilderPane'
import {
  fetchPrograms, fetchWorkTypes,
  fetchEmailTemplates, fetchDocumentTemplates, fetchEnvelopes,
  fetchAutomationRules, fetchValidationRules,
  fetchPicklistValues, fetchAuditLog,
  fetchSavedListViews,
  fetchServiceTerritories,
  fetchDeletedRecords, fetchDeletedRecordsAcrossTables, restoreRecord, purgeRecord,
  fetchAdminHealthSummary,
  fetchAllPageLayouts,
  fetchWorkPlanTemplates,
  fetchWorkStepTemplates,
  fetchProjectReportTemplates,
  fetchSkills,
  fetchWorkTypeSkillRequirements,
  fetchPortals,
  fetchPortalRoleAssignments,
  fetchObjectChatEnabled,
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
          : <WelcomePane onOpenObjectManager={onOpenObjectManager} onNavigate={handleSelect} />}
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

function WelcomePane({ onOpenObjectManager, onNavigate }) {
  const quickLinks = [
    { label: 'Object Manager',    hint: 'Manage tables, fields, page layouts',        onClick: onOpenObjectManager,  highlight: true },
    { label: 'Users',             hint: 'Energy Efficiency Services user accounts',                        nodeId: 'users' },
    { label: 'Roles',             hint: 'Row-level and field-level security roles',   nodeId: 'roles' },
    { label: 'Permission Sets',   hint: 'Additive grants on top of role baseline',    nodeId: 'permission_sets' },
    { label: 'Picklist Value Sets', hint: 'Central dictionary for every dropdown',    nodeId: 'picklist_values' },
    { label: 'Page Layouts',      hint: 'Record detail layouts',                      nodeId: 'page_layouts' },
    { label: 'Email Templates',   hint: 'Outbound email templates with merge fields', nodeId: 'email_templates' },
    { label: 'Audit Log',         hint: 'Append-only history of system changes',      nodeId: 'audit_log' },
    { label: 'Recycle Bin',       hint: 'View, restore, or purge deleted records',    nodeId: 'recycle_bin' },
  ]

  // ─── System health summary ───────────────────────────────────────────
  // Single RPC round-trip on mount. Used to populate the strip of stat
  // cards above Most Visited. Errors fail silently — health strip is
  // nice-to-have, not load-bearing for the welcome pane.
  const [health,        setHealth]        = useState(null)
  const [healthLoading, setHealthLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    fetchAdminHealthSummary()
      .then(h => { if (!cancelled) setHealth(h) })
      .catch(() => { if (!cancelled) setHealth(null) })
      .finally(() => { if (!cancelled) setHealthLoading(false) })
    return () => { cancelled = true }
  }, [])

  const handleQuickLinkClick = (link) => {
    if (link.onClick) link.onClick()
    else if (link.nodeId && onNavigate) onNavigate(link.nodeId)
  }

  const fmtRelativeTime = (date) => {
    if (!date) return 'never'
    const diff = (new Date()).getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1)  return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24)   return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7)     return `${days}d ago`
    return date.toLocaleDateString()
  }

  // Stat card styles
  const statCard = (highlight) => ({
    background: highlight ? '#fef5f5' : C.card,
    border: `1px solid ${highlight ? '#fcc' : C.border}`,
    borderRadius: 8, padding: '12px 14px',
    minHeight: 68,
  })
  const statValue = (highlight) => ({
    fontSize: 22, fontWeight: 700,
    color: highlight ? '#933' : C.textPrimary,
    lineHeight: 1, marginBottom: 4,
  })
  const statLabel = { fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }

  return (
    <div style={{ padding: '28px 32px', overflow: 'auto', flex: 1 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary }}>Setup</div>
      <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 4, marginBottom: 24 }}>
        System configuration, automation, security, and metadata. Manage everything Energy Efficiency Services Admin controls from here.
      </div>

      {/* System health strip — six stat cards in a responsive grid */}
      <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 10 }}>
        System Health
        {!healthLoading && health && (
          <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 400, marginLeft: 8 }}>
            as of {health.generatedAt.toLocaleTimeString()}
          </span>
        )}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10,
        marginBottom: 28,
      }}>
        {healthLoading && (
          <div style={{ ...statCard(false), gridColumn: '1 / -1', textAlign: 'center', color: C.textMuted, fontSize: 12 }}>
            Loading health stats…
          </div>
        )}
        {!healthLoading && health && (
          <>
            <div style={statCard(false)}>
              <div style={statValue(false)}>{health.activeUsers}</div>
              <div style={statLabel}>Active Users</div>
            </div>
            <div style={statCard(false)}>
              <div style={statValue(false)}>{health.permissionSets}</div>
              <div style={statLabel}>Active Permission Sets</div>
            </div>
            <div
              style={{ ...statCard(false), cursor: 'pointer' }}
              onClick={() => onNavigate && onNavigate('audit_log')}
              title="Open Audit Log">
              <div style={statValue(false)}>{health.audit24h}</div>
              <div style={statLabel}>Audit Events (24h)</div>
            </div>
            <div
              style={{ ...statCard(health.recycleBinTotal > 0), cursor: 'pointer' }}
              onClick={() => onNavigate && onNavigate('recycle_bin')}
              title="Open Recycle Bin">
              <div style={statValue(health.recycleBinTotal > 0)}>{health.recycleBinTotal}</div>
              <div style={statLabel}>In Recycle Bin</div>
            </div>
            <div style={statCard(false)}>
              <div style={{ ...statValue(false), fontSize: 14, fontWeight: 600 }}>
                {fmtRelativeTime(health.lastDispatch)}
              </div>
              <div style={statLabel}>Last Dispatch Run</div>
            </div>
            <div style={statCard(health.dispatchErrors24h > 0)}>
              <div style={statValue(health.dispatchErrors24h > 0)}>{health.dispatchErrors24h}</div>
              <div style={statLabel}>Dispatch Errors (24h)</div>
            </div>
          </>
        )}
        {!healthLoading && !health && (
          <div style={{ ...statCard(false), gridColumn: '1 / -1', textAlign: 'center', color: C.textMuted, fontSize: 12 }}>
            Health stats unavailable
          </div>
        )}
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 10 }}>Most Visited</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {quickLinks.map(link => {
          const clickable = !!(link.onClick || (link.nodeId && onNavigate))
          return (
            <div key={link.label}
              onClick={clickable ? () => handleQuickLinkClick(link) : undefined}
              style={{
                background: link.highlight ? '#f0f9f5' : C.card,
                border: `1px solid ${link.highlight ? C.emerald : C.border}`,
                borderRadius: 8, padding: '12px 14px',
                cursor: clickable ? 'pointer' : 'default',
                transition: 'box-shadow 120ms',
              }}
              onMouseEnter={e => { if (clickable) e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)' }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: link.highlight ? '#1a7a4e' : C.textPrimary, marginBottom: 3 }}>
                {link.label}
              </div>
              <div style={{ fontSize: 11.5, color: C.textMuted }}>{link.hint}</div>
            </div>
          )
        })}
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
    case 'roles':             return <RolesPane />
    case 'permission_sets':   return <PermissionSetsPane />
    case 'help_articles':     return <HelpArticlesPane />
    case 'picklist_values':   return <NodePage title="Picklist Value Sets"     table="picklist_values"   fetcher={fetchPicklistValues}    columns={PL_COLS}             newLabel="Picklist Value"   onOpenRecord={onOpenRecord} />
    case 'record_types':      return <RecordTypesNodePane onOpenObjectManager={onOpenObjectManager} />
    case 'automation_rules':  return <NodePage title="Flows (Automation Rules)" table="automation_rules" fetcher={fetchAutomationRules}   columns={AR_COLS}             newLabel="Automation Rule"  onOpenRecord={onOpenRecord} />
    case 'lifecycle_builder': return <LifecycleBuilderPane />
    case 'validation_rules':  return <NodePage title="Validation Rules"        table="validation_rules"  fetcher={fetchValidationRules}   columns={VR_COLS}             newLabel="Validation Rule"  onOpenRecord={onOpenRecord} />
    case 'page_layouts':      return <NodePage title="Page Layouts"            table="page_layouts"      fetcher={fetchAllPageLayouts}    columns={PAGELAYOUT_COLS}     newLabel="Page Layout"      onOpenRecord={onOpenRecord} />
    case 'saved_list_views':  return <NodePage title="Saved List Views"        table="saved_list_views"  fetcher={fetchSavedListViews}    columns={LV_COLS}             newLabel="List View"        onOpenRecord={onOpenRecord} />
    case 'email_templates':   return <NodePage title="Email Templates"         table="email_templates"   fetcher={fetchEmailTemplates}    columns={ET_COLS}             newLabel="Email Template"   onOpenRecord={onOpenRecord} />
    case 'document_templates':return <NodePage title="Document Templates"      table="document_templates" fetcher={fetchDocumentTemplates} columns={DT_COLS}            newLabel="Document Template" onOpenRecord={onOpenRecord} />
    case 'envelopes':         return <NodePage title="Envelopes"               table="envelopes"         fetcher={fetchEnvelopes}         columns={ENV_COLS}            newLabel={null}             onOpenRecord={onOpenRecord} />
    case 'programs':          return <NodePage title="Programs"                table="programs"          fetcher={fetchPrograms}          columns={PROG_COLS}           newLabel="Program"          onOpenRecord={onOpenRecord} />
    case 'work_types':        return <NodePage title="Work Types"              table="work_types"        fetcher={fetchWorkTypes}         columns={WT_COLS}             newLabel="Work Type"        onOpenRecord={onOpenRecord} />
    case 'work_plan_templates': return <WorkPlanTemplatesPane onOpenRecord={onOpenRecord} />
    case 'work_step_templates': return <NodePage title="Work Step Templates"   table="work_step_templates" fetcher={fetchWorkStepTemplates} columns={WST_COLS}            newLabel="Work Step Template" onOpenRecord={onOpenRecord} />
    case 'project_report_templates': return <NodePage title="Project Report Templates" table="project_report_templates" fetcher={fetchProjectReportTemplates} columns={PRT_COLS} newLabel="Project Report Template" onOpenRecord={onOpenRecord} />
    case 'service_territories': return <NodePage title="Service Territories"   table="service_territories" fetcher={fetchServiceTerritories} columns={ST_COLS}             newLabel="Service Territory" onOpenRecord={onOpenRecord} />
    case 'skills':              return <NodePage title="Skills"                  table="skills"                       fetcher={fetchSkills}                       columns={SKILL_COLS} newLabel="Skill"                       onOpenRecord={onOpenRecord} />
    case 'work_type_skill_requirements': return <NodePage title="Work Type Skill Requirements" table="work_type_skill_requirements" fetcher={fetchWorkTypeSkillRequirements} columns={WTSR_COLS}  newLabel="Skill Requirement"           onOpenRecord={onOpenRecord} />
    case 'audit_log':         return <AuditLogPane />
    case 'recycle_bin':       return <RecycleBinPane onOpenRecord={onOpenRecord} />
    case 'portals':                  return <NodePage title="Portals"                  table="portals"                  fetcher={fetchPortals}                 columns={PORTAL_COLS}     newLabel="Portal"                  onOpenRecord={onOpenRecord} />
    case 'portal_role_assignments':  return <NodePage title="Portal Role Assignments"  table="portal_role_assignments"  fetcher={fetchPortalRoleAssignments}   columns={PRA_COLS}        newLabel="Role Assignment"         onOpenRecord={onOpenRecord} />
    case 'object_chat_enabled':      return <NodePage title="Object Chat Settings"     table="object_chat_enabled"      fetcher={fetchObjectChatEnabled}       columns={OCE_COLS}        newLabel="Object Chat Setting"     onOpenRecord={onOpenRecord} />
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

// ─── AuditLogPane — dedicated viewer with filter controls ────────────────
//
// audit_log gets its own page because (a) the table is large (5k+ rows
// today, monotonically growing) and an unfiltered list isn't useful, and
// (b) the typical investigation pattern is 'show me everything for record
// X' or 'show me every permission_sets change in the last week' — neither
// of which fits the generic NodePage. fetchAuditLog accepts objectFilter
// / recordFilter / actionFilter / limit; this pane wires controls for all
// three plus a manual Refresh button.

const AUDIT_ACTIONS = ['', 'INSERT', 'UPDATE', 'SOFT_DELETE', 'RESTORE', 'HARD_DELETE']
const AUDIT_LIMITS  = [100, 200, 500, 1000]
const AUDIT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function AuditLogPane() {
  const [objectFilter, setObjectFilter] = useState('')
  const [recordFilter, setRecordFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [limit,        setLimit]        = useState(200)
  const [data,         setData]         = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [reloadKey,    setReloadKey]    = useState(0)

  // Validate recordFilter: empty is fine; non-empty must be a UUID. Bad
  // UUIDs would 400 the query, so we hold the filter until it parses.
  const recordFilterValid = !recordFilter || AUDIT_UUID_RE.test(recordFilter.trim())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchAuditLog({
      limit,
      objectFilter: objectFilter.trim() || null,
      recordFilter: recordFilterValid && recordFilter.trim() ? recordFilter.trim() : null,
      actionFilter: actionFilter || null,
    })
      .then(d => { if (!cancelled) setData(d) })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  // We deliberately don't include the filter values themselves in the dep
  // array — reload is triggered by Refresh (reloadKey bump). Otherwise
  // every keystroke would hit the DB.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  const refresh = () => setReloadKey(k => k + 1)
  const clear   = () => {
    setObjectFilter('')
    setRecordFilter('')
    setActionFilter('')
    setLimit(200)
    setReloadKey(k => k + 1)
  }

  const filtersActive = !!(objectFilter || recordFilter || actionFilter || limit !== 200)
  const systemViews = [{ id: 'AV', name: 'All', filters: [], sortField: 'timestamp', sortDir: 'desc' }]

  const inputStyle = {
    fontSize: 12.5, padding: '5px 8px',
    border: `1px solid ${C.border}`, borderRadius: 4,
    background: '#fff', color: C.textPrimary,
    fontFamily: 'inherit',
  }
  const labelStyle = { fontSize: 11, color: C.textMuted, fontWeight: 600 }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Audit Log</div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          {loading
            ? 'Loading…'
            : `${data.length} record${data.length === 1 ? '' : 's'}${filtersActive ? ' (filtered)' : ''}`}
        </div>

        {/* Filter row */}
        <div style={{
          marginTop: 14, display: 'flex', alignItems: 'flex-end',
          gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>Object</label>
            <input
              type="text" value={objectFilter} placeholder="e.g. permission_sets"
              onChange={e => setObjectFilter(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') refresh() }}
              style={{ ...inputStyle, width: 180 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>Record ID (full UUID)</label>
            <input
              type="text" value={recordFilter}
              placeholder="00000000-0000-0000-0000-000000000000"
              onChange={e => setRecordFilter(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') refresh() }}
              style={{
                ...inputStyle, width: 280,
                fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5,
                borderColor: recordFilterValid ? C.border : '#e85a4f',
              }} />
            {!recordFilterValid && (
              <span style={{ fontSize: 10.5, color: '#e85a4f' }}>Not a valid UUID</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>Action</label>
            <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
              style={{ ...inputStyle, width: 150 }}>
              {AUDIT_ACTIONS.map(a =>
                <option key={a} value={a}>{a || '(any)'}</option>
              )}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>Limit</label>
            <select value={limit} onChange={e => setLimit(parseInt(e.target.value, 10))}
              style={{ ...inputStyle, width: 90 }}>
              {AUDIT_LIMITS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <button onClick={refresh}
            style={{
              fontSize: 12.5, padding: '6px 14px',
              background: C.emerald, color: '#fff',
              border: 'none', borderRadius: 4, cursor: 'pointer',
              fontWeight: 500,
            }}>
            Apply
          </button>
          {filtersActive && (
            <button onClick={clear}
              style={{
                fontSize: 12.5, padding: '6px 12px',
                background: 'transparent', color: C.textSecondary,
                border: `1px solid ${C.border}`, borderRadius: 4, cursor: 'pointer',
              }}>
              Clear
            </button>
          )}
        </div>
      </div>
      {loading && <LoadingState />}
      {error && !loading && <ErrorState error={error} />}
      {!loading && !error && (
        <ListView
          data={data}
          columns={AL_COLS}
          systemViews={systemViews}
          defaultViewId="AV"
        />
      )}
    </div>
  )
}

// ─── RecycleBinPane — view + restore soft-deleted records ───────────────
//
// Phase 1 of the recycle bin spec from anura-data-standards.md. Lets admins
// pick a table from a curated dropdown, see what's been soft-deleted with
// who/when/why, and restore individual rows. Permanent purge is deferred
// to a Phase 2 with cascade-delete + audit-snapshot work.
//
// The dropdown is curated rather than driven by ees_table_metadata across
// all 96 soft-deletable tables: child tables (report_filters,
// dashboard_widgets, page_layout_widgets, etc.) are managed via their
// parent's delete cascade and rarely need standalone restoration. Showing
// them as standalone bin entries would be noisy without serving the real
// admin workflow ("I deleted a Project — restore it").

const RECYCLE_BIN_TABLES = [
  // Primary business objects (most-likely restore targets)
  { value: 'projects',                     label: 'Projects' },
  { value: 'opportunities',                label: 'Opportunities' },
  { value: 'work_orders',                  label: 'Work Orders' },
  { value: 'properties',                   label: 'Properties' },
  { value: 'buildings',                    label: 'Buildings' },
  { value: 'units',                        label: 'Units' },
  { value: 'accounts',                     label: 'Accounts' },
  { value: 'contacts',                     label: 'Contacts' },
  { value: 'assessments',                  label: 'Assessments' },
  { value: 'incentive_applications',       label: 'Incentive Applications' },
  { value: 'incentives',                   label: 'Incentives' },
  { value: 'project_payment_requests',     label: 'Project Payment Requests' },
  { value: 'payment_receipts',             label: 'Payment Receipts' },
  { value: 'documents',                    label: 'Documents' },
  // Configuration / builder objects
  { value: 'work_types',                   label: 'Work Types' },
  { value: 'work_plan_templates',          label: 'Work Plan Templates' },
  { value: 'work_step_templates',          label: 'Work Step Templates' },
  { value: 'programs',                     label: 'Programs' },
  { value: 'price_books',                  label: 'Price Books' },
  { value: 'products',                     label: 'Products' },
  { value: 'document_templates',           label: 'Document Templates' },
  { value: 'email_templates',              label: 'Email Templates' },
  { value: 'project_report_templates',     label: 'Project Report Templates' },
  // Reports module
  { value: 'reports',                      label: 'Reports' },
  { value: 'dashboards',                   label: 'Dashboards' },
  { value: 'scheduled_reports',            label: 'Scheduled Reports' },
  // Permission Builder
  { value: 'permission_sets',              label: 'Permission Sets' },
  // Field operations
  { value: 'vehicles',                     label: 'Vehicles' },
  { value: 'equipment',                    label: 'Equipment' },
  { value: 'job_kits',                     label: 'Job Kits' },
]

// Sentinel value for the All-Tables option in the dropdown. Not a real
// table name; the pane checks for this string to switch fetchers.
const RECYCLE_BIN_ALL_SENTINEL = '__all__'

const RECYCLE_BIN_COLS = [
  { field: 'id',             label: 'Record',         type: 'text', sortable: true,  filterable: false },
  { field: 'name',           label: 'Name',           type: 'text', sortable: true,  filterable: true  },
  { field: 'deletedAt',      label: 'Deleted At',     type: 'text', sortable: true,  filterable: false },
  { field: 'deletedBy',      label: 'Deleted By',     type: 'text', sortable: true,  filterable: true  },
  { field: 'deletionReason', label: 'Reason',         type: 'text', sortable: false, filterable: true  },
]
// In All-Tables mode the table column matters; in single-table mode it's
// just noise (every row has the same value). Show conditionally.
const RECYCLE_BIN_COLS_WITH_TABLE = [
  { field: 'id',             label: 'Record',         type: 'text', sortable: true,  filterable: false },
  { field: 'table',          label: 'Object',         type: 'text', sortable: true,  filterable: true  },
  { field: 'name',           label: 'Name',           type: 'text', sortable: true,  filterable: true  },
  { field: 'deletedAt',      label: 'Deleted At',     type: 'text', sortable: true,  filterable: false },
  { field: 'deletedBy',      label: 'Deleted By',     type: 'text', sortable: true,  filterable: true  },
  { field: 'deletionReason', label: 'Reason',         type: 'text', sortable: false, filterable: true  },
]

function RecycleBinPane({ onOpenRecord }) {
  const [selectedTable, setSelectedTable] = useState(RECYCLE_BIN_TABLES[0].value)
  const [data,          setData]          = useState([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  const [restoreBusy,   setRestoreBusy]   = useState(null) // record id currently being restored
  const [restoreNotice, setRestoreNotice] = useState(null) // { type: 'ok'|'err', message }
  const [reloadKey,     setReloadKey]     = useState(0)
  // Purge state: which row is queued for purge, what the user has typed
  // to confirm, and whether the RPC is in flight. The purge confirmation
  // requires typing the exact record name/id to avoid muscle-memory deletes.
  const [purgeRow,      setPurgeRow]      = useState(null) // the row being purged
  const [purgeTyped,    setPurgeTyped]    = useState('')
  const [purgeBusy,     setPurgeBusy]     = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    // All-Tables mode fans out across the curated table list with a
    // per-table cap so a single very-deleted table can't crowd out
    // others. Single-table mode keeps the larger limit.
    const isAllMode = selectedTable === RECYCLE_BIN_ALL_SENTINEL
    const tableList = RECYCLE_BIN_TABLES.map(t => t.value)
    const promise = isAllMode
      ? fetchDeletedRecordsAcrossTables(tableList, { perTableLimit: 50 })
      : fetchDeletedRecords(selectedTable, { limit: 500 })

    promise
      .then(d => { if (!cancelled) setData(d) })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedTable, reloadKey])

  const isAllMode = selectedTable === RECYCLE_BIN_ALL_SENTINEL
  const refresh = () => setReloadKey(k => k + 1)

  // Restore a single row. In All-Tables mode the row's _table is what
  // we dispatch to; in single-table mode we honor selectedTable directly
  // (rows still carry _table after the recent refactor, so we could
  // use that everywhere — using selectedTable is just a tiny safety
  // belt against any edge where _table got stripped).
  const handleRestore = async (row) => {
    if (!row?._id || restoreBusy) return
    const targetTable = row._table || selectedTable
    const ok = window.confirm(
      `Restore ${row.name || row._id} (${targetTable})?\n\nThe record will reappear in list views and related-record sections.`
    )
    if (!ok) return
    setRestoreBusy(row._id)
    setRestoreNotice(null)
    try {
      await restoreRecord(targetTable, row._id)
      setRestoreNotice({ type: 'ok', message: `Restored ${row.name || row._id}` })
      refresh()
    } catch (err) {
      setRestoreNotice({ type: 'err', message: `Restore failed: ${err.message || err}` })
    } finally {
      setRestoreBusy(null)
    }
  }

  // Purge — open the typed-confirmation modal. The modal requires the
  // admin to type the record's display id (e.g. "RPT-00009") to confirm,
  // matching the data-standards spec's 'deliberate multi-step confirmation'
  // requirement.
  const openPurgeModal = (row) => {
    if (!row?._id) return
    setPurgeRow(row)
    setPurgeTyped('')
    setRestoreNotice(null)
  }
  const closePurgeModal = () => {
    if (purgeBusy) return
    setPurgeRow(null)
    setPurgeTyped('')
  }
  const confirmPurge = async () => {
    if (!purgeRow?._id || purgeBusy) return
    if (purgeTyped.trim() !== purgeRow.id) return // belt-and-suspenders; button is also disabled
    setPurgeBusy(true)
    try {
      // In All-Tables mode the row knows its own table. In single-table
      // mode it does too (rows always carry _table), but fall back to
      // selectedTable just in case.
      const targetTable = purgeRow._table || selectedTable
      await purgeRecord(targetTable, purgeRow._id)
      setRestoreNotice({ type: 'ok', message: `Purged ${purgeRow.name || purgeRow._id} permanently. A HARD_DELETE row with the full snapshot is in the audit log.` })
      setPurgeRow(null)
      setPurgeTyped('')
      refresh()
    } catch (err) {
      setRestoreNotice({ type: 'err', message: `Purge failed: ${err.message || err}` })
    } finally {
      setPurgeBusy(false)
    }
  }

  const systemViews = [{ id: 'AV', name: 'All', filters: [], sortField: 'deletedAt', sortDir: 'desc' }]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 12px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Recycle Bin</div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          {loading
            ? 'Loading…'
            : isAllMode
              ? `${data.length} deleted records across ${RECYCLE_BIN_TABLES.length} objects`
              : `${data.length} deleted ${selectedTable.replace(/_/g, ' ')}`}
        </div>

        <div style={{
          marginTop: 14, display: 'flex', alignItems: 'flex-end',
          gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>Object</label>
            <select value={selectedTable} onChange={e => setSelectedTable(e.target.value)}
              style={{
                fontSize: 12.5, padding: '5px 8px',
                border: `1px solid ${C.border}`, borderRadius: 4,
                background: '#fff', color: C.textPrimary, fontFamily: 'inherit',
                minWidth: 260,
              }}>
              <option value={RECYCLE_BIN_ALL_SENTINEL}>— All tables (up to 50 each) —</option>
              <option value="" disabled>──────────────</option>
              {RECYCLE_BIN_TABLES.map(t =>
                <option key={t.value} value={t.value}>{t.label}</option>
              )}
            </select>
          </div>
          <button onClick={refresh}
            style={{
              fontSize: 12.5, padding: '6px 14px',
              background: C.emerald, color: '#fff',
              border: 'none', borderRadius: 4, cursor: 'pointer',
              fontWeight: 500,
            }}>
            Refresh
          </button>
          {restoreNotice && (
            <div style={{
              fontSize: 12, padding: '5px 10px', borderRadius: 4,
              background: restoreNotice.type === 'ok' ? '#e8f5ec' : '#fee',
              color: restoreNotice.type === 'ok' ? '#1a7a4e' : '#933',
              border: `1px solid ${restoreNotice.type === 'ok' ? '#9c9' : '#f99'}`,
              alignSelf: 'center',
            }}>
              {restoreNotice.message}
            </div>
          )}
        </div>
      </div>
      {loading && <LoadingState />}
      {error && !loading && <ErrorState error={error} />}
      {!loading && !error && data.length === 0 && (
        <div style={{ padding: '32px 24px', color: C.textMuted, fontSize: 13 }}>
          {isAllMode
            ? 'No deleted records found across any tracked object.'
            : `No deleted ${selectedTable.replace(/_/g, ' ')} found.`}
        </div>
      )}
      {!loading && !error && data.length > 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ListView
            data={data}
            columns={isAllMode ? RECYCLE_BIN_COLS_WITH_TABLE : RECYCLE_BIN_COLS}
            systemViews={systemViews}
            defaultViewId="AV"
            onOpenRecord={onOpenRecord
              ? row => row?._id && onOpenRecord({ table: row._table || selectedTable, id: row._id, name: row.name })
              : undefined}
          />
          {/* Row actions — restoration is a separate button so the row click
              still navigates to the (restored) record detail. Rendered as a
              footer panel since ListView doesn't expose a per-row action API. */}
          <div style={{
            borderTop: `1px solid ${C.border}`, background: C.card,
            padding: '10px 24px', display: 'flex', flexDirection: 'column', gap: 6,
            maxHeight: 200, overflow: 'auto',
          }}>
            <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Quick Restore
            </div>
            {data.slice(0, 50).map(row => (
              <div key={`${row._table || selectedTable}-${row._id}`} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '4px 0', fontSize: 12,
              }}>
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace', color: C.textMuted,
                  minWidth: 100,
                }}>{row.id}</span>
                {isAllMode && (
                  <span style={{
                    fontSize: 10.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace',
                    background: C.cardSecondary, padding: '1px 6px', borderRadius: 3,
                    minWidth: 0, whiteSpace: 'nowrap',
                  }}>{row._table || row.table}</span>
                )}
                <span style={{ flex: 1, color: C.textPrimary }}>{row.name}</span>
                <span style={{ color: C.textMuted, fontSize: 11 }}>
                  {row.deletedAt} · {row.deletedBy}
                </span>
                <button
                  onClick={() => handleRestore(row)}
                  disabled={restoreBusy === row._id}
                  style={{
                    fontSize: 11.5, padding: '3px 10px',
                    background: restoreBusy === row._id ? C.cardSecondary : 'transparent',
                    color: restoreBusy === row._id ? C.textMuted : C.emerald,
                    border: `1px solid ${restoreBusy === row._id ? C.border : C.emerald}`,
                    borderRadius: 3, cursor: restoreBusy === row._id ? 'wait' : 'pointer',
                    fontWeight: 500,
                  }}>
                  {restoreBusy === row._id ? '…' : 'Restore'}
                </button>
                <button
                  onClick={() => openPurgeModal(row)}
                  disabled={restoreBusy === row._id || purgeBusy}
                  title="Permanently delete this record. Cannot be undone. Admin-only; the full row is preserved in the audit log."
                  style={{
                    fontSize: 11.5, padding: '3px 10px',
                    background: 'transparent',
                    color: '#933',
                    border: `1px solid #f99`,
                    borderRadius: 3,
                    cursor: (restoreBusy === row._id || purgeBusy) ? 'not-allowed' : 'pointer',
                    fontWeight: 500,
                    opacity: (restoreBusy === row._id || purgeBusy) ? 0.5 : 1,
                  }}>
                  Purge
                </button>
              </div>
            ))}
            {data.length > 50 && (
              <div style={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic' }}>
                Showing 50 of {data.length}. Filter the list above to narrow further.
              </div>
            )}
          </div>
        </div>
      )}
      {/* Purge confirmation modal — typed-confirmation for an irreversible
          action. Admin must type the record's display id verbatim. */}
      {purgeRow && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        onClick={closePurgeModal}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: C.card, borderRadius: 8, padding: 24,
              minWidth: 420, maxWidth: 560,
              boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
              border: `1px solid ${C.border}`,
            }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#933', marginBottom: 4 }}>
              Permanently purge {purgeRow.id}
            </div>
            <div style={{ fontSize: 12.5, color: C.textPrimary, marginBottom: 12 }}>
              <strong>{purgeRow.name}</strong>
            </div>
            <div style={{
              fontSize: 12, color: C.textSecondary, marginBottom: 14, lineHeight: 1.45,
              padding: 10, background: '#fef5f5', borderRadius: 4, border: '1px solid #fcc',
            }}>
              This action <strong>cannot be undone</strong>. The record will be physically
              deleted from the database. A HARD_DELETE row with the complete record
              snapshot is preserved in the audit log per the data-standards spec.
              <br /><br />
              If the record has dependent records that aren&apos;t soft-deleted, the
              purge will fail with a referential-integrity error \u2014 purge or reassign
              the dependents first.
            </div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 6 }}>
              Type <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>{purgeRow.id}</strong> to confirm:
            </div>
            <input
              type="text"
              value={purgeTyped}
              autoFocus
              disabled={purgeBusy}
              onChange={e => setPurgeTyped(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && purgeTyped.trim() === purgeRow.id) confirmPurge()
                if (e.key === 'Escape') closePurgeModal()
              }}
              placeholder={purgeRow.id}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '6px 10px', border: `1px solid ${C.border}`,
                borderRadius: 4, fontSize: 12.5, fontFamily: 'JetBrains Mono, monospace',
                marginBottom: 14, background: '#fff', color: C.textPrimary,
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={closePurgeModal} disabled={purgeBusy}
                style={{
                  fontSize: 12.5, padding: '6px 14px',
                  background: 'transparent', color: C.textSecondary,
                  border: `1px solid ${C.border}`, borderRadius: 4,
                  cursor: purgeBusy ? 'not-allowed' : 'pointer',
                }}>
                Cancel
              </button>
              <button onClick={confirmPurge}
                disabled={purgeBusy || purgeTyped.trim() !== purgeRow.id}
                style={{
                  fontSize: 12.5, padding: '6px 14px',
                  background: (purgeTyped.trim() === purgeRow.id && !purgeBusy) ? '#933' : C.cardSecondary,
                  color: (purgeTyped.trim() === purgeRow.id && !purgeBusy) ? '#fff' : C.textMuted,
                  border: 'none', borderRadius: 4,
                  cursor: (purgeTyped.trim() === purgeRow.id && !purgeBusy) ? 'pointer' : 'not-allowed',
                  fontWeight: 500,
                }}>
                {purgeBusy ? 'Purging…' : 'Purge permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RecordTypesNodePane({ onOpenObjectManager }) {
  return (
    <div style={{ padding: '28px 32px', overflow: 'auto', flex: 1 }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Record Types</div>
      <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 6, maxWidth: 640, lineHeight: 1.5 }}>
        Record types in Energy Efficiency Services are defined per-object via picklist values with{' '}
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
// Roles columns moved to permissions/RolesPane.jsx alongside the permission
// editor that consumes them.

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

const LV_COLS = [
  { field: 'id',            label: 'Record #',   type: 'text',   sortable: true, filterable: false },
  { field: 'name',          label: 'Name',       type: 'text',   sortable: true, filterable: true },
  { field: 'object',        label: 'Object',     type: 'text',   sortable: true, filterable: true },
  { field: 'module',        label: 'Module',     type: 'text',   sortable: true, filterable: true },
  { field: 'scope',         label: 'Scope',      type: 'text',   sortable: true, filterable: true },
  { field: 'isDefault',     label: 'Default',    type: 'select', sortable: true, filterable: true, options: ['Yes', 'No'] },
  { field: 'sort',          label: 'Sort',       type: 'text',   sortable: false, filterable: false },
  { field: 'columnsCount',  label: 'Columns',    type: 'text',   sortable: true, filterable: false },
  { field: 'filtersCount',  label: 'Filters',    type: 'text',   sortable: true, filterable: false },
  { field: 'owner',         label: 'Owner',      type: 'text',   sortable: true, filterable: true },
  { field: 'updatedAt',     label: 'Updated',    type: 'text',   sortable: true, filterable: false },
]

const ST_COLS = [
  { field: 'id',              label: 'Record #',     type: 'text',   sortable: true, filterable: false },
  { field: 'name',            label: 'Name',         type: 'text',   sortable: true, filterable: true },
  { field: 'active',          label: 'Status',       type: 'select', sortable: true, filterable: true, options: ['Active', 'Inactive'] },
  { field: 'parent',          label: 'Parent',       type: 'text',   sortable: true, filterable: true },
  { field: 'state',           label: 'State',        type: 'text',   sortable: true, filterable: true },
  { field: 'country',         label: 'Country',      type: 'text',   sortable: true, filterable: true },
  { field: 'zipCount',        label: 'Zips',         type: 'text',   sortable: true, filterable: false },
  { field: 'travelBufferMin', label: 'Travel Buffer (min)', type: 'text', sortable: true, filterable: false },
  { field: 'owner',           label: 'Owner',        type: 'text',   sortable: true, filterable: true },
  { field: 'updatedAt',       label: 'Updated',      type: 'text',   sortable: true, filterable: false },
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
  { field: 'timestamp',   label: 'Timestamp',   type: 'text', sortable: true,  filterable: false },
  { field: 'action',      label: 'Action',      type: 'text', sortable: true,  filterable: true  },
  { field: 'object',      label: 'Object',      type: 'text', sortable: true,  filterable: true  },
  { field: 'recordId',    label: 'Record',      type: 'text', sortable: false, filterable: false },
  { field: 'performedBy', label: 'Performed By',type: 'text', sortable: true,  filterable: true  },
  { field: 'notes',       label: 'Notes',       type: 'text', sortable: false, filterable: false },
]

const PORTAL_COLS = [
  { field: 'id',          label: 'Record #',     type: 'text',   sortable: true,  filterable: false },
  { field: 'name',        label: 'Portal',       type: 'text',   sortable: true,  filterable: true  },
  { field: 'urlPath',     label: 'URL Path',     type: 'text',   sortable: true,  filterable: true  },
  { field: 'hostname',    label: 'Hostname',     type: 'text',   sortable: true,  filterable: true  },
  { field: 'description', label: 'Description',  type: 'text',   sortable: false, filterable: false },
  { field: 'active',      label: 'Status',       type: 'select', sortable: true,  filterable: true, options: ['Active', 'Inactive'] },
]

const PRA_COLS = [
  { field: 'id',        label: 'Assignment',  type: 'text',   sortable: true,  filterable: false },
  { field: 'portal',    label: 'Portal',      type: 'text',   sortable: true,  filterable: true  },
  { field: 'role',      label: 'Role',        type: 'text',   sortable: true,  filterable: true  },
  { field: 'isDefault', label: 'Default',     type: 'select', sortable: true,  filterable: true, options: ['Yes', 'No'] },
]

const OCE_COLS = [
  { field: 'id',        label: 'Object',     type: 'text',   sortable: true,  filterable: true  },
  { field: 'enabled',   label: 'Chat',       type: 'select', sortable: true,  filterable: true, options: ['Enabled', 'Disabled'] },
  { field: 'updatedAt', label: 'Updated',    type: 'text',   sortable: true,  filterable: false },
]
