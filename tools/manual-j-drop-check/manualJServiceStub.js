// Only the DATABASE is swapped out. The extraction — pdf.js, the layout pass
// and the parser — is the shipped code running on the real report, because that
// is half of what this check exists to prove.

export { extractManualJFromPdf, PARSER_VERSION } from '../../src/data/manualJService.js'

export const captured = { saved: null, contextCalls: 0 }

export async function fetchManualJContext() {
  captured.contextCalls += 1
  // Deliberately holds NO construction year: the review screen must then say so
  // and leave the field empty rather than inventing one.
  return {
    assessmentId: 'a0000000-0000-0000-0000-000000000001',
    propertyId: 'p0000000-0000-0000-0000-000000000001',
    buildingId: null,
    constructionYear: null,
    constructionYearSource: null,
    postalCode: null,
  }
}

export async function fetchManualJReports() { return [] }
export async function fetchManualJReportDetail() { return { blocks: [], materials: [] } }
export async function deleteManualJReport() {}

export async function saveManualJReport(args) {
  captured.saved = args
  window.__saved = {
    assessmentId: args.assessmentId,
    fileName: args.file && args.file.name,
    values: args.values,
    blockCount: args.extraction.report.blocks.length,
    materialCount: args.extraction.report.materials.length,
  }
  return 'r0000000-0000-0000-0000-000000000001'
}
