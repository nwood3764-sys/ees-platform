// =============================================================================
// TiptapEmailComposer
//
// Rich-text email composer built on TipTap (ProseMirror). Drops into the
// Communications Module v1 compose surface as the body editor. Replaces
// the prior <textarea> approach.
//
// Two modes:
//   • 'free-form'    — open editor, full body authored by the user
//   • 'template'     — alternating locked + editable regions per
//                      email_templates.template_locked_regions
//
// In template mode locked regions render inline as dimmed, uneditable
// blocks (atom nodes with selectable=false) so the user sees the
// surrounding context without being able to alter it. Editable regions
// render as normal editable paragraphs that the user fills in.
//
// On send the modal calls editor.getEditableRegions() (free-form returns
// the whole HTML under a synthetic 'body' region; template mode returns
// a map keyed by region_id with each editable region's HTML).
//
// Merge fields are inserted via the toolbar's "Insert Merge Field" button
// (opens the same picker used elsewhere in the platform) OR via the `{{`
// trigger which opens an inline suggestion list. Both paths emit a
// Mention node whose `renderText` produces the literal `{{path}}` string —
// the server-side resolver at send-email-v1 expects this exact format.
//
// Locked-region content is reassembled server-side from the template row,
// not transported in the payload — the editor renders locked regions
// purely for preview clarity in compose. This keeps the data-layer
// validation in send-email-v1 (which checks that locked regions appear
// verbatim in the final body) as the single source of truth for
// template integrity.
// =============================================================================

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react'
import { Node, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'

import { C } from '../data/constants'
import {
  MERGE_FIELD_OBJECTS,
  loadFieldsForObject,
} from '../data/mergeFieldCatalog'

// ── Visual constants ──────────────────────────────────────────────────────

const TOOLBAR_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
  padding: '6px 8px',
  background: '#fafbfd',
  borderBottom: `1px solid ${C.border}`,
  borderTopLeftRadius: 6,
  borderTopRightRadius: 6,
}

const TOOLBAR_BTN = (active) => ({
  background: active ? '#dbeefd' : 'transparent',
  border: `1px solid ${active ? '#7eb3e8' : 'transparent'}`,
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 13,
  fontFamily: 'inherit',
  color: active ? '#0d1a2e' : C.textSecondary,
  cursor: 'pointer',
  minWidth: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 500,
})

const TOOLBAR_SEP = {
  width: 1,
  height: 18,
  background: C.border,
  margin: '0 4px',
}

const EDITOR_SHELL_STYLE = {
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  background: C.card,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
}

const EDITOR_BODY_STYLE = {
  padding: '10px 12px',
  minHeight: 180,
  fontSize: 13,
  lineHeight: 1.5,
  color: C.textPrimary,
  fontFamily: 'inherit',
}

// Locked region: shown inline in the doc but uneditable, slightly dimmed
// with a left-rule so the user can see why they can't touch it.
const LOCKED_BLOCK_STYLE = {
  background: '#f1f5fb',
  borderLeft: '3px solid #b9c8df',
  padding: '8px 10px',
  margin: '6px 0',
  color: '#4a5e7a',
  fontSize: 13,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  borderRadius: 3,
  userSelect: 'text',
  cursor: 'not-allowed',
  position: 'relative',
}

const LOCKED_TAG_STYLE = {
  position: 'absolute',
  top: 4,
  right: 6,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  color: '#7d8da6',
}

const EDITABLE_TAG_STYLE = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  color: '#3ecf8e',
  marginBottom: 2,
  display: 'block',
}

// Mention chip in-editor visual. The renderHTML / renderText paths emit
// the literal `{{path}}` text the server resolver consumes; the chip is
// a UI affordance only.
const CHIP_STYLE = `
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  margin: 0 1px;
  border-radius: 10px;
  background: #e9f4ff;
  color: #0d1a2e;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid #b8d8f5;
  line-height: 1.4;
  vertical-align: baseline;
  white-space: nowrap;
`

// ── Custom Node: LockedRegion ─────────────────────────────────────────────
// Renders the region_content verbatim (with merge fields visible as
// literal {{path}} tokens). Atom + selectable=false makes it a single
// uneditable block — caret can't enter it.

const LockedRegion = Node.create({
  name: 'lockedRegion',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      regionId:      { default: null,    parseHTML: el => el.getAttribute('data-region-id') },
      regionContent: { default: '',      parseHTML: el => el.getAttribute('data-region-content') || '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-locked-region]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-locked-region':    '',
        'data-region-id':        node.attrs.regionId,
        'data-region-content':   node.attrs.regionContent,
        'contenteditable':       'false',
        'class':                 'leap-locked-region',
        'style':
          'background:#f1f5fb;border-left:3px solid #b9c8df;' +
          'padding:8px 10px;margin:6px 0;color:#4a5e7a;font-size:13px;' +
          'line-height:1.5;white-space:pre-wrap;border-radius:3px;' +
          'position:relative;cursor:not-allowed;',
      }),
      [
        'span',
        {
          style:
            'position:absolute;top:4px;right:6px;font-size:9px;' +
            'font-weight:700;letter-spacing:0.4px;text-transform:uppercase;' +
            'color:#7d8da6;',
        },
        'Locked',
      ],
      node.attrs.regionContent,
    ]
  },
})

// ── Custom Node: EditableRegion ───────────────────────────────────────────
// Wraps the user's editable paragraphs. In template mode the doc is a
// sequence of LockedRegion + EditableRegion nodes; in free-form mode the
// entire doc is implicitly one editable region (no wrapper needed).

const EditableRegion = Node.create({
  name: 'editableRegion',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      regionId: {
        default: null,
        parseHTML: el => el.getAttribute('data-region-id'),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-editable-region]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-editable-region': '',
        'data-region-id':       node.attrs.regionId,
        'class':                'leap-editable-region',
        'style':
          'background:#fbfdff;border:1px dashed #b8d8f5;' +
          'padding:8px 10px 4px;margin:6px 0;border-radius:3px;' +
          'position:relative;',
      }),
      0,  // hole: children render here
    ]
  },
})

// ── Mention configuration: merge fields ───────────────────────────────────
// The Mention extension is reused as the merge-field carrier. Trigger char
// is `{{` (two chars supported via suggestion.char). Selected items
// produce a Mention node whose renderText emits literal `{{path}}`.

function buildMergeFieldSuggestion(getFlatFieldList) {
  return {
    char: '{{',
    allowedPrefixes: null,           // allow trigger at any position
    startOfLine: false,

    items: ({ query }) => {
      // getFlatFieldList returns the cached full list. Filter by query
      // against both path and label.
      const all = getFlatFieldList() || []
      const q = (query || '').toLowerCase()
      if (!q) return all.slice(0, 12)
      return all
        .filter(f =>
          f.path.toLowerCase().includes(q) ||
          (f.label || '').toLowerCase().includes(q)
        )
        .slice(0, 12)
    },

    render: () => {
      let component
      let popup

      return {
        onStart: (props) => {
          component = new ReactRenderer(MergeFieldSuggestionList, {
            props,
            editor: props.editor,
          })
          popup = document.createElement('div')
          popup.style.position = 'fixed'
          popup.style.zIndex = '1500'
          popup.appendChild(component.element)
          document.body.appendChild(popup)
          positionPopup(popup, props.clientRect)
        },
        onUpdate: (props) => {
          component?.updateProps(props)
          positionPopup(popup, props.clientRect)
        },
        onKeyDown: (props) => {
          if (props.event.key === 'Escape') {
            popup?.remove()
            return true
          }
          return component?.ref?.onKeyDown?.(props)
        },
        onExit: () => {
          popup?.remove()
          component?.destroy()
        },
      }
    },
  }
}

function positionPopup(popup, getRect) {
  if (!popup || !getRect) return
  const rect = getRect()
  if (!rect) return
  popup.style.left = `${rect.left}px`
  popup.style.top  = `${rect.bottom + 4}px`
}

// Suggestion list ReactRenderer — keyboard-navigable popup.

const MergeFieldSuggestionList = forwardRef(function MergeFieldSuggestionList(props, ref) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const items = props.items || []

  useEffect(() => { setSelectedIdx(0) }, [items])

  const select = useCallback((idx) => {
    const item = items[idx]
    if (item) props.command({ id: item.path, label: item.label })
  }, [items, props])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') {
        setSelectedIdx(i => (i + 1) % Math.max(items.length, 1))
        return true
      }
      if (event.key === 'ArrowUp') {
        setSelectedIdx(i => (i - 1 + items.length) % Math.max(items.length, 1))
        return true
      }
      if (event.key === 'Enter') {
        select(selectedIdx)
        return true
      }
      return false
    },
  }))

  if (items.length === 0) {
    return (
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 5,
        padding: '6px 10px',
        fontSize: 12,
        color: C.textMuted,
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        minWidth: 280,
      }}>
        No merge fields matched
      </div>
    )
  }

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 5,
      boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
      maxHeight: 280,
      overflowY: 'auto',
      minWidth: 320,
      padding: 4,
    }}>
      {items.map((it, idx) => (
        <button
          key={it.path}
          onMouseDown={(e) => { e.preventDefault(); select(idx) }}
          onMouseEnter={() => setSelectedIdx(idx)}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '5px 8px',
            border: 'none',
            borderRadius: 3,
            background: idx === selectedIdx ? '#e9f4ff' : 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 12,
            color: C.textPrimary,
          }}
        >
          <div style={{ fontWeight: 500 }}>{it.label}</div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: C.textMuted,
          }}>
            {`{{${it.path}}}`}
          </div>
        </button>
      ))}
    </div>
  )
})

// ── Merge field flat-list loader ──────────────────────────────────────────
// Loads every field across every catalog object once per anchor-object
// context, caches in component state. Called lazily on first `{{` trigger.

function useMergeFieldFlatList(anchorObjectKey) {
  const [list, setList] = useState(null)

  const loadAll = useCallback(async () => {
    if (list !== null) return list
    const acc = []
    // Object groups vary by anchor — for v1 we just load every catalog
    // group; the resolver can route paths irrespective of anchor since
    // every group is reachable via the project graph.
    for (const obj of MERGE_FIELD_OBJECTS) {
      if (obj.kind === 'signing_anchor') continue   // not valid in emails
      try {
        const fields = await loadFieldsForObject(obj.key)
        for (const f of fields) {
          acc.push({
            path:  f.path,
            label: `${obj.label} · ${f.label}`,
          })
        }
      } catch {
        /* skip groups that fail to describe */
      }
    }
    setList(acc)
    return acc
  }, [list, anchorObjectKey])

  const getFlat = useCallback(() => list || [], [list])

  return { loadAll, getFlat, isLoaded: list !== null }
}

// ── Toolbar icon helpers (SVG, no emoji per platform rule) ────────────────

const ToolbarIcons = {
  bold: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M7 4h6a4 4 0 010 8H7V4zm0 8h7a4 4 0 010 8H7v-8z"
            stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  ),
  italic: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M10 4h8M6 20h8M14 4l-4 16"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  underline: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M7 4v8a5 5 0 0010 0V4M5 20h14"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  bulletList: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M9 6h11M9 12h11M9 18h11"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="5" cy="6"  r="1.4" fill="currentColor" />
      <circle cx="5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="5" cy="18" r="1.4" fill="currentColor" />
    </svg>
  ),
  orderedList: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M10 6h10M10 12h10M10 18h10"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <text x="3" y="8"  fontSize="7" fill="currentColor" fontWeight="700">1</text>
      <text x="3" y="14" fontSize="7" fill="currentColor" fontWeight="700">2</text>
      <text x="3" y="20" fontSize="7" fill="currentColor" fontWeight="700">3</text>
    </svg>
  ),
  link: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M10 14a4 4 0 005.66 0l2.83-2.83a4 4 0 00-5.66-5.66l-1.41 1.42M14 10a4 4 0 00-5.66 0l-2.83 2.83a4 4 0 005.66 5.66l1.41-1.42"
            stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  ),
  mergeField: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M8 4 4 12l4 8M16 4l4 8-4 8"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

// ── Main exported component ───────────────────────────────────────────────

const TiptapEmailComposer = forwardRef(function TiptapEmailComposer({
  mode,                  // 'free-form' | 'template'
  initialHtml,           // free-form mode: initial body html (string)
  templateLockedRegions, // template mode: jsonb array from email_templates
  placeholder,
  onChange,
  disabled = false,
}, ref) {
  // Flat merge field list (loaded lazily on first `{{` trigger).
  const { loadAll: loadMergeFields, getFlat: getMergeFieldList, isLoaded: mfLoaded } =
    useMergeFieldFlatList(/* anchorObjectKey */ null)

  // Mention extension config — uses the flat list closure so it's
  // stable across re-renders.
  const mentionConfig = useMemo(() => ({
    HTMLAttributes: { class: 'leap-merge-chip' },
    renderText:    ({ node }) => `{{${node.attrs.id}}}`,
    renderHTML:    ({ node }) => [
      'span',
      {
        'data-merge-field': node.attrs.id,
        'class':            'leap-merge-chip',
        'style':            CHIP_STYLE,
      },
      `{{${node.attrs.id}}}`,
    ],
    suggestion: buildMergeFieldSuggestion(getMergeFieldList),
  }), [getMergeFieldList])

  // Build the initial doc as a single JSON tree. Template mode emits
  // alternating locked + editable region nodes; free-form mode emits
  // a single paragraph with the initial HTML (parsed by TipTap).
  const initialContent = useMemo(() => {
    if (mode === 'template' && Array.isArray(templateLockedRegions)) {
      const sorted = [...templateLockedRegions].sort(
        (a, b) => (a.region_order ?? 0) - (b.region_order ?? 0)
      )
      const blocks = sorted.map(r => {
        if (r.region_type === 'locked') {
          return {
            type:  'lockedRegion',
            attrs: {
              regionId:      r.region_id,
              regionContent: r.region_content || '',
            },
          }
        }
        // editable region — empty paragraph inside, user types here
        return {
          type:  'editableRegion',
          attrs: { regionId: r.region_id },
          content: [
            r.region_placeholder
              ? {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '' }],
                }
              : { type: 'paragraph' },
          ],
        }
      })
      return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] }
    }
    return initialHtml || ''
  }, [mode, templateLockedRegions, initialHtml])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Avoid duplicate definitions with our explicit Link extension
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Underline,
      Placeholder.configure({
        placeholder: placeholder || 'Type your message…',
        emptyEditorClass: 'is-editor-empty',
      }),
      Mention.configure(mentionConfig),
      LockedRegion,
      EditableRegion,
    ],
    content: initialContent,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      // Eagerly load merge fields on first edit so the `{{` trigger
      // doesn't stall the first time a user uses it.
      if (!mfLoaded) loadMergeFields()
      onChange?.(editor.getHTML())
    },
    // Re-create editor when mode/template changes — avoids the
    // lifecycle-mismatch warning when switching between free-form and
    // template after a template is picked. `disabled` is deliberately NOT a
    // dep: re-creating on the submitting toggle wiped the typed body
    // mid-send (and on a failed send). It's applied via setEditable below.
    autofocus: false,
  }, [mode, JSON.stringify(templateLockedRegions || null)])

  // Toggle read-only in place instead of rebuilding the editor.
  useEffect(() => {
    if (!editor || editor.isEditable === !disabled) return
    editor.setEditable(!disabled)
  }, [editor, disabled])

  // Imperative API exposed to the modal.
  useImperativeHandle(ref, () => ({
    getHtml: () => editor?.getHTML() || '',
    getText: () => editor?.getText() || '',
    isEmpty: () => {
      const t = editor?.getText() || ''
      return t.trim().length === 0
    },
    // Template-mode: return { region_id: html } for every editable region
    // in the current doc. Renders the full HTML and walks it with DOMParser
    // — the renderHTML on EditableRegion emits identifiable wrapper divs so
    // this is straightforward and avoids any dependency on ProseMirror's
    // internal serializer API (which changed shape across TipTap versions).
    getEditableRegions: () => {
      if (!editor) return {}
      if (mode !== 'template') {
        return { __body__: editor.getHTML() }
      }
      const html = editor.getHTML()
      const out = {}
      try {
        const doc = new DOMParser().parseFromString(
          `<div id="root">${html}</div>`,
          'text/html'
        )
        const editableNodes = doc.querySelectorAll('[data-editable-region]')
        editableNodes.forEach(node => {
          const id = node.getAttribute('data-region-id')
          if (!id) return
          out[id] = node.innerHTML
        })
      } catch {
        /* leave out empty — caller will reject the send */
      }
      return out
    },
    focus: () => editor?.commands.focus(),
  }), [editor, mode])

  // Trigger merge-field list load on mount so the picker has data ready
  useEffect(() => {
    loadMergeFields()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Insert a merge field at the current selection via the toolbar button.
  // Opens a small popover anchored to the button.
  const [pickerOpen, setPickerOpen] = useState(false)

  const insertMergeField = useCallback((path) => {
    if (!editor) return
    editor
      .chain()
      .focus()
      .insertContent([
        {
          type: 'mention',
          attrs: { id: path, label: path },
        },
        { type: 'text', text: ' ' },
      ])
      .run()
    setPickerOpen(false)
  }, [editor])

  const promptLink = useCallback(() => {
    if (!editor) return
    const previous = editor.getAttributes('link')?.href || ''
    const url = window.prompt('Enter URL (leave empty to remove link):', previous)
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    let resolved = url.trim()
    if (!/^https?:\/\//i.test(resolved) && !/^mailto:/i.test(resolved)) {
      resolved = `https://${resolved}`
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: resolved }).run()
  }, [editor])

  if (!editor) {
    return (
      <div style={{ ...EDITOR_SHELL_STYLE, height: 220, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ padding: 12, color: C.textMuted, fontSize: 12 }}>Loading editor…</div>
      </div>
    )
  }

  return (
    <div style={EDITOR_SHELL_STYLE}>
      <div style={TOOLBAR_STYLE}>
        <ToolbarButton
          icon={ToolbarIcons.bold}
          title="Bold (Ctrl+B)"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          icon={ToolbarIcons.italic}
          title="Italic (Ctrl+I)"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          icon={ToolbarIcons.underline}
          title="Underline (Ctrl+U)"
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <div style={TOOLBAR_SEP} />
        <ToolbarButton
          icon={ToolbarIcons.bulletList}
          title="Bulleted list"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          icon={ToolbarIcons.orderedList}
          title="Numbered list"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          icon={ToolbarIcons.link}
          title="Link"
          active={editor.isActive('link')}
          onClick={promptLink}
        />
        <div style={TOOLBAR_SEP} />
        <button
          type="button"
          title="Insert merge field — type {{ for shortcut"
          onClick={() => setPickerOpen(true)}
          style={{
            ...TOOLBAR_BTN(false),
            padding: '4px 10px',
            fontSize: 12,
            gap: 6,
          }}
        >
          {ToolbarIcons.mergeField}
          <span style={{ fontWeight: 500 }}>Merge field</span>
        </button>
      </div>
      <EditorContent editor={editor} style={EDITOR_BODY_STYLE} />
      <style>{`
        .leap-locked-region { user-select: text; }
        .ProseMirror { outline: none; min-height: 160px; }
        .ProseMirror p.is-editor-empty:first-child::before {
          color: ${C.textMuted};
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }
        .ProseMirror ul, .ProseMirror ol { padding-left: 1.4rem; margin: 0.3rem 0; }
        .ProseMirror a { color: #2aab72; text-decoration: underline; }
        .ProseMirror .leap-merge-chip {
          display: inline-flex;
          align-items: center;
          padding: 1px 7px;
          border-radius: 10px;
          background: #e9f4ff;
          color: #0d1a2e;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          font-weight: 500;
          border: 1px solid #b8d8f5;
          line-height: 1.4;
          vertical-align: baseline;
          white-space: nowrap;
        }
      `}</style>
      {pickerOpen ? (
        <MergeFieldPickerPopover
          onPick={insertMergeField}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  )
})

function ToolbarButton({ icon, title, active, onClick }) {
  return (
    <button type="button" title={title} onClick={onClick} style={TOOLBAR_BTN(active)}>
      {icon}
    </button>
  )
}

// Full-field picker popover — fallback for users who don't know the
// `{{` trigger. Renders the same flat field list as the Mention
// suggestion, but in a modal popover with a search box.
function MergeFieldPickerPopover({ onPick, onClose }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const acc = []
      for (const obj of MERGE_FIELD_OBJECTS) {
        if (obj.kind === 'signing_anchor') continue
        try {
          const fs = await loadFieldsForObject(obj.key)
          for (const f of fs) {
            acc.push({ path: f.path, label: `${obj.label} · ${f.label}` })
          }
        } catch {
          /* skip */
        }
      }
      if (alive) setItems(acc)
    })()
    return () => { alive = false }
  }, [])

  const filtered = useMemo(() => {
    const v = (q || '').toLowerCase().trim()
    const all = items || []
    if (!v) return all.slice(0, 100)
    return all.filter(f =>
      f.path.toLowerCase().includes(v) ||
      f.label.toLowerCase().includes(v)
    ).slice(0, 100)
  }, [items, q])

  return (
    <div
      role="dialog"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(13,26,46,0.4)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '60px 16px',
      }}
    >
      <div
        style={{
          background: C.card,
          width: '100%',
          maxWidth: 480,
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 8,
          boxShadow: '0 12px 36px rgba(0,0,0,0.25)',
          border: `1px solid ${C.borderDark || C.border}`,
        }}
      >
        <div style={{
          padding: '10px 12px',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Insert merge field</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 16,
              cursor: 'pointer',
              color: C.textSecondary,
              padding: 4,
            }}
            title="Close"
          >
            ×
          </button>
        </div>
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name or object…"
            style={{
              width: '100%',
              padding: '7px 10px',
              fontSize: 13,
              border: `1px solid ${C.border}`,
              borderRadius: 5,
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
          {items === null ? (
            <div style={{ padding: 12, fontSize: 12, color: C.textMuted }}>Loading fields…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: C.textMuted }}>No fields match “{q}”.</div>
          ) : (
            filtered.map(f => (
              <button
                key={f.path}
                onMouseDown={(e) => { e.preventDefault(); onPick(f.path) }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  border: 'none',
                  borderRadius: 4,
                  background: 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 12,
                  color: C.textPrimary,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f0f4f9' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ fontWeight: 500 }}>{f.label}</div>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  color: C.textMuted,
                }}>
                  {`{{${f.path}}}`}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default TiptapEmailComposer
