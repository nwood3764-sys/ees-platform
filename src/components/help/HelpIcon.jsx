import { useHelp } from './HelpProvider'

// ---------------------------------------------------------------------------
// HelpIcon — render a small `?` button next to a label, header, or field.
// Clicking it opens the help side panel filtered to the supplied anchors.
//
// Usage:
//   <HelpIcon anchors={[{ type: 'concept', concept: 'financial-tier' }]} />
//   <HelpIcon anchors={[{ type: 'route', route: '/admin/permission-sets' }]} title="Permission Sets" />
//   <HelpIcon anchors={[{ type: 'field', object: 'work_orders', field: 'work_order_status' }]} />
//
// Convenience props:
//   anchor   — single anchor spec; sugar for anchors=[…]
//   concept  — quick concept anchor: <HelpIcon concept="financial-tier" />
//   size     — px size of the icon, default 14
// ---------------------------------------------------------------------------

export default function HelpIcon({
  anchors,
  anchor,
  concept,
  title = null,
  size = 14,
  style: extraStyle,
  label = 'Help',
}) {
  const { open } = useHelp()

  const finalAnchors = (() => {
    if (Array.isArray(anchors) && anchors.length > 0) return anchors
    if (anchor) return [anchor]
    if (concept) return [{ type: 'concept', concept }]
    return []
  })()

  if (finalAnchors.length === 0) return null

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        open(finalAnchors, title)
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size + 4,
        height: size + 4,
        padding: 0,
        margin: 0,
        marginLeft: 4,
        background: 'transparent',
        border: 'none',
        borderRadius: '50%',
        cursor: 'pointer',
        color: '#8fa0b8',
        verticalAlign: 'middle',
        ...extraStyle,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = '#2aab72'
        e.currentTarget.style.background = '#f0f9f5'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = '#8fa0b8'
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </button>
  )
}
