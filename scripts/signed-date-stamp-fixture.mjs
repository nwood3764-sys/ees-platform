// =============================================================================
// signed-date-stamp-fixture — the signing date is stamped, never typed.
//
// Nicholas, 2026-09-05: "the date and time need to be automatic. The user
// shouldn't have to click that. It should just be like DocuSign." Then: "the
// date and time should automatically be appended to the signature."
//
// It used to be a field the signer clicked, seeded in the BROWSER at page
// load. Three defects, and only the first is the one he saw:
//
//   1. It asked the signer to do the system's job.
//   2. The value was set when the PAGE OPENED, not when they signed. Open the
//      link Friday and sign Monday and the document said Friday.
//   3. `new Date().toISOString().slice(0,10)` is UTC. After 7pm in Wisconsin
//      that is already TOMORROW, so a signed document could carry a date the
//      signer had not reached.
//
// Source-text checks: the modules are an edge function (Deno) and a React page.
// What must not regress is structural, and the behaviour that needs a browser
// is verified by npm run verify:signing-tab-click.
// =============================================================================

import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const check = (n, ok) => { ok ? (pass++, console.log(`PASS  ${n}`)) : (fail++, console.log(`FAIL  ${n}`)) }

// COMMENTS ARE STRIPPED BEFORE ANYTHING IS MATCHED, and that is not tidiness.
// The first run of this fixture reported three failures that were all its own
// prose: the comments explaining the UTC bug and the invalid Intl spelling
// quote both verbatim, so a check asserting "that spelling is gone" matched
// the sentence saying it was gone. A source-text check that reads comments is
// a check that fails when the code is right and passes when a comment is
// deleted -- exactly backwards.
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/^\s*\/\/.*$/gm, ' ')        // whole-line // comments
    .replace(/([^:'"\`])\/\/.*$/gm, '$1')  // trailing //, sparing a URL's //
}

const server = code(readFileSync(new URL('../supabase/functions/signing-portal-submit/index.ts', import.meta.url), 'utf8'))
const client = code(readFileSync(new URL('../src/pages/SigningPortal.jsx', import.meta.url), 'utf8'))

// The stripper must actually strip, or every check below is meaningless.
const rawClient = readFileSync(new URL('../src/pages/SigningPortal.jsx', import.meta.url), 'utf8')
// A phrase that exists ONLY in prose, so the control tests the stripper rather
// than the code. Picking a pattern that also appears in code is how the first
// version of this control failed while the stripper was working perfectly.
check('CONTROL: the comment stripper removes prose the checks would match',
  /Just like DocuSign|stamped by the server/.test(rawClient)
  && !/Just like DocuSign|stamped by the server/.test(client))

// ── The browser no longer decides the signing date ─────────────────────────
check('the client no longer seeds a date at page load',
  !/t\.type === 'date'\) initial\[t\.id\]/.test(client))
check('the UTC slice that could stamp tomorrow is gone',
  !/toISOString\(\)\.slice\(0, ?10\)/.test(client))
check('a date tab is not sent as a client value',
  /\.filter\(t => t\.type !== 'date'\)/.test(client))
check('the signer\'s time zone is sent so the stamp reads locally',
  /signer_timezone:/.test(client) && /resolvedOptions\(\)\.timeZone/.test(client))

// ── It is not a field the signer must complete ─────────────────────────────
check('a date tab is excluded from "still to complete"',
  /t\.type !== 'date' && !tabValues\[t\.id\]/.test(client))
check('a date tab has no click handler',
  /onClick=\{isAuto \? undefined :/.test(client))
check('a date tab shows no pointer',
  /cursor: isAuto \? 'default'/.test(client))
check('a date tab is marked in the DOM so a browser check can see it',
  /data-signing-tab-auto=/.test(client))

// ── The server is the authority ────────────────────────────────────────────
check('the server stamps every date tab for the signer',
  /picklist_value !== "date"\) continue/.test(server))
check('the stamp ignores whatever the client sent',
  /tab_filled_value: signedStampText\(signedAt, signerZone\)/.test(server))
check('one instant is used for the whole submission',
  /const signedAt = new Date\(\)/.test(server))
check('the zone is validated, never trusted',
  /function resolveTimeZone/.test(server) && /catch \{ return "UTC" \}/.test(server))
check('an unusable zone falls back to UTC, never to a guessed one',
  /if \(!name\) return "UTC"/.test(server))

// THE BUG THE BROWSER CAUGHT, pinned so it cannot come back in either place.
// dateStyle/timeStyle cannot be combined with timeZoneName -- it throws, and
// both spellings looked entirely reasonable while doing so.
check('the server does not combine dateStyle with timeZoneName',
  !/dateStyle[\s\S]{0,80}timeZoneName/.test(server))
check('the client preview does not combine dateStyle with timeZoneName',
  !/dateStyle[\s\S]{0,80}timeZoneName/.test(client))
check('the server names the zone on the stamp',
  /timeZoneName: "short"/.test(server))
check('the stamp carries a time, not just a date',
  /hour: "numeric", minute: "2-digit"/.test(server))

// That spelling really does throw — asserted rather than asserted-about, so
// the two checks above are known to be guarding something real.
let threw = false
try { new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZoneName: 'short' }) }
catch { threw = true }
check('CONTROL: dateStyle + timeZoneName really is invalid', threw === true)
check('CONTROL: the explicit-component form really works',
  /\d{4}.*(AM|PM)/.test(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(Date.UTC(2026, 8, 5, 20, 54)))))

// ── A signature is never undated ───────────────────────────────────────────
check('a signer with no date tab gets the stamp under the signature',
  /signersWithADate/.test(server) && /`Signed \$\{stamp\}`/.test(server))
check('a signer who HAS a date tab gets nothing drawn under the signature',
  /!signersWithADate\.has/.test(server))

// ── Documents signed before this change still print as they did ────────────
check('a bare ISO date is still formatted the old way',
  /function renderDateTabValue/.test(server) && /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(server))
check('a composed stamp is drawn verbatim, not re-parsed',
  /renderDateTabValue\(t\.tab_filled_value\)/.test(server))
check('the stamp is shrunk to fit rather than overflowing the tab',
  /widthOfTextAtSize\(dateText, dateSize\) > w - 8/.test(server))

console.log(`signed-date-stamp-fixture: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`)
if (fail) process.exit(1)
