// Preflight guard: catch the Rules-of-Hooks violation that took every record
// page down on 2026-08-26 — a hook called BELOW an early return. React counts
// hooks positionally, so a component that returns "Loading record…" on its
// first render and then falls through to one more useMemo on its second
// render calls MORE hooks than it did before, and React aborts the whole
// subtree with error #310. The record page rendered "Something went wrong"
// for every object on the platform.
//
// Nothing caught it because this repo has no ESLint, so the react-hooks
// plugin's rules-of-hooks was never running. This check enforces the one
// rule that matters: within a component, every hook call must sit in the
// unconditional prefix of the function body — above any return, and never
// inside an if/loop/try. Hoisting the hook and reading the still-loading
// value with `?.` removes the hazard.
import fs from 'fs'
import path from 'path'
import { parse } from '@babel/parser'

const HOOK_RE = /^use[A-Z]/
const ROOT = path.resolve('src')
const exts = new Set(['.js', '.jsx', '.ts', '.tsx'])
const files = []
;(function walk (d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (exts.has(path.extname(e.name))) files.push(p)
  }
})(ROOT)

const violations = []
const isFn = n => /Function/.test(n?.type || '')

// Walk a subtree WITHOUT descending into nested functions: a hook inside a
// nested component or callback belongs to that function, not this one.
function walkOwn (node, visit) {
  if (!node || typeof node.type !== 'string') return
  // A nested function owns its own hooks and its own returns. `function
  // toggleSort() { if (!sortable) return }` declared mid-component is not an
  // early return of the component — descending into it reports the hooks
  // below it as violations when nothing is wrong.
  if (isFn(node)) return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue
    const v = node[key]
    const kids = Array.isArray(v) ? v : [v]
    for (const k of kids) {
      if (!k || typeof k.type !== 'string') continue
      if (isFn(k)) continue
      walkOwn(k, visit)
    }
  }
}

function hookCallsIn (node) {
  const found = []
  walkOwn(node, n => {
    if (n.type !== 'CallExpression') return
    const c = n.callee
    const name = c?.type === 'Identifier' ? c.name
      : (c?.type === 'MemberExpression' && c.property?.type === 'Identifier' && c.object?.name === 'React') ? c.property.name
        : null
    if (name && HOOK_RE.test(name)) found.push({ name, line: n.loc?.start.line })
  })
  return found
}

function hasOwnReturn (node) {
  let found = null
  walkOwn(node, n => {
    if (n.type === 'ReturnStatement' && !found) found = n.loc?.start.line
  })
  return found
}

for (const file of files) {
  let ast
  try {
    ast = parse(fs.readFileSync(file, 'utf8'), {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'classProperties', 'topLevelAwait'],
      errorRecovery: true,
    })
  } catch { continue }

  const rel = path.relative(process.cwd(), file)

  ;(function visit (node) {
    if (!node || typeof node.type !== 'string') return
    if (isFn(node) && node.body?.type === 'BlockStatement') {
      let returnLine = null
      for (const stmt of node.body.body) {
        // A hook that runs only after the function may already have returned
        // is a hook that does not run on every render.
        if (returnLine !== null) {
          for (const h of hookCallsIn(stmt)) {
            violations.push(
              `${rel}:${h.line}  ${h.name}() is called below an early return on line ${returnLine}. ` +
              `Hoist it above every return (read loading values with ?.).`,
            )
          }
        }
        // A hook nested inside a conditional/loop/try doesn't run every render
        // either, even when nothing has returned yet.
        if (/^(If|For|ForIn|ForOf|While|DoWhile|Switch|Try)Statement$/.test(stmt.type)) {
          for (const h of hookCallsIn(stmt)) {
            violations.push(
              `${rel}:${h.line}  ${h.name}() is called inside a conditional (${stmt.type}). ` +
              `Hooks must run unconditionally on every render.`,
            )
          }
        }
        if (returnLine === null) returnLine = hasOwnReturn(stmt)
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc') continue
      const v = node[key]
      const kids = Array.isArray(v) ? v : [v]
      for (const k of kids) if (k && typeof k.type === 'string') visit(k)
    }
  })(ast.program)
}

if (violations.length) {
  console.error(`\nConditional hook check FAILED — ${violations.length} violation(s):\n`)
  for (const v of violations) console.error('  ' + v)
  console.error('\nA hook below a return runs on some renders and not others. React counts')
  console.error('hooks positionally, so the render counts diverge and React aborts the')
  console.error('subtree with minified error #310 ("Rendered more hooks than during the')
  console.error('previous render") — which is how every record page broke on 2026-08-26.\n')
  process.exit(1)
}

console.log(`Conditional hook check passed (${files.length} files).`)
