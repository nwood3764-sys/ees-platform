// ---------------------------------------------------------------------------
// Tiny dependency-free markdown renderer for help articles.
//
// We only support the subset we actually author in help bodies:
//   • Headings    (## Header, ### Subheader)
//   • Paragraphs  (blank-line separated)
//   • Bold / italic / inline code
//   • Bulleted lists (- item)
//   • Numbered lists (1. item)
//   • Links        ([text](url))
//   • Fenced code  (```...```)
//
// Anything else is escaped and rendered as plain text. Importing a real
// markdown library would balloon the bundle — keeping this in-tree means
// help content travels with the app for free.
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Inline transforms run on already-escaped text. Order matters — code spans
// first so we don't try to bold inside them.
function applyInline(html) {
  // Inline code (escape inside)
  html = html.replace(/`([^`]+)`/g, (_, code) =>
    `<code style="font-family:'JetBrains Mono',monospace;font-size:0.9em;background:#f0f3f8;padding:1px 5px;border-radius:3px;">${code}</code>`)

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const safe = url.replace(/"/g, '&quot;')
    return `<a href="${safe}" target="_blank" rel="noopener" style="color:#2aab72;text-decoration:underline;">${text}</a>`
  })

  // Bold then italic (bold double-underscore handled by the same rule via **).
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>')

  return html
}

export function renderMarkdown(src) {
  if (!src) return ''
  const out = []

  // Pull out fenced code blocks first so their contents stay verbatim.
  const codeBlocks = []
  src = String(src).replace(/```([\s\S]*?)```/g, (_, body) => {
    codeBlocks.push(body)
    return `\u0000CODE${codeBlocks.length - 1}\u0000`
  })

  const lines = src.split(/\r?\n/)
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Code block placeholder
    const codeMatch = line.match(/^\u0000CODE(\d+)\u0000$/)
    if (codeMatch) {
      const body = codeBlocks[Number(codeMatch[1])] || ''
      out.push(
        `<pre style="background:#0d1a2e;color:#dfe6f3;padding:10px 12px;border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:11.5px;overflow:auto;margin:10px 0;line-height:1.5;">${escapeHtml(body.replace(/^\n/, '').replace(/\n$/, ''))}</pre>`
      )
      i++
      continue
    }

    // Headings
    const h3 = line.match(/^###\s+(.+)$/)
    if (h3) {
      out.push(`<h3 style="font-size:13px;font-weight:600;color:#0d1a2e;margin:14px 0 4px;">${applyInline(escapeHtml(h3[1]))}</h3>`)
      i++; continue
    }
    const h2 = line.match(/^##\s+(.+)$/)
    if (h2) {
      out.push(`<h2 style="font-size:14.5px;font-weight:700;color:#0d1a2e;margin:18px 0 6px;">${applyInline(escapeHtml(h2[1]))}</h2>`)
      i++; continue
    }

    // Bulleted list
    if (/^\s*[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      out.push(`<ul style="margin:8px 0;padding-left:20px;">${items.map(it =>
        `<li style="margin-bottom:4px;line-height:1.55;">${applyInline(escapeHtml(it))}</li>`).join('')}</ul>`)
      continue
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      out.push(`<ol style="margin:8px 0;padding-left:22px;">${items.map(it =>
        `<li style="margin-bottom:4px;line-height:1.55;">${applyInline(escapeHtml(it))}</li>`).join('')}</ol>`)
      continue
    }

    // Blank line — separates paragraphs
    if (line.trim() === '') { i++; continue }

    // Paragraph — collect until blank, heading, list, or code block
    const para = []
    while (i < lines.length
        && lines[i].trim() !== ''
        && !/^##\s+/.test(lines[i])
        && !/^###\s+/.test(lines[i])
        && !/^\s*[-*]\s+/.test(lines[i])
        && !/^\s*\d+\.\s+/.test(lines[i])
        && !/^\u0000CODE\d+\u0000$/.test(lines[i])) {
      para.push(lines[i])
      i++
    }
    out.push(`<p style="margin:8px 0;line-height:1.6;color:#0d1a2e;">${applyInline(escapeHtml(para.join(' ')))}</p>`)
  }

  return out.join('\n')
}
