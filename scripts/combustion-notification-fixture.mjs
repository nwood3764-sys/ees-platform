// Headless proof for the Combustion Safety Notification renderer.
// Builds the PDF from a fixture model under Node (jspdf via dynamic import),
// asserts it produces a valid multi-page PDF, and checks signature-tab capture
// and the sampling-rate table. Run: node scripts/combustion-notification-fixture.mjs
import { buildCombustionPdf, buildSubmittalPdfWithSignatureTabs, combustionSampleCount }
  from '../src/data/paperworkModel.js'

let failures = 0
const ok = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failures++ }

// --- sampling rate table (the form's own table) ---
ok('sample 5→4',   combustionSampleCount(5) === 4)
ok('sample 9→4',   combustionSampleCount(9) === 4)
ok('sample 10→7',  combustionSampleCount(10) === 7)
ok('sample 29→7',  combustionSampleCount(29) === 7)
ok('sample 30→10', combustionSampleCount(30) === 10)
ok('sample 49→10', combustionSampleCount(49) === 10)
ok('sample 50→15', combustionSampleCount(50) === 15)
ok('sample 99→15', combustionSampleCount(99) === 15)
ok('sample 100→20',combustionSampleCount(100) === 20)
ok('sample 150→20',combustionSampleCount(150) === 20)

const unit = (n) => ({
  unit_number: n, gas_leak_result: 'None Found', gas_detector_installed: true,
  ambient_co_result: '0-8 ppm', co_detector_installed: true, co_detector_location: 'Hallway',
  furnace_co_status: 'Acceptable', furnace_spillage: 'None Found',
  water_heater_co_status: 'Acceptable', water_heater_spillage: 'None Found',
  stove_co_status: 'Acceptable', notes: '',
})

const model = {
  building: { name: '1837' },
  property: { name: '1837 Alden Rd', street: '1837 Alden Rd', cityStateZip: 'Janesville, WI 53546' },
  owner: { name: 'Example Housing Partners LLC', address: '100 Main St', cityStateZip: 'Madison, WI 53703' },
  ventilation: { status: 'Tested', cfm: '120', notes: 'Whole-building exhaust verified.' },
  common: {
    gas_leak_result: 'None Found', gas_detector_installed: true,
    ambient_co_result: '0-8 ppm', co_detector_installed: true, co_detector_location: 'Mechanical Room',
    heating_plant_co_status: 'Acceptable', heating_plant_spillage: 'None Found',
    water_heater_co_status: 'Acceptable', water_heater_spillage: 'None Found',
    notes: 'All shared equipment within acceptable limits.',
  },
  samples: [unit('101'), unit('102'), unit('205'), unit('310')],
  totalUnits: 16, sampleCount: combustionSampleCount(16),
}

async function bytesOf(blob) { return new Uint8Array(await blob.arrayBuffer()) }

const blob = await buildCombustionPdf(model, 'combustion_safety_notification')
const bytes = await bytesOf(blob)
const head = String.fromCharCode(...bytes.slice(0, 5))
ok('produces a PDF blob', blob && blob.size > 3000)
ok('starts with %PDF', head === '%PDF-')
// page count: count "/Type /Page" occurrences (not /Pages)
const text = Buffer.from(bytes).toString('latin1')
const pageCount = (text.match(/\/Type\s*\/Page[^s]/g) || []).length
ok('multi-page (>=2)', pageCount >= 2)
console.log(`   pages≈${pageCount}, size=${blob.size}B`)

// signature tab capture
const { blob: sBlob, tabs } = await buildSubmittalPdfWithSignatureTabs(model, 'combustion_safety_notification')
ok('signature build returns a blob', sBlob && sBlob.size > 3000)
ok('captures 2 tabs', Array.isArray(tabs) && tabs.length === 2)
ok('tab types sig+date', tabs.map(t => t.tab_type).sort().join(',') === 'date,sig')
ok('sig tab recipient order 1', tabs.every(t => t.recipient_order === 1))
ok('tabs carry bottom-left y', tabs.every(t => typeof t.y === 'number' && t.y > 0 && t.y < 792))

// empty-samples path (no units yet) still renders
const empty = { ...model, samples: [], sampleCount: 0 }
const eBlob = await buildCombustionPdf(empty, 'combustion_safety_notification')
ok('renders with no sampled units', eBlob && eBlob.size > 2000)

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
process.exit(failures ? 1 : 0)
