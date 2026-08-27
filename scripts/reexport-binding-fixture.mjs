#!/usr/bin/env node
// =============================================================================
// reexport-binding-fixture — a re-export is not an import.
//
// `export { getTableListUrl } from './urlGrammar.js'` forwards a name to this
// module's CONSUMERS. It does not bind that name in this module's own scope.
// So a file that re-exports a helper and then calls it — reading, correctly,
// as though the name were in scope — throws at runtime:
//
//     ReferenceError: getTableListUrl is not defined
//
// That is exactly what shipped in src/lib/urlNav.js on 2026-08-24 and stood
// for three days: closeRecord() called a name it only re-exported, so leaving
// a record with no in-page history behind it (a deep link, a bookmark, a fresh
// tab — and the screen immediately after a delete) blew up the whole app view.
// The delete itself had already succeeded, so the user saw "Something went
// wrong" over a record that was in fact gone, and concluded it hadn't worked.
//
// Nothing catches this class of defect: it is valid syntax, the linter is
// happy, the build succeeds, and every line of the file reads correctly. So
// this fixture asserts the rule directly, over every module in src/.
// =============================================================================

import { readFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC  = join(ROOT, 'src')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(js|jsx|mjs)$/.test(entry)) out.push(full)
  }
  return out
}

// Comments and string/template literals mention these names constantly (the
// header comment of urlNav.js lists every one of them), so they are stripped
// before the body is searched — otherwise every documented re-export would
// read as a use.
function stripCommentsAndStrings(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      while (i < n && src[i] !== quote) { if (src[i] === '\\') i++; i++ }
      i++
      // An EMPTY literal of the same kind, not a space: the module-source and
      // import-specifier regexes below match on the quotes, so dropping them
      // would silently stop matching every import in the file — a fixture that
      // scans nothing and reports success.
      out += quote + quote
      continue
    }
    out += c
    i++
  }
  return out
}

// The module specifier is matched as POSSIBLY EMPTY: stripCommentsAndStrings
// blanks every literal to '' so that an import path can never be mistaken for
// code, which means `from './urlGrammar.js'` arrives here as `from ''`.
const RE_EXPORT_FROM = /export\s*\{([^}]*)\}\s*from\s*['"][^'"]*['"]/g
const IMPORT_STMT    = /import\s+([^;]*?)\s*from\s*['"][^'"]*['"]/g

function namesIn(clause) {
  return clause
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    // `export { a as b } from` forwards under the alias; the LOCAL name is the
    // left-hand side, which is what a body reference would have to resolve to.
    .map(s => s.split(/\s+as\s+/)[0].trim())
    .filter(s => /^[A-Za-z_$][\w$]*$/.test(s))
}

const failures = []
let filesScanned = 0
let reexportsChecked = 0

for (const file of walk(SRC)) {
  const raw = readFileSync(file, 'utf8')
  if (!/export\s*\{[^}]*\}\s*from/.test(raw)) continue
  filesScanned++
  const code = stripCommentsAndStrings(raw)

  // Every name this module actually binds via an import — named, default, or
  // namespace. Anything in here is legitimately in scope.
  const imported = new Set()
  for (const m of code.matchAll(IMPORT_STMT)) {
    const clause = m[1]
    const named = clause.match(/\{([^}]*)\}/)
    if (named) for (const nm of namesIn(named[1])) imported.add(nm)
    // default / namespace: `import x from`, `import * as x from`
    const head = clause.replace(/\{[^}]*\}/g, '').replace(/,/g, ' ').trim()
    for (const tok of head.split(/\s+/)) {
      if (tok === '*' || tok === 'as' || !tok) continue
      if (/^[A-Za-z_$][\w$]*$/.test(tok)) imported.add(tok)
    }
  }

  // The module body with every import and re-export statement removed — what
  // is left is code that has to resolve names in this module's own scope.
  const body = code
    .replace(RE_EXPORT_FROM, ' ')
    .replace(IMPORT_STMT, ' ')

  for (const m of code.matchAll(RE_EXPORT_FROM)) {
    for (const name of namesIn(m[1])) {
      reexportsChecked++
      if (imported.has(name)) continue
      // A local declaration of the same name is also a real binding.
      const declared = new RegExp(`(?:function|class|const|let|var)\\s+${name}\\b`).test(body)
      if (declared) continue
      if (new RegExp(`\\b${name}\\b`).test(body)) {
        failures.push(
          `${relative(ROOT, file)}: "${name}" is re-exported with \`export { … } from\` ` +
          `but also USED in this module, and never imported. ` +
          `A re-export does not bind the name locally — this throws ` +
          `"ReferenceError: ${name} is not defined" at runtime. ` +
          `Add it to this module's own import from the same source.`,
        )
      }
    }
  }
}

// Positive control: the defect must be detectable, or a green run means
// nothing. This is the exact shape urlNav.js shipped with.
const CONTROL = `
import { parsePath } from './urlGrammar.js'
export { parsePath, getTableListUrl } from './urlGrammar.js'
export function closeRecord(table) { return getTableListUrl(table) }
`
{
  const code = stripCommentsAndStrings(CONTROL)
  const imported = new Set(['parsePath'])
  const body = code.replace(RE_EXPORT_FROM, ' ').replace(IMPORT_STMT, ' ')
  const caught = !imported.has('getTableListUrl') && /\bgetTableListUrl\b/.test(body)
  if (!caught) {
    failures.push('POSITIVE CONTROL FAILED: the fixture no longer detects the defect it exists to catch.')
  }
}

if (failures.length) {
  console.error('✗ re-export binding fixture FAILED\n')
  for (const f of failures) console.error(`  • ${f}`)
  process.exit(1)
}
console.log(`✓ re-export binding fixture — ${reexportsChecked} re-exported names across ${filesScanned} files, positive control caught`)
