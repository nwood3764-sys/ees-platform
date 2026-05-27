#!/usr/bin/env node
// =============================================================================
// scripts/runtime-smoke.mjs
//
// Tier-2 deploy gate. Two checks, fast and reliable:
//
//   1. Every JS chunk in dist/assets/ parses without SyntaxError.
//      Catches: minifier bugs, malformed bundle output. Rare but
//      catastrophic — a SyntaxError in any chunk reaches the user
//      as a complete white screen with no error UI.
//
//   2. Every chunk referenced in dist/index.html actually exists
//      on disk. Catches: truncated build artifacts where the
//      bundler emitted the manifest but failed to write a file
//      (or someone manually deleted a chunk).
//
// What this does NOT catch:
//   • Top-level eval errors after parse succeeds. That would need
//     a full browser environment (Playwright) since JSDOM doesn't
//     support <script type="module">. Tracked as roadmap.
//   • React render crashes. Same constraint as above.
//
// Why not JSDOM: jsdom@29 silently ignores <script type="module">
// elements, so the chunks would never actually evaluate. Confirmed
// experimentally before pivoting to parse-only validation.
//
// Why this is still useful even without runtime eval:
//   The vast majority of "broken deploy" failures fall into one of
//   the two checks above. SyntaxError-on-load and missing-chunk-404
//   together account for every truly catastrophic deploy I've seen.
//   Runtime eval errors are usually module-load-order issues already
//   caught by the static preflight's lazy-target check.
//
// Runtime: ~1-2s against the current bundle.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIST_DIR = new URL('../dist', import.meta.url).pathname

const RED   = '\x1b[31m'
const GRN   = '\x1b[32m'
const DIM   = '\x1b[2m'
const RESET = '\x1b[0m'

async function main() {
  let chunks
  let html
  try {
    chunks = readdirSync(join(DIST_DIR, 'assets')).filter(f => f.endsWith('.js'))
    html   = readFileSync(join(DIST_DIR, 'index.html'), 'utf8')
  } catch {
    console.log(`${RED}runtime-smoke: dist/ not found — run \`npm run build\` first${RESET}`)
    process.exit(1)
  }

  let failed = 0
  const failures = []

  // ─── Check 1: every chunk parses ─────────────────────────────────────
  // Node's import() of a file:// URL drives the same parser the V8
  // engine uses in browsers. We expect resolution failures for chunks
  // that import other chunks by relative path (Node can't resolve
  // them without a server context); those are tolerated. SyntaxError
  // is the failure we care about — it means the bundle text is
  // malformed and no browser could load it.
  console.log(`${DIM}runtime-smoke: parse-check ${chunks.length} chunks${RESET}`)
  for (const chunk of chunks) {
    const fullPath = `file://${join(DIST_DIR, 'assets', chunk)}`
    try {
      await import(fullPath)
    } catch (err) {
      const msg = String(err?.message || err)
      const isSyntaxError = err?.name === 'SyntaxError' || /SyntaxError/.test(msg)
      // Expected resolution failures — chunks reference each other via
      // relative specifiers like "./vendor-react-XXX.js" which Node
      // can't resolve at this layer.
      const isResolutionFailure = err?.code === 'ERR_MODULE_NOT_FOUND'
        || /Cannot find module/.test(msg)
        || /Cannot find package/.test(msg)
      // Reference errors during top-level eval — chunk parses fine but
      // references something the runtime doesn't have (window, etc.).
      // These would fire in a real browser too only if the user's
      // browser lacks the global, which doesn't happen in practice.
      const isReferenceError = err?.name === 'ReferenceError'
        || /is not defined/.test(msg)
      if (isSyntaxError) {
        failed++
        failures.push({ file: chunk, error: msg.split('\n')[0] })
      } else if (isResolutionFailure || isReferenceError) {
        // Tolerated. The check is parse-only; further runtime errors
        // happen naturally in this environment and tell us nothing
        // about what would happen in a browser.
      } else {
        // Genuinely unexpected error — surface it as info
        console.log(`  ${DIM}note: ${chunk} — ${err?.name || 'Error'}: ${msg.split('\n')[0].substring(0, 80)}${RESET}`)
      }
    }
  }

  // ─── Check 2: every chunk referenced in index.html exists ───────────
  // Vite emits <link rel="modulepreload"> and <script type="module">
  // tags referencing chunk filenames. Any of those NOT in dist/assets/
  // means the deploy is truncated — the user would 404 on first load.
  console.log(`${DIM}runtime-smoke: verifying chunk references in index.html${RESET}`)
  const chunkRefs = [...html.matchAll(/\/assets\/([^"'\s>]+)/g)].map(m => m[1])
  const presentSet = new Set(chunks)
  // index.html also references CSS files
  let cssFiles = []
  try {
    cssFiles = readdirSync(join(DIST_DIR, 'assets')).filter(f => f.endsWith('.css'))
  } catch {}
  for (const css of cssFiles) presentSet.add(css)
  for (const ref of chunkRefs) {
    if (!presentSet.has(ref)) {
      failed++
      failures.push({ file: 'index.html', error: `references missing chunk: /assets/${ref}` })
    }
  }

  if (failed > 0) {
    console.log()
    for (const f of failures) {
      console.log(`  ${RED}fail${RESET} ${f.file} — ${f.error}`)
    }
    console.log(`\n${RED}runtime-smoke: ${failed} issue${failed === 1 ? '' : 's'} — deploy blocked${RESET}`)
    process.exit(1)
  }
  console.log(`\n${GRN}runtime-smoke passed${RESET}`)
}

main().catch(err => {
  console.error(`${RED}runtime-smoke: unexpected failure: ${err?.message || err}${RESET}`)
  process.exit(1)
})
