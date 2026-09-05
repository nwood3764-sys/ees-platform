// ---------------------------------------------------------------------------
// ownerAddress — how the customer's mailing address is broken into the two
// lines a proposal prints, and where it is read from.
//
// The Customer Information block on the Sealed Project Reservation printed
//
//     PO BOX 304
//     WAUKESHA, WI 53187, Alexandria, VA 22314
//
// The casing is fixed in the database (normalize_text_case).  The SPLIT was
// wrong here: enrollments.enrollment_owner_address is a single text column, and
// it was cut at the FIRST comma — street before, everything else after.  That
// is wrong for the address most live enrollments actually carry,
//
//     6737 W Washington Street, Suite 2275, West Allis, WI 53214
//
// which printed the suite on the city line.  A street line may contain commas;
// the city/state/ZIP tail may not.  So parse from the END, where the shape is
// unambiguous, and treat everything before it as the street.
//
// Reading the structured address off the account is better still, and is what
// loadEnrollmentProposalContext now does first — this parser is the fallback
// for a record whose owner address was typed or inherited as free text.
// ---------------------------------------------------------------------------

// "…, West Allis, WI 53214" / "…, West Allis, WI 53214-1234"
const CITY_STATE_ZIP = /,\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/
// A tail with no city: "…, WI 53214"
const STATE_ZIP = /,\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/

const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim()

/**
 * Split a one-line mailing address into the street line and the city/state/ZIP
 * line, reading the city/state/ZIP off the END.
 *
 * "6737 W Washington Street, Suite 2275, West Allis, WI 53214"
 *   -> { addr: "6737 W Washington Street, Suite 2275", csz: "West Allis, WI 53214" }
 *
 * A value that carries no recognisable city/state/ZIP tail is returned whole as
 * the street line rather than guessed at: half an address on the wrong line is
 * worse than one long line.
 */
export function splitOwnerAddress(full) {
  const s = clean(full)
  if (!s) return { addr: '', csz: '' }

  const m = CITY_STATE_ZIP.exec(s)
  if (m) {
    return {
      addr: s.slice(0, m.index).replace(/,\s*$/, '').trim(),
      csz: `${clean(m[1])}, ${m[2].toUpperCase()} ${m[3]}`,
    }
  }
  const sz = STATE_ZIP.exec(s)
  if (sz) {
    return {
      addr: s.slice(0, sz.index).replace(/,\s*$/, '').trim(),
      csz: `${sz[1].toUpperCase()} ${sz[2]}`,
    }
  }
  return { addr: s, csz: '' }
}

/**
 * The same two lines, built from an account's STRUCTURED billing address.
 * Preferred over parsing free text wherever the account is resolvable — there
 * is nothing to guess when the parts are already separate columns.
 */
export function ownerAddressFromParts({ street, city, state, zip } = {}) {
  const addr = clean(street)
  const csz = [clean(city), [clean(state).toUpperCase(), clean(zip)].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ')
  return { addr, csz }
}

/** Is there anything to print? */
export function hasOwnerAddress(a) {
  return Boolean(a && (a.addr || a.csz))
}

/**
 * The customer's address for a proposal: the owner account's structured
 * billing address when there is one, otherwise the record's free-text column
 * parsed from the end.  Kept here rather than in each programme's service so
 * the HOMES and HEAR documents cannot drift apart on it.
 */
export function resolveOwnerAddress({ account, freeText } = {}) {
  if (account) {
    const parts = ownerAddressFromParts({
      street: account.billing_street, city: account.billing_city,
      state: account.billing_state, zip: account.billing_zip,
    })
    if (hasOwnerAddress(parts)) return parts
    const mailing = ownerAddressFromParts({
      street: account.mailing_street, city: account.mailing_city,
      state: account.mailing_state, zip: account.mailing_zip,
    })
    if (hasOwnerAddress(mailing)) return mailing
  }
  return splitOwnerAddress(freeText)
}
