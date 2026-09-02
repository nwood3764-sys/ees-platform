// Fixture: no step of an evidence upload waits forever, and the two kinds of
// step fail in the two different ways they have to.
//
// A hung upload is worse than a failed one. A failure says so and the
// technician retakes the photo; a hang leaves the spinner up, and the escape a
// technician reaches for is "Not Applicable — Photo does not upload", which
// closes the step with no evidence in it. Every step in uploadPhoto() could
// hang before this: createImageBitmap and canvas.toBlob on a memory-pressed
// phone, libheif's frame.display() callback that on a failed decode is never
// invoked at all (no try/catch can catch that), and a PUT whose connection goes
// away mid-body.
//
// The rule this pins is which failures are allowed to be silent:
//
//   OPTIONAL work degrades — a shrink or a HEIC rendition that stalls is
//   abandoned and the ORIGINAL is uploaded. Failing an upload because an
//   optimisation hung would be strictly worse than not optimising.
//
//   REQUIRED work throws, by name — the storage PUT and the photos row. There
//   is no photo without them, so silence is not an option.
//
// Run with:  node scripts/upload-deadline-fixture.mjs

import {
  softDeadline, hardDeadline, timedOutMessage, UPLOAD_DEADLINES,
} from '../src/lib/uploadDeadline.js'

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

const never = () => new Promise(() => {})
const after = (ms, v) => new Promise((r) => setTimeout(r, ms, v))

// Keep the console clean: softDeadline warns by design when it gives up.
const realWarn = console.warn
console.warn = () => {}

// ── softDeadline: optional work degrades ───────────────────────────────────
check('soft: work that answers in time is used',
  await softDeadline(after(5, 'compressed'), 200, 'ORIGINAL'), 'compressed')
check('soft: work that never answers falls back',
  await softDeadline(never(), 30, 'ORIGINAL'), 'ORIGINAL')
check('soft: work that REJECTS falls back rather than sinking the upload',
  await softDeadline(Promise.reject(new Error('decode blew up')), 200, 'ORIGINAL'), 'ORIGINAL')
check('soft: a null result is a real answer, not a miss',
  await softDeadline(Promise.resolve(null), 200, 'FALLBACK'), null)
check('soft: a non-promise value passes straight through',
  await softDeadline('already here', 200, 'FALLBACK'), 'already here')

// The point of the fallback being the ORIGINAL FILE: a stalled shrink must
// still upload a photo, never nothing.
{
  const original = { name: 'IMG_5512.JPG', size: 8_100_000 }
  const used = await softDeadline(never(), 30, original, 'Photo compression')
  check('soft: a stalled shrink still uploads the untouched original',
    [used.name, used.size], ['IMG_5512.JPG', 8_100_000])
}

// ── hardDeadline: required work is reported ────────────────────────────────
check('hard: work that answers in time is returned',
  await hardDeadline(after(5, { error: null }), 200, 'nope'), { error: null })

{
  let thrown = null
  try { await hardDeadline(never(), 30, 'The photo upload did not finish.') }
  catch (e) { thrown = e.message }
  check('hard: work that never answers throws its own message',
    thrown, 'The photo upload did not finish.')
}

{
  // A real rejection must surface as itself, not be reshaped into a timeout —
  // "Storage upload failed: Payload too large" is the actionable message.
  let thrown = null
  try { await hardDeadline(Promise.reject(new Error('Payload too large')), 200, 'timed out') }
  catch (e) { thrown = e.message }
  check('hard: a genuine error is passed through unchanged', thrown, 'Payload too large')
}

// A deadline that has expired must not keep a timer alive, or a phone left on a
// work order screen accumulates one per attempted upload.
{
  const before = process.getActiveResourcesInfo?.().filter(r => r === 'Timeout').length ?? 0
  await softDeadline(after(1, 'ok'), 60_000, 'FALLBACK')
  await new Promise(r => setImmediate(r))
  const afterCount = process.getActiveResourcesInfo?.().filter(r => r === 'Timeout').length ?? 0
  check('a completed step leaves no timer behind', afterCount <= before, true)
}

console.warn = realWarn

// ── The wording a technician actually reads ────────────────────────────────
check('the message says what stalled and that nothing was lost',
  timedOutMessage('The photo upload', 180000),
  'The photo upload did not finish within 3 minutes. Nothing was lost — check your signal and try again.')
check('a sub-minute wait is said in seconds',
  timedOutMessage('Filing the photo against the step', 45000),
  'Filing the photo against the step did not finish within 45 seconds. Nothing was lost — check your signal and try again.')
check('one minute is not "1 minutes"',
  timedOutMessage('The upload', 60000).includes('within 1 minute.'), true)

// ── The budgets themselves ─────────────────────────────────────────────────
// These are hang detectors, not performance budgets: a slow-but-working upload
// on a job-site uplink must finish inside them, or the fix becomes the bug.
check('every step has a deadline',
  Object.keys(UPLOAD_DEADLINES).sort(),
  ['compress', 'heifDecode', 'rowInsert', 'storageUpload'])
check('none is short enough to cut off a working slow upload',
  Object.values(UPLOAD_DEADLINES).every(ms => ms >= 30000), true)
check('none is long enough to outlast a shift',
  Object.values(UPLOAD_DEADLINES).every(ms => ms <= 300000), true)
check('the network step gets the longest of them',
  UPLOAD_DEADLINES.storageUpload === Math.max(...Object.values(UPLOAD_DEADLINES)), true)

// ── The chain is actually wired to them ────────────────────────────────────
// A deadline module nothing calls is exactly as useless as no deadline.
{
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/data/storageService.js', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('export async function uploadPhoto'),
    src.indexOf('export async function repairPhotoRendition') >= 0
      ? src.indexOf('export async function repairPhotoRendition')
      : undefined)
  check('uploadPhoto bounds the shrink',
    /softDeadline\(\s*\n?\s*compressPhotoForUpload/.test(body), true)
  check('uploadPhoto bounds the HEIC decode',
    /softDeadline\(\s*\n?\s*heifRenditionForFile/.test(body), true)
  check('uploadPhoto bounds the storage PUT as a HARD deadline',
    /hardDeadline\([\s\S]{0,400}?\.upload\(path, file/.test(body), true)
  check('uploadPhoto bounds the row insert as a HARD deadline',
    /hardDeadline\([\s\S]{0,300}?\.from\('photos'\)/.test(body), true)
  check('a photo that cannot be filed does not leave its object behind',
    /catch \(err\) \{[\s\S]{0,320}?\.remove\(\[path\]\)/.test(body), true)
}

console.log(failures === 0
  ? `upload-deadline fixture: ${checks} checks passed`
  : `upload-deadline fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
