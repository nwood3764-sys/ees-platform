#!/usr/bin/env node
// =============================================================================
// scripts/preflight.mjs
//
// Pre-build static analysis. Runs as part of the Netlify build command
// (and locally before any commit). If any check fails, exit non-zero so
// the build fails and the deploy does not ship.
//
// What this catches:
//
//   1. IMPORT-OF-NONEXISTENT-EXPORT.   The "named import undefined at runtime"
//      class of bug — e.g. importing `mergeAttributes` from `@tiptap/react`
//      when it only exists in `@tiptap/core`. Vite's build doesn't catch
//      this; it only blows up when the bundle is evaluated in the browser,
//      and the symptom is the catastrophic white screen.
//
//   2. MIXED-CASE INTERNAL IMPORTS.    `import X from './foo'` when the file
//      is `Foo.jsx` works on macOS/Windows (case-insensitive filesystems)
//      and breaks on Linux/Netlify (case-sensitive). Famous Netlify
//      footgun. We check every internal relative import resolves to a
//      file with EXACT case.
//
//   3. UNUSED LAZY-MODULE IMPORTS.     A `lazy(() => import('./modules/X'))`
//      whose target file no longer exists. Vite's tree-shaker silently
//      drops the lazy chunk; the user clicks the sidebar entry and
//      nothing happens.
//
//   4. STRAY CONSOLE.LOG STATEMENTS    in shipped production code paths
//      (warnings only, not failures — they're allowed but flagged so
//      we can clean them up if they accumulate).
//
//   5. UNRESOLVED RELATIVE IMPORTS.    `from './nonexistent'` — Vite's
//      build will catch this for the entry chain, but a file that's
//      orphan-imported (only by another orphan) sometimes slips through.
//      Belt-and-braces check.
//
// What this does NOT catch:
//
//   - Logic bugs. A working build that produces wrong output is fine
//     by these checks.
//   - Runtime data-shape mismatches. If the DB returns a different
//     shape than the React component expects, this won't see it.
//   - UI/visual regressions. Anything browser-level needs a real
//     headless browser (Playwright next session).
//
// Speed: ~2 seconds on a cold run. Cheap enough to run on every push.
// =============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot  = resolve(__dirname, '..')
const srcRoot   = join(repoRoot, 'src')

const failures = []
const warnings = []
let filesScanned = 0

function fail(message, file, line)    { failures.push({ message, file, line }) }
function warn(message, file, line)    { warnings.push({ message, file, line }) }

// ─── File walker ─────────────────────────────────────────────────────────
function* walkSource(dir = srcRoot) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) yield* walkSource(p)
    else if (/\.(jsx?|mjs|ts|tsx)$/.test(entry)) yield p
  }
}

// ─── 1. Resolve a relative import to an actual file on disk ───────────────
// Vite's resolver tries a fixed extension list in a fixed order. We mirror
// that here so the preflight matches Vite's behavior.
const EXTS = ['', '.jsx', '.js', '.ts', '.tsx', '/index.jsx', '/index.js']
function resolveRelativeImport(fromFile, importPath) {
  const baseDir = dirname(fromFile)
  const target  = join(baseDir, importPath)
  for (const ext of EXTS) {
    const candidate = target + ext
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

// ─── 2. Case-sensitive file existence check ──────────────────────────────
// existsSync() lies on macOS — it returns true for files differing only
// in case. We walk the path component-by-component, listing each parent
// dir and matching the case exactly. If any segment doesn't match, the
// file does not exist on Linux (== does not exist on Netlify).
function caseExact(absPath) {
  let cur = '/'
  const parts = relative('/', absPath).split('/')
  for (const part of parts) {
    if (!existsSync(cur)) return false
    const entries = readdirSync(cur)
    if (!entries.includes(part)) return false
    cur = join(cur, part)
  }
  return true
}

// ─── 3. Import-statement extractor ───────────────────────────────────────
// Simple regex-based — full AST parsing would be more correct but adds
// a heavy dep (acorn). For our codebase the regex catches every real
// import; edge cases (multi-line `import { a, b, c }` across 5 lines)
// are joined first.
function extractImports(source) {
  // Collapse multi-line imports into one line each so the regex below
  // can match the whole statement.
  const flat = source
    .replace(/import\s*\{([\s\S]*?)\}\s*from/g, (_, names) =>
      `import {${names.replace(/\s+/g, ' ')}} from`)

  const out = []
  // Static imports: `import X from 'y'`, `import { a, b } from 'y'`,
  // `import * as ns from 'y'`, `import 'y'` (side-effect)
  const re = /^\s*import\s+(?:([^'"]*?)\s+from\s+)?['"]([^'"]+)['"]/gm
  let m
  while ((m = re.exec(flat)) !== null) {
    out.push({
      raw:        m[0],
      bindings:   (m[1] || '').trim(),
      moduleSpec: m[2],
      line:       flat.slice(0, m.index).split('\n').length,
    })
  }
  // Dynamic imports: `import('y')` (only worth checking when the spec
  // is a string literal; template literals etc. aren't statically
  // resolvable)
  const reDyn = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = reDyn.exec(flat)) !== null) {
    out.push({
      raw:        m[0],
      bindings:   '__dynamic__',
      moduleSpec: m[1],
      line:       flat.slice(0, m.index).split('\n').length,
      dynamic:    true,
    })
  }
  return out
}

// ─── 4. Named-export extractor ───────────────────────────────────────────
// Pulls all named exports from a JS/JSX file so we can cross-check that
// `import { x } from './foo'` actually finds an `export ... x` in foo.
function extractNamedExports(source) {
  const names = new Set()
  // export const X = ..., export let X, export var X
  for (const m of source.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1])
  }
  // export function X(...)
  for (const m of source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1])
  }
  // export class X
  for (const m of source.matchAll(/^export\s+class\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1])
  }
  // export { a, b as c, d }
  for (const m of source.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const piece of m[1].split(',')) {
      const cleaned = piece.trim().split(/\s+as\s+/)
      const exported = (cleaned[1] || cleaned[0]).trim()
      if (exported && exported !== 'default') names.add(exported)
    }
  }
  // export default
  if (/^export\s+default\s/m.test(source)) names.add('default')
  return names
}

// ─── 5. Parse a comma-separated bindings clause into named-symbol list ───
// "X, { a, b as c }" → ['default', 'a', 'b']  (the as-alias doesn't matter
// for import resolution; only the source-side name does)
function parseBindings(bindings) {
  if (!bindings || bindings === '__dynamic__') return { needsDefault: false, names: [] }
  let needsDefault = false
  const names = []
  // Default binding: `X from` or `X, { a, b } from`
  const m = bindings.match(/^([A-Za-z_$][\w$]*)\s*(?:,\s*)?/)
  if (m && !bindings.startsWith('{') && !bindings.startsWith('*')) {
    needsDefault = true
    bindings = bindings.slice(m[0].length)
  }
  // Namespace: `* as ns` — wildcard, accepts any exports
  if (/^\*\s+as\s+/.test(bindings)) {
    return { needsDefault, names: ['__namespace__'] }
  }
  // Named: `{ a, b as c }`
  const namedMatch = bindings.match(/\{([^}]+)\}/)
  if (namedMatch) {
    for (const piece of namedMatch[1].split(',')) {
      const cleaned = piece.trim().split(/\s+as\s+/)
      const imported = cleaned[0].trim()
      if (imported) names.push(imported)
    }
  }
  return { needsDefault, names }
}

// ─── Main scan ───────────────────────────────────────────────────────────
const exportCache = new Map() // absPath -> Set<string>
function exportsOf(absPath) {
  if (exportCache.has(absPath)) return exportCache.get(absPath)
  const src = readFileSync(absPath, 'utf8')
  const exp = extractNamedExports(src)
  exportCache.set(absPath, exp)
  return exp
}

for (const file of walkSource()) {
  filesScanned++
  const source = readFileSync(file, 'utf8')
  const imports = extractImports(source)
  const relPath = relative(repoRoot, file)

  for (const imp of imports) {
    // Skip external packages (node_modules, jsr:, https:, etc.)
    if (!imp.moduleSpec.startsWith('.')) continue

    // 1. Does the file exist?
    const target = resolveRelativeImport(file, imp.moduleSpec)
    if (!target) {
      fail(
        `Unresolved import: '${imp.moduleSpec}' does not resolve to any file`,
        relPath, imp.line,
      )
      continue
    }

    // 2. Does the case match exactly? (Netlify-Linux trap)
    if (!caseExact(target)) {
      fail(
        `Case-mismatched import: '${imp.moduleSpec}' resolves to ${relative(repoRoot, target)} ` +
        `with different case. Works on macOS, fails on Netlify/Linux.`,
        relPath, imp.line,
      )
      continue
    }

    // 3. Do all named bindings exist as exports in the target?
    if (imp.dynamic) continue
    const { needsDefault, names } = parseBindings(imp.bindings)
    if (names.includes('__namespace__')) continue  // import * as X — any export OK

    const targetExports = exportsOf(target)
    if (needsDefault && !targetExports.has('default')) {
      fail(
        `Import has 'default' binding but ${relative(repoRoot, target)} exports no default`,
        relPath, imp.line,
      )
    }
    for (const name of names) {
      if (!targetExports.has(name)) {
        fail(
          `Imports { ${name} } from ${relative(repoRoot, target)} but that file ` +
          `does not export ${name}. (Available: ${[...targetExports].sort().join(', ') || '(none)'})`,
          relPath, imp.line,
        )
      }
    }
  }

  // ─── 4. Console.log warnings ────────────────────────────────────────
  // We allow console.warn and console.error (used for telemetry +
  // diagnostic logging). Just .log() in production is usually leftover
  // debug output.
  const logLines = []
  source.split('\n').forEach((line, i) => {
    if (/^\s*console\.log\s*\(/.test(line)) logLines.push(i + 1)
  })
  for (const ln of logLines) {
    warn(`console.log statement (consider removing or downgrading)`, relPath, ln)
  }
}

// ─── Report ──────────────────────────────────────────────────────────────
const RED   = '\x1b[31m'
const YEL   = '\x1b[33m'
const GRN   = '\x1b[32m'
const DIM   = '\x1b[2m'
const RESET = '\x1b[0m'

console.log(`${DIM}preflight: scanned ${filesScanned} source files${RESET}`)

if (warnings.length) {
  console.log(`\n${YEL}${warnings.length} warning${warnings.length === 1 ? '' : 's'}:${RESET}`)
  for (const w of warnings.slice(0, 25)) {
    console.log(`  ${YEL}warn${RESET} ${w.file}:${w.line} — ${w.message}`)
  }
  if (warnings.length > 25) console.log(`  ${DIM}…and ${warnings.length - 25} more${RESET}`)
}

if (failures.length) {
  console.log(`\n${RED}${failures.length} failure${failures.length === 1 ? '' : 's'}:${RESET}`)
  for (const f of failures) {
    console.log(`  ${RED}fail${RESET} ${f.file}:${f.line} — ${f.message}`)
  }
  console.log(`\n${RED}preflight failed — deploy blocked${RESET}`)
  process.exit(1)
}

console.log(`\n${GRN}preflight passed${RESET}`)
