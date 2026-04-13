import { createClient } from '@supabase/supabase-js'

// These are injected at build time by Vite from env vars.
// Set them in Netlify under Site settings → Environment variables:
//   VITE_SUPABASE_URL        = https://flyjigrijjjtcsvpgzvk.supabase.co
//   VITE_SUPABASE_ANON_KEY   = <publishable key from Supabase → Project Settings → API>
//
// Fallbacks below let local `npm run dev` work without a .env file.
// The anon/publishable key is safe to ship in the client bundle — row-level
// security on every table enforces what it can and cannot read.
const FALLBACK_URL = 'https://flyjigrijjjtcsvpgzvk.supabase.co'
const FALLBACK_ANON_KEY = 'sb_publishable_qkmVXJMofrUrSoVA3bhZ2g_XNsdE9lq'

const url = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON_KEY

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
})
