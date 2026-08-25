import RecordLink from './RecordLink'
import { resolveRowRecordLink } from '../lib/reportRecordLinks'

/**
 * A report cell that IS a record opens it.
 *
 * Nicholas, 2026-08-25: "the property and the opportunity have to be
 * hyperlinked so we can click into them on the reports." Only the first
 * column ever linked, so a report listing a property, its building and the
 * opportunity was a dead end for two of the three.
 *
 * Three kinds of cell carry a record, and all three link:
 *   - the row's own record          (the report's primary object)
 *   - a lookup column on that row   (the record it references)
 *   - a related object's own name / record number (that related record)
 * The runner works out which, per column, and records it on the column
 * (`_link`); the viewer never guesses from the value in the cell.
 */
export function reportCellLink(row, column, primaryObject, isFirstColumn) {
  const link = resolveRowRecordLink(row, column)
  if (link) return link
  if (isFirstColumn && row?.id && primaryObject) return { table: primaryObject, id: row.id }
  return null
}

export default function ReportRecordCellLink({ link, emphasis = false, children }) {
  if (!link) return children
  return (
    <RecordLink
      table={link.table}
      id={link.id}
      title="Open record"
      onActivate={() => {
        window.history.pushState(null, '', `/${link.table}/${link.id}`)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }}
      style={{ color: '#1a5a8a', fontWeight: emphasis ? 600 : 500 }}
    >
      {children}
    </RecordLink>
  )
}
