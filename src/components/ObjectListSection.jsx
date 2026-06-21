import { useState, useEffect } from 'react'
import { ListView } from './ListView'
import { LoadingState, ErrorState } from './UI'
import RecordDetail from './RecordDetail'
import { fetchObjectRecords, buildObjectColumns } from '../data/objectListService'
import { fetchSavedViewsForObject } from '../data/listViewsService'

// ---------------------------------------------------------------------------
// ObjectListSection — renders the universal list view for any object, on any
// module. Given an object table it auto-derives columns from schema, fetches
// the object's records, loads that object's saved views (which the ListView
// selector lets the user switch between), and opens records via RecordDetail.
//
// This is what makes an object tab work on a module that has no hand-written
// list code for it: the same records, the same saved views, everywhere.
// ---------------------------------------------------------------------------

export default function ObjectListSection({ objectTable, moduleId }) {
  const [data, setData]       = useState([])
  const [columns, setColumns] = useState([])
  const [views, setViews]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [selected, setSelected] = useState(null)   // { id, mode } | null

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [cols, rows, savedViews] = await Promise.all([
        buildObjectColumns(objectTable),
        fetchObjectRecords(objectTable),
        fetchSavedViewsForObject(objectTable).catch(() => []),
      ])
      setColumns(cols)
      setData(rows)
      setViews(savedViews)
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
        const [cols, rows, savedViews] = await Promise.all([
          buildObjectColumns(objectTable),
          fetchObjectRecords(objectTable),
          fetchSavedViewsForObject(objectTable).catch(() => []),
        ])
        if (cancelled) return
        setColumns(cols); setData(rows); setViews(savedViews)
      } catch (err) {
        if (!cancelled) setError(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [objectTable])

  if (selected) {
    return (
      <RecordDetail
        tableName={objectTable}
        recordId={selected.id}
        mode={selected.mode || 'view'}
        onBack={() => setSelected(null)}
        onRecordCreated={(r) => setSelected({ id: r.id, mode: 'view' })}
        onNavigateToRecord={(r) => setSelected({ id: r.id, mode: r.mode })}
      />
    )
  }

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={load} />

  return (
    <ListView
      data={data}
      columns={columns}
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
