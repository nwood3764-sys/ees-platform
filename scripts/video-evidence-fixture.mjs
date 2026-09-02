// Fixture: a video is evidence, and every rule that decides so.
//
// On 2026-08-27 an assessor recorded two videos on site and neither had a
// route into LEAP. LEAP Pad offers a Record Video button only on a step whose
// evidence type IS Video, so a Photo step's picker was `accept="image/*"`; the
// desktop Photos card refused a video outright and re-filed it as a nondescript
// attachment with a message saying it had been misfiled; and once stored, the
// only thing LEAP could do with it was hand back a Download button. Nicholas:
// "We need to include videos."
//
// The pure rules behind that are checked here — what counts as a video, what
// the person is told after a drop, and the wording that must never come back.
//
// Run with:  node scripts/video-evidence-fixture.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isVideoFile, isImageFile, fileTypeLabel, extensionOf } from '../src/lib/fileKinds.js'
import { uploadOutcomeMessages } from '../src/lib/galleryUploadOutcome.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
let checks = 0
function check(label, ok, detail) {
  checks += 1
  if (!ok) { failures += 1; console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`) }
}
const eq = (label, actual, expected) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}\n      want ${JSON.stringify(expected)}`)

// ── 1. What is a video ───────────────────────────────────────────────────────
//
// The two real files first. IMG_0346.MOV is the iPhone capture that started
// this; a .MOV that a browser will not decode is still a video, and calling it
// anything else is how it lost its type.
for (const [name, mime] of [
  ['IMG_0346.MOV', 'video/quicktime'],
  ['20260819_102109.mp4', 'video/mp4'],
  ['attic-pan.webm', 'video/webm'],
  ['clip.3gp', 'video/3gpp'],
]) check(`${name} is a video`, isVideoFile(name, mime))

// No mime at all — a drag from some file managers sets none. The name decides.
for (const name of ['IMG_0346.MOV', 'pan.mp4', 'walk.m4v', 'old.avi', 'a.mkv', 'x.mpg'])
  check(`${name} with no mime type is a video`, isVideoFile(name, ''))

// A mime that actually says what the file is beats the extension, both ways.
check('application/pdf named .mp4 is NOT a video', !isVideoFile('report.mp4', 'application/pdf'))
check('video/mp4 named .pdf IS a video', isVideoFile('report.pdf', 'video/mp4'))
// octet-stream says nothing, so the name still decides.
check('octet-stream .mov is a video', isVideoFile('a.mov', 'application/octet-stream'))

// Not videos. The last two matter: a photo must never be diverted into the
// document path, and a drawing must keep being called a drawing.
for (const [name, mime] of [
  ['photo.jpg', 'image/jpeg'],
  ['IMG_1234.HEIC', 'image/heic'],
  ['plan.dwg', ''],
  ['bills.xlsx', ''],
  ['report.pdf', 'application/pdf'],
  ['notes.txt', 'text/plain'],
]) check(`${name} is not a video`, !isVideoFile(name, mime))

// A video is never also an image — the two branches in the upload handler are
// mutually exclusive, and an overlap would file a video through the photo
// pipeline (watermark, EXIF, HEIC decode), none of which can touch it.
for (const [name, mime] of [['IMG_0346.MOV', 'video/quicktime'], ['a.mp4', ''], ['b.webm', 'video/webm']])
  check(`${name} is not treated as an image`, !isImageFile(name, mime))

// The label the UI prints.
eq('fileTypeLabel(.MOV)', fileTypeLabel('IMG_0346.MOV', 'video/quicktime'), 'Video')
eq('fileTypeLabel(.m4v)', fileTypeLabel('walk.m4v', ''), 'Video')
eq('extensionOf(.MOV) lowercases', extensionOf('IMG_0346.MOV'), 'mov')

// ── 2. What the person is told after a drop ──────────────────────────────────
const msg = o => uploadOutcomeMessages(o)

eq('nothing succeeded says nothing', msg({ attempted: 2 }), [])

eq('one photo confirms by name',
  msg({ attempted: 1, photos: 1, photoNames: ['roof-01.jpg'] }),
  ['Uploaded roof-01.jpg'])

eq('a batch of photos confirms by count',
  msg({ attempted: 5, photos: 5, photoNames: ['a.jpg'] }),
  ['Uploaded 5 of 5 files'])

// The one that changed. A video is SAVED, not misfiled — and it is named as a
// video so the person knows the app understood what it was given.
eq('one video is saved, not misfiled',
  msg({ attempted: 1, videos: [{ name: 'IMG_0346.MOV' }] }),
  ['IMG_0346.MOV is a video — saved to this record under Documents'])

eq('several videos',
  msg({ attempted: 3, videos: [{ name: 'a.mp4' }, { name: 'b.mov' }, { name: 'c.mp4' }] }),
  ['3 videos — saved to this record under Documents'])

eq('photos and a video, in that order',
  msg({ attempted: 3, photos: 2, photoNames: ['a.jpg', 'b.jpg'], videos: [{ name: 'v.mp4' }] }),
  ['Uploaded 2 photos', 'v.mp4 is a video — saved to this record under Documents'])

// A document is still called a misfile, because it is one — that message is
// what stops a dropped floor plan looking like it vanished.
eq('a drawing still says where it went',
  msg({ attempted: 1, documents: [{ name: 'plan.dwg', kind: 'AutoCAD' }] }),
  ['plan.dwg is an AutoCAD, not a photo — filed under Documents'])
eq('the article follows the word',
  msg({ attempted: 1, documents: [{ name: 'a.pdf', kind: 'PDF' }] }),
  ['a.pdf is a PDF, not a photo — filed under Documents'])

eq('all three at once, each named for what it is',
  msg({
    attempted: 4, photos: 2, photoNames: ['a.jpg', 'b.jpg'],
    videos: [{ name: 'v.mp4' }], documents: [{ name: 'p.pdf', kind: 'PDF' }],
  }),
  [
    'Uploaded 2 photos',
    'v.mp4 is a video — saved to this record under Documents',
    'p.pdf is a PDF, not a photo — filed under Documents',
  ])

// The wording that must never come back: a video told it was misfiled.
for (const o of [
  { attempted: 1, videos: [{ name: 'a.mov' }] },
  { attempted: 2, photos: 1, photoNames: ['p.jpg'], videos: [{ name: 'a.mov' }] },
]) {
  const joined = msg(o).join(' | ')
  check('a video is never called "not a photo"', !/not a photo/.test(joined), joined)
  check('a video is never called a document', !/filed under Documents\b(?!.*saved)/.test(
    msg(o).find(m => m.includes('video')) || ''), joined)
}

// ── 3. The wiring, in the files that carry it ────────────────────────────────
const read = rel => readFileSync(join(root, rel), 'utf8')

const gallery = read('src/components/FileGallery.jsx')
check('the Photos card accepts video in its file picker',
  /photos: 'image\/\*,video\/\*'/.test(gallery))
check('a video dropped on the Photos card is typed video',
  /documentType: asVideo \? 'video' :/.test(gallery))
check('the document preview has a video branch',
  /if \(isVideoFile\(doc\.name, doc\.mime_type\)\) return 'video'/.test(gallery))
check('there is a player, not just a download',
  /function VideoPreview\(/.test(gallery) && /<video\b/.test(gallery))
check('the player has an honest failure path',
  /onError=\{\(\) => setFailed\(true\)\}/.test(gallery))

const storage = read('src/data/storageService.js')
check('uploadDocument types a video at the single door',
  /isVideoFile\(file\.name, file\.type\)\)\s*\{\s*\n\s*documentType = 'video'/.test(storage))
check('a NAMED document slot still wins over the video rule',
  /\(documentType \|\| 'attachment'\) === 'attachment'/.test(storage))
check('the report can see a step’s documents',
  /export async function listWorkOrderAndStepDocuments/.test(storage))

const pad = read('src/fieldMobile/WorkOrderDetail.jsx')
// REVERSED 2026-09-02. From 2026-08-27 a Video button sat beside Photo on every
// step; Nicholas asked for it back on the Video steps only, so a photo step's
// controls stop reading as a choice between two equal things when they are not.
// The 08-27 rule that a video may be filed ANYWHERE still holds — it is served
// by the Photos/Files card on the record, checked further down — and the LEAP
// Pad guided flow keeps its own video prompts. What changed is one screen's
// buttons, not where a video may live.
check('LEAP Pad does NOT put a Video button on a photo step',
  !/\{!isVideoStep && \(\s*\n\s*<CaptureBtn label="Video" icon="video"/.test(pad))
check('a photo step renders no video input at all, so nothing can reach one',
  !/\{!isVideoStep && \(\s*\n\s*<input\s*\n?\s*ref=\{videoRef\}/.test(pad))
check('a Video step still leads with Record Video',
  /\{isVideoStep && \(\s*\n\s*<CaptureBtn label="Record Video"/.test(pad))
check('a large video reports its own progress',
  /videoUploading/.test(pad))

const reportSvc = read('src/data/assessmentReportService.js')
check('the report offers work-step documents, not only the work order’s',
  /listWorkOrderAndStepDocuments\(workOrderId\)/.test(reportSvc))
check('the report names the step a document came from',
  /step: row\._work_step_name \|\| null/.test(reportSvc))

// ── 4. A video is never restricted by WHERE it is being filed ────────────────
//
// Nicholas, 2026-08-27: "the user can upload videos anywhere. You can't
// restrict this." Each of these was a real refusal, and each is the kind that
// creeps back the next time someone tightens a gate meant for photos.
//
// This is about WHERE a video may be stored, and it is unchanged. The
// 2026-09-02 ruling above narrows which LEAP Pad step shows a Video BUTTON; it
// does not reintroduce a refusal. The Photos/Files card on the work order
// accepts a video from any step, which is the route a video off a photo step
// takes now.

// LEAP Pad: on a VIDEO step the inputs and the Add video control sit OUTSIDE
// the isActionable gate, so a finished video step and one further down an
// ordered plan can both still receive their footage. That gate is about the
// ORDER work is done in; a 360 pan of a building is not evidence a step is
// judged on, and refusing it produces no tidier work order — only footage that
// never gets filed.
const padVideoBlock = pad.slice(
  pad.indexOf('Attached videos — playable inline'),
  pad.indexOf('Capture + complete actions'))
check('LEAP Pad: the video file inputs are outside the actionable gate',
  /ref=\{videoRef\}/.test(padVideoBlock) && /ref=\{folderVideoRef\}/.test(padVideoBlock))
check('LEAP Pad: the video inputs exist only on a Video step',
  /\{isVideoStep && \(/.test(padVideoBlock))
check('LEAP Pad: a NON-actionable Video step can still add a video',
  /\{isVideoStep && !isActionable && \(/.test(padVideoBlock) && /Add video/.test(padVideoBlock))
check('LEAP Pad: the photo controls stay behind the ordering gate',
  /\{isActionable && \(/.test(pad) &&
  pad.indexOf('triggerCapture(\'before\')') > pad.indexOf('Capture + complete actions'))

// The Photos-card lockout refuses PHOTOS, not the drop.
check('the gallery lockout no longer refuses every file outright',
  !/if \(photoLockoutMessage\) \{\s*\n\s*toast\.error\(photoLockoutMessage\)\s*\n\s*return/.test(gallery))
check('the lockout filters only what would become a photo',
  /if \(!photoLockoutMessage\) return true\s*\n\s*if \(isImageFile\(f\.name, f\.type\)\) return false/.test(gallery))
check('a locked card still offers a picker, so a video need not be dragged',
  /label=\{photoLockoutMessage \? 'Video' : 'Upload'\}/.test(gallery))
check('the locked picker offers video only — an image there truly cannot be stored',
  /accept=\{photoLockoutMessage \? 'video\/\*' : ACCEPT_BY_MODE\[target\]\}/.test(gallery))
check('the drop zone is live on a locked card',
  /\{dragActive && \(/.test(gallery))
check('the misconfiguration notice says a video still works',
  /A <strong>video<\/strong> can still be filed here/.test(gallery))

// The one restriction that IS correct and must stay: a video does not satisfy
// a photo requirement. The gate is the SERVER's (_work_step_evidence_gap,
// surfaced as step.evidence_gap) — the client renders it and never computes
// its own, so loosening where a video may be filed could not loosen it.
check('the completion gate is the server\u2019s, read not recomputed',
  /const gap = step\.evidence_gap/.test(pad))
check('Complete Step is still disabled by that gate',
  /disabled=\{!!gap \|\| busy \|\| uploading\}/.test(pad))

console.log(failures === 0
  ? `video-evidence-fixture: ${checks} checks passed`
  : `video-evidence-fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
