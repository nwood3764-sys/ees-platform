import { useState, useMemo, useRef, useEffect } from 'react';
import { C } from '../data/constants';
import { useIsMobile } from '../lib/useMediaQuery';
import { useSwipeToDismiss } from '../lib/useSwipeToDismiss';
import { usePullToRefresh } from '../lib/usePullToRefresh';
import { Badge, Icon, TableRow, ProgramTag } from './UI';

// ── Filter Dropdown ──────────────────────────────────────────────────────────
function FilterDropdown({ col, activeFilters, onApply, onClose }) {
  const colF = activeFilters.filter(f => f.field === col.field);
  const [sel, setSel] = useState(colF.map(f => f.value));
  const [txt, setTxt] = useState(colF[0]?.value || '');
  const [dateFrom, setDateFrom] = useState(colF.find(f => f.op === 'from')?.value || '');
  const [dateTo, setDateTo] = useState(colF.find(f => f.op === 'to')?.value || '');
  const ref = useRef();

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const toggle = v => setSel(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  const apply = () => {
    const nf = activeFilters.filter(f => f.field !== col.field);
    if (col.type === 'select') sel.forEach(v => nf.push({ field: col.field, label: col.label, op: 'equals', value: v }));
    else if (col.type === 'text' && txt.trim()) nf.push({ field: col.field, label: col.label, op: 'contains', value: txt.trim() });
    else if (col.type === 'date') {
      if (dateFrom) nf.push({ field: col.field, label: col.label + ' from', op: 'from', value: dateFrom });
      if (dateTo) nf.push({ field: col.field, label: col.label + ' to', op: 'to', value: dateTo });
    }
    onApply(nf);
    onClose();
  };

  const clear = () => { onApply(activeFilters.filter(f => f.field !== col.field)); onClose(); };

  return (
    <div ref={ref} style={{
      position: 'absolute', top: '100%', left: 0, zIndex: 300,
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: 14, minWidth: 230, marginTop: 2
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
        Filter: {col.label}
      </div>

      {col.type === 'select' && (
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span onClick={() => setSel(col.options)} style={{ fontSize: 11, color: '#1a5a8a', cursor: 'pointer' }}>Select all</span>
            <span onClick={() => setSel([])} style={{ fontSize: 11, color: C.textMuted, cursor: 'pointer' }}>Clear</span>
          </div>
          {col.options.map(o => (
            <div key={o} onClick={() => toggle(o)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', cursor: 'pointer', borderRadius: 4 }}
              onMouseEnter={e => e.currentTarget.style.background = C.page}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <div style={{
                width: 14, height: 14, borderRadius: 3,
                border: `1.5px solid ${sel.includes(o) ? C.emerald : C.borderDark}`,
                background: sel.includes(o) ? C.emerald : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
              }}>
                {sel.includes(o) && <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </div>
              <span style={{ fontSize: 12, color: C.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 185 }}>{o}</span>
            </div>
          ))}
        </div>
      )}

      {col.type === 'text' && (
        <input value={txt} onChange={e => setTxt(e.target.value)} placeholder={`Search ${col.label.toLowerCase()}...`}
          style={{ width: '100%', background: C.page, border: `1px solid ${C.border}`, borderRadius: 5, padding: '6px 9px', fontSize: 12.5, color: C.textPrimary, outline: 'none', boxSizing: 'border-box' }} />
      )}

      {col.type === 'date' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>From</div>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ width: '100%', background: C.page, border: `1px solid ${C.border}`, borderRadius: 5, padding: '6px 9px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>To</div>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ width: '100%', background: C.page, border: `1px solid ${C.border}`, borderRadius: 5, padding: '6px 9px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <button onClick={apply} style={{ flex: 1, background: C.emerald, color: '#fff', border: 'none', borderRadius: 5, padding: '6px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Apply</button>
        {colF.length > 0 && <button onClick={clear} style={{ flex: 1, background: C.page, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 5, padding: '6px 0', fontSize: 12, cursor: 'pointer' }}>Clear</button>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MobileFilterSheet — full-width bottom sheet that replaces per-column
// filter dropdowns on mobile. Opens above a dimmed backdrop, slides up
// from bottom, and exposes the same select / text / date filter primitives
// desktop users get through the column-header funnel menus.
//
// Design notes:
// - One expandable row per filterable column. Columns default to collapsed
//   so the sheet isn't a wall of controls. A column that already has an
//   active filter auto-expands so the user sees what's applied.
// - Filter state is held locally (draft). "Apply" commits all filters
//   atomically to the parent; "Clear all" resets the draft. This avoids
//   the disorienting jump-to-top behavior of live-filtering on each tap.
// - Sort is included too — picking a column/direction sets sortField and
//   sortDir on apply. Desktop has sort in the column headers; mobile has
//   no headers, so the sheet is the only home for it.
// - Sheet height caps at 85vh. Content scrolls. Apply/Clear bar is sticky
//   at the bottom with safe-area padding so it always clears the iOS home
//   indicator.
// ─────────────────────────────────────────────────────────────────────────────
function MobileFilterSheet({
  columns, activeFilters, sortField, sortDir,
  onApply, onClose,
}) {
  // Columns that can actually be filtered (have a supported type)
  const filterable = columns.filter(c => c.type === 'select' || c.type === 'text' || c.type === 'date');

  // Draft state — all edits are local until Apply
  const [draftFilters, setDraftFilters] = useState(activeFilters);
  const [draftSortField, setDraftSortField] = useState(sortField || '');
  const [draftSortDir, setDraftSortDir] = useState(sortDir || 'asc');

  // Which column sections are expanded. Columns with active filters start open.
  const [expanded, setExpanded] = useState(() => {
    const init = {};
    for (const c of filterable) {
      if (activeFilters.some(f => f.field === c.field)) init[c.field] = true;
    }
    return init;
  });
  const toggleExpanded = (field) => setExpanded(prev => ({ ...prev, [field]: !prev[field] }));

  // Helpers for reading/writing draft filters
  const getSelValues = (col) => draftFilters.filter(f => f.field === col.field).map(f => f.value);
  const getTextValue = (col) => {
    const f = draftFilters.find(f => f.field === col.field && f.op === 'contains');
    return f?.value || '';
  };
  const getDateValue = (col, op) => {
    const f = draftFilters.find(f => f.field === col.field && f.op === op);
    return f?.value || '';
  };

  const setSelValues = (col, values) => {
    setDraftFilters(prev => {
      const keep = prev.filter(f => f.field !== col.field);
      return [...keep, ...values.map(v => ({ field: col.field, label: col.label, op: 'equals', value: v }))];
    });
  };
  const setTextValue = (col, value) => {
    setDraftFilters(prev => {
      const keep = prev.filter(f => f.field !== col.field);
      if (!value.trim()) return keep;
      return [...keep, { field: col.field, label: col.label, op: 'contains', value: value.trim() }];
    });
  };
  const setDateValue = (col, op, value) => {
    setDraftFilters(prev => {
      const keep = prev.filter(f => !(f.field === col.field && f.op === op));
      if (!value) return keep;
      return [...keep, { field: col.field, label: `${col.label} ${op}`, op, value }];
    });
  };
  const clearColumn = (col) => {
    setDraftFilters(prev => prev.filter(f => f.field !== col.field));
  };

  const clearAll = () => {
    setDraftFilters([]);
    setDraftSortField('');
    setDraftSortDir('asc');
  };

  const apply = () => {
    onApply({
      filters: draftFilters,
      sortField: draftSortField || null,
      sortDir: draftSortDir,
    });
    onClose();
  };

  // Close on ESC
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const activeCount = draftFilters.length + (draftSortField ? 1 : 0);

  // Swipe-down to dismiss — attached to the sheet's drag handle + header
  // region only so it doesn't intercept taps/scrolls inside the filter
  // list itself.
  const swipe = useSwipeToDismiss({ direction: 'down', onDismiss: onClose });

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(7, 17, 31, 0.55)',
          zIndex: 500, animation: 'ees-fade-in 180ms ease',
        }}
      />
      {/* Sheet */}
      <div
        role="dialog"
        aria-label="Filters"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0,
          background: C.card, zIndex: 510,
          borderTopLeftRadius: 14, borderTopRightRadius: 14,
          maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.25)',
          animation: 'ees-slide-up 220ms ease',
          ...swipe.style,
        }}
      >
        {/* Swipe-grab region: drag handle + header. Touching here and
            dragging down dismisses the sheet. Touches inside the scrollable
            body below use native scroll — no gesture conflict. */}
        <div {...swipe.handlers}>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 0', touchAction: 'none' }}>
            <div style={{
              width: 40, height: 4, borderRadius: 2,
              background: swipe.isDragging ? C.emerald : C.borderDark,
              transition: 'background 150ms',
            }} />
          </div>

          {/* Header */}
          <div style={{
            padding: '10px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: `1px solid ${C.border}`,
          }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: C.textPrimary }}>Filters</h2>
            {activeCount > 0 && (
              <span style={{ fontSize: 12, color: C.textMuted }}>
                {activeCount} applied
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close filters"
            style={{
              background: 'transparent', border: 'none', padding: 8, borderRadius: 6,
              cursor: 'pointer', color: C.textSecondary,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 36, minHeight: 36,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {/* Sort section */}
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              Sort by
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                value={draftSortField}
                onChange={(e) => setDraftSortField(e.target.value)}
                style={{
                  flex: 1, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6,
                  padding: '10px 12px', color: C.textPrimary, outline: 'none',
                }}
              >
                <option value="">— None —</option>
                {columns.map(c => (
                  <option key={c.field} value={c.field}>{c.label}</option>
                ))}
              </select>
              <select
                value={draftSortDir}
                onChange={(e) => setDraftSortDir(e.target.value)}
                disabled={!draftSortField}
                style={{
                  width: 110, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6,
                  padding: '10px 12px', color: draftSortField ? C.textPrimary : C.textMuted, outline: 'none',
                }}
              >
                <option value="asc">Asc ↑</option>
                <option value="desc">Desc ↓</option>
              </select>
            </div>
          </div>

          {/* Filter sections — one per filterable column */}
          {filterable.map(col => {
            const isOpen = !!expanded[col.field];
            const hasFilter = draftFilters.some(f => f.field === col.field);
            return (
              <div key={col.field} style={{ borderBottom: `1px solid ${C.border}` }}>
                <button
                  onClick={() => toggleExpanded(col.field)}
                  style={{
                    width: '100%', background: 'transparent', border: 'none',
                    padding: '14px 16px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    minHeight: 48,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 500, color: C.textPrimary }}>{col.label}</span>
                    {hasFilter && (
                      <span style={{
                        background: 'rgba(62,207,142,0.14)', color: '#2aab72',
                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                      }}>
                        {draftFilters.filter(f => f.field === col.field).length}
                      </span>
                    )}
                  </div>
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={2}
                    style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }}
                  >
                    <path d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isOpen && (
                  <div style={{ padding: '0 16px 14px' }}>
                    {col.type === 'select' && (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <button
                            onClick={() => setSelValues(col, col.options)}
                            style={{ background: 'none', border: 'none', fontSize: 13, color: '#1a5a8a', cursor: 'pointer', padding: '4px 0' }}
                          >
                            Select all
                          </button>
                          <button
                            onClick={() => clearColumn(col)}
                            style={{ background: 'none', border: 'none', fontSize: 13, color: C.textMuted, cursor: 'pointer', padding: '4px 0' }}
                          >
                            Clear
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {col.options.map(o => {
                            const selected = getSelValues(col).includes(o);
                            return (
                              <div
                                key={o}
                                onClick={() => {
                                  const curr = getSelValues(col);
                                  setSelValues(col, selected ? curr.filter(v => v !== o) : [...curr, o]);
                                }}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 10,
                                  padding: '10px 4px', cursor: 'pointer', borderRadius: 6,
                                  minHeight: 40,
                                }}
                              >
                                <div style={{
                                  width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                                  border: `1.5px solid ${selected ? C.emerald : C.borderDark}`,
                                  background: selected ? C.emerald : 'transparent',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                  {selected && (
                                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  )}
                                </div>
                                <span style={{ color: C.textPrimary, flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{o}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {col.type === 'text' && (
                      <input
                        value={getTextValue(col)}
                        onChange={(e) => setTextValue(col, e.target.value)}
                        placeholder={`Contains…`}
                        style={{
                          width: '100%', background: C.page, border: `1px solid ${C.border}`, borderRadius: 6,
                          padding: '10px 12px', color: C.textPrimary, outline: 'none', boxSizing: 'border-box',
                        }}
                      />
                    )}

                    {col.type === 'date' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 5 }}>From</div>
                          <input
                            type="date" value={getDateValue(col, 'from')}
                            onChange={(e) => setDateValue(col, 'from', e.target.value)}
                            style={{
                              width: '100%', background: C.page, border: `1px solid ${C.border}`, borderRadius: 6,
                              padding: '10px 12px', color: C.textPrimary, outline: 'none', boxSizing: 'border-box',
                            }}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 5 }}>To</div>
                          <input
                            type="date" value={getDateValue(col, 'to')}
                            onChange={(e) => setDateValue(col, 'to', e.target.value)}
                            style={{
                              width: '100%', background: C.page, border: `1px solid ${C.border}`, borderRadius: 6,
                              padding: '10px 12px', color: C.textPrimary, outline: 'none', boxSizing: 'border-box',
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {filterable.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.textMuted, fontSize: 14 }}>
              No filterable columns on this view.
            </div>
          )}
        </div>

        {/* Sticky action bar */}
        <div style={{
          flexShrink: 0, background: C.card, borderTop: `1px solid ${C.border}`,
          padding: '10px 14px calc(10px + env(safe-area-inset-bottom)) 14px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <button
            onClick={clearAll}
            disabled={activeCount === 0}
            style={{
              flex: 1, background: C.page, color: activeCount === 0 ? C.textMuted : C.textSecondary,
              border: `1px solid ${C.border}`, borderRadius: 8,
              padding: '12px 16px', fontSize: 15, fontWeight: 500,
              cursor: activeCount === 0 ? 'not-allowed' : 'pointer',
              minHeight: 48,
            }}
          >
            Clear all
          </button>
          <button
            onClick={apply}
            style={{
              flex: 2, background: C.emerald, color: '#fff',
              border: 'none', borderRadius: 8,
              padding: '12px 16px', fontSize: 15, fontWeight: 600,
              cursor: 'pointer', minHeight: 48,
            }}
          >
            Apply {activeCount > 0 ? `(${activeCount})` : ''}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Sortable Header ──────────────────────────────────────────────────────────
function SortableHeader({ col, sortField, sortDir, onSort, activeFilters, onFilterApply, openFilterCol, setOpenFilterCol }) {
  const isFiltered = activeFilters.some(f => f.field === col.field);
  const isSorted = sortField === col.field;
  const isOpen = openFilterCol === col.field;

  const handleSort = () => {
    if (!col.sortable) return;
    if (sortField !== col.field) { onSort(col.field, 'asc'); return; }
    if (sortDir === 'asc') { onSort(col.field, 'desc'); return; }
    onSort(null, null);
  };

  return (
    <th style={{ padding: 0, position: 'relative', userSelect: 'none', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div onClick={handleSort}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '10px 6px 10px 12px', cursor: col.sortable ? 'pointer' : 'default', flex: 1 }}
          onMouseEnter={e => { if (col.sortable) e.currentTarget.style.background = C.page; }}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <span style={{ fontSize: 11, fontWeight: 600, color: isSorted ? C.textPrimary : C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {col.label}
          </span>
          {col.sortable && (
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <svg width="6" height="4" viewBox="0 0 6 4" fill={isSorted && sortDir === 'asc' ? C.emerald : C.borderDark}><path d="M3 0L6 4H0L3 0Z" /></svg>
              <svg width="6" height="4" viewBox="0 0 6 4" fill={isSorted && sortDir === 'desc' ? C.emerald : C.borderDark}><path d="M3 4L0 0H6L3 4Z" /></svg>
            </span>
          )}
        </div>
        {col.filterable && (
          <div onClick={() => setOpenFilterCol(isOpen ? null : col.field)}
            style={{ padding: '10px 9px 10px 3px', cursor: 'pointer', position: 'relative' }}
            onMouseEnter={e => e.currentTarget.style.background = C.page}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <svg width="11" height="11" viewBox="0 0 24 24"
              fill={isFiltered ? C.emerald : 'none'} stroke={isFiltered ? C.emerald : C.textMuted}
              strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            {isFiltered && <span style={{ position: 'absolute', top: 6, right: 5, width: 4, height: 4, background: C.emerald, borderRadius: '50%', border: '1.5px solid white' }} />}
          </div>
        )}
      </div>
      {isOpen && col.filterable && (
        <FilterDropdown col={col} activeFilters={activeFilters} onApply={onFilterApply} onClose={() => setOpenFilterCol(null)} />
      )}
    </th>
  );
}

// ── View Selector ────────────────────────────────────────────────────────────
function ViewSelector({ activeViewId, systemViews, personalViews, onSelect, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const Row = ({ v }) => (
    <div onClick={() => { onSelect(v); onClose(); }}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', cursor: 'pointer', background: v.id === activeViewId ? '#e8f8f2' : 'transparent' }}
      onMouseEnter={e => { if (v.id !== activeViewId) e.currentTarget.style.background = C.page; }}
      onMouseLeave={e => { if (v.id !== activeViewId) e.currentTarget.style.background = 'transparent'; }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={v.id === activeViewId ? C.emerald : 'transparent'} strokeWidth={2.5}><polyline points="20 6 9 17 4 12" /></svg>
      <span style={{ fontSize: 13, color: v.id === activeViewId ? C.emerald : C.textPrimary, fontWeight: v.id === activeViewId ? 600 : 400 }}>{v.name}</span>
    </div>
  );

  return (
    <div ref={ref} style={{
      position: 'absolute', top: '100%', left: 0, zIndex: 300,
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 260, marginTop: 4, overflow: 'hidden'
    }}>
      <div style={{ padding: '8px 0' }}>
        <div style={{ padding: '4px 14px 6px', fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>System Views</div>
        {systemViews.map(v => <Row key={v.id} v={v} />)}
        {personalViews.length > 0 && (
          <>
            <div style={{ height: 1, background: C.border, margin: '6px 0' }} />
            <div style={{ padding: '4px 14px 6px', fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>My Views</div>
            {personalViews.map(v => <Row key={v.id} v={v} />)}
          </>
        )}
      </div>
    </div>
  );
}

// ── Save View Modal ──────────────────────────────────────────────────────────
function SaveViewModal({ activeFilters, sortField, sortDir, cols, onSave, onClose }) {
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.card, borderRadius: 10, padding: 28, width: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>Save List View</div>
        <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 20 }}>Save your current filters and sort as a named view.</div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 5 }}>View Name</div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My WI Work Orders"
            style={{ width: '100%', background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: C.textPrimary, outline: 'none', boxSizing: 'border-box' }} />
        </div>

        {activeFilters.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6 }}>Active Filters</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {activeFilters.map((f, i) => (
                <span key={i} style={{ background: '#e8f3fb', color: '#1a5a8a', fontSize: 11, padding: '3px 8px', borderRadius: 4 }}>{f.label}: {f.value}</span>
              ))}
            </div>
          </div>
        )}

        {sortField && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 5 }}>Sort</div>
            <span style={{ background: '#f0eeff', color: '#6d5ae0', fontSize: 11, padding: '3px 8px', borderRadius: 4 }}>
              {cols.find(c => c.field === sortField)?.label} — {sortDir === 'asc' ? 'A→Z' : 'Z→A'}
            </span>
          </div>
        )}

        <div onClick={() => setShared(!shared)} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22, cursor: 'pointer' }}>
          <div style={{ width: 36, height: 20, borderRadius: 10, background: shared ? C.emerald : C.borderDark, position: 'relative', transition: 'background 0.2s' }}>
            <div style={{ position: 'absolute', top: 3, left: shared ? 18 : 3, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
          </div>
          <span style={{ fontSize: 13, color: C.textSecondary }}>Share with my role</span>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => name.trim() && onSave({ name: name.trim(), shared })}
            disabled={!name.trim()}
            style={{ flex: 1, background: name.trim() ? C.emerald : C.borderDark, color: '#fff', border: 'none', borderRadius: 6, padding: 10, fontSize: 13, fontWeight: 600, cursor: name.trim() ? 'pointer' : 'default' }}>
            Save View
          </button>
          <button onClick={onClose} style={{ flex: 1, background: C.page, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 6, padding: 10, fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ListView ────────────────────────────────────────────────────────────
export function ListView({ data, columns, systemViews, defaultViewId, newLabel, renderCell, renderDetail, onNew, onOpenRecord, onRefresh }) {
  const firstView = systemViews.find(v => v.id === defaultViewId) || systemViews[0];
  const isMobile = useIsMobile();

  // Pull-to-refresh plumbing — attached to the mobile card scroll container
  // below. No-op when onRefresh isn't provided (so modules that haven't wired
  // a refetch callback through still work exactly as before).
  const pullToRefresh = usePullToRefresh({
    onRefresh,
    enabled: isMobile && typeof onRefresh === 'function',
  });

  const [sortField, setSortField] = useState(firstView?.sortField || null);
  const [sortDir, setSortDir] = useState(firstView?.sortDir || 'asc');
  const [activeFilters, setActiveFilters] = useState([...(firstView?.filters || [])]);
  const [openFilterCol, setOpenFilterCol] = useState(null);
  const [activeViewId, setActiveViewId] = useState(defaultViewId);
  const [showViewSel, setShowViewSel] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [personalViews, setPersonalViews] = useState([]);
  const [globalSearch, setGlobalSearch] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  // Mobile-only: whether the expandable search input is shown. Tap the search
  // icon in the mobile toolbar to toggle. Desktop always shows the search box.
  const [showSearchMobile, setShowSearchMobile] = useState(false);
  // Mobile-only: whether the filter bottom sheet is open.
  const [showFilterSheet, setShowFilterSheet] = useState(false);

  const applyView = v => {
    setActiveViewId(v.id);
    setActiveFilters(v.filters || []);
    setSortField(v.sortField || null);
    setSortDir(v.sortDir || 'asc');
    setIsDirty(false);
  };

  const handleSort = (f, d) => { setSortField(f); setSortDir(d); setIsDirty(true); };

  const handleFilterApply = nf => { setActiveFilters(nf); setIsDirty(true); setOpenFilterCol(null); };

  const removeFilter = i => { setActiveFilters(prev => prev.filter((_, j) => j !== i)); setIsDirty(true); };

  const clearAll = () => { setActiveFilters([]); setSortField(null); setSortDir('asc'); setIsDirty(false); setActiveViewId(defaultViewId); };

  const handleSave = ({ name }) => {
    const v = { id: 'pv' + Date.now(), name, filters: [...activeFilters], sortField, sortDir };
    setPersonalViews(prev => [...prev, v]);
    setActiveViewId(v.id);
    setIsDirty(false);
    setShowSave(false);
  };

  const filtered = useMemo(() => {
    let d = [...data];
    if (globalSearch) {
      const q = globalSearch.toLowerCase();
      d = d.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));
    }
    activeFilters.forEach(f => {
      d = d.filter(r => {
        const v = String(r[f.field] || '');
        if (f.op === 'equals') return v === f.value;
        if (f.op === 'contains') return v.toLowerCase().includes(f.value.toLowerCase());
        if (f.op === 'from') return v >= f.value;
        if (f.op === 'to') return v <= f.value;
        return true;
      });
    });
    if (sortField) {
      d.sort((a, b) => {
        const av = String(a[sortField] || ''), bv = String(b[sortField] || '');
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return d;
  }, [activeFilters, sortField, sortDir, globalSearch, data]);

  const activeViewName = [...systemViews, ...personalViews].find(v => v.id === activeViewId)?.name || systemViews[0]?.name;

  const totalAmount = columns.some(c => c.field === 'amount') ? filtered.reduce((s, r) => s + (r.amount || 0), 0) : null;
  const totalUnits = columns.some(c => c.field === 'units') ? filtered.reduce((s, r) => s + (r.units || 0), 0) : null;

  // Default cell renderer
  const defaultCell = (col, r) => {
    const v = r[col.field];
    if (col.field === 'status' || col.field === 'stage') return <td key={col.field} style={{ padding: '11px 12px', borderBottom: `1px solid ${C.border}` }}><Badge s={v} /></td>;
    if (col.field === 'program') return <td key={col.field} style={{ padding: '11px 12px', borderBottom: `1px solid ${C.border}` }}><ProgramTag value={v} /></td>;
    if (col.field === 'id') return <td key={col.field} style={{ padding: '11px 12px', borderBottom: `1px solid ${C.border}`, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{v}</td>;
    if (col.field === 'name') return <td key={col.field} style={{ padding: '11px 12px', borderBottom: `1px solid ${C.border}`, color: C.textPrimary, fontWeight: 500, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</td>;
    if (col.field === 'amount') return <td key={col.field} style={{ padding: '11px 12px', borderBottom: `1px solid ${C.border}`, color: C.textPrimary, fontWeight: 500, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>${v ? Number(v).toLocaleString() : '—'}</td>;
    if (col.field === 'email') return <td key={col.field} style={{ padding: '11px 12px', borderBottom: `1px solid ${C.border}`, color: '#1a5a8a', fontSize: 12 }}>{v}</td>;
    return <td key={col.field} style={{ padding: '11px 12px', borderBottom: `1px solid ${C.border}`, color: v ? C.textSecondary : C.textMuted, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v || '—'}</td>;
  };

  // ─── Mobile render ───────────────────────────────────────────────────────
  // Goals: maximize records-per-screen, thumb-reachable actions, minimize chrome.
  // Layout:
  //   - Single-row toolbar: [View selector ▾] [search icon] [filter icon]
  //   - Search input appears below on tap (toggled via showSearchMobile)
  //   - Filter chips row appears below only when filters are active
  //   - A thin 28px stats strip shows the result count
  //   - Card list: ID (small mono) + name (16px bold) + status badge. No secondaries.
  //   - "New" is a floating action button (FAB) in the bottom-right corner
  //     with safe-area-inset-bottom padding so it clears the iOS home indicator.
  if (isMobile) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.page, position: 'relative' }}>
        {/* Compressed single-row toolbar */}
        <div style={{
          background: C.card, borderBottom: `1px solid ${C.border}`,
          padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* View selector — takes remaining space */}
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <button onClick={() => setShowViewSel(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: C.page, border: `1px solid ${C.border}`, borderRadius: 6,
                  padding: '8px 10px', color: C.textPrimary, cursor: 'pointer', fontWeight: 500,
                  width: '100%', minHeight: 40,
                }}>
                <Icon path="M4 6h16M4 10h16M4 14h16M4 18h16" size={14} color={C.textSecondary} />
                <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeViewName}</span>
                {isDirty && <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.amber, flexShrink: 0 }} />}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={2}><path d="M19 9l-7 7-7-7" /></svg>
              </button>
              {showViewSel && <ViewSelector activeViewId={activeViewId} systemViews={systemViews} personalViews={personalViews} onSelect={applyView} onClose={() => setShowViewSel(false)} />}
            </div>

            {/* Search toggle */}
            <button
              onClick={() => setShowSearchMobile(v => !v)}
              aria-label="Toggle search"
              style={{
                background: showSearchMobile || globalSearch ? '#e8f8f2' : C.page,
                border: `1px solid ${showSearchMobile || globalSearch ? C.emerald : C.border}`,
                borderRadius: 6, width: 40, height: 40, padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
                color: showSearchMobile || globalSearch ? C.emerald : C.textSecondary,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            </button>

            {/* Filter sheet toggle — badge shows combined filter+sort count */}
            <button
              onClick={() => setShowFilterSheet(true)}
              aria-label="Filters"
              style={{
                position: 'relative',
                background: (activeFilters.length > 0 || sortField) ? '#e8f8f2' : C.page,
                border: `1px solid ${(activeFilters.length > 0 || sortField) ? C.emerald : C.border}`,
                borderRadius: 6, width: 40, height: 40, padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
                color: (activeFilters.length > 0 || sortField) ? C.emerald : C.textSecondary,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              {(activeFilters.length + (sortField ? 1 : 0)) > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  background: C.emerald, color: '#fff',
                  fontSize: 10, fontWeight: 700,
                  minWidth: 16, height: 16, padding: '0 4px',
                  borderRadius: 8, border: `2px solid ${C.card}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1,
                }}>
                  {activeFilters.length + (sortField ? 1 : 0)}
                </span>
              )}
            </button>

            {/* Save-view indicator (only when filters dirty) */}
            {isDirty && (
              <button
                onClick={() => setShowSave(true)}
                aria-label="Save view"
                style={{
                  background: C.page, border: `1px solid ${C.emerald}`, borderRadius: 6,
                  width: 40, height: 40, padding: 0, cursor: 'pointer', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: C.emerald,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
              </button>
            )}
          </div>

          {/* Expandable search row */}
          {showSearchMobile && (
            <div style={{ position: 'relative' }}>
              <input
                autoFocus
                placeholder="Search..." value={globalSearch} onChange={e => setGlobalSearch(e.target.value)}
                style={{ width: '100%', background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 34px 10px 12px', color: C.textPrimary, outline: 'none' }}
              />
              {globalSearch && (
                <button
                  onClick={() => setGlobalSearch('')}
                  aria-label="Clear search"
                  style={{
                    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', padding: 6, cursor: 'pointer', color: C.textMuted,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              )}
            </div>
          )}

          {/* Active filter chips row — only appears when filters/sort are present */}
          {(activeFilters.length > 0 || sortField) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {activeFilters.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#e8f3fb', border: `1px solid #b8d8f0`, borderRadius: 5, padding: '4px 8px', fontSize: 12 }}>
                  <span style={{ color: '#1a5a8a', fontWeight: 500 }}>{f.label}:</span>
                  <span style={{ color: '#1a5a8a' }}>{f.value}</span>
                  <button onClick={() => removeFilter(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#7eb3e8', lineHeight: 1, marginLeft: 2 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
              {sortField && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#f0eeff', border: `1px solid #d0c8f8`, borderRadius: 5, padding: '4px 8px', fontSize: 12 }}>
                  <span style={{ color: '#6d5ae0', fontWeight: 500 }}>Sort: {columns.find(c => c.field === sortField)?.label} {sortDir === 'asc' ? '↑' : '↓'}</span>
                  <button onClick={() => { setSortField(null); setSortDir('asc'); setIsDirty(true); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#a78bfa' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </div>
              )}
              <button onClick={clearAll} style={{ background: 'none', border: 'none', fontSize: 12, color: C.textMuted, cursor: 'pointer', padding: '4px 6px' }}>Clear all</button>
            </div>
          )}
        </div>

        {/* Thin stats strip */}
        <div style={{
          padding: '6px 14px', background: C.page, borderBottom: `1px solid ${C.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 12, color: C.textSecondary, flexShrink: 0,
        }}>
          <span>{filtered.length} record{filtered.length === 1 ? '' : 's'}</span>
          {totalAmount !== null && <span>${Math.round(totalAmount / 1000)}K pipeline</span>}
          {totalUnits !== null && totalAmount === null && <span>{filtered.reduce((s, r) => s + (r.units || 0), 0).toLocaleString()} units</span>}
        </div>

        {/* Minimal card list — ID + name + status, high density */}
        <div
          {...pullToRefresh.handlers}
          style={{
            flex: 1, overflowY: 'auto', padding: '8px 10px 96px',
            WebkitOverflowScrolling: 'touch',
            position: 'relative',
          }}
        >
          {/* Pull-to-refresh indicator — only visible while pulling or
              refreshing. Sits above the first card with a spinner that
              fills in as the user pulls, becoming solid when past the
              threshold. Absolutely positioned so it doesn't take layout
              space when idle. */}
          {(pullToRefresh.pullDistance > 0 || pullToRefresh.refreshing) && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              height: pullToRefresh.pullDistance,
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
              paddingBottom: 8, pointerEvents: 'none',
              transition: pullToRefresh.refreshing ? 'height 160ms ease' : undefined,
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%',
                border: `2px solid ${C.border}`,
                borderTopColor: pullToRefresh.pullDistance >= pullToRefresh.threshold || pullToRefresh.refreshing ? C.emerald : C.borderDark,
                animation: pullToRefresh.refreshing ? 'ees-spin 0.7s linear infinite' : undefined,
                transform: pullToRefresh.refreshing
                  ? undefined
                  : `rotate(${Math.min(1, pullToRefresh.pullDistance / pullToRefresh.threshold) * 360}deg)`,
                transition: pullToRefresh.refreshing ? undefined : 'transform 80ms linear, border-top-color 150ms',
              }} />
            </div>
          )}
          {filtered.length === 0 ? (
            <div style={{
              padding: '56px 24px',
              textAlign: 'center',
              color: C.textMuted,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
            }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: C.page,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  {/* "Inbox" icon when there's no data at all, "search" when filtered */}
                  {data.length === 0 ? (
                    <>
                      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                    </>
                  ) : (
                    <>
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.35-4.35" />
                    </>
                  )}
                </svg>
              </div>
              <div style={{ fontSize: 15, fontWeight: 500, color: C.textPrimary }}>
                {data.length === 0 ? `No ${newLabel ? newLabel.toLowerCase() + 's' : 'records'} yet` : 'No matching records'}
              </div>
              <div style={{ fontSize: 13, maxWidth: 260, lineHeight: 1.4 }}>
                {data.length === 0
                  ? `Tap the + button to create your first ${newLabel ? newLabel.toLowerCase() : 'record'}.`
                  : 'Try adjusting the filters or search to find what you\'re looking for.'}
              </div>
              {data.length > 0 && (activeFilters.length > 0 || sortField || globalSearch) && (
                <button
                  onClick={() => { clearAll(); setGlobalSearch('') }}
                  style={{
                    marginTop: 4, background: 'transparent',
                    border: `1px solid ${C.border}`, borderRadius: 6,
                    padding: '8px 14px', fontSize: 13,
                    color: C.textSecondary, cursor: 'pointer',
                    minHeight: 36,
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filtered.map(r => {
                const statusVal = r.status || r.stage;
                return (
                  <div
                    key={r.id}
                    onClick={() => onOpenRecord && onOpenRecord(r)}
                    style={{
                      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
                      padding: '10px 12px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 10,
                      boxShadow: '0 1px 2px rgba(13, 26, 46, 0.03)',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {r.id && (
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.textMuted, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.id}
                        </div>
                      )}
                      <div style={{
                        fontSize: 16, fontWeight: 600, color: C.textPrimary, lineHeight: 1.3,
                        overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      }}>
                        {r.name || '(no name)'}
                      </div>
                    </div>
                    {statusVal && <div style={{ flexShrink: 0 }}><Badge s={statusVal} /></div>}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={2} style={{ flexShrink: 0 }}>
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Floating Action Button for "New" — thumb-reachable bottom-right */}
        <button
          onClick={onNew}
          aria-label={`New ${newLabel}`}
          style={{
            position: 'absolute',
            bottom: `calc(20px + env(safe-area-inset-bottom))`,
            right: 20,
            width: 56, height: 56, borderRadius: '50%',
            background: C.emerald, color: '#fff',
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 16px rgba(62, 207, 142, 0.45), 0 2px 4px rgba(0,0,0,0.1)',
            zIndex: 100,
            padding: 0,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>

        {showSave && <SaveViewModal activeFilters={activeFilters} sortField={sortField} sortDir={sortDir} cols={columns} onSave={handleSave} onClose={() => setShowSave(false)} />}
        {showFilterSheet && (
          <MobileFilterSheet
            columns={columns}
            activeFilters={activeFilters}
            sortField={sortField}
            sortDir={sortDir}
            onClose={() => setShowFilterSheet(false)}
            onApply={({ filters, sortField: sf, sortDir: sd }) => {
              setActiveFilters(filters);
              setSortField(sf);
              setSortDir(sd);
              setIsDirty(true);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
        {/* View selector */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowViewSel(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 13, color: C.textPrimary, cursor: 'pointer', fontWeight: 500 }}>
            <Icon path="M4 6h16M4 10h16M4 14h16M4 18h16" size={13} color={C.textSecondary} />
            {activeViewName}
            {isDirty && <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.amber, flexShrink: 0 }} />}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={2}><path d="M19 9l-7 7-7-7" /></svg>
          </button>
          {showViewSel && <ViewSelector activeViewId={activeViewId} systemViews={systemViews} personalViews={personalViews} onSelect={applyView} onClose={() => setShowViewSel(false)} />}
        </div>

        {/* Active filter chips */}
        {activeFilters.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#e8f3fb', border: `1px solid #b8d8f0`, borderRadius: 5, padding: '4px 8px', fontSize: 12 }}>
            <span style={{ color: '#1a5a8a', fontWeight: 500 }}>{f.label}:</span>
            <span style={{ color: '#1a5a8a' }}>{f.value}</span>
            <button onClick={() => removeFilter(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#7eb3e8', lineHeight: 1, marginLeft: 2 }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        ))}

        {/* Sort chip */}
        {sortField && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#f0eeff', border: `1px solid #d0c8f8`, borderRadius: 5, padding: '4px 8px', fontSize: 12 }}>
            <span style={{ color: '#6d5ae0', fontWeight: 500 }}>Sort: {columns.find(c => c.field === sortField)?.label} {sortDir === 'asc' ? '↑' : '↓'}</span>
            <button onClick={() => { setSortField(null); setSortDir('asc'); setIsDirty(true); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#a78bfa' }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {/* Right side */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {totalAmount !== null && <span style={{ fontSize: 12, color: C.textSecondary }}>${Math.round(totalAmount / 1000)}K pipeline</span>}
          {totalUnits !== null && <span style={{ fontSize: 12, color: C.textMuted }}>{filtered.reduce((s, r) => s + (r.units || 0), 0).toLocaleString()} units</span>}
          <span style={{ fontSize: 12, color: C.textMuted }}>{filtered.length} records</span>

          <div style={{ position: 'relative' }}>
            <input placeholder="Search..." value={globalSearch} onChange={e => setGlobalSearch(e.target.value)}
              style={{ background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 9px 5px 27px', fontSize: 12, color: C.textPrimary, width: 160, outline: 'none' }} />
            <svg style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={2}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          </div>

          {(activeFilters.length > 0 || sortField) && (
            <button onClick={clearAll} style={{ background: 'none', border: 'none', fontSize: 12, color: C.textMuted, cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }}
              onMouseEnter={e => e.currentTarget.style.background = C.page}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              Clear all
            </button>
          )}

          {isDirty && (
            <button onClick={() => setShowSave(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: C.page, border: `1px solid ${C.emerald}`, borderRadius: 6, padding: '5px 12px', fontSize: 12, color: C.emerald, cursor: 'pointer', fontWeight: 600 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
              Save View
            </button>
          )}

          <button onClick={onNew} style={{ background: C.emerald, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}><path d="M12 5v14M5 12h14" /></svg>
            New {newLabel}
          </button>
        </div>
      </div>

      {/* Table + detail panel */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 24px 24px' }}>
          <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {columns.map(col => (
                    <SortableHeader key={col.field} col={col} sortField={sortField} sortDir={sortDir} onSort={handleSort}
                      activeFilters={activeFilters} onFilterApply={handleFilterApply} openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={columns.length} style={{ padding: '40px 20px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
                    {data.length === 0
                      ? <>No {newLabel ? newLabel.toLowerCase() + 's' : 'records'} yet. <span onClick={onNew} style={{ color: '#1a5a8a', cursor: 'pointer', textDecoration: 'underline' }}>Create one</span></>
                      : <>No records match the current filters. <span onClick={() => { clearAll(); setGlobalSearch('') }} style={{ color: '#1a5a8a', cursor: 'pointer', textDecoration: 'underline' }}>Clear filters</span></>
                    }
                  </td></tr>
                ) : filtered.map(r => (
                  <TableRow key={r.id} onClick={() => setSelectedRow(selectedRow?.id === r.id ? null : r)} onDoubleClick={() => onOpenRecord && onOpenRecord(r)} selected={selectedRow?.id === r.id}>
                    {columns.map(col => {
                      if (renderCell) {
                        const custom = renderCell(col, r);
                        if (custom !== null && custom !== undefined) return custom;
                      }
                      return defaultCell(col, r);
                    })}
                  </TableRow>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail panel */}
        {selectedRow && (
          <div style={{ width: 296, background: C.card, borderLeft: `1px solid ${C.border}`, padding: 20, overflowY: 'auto', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: C.textMuted, marginBottom: 4 }}>{selectedRow.id}</div>
                <div style={{ fontWeight: 600, fontSize: 13, color: C.textPrimary, lineHeight: 1.4 }}>{selectedRow.name}</div>
              </div>
              <button onClick={() => setSelectedRow(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 2, flexShrink: 0 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {(selectedRow.status || selectedRow.stage) && <div style={{ marginBottom: 14 }}><Badge s={selectedRow.status || selectedRow.stage} /></div>}

            {renderDetail ? renderDetail(selectedRow) : (
              <div>
                {columns.filter(c => !['id', 'name', 'status', 'stage'].includes(c.field)).map(col => {
                  const v = selectedRow[col.field];
                  const display = col.field === 'amount' ? `$${v ? Number(v).toLocaleString() : '0'}` : (v || '—');
                  return (
                    <div key={col.field} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${C.border}`, gap: 12 }}>
                      <span style={{ color: C.textMuted, fontSize: 12, flexShrink: 0 }}>{col.label}</span>
                      <span style={{ color: C.textPrimary, fontSize: 12, textAlign: 'right' }}>{display}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={() => onOpenRecord && onOpenRecord(selectedRow)} style={{ width: '100%', background: C.emerald, color: '#fff', border: 'none', borderRadius: 6, padding: 9, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Open Record</button>
              <button style={{ width: '100%', background: C.page, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 6, padding: 9, fontSize: 13, cursor: 'pointer' }}>Edit</button>
            </div>
          </div>
        )}
      </div>

      {showSave && <SaveViewModal activeFilters={activeFilters} sortField={sortField} sortDir={sortDir} cols={columns} onSave={handleSave} onClose={() => setShowSave(false)} />}
    </div>
  );
}
