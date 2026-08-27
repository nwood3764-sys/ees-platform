// ---------------------------------------------------------------------------
// reportInclusion — which objects actually READ the "Include in report" flag.
//
// The flag is a curation marker: a person ticks the photos and documents that
// belong in a record's deliverable once, and the report reads the flag instead
// of asking them to re-pick on every generation.
//
// That only means something where a report exists to read it. When the flag
// was generalised from photos to documents (2026-08-27) the control was not
// scoped, so it appeared on every documents gallery on the platform — a
// property's, an account's, and the one added to enrollments the same morning
// — where nothing consumed it. Nicholas found it on an enrollment and asked,
// reasonably, what report it was for. There wasn't one: 67 documents across
// six typed slots, zero flagged, no consumer.
//
// A control that writes a value nothing reads is worse than a missing one: it
// invites somebody to curate a deliverable that will never be produced. So the
// gallery asks HERE whether this record's object has a report, and only offers
// the flag when the answer is yes.
// ---------------------------------------------------------------------------

import { hasSubmissionReport } from './enrollmentSubmissionReport.js'

/**
 * True when a record on this object has a report that reads the flag.
 *
 *   · work_orders — the Energy Assessment Report reads flagged photos, and its
 *     generate dialog preselects the flagged documents. Every work order's
 *     gallery offers it: which work orders have a report depends on the record
 *     type, and the gallery does not know it. Offering the flag on a work order
 *     with no report yet is the harmless direction — the curation is still
 *     about that work order's own deliverable.
 *   · enrollments — the Enrollment Submission Record reads flagged documents
 *     as the statement of what was filed.
 *
 * Everything else (properties, accounts, projects, opportunities, buildings)
 * has no report reading the flag, so the control is not shown there.
 */
export function objectHasReportInclusion(tableName) {
  if (!tableName) return false
  if (tableName === 'work_orders') return true
  return hasSubmissionReport(tableName)
}
