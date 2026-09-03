// ---------------------------------------------------------------------------
// owner-address-fixture — pins how the customer's mailing address is split into
// the two lines a proposal prints.
//
// The defect this exists to stop coming back: splitting at the FIRST comma.
// That is what printed
//
//     6737 W Washington Street
//     Suite 2275, West Allis, WI 53214
//
// on every proposal whose owner has a suite, and
//
//     PO BOX 304
//     WAUKESHA, WI 53187, Alexandria, VA 22314
//
// on the Sealed Project Reservation that was reported. The first-comma rule is
// carried below as a POSITIVE CONTROL: it must produce the wrong answer, so a
// regression that reintroduces it cannot pass.
// ---------------------------------------------------------------------------
import {
  splitOwnerAddress, ownerAddressFromParts, hasOwnerAddress, resolveOwnerAddress,
} from '../src/lib/ownerAddress.js'

let checks = 0
const fail = []
const eq = (label, got, want) => {
  checks += 1
  if (got !== want) fail.push(`${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
}
const split = (label, input, addr, csz) => {
  const r = splitOwnerAddress(input)
  eq(`${label} .addr`, r.addr, addr)
  eq(`${label} .csz`, r.csz, csz)
}

// --- the address most live enrollments actually carry -----------------------
split('suite line stays with the street',
  '6737 W Washington Street, Suite 2275, West Allis, WI 53214',
  '6737 W Washington Street, Suite 2275', 'West Allis, WI 53214')

// --- the reported line ------------------------------------------------------
// Genuinely corrupt source data (HUD's owner-address column holds a whole
// address, and HUD's owner city/state/zip is a DIFFERENT city). The parser
// cannot un-corrupt it, but it must put the real city/state/ZIP tail on the
// city line rather than leaving the whole remainder there.
split('the reported line',
  'PO Box 304, Waukesha, WI 53187, Alexandria, VA 22314',
  'PO Box 304, Waukesha, WI 53187', 'Alexandria, VA 22314')

// --- ordinary shapes --------------------------------------------------------
split('plain three-part address',
  '1065 Pinehurst Drive, Rocky Mount, NC 27803',
  '1065 Pinehurst Drive', 'Rocky Mount, NC 27803')
split('zip+4', '112 Owen Rd, Monona, WI 53716-1234', '112 Owen Rd', 'Monona, WI 53716-1234')
split('two-word city', '1 Lily Pad Lane, West Allis, WI 53214', '1 Lily Pad Lane', 'West Allis, WI 53214')
split('lowercase state code is raised', '9 Main St, Madison, wi 53713', '9 Main St', 'Madison, WI 53713')
split('state and zip with no city', '3625 Del Amo Boulevard, CA 90503', '3625 Del Amo Boulevard', 'CA 90503')

// --- values the parser must NOT guess at ------------------------------------
// Half an address on the wrong line is worse than one long line.
split('no recognisable tail', 'Somewhere out past the county line',
  'Somewhere out past the county line', '')
split('street only', '112 Owen Rd', '112 Owen Rd', '')
split('empty', '', '', '')
split('null', null, '', '')
split('whitespace is collapsed, not guessed', '  112   Owen Rd  ', '112 Owen Rd', '')

// --- THE POSITIVE CONTROL ---------------------------------------------------
// The rule that shipped the defect. If this ever agrees with splitOwnerAddress
// on these inputs, the first-comma split is back.
const firstComma = (full) => {
  if (!full) return { addr: '', csz: '' }
  const s = String(full).trim()
  const i = s.indexOf(',')
  if (i < 0) return { addr: s, csz: '' }
  return { addr: s.slice(0, i).trim(), csz: s.slice(i + 1).trim() }
}
for (const bad of [
  '6737 W Washington Street, Suite 2275, West Allis, WI 53214',
  'PO Box 304, Waukesha, WI 53187, Alexandria, VA 22314',
]) {
  const old = firstComma(bad)
  const now = splitOwnerAddress(bad)
  checks += 1
  if (old.csz === now.csz) {
    fail.push(`control: the first-comma split still agrees with the parser on ${JSON.stringify(bad)}`)
  }
  // and state plainly what the old rule got wrong
  eq('control keeps the suite on the city line', old.csz.startsWith('Suite 2275') || old.csz.startsWith('Waukesha'), true)
}

// --- structured parts, which is what the account gives us -------------------
{
  const r = ownerAddressFromParts({
    street: '6737 W Washington Street, Suite 2275', city: 'West Allis', state: 'wi', zip: '53214',
  })
  eq('parts .addr', r.addr, '6737 W Washington Street, Suite 2275')
  eq('parts .csz', r.csz, 'West Allis, WI 53214')
}
eq('parts with nothing', hasOwnerAddress(ownerAddressFromParts({})), false)
eq('parts with only a city', ownerAddressFromParts({ city: 'Madison' }).csz, 'Madison')

// --- the resolver: structured first, free text as the fallback --------------
{
  const account = {
    billing_street: '6737 W Washington Street', billing_city: 'West Allis',
    billing_state: 'WI', billing_zip: '53214',
  }
  const r = resolveOwnerAddress({ account, freeText: 'PO Box 304, Waukesha, WI 53187' })
  eq('the account wins over the free text', r.addr, '6737 W Washington Street')
  eq('the account wins over the free text (csz)', r.csz, 'West Allis, WI 53214')
}
{
  // An account row with an EMPTY billing address must not blank the address --
  // it falls through to mailing, then to the free text.
  const r = resolveOwnerAddress({
    account: { billing_street: null, mailing_street: '112 Owen Rd', mailing_city: 'Monona',
               mailing_state: 'WI', mailing_zip: '53716' },
    freeText: 'PO Box 304, Waukesha, WI 53187',
  })
  eq('mailing address backs up billing', r.addr, '112 Owen Rd')
  eq('mailing address backs up billing (csz)', r.csz, 'Monona, WI 53716')
}
{
  const r = resolveOwnerAddress({
    account: { billing_street: null }, freeText: 'PO Box 304, Waukesha, WI 53187',
  })
  eq('an empty account falls through to the free text', r.addr, 'PO Box 304')
  eq('an empty account falls through to the free text (csz)', r.csz, 'Waukesha, WI 53187')
}
eq('no account and no text', hasOwnerAddress(resolveOwnerAddress({})), false)

if (fail.length) {
  console.error(`owner-address-fixture: ${fail.length} of ${checks} checks failed`)
  for (const f of fail) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`owner-address-fixture: ${checks} checks passed`)
