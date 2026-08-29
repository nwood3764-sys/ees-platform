// Fixture test for the file-name → storage-key rule.
//
// Lucas Wood, 2026-08-27, uploading a manufacturer spec sheet to WO-00208:
//
//   "AZ25E15D – GE Zoneline Deluxe Series Cooling and Electric Heat Unit.pdf:
//    Storage upload failed: Invalid key: work_orders/…__AZ25E15D_–_GE_…pdf"
//
// The en dash in the file name (U+2013 — what Word and most vendors' PDF
// titles carry where a person typed a hyphen) is not a character Supabase
// Storage accepts in an object key, and the old sanitizer only replaced a
// hand-listed set of ASCII punctuation, so it passed straight through.
//
// Every check below is really the same check: whatever a person's file is
// called, the key we build from it must satisfy the service's own rule, which
// isStorageSafeKey states. The last block asserts exactly that over a pile of
// awkward names, so this cannot regress into a longer denylist.
//
// Run with:  node scripts/storage-key-fixture.mjs

import { storageSafeFileName, isStorageSafeKey } from '../src/lib/storageKey.js'

let checks = 0, failures = 0
const check = (label, actual, expected) => {
  checks++
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) { failures++; console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`) }
}

// ── The file that started this ─────────────────────────────────────────────
check('the en dash becomes a hyphen, not an Invalid key',
  storageSafeFileName('AZ25E15D \u2013 GE Zoneline Deluxe Series Cooling and Electric Heat Unit.pdf'),
  'AZ25E15D_-_GE_Zoneline_Deluxe_Series_Cooling_and_Electric_Heat_Unit.pdf')
check('an ASCII hyphen in the same name is untouched',
  storageSafeFileName('AZ25E15D - GE Zoneline.pdf'), 'AZ25E15D_-_GE_Zoneline.pdf')
// The names that DID upload to the same work order, unchanged — the fix must
// not move a key that already worked.
check('an already-safe name is unchanged', storageSafeFileName('Split_System_XR15.pdf'), 'Split_System_XR15.pdf')
check('a plain name with spaces', storageSafeFileName('Rheem Heavy Duty Water Heater.pdf'),
  'Rheem_Heavy_Duty_Water_Heater.pdf')

// ── The rest of the typographic set that arrives in real file names ────────
check('em dash', storageSafeFileName('a \u2014 b.pdf'), 'a_-_b.pdf')
check('minus sign', storageSafeFileName('a \u2212 b.pdf'), 'a_-_b.pdf')
check('curly apostrophe is dropped, not underscored',
  storageSafeFileName('Owner\u2019s Manual.pdf'), 'Owners_Manual.pdf')
check('curly quotes', storageSafeFileName('\u201Cspec\u201D.pdf'), 'spec.pdf')
check('non-breaking space', storageSafeFileName('Model\u00A0AZ25.pdf'), 'Model_AZ25.pdf')
check('zero-width space', storageSafeFileName('Model\u200BAZ25.pdf'), 'Model_AZ25.pdf')
check('multiplication sign', storageSafeFileName('24\u00D736 filter.pdf'), '24x36_filter.pdf')
check('ellipsis', storageSafeFileName('notes\u2026.txt'), 'notes.txt')
check('accents keep the letter', storageSafeFileName('Cafe\u0301 Su\u0308d.pdf'), 'Cafe_Sud.pdf')
check('precomposed accents keep the letter', storageSafeFileName('Caf\u00E9.pdf'), 'Cafe.pdf')
check('an emoji is not a character in a key', storageSafeFileName('done \u2705.pdf'), 'done.pdf')

// ── Nothing survivable is left ─────────────────────────────────────────────
check('a wholly non-Latin name still yields a usable key, keeping the type',
  storageSafeFileName('\u65E5\u672C\u8A9E.pdf'), 'file.pdf')
check('no name at all', storageSafeFileName(''), 'file')
check('null', storageSafeFileName(null), 'file')
check('undefined', storageSafeFileName(undefined), 'file')
check('the caller may name the fallback', storageSafeFileName('\u65E5\u672C\u8A9E', { fallback: 'w9' }), 'w9')

// ── A key is a key: no separators, no traversal ────────────────────────────
check('a path keeps only its last segment', storageSafeFileName('C:\\Users\\lucas\\spec.pdf'), 'spec.pdf')
check('a posix path keeps only its last segment', storageSafeFileName('/etc/passwd'), 'passwd')
check('traversal cannot survive', storageSafeFileName('../../etc/passwd'), 'passwd')
check('a dot run collapses', storageSafeFileName('spec...pdf'), 'spec.pdf')
check('a leading dot does not make a hidden file', storageSafeFileName('.env'), 'file.env')
check('a run of unsafe characters collapses to ONE underscore',
  storageSafeFileName('a???b'), 'a_b')
check('trailing separators are trimmed', storageSafeFileName('spec _-.pdf'), 'spec.pdf')

// ── Length: the extension is never what gets cut ───────────────────────────
const long = storageSafeFileName('x'.repeat(300) + '.pdf')
check('a very long name is capped', long.length, 120)
check('…and keeps its extension', long.endsWith('.pdf'), true)
check('the cap is settable', storageSafeFileName('x'.repeat(50) + '.pdf', { maxLength: 20 }).length, 20)
check('a name that is only an extension after truncation still has a stem',
  storageSafeFileName('\u2013\u2013\u2013.pdf'), 'file.pdf')

// ── The service's own rule ─────────────────────────────────────────────────
check('the failing key was genuinely invalid',
  isStorageSafeKey('work_orders/2dca7ea8/63a7437d__AZ25E15D_\u2013_GE_Zoneline.pdf'), false)
check('the repaired key is valid',
  isStorageSafeKey('work_orders/2dca7ea8/63a7437d__AZ25E15D_-_GE_Zoneline.pdf'), true)
check('an empty key is not a key', isStorageSafeKey(''), false)
check('a non-string is not a key', isStorageSafeKey(null), false)

// The real assertion: every name above, in the shape the app actually builds,
// must pass the service's rule. A future edit that adds a character to the
// output has to keep this true.
const AWKWARD = [
  'AZ25E15D \u2013 GE Zoneline Deluxe Series Cooling and Electric Heat Unit.pdf',
  'Owner\u2019s Manual (rev\u00A02).pdf', '\u65E5\u672C\u8A9E.pdf', '\u0627\u0644\u0645\u0644\u0641.pdf',
  'r\u00E9sum\u00E9 \u2014 final\u2026.docx', 'done \u2705\uD83D\uDD25.jpg', '../../etc/passwd', 'C:\\x\\y\\z.pdf',
  '   .pdf', '%2F%2E%2E.pdf', 'a"b\'c`d.pdf', 'tab\there.pdf', 'new\nline.pdf',
  '\u00BD" copper 90\u00B0 elbow.pdf', 'x'.repeat(400) + '.pdf', '', null,
]
for (const name of AWKWARD) {
  const key = `work_orders/2dca7ea8-d311-402a-bb0b-29d0239ce8c8/63a7437d-cb26-4c90-b8b3-e7072704719b__${storageSafeFileName(name)}`
  check(`key is valid for ${JSON.stringify(String(name).slice(0, 28))}`, isStorageSafeKey(key), true)
}

console.log(`storage-key fixture: ${checks} checks passed`)
if (failures) process.exit(1)
