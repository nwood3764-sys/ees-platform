import { useState, useEffect, useRef, useCallback } from 'react'
import { ListView } from './ListView'
import { LoadingState, ErrorState } from './UI'
import RecordDetail from './RecordDetail'
import RecordLink from './RecordLink'
import { fetchObjectRecords, buildObjectColumnCatalog, deriveColumnOptions, isRelatedField } from '../data/objectListService'
import { collectRelatedFieldsForViews, collectRelatedFields } from '../lib/listViewFields'
import { fetchSavedViewsForObject } from '../data/listViewsService'
import { useNav } from '../lib/navContext'
import { isUrlAddressableTable, getTableListUrl } from '../lib/urlNav'
import { useDataRefresh } from '../lib/dataRefresh'

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

  // Related-list "View All" scope, decoded from the URL's `rel` param and
  // surfaced on the nav context. Applies only when it targets THIS list's
  // object — the list then fetches just this parent's related records
  // (Salesforce related-list page parity) rather than the whole object. A
  // stable key drives a re-fetch when the scope changes.
  const listScope = (nav?.listScope && nav.listScope.table === objectTable) ? nav.listScope : null
  const scopeKey = listScope
    ? `${listScope.fk}|${listScope.parentId}|${(listScope.via || []).map(v => `${v.table}:${v.fk}`).join('>')}`
    : ''

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
  // True while a refetch triggered by a newly-referenced related field is in
  // flight. The rows on screen don't carry that field yet, so a filter on it
  // matches nothing — the list says "loading" instead of "no records match",
  // which would read as a broken filter.
  const [relatedPending, setRelatedPending] = useState(false)

  // Pre-seed related fields from saved views so a view resolves on first paint
  // without a second fetch. Every way a view REFERENCES a field counts — the
  // columns it displays, the fields it filters on, and the field it sorts by —
  // because a filter on a related field is worthless if the fetch didn't
  // resolve it. Drill-down filters passed in by a caller are seeded the same
  // way, since they arrive as the default view.
  const seedRelatedFromViews = (savedViews) => {
    const seeded = new Set(collectRelatedFieldsForViews(savedViews))
    for (const f of collectRelatedFields({ filters: initialFilters })) seeded.add(f)
    return Array.from(seeded).sort()
  }

  const fetchRows = useCallback(async (relatedFields) => {
    const rows = await fetchObjectRecords(objectTable, { activeFields: relatedFields, relatedScope: listScope })
    return rows
  }, [objectTable, scopeKey])   // eslint-disable-line react-hooks/exhaustive-deps

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
        const rows = await fetchObjectRecords(objectTable, { activeFields: seeded, relatedScope: listScope })
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
  }, [objectTable, scopeKey])   // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch the rows when a background action (today: the LEAP Assistant)
  // commits a change to this list's object, so a newly created record or an
  // edited field shows without a manual reload. Refetches in the background
  // (keeps the current rows on screen, no loading flash) and only when this
  // list's object was touched — an empty tables list means "refresh regardless".
  useDataRefresh(useCallback((evt) => {
    const tables = evt?.tables || []
    if (tables.length && !tables.includes(objectTable)) return
    ;(async () => {
      try {
        const rows = await fetchRows(activeRelated)
        lastRowsRef.current = rows
        setData(rows)
        setColumns(cols => deriveColumnOptions(cols, rows))
      } catch { /* keep prior rows on failure */ }
    })()
  }, [objectTable, activeRelated, fetchRows]))

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
      // A field this view now references but the current rows don't carry.
      // Refetch in the background; keep showing current rows meanwhile.
      const needsRows = next.some(f => !prev.includes(f))
      if (needsRows) setRelatedPending(true)
      ;(async () => {
        try {
          const rows = await fetchRows(next)
          lastRowsRef.current = rows
          setData(rows)
          // Re-derive filter options against the catalog columns currently in
          // the catalog (cheap; deriveColumnOptions only touches text cols).
          setColumns(cols => deriveColumnOptions(cols, rows))
        } catch { /* keep prior rows on failure */ }
        finally { if (needsRows) setRelatedPending(false) }
      })()
      return next
    })
  }, [fetchRows])

  // Background refetch of the current rows — used after a list-view bulk
  // action (edit/delete/clone) so counts and rows reflect the new server state
  // WITHOUT the full-screen loading flash `load()` would cause.
  const refreshRowsInBackground = useCallback(async () => {
    try {
      const rows = await fetchRows(activeRelated)
      lastRowsRef.current = rows
      setData(rows)
      setColumns(cols => deriveColumnOptions(cols, rows))
    } catch { /* keep prior rows on failure */ }
  }, [fetchRows, activeRelated])

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

  // Create is a pop-up, never a page swap: a local create (a table with no
  // record URL, or a standalone mount with no NavContext) renders RecordDetail
  // in create mode — which draws itself as a modal — while this list stays
  // mounted underneath. The URL-driven path never reaches here; App intercepts
  // mode:'create' and shows the same pop-up above the module.
  const localCreate = selected && selected.mode === 'create' ? selected : null
  const localCreateOverlay = localCreate ? (
    <RecordDetail
      key={`create:${localCreate.table || objectTable}`}
      tableName={localCreate.table || objectTable}
      recordId={null}
      mode="create"
      prefill={localCreate.prefill || null}
      onBack={() => setSelected(null)}
      onRecordCreated={(r) => setSelected({ id: r.id, mode: 'view', table: localCreate.table || objectTable })}
      onNavigateToRecord={(r) => setSelected({ id: r.id, mode: r.mode || 'view', table: r.table || objectTable, prefill: r.prefill || null })}
    />
  ) : null

  // In the URL-driven path this branch never renders (the list unmounts the
  // moment a record is selected — the parent module shows its own RecordDetail
  // from the URL). It remains for standalone mounts with no NavContext.
  if (selected && !localCreate) {
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

  if (loading) return <>{localCreateOverlay}<LoadingState /></>
  if (error)   return <>{localCreateOverlay}<ErrorState error={error} onRetry={load} /></>

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

  // When the list is scoped to a parent record (related-list "View All"), the
  // rows are already fetched scoped — so the header banner tells the user what
  // they're looking at and offers a one-click return to the full object list.
  // A pinned per-user default view is skipped in this mode so its saved filters
  // don't further narrow the scoped set.
  const unscopedListUrl = listScope ? getTableListUrl(objectTable) : null

  const listView = (
    <ListView
      data={data}
      columns={columns}
      columnCatalog={catalog}
      columnGroups={groups}
      onActiveRelatedFieldsChange={handleActiveRelatedChange}
      dataPending={relatedPending}
      systemViews={effectiveViews}
      defaultViewId={drillView ? '__drill__' : undefined}
      applyDefaultViewOnLoad={!drillView && !listScope}
      listObject={objectTable}
      listModule={moduleId}
      onRefresh={load}
      // Edit mode (Salesforce-parity): multi-select, inline cell edit, bulk
      // edit/clone/delete, and per-row Edit/Clone/Delete on every object list.
      // Row-scoped writes go through the bulk RPCs against this object's table.
      tableName={objectTable}
      onRecordsUpdated={refreshRowsInBackground}
      onEditRecord={(row) => { if (row?._id) openRecord({ id: row._id, mode: 'edit', name: row.name, table: row.table }) }}
      onCloneRecord={(row) => { if (row?._id) openRecord({ id: row._id, mode: 'clone', name: row.name, table: row.table }) }}
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

  if (!listScope) return <>{listView}{localCreateOverlay}</>

  // Scoped view — a related-list "View All". Header banner names the parent and
  // links back to the full object list (a real anchor so it also opens in a new
  // tab / shares like every other list link).
  const objectLabel = objectTable
    .replace(/_/g, ' ')
    .replace(/\b\w/g, m => m.toUpperCase())
  return (
    // Mirror ListView's own root box (flex:1 + minWidth/minHeight:0 + overflow
    // hidden) so this wrapper fills the module's flex row exactly as the bare
    // ListView did — otherwise it collapses to content width and the table is
    // clipped with dead space beside it.
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 16px', background: '#eef4fb',
        borderBottom: '1px solid #d0d8e8', fontSize: 12.5, color: '#0d1a2e',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 500 }}>
          Showing {objectLabel}
          {listScope.label ? <> related to <strong>{listScope.label}</strong></> : ' for this record'}
        </span>
        {unscopedListUrl && (
          <a
            href={unscopedListUrl}
            style={{ marginLeft: 'auto', color: '#1a5a8a', fontWeight: 500, textDecoration: 'none' }}
            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline' }}
            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none' }}
          >
            View all {objectLabel} →
          </a>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {listView}
      </div>
      {localCreateOverlay}
    </div>
  )
}
