// Opportunity Products — Salesforce-style inline-editable line-item table shown
// on the opportunity record page (specializes the opportunity_line_items
// related list). Each product is a row; Quantity, Sales Price, Line
// Description, and Notes edit in place; rows reorder up/down; products add and
// remove without leaving the page. Pricing stays product-driven — adding a
// product resolves its price book entry, list price, and description via the
// DB trigger (see opportunityProductsService + migration 20260729023310).

import { useState, useEffect, useCallback, useMemo } from 'react'
import { C } from '../data/constants'
import { useToast } from './Toast'
import {
  listOpportunityProducts,
  listAddableProducts,
  addOpportunityProduct,
  updateOpportunityProductField,
  removeOpportunityProduct,
  reorderOpportunityProducts,
} from '../data/opportunityProductsService'

const CARD_SECONDARY = '#f7f9fc'

const fmtCurrency = (v) =>
  v === null || v === undefined || v === ''
    ? '—'
    : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtNumber = (v) =>
  v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-US')

// Editable columns: text vs numeric changes validation + input type.
const EDIT_TEXT = new Set(['oli_line_description', 'oli_notes'])
const EDIT_NUMBER = new Set(['oli_quantity', 'oli_unit_price'])

export default function OpportunityProductsWidget({
  widget, opportunityId, onNavigateToRecord,
}) {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(null) // { id, field }
  const [draft, setDraft] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [reordering, setReordering] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addOptions, setAddOptions] = useState(null) // null = not loaded
  const [addSearch, setAddSearch] = useState('')
  const [adding, setAdding] = useState(false)

  const title = widget?.widget_config?.label || 'Products'

  const load = useCallback(async () => {
    try {
      setRows(await listOpportunityProducts(opportunityId))
    } catch (e) {
      console.error('Load opportunity products failed', e)
      toast.error('Could not load products')
    } finally {
      setLoading(false)
    }
  }, [opportunityId, toast])

  useEffect(() => { load() }, [load])

  const grandTotal = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.oli_total_price) || 0), 0),
    [rows],
  )

  // --- cell editing -------------------------------------------------------
  const startEdit = (row, field) => {
    setEditing({ id: row.id, field })
    setDraft(row[field] == null ? '' : String(row[field]))
  }
  const cancelEdit = () => { setEditing(null); setDraft('') }

  const commitEdit = async (row, field) => {
    const raw = draft
    let value
    if (EDIT_NUMBER.has(field)) {
      if (raw.trim() === '') { cancelEdit(); return }
      value = Number(raw)
      if (Number.isNaN(value) || value < 0) {
        toast.error('Enter a valid number')
        return
      }
    } else {
      value = raw.trim() === '' ? null : raw
    }
    const current = row[field]
    const same = (current == null ? '' : String(current)) === (value == null ? '' : String(value))
    if (same) { cancelEdit(); return }

    setBusyId(row.id)
    try {
      const updated = await updateOpportunityProductField(row.id, field, value)
      setRows(prev => prev.map(r => (r.id === row.id ? updated : r)))
    } catch (e) {
      console.error('Save cell failed', e)
      toast.error('Save failed')
    } finally {
      setBusyId(null)
      cancelEdit()
    }
  }

  // --- reorder (up / down) ------------------------------------------------
  const move = async (index, dir) => {
    const target = index + dir
    if (target < 0 || target >= rows.length || reordering) return
    const next = rows.slice()
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    setRows(next) // optimistic
    setReordering(true)
    try {
      await reorderOpportunityProducts(next.map(r => r.id))
    } catch (e) {
      console.error('Reorder failed', e)
      toast.error('Reorder failed')
      load()
    } finally {
      setReordering(false)
    }
  }

  // --- remove -------------------------------------------------------------
  const remove = async (row) => {
    if (!window.confirm(`Remove "${row.product_name || row.oli_name || 'this line'}" from the opportunity?`)) return
    setBusyId(row.id)
    try {
      await removeOpportunityProduct(row.id)
      setRows(prev => prev.filter(r => r.id !== row.id))
    } catch (e) {
      console.error('Remove failed', e)
      toast.error('Remove failed')
    } finally {
      setBusyId(null)
    }
  }

  // --- add ----------------------------------------------------------------
  const openAdd = async () => {
    setAddOpen(true)
    setAddSearch('')
    if (addOptions == null) {
      try {
        setAddOptions(await listAddableProducts(opportunityId))
      } catch (e) {
        console.error('Load addable products failed', e)
        toast.error('Could not load products')
        setAddOptions([])
      }
    }
  }
  const addProduct = async (productId) => {
    setAdding(true)
    try {
      const maxOrder = rows.reduce((m, r) => Math.max(m, Number(r.oli_sort_order) || 0), 0)
      const row = await addOpportunityProduct(opportunityId, productId, maxOrder + 1)
      setRows(prev => [...prev, row])
      setAddOpen(false)
    } catch (e) {
      console.error('Add product failed', e)
      toast.error('Could not add product')
    } finally {
      setAdding(false)
    }
  }

  const filteredAdd = useMemo(() => {
    const list = addOptions || []
    const q = addSearch.trim().toLowerCase()
    return q ? list.filter(o => o.label.toLowerCase().includes(q)) : list
  }, [addOptions, addSearch])

  // --- styles -------------------------------------------------------------
  const th = {
    textAlign: 'left', padding: '7px 10px', fontSize: 11, fontWeight: 600,
    color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.03em',
    borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', background: CARD_SECONDARY,
  }
  const thRight = { ...th, textAlign: 'right' }
  const td = { padding: '6px 10px', fontSize: 13, color: C.textPrimary, borderBottom: `1px solid ${C.border}`, verticalAlign: 'middle' }
  const tdRight = { ...td, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }
  const editBox = {
    width: '100%', boxSizing: 'border-box', padding: '4px 6px', fontSize: 13,
    border: `1px solid ${C.emerald}`, borderRadius: 4, outline: 'none', background: '#fff',
    color: C.textPrimary,
  }
  const iconBtn = (enabled) => ({
    border: `1px solid ${C.border}`, background: '#fff', borderRadius: 4,
    width: 22, height: 20, lineHeight: '16px', fontSize: 11, cursor: enabled ? 'pointer' : 'not-allowed',
    color: enabled ? C.textSecondary : C.textMuted, opacity: enabled ? 1 : 0.5, padding: 0,
  })

  const renderEditable = (row, field, display, align) => {
    const isEditing = editing && editing.id === row.id && editing.field === field
    if (isEditing) {
      return (
        <input
          autoFocus
          type={EDIT_NUMBER.has(field) ? 'number' : 'text'}
          min={EDIT_NUMBER.has(field) ? 0 : undefined}
          step="any"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => commitEdit(row, field)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit(row, field) }
            else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
          }}
          style={{ ...editBox, textAlign: align === 'right' ? 'right' : 'left' }}
        />
      )
    }
    return (
      <div
        onClick={() => busyId !== row.id && startEdit(row, field)}
        title="Click to edit"
        style={{
          cursor: 'text', minHeight: 20, padding: '2px 4px', borderRadius: 4,
          color: display === '—' ? C.textMuted : C.textPrimary,
          border: '1px solid transparent',
        }}
        onMouseEnter={e => { e.currentTarget.style.border = `1px solid ${C.border}` }}
        onMouseLeave={e => { e.currentTarget.style.border = '1px solid transparent' }}
      >
        {display}
      </div>
    )
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 16, overflow: 'hidden' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: collapsed ? 'none' : `1px solid ${C.border}` }}>
        <button
          onClick={() => setCollapsed(c => !c)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <span style={{ color: C.textMuted, fontSize: 11 }}>{collapsed ? '▸' : '▾'}</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{title}</span>
          <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 400 }}>
            ({rows.length})
          </span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!loading && rows.length > 0 && (
            <span style={{ fontSize: 12, color: C.textSecondary }}>
              Total: <strong style={{ fontFamily: "'JetBrains Mono', monospace", color: C.textPrimary }}>{fmtCurrency(grandTotal)}</strong>
            </span>
          )}
          <button
            onClick={openAdd}
            style={{ background: C.emerald, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
          >
            + Add Product
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* add panel */}
          {addOpen && (
            <div style={{ padding: '10px 14px', background: CARD_SECONDARY, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input
                  autoFocus
                  placeholder="Search products…"
                  value={addSearch}
                  onChange={e => setAddSearch(e.target.value)}
                  style={{ flex: 1, padding: '6px 10px', fontSize: 13, border: `1px solid ${C.borderDark}`, borderRadius: 6, outline: 'none' }}
                />
                <button onClick={() => setAddOpen(false)} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', color: C.textSecondary }}>Close</button>
              </div>
              <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 6, background: '#fff' }}>
                {addOptions == null ? (
                  <div style={{ padding: 12, fontSize: 13, color: C.textMuted }}>Loading…</div>
                ) : filteredAdd.length === 0 ? (
                  <div style={{ padding: 12, fontSize: 13, color: C.textMuted }}>
                    {addOptions.length === 0 ? 'No products are priced into this opportunity’s price book yet.' : 'No matches.'}
                  </div>
                ) : (
                  filteredAdd.map(o => (
                    <button
                      key={o.value}
                      disabled={adding}
                      onClick={() => addProduct(o.value)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, background: 'none', border: 'none', borderBottom: `1px solid ${C.border}`, cursor: adding ? 'wait' : 'pointer', color: C.textPrimary }}
                    >
                      {o.label}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* table */}
          {loading ? (
            <div style={{ padding: 16, fontSize: 13, color: C.textMuted }}>Loading products…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 20, fontSize: 13, color: C.textMuted, textAlign: 'center' }}>
              No products yet — use <strong>+ Add Product</strong> to build the proposal.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 62 }}></th>
                    <th style={th}>Product</th>
                    <th style={th}>Line Description</th>
                    <th style={th}>Notes</th>
                    <th style={{ ...thRight, width: 80 }}>Qty</th>
                    <th style={{ ...thRight, width: 110 }}>Sales Price</th>
                    <th style={{ ...thRight, width: 110 }}>List Price</th>
                    <th style={{ ...thRight, width: 120 }}>Total</th>
                    <th style={{ ...th, width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const rowBusy = busyId === row.id
                    return (
                      <tr key={row.id} style={{ background: rowBusy ? CARD_SECONDARY : '#fff', opacity: rowBusy ? 0.6 : 1 }}>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 3 }}>
                            <button style={iconBtn(i > 0)} disabled={i === 0 || reordering} onClick={() => move(i, -1)} title="Move up">▲</button>
                            <button style={iconBtn(i < rows.length - 1)} disabled={i === rows.length - 1 || reordering} onClick={() => move(i, 1)} title="Move down">▼</button>
                          </div>
                        </td>
                        <td style={td}>
                          <button
                            onClick={() => onNavigateToRecord && onNavigateToRecord({ table: 'opportunity_line_items', id: row.id })}
                            style={{ background: 'none', border: 'none', padding: 0, color: '#1e466b', fontSize: 13, fontWeight: 500, cursor: 'pointer', textAlign: 'left' }}
                          >
                            {row.product_name || row.oli_name || 'Line item'}
                          </button>
                          {row.unit_name && (
                            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{row.unit_name}</div>
                          )}
                        </td>
                        <td style={{ ...td, minWidth: 200 }}>{renderEditable(row, 'oli_line_description', row.oli_line_description || '—', 'left')}</td>
                        <td style={{ ...td, minWidth: 160 }}>{renderEditable(row, 'oli_notes', row.oli_notes || '—', 'left')}</td>
                        <td style={tdRight}>{renderEditable(row, 'oli_quantity', fmtNumber(row.oli_quantity), 'right')}</td>
                        <td style={tdRight}>{renderEditable(row, 'oli_unit_price', fmtCurrency(row.oli_unit_price), 'right')}</td>
                        <td style={{ ...tdRight, color: C.textMuted }}>{fmtCurrency(row.oli_list_price)}</td>
                        <td style={{ ...tdRight, fontWeight: 600 }}>{fmtCurrency(row.oli_total_price)}</td>
                        <td style={{ ...td, textAlign: 'center' }}>
                          <button
                            onClick={() => remove(row)}
                            disabled={rowBusy}
                            title="Remove"
                            style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 16, cursor: rowBusy ? 'wait' : 'pointer', lineHeight: 1, padding: 2 }}
                          >×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={7} style={{ ...tdRight, borderBottom: 'none', paddingTop: 10, color: C.textSecondary, fontWeight: 600 }}>Grand Total</td>
                    <td style={{ ...tdRight, borderBottom: 'none', paddingTop: 10, fontWeight: 700 }}>{fmtCurrency(grandTotal)}</td>
                    <td style={{ borderBottom: 'none' }}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
