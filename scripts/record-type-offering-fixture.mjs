// =============================================================================
// record-type-offering-fixture — what a record-type picker is allowed to OFFER.
//
// Two defects Nicholas reported on 2026-08-29, both of which read as "the
// picker is showing programs that don't belong here":
//
//   1. Single-family opportunity record types offered on a multifamily
//      building. The eligibility rules were right all along; what was wrong is
//      that 31 of 82 live buildings carried NO record type, and an untyped
//      parent made both the picker and the database trigger fail OPEN.
//   2. FIELD-OPERATIONS offered as a manual choice. It is not a program — it is
//      the platform's nationwide default record type and the anchor LEAP Pad
//      hangs ad-hoc technician work off, so it must stay active and must never
//      be listed.
//
// These are source assertions rather than behaviour tests because both live in
// supabase-bound query builders. What they pin is the part that silently
// regresses: a dropped filter, or a fetch that runs before the question that
// scopes it has been answered.
// =============================================================================

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

let checks = 0
const fail = []
function ok(cond, label) {
  checks++
  if (!cond) fail.push(label)
}

const layoutService = read('src/data/layoutService.js')
const picker        = read('src/components/RecordTypePicker.jsx')
const recordDetail  = read('src/components/RecordDetail.jsx')

// ── A system-assigned record type is never offered ───────────────────────────
ok(/\.eq\('picklist_is_system_assigned', false\)/.test(layoutService),
   'fetchAvailableRecordTypes filters out system-assigned record types')

// The eligibility RPC is the picker's OTHER source of record types, and it has
// its own fallback branch that builds entries straight from the RPC rows. Both
// have to drop system-assigned or the fallback puts FIELD-OPERATIONS back on
// exactly the screens this keeps it off.
ok(/const offerable = \(data \|\| \[\]\)\.filter\(r => !r\.picklist_is_system_assigned\)/
     .test(layoutService),
   'applyParentEligibility drops system-assigned rows from the RPC result')
ok(/if \(narrowed\.length > 0\) return narrowed\s*\n\s*return offerable\.map/.test(layoutService),
   'applyParentEligibility fallback maps the filtered rows, not the raw ones')

// It must be filtered by being SYSTEM-ASSIGNED, never by naming the value. A
// name check would break the moment a second one exists, and would read as a
// hardcoded business rule in code — the thing this repo forbids.
const codeOnly = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')
ok(!/FIELD-OPERATIONS/.test(codeOnly(layoutService)),
   'layoutService names no record type value in code — the flag is the rule')
ok(!/FIELD-OPERATIONS/.test(codeOnly(picker)),
   'RecordTypePicker names no record type value in code')

// ── A picker never lists before it can scope ─────────────────────────────────
// An opportunity's programs are decided by its BUILDING. Started from a
// property that holds several, the building is unknown — and fetching then
// would draw the unconstrained list AND could auto-pick off it, which is the
// original defect wearing a different hat.
ok(/const needsParentChoice = !parentRecordTypeId && parentOptions\.length > 0/.test(picker),
   'picker knows when a constraining parent is still owed')
ok(/if \(needsParentChoice && !effectiveParentRecordTypeId\) \{[\s\S]{0,200}?setLoading\(false\)\s*\n\s*return/
     .test(picker),
   'picker holds the record-type fetch while the parent question is unanswered')
ok(/!loading && !needsParentChoice && !needsStateChoice/.test(picker),
   'picker never hides itself while a parent choice is owed')

// Whatever the picker had to ask for travels back with the pick, so the create
// form opens with that answer filled in rather than asking a second time.
for (const call of ['onPick(selectable[0], parentSeed)', 'onPick(null, parentSeed)',
                    'onPick(rt, parentSeed)']) {
  ok(picker.includes(call), `picker carries the parent seed: ${call}`)
}
ok(/const parentSeed = \(chosenParent && parentChoices\?\.fkColumn\)/.test(picker),
   'the parent seed is keyed by the real FK column, not a hardcoded name')

// ── The create form receives it ──────────────────────────────────────────────
ok(/if \(pickedParentSeed\) Object\.assign\(d, pickedParentSeed\)/.test(recordDetail),
   'RecordDetail merges the picker-resolved parent into the create draft')
ok(/if \(parentSeed\) setPickedParentSeed\(parentSeed\)/.test(recordDetail),
   'RecordDetail stores the parent seed the picker returns')
ok(/prefillObj\.__parentChoices = constrainingParent\.choices/.test(recordDetail),
   'the create prefill carries the candidate parents when there is a choice to make')
// A single candidate is not a question — it is an answer, and it fills in.
ok(/constrainingParent\.resolvedParentId && constrainingParent\.fkColumn/.test(recordDetail),
   'a lone candidate parent is adopted rather than asked about')

// ── The database is the guarantee, not this ──────────────────────────────────
const migration = read('supabase/migrations/20260829194532_building_record_type_defaults_from_property.sql')
ok(/BEFORE INSERT OR UPDATE OF building_record_type, property_id ON public\.buildings/.test(migration),
   'a building takes its record type from its property on insert')
ok(/IF NEW\.building_record_type IS NOT NULL[\s\S]{0,80}RETURN NEW/.test(migration),
   'it is a DEFAULT: a record type someone chose is never overwritten')
ok(/picklist_object = 'buildings'/.test(migration),
   'the property value is resolved into the BUILDING picklist, not copied by id')
ok(/RAISE EXCEPTION 'aborting: % building\(s\) on a typed property are still untyped'/.test(migration),
   'the migration refuses to ship leaving a building unclassifiable')

const sysMigration = read('supabase/migrations/20260829194533_system_assigned_record_types.sql')
ok(/picklist_is_system_assigned boolean NOT NULL DEFAULT false/.test(sysMigration),
   'system-assigned is a column, defaulting to false so nothing else changes')
ok(/FIELD-OPERATIONS must stay active and stay the platform default record type/
     .test(sysMigration),
   'the migration asserts FIELD-OPERATIONS stays active and stays the default')

if (fail.length) {
  console.error(`record-type-offering fixture: ${fail.length} FAILED of ${checks}`)
  for (const f of fail) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`record-type-offering fixture: ${checks} checks passed`)
