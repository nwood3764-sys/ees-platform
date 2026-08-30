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
  getOpportunityPriceBook,
  listSelectablePriceBooks,
  setOpportunityPriceBook,
  getOpportunityRebateCapStatus,
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
  // Price book — lives on the opportunity.
  const [priceBook, setPriceBook] = useState({ price_book_id: null, price_book_name: null })
  const [choosingBook, setChoosingBook] = useState(false) // add panel is on the book-picker step
  const [bookOptions, setBookOptions] = useState(null)    // null = not loaded
  const [settingBook, setSettingBook] = useState(false)

  const title = widget?.widget_config?.label || 'Products'
  const hasBook = !!priceBook.price_book_id

  const load = useCallback(async () => {
    try {
      const [products, book] = await Promise.all([
        listOpportunityProducts(opportunityId),
        getOpportunityPriceBook(opportunityId),
      ])
      setRows(products)
      setPriceBook(book)
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

  // Per-dwelling-unit rebate cap (IRA HEAR and any other capped program).
  // Re-read from the server whenever the lines change rather than recomputing
  // it here: the "worst-off unit" rule has ONE definition, in the database, so
  // this card and any future save-time check can never disagree. A program with
  // no cap configured returns nothing and the band simply does not render — it
  // must never invent a limit for a program that has none.
  const [capStatus, setCapStatus] = useState(null)
  useEffect(() => {
    if (!opportunityId) return
    let cancelled = false
    ;(async () => {
      try {
        const s = await getOpportunityRebateCapStatus(opportunityId)
        if (!cancelled) setCapStatus(s)
      } catch (e) {
        // A missing cap is not an error worth interrupting the grid for.
        console.error('Rebate cap status failed', e)
        if (!cancelled) setCapStatus(null)
      }
    })()
    return () => { cancelled = true }
  }, [opportunityId, rows])

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
  const loadBookOptions = async () => {
    if (bookOptions != null) return
    try {
      setBookOptions(await listSelectablePriceBooks())
    } catch (e) {
      console.error('Load price books failed', e)
      toast.error('Could not load price books')
      setBookOptions([])
    }
  }
  const loadProductOptions = async () => {
    try {
      setAddOptions(await listAddableProducts(opportunityId))
    } catch (e) {
      console.error('Load addable products failed', e)
      toast.error('Could not load products')
      setAddOptions([])
    }
  }
  const openAdd = async () => {
    setAddOpen(true)
    setAddSearch('')
    if (!hasBook) {
      // First product: the opportunity has no price book — prompt to pick one.
      setChoosingBook(true)
      loadBookOptions()
    } else {
      setChoosingBook(false)
      if (addOptions == null) loadProductOptions()
    }
  }
  const chooseBook = async (priceBookId, priceBookName) => {
    setSettingBook(true)
    try {
      await setOpportunityPriceBook(opportunityId, priceBookId)
      setPriceBook({ price_book_id: priceBookId, price_book_name: priceBookName })
      setAddOptions(null)
      setChoosingBook(false)
      await loadProductOptions()
    } catch (e) {
      console.error('Set price book failed', e)
      toast.error('Could not set the price book')
    } finally {
      setSettingBook(false)
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
          style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
        >
          <span style={{ color: C.textMuted, fontSize: 11, marginTop: 3 }}>{collapsed ? '▸' : '▾'}</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{title}</span>
              <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 400, marginLeft: 6 }}>({rows.length})</span>
            </span>
            {!loading && (
              <span style={{ fontSize: 11.5, color: C.textMuted }}>
                {hasBook ? <>Price Book: <span style={{ color: C.textSecondary, fontWeight: 500 }}>{priceBook.price_book_name || '—'}</span></> : 'No price book yet'}
              </span>
            )}
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

      {/* Per-dwelling-unit rebate cap. Rendered outside the collapse so a
          project that is over the cap cannot be folded out of sight. */}
      {capStatus && (() => {
        // Two different questions, side by side, because they answer different
        // things and can disagree: PER UNIT is the rule a submission is judged
        // against, PROJECT is the budget you estimate against. A project can sit
        // under budget while one unit is over its cap, since caps are per unit.
        const overUnit = !!capStatus.is_over_cap
        const amount   = Number(capStatus.amount_per_unit) || 0
        const cap      = Number(capStatus.cap_per_unit) || 0
        const room     = Number(capStatus.headroom_per_unit) || 0

        // Project figures are null until somebody says how many units this is —
        // showing a $0 budget would read as "nothing left" rather than "unknown".
        const units     = capStatus.unit_count == null ? null : Number(capStatus.unit_count)
        const available = capStatus.total_available == null ? null : Number(capStatus.total_available)
        const spent     = Number(capStatus.grand_total) || 0
        const remaining = capStatus.remaining_budget == null ? null : Number(capStatus.remaining_budget)
        const overBudget = remaining != null && remaining < 0

        const warn   = overUnit || overBudget
        const accent = warn ? C.amber : C.emerald
        const mono   = { fontFamily: "'JetBrains Mono', monospace", color: C.textPrimary, fontWeight: 600 }
        const divider = <span style={{ color: C.border }}>|</span>

        return (
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8,
            padding: '8px 14px',
            // Tint of C.amber, which this palette points at sky blue — warning
            // states are blue or navy here, never red or orange.
            background: warn ? 'rgba(126,179,232,0.14)' : CARD_SECONDARY,
            borderTop: `1px solid ${C.border}`,
            borderLeft: `3px solid ${accent}`,
            fontSize: 12,
            color: C.textSecondary,
          }}>
            <span style={{ color: C.textMuted }}>Total</span>
            <span style={mono}>{fmtCurrency(spent)}</span>

            {divider}

            <span style={{ color: C.textMuted }}>Per unit</span>
            <span style={mono}>{fmtCurrency(amount)}</span>
            <span style={{ color: C.textMuted }}>of {fmtCurrency(cap)}</span>
            <span style={{ color: overUnit ? C.amber : C.textSecondary, fontWeight: 600 }}>
              {overUnit
                ? `over by ${fmtCurrency(Math.abs(room))}`
                : `· ${fmtCurrency(room)} left`}
            </span>

            {available != null && (
              <>
                {divider}
                <span style={{ color: C.textMuted }}>
                  Remaining {capStatus.program_label} funding
                </span>
                <span style={{ ...mono, color: overBudget ? C.amber : C.textPrimary }}>
                  {fmtCurrency(remaining)}
                </span>
                <span style={{ color: C.textMuted }}>
                  of {fmtCurrency(available)} ({units} {units === 1 ? 'unit' : 'units'} × {fmtCurrency(cap)})
                </span>
              </>
            )}

            {warn && (
              <span style={{ color: C.textPrimary, fontWeight: 600 }}>
                {overUnit
                  ? `— a dwelling unit is over the ${fmtCurrency(cap)} cap. Reduce a sales price or drop a measure.`
                  : '— the project is over its available funding.'}
              </span>
            )}
          </div>
        )
      })()}

      {!collapsed && (
        <>
          {/* add panel */}
          {addOpen && (
            <div style={{ padding: '10px 14px', background: CARD_SECONDARY, borderBottom: `1px solid ${C.border}` }}>
              {choosingBook ? (
                // Step 1 (only when the opportunity has no price book yet):
                // choose the price book. It is then stored on the opportunity.
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textSecondary }}>Select a price book for this opportunity</span>
                    <button onClick={() => setAddOpen(false)} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', color: C.textSecondary }}>Close</button>
                  </div>
                  <div style={{ maxHeight: 240, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 6, background: '#fff' }}>
                    {bookOptions == null ? (
                      <div style={{ padding: 12, fontSize: 13, color: C.textMuted }}>Loading price books…</div>
                    ) : bookOptions.length === 0 ? (
                      <div style={{ padding: 12, fontSize: 13, color: C.textMuted }}>No price books are set up yet.</div>
                    ) : (
                      bookOptions.map(b => (
                        <button
                          key={b.value}
                          disabled={settingBook}
                          onClick={() => chooseBook(b.value, b.label)}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', fontSize: 13, background: 'none', border: 'none', borderBottom: `1px solid ${C.border}`, cursor: settingBook ? 'wait' : 'pointer', color: C.textPrimary }}
                        >
                          {b.label}
                        </button>
                      ))
                    )}
                  </div>
                </>
              ) : (
                // Step 2: browse the whole product list for the opportunity's
                // price book (search is an optional filter, not required).
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textSecondary }}>
                      Products in {priceBook.price_book_name || 'this price book'}
                    </span>
                    {rows.length === 0 && (
                      <button
                        onClick={() => { setChoosingBook(true); loadBookOptions() }}
                        style={{ background: 'none', border: 'none', color: '#1e466b', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                      >Change price book</button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <input
                      autoFocus
                      placeholder="Filter products…"
                      value={addSearch}
                      onChange={e => setAddSearch(e.target.value)}
                      style={{ flex: 1, padding: '6px 10px', fontSize: 13, border: `1px solid ${C.borderDark}`, borderRadius: 6, outline: 'none' }}
                    />
                    <button onClick={() => setAddOpen(false)} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', color: C.textSecondary }}>Close</button>
                  </div>
                  <div style={{ maxHeight: 260, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 6, background: '#fff' }}>
                    {addOptions == null ? (
                      <div style={{ padding: 12, fontSize: 13, color: C.textMuted }}>Loading…</div>
                    ) : filteredAdd.length === 0 ? (
                      <div style={{ padding: 12, fontSize: 13, color: C.textMuted }}>
                        {addOptions.length === 0 ? 'No products are priced into this price book yet.' : 'No matches.'}
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
                </>
              )}
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
