// ---------------------------------------------------------------------------
// ventilationSupplementalDataSheet — pure rules for the IRA Home Energy Rebates
// Quality Installation Supplemental Data Sheet.
//
// The programme administrator's own workbook, one row per dwelling unit, naming
// the model installed in each. Nicholas supplied the filled example for GREEN
// VALLEY ESTATES (570 South Clark Street, Whitewater — 8 units) and asked for it
// to "auto-generate when the enrollment record is created based off the
// opportunity", triggered by the WI-IRA-MF-HEAR-Project-Reservation enrollment
// record type.
//
// ── This fills the administrator's workbook; it does not draw one ─────────
//
// The template is their binary, shipped as an app asset and filled by cell
// surgery (see fillSupplementalDataSheet in the service). That is deliberate:
// the sheet is READ by a person at Focus On Energy who expects their own
// layout, their own header wording, and the Measure Type dropdown validated
// against their own "Data Validation" tab. Rebuilding it from scratch — the way
// the Tenant Data Sheet in incomeQualificationService is built — would produce
// a workbook that merely resembles theirs, and every revision they issue would
// have to be re-implemented instead of re-dropped.
//
// The template carries 543 pre-styled rows with the Measure Type dropdown
// validated across all of them, so no row-insertion machinery is needed.
// Nicholas: "we're only going to have 24 units or 40 units ever, so we don't
// need 500 units." The cap is asserted, not assumed — see MAX_TEMPLATE_ROWS.
//
// Kept free of React and Supabase so every rule below is testable — see
// scripts/ventilation-supplemental-data-sheet-fixture.mjs.
// ---------------------------------------------------------------------------

/** The enrollment record type that files this sheet. */
export const SUPPLEMENTAL_SHEET_ENROLLMENT_RECORD_TYPE = 'WI-IRA-MF-HEAR-Project-Reservation'

/** The documents.document_type this sheet is filed under. */
export const SUPPLEMENTAL_SHEET_DOCUMENT_TYPE = 'hear_quality_installation_supplemental_data_sheet'

/** The documents.category the sheet and its supporting product files share. */
export const SUPPLEMENTAL_SHEET_CATEGORY = 'HEAR Project Reservation'

/** Where the template asset lives, relative to the site root. */
export const SUPPLEMENTAL_SHEET_TEMPLATE_URL = '/paperwork/ira_supplemental_data_sheet.xlsx'

/**
 * The first data row and the last row the template has styled and validated.
 *
 * Row 6 is the header. Rows 7..549 exist in the template with their cells,
 * styles and the Measure Type dropdown already in place. Writing past 549 would
 * land in rows the workbook does not define — no style, and crucially no
 * validation, so the administrator's dropdown would simply be absent on those
 * rows and the value would not be checked against their list.
 */
export const FIRST_DATA_ROW = 7
export const LAST_TEMPLATE_ROW = 549
export const MAX_TEMPLATE_ROWS = LAST_TEMPLATE_ROW - FIRST_DATA_ROW + 1 // 543

/**
 * The template's columns, in its order. The header text is the administrator's
 * own wording and is NOT rewritten — it is here so the fixture can assert the
 * shipped template still says what this module thinks it says. A template
 * revision that renames a column must fail loudly, not fill the wrong one.
 */
export const SHEET_COLUMNS = Object.freeze([
  { col: 'A', key: 'buildingName',  header: 'Building Name - optional' },
  { col: 'B', key: 'streetAddress', header: 'Street Address' },
  { col: 'C', key: 'unitNumber',    header: 'Unit Number' },
  { col: 'D', key: 'measureType',   header: 'Measure Type' },
  { col: 'E', key: 'modelNumber',   header: 'Model Number' },
  { col: 'F', key: 'serialNumber',  header: 'Serial Number' },
  { col: 'G', key: 'ahriNumber',    header: 'AHRI Number (HVAC only)' },
  { col: 'H', key: 'city',          header: 'City' },
  { col: 'I', key: 'state',         header: 'State' },
  { col: 'J', key: 'zipCode',       header: 'Zip Code' },
])

/**
 * The value written when a column does not apply to this measure.
 *
 * The administrator's filled example writes the literal "N/A" rather than
 * leaving the cell empty, and the distinction carries meaning to them: blank
 * reads as "not answered yet", N/A reads as "answered — this measure has none".
 * A bath fan has no serial plate and no AHRI certificate, so both are N/A.
 */
export const NOT_APPLICABLE = 'N/A'

/**
 * Equipment product record type -> the Measure Type the administrator's
 * dropdown expects.
 *
 * Every value here MUST appear on the workbook's own "Data Validation" tab, or
 * Excel flags the cell the moment they open it. Their list is: Heating,
 * Cooling, Ventilation, Water Heating, and the six ENERGY STAR appliances.
 *
 * Ventilation is BUILT. Heat pumps and furnaces are DECLARED and not built, in
 * the pattern assessmentReport.js already uses for single-family: the platform
 * says the sheet does not cover that measure yet rather than emitting a row
 * with a measure type guessed from a category name. A heat pump is genuinely
 * ambiguous here — it is Heating, or Cooling, or both depending on what it
 * replaced, and that is a programme question nobody has answered.
 */
/**
 * The Measure Type values the programme administrator's own dropdown accepts,
 * from the workbook's "Data Validation" tab. A value not on this list is
 * flagged by Excel the moment they open the file.
 *
 * Held here so the fixture can check it against the SHIPPED template rather
 * than trusting this list — if the programme revises their form, the mismatch
 * fails the build instead of reaching a filing.
 */
export const PROGRAMME_MEASURE_TYPES = Object.freeze([
  'Heating', 'Cooling', 'Ventilation', 'Water Heating',
  'ENERGY STAR Refrigerator', 'ENERGY STAR Dishwasher', 'ENERGY STAR Freezer',
  'ENERGY STAR Electric Cooking Product', 'ENERGY STAR Clothes Washer',
  'ENERGY STAR Clothes Dryer', 'ENERGY STAR Pool Pump',
])

/**
 * The Measure Type belongs to the MEASURE, not to the equipment's record type.
 *
 * The first cut of this keyed the column off the equipment product's record
 * type, which is wrong in a way the data already demonstrates: PRD-00002 (Rheem
 * ProTerra, a heat pump WATER HEATER) sits on the HEAT-PUMP-EQUIPMENT record
 * type alongside space-conditioning heat pumps. Keyed by equipment type it
 * would print as Heating and Cooling. The programme is paying for a measure —
 * "ENERGY STAR Electric Heat Pump Water Heater" — and Water Heating is what
 * belongs in the column.
 *
 * So the values ride on the measure product itself
 * (products.product_supplemental_measure_types), and this module only knows how
 * to READ them. A new measure is configured, never coded.
 *
 * A measure mapping to MORE THAN ONE value emits one row per value per unit.
 * Nicholas, on a space-heating-and-cooling heat pump: "Two rows per unit —
 * Heating and Cooling." The administrator's list has no combined value, and the
 * same physical unit legitimately carries both measures.
 */
export function measureTypesFor(line) {
  const raw = line?.measureTypes
  if (!Array.isArray(raw)) return []
  return raw.map(v => String(v ?? '').trim()).filter(Boolean)
}

/** A measure with no configured Measure Type cannot be printed on the sheet. */
export function isPrintableLine(line) {
  return measureTypesFor(line).length > 0
}

/**
 * Which units get a row.
 *
 * The administrator wants one row per DWELLING unit. BLD-00178 carries 11 unit
 * records — 8 dwelling units plus an Attic, a Mechanical Room and a Common Area
 * — and the sheet Nicholas filled has exactly 8 rows. The rule is read off the
 * unit's record type rather than guessed from its name: every one of the 291
 * live units in LEAP is typed, and a name rule would have to know that "Common
 * Area" is not a dwelling while "Unit 3" is.
 */
export const DWELLING_UNIT_RECORD_TYPE = 'DWELLING-UNIT'

export function isDwellingUnit(unit) {
  return String(unit?.unitRecordType ?? '').trim().toUpperCase() === DWELLING_UNIT_RECORD_TYPE
}

/**
 * Only the HEAR Project Reservation files this sheet.
 *
 * Nicholas named that one record type explicitly when offered a measure-driven
 * rule across every HEAR reservation. Narrow on purpose: NC and MI have no HEAR
 * reservation enrollment record type yet, and inventing coverage for programmes
 * whose paperwork nobody here has seen would produce a Wisconsin workbook for
 * another state's administrator.
 */
export function hasVentilationSupplementalDataSheet(tableName, recordTypeValue) {
  if (tableName !== 'enrollments') return false
  return String(recordTypeValue ?? '').trim().toUpperCase()
    === SUPPLEMENTAL_SHEET_ENROLLMENT_RECORD_TYPE.toUpperCase()
}

/**
 * The unit's street address.
 *
 * Nicholas: "you're gonna hyphenate the building address and then say unit
 * number for the unit address" — "570 South Clark Street - Unit 1". Derived,
 * because units carry no address column of their own; the building holds the
 * one address and the unit number distinguishes the door.
 *
 * A unit number that already reads as a unit ("Unit 3") is not doubled into
 * "Unit Unit 3". A non-numeric unit number (a lettered door, "3B") is passed
 * through as it stands — the administrator reads these, and inventing a format
 * for a door LEAP was told is called "3B" helps nobody.
 */
export function unitStreetAddress(buildingAddress, unitNumber) {
  const base = String(buildingAddress ?? '').trim()
  const num = String(unitNumber ?? '').trim()
  if (!base) return num ? `Unit ${num}` : ''
  if (!num) return base
  const labelled = /^unit\b/i.test(num) ? num : `Unit ${num}`
  return `${base} - ${labelled}`
}

/**
 * The building name column — the administrator's "Building Name - optional".
 *
 * property_aka_name is the trade name a person recognises ("GREEN VALLEY
 * ESTATES"); property_name is LEAP's derived "570 South Clark Street -
 * Whitewater", which restates the address column beside it and tells the reader
 * nothing new. So the aka name wins, and the column is genuinely left EMPTY
 * when there isn't one — it is marked optional on their sheet, and repeating
 * the address in it would be noise dressed as data.
 */
export function buildingNameFor(property) {
  return String(property?.propertyAkaName ?? '').trim()
}

/**
 * The model number as the administrator reads it: "Panasonic FV-0511VF1".
 *
 * Composed from manufacturer + model number rather than taken from the product
 * NAME, because a name is free text somebody can rename to anything, while
 * those two columns are the equipment's identity. The name is the fallback only
 * when neither is filled in.
 */
export function modelNumberFor(equipment) {
  if (!equipment) return ''
  const make = String(equipment.manufacturer ?? '').trim()
  const model = String(equipment.modelNumber ?? '').trim()
  if (make && model) return `${make} ${model}`
  if (model) return model
  if (make) return make
  return String(equipment.name ?? '').trim()
}

/**
 * Natural ordering, so unit 10 follows unit 9 rather than unit 1.
 *
 * A plain string sort puts "10" between "1" and "2", which on a 24-unit
 * building produces a sheet the administrator has to re-sort by hand.
 */
export function compareUnitNumbers(a, b) {
  const na = String(a ?? ''), nb = String(b ?? '')
  const ia = parseInt(na, 10), ib = parseInt(nb, 10)
  const aNum = /^\d+$/.test(na.trim()), bNum = /^\d+$/.test(nb.trim())
  if (aNum && bNum) return ia - ib
  if (aNum) return -1          // numbered doors before named spaces
  if (bNum) return 1
  return na.localeCompare(nb, 'en', { numeric: true, sensitivity: 'base' })
}

/**
 * Resolve the equipment installed in one unit.
 *
 * A line item scoped to a unit (opportunity_line_items.unit_id) claims that
 * unit; otherwise the building-wide line for the measure covers it. That is
 * what makes "most units get the Panasonic, these three get something else"
 * expressible with no further schema — unit_id has been on the line item all
 * along.
 *
 * Two building-wide lines naming DIFFERENT models is genuinely ambiguous: the
 * data does not say which unit gets which. That returns null with a reason
 * rather than picking the first, because a model number is the one thing this
 * sheet exists to report and a confident wrong answer is worse than a gap the
 * reader can see.
 */
export function equipmentForUnit(unitId, equipmentLines) {
  const lines = Array.isArray(equipmentLines) ? equipmentLines : []
  const scoped = lines.filter(l => l.unitId && l.unitId === unitId)
  if (scoped.length === 1) return { equipment: scoped[0].equipment, ambiguous: false }
  if (scoped.length > 1) {
    const models = new Set(scoped.map(l => modelNumberFor(l.equipment)))
    if (models.size === 1) return { equipment: scoped[0].equipment, ambiguous: false }
    return { equipment: null, ambiguous: true, reason: 'more than one model is recorded for this unit' }
  }
  const buildingWide = lines.filter(l => !l.unitId)
  if (buildingWide.length === 0) return { equipment: null, ambiguous: false, reason: 'no equipment line covers this unit' }
  const models = new Set(buildingWide.map(l => modelNumberFor(l.equipment)))
  if (models.size > 1) {
    return { equipment: null, ambiguous: true, reason: 'the opportunity names more than one model and no line says which unit gets which' }
  }
  return { equipment: buildingWide[0].equipment, ambiguous: false }
}

/**
 * Build the sheet's rows.
 *
 * Input shapes are plain objects so this module never imports a client:
 *   property       { propertyAkaName }
 *   building       { address, city, state, zip }
 *   units          [{ id, unitNumber, unitRecordType }]
 *   equipmentLines [{ unitId, measureTypes: string[], equipment: { manufacturer,
 *                     modelNumber, name, isSerialized, ahriCertificateNumber } }]
 *
 * A row is one UNIT x one MEASURE TYPE. A building of 8 units with a ventilation
 * line yields 8 rows; add a space-conditioning heat pump line (Heating AND
 * Cooling) and the same building yields 24 — 8 ventilation, 8 heating, 8
 * cooling. That is the administrator's own shape: their Measure Type column
 * describes a measure, and their dropdown has no combined value.
 *
 * Rows are UNIT-MAJOR, so a unit's measures sit together and a reader scanning
 * for "what happened in apartment 3" finds it in one place rather than three
 * blocks apart.
 *
 * Returns { rows, warnings }. Warnings are surfaced to the person generating the
 * sheet — a silently short sheet is how a building gets filed with three units
 * missing.
 */
export function buildSupplementalRows({ property, building, units, equipmentLines }) {
  const warnings = []
  const allUnits = Array.isArray(units) ? units : []
  const dwellings = allUnits.filter(isDwellingUnit)
    .slice()
    .sort((a, b) => compareUnitNumbers(a.unitNumber, b.unitNumber))

  if (allUnits.length === 0) {
    warnings.push('This building has no unit records in LEAP, so the sheet has no rows. Add the units to the building first.')
  } else if (dwellings.length === 0) {
    warnings.push(`This building has ${allUnits.length} unit record(s) but none is typed as a Dwelling Unit, so the sheet has no rows.`)
  }

  const allLines = Array.isArray(equipmentLines) ? equipmentLines : []
  const lines = allLines.filter(isPrintableLine)
  const unconfigured = allLines.filter(l => !isPrintableLine(l))
  if (unconfigured.length > 0) {
    warnings.push(`${unconfigured.length} equipment line(s) are for a measure with no Measure Type configured, so they were left off. Set the Measure Type on the measure's product record.`)
  }
  if (lines.length === 0 && dwellings.length > 0) {
    warnings.push('No measures are recorded on the opportunity, so the sheet has no rows. Add the line items first, then regenerate.')
  }
  // A line that names its measure but not yet its model still lays out rows —
  // the Model Number is simply blank, and that is the state the sheet is in
  // when it auto-generates before anybody has chosen a fan.
  const unchosen = lines.filter(l => !l.equipment)
  if (unchosen.length > 0 && dwellings.length > 0) {
    warnings.push(`${unchosen.length} line item(s) have no equipment selected, so their Model Number column is empty. Pick the model on the line item, then regenerate.`)
  }

  // Every Measure Type present, in the order the measures declare them, so the
  // sheet's row order is stable between regenerations.
  const measureTypes = []
  for (const l of lines) {
    for (const t of measureTypesFor(l)) if (!measureTypes.includes(t)) measureTypes.push(t)
  }

  const buildingName = buildingNameFor(property)
  const rows = []
  for (const u of dwellings) {
    for (const measureType of measureTypes) {
      // Resolve the equipment WITHIN this measure. Scoping the search matters:
      // a building with both a fan line and a heat pump line must not offer the
      // fan as a candidate for the Heating row, and the ambiguity check must
      // compare fans against fans.
      const forMeasure = lines.filter(l => measureTypesFor(l).includes(measureType))
      const { equipment, ambiguous, reason } = equipmentForUnit(u.id, forMeasure)
      if (ambiguous) {
        warnings.push(`Unit ${u.unitNumber} (${measureType}): ${reason}.`)
      }
      // A measure that does not cover this unit produces no row at all, rather
      // than a row with an empty Model Number. An absent row says "this unit is
      // not part of that measure"; a blank one says "we forgot".
      if (!equipment && forMeasure.length > 0 && forMeasure.every(l => l.unitId)) continue
      rows.push({
        buildingName,
        streetAddress: unitStreetAddress(building?.address, u.unitNumber),
        unitNumber:    u.unitNumber ?? '',
        measureType,
        modelNumber:   modelNumberFor(equipment),
        serialNumber:  equipment?.isSerialized ? '' : NOT_APPLICABLE,
        ahriNumber:    String(equipment?.ahriCertificateNumber ?? '').trim() || NOT_APPLICABLE,
        city:          String(building?.city ?? '').trim(),
        state:         String(building?.state ?? '').trim(),
        zipCode:       String(building?.zip ?? '').trim(),
      })
    }
  }

  if (rows.length > MAX_TEMPLATE_ROWS) {
    warnings.push(`This building needs ${rows.length} rows but the programme's workbook only defines ${MAX_TEMPLATE_ROWS}. The sheet was cut at ${MAX_TEMPLATE_ROWS}.`)
    return { rows: rows.slice(0, MAX_TEMPLATE_ROWS), warnings }
  }
  return { rows, warnings }
}

/**
 * The saved file's name.
 *
 * Named for the BUILDING, because the sheet covers one building's units and an
 * enrollment on a second building produces a second sheet — two files called
 * "Supplemental Data Sheet" in one packet is how the wrong one gets sent.
 */
export function supplementalSheetFileName({ building, enrollmentRecordNumber }) {
  const part = s => String(s ?? '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const addr = part(building?.address) || 'Building'
  const enr = part(enrollmentRecordNumber)
  return [addr, enr, 'Quality_Installation_Supplemental_Data_Sheet'].filter(Boolean).join('_') + '.xlsx'
}
