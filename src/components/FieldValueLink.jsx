import { resolveFieldLink, isLinkableFieldType } from '../lib/fieldLinks'

// ---------------------------------------------------------------------------
// FieldValueLink — render a field value as the action it represents.
//
// A phone number, an email address, and a website are not strings: clicking one
// should dial (handing off to whatever the device registered as its phone
// handler — Teams, a softphone, the mobile dialer), open a mail composer, or
// open the site. This renders those as real anchors, so the browser's own
// affordances (open in a new tab, copy link address, long-press on mobile) all
// work, and every surface that shows a field value behaves the same way.
//
// resolveFieldLink returns null for a value that isn't actually actionable — a
// note in a phone column, a storage key in a url column, two numbers in one
// field — and those fall back to plain text rather than a dead link.
//
// stopPropagation matters inside a clickable row (a list view, a related list):
// clicking the phone number should place the call, not open the record.
// ---------------------------------------------------------------------------
export default function FieldValueLink({ type, raw, display, style, label }) {
  const link = isLinkableFieldType(type) ? resolveFieldLink(type, raw, { label }) : null
  if (!link) return <span style={style}>{display}</span>
  return (
    <a
      href={link.href}
      title={link.title}
      target={link.newTab ? '_blank' : undefined}
      rel={link.newTab ? 'noopener noreferrer' : undefined}
      onClick={(e) => e.stopPropagation()}
      style={{
        ...style,
        color: '#1a5a8a',
        textDecoration: 'underline',
        textUnderlineOffset: 2,
      }}
    >
      {display}
    </a>
  )
}
