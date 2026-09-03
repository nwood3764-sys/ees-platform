// ---------------------------------------------------------------------------
// supplementalDataSheetWorkbook — filling the programme administrator's own
// workbook by cell surgery.
//
// Separated from the service so it can be exercised in Node: the service
// imports the Supabase client, which cannot load outside a browser, and this is
// the half of the work that most needs a test — a fill that silently writes
// nothing produces a workbook that opens cleanly and reports no units.
//
// The template zip is copied and individual <c> elements are rewritten in
// place, exactly as paperworkModel.fillPaperworkWorkbook does for the invoice
// workbook. Every style, column width, merge, print setting and — the one that
// matters here — the Measure Type data validation bound to
// 'Data Validation'!$B$3:$B$12 survives byte for byte, because none of it is
// ever parsed. Rebuilding the sheet with the xlsx library (the Tenant Data
// Sheet's approach in incomeQualificationService) would drop the validation
// silently: the file would open, look right, and no longer be their form.
//
// See scripts/ventilation-supplemental-data-sheet-fixture.mjs, which fills the
// REAL shipped template and reads every cell back out.
// ---------------------------------------------------------------------------

import {
  SHEET_COLUMNS,
  FIRST_DATA_ROW,
  LAST_TEMPLATE_ROW,
} from './ventilationSupplementalDataSheet.js'

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Write a literal into an existing cell, preserving its style attribute.
 *
 * Numbers are written as <v>, everything else as an inline string. Inline
 * strings are used rather than the shared-string table so the fill never has to
 * rewrite sharedStrings.xml and renumber every other reference in the workbook
 * — one wrong index there silently relabels a header.
 *
 * The template defines every cell from row 7 to row 549, so the "cell is
 * absent" branch fillPaperworkWorkbook needs is not reachable here; a ref that
 * does not match is returned unchanged and caught by the assertion in
 * fillSupplementalDataSheet rather than silently doing nothing.
 */
function setCell(xml, ref, value) {
  const isNum = typeof value === 'number' && Number.isFinite(value)
  const body = isNum
    ? `<v>${value}</v>`
    : (value === '' || value == null ? '' : `<is><t xml:space="preserve">${xmlEscape(value)}</t></is>`)
  const typeAttr = isNum || body === '' ? '' : ' t="inlineStr"'
  const re = new RegExp(`<c r="${ref}"([^>]*?)(/>|>[\\s\\S]*?</c>)`)
  if (!re.test(xml)) return { xml, written: false }
  return {
    xml: xml.replace(re, (_m, attrs) => {
      const style = (attrs.match(/ s="\d+"/) || [''])[0]
      return body === ''
        ? `<c r="${ref}"${style}/>`
        : `<c r="${ref}"${style}${typeAttr}>${body}</c>`
    }),
    written: true,
  }
}

/**
 * A Zip Code that is all digits is written as a NUMBER, matching the filled
 * example the administrator supplied (53190, not "53190"). A ZIP with a leading
 * zero or a +4 must stay text — 07030 written as a number becomes 7030, which
 * is a different place.
 */
function zipValue(zip) {
  const s = String(zip ?? '').trim()
  return /^[1-9]\d{4}$/.test(s) ? Number(s) : s
}

/**
 * Unit Number likewise: numeric doors as numbers (the example writes 1..8),
 * anything else as text.
 */
function unitNumberValue(n) {
  const s = String(n ?? '').trim()
  return /^\d+$/.test(s) ? Number(s) : s
}

/**
 * Fill the template with the rows and return a Blob.
 *
 * Takes the template as an ArrayBuffer so the caller owns where it comes from
 * — fetched from the app asset in the browser, read from disk in the fixture.
 */
export async function fillSupplementalDataSheet(rows, templateArrayBuffer, { outputType = 'blob' } = {}) {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(templateArrayBuffer)
  const sheetPath = 'xl/worksheets/sheet1.xml'
  let xml = await zip.file(sheetPath).async('string')

  // Guard the template itself. If a revision renames or reorders a column, the
  // fill would put the model number under "Serial Number" and nobody would know
  // until the administrator queried it.
  for (const c of SHEET_COLUMNS) {
    const headerRe = new RegExp(`<c r="${c.col}6"`)
    if (!headerRe.test(xml)) {
      throw new Error(`The supplemental data sheet template has no header cell at ${c.col}6. The template may have been replaced with a different revision.`)
    }
  }

  const valueFor = (row, key) => {
    if (key === 'zipCode') return zipValue(row.zipCode)
    if (key === 'unitNumber') return unitNumberValue(row.unitNumber)
    return row[key] ?? ''
  }

  // Write the rows, then blank every remaining template row. Blanking matters
  // on a REGENERATE against a template that already holds a longer previous
  // run's rows — without it, shrinking a building from 11 units to 8 would
  // leave units 9, 10 and 11 on the filed sheet.
  let rowIndex = FIRST_DATA_ROW
  for (const row of rows) {
    for (const c of SHEET_COLUMNS) {
      const res = setCell(xml, `${c.col}${rowIndex}`, valueFor(row, c.key))
      if (!res.written) {
        throw new Error(`The template has no cell at ${c.col}${rowIndex}; it defines rows ${FIRST_DATA_ROW}–${LAST_TEMPLATE_ROW}.`)
      }
      xml = res.xml
    }
    rowIndex++
  }
  for (; rowIndex <= LAST_TEMPLATE_ROW; rowIndex++) {
    for (const c of SHEET_COLUMNS) {
      xml = setCell(xml, `${c.col}${rowIndex}`, '').xml
    }
  }

  zip.file(sheetPath, xml)
  // 'blob' in the browser, 'uint8array' in Node — JSZip has no Blob there, and
  // the fixture needs the bytes back to read the workbook it just wrote.
  return outputType === 'blob'
    ? zip.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    : zip.generateAsync({ type: outputType })
}

