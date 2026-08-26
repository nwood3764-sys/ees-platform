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
import { PINNED_TABLE, ROW_RULE, pinnedHeaderCell } from '../../lib/pinnedTableHeader'
import { Icon } from '../../components/UI'
import HelpIcon from '../../components/help/HelpIcon'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'

// ── Template definition ─────────────────────────────────────────────────
const TEMPLATE_COLUMNS = [
  { key: 'owner_name',             label: 'Owner Name',             required: true,  example: 'Test Owner Name' },
  { key: 'property_name',          label: 'Property Name',          required: true,  example: 'Test Property Name' },
  { key: 'property_street',        label: 'Property Street',        required: true,  example: '123 Main St' },
  { key: 'property_city',          label: 'Property City',          required: true,  example: 'Madison' },
  { key: 'property_state',         label: 'Property State',         required: true,  example: 'WI' },
  { key: 'property_zip',           label: 'Property Zip',           required: true,  example: '53703' },
  { key: 'property_subsidy_type',  label: 'Subsidy Type',           required: false, example: 'LIHTC' },
  { key: 'building_name',          label: 'Building Name',          required: true,  example: 'Building A' },
  { key: 'building_year_built',    label: 'Year Built',             required: false, example: 1985 },
  { key: 'building_unit_count',    label: 'Unit Count',             required: false, example: 12 },
]

const REQUIRED_KEYS = TEMPLATE_COLUMNS.filter(c => c.required).map(c => c.key)
const VALID_STATES = ['WI','MI','NC','CO','IN']  // EES-WI's five-state list — warning if outside
// Matches the live properties.property_subsidy_type picklist.
const VALID_SUBSIDY = ['Section 8 / HUD','LIHTC','NOAH','DAC','NEST Community','Public Housing Authority Owned','Other']

// ── Units sheet definition ───────────────────────────────────────────────
// One row per unit on the "Units" sheet, tied back to its building by
// Property Name + Building Name (the same values used on the Data sheet).
// Buildings with no unit rows here fall back to Unit Count auto-generation.
const UNIT_TEMPLATE_COLUMNS = [
  { key: 'property_name',    label: 'Property Name',    required: true,  example: 'Test Property Name' },
  { key: 'building_name',    label: 'Building Name',    required: true,  example: 'Building A' },
  { key: 'unit_name',        label: 'Unit Name',        required: false, example: 'Apt 101' },
  { key: 'unit_number',      label: 'Unit Number',      required: false, example: '101' },
  { key: 'unit_record_type', label: 'Unit Record Type', required: false, example: 'DWELLING-UNIT' },
  { key: 'bedrooms',         label: 'Bedrooms',         required: false, example: 2 },
  { key: 'bathrooms',        label: 'Bathrooms',        required: false, example: 1 },
  { key: 'square_footage',   label: 'Square Footage',   required: false, example: 850 },
  { key: 'floor',            label: 'Floor',            required: false, example: 1 },
]
// Live units.record_type picklist. Blank on import defaults to DWELLING-UNIT.
const VALID_UNIT_RECORD_TYPES = ['ATTIC-SPACE','COMMON-AREA','DWELLING-UNIT','HALLWAY','MECHANICAL-ROOM','OFFICE','STANDARD']

// Key a unit row to its building the same way on both sheets.
function unitBuildingKey(propertyName, buildingName) {
  return `${normalizeName(propertyName)}||${normalizeName(buildingName)}`
}

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

// ── Template download (exceljs — native in-cell dropdowns) ────────────────
// exceljs is lazy-loaded only when Download Template is clicked (its own
// vendor-exceljs chunk), so it never weighs on the app's load path. SheetJS
// stays the reader; exceljs is only the writer, because it can emit the real
// Excel data-validation dropdowns SheetJS's community build cannot.

// Convert a 1-based column index to its spreadsheet letter (1→A, 27→AA).
function columnLetter(idx) {
  let s = ''
  while (idx > 0) { const m = (idx - 1) % 26; s = String.fromCharCode(65 + m) + s; idx = Math.floor((idx - 1) / 26) }
  return s
}

// Dropdown source ranges on the Lists sheet — computed from list lengths so
// they're known before the Lists sheet is added (it goes last for tab order).
const LIST_SOURCE = {
  unitRecordType: `Lists!$A$2:$A$${VALID_UNIT_RECORD_TYPES.length + 1}`,
  subsidyType:    `Lists!$B$2:$B$${VALID_SUBSIDY.length + 1}`,
  state:          `Lists!$C$2:$C$${VALID_STATES.length + 1}`,
}
const DV_ROWS = 500  // number of data rows that carry dropdowns

function listDropdown(sourceRange) {
  return {
    type: 'list',
    allowBlank: true,
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: 'Not a valid value',
    error: 'Pick a value from the drop-down list.',
    formulae: [sourceRange],
  }
}

function styleHeaderRow(row) {
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF07111F' } }
    cell.alignment = { vertical: 'middle' }
  })
  row.height = 18
}

async function downloadTemplate() {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'LEAP'

  // ── Tab 1: Instructions ────────────────────────────────────────────────
  const wsI = wb.addWorksheet('Instructions')
  const instructions = [
    ['LEAP Property Hierarchy Import — Instructions'],
    [''],
    ['Fill in the Data tab (one row per building) and, optionally, the Units tab (one row per unit).'],
    ['Do not change the column headers. Add your rows starting on row 2.'],
    ['The example rows are for reference — delete or overwrite them before uploading.'],
    ['Cells with a drop-down arrow only accept a value from the list. On the Units tab, Property Name and Building Name are'],
    ['drop-downs built from what you type on the Data tab — so fill in the Data tab FIRST, then pick each unit\'s building.'],
    [''],
    ['DATA TAB — one row per BUILDING.'],
    ['Repeat the Owner and Property columns on every building row at the same property; the importer deduplicates automatically.'],
    [''],
    ['COLUMNS (Data tab):'],
    ...TEMPLATE_COLUMNS.map(c => [
      `${c.label}${c.required ? ' (required)' : ' (optional)'}`,
      c.key === 'property_state'         ? `2-letter state code (drop-down). EES-WI's five states: ${VALID_STATES.join(', ')}.`
      : c.key === 'property_zip'          ? '5-digit ZIP (or ZIP+4). Required — the database stores a valid ZIP on every property.'
      : c.key === 'property_subsidy_type' ? 'Affordability category (drop-down).'
      : c.key === 'building_unit_count'   ? 'Integer ≥ 1. If you do NOT list this building on the Units tab, the importer auto-creates that many placeholder units (Unit 1, Unit 2, …). If you DO list units, those are used and this count is ignored.'
      : c.key === 'building_year_built'   ? 'Integer year (e.g. 1985). Leave blank if unknown.'
      : '',
      `Example: ${c.example}`,
    ]),
    [''],
    ['UNITS TAB (optional — for real unit names/numbers):'],
    ['Each row is ONE unit. Pick its Property and Building from the drop-downs (they list what you entered on the Data tab).'],
    ['A unit needs a Unit Name OR a Unit Number (at least one). The other is filled from it if left blank.'],
    ['Unit Record Type is a drop-down; blank defaults to DWELLING-UNIT.'],
    ['Bedrooms / Floor are whole numbers; Bathrooms / Square Footage may be decimals. All optional.'],
    ['A building listed on the Units tab ignores its Unit Count — the listed units win.'],
    [''],
    ['DEDUPLICATION:'],
    ['• Owner — matched by normalized name across record types (LLC/Inc. ignored). An existing Property Owner account is reused.'],
    ['• Property — matched on normalized Street + City + State. "123 Main St" and "123 Main Street" are the same address.'],
    ['• Building — matched on Property + Building Name. Two buildings cannot share a name at one property.'],
    ['• Unit — matched on Building + Unit Number. Re-running an import will not duplicate a unit that already exists.'],
  ]
  instructions.forEach(r => wsI.addRow(r))
  wsI.getColumn(1).width = 34; wsI.getColumn(2).width = 96; wsI.getColumn(3).width = 34
  wsI.getRow(1).font = { bold: true, size: 14 }

  // ── Tab 2: Data ─────────────────────────────────────────────────────────
  const wsD = wb.addWorksheet('Data')
  wsD.addRow(TEMPLATE_COLUMNS.map(c => c.label))
  wsD.addRow(TEMPLATE_COLUMNS.map(c => c.example))
  // Second example: a second building at the SAME test property (dedup demo).
  wsD.addRow(['Test Owner Name','Test Property Name','123 Main St','Madison','WI','53703','LIHTC','Building B',1987,18])
  styleHeaderRow(wsD.getRow(1))
  wsD.views = [{ state: 'frozen', ySplit: 1 }]
  wsD.columns = TEMPLATE_COLUMNS.map(c => ({ width: Math.max(c.label.length + 2, 16) }))
  const propColLetter  = columnLetter(TEMPLATE_COLUMNS.findIndex(c => c.key === 'property_name') + 1)
  const bldgColLetter  = columnLetter(TEMPLATE_COLUMNS.findIndex(c => c.key === 'building_name') + 1)
  const stateCol = columnLetter(TEMPLATE_COLUMNS.findIndex(c => c.key === 'property_state') + 1)
  const subCol   = columnLetter(TEMPLATE_COLUMNS.findIndex(c => c.key === 'property_subsidy_type') + 1)
  for (let r = 2; r <= DV_ROWS; r++) {
    wsD.getCell(`${stateCol}${r}`).dataValidation = listDropdown(LIST_SOURCE.state)
    wsD.getCell(`${subCol}${r}`).dataValidation   = listDropdown(LIST_SOURCE.subsidyType)
  }
  // The Units tab's Property / Building drop-downs read straight from the Data
  // tab, so a unit can only point at a property/building you actually entered.
  const DATA_PROPERTY_SOURCE = `Data!$${propColLetter}$2:$${propColLetter}$${DV_ROWS}`
  const DATA_BUILDING_SOURCE = `Data!$${bldgColLetter}$2:$${bldgColLetter}$${DV_ROWS}`

  // ── Tab 3: Units ────────────────────────────────────────────────────────
  const wsU = wb.addWorksheet('Units')
  wsU.addRow(UNIT_TEMPLATE_COLUMNS.map(c => c.label))
  ;[
    ['Test Property Name','Building A','Apt 101','101','DWELLING-UNIT',2,1,850,1],
    ['Test Property Name','Building A','Apt 102','102','DWELLING-UNIT',1,1,650,1],
    ['Test Property Name','Building A','Community Room','CR','COMMON-AREA','','','',1],
  ].forEach(r => wsU.addRow(r))
  styleHeaderRow(wsU.getRow(1))
  wsU.views = [{ state: 'frozen', ySplit: 1 }]
  wsU.columns = UNIT_TEMPLATE_COLUMNS.map(c => ({ width: Math.max(c.label.length + 2, 14) }))
  const uPropCol = columnLetter(UNIT_TEMPLATE_COLUMNS.findIndex(c => c.key === 'property_name') + 1)
  const uBldgCol = columnLetter(UNIT_TEMPLATE_COLUMNS.findIndex(c => c.key === 'building_name') + 1)
  const urtCol   = columnLetter(UNIT_TEMPLATE_COLUMNS.findIndex(c => c.key === 'unit_record_type') + 1)
  for (let r = 2; r <= DV_ROWS; r++) {
    wsU.getCell(`${uPropCol}${r}`).dataValidation = listDropdown(DATA_PROPERTY_SOURCE)
    wsU.getCell(`${uBldgCol}${r}`).dataValidation = listDropdown(DATA_BUILDING_SOURCE)
    wsU.getCell(`${urtCol}${r}`).dataValidation   = listDropdown(LIST_SOURCE.unitRecordType)
  }

  // ── Tab 4: Lists (drop-down source; also human-readable) ────────────────
  const wsL = wb.addWorksheet('Lists')
  wsL.addRow(['Unit Record Type', 'Subsidy Type', 'Property State'])
  styleHeaderRow(wsL.getRow(1))
  const maxLen = Math.max(VALID_UNIT_RECORD_TYPES.length, VALID_SUBSIDY.length, VALID_STATES.length)
  for (let i = 0; i < maxLen; i++) {
    wsL.addRow([VALID_UNIT_RECORD_TYPES[i] || '', VALID_SUBSIDY[i] || '', VALID_STATES[i] || ''])
  }
  wsL.columns = [{ width: 22 }, { width: 32 }, { width: 16 }]

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'LEAP_Property_Hierarchy_Import_Template.xlsx'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
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

  const unitRows = parseUnitsSheet(wb)
  return { rows, unitRows }
}

// Parse the optional "Units" sheet into raw unit records. Silently returns []
// when the sheet is absent (older templates / single-sheet files).
function parseUnitsSheet(wb) {
  const sheetName = wb.SheetNames.find(n => n.toLowerCase() === 'units')
  if (!sheetName) return []
  const ws = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' })
  if (aoa.length < 2) return []
  const headerRow = aoa[0].map(h => String(h || '').trim())
  const headerToKey = {}
  for (const col of UNIT_TEMPLATE_COLUMNS) {
    const idx = headerRow.findIndex(h => h.toLowerCase() === col.label.toLowerCase())
    if (idx >= 0) headerToKey[col.key] = idx
  }
  // Property + Building columns are what tie a unit to its building.
  if (headerToKey.property_name == null || headerToKey.building_name == null) return []

  const out = []
  for (let r = 1; r < aoa.length; r++) {
    const raw = aoa[r]
    if (!raw || raw.every(v => v === '' || v == null)) continue
    const u = {}
    for (const [key, idx] of Object.entries(headerToKey)) {
      const cell = raw[idx]
      u[key] = cell == null ? '' : String(cell).trim()
    }
    // Skip fully-blank unit rows (only property/building filled, no unit id)
    if (!u.unit_name && !u.unit_number) continue
    u._file_row = r + 1
    out.push(u)
  }
  return out
}

// ── Attach parsed units to their building rows ───────────────────────────
// Normalize a raw unit record to the RPC payload shape and flag a bad record type.
function cleanUnit(u) {
  const rt = String(u.unit_record_type || '').trim()
  const invalidRecordType = !!rt && !VALID_UNIT_RECORD_TYPES.includes(rt.toUpperCase())
  return {
    unit: {
      unit_name:        u.unit_name || '',
      unit_number:      u.unit_number || '',
      unit_record_type: rt,
      bedrooms:         u.bedrooms || '',
      bathrooms:        u.bathrooms || '',
      square_footage:   u.square_footage || '',
      floor:            u.floor || '',
    },
    invalidRecordType,
  }
}

// Returns rows each carrying a `units` array, plus a summary of unmatched /
// invalid unit rows to surface in the preview.
function attachUnitsToRows(rows, unitRows) {
  const keyToRowIndex = {}
  rows.forEach((r, i) => {
    const key = unitBuildingKey(r.property_name, r.building_name)
    if (!(key in keyToRowIndex)) keyToRowIndex[key] = i
  })
  const withUnits = rows.map(r => ({ ...r, units: [] }))
  const unmatched = []
  let invalidRecordType = 0
  let matched = 0
  for (const u of (unitRows || [])) {
    const key = unitBuildingKey(u.property_name, u.building_name)
    const idx = keyToRowIndex[key]
    if (idx == null) { unmatched.push(u); continue }
    const { unit, invalidRecordType: bad } = cleanUnit(u)
    if (bad) invalidRecordType++
    withUnits[idx].units.push(unit)
    matched++
  }
  return { rows: withUnits, summary: { totalUnits: (unitRows || []).length, matched, unmatched, invalidRecordType } }
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
    // Zip — required, must be 5 or 9 digits (the DB CHECK enforces ^\d{5}(\d{4})?$)
    if (r.property_zip) {
      const digits = String(r.property_zip).replace(/\D/g, '')
      if (digits.length !== 5 && digits.length !== 9) {
        a.errors.push(`Property Zip must be 5 or 9 digits (got "${r.property_zip}")`)
      }
    }
    // State must be a 2-letter code
    if (r.property_state && !/^[A-Z]{2}$/i.test(r.property_state)) {
      a.errors.push(`State must be a 2-letter code (got "${r.property_state}")`)
    } else if (r.property_state && !VALID_STATES.includes(r.property_state.toUpperCase())) {
      a.warnings.push(`State "${r.property_state.toUpperCase()}" is outside EES-WI's five-state list — will import anyway`)
    }
    // Units: a building is defined either by an explicit unit list (Units sheet)
    // or by a Unit Count that auto-generates placeholders. Require one.
    const explicitUnits = Array.isArray(r.units) ? r.units : []
    if (r.building_unit_count) {
      const n = Number(r.building_unit_count)
      if (!Number.isInteger(n) || n < 1) {
        a.errors.push(`Unit Count must be an integer ≥ 1 (got "${r.building_unit_count}")`)
      }
    } else if (r.building_name && explicitUnits.length === 0) {
      a.errors.push('Provide a Unit Count, or list this building’s units on the Units sheet')
    }
    if (explicitUnits.length > 0) {
      const badRt = explicitUnits.filter(u => u.unit_record_type && !VALID_UNIT_RECORD_TYPES.includes(String(u.unit_record_type).toUpperCase()))
      if (badRt.length) {
        a.warnings.push(`${badRt.length} unit(s) have an unrecognized Unit Record Type — will default to DWELLING-UNIT`)
      }
      const seen = new Set()
      let dupN = 0
      for (const u of explicitUnits) {
        const n = String(u.unit_number || u.unit_name || '').trim().toLowerCase()
        if (!n) continue
        if (seen.has(n)) dupN++; else seen.add(n)
      }
      if (dupN) a.warnings.push(`${dupN} duplicate unit number(s) in this building’s list — duplicates will be skipped`)
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
  const [unitSummary, setUnitSummary] = useState(null)  // Units sheet parse summary
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
      const { rows: parsedRows, unitRows } = await parseUploadedFile(file)
      if (parsedRows.length === 0) throw new Error('No data rows found in the file.')
      const { rows: rowsWithUnits, summary } = attachUnitsToRows(parsedRows, unitRows)
      setFilename(file.name)
      setRows(rowsWithUnits)
      setUnitSummary(summary)
      const localAnalysis = analyzeRows(rowsWithUnits)
      setAnalysis(localAnalysis)
      // Call server preview
      setPreviewing(true)
      const { data, error } = await supabase.rpc('preview_property_hierarchy_import', { p_rows: rowsWithUnits })
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

  const handleDownload = useCallback(async () => {
    try {
      await downloadTemplate()
    } catch (err) {
      toast.error('Could not build the template: ' + (err?.message || err))
    }
  }, [toast])

  const handleStartOver = useCallback(() => {
    setStep(1)
    setRows([])
    setAnalysis([])
    setServerPreview([])
    setRowActions([])
    setUnitSummary(null)
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
        {step === 1 && <Step1Download onNext={() => setStep(2)} onDownload={handleDownload} />}

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
            unitSummary={unitSummary}
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
function Step1Download({ onNext, onDownload }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: 24, maxWidth: 720,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, marginBottom: 6 }}>
        Step 1 — Download the template
      </div>
      <div style={{ fontSize: 12.5, color: C.textSecondary, lineHeight: 1.6, marginBottom: 16 }}>
        The template is a pre-built Excel workbook. <strong>Instructions</strong> is the first tab. On <strong>Data</strong>, one row per <strong>building</strong> — repeat the Owner and Property columns on every building row at the same property (the importer deduplicates automatically). On <strong>Units</strong>, one row per unit with its real name/number and attributes, tied to its building by Property + Building Name. Subsidy Type, Property State, and Unit Record Type are <strong>drop-downs</strong> — pick a value, don't type it. Buildings with no rows on the Units tab auto-generate units from their Unit Count.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={onDownload}
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
          background: '#e8f1fb', border: '1px solid #bcd9f2', borderRadius: 5,
          color: '#1e466b', fontSize: 12.5,
        }}>
          {parseError}
        </div>
      )}
    </div>
  )
}

// ── Step 3: Preview & Resolve ────────────────────────────────────────────
function Step3Preview({ filename, rows, analysis, serverPreview, rowActions, setRowActions, unitSummary, counts, onApplyRecommendations, onStartOver, onCommit, committing }) {
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
        <SummaryCard color="#1e466b" bg="#e8f1fb" label="Warnings" value={counts.warnings} />
        <SummaryCard color="#1e466b" bg="#e8f1fb" label="Errors" value={counts.errors} />
        <SummaryCard color={C.textSecondary} bg="#f0f3f8" label="Skipped" value={counts.skipped} />
      </div>

      {/* Units sheet summary */}
      {unitSummary && unitSummary.totalUnits > 0 && (
        <div style={{
          background: '#e8f1fb', border: '1px solid #bcd9f2', borderRadius: 8,
          padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#1e466b',
        }}>
          <strong>{unitSummary.matched}</strong> unit{unitSummary.matched === 1 ? '' : 's'} from the Units sheet matched a building and will be created with the name/number and attributes you specified.
          {unitSummary.unmatched.length > 0 && (
            <span> · <strong>{unitSummary.unmatched.length}</strong> unit row{unitSummary.unmatched.length === 1 ? '' : 's'} did not match any Property + Building on the Data sheet and will be ignored (check spelling: {unitSummary.unmatched.slice(0, 3).map(u => `"${u.property_name} / ${u.building_name}"`).join(', ')}{unitSummary.unmatched.length > 3 ? '…' : ''}).</span>
          )}
          {unitSummary.invalidRecordType > 0 && (
            <span> · <strong>{unitSummary.invalidRecordType}</strong> unit{unitSummary.invalidRecordType === 1 ? '' : 's'} with an unrecognized Unit Record Type will default to DWELLING-UNIT.</span>
          )}
        </div>
      )}

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
            background: blockedByErrors ? '#f0f3f8' : '#7eb3e8',
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
          <table style={{ ...PINNED_TABLE, fontSize: 12, minWidth: 1200 }}>
            <thead>
              <tr>
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
                  statusColor = '#1e466b'; statusBg = '#e8f1fb'; statusLabel = 'Error'
                } else if (action === 'skip') {
                  statusColor = C.textSecondary; statusBg = '#f0f3f8'; statusLabel = 'Skip'
                } else if (a.warnings.length > 0 || sp.existing_property) {
                  statusColor = '#1e466b'; statusBg = '#e8f1fb'; statusLabel = 'Warning'
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
                  <tr key={i}>
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
                    <td style={TD}>{r.owner_name || <span style={{ color: '#7eb3e8' }}>(missing)</span>}</td>
                    <td style={TD}>{r.property_name || <span style={{ color: '#7eb3e8' }}>(missing)</span>}</td>
                    <td style={TD}>{[r.property_street, r.property_city, r.property_state].filter(Boolean).join(', ') || <span style={{ color: '#7eb3e8' }}>(missing)</span>}</td>
                    <td style={TD}>{r.building_name || <span style={{ color: '#7eb3e8' }}>(missing)</span>}</td>
                    <td style={TD_MONO}>
                      {Array.isArray(r.units) && r.units.length > 0
                        ? <span title="Explicit units from the Units sheet">{r.units.length} listed</span>
                        : (r.building_unit_count ? `${r.building_unit_count} auto` : '')}
                    </td>
                    <td style={TD}>
                      {a.errors.length > 0 && (
                        <div style={{ color: '#1e466b', fontSize: 11 }}>
                          {a.errors.map((e, k) => <div key={`e${k}`}>• {e}</div>)}
                        </div>
                      )}
                      {a.warnings.length > 0 && (
                        <div style={{ color: '#1e466b', fontSize: 11 }}>
                          {a.warnings.map((w, k) => <div key={`w${k}`}>• {w}</div>)}
                        </div>
                      )}
                      {sp.existing_property && !buildingDupeOnServer && (
                        <div style={{ color: '#1a5a8a', fontSize: 11 }}>
                          • Existing property in LEAP: <strong>{sp.existing_property.name}</strong> ({sp.existing_property.record_number}) under owner <strong>{sp.existing_property.account_name || '—'}</strong>
                        </div>
                      )}
                      {buildingDupeOnServer && (
                        <div style={{ color: '#1e466b', fontSize: 11 }}>
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

// An import preview is hundreds of rows long by definition, so its header pins:
// scrolling to row 300 to check a column you can no longer name is how a bad
// row gets imported.
const TH = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap', ...pinnedHeaderCell({ background: '#fafbfd' }) }
// The row rule lives on the CELLS: a border on a <tr> is not painted with
// border-collapse: separate, which the pinned header requires.
const TD = { padding: '8px 12px', verticalAlign: 'top', color: C.textPrimary, ...ROW_RULE }
const TD_MONO = { ...TD, fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }

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
