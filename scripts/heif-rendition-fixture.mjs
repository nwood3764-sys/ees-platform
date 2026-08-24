// ─── heif-rendition-fixture.mjs ──────────────────────────────────────────────
// Pins the pure rules behind HEIC support and behind "never hand the browser
// bytes it cannot paint".
//
// The defect these come from (2026-08-24): 66 iPhone HEIC photos on one work
// order rendered as broken tiles. Two independent causes, one pinned in each
// half below — the format was never detectable from what the browser reported,
// and the display path fell through to an original no browser can decode.
//
// Run by scripts/run-fixtures.mjs inside `npm run build:safe`.

import assert from 'node:assert/strict'
import {
  isHeifBytes,
  looksLikeHeifName,
  renditionPathFor,
  renditionDimensions,
  RENDITION_LONG_EDGE,
  browserRenderablePath,
  displayPathForPhoto,
} from '../src/lib/heifRendition.js'

let checks = 0
const check = (name, fn) => { fn(); checks++ }

// ── Building blocks ─────────────────────────────────────────────────────────
function ftyp(brand, ...compatible) {
  const parts = ['\0\0\0\0', 'ftyp', brand, '\0\0\0\0', ...compatible].join('')
  const b = new Uint8Array(64)
  for (let i = 0; i < parts.length && i < b.length; i++) b[i] = parts.charCodeAt(i)
  return b
}
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1])
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0])

// ── Sniffing the bytes, because nothing else can be trusted ─────────────────
// Every one of the 66 rows this defect produced has mime_type NULL: Chrome on
// Windows reports an empty File.type for .heic. The header is the only honest
// signal, so these are the cases the sniff has to get right.
check('iPhone HEIC (major brand heic) is detected', () => {
  assert.equal(isHeifBytes(ftyp('heic', 'mif1', 'heic')), true)
})
check('mif1-major HEIF is detected', () => {
  assert.equal(isHeifBytes(ftyp('mif1', 'heic')), true)
})
check('AVIF is detected (same container family)', () => {
  assert.equal(isHeifBytes(ftyp('avif')), true)
})
check('an MP4 is NOT treated as HEIF', () => {
  assert.equal(isHeifBytes(ftyp('isom', 'mp42')), false)
})
check('a QuickTime video is NOT treated as HEIF', () => {
  assert.equal(isHeifBytes(ftyp('qt  ')), false)
})
check('a JPEG is not HEIF', () => { assert.equal(isHeifBytes(JPEG), false) })
check('a PNG is not HEIF', () => { assert.equal(isHeifBytes(PNG), false) })
check('a truncated header never throws and never matches', () => {
  assert.equal(isHeifBytes(Uint8Array.from([0, 0, 0, 24, 0x66])), false)
  assert.equal(isHeifBytes(new Uint8Array(0)), false)
  assert.equal(isHeifBytes(null), false)
})

check('the name/type hint accepts what phones and desktops actually send', () => {
  assert.equal(looksLikeHeifName('IMG_0001.HEIC', ''), true)      // empty type: Chrome/Windows
  assert.equal(looksLikeHeifName('IMG_0001.heic', 'image/heic'), true)
  assert.equal(looksLikeHeifName('photo.heif', ''), true)
  assert.equal(looksLikeHeifName('photo.hif', ''), true)          // some cameras
  assert.equal(looksLikeHeifName('shot.jpg', 'image/jpeg'), false)
  assert.equal(looksLikeHeifName('', 'image/heif'), true)         // no name, honest type
})

// ── Rendition paths sit beside the capture, never on top of it ──────────────
check('a rendition lands in a sibling renditions/ folder as .jpg', () => {
  assert.equal(
    renditionPathFor('work_orders/abc/originals/1111-2222.heic'),
    'work_orders/abc/renditions/1111-2222.jpg',
  )
})
check('the original key is never reused or extended', () => {
  const original = 'work_steps/s1/originals/uuid.heic'
  const rendition = renditionPathFor(original)
  assert.notEqual(rendition, original)
  assert.equal(rendition.startsWith(original), false,
    'a rendition path must not be the original with something appended — that is ' +
    'how process-photo once produced ".../originals/<uuid>.jpg/<uuid>.jpg"')
})
check('an unrecognised path shape yields no rendition path rather than a guess', () => {
  assert.equal(renditionPathFor('some/other/place/file.heic'), null)
  assert.equal(renditionPathFor(''), null)
  assert.equal(renditionPathFor(null), null)
})

// ── Rendition sizing matches what the server would have kept anyway ─────────
check('a 12 MP iPhone frame is capped at the watermark long edge', () => {
  assert.deepEqual(renditionDimensions(4032, 3024), { width: 2400, height: 1800 })
})
check('portrait orientation caps the same edge', () => {
  assert.deepEqual(renditionDimensions(3024, 4032), { width: 1800, height: 2400 })
})
check('an already-small image is never upscaled', () => {
  assert.deepEqual(renditionDimensions(800, 600), { width: 800, height: 600 })
})
check('the cap matches the exported constant', () => {
  const d = renditionDimensions(10000, 5000)
  assert.equal(Math.max(d.width, d.height), RENDITION_LONG_EDGE)
})
check('degenerate dimensions return null instead of NaN', () => {
  assert.equal(renditionDimensions(0, 100), null)
  assert.equal(renditionDimensions(100, 0), null)
})

// ── The display rule: an <img> only ever gets bytes a browser can paint ─────
check('a browser can paint the formats we claim it can', () => {
  for (const p of ['a/b.jpg', 'a/b.JPEG', 'a/b.png', 'a/b.gif', 'a/b.webp', 'a/b.avif']) {
    assert.equal(browserRenderablePath(p), true, p)
  }
})
check('HEIC is NOT browser-renderable — the entire bug in one assertion', () => {
  assert.equal(browserRenderablePath('work_orders/x/originals/y.heic'), false)
  assert.equal(browserRenderablePath('work_orders/x/originals/y.HEIC'), false)
  assert.equal(browserRenderablePath('a/b.heif'), false)
})
check('an unknown or missing extension is not assumed paintable', () => {
  assert.equal(browserRenderablePath('a/b.dng'), false)
  assert.equal(browserRenderablePath('a/b'), false)
  assert.equal(browserRenderablePath(''), false)
  assert.equal(browserRenderablePath(null), false)
})

check('the watermarked evidence variant always wins', () => {
  assert.equal(displayPathForPhoto({
    storage_path_watermarked: 'w/x.jpg',
    storage_path_rendition: 'r/x.jpg',
    storage_path_original: 'o/x.heic',
  }), 'w/x.jpg')
})
check('the rendition carries a HEIC photo until its watermark exists', () => {
  assert.equal(displayPathForPhoto({
    storage_path_watermarked: null,
    storage_path_rendition: 'work_orders/a/renditions/x.jpg',
    storage_path_original: 'work_orders/a/originals/x.heic',
  }), 'work_orders/a/renditions/x.jpg')
})
check('a plain JPEG capture still displays from its original', () => {
  assert.equal(displayPathForPhoto({
    storage_path_watermarked: null,
    storage_path_rendition: null,
    storage_path_original: 'work_orders/a/originals/x.jpg',
  }), 'work_orders/a/originals/x.jpg')
})
check('a HEIC with no rendition and no watermark displays NOTHING', () => {
  // The regression under test. Returning the .heic here is what put an
  // undecodable file in an <img> and made 66 intact photos look broken.
  assert.equal(displayPathForPhoto({
    storage_path_watermarked: null,
    storage_path_rendition: null,
    storage_path_original: 'work_orders/a/originals/x.heic',
  }), null)
})
check('a photo row with no paths at all is handled', () => {
  assert.equal(displayPathForPhoto({}), null)
  assert.equal(displayPathForPhoto(null), null)
})

console.log(`heif-rendition-fixture: ${checks} checks passed`)
