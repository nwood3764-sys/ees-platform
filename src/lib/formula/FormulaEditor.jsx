// =============================================================================
// src/lib/formula/FormulaEditor.jsx
//
// The visual formula editor (§8): a CodeMirror 6 code field with syntax
// highlighting, inline autocomplete over fields + the function library, and a
// live "Check syntax" indicator that validates against the SAME engine the
// runtime uses. Lazy-loaded (CodeMirror is heavy and only needed while editing
// a calculated field).
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { C } from '../../data/constants'
import { validateFormula, FORMULA_FUNCTIONS, ALL_FUNCTION_NAMES } from './engine'

// Curated functions (name → signature + description) for richer completions.
const CURATED = FORMULA_FUNCTIONS.flatMap(g => g.items.map(i => ({ ...i, category: g.category })))
const CURATED_BY_NAME = Object.fromEntries(CURATED.map(i => [i.name, i]))

// ─── Tiny tokenizer for highlighting ──────────────────────────────────────────
const formulaLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match(/"(?:[^"\\]|\\.)*"/) || stream.match(/'(?:[^'\\]|\\.)*'/)) return 'string'
    if (stream.match(/\d+(\.\d+)?/)) return 'number'
    if (stream.match(/[A-Za-z_][A-Za-z0-9_]*/)) {
      // A name immediately followed by '(' is a function call.
      return stream.peek() === '(' ? 'function' : 'field'
    }
    if (stream.match(/[+\-*/^%<>=!&|,]/)) return 'operator'
    stream.next()
    return null
  },
  tokenTable: {
    function: t.function(t.variableName),
    field: t.variableName,
    string: t.string,
    number: t.number,
    operator: t.operator,
  },
})

const highlight = HighlightStyle.define([
  { tag: t.string, color: C.emeraldMid },
  { tag: t.number, color: '#1e466b' },
  { tag: t.function(t.variableName), color: C.textPrimary, fontWeight: '600' },
  { tag: t.variableName, color: C.textSecondary },
  { tag: t.operator, color: C.textMuted },
])

const theme = EditorView.theme({
  '&': { fontSize: '12.5px', border: `1px solid ${C.border}`, borderRadius: '6px', background: C.card },
  '&.cm-focused': { outline: 'none', borderColor: C.emerald },
  '.cm-content': { fontFamily: 'JetBrains Mono, monospace', padding: '8px 10px', color: C.textPrimary },
  '.cm-scroller': { lineHeight: '1.5' },
})

function makeCompletions(fields) {
  const fieldSet = new Set(fields)
  return (context) => {
    const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/)
    if (!word || (word.from === word.to && !context.explicit)) return null
    const options = [
      ...fields.map(f => ({ label: f, type: 'variable', detail: 'field' })),
      ...CURATED.map(fn => ({
        label: fn.name, type: 'function', detail: fn.category,
        info: `${fn.template}\n${fn.desc}`, apply: `${fn.name}(`, boost: 1,
      })),
      ...ALL_FUNCTION_NAMES
        .filter(n => !CURATED_BY_NAME[n] && !fieldSet.has(n))
        .map(n => ({ label: n, type: 'function', detail: 'fn', apply: `${n}(` })),
    ]
    return { from: word.from, options, validFor: /^[A-Za-z_][A-Za-z0-9_]*$/ }
  }
}

export default function FormulaEditor({ value = '', onChange, fields = [], placeholder = 'e.g. IF(amount > 1000, "Large", "Standard")' }) {
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [status, setStatus] = useState(null)   // null | {ok} | {ok:false,error}

  // Create the editor once.
  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          closeBrackets(),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap]),
          formulaLanguage,
          syntaxHighlighting(highlight),
          autocompletion({ override: [makeCompletions(fields)] }),
          cmPlaceholder(placeholder),
          EditorView.lineWrapping,
          theme,
          EditorView.updateListener.of(u => {
            if (u.docChanged) {
              const next = u.state.doc.toString()
              onChangeRef.current?.(next)
              setStatus(null)
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.join('|')])

  // Sync external value changes into the editor.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const cur = view.state.doc.toString()
    if (value !== cur) {
      view.dispatch({ changes: { from: 0, to: cur.length, insert: value || '' } })
    }
  }, [value])

  const check = () => setStatus(validateFormula(value, fields))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <button onClick={check} style={{
          padding: '4px 10px', fontSize: 12, fontWeight: 500, background: C.card, color: C.textPrimary,
          border: `1px solid ${C.borderDark}`, borderRadius: 6, cursor: 'pointer',
        }}>Check syntax</button>
        {status && (
          <span style={{ fontSize: 11, fontWeight: 600, color: status.ok ? C.emeraldMid : C.sky }}>
            {status.ok ? '✓ Valid' : `✗ ${status.error}`}
          </span>
        )}
        <span style={{ fontSize: 10.5, color: C.textMuted, marginLeft: 'auto' }}>Ctrl-Space for suggestions</span>
      </div>
      <div ref={hostRef} />
    </div>
  )
}
