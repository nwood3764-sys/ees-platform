import { createClient } from '@supabase/supabase-js'

// Both values must be provided via Vite env vars at build time.
// Set them in Netlify under Site settings → Environment variables:
//   VITE_SUPABASE_URL       = https://flyjigrijjjtcsvpgzvk.supabase.co
//   VITE_SUPABASE_ANON_KEY  = <publishable key from Supabase → Project Settings → API>
//
// For local development create a file at /home/claude/anura/.env.local with
// the same two variables. No fallback is hardcoded on purpose — the key
// should only live in environment variables, never in source.
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  // Surface a clear error at app start rather than letting queries fail
  // mysteriously later. The error will appear in the browser console and
  // the login screen will show a friendly message.
  console.error(
    'Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  )
}

export const supabase = createClient(url || '', key || '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

export const hasSupabaseConfig = Boolean(url && key)
