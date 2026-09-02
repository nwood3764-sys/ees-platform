// Fixture test for signing anchors (src/lib/signingAnchors.js).
//
// Nicholas, 2026-09-02, on a work order whose Send for Signature warned "No
// signing anchors found": "Every template, you need at least one signature
// anchor. That has to be mandatory for a signature document, right?"
//
// All five of LEAP's document templates were in that state, three of them
// Active. This pins what counts as an anchor, so the send modal, the editor's
// warning and the database rule that refuses to activate a signature template
// without one all agree with the RENDERER (ANCHOR_RE in
// supabase/functions/_shared/htmlToPdf.ts). If they ever disagree, the
// platform accepts a token the PDF will not render — the same silent failure
// in a new costume.
//
// Run with: node scripts/signing-anchors-fixture.mjs

import { scanAnchors, hasSigningAnchor, signingAnchorToken } from '../src/lib/signingAnchors.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { failures += 1; console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`) }
}

// ── The four real tab types ─────────────────────────────────────────────────
check('a signature anchor counts',        hasSigningAnchor('Sign: \\sig1\\'),      true)
check('an initials anchor counts',        hasSigningAnchor('Init: \\initial1\\'),  true)
check('a date anchor counts',             hasSigningAnchor('Date: \\date1\\'),     true)
check('a text anchor counts',             hasSigningAnchor('Name: \\text1\\'),     true)

// ── The reported case ───────────────────────────────────────────────────────
// Every LEAP template body was a stub of ordinary prose with no anchor.
check('a stub body with no anchor has none',
  hasSigningAnchor('<p>Work order completion summary with photos and signatures.</p>'), false)
check('an empty body has none',   hasSigningAnchor(''),   false)
check('a null body has none',     hasSigningAnchor(null), false)
check('a non-string body has none', hasSigningAnchor(42), false)

// ── THE TRAP: the form the help text used to document ───────────────────────
// The editor's help text said `\init1\`, but the renderer only understands
// `\initial1\`. An author following the documentation would have produced a
// template that LOOKED anchored and rendered no field at all.
check('\\init1\\ is NOT an anchor — the renderer does not know it',
  hasSigningAnchor('Initials here \\init1\\'), false)
check('\\initial1\\ IS the real form',
  hasSigningAnchor('Initials here \\initial1\\'), true)

// ── The ordinal is required ─────────────────────────────────────────────────
// Without it there is nobody to attribute the signature to.
check('\\sig\\ with no ordinal is not an anchor', hasSigningAnchor('X \\sig\\ Y'), false)
check('an unknown tab type is not an anchor',     hasSigningAnchor('X \\stamp1\\ Y'), false)
check('a bare backslash pair is not an anchor',   hasSigningAnchor('C:\\\\Users\\\\'), false)

// ── Recipients and ordinals ─────────────────────────────────────────────────
{
  const scan = scanAnchors('\\sig1\\ and \\date1\\ then \\sig2\\ and \\initial2\\')
  check('counts every anchor', scan.total, 4)
  check('tracks the highest recipient ordinal', scan.maxOrdinal, 2)
  check('groups tab types by recipient 1',
    Array.from(scan.byOrdinal.get(1)).sort(), ['date', 'signature'])
  check('groups tab types by recipient 2',
    Array.from(scan.byOrdinal.get(2)).sort(), ['initial', 'signature'])
  check('"sig" is reported as the tab type "signature"',
    scan.byOrdinal.get(1).has('signature'), true)
}

// ── The token the picker writes must be one this scanner accepts ────────────
// The round trip is the point: if Insert Signature Tab wrote a token the
// scanner rejected, the author would add an anchor and still be told there are
// none.
for (const type of ['sig', 'initial', 'date', 'text']) {
  check(`the picker's ${type} token round-trips`,
    hasSigningAnchor(`Body ${signingAnchorToken(type, 1)} more`), true)
}
check('the token is padded so it measures as its own inline run',
  signingAnchorToken('sig', 1), ' \\sig1\\ ')

// ── Repeated scans do not drift ─────────────────────────────────────────────
// ANCHOR_RE is a module-level /g regex, so lastIndex must be reset per call or
// the second scan of the same body silently returns fewer anchors.
{
  const body = '\\sig1\\ \\date1\\'
  check('first scan',  scanAnchors(body).total, 2)
  check('second scan of the same body is identical', scanAnchors(body).total, 2)
  check('third scan too', scanAnchors(body).total, 2)
}

// ── POSITIVE CONTROL ────────────────────────────────────────────────────────
// The real DT-00005 body as it stood: prose promising signatures, carrying none.
check('CONTROL: the real template that raised this has no anchor',
  hasSigningAnchor('Per-work-order summary PDF with photos and signatures'), false)

console.log(`signing-anchors-fixture: ${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
