import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'
import { Icon } from './UI'

/**
 * Salesforce-style gear menu shown in the top-right toolbar of every record
 * detail page. Admin-only — renders nothing for non-admin roles. The three
 * quick-links shortcut the most common Setup paths while iterating on the
 * platform:
 *
 *   - Edit Page Layout — opens the page layout for this object + record type
 *     directly in Setup (RecordDetail on a `page_layouts` row). Resolves the
 *     correct layout UUID via the (object, record_type_id, default) tuple
 *     so the user lands on the exact layout that produced the current page.
 *   - Edit Object — opens Setup → Object Manager so the user can edit
 *     columns, validation rules, and record-type definitions for this table.
 *   - Edit Record Types — opens Setup → Record Types so the user can
 *     activate/deactivate record types or rename them.
 *
 * The component owns its own dropdown state and outside-click handler. The
 * action callbacks come in via the `onOpenSetup` prop (provided by App.jsx
 * → module → RecordDetail) which navigates to /m/admin/<nodeId>. For the
 * page-layout link we use `onNavigateToRecord` with table='page_layouts'
 * because that table is wired into TABLE_MODULE_MAP→'admin' specifically
 * to support this deep-link pattern.
 */
export default function RecordSetupMenu({
  tableName,
  recordTypeId,
  isAdmin,
  onOpenSetup,
  onNavigateToRecord,
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef(null)

  // Outside-click closes the menu. We listen on mousedown rather than click
  // so the menu doesn't reopen on the same gesture that closed it.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const handleEditPageLayout = useCallback(async () => {
    setOpen(false)
    if (busy) return
    setBusy(true)
    try {
      // Find the default page layout for this object + record type. The
      // RecordDetail page is rendered against this exact tuple, so this
      // is the layout the user wants to edit. Falls back to any default
      // layout for the object if the record-type-specific one is missing.
      let layoutId = null
      if (recordTypeId) {
        const { data } = await supabase
          .from('page_layouts')
          .select('id')
          .eq('page_layout_object', tableName)
          .eq('page_layout_type', 'record_detail')
          .eq('record_type_id', recordTypeId)
          .eq('page_layout_is_default', true)
          .eq('is_deleted', false)
          .limit(1)
          .maybeSingle()
        layoutId = data?.id || null
      }
      if (!layoutId) {
        // Fallback — default layout with no record-type binding
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
      if (layoutId && onNavigateToRecord) {
        onNavigateToRecord({ table: 'page_layouts', id: layoutId, mode: 'view' })
      } else if (onOpenSetup) {
        // No specific layout found — open the page-layout list instead so
        // the user can pick one or create one. Beats showing a dead end.
        onOpenSetup('page_layouts')
      }
    } finally {
      setBusy(false)
    }
  }, [tableName, recordTypeId, onNavigateToRecord, onOpenSetup, busy])

  const handleEditObject = useCallback(() => {
    setOpen(false)
    if (onOpenSetup) onOpenSetup('object_manager')
  }, [onOpenSetup])

  const handleEditRecordTypes = useCallback(() => {
    setOpen(false)
    if (onOpenSetup) onOpenSetup('record_types')
  }, [onOpenSetup])

  if (!isAdmin) return null

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Setup quick links"
        aria-label="Setup quick links"
        aria-expanded={open}
        style={{
          background: open ? '#eef2f7' : C.page,
          color: C.textSecondary,
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          padding: '7px 10px',
          fontSize: 12.5,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = '#eef2f7' }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = C.page }}
      >
        {/* Cog icon — same path used in the sidebar Setup link */}
        <Icon path="M10.325 4.317a1 1 0 011.35 0l.99.99a1 1 0 001.13.18l1.32-.55a1 1 0 011.36.55l.5 1.36a1 1 0 00.78.78l1.36.5a1 1 0 01.55 1.36l-.55 1.32a1 1 0 00.18 1.13l.99.99a1 1 0 010 1.35l-.99.99a1 1 0 00-.18 1.13l.55 1.32a1 1 0 01-.55 1.36l-1.36.5a1 1 0 00-.78.78l-.5 1.36a1 1 0 01-1.36.55l-1.32-.55a1 1 0 00-1.13.18l-.99.99a1 1 0 01-1.35 0l-.99-.99a1 1 0 00-1.13-.18l-1.32.55a1 1 0 01-1.36-.55l-.5-1.36a1 1 0 00-.78-.78l-1.36-.5a1 1 0 01-.55-1.36l.55-1.32a1 1 0 00-.18-1.13l-.99-.99a1 1 0 010-1.35l.99-.99a1 1 0 00.18-1.13l-.55-1.32a1 1 0 01.55-1.36l1.36-.5a1 1 0 00.78-.78l.5-1.36a1 1 0 011.36-.55l1.32.55a1 1 0 001.13-.18l.99-.99zM12 15a3 3 0 100-6 3 3 0 000 6z" size={14} color={C.textSecondary} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            minWidth: 200,
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
          <MenuItem label="Edit Page Layout"  hint="For this object + record type" onClick={handleEditPageLayout} disabled={busy} />
          <MenuItem label="Edit Object"        hint="Columns, validations, record types" onClick={handleEditObject} />
          <MenuItem label="Edit Record Types"  hint="Activate, rename, reorder" onClick={handleEditRecordTypes} />
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
