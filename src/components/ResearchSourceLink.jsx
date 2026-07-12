import { C } from '../data/constants'

// ---------------------------------------------------------------------------
// ResearchSourceLink — evidence-link chip for owner research findings.
//
// Research evidence used to render as opaque "Source 1 ↗" links; the reviewer
// had to click to learn where a claim came from. This chip previews the
// source in place: site favicon + the page title when research captured one
// (edge fn v16+ returns {url, title} objects), else the domain. The full URL
// shows on hover. Tolerant of both shapes — older candidates store plain URL
// strings.
// ---------------------------------------------------------------------------

export function isSourceEntry(entry) {
  return typeof entry === 'string'
    || (entry && typeof entry === 'object' && typeof entry.url === 'string')
}

export default function ResearchSourceLink({ source, index = 0 }) {
  const url = typeof source === 'string' ? source : source?.url
  if (!url || typeof url !== 'string') return null
  const title = (source && typeof source === 'object' && source.title) ? String(source.title).trim() : null
  let domain = null
  try { domain = new URL(url).hostname.replace(/^www\./i, '') } catch { /* label falls back below */ }
  const label = title
    ? (title.length > 52 ? `${title.slice(0, 49)}…` : title)
    : (domain || `Source ${index + 1}`)
  return (
    <a
      href={url} target="_blank" rel="noreferrer" title={url}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 11.5, color: C.sky, textDecoration: 'none',
        background: 'rgba(126,179,232,0.08)', border: '1px solid rgba(126,179,232,0.35)',
        borderRadius: 4, padding: '2px 8px', maxWidth: '100%',
      }}>
      {domain && (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16`}
          alt="" width={13} height={13} style={{ borderRadius: 2, flexShrink: 0 }}
          onError={e => { e.currentTarget.style.display = 'none' }}
        />
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {title && domain && (
        <span style={{ color: C.textMuted, whiteSpace: 'nowrap' }}>· {domain}</span>
      )}
      <span style={{ flexShrink: 0 }}>↗</span>
    </a>
  )
}
