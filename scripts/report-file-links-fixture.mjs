// Fixture test for the report's file links.
//
// Adobe Acrobat prompts before following any link out of a PDF and names the
// host (Nicholas, 2026-08-27): "This document is trying to connect to:
// flyjigrijjjtcsvpgzvk.supabase.co". A program reviewer cannot answer that
// honestly about a random project ref, so they Block and the evidence link is
// dead. Links are rewritten onto LEAP's own domain, which netlify.toml proxies
// straight back to storage.
//
// What is pinned here is the shape of that rewrite, because the failure mode is
// silent: a path that no longer matches the proxy rule returns the SPA's
// index.html with a 200, so every photo link in every filed report quietly
// serves a web page instead of a photo.
//
// Run with:  node scripts/report-file-links-fixture.mjs

import {
  proxiedStorageUrl,
  REPORT_LINK_ORIGIN,
  STORAGE_PROXY_PREFIX,
} from '../src/lib/reportFileLinks.js'
import { readFileSync } from 'node:fs'

let checks = 0, failures = 0
const check = (label, actual, expected) => {
  checks++
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) { failures++; console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`) }
}

const SIGNED = 'https://flyjigrijjjtcsvpgzvk.supabase.co/storage/v1/object/sign/'
  + 'work-evidence/work_steps/abc/originals/x.jpg?token=eyJhbGciOi.J9.sig'

// ── The rewrite ────────────────────────────────────────────────────────────
check('a signed URL moves onto LEAP\'s domain',
  proxiedStorageUrl(SIGNED),
  REPORT_LINK_ORIGIN + '/evidence/work-evidence/work_steps/abc/originals/x.jpg?token=eyJhbGciOi.J9.sig')

// The token IS the access control. Losing it turns every link into a 400.
check('the signed token survives the rewrite',
  proxiedStorageUrl(SIGNED).includes('?token=eyJhbGciOi.J9.sig'), true)
// The download filename param is what makes a saved photo identifiable.
check('a download filename param survives too',
  proxiedStorageUrl(SIGNED + '&download=Roof.jpg').endsWith('&download=Roof.jpg'), true)
check('the bucket stays the first path segment, which is what :splat feeds',
  proxiedStorageUrl(SIGNED).split('/evidence/')[1].split('/')[0], 'work-evidence')

// ── Things that must pass through untouched ────────────────────────────────
check('a non-storage URL is left alone',
  proxiedStorageUrl('https://example.com/a.jpg'), 'https://example.com/a.jpg')
check('an already-proxied URL is not rewritten twice',
  proxiedStorageUrl(proxiedStorageUrl(SIGNED)),
  proxiedStorageUrl(SIGNED))
check('a data URL is left alone',
  proxiedStorageUrl('data:image/jpeg;base64,abc'), 'data:image/jpeg;base64,abc')
check('null stays null', proxiedStorageUrl(null), null)
check('an empty string yields null, never a bare origin', proxiedStorageUrl(''), null)
check('a non-string is not coerced into a broken link', proxiedStorageUrl(42), null)
// A marker with nothing after it would produce a link to the proxy root.
check('a truncated signed URL is left alone rather than pointed at the proxy root',
  proxiedStorageUrl('https://x.supabase.co/storage/v1/object/sign/'),
  'https://x.supabase.co/storage/v1/object/sign/')
check('a trailing slash on the origin does not double up',
  proxiedStorageUrl(SIGNED, 'https://leap.example.org/'),
  'https://leap.example.org/evidence/work-evidence/work_steps/abc/originals/x.jpg?token=eyJhbGciOi.J9.sig')

// ── The proxy rule must actually exist, and above the SPA catch-all ───────
// This is the check that matters most: the rewrite is useless if netlify.toml
// does not carry the matching rule, and actively harmful if /* is matched first.
const toml = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8')
check('netlify.toml proxies the prefix this module produces',
  toml.includes(`from   = "${STORAGE_PROXY_PREFIX}*"`), true)
check('the proxy targets the storage sign endpoint with :splat',
  /to\s+=\s+"https:\/\/\S+\/storage\/v1\/object\/sign\/:splat"/.test(toml), true)
check('the proxy is a 200 rewrite, not a 301/302 to another host',
  /from\s+=\s+"\/evidence\/\*"[\s\S]{0,200}?status = 200/.test(toml), true)
check('the proxy rule is declared BEFORE the SPA catch-all',
  toml.indexOf('"/evidence/*"') < toml.indexOf('from   = "/*"'), true)

if (failures > 0) {
  console.error(`\nreport-file-links fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`report-file-links fixture: ${checks} checks passed`)
