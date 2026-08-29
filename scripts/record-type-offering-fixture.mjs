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

// ── An opportunity asks which building, like every other constrained child ───
// A multifamily building offers the multifamily programs and nothing else.
// Started from a PROPERTY the building is unknown, so the picker had nothing to
// narrow by. It goes through the same shared resolver incentive applications
// and assessments use — derive when there is one, ask when there are several —
// rather than a second implementation of the same question.
ok(/await seedConstrainingParent\('opportunities', prefillObj,\s*\n?\s*\{ propertyId: parentRecord\.id \}\)/
     .test(recordDetail),
   'a new opportunity from a property resolves its constraining building')
ok((recordDetail.match(/seedConstrainingParent\('/g) || []).length >= 3,
   'all three constrained children share the one resolver')

// The picker's parent prompt is written from the parent object, so it reads
// correctly whichever child is asking — it used to name the building case only.
ok(!/This building runs more than one program/.test(picker),
   'the parent prompt is not worded for one caller')
ok(/Choose the \$\{parentLabel\.toLowerCase\(\)\} this belongs to/.test(picker),
   'the parent prompt names the parent object it is actually asking about')

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
