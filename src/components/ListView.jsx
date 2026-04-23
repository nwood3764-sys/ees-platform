import { useState, useMemo, useRef, useEffect } from 'react';
import { C } from '../data/constants';
import { useIsMobile } from '../lib/useMediaQuery';
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
export function ListView({ data, columns, systemViews, defaultViewId, newLabel, renderCell, renderDetail, onNew, onOpenRecord }) {
  const firstView = systemViews.find(v => v.id === defaultViewId) || systemViews[0];
  const isMobile = useIsMobile();

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

  // ── Mobile card value formatter ────────────────────────────────────────────
  // Returns a JSX snippet (no <td>) suitable for rendering inside a card row.
  // Mirrors the special cases from defaultCell but without table markup.
  const cardValue = (col, r) => {
    const v = r[col.field];
    if (v === null || v === undefined || v === '') return <span style={{ color: C.textMuted }}>—</span>;
    if (col.field === 'status' || col.field === 'stage') return <Badge s={v} />;
    if (col.field === 'program') return <ProgramTag value={v} />;
    if (col.field === 'amount') return <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>${Number(v).toLocaleString()}</span>;
    if (col.field === 'email') return <span style={{ color: '#1a5a8a' }}>{v}</span>;
    if (col.field === 'id') return <span style={{ fontFamily: 'JetBrains Mono, monospace', color: C.textMuted }}>{v}</span>;
    return <span>{String(v)}</span>;
  };

  // Pick up to 2 "secondary" fields for the body of each card — skip the ones
  // already shown in the header (id, name, status, stage).
  const secondaryCols = columns
    .filter(c => !['id', 'name', 'status', 'stage'].includes(c.field))
    .slice(0, 2);

  // ─── Mobile render ───────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.page }}>
        {/* Mobile toolbar: view selector on top row, search + new on second */}
        <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <button onClick={() => setShowViewSel(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontSize: 14, color: C.textPrimary, cursor: 'pointer', fontWeight: 500, width: '100%' }}>
                <Icon path="M4 6h16M4 10h16M4 14h16M4 18h16" size={14} color={C.textSecondary} />
                <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeViewName}</span>
                {isDirty && <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.amber, flexShrink: 0 }} />}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={2}><path d="M19 9l-7 7-7-7" /></svg>
              </button>
              {showViewSel && <ViewSelector activeViewId={activeViewId} systemViews={systemViews} personalViews={personalViews} onSelect={applyView} onClose={() => setShowViewSel(false)} />}
            </div>
            <button onClick={onNew} aria-label={`New ${newLabel}`}
              style={{ background: C.emerald, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}><path d="M12 5v14M5 12h14" /></svg>
              New
            </button>
          </div>

          <div style={{ position: 'relative' }}>
            <input placeholder="Search..." value={globalSearch} onChange={e => setGlobalSearch(e.target.value)}
              style={{ width: '100%', background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '9px 10px 9px 32px', color: C.textPrimary, outline: 'none' }} />
            <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={2}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          </div>

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

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: C.textMuted }}>
            <span>{filtered.length} record{filtered.length === 1 ? '' : 's'}</span>
            {totalAmount !== null && <span>${Math.round(totalAmount / 1000)}K pipeline</span>}
            {totalUnits !== null && totalAmount === null && <span>{filtered.reduce((s, r) => s + (r.units || 0), 0).toLocaleString()} units</span>}
          </div>
        </div>

        {/* Card list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 24px', WebkitOverflowScrolling: 'touch' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
              No records match the current filters.{' '}
              <span onClick={clearAll} style={{ color: '#1a5a8a', cursor: 'pointer', textDecoration: 'underline' }}>Clear filters</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.map(r => {
                const statusVal = r.status || r.stage;
                return (
                  <div
                    key={r.id}
                    onClick={() => onOpenRecord && onOpenRecord(r)}
                    style={{
                      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
                      padding: 14, cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(13, 26, 46, 0.04)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        {r.id && (
                          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: C.textMuted, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {r.id}
                          </div>
                        )}
                        <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, lineHeight: 1.35, wordBreak: 'break-word' }}>
                          {r.name || '(no name)'}
                        </div>
                      </div>
                      {statusVal && <div style={{ flexShrink: 0 }}><Badge s={statusVal} /></div>}
                    </div>

                    {secondaryCols.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {secondaryCols.map(col => (
                          <div key={col.field} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 13 }}>
                            <span style={{ color: C.textMuted, flexShrink: 0 }}>{col.label}</span>
                            <span style={{ color: C.textSecondary, textAlign: 'right', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {cardValue(col, r)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {showSave && <SaveViewModal activeFilters={activeFilters} sortField={sortField} sortDir={sortDir} cols={columns} onSave={handleSave} onClose={() => setShowSave(false)} />}
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
                    No records match the current filters.{' '}
                    <span onClick={clearAll} style={{ color: '#1a5a8a', cursor: 'pointer', textDecoration: 'underline' }}>Clear filters</span>
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
