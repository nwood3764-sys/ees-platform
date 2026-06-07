import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'
import { Icon } from './UI'
import { getRecordTypeColumn, getCurrentUserProfile } from '../data/layoutService'

/**
 * Salesforce-style gear menu that lives in the global topbar (not on every
 * record detail page like the previous version). Admin-only — renders
 * nothing for non-admin roles. Menu items adapt based on whether the user
 * is currently viewing a record:
 *
 *   - On a record page (selectedRecord populated):
 *       Edit Page Layout    — resolves to the layout for (object + record type)
 *       Edit Object         — opens Object Manager → this object's detail
 *       Edit Record Types   — opens Object Manager → record types sub-tab
 *   - On a non-record page:
 *       Open Setup          — single jump to /m/admin
 *
 * The record_type lookup happens lazily when the menu opens, not on every
 * navigation, so there is no per-page query overhead. Cached for the
 * lifetime of the current selectedRecord so re-opening the menu while on
 * the same record is instant.
 */
export default function TopbarSetupGear({
  selectedRecord,
  listTable,
  onOpenSetup,
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  // Cached record_type for the current selectedRecord. Cleared whenever the
  // selectedRecord changes — guards against showing the wrong layout link
  // if the user navigates from one record to another with the menu closed.
  const [resolvedRecordTypeId, setResolvedRecordTypeId] = useState(null)
  const wrapRef = useRef(null)

  // The object the gear acts on: the open record's table when viewing a
  // record, otherwise the current list page's table (so the gear deep-links to
  // the right object's setup from a list, not the generic Setup home).
  const effectiveTable = selectedRecord?.table || listTable || null

  // Admin gate — fetch once on mount.
  useEffect(() => {
    let cancelled = false
    getCurrentUserProfile()
      .then(({ roleName }) => { if (!cancelled) setIsAdmin(roleName === 'Admin') })
      .catch(() => { /* leave isAdmin false */ })
    return () => { cancelled = true }
  }, [])

  // Reset the resolved record_type when the user moves to a different
  // record. The lazy fetch in the menu-open handler picks up the right one.
  useEffect(() => {
    setResolvedRecordTypeId(null)
  }, [selectedRecord?.table, selectedRecord?.id])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // When the menu opens on a record page, lazily fetch the record's record_type
  // so Edit Page Layout can resolve the right layout.
  const handleOpen = useCallback(async () => {
    setOpen(o => !o)
    if (resolvedRecordTypeId !== null) return
    if (!selectedRecord?.table || !selectedRecord?.id) return
    const rtCol = getRecordTypeColumn(selectedRecord.table)
    if (!rtCol || rtCol === 'record_type') return  // table has no record-type column
    try {
      const { data } = await supabase
        .from(selectedRecord.table)
        .select(`id, ${rtCol}`)
        .eq('id', selectedRecord.id)
        .maybeSingle()
      setResolvedRecordTypeId(data?.[rtCol] || null)
    } catch {
      /* failed — Edit Page Layout will fall back to default layout */
    }
  }, [selectedRecord, resolvedRecordTypeId])

  const handleEditPageLayout = useCallback(async () => {
    setOpen(false)
    if (busy) return
    setBusy(true)
    try {
      const tableName = effectiveTable
      if (!tableName) return
      // Find the default page layout for (object, record_type). Falls back to
      // the object's default layout if no record-type-specific one exists.
      let layoutId = null
      if (resolvedRecordTypeId) {
        const { data } = await supabase
          .from('page_layouts')
          .select('id')
          .eq('page_layout_object', tableName)
          .eq('page_layout_type', 'record_detail')
          .eq('record_type_id', resolvedRecordTypeId)
          .eq('page_layout_is_default', true)
          .eq('is_deleted', false)
          .limit(1)
          .maybeSingle()
        layoutId = data?.id || null
      }
      if (!layoutId) {
        const { data } = await supabase
          .from('page_layouts')
          .select('id')
          .eq('page_layout_object', tableName)
          .eq('page_layout_type', 'record_detail')
          .eq('page_layout_is_default', true)
          .eq('is_deleted', false)
          .limit(1)
          .maybeSingle()
        layoutId = data?.id || null
      }
      // Deep-link into Object Manager's Page Layouts sub-tab with the
      // specific layout pre-selected. ObjectDetail reads initialLayoutId
      // from the ?layout= URL param and renders LayoutEditor directly.
      // Previously this opened RecordDetail on the page_layouts row itself,
      // which just shows the metadata row, not the real editor with
      // sections/fields/drag-and-drop.
      if (onOpenSetup) {
        if (layoutId) {
          onOpenSetup('objects', tableName, { initialSubTab: 'layouts', initialLayoutId: layoutId })
        } else {
          // No matching layout — fall back to the Page Layouts list for
          // this object so the admin can pick one or create one.
          onOpenSetup('objects', tableName, { initialSubTab: 'layouts' })
        }
      }
    } finally {
      setBusy(false)
    }
  }, [effectiveTable, resolvedRecordTypeId, onOpenSetup, busy])

  const handleEditObject = useCallback(() => {
    setOpen(false)
    if (!onOpenSetup) return
    const tableName = effectiveTable
    if (tableName) onOpenSetup('objects', tableName)
    else onOpenSetup('objects')
  }, [onOpenSetup, effectiveTable])

  const handleEditRecordTypes = useCallback(() => {
    setOpen(false)
    if (!onOpenSetup) return
    // Edit Record Types lives inside ObjectDetail under the Record Types
    // sub-tab. We deep-link to that object with a query param the AdminModule
    // reads to pre-select the recordtypes sub-tab.
    const tableName = effectiveTable
    if (tableName) onOpenSetup('objects', tableName, { initialSubTab: 'recordtypes' })
    else onOpenSetup('objects')
  }, [onOpenSetup, effectiveTable])

  const handleOpenSetup = useCallback(() => {
    setOpen(false)
    if (onOpenSetup) onOpenSetup(null)  // /m/admin, no section
  }, [onOpenSetup])

  if (!isAdmin) return null

  const onRecordPage = !!(selectedRecord?.table && selectedRecord?.id)

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={handleOpen}
        title="Setup"
        aria-label="Setup"
        aria-expanded={open}
        style={{
          background: open ? '#eef2f7' : 'transparent',
          color: C.textSecondary,
          border: 'none',
          borderRadius: 6,
          padding: 6,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = '#eef2f7' }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        <Icon path="M10.325 4.317a1 1 0 011.35 0l.99.99a1 1 0 001.13.18l1.32-.55a1 1 0 011.36.55l.5 1.36a1 1 0 00.78.78l1.36.5a1 1 0 01.55 1.36l-.55 1.32a1 1 0 00.18 1.13l.99.99a1 1 0 010 1.35l-.99.99a1 1 0 00-.18 1.13l.55 1.32a1 1 0 01-.55 1.36l-1.36.5a1 1 0 00-.78.78l-.5 1.36a1 1 0 01-1.36.55l-1.32-.55a1 1 0 00-1.13.18l-.99.99a1 1 0 01-1.35 0l-.99-.99a1 1 0 00-1.13-.18l-1.32.55a1 1 0 01-1.36-.55l-.5-1.36a1 1 0 00-.78-.78l-1.36-.5a1 1 0 01-.55-1.36l.55-1.32a1 1 0 00-.18-1.13l-.99-.99a1 1 0 010-1.35l.99-.99a1 1 0 00.18-1.13l-.55-1.32a1 1 0 01.55-1.36l1.36-.5a1 1 0 00.78-.78l.5-1.36a1 1 0 011.36-.55l1.32.55a1 1 0 001.13-.18l.99-.99zM12 15a3 3 0 100-6 3 3 0 000 6z" size={18} color={C.textSecondary} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 240,
            background: '#fff',
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            boxShadow: '0 6px 16px rgba(15, 23, 42, 0.10)',
            zIndex: 50,
            padding: '4px 0',
          }}
        >
          <div style={{
            padding: '6px 14px 4px',
            fontSize: 10.5,
            fontWeight: 600,
            color: C.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}>
            Setup
          </div>
          {effectiveTable ? (
            <>
              <MenuItem label="Edit Page Layout"  hint={onRecordPage ? 'For this object + record type' : 'Default layout for this object'} onClick={handleEditPageLayout} disabled={busy} />
              <MenuItem label="Edit Object"        hint="Columns, validations, record types" onClick={handleEditObject} />
              <MenuItem label="Edit Record Types"  hint="Activate, rename, reorder" onClick={handleEditRecordTypes} />
              <div style={{ borderTop: `1px solid ${C.border}`, margin: '4px 0' }} />
            </>
          ) : null}
          <MenuItem label="Open Setup" hint="Setup home" onClick={handleOpenSetup} />
        </div>
      )}
    </div>
  )
}

function MenuItem({ label, hint, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role="menuitem"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'none',
        border: 'none',
        padding: '8px 14px',
        cursor: disabled ? 'wait' : 'pointer',
        color: C.textPrimary,
        opacity: disabled ? 0.6 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = '#f1f5f9' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>{hint}</div>}
    </button>
  )
}
