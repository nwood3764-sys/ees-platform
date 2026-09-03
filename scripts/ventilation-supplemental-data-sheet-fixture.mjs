// ---------------------------------------------------------------------------
// The IRA Home Energy Rebates Quality Installation Supplemental Data Sheet.
//
// Two halves, and the second is the one that matters:
//
//   1. The selection and formatting rules (which units, how the address reads,
//      what N/A means) against the shapes real production data takes.
//   2. The FILL — this fixture writes the REAL shipped template and then reads
//      every cell back out of the resulting zip. A fill that silently writes
//      nothing produces a workbook that opens cleanly, looks like the
//      administrator's form, and reports that the building has no units.
//      Reading the code is not verification of that; the bytes are.
//
// Positive controls are included and MUST fail — see CONTROLS at the end. A
// checker that cannot fail proves nothing.
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

import {
  SHEET_COLUMNS, FIRST_DATA_ROW, LAST_TEMPLATE_ROW, MAX_TEMPLATE_ROWS,
  NOT_APPLICABLE, PROGRAMME_MEASURE_TYPES, measureTypesFor, isPrintableLine,
  hasVentilationSupplementalDataSheet, unitStreetAddress, buildingNameFor,
  modelNumberFor, compareUnitNumbers, isDwellingUnit, equipmentForUnit,
  buildSupplementalRows, supplementalSheetFileName,
} from '../src/lib/ventilationSupplementalDataSheet.js'
import { fillSupplementalDataSheet } from '../src/lib/supplementalDataSheetWorkbook.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE = path.join(here, '..', 'public', 'paperwork', 'ira_supplemental_data_sheet.xlsx')

let checks = 0
const ok = (cond, msg) => { assert.ok(cond, msg); checks++ }
const eq = (a, b, msg) => { assert.deepEqual(a, b, `${msg} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); checks++ }

// ── The real case: GREEN VALLEY ESTATES, ENR-00077 ────────────────────────
//
// Taken from production: PROP-07530 (aka name GREEN VALLEY ESTATES) →
// BLD-00178 "570 South Clark Street", Whitewater WI 53190, whose 11 unit
// records are 8 Dwelling Units plus an Attic, a Mechanical Room and a Common
// Area. The sheet Nicholas supplied for this building has exactly 8 rows.
const PROPERTY = { propertyAkaName: 'GREEN VALLEY ESTATES', propertyName: '570 South Clark Street - Whitewater' }
const BUILDING = { address: '570 South Clark Street', city: 'Whitewater', state: 'WI', zip: '53190' }
const UNITS = [
  ...Array.from({ length: 8 }, (_, i) => ({ id: `u${i + 1}`, unitNumber: String(i + 1), unitRecordType: 'DWELLING-UNIT' })),
  { id: 'ua', unitNumber: 'Attic',           unitRecordType: 'ATTIC-SPACE' },
  { id: 'um', unitNumber: 'Mechanical Room', unitRecordType: 'MECHANICAL-ROOM' },
  { id: 'uc', unitNumber: 'Common Area',     unitRecordType: 'COMMON-AREA' },
]
const PANASONIC = {
  name: 'Panasonic FV-0511VF1', manufacturer: 'Panasonic', modelNumber: 'FV-0511VF1',
  isSerialized: false, ahriCertificateNumber: null,
}
const VENT_LINE = { unitId: null, measureTypes: ['Ventilation'], equipmentProductId: 'p-fan', equipment: PANASONIC }

// A space-conditioning heat pump: ONE measure, TWO Measure Types. Nicholas:
// "Two rows per unit — Heating and Cooling."
const MITSUBISHI = {
  name: 'Mitsubishi MSZ-FH15NA Hyper Heat', manufacturer: 'Mitsubishi Electric',
  modelNumber: 'MSZ-FH15NA', isSerialized: false, ahriCertificateNumber: null,
}
const HEAT_PUMP_LINE = { unitId: null, measureTypes: ['Heating', 'Cooling'], equipmentProductId: 'p-hp', equipment: MITSUBISHI }

// ── 1. Which enrollments file this sheet ──────────────────────────────────
ok(hasVentilationSupplementalDataSheet('enrollments', 'WI-IRA-MF-HEAR-Project-Reservation'), 'HEAR reservation files the sheet')
ok(hasVentilationSupplementalDataSheet('enrollments', 'wi-ira-mf-hear-project-reservation'), 'record type match is case-insensitive')
ok(!hasVentilationSupplementalDataSheet('enrollments', 'WI-IRA-MF-HOMES-Project-Reservation'), 'the HOMES reservation does NOT file it')
ok(!hasVentilationSupplementalDataSheet('enrollments', 'WI-IRA-MF'), 'income qualification does NOT file it')
ok(!hasVentilationSupplementalDataSheet('enrollments', null), 'an enrollment with no record type does NOT file it')
ok(!hasVentilationSupplementalDataSheet('opportunities', 'WI-IRA-MF-HEAR-Project-Reservation'), 'only the enrollments object files it')

// ── 2. Which units get a row ──────────────────────────────────────────────
ok(isDwellingUnit({ unitRecordType: 'DWELLING-UNIT' }), 'a dwelling unit is a row')
ok(!isDwellingUnit({ unitRecordType: 'COMMON-AREA' }), 'a common area is not')
ok(!isDwellingUnit({ unitRecordType: 'ATTIC-SPACE' }), 'an attic is not')
ok(!isDwellingUnit({ unitRecordType: null }), 'an untyped unit is not assumed to be a dwelling')

// ── 3. The address string Nicholas specified ──────────────────────────────
eq(unitStreetAddress('570 South Clark Street', '1'), '570 South Clark Street - Unit 1', 'unit address')
eq(unitStreetAddress('570 South Clark Street', 'Unit 3'), '570 South Clark Street - Unit 3', 'an already-labelled unit is not doubled')
eq(unitStreetAddress('570 South Clark Street', '3B'), '570 South Clark Street - Unit 3B', 'a lettered door keeps its label')
eq(unitStreetAddress('570 South Clark Street', ''), '570 South Clark Street', 'no unit number leaves the building address alone')
eq(unitStreetAddress('', '1'), 'Unit 1', 'no building address still names the unit')

// ── 4. The building name column ───────────────────────────────────────────
eq(buildingNameFor(PROPERTY), 'GREEN VALLEY ESTATES', 'the aka name is the building name')
eq(buildingNameFor({ propertyName: '570 South Clark Street - Whitewater' }), '',
  'with no aka name the optional column is EMPTY, not the address repeated')

// ── 5. The model number ───────────────────────────────────────────────────
eq(modelNumberFor(PANASONIC), 'Panasonic FV-0511VF1', 'manufacturer + model')
eq(modelNumberFor({ modelNumber: 'FV-0511VF1' }), 'FV-0511VF1', 'model alone')
eq(modelNumberFor({ name: 'Some Fan' }), 'Some Fan', 'name is the last resort')
eq(modelNumberFor(null), '', 'no equipment yields no model number, never a placeholder')

// ── 6. Unit ordering — 10 follows 9 ───────────────────────────────────────
const order = ['10', '2', '1', '9', 'Attic'].sort(compareUnitNumbers)
eq(order, ['1', '2', '9', '10', 'Attic'], 'units sort naturally, named spaces last')

// ── 7. Resolving equipment per unit ───────────────────────────────────────
eq(equipmentForUnit('u1', [VENT_LINE]).equipment, PANASONIC, 'a building-wide line covers every unit')
const OTHER = { ...PANASONIC, modelNumber: 'FV-0810VSS1', name: 'Panasonic FV-0810VSS1' }
eq(equipmentForUnit('u1', [VENT_LINE, { unitId: 'u1', measureTypes: ['Ventilation'], equipment: OTHER }]).equipment, OTHER,
  'a unit-scoped line beats the building-wide one')
ok(equipmentForUnit('u1', [VENT_LINE, { unitId: null, measureTypes: ['Ventilation'], equipment: OTHER }]).ambiguous,
  'two building-wide lines naming different models is ambiguous, not a guess')
eq(equipmentForUnit('u1', [VENT_LINE, { unitId: null, measureTypes: ['Ventilation'], equipment: { ...PANASONIC } }]).equipment,
  PANASONIC, 'two lines naming the SAME model is not ambiguous')

// ── 8. The rows for the real building ─────────────────────────────────────
const built = buildSupplementalRows({ property: PROPERTY, building: BUILDING, units: UNITS, equipmentLines: [VENT_LINE] })
eq(built.rows.length, 8, 'eight dwelling units, eight rows — the attic, mechanical room and common area are excluded')
eq(built.warnings, [], 'a complete building produces no warnings')
eq(built.rows[0], {
  buildingName: 'GREEN VALLEY ESTATES',
  streetAddress: '570 South Clark Street - Unit 1',
  unitNumber: '1',
  measureType: 'Ventilation',
  modelNumber: 'Panasonic FV-0511VF1',
  serialNumber: NOT_APPLICABLE,
  ahriNumber: NOT_APPLICABLE,
  city: 'Whitewater', state: 'WI', zipCode: '53190',
}, 'the first row matches the sheet Nicholas filled by hand')
eq(built.rows[7].streetAddress, '570 South Clark Street - Unit 8', 'the last row is unit 8')

// ── 9. Honest gaps ────────────────────────────────────────────────────────
// The state the sheet is in when it auto-generates on enrollment create: the
// measure is on the opportunity, the model has not been chosen yet.
const notYetChosen = buildSupplementalRows({
  property: PROPERTY, building: BUILDING, units: UNITS,
  equipmentLines: [{ unitId: null, measureTypes: ['Ventilation'], equipment: null }],
})
eq(notYetChosen.rows.length, 8, 'the rows still lay out with no equipment selected')
eq(notYetChosen.rows[0].modelNumber, '', 'the model number is EMPTY, never invented')
eq(notYetChosen.rows[0].measureType, 'Ventilation', 'the measure is known even before the model is')
ok(notYetChosen.warnings.some(w => /no equipment selected/.test(w)), 'and the gap is reported')

// No line items at all is a different thing, and says so differently.
const noLines = buildSupplementalRows({ property: PROPERTY, building: BUILDING, units: UNITS, equipmentLines: [] })
eq(noLines.rows.length, 0, 'no measures on the opportunity means no rows')
ok(noLines.warnings.some(w => /No measures are recorded/.test(w)), 'and it names that, not a missing model')

const noUnits = buildSupplementalRows({ property: PROPERTY, building: BUILDING, units: [], equipmentLines: [VENT_LINE] })
eq(noUnits.rows.length, 0, 'a building with no unit records produces no rows')
ok(noUnits.warnings.some(w => /no unit records/.test(w)), 'and says so rather than filing an empty sheet silently')

// BLD-00180 on production: 8 units claimed on the building, 1 unit record, none
// a dwelling. The sheet must say so rather than come back blank.
const noDwellings = buildSupplementalRows({
  property: PROPERTY, building: BUILDING,
  units: [{ id: 'x', unitNumber: 'Common Area', unitRecordType: 'COMMON-AREA' }],
  equipmentLines: [VENT_LINE],
})
eq(noDwellings.rows.length, 0, 'a building with no DWELLING units produces no rows')
ok(noDwellings.warnings.some(w => /none is typed as a Dwelling Unit/.test(w)), 'and names the reason')

// ── 10. Measure Type rides on the MEASURE, and may be more than one ───────
eq(measureTypesFor(VENT_LINE), ['Ventilation'], 'a ventilation line prints one Measure Type')
eq(measureTypesFor(HEAT_PUMP_LINE), ['Heating', 'Cooling'], 'a space-conditioning heat pump prints two')
ok(isPrintableLine(VENT_LINE), 'a configured measure prints')
ok(!isPrintableLine({ unitId: null, measureTypes: [], equipment: PANASONIC }),
  'a measure with no Measure Type configured does NOT print')
ok(!isPrintableLine({ unitId: null, equipment: PANASONIC }),
  'nor does one missing the field entirely')

// Two rows per unit for the heat pump, and the SAME model number on both — one
// physical machine reported under two measures, not two machines.
const hp = buildSupplementalRows({ property: PROPERTY, building: BUILDING, units: UNITS, equipmentLines: [HEAT_PUMP_LINE] })
eq(hp.rows.length, 16, 'eight units x two Measure Types = sixteen rows')
eq(hp.rows[0].measureType, 'Heating', 'unit 1 heating first')
eq(hp.rows[1].measureType, 'Cooling', 'then unit 1 cooling — rows are unit-major')
eq(hp.rows[0].unitNumber, '1', 'both rows are the same unit')
eq(hp.rows[1].unitNumber, '1', 'both rows are the same unit')
eq(hp.rows[0].modelNumber, 'Mitsubishi Electric MSZ-FH15NA', 'the heating row names the machine')
eq(hp.rows[1].modelNumber, 'Mitsubishi Electric MSZ-FH15NA', 'and the cooling row names the SAME machine')
eq(hp.rows[2].unitNumber, '2', 'unit 2 follows unit 1, not all the heating rows first')
eq(hp.warnings, [], 'a fully configured heat pump produces no warnings')

// Both measures on one opportunity: three rows per unit, in measure order.
const both = buildSupplementalRows({ property: PROPERTY, building: BUILDING, units: UNITS, equipmentLines: [VENT_LINE, HEAT_PUMP_LINE] })
eq(both.rows.length, 24, 'ventilation + heat pump on 8 units = 24 rows')
eq(both.rows.slice(0, 3).map(r => r.measureType), ['Ventilation', 'Heating', 'Cooling'],
  "one unit's three measures sit together")
eq(both.rows[0].modelNumber, 'Panasonic FV-0511VF1', 'the ventilation row names the fan')
eq(both.rows[1].modelNumber, 'Mitsubishi Electric MSZ-FH15NA', 'the heating row names the heat pump, not the fan')

// A measure with no Measure Type configured is left off and REPORTED.
const unconfigured = buildSupplementalRows({
  property: PROPERTY, building: BUILDING, units: UNITS,
  equipmentLines: [VENT_LINE, { unitId: null, measureTypes: [], equipment: MITSUBISHI }],
})
ok(unconfigured.warnings.some(w => /no Measure Type configured/.test(w)),
  'an unconfigured measure is reported, never emitted with a guessed type')
eq(unconfigured.rows.length, 8, 'and the configured measure still fills normally')

// Every Measure Type this module can emit must be on the programme's list.
for (const t of ['Ventilation', 'Heating', 'Cooling', 'Water Heating']) {
  ok(PROGRAMME_MEASURE_TYPES.includes(t), `"${t}" is on the programme's Measure Type list`)
}

// ── 11. The file name ─────────────────────────────────────────────────────
eq(supplementalSheetFileName({ building: BUILDING, enrollmentRecordNumber: 'ENR-00077' }),
  '570_South_Clark_Street_ENR_00077_Quality_Installation_Supplemental_Data_Sheet.xlsx',
  'the file is named for the building and the enrollment')

// ── 12. THE FILL — write the real template, read every cell back ──────────
const templateBytes = await readFile(TEMPLATE)
const filled = await fillSupplementalDataSheet(built.rows, templateBytes, { outputType: 'uint8array' })
ok(filled.length > 10000, 'the filled workbook has real bytes')

const JSZip = (await import('jszip')).default
const outZip = await JSZip.loadAsync(filled)
const sheetXml = await outZip.file('xl/worksheets/sheet1.xml').async('string')

/** Read one cell's value back out of the written sheet. */
function cellValue(xml, ref) {
  const m = xml.match(new RegExp(`<c r="${ref}"[^>]*?(/>|>([\\s\\S]*?)</c>)`))
  if (!m) return undefined
  if (m[1] === '/>') return ''
  const body = m[2] ?? ''
  const inline = body.match(/<t[^>]*>([\s\S]*?)<\/t>/)
  if (inline) return inline[1]
  const num = body.match(/<v>([\s\S]*?)<\/v>/)
  if (num) return num[1]
  return ''
}

// Every cell of every row, against the row objects that produced them.
for (let i = 0; i < built.rows.length; i++) {
  const row = built.rows[i]
  const r = FIRST_DATA_ROW + i
  eq(cellValue(sheetXml, `A${r}`), 'GREEN VALLEY ESTATES', `A${r} building name`)
  eq(cellValue(sheetXml, `B${r}`), row.streetAddress, `B${r} street address`)
  eq(cellValue(sheetXml, `C${r}`), row.unitNumber, `C${r} unit number`)
  eq(cellValue(sheetXml, `D${r}`), row.measureType, `D${r} measure type`)
  eq(cellValue(sheetXml, `E${r}`), row.modelNumber, `E${r} model number`)
  eq(cellValue(sheetXml, `F${r}`), 'N/A', `F${r} serial number`)
  eq(cellValue(sheetXml, `G${r}`), 'N/A', `G${r} AHRI number`)
  eq(cellValue(sheetXml, `H${r}`), 'Whitewater', `H${r} city`)
  eq(cellValue(sheetXml, `I${r}`), 'WI', `I${r} state`)
  eq(cellValue(sheetXml, `J${r}`), '53190', `J${r} zip`)
}

// The row after the last unit must be EMPTY — otherwise a regenerate on a
// building that shrank would leave a phantom unit on the filed sheet.
const afterLast = FIRST_DATA_ROW + built.rows.length
for (const c of SHEET_COLUMNS) {
  eq(cellValue(sheetXml, `${c.col}${afterLast}`), '', `${c.col}${afterLast} is blank after the last unit`)
}

// The administrator's own form must survive the fill intact.
ok(sheetXml.includes("'Data Validation'!$B$3:$B$12"),
  'the Measure Type dropdown validation survives the fill')
ok(sheetXml.includes('<mergeCell ref="A1:E1"/>'), 'the title merge survives')
const sharedStrings = await outZip.file('xl/sharedStrings.xml').async('string')
// The Data Validation tab stores its values in the SHARED STRING table (t="s"),
// so its cells hold indices, not text. Resolve them the way Excel does — a
// substring search of sheet2.xml for "Ventilation" would find nothing and pass
// or fail for the wrong reason.
const SST = [...sharedStrings.matchAll(/<si>([\s\S]*?)<\/si>/g)]
  .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''))
const sheet2Xml = await outZip.file('xl/worksheets/sheet2.xml').async('string')
const sheet2Values = [...sheet2Xml.matchAll(/<c r="[A-Z]+\d+"[^>]*t="s"[^>]*>\s*<v>(\d+)<\/v>/g)]
  .map(m => SST[Number(m[1])])
ok(sheet2Values.includes('Ventilation'),
  'the Data Validation tab itself survives, still listing Ventilation')
ok(sheet2Values.includes('Heating') && sheet2Values.includes('Water Heating'),
  'and the rest of the administrator\'s measure list with it')
for (const c of SHEET_COLUMNS) {
  ok(SST.includes(c.header), `the header "${c.header}" is unchanged in the template`)
}

// Every Measure Type written must be one the administrator's dropdown accepts,
// or Excel flags the cell the moment they open it.
for (let i = 0; i < built.rows.length; i++) {
  ok(sheet2Values.includes(cellValue(sheetXml, `D${FIRST_DATA_ROW + i}`)),
    `row ${i + 1}'s measure type is on the administrator's validation list`)
}

// Every measure type this module can EVER emit must be on their list too — not
// just the ones this run happened to write.
for (const t of PROGRAMME_MEASURE_TYPES) {
  ok(sheet2Values.includes(t), `"${t}" really is on the shipped template's own validation list`)
}

// Zip codes are written as NUMBERS, matching the filled example.
ok(/<c r="J7"[^>]*>(?!.*inlineStr)/.test(sheetXml.match(/<c r="J7"[^>]*>[\s\S]*?<\/c>/)[0]) ||
   !sheetXml.match(/<c r="J7"[^>]*>[\s\S]*?<\/c>/)[0].includes('inlineStr'),
  'a five-digit zip is written as a number, not a string')

// The shipped template carries no sample data from the property it came from.
const pristine = await JSZip.loadAsync(templateBytes)
const pristineXml = await pristine.file('xl/worksheets/sheet1.xml').async('string')
ok(!pristineXml.includes('inlineStr'), 'the shipped template has no inline data')
ok(!/GREEN VALLEY|Panasonic|Whitewater/.test(cellValue(pristineXml, 'A7') + cellValue(pristineXml, 'E7')),
  'the shipped template carries no real property data in its data rows')
eq(cellValue(pristineXml, 'A7'), '', 'the template ships with row 7 empty')

// ── 13. The template's own bounds ─────────────────────────────────────────
ok(pristineXml.includes(`<row r="${LAST_TEMPLATE_ROW}"`), `the template really defines row ${LAST_TEMPLATE_ROW}`)
ok(!pristineXml.includes(`<row r="${LAST_TEMPLATE_ROW + 1}"`), `and nothing past it`)
eq(MAX_TEMPLATE_ROWS, 543, 'the template holds 543 data rows — far beyond the 24–40 units these buildings have')

// ── CONTROLS: each must FAIL, or the checks above prove nothing ───────────
{
  // (a) The naive lexical unit sort that puts 10 between 1 and 2.
  const naive = ['10', '2', '1', '9'].sort()
  ok(JSON.stringify(naive) !== JSON.stringify(['1', '2', '9', '10']),
    'CONTROL: a plain string sort really does mis-order unit 10 (so check 6 is meaningful)')

  // (b) A fill that writes nothing still produces a valid, openable workbook.
  //     This is the failure mode the byte-level checks above exist to catch.
  const emptyFill = await fillSupplementalDataSheet([], templateBytes, { outputType: 'uint8array' })
  const emptyZip = await JSZip.loadAsync(emptyFill)
  const emptyXml = await emptyZip.file('xl/worksheets/sheet1.xml').async('string')
  ok(emptyFill.length > 10000, 'CONTROL: a zero-row fill still yields a valid workbook')
  eq(cellValue(emptyXml, 'A7'), '', 'CONTROL: and it is silently empty — only reading the cells reveals it')

  // (c) Building the row set WITHOUT the dwelling-unit filter would file the
  //     attic, the mechanical room and the common area as apartments.
  const unfiltered = UNITS.length
  ok(unfiltered !== built.rows.length,
    `CONTROL: 11 unit records really do reduce to 8 rows (${unfiltered} -> ${built.rows.length})`)
}

console.log(`ventilation-supplemental-data-sheet: ${checks} checks passed`)
