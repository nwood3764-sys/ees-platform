import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { C } from '../data/constants';
import { useIsMobile } from '../lib/useMediaQuery';
import { useSwipeToDismiss } from '../lib/useSwipeToDismiss';
import { usePullToRefresh } from '../lib/usePullToRefresh';
import { blockNegativeKeys, composeKeyDown, clampNonNegative } from '../lib/numberInput';
import { Badge, Icon, TableRow, ProgramTag } from './UI';
import HelpIcon from './help/HelpIcon';
import FieldValueLink from './FieldValueLink';
import { formatUsPhoneDisplay } from '../lib/fieldLinks';
import { collectRelatedFields } from '../lib/listViewFields';
import {
  numberFilters, compileFilterLogic, logicAfterRemoval, validateFilterLogic,
  isMatchAll, defaultFilterLogic, MATCH_ALL,
} from '../lib/listFilterLogic';
import {
  getEditableFieldsForTable,
  getPicklistOptions,
  searchLookupOptions,
  bulkUpdateRecords,
  bulkSoftDeleteRecords,
  bulkCloneRecords,
} from '../data/fieldMetadataService';
import {
  fetchSavedViewsForObject,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  setDefaultViewForObject,
  getCurrentRoleId,
} from '../data/listViewsService';

// Pluralize an object label for empty-state copy. Handles the common English
// cases that a naive `+ 's'` gets wrong: consonant+y → -ies (Property →
// Properties), sibilant endings → -es (Address → Addresses, Box → Boxes).
function pluralizeLabel(label) {
  if (!label) return 'records';
  if (/[^aeiou]y$/i.test(label)) return label.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(label)) return label + 'es';
  return label + 's';
}

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
// Sentinel value representing "blank/empty" in a multi-select column filter.
// Persisted into saved views like any other selected value; the filter
// predicate maps it to the empty-string test. Chosen to never collide with a
// real picklist/text value.
const BLANK_FILTER_VALUE = '__BLANK__';

// ── Filter operators ─────────────────────────────────────────────────────────
// Salesforce-style operator set, scoped by column type. Each filter row is
// { field, label, op, value(s) }. Legacy ops ('equals' multi-select, 'contains',
// 'from'/'to' date range) remain valid so previously-saved views keep working;
// the sidebar authors the richer ops below.
//
// op semantics (evaluated in matchFilter):
//   equals / not_equals        — exact (multi-select equals OR's its values)
//   contains / not_contains    — substring, case-insensitive
//   starts_with / ends_with     — affix, case-insensitive
//   gt / gte / lt / lte         — numeric if both sides parse as numbers, else string compare
//   from / to                   — legacy date range bounds (inclusive)
//   between                     — value = [lo, hi] inclusive (number or date)
//   is_blank / is_not_blank     — empty-cell test
const OPERATORS = {
  text: [
    { op: 'contains', label: 'contains' },
    { op: 'not_contains', label: 'does not contain' },
    { op: 'equals', label: 'equals' },
    { op: 'not_equals', label: 'does not equal' },
    { op: 'starts_with', label: 'starts with' },
    { op: 'ends_with', label: 'ends with' },
    { op: 'is_blank', label: 'is blank' },
    { op: 'is_not_blank', label: 'is not blank' },
  ],
  select: [
    { op: 'equals', label: 'is any of', multi: true },
    { op: 'not_equals', label: 'is none of', multi: true },
    { op: 'is_blank', label: 'is blank' },
    { op: 'is_not_blank', label: 'is not blank' },
  ],
  number: [
    { op: 'equals', label: '=' },
    { op: 'not_equals', label: '≠' },
    { op: 'gt', label: '>' },
    { op: 'gte', label: '≥' },
    { op: 'lt', label: '<' },
    { op: 'lte', label: '≤' },
    { op: 'between', label: 'between' },
    { op: 'is_blank', label: 'is blank' },
    { op: 'is_not_blank', label: 'is not blank' },
  ],
  date: [
    { op: 'equals', label: 'on' },
    { op: 'from', label: 'on or after' },
    { op: 'to', label: 'on or before' },
    { op: 'between', label: 'between' },
    { op: 'is_blank', label: 'is blank' },
    { op: 'is_not_blank', label: 'is not blank' },
  ],
};
// Operators that need no value input.
const VALUELESS_OPS = new Set(['is_blank', 'is_not_blank']);
// Operators whose value is a 2-tuple.
const RANGE_OPS = new Set(['between']);

function operatorsForType(type) {
  return OPERATORS[type] || OPERATORS.text;
}
function defaultOperatorForType(type) {
  return operatorsForType(type)[0].op;
}

// Evaluate one filter row against one record's raw cell value.
function matchFilter(rawValue, filter) {
  const v = (rawValue === null || rawValue === undefined) ? '' : String(rawValue);
  const blank = v.trim() === '';
  const { op } = filter;

  if (op === 'is_blank') return blank;
  if (op === 'is_not_blank') return !blank;

  // Multi-select equals/not_equals: value is an array (or single legacy value).
  if (op === 'equals' || op === 'not_equals') {
    const vals = Array.isArray(filter.value) ? filter.value : [filter.value];
    const hit = vals.some(val =>
      val === BLANK_FILTER_VALUE ? blank : v === String(val)
    );
    return op === 'equals' ? hit : !hit;
  }

  const needle = String(filter.value ?? '').toLowerCase();
  const hay = v.toLowerCase();
  if (op === 'contains') return hay.includes(needle);
  if (op === 'not_contains') return !hay.includes(needle);
  if (op === 'starts_with') return hay.startsWith(needle);
  if (op === 'ends_with') return hay.endsWith(needle);

  // Numeric/date comparisons. Prefer numeric when both parse as numbers,
  // otherwise lexical (ISO dates compare correctly as strings).
  const cmp = (a, b) => {
    const na = Number(a), nb = Number(b);
    if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) {
      return na < nb ? -1 : na > nb ? 1 : 0;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  };
  if (op === 'gt')  return !blank && cmp(v, filter.value) > 0;
  if (op === 'gte') return !blank && cmp(v, filter.value) >= 0;
  if (op === 'lt')  return !blank && cmp(v, filter.value) < 0;
  if (op === 'lte') return !blank && cmp(v, filter.value) <= 0;
  if (op === 'from') return !blank && cmp(v, filter.value) >= 0;
  if (op === 'to')   return !blank && cmp(v, filter.value) <= 0;
  if (op === 'between') {
    const [lo, hi] = Array.isArray(filter.value) ? filter.value : [filter.value, filter.value];
    if (blank) return false;
    if (lo !== '' && lo != null && cmp(v, lo) < 0) return false;
    if (hi !== '' && hi != null && cmp(v, hi) > 0) return false;
    return true;
  }
  return true;
}

// A short human description of a filter row for chips/sidebar.
function describeFilter(filter, colLabel) {
  const opMeta = Object.values(OPERATORS).flat().find(o => o.op === filter.op);
  const opLabel = opMeta?.label || filter.op;
  if (VALUELESS_OPS.has(filter.op)) return `${colLabel} ${opLabel}`;
  if (filter.op === 'equals' && Array.isArray(filter.value)) {
    const shown = filter.value.map(v => v === BLANK_FILTER_VALUE ? '(Blanks)' : v);
    return `${colLabel}: ${shown.join(', ')}`;
  }
  if (RANGE_OPS.has(filter.op)) {
    const [lo, hi] = Array.isArray(filter.value) ? filter.value : ['', ''];
    return `${colLabel} ${opLabel} ${lo || '…'}–${hi || '…'}`;
  }
  const val = filter.value === BLANK_FILTER_VALUE ? '(Blanks)' : filter.value;
  return `${colLabel} ${opLabel} ${val}`;
}

function FilterDropdown({ col, activeFilters, onApply, onClose, triggerRect }) {
  const colF = activeFilters.filter(f => f.field === col.field);
  const [sel, setSel] = useState(colF.filter(f => f.op === 'equals').map(f => f.value));
  const [txt, setTxt] = useState(colF.find(f => f.op === 'contains')?.value || '');
  const [dateFrom, setDateFrom] = useState(colF.find(f => f.op === 'from')?.value || '');
  const [dateTo, setDateTo] = useState(colF.find(f => f.op === 'to')?.value || '');
  const [search, setSearch] = useState('');
  const ref = useRef();

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    const esc = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, []);

  const toggle = v => setSel(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  // Full value list incl. the blank sentinel (only when the column has blanks).
  const allValues = [
    ...(col.options || []),
    ...(col.hasBlanks ? [BLANK_FILTER_VALUE] : []),
  ];
  const labelFor = v => (v === BLANK_FILTER_VALUE ? '(Blanks)' : v);
  // Search filters the value checklist (matches Excel's column filter search).
  const q = search.trim().toLowerCase();
  const visibleValues = q
    ? allValues.filter(v => labelFor(v).toLowerCase().includes(q))
    : allValues;

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

  // Anchor to the funnel trigger via a fixed-position body portal so the panel
  // escapes the table card's overflow:hidden (which previously clipped it out
  // of view — the panel opened but was invisible). Flip left when the trigger
  // is near the right viewport edge so the panel stays on-screen.
  const PANEL_W = 244;
  const rect = triggerRect;
  const top = rect ? Math.min(rect.bottom + 4, window.innerHeight - 80) : 80;
  let left = rect ? rect.left : 0;
  if (rect && left + PANEL_W > window.innerWidth - 8) {
    left = Math.max(8, rect.right - PANEL_W);
  }
  const maxH = rect ? Math.max(220, window.innerHeight - top - 16) : 420;

  const panel = (
    <div ref={ref} style={{
      position: 'fixed', top, left, zIndex: 4000,
      width: PANEL_W, maxHeight: maxH, display: 'flex', flexDirection: 'column',
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      boxShadow: '0 8px 28px rgba(7,17,31,0.22)', padding: 14, boxSizing: 'border-box'
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
        Filter: {col.label}
      </div>

      {col.type === 'select' && (
        <>
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search values…"
            style={{ width: '100%', background: C.page, border: `1px solid ${C.border}`, borderRadius: 5, padding: '6px 9px', fontSize: 12, color: C.textPrimary, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
          />
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span onClick={() => setSel(prev => Array.from(new Set([...prev, ...visibleValues])))} style={{ fontSize: 11, color: '#1a5a8a', cursor: 'pointer' }}>Select all</span>
              <span onClick={() => setSel(prev => prev.filter(v => !visibleValues.includes(v)))} style={{ fontSize: 11, color: C.textMuted, cursor: 'pointer' }}>Clear</span>
            </div>
            {visibleValues.length === 0 && (
              <div style={{ fontSize: 12, color: C.textMuted, padding: '6px 4px' }}>No matching values</div>
            )}
            {visibleValues.map(o => (
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
                <span style={{ fontSize: 12, color: o === BLANK_FILTER_VALUE ? C.textMuted : C.textPrimary, fontStyle: o === BLANK_FILTER_VALUE ? 'italic' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 185 }}>{labelFor(o)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {col.type === 'text' && (
        <input autoFocus value={txt} onChange={e => setTxt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') apply(); }} placeholder={`Search ${col.label.toLowerCase()}...`}
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
  return createPortal(panel, document.body);
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
                    {col.type === 'select' && (() => {
                      const mobileOptions = [
                        ...(col.options || []),
                        ...(col.hasBlanks ? [BLANK_FILTER_VALUE] : []),
                      ];
                      const mLabel = v => (v === BLANK_FILTER_VALUE ? '(Blanks)' : v);
                      return (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <button
                            onClick={() => setSelValues(col, mobileOptions)}
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
                          {mobileOptions.map(o => {
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
                                <span style={{ color: o === BLANK_FILTER_VALUE ? C.textMuted : C.textPrimary, fontStyle: o === BLANK_FILTER_VALUE ? 'italic' : 'normal', flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{mLabel(o)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      );
                    })()}

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
function SortableHeader({ col, sortField, sortDir, onSort, activeFilters, onFilterApply, openFilterCol, setOpenFilterCol, onResizeStart, onResizeReset, currentWidth,
  onColDragStart, onColDragOver, onColDrop, onColDragEnd, isColDragging, isColDragOver }) {
  const isFiltered = activeFilters.some(f => f.field === col.field);
  const isSorted = sortField === col.field;
  const isOpen = openFilterCol === col.field;
  const [gripHover, setGripHover] = useState(false);
  const [filterRect, setFilterRect] = useState(null);

  const handleSort = () => {
    if (!col.sortable) return;
    if (sortField !== col.field) { onSort(col.field, 'asc'); return; }
    if (sortDir === 'asc') { onSort(col.field, 'desc'); return; }
    onSort(null, null);
  };

  const onFunnelClick = (e) => {
    const r = (e.currentTarget.closest('div') || e.currentTarget).getBoundingClientRect();
    setFilterRect(r);
    setOpenFilterCol(isOpen ? null : col.field);
  };

  return (
    <th
      onDragOver={onColDragStart ? (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; onColDragOver?.(col.field); } : undefined}
      onDrop={onColDragStart ? (e) => { e.preventDefault(); onColDrop?.(col.field); } : undefined}
      style={{
        padding: 0, position: 'sticky', top: 0, zIndex: 3, background: C.card, userSelect: 'none',
        borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', overflow: 'hidden',
        // Drag-reorder affordances: fade the column being dragged, and show a
        // 2px emerald insertion bar on the header currently hovered as a target.
        opacity: isColDragging ? 0.45 : 1,
        boxShadow: isColDragOver ? `inset 2px 0 0 ${C.emerald}` : undefined,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
        <div onClick={handleSort}
          draggable={!!onColDragStart}
          onDragStart={onColDragStart ? (e) => {
            if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', col.field); } catch { /* older browsers */ } }
            onColDragStart(col.field);
          } : undefined}
          onDragEnd={onColDragStart ? () => onColDragEnd?.() : undefined}
          title={onColDragStart ? 'Drag to reorder · click to sort' : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '10px 4px 10px 12px', cursor: col.sortable ? 'pointer' : (onColDragStart ? 'grab' : 'default'), flex: '1 1 auto', minWidth: 0 }}
          onMouseEnter={e => { if (col.sortable) e.currentTarget.style.background = C.page; }}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <span style={{ fontSize: 11, fontWeight: 600, color: isSorted ? C.textPrimary : C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, maxWidth: 168 }} title={col.label}>
            {col.label}
          </span>
          {col.sortable && (
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
              <svg width="6" height="4" viewBox="0 0 6 4" fill={isSorted && sortDir === 'asc' ? C.emerald : C.borderDark}><path d="M3 0L6 4H0L3 0Z" /></svg>
              <svg width="6" height="4" viewBox="0 0 6 4" fill={isSorted && sortDir === 'desc' ? C.emerald : C.borderDark}><path d="M3 4L0 0H6L3 4Z" /></svg>
            </span>
          )}
        </div>
        {col.filterable && (
          <div onClick={onFunnelClick}
            style={{ padding: '10px 10px 10px 4px', cursor: 'pointer', position: 'relative', flexShrink: 0, background: isFiltered ? 'rgba(62,207,142,0.10)' : 'transparent' }}
            title={`Filter ${col.label}`}
            onMouseEnter={e => e.currentTarget.style.background = isFiltered ? 'rgba(62,207,142,0.18)' : C.page}
            onMouseLeave={e => e.currentTarget.style.background = isFiltered ? 'rgba(62,207,142,0.10)' : 'transparent'}>
            <svg width="12" height="12" viewBox="0 0 24 24"
              fill={isFiltered ? C.emerald : 'none'} stroke={isFiltered ? C.emerald : C.textMuted}
              strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            {isFiltered && <span style={{ position: 'absolute', top: 6, right: 5, width: 4, height: 4, background: C.emerald, borderRadius: '50%', border: '1.5px solid white' }} />}
          </div>
        )}
      </div>
      {isOpen && col.filterable && (
        <FilterDropdown col={col} activeFilters={activeFilters} onApply={onFilterApply} onClose={() => setOpenFilterCol(null)} triggerRect={filterRect} />
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

// ── Column Picker ────────────────────────────────────────────────────────────
// Searchable, grouped combo box for choosing which columns show in the current
// view. Driven by the FULL column catalog (every own column + one-hop related
// columns through the object's lookups), grouped by relationship. A search box
// filters across all groups by label. EVERY column is un-checkable, including
// the record number and the name — the only floor is that one column has to
// remain, or the list would render nothing. Selection is an explicit ordered
// array (newly checked columns append to the end); clearing back to the
// default set is offered via "Reset to default".
//
// catalog:        [{ field, label, type, group, related?, locked? }]
// groups:         ordered group labels (object group first)
// defaultFields:  the field list of the default-visible set (for Reset)
// visibleColumns: current explicit selection (array) or null (= default set)
function ColumnPicker({
  catalog, groups, visibleColumns, defaultFields, onChange, onClose, triggerRect,
}) {
  const ref = useRef();
  const [search, setSearch] = useState('');
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // The current explicit selection. null means "default set" — materialize it
  // to the default fields so toggling produces a concrete ordered array.
  const currentOrdered = Array.isArray(visibleColumns)
    ? visibleColumns
    : (defaultFields || []);
  const selectedSet = new Set(currentOrdered);

  const isVisible = (field) => selectedSet.has(field);
  // The last remaining column can't be unchecked — an empty list view has
  // nothing to click and nothing to read. Everything else, including the
  // record number and the name, comes off freely.
  const isLastColumn = (field) => selectedSet.has(field) && selectedSet.size <= 1;

  const toggle = (field) => {
    if (isLastColumn(field)) return;
    const next = selectedSet.has(field)
      ? currentOrdered.filter(f => f !== field)
      // Append so the user's most-recently-added column shows at the right.
      : [...currentOrdered, field];
    onChange(next);
  };

  // Group the catalog for display, applying the search filter. Locked identity
  // columns always show in their group regardless of search so the user sees
  // them pinned.
  const q = search.trim().toLowerCase();
  const grouped = useMemo(() => {
    const byGroup = new Map();
    for (const g of (groups || [])) byGroup.set(g, []);
    for (const c of (catalog || [])) {
      if (q && !c.label.toLowerCase().includes(q) && !(c.group || '').toLowerCase().includes(q)) continue;
      const g = c.group || 'Other';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(c);
    }
    // Drop empty groups (after search).
    return Array.from(byGroup.entries()).filter(([, arr]) => arr.length > 0);
  }, [catalog, groups, q]);

  const rect = triggerRect;
  const top = rect ? rect.bottom + 4 : 0;
  const left = rect ? rect.left : 0;
  const maxH = rect ? Math.max(240, window.innerHeight - rect.bottom - 16) : 460;
  const selectedCount = selectedSet.size;

  const menu = (
    <div ref={ref} style={{
      position: 'fixed', top, left, zIndex: 4000,
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      boxShadow: '0 8px 28px rgba(7,17,31,0.22)', width: 320,
      maxHeight: maxH, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 14px 8px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Add columns{selectedCount > 0 && <span style={{ color: C.textSecondary }}> · {selectedCount} shown</span>}
          </span>
          <span onClick={() => onChange(null)} style={{ cursor: 'pointer', color: C.emerald, fontWeight: 600, fontSize: 11 }}>Reset to default</span>
        </div>
        <div style={{ position: 'relative' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={2}
            style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)' }}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search columns and related fields…"
            style={{ width: '100%', background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 9px 7px 28px', fontSize: 12.5, color: C.textPrimary, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
      </div>

      <div style={{ overflowY: 'auto', padding: '4px 0 8px' }}>
        {grouped.length === 0 && (
          <div style={{ padding: '14px', fontSize: 12.5, color: C.textMuted }}>No columns match “{search}”.</div>
        )}
        {grouped.map(([group, cols]) => (
          <div key={group}>
            <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', position: 'sticky', top: 0, background: C.card }}>
              {group}
            </div>
            {cols.map(col => {
              const on = isVisible(col.field);
              const locked = col.locked || isLastColumn(col.field);
              return (
                <div key={col.field}
                  onClick={() => toggle(col.field)}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 14px',
                           cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.55 : 1 }}
                  onMouseEnter={e => { if (!locked) e.currentTarget.style.background = C.page; }}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{
                    width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                    border: `1.5px solid ${on ? C.emerald : C.borderDark}`,
                    background: on ? C.emerald : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3}><polyline points="20 6 9 17 4 12" /></svg>}
                  </span>
                  <span style={{ fontSize: 13, color: C.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {col.label}
                    {locked && <span style={{ color: C.textMuted, fontSize: 11 }}> {isLastColumn(col.field) ? '(last column)' : '(always shown)'}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
  return createPortal(menu, document.body);
}

// ── View Selector ────────────────────────────────────────────────────────────
// Lists system views and saved (persisted) views. When persistence is enabled
// (onEditView/onDeleteView/onSetDefault provided), each row exposes hover
// actions: set-default (star), edit, delete. A default view shows a filled
// star regardless of hover. System views are editable too when persistence is
// on — editing one persists an override carrying its __system_base id.
function ViewSelector({
  activeViewId, systemViews, personalViews, onSelect, onClose,
  onEditView, onDeleteView, onSetDefault, onNewView, persistEnabled, triggerRect,
}) {
  const ref = useRef();
  const [hoverId, setHoverId] = useState(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // One unified, de-duplicated "List Views" list, built from two sources:
  //
  //   • systemViews — the prop. For most callers these are in-code system view
  //     constants (never `_persisted`). ObjectListSection additionally passes
  //     the object's persisted saved views here, but that prop is loaded once
  //     by the parent and is NOT refreshed when the user deletes/renames/sets-
  //     default on a view from inside this selector.
  //   • personalViews — loaded and re-loaded HERE in ListView after every
  //     create/edit/delete/set-default, so it is always the live copy of the
  //     user's persisted saved views.
  //
  // Because a persisted view can appear in BOTH, an earlier version merged them
  // and de-duped by id — but that let the stale `systemViews` copy win, so a
  // deleted view kept reappearing ("can't delete list views") and a rename
  // showed the old name until a full reload. Fix: take persisted views ONLY
  // from the live personalViews; use the systemViews prop solely for genuine
  // in-code system views (those are never `_persisted`). In-code system views
  // list first (e.g. "All"), then the user's saved views.
  const overriddenBaseIds = new Set(personalViews.map(v => v.systemBase).filter(Boolean));
  const listViews = [];
  const seenViewIds = new Set();
  for (const v of systemViews) {
    if (!v || v._persisted || overriddenBaseIds.has(v.id) || seenViewIds.has(v.id)) continue;
    seenViewIds.add(v.id);
    listViews.push(v);
  }
  for (const v of personalViews) {
    if (!v || seenViewIds.has(v.id)) continue;
    seenViewIds.add(v.id);
    listViews.push(v);
  }

  const IconBtn = ({ title, onClick, children, danger }) => (
    <button title={title} onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ background: 'transparent', border: 'none', padding: 3, cursor: 'pointer',
               display: 'flex', alignItems: 'center', color: danger ? '#1a5a8a' : C.textMuted, borderRadius: 4 }}
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
        <div style={{ padding: '4px 14px 6px', fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>List Views</div>
        {listViews.map(v => <Row key={v.id} v={v} editable={persistEnabled} />)}
        {persistEnabled && (
          <>
            <div style={{ height: 1, background: C.border, margin: '6px 0' }} />
            <div
              onClick={() => { onNewView && onNewView(); onClose(); }}
              onMouseEnter={e => e.currentTarget.style.background = C.page}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px 9px 14px',
                       cursor: 'pointer', color: C.emerald, fontWeight: 600, fontSize: 13 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              New View
            </div>
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
function SaveViewModal({ activeFilters, sortField, sortDir, cols, onSave, onSaveAsNew, onClose, editing, persistEnabled, hasRole }) {
  const [name, setName] = useState(editing?.name || '');
  const [scope, setScope] = useState(editing?.scope || 'personal');
  const [isDefault, setIsDefault] = useState(editing?.isDefault || false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  // When editing, "Save as new" flips this so commit creates a fresh view.
  const [forceNew, setForceNew] = useState(false);

  const scopeOpts = [
    { id: 'personal', label: 'Only me' },
    ...(hasRole ? [{ id: 'role', label: 'My role' }] : []),
    { id: 'shared', label: 'Everyone' },
  ];

  const commit = async (asNew = false) => {
    const effectiveName = asNew && name.trim() === (editing?.name || '')
      ? `${name.trim()} (copy)` : name.trim();
    if (!effectiveName || saving) return;
    setSaving(true); setErr(null);
    try {
      if (asNew && typeof onSaveAsNew === 'function') onSaveAsNew();
      await onSave({ name: effectiveName, scope, isDefault, asNew });
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

        {err && <div style={{ background: '#e8f1fb', color: '#1a5a8a', fontSize: 12, padding: '8px 10px', borderRadius: 6, marginBottom: 14 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => commit(false)} disabled={!name.trim() || saving}
            style={{ flex: 1, minWidth: 120, background: (name.trim() && !saving) ? C.emerald : C.borderDark, color: '#fff', border: 'none', borderRadius: 6, padding: 10, fontSize: 13, fontWeight: 600, cursor: (name.trim() && !saving) ? 'pointer' : 'default' }}>
            {saving ? 'Saving…' : (editing ? 'Save Changes' : 'Save View')}
          </button>
          {editing && (
            <button onClick={() => commit(true)} disabled={!name.trim() || saving}
              title="Keep the original view and save these settings as a separate new view"
              style={{ flex: 1, minWidth: 120, background: C.page, color: C.emerald, border: `1px solid ${C.emerald}`, borderRadius: 6, padding: 10, fontSize: 13, fontWeight: 600, cursor: (name.trim() && !saving) ? 'pointer' : 'default' }}>
              Save as new
            </button>
          )}
          <button onClick={onClose} style={{ flex: editing ? '1 1 100%' : 1, background: C.page, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 6, padding: 10, fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Filter Sidebar ───────────────────────────────────────────────────────────
// Right-docked panel (Salesforce-style) listing every active filter as an
// editable row and an "Add Filter" affordance. The field picker draws from the
// full column catalog (own + one-hop related), so a filter can target a field
// that isn't currently shown as a column. Operators are scoped by field type.
//
// Internally the sidebar represents filters as normalized rows
// { id, field, label, type, op, value }. On Apply it serializes to the
// activeFilters shape the list engine consumes (array-valued equals for
// multi-select; scalar value otherwise), and pushes via onApply.
function FilterSidebar({ catalog, groups, activeFilters, filterLogic, onApply, onClose }) {
  const ref = useRef();

  // Resolve a catalog column by field.
  const colByField = useMemo(() => {
    const m = new Map();
    for (const c of (catalog || [])) m.set(c.field, c);
    return m;
  }, [catalog]);

  // Hydrate working rows from activeFilters. Collapse multiple scalar 'equals'
  // on the same field back into one multi-value row (mirrors how the header
  // dropdown emits them) so the sidebar shows one editable row per field/op.
  const hydrate = () => {
    const rows = [];
    const equalsByField = new Map();
    const colType = (col) => {
      const vs = col?.valueSource;
      if (vs && (vs.kind === 'lookup' || (vs.kind === 'picklist' && !vs.maybe))) return 'select';
      return col?.type || 'text';
    };
    for (const f of (activeFilters || [])) {
      const col = colByField.get(f.field) || { field: f.field, label: f.label || f.field, type: 'text' };
      const extra = { valueSource: col.valueSource, options: col.options, hasBlanks: col.hasBlanks };
      if (f.op === 'equals' && !Array.isArray(f.value)) {
        if (!equalsByField.has(f.field)) {
          const row = { id: `r${rows.length}_${f.field}`, field: f.field, label: col.label, type: colType(col), op: 'equals', value: [f.value], ...extra };
          equalsByField.set(f.field, row); rows.push(row);
        } else {
          equalsByField.get(f.field).value.push(f.value);
        }
      } else {
        rows.push({ id: `r${rows.length}_${f.field}`, field: f.field, label: col.label, type: colType(col), op: f.op, value: f.value, ...extra });
      }
    }
    return rows;
  };

  const [rows, setRows] = useState(hydrate);
  const [picking, setPicking] = useState(false); // field-picker open for a new row
  const [search, setSearch] = useState('');
  // The filter-logic expression being edited. Rows here are 1:1 with the
  // numbers the expression refers to (hydrate already collapses a field's
  // multi-select rows into one), so what the user counts on screen is what
  // "2" means.
  const [logic, setLogic] = useState(filterLogic || MATCH_ALL);
  const usingLogic = !isMatchAll(logic);
  const logicCheck = validateFilterLogic(logic, rows.length);

  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);

  // A field whose values come from a picklist or lookup behaves like a
  // 'select' for operator purposes (is any of / is none of / blank), even
  // though its column type is text. Free-text picklists ('maybe') still get
  // the full text operator set so contains/starts-with remain available.
  const effectiveType = (col) => {
    const vs = col?.valueSource;
    if (vs && (vs.kind === 'lookup' || (vs.kind === 'picklist' && !vs.maybe))) return 'select';
    return col?.type || 'text';
  };

  const addRowForField = (col) => {
    const type = effectiveType(col);
    const op = defaultOperatorForType(type);
    const opMeta = operatorsForType(type).find(o => o.op === op);
    setRows(prev => [...prev, {
      id: `r${Date.now()}_${col.field}`, field: col.field, label: col.label,
      type, op, value: opMeta?.multi ? [] : '',
      valueSource: col.valueSource, options: col.options, hasBlanks: col.hasBlanks,
    }]);
    setPicking(false); setSearch('');
  };

  const updateRow = (id, patch) => setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  const removeRow = (id) => {
    const idx = rows.findIndex(r => r.id === id);
    setRows(prev => prev.filter(r => r.id !== id));
    if (idx >= 0) setLogic(prev => logicAfterRemoval(prev, rows.length, idx));
  };

  const changeOp = (id, op) => {
    const row = rows.find(r => r.id === id);
    const opMeta = operatorsForType(row.type).find(o => o.op === op);
    let value = row.value;
    if (VALUELESS_OPS.has(op)) value = '';
    else if (opMeta?.multi) value = Array.isArray(value) ? value : (value ? [value] : []);
    else if (RANGE_OPS.has(op)) value = Array.isArray(value) ? value : ['', ''];
    else value = Array.isArray(value) ? (value[0] || '') : value;
    updateRow(id, { op, value });
  };

  // Serialize rows → activeFilters shape and apply.
  const apply = () => {
    const out = [];
    for (const r of rows) {
      if (VALUELESS_OPS.has(r.op)) { out.push({ field: r.field, label: r.label, op: r.op }); continue; }
      const opMeta = operatorsForType(r.type).find(o => o.op === r.op);
      if (opMeta?.multi) {
        const vals = Array.isArray(r.value) ? r.value.filter(v => v !== '' && v != null) : [];
        if (vals.length === 0) continue;
        // Emit one scalar equals row per value for 'equals' (keeps header
        // dropdown + chips consistent); 'not_equals' stays a single array row.
        if (r.op === 'equals') vals.forEach(v => out.push({ field: r.field, label: r.label, op: 'equals', value: v }));
        else out.push({ field: r.field, label: r.label, op: r.op, value: vals });
        continue;
      }
      if (RANGE_OPS.has(r.op)) {
        const [lo, hi] = Array.isArray(r.value) ? r.value : ['', ''];
        if ((lo === '' || lo == null) && (hi === '' || hi == null)) continue;
        out.push({ field: r.field, label: r.label, op: r.op, value: [lo, hi] });
        continue;
      }
      if (r.value === '' || r.value == null) continue;
      out.push({ field: r.field, label: r.label, op: r.op, value: r.value });
    }
    // The logic refers to filter NUMBERS, so it is only meaningful against the
    // rows it was written for. A row that contributed no filter (an operator
    // left without a value) would shift every number after it, so an
    // incomplete row falls back to match-all rather than shifting the
    // expression silently onto the wrong filters.
    const authored = rows.filter(r => {
      if (VALUELESS_OPS.has(r.op)) return true;
      if (Array.isArray(r.value)) return r.value.some(v => v !== '' && v != null);
      return r.value !== '' && r.value != null;
    });
    const logicOut = (!isMatchAll(logic) && authored.length === rows.length && logicCheck.ok)
      ? logic
      : MATCH_ALL;
    onApply(out, logicOut);
    onClose();
  };

  const clearAll = () => { setRows([]); setLogic(MATCH_ALL); };

  // Grouped, searched catalog for the field picker.
  const q = search.trim().toLowerCase();
  const groupedCatalog = useMemo(() => {
    const byGroup = new Map();
    for (const g of (groups || [])) byGroup.set(g, []);
    for (const c of (catalog || [])) {
      if (q && !c.label.toLowerCase().includes(q) && !(c.group || '').toLowerCase().includes(q)) continue;
      const g = c.group || 'Other';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(c);
    }
    return Array.from(byGroup.entries()).filter(([, arr]) => arr.length > 0);
  }, [catalog, groups, q]);

  const panel = (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(7,17,31,0.18)', zIndex: 3500 }} />
      <div ref={ref} style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, maxWidth: '92vw', zIndex: 3600,
        background: C.card, borderLeft: `1px solid ${C.border}`, boxShadow: '-8px 0 28px rgba(7,17,31,0.16)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>Filters</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {rows.length > 0 && <span onClick={clearAll} style={{ fontSize: 12, color: C.textMuted, cursor: 'pointer' }}>Remove all</span>}
            <svg onClick={onClose} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={2} style={{ cursor: 'pointer' }}><path d="M18 6L6 18M6 6l12 12" /></svg>
          </div>
        </div>

        {/* Filter rows */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          {rows.length === 0 && !picking && (
            <div style={{ fontSize: 13, color: C.textMuted, padding: '8px 0 16px' }}>
              No filters applied. Add a filter to narrow this list.
            </div>
          )}

          {rows.map((row, rowIndex) => (
            <div key={row.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 10, background: C.cardSecondary || C.page }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {/* The number the filter logic refers to. Always shown, so an
                      expression can be written without counting rows by eye. */}
                  <span style={{
                    flexShrink: 0, minWidth: 18, height: 18, borderRadius: 4,
                    background: usingLogic ? C.emerald : C.border,
                    color: usingLogic ? '#fff' : C.textSecondary,
                    fontSize: 10.5, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                  }}>{rowIndex + 1}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.label}>{row.label}</span>
                </span>
                <svg onClick={() => removeRow(row.id)} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={2} style={{ cursor: 'pointer', flexShrink: 0 }}><path d="M18 6L6 18M6 6l12 12" /></svg>
              </div>

              {/* Operator */}
              <select value={row.op} onChange={e => changeOp(row.id, e.target.value)}
                style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 5, padding: '6px 8px', fontSize: 12.5, color: C.textPrimary, marginBottom: 8, cursor: 'pointer' }}>
                {operatorsForType(row.type).map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
              </select>

              {/* Value editor */}
              <FilterValueEditor row={row} onChange={(value) => updateRow(row.id, { value })} />
            </div>
          ))}

          {/* Add filter / field picker */}
          {picking ? (
            <div style={{ border: `1px solid ${C.emerald}`, borderRadius: 8, padding: 10, marginTop: 4 }}>
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search fields…"
                style={{ width: '100%', background: C.page, border: `1px solid ${C.border}`, borderRadius: 5, padding: '7px 9px', fontSize: 12.5, color: C.textPrimary, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                {groupedCatalog.length === 0 && <div style={{ fontSize: 12.5, color: C.textMuted, padding: 8 }}>No fields match “{search}”.</div>}
                {groupedCatalog.map(([group, cols]) => (
                  <div key={group}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '8px 4px 4px' }}>{group}</div>
                    {cols.map(c => (
                      <div key={c.field} onClick={() => addRowForField(c)}
                        style={{ fontSize: 12.5, color: C.textPrimary, padding: '6px 8px', borderRadius: 5, cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = C.page}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        {c.label}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div onClick={() => { setPicking(false); setSearch(''); }} style={{ fontSize: 12, color: C.textMuted, cursor: 'pointer', padding: '8px 4px 2px' }}>Cancel</div>
            </div>
          ) : (
            <div onClick={() => setPicking(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.emerald, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '10px 4px', marginTop: 4 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 5v14M5 12h14" /></svg>
              Add Filter
            </div>
          )}
        </div>

        {/* Filter logic — how the numbered filters above combine. Absent, they
            are all ANDed, which is what this list always did and cannot express
            "owned by Lutheran OR managed by Lutheran". */}
        {rows.length > 1 && (
          <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}`, background: C.page }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary }}>Filter Logic</span>
              {usingLogic ? (
                <span onClick={() => setLogic(MATCH_ALL)}
                  style={{ fontSize: 11.5, color: C.textMuted, cursor: 'pointer' }}>Match all filters</span>
              ) : (
                <span onClick={() => setLogic(defaultFilterLogic(rows.length))}
                  style={{ fontSize: 11.5, color: C.emerald, fontWeight: 600, cursor: 'pointer' }}>Add filter logic</span>
              )}
            </div>
            {usingLogic ? (
              <>
                <input
                  value={logic}
                  onChange={e => setLogic(e.target.value)}
                  placeholder={`e.g. 1 AND (2 OR ${rows.length})`}
                  spellCheck={false}
                  style={{
                    width: '100%', marginTop: 8, boxSizing: 'border-box',
                    background: C.card, border: `1px solid ${logicCheck.ok ? C.border : C.skyBlue || '#7eb3e8'}`,
                    borderRadius: 5, padding: '7px 9px', fontSize: 12.5, color: C.textPrimary,
                    fontFamily: 'JetBrains Mono, monospace', outline: 'none',
                  }} />
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Any of these', expr: Array.from({ length: rows.length }, (_, i) => i + 1).join(' OR ') },
                    { label: 'All of these', expr: MATCH_ALL },
                  ].map(p => (
                    <span key={p.label} onClick={() => setLogic(p.expr)}
                      style={{ fontSize: 11, color: C.textSecondary, background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 7px', cursor: 'pointer' }}>
                      {p.label}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, marginTop: 6, color: logicCheck.ok ? C.textMuted : (C.skyBlue || '#7eb3e8'), lineHeight: 1.4 }}>
                  {logicCheck.ok
                    ? 'Refer to filters by number, with AND, OR, NOT and parentheses.'
                    : logicCheck.error}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 4 }}>
                A record must match every filter. Add filter logic to say OR.
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '14px 18px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10 }}>
          <button onClick={apply} style={{ flex: 1, background: C.emerald, color: '#fff', border: 'none', borderRadius: 6, padding: '9px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Apply</button>
          <button onClick={onClose} style={{ flex: 1, background: C.page, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 6, padding: '9px 0', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </>
  );
  return createPortal(panel, document.body);
}

// Value editor for one sidebar filter row, by operator/type/value-source.
// A picklist or lookup field gets a searchable typeahead of its real options
// (picklist definition / referenced records); free-text/number/date and
// literal operators (contains, >, between …) get manual entry. The stored
// filter value is always the displayed text (rows carry resolved labels), so
// lookups emit the label string, not the id.
function FilterValueEditor({ row, onChange }) {
  const opMeta = operatorsForType(row.type).find(o => o.op === row.op);
  const isMulti = !!opMeta?.multi;
  const isRange = RANGE_OPS.has(row.op);
  const vs = row.valueSource;

  // Operators that compare literally (substring/affix/inequalities) always use
  // a manual input even on a picklist field — you might want "contains 'WI'".
  const literalOp = ['contains', 'not_contains', 'starts_with', 'ends_with', 'gt', 'gte', 'lt', 'lte'].includes(row.op);
  const wantsTypeahead = !!vs && !literalOp && !isRange && !VALUELESS_OPS.has(row.op);

  const baseStyle = { width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 5, padding: '6px 8px', fontSize: 12.5, color: C.textPrimary, outline: 'none', boxSizing: 'border-box' };

  // ── Typeahead state (declared unconditionally to respect hook ordering) ──
  const [query, setQuery] = useState('');
  const [opts, setOpts] = useState(null);   // resolved options [{label}] | 'TEXT'
  const [open, setOpen] = useState(false);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const fellBackToText = opts === 'TEXT';

  useEffect(() => {
    if (!wantsTypeahead) return;
    let cancelled = false;
    (async () => {
      setLoadingOpts(true);
      try {
        if (vs.kind === 'picklist') {
          const list = await getPicklistOptions(vs.object, vs.field);
          if (cancelled) return;
          if ((!list || list.length === 0) && vs.maybe) setOpts('TEXT');
          else setOpts((list || []).map(o => ({ label: o.label })));
        } else if (vs.kind === 'lookup') {
          const list = await searchLookupOptions(vs.table, '').catch(() => []);
          if (cancelled) return;
          setOpts((list || []).map(o => ({ label: o.label })));
        }
      } catch {
        if (!cancelled) setOpts(vs?.maybe ? 'TEXT' : []);
      } finally {
        if (!cancelled) setLoadingOpts(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vs?.kind, vs?.object, vs?.field, vs?.table, wantsTypeahead]);

  // Live lookup search as the user types (lookups can have many records).
  useEffect(() => {
    if (!wantsTypeahead || vs?.kind !== 'lookup') return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const list = await searchLookupOptions(vs.table, query).catch(() => []);
      if (!cancelled) setOpts((list || []).map(o => ({ label: o.label })));
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (VALUELESS_OPS.has(row.op)) return null;

  if (wantsTypeahead && !fellBackToText) {
    const optionList = Array.isArray(opts) ? opts : [];
    const q = query.trim().toLowerCase();
    // Picklist filters client-side; lookup is already server-filtered.
    const shown = (vs.kind === 'picklist' && q)
      ? optionList.filter(o => o.label.toLowerCase().includes(q))
      : optionList;
    const selected = isMulti ? (Array.isArray(row.value) ? row.value : []) : row.value;

    const pickSingle = (label) => { onChange(label); setOpen(false); setQuery(''); };
    const toggleMulti = (label) => {
      const cur = Array.isArray(row.value) ? row.value : [];
      onChange(cur.includes(label) ? cur.filter(v => v !== label) : [...cur, label]);
    };

    return (
      <div style={{ position: 'relative' }}>
        {/* Selected chips for multi */}
        {isMulti && Array.isArray(selected) && selected.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
            {selected.map(s => (
              <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#e8f3fb', color: '#1a5a8a', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}>
                {s}
                <svg onClick={() => toggleMulti(s)} width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} style={{ cursor: 'pointer' }}><path d="M18 6 6 18M6 6l12 12" /></svg>
              </span>
            ))}
          </div>
        )}
        <input
          value={isMulti ? query : (open ? query : (row.value || ''))}
          onChange={e => { setQuery(e.target.value); onChange(isMulti ? row.value : e.target.value); if (!open) setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={loadingOpts ? 'Loading…' : (isMulti ? 'Search and select…' : 'Search…')}
          style={baseStyle}
        />
        {open && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, marginTop: 2, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, boxShadow: '0 6px 20px rgba(7,17,31,0.16)', maxHeight: 200, overflowY: 'auto' }}>
            {shown.length === 0 && <div style={{ fontSize: 12, color: C.textMuted, padding: '8px 10px' }}>{loadingOpts ? 'Loading…' : 'No matches'}</div>}
            {shown.map(o => {
              const on = isMulti && Array.isArray(selected) && selected.includes(o.label);
              return (
                <div key={o.label}
                  onClick={() => { isMulti ? toggleMulti(o.label) : pickSingle(o.label); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12.5, color: C.textPrimary }}
                  onMouseEnter={e => e.currentTarget.style.background = C.page}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  {isMulti && (
                    <span style={{ width: 13, height: 13, borderRadius: 3, flexShrink: 0, border: `1.5px solid ${on ? C.emerald : C.borderDark}`, background: on ? C.emerald : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {on && <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </span>
                  )}
                  {o.label}
                </div>
              );
            })}
            <div onClick={() => setOpen(false)} style={{ fontSize: 11, color: C.textMuted, padding: '6px 10px', borderTop: `1px solid ${C.border}`, cursor: 'pointer', textAlign: 'center' }}>Close</div>
          </div>
        )}
      </div>
    );
  }

  // ── Manual inputs ───────────────────────────────────────────────────────
  const inputType = row.type === 'date' ? 'date' : (row.type === 'number' ? 'number' : 'text');

  if (isRange) {
    const [lo, hi] = Array.isArray(row.value) ? row.value : ['', ''];
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type={inputType} value={lo} onChange={e => onChange([e.target.value, hi])} placeholder="From" style={baseStyle} />
        <span style={{ color: C.textMuted, fontSize: 12 }}>–</span>
        <input type={inputType} value={hi} onChange={e => onChange([lo, e.target.value])} placeholder="To" style={baseStyle} />
      </div>
    );
  }

  return <input type={inputType} value={Array.isArray(row.value) ? (row.value[0] || '') : (row.value || '')}
    onChange={e => onChange(e.target.value)} placeholder="Value" style={baseStyle} />;
}

// ── Main ListView ────────────────────────────────────────────────────────────
// Opt-in edit features (Salesforce-style):
//   tableName        — when provided, enables row checkboxes, inline cell
//                      edit via double-click, and the bulk-edit toolbar.
//                      The string is the LEAP table to write back to via
//                      the bulk_update_records RPC. When omitted, the
//                      ListView renders exactly as it did before — pure
//                      read-only, all existing call sites unchanged.
//   onRecordsUpdated — fires after any successful bulk edit, delete, or clone
//                      with the RPC summary. Parent should reload its
//                      data on this callback so the table reflects the
//                      new server state.
//   onEditRecord     — (row) => void. Opens the row's record in edit mode
//                      (the per-row "Edit" action). When omitted the action
//                      falls back to onOpenRecord.
//   onCloneRecord    — (row) => void. Opens the row's record in clone mode
//                      (a pre-filled create form). The per-row "Clone" action.
export function ListView({
  data: dataProp,
  columns: columnsProp,
  columnCatalog: columnCatalogProp,
  columnGroups: columnGroupsProp,
  onActiveRelatedFieldsChange,
  // True while the parent is re-fetching rows because this view started
  // referencing a field the current rows don't carry (a related column added
  // to the columns, the filters, or the sort). The rows on screen are stale
  // for that field, so an empty result is "not loaded yet", not "no matches" —
  // saying otherwise is how a filter looks broken while it's simply waiting.
  dataPending = false,
  systemViews: systemViewsProp,
  defaultViewId, newLabel,
  renderCell, renderDetail, onNew, onOpenRecord, onRefresh,
  tableName, onRecordsUpdated, storageKey,
  onEditRecord, onCloneRecord,
  listObject, listModule,
  // When true (the default), the user's persisted default view is applied on
  // first load — its filters/sort/columns become the opening state, matching
  // Salesforce pinned-list-view behavior. Callers that open with an explicit
  // scope (e.g. a dashboard drill-down's synthetic Filtered view) pass false
  // so the drill filters aren't stomped by the saved default.
  applyDefaultViewOnLoad = true,
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
  // Normalize column descriptors so auto-generated object lists (which only
  // carry field/label/type/options) get the same header affordances the
  // hand-written module lists set explicitly. A caller may still pin
  // sortable/filterable to false per column; only undefined is defaulted.
  // Filterable applies to the supported filter types (select/text/date);
  // number columns have no header filter UI, matching the mobile sheet.
  const columns = useMemo(() => {
    const raw = Array.isArray(columnsProp) ? columnsProp : []
    return raw.map(c => ({
      ...c,
      sortable: c.sortable !== undefined ? c.sortable : true,
      filterable: c.filterable !== undefined
        ? c.filterable
        : (c.type === 'select' || c.type === 'text' || c.type === 'date'),
    }))
  }, [columnsProp])

  // Full searchable catalog (own + one-hop related columns). Normalized the
  // same way as the default columns. When absent (hand-written module lists),
  // the catalog falls back to the default columns so the picker still works.
  const columnCatalog = useMemo(() => {
    const raw = Array.isArray(columnCatalogProp) && columnCatalogProp.length > 0
      ? columnCatalogProp
      : (Array.isArray(columnsProp) ? columnsProp : [])
    return raw.map(c => ({
      ...c,
      sortable: c.sortable !== undefined ? c.sortable : true,
      filterable: c.filterable !== undefined
        ? c.filterable
        : (c.type === 'select' || c.type === 'text' || c.type === 'date'),
    }))
  }, [columnCatalogProp, columnsProp])

  const columnGroups = Array.isArray(columnGroupsProp) ? columnGroupsProp : []

  // Resolver over every column the user could show: default columns first
  // (they may carry filter `options` derived from loaded rows), then any
  // catalog column not already present. Keyed by field for O(1) lookup.
  const columnByField = useMemo(() => {
    const m = new Map()
    for (const c of columns) m.set(c.field, c)
    for (const c of columnCatalog) if (!m.has(c.field)) m.set(c.field, c)
    return m
  }, [columns, columnCatalog])

  // Catalog enriched with filter metadata (options/hasBlanks derived from the
  // loaded rows on the default columns) so the filter sidebar's multi-select
  // value editors have value lists where available.
  const filterCatalog = useMemo(() => {
    return columnCatalog.map(c => {
      const enriched = columnByField.get(c.field)
      return enriched && (enriched.options || enriched.hasBlanks)
        ? { ...c, type: enriched.type || c.type, options: enriched.options, hasBlanks: enriched.hasBlanks }
        : c
    })
  }, [columnCatalog, columnByField])
  // Map a DB column name to the row-object key it renders under, so a saved
  // view or filter that stored the underlying columnName (e.g. property_state)
  // still resolves against rows keyed by the display field (e.g. state).
  // Curated lists like Outreach Properties define columns as
  // { field:'state', columnName:'property_state' } and shape their rows with
  // the friendly `field` key; a saved filter authored with the DB column name
  // otherwise reads `undefined` on every row and silently hides everything.
  // Only added when the columnName can't collide with a real field key, so
  // lists whose fields already equal their DB columns are unaffected.
  const fieldAlias = useMemo(() => {
    const fieldSet = new Set();
    for (const c of columns) fieldSet.add(c.field);
    for (const c of columnCatalog) fieldSet.add(c.field);
    const m = new Map();
    const add = (c) => {
      if (c.columnName && c.columnName !== c.field && !fieldSet.has(c.columnName)) {
        m.set(c.columnName, c.field);
      }
    };
    for (const c of columns) add(c);
    for (const c of columnCatalog) add(c);
    return m;
  }, [columns, columnCatalog]);
  const rowKeyFor = (field) => fieldAlias.get(field) || field;

  // Nothing is un-hideable. The record number and the name are ordinary
  // columns: removable, and draggable to any position. A row stays openable
  // without them — double-click opens the record, and edit mode's per-row
  // menu carries Edit / Clone / Delete.
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
  // How those filters combine. 'all' — every filter must match — is the default
  // and what every view saved before filter logic existed means.
  const [filterLogic, setFilterLogic] = useState(firstView?.filterLogic || MATCH_ALL);
  // Column visibility for the active view. null = show all columns (default).
  // When set, it's an array of column field names to show, in the catalog's
  // order. The record-identity columns ('name', and the record-number 'id'
  // shown first) are always kept so a row is never un-clickable / unlabeled.
  const [visibleColumns, setVisibleColumns] = useState(null);
  const [showColPicker, setShowColPicker] = useState(false);
  const [colPickerRect, setColPickerRect] = useState(null);
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // The columns actually rendered: the default set when visibleColumns is null,
  // otherwise EXACTLY the user's selection, in the user's order. Header, rows,
  // and the mobile card all map over effectiveColumns so a hidden column
  // disappears everywhere consistently.
  //
  // Nothing is pinned. The record number and the name used to be forced to the
  // front and could not be unchecked, which meant they could not be dragged
  // anywhere either — every reorder snapped them back. A column the user
  // doesn't want is a column that shouldn't be on screen, wherever it sits in
  // the catalog. The one floor is that a list can't render zero columns: an
  // empty selection falls back to the default set.
  const effectiveColumns = useMemo(() => {
    // Default view (no explicit selection): show the default column set.
    if (!Array.isArray(visibleColumns)) return columns;
    // Explicit selection: render in the user's chosen order. Each field
    // resolves through the merged catalog so related/extra columns the user
    // added render even though they're not in the default set.
    const ordered = [];
    const seen = new Set();
    for (const f of visibleColumns) {
      if (seen.has(f)) continue;
      const c = columnByField.get(f);
      if (c) { ordered.push(c); seen.add(f); }
    }
    return ordered.length > 0 ? ordered : columns;
  }, [columns, columnByField, visibleColumns]);

  // Sum of every column's width (its custom drag width, or its type-based
  // default) plus the edit-mode checkbox column. Used as the table's minWidth so
  // that when the columns don't fit the pane the table overflows and the
  // horizontal scrollbar appears — reachable even before any column is resized.
  const tableMinWidth = useMemo(() => {
    // Edit mode adds a 36px checkbox column (left) and a 44px row-actions
    // column (right).
    const base = editMode ? 36 + 44 : 0;
    return base + effectiveColumns.reduce((sum, col) => {
      const w = colWidths[col.field];
      return sum + (w != null ? w : defaultColWidth(col));
    }, 0);
  }, [effectiveColumns, colWidths, editMode]);

  // ── Column drag-to-reorder ──────────────────────────────────────────────
  // Native HTML5 drag on the header label moves a column left/right. Tracks the
  // column being dragged (from) and the header hovered as the drop target (over)
  // for the insertion-bar affordance.
  const [colDrag, setColDrag] = useState({ from: null, over: null });
  const reorderColumns = (fromField, toField) => {
    if (!fromField || fromField === toField) return;
    // Materialize the current rendered order (effectiveColumns already reflects
    // any explicit selection AND the forced identity columns), move `from` to
    // where `to` sits, and persist as the explicit column order.
    const order = effectiveColumns.map(c => c.field);
    const fromIdx = order.indexOf(fromField);
    const toIdx   = order.indexOf(toField);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...order];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, fromField);
    setVisibleColumns(next);
    setIsDirty(true);
  };

  // Report the related (one-hop) fields this view REFERENCES to the parent so it
  // can refetch with the necessary parent joins. A view references a field by
  // displaying it, by filtering on it, or by sorting on it — all three count.
  // Hiding a column never removes the field the active filter needs, which is
  // what used to empty the list the moment someone unchecked the column their
  // filter rode on. Own-column changes don't trigger this (their data is on
  // every row already). Fires only when the set actually changes.
  const lastRelatedKeyRef = useRef('');
  useEffect(() => {
    if (typeof onActiveRelatedFieldsChange !== 'function') return;
    const related = collectRelatedFields({ visibleColumns, filters: activeFilters, sortField });
    const key = related.join('|');
    if (key === lastRelatedKeyRef.current) return;
    lastRelatedKeyRef.current = key;
    onActiveRelatedFieldsChange(related);
  }, [visibleColumns, activeFilters, sortField, onActiveRelatedFieldsChange]);
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
  // Guards for applying the persisted default view exactly once on load: never
  // re-apply after the user has interacted (switched views, sorted, filtered),
  // and never apply twice if the saved-views fetch resolves late.
  const defaultAppliedRef = useRef(false);
  const userInteractedRef = useRef(false);
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
  // Bulk delete/clone state. confirmDelete carries the ids pending a
  // recycle-bin confirmation (bulk selection or a single row action).
  const [bulkBusy, setBulkBusy]         = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // { ids } | null
  const [bulkActionError, setBulkActionError] = useState(null);
  // One-time "how to use edit mode" hint, dismissed per browser.
  const [editHintDismissed, setEditHintDismissed] = useState(() => {
    try { return localStorage.getItem('ees.listedit.hint') === '1'; } catch { return true; }
  });
  const dismissEditHint = () => {
    setEditHintDismissed(true);
    try { localStorage.setItem('ees.listedit.hint', '1'); } catch { /* ignore */ }
  };

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
  // known. Reloads after every create/edit/delete/set-default so the selector
  // (and its per-user default star) is always live.
  const reloadSavedViews = async () => {
    if (!persistObject) return;
    try {
      const views = await fetchSavedViewsForObject(persistObject);
      setPersonalViews(views);
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
      setPersonalViews(views);
      // Apply the user's default view on first load — this is what makes "set
      // as default" actually mean something across refreshes. Applied once,
      // and only if the user hasn't already interacted (switched views,
      // sorted, filtered) while the fetch was in flight. Filtering/sorting is
      // client-side here, so this only changes which loaded rows render — the
      // parent's data load is untouched. Default views that include related
      // columns are pre-seeded by ObjectListSection (seedRelatedFromViews) so
      // those columns resolve without a second fetch.
      const def = views.find(v => v.isDefault);
      if (def && applyDefaultViewOnLoad && !defaultAppliedRef.current && !userInteractedRef.current) {
        defaultAppliedRef.current = true;
        setActiveViewId(def.id);
        setActiveFilters([...(def.filters || [])]);
        setFilterLogic(def.filterLogic || MATCH_ALL);
        setSortField(def.sortField || null);
        setSortDir(def.sortDir || 'asc');
        setVisibleColumns(Array.isArray(def.visibleColumns) ? def.visibleColumns : null);
        setIsDirty(false);
      }
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
      const v = { id: 'pv' + Date.now(), name, filters: [...activeFilters], filterLogic, sortField, sortDir, visibleColumns };
      setPersonalViews(prev => [...prev, v]);
      setActiveViewId(v.id);
      setIsDirty(false); setShowSave(false); setEditingView(null);
      return;
    }
    const common = {
      name, scope: scope || 'personal', isDefault: !!isDefault,
      object: persistObject, module: listModule || persistObject,
      filters: [...activeFilters], filterLogic, sortField, sortDir, visibleColumns,
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

  const handleNewView = () => {
    // Open the Save modal in create mode. Captures the current filters/sort as
    // the starting point for the new view (the user can clear them in the list
    // first if they want a clean view). Clears any edit target so the modal
    // shows "Save View", not "Save Changes".
    setEditingView(null);
    setShowSave(true);
    setShowViewSel(false);
  };

  // Opening the Save modal from the dirty-state "Save View" button. If the
  // user is sitting on an existing saved (persisted) view and has tweaked its
  // filters/sort/columns, default to UPDATING that view ("Save Changes")
  // rather than forcing a brand-new view. Falls back to create mode when the
  // active view isn't a persisted personal/role/shared view (e.g. an in-code
  // system view or the synthetic "All").
  const openSaveForDirty = () => {
    const active = [...personalViews, ...systemViews].find(v => v.id === activeViewId);
    if (active && active._persisted) setEditingView(active);
    else setEditingView(null);
    setShowSave(true);
  };

  // "Save as new" from within the edit modal: drop the edit target so the
  // commit creates a fresh view from the current state.
  const handleSaveAsNew = () => { setEditingView(null); };

  const handleEditView = (v) => {
    // Load the view's settings into the working state, then open the modal in
    // edit mode so Save Changes re-persists with any tweaks.
    setActiveViewId(v.id);
    setActiveFilters(v.filters || []);
    setFilterLogic(v.filterLogic || MATCH_ALL);
    setSortField(v.sortField || null);
    setSortDir(v.sortDir || 'asc');
    setVisibleColumns(Array.isArray(v.visibleColumns) ? v.visibleColumns : null);
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
      // Pin directly: the default is a per-user pointer, not a view column, so
      // pinning a shared view never edits the view row (or anyone else's pin).
      await setDefaultViewForObject(persistObject, v.id);
    } else {
      // Setting a system view as default persists an override row for it.
      await createSavedView({
        name: v.name, scope: 'personal', isDefault: true,
        object: persistObject, module: listModule || persistObject,
        filters: v.filters || [], filterLogic: v.filterLogic || MATCH_ALL,
        sortField: v.sortField || null, sortDir: v.sortDir || 'asc',
        visibleColumns: Array.isArray(v.visibleColumns) ? v.visibleColumns : null,
        systemBase: v.id,
      });
    }
    await reloadSavedViews();
  };

  const applyView = v => {
    userInteractedRef.current = true;
    setActiveViewId(v.id);
    setActiveFilters(v.filters || []);
    setFilterLogic(v.filterLogic || MATCH_ALL);
    setSortField(v.sortField || null);
    setSortDir(v.sortDir || 'asc');
    setVisibleColumns(Array.isArray(v.visibleColumns) ? v.visibleColumns : null);
    setIsDirty(false);
  };

  const handleSort = (f, d) => { userInteractedRef.current = true; setSortField(f); setSortDir(d); setIsDirty(true); };

  // A header-dropdown filter change can't know about filter logic, so it
  // resets to match-all rather than leaving an expression pointing at filter
  // numbers the change just shifted — which is how a list silently empties.
  const handleFilterApply = (nf, nextLogic) => {
    userInteractedRef.current = true;
    setActiveFilters(nf);
    setFilterLogic(nextLogic === undefined ? MATCH_ALL : (nextLogic || MATCH_ALL));
    setIsDirty(true);
    setOpenFilterCol(null);
  };

  // Removing a chip removes ONE numbered filter (a multi-value chip set is one
  // filter over several rows) and renumbers the logic around it, so "1 AND (2
  // OR 3)" never survives as a reference to a filter that no longer exists.
  const removeFilter = i => {
    userInteractedRef.current = true;
    const removed = activeFilters[i];
    if (!removed) return;
    const entries = numberFilters(activeFilters);
    const entryIndex = entries.findIndex(e => e.rows.includes(removed));
    const doomed = entryIndex >= 0 ? new Set(entries[entryIndex].rows) : new Set([removed]);
    setActiveFilters(prev => prev.filter(f => !doomed.has(f)));
    if (entryIndex >= 0) setFilterLogic(prev => logicAfterRemoval(prev, entries.length, entryIndex));
    setIsDirty(true);
  };

  const clearAll = () => { userInteractedRef.current = true; setActiveFilters([]); setFilterLogic(MATCH_ALL); setSortField(null); setSortDir('asc'); setIsDirty(false); setActiveViewId(defaultViewId); };

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
  // displayField is the row key the cell renders from (for FK columns this is
  // the *__label display column, distinct from the DB columnName we write).
  // displayValue is the human-readable string to show immediately after save.
  const saveSingleCell = async (rowId, displayField, columnName, newValue, displayValue) => {
    setSavingCell({ rowId, columnName });
    setEditError(null);
    try {
      const result = await bulkUpdateRecords(tableName, [rowId], { [columnName]: newValue });
      if (result.records_errored > 0) {
        const msg = (result.errors?.[0]?.error) || 'Update failed';
        setEditError({ rowId, columnName, message: msg });
        return;
      }
      // Persist the display value in the local overlay, keyed by the display
      // field so the cell shows the new value immediately (authoritative until
      // the parent reloads on its own).
      setOverlay(prev => {
        const next = new Map(prev);
        next.set(`${rowId}::${displayField}`, displayValue !== undefined ? displayValue : newValue);
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

  // ── Bulk delete / clone (edit mode only) ────────────────────────────────
  // Both route through the server RPCs (soft-delete / clone) and then ask the
  // parent to reload via onRecordsUpdated so counts and derived data refresh.
  const runDelete = async (ids) => {
    if (!ids || ids.length === 0) return;
    setBulkBusy(true); setBulkActionError(null);
    try {
      const summary = await bulkSoftDeleteRecords(tableName, ids);
      setConfirmDelete(null);
      setSelected(new Set());
      if (summary.records_errored > 0) {
        setBulkActionError(`${summary.records_deleted} deleted, ${summary.records_errored} could not be deleted.`);
      }
      if (onRecordsUpdated) onRecordsUpdated(summary);
    } catch (e) {
      setBulkActionError(e.message || String(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const runClone = async (ids) => {
    if (!ids || ids.length === 0) return;
    setBulkBusy(true); setBulkActionError(null);
    try {
      const summary = await bulkCloneRecords(tableName, ids);
      setSelected(new Set());
      if (summary.records_errored > 0) {
        setBulkActionError(`${summary.records_cloned} cloned, ${summary.records_errored} could not be cloned.`);
      }
      if (onRecordsUpdated) onRecordsUpdated(summary);
    } catch (e) {
      setBulkActionError(e.message || String(e));
    } finally {
      setBulkBusy(false);
    }
  };

  // Per-row actions. Edit/Clone open the record (falling back to onOpenRecord
  // for Edit); Delete goes through the same confirm + RPC path as bulk delete.
  const handleRowEdit  = (r) => { (onEditRecord || onOpenRecord)?.(r); };
  const handleRowClone = (r) => { if (onCloneRecord) onCloneRecord(r); else { const k = rowKey(r); if (k) runClone([k]); } };
  const handleRowDelete = (r) => { const k = rowKey(r); if (k) setConfirmDelete({ ids: [k] }); };

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
    // Filters, numbered the way the sidebar shows them, combined the way the
    // view's filter logic says. The default logic is match-all, which is the
    // behavior this list always had: every filter must match, with one field's
    // multi-select values OR'd together (the header dropdown emits one row per
    // chosen value, and numberFilters collapses them back into one filter).
    // Anything else — "1 AND (2 OR 3)" — is the whole point: two filters ANDed
    // cannot answer "owned by Lutheran OR managed by Lutheran".
    const filterEntries = numberFilters(activeFilters);
    if (filterEntries.length > 0) {
      // Parse the expression ONCE for the whole list, not once per row.
      const evaluate = compileFilterLogic(filterEntries, filterLogic);
      const entryKeys = filterEntries.map(e => rowKeyFor(e.field));
      d = d.filter(r => evaluate((entry, i) => matchFilter(r[entryKeys[i]], entry)));
    }
    if (sortField) {
      const sk = rowKeyFor(sortField);
      d.sort((a, b) => {
        const av = String(a[sk] || ''), bv = String(b[sk] || '');
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return d;
  }, [activeFilters, filterLogic, sortField, sortDir, globalSearch, data, fieldAlias]);

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
    if (col.field === 'amount') {
      // `v` may arrive already-formatted (e.g. "$1,234" or "—") from a
      // service's fmtAmount, or as a raw number. Only number-format when it's
      // actually numeric; otherwise render the string as-is. Prevents the
      // "$NaN" artifact from double-formatting a formatted string.
      const display = (typeof v === 'number')
        ? `$${v.toLocaleString()}`
        : (v == null || v === '' ? '—' : String(v));
      return <td key={col.field} style={{ padding: '11px 12px', borderBottom: `1px solid ${C.border}`, color: C.textPrimary, fontWeight: 500, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{display}</td>;
    }
    if (col.field === 'email') return <td key={col.field} style={{ padding: '11px 12px', borderBottom: `1px solid ${C.border}`, color: '#1a5a8a', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><FieldValueLink type="email" raw={v} display={v || '—'} label={col.label} /></td>;
    // A phone / email / website column (col.linkType, from the object's field
    // metadata) is as actionable in a list as it is on the record page: click
    // the number to dial, the address to compose, the site to open it.
    if (col.linkType) {
      const shownLink = col.linkType === 'phone' && v ? formatUsPhoneDisplay(v) : v;
      return <td key={col.field} style={{ padding: '11px 12px', borderBottom: `1px solid ${C.border}`, color: v ? C.textSecondary : C.textMuted, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <FieldValueLink type={col.linkType} raw={v} display={shownLink || '—'} label={col.label} />
      </td>;
    }
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
              {showViewSel && <ViewSelector activeViewId={activeViewId} systemViews={systemViews} personalViews={personalViews} onSelect={applyView} onClose={() => setShowViewSel(false)} persistEnabled={persistEnabled} onEditView={handleEditView} onDeleteView={handleDeleteView} onSetDefault={handleSetDefault} onNewView={handleNewView} triggerRect={viewSelRect} />}
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
                onClick={openSaveForDirty}
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
                  <span style={{ color: '#1a5a8a' }}>{f.value === BLANK_FILTER_VALUE ? '(Blanks)' : f.value}</span>
                  <button onClick={() => removeFilter(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#7eb3e8', lineHeight: 1, marginLeft: 2 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
              {sortField && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#f0eeff', border: `1px solid #d0c8f8`, borderRadius: 5, padding: '4px 8px', fontSize: 12 }}>
                  <span style={{ color: '#6d5ae0', fontWeight: 500 }}>Sort: {(columnByField.get(sortField)?.label || sortField)} {sortDir === 'asc' ? '↑' : '↓'}</span>
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
                {dataPending ? 'Loading matching records…'
                  : data.length === 0 ? `No ${pluralizeLabel(newLabel ? newLabel.toLowerCase() : '')} yet` : 'No matching records'}
              </div>
              <div style={{ fontSize: 13, maxWidth: 260, lineHeight: 1.4 }}>
                {dataPending
                  ? 'Fetching the fields this view filters on.'
                  : data.length === 0
                  ? `Tap the + button to create your first ${newLabel ? newLabel.toLowerCase() : 'record'}.`
                  : 'Try adjusting the filters or search to find what you\'re looking for.'}
              </div>
              {!dataPending && data.length > 0 && (activeFilters.length > 0 || sortField || globalSearch) && (
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

        {showSave && <SaveViewModal activeFilters={activeFilters} sortField={sortField} sortDir={sortDir} cols={effectiveColumns} onSave={handleSave} onSaveAsNew={handleSaveAsNew} onClose={() => { setShowSave(false); setEditingView(null); }} editing={editingView} persistEnabled={persistEnabled} hasRole={hasRole} />}
        {showFilterSheet && (
          <MobileFilterSheet
            columns={columns}
            activeFilters={activeFilters}
            sortField={sortField}
            sortDir={sortDir}
            onClose={() => setShowFilterSheet(false)}
            onApply={({ filters, sortField: sf, sortDir: sd }) => {
              setActiveFilters(filters);
              // The mobile sheet edits filters without showing their numbers,
              // so it cannot keep an expression written against the old ones.
              setFilterLogic(MATCH_ALL);
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
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
          {showViewSel && <ViewSelector activeViewId={activeViewId} systemViews={systemViews} personalViews={personalViews} onSelect={applyView} onClose={() => setShowViewSel(false)} persistEnabled={persistEnabled} onEditView={handleEditView} onDeleteView={handleDeleteView} onSetDefault={handleSetDefault} onNewView={handleNewView} triggerRect={viewSelRect} />}
        </div>

        {/* Filter button — opens the right-docked filter sidebar */}
        <button onClick={() => setShowFilterPanel(true)}
          title="Filter this list"
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: activeFilters.length ? '#e8f8f2' : C.page, border: `1px solid ${activeFilters.length ? C.emerald : C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 13, color: activeFilters.length ? '#1a7a4e' : C.textPrimary, cursor: 'pointer', fontWeight: 500 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
          Filters
          {activeFilters.length > 0 && <span style={{ fontSize: 11, color: '#1a7a4e', fontFamily: 'JetBrains Mono, monospace' }}>{activeFilters.length}</span>}
        </button>

        {/* Column picker */}
        <div style={{ position: 'relative' }}>
          <button onClick={(e) => { setColPickerRect((e.currentTarget.closest('button') || e.currentTarget).getBoundingClientRect()); setShowColPicker(v => !v); }}
            title="Choose columns"
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 13, color: C.textPrimary, cursor: 'pointer', fontWeight: 500 }}>
            <Icon path="M3 3h7v18H3zM14 3h7v7h-7zM14 14h7v7h-7z" size={13} color={C.textSecondary} />
            Columns
            {Array.isArray(visibleColumns) && <span style={{ fontSize: 11, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>{effectiveColumns.length}</span>}
          </button>
          {showColPicker && <ColumnPicker catalog={columnCatalog} groups={columnGroups} visibleColumns={visibleColumns} defaultFields={columns.map(c => c.field)} onChange={(next) => { setVisibleColumns(next); setIsDirty(true); }} onClose={() => setShowColPicker(false)} triggerRect={colPickerRect} />}
        </div>

        {persistEnabled && <HelpIcon anchors={[{ type: 'concept', concept: 'list-views' }, { type: 'concept', concept: 'column-visibility' }]} title="List views & columns" />}

        {/* Active filter chips */}
        {activeFilters.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#e8f3fb', border: `1px solid #b8d8f0`, borderRadius: 5, padding: '4px 8px', fontSize: 12 }}>
            <span style={{ color: '#1a5a8a' }}>{describeFilter(f, columnByField.get(f.field)?.label || f.label || f.field)}</span>
            <button onClick={() => removeFilter(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#7eb3e8', lineHeight: 1, marginLeft: 2 }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        ))}

        {/* Sort chip */}
        {sortField && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#f0eeff', border: `1px solid #d0c8f8`, borderRadius: 5, padding: '4px 8px', fontSize: 12 }}>
            <span style={{ color: '#6d5ae0', fontWeight: 500 }}>Sort: {(columnByField.get(sortField)?.label || sortField)} {sortDir === 'asc' ? '↑' : '↓'}</span>
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
            <button onClick={openSaveForDirty} style={{ display: 'flex', alignItems: 'center', gap: 5, background: C.page, border: `1px solid ${C.emerald}`, borderRadius: 6, padding: '5px 12px', fontSize: 12, color: C.emerald, cursor: 'pointer', fontWeight: 600 }}>
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
          <button onClick={() => setBulkPanelOpen(true)} disabled={bulkBusy}
            style={{ padding: '6px 14px', fontSize: 12.5, fontWeight: 600,
                     background: '#3ecf8e', border: '1px solid #2aab72', borderRadius: 6,
                     color: '#fff', cursor: bulkBusy ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon path="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" size={13} color="#fff" />
            Edit fields
          </button>
          <button onClick={() => runClone([...selected])} disabled={bulkBusy}
            style={{ padding: '6px 14px', fontSize: 12.5, fontWeight: 600,
                     background: C.card, border: '1px solid #2aab72', borderRadius: 6,
                     color: '#1a7a4e', cursor: bulkBusy ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon path="M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" size={13} color="#1a7a4e" />
            {bulkBusy ? 'Working…' : 'Clone'}
          </button>
          <button onClick={() => setConfirmDelete({ ids: [...selected] })} disabled={bulkBusy}
            style={{ padding: '6px 14px', fontSize: 12.5, fontWeight: 600,
                     background: C.card, border: `1px solid ${C.skyBlue || '#7eb3e8'}`, borderRadius: 6,
                     color: '#1a5a8a', cursor: bulkBusy ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon path="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" size={13} color="#1a5a8a" />
            Delete
          </button>
          <button onClick={() => setSelected(new Set())} disabled={bulkBusy}
            style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 500,
                     background: 'transparent', border: '1px solid #2aab72', borderRadius: 6,
                     color: '#1a7a4e', cursor: bulkBusy ? 'not-allowed' : 'pointer' }}>
            Clear selection
          </button>
          {(fieldMetaErr || bulkActionError) && (
            <div style={{ fontSize: 11.5, color: '#1a5a8a', marginLeft: 'auto' }}>
              {bulkActionError || `Field metadata failed to load: ${fieldMetaErr.message}`}
            </div>
          )}
        </div>
      )}

      {/* First-run hint: how to use the list's edit features. Shown only in
          edit mode when nothing is selected, dismissible per browser. */}
      {editMode && selected.size === 0 && !editHintDismissed && (
        <div style={{
          padding: '7px 24px', display: 'flex', alignItems: 'center', gap: 10,
          background: '#eef4fb', borderBottom: '1px solid #d0d8e8',
          fontSize: 12, color: '#0d1a2e',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a5a8a" strokeWidth={2} style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
          </svg>
          <span>
            <strong>Editing this list:</strong> double-click a cell to edit it in place ·
            check rows to <strong>edit fields, clone, or delete</strong> in bulk ·
            use the <strong>⋯</strong> menu at the end of a row for Edit, Clone, or Delete.
          </span>
          <button onClick={dismissEditHint}
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer',
                     color: '#1a5a8a', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
            Got it
          </button>
        </div>
      )}

      {/* Table + detail panel */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
        <div style={{ flex: '1 1 0', minWidth: 0, width: 0, padding: '14px 14px 24px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* The card itself is the scroll container so its rounded corners clip
              AND the sticky <thead> has a proper scrollport to freeze against.
              (A wrapping overflow:hidden here previously defeated position:sticky.) */}
          <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, overflow: 'auto', flex: 1, minHeight: 0 }}>
            <table data-colfixed={hasCustomWidths ? '1' : '0'} style={{
              // width:100% fills the pane when there's room; minWidth is the sum
              // of each column's width (custom drag width or type-based default)
              // so that with many columns the table overflows the pane and the
              // container's horizontal scrollbar appears — instead of squeezing
              // every column to fit and leaving off-screen columns unreachable.
              width: '100%', minWidth: tableMinWidth,
              borderCollapse: 'collapse', fontSize: 13,
              tableLayout: hasCustomWidths ? 'fixed' : 'auto',
            }}>
              <colgroup>
                {editMode && <col style={{ width: 36 }} />}
                {effectiveColumns.map(col => {
                  const w = colWidths[col.field];
                  // Sized columns get their explicit px. Once ANY column is
                  // dragged the table switches to fixed layout, so unsized
                  // columns need a width too — fall back to a type-based
                  // default so they don't all collapse to equal slices.
                  // When NO column is dragged we stay on auto layout (no col
                  // widths) so the table fills the pane instead of rendering
                  // at the sum of fixed widths and leaving dead space.
                  const colW = w != null ? w : (hasCustomWidths ? defaultColWidth(col) : undefined);
                  return <col key={col.field} style={colW != null ? { width: colW } : undefined} />;
                })}
                {editMode && <col style={{ width: 44 }} />}
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
                  {effectiveColumns.map(col => (
                    <SortableHeader key={col.field} col={col} sortField={sortField} sortDir={sortDir} onSort={handleSort}
                      activeFilters={activeFilters} onFilterApply={handleFilterApply} openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol}
                      onResizeStart={onResizeStart} onResizeReset={resetColumn}
                      currentWidth={colWidths[col.field] != null ? colWidths[col.field] : defaultColWidth(col)}
                      onColDragStart={(f) => setColDrag({ from: f, over: null })}
                      onColDragOver={(f) => setColDrag(d => (d.from && d.over !== f ? { ...d, over: f } : d))}
                      onColDrop={(f) => { reorderColumns(colDrag.from, f); setColDrag({ from: null, over: null }); }}
                      onColDragEnd={() => setColDrag({ from: null, over: null })}
                      isColDragging={colDrag.from === col.field}
                      isColDragOver={!!colDrag.from && colDrag.over === col.field && colDrag.from !== col.field} />
                  ))}
                  {editMode && (
                    <th style={{
                      width: 44, borderBottom: `1px solid ${C.border}`,
                      background: C.card, position: 'sticky', top: 0, right: 0, zIndex: 6,
                      boxShadow: '-6px 0 8px -8px rgba(7,17,31,0.25)',
                    }} aria-label="Row actions" />
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={effectiveColumns.length + (editMode ? 2 : 0)} style={{ padding: '40px 20px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
                    {dataPending
                      ? <>Loading matching records…</>
                      : data.length === 0
                      ? <>No {pluralizeLabel(newLabel ? newLabel.toLowerCase() : '')} yet. <span onClick={onNew} style={{ color: '#1a5a8a', cursor: 'pointer', textDecoration: 'underline' }}>Create one</span></>
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
                      {effectiveColumns.map(col => {
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
                            // Overlay is keyed by the display field (col.field),
                            // which for FK columns differs from the DB columnName.
                            const ov = overlayValue(key, col.field);
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
                                onSave={(newValue, displayValue) => saveSingleCell(key, col.field, columnName, newValue, displayValue)}
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
                      {editMode && (
                        <td style={{
                          width: 44, padding: '4px 6px', textAlign: 'center',
                          borderBottom: `1px solid ${C.border}`,
                          position: 'sticky', right: 0, zIndex: 1,
                          background: isSelected ? '#f0faf6' : C.card,
                          boxShadow: '-6px 0 8px -8px rgba(7,17,31,0.25)',
                        }} onClick={(e) => e.stopPropagation()}>
                          {key && (
                            <RowActionMenu
                              disabled={bulkBusy}
                              onEdit={() => handleRowEdit(r)}
                              onClone={() => handleRowClone(r)}
                              onDelete={() => handleRowDelete(r)}
                            />
                          )}
                        </td>
                      )}
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
                {effectiveColumns.filter(c => !['id', 'name', 'status', 'stage'].includes(c.field)).map(col => {
                  const v = selectedRow[col.field];
                  const display = col.field === 'amount'
                    ? (typeof v === 'number' ? `$${v.toLocaleString()}` : (v == null || v === '' ? '—' : String(v)))
                    : (v || '—');
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

      {showFilterPanel && (
        <FilterSidebar
          catalog={filterCatalog}
          groups={columnGroups}
          activeFilters={activeFilters}
          filterLogic={filterLogic}
          onApply={(nf, nextLogic) => {
            userInteractedRef.current = true;
            setActiveFilters(nf);
            setFilterLogic(nextLogic || MATCH_ALL);
            setIsDirty(true);
          }}
          onClose={() => setShowFilterPanel(false)}
        />
      )}
      {showSave && <SaveViewModal activeFilters={activeFilters} sortField={sortField} sortDir={sortDir} cols={effectiveColumns} onSave={handleSave} onSaveAsNew={handleSaveAsNew} onClose={() => { setShowSave(false); setEditingView(null); }} editing={editingView} persistEnabled={persistEnabled} hasRole={hasRole} />}
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
      {editMode && confirmDelete && (
        <ConfirmDeleteModal
          count={confirmDelete.ids.length}
          label={newLabel}
          busy={bulkBusy}
          onCancel={() => { if (!bulkBusy) setConfirmDelete(null); }}
          onConfirm={() => runDelete(confirmDelete.ids)}
        />
      )}
    </div>
  );
}

// RowActionMenu — the trailing per-row "⋯" menu (Edit / Clone / Delete). The
// dropdown is portaled to <body> and fixed-positioned to the button so it is
// never clipped by the table's overflow:auto scroll container. Closes on
// outside click, Escape, or scroll.
function RowActionMenu({ onEdit, onClone, onDelete, disabled }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    // Capture-phase scroll so scrolling any ancestor (incl. the table) closes it.
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (e) => {
    e.stopPropagation();
    setRect(e.currentTarget.getBoundingClientRect());
    setOpen(o => !o);
  };

  const item = (label, handler, danger) => (
    <button
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); handler(); }}
      style={{
        display: 'flex', alignItems: 'center', width: '100%', gap: 8,
        padding: '8px 12px', fontSize: 12.5, textAlign: 'left',
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: danger ? '#1a5a8a' : C.textPrimary,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = C.page; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >{label}</button>
  );

  return (
    <>
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={toggle}
        disabled={disabled}
        title="Row actions"
        style={{
          width: 28, height: 28, borderRadius: 6, border: 'none',
          background: open ? C.page : 'transparent', cursor: disabled ? 'not-allowed' : 'pointer',
          color: C.textSecondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, lineHeight: 1,
        }}
      >⋯</button>
      {open && rect && createPortal(
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', top: rect.bottom + 4, left: Math.max(8, rect.right - 168),
            width: 168, background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 8, boxShadow: '0 8px 28px rgba(7,17,31,0.18)', zIndex: 9500,
            padding: '4px 0', overflow: 'hidden',
          }}
        >
          {item('Edit', onEdit)}
          {item('Clone', onClone)}
          <div style={{ height: 1, background: C.border, margin: '4px 0' }} />
          {item('Delete', onDelete, true)}
        </div>,
        document.body
      )}
    </>
  );
}

// ConfirmDeleteModal — recycle-bin confirmation for bulk or single-row delete.
function ConfirmDeleteModal({ count, label, busy, onCancel, onConfirm }) {
  const noun = count === 1 ? (label ? label.toLowerCase() : 'record') : pluralizeLabel(label ? label.toLowerCase() : 'record');
  return (
    <div onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(7,17,31,0.55)', zIndex: 9600,
               display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: C.card, borderRadius: 10, width: 'min(440px, 100%)',
                 boxShadow: '0 12px 40px rgba(7,17,31,0.4)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 4px', fontSize: 15, fontWeight: 600, color: C.textPrimary }}>
          Move {count.toLocaleString()} {noun} to the recycle bin?
        </div>
        <div style={{ padding: '4px 20px 16px', fontSize: 12.5, color: C.textSecondary, lineHeight: 1.5 }}>
          {count === 1 ? 'This record' : 'These records'} will be soft-deleted and can be restored
          from the recycle bin. Related records are handled by the standard cascade rules.
        </div>
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.border}`,
                      display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={busy} style={bulkSecondaryBtn}>Cancel</button>
          <button onClick={onConfirm} disabled={busy}
            style={{ ...bulkPrimaryBtn, background: busy ? C.border : '#7eb3e8',
                     cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
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

  const [hover, setHover] = useState(false);
  return (
    <td style={{
      padding: 0,
      borderBottom: `1px solid ${C.border}`,
      cursor: 'cell',
      position: 'relative',
      background: errorHere ? '#e8f1fb' : (overlayVal !== undefined ? '#f0faf6' : (hover ? '#f7faff' : undefined)),
    }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onDoubleClick={(e) => { e.stopPropagation(); if (!isSaving) onStartEdit(); }}
        title="Double-click to edit">
      {isSaving ? (
        <div style={{ padding: '11px 12px', color: C.textMuted, fontStyle: 'italic', fontSize: 12 }}>Saving…</div>
      ) : (
        // View state: show the just-saved overlay value when present, else the
        // baseCell contents. baseCell is already a <td> produced by
        // defaultCell/renderCell — we render its `children` inside this td.
        <div style={{ padding: '11px 12px', fontSize: 12, color: C.textPrimary, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {overlayVal !== undefined
              ? overlayVal
              : ((baseCell?.props?.children !== undefined) ? baseCell.props.children : baseCell)}
          </span>
          {/* Pencil affordance on hover so inline edit is discoverable. */}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={2}
               style={{ opacity: hover ? 0.8 : 0, flexShrink: 0, transition: 'opacity 120ms' }}>
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </div>
      )}
      {errorHere && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 10,
          background: '#1a5a8a', color: '#fff', fontSize: 11,
          padding: '4px 8px', borderRadius: '0 0 4px 4px', maxWidth: 280,
        }}>{errorHere}</div>
      )}
    </td>
  );
}

// CellEditor: the in-place input for whatever type the field is.
function CellEditor({ meta, initialValue, onSave, onCancel }) {
  const [value, setValue] = useState(initialValue ?? '');
  // Human-readable label for the current value — set by the picklist/lookup
  // editors (which know the chosen option's label). undefined for scalar types,
  // where the value itself is the display.
  const displayRef = useRef(undefined);
  const editorType = meta?.editorType || 'text';

  const commit = () => {
    let toSend = value;
    if (editorType === 'number' && value !== '' && value !== null) {
      const n = Number(value);
      if (Number.isNaN(n)) { onCancel(); return; }
      toSend = n;
    }
    if (value === '' || value === null) toSend = null;
    // Compute the display string shown in the cell right after saving.
    let disp;
    if (editorType === 'picklist' || editorType === 'lookup') {
      disp = toSend == null ? '—' : (displayRef.current ?? String(toSend));
    } else if (editorType === 'boolean') {
      disp = toSend === true ? 'Yes' : toSend === false ? 'No' : '—';
    } else {
      disp = (toSend == null || toSend === '') ? '—' : String(toSend);
    }
    onSave(toSend, disp);
  };
  const onKey = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };
  const pick = (id, label) => { setValue(id); displayRef.current = label; };

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
    return <PicklistInlineEditor meta={meta} value={value} pick={pick} commit={commit} onCancel={onCancel} />;
  }
  if (editorType === 'lookup' && meta?.referencesTable) {
    return <LookupInlineEditor meta={meta} value={value} pick={pick} commit={commit} onCancel={onCancel} />;
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
    return <input autoFocus type="number" min={0} value={value ?? ''}
                  onChange={(e) => setValue(clampNonNegative(e.target.value))}
                  onBlur={commit} onKeyDown={composeKeyDown(onKey)} style={inlineEditorStyle} />;
  }
  return <input autoFocus type="text" value={value ?? ''} onChange={(e) => setValue(e.target.value)}
                onBlur={commit} onKeyDown={onKey} style={inlineEditorStyle} />;
}

function PicklistInlineEditor({ meta, value, pick, commit, onCancel }) {
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
      onChange={(e) => {
        const id = e.target.value || null;
        const label = id ? (e.target.options[e.target.selectedIndex]?.text || null) : '—';
        pick(id, label);
      }}
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

function LookupInlineEditor({ meta, value, pick, commit, onCancel }) {
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
            pick(options[0].id, options[0].label);
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
                 onMouseDown={(e) => { e.preventDefault(); pick(o.id, o.label); setTimeout(() => commit(), 0); }}
                 style={{ padding: '7px 10px', fontSize: 12, cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// BulkEditModal — Salesforce-style "Edit fields" across the selected records.
// Supports editing MULTIPLE fields in a single apply (add as many field/value
// rows as you like); all changes are written in one bulk_update_records call.
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

  // Each entry is one field being set: { id, field, value }.
  const [entries, setEntries] = useState([{ id: 1, field: '', value: '' }]);
  const nextId = useRef(2);
  const [working, setWorking] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState(null);

  const chosen = new Set(entries.map(e => e.field).filter(Boolean));
  const updateEntry = (id, patch) =>
    setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
  const addEntry = () => setEntries(prev => [...prev, { id: nextId.current++, field: '', value: '' }]);
  const removeEntry = (id) => setEntries(prev => (prev.length > 1 ? prev.filter(e => e.id !== id) : prev));

  const activeEntries = entries.filter(e => e.field);

  const apply = async () => {
    if (activeEntries.length === 0) return;
    setWorking(true); setError(null); setResult(null);
    try {
      const updates = {};
      for (const e of activeEntries) {
        const meta = fieldMeta.get(e.field);
        updates[e.field] = e.value === '' || e.value === null ? null
          : meta?.editorType === 'number'  ? Number(e.value)
          : meta?.editorType === 'boolean' ? (e.value === 'true')
          : e.value;
      }
      const summary = await bulkUpdateRecords(tableName, recordIds, updates);
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
            Edit fields across {recordIds.length.toLocaleString()} record{recordIds.length === 1 ? '' : 's'}
          </div>
          <button onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: '14px 18px', overflowY: 'auto', flex: 1 }}>
          {entries.map((entry, idx) => {
            const meta = entry.field ? fieldMeta.get(entry.field) : null;
            // Options: this row's own field plus any field not chosen elsewhere.
            const opts = editableFields.filter(f => f.columnName === entry.field || !chosen.has(f.columnName));
            return (
              <div key={entry.id} style={{
                marginBottom: 12, paddingBottom: 12,
                borderBottom: idx < entries.length - 1 ? `1px dashed ${C.border}` : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <label style={{ ...bulkLabel, marginBottom: 0, flex: 1 }}>Field {entries.length > 1 ? idx + 1 : ''}</label>
                  {entries.length > 1 && (
                    <button onClick={() => removeEntry(entry.id)}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 12 }}>
                      Remove
                    </button>
                  )}
                </div>
                <select value={entry.field} onChange={(e) => updateEntry(entry.id, { field: e.target.value, value: '' })} style={bulkInput}>
                  <option value="">— Select a field —</option>
                  {opts.map(f => (
                    <option key={f.columnName} value={f.columnName}>{f.label} ({f.meta.editorType})</option>
                  ))}
                </select>
                {entry.field && (
                  <div style={{ marginTop: 8 }}>
                    <label style={bulkLabel}>New value</label>
                    <BulkValueEditor meta={meta} value={entry.value} setValue={(v) => updateEntry(entry.id, { value: v })} />
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                      Leave blank to clear this field on all selected records.
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {editableFields.length > chosen.size && (
            <button onClick={addEntry}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent',
                       border: `1px dashed ${C.borderDark || C.border}`, borderRadius: 6, padding: '6px 12px',
                       fontSize: 12.5, color: C.textSecondary, cursor: 'pointer', marginBottom: 8 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M12 5v14M5 12h14" /></svg>
              Add another field
            </button>
          )}
          {error && (
            <div style={{ padding: '10px 12px', background: '#e8f1fb', color: '#1a5a8a', fontSize: 12, borderRadius: 6, marginBottom: 12 }}>
              {error}
            </div>
          )}
          {result && (
            <div style={{ padding: '12px 14px',
                          background: result.records_errored > 0 ? '#e8f1fb' : '#e8f8f2',
                          color:      result.records_errored > 0 ? '#1a5a8a' : '#1a7a4e',
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
          <button onClick={apply} disabled={activeEntries.length === 0 || working}
            style={{ ...bulkPrimaryBtn,
                     background: (activeEntries.length === 0 || working) ? C.border : '#3ecf8e',
                     cursor: (activeEntries.length === 0 || working) ? 'not-allowed' : 'pointer' }}>
            {working ? 'Applying…' : `Apply${activeEntries.length > 1 ? ` (${activeEntries.length} fields)` : ''}`}
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
  if (meta.editorType === 'number')   return <input type="number" min={0} value={value} onChange={(e) => setValue(clampNonNegative(e.target.value))} onKeyDown={blockNegativeKeys()} style={bulkInput} />;
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
