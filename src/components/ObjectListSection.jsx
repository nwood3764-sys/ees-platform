import { useState, useEffect, useRef, useCallback } from 'react'
import { ListView } from './ListView'
import { LoadingState, ErrorState } from './UI'
import RecordDetail from './RecordDetail'
import RecordLink from './RecordLink'
import { fetchObjectRecords, buildObjectColumnCatalog, deriveColumnOptions, isRelatedField } from '../data/objectListService'
import { fetchSavedViewsForObject } from '../data/listViewsService'
import { useNav } from '../lib/navContext'
import { isUrlAddressableTable } from '../lib/urlNav'

// ---------------------------------------------------------------------------
// ObjectListSection — renders the universal list view for any object, on any
// module. Given an object table it auto-derives columns from schema, fetches
// the object's records, loads that object's saved views (which the ListView
// selector lets the user switch between), and opens records via RecordDetail.
//
// This is what makes an object tab work on a module that has no hand-written
// list code for it: the same records, the same saved views, everywhere.
//
// Columns: the full searchable catalog (every own column + one-hop related
// columns through the object's lookups) comes from buildObjectColumnCatalog.
// The initial render shows the default set; the user adds more via the column
// picker. When the visible set includes related columns, the row fetch is
// re-run with those fields so the parent-join resolves their values.
// ---------------------------------------------------------------------------

export default function ObjectListSection({ objectTable, moduleId, initialFilters = null }) {
  // When the app shell provides navigation (the default in the running app),
  // open records by pushing a real record URL (`/<table>/<id>`) so every record
  // is shareable, bookmarkable, and visible to the topbar gear (Salesforce
  // parity). The parent module's URL-driven `selectedRecord ? <RecordDetail>`
  // branch then renders the detail and this list unmounts — so the local
  // `selected` state below is only used as a fallback for a standalone mount
  // with no NavContext provider.
  const nav = useNav()
  const [data, setData]       = useState([])
  const [columns, setColumns] = useState([])     // default-visible descriptors
  const [catalog, setCatalog] = useState([])     // full selectable catalog
  const [groups, setGroups]   = useState([])     // ordered group labels
  const [views, setViews]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [selected, setSelected] = useState(null)   // { id, mode, table?, prefill? } | null

  // Related fields currently needed by the active view (so the fetch resolves
  // their parent joins). Kept as a stable sorted key to avoid redundant fetches.
  const [activeRelated, setActiveRelated] = useState([])
  const activeRelatedKey = activeRelated.join('|')
  const lastRowsRef = useRef([])

  // Pre-seed related fields from saved views so a default view that includes a
  // related column resolves on first paint without a second fetch.
  const seedRelatedFromViews = (savedViews) => {
    const s = new Set()
    for (const v of savedViews || []) {
      for (const f of (v.visibleColumns || [])) if (isRelatedField(f)) s.add(f)
    }
    return Array.from(s).sort()
  }

  const fetchRows = useCallback(async (relatedFields) => {
    const rows = await fetchObjectRecords(objectTable, { activeFields: relatedFields })
    return rows
  }, [objectTable])

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [cat, savedViews] = await Promise.all([
        buildObjectColumnCatalog(objectTable),
        fetchSavedViewsForObject(objectTable).catch(() => []),
      ])
      const seeded = seedRelatedFromViews(savedViews)
      const rows = await fetchRows(seeded)
      lastRowsRef.current = rows
      setCatalog(cat.catalog); setGroups(cat.groups)
      setColumns(deriveColumnOptions(cat.defaultColumns, rows))
      setData(rows); setViews(savedViews); setActiveRelated(seeded)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const [cat, savedViews] = await Promise.all([
          buildObjectColumnCatalog(objectTable),
          fetchSavedViewsForObject(objectTable).catch(() => []),
        ])
        const seeded = seedRelatedFromViews(savedViews)
        const rows = await fetchObjectRecords(objectTable, { activeFields: seeded })
        if (cancelled) return
        lastRowsRef.current = rows
        setCatalog(cat.catalog); setGroups(cat.groups)
        setColumns(deriveColumnOptions(cat.defaultColumns, rows))
        setData(rows); setViews(savedViews); setActiveRelated(seeded)
      } catch (err) {
        if (!cancelled) setError(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [objectTable])

  // When the user adds/removes related columns live, ListView reports the new
  // set of active related fields. If it changed, refetch rows with those fields
  // so the parent joins resolve. Own-column changes never trigger a refetch
  // (their data is already on every row).
  const handleActiveRelatedChange = useCallback((relatedFields) => {
    const next = Array.from(new Set(relatedFields.filter(isRelatedField))).sort()
    setActiveRelated(prev => {
      const prevKey = prev.join('|')
      const nextKey = next.join('|')
      if (prevKey === nextKey) return prev
      // Refetch in the background; keep showing current rows meanwhile.
      ;(async () => {
        try {
          const rows = await fetchRows(next)
          lastRowsRef.current = rows
          setData(rows)
          // Re-derive filter options against the catalog columns currently in
          // the catalog (cheap; deriveColumnOptions only touches text cols).
          setColumns(cols => deriveColumnOptions(cols, rows))
        } catch { /* keep prior rows on failure */ }
      })()
      return next
    })
  }, [fetchRows])

  // Open a record. With NavContext present, push a record URL so the address
  // bar carries the id and the open record is shareable; otherwise fall back to
  // local detail state. rec: { id, mode?, table?, prefill? }.
  const openRecord = (rec) => {
    const targetTable = rec.table || objectTable
    // Only route through the URL when the table is a real record root, so the
    // resulting link resolves back to the record on reload/share. Unmapped
    // tables (and standalone mounts with no NavContext) keep local detail state.
    if (nav?.navigateToRecord && isUrlAddressableTable(targetTable)) {
      // name is carried so the module breadcrumb has it in-session (the URL
      // can't encode it; a fresh deep link resolves the name from the record).
      nav.navigateToRecord({ table: targetTable, id: rec.id, mode: rec.mode || 'view', name: rec.name, prefill: rec.prefill })
    } else {
      setSelected({ id: rec.id, mode: rec.mode || 'view', table: rec.table, name: rec.name, prefill: rec.prefill })
    }
  }

  // In the URL-driven path this branch never renders (the list unmounts the
  // moment a record is selected — the parent module shows its own RecordDetail
  // from the URL). It remains for standalone mounts with no NavContext.
  if (selected) {
    // selected.table lets a lookup hyperlink, breadcrumb, or advance-to action
    // open a record on a DIFFERENT object than this list's own. Without it,
    // RecordDetail would query the target id against objectTable and fail with
    // "Cannot coerce the result to a single JSON object" (zero rows). Defaults
    // to this list's object for ordinary row opens.
    const detailTable = selected.table || objectTable
    return (
      <RecordDetail
        key={`${detailTable}:${selected.id || 'new'}`}
        tableName={detailTable}
        recordId={selected.id}
        mode={selected.mode || 'view'}
        prefill={selected.prefill || null}
        onBack={() => setSelected(null)}
        onRecordCreated={(r) => setSelected({ id: r.id, mode: 'view', table: detailTable })}
        onNavigateToRecord={(r) => setSelected({ id: r.id, mode: r.mode || 'view', table: r.table || detailTable, prefill: r.prefill || null })}
      />
    )
  }

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={load} />

  // Drill-down scope: when a caller (e.g. a dashboard widget click) passes
  // initialFilters, prepend a synthetic "Filtered" system view and default to
  // it, so the list opens scoped to the clicked segment (Salesforce-style
  // drill-down). ListView seeds its active filters from the default view, so no
  // extra state is needed here — the parent remounts this component (via a
  // filter-aware key) when the drill target changes. Each filter row is the
  // standard { field, op, value } shape the list engine matches on.
  const drillView = (Array.isArray(initialFilters) && initialFilters.length > 0)
    ? { id: '__drill__', name: 'Filtered', filters: initialFilters, sortField: null, sortDir: 'asc' }
    : null
  const effectiveViews = drillView ? [drillView, ...views] : views

  return (
    <ListView
      data={data}
      columns={columns}
      columnCatalog={catalog}
      columnGroups={groups}
      onActiveRelatedFieldsChange={handleActiveRelatedChange}
      systemViews={effectiveViews}
      defaultViewId={drillView ? '__drill__' : undefined}
      listObject={objectTable}
      listModule={moduleId}
      onRefresh={load}
      onOpenRecord={(row) => { if (row?._id) openRecord({ id: row._id, mode: 'view', name: row.name }) }}
      onNew={() => openRecord({ id: null, mode: 'create' })}
      renderCell={(col, r) => {
        // Make the Name a single-click link that opens the record, so the
        // generic list behaves like a standard list view (the table otherwise
        // opens on double-click).
        if (col.field === 'name') {
          // Render the name as a real anchor (RecordLink) so right-click →
          // "Open in new tab", middle-click, and Ctrl/Cmd-click work like a
          // standard Salesforce record link. Plain left-click still opens the
          // record in-app (single-click list behavior). The link targets the
          // row's own table when it differs from this list's object (lookup
          // rows), falling back to the list object otherwise.
          const targetTable = r.table || objectTable
          return (
            <td key="name" style={{ padding: '11px 12px', borderBottom: '1px solid #e4e9f2', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <RecordLink
                table={targetTable}
                id={r?._id}
                title={r.name || ''}
                onActivate={() => { if (r?._id) openRecord({ id: r._id, mode: 'view', name: r.name }) }}
                style={{ color: '#1a5a8a', fontWeight: 600 }}
              >
                {r.name || '(no name)'}
              </RecordLink>
            </td>
          )
        }
        return null   // fall through to ListView's default cell for other columns
      }}
    />
  )
}
