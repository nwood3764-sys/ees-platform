// =============================================================================
// BulkPropertyImportPane — Setup → Data → Bulk Property Import
//
// 4-step wizard for bulk-creating Account → Property → Building → Unit
// hierarchy from an XLSX file:
//
//   1) Download Template — pre-built workbook with column headers, an
//      instructions sheet, and example rows.
//   2) Upload — user picks the filled file. We parse it with SheetJS.
//   3) Preview — we call preview_property_hierarchy_import RPC to detect
//      collisions with existing rows in LEAP, and we run client-side checks
//      for in-file duplicates and validation errors. Each problem row gets
//      a recommendation badge and an override dropdown.
//   4) Confirm — calls import_property_hierarchy RPC inside one transaction.
//      Audit row written to bulk_import_runs. Success page shows counts.
//
// Address normalization mirrors the server-side `normalize_property_address`
// function so in-file dupes are detected the same way the DB does.
// =============================================================================

import { useCallback, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { C } from '../../data/constants'
import { Icon } from '../../components/UI'
import HelpIcon from '../../components/help/HelpIcon'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'

// ── Template definition ─────────────────────────────────────────────────
const TEMPLATE_COLUMNS = [
  { key: 'owner_name',             label: 'Owner Name',             required: true,  example: 'Mercy Housing Wisconsin' },
  { key: 'property_name',          label: 'Property Name',          required: true,  example: 'Maple Heights Apartments' },
  { key: 'property_street',        label: 'Property Street',        required: true,  example: '123 Main St' },
  { key: 'property_city',          label: 'Property City',          required: true,  example: 'Madison' },
  { key: 'property_state',         label: 'Property State',         required: true,  example: 'WI' },
  { key: 'property_zip',           label: 'Property Zip',           required: false, example: '53703' },
  { key: 'property_subsidy_type',  label: 'Subsidy Type',           required: false, example: 'LIHTC' },
  { key: 'building_name',          label: 'Building Name',          required: true,  example: 'Building A' },
  { key: 'building_year_built',    label: 'Year Built',             required: false, example: 1985 },
  { key: 'building_unit_count',    label: 'Unit Count',             required: true,  example: 12 },
  { key: 'building_notes',         label: 'Building Notes',         required: false, example: '' },
]

const REQUIRED_KEYS = TEMPLATE_COLUMNS.filter(c => c.required).map(c => c.key)
const VALID_STATES = ['WI','MI','NC','CO','IN']  // EES-WI's five-state list — warning if outside
const VALID_SUBSIDY = ['Section 8 / HUD','LIHTC','NOAH','DAC','NEST Community','Other']

// ── Address normalization (must match server normalize_property_address) ──
function normalizeAddress(street, city, state) {
  const raw = `${street || ''}|${city || ''}|${state || ''}`
  return raw
    .toLowerCase()
    .replace(/[.,#]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(st)\b/gi, 'street')
    .replace(/\b(ave|av)\b/gi, 'avenue')
    .replace(/\b(rd)\b/gi, 'road')
    .replace(/\b(blvd|bl)\b/gi, 'boulevard')
    .replace(/\b(dr)\b/gi, 'drive')
    .replace(/\b(ln)\b/gi, 'lane')
    .replace(/\b(ct)\b/gi, 'court')
    .replace(/\b(n|no)\b/gi, 'north')
    .toLowerCase()
}

function normalizeName(s) {
  return (s || '').toString().trim().replace(/\s+/g, ' ').toLowerCase()
}

// ── Template download ────────────────────────────────────────────────────
function buildTemplateWorkbook() {
  const wb = XLSX.utils.book_new()

  // Sheet 1: Data (headers + 2 example rows)
  const headers = TEMPLATE_COLUMNS.map(c => c.label)
  const example1 = TEMPLATE_COLUMNS.map(c => c.example)
  const example2 = ['Mercy Housing Wisconsin','Maple Heights Apartments','123 Main St','Madison','WI','53703','LIHTC','Building B',1987,18,'Across the courtyard from Building A']
  const blank = TEMPLATE_COLUMNS.map(() => '')
  const data = [headers, example1, example2, blank, blank, blank, blank, blank, blank, blank, blank]
  const ws = XLSX.utils.aoa_to_sheet(data)
  // Column widths
  ws['!cols'] = TEMPLATE_COLUMNS.map(c => ({ wch: Math.max(c.label.length + 2, String(c.example || '').length + 2, 16) }))
  XLSX.utils.book_append_sheet(wb, ws, 'Data')

  // Sheet 2: Instructions
  const instructions = [
    ['LEAP Property Hierarchy Import — Instructions'],
    [''],
    ['Do not change the column headers in the Data sheet. Add your rows starting on row 2.'],
    ['Example rows are provided for reference — delete or overwrite them before uploading.'],
    [''],
    ['One row per BUILDING.'],
    ['Repeat the Owner and Property columns on every building row at the same property.'],
    ['The importer deduplicates by name — if Owner "Mercy Housing Wisconsin" appears 50 times, only one Account is created.'],
    ['Same for Properties: deduplicated by Street + City + State (the address is the unique key).'],
    [''],
    ['COLUMNS:'],
    ...TEMPLATE_COLUMNS.map(c => [
      `${c.label}${c.required ? ' (required)' : ' (optional)'}`,
      c.key === 'property_state'        ? `2-letter state code. EES-WI's five states: ${VALID_STATES.join(', ')}. Other states allowed with a warning.`
      : c.key === 'property_subsidy_type' ? `Affordability category. Valid values: ${VALID_SUBSIDY.join(', ')}.`
      : c.key === 'building_unit_count' ? 'Integer ≥ 1. Importer auto-creates that many Unit records (Unit 1, Unit 2, …) under the building.'
      : c.key === 'building_year_built' ? 'Integer year (e.g. 1985). Leave blank if unknown.'
      : '',
      `Example: ${c.example}`,
    ]),
    [''],
    ['DEDUPLICATION:'],
    ['• Owner Name matched exact (case + whitespace insensitive). Variants ("Mercy Housing" vs "Mercy Housing Inc.") stay separate — clean your data first.'],
    ['• Property matched on normalized Street + City + State. "123 Main St" and "123 Main Street" are treated as the same address.'],
    ['• Building matched on Property + Building Name. Two buildings cannot share a name within the same property.'],
    [''],
    ['SUBSIDY TYPE valid values: ' + VALID_SUBSIDY.join(' | ')],
  ]
  const wsI = XLSX.utils.aoa_to_sheet(instructions)
  wsI['!cols'] = [{ wch: 30 }, { wch: 80 }, { wch: 35 }]
  XLSX.utils.book_append_sheet(wb, wsI, 'Instructions')

  return wb
}

function downloadTemplate() {
  const wb = buildTemplateWorkbook()
  XLSX.writeFile(wb, `LEAP_Property_Hierarchy_Import_Template.xlsx`)
}

// ── File parsing ─────────────────────────────────────────────────────────
async function parseUploadedFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const dataSheetName = wb.SheetNames.find(n => n.toLowerCase() === 'data') || wb.SheetNames[0]
  const ws = wb.Sheets[dataSheetName]
  // Parse to array-of-arrays so we control header mapping
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' })
  if (aoa.length < 1) throw new Error('Empty file — no rows found.')
  const headerRow = aoa[0].map(h => String(h || '').trim())

  // Map headers to template keys
  const headerToKey = {}
  for (const col of TEMPLATE_COLUMNS) {
    const idx = headerRow.findIndex(h => h.toLowerCase() === col.label.toLowerCase())
    if (idx < 0 && col.required) {
      throw new Error(`Required column "${col.label}" not found in file. Use the official template.`)
    }
    if (idx >= 0) headerToKey[col.key] = idx
  }

  const rows = []
  for (let r = 1; r < aoa.length; r++) {
    const raw = aoa[r]
    if (!raw || raw.every(v => v === '' || v == null)) continue
    const row = {}
    for (const [key, idx] of Object.entries(headerToKey)) {
      const cell = raw[idx]
      row[key] = cell == null ? '' : String(cell).trim()
    }
    rows.push(row)
  }
  return rows
}

// ── Client-side validation + in-file dup detection ───────────────────────
function analyzeRows(rows) {
  // Returns per-row { errors:[], warnings:[], in_file_dupe_property: false, in_file_dupe_building: false }
  const propertyAddrToRows = {}    // addrNorm -> [rowIndex]
  const propertyAddrToName = {}    // addrNorm -> set of distinct property names
  const buildingKeyToRows = {}     // addrNorm + '|' + bldgName -> [rowIndex]
  const ownerNameVariants = new Set()

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const addr = normalizeAddress(r.property_street, r.property_city, r.property_state)
    if (addr.replace(/\|/g, '').trim()) {
      if (!propertyAddrToRows[addr]) propertyAddrToRows[addr] = []
      propertyAddrToRows[addr].push(i)
      const pname = normalizeName(r.property_name)
      if (pname) {
        if (!propertyAddrToName[addr]) propertyAddrToName[addr] = new Set()
        propertyAddrToName[addr].add(pname)
      }
    }
    const bldg = normalizeName(r.building_name)
    if (addr && bldg) {
      const key = `${addr}||${bldg}`
      if (!buildingKeyToRows[key]) buildingKeyToRows[key] = []
      buildingKeyToRows[key].push(i)
    }
    if (r.owner_name) ownerNameVariants.add(normalizeName(r.owner_name))
  }

  const analysis = rows.map((r, idx) => ({
    row_index: idx,
    errors: [],
    warnings: [],
    in_file_dupe_building: false,
    in_file_property_name_conflict: false,
  }))

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const a = analysis[i]
    // Required fields
    for (const key of REQUIRED_KEYS) {
      if (!r[key] || !String(r[key]).trim()) {
        a.errors.push(`Missing required field: ${TEMPLATE_COLUMNS.find(c => c.key === key).label}`)
      }
    }
    // State must be a 2-letter code
    if (r.property_state && !/^[A-Z]{2}$/i.test(r.property_state)) {
      a.errors.push(`State must be a 2-letter code (got "${r.property_state}")`)
    } else if (r.property_state && !VALID_STATES.includes(r.property_state.toUpperCase())) {
      a.warnings.push(`State "${r.property_state.toUpperCase()}" is outside EES-WI's five-state list — will import anyway`)
    }
    // Unit count
    if (r.building_unit_count) {
      const n = Number(r.building_unit_count)
      if (!Number.isInteger(n) || n < 1) {
        a.errors.push(`Unit Count must be an integer ≥ 1 (got "${r.building_unit_count}")`)
      }
    }
    // Year built
    if (r.building_year_built) {
      const n = Number(r.building_year_built)
      const yr = new Date().getFullYear()
      if (!Number.isInteger(n) || n < 1800 || n > yr + 1) {
        a.errors.push(`Year Built must be an integer between 1800 and ${yr + 1} (got "${r.building_year_built}")`)
      }
    }
    // Subsidy type
    if (r.property_subsidy_type && !VALID_SUBSIDY.includes(r.property_subsidy_type)) {
      a.warnings.push(`Unknown Subsidy Type "${r.property_subsidy_type}" — will be left blank. Valid: ${VALID_SUBSIDY.join(', ')}`)
    }
    // In-file building dupes
    const addr = normalizeAddress(r.property_street, r.property_city, r.property_state)
    const bldg = normalizeName(r.building_name)
    if (addr && bldg) {
      const dupes = buildingKeyToRows[`${addr}||${bldg}`]
      if (dupes && dupes.length > 1 && dupes[0] !== i) {
        a.in_file_dupe_building = true
        a.errors.push(`Same building name "${r.building_name}" at the same property appears on row ${dupes[0] + 2} of the file`)
      }
    }
    // In-file property name variants for same address
    if (addr && propertyAddrToName[addr] && propertyAddrToName[addr].size > 1) {
      a.in_file_property_name_conflict = true
      a.warnings.push(`Property Name varies across rows that share this address — will use the first occurrence`)
    }
  }
  return analysis
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level pane
// ─────────────────────────────────────────────────────────────────────────
export default function BulkPropertyImportPane() {
  const toast = useToast()
  const fileInputRef = useRef(null)
  const [step, setStep] = useState(1)              // 1 download | 2 upload | 3 preview | 4 result
  const [filename, setFilename] = useState('')
  const [rows, setRows] = useState([])             // parsed rows
  const [analysis, setAnalysis] = useState([])     // per-row client-side analysis
  const [serverPreview, setServerPreview] = useState([])  // per-row server dedup result
  const [rowActions, setRowActions] = useState([]) // per-row chosen action
  const [parsing, setParsing] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState(null)
  const [parseError, setParseError] = useState(null)

  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setParsing(true)
    setParseError(null)
    try {
      const parsed = await parseUploadedFile(file)
      if (parsed.length === 0) throw new Error('No data rows found in the file.')
      setFilename(file.name)
      setRows(parsed)
      const localAnalysis = analyzeRows(parsed)
      setAnalysis(localAnalysis)
      // Call server preview
      setPreviewing(true)
      const { data, error } = await supabase.rpc('preview_property_hierarchy_import', { p_rows: parsed })
      if (error) throw error
      const arr = Array.isArray(data) ? data : []
      setServerPreview(arr)
      // Default each row's action to the server's suggested_action (or 'create' if none)
      setRowActions(arr.map(r => r.suggested_action || 'create'))
      setStep(3)
    } catch (err) {
      setParseError(err.message || String(err))
      toast.error(err.message || 'Could not parse file.')
    } finally {
      setParsing(false)
      setPreviewing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [toast])

  const handleApplyRecommendations = useCallback(() => {
    setRowActions(serverPreview.map(r => r.suggested_action || 'create'))
    toast.success('Applied recommended action to every flagged row.')
  }, [serverPreview, toast])

  // Counts
  const counts = useMemo(() => {
    let errors = 0, warnings = 0, clean = 0, skipped = 0
    for (let i = 0; i < rows.length; i++) {
      const a = analysis[i] || { errors: [], warnings: [] }
      const action = rowActions[i] || 'create'
      const hasHardError = a.errors.length > 0 ||
        (serverPreview[i]?.suggested_action === 'error_building_exists' && action !== 'skip_building')
      if (action === 'skip') { skipped++; continue }
      if (hasHardError) errors++
      else if (a.warnings.length > 0 || serverPreview[i]?.existing_property) warnings++
      else clean++
    }
    return { errors, warnings, clean, skipped, total: rows.length }
  }, [rows, analysis, serverPreview, rowActions])

  const handleCommit = useCallback(async () => {
    setCommitting(true)
    try {
      // Build payload: drop skip/error rows; attach chosen action
      const payload = rows.map((r, i) => {
        const action = rowActions[i] || 'create'
        if (action === 'error_building_exists') return null    // hard error, exclude
        if (action === 'skip') return null
        const a = analysis[i] || { errors: [] }
        if (a.errors.length > 0) return null                    // validation errors exclude
        return {
          ...r,
          building_year_built: r.building_year_built === '' ? null : Number(r.building_year_built) || null,
          building_unit_count: r.building_unit_count === '' ? null : Number(r.building_unit_count) || null,
          row_action: action,
        }
      }).filter(Boolean)

      if (payload.length === 0) {
        toast.error('Nothing to import — every row was excluded.')
        setCommitting(false)
        return
      }

      const { data, error } = await supabase.rpc('import_property_hierarchy', {
        p_rows: payload,
        p_source_filename: filename,
      })
      if (error) throw error
      setCommitResult(data)
      setStep(4)
      toast.success(`Imported ${data.processed_rows} rows. Created ${data.accounts_created} owners, ${data.properties_created} properties, ${data.buildings_created} buildings, ${data.units_created} units.`)
    } catch (err) {
      toast.error(err.message || 'Import failed.')
    } finally {
      setCommitting(false)
    }
  }, [rows, rowActions, analysis, filename, toast])

  const handleStartOver = useCallback(() => {
    setStep(1)
    setRows([])
    setAnalysis([])
    setServerPreview([])
    setRowActions([])
    setFilename('')
    setCommitResult(null)
    setParseError(null)
  }, [])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Bulk Property Import</div>
          <HelpIcon
            anchors={[
              { type: 'route', route: '/admin/bulk_property_import' },
              { type: 'concept', concept: 'bulk-import' },
              { type: 'concept', concept: 'property-hierarchy-import' },
            ]}
            title="Bulk Property Import"
          />
        </div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          Download a template, fill in Owner → Property → Building → Unit rows in Excel, upload, preview, commit. Deduplication is automatic — addresses are the unique key.
        </div>
        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 12 }}>
          {[
            { n: 1, label: 'Download Template' },
            { n: 2, label: 'Upload File' },
            { n: 3, label: 'Preview & Resolve' },
            { n: 4, label: 'Done' },
          ].map((s, idx, all) => (
            <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                background: step >= s.n ? '#3ecf8e' : '#e4e9f2',
                color: step >= s.n ? '#fff' : C.textMuted,
                fontSize: 11.5, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{s.n}</div>
              <div style={{ fontSize: 11.5, fontWeight: step === s.n ? 700 : 500, color: step >= s.n ? C.textPrimary : C.textMuted }}>{s.label}</div>
              {idx < all.length - 1 && (
                <div style={{ width: 24, height: 2, background: step > s.n ? '#3ecf8e' : '#e4e9f2', margin: '0 6px' }} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 24, background: '#f7f9fc' }}>
        {step === 1 && <Step1Download onNext={() => setStep(2)} />}

        {step === 2 && (
          <Step2Upload
            fileInputRef={fileInputRef}
            parsing={parsing || previewing}
            parseError={parseError}
            onPick={() => fileInputRef.current?.click()}
            onFile={handleFile}
          />
        )}

        {step === 3 && (
          <Step3Preview
            filename={filename}
            rows={rows}
            analysis={analysis}
            serverPreview={serverPreview}
            rowActions={rowActions}
            setRowActions={setRowActions}
            counts={counts}
            onApplyRecommendations={handleApplyRecommendations}
            onStartOver={handleStartOver}
            onCommit={handleCommit}
            committing={committing}
          />
        )}

        {step === 4 && commitResult && (
          <Step4Result result={commitResult} onAnother={handleStartOver} />
        )}
      </div>
    </div>
  )
}

// ── Step 1: Download Template ────────────────────────────────────────────
function Step1Download({ onNext }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: 24, maxWidth: 720,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, marginBottom: 6 }}>
        Step 1 — Download the template
      </div>
      <div style={{ fontSize: 12.5, color: C.textSecondary, lineHeight: 1.6, marginBottom: 16 }}>
        The template is a pre-built Excel workbook with the correct columns, example rows, and an instructions tab. One row per <strong>building</strong>. Repeat the Owner and Property columns on every building row at the same property — the importer deduplicates automatically.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={downloadTemplate}
          style={{
            background: '#3ecf8e', color: '#fff', border: 'none', borderRadius: 5,
            padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <Icon path="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4 M7 10l5 5 5-5 M12 15V3" size={13} color="currentColor" />
          Download template
        </button>
        <button
          onClick={onNext}
          style={{
            background: C.card, color: C.textSecondary,
            border: `1px solid ${C.border}`, borderRadius: 5,
            padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Already have a filled file →
        </button>
      </div>
    </div>
  )
}

// ── Step 2: Upload File ──────────────────────────────────────────────────
function Step2Upload({ fileInputRef, parsing, parseError, onPick, onFile }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: 24, maxWidth: 720,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, marginBottom: 6 }}>
        Step 2 — Upload your filled file
      </div>
      <div style={{ fontSize: 12.5, color: C.textSecondary, lineHeight: 1.6, marginBottom: 16 }}>
        Pick the .xlsx or .csv file you filled in from the template. The importer will parse it and run a preview check before anything writes to the database.
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={onFile}
        style={{ display: 'none' }}
      />
      <button
        onClick={onPick}
        disabled={parsing}
        style={{
          background: '#3ecf8e', color: '#fff', border: 'none', borderRadius: 5,
          padding: '9px 18px', fontSize: 13, fontWeight: 700,
          cursor: parsing ? 'wait' : 'pointer',
          opacity: parsing ? 0.6 : 1,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >
        <Icon path="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4 M17 8l-5-5-5 5 M12 3v12" size={13} color="currentColor" />
        {parsing ? 'Parsing…' : 'Pick file…'}
      </button>
      {parseError && (
        <div style={{
          marginTop: 14, padding: 12,
          background: '#fce8e8', border: '1px solid #f3b4b4', borderRadius: 5,
          color: '#8a1a1a', fontSize: 12.5,
        }}>
          {parseError}
        </div>
      )}
    </div>
  )
}

// ── Step 3: Preview & Resolve ────────────────────────────────────────────
function Step3Preview({ filename, rows, analysis, serverPreview, rowActions, setRowActions, counts, onApplyRecommendations, onStartOver, onCommit, committing }) {
  const setAction = useCallback((idx, action) => {
    setRowActions(prev => {
      const next = [...prev]
      next[idx] = action
      return next
    })
  }, [setRowActions])

  const blockedByErrors = counts.errors > 0

  return (
    <div>
      {/* Summary */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16,
      }}>
        <SummaryCard color="#1a7a4e" bg="#e8f8f2" label="Clean" value={counts.clean} />
        <SummaryCard color="#8a5a1a" bg="#fff4e0" label="Warnings" value={counts.warnings} />
        <SummaryCard color="#8a1a1a" bg="#fce8e8" label="Errors" value={counts.errors} />
        <SummaryCard color={C.textSecondary} bg="#f0f3f8" label="Skipped" value={counts.skipped} />
      </div>

      {/* Action bar */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: 14, marginBottom: 16,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 12.5, color: C.textSecondary, flex: 1 }}>
          File: <strong style={{ color: C.textPrimary }}>{filename}</strong> · {rows.length} row{rows.length === 1 ? '' : 's'}
        </div>
        <button
          onClick={onApplyRecommendations}
          style={{
            background: '#fff', color: C.textSecondary,
            border: `1px solid ${C.border}`, borderRadius: 5,
            padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Apply recommended action to all flagged rows
        </button>
        <button
          onClick={onStartOver}
          style={{
            background: '#fff', color: C.textSecondary,
            border: `1px solid ${C.border}`, borderRadius: 5,
            padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Start over
        </button>
        <button
          onClick={onCommit}
          disabled={blockedByErrors || committing}
          style={{
            background: blockedByErrors ? '#f0f3f8' : '#e85c5c',
            color: blockedByErrors ? C.textMuted : '#fff',
            border: 'none', borderRadius: 5,
            padding: '7px 16px', fontSize: 13, fontWeight: 700,
            cursor: blockedByErrors || committing ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
          title={blockedByErrors ? 'Resolve all errors before importing' : 'Commit the import'}
        >
          {committing ? 'Importing…' : `Import ${counts.clean + counts.warnings} row${counts.clean + counts.warnings === 1 ? '' : 's'}`}
        </button>
      </div>

      {/* Row table */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden',
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1200 }}>
            <thead>
              <tr style={{ background: '#fafbfd', borderBottom: `2px solid ${C.border}` }}>
                <th style={TH}>#</th>
                <th style={TH}>Status</th>
                <th style={TH}>Action</th>
                <th style={TH}>Owner</th>
                <th style={TH}>Property</th>
                <th style={TH}>Address</th>
                <th style={TH}>Building</th>
                <th style={TH}>Units</th>
                <th style={TH}>Issues</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const a = analysis[i] || { errors: [], warnings: [] }
                const sp = serverPreview[i] || {}
                const action = rowActions[i] || 'create'
                const hasHardError = a.errors.length > 0
                const buildingDupeOnServer = sp.suggested_action === 'error_building_exists'

                let statusColor, statusBg, statusLabel
                if (hasHardError || (buildingDupeOnServer && action !== 'skip')) {
                  statusColor = '#8a1a1a'; statusBg = '#fce8e8'; statusLabel = 'Error'
                } else if (action === 'skip') {
                  statusColor = C.textSecondary; statusBg = '#f0f3f8'; statusLabel = 'Skip'
                } else if (a.warnings.length > 0 || sp.existing_property) {
                  statusColor = '#8a5a1a'; statusBg = '#fff4e0'; statusLabel = 'Warning'
                } else {
                  statusColor = '#1a7a4e'; statusBg = '#e8f8f2'; statusLabel = 'OK'
                }

                // Build action options
                const actionOptions = []
                if (buildingDupeOnServer) {
                  actionOptions.push({ value: 'error_building_exists', label: 'Block — building already exists in LEAP' })
                  actionOptions.push({ value: 'skip', label: 'Skip row' })
                } else if (sp.existing_property) {
                  actionOptions.push({ value: 'skip',                       label: 'Skip — property already in LEAP' })
                  actionOptions.push({ value: 'add_buildings_to_existing',  label: 'Add building to existing property' })
                } else {
                  actionOptions.push({ value: 'create', label: 'Create' })
                  actionOptions.push({ value: 'skip',   label: 'Skip this row' })
                }

                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={TD_MONO}>{i + 2}</td>
                    <td style={TD}>
                      <span style={{
                        background: statusBg, color: statusColor,
                        fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                        padding: '2px 7px', borderRadius: 8, textTransform: 'uppercase',
                      }}>{statusLabel}</span>
                    </td>
                    <td style={TD}>
                      <select
                        value={action}
                        onChange={e => setAction(i, e.target.value)}
                        disabled={hasHardError && action === 'create'}
                        style={{
                          fontSize: 11.5, padding: '3px 6px',
                          border: `1px solid ${C.border}`, borderRadius: 4,
                          background: '#fff', maxWidth: 230,
                        }}
                      >
                        {actionOptions.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                    <td style={TD}>{r.owner_name || <span style={{ color: '#c44' }}>(missing)</span>}</td>
                    <td style={TD}>{r.property_name || <span style={{ color: '#c44' }}>(missing)</span>}</td>
                    <td style={TD}>{[r.property_street, r.property_city, r.property_state].filter(Boolean).join(', ') || <span style={{ color: '#c44' }}>(missing)</span>}</td>
                    <td style={TD}>{r.building_name || <span style={{ color: '#c44' }}>(missing)</span>}</td>
                    <td style={TD_MONO}>{r.building_unit_count || ''}</td>
                    <td style={TD}>
                      {a.errors.length > 0 && (
                        <div style={{ color: '#8a1a1a', fontSize: 11 }}>
                          {a.errors.map((e, k) => <div key={`e${k}`}>• {e}</div>)}
                        </div>
                      )}
                      {a.warnings.length > 0 && (
                        <div style={{ color: '#8a5a1a', fontSize: 11 }}>
                          {a.warnings.map((w, k) => <div key={`w${k}`}>• {w}</div>)}
                        </div>
                      )}
                      {sp.existing_property && !buildingDupeOnServer && (
                        <div style={{ color: '#1a5a8a', fontSize: 11 }}>
                          • Existing property in LEAP: <strong>{sp.existing_property.name}</strong> ({sp.existing_property.record_number}) under owner <strong>{sp.existing_property.account_name || '—'}</strong>
                        </div>
                      )}
                      {buildingDupeOnServer && (
                        <div style={{ color: '#8a1a1a', fontSize: 11 }}>
                          • Building <strong>{sp.existing_building?.name}</strong> already exists at this property ({sp.existing_building?.record_number}) — block or skip
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const TH = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }
const TD = { padding: '8px 12px', verticalAlign: 'top', color: C.textPrimary }
const TD_MONO = { padding: '8px 12px', verticalAlign: 'top', color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }

function SummaryCard({ color, bg, label, value }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14,
    }}>
      <div style={{
        display: 'inline-block', background: bg, color,
        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8,
        letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 6,
      }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>
        {value}
      </div>
    </div>
  )
}

// ── Step 4: Result ───────────────────────────────────────────────────────
function Step4Result({ result, onAnother }) {
  return (
    <div style={{
      background: C.card, border: '1px solid #bfe7d3', borderRadius: 8,
      padding: 24, maxWidth: 720,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Icon path="M9 12l2 2 4-4 m5 2a9 9 0 11-18 0 9 9 0 0118 0z" size={22} color="#1a7a4e" />
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a7a4e' }}>Import complete</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        <SummaryCard color="#1a7a4e" bg="#e8f8f2" label="Owners"     value={result.accounts_created} />
        <SummaryCard color="#1a7a4e" bg="#e8f8f2" label="Properties" value={result.properties_created} />
        <SummaryCard color="#1a7a4e" bg="#e8f8f2" label="Buildings"  value={result.buildings_created} />
        <SummaryCard color="#1a7a4e" bg="#e8f8f2" label="Units"      value={result.units_created} />
      </div>
      <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 16 }}>
        Audit row written: <strong>{result.import_run_record_number}</strong>
      </div>
      <button
        onClick={onAnother}
        style={{
          background: '#3ecf8e', color: '#fff', border: 'none', borderRadius: 5,
          padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}
      >
        Import another file
      </button>
    </div>
  )
}
