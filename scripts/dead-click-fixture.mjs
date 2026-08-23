// Dead-click audit — every element that LOOKS clickable must actually do something.
//
// Why this exists (2026-08-22): the Field home dashboard shipped a "Projects to
// Schedule" card whose rows rendered through <TableRow>, which hardcodes
// cursor:pointer, but the card passed no onClick. The rows looked clickable,
// highlighted on hover, and did nothing — you could only select the text. The
// same card's Schedule button, the two work-order queues in the right rail, the
// payment-requests card and its "View All" were all the same: a pointer cursor
// and a hover highlight over no handler at all.
//
// Reading the JSX is what let that ship. Nobody can hand-click every screen in
// the platform on every deploy, so this walks the real syntax tree of every
// source file and fails the build when an element advertises an affordance it
// cannot honor.
//
// WHAT IS FLAGGED
//   1. Affordance with no action anywhere in its subtree or above it — an
//      element that sets cursor:pointer (or a hover highlight, or renders as a
//      component that sets one for you, like TableRow) while neither it, an
//      ancestor, nor anything it renders can respond to a click.
//   2. A handler that provably does nothing — onClick={() => {}}.
//
// WHAT IS NOT FLAGGED (deliberately — these are correct patterns)
//   • A cell inside a row that handles the click (ancestor delegation).
//   • A wrapper whose child is the real button/link (descendant handles it).
//   • Anything carrying {...spread} props, where a handler can arrive from a
//     caller and this file cannot see it.
//   • cursor:'pointer' on an element that also sets a real handler, an href,
//     a `to` descriptor, or is natively interactive (button/a/input/select/…).
//
// The allowlist at the bottom is for the handful of cases a static read cannot
// settle. Every entry needs a reason. It is not a place to silence real ones.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'

const traverse = _traverse.default || _traverse
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const srcDir = join(root, 'src')

// ── What counts as "this element can respond to a click" ──────────────────
const ACTION_PROPS = new Set([
  'onClick', 'onDoubleClick', 'onMouseDown', 'onMouseUp', 'onPointerDown', 'onPointerUp',
  'onTouchStart', 'onTouchEnd', 'onKeyDown', 'onKeyPress', 'onActivate', 'onChange',
  'onSubmit', 'onDrop', 'onFocus', 'onSelect', 'onInput', 'onToggle', 'onNavigate',
  'href', 'to', 'onOpen', 'onSelectRow', 'onRowClick',
  // htmlFor makes a <label> focus/toggle its control — a real action, and the
  // reason a checkbox label legitimately carries cursor:pointer.
  'htmlFor',
])

// Elements the browser makes interactive ON THEIR OWN, with no props from us:
// typing into an input, opening a <details>. These always act.
const SELF_INTERACTIVE = new Set(['input', 'select', 'textarea', 'option', 'summary', 'details'])

// Elements that LOOK interactive but only act if we wire them. A <button> with
// no onClick and no submit role is exactly as dead as a cursor:pointer <div> —
// and it is what hid the original Field-home bug from an earlier version of
// this check: the row was judged "satisfied" by a Schedule button that did
// nothing itself.
// (<label> is deliberately absent: a label with no htmlFor and no wrapped input
// is an accessibility nit, not a click that lies — different problem, different
// check. This one is about controls that promise an action and have none.)
const NEEDS_WIRING = new Set(['button', 'a'])

// Components whose own implementation always wires an action (they are the
// platform's navigation/interaction primitives — verified by reading them).
const INTERACTIVE_COMPONENTS = new Set([
  'NavLink', 'RecordLink', 'HelpIcon', 'Link', 'FieldValueLink',
])

// Components that set cursor:pointer for their caller, so the CALLER owes a
// handler. TableRow is the one that caused the Field-home bug.
const AFFORDANCE_COMPONENTS = new Set(['TableRow'])

// ── Source discovery ──────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) { walk(full, out); continue }
    if (/\.(jsx?|tsx?)$/.test(entry)) out.push(full)
  }
  return out
}

// ── AST helpers ───────────────────────────────────────────────────────────
function elementName(node) {
  const n = node.name
  if (!n) return ''
  if (n.type === 'JSXIdentifier') return n.name
  if (n.type === 'JSXMemberExpression') {
    let cur = n, parts = []
    while (cur.type === 'JSXMemberExpression') { parts.unshift(cur.property.name); cur = cur.object }
    parts.unshift(cur.name)
    return parts.join('.')
  }
  return ''
}

function attrNames(node) {
  const names = new Set()
  let hasSpread = false
  for (const a of node.attributes || []) {
    if (a.type === 'JSXSpreadAttribute') { hasSpread = true; continue }
    if (a.name?.type === 'JSXIdentifier') names.add(a.name.name)
    else if (a.name?.type === 'JSXNamespacedName') names.add(a.name.name.name)
  }
  return { names, hasSpread }
}

function attrByName(node, want) {
  for (const a of node.attributes || []) {
    if (a.type !== 'JSXSpreadAttribute' && a.name?.name === want) return a
  }
  return null
}

// Source text of a node — the cheapest reliable way to look inside a style
// object that may be spread, conditional, or built from constants.
function textOf(node, code) {
  if (node?.start == null || node?.end == null) return ''
  return code.slice(node.start, node.end)
}

// Does this element advertise clickability?
function affordance(node, code) {
  const name = elementName(node)
  if (AFFORDANCE_COMPONENTS.has(name)) return `<${name}> sets cursor:pointer for you`

  const style = attrByName(node, 'style')
  if (style) {
    const t = textOf(style.value, code)
    // cursor:'pointer' written literally, including inside a ternary.
    if (/cursor\s*:\s*(['"`])pointer\1/.test(t)) return "cursor:'pointer'"
  }
  // A hover highlight is the same promise made a different way.
  const enter = attrByName(node, 'onMouseEnter')
  if (enter) {
    const t = textOf(enter.value, code)
    if (/style\.(background|boxShadow|textDecoration|borderColor)/.test(t)) return 'hover highlight'
  }
  return null
}

// Props that make one of the platform's navigation primitives resolve to a
// real destination. A <NavLink> with no `to`/`href`/`onActivate` goes nowhere.
const NAV_PRIMITIVE_PROPS = new Set(['to', 'href', 'onActivate', 'onClick', 'table', 'slug', 'value'])

// Can this element itself respond to a click?
function selfActs(node, inForm) {
  const name = elementName(node)
  const { names, hasSpread } = attrNames(node)

  if (hasSpread) return true               // a handler can arrive from the caller
  for (const n of names) if (ACTION_PROPS.has(n)) return true

  if (SELF_INTERACTIVE.has(name)) return true

  if (NEEDS_WIRING.has(name)) {
    // <button type="submit"> (or any button inside a <form>, where submit is
    // the implicit default) posts the form — that is a real action.
    if (name === 'button') {
      const t = attrByName(node, 'type')
      if (t && /submit/.test(textOf(t.value, '') || t.value?.value || '')) return true
      if (inForm) return true
    }
    return false                            // dead <button> / dead <a>
  }

  if (INTERACTIVE_COMPONENTS.has(name)) {
    for (const n of names) if (NAV_PRIMITIVE_PROPS.has(n)) return true
    return false
  }

  return false
}

// Is this element rendered inside a <form> in the same file? Decides whether a
// bare <button> is an implicit submit.
function insideForm(path) {
  let p = path.parentPath
  while (p) {
    if (p.node?.type === 'JSXElement' && elementName(p.node.openingElement) === 'form') return true
    p = p.parentPath
  }
  return false
}

// An element is satisfied when it, an ancestor, or a descendant can act.
function subtreeActs(path) {
  if (selfActs(path.node.openingElement, insideForm(path))) return true
  let found = false
  path.traverse({
    JSXElement(p) { if (!found && selfActs(p.node.openingElement, insideForm(p))) found = true },
  })
  return found
}

function ancestorActs(path) {
  let p = path.parentPath
  while (p) {
    if (p.node?.type === 'JSXElement' && selfActs(p.node.openingElement, insideForm(p))) return true
    p = p.parentPath
  }
  return false
}

// onClick={() => {}} — a handler that provably does nothing.
function emptyHandler(node, code) {
  for (const a of node.attributes || []) {
    if (a.type === 'JSXSpreadAttribute') continue
    const n = a.name?.name
    if (!n || !/^on[A-Z]/.test(n)) continue
    const t = textOf(a.value, code).replace(/\s+/g, '')
    if (/^\{\(\)=>\{\}\}$/.test(t) || /^\{\(\)=>null\}$/.test(t) || /^\{\(\)=>undefined\}$/.test(t)) {
      return n
    }
  }
  return null
}

// ── Allowlist — each entry needs a reason ─────────────────────────────────
// key: `<relative path>:<line>` — kept coarse on purpose so a moved line
// re-surfaces the finding instead of silently staying suppressed.
const ALLOW = new Map([
])

// ── Run ───────────────────────────────────────────────────────────────────
const files = walk(srcDir)
const findings = []

for (const file of files) {
  const code = readFileSync(file, 'utf8')
  if (!code.includes('<')) continue
  let ast
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'topLevelAwait'],
      errorRecovery: true,
    })
  } catch (err) {
    findings.push({ file: relative(root, file), line: 0, kind: 'parse-error', detail: err.message })
    continue
  }

  traverse(ast, {
    JSXElement(path) {
      const open = path.node.openingElement
      const rel = relative(root, file)
      const line = open.loc?.start.line ?? 0

      const empty = emptyHandler(open, code)
      if (empty) {
        findings.push({ file: rel, line, kind: 'empty-handler', detail: `${empty}={() => {}} on <${elementName(open)}>` })
      }

      // A control that is a button or a link by tag name promises an action by
      // existing at all — it needs no cursor:pointer to make the promise.
      const name = elementName(open)
      if (NEEDS_WIRING.has(name) && !selfActs(open, insideForm(path)) && !subtreeActs(path) && !ancestorActs(path)) {
        findings.push({ file: rel, line, kind: 'dead-control', detail: `<${name}> is wired to nothing` })
        return
      }

      const signal = affordance(open, code)
      if (!signal) return
      if (subtreeActs(path) || ancestorActs(path)) return
      findings.push({ file: rel, line, kind: 'dead-click', detail: `<${name}> ${signal} with no handler, href, or interactive child` })
    },
  })
}

const live = findings.filter(f => !ALLOW.has(`${f.file}:${f.line}`))

if (live.length === 0) {
  console.log(`dead-click-fixture: ${files.length} files scanned · no dead clicks`)
  process.exit(0)
}

console.error(`dead-click-fixture: ${live.length} finding(s) across ${new Set(live.map(f => f.file)).size} file(s)\n`)
const byFile = new Map()
for (const f of live) {
  if (!byFile.has(f.file)) byFile.set(f.file, [])
  byFile.get(f.file).push(f)
}
for (const [file, list] of [...byFile.entries()].sort()) {
  console.error(`  ${file}`)
  for (const f of list.sort((a, b) => a.line - b.line)) {
    console.error(`    ${String(f.line).padStart(5)}  [${f.kind}] ${f.detail}`)
  }
}
console.error(`
Every element above tells the user it can be clicked and then does nothing.
Give it a handler (or an href/to via NavLink/RecordLink), or take the
cursor:pointer / hover highlight off so it stops making the promise.`)
process.exit(1)
