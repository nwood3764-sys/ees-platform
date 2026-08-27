#!/usr/bin/env node
//
// Does an evidence video actually PLAY in LEAP?
//
// Until 2026-08-27 it did not — a video document fell through the preview
// modal's type switch to the metadata-and-Download fallback, so the only way to
// watch a 430 MB attic pan was to save it first. Reading the switch statement
// tells you a `video` branch now exists; it does not tell you a browser decodes
// what LEAP hands it, which is the whole question (and the reason the .MOV that
// started this is a problem at all).
//
// So this asks a real Chromium:
//
//   playable            record a canvas to a real video Blob IN the browser,
//                       hand it to the REAL DocumentPreviewModal, and require
//                       the <video> to reach readyState >= 1 with a real
//                       duration and real pixel dimensions. That is decoding,
//                       not "an element exists".
//
//   CONTROL-undecodable feed the same modal bytes that are NOT a video under a
//                       .MOV name and video/quicktime — the case Chrome hits on
//                       a real iPhone capture. The player must FAIL and LEAP
//                       must say so in words, with Download offered. If this
//                       case ever renders a working player, the harness is
//                       lying and every other PASS is worthless.
//
// Run with:  npm run verify:video-preview
//
// Not part of `npm run build:safe`: it needs a browser binary, and a deploy that
// depends on one breaks when the build image changes. The build gate for this
// behaviour is scripts/video-evidence-fixture.mjs, which pins the rules
// statically. This tool is how you prove the result.

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'video-preview-check'

let chromium
try {
  ({ chromium } = await import('playwright-core'))
} catch {
  console.log([
    '',
    'verify:video-preview  SKIPPED — nothing was verified.',
    '',
    '  playwright-core is not installed. It is deliberately not a dependency:',
    '  this check is a tool, not a build step. To run it:',
    '',
    '    npm install --no-save playwright-core',
    '    npm run verify:video-preview',
    '',
  ].join('\n'))
  process.exit(0)
}

function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  if (!existsSync(base)) return null
  for (const entry of readdirSync(base)) {
    for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(base, entry, rel)
      if (entry.startsWith('chromium') && !entry.includes('headless_shell') && existsSync(p)) return p
    }
  }
  return null
}
const executablePath = findChromium()
if (!executablePath) {
  console.log('\nverify:video-preview  SKIPPED — nothing was verified.\n  No Chromium found under PLAYWRIGHT_BROWSERS_PATH. Set CHROMIUM_PATH to a binary.\n')
  process.exit(0)
}

const server = await createServer({
  root, plugins: [react()], configFile: false,
  server: { port: 5312, strictPort: true }, logLevel: 'error',
})
await server.listen()

let failures = 0, checks = 0
const note = (ok, label, detail) => {
  checks += 1
  if (ok) console.log(`PASS  ${label}`)
  else { failures += 1; console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`) }
}

const browser = await chromium.launch({
  executablePath,
  // Autoplay is irrelevant — nothing is played automatically; this only stops
  // Chromium gating metadata loads behind a gesture in headless.
  args: ['--autoplay-policy=no-user-gesture-required'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))
  await page.goto('http://localhost:5312/tools/video-preview-check/', { waitUntil: 'networkidle' })

  const recordError = await page.$('[data-record-error]')
  if (recordError) {
    console.log(`\nverify:video-preview  SKIPPED — this browser cannot record a test video: ${await recordError.textContent()}\n`)
    process.exit(0)
  }
  await page.waitForSelector('[data-case="playable"]', { timeout: 30000 })

  // ── playable ───────────────────────────────────────────────────────────────
  const played = await page.evaluate(async () => {
    const v = document.querySelector('[data-case="playable"] video')
    if (!v) return { ok: false, why: 'no <video> element rendered' }
    await new Promise(res => {
      if (v.readyState >= 1) return res()
      v.addEventListener('loadedmetadata', res, { once: true })
      v.addEventListener('error', res, { once: true })
      setTimeout(res, 15000)
    })
    return {
      ok: v.readyState >= 1 && v.videoWidth > 0 && v.videoHeight > 0 && v.duration > 0,
      readyState: v.readyState, w: v.videoWidth, h: v.videoHeight,
      duration: Number.isFinite(v.duration) ? Number(v.duration.toFixed(2)) : String(v.duration),
      controls: v.controls, error: v.error ? v.error.code : null,
    }
  })
  note(played.ok, 'playable: the browser decoded the video LEAP handed it',
    JSON.stringify(played))
  note(played.controls === true, 'playable: it has transport controls (a video you cannot scrub is not watchable)')

  const noFallbackWhenFine = await page.evaluate(() =>
    !/cannot play/i.test(document.querySelector('[data-case="playable"]')?.textContent || ''))
  note(noFallbackWhenFine, 'playable: LEAP does NOT claim it cannot play a video it just played')

  // ── CONTROL-undecodable ────────────────────────────────────────────────────
  const control = await page.evaluate(async () => {
    const root = document.querySelector('[data-case="CONTROL-undecodable"]')
    const start = Date.now()
    while (Date.now() - start < 15000) {
      if (/cannot play/i.test(root.textContent || '')) break
      await new Promise(r => setTimeout(r, 100))
    }
    const text = root.textContent || ''
    return {
      said: /cannot play/i.test(text),
      namedFormat: /\.mov/i.test(text),
      reassured: /not damaged/i.test(text),
      offersDownload: [...root.querySelectorAll('button')].some(b => /download/i.test(b.textContent || '')),
      stillShowsDeadPlayer: !!root.querySelector('video'),
      text: text.replace(/\s+/g, ' ').slice(0, 240),
    }
  })
  note(control.said, 'CONTROL: an undecodable video is REPORTED, not left as a black box', control.text)
  note(control.namedFormat, 'CONTROL: the message names the format (.MOV), so the person knows what to do')
  note(control.reassured, 'CONTROL: it says the file is not damaged — the upload DID work')
  note(control.offersDownload, 'CONTROL: Download is offered right there')
  note(!control.stillShowsDeadPlayer, 'CONTROL: the dead player is replaced, not left underneath')

  note(pageErrors.length === 0, 'no uncaught page errors', pageErrors.join('\n      '))
} finally {
  await browser.close()
  await server.close()
}

console.log(failures === 0
  ? `\nverify:video-preview: ${checks} checks passed`
  : `\nverify:video-preview: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
