// ─── bookingService.js ───────────────────────────────────────────────────────
// Public-facing API wrapper for the two booking edge functions. Used only by
// the customer-facing /book/* pages; no auth required — the edge functions
// run with verify_jwt=false and protect themselves via input validation +
// territory/work_type lookups.

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const ANON_KEY      = import.meta.env.VITE_SUPABASE_ANON_KEY

async function call(name, payload) {
  let res
  try {
    res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (networkErr) {
    throw new Error(`Network error reaching ${name}. Check your connection and try again.`)
  }

  let json
  try { json = await res.json() } catch { json = null }

  if (!res.ok) {
    const message = (json && (json.message || json.error)) || `Server returned ${res.status}`
    throw new Error(message)
  }
  return json
}

export function computeAvailability({ slug, address, intake, start_date, days }) {
  return call('compute-availability', { slug, address, intake, start_date, days })
}

export function bookAppointment({
  slug, start_iso, end_iso, resource_id,
  customer_first_name, customer_last_name, phone, email, address, intake,
}) {
  return call('book-appointment', {
    slug, start_iso, end_iso, resource_id,
    customer_first_name, customer_last_name, phone, email, address, intake,
  })
}
