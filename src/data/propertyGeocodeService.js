import { supabase } from '../lib/supabase'

// =====================================================================
// propertyGeocodeService
//
// On-demand geocoding for a single property, used by the record-page Map
// card when a property has no stored coordinates yet. Calls the
// `geocode-property-coordinates` edge function on its caller-JWT path
// (a single property_id, authorized by the signed-in user's session and
// RLS), so a freshly created property is pinned immediately instead of
// waiting for the 15-minute background cron sweep.
//
// Returns a normalized result the widget renders directly:
//   { matched: true,  lat, lng }                — geocoded (or already had coords)
//   { matched: false, status, reason? }         — geocoder found no match
//   { matched: false, error }                   — request/geocoder failure
// =====================================================================

export async function geocodePropertyNow(propertyId) {
  if (!propertyId) return { matched: false, error: 'No property id provided.' }

  const { data, error } = await supabase.functions.invoke('geocode-property-coordinates', {
    body: { property_id: propertyId },
  })

  if (error) {
    // functions.invoke surfaces non-2xx as an error; try to read the body.
    let message = error.message || 'Geocoding request failed.'
    try {
      const parsed = await error.context?.json?.()
      if (parsed?.error) message = parsed.error
    } catch { /* ignore — fall back to the generic message */ }
    return { matched: false, error: message }
  }

  if (data?.matched) {
    return { matched: true, lat: Number(data.lat), lng: Number(data.lng) }
  }
  return { matched: false, status: data?.status || 'Geocode No Match', reason: data?.reason }
}
