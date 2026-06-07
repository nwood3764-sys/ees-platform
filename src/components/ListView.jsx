import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { C } from '../data/constants';
import { useIsMobile } from '../lib/useMediaQuery';
import { useSwipeToDismiss } from '../lib/useSwipeToDismiss';
import { usePullToRefresh } from '../lib/usePullToRefresh';
import { Badge, Icon, TableRow, ProgramTag } from './UI';
import {
  getEditableFieldsForTable,
  getPicklistOptions,
  searchLookupOptions,
  bulkUpdateRecords,
} from '../data/fieldMetadataService';
import {
  fetchSavedViewsForObject,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  getCurrentRoleId,
} from '../data/listViewsService';

// ── Column-width persistence ─────────────────────────────────────────────────
// Excel-style draggable column widths. Widths are stored per list under a
// stable localStorage key so a user's sizing survives reloads and navigation.
//
// Key derivation: callers may pass an explicit `storageKey`. When absent we
// build one from (tableName || defaultViewId) PLUS a short signature of the
// column field set. The signature guards against the case where two different
// lists share a defaultViewId code (e.g. AV-01 appears in several modules) —
// their column sets differ, so their keys differ, and their widths stay
// independent. No call-site changes required for any of the 8 modules.
const COLWIDTH_NS = 'ees.colwidths.';
const COL_MIN_WIDTH = 64;   // px — never let a column collapse below this
const COL_MAX_WIDTH = 900;  // px — sanity cap so a stray drag can't run away

function columnSignature(columns) {
  // Order-sensitive join of field names, hashed to a short stable token.
  const src = columns.map(c => c.field).join('|');
  let h = 0;
  for (let i = 0; i < src.length; i++) { h = (h * 31 + src.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}

function resolveStorageKey({ storageKey, tableName, defaultViewId, columns }) {
  if (storageKey) return COLWIDTH_NS + storageKey;
  const base = tableName || defaultViewId || 'list';
  return `${COLWIDTH_NS}${base}.${columnSignature(columns)}`;
}

function readStoredWidths(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch { return {}; }
}

function writeStoredWidths(key, widths) {
  try { localStorage.setItem(key, JSON.stringify(widths)); }
  catch { /* storage disabled / quota — widths simply won't persist */ }
}

function clampWidth(px) {
  return Math.max(COL_MIN_WIDTH, Math.min(COL_MAX_WIDTH, Math.round(px)));
}

// defaultColWidth — starting width (px) for a column that the user hasn't
// explicitly sized yet, used once the table is in fixed-layout mode. Tuned by
// field role and data type so unsized columns look reasonable rather than
// collapsing to equal slices. Authors can override per column via
// `col.defaultWidth`.
function defaultColWidth(col) {
  if (col.defaultWidth != null) return col.defaultWidth;
  if (col.field === 'id') return 120;
  if (col.field === 'name') return 240;
  if (col.field === 'status' || col.field === 'stage') return 200;
  if (col.field === 'program') return 160;
  if (col.field === 'email') return 200;
  if (col.field === 'amount' || col.field === 'units' || col.field === 'buildings') return 110;
  if (col.type === 'date') return 130;
  if (col.type === 'select') return 150;
  return 160;
}

// useColumnWidths — owns the per-field width map plus the drag interaction.
// Returns the width map (field → px), a getter, and a pointer-down handler to
// wire onto each resize grip. Pointer events (not mouse) so it works with
// trackpads and touch-capable laptops; capture-phase listeners on window so a
// fast drag that leaves the <th> doesn't drop the gesture.
function useColumnWidths({ enabled, storageKey, columns }) {
  const [widths, setWidths] = useState(() => (enabled ? readStoredWidths(storageKey) : {}));

  // Reset/reload when the target list changes (key changes) so we don't carry
  // one list's widths onto another that mounted into the same component slot.
  useEffect(() => {
    if (!enabled) return;
    setWidths(readStoredWidths(storageKey));
  }, [storageKey, enabled]);

  const dragRef = useRef(null); // { field, startX, startWidth }

  const onResizeStart = (field, e, currentWidth) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { field, startX: e.clientX, startWidth: currentWidth };

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const next = clampWidth(d.startWidth + (ev.clientX - d.startX));
      setWidths(prev => (prev[d.field] === next ? prev : { ...prev, [d.field]: next }));
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Persist on release using the freshest state.
      setWidths(prev => { writeStoredWidths(storageKey, prev); return prev; });
      if (d) {}
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // Double-click a grip to reset that one column to auto width.
  const resetColumn = (field) => {
    setWidths(prev => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      writeStoredWidths(storageKey, next);
      return next;
    });
  };

  return { widths, onResizeStart, resetColumn };
}

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
function SortableHeader({ col, sortField, sortDir, onSort, activeFilters, onFilterApply, openFilterCol, setOpenFilterCol, onResizeStart, onResizeReset, currentWidth }) {
  const isFiltered = activeFilters.some(f => f.field === col.field);
  const isSorted = sortField === col.field;
  const isOpen = openFilterCol === col.field;
  const [gripHover, setGripHover] = useState(false);

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
      {onResizeStart && (
        // Resize grip — sits on the column's right border. Drag to size,
        // double-click to reset this column to auto. 7px hit area for easy
        // grabbing; the visible 2px line only shows on hover/drag.
        <div
          onPointerDown={(e) => onResizeStart(col.field, e, currentWidth)}
          onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); onResizeReset && onResizeReset(col.field); }}
          onMouseEnter={() => setGripHover(true)}
          onMouseLeave={() => setGripHover(false)}
          title="Drag to resize · double-click to reset"
          style={{
            position: 'absolute', top: 0, right: -3, width: 7, height: '100%',
            cursor: 'col-resize', zIndex: 6, touchAction: 'none',
            display: 'flex', justifyContent: 'center',
          }}
        >
          <div style={{
            width: 2, height: '100%',
            background: gripHover ? C.emerald : 'transparent',
            transition: 'background 120ms',
          }} />
        </div>
      )}
    </th>
  );
}

// ── View Selector ────────────────────────────────────────────────────────────
// Lists system views and saved (persisted) views. When persistence is enabled
// (onEditView/onDeleteView/onSetDefault provided), each row exposes hover
// actions: set-default (star), edit, delete. A default view shows a filled
// star regardless of hover. System views are editable too when persistence is
// on — editing one persists an override carrying its __system_base id.
function ViewSelector({
  activeViewId, systemViews, personalViews, onSelect, onClose,
  onEditView, onDeleteView, onSetDefault, persistEnabled, triggerRect,
}) {
  const ref = useRef();
  const [hoverId, setHoverId] = useState(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // A saved view created by overriding a system view carries systemBase = that
  // system view's id. Hide the in-code system view when an override exists, so
  // it shows once (in Saved Views) rather than duplicated in both sections.
  const overriddenBaseIds = new Set(personalViews.map(v => v.systemBase).filter(Boolean));
  const visibleSystemViews = systemViews.filter(v => !overriddenBaseIds.has(v.id));

  const IconBtn = ({ title, onClick, children, danger }) => (
    <button title={title} onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ background: 'transparent', border: 'none', padding: 3, cursor: 'pointer',
               display: 'flex', alignItems: 'center', color: danger ? '#a32626' : C.textMuted, borderRadius: 4 }}
      onMouseEnter={e => e.currentTarget.style.background = C.page}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      {children}
    </button>
  );

  const Row = ({ v, editable }) => {
    const active = v.id === activeViewId;
    const hovered = hoverId === v.id;
    return (
      <div onClick={() => { onSelect(v); onClose(); }}
        onMouseEnter={() => setHoverId(v.id)}
        onMouseLeave={() => setHoverId(null)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 8px 14px',
                 cursor: 'pointer', background: active ? '#e8f8f2' : (hovered ? C.page : 'transparent') }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={active ? C.emerald : 'transparent'} strokeWidth={2.5}><polyline points="20 6 9 17 4 12" /></svg>
        <span style={{ flex: 1, fontSize: 13, color: active ? C.emerald : C.textPrimary, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {v.name}
        </span>
        {v.isDefault && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill={C.amber} stroke={C.amber} strokeWidth={1.5} title="Default view">
            <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9" />
          </svg>
        )}
        {persistEnabled && editable && hovered && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {!v.isDefault && (
              <IconBtn title="Set as default" onClick={() => onSetDefault(v)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9" /></svg>
              </IconBtn>
            )}
            <IconBtn title="Edit view" onClick={() => onEditView(v)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            </IconBtn>
            <IconBtn title="Delete view" danger onClick={() => onDeleteView(v)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
            </IconBtn>
          </div>
        )}
      </div>
    );
  };

  // Position via body portal so the dropdown escapes the toolbar's overflow
  // clip (which was cutting off the Saved Views section). Anchored to the
  // trigger's rect with a viewport-aware max-height so a long list scrolls
  // internally instead of running off-screen.
  const rect = triggerRect;
  const top = rect ? rect.bottom + 4 : 0;
  const left = rect ? rect.left : 0;
  const maxH = rect ? Math.max(180, window.innerHeight - rect.bottom - 16) : 380;

  const menu = (
    <div ref={ref} style={{
      position: 'fixed', top, left, zIndex: 4000,
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      boxShadow: '0 8px 28px rgba(7,17,31,0.22)', minWidth: 280,
      maxHeight: maxH, overflowY: 'auto', overflowX: 'hidden',
    }}>
      <div style={{ padding: '8px 0' }}>
        <div style={{ padding: '4px 14px 6px', fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>System Views</div>
        {visibleSystemViews.map(v => <Row key={v.id} v={v} editable={persistEnabled} />)}
        {personalViews.length > 0 && (
          <>
            <div style={{ height: 1, background: C.border, margin: '6px 0' }} />
            <div style={{ padding: '4px 14px 6px', fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Saved Views</div>
            {personalViews.map(v => <Row key={v.id} v={v} editable={persistEnabled} />)}
          </>
        )}
      </div>
    </div>
  );

  return createPortal(menu, document.body);
}

// ── Save View Modal ──────────────────────────────────────────────────────────
// Handles both "save current as new view" and editing an existing saved view.
// scope: 'personal' | 'role' | 'shared'. When persistence is off (no
// listObject), only the name is meaningful and onSave falls back to local.
function SaveViewModal({ activeFilters, sortField, sortDir, cols, onSave, onClose, editing, persistEnabled, hasRole }) {
  const [name, setName] = useState(editing?.name || '');
  const [scope, setScope] = useState(editing?.scope || 'personal');
  const [isDefault, setIsDefault] = useState(editing?.isDefault || false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const scopeOpts = [
    { id: 'personal', label: 'Only me' },
    ...(hasRole ? [{ id: 'role', label: 'My role' }] : []),
    { id: 'shared', label: 'Everyone' },
  ];

  const commit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true); setErr(null);
    try {
      await onSave({ name: name.trim(), scope, isDefault });
    } catch (e) {
      setErr(e.message || String(e));
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.card, borderRadius: 10, padding: 28, width: 420, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>{editing ? 'Edit List View' : 'Save List View'}</div>
        <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 20 }}>
          {editing ? 'Update this view with the current filters, sort, and column widths.' : 'Save your current filters, sort, and column widths as a named view.'}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 5 }}>View Name</div>
          <input value={name} autoFocus onChange={e => setName(e.target.value)} placeholder="e.g. My WI Work Orders"
            onKeyDown={e => { if (e.key === 'Enter') commit(); }}
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

        {persistEnabled && (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6 }}>Visible to</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {scopeOpts.map(o => (
                  <button key={o.id} onClick={() => setScope(o.id)}
                    style={{ flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                             background: scope === o.id ? '#e8f8f2' : C.page,
                             border: `1px solid ${scope === o.id ? C.emerald : C.border}`,
                             color: scope === o.id ? '#1a7a4e' : C.textSecondary }}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div onClick={() => setIsDefault(!isDefault)} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22, cursor: 'pointer' }}>
              <div style={{ width: 36, height: 20, borderRadius: 10, background: isDefault ? C.emerald : C.borderDark, position: 'relative', transition: 'background 0.2s' }}>
                <div style={{ position: 'absolute', top: 3, left: isDefault ? 18 : 3, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
              </div>
              <span style={{ fontSize: 13, color: C.textSecondary }}>Make this my default view</span>
            </div>
          </>
        )}

        {err && <div style={{ background: '#fde8e8', color: '#a32626', fontSize: 12, padding: '8px 10px', borderRadius: 6, marginBottom: 14 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={commit} disabled={!name.trim() || saving}
            style={{ flex: 1, background: (name.trim() && !saving) ? C.emerald : C.borderDark, color: '#fff', border: 'none', borderRadius: 6, padding: 10, fontSize: 13, fontWeight: 600, cursor: (name.trim() && !saving) ? 'pointer' : 'default' }}>
            {saving ? 'Saving…' : (editing ? 'Save Changes' : 'Save View')}
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
// Opt-in edit features (Salesforce-style):
//   tableName        — when provided, enables row checkboxes, inline cell
//                      edit via double-click, and the bulk-edit toolbar.
//                      The string is the LEAP table to write back to via
//                      the bulk_update_records RPC. When omitted, the
//                      ListView renders exactly as it did before — pure
//                      read-only, all existing call sites unchanged.
//   onRecordsUpdated — fires after any successful inline or bulk edit
//                      with the RPC summary. Parent should reload its
//                      data on this callback so the table reflects the
//                      new server state.
export function ListView({
  data: dataProp,
  columns: columnsProp,
  systemViews: systemViewsProp,
  defaultViewId, newLabel,
  renderCell, renderDetail, onNew, onOpenRecord, onRefresh,
  tableName, onRecordsUpdated, storageKey,
  listObject, listModule,
}) {
  // ── Defensive defaults ─────────────────────────────────────────────────
  // The original signature treated systemViews and data as required arrays.
  // Forgetting either at a call site produced the most painful failure
  // mode possible: a white screen with `Cannot read properties of
  // undefined (reading 'find')` from the firstView line, because there's
  // no boundary to catch a top-level render throw.
  //
  // Production telemetry from /m/tasks (see client_errors rows from
  // 26-May) showed exactly this failure: TasksModule was passing
  // `rows`/`rowKey`/`onRowClick` (an older API shape), so systemViews
  // arrived undefined and the page crashed before mounting anything.
  //
  // Treating these as optional with safe defaults means a misuse
  // renders an empty-state instead of crashing the whole module.
  // The call site still needs to be fixed to show real data, but the
  // user sees an empty table, not a broken module.
  const data        = Array.isArray(dataProp) ? dataProp : []
  const columns     = Array.isArray(columnsProp) ? columnsProp : []
  const systemViews = Array.isArray(systemViewsProp) && systemViewsProp.length > 0
    ? systemViewsProp
    : [{ id: '__default__', name: 'All', filters: [], sortField: null, sortDir: 'asc' }]

  const editMode = Boolean(tableName)
  const firstView = systemViews.find(v => v.id === defaultViewId) || systemViews[0]
  const isMobile = useIsMobile()

  // Excel-style adjustable column widths. Desktop only — the mobile view is a
  // card list with no columns to size. Key is stable per list (see
  // resolveStorageKey) so each object's widths persist independently.
  const colWidthKey = useMemo(
    () => resolveStorageKey({ storageKey, tableName, defaultViewId, columns }),
    [storageKey, tableName, defaultViewId, columns]
  );
  const { widths: colWidths, onResizeStart, resetColumn } = useColumnWidths({
    enabled: !isMobile,
    storageKey: colWidthKey,
    columns,
  });
  // Once the user has sized any column, the table switches to fixed layout so
  // those widths are authoritative and header/body cells stay locked together.
  const hasCustomWidths = Object.keys(colWidths).length > 0;

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
  const [viewSelRect, setViewSelRect] = useState(null);
  const [showSave, setShowSave] = useState(false);
  const [personalViews, setPersonalViews] = useState([]);
  // ── Saved-view persistence (active when listObject or tableName present) ──
  // persistObject is the object key under which views are stored/loaded. When
  // absent, the selector keeps the prior local-only behavior so nothing breaks.
  const persistObject = listObject || tableName || null;
  const persistEnabled = Boolean(persistObject);
  const [hasRole, setHasRole] = useState(false);
  const [editingView, setEditingView] = useState(null); // saved view being edited, or null
  const [defaultViewOverride, setDefaultViewOverride] = useState(null); // persisted default id
  const [globalSearch, setGlobalSearch] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  // Mobile-only: whether the expandable search input is shown. Tap the search
  // icon in the mobile toolbar to toggle. Desktop always shows the search box.
  const [showSearchMobile, setShowSearchMobile] = useState(false);
  // Mobile-only: whether the filter bottom sheet is open.
  const [showFilterSheet, setShowFilterSheet] = useState(false);

  // ── Edit mode state (active only when tableName is provided) ────────────
  // fieldMeta: Map<columnName, meta> built from describe_object_columns
  // Selected row uuids (keyed by row._id; falls back to row.id for legacy
  // call sites that don't surface an _id).
  // editingCell: { rowId, columnName } | null
  // savingCell:  { rowId, columnName } | null  (cell is mid-RPC)
  // editError:   { rowId, columnName, message } | null
  // overlay:     Map<`${rowId}::${columnName}`, value>  optimistic-write
  //              cache. Cleared whenever the parent reloads `data`.
  const [fieldMeta, setFieldMeta]       = useState(null);
  const [fieldMetaErr, setFieldMetaErr] = useState(null);
  const [selected, setSelected]         = useState(() => new Set());
  const [editingCell, setEditingCell]   = useState(null);
  const [savingCell, setSavingCell]     = useState(null);
  const [editError, setEditError]       = useState(null);
  const [overlay, setOverlay]           = useState(new Map());
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);

  // Load field metadata once per tableName. Stays null in non-edit mode.
  useEffect(() => {
    if (!editMode) return;
    let cancelled = false;
    setFieldMeta(null); setFieldMetaErr(null);
    getEditableFieldsForTable(tableName)
      .then(rows => {
        if (cancelled) return;
        setFieldMeta(new Map(rows.map(r => [r.columnName, r])));
      })
      .catch(e => { if (!cancelled) setFieldMetaErr(e); });
    return () => { cancelled = true; };
  }, [tableName, editMode]);

  // Drop stale overlay entries when parent reloads data.
  useEffect(() => { if (editMode) setOverlay(new Map()); }, [data, editMode]);

  // Load persisted saved views for this object. Runs when persistObject is
  // known. Applies a persisted default view on first load if one exists and
  // the user hasn't already navigated/dirtied the view.
  const reloadSavedViews = async () => {
    if (!persistObject) return;
    try {
      const views = await fetchSavedViewsForObject(persistObject);
      setPersonalViews(views);
      const def = views.find(v => v.isDefault);
      if (def) setDefaultViewOverride(def.id);
      return views;
    } catch {
      // Non-fatal: a failure to load saved views must not blank the list or
      // crash the selector — the user still gets system views.
      return [];
    }
  };
  useEffect(() => {
    let cancelled = false;
    if (!persistObject) { setPersonalViews([]); return; }
    (async () => {
      const views = await fetchSavedViewsForObject(persistObject).catch(() => []);
      if (cancelled) return;
      // Strictly additive: populate the selector only. We deliberately do NOT
      // auto-apply a default view's filters/sort on mount — doing so mutates
      // the active filter/sort state during initial render, which risks
      // interfering with the list's own data load. The default is surfaced as
      // a star in the selector; the user applies it by clicking. This keeps the
      // saved-views layer incapable of affecting which rows render on load.
      setPersonalViews(views);
      const def = views.find(v => v.isDefault);
      if (def) setDefaultViewOverride(def.id);
      getCurrentRoleId().then(rid => { if (!cancelled) setHasRole(Boolean(rid)); }).catch(() => {});
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistObject]);

  // Save: when persistence is enabled, write to saved_list_views and reload;
  // otherwise fall back to the prior local-only behavior. `editingView` set =>
  // update that view; else create new. Visible columns currently captured as
  // null (column-set selection is a follow-up); column WIDTHS persist
  // separately via localStorage.
  const handleSave = async ({ name, scope, isDefault }) => {
    if (!persistEnabled) {
      const v = { id: 'pv' + Date.now(), name, filters: [...activeFilters], sortField, sortDir };
      setPersonalViews(prev => [...prev, v]);
      setActiveViewId(v.id);
      setIsDirty(false); setShowSave(false); setEditingView(null);
      return;
    }
    const common = {
      name, scope: scope || 'personal', isDefault: !!isDefault,
      object: persistObject, module: listModule || persistObject,
      filters: [...activeFilters], sortField, sortDir,
      // Preserve a system view's origin id when editing one, so the selector
      // can overlay the saved version on the in-code constant.
      systemBase: editingView?.systemBase || (editingView && !editingView._persisted ? editingView.id : null),
    };
    if (editingView && editingView._persisted) {
      await updateSavedView(editingView.id, common);
    } else {
      const newId = await createSavedView(common);
      setActiveViewId(newId);
    }
    await reloadSavedViews();
    setIsDirty(false); setShowSave(false); setEditingView(null);
  };

  const handleEditView = (v) => {
    // Load the view's settings into the working state, then open the modal in
    // edit mode so Save Changes re-persists with any tweaks.
    setActiveViewId(v.id);
    setActiveFilters(v.filters || []);
    setSortField(v.sortField || null);
    setSortDir(v.sortDir || 'asc');
    setEditingView(v);
    setShowSave(true);
    setShowViewSel(false);
  };

  const handleDeleteView = async (v) => {
    if (!v._persisted) { setPersonalViews(prev => prev.filter(x => x.id !== v.id)); return; }
    await deleteSavedView(v.id);
    if (activeViewId === v.id) clearAll();
    await reloadSavedViews();
  };

  const handleSetDefault = async (v) => {
    if (!persistEnabled) return;
    if (v._persisted) {
      await updateSavedView(v.id, { isDefault: true, object: persistObject });
    } else {
      // Setting a system view as default persists an override row for it.
      await createSavedView({
        name: v.name, scope: 'personal', isDefault: true,
        object: persistObject, module: listModule || persistObject,
        filters: v.filters || [], sortField: v.sortField || null, sortDir: v.sortDir || 'asc',
        systemBase: v.id,
      });
    }
    await reloadSavedViews();
  };

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

  // Toggle the view selector, capturing the trigger's screen rect so the
  // portal'd dropdown can anchor to it (escapes toolbar overflow clipping).
  const toggleViewSel = (e) => {
    const btn = e.currentTarget.closest('button') || e.currentTarget;
    setViewSelRect(btn.getBoundingClientRect());
    setShowViewSel(v => !v);
  };

  // ── Selection helpers (edit mode only) ──────────────────────────────────
  // We key on row._id (the underlying uuid) and fall back to row.id since
  // some legacy data shapes only have id. The bulk_update_records RPC
  // requires a real uuid — rows without _id can't be selected at all.
  const rowKey = (r) => r._id || (typeof r.id === 'string' && r.id.length === 36 ? r.id : null);
  const toggleRow = (r) => {
    const k = rowKey(r); if (!k) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const toggleAllVisible = (visibleRows) => {
    const keys = visibleRows.map(rowKey).filter(Boolean);
    setSelected(prev => {
      const allSelected = keys.length > 0 && keys.every(k => prev.has(k));
      const next = new Set(prev);
      if (allSelected) { for (const k of keys) next.delete(k); }
      else             { for (const k of keys) next.add(k); }
      return next;
    });
  };

  // ── Inline cell save (edit mode only) ───────────────────────────────────
  //
  // Single-cell saves are intentionally LOCAL-ONLY for performance. When
  // a single cell saves successfully the new value lives in the
  // `overlay` map indefinitely for the lifetime of this list mount — we
  // do NOT call onRecordsUpdated, which would force the parent to
  // re-fetch the entire dataset (6,781 properties + counts + batches
  // takes seconds). The next time the user navigates away and back, or
  // pulls to refresh, the parent reloads naturally and the overlay
  // gets discarded.
  //
  // Bulk edits DO trigger onRecordsUpdated because they touch enough
  // rows that the parent's source-of-truth view (counts, related
  // derivations, etc.) is worth refreshing.
  const saveSingleCell = async (rowId, columnName, newValue) => {
    setSavingCell({ rowId, columnName });
    setEditError(null);
    try {
      const result = await bulkUpdateRecords(tableName, [rowId], { [columnName]: newValue });
      if (result.records_errored > 0) {
        const msg = (result.errors?.[0]?.error) || 'Update failed';
        setEditError({ rowId, columnName, message: msg });
        return;
      }
      // Persist the new value in the local overlay. This is the
      // authoritative display until the parent reloads on its own.
      setOverlay(prev => {
        const next = new Map(prev);
        next.set(`${rowId}::${columnName}`, newValue);
        return next;
      });
      setEditingCell(null);
      // NOTE: deliberately do NOT call onRecordsUpdated here. See block
      // comment above. Bulk edits (BulkEditModal) still fire it.
    } catch (e) {
      setEditError({ rowId, columnName, message: e.message || String(e) });
    } finally {
      setSavingCell(null);
    }
  };

  // Returns the value to display for (row, col) — honoring optimistic
  // overlay first. Used both for the cell's read state and as the seed
  // value when the user starts editing.
  const overlayValue = (rowId, columnName) => {
    const k = `${rowId}::${columnName}`;
    return overlay.has(k) ? overlay.get(k) : undefined;
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

  // Render-time row cap. Filtering + sorting still run across the full
  // dataset above, but only the first `renderLimit` rows actually mount.
  // 200 is a comfortable scroll buffer for screens. The toolbar shows
  // "Showing X of Y; load more" when the cap is hit.
  const [renderLimit, setRenderLimit] = useState(200);
  useEffect(() => { setRenderLimit(200); }, [activeFilters, sortField, sortDir, globalSearch, activeViewId]);
  const visibleRows = useMemo(() => filtered.slice(0, renderLimit), [filtered, renderLimit]);

  const activeViewName = [...systemViews, ...personalViews].find(v => v.id === activeViewId)?.name || systemViews[0]?.name;



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
              <button onClick={toggleViewSel}
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
              {showViewSel && <ViewSelector activeViewId={activeViewId} systemViews={systemViews} personalViews={personalViews} onSelect={applyView} onClose={() => setShowViewSel(false)} persistEnabled={persistEnabled} onEditView={handleEditView} onDeleteView={handleDeleteView} onSetDefault={handleSetDefault} triggerRect={viewSelRect} />}
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
              {visibleRows.map(r => {
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

        {showSave && <SaveViewModal activeFilters={activeFilters} sortField={sortField} sortDir={sortDir} cols={columns} onSave={handleSave} onClose={() => { setShowSave(false); setEditingView(null); }} editing={editingView} persistEnabled={persistEnabled} hasRole={hasRole} />}
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
          <button onClick={toggleViewSel}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 13, color: C.textPrimary, cursor: 'pointer', fontWeight: 500 }}>
            <Icon path="M4 6h16M4 10h16M4 14h16M4 18h16" size={13} color={C.textSecondary} />
            {activeViewName}
            {isDirty && <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.amber, flexShrink: 0 }} />}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={2}><path d="M19 9l-7 7-7-7" /></svg>
          </button>
          {showViewSel && <ViewSelector activeViewId={activeViewId} systemViews={systemViews} personalViews={personalViews} onSelect={applyView} onClose={() => setShowViewSel(false)} persistEnabled={persistEnabled} onEditView={handleEditView} onDeleteView={handleDeleteView} onSetDefault={handleSetDefault} triggerRect={viewSelRect} />}
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

      {/* Bulk-edit toolbar (edit mode only, shown when 1+ rows selected) */}
      {editMode && selected.size > 0 && (
        <div style={{
          padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 12,
          background: '#e8f8f2', borderBottom: '1px solid #2aab72',
        }}>
          <div style={{ fontSize: 12.5, color: '#1a7a4e', fontWeight: 600 }}>
            {selected.size.toLocaleString()} selected
          </div>
          <button onClick={() => setBulkPanelOpen(true)}
            style={{ padding: '6px 14px', fontSize: 12.5, fontWeight: 600,
                     background: '#3ecf8e', border: '1px solid #2aab72', borderRadius: 6,
                     color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon path="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" size={13} color="#fff" />
            Edit selected
          </button>
          <button onClick={() => setSelected(new Set())}
            style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 500,
                     background: 'transparent', border: '1px solid #2aab72', borderRadius: 6,
                     color: '#1a7a4e', cursor: 'pointer' }}>
            Clear selection
          </button>
          {fieldMetaErr && (
            <div style={{ fontSize: 11.5, color: '#a32626', marginLeft: 'auto' }}>
              Field metadata failed to load: {fieldMetaErr.message}
            </div>
          )}
        </div>
      )}

      {/* Table + detail panel */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 24px 24px' }}>
          <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, overflow: 'auto' }}>
            <table data-colfixed={hasCustomWidths ? '1' : '0'} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: hasCustomWidths ? 'fixed' : 'auto' }}>
              <colgroup>
                {editMode && <col style={{ width: 36 }} />}
                {columns.map(col => {
                  const w = colWidths[col.field];
                  // Sized columns get their explicit px. Once ANY column is
                  // sized the table switches to fixed layout, so unsized
                  // columns need a width too — fall back to a type-based
                  // default so they don't all collapse to equal slices.
                  const colW = w != null ? w : (hasCustomWidths ? defaultColWidth(col) : undefined);
                  return <col key={col.field} style={colW != null ? { width: colW } : undefined} />;
                })}
              </colgroup>
              <thead>
                <tr>
                  {editMode && (
                    <th style={{
                      width: 36, padding: '9px 0 9px 14px',
                      borderBottom: `1px solid ${C.border}`,
                      background: C.card, position: 'sticky', top: 0, zIndex: 4,
                    }}>
                      <ListCheckbox
                        checked={filtered.length > 0 && filtered.every(r => selected.has(rowKey(r)))}
                        indeterminate={
                          filtered.some(r => selected.has(rowKey(r))) &&
                          !filtered.every(r => selected.has(rowKey(r)))
                        }
                        onChange={() => toggleAllVisible(filtered)}
                      />
                    </th>
                  )}
                  {columns.map(col => (
                    <SortableHeader key={col.field} col={col} sortField={sortField} sortDir={sortDir} onSort={handleSort}
                      activeFilters={activeFilters} onFilterApply={handleFilterApply} openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol}
                      onResizeStart={onResizeStart} onResizeReset={resetColumn}
                      currentWidth={colWidths[col.field] != null ? colWidths[col.field] : defaultColWidth(col)} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={columns.length + (editMode ? 1 : 0)} style={{ padding: '40px 20px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
                    {data.length === 0
                      ? <>No {newLabel ? newLabel.toLowerCase() + 's' : 'records'} yet. <span onClick={onNew} style={{ color: '#1a5a8a', cursor: 'pointer', textDecoration: 'underline' }}>Create one</span></>
                      : <>No records match the current filters. <span onClick={() => { clearAll(); setGlobalSearch('') }} style={{ color: '#1a5a8a', cursor: 'pointer', textDecoration: 'underline' }}>Clear filters</span></>
                    }
                  </td></tr>
                ) : visibleRows.map(r => {
                  const key = rowKey(r);
                  const isSelected = key && selected.has(key);
                  return (
                    <TableRow key={r.id}
                              onClick={() => setSelectedRow(selectedRow?.id === r.id ? null : r)}
                              onDoubleClick={() => onOpenRecord && onOpenRecord(r)}
                              selected={selectedRow?.id === r.id || isSelected}>
                      {editMode && (
                        <td style={{
                          width: 36, padding: '11px 0 11px 14px',
                          borderBottom: `1px solid ${C.border}`,
                          background: isSelected ? '#f0faf6' : undefined,
                        }} onClick={(e) => { e.stopPropagation(); toggleRow(r); }}>
                          <ListCheckbox checked={isSelected} onChange={() => toggleRow(r)} />
                        </td>
                      )}
                      {columns.map(col => {
                        // Edit-mode wrapping: when this column is editable on
                        // the underlying table, replace the cell with an
                        // EditableCell that intercepts double-click.
                        if (editMode && key) {
                          const columnName = col.columnName;
                          const meta       = columnName ? fieldMeta?.get(columnName) : null;
                          const cellEditable = col.editable !== false && columnName && meta?.isEditable === true;
                          const isEditing = editingCell?.rowId === key && editingCell?.columnName === columnName;
                          const isSaving  = savingCell?.rowId  === key && savingCell?.columnName  === columnName;
                          const errorHere = editError?.rowId   === key && editError?.columnName   === columnName
                                              ? editError.message : null;
                          if (cellEditable || isSaving || errorHere) {
                            const ov = overlayValue(key, columnName);
                            // Render the underlying-display cell with a wrapper
                            // <td> that handles double-click + error display.
                            const baseCell = (renderCell ? renderCell(col, r) : null) || defaultCell(col, r);
                            return (
                              <EditableCellTd
                                key={col.field}
                                col={col} row={r} columnName={columnName} meta={meta}
                                baseCell={baseCell}
                                isEditing={isEditing} isSaving={isSaving} errorHere={errorHere}
                                overlayVal={ov}
                                onStartEdit={() => { setEditingCell({ rowId: key, columnName }); setEditError(null); }}
                                onCancel={() => { setEditingCell(null); setEditError(null); }}
                                onSave={(newValue) => saveSingleCell(key, columnName, newValue)}
                              />
                            );
                          }
                          // Non-editable in edit mode → fall through to default
                        }
                        if (renderCell) {
                          const custom = renderCell(col, r);
                          if (custom !== null && custom !== undefined) return custom;
                        }
                        return defaultCell(col, r);
                      })}
                    </TableRow>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > visibleRows.length && (
              <div style={{
                padding: '12px 14px',
                borderTop: `1px solid ${C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                fontSize: 12, color: C.textSecondary, background: C.card,
              }}>
                <span>
                  Showing <b>{visibleRows.length.toLocaleString()}</b> of {filtered.length.toLocaleString()} records
                </span>
                <button onClick={() => setRenderLimit(n => n + 500)}
                  style={{
                    padding: '5px 12px', fontSize: 12, fontWeight: 600,
                    background: C.page, border: `1px solid ${C.border}`, borderRadius: 5,
                    color: C.textPrimary, cursor: 'pointer',
                  }}>
                  Load 500 more
                </button>
                <button onClick={() => setRenderLimit(filtered.length)}
                  style={{
                    padding: '5px 12px', fontSize: 12, fontWeight: 600,
                    background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 5,
                    color: C.textSecondary, cursor: 'pointer',
                  }}>
                  Show all {filtered.length.toLocaleString()}
                </button>
              </div>
            )}
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

      {showSave && <SaveViewModal activeFilters={activeFilters} sortField={sortField} sortDir={sortDir} cols={columns} onSave={handleSave} onClose={() => { setShowSave(false); setEditingView(null); }} editing={editingView} persistEnabled={persistEnabled} hasRole={hasRole} />}
      {editMode && bulkPanelOpen && (
        <BulkEditModal
          tableName={tableName}
          fieldMeta={fieldMeta}
          columns={columns}
          recordIds={[...selected]}
          onClose={() => setBulkPanelOpen(false)}
          onApplied={(summary) => {
            setBulkPanelOpen(false);
            setSelected(new Set());
            if (onRecordsUpdated) onRecordsUpdated(summary);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit-mode helpers (active only when ListView gets a `tableName` prop)
// ─────────────────────────────────────────────────────────────────────────────

function ListCheckbox({ checked, indeterminate, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={!!checked}
      onChange={(e) => { e.stopPropagation(); onChange?.(); }}
      onClick={(e) => e.stopPropagation()}
      style={{ cursor: 'pointer', width: 14, height: 14, accentColor: '#3ecf8e' }}
    />
  );
}

// EditableCellTd wraps a single <td> for an edit-mode-eligible column.
// In view state it renders the existing `baseCell` (the result of the
// caller's renderCell or the ListView's defaultCell). On double-click it
// flips into edit state, replacing the cell contents with the right
// editor for the field's data type.
function EditableCellTd({ col, row, columnName, meta, baseCell, isEditing, isSaving, errorHere, overlayVal, onStartEdit, onCancel, onSave }) {
  // If we have an overlay value (just-saved) and the baseCell hasn't
  // caught up yet (parent hasn't reloaded), render a small chip over the
  // baseCell instead so the user sees the new value immediately.
  if (isEditing) {
    return (
      <td style={{
        padding: 0,
        borderBottom: `1px solid ${C.border}`,
        background: '#f0faf6',
        position: 'relative',
      }}>
        <div style={{ padding: '4px 6px' }}>
          <CellEditor
            meta={meta}
            initialValue={overlayVal !== undefined ? overlayVal : row[col.field]}
            onCancel={onCancel}
            onSave={onSave}
          />
        </div>
      </td>
    );
  }

  return (
    <td style={{
      padding: 0,
      borderBottom: `1px solid ${C.border}`,
      cursor: 'cell',
      position: 'relative',
      background: errorHere ? '#fde8e8' : (overlayVal !== undefined ? '#f0faf6' : undefined),
    }}
        onDoubleClick={(e) => { e.stopPropagation(); if (!isSaving) onStartEdit(); }}
        title="Double-click to edit">
      {isSaving ? (
        <div style={{ padding: '11px 12px', color: C.textMuted, fontStyle: 'italic', fontSize: 12 }}>Saving…</div>
      ) : (
        // Render the baseCell contents inline. baseCell is already a <td>
        // produced by defaultCell/renderCell — we strip its outer td by
        // rendering its `children` inside this td instead. React lets us
        // grab .props.children directly on the element.
        <div style={{ padding: '11px 12px', fontSize: 12, color: C.textPrimary }}>
          {(baseCell?.props?.children !== undefined) ? baseCell.props.children : baseCell}
        </div>
      )}
      {errorHere && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 10,
          background: '#a32626', color: '#fff', fontSize: 11,
          padding: '4px 8px', borderRadius: '0 0 4px 4px', maxWidth: 280,
        }}>{errorHere}</div>
      )}
    </td>
  );
}

// CellEditor: the in-place input for whatever type the field is.
function CellEditor({ meta, initialValue, onSave, onCancel }) {
  const [value, setValue] = useState(initialValue ?? '');
  const editorType = meta?.editorType || 'text';

  const commit = () => {
    let toSend = value;
    if (editorType === 'number' && value !== '' && value !== null) {
      const n = Number(value);
      if (Number.isNaN(n)) { onCancel(); return; }
      toSend = n;
    }
    if (value === '' || value === null) toSend = null;
    onSave(toSend);
  };
  const onKey = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };

  if (editorType === 'boolean') {
    return (
      <select autoFocus value={String(value ?? '')} onBlur={commit} onKeyDown={onKey}
        onChange={(e) => setValue(e.target.value === 'true')}
        style={inlineEditorStyle}>
        <option value="">—</option><option value="true">Yes</option><option value="false">No</option>
      </select>
    );
  }
  if (editorType === 'picklist' && meta?.picklistObject && meta?.picklistField) {
    return <PicklistInlineEditor meta={meta} value={value} setValue={setValue} commit={commit} onCancel={onCancel} />;
  }
  if (editorType === 'lookup' && meta?.referencesTable) {
    return <LookupInlineEditor meta={meta} value={value} setValue={setValue} commit={commit} onCancel={onCancel} />;
  }
  if (editorType === 'date') {
    return <input autoFocus type="date" value={value || ''} onChange={(e) => setValue(e.target.value)}
                  onBlur={commit} onKeyDown={onKey} style={inlineEditorStyle} />;
  }
  if (editorType === 'datetime') {
    return <input autoFocus type="datetime-local" value={(value || '').slice(0,16)}
                  onChange={(e) => setValue(e.target.value)} onBlur={commit} onKeyDown={onKey} style={inlineEditorStyle} />;
  }
  if (editorType === 'number') {
    return <input autoFocus type="number" value={value ?? ''} onChange={(e) => setValue(e.target.value)}
                  onBlur={commit} onKeyDown={onKey} style={inlineEditorStyle} />;
  }
  return <input autoFocus type="text" value={value ?? ''} onChange={(e) => setValue(e.target.value)}
                onBlur={commit} onKeyDown={onKey} style={inlineEditorStyle} />;
}

function PicklistInlineEditor({ meta, value, setValue, commit, onCancel }) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    getPicklistOptions(meta.picklistObject, meta.picklistField)
      .then(o => { if (!cancelled) { setOptions(o); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [meta.picklistObject, meta.picklistField]);
  return (
    <select autoFocus value={value || ''} onBlur={commit}
      onChange={(e) => setValue(e.target.value || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter')  { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      style={inlineEditorStyle}>
      <option value="">—</option>
      {loading && <option disabled>Loading…</option>}
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}

function LookupInlineEditor({ meta, value, setValue, commit, onCancel }) {
  const [query, setQuery]     = useState('');
  const [options, setOptions] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => {
      searchLookupOptions(meta.referencesTable, query, { limit: 20 })
        .then(setOptions).catch(() => setOptions([]));
    }, 180);
    return () => clearTimeout(t);
  }, [query, meta.referencesTable]);
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input autoFocus type="text" value={query}
        placeholder={`Search ${meta.referencesTable}…`}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          if (e.key === 'Enter' && options[0]) {
            e.preventDefault();
            setValue(options[0].id);
            setTimeout(() => commit(), 0);
          }
        }}
        style={inlineEditorStyle}
      />
      {options.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
          maxHeight: 200, overflowY: 'auto', boxShadow: '0 6px 18px rgba(7,17,31,0.2)',
        }}>
          {options.map(o => (
            <div key={o.id}
                 onMouseDown={(e) => { e.preventDefault(); setValue(o.id); setTimeout(() => commit(), 0); }}
                 style={{ padding: '7px 10px', fontSize: 12, cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BulkEditModal({ tableName, fieldMeta, columns, recordIds, onClose, onApplied }) {
  const editableFields = useMemo(() => {
    if (!fieldMeta) return [];
    const out = [];
    for (const [columnName, meta] of fieldMeta.entries()) {
      if (!meta.isEditable) continue;
      const colDescriptor = columns.find(c => c.columnName === columnName);
      out.push({ columnName, label: colDescriptor?.label || prettifyColumnName(columnName), meta });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [fieldMeta, columns]);

  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [working, setWorking] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState(null);
  const selectedMeta = field ? fieldMeta.get(field) : null;

  const apply = async () => {
    if (!field) return;
    setWorking(true); setError(null); setResult(null);
    try {
      const sendValue = value === '' || value === null ? null
                       : selectedMeta?.editorType === 'number'  ? Number(value)
                       : selectedMeta?.editorType === 'boolean' ? (value === 'true')
                       : value;
      const summary = await bulkUpdateRecords(tableName, recordIds, { [field]: sendValue });
      setResult(summary);
      if (summary.records_errored === 0 && onApplied) onApplied(summary);
    } catch (e) {
      setError(e.message || String(e));
    } finally { setWorking(false); }
  };

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(7,17,31,0.55)', zIndex: 9000,
               display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: C.card, borderRadius: 10, width: 'min(560px, 100%)', maxHeight: '90vh',
                 display: 'flex', flexDirection: 'column', overflow: 'hidden',
                 boxShadow: '0 12px 40px rgba(7,17,31,0.4)' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>
            Edit field across {recordIds.length.toLocaleString()} record{recordIds.length === 1 ? '' : 's'}
          </div>
          <button onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: '14px 18px', overflowY: 'auto', flex: 1 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={bulkLabel}>Field</label>
            <select value={field} onChange={(e) => { setField(e.target.value); setValue(''); }} style={bulkInput}>
              <option value="">— Select a field —</option>
              {editableFields.map(f => (
                <option key={f.columnName} value={f.columnName}>{f.label} ({f.meta.editorType})</option>
              ))}
            </select>
          </div>
          {field && (
            <div style={{ marginBottom: 12 }}>
              <label style={bulkLabel}>New value</label>
              <BulkValueEditor meta={selectedMeta} value={value} setValue={setValue} />
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                Leave blank to clear the field on all selected records.
              </div>
            </div>
          )}
          {error && (
            <div style={{ padding: '10px 12px', background: '#fde8e8', color: '#a32626', fontSize: 12, borderRadius: 6, marginBottom: 12 }}>
              {error}
            </div>
          )}
          {result && (
            <div style={{ padding: '12px 14px',
                          background: result.records_errored > 0 ? '#fef3e7' : '#e8f8f2',
                          color:      result.records_errored > 0 ? '#a35a18' : '#1a7a4e',
                          fontSize: 12.5, borderRadius: 6, marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {result.records_updated} updated, {result.records_errored} errored, of {result.records_total} total
              </div>
              {Array.isArray(result.errors) && result.errors.length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                    {result.errors.length} error{result.errors.length === 1 ? '' : 's'}
                  </summary>
                  <pre style={{ fontSize: 10.5, fontFamily: 'JetBrains Mono, monospace', marginTop: 6, whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto' }}>
                    {JSON.stringify(result.errors, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}`,
                      display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={bulkSecondaryBtn}>Close</button>
          <button onClick={apply} disabled={!field || working}
            style={{ ...bulkPrimaryBtn,
                     background: (!field || working) ? C.border : '#3ecf8e',
                     cursor: (!field || working) ? 'not-allowed' : 'pointer' }}>
            {working ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkValueEditor({ meta, value, setValue }) {
  if (!meta) return null;
  if (meta.editorType === 'boolean') {
    return (
      <select value={value} onChange={(e) => setValue(e.target.value)} style={bulkInput}>
        <option value="">—</option><option value="true">Yes</option><option value="false">No</option>
      </select>
    );
  }
  if (meta.editorType === 'picklist') return <BulkPicklist meta={meta} value={value} setValue={setValue} />;
  if (meta.editorType === 'lookup')   return <BulkLookup meta={meta} value={value} setValue={setValue} />;
  if (meta.editorType === 'date')     return <input type="date" value={value} onChange={(e) => setValue(e.target.value)} style={bulkInput} />;
  if (meta.editorType === 'datetime') return <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} style={bulkInput} />;
  if (meta.editorType === 'number')   return <input type="number" value={value} onChange={(e) => setValue(e.target.value)} style={bulkInput} />;
  return <input type="text" value={value} onChange={(e) => setValue(e.target.value)} style={bulkInput} />;
}

function BulkPicklist({ meta, value, setValue }) {
  const [options, setOptions] = useState([]);
  useEffect(() => {
    getPicklistOptions(meta.picklistObject, meta.picklistField).then(setOptions).catch(() => setOptions([]));
  }, [meta.picklistObject, meta.picklistField]);
  return (
    <select value={value} onChange={(e) => setValue(e.target.value)} style={bulkInput}>
      <option value="">—</option>
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}

function BulkLookup({ meta, value, setValue }) {
  const [query, setQuery] = useState('');
  const [opts, setOpts]   = useState([]);
  const [picked, setPicked] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => {
      searchLookupOptions(meta.referencesTable, query, { limit: 20 })
        .then(setOpts).catch(() => setOpts([]));
    }, 180);
    return () => clearTimeout(t);
  }, [query, meta.referencesTable]);
  if (picked) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, padding: '8px 10px', background: '#e8f8f2', border: '1px solid #2aab72', borderRadius: 6, fontSize: 12, color: '#1a7a4e' }}>
          {picked.label}
        </div>
        <button onClick={() => { setPicked(null); setValue(''); }}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 14, padding: 4 }}>✕</button>
      </div>
    );
  }
  return (
    <div>
      <input type="text" value={query} placeholder={`Search ${meta.referencesTable}…`}
        onChange={(e) => setQuery(e.target.value)} style={bulkInput} />
      {opts.length > 0 && (
        <div style={{ marginTop: 4, maxHeight: 180, overflowY: 'auto',
                      border: `1px solid ${C.border}`, borderRadius: 6, background: C.page }}>
          {opts.map(o => (
            <div key={o.id} onClick={() => { setPicked(o); setValue(o.id); setQuery(''); }}
              style={{ padding: '7px 10px', fontSize: 12, cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function prettifyColumnName(s) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const inlineEditorStyle = {
  width: '100%', padding: '5px 8px', fontSize: 12,
  border: '1.5px solid #2aab72', borderRadius: 4,
  background: '#fff', color: C.textPrimary, outline: 'none',
};
const bulkLabel = {
  fontSize: 11, color: C.textMuted, fontWeight: 500, display: 'block', marginBottom: 4,
  textTransform: 'uppercase', letterSpacing: 0.3,
};
const bulkInput = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: `1px solid ${C.border}`, borderRadius: 6,
  background: C.card, color: C.textPrimary,
};
const bulkPrimaryBtn = {
  padding: '8px 16px', fontSize: 12.5, fontWeight: 600,
  color: '#fff', border: 'none', borderRadius: 6,
};
const bulkSecondaryBtn = {
  padding: '8px 14px', fontSize: 12.5, fontWeight: 500,
  background: C.page, border: `1px solid ${C.border}`, borderRadius: 6,
  color: C.textSecondary, cursor: 'pointer',
};
