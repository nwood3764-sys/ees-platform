// Fixture test for clickable contact-method fields.
//
// The rule everything rests on: a phone / email / website field value becomes a
// real link ONLY when it's actually dialable, mailable, or browsable — and a
// value that isn't (a storage path, a note, two numbers in one field) stays
// plain text. Run with:
//   node scripts/field-links-fixture.mjs
//
// Cases are drawn from live LEAP data (Nicholas, 2026-08-22: the property page's
// Website rendered as dead text on PROP-00506).

import {
  resolveFieldLink, emailHref, phoneHref, urlHref, formatUsPhoneDisplay,
} from '../src/lib/fieldLinks.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures += 1
    console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`)
  }
}

// ── Websites ────────────────────────────────────────────────────────────────
check('url: full https URL passes through',
  urlHref('https://www.rm-ha.org/locations/detail/3478'), 'https://www.rm-ha.org/locations/detail/3478')
check('url: http is allowed', urlHref('http://example.org/x'), 'http://example.org/x')
check('url: bare host gets https', urlHref('jesholdings.com'), 'https://jesholdings.com/')
check('url: www host with path gets https', urlHref('www.rm-ha.org/locations'), 'https://www.rm-ha.org/locations')
check('url: surrounding whitespace trimmed', urlHref('  example.com  '), 'https://example.com/')
check('url: javascript: is never linked', urlHref('javascript:alert(1)'), null)
check('url: data: is never linked', urlHref('data:text/html,<script>x</script>'), null)
check('url: file: is never linked', urlHref('file:///etc/passwd'), null)
check('url: storage path is not a link', urlHref('work-evidence/2f/9a1c.jpg'), null)
check('url: bare filename is not a link', urlHref('scope-of-work.pdf'), null)
check('url: filename host with a path is not a link', urlHref('photo.jpg/thumb'), null)
check('url: prose is not a link', urlHref('see the owner portal'), null)
check('url: single-label host is not a link', urlHref('intranet'), null)
check('url: empty is not a link', urlHref(''), null)

// ── Phones ──────────────────────────────────────────────────────────────────
check('phone: bare 10 digits dials as US', phoneHref('7048751634'), 'tel:+17048751634')
check('phone: formatted US number', phoneHref('(203) 240-9847'), 'tel:+12032409847')
check('phone: 1-prefixed 11 digits', phoneHref('1-608-555-1212'), 'tel:+16085551212')
check('phone: already E.164', phoneHref('+16085551212'), 'tel:+16085551212')
check('phone: international with +', phoneHref('+44 20 7946 0958'), 'tel:+442079460958')
check('phone: extension is preserved', phoneHref('608-555-1212 ext 214'), 'tel:+16085551212;ext=214')
check('phone: x-style extension', phoneHref('(608) 555-1212 x7'), 'tel:+16085551212;ext=7')
check('phone: #-style extension', phoneHref('6085551212 #33'), 'tel:+16085551212;ext=33')
check('phone: 7-digit local dials as typed', phoneHref('555-1212'), 'tel:5551212')
check('phone: two numbers in one field stay text', phoneHref('555-1212 / 555-1213'), null)
check('phone: "or" between numbers stays text', phoneHref('6085551212 or 6085551213'), null)
check('phone: prose stays text', phoneHref('call the site office'), null)
check('phone: too few digits stays text', phoneHref('411'), null)
check('phone: empty stays text', phoneHref(''), null)

check('phone display: 10 digits', formatUsPhoneDisplay('7048751634'), '(704) 875-1634')
check('phone display: 11 digits', formatUsPhoneDisplay('17048751634'), '(704) 875-1634')
check('phone display: unrecognized is untouched', formatUsPhoneDisplay('+44 20 7946 0958'), '+44 20 7946 0958')

// ── Emails ──────────────────────────────────────────────────────────────────
check('email: plain address', emailHref('deer-hill@cmc-nc.com'), 'mailto:deer-hill@cmc-nc.com')
check('email: plus-addressing', emailHref('ap+leap@ees-wi.org'), 'mailto:ap+leap@ees-wi.org')
check('email: trimmed', emailHref('  nicholas.wood@ees-wi.org '), 'mailto:nicholas.wood@ees-wi.org')
check('email: two addresses stay text', emailHref('a@x.com, b@x.com'), null)
check('email: no domain dot stays text', emailHref('someone@localhost'), null)
check('email: prose stays text', emailHref('ask the property manager'), null)
check('email: display name form stays text', emailHref('Jane <jane@x.com>'), null)

// ── Resolver ────────────────────────────────────────────────────────────────
check('resolve: non-linkable type is never a link', resolveFieldLink('text', 'https://example.com'), null)
check('resolve: null value', resolveFieldLink('email', null), null)
check('resolve: website opens in a new tab',
  resolveFieldLink('url', 'https://example.com/a'),
  { href: 'https://example.com/a', kind: 'url', newTab: true, title: 'Open https://example.com/a in a new tab' })
check('resolve: email stays in place',
  resolveFieldLink('email', 'jane@x.com'),
  { href: 'mailto:jane@x.com', kind: 'email', newTab: false, title: 'Email jane@x.com' })
check('resolve: phone title shows the formatted number',
  resolveFieldLink('phone', '7048751634'),
  { href: 'tel:+17048751634', kind: 'phone', newTab: false, title: 'Call (704) 875-1634' })
check('resolve: label is folded into the website tooltip',
  resolveFieldLink('url', 'example.com', { label: 'Website' }).title,
  'Open Website — example.com in a new tab')

console.log(failures === 0
  ? `field-links fixture: ${checks} checks passed`
  : `field-links fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
