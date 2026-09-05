// Reading a Conduit Tech Manual J report.
//
// Nicholas, 2026-09-05: "I'll upload the Conduit Tech report, and then I want
// the software to scrape all of the relevant fields and put the information in
// … This is going to support the equipment selection to make sure that we are
// selecting the proper equipment for HVAC and that we're satisfying the heating
// and cooling load."
//
// Input is rows of CELLS from pdfTextLayout — not a flat string. The Building
// Materials table cannot be read from flattened text at all: a construction
// number may contain a space ("16B-19 ad"), and a row may leave whole columns
// BLANK ("Below-Grade Wall … 229 1,904 0.117" is area / no cooling / heating /
// U-value), so which number is which is decided by x position and by nothing
// else. Splitting that line on whitespace silently files the heating load as a
// cooling load.
//
// ─── What a Conduit report actually contains ────────────────────────────────
//
// A report models the SAME house under one or more proposed systems, and prints
// a load table at four levels:
//
//   WHOLE HOME              → the house
//   <SYSTEM>                → what that system serves
//   <SYSTEM> Zone n         → a zone of it
//   <SYSTEM> · ZONE n       → one room, one page each
//   UNASSIGNED              → a room no modelled system serves
//
// Every level prints the same 16-component breakdown against the same four
// measures (sensible cooling, latent cooling, total cooling, total heating), so
// they are all parsed by one routine and distinguished by SCOPE.
//
// ─── The trap this module exists to make visible ────────────────────────────
//
// In the 2506 Frazier Ave report the printed WHOLE HOME heating load is 46,735
// Btu/h, and the rooms sum to 29,881. The difference is 16,854 — exactly Zone
// 1 over again. Zone 1's five rooms are served by BOTH modelled systems (a gas
// furnace and a cold-climate heat pump), and the whole-home figure sums per
// system ASSIGNMENT rather than per room. A comparison report therefore prints
// a whole-home load that counts twice every room more than one proposed system
// serves.
//
// Sizing equipment to 46,735 would oversize this house by nearly two. So the
// whole-home figure is stored exactly as printed and NEVER silently used: the
// building roll-up is computed from DISTINCT rooms, and the discrepancy is
// reported by name (see manualJDesignLoad.js). Nothing here decides which load
// the equipment is sized to — a person does, on the review screen, which is the
// whole point of scraping into a form rather than into the record.
//
// Pure: no DOM, no network, no clock. Pinned against the real report in
// scripts/conduit-manual-j-fixture.mjs.

import { rowText } from './pdfTextLayout.js'

// ─── Label matching ─────────────────────────────────────────────────────────

// The report's font has no unicode mapping for its ff / ffi ligatures, so those
// glyphs extract as nothing: "Difference" arrives as "Dierence" and
// "efficiency" as "eciency". Labels are therefore matched on a key that also
// accepts the ligature-less spelling, generated from the label rather than
// listed — a label nobody thought about ("Efficiency", "Diffuser") is covered
// the day it appears.
const LIGATURES = ['ffi', 'ff', 'fi', 'fl']

/** Lowercase, drop everything that is not a letter or digit. */
export function labelKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Every spelling of a label the extractor might produce, ligatures included. */
export function labelKeyVariants(label) {
  const base = labelKey(label)
  const out = new Set([base])
  for (const lig of LIGATURES) {
    if (base.includes(lig)) out.add(base.split(lig).join(''))
  }
  return [...out]
}

/** Build a lookup from { label: field } accepting every ligature spelling. */
function buildLabelMap(spec) {
  const map = new Map()
  for (const [label, field] of Object.entries(spec)) {
    for (const key of labelKeyVariants(label)) if (!map.has(key)) map.set(key, field)
  }
  return map
}

// ─── Numbers ────────────────────────────────────────────────────────────────

/**
 * "1,881" → 1881, "0.097" → 0.097, "-1F" → -1, "50%" → 50, "878ft" → 878.
 * Returns null for anything that is not a number — "None", "N/A", "" — because
 * a blank cell in this report means "not applicable", and coercing it to 0
 * would print a heating load of zero where the report printed nothing.
 */
export function parseNumber(s) {
  if (s == null) return null
  const t = String(s).trim()
  if (t === '' || /^(none|n\/a|na|-|—)$/i.test(t)) return null
  const m = t.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

// ─── Field vocabularies ─────────────────────────────────────────────────────

const GEOMETRY_FIELDS = buildLabelMap({
  // The ² of "ft²" is set as a superscript on its own row, so the cell reads
  // "(ft )". Both spellings are accepted rather than assumed.
  'Total Floor Area (ft )': 'floorAreaSqFt',
  'Total Floor Area (ft2)': 'floorAreaSqFt',
  'Total Volume (ft )': 'volumeCuFt',
  'Total Volume (ft3)': 'volumeCuFt',
  'Ceiling height(s) (ft)': 'ceilingHeightFt',
  'Running length of exposed wall (ft)': 'runningExposedWallFt',
  'Total glazing area (ft )': 'glazingAreaSqFt',
  'Sensible Heat Ratio (SHR)': 'sensibleHeatRatio',
  'Exposed wall area (ft ) (gross) - Total': 'exposedWallGrossSqFt',
  'Exposed wall area (ft ) (gross)': 'exposedWallGrossSqFt',
  'Exposed wall area (ft ) (net)': 'exposedWallNetSqFt',
  'Envelope tightness': 'envelopeTightness',
  'Appliance Scenario': 'applianceScenario',
  'Number of occupants': 'occupants',
  Occupants: 'occupants',
  'Design CFM': 'designCfm',
})

const DISTRIBUTION_FIELDS = buildLabelMap({
  'System Type': 'systemType',
  'Distribution Type': 'distributionType',
  Ducts: 'ducts',
  'Supply Run Location': 'supplyRunLocation',
  'Leakage Class': 'leakageClass',
  'Duct Wall Insulation': 'ductWallInsulation',
  'Airway Configuration': 'airwayConfiguration',
  // Conduit prints these three unexpanded. Equivalent Heating Load Factor,
  // Equivalent Sensible Gain Factor and Equivalent Latent Gain — the duct-loss
  // multipliers Manual J Appendix 3 derives the duct load from.
  EHLF: 'ehlf',
  ESGF: 'esgf',
  ELG: 'elg',
})

const NUMERIC_GEOMETRY = new Set([
  'floorAreaSqFt', 'volumeCuFt', 'ceilingHeightFt', 'runningExposedWallFt',
  'glazingAreaSqFt', 'sensibleHeatRatio', 'exposedWallGrossSqFt',
  'exposedWallNetSqFt', 'occupants', 'designCfm',
])
const NUMERIC_DISTRIBUTION = new Set(['ehlf', 'esgf', 'elg'])

const ORIENTATIONS = new Set(['N', 'E', 'W', 'S', 'NE', 'NW', 'SE', 'SW'])

/** The four measures every load table prints, in the order the report prints them. */
export const LOAD_MEASURES = ['sensibleCoolingBtuh', 'latentCoolingBtuh', 'totalCoolingBtuh', 'totalHeatingBtuh']

/**
 * The rows a Manual J load table prints, in order. A component row is accepted
 * only if its label is one of these — matching on shape alone is not enough,
 * because a Building Materials row is also "a label and four numbers":
 *
 *     Below-Grade | 15B0-4sf-x | 533 | 2,954 | 0.078
 *
 * where the CONSTRUCTION NUMBER "15B0-4sf-x" parses as 15. Read by shape, that
 * row files a wall assembly as a load component with a sensible cooling load of
 * 15 Btu/h. Named components make that impossible.
 *
 * A wrapped label ("Infiltration Loss and" / "Gain") is matched as a prefix and
 * completed when its continuation row arrives.
 */
export const LOAD_COMPONENTS = [
  'Total', 'Walls', 'Glazing', 'Doors', 'Ceilings', 'Floors', 'Ventilation',
  'Ducts', 'Infiltration Loss and Gain', 'Blower Heat', 'Occupants',
  'Appliances', 'Plants', 'Hot Water Piping', 'Moisture Migration',
  'Winter Humidification',
]
const COMPONENT_KEYS = LOAD_COMPONENTS.flatMap(labelKeyVariants)

/** True when `label` is a load component, or the start of one that wrapped. */
export function isLoadComponentLabel(label) {
  const key = labelKey(label)
  if (!key) return false
  return COMPONENT_KEYS.some(k => k === key || k.startsWith(key))
}

// ─── Row classification helpers ─────────────────────────────────────────────

const LOAD_HEADER_KEY = labelKey('Sensible Cooling')
const isLoadTableHeader = row =>
  row.cells.length >= 4 && labelKey(row.cells[0].text) === LOAD_HEADER_KEY

const isUnitsRow = row => row.cells.every(c => labelKey(c.text) === 'btuh')

// A superscript (the ² of ft², the ³ of ft³) is laid out on its own row, to the
// right of the label it belongs to. It is never content: no line of this report
// is a bare digit sitting out in the value column.
const isStraySuperscript = row =>
  row.cells.length === 1 && /^[0-9]$/.test(row.cells[0].text) && row.cells[0].x >= 100

const LABEL_X_MAX = 130   // a label starts in the left margin band (49–88 observed)
const HEADING_X_MAX = 60  // a section heading is flush left, at x 49

/**
 * A section heading: "WHOLE HOME", "GAS FURNACE", "COLD CLIMATE HEAT PUMP",
 * "UNASSIGNED", or the running header of a room page, "GAS FURNACE" | "ZONE 1".
 *
 * Upper case is NOT sufficient on its own, which is what the first cut of this
 * assumed. The whole-home page lists its exposed wall by compass point — "N
 * 477", "E 467" — and the duct loss factors are "EHLF 0.18", "ESGF 0.11", "ELG
 * 1004". Every one of those rows is upper case, and every one of them was read
 * as a section heading, which silently discarded the value AND repointed the
 * block that followed. A heading is also flush left at x 49, where those labels
 * are indented to 88, and it never carries a number of its own.
 */
function asHeading(row) {
  if (row.cells[0].x > HEADING_X_MAX) return null
  const text = rowText(row)
  if (!text || /[a-z]/.test(text)) return null
  if (!/[A-Z]/.test(text)) return null
  // "ZONE 1" is a heading; "EHLF 0.18" and "N 477" are labelled values.
  if (row.cells.some(c => /^[\d.,]+$/.test(c.text))) return null
  if (/\d[\d.,]*\.[\d,]/.test(text)) return null
  return text.replace(/\s*·\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

// ─── The parse ──────────────────────────────────────────────────────────────

/**
 * @param {Array<{page:number, cells:Array<{x:number,text:string}>}>} rows
 * @returns {object} the parsed report
 */
export function parseConduitManualJ(rows) {
  const all = (rows || []).filter(r => r && r.cells && r.cells.length && !isStraySuperscript(r))
  const warnings = []

  const report = {
    source: {
      software: 'Conduit Tech',
      reportTitle: null,
      createdBy: null,
      createdAt: null,
      lastUpdatedAt: null,
      manualJVersion: null,
    },
    subject: { name: null, address: null },
    designConditions: {
      weatherStation: null,
      elevationFt: null,
      latitude: null,
      altitudeCorrectionFactor: null,
      heating: null,
      cooling: null,
    },
    blocks: [],
    materials: [],
    warnings,
  }

  parseCoverAndConditions(all, report, warnings)
  report.blocks = parseLoadBlocks(all, warnings)
  report.materials = parseMaterials(all, warnings)

  if (!report.blocks.length) warnings.push('No load tables were found. This may not be a Conduit Tech Manual J report.')
  return report
}

// ─── Cover page and design conditions ───────────────────────────────────────

function parseCoverAndConditions(rows, report, warnings) {
  const COVER = buildLabelMap({
    Name: 'name',
    Address: 'address',
    'Manual J Version': 'manualJVersion',
    'Created by': 'createdBy',
    Created: 'createdAt',
    'Last Updated': 'lastUpdatedAt',
    'ASHRAE Weather Station': 'weatherStation',
    Elevation: 'elevationFt',
    Latitude: 'latitude',
    'Altitude Correction Factor': 'altitudeCorrectionFactor',
  })

  for (const row of rows) {
    if (row.page > 2) break
    if (rowText(row) === 'Manual J Report' && !report.source.reportTitle) {
      report.source.reportTitle = 'Manual J Report'
      continue
    }
    const { label, value } = splitLabelValue(row)
    if (!label) continue
    const field = COVER.get(labelKey(label))
    if (!field || !value) continue
    switch (field) {
      case 'name': report.subject.name = value; break
      case 'address': report.subject.address = parseAddress(value); break
      case 'manualJVersion': report.source.manualJVersion = value; break
      case 'createdBy': report.source.createdBy = value; break
      // "Created" also prefixes "Created by"; the map keys them apart, but a
      // second "Created" row must not overwrite the first.
      case 'createdAt': if (!report.source.createdAt) report.source.createdAt = value; break
      case 'lastUpdatedAt': report.source.lastUpdatedAt = value; break
      case 'weatherStation': report.designConditions.weatherStation = value; break
      case 'elevationFt': report.designConditions.elevationFt = parseNumber(value); break
      case 'latitude': report.designConditions.latitude = parseNumber(value); break
      case 'altitudeCorrectionFactor': report.designConditions.altitudeCorrectionFactor = parseNumber(value); break
      default: break
    }
  }

  // The design-conditions grid: a six-column row per season, under a two-line
  // header. Read positionally — the header's own labels are the ones the
  // dropped ff ligature mangles ("Temperature Dierence").
  for (const row of rows) {
    if (row.page > 2) break
    const first = labelKey(row.cells[0].text)
    if (first !== 'heating' && first !== 'cooling') continue
    const v = row.cells.length >= 7
      ? row.cells.slice(1).map(c => c.text)
      : rowText(row).split(/\s+/).slice(1)
    const season = {
      outdoorDryBulbF: parseNumber(v[0]),
      indoorDryBulbF: parseNumber(v[1]),
      temperatureDifferenceF: parseNumber(v[2]),
      indoorRelativeHumidityPct: parseNumber(v[3]),
      dailyRange: v[4] && !/^n\/a$/i.test(v[4]) ? v[4] : null,
      grainsDifference: parseNumber(v[5]),
    }
    report.designConditions[first] = season
  }

  if (!report.designConditions.heating || report.designConditions.heating.outdoorDryBulbF == null) {
    warnings.push('No winter design temperature was found — equipment cannot be sized without one.')
  }
}

/** "2506 Frazier Ave, Madison, WI 53713, USA" → its parts, read from the END. */
export function parseAddress(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
  const out = { raw, street: null, city: null, state: null, postalCode: null, country: null }
  let rest = parts.slice()
  if (rest.length && /^[A-Za-z]{2,}$/.test(rest[rest.length - 1]) && rest.length > 2) {
    out.country = rest.pop()
  }
  const tail = rest.length ? rest[rest.length - 1] : ''
  const sz = tail.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/)
  if (sz) {
    out.state = sz[1].toUpperCase()
    out.postalCode = sz[2]
    rest.pop()
  } else {
    const zipOnly = tail.match(/^(\d{5}(?:-\d{4})?)$/)
    if (zipOnly) { out.postalCode = zipOnly[1]; rest.pop() }
  }
  if (rest.length) out.city = rest.pop()
  if (rest.length) out.street = rest.join(', ')
  return out
}

// ─── Load blocks ────────────────────────────────────────────────────────────

/** Split a row into a left-margin label and the value cells to its right. */
function splitLabelValue(row) {
  const cells = row.cells
  if (!cells.length) return { label: null, value: null, valueX: null }
  if (cells[0].x > LABEL_X_MAX) return { label: null, value: null, valueX: cells[0].x }
  if (cells.length === 1) {
    // "Label value" with no column gap between them — the cover page and the
    // design grid both do this.
    return { label: cells[0].text, value: null, valueX: null, inline: true }
  }
  return {
    label: cells[0].text,
    value: cells.slice(1).map(c => c.text).join(' '),
    valueX: cells[1].x,
  }
}

/** Label and value where they share one cell: "Elevation 878ft". */
function splitInline(text, map) {
  const words = String(text).split(' ')
  for (let take = Math.min(words.length - 1, 6); take >= 1; take--) {
    const label = words.slice(0, take).join(' ')
    if (map.has(labelKey(label))) return { label, value: words.slice(take).join(' ') }
  }
  return null
}

function newBlock(scope, heading, name, page) {
  return {
    scope,
    system: null,
    zone: null,
    room: null,
    story: null,
    heading,
    name,
    page,
    geometry: {},
    exposedWallByOrientation: {},
    distribution: {},
    rooms: [],
    total: null,
    components: [],
  }
}

function parseLoadBlocks(rows, warnings) {
  const blocks = []
  let heading = null
  let block = null
  let mode = 'idle'          // idle | facts | table
  let lastLabel = null
  let lastValueX = null
  let pendingComponent = null

  const closeBlock = () => {
    if (block) blocks.push(block)
    block = null
    pendingComponent = null
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const text = rowText(row)

    // A `·` between a system and its zone lands on its own row.
    if (text === '·') continue

    const head = asHeading(row)
    if (head) { heading = head; continue }

    // ── the sub-heading that opens a block ──
    const opened = openingBlock(row, text, heading, rows, i)
    if (opened) {
      closeBlock()
      block = opened
      mode = 'facts'
      lastLabel = null
      continue
    }

    if (!block) continue

    if (isLoadTableHeader(row)) { mode = 'table'; continue }
    if (isUnitsRow(row)) continue

    if (mode === 'table') {
      const comp = asComponentRow(row)
      if (comp) {
        pendingComponent = comp
        if (labelKey(comp.name) === 'total') block.total = comp.values
        else block.components.push(comp)
        continue
      }
      // A component label that wrapped: "Infiltration Loss and" / "Gain". The
      // numbers were on the first row, so this only completes the name.
      if (row.cells.length === 1 && row.cells[0].x <= LABEL_X_MAX && pendingComponent) {
        pendingComponent.name = `${pendingComponent.name} ${row.cells[0].text}`.trim()
        continue
      }
      continue
    }

    // ── facts: label / value pairs, some wrapping over several rows ──
    const { label, value, valueX, inline } = splitLabelValue(row)

    if (label && !inline) {
      const applied = applyFact(block, label, value)
      if (applied) { lastLabel = applied; lastValueX = valueX; continue }
      if (ORIENTATIONS.has(label.toUpperCase()) && value != null) {
        block.exposedWallByOrientation[label.toUpperCase()] = parseNumber(value)
        lastLabel = null
        continue
      }
      lastLabel = null
      continue
    }

    if (label && inline) {
      const hit = splitInline(text, GEOMETRY_FIELDS) || splitInline(text, DISTRIBUTION_FIELDS)
      if (hit) { lastLabel = applyFact(block, hit.label, hit.value); continue }
      lastLabel = null
      continue
    }

    // A value that wrapped onto its own row, in the value column.
    if (!label && lastLabel && row.cells[0].x >= LABEL_X_MAX) {
      if (lastLabel === 'rooms') block.rooms.push(text)
      else if (lastValueX != null) appendToFact(block, lastLabel, text)
      continue
    }
  }

  closeBlock()
  if (blocks.some(b => !b.total)) {
    warnings.push('A load block was found with no totals row; its numbers were left empty rather than guessed.')
  }
  return blocks
}

/**
 * Does this row open a block? "Load Summary", "Zone 1 Load Summary" and
 * "<Room> Load" are the three shapes, and the heading above supplies the rest.
 */
function openingBlock(row, text, heading, rows, i) {
  if (row.cells.length !== 1 || row.cells[0].x > LABEL_X_MAX) return null
  const h = heading || ''
  const isWholeHome = labelKey(h) === labelKey('WHOLE HOME')
  const isUnassigned = labelKey(h) === labelKey('UNASSIGNED')

  if (labelKey(text) === labelKey('Load Summary')) {
    const b = newBlock(isWholeHome ? 'whole_home' : 'system', h, isWholeHome ? 'Whole Home' : titleCaseHeading(h), row.page)
    if (!isWholeHome) b.system = titleCaseHeading(h)
    return b
  }

  const zone = text.match(/^(.*?)\s+Load Summary$/i)
  if (zone) {
    const b = newBlock('zone', h, `${titleCaseHeading(h)} — ${zone[1]}`, row.page)
    b.system = titleCaseHeading(h)
    b.zone = zone[1].trim()
    return b
  }

  const room = text.match(/^(.*?)\s+Load$/i)
  if (room && room[1] && !/^whole home$/i.test(room[1])) {
    const b = newBlock(isUnassigned ? 'unassigned_room' : 'room', h, room[1].trim(), row.page)
    b.room = room[1].trim()
    // The running header of a room page is "<SYSTEM> ZONE n".
    const z = h.match(/^(.*?)\s+ZONE\s+(\S+)$/i)
    if (z) { b.system = titleCaseHeading(z[1]); b.zone = `Zone ${z[2]}` }
    else if (!isUnassigned && h) b.system = titleCaseHeading(h)
    // The story is printed directly beneath the room name.
    const next = rows[i + 1]
    if (next && next.cells.length === 1 && next.cells[0].x <= LABEL_X_MAX) {
      const t = rowText(next)
      if (/story|basement|attic|crawl/i.test(t) && !/Load$/i.test(t)) b.story = t
    }
    return b
  }
  return null
}

/** "COLD CLIMATE HEAT PUMP" → "Cold Climate Heat Pump". */
export function titleCaseHeading(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/\b[a-z]/g, c => c.toUpperCase())
    .trim()
}

function applyFact(block, label, value) {
  const key = labelKey(label)
  if (key === 'rooms') {
    if (value) block.rooms.push(value)
    return 'rooms'
  }
  const g = GEOMETRY_FIELDS.get(key)
  if (g) {
    block.geometry[g] = NUMERIC_GEOMETRY.has(g) ? parseNumber(value) : (value || null)
    return `geometry.${g}`
  }
  const d = DISTRIBUTION_FIELDS.get(key)
  if (d) {
    block.distribution[d] = NUMERIC_DISTRIBUTION.has(d) ? parseNumber(value) : (value || null)
    return `distribution.${d}`
  }
  return null
}

function appendToFact(block, path, extra) {
  const [group, field] = path.split('.')
  if (!field || !block[group]) return
  const cur = block[group][field]
  if (typeof cur === 'string') block[group][field] = `${cur} ${extra}`.trim()
}

/** A component row: a label and exactly four measures. */
function asComponentRow(row) {
  if (row.cells.length < 5) return null
  if (row.cells[0].x > LABEL_X_MAX) return null
  if (!isLoadComponentLabel(row.cells[0].text)) return null
  const numbers = row.cells.slice(1)
  if (numbers.length !== LOAD_MEASURES.length) return null
  const values = {}
  for (let i = 0; i < LOAD_MEASURES.length; i++) {
    const n = parseNumber(numbers[i].text)
    if (n == null) return null
    values[LOAD_MEASURES[i]] = n
  }
  return { name: row.cells[0].text, values }
}

// ─── Building materials ─────────────────────────────────────────────────────

const MATERIAL_COLUMNS = [
  'constructionType', 'constructionNumber', 'orientation',
  'areaSqFt', 'coolingBtuh', 'heatingBtuh', 'uValue',
]

/**
 * The second line of the materials column header — "Type | Number |
 * applicable) | (ft ) | BTUH | BTUH | Value". It is the anchor row: it sits
 * directly above the data, so a cell at x 529 lands on U-Value rather than on
 * the Heating column 60pt to its left.
 */
const isMaterialsAnchorRow = row =>
  row.cells.length >= 7 &&
  labelKey(row.cells[0].text) === 'type' &&
  labelKey(row.cells[row.cells.length - 1].text) === 'value'

function parseMaterials(rows, warnings) {
  // Deliberately anchored on the column header and NOT on the section title:
  // "Building Materials Breakdown" appears twice, once in the table of
  // contents on page 1, and starting there walks the reader into the design
  // conditions grid and gives up before reaching any material.
  const start = rows.findIndex(isMaterialsAnchorRow)
  if (start < 0) {
    if (rows.some(r => labelKey(rowText(r)) === labelKey('Building Materials Breakdown'))) {
      warnings.push('The Building Materials table was found with no column header; it was not read.')
    }
    return []
  }

  const out = []
  let anchors = null
  let current = null
  let description = []

  const flush = () => {
    if (current) {
      current.description = description.join(' ').replace(/\s+/g, ' ').trim() || null
      // Conduit closes a multi-orientation assembly with a "total" row. It is
      // marked rather than dropped — it is a real printed figure — but summing
      // areas across the table without honouring the flag counts every window
      // twice.
      current.isTotalRow = labelKey(current.orientation) === 'total'
      out.push(current)
    }
    current = null
    description = []
  }

  for (let i = start; i < rows.length; i++) {
    const row = rows[i]
    const text = rowText(row)

    // The header is two lines and repeats at the top of each continuation page.
    if (isMaterialsAnchorRow(row)) { anchors = row.cells.map(c => c.x); continue }
    if (row.cells.length >= 7 && labelKey(row.cells[0].text) === 'construction') continue
    if (/floor plan$/i.test(text) || /^Terms and Conditions/i.test(text)) break

    if (row.cells[0].x >= 65 && row.cells.length === 1) {
      // A description line. The first carries the ↳ marker; the rest wrap.
      description.push(text.replace(/^↳\s*/, ''))
      continue
    }

    if (row.cells.length === 1 && row.cells[0].x < 65) {
      // The construction type wrapped: "Above-Grade" / "Wall".
      if (current) current.constructionType = `${current.constructionType} ${text}`.trim()
      continue
    }

    if (!anchors) { warnings.push('The Building Materials table was found with no column header; it was not read.'); break }

    flush()
    current = { constructionType: null, constructionNumber: null, orientation: null, areaSqFt: null, coolingBtuh: null, heatingBtuh: null, uValue: null, description: null }
    for (const cell of row.cells) {
      const col = MATERIAL_COLUMNS[nearestColumn(cell.x, anchors)]
      if (!col) continue
      if (col === 'areaSqFt' || col === 'coolingBtuh' || col === 'heatingBtuh' || col === 'uValue') {
        current[col] = parseNumber(cell.text)
      } else {
        current[col] = current[col] ? `${current[col]} ${cell.text}` : cell.text
      }
    }
  }
  flush()
  return out
}

/**
 * Which column a cell belongs to, by x. Numbers are right-aligned so a cell's
 * x moves with its width; the nearest anchor is what identifies the column, and
 * a column with no cell at all stays empty — which is how "Below-Grade Wall"
 * keeps its blank cooling load instead of stealing the heating one.
 */
export function nearestColumn(x, anchors) {
  let best = -1
  let bestD = Infinity
  anchors.forEach((ax, i) => {
    const d = Math.abs(x - ax)
    if (d < bestD) { bestD = d; best = i }
  })
  return best
}
