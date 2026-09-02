// Fixture: a datetime field can be edited, and editing it does not move it.
//
// Nicholas, 2026-09-02, on a service appointment: "why can't I edit the
// schedule start time?"
//
// He could not, and neither could anyone, anywhere: the record page's edit gate
// excluded `datetime` outright and EditField's `datetime` case returned the
// literal string "Read-only". `date` had an editor; `datetime` never did. 570
// datetime fields are placed across ~100 objects — most are audit columns and
// correctly read-only, which is why it went unnoticed, but Scheduled Start,
// timesheet clock-in and a work order's start/end were shown and unenterable.
//
// The dangerous half of the fix is the conversion, not the input. A
// `datetime-local` value is WALL-CLOCK TIME WITH NO ZONE; the column is a
// timestamptz, an absolute instant. Reverse the direction and every appointment
// in the platform shifts by the UTC offset — five hours in Wisconsin — with
// nothing on screen to show it. So the conversion lives in its own module and
// this pins it, including a CONTROL running the naive
// `toISOString().slice(0,16)` that would produce exactly that shift.
//
// Run with:  node scripts/datetime-field-fixture.mjs
//
// TZ is forced so the checks mean the same thing on any machine and in CI.

process.env.TZ = 'America/Chicago'

const { toDatetimeLocal, fromDatetimeLocal, datetimeRoundTripsCleanly } =
  await import('../src/lib/datetimeField.js')

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures += 1
    console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`)
  }
}

// Sanity: if the runtime ignored TZ, every expectation below is meaningless.
check('PREMISE: the fixture is running in America/Chicago',
  new Date('2026-09-02T13:00:00Z').getHours(), 8)

// ── Stored instant → what the input shows ──────────────────────────────────
// SA-00299's real start: 13:00 UTC, which is 8:00 AM in Appleton.
check('a stored UTC instant is shown as local wall-clock',
  toDatetimeLocal('2026-09-02T13:00:00+00:00'), '2026-09-02T08:00')
check('...and an offset-bearing string resolves to the same instant',
  toDatetimeLocal('2026-09-02T08:00:00-05:00'), '2026-09-02T08:00')
check('a Date object works as well as a string',
  toDatetimeLocal(new Date('2026-09-02T13:00:00Z')), '2026-09-02T08:00')
check('midnight is not mistaken for empty',
  toDatetimeLocal('2026-09-02T05:00:00Z'), '2026-09-02T00:00')
check('an empty value shows an empty input', toDatetimeLocal(null), '')
check('an empty string shows an empty input', toDatetimeLocal(''), '')
check('a malformed value shows an empty input rather than "Invalid Date"',
  toDatetimeLocal('not a date'), '')

// ── CONTROL: the naive conversion, which MUST be wrong ─────────────────────
// This is the one-liner anybody reaches for first. It hands the input UTC
// wall-clock, so an 8 AM appointment reads 1 PM.
const naive = (iso) => new Date(iso).toISOString().slice(0, 16)
check('CONTROL: toISOString().slice() shows the WRONG hour',
  naive('2026-09-02T13:00:00+00:00'), '2026-09-02T13:00')
check('CONTROL: ...five hours off the correct value',
  naive('2026-09-02T13:00:00+00:00') !== toDatetimeLocal('2026-09-02T13:00:00+00:00'), true)

// ── What the input gives back → what is stored ─────────────────────────────
check('a typed wall-clock is stored as the matching instant',
  fromDatetimeLocal('2026-09-02T08:00'), '2026-09-02T13:00:00.000Z')
check('clearing the field stores null, not an empty string',
  fromDatetimeLocal(''), null)
check('a whitespace-only value is also null', fromDatetimeLocal('   '), null)
check('null in, null out', fromDatetimeLocal(null), null)
check('a malformed value is null rather than an Invalid Date',
  fromDatetimeLocal('nonsense'), null)
check('seconds are accepted if a browser supplies them',
  fromDatetimeLocal('2026-09-02T08:00:30'), '2026-09-02T13:00:30.000Z')

// ── The round trip ─────────────────────────────────────────────────────────
// Reading a value into the input and saving it back unchanged must not move it.
for (const iso of [
  '2026-09-02T13:00:00.000Z',   // the real SA-00299 start
  '2026-01-15T14:30:00.000Z',   // winter, CST
  '2026-07-04T17:45:00.000Z',   // summer, CDT — the offset differs
  '2026-12-31T06:00:00.000Z',   // year boundary in local time
]) {
  check(`round trip is lossless: ${iso}`,
    fromDatetimeLocal(toDatetimeLocal(iso)), iso)
  check(`...and reports itself clean: ${iso}`, datetimeRoundTripsCleanly(iso), true)
}

// A stored value carrying SECONDS cannot survive an input that has none, and
// the helper says so rather than pretending — callers use it to leave an
// untouched field alone instead of silently truncating it on save.
check('a value with seconds does NOT round trip cleanly, and admits it',
  datetimeRoundTripsCleanly('2026-09-02T13:00:45.000Z'), false)
check('an empty value round trips cleanly', datetimeRoundTripsCleanly(null), true)

// ── DST, where a naive implementation quietly loses an hour ────────────────
// 2026-03-08 02:30 local does not exist in America/Chicago — the clocks jump
// from 02:00 to 03:00. The conversion must still produce a real instant rather
// than NaN, so a form cannot be wedged by a date nobody can type again.
{
  const stored = fromDatetimeLocal('2026-03-08T02:30')
  check('a non-existent local time still yields a valid instant', typeof stored, 'string')
  check('...and it is a real date', Number.isNaN(new Date(stored).getTime()), false)
}
// The repeated hour in November resolves to one of the two instants, and must
// round trip to the same wall-clock the user typed.
check('an ambiguous fall-back hour round trips to the same wall-clock',
  toDatetimeLocal(fromDatetimeLocal('2026-11-01T01:30')), '2026-11-01T01:30')

// ── The wiring ─────────────────────────────────────────────────────────────
{
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/components/RecordDetail.jsx', import.meta.url), 'utf8')

  check('the blanket datetime exclusion is gone from the edit gate',
    /&& \(f\.type !== 'datetime'\)/.test(src), false)
  check('EditField no longer returns the literal "Read-only" for datetime',
    /case 'datetime':\s*\n\s*return <span[^>]*>Read-only<\/span>/.test(src), false)
  check('the record form renders a real datetime picker',
    /case 'datetime':[\s\S]{0,400}?type="datetime-local"/.test(src), true)
  check('and it converts through the shared module, not by hand',
    /value=\{toDatetimeLocal\(v\)\}/.test(src), true)
  check('the quick-create modal uses the same picker',
    /f\.type === 'datetime' \?[\s\S]{0,300}?type="datetime-local"/.test(src), true)
  check('a required datetime column with no layout entry is no longer downgraded to text',
    /m\.editorType === 'datetime' \? 'text'/.test(src), false)
  check('audit fields are still excluded before type is considered',
    /const isEditable = editing\s*\n\s*&& !isSystemAuditField\(f\)/.test(src), true)
}

console.log(failures === 0
  ? `datetime-field fixture: ${checks} checks passed`
  : `datetime-field fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
