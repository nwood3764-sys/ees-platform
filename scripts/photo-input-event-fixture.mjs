// Fixture: a file picker hands over the files it was given.
//
// Work steps stopped accepting photos on 2026-08-22 and stayed that way for
// eleven days. Nothing errored. Technicians marked required evidence steps
// "Not Applicable — Photo does not upload" to get past a Complete button that
// would never enable, which is how evidence gets lost.
//
// The cause was two lines in the wrong order:
//
//     const files = e.target.files     // a LIVE FileList — a reference
//     e.target.value = ''              // ...which this EMPTIES
//     await uploadPhotos(files)        // 0 files. Loop runs 0 times. Silence.
//
// `input.value = ''` is how a picker allows the same file to be chosen twice in
// a row, so it is not optional; it just has to happen AFTER the list is copied.
// The guided-flow handler, written in the same commit, called Array.from first
// and never broke — which is why two surfaces of one feature behaved
// differently while both read as correct.
//
// So the order is owned by ONE function, imageFilesFromInputEvent, and this
// pins it. The CONTROL cases run the OLD handler shape against the same live
// list and MUST come back empty: if they ever pass, this fixture is modelling a
// FileList that does not behave like a browser's and every check below is
// worthless. The real browser semantics — that clearing `value` really does
// empty `files` — are proved separately in Chromium by
// `npm run verify:photo-upload`.
//
// Run with:  node scripts/photo-input-event-fixture.mjs

import { imageFilesFromInputEvent, fileFromInputEvent } from '../src/lib/photoDrop.js'

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

// A stand-in for <input type="file"> that reproduces the one behaviour that
// matters: `files` is a LIVE list, and setting `value = ''` empties it in
// place. Same object identity before and after, exactly as in the browser.
function fileInput(files) {
  const live = [...files]
  const input = {
    get files() { return live },
    get value() { return live.length ? 'C:\\fakepath\\' + live[0].name : '' },
    set value(v) { if (v === '') live.length = 0 },
  }
  return { target: input }
}

const jpg = (name = 'a.jpg') => ({ name, type: 'image/jpeg', size: 100 })
const heic = (name = 'IMG_0001.HEIC') => ({ name, type: '', size: 100 })
const pdf = (name = 'report.pdf') => ({ name, type: 'application/pdf', size: 100 })

// ── The premise this fixture rests on ──────────────────────────────────────
// If the stand-in did not empty itself, every CONTROL below would pass for the
// wrong reason.
{
  const ev = fileInput([jpg()])
  const before = ev.target.files.length
  ev.target.value = ''
  check('PREMISE: clearing the input empties the live list',
    { before, after: ev.target.files.length }, { before: 1, after: 0 })
}

// ── CONTROL — the shape that broke it. These MUST come back empty. ─────────
const oldHandler = (e) => {
  const files = e.target.files   // reference to the live list
  e.target.value = ''            // ...emptied here
  return [...files]
}
check('CONTROL: old handler loses a single photo',
  oldHandler(fileInput([jpg()])).length, 0)
check('CONTROL: old handler loses a 30-photo folder pick',
  oldHandler(fileInput(Array.from({ length: 30 }, (_, i) => jpg(`p${i}.jpg`)))).length, 0)

// ── The rule ───────────────────────────────────────────────────────────────
{
  const ev = fileInput([jpg()])
  const { files, rejected } = imageFilesFromInputEvent(ev)
  check('one photo survives the clear', [files.length, rejected], [1, 0])
  check('and the input WAS cleared, so the same file can be picked again',
    ev.target.files.length, 0)
}

{
  const picked = Array.from({ length: 30 }, (_, i) => jpg(`p${i}.jpg`))
  const { files } = imageFilesFromInputEvent(fileInput(picked))
  check('a 30-photo folder pick survives in full', files.length, 30)
  check('...in the order they were chosen',
    [files[0].name, files[29].name], ['p0.jpg', 'p29.jpg'])
}

{
  // An iPhone HEIC arrives from several file managers with no MIME type at all.
  const { files, rejected } = imageFilesFromInputEvent(fileInput([heic()]))
  check('a HEIC with no mime type is still a photo', [files.length, rejected], [1, 0])
}

{
  // A non-image is dropped here, not at the storage bucket — but it is COUNTED,
  // so the screen can say it was skipped instead of appearing to lose it.
  const { files, rejected } = imageFilesFromInputEvent(fileInput([jpg(), pdf(), jpg('b.jpg')]))
  check('non-images are filtered and counted', [files.length, rejected], [2, 1])
}

{
  // Cancelling the picker. The handler must report nothing rather than throw.
  const { files, rejected } = imageFilesFromInputEvent(fileInput([]))
  check('an empty pick is zero files and zero rejects', [files.length, rejected], [0, 0])
}

check('a malformed event does not throw',
  imageFilesFromInputEvent(undefined), { files: [], rejected: 0 })
check('an event with no target does not throw',
  imageFilesFromInputEvent({}), { files: [], rejected: 0 })

{
  // A detached input can refuse the value write; the files still come back.
  const target = {
    get files() { return [jpg()] },
    set value(_v) { throw new Error('read-only') },
  }
  check('an input that refuses to be cleared still yields its file',
    imageFilesFromInputEvent({ target }).files.length, 1)
}

// ── The single-file form, used by the video pickers ────────────────────────
{
  const ev = fileInput([{ name: 'pan.mp4', type: 'video/mp4', size: 10 }])
  const f = fileFromInputEvent(ev)
  check('the one file survives the clear', f && f.name, 'pan.mp4')
  check('and the input was cleared', ev.target.files.length, 0)
}
check('a cancelled single pick is null', fileFromInputEvent(fileInput([])), null)
check('a malformed single-pick event is null', fileFromInputEvent(undefined), null)
{
  // fileFromInputEvent does NOT filter — a video picker's file is not an image,
  // and refusing it here would be the bug in the other direction.
  const f = fileFromInputEvent(fileInput([pdf()]))
  check('the single-file form does not second-guess the accept attribute',
    f && f.name, 'report.pdf')
}

// ── No handler may hand-roll the order again ───────────────────────────────
// The rule is only a rule while every picker goes through it.
import { readFileSync } from 'node:fs'
for (const file of [
  'src/fieldMobile/WorkOrderDetail.jsx',
  'src/fieldMobile/VehicleInspectionScreen.jsx',
]) {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  // Any surviving read of `.files` outside a comment means a picker is doing it
  // by hand, and a hand-rolled one is where this defect came from.
  const handRolled = src
    .split('\n')
    .filter((l) => /\.target\.files/.test(l) && !/^\s*(\/\/|\*)/.test(l))
  check(`${file}: no picker reads .target.files by hand`, handRolled, [])
}

console.log(failures === 0
  ? `photo-input-event fixture: ${checks} checks passed`
  : `photo-input-event fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
