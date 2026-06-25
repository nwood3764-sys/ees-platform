import { useState, useEffect, useRef, useCallback } from 'react'
import { ListView } from './ListView'
import { LoadingState, ErrorState } from './UI'
import RecordDetail from './RecordDetail'
import { fetchObjectRecords, buildObjectColumnCatalog, deriveColumnOptions, isRelatedField } from '../data/objectListService'
import { fetchSavedViewsForObject } from '../data/listViewsService'

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

export default function ObjectListSection({ objectTable, moduleId }) {
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

  return (
    <ListView
      data={data}
      columns={columns}
      columnCatalog={catalog}
      columnGroups={groups}
      onActiveRelatedFieldsChange={handleActiveRelatedChange}
      systemViews={views}
      listObject={objectTable}
      listModule={moduleId}
      onRefresh={load}
      onOpenRecord={(row) => { if (row?._id) setSelected({ id: row._id, mode: 'view' }) }}
      onNew={() => setSelected({ id: null, mode: 'create' })}
      renderCell={(col, r) => {
        // Make the Name a single-click link that opens the record, so the
        // generic list behaves like a standard list view (the table otherwise
        // opens on double-click).
        if (col.field === 'name') {
          return (
            <td key="name" style={{ padding: '11px 12px', borderBottom: '1px solid #e4e9f2', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span
                onClick={(e) => { e.stopPropagation(); if (r?._id) setSelected({ id: r._id, mode: 'view' }) }}
                style={{ color: '#1a5a8a', fontWeight: 600, cursor: 'pointer' }}
              >
                {r.name || '(no name)'}
              </span>
            </td>
          )
        }
        return null   // fall through to ListView's default cell for other columns
      }}
    />
  )
}
