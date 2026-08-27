// Fixture: a callback prop that may be null must stay null all the way down.
//
// The defect class, in one line:
//
//     <Child onFoo={() => onFoo(row)} />        // inside a component that
//                                               // itself RECEIVES onFoo
//
// If the parent passed `onFoo={condition ? handler : null}` to say "this
// control does not apply here", that arrow throws the null away. The child
// receives a function, its own `{onFoo && …}` guard passes, the control renders
// where it was deliberately withheld — and pressing it calls null.
//
// It shipped and bit. `objectHasReportInclusion('work_steps')` is false, so
// FileGallery correctly passed `onToggleReport={null}` on a work step's
// documents card — and `DocumentList` re-wrapped it, so the "In report" button
// was drawn anyway. Lucas uploaded a video to a work step on 2026-08-27, tagged
// it for the report, and the record page died with `TypeError: c is not a
// function` (client_errors, /work_steps/…, three times in two seconds). The
// same line existed for photos, so every photo tile on every object with no
// report — properties, accounts, projects, buildings, work steps — carried a
// button that crashed the page.
//
// The rule this pins: within a file, if a prop name is EVER passed as
// `cond ? x : null`, then every other place that same prop is re-wrapped must
// carry the guard — `onFoo ? () => onFoo(row) : null`.
//
// Run with:  node scripts/optional-callback-prop-fixture.mjs

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')

let failures = 0
let checks = 0
function check(label, ok, detail) {
  checks += 1
  if (!ok) { failures += 1; console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`) }
}

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(p)
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) yield p
  }
}

// Props handed a conditional null: `onFoo={anything ? whatever : null}`.
// `undefined` counts too — it reaches the child identically.
const NULLABLE = /\bon([A-Z][A-Za-z0-9]*)\s*=\s*\{[^{}]*\?[^{}]*:\s*(?:null|undefined)\s*\}/g
// The unguarded re-wrap: `onFoo={() => onFoo(...)}` / `{(e) => onFoo(...)}`.
const REWRAP = name =>
  new RegExp(`\\b${name}\\s*=\\s*\\{\\s*\\(([^)]*)\\)\\s*=>\\s*${name}\\s*\\(`)
// The guarded form the fix must use: `onFoo={onFoo ? () => onFoo(...) : null}`.
const GUARDED = name =>
  new RegExp(`\\b${name}\\s*=\\s*\\{\\s*${name}\\s*(?:&&|\\?)`)

/** Every (file, prop) pair where a nullable prop is re-wrapped without a guard. */
export function unguardedRewraps(sources) {
  const offenders = []
  for (const [path, src] of sources) {
    const nullable = new Set([...src.matchAll(NULLABLE)].map(m => `on${m[1]}`))
    for (const name of nullable) {
      // A line that both re-wraps and guards is the fixed form — check the
      // guard first, since the guarded string contains the re-wrap.
      const lines = src.split('\n')
      lines.forEach((line, i) => {
        // A prose line describing the defect is not the defect. This very
        // fixture and FileGallery's own comment both spell the broken form out.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        if (!REWRAP(name).test(line)) return
        if (GUARDED(name).test(line)) return
        offenders.push({ path, name, line: i + 1, text: line.trim() })
      })
    }
  }
  return offenders
}

// ── 1. The platform is clean ─────────────────────────────────────────────────
const sources = [...sourceFiles(srcDir)].map(p => [relative(root, p), readFileSync(p, 'utf8')])
const offenders = unguardedRewraps(sources)
check('no nullable callback prop is re-wrapped without its guard',
  offenders.length === 0,
  offenders.map(o => `${o.path}:${o.line}  ${o.name}  →  ${o.text}`).join('\n      '))

// ── 2. FileGallery specifically — the two call sites that crashed ────────────
const galleryPath = 'src/components/FileGallery.jsx'
const gallery = sources.find(([p]) => p === galleryPath)
check(`${galleryPath} is readable`, !!gallery)
if (gallery) {
  const src = gallery[1]
  check('FileGallery still withholds the report flag by object',
    /onToggleReport=\{offersReportFlag \? handleToggleReport : null\}/.test(src))
  for (const row of ['p', 'd']) {
    check(`FileGallery guards the onToggleReport re-wrap for (${row})`,
      src.includes(`onToggleReport={onToggleReport ? () => onToggleReport(${row}) : null}`))
  }
}

// ── 3. Positive control — the check must FAIL on the shipped defect ──────────
//
// A fixture that cannot fail proves nothing. This is the exact line that was
// live on 2026-08-27.
const brokenControl = [['fixture://broken.jsx', `
  <DocumentList onToggleReport={offersReportFlag ? handleToggleReport : null} />
  function DocumentList({ onToggleReport }) {
    return <DocumentRow onToggleReport={() => onToggleReport(d)} />
  }
`]]
check('positive control: the shipped defect is caught',
  unguardedRewraps(brokenControl).length === 1,
  `caught ${unguardedRewraps(brokenControl).length}`)

const fixedControl = [['fixture://fixed.jsx', `
  <DocumentList onToggleReport={offersReportFlag ? handleToggleReport : null} />
  function DocumentList({ onToggleReport }) {
    return <DocumentRow onToggleReport={onToggleReport ? () => onToggleReport(d) : null} />
  }
`]]
check('negative control: the guarded form passes',
  unguardedRewraps(fixedControl).length === 0)

console.log(failures === 0
  ? `optional-callback-prop-fixture: ${checks} checks passed`
  : `optional-callback-prop-fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
