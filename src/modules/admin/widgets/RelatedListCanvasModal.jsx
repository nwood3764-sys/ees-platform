import { useState, useEffect, useMemo, useRef } from 'react'
import { C } from '../../../data/constants'
import { useIsMobile } from '../../../lib/useMediaQuery'
import { describeObject, describeIncomingFKs } from '../../../data/adminService'
import { humanizeColumnName } from './eesFieldTypes'
import { humanizeObjectLabel } from '../../../lib/objectNav.js'
import { relatedListTitle } from '../../../lib/relatedListNaming.js'
import {
  FormField,
  inputStyle,
  buttonPrimaryStyle, buttonSecondaryStyle,
  dangerBoxStyle, hintBoxStyle,
} from '../adminStyles'
import { backdropDismissProps } from '../../../lib/modalDismiss'

// ---------------------------------------------------------------------------
// RelatedListCanvasModal — configure a related_list widget for the canvas
// page-layout builder (LayoutCanvasEditor). Purely local: collects
// { title, config } and hands it back via onApply — nothing is written to
// the database until the admin saves the whole layout.
//
// The admin picks WHAT to show from a browsable object tree: the top level
// lists this object's direct children (tables with an FK to it); the ›
// control on any row drills into THAT object's children, so related records
// any number of levels down the hierarchy (units under a property's
// buildings, work steps under a project's work orders) are one click each.
// Selecting an object auto-fills the title, a default column set
// (Record # / Name / Status / Record Type) and the sort — nothing else is
// required. Columns stay editable below for admins who want a different set.
//
// Emitted config:
//   direct child   → { table, fk, columns, ... }              (unchanged shape)
//   deeper levels  → { table, fk, via: [{table, fk}, ...], columns, ... }
//     via is the chain of intermediate tables ordered target-side first;
//     each entry's fk is that table's FK to the NEXT entry, the last entry's
//     fk points at the layout's object, and config.fk is the target's FK to
//     the first intermediate. fetchRelatedRecords resolves the chain as
//     nested PostgREST inner-join embeds.
//
// config.columns keeps the live renderer's shape: { name, type, label }
// entries, FK columns becoming 'picklist' (picklist_values) or 'lookup'
// with { fk_column, lookup_table, lookup_field }.
//
// The DB trigger trg_validate_page_layout_widget_config re-validates
// table / fk / columns on insert, so a stale schema can't slip through.
// ---------------------------------------------------------------------------

const SORT_DIRECTIONS = [
  { value: 'asc',  label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
]

// How many levels below the layout's object the browser can drill.
const MAX_BROWSE_DEPTH = 3

// FK targets that are never "shared-parent" objects — record type / status /
// picklists resolve to picklist_values, and owner/audit columns to users.
// Excluding these leaves only real object parents (Property, Account, …).
const NON_OBJECT_FK_TABLES = new Set(['picklist_values', 'users'])

// System plumbing columns hidden from the display-columns picker.
const HIDDEN_TARGET_COLUMNS = new Set([
  'created_at', 'updated_at',
  'created_by', 'updated_by',
  'is_deleted', 'deleted_at', 'deleted_by', 'deletion_reason',
])

// One humanizer for object names platform-wide, so a related list, a
// breadcrumb and a record page all call the same object the same thing
// (and LEAP's acronyms stay upper-case: EFR Reports, HUD, GPS Points).
function humanizeTableName(table) {
  return humanizeObjectLabel(table)
}

// Renderer-facing type for a describeObject column row (related-list cells).
function relatedColumnType(col) {
  const dt = col.data_type || ''
  if (col.is_foreign_key && dt === 'uuid') {
    return col.references_table === 'picklist_values' ? 'picklist' : 'lookup'
  }
  if (dt === 'date') return 'date'
  if (dt === 'timestamp with time zone' || dt === 'timestamp without time zone') return 'datetime'
  if (dt === 'boolean') return 'boolean'
  if (['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision'].includes(dt)) return 'number'
  return 'text'
}

// Pick the display column on a lookup's referenced table: prefer the first
// *_name column, then a literal `name`, else null (caller degrades to text).
function pickDisplayField(columns) {
  const named = columns.find(c => /_name$/.test(c.column_name))
  if (named) return named.column_name
  const plain = columns.find(c => c.column_name === 'name')
  return plain ? plain.column_name : null
}

// Default display columns for a freshly selected object: Record #, the
// display name, Status, Record Type — whichever of those the table has.
function defaultDisplayColumns(columns) {
  const names = columns.map(c => c.column_name)
  const picks = []
  const add = (n) => { if (n && !picks.includes(n)) picks.push(n) }
  add(names.find(n => /_record_number$/.test(n)))
  add(
    names.find(n => n === 'name')
      || names.find(n => /_name$/.test(n) && !/(file|first|last|middle)_name$/.test(n)),
  )
  add(names.find(n => /_status$/.test(n)))
  add(names.find(n => /_record_type$/.test(n) || n === 'record_type'))
  return picks
}

// The chain is stored root-first ([buildings, units] for units-via-buildings);
// render it target-first the way the join actually walks back to the object.
function joinPathLabel(chain, objectName) {
  const parts = []
  for (let i = chain.length - 1; i >= 0; i--) {
    parts.push(`${chain[i].table}.${chain[i].fk}`)
  }
  parts.push(objectName)
  return parts.join(' → ')
}

function chainKey(chain) {
  return chain.map(n => `${n.table}:${n.fk}`).join('/')
}

// Reconstruct the root-first selection chain from a saved widget config.
// via may be the current array shape or the legacy single-object shape.
// A shared-parent config carries no via chain (see sharedParentFromConfig).
function chainFromConfig(cfg) {
  if (!cfg || !cfg.table || !cfg.fk || cfg.shared_parent) return []
  const viaArr = Array.isArray(cfg.via)
    ? cfg.via.filter(v => v && v.table && v.fk)
    : (cfg.via && cfg.via.table && cfg.via.fk ? [cfg.via] : [])
  return [...viaArr].reverse().concat([{ table: cfg.table, fk: cfg.fk }])
}

// Reconstruct a shared-parent (sibling) selection from a saved widget config.
// Shape: the target sibling (cfg.table) links to the shared parent via cfg.fk;
// the layout's object links to it via cfg.shared_parent.object_fk.
function sharedParentFromConfig(cfg) {
  if (!cfg || !cfg.table || !cfg.fk || !cfg.shared_parent) return null
  const sp = cfg.shared_parent
  if (!sp.table || !sp.object_fk) return null
  return {
    parentTable: sp.table,     // the shared parent object (e.g. properties)
    objectFk: sp.object_fk,    // the layout object's FK to the parent
    targetTable: cfg.table,    // the sibling shown (e.g. enrollments)
    targetFk: cfg.fk,          // the sibling's FK to the parent
  }
}

export default function RelatedListCanvasModal({
  objectName,           // parent object the layout belongs to
  initial,              // { title, config } when editing, null when adding
  onClose,
  onApply,              // ({ title, config }) => void
}) {
  const isMobile = useIsMobile()
  const cfg = initial?.config || {}

  const [title, setTitle] = useState(initial?.title || '')
  // Once the admin types their own title we stop auto-filling it on
  // selection changes. Editing an existing widget counts as touched.
  const titleTouched = useRef(!!initial)

  // Root-first path of {table, fk} picks; last entry is the target table.
  const [chain, setChain] = useState(() => chainFromConfig(cfg))
  // Shared-parent (sibling) selection, mutually exclusive with `chain`.
  const [sharedParent, setSharedParent] = useState(() => sharedParentFromConfig(cfg))
  const [selectedCols, setSelectedCols] = useState(
    Array.isArray(cfg.columns) ? cfg.columns.map(c => c.name).filter(Boolean) : [],
  )
  const [sortField, setSortField] = useState(cfg.sort_field || '')
  const [sortDir, setSortDir]     = useState(cfg.sort_dir || 'asc')

  // Incoming-FK rows per browsed table (lazy, adminService caches the RPC).
  const [fksByTable, setFksByTable] = useState({})
  const [loadingRoot, setLoadingRoot] = useState(true)
  const [expanded, setExpanded] = useState(() => new Set())
  // Shared-parent browsing: the layout object's outgoing FKs to real objects
  // (its parents), and each parent's OTHER children (this object's siblings).
  const [parentFks, setParentFks] = useState([])          // [{ objectFk, parentTable }]
  const [siblingsByParent, setSiblingsByParent] = useState({}) // { [parentTable]: [{targetTable,targetFk}] }
  const [expandedParents, setExpandedParents] = useState(() => new Set())
  const [search, setSearch] = useState('')
  // Filter text for the Add/Remove Columns list — the target table can have
  // dozens of columns, so let the admin type any part of a column name.
  const [colSearch, setColSearch] = useState('')

  const [targetColumns, setTargetColumns] = useState([])
  const [loadingTarget, setLoadingTarget] = useState(false)
  // Set when a NEW selection is made: apply default columns/sort once the
  // target's columns arrive. Not set on edit-open, so saved picks survive.
  const [defaultsPending, setDefaultsPending] = useState(false)

  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)

  const targetTable = sharedParent
    ? sharedParent.targetTable
    : (chain.length ? chain[chain.length - 1].table : '')

  function loadChildren(table) {
    if (fksByTable[table]) return
    describeIncomingFKs(table)
      .then(rows => setFksByTable(prev => (prev[table] ? prev : { ...prev, [table]: rows || [] })))
      .catch(err => setError(err.message || String(err)))
  }

  useEffect(() => {
    let cancelled = false
    describeIncomingFKs(objectName)
      .then(rows => { if (!cancelled) setFksByTable(prev => ({ ...prev, [objectName]: rows || [] })) })
      .catch(err => { if (!cancelled) setError(err.message || String(err)) })
      .finally(() => { if (!cancelled) setLoadingRoot(false) })
    return () => { cancelled = true }
  }, [objectName])

  // Discover the layout object's outgoing FKs to real objects — each is a
  // "shared parent" whose OTHER children are this object's siblings, reachable
  // as a shared-parent related list (e.g. Enrollments under a Building's
  // Property). picklist_values / users targets (record type, status, owner,
  // audit) are excluded.
  useEffect(() => {
    let cancelled = false
    describeObject(objectName)
      .then(cols => {
        if (cancelled) return
        const parents = (cols || [])
          .filter(c => c.is_foreign_key && c.references_table
            && !NON_OBJECT_FK_TABLES.has(c.references_table)
            && c.references_table !== objectName)
          .map(c => ({ objectFk: c.column_name, parentTable: c.references_table }))
        setParentFks(parents)
      })
      .catch(() => { /* non-fatal — shared-parent section just won't appear */ })
    return () => { cancelled = true }
  }, [objectName])

  // A parent's OTHER children = this object's siblings (drop the layout object
  // itself and any picklist/user referencing rows).
  function loadSiblings(parentTable) {
    if (siblingsByParent[parentTable]) return
    describeIncomingFKs(parentTable)
      .then(rows => {
        const sibs = (rows || [])
          .filter(r => r.referencing_table !== objectName
            && !NON_OBJECT_FK_TABLES.has(r.referencing_table))
          .map(r => ({ targetTable: r.referencing_table, targetFk: r.referencing_column }))
        setSiblingsByParent(prev => (prev[parentTable] ? prev : { ...prev, [parentTable]: sibs }))
      })
      .catch(err => setError(err.message || String(err)))
  }

  useEffect(() => {
    if (!targetTable) { setTargetColumns([]); return }
    let cancelled = false
    setLoadingTarget(true)
    describeObject(targetTable)
      .then(cols => { if (!cancelled) setTargetColumns(cols || []) })
      .catch(err => { if (!cancelled) setError(err.message || String(err)) })
      .finally(() => { if (!cancelled) setLoadingTarget(false) })
    return () => { cancelled = true }
  }, [targetTable])

  // Apply defaults for a fresh selection; otherwise just drop stale picks
  // that don't exist on the (possibly changed) target table.
  useEffect(() => {
    if (!targetTable || loadingTarget || targetColumns.length === 0) return
    if (defaultsPending) {
      const defaults = defaultDisplayColumns(targetColumns)
      setSelectedCols(defaults)
      const sortPick = defaults.find(n => /_record_number$/.test(n)) || defaults[0] || ''
      setSortField(sortPick)
      setSortDir('asc')
      setDefaultsPending(false)
      return
    }
    const valid = new Set(targetColumns.map(c => c.column_name))
    setSelectedCols(prev => prev.filter(n => valid.has(n)))
    setSortField(prev => (prev && !valid.has(prev) ? '' : prev))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTable, loadingTarget, targetColumns, defaultsPending])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  // The auto-filled TITLE is the object's name — what the card is called is
  // the admin's call, and they type over it. The relationship naming
  // (lib/relatedListNaming) belongs to the picker ROWS above, where two
  // routes to the same object have to be told apart before one is chosen.
  function selectChain(nextChain) {
    setChain(nextChain)
    setSharedParent(null)
    setDefaultsPending(true)
    if (!titleTouched.current) {
      setTitle(humanizeTableName(nextChain[nextChain.length - 1].table))
    }
  }

  function selectSharedParent(sp) {
    setSharedParent(sp)
    setChain([])
    setDefaultsPending(true)
    if (!titleTouched.current) {
      setTitle(humanizeTableName(sp.targetTable))
    }
  }

  function toggleExpanded(pathKey, childTable) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(pathKey)) next.delete(pathKey)
      else {
        next.add(pathKey)
        loadChildren(childTable)
      }
      return next
    })
  }

  function toggleExpandedParent(parentTable) {
    setExpandedParents(prev => {
      const next = new Set(prev)
      if (next.has(parentTable)) next.delete(parentTable)
      else {
        next.add(parentTable)
        loadSiblings(parentTable)
      }
      return next
    })
  }

  const selectableTargetColumns = useMemo(() => (
    targetColumns
      .filter(c => !HIDDEN_TARGET_COLUMNS.has(c.column_name) && !c.is_primary_key)
      .sort((a, b) => a.column_name.localeCompare(b.column_name))
  ), [targetColumns])

  const visibleTargetColumns = useMemo(() => {
    const q = colSearch.trim().toLowerCase()
    if (!q) return selectableTargetColumns
    return selectableTargetColumns.filter(c =>
      c.column_name.toLowerCase().includes(q)
      || humanizeColumnName(c.column_name).toLowerCase().includes(q)
      || relatedColumnType(c).toLowerCase().includes(q),
    )
  }, [selectableTargetColumns, colSearch])

  function toggleColumn(name) {
    setSelectedCols(prev =>
      prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name],
    )
  }

  function moveColumn(name, delta) {
    setSelectedCols(prev => {
      const idx = prev.indexOf(name)
      const to = idx + delta
      if (idx < 0 || to < 0 || to >= prev.length) return prev
      const next = [...prev]
      next.splice(idx, 1)
      next.splice(to, 0, name)
      return next
    })
  }

  function validate() {
    if (!title.trim()) return 'Title is required'
    if (chain.length === 0 && !sharedParent) return 'Pick an object to show'
    if (selectedCols.length === 0) return 'Pick at least one column to display'
    return null
  }

  async function apply() {
    const err = validate()
    if (err) { setError(err); return }
    setBusy(true)
    setError(null)
    try {
      const byName = new Map(targetColumns.map(c => [c.column_name, c]))

      // Resolve display fields for lookup columns up front (cached RPC).
      const lookupTables = [...new Set(
        selectedCols
          .map(n => byName.get(n))
          .filter(c => c && relatedColumnType(c) === 'lookup')
          .map(c => c.references_table),
      )]
      const displayFieldByTable = {}
      await Promise.all(lookupTables.map(async (t) => {
        const cols = await describeObject(t).catch(() => [])
        displayFieldByTable[t] = pickDisplayField(cols || [])
      }))

      // Preserve prior column entries verbatim (they may carry hand-authored
      // labels or lookup wiring); build fresh entries for new picks.
      const priorByName = new Map(
        (Array.isArray(cfg.columns) ? cfg.columns : []).map(c => [c.name, c]),
      )
      const columns = selectedCols.map(name => {
        const prior = priorByName.get(name)
        if (prior && cfg.table === targetTable) return prior
        const col = byName.get(name)
        const type = col ? relatedColumnType(col) : 'text'
        const entry = { name, type, label: humanizeColumnName(name) }
        if (type === 'lookup') {
          const lookupField = displayFieldByTable[col.references_table]
          if (lookupField) {
            entry.fk_column    = name
            entry.lookup_table = col.references_table
            entry.lookup_field = lookupField
          } else {
            entry.type = 'text' // no display column to embed — show raw value
          }
        }
        return entry
      })

      // Carry forward any extra config keys (editable, picker, order_field,
      // hide_when_empty, …) the layout may already have on this widget.
      const config = { ...cfg, columns }
      if (sharedParent) {
        // Sibling-via-shared-parent: target links to the parent through
        // config.fk; the layout object links to it through object_fk.
        config.table = sharedParent.targetTable
        config.fk = sharedParent.targetFk
        config.shared_parent = {
          table: sharedParent.parentTable,
          object_table: objectName,
          object_fk: sharedParent.objectFk,
        }
        delete config.via
      } else {
        const target = chain[chain.length - 1]
        config.table = target.table
        config.fk = target.fk
        delete config.shared_parent
        if (chain.length > 1) {
          config.via = chain.slice(0, -1).reverse().map(n => ({ table: n.table, fk: n.fk }))
        } else {
          delete config.via
        }
      }
      if (sortField) { config.sort_field = sortField; config.sort_dir = sortDir }
      else { delete config.sort_field; delete config.sort_dir }
      // Soft-delete filter column: detect the target's real column — audit
      // columns are unprefixed on some tables (`is_deleted`) and prefixed on
      // others (`unit_is_deleted`); a blanket 'is_deleted' 400s the fetch on
      // prefixed tables. Re-detect whenever the target table changed.
      if (config.is_deleted_col === undefined || cfg.table !== targetTable) {
        const softDel = targetColumns.find(c => c.column_name === 'is_deleted')
          || targetColumns.find(c => /_is_deleted$/.test(c.column_name))
        config.is_deleted_col = softDel ? softDel.column_name : 'is_deleted'
      }

      onApply({ title: title.trim(), config })
    } catch (e) {
      setError(e.message || String(e))
      setBusy(false)
    }
  }

  const selectedKey = chainKey(chain)
  const searchLower = search.trim().toLowerCase()

  // One browser level: the incoming FKs of ancestry's last table, each row
  // selectable and (until the depth cap) drillable into its own children.
  function renderLevel(ancestry, depth) {
    const parentTable = ancestry.length ? ancestry[ancestry.length - 1].table : objectName
    const rows = fksByTable[parentTable]
    if (!rows) {
      return (
        <div style={{ padding: '7px 12px', paddingLeft: 12 + depth * 22, color: C.textMuted, fontSize: 12 }}>
          Loading…
        </div>
      )
    }
    if (rows.length === 0) {
      return (
        <div style={{ padding: '7px 12px', paddingLeft: 12 + depth * 22, color: C.textMuted, fontSize: 12, fontStyle: 'italic' }}>
          No related objects.
        </div>
      )
    }
    const tableCounts = rows.reduce((m, r) => {
      m[r.referencing_table] = (m[r.referencing_table] || 0) + 1
      return m
    }, {})
    return rows.map(r => {
      const node = { table: r.referencing_table, fk: r.referencing_column }
      const nodeChain = [...ancestry, node]
      const pathKey = chainKey(nodeChain)
      const label = relatedListTitle(node.table, node.fk, { fkCount: tableCounts[node.table] })
      // Top-level search: hide non-matching rows, but never hide an expanded
      // branch or the current selection's path.
      const matchesSearch = !searchLower
        || label.toLowerCase().includes(searchLower)
        || node.table.includes(searchLower)
      const isOnSelectedPath = selectedKey === pathKey || selectedKey.startsWith(`${pathKey}/`)
      const isExpanded = expanded.has(pathKey)
      if (!matchesSearch && !isExpanded && !isOnSelectedPath) return null
      const isSelected = selectedKey === pathKey
      const canDrill = depth < MAX_BROWSE_DEPTH
      return (
        <div key={pathKey}>
          <div
            onClick={() => { if (!busy) selectChain(nodeChain) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 12px',
              paddingLeft: 12 + (depth - 1) * 22,
              borderBottom: `1px solid ${C.border}`,
              background: isSelected ? '#f0f9f5' : 'transparent',
              cursor: 'pointer',
              fontSize: 12.5,
            }}
          >
            {canDrill ? (
              <button
                onClick={(e) => { e.stopPropagation(); if (!busy) toggleExpanded(pathKey, node.table) }}
                aria-label={isExpanded ? `Collapse ${label}` : `Show objects related to ${label}`}
                title={isExpanded ? 'Collapse' : `Show objects related to ${label}`}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: '2px 4px', color: C.textMuted, fontSize: 11, lineHeight: 1,
                  transform: isExpanded ? 'rotate(90deg)' : 'none',
                  transition: 'transform 150ms ease',
                  flexShrink: 0,
                }}
              >
                ›
              </button>
            ) : (
              <span style={{ width: 19, flexShrink: 0 }} />
            )}
            <span style={{
              width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
              border: `1.5px solid ${isSelected ? C.emerald : C.borderDark || C.border}`,
              background: isSelected ? C.emerald : 'transparent',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {isSelected && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />}
            </span>
            <span style={{
              color: C.textPrimary, fontWeight: isSelected ? 600 : 400,
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {label}
            </span>
            {tableCounts[node.table] > 1 && (
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: C.textMuted, flexShrink: 0 }}>
                {node.fk}
              </span>
            )}
            {depth > 1 && (
              <span style={{
                background: '#e8f3fb', color: '#1a5a8a', fontSize: 9.5, fontWeight: 600,
                padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase',
                letterSpacing: '0.04em', flexShrink: 0, marginLeft: 'auto',
              }}>
                via {humanizeTableName(parentTable)}
              </span>
            )}
          </div>
          {isExpanded && renderLevel(nodeChain, depth + 1)}
        </div>
      )
    })
  }

  // Shared-parent (sibling) browser: each of the layout object's parents, with
  // that parent's OTHER children (this object's siblings) as selectable rows.
  // e.g. under a Buildings layout → "Through Property" → Enrollments.
  function renderSharedParentSection() {
    if (parentFks.length === 0) return null
    // Only render parent groups that (when searching) contain a matching
    // sibling — but always keep an expanded group and the selected group open.
    const groups = parentFks.map(p => {
      const sibs = siblingsByParent[p.parentTable]
      const isExpanded = expandedParents.has(p.parentTable)
      const isSelectedParent = !!sharedParent && sharedParent.parentTable === p.parentTable
      const matchingSibs = !searchLower || !sibs
        ? sibs
        : sibs.filter(s => humanizeTableName(s.targetTable).toLowerCase().includes(searchLower)
            || s.targetTable.includes(searchLower))
      // When searching, hide a collapsed group with no matching siblings
      // (unless it holds the current selection).
      if (searchLower && !isExpanded && !isSelectedParent
        && sibs && (!matchingSibs || matchingSibs.length === 0)) return null
      return { p, sibs, matchingSibs, isExpanded, isSelectedParent }
    }).filter(Boolean)
    if (groups.length === 0) return null

    return (
      <>
        <div style={{
          padding: '6px 12px', background: '#f2f6fb',
          borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
          fontSize: 10.5, fontWeight: 700, color: C.textSecondary,
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          Through a shared parent
        </div>
        {groups.map(({ p, sibs, matchingSibs, isExpanded }) => (
          <div key={`sp::${p.parentTable}`}>
            <div
              onClick={() => { if (!busy) toggleExpandedParent(p.parentTable) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 12px',
                borderBottom: `1px solid ${C.border}`,
                cursor: 'pointer', fontSize: 12.5,
              }}
            >
              <span style={{
                padding: '2px 4px', color: C.textMuted, fontSize: 11, lineHeight: 1, flexShrink: 0,
                transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease',
              }}>›</span>
              <span style={{ color: C.textPrimary, fontWeight: 500 }}>
                Through {humanizeTableName(p.parentTable)}
              </span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: C.textMuted }}>
                {p.objectFk}
              </span>
            </div>
            {isExpanded && (
              !sibs ? (
                <div style={{ padding: '7px 12px', paddingLeft: 34, color: C.textMuted, fontSize: 12 }}>Loading…</div>
              ) : matchingSibs.length === 0 ? (
                <div style={{ padding: '7px 12px', paddingLeft: 34, color: C.textMuted, fontSize: 12, fontStyle: 'italic' }}>
                  {searchLower ? 'No matching sibling objects.' : 'No sibling objects.'}
                </div>
              ) : (
                matchingSibs.map(s => {
                  const isSelected = !!sharedParent
                    && sharedParent.parentTable === p.parentTable
                    && sharedParent.targetTable === s.targetTable
                    && sharedParent.targetFk === s.targetFk
                  const sameTableCount = sibs.filter(x => x.targetTable === s.targetTable).length
                  return (
                    <div
                      key={`${p.parentTable}/${s.targetTable}/${s.targetFk}`}
                      onClick={() => { if (!busy) selectSharedParent({ ...s, parentTable: p.parentTable, objectFk: p.objectFk }) }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '7px 12px', paddingLeft: 34,
                        borderBottom: `1px solid ${C.border}`,
                        background: isSelected ? '#f0f9f5' : 'transparent',
                        cursor: 'pointer', fontSize: 12.5,
                      }}
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                        border: `1.5px solid ${isSelected ? C.emerald : C.borderDark || C.border}`,
                        background: isSelected ? C.emerald : 'transparent',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {isSelected && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />}
                      </span>
                      <span style={{
                        color: C.textPrimary, fontWeight: isSelected ? 600 : 400,
                        minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {relatedListTitle(s.targetTable, s.targetFk, { fkCount: sameTableCount })}
                      </span>
                      {sameTableCount > 1 && (
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: C.textMuted, flexShrink: 0 }}>
                          {s.targetFk}
                        </span>
                      )}
                      <span style={{
                        background: '#e8f3fb', color: '#1a5a8a', fontSize: 9.5, fontWeight: 600,
                        padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase',
                        letterSpacing: '0.04em', flexShrink: 0, marginLeft: 'auto',
                      }}>
                        via {humanizeTableName(p.parentTable)}
                      </span>
                    </div>
                  )
                })
              )
            )}
          </div>
        ))}
      </>
    )
  }

  return (
    <div
      {...backdropDismissProps(onClose, { disabled: busy })}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 700,
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 20,
      }}
    >
      <div
        role="dialog" aria-modal="true" aria-label={initial ? 'Edit related list' : 'Add related list'}
        style={{
          background: C.card,
          borderRadius: isMobile ? '12px 12px 0 0' : 10,
          width: isMobile ? '100%' : 640,
          maxWidth: '100%',
          maxHeight: isMobile ? '92vh' : '88vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 20px 12px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary }}>
              {initial ? 'Edit Related List' : 'Add Related List'}
            </div>
            <span style={{
              background: '#e8f3fb', color: '#1a5a8a',
              fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>related_list</span>
          </div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 4 }}>
            Changes apply to the canvas — save the layout to make them live.
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          <FormField
            label="Show Records From"
            hint={`Objects related to ${humanizeTableName(objectName)}. Use › to drill into an object's own related records (e.g. Units under Buildings) — the list on the page gathers them across all of this record's ${humanizeTableName(objectName).toLowerCase()} children. Under "Through a shared parent" you can also show sibling objects that share this record's parent (e.g. Enrollments through Property).`}
            required
          >
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              disabled={busy || loadingRoot}
              placeholder="Search objects…"
              style={{ ...inputStyle, marginBottom: 6 }}
            />
            <div style={{
              border: `1px solid ${C.borderDark || C.border}`,
              borderRadius: 6, overflow: 'hidden',
              maxHeight: 240, overflowY: 'auto',
              background: '#fafbfd',
            }}>
              {loadingRoot ? (
                <div style={{ padding: 16, textAlign: 'center', color: C.textMuted, fontSize: 12 }}>Loading objects…</div>
              ) : (
                <>
                  {renderLevel([], 1)}
                  {renderSharedParentSection()}
                </>
              )}
            </div>
            {chain.length > 0 && (
              <div style={{
                ...hintBoxStyle, marginTop: 6, marginBottom: 0,
                display: 'flex', flexDirection: 'column', gap: 2,
              }}>
                <span>
                  Showing <strong>{humanizeTableName(targetTable)}</strong>
                  {chain.length > 1
                    ? ` related to this record through ${chain.slice(0, -1).map(n => humanizeTableName(n.table)).join(' → ')}.`
                    : ' directly linked to this record.'}
                </span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                  {joinPathLabel(chain, objectName)}
                </span>
              </div>
            )}
            {sharedParent && (
              <div style={{
                ...hintBoxStyle, marginTop: 6, marginBottom: 0,
                display: 'flex', flexDirection: 'column', gap: 2,
              }}>
                <span>
                  Showing <strong>{humanizeTableName(sharedParent.targetTable)}</strong> that share this
                  {' '}{humanizeTableName(objectName).toLowerCase().replace(/s$/, '')}'s
                  {' '}<strong>{humanizeTableName(sharedParent.parentTable).replace(/s$/, '')}</strong>.
                </span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                  {`${sharedParent.targetTable}.${sharedParent.targetFk} → ${sharedParent.parentTable} ← ${objectName}.${sharedParent.objectFk}`}
                </span>
              </div>
            )}
          </FormField>

          <FormField label="Title" hint="Card heading on the record page's Related tab — filled in for you from the object you pick." required>
            <input
              value={title}
              onChange={e => { titleTouched.current = true; setTitle(e.target.value) }}
              disabled={busy}
              placeholder="e.g. Units"
              style={inputStyle}
            />
          </FormField>

          {targetTable && selectedCols.length > 0 && (
            <FormField
              label="Column Order"
              hint="Left-to-right order of the list's columns — use the arrows to rearrange, × to remove."
            >
              <div style={{
                border: `1px solid ${C.borderDark || C.border}`,
                borderRadius: 6, overflow: 'hidden',
                background: '#fafbfd',
              }}>
                {selectedCols.map((name, i) => (
                  <div
                    key={name}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 12px',
                      borderBottom: i === selectedCols.length - 1 ? 'none' : `1px solid ${C.border}`,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', width: 16, flexShrink: 0 }}>
                      {i + 1}
                    </span>
                    <span style={{
                      fontFamily: 'JetBrains Mono, monospace', color: C.textPrimary,
                      flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {name}
                    </span>
                    <button
                      onClick={() => moveColumn(name, -1)}
                      disabled={busy || i === 0}
                      aria-label={`Move ${name} left`}
                      title="Move left (up in this list)"
                      style={{
                        background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4,
                        cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? C.border : C.textSecondary,
                        padding: '1px 7px', fontSize: 11, lineHeight: 1.4, flexShrink: 0,
                      }}
                    >↑</button>
                    <button
                      onClick={() => moveColumn(name, 1)}
                      disabled={busy || i === selectedCols.length - 1}
                      aria-label={`Move ${name} right`}
                      title="Move right (down in this list)"
                      style={{
                        background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4,
                        cursor: i === selectedCols.length - 1 ? 'default' : 'pointer',
                        color: i === selectedCols.length - 1 ? C.border : C.textSecondary,
                        padding: '1px 7px', fontSize: 11, lineHeight: 1.4, flexShrink: 0,
                      }}
                    >↓</button>
                    <button
                      onClick={() => toggleColumn(name)}
                      disabled={busy}
                      aria-label={`Remove ${name}`}
                      title="Remove column"
                      style={{
                        background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4,
                        cursor: 'pointer', color: C.textSecondary,
                        padding: '1px 7px', fontSize: 11, lineHeight: 1.4, flexShrink: 0,
                      }}
                    >×</button>
                  </div>
                ))}
              </div>
            </FormField>
          )}

          {targetTable && (
            <FormField
              label={selectedCols.length > 0 ? 'Add or Remove Columns' : 'Columns to Display'}
              hint={`Sensible defaults are pre-selected — adjust only if you want a different set. ${selectedCols.length} selected · click to toggle`}
              required
            >
              <input
                value={colSearch}
                onChange={e => setColSearch(e.target.value)}
                disabled={busy || loadingTarget}
                placeholder="Search columns…"
                style={{ ...inputStyle, marginBottom: 6 }}
              />
              <div style={{
                border: `1px solid ${C.borderDark || C.border}`,
                borderRadius: 6, overflow: 'hidden',
                maxHeight: 220, overflowY: 'auto',
                background: '#fafbfd',
              }}>
                {loadingTarget ? (
                  <div style={{ padding: 16, textAlign: 'center', color: C.textMuted, fontSize: 12 }}>Loading columns…</div>
                ) : selectableTargetColumns.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: C.textMuted, fontSize: 12, fontStyle: 'italic' }}>
                    No selectable columns.
                  </div>
                ) : visibleTargetColumns.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: C.textMuted, fontSize: 12, fontStyle: 'italic' }}>
                    No columns match “{colSearch.trim()}”.
                  </div>
                ) : (
                  visibleTargetColumns.map(c => {
                    const checked = selectedCols.includes(c.column_name)
                    return (
                      <label
                        key={c.column_name}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '7px 12px',
                          borderBottom: `1px solid ${C.border}`,
                          background: checked ? '#f0f9f5' : 'transparent',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleColumn(c.column_name)}
                          disabled={busy}
                        />
                        <span style={{
                          fontFamily: 'JetBrains Mono, monospace',
                          color: C.textPrimary,
                          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          flex: 1,
                        }}>
                          {c.column_name}
                        </span>
                        <span style={{
                          background: C.card, color: C.textSecondary, fontSize: 9.5, fontWeight: 600,
                          padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.04em',
                          border: `1px solid ${C.border}`, flexShrink: 0,
                        }}>
                          {relatedColumnType(c)}
                        </span>
                      </label>
                    )
                  })
                )}
              </div>
            </FormField>
          )}

          {targetTable && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12 }}>
              <FormField label="Sort Field" hint="Pre-set from the object — change if needed.">
                <select
                  value={sortField}
                  onChange={e => setSortField(e.target.value)}
                  disabled={busy}
                  style={{ ...inputStyle, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}
                >
                  <option value="">— No sort —</option>
                  {targetColumns
                    .filter(c => !c.is_primary_key)
                    .map(c => (
                      <option key={c.column_name} value={c.column_name}>{c.column_name}</option>
                    ))}
                </select>
              </FormField>
              <FormField label="Direction">
                <select
                  value={sortDir}
                  onChange={e => setSortDir(e.target.value)}
                  disabled={busy || !sortField}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  {SORT_DIRECTIONS.map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </FormField>
            </div>
          )}
        </div>

        <div style={{
          padding: '12px 20px',
          borderTop: `1px solid ${C.border}`,
          background: '#fafbfd',
          display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 11, color: C.textMuted }}>
            {!targetTable
              ? 'Pick an object above.'
              : `${humanizeTableName(targetTable)} · ${selectedCols.length} column${selectedCols.length === 1 ? '' : 's'}`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={busy} style={buttonSecondaryStyle}>Cancel</button>
            <button onClick={apply} disabled={busy} style={buttonPrimaryStyle}>
              {busy ? 'Applying…' : initial ? 'Apply Changes' : 'Add to Section'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: '0 20px 12px' }}>
            <div style={dangerBoxStyle}>{error}</div>
          </div>
        )}
      </div>
    </div>
  )
}
