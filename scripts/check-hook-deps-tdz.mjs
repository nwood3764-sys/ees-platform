// Preflight guard: catch the temporal-dead-zone hazard that took down the
// topbar on 2026-07-28 — a hook dependency array that references a const/let
// declared LATER in the same function. A dependency array is evaluated
// synchronously at the useEffect()/useMemo() call site during render, so a
// binding read there before its declaration line is in its TDZ. It "works"
// only when the minifier happens to hoist the declaration; a build that
// orders it the other way throws "Cannot access 'X' before initialization"
// and crashes the whole render subtree. Declare-before-use removes the
// hazard regardless of build ordering — this check enforces that.
import fs from 'fs'
import path from 'path'
import { parse } from '@babel/parser'

const HOOKS = new Set(['useEffect','useLayoutEffect','useMemo','useCallback','useImperativeHandle'])
const ROOT = path.resolve('src')
const exts = new Set(['.js','.jsx','.ts','.tsx'])
const files = []
;(function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); if(e.isDirectory()) walk(p); else if(exts.has(path.extname(e.name))) files.push(p) } })(ROOT)

const violations = []

function fnKey(node){ return node ? `${node.type}@${node.start}` : 'module' }

for (const file of files) {
  let ast
  try {
    ast = parse(fs.readFileSync(file,'utf8'), {
      sourceType:'module', plugins:['jsx','typescript','classProperties','topLevelAwait'],
      errorRecovery:true,
    })
  } catch { continue }

  // Pass 1: collect const/let bindings keyed by (enclosing function, name) -> earliest decl start
  const decls = new Map()  // `${fnKey}::${name}` -> declStart
  // Pass: hook calls with a deps array -> {fnKey, callStart, idents:[{name,start}]}
  const hookCalls = []
  const fnStack = [null]

  ;(function visit(node, parent){
    if (!node || typeof node.type !== 'string') return
    const isFn = /Function/.test(node.type)
    if (isFn) fnStack.push(node)
    const curFn = fnStack[fnStack.length-1]

    if (node.type === 'VariableDeclaration' && (node.kind === 'const' || node.kind === 'let')) {
      for (const d of node.declarations) {
        collectNames(d.id).forEach(n => {
          const k = `${fnKey(curFn)}::${n}`
          if (!decls.has(k) || node.start < decls.get(k)) decls.set(k, node.start)
        })
      }
    }

    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && HOOKS.has(node.callee.name)) {
      const last = node.arguments[node.arguments.length-1]
      if (last && last.type === 'ArrayExpression') {
        const idents = []
        for (const el of last.elements) if (el && el.type === 'Identifier') idents.push({name:el.name, start:el.start})
        if (idents.length) hookCalls.push({ fnKey: fnKey(curFn), callStart: node.start, idents, line: node.loc?.start.line })
      }
    }

    for (const key in node) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments') continue
      const v = node[key]
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c, node) }
      else if (v && typeof v.type === 'string') visit(v, node)
    }
    if (isFn) fnStack.pop()
  })(ast, null)

  for (const hc of hookCalls) {
    for (const id of hc.idents) {
      const k = `${hc.fnKey}::${id.name}`
      const declStart = decls.get(k)
      if (declStart !== undefined && declStart > hc.callStart) {
        violations.push(`${path.relative(process.cwd(),file)}:${hc.line}  dependency '${id.name}' is declared later in the same scope (TDZ hazard) — move its declaration above this hook.`)
      }
    }
  }
}

function collectNames(idNode, out=[]) {
  if (!idNode) return out
  switch (idNode.type) {
    case 'Identifier': out.push(idNode.name); break
    case 'ObjectPattern': idNode.properties.forEach(p => collectNames(p.value || p.argument, out)); break
    case 'ArrayPattern': idNode.elements.forEach(e => e && collectNames(e, out)); break
    case 'AssignmentPattern': collectNames(idNode.left, out); break
    case 'RestElement': collectNames(idNode.argument, out); break
  }
  return out
}

if (violations.length) {
  console.error('\x1b[31mhook-deps-tdz: found '+violations.length+' use-before-declaration hazard(s):\x1b[0m')
  for (const v of violations) console.error('  '+v)
  process.exit(1)
}
console.log('\x1b[2mhook-deps-tdz: scanned '+files.length+' files, no dependency-array TDZ hazards\x1b[0m')
