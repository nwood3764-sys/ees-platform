#!/usr/bin/env node
// =============================================================================
// scripts/post-deploy-smoke.mjs
//
// Tier-3 deploy gate — the live runtime check that runtime-smoke.mjs flagged
// as roadmap. Where build:safe proves the bundle COMPILES and PARSES, this
// proves the deployed app actually RENDERS DATA: it loads the live site as an
// authenticated user and asserts every core list view returns rows with no
// console errors.
//
// This is the check that catches the failure class build:safe cannot — a list
// that renders empty, a fetch that 400s under RLS, a render crash that only
// shows up with real data. The kind of regression that otherwise gets caught
// by a human noticing "0 records" after the fact.
//
// ── How it authenticates (no UI login, no test-account creation) ─────────────
// The app uses Supabase Auth with persistSession:true, which stores the
// session in localStorage under `sb-<ref>-auth-token`. Rather than driving the
// magic-link/password login UI, this script:
//   1. Uses the Supabase service-role key (Admin API) to mint a session for an
//      EXISTING internal user — no new account, no password handling.
//   2. Injects that session into localStorage before the SPA boots.
//   3. Loads the app already-authenticated and exercises the lists.
//
// ── Required environment (secrets — never hard-coded, never in chat) ─────────
//   SMOKE_BASE_URL                 default https://ees-ops.netlify.app
//   VITE_SUPABASE_URL              the project URL (already public)
//   SUPABASE_SERVICE_ROLE_KEY      service-role key, Supabase → Settings → API
//   VITE_SUPABASE_ANON_KEY         publishable/anon key (already public)
//   SMOKE_USER_EMAIL               email of an EXISTING internal user to run as
//
// Set these as CI / Netlify environment variables. Locally, put them in a
// gitignored .env and run `node --env-file=.env scripts/post-deploy-smoke.mjs`.
//
// ── Exit code ────────────────────────────────────────────────────────────────
//   0  every checked list returned rows with no console errors
//   1  any list failed, or setup/auth failed
// =============================================================================

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const BASE_URL  = process.env.SMOKE_BASE_URL || 'https://ees-ops.netlify.app';
const SB_URL    = process.env.VITE_SUPABASE_URL;
const SB_ANON   = process.env.VITE_SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_EMAIL = process.env.SMOKE_USER_EMAIL;

// Project ref is the subdomain of the Supabase URL; localStorage auth key is
// `sb-<ref>-auth-token`. Derive it rather than hard-coding.
function projectRef(url) {
  try { return new URL(url).hostname.split('.')[0]; }
  catch { return null; }
}

// The lists to exercise. Each entry: a label, the route, and the selector/text
// signal that means "rows rendered". We assert on the visible record-count
// readout the toolbar already renders ("N records"), which is the same number
// the user sees — no dependency on internal markup.
const LISTS = [
  { label: 'Opportunities', path: '/m/outreach/opps' },
  { label: 'Accounts',      path: '/m/outreach/accounts' },
  { label: 'Properties',    path: '/m/outreach/properties' },
  { label: 'Contacts',      path: '/m/outreach/contacts' },
  { label: 'Work Orders',   path: '/m/field/workorders' },
  { label: 'Projects',      path: '/m/field/projects' },
];

function fail(msg) { console.error(`\x1b[31m${msg}\x1b[0m`); }
function ok(msg)   { console.log(`\x1b[32m${msg}\x1b[0m`); }
function dim(msg)  { console.log(`\x1b[2m${msg}\x1b[0m`); }

function requireEnv() {
  const missing = [];
  if (!SB_URL)     missing.push('VITE_SUPABASE_URL');
  if (!SB_ANON)    missing.push('VITE_SUPABASE_ANON_KEY');
  if (!SB_SERVICE) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!USER_EMAIL) missing.push('SMOKE_USER_EMAIL');
  if (missing.length) {
    // Self-skip rather than fail. This lets the script live in the repo and be
    // referenced by tooling without breaking any environment that hasn't set
    // the secrets yet (local dev, PR previews). It only does real work once the
    // service-role key + a user email are present (CI / production gate).
    dim(`post-deploy-smoke: SKIPPED — missing env: ${missing.join(', ')}`);
    dim('Set these as CI/Netlify env vars to enable the live check. See file header.');
    process.exit(0);
  }
}

// Mint a session for an existing user via the Admin API. We generate a magic
// link (type=magiclink), then exchange its token for a full session using the
// anon client's verifyOtp — yielding access + refresh tokens we can plant in
// localStorage. No password, no new account.
async function mintSession() {
  const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: USER_EMAIL,
  });
  if (error) throw new Error(`generateLink failed: ${error.message}`);

  const props = data?.properties;
  if (!props?.email_otp && !props?.hashed_token) {
    throw new Error('generateLink returned no verifiable token');
  }

  const anon = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
  const { data: sess, error: verr } = await anon.auth.verifyOtp({
    email: USER_EMAIL,
    token: props.email_otp,
    type: 'magiclink',
  });
  if (verr) throw new Error(`verifyOtp failed: ${verr.message}`);
  if (!sess?.session) throw new Error('verifyOtp returned no session');
  return sess.session; // { access_token, refresh_token, expires_at, ... }
}

async function run() {
  requireEnv();
  const ref = projectRef(SB_URL);
  if (!ref) { fail('post-deploy-smoke: could not derive project ref from VITE_SUPABASE_URL'); process.exit(1); }

  dim(`post-deploy-smoke: target ${BASE_URL}, running as ${USER_EMAIL}`);

  let session;
  try {
    session = await mintSession();
    dim('post-deploy-smoke: minted auth session via Admin API');
  } catch (e) {
    fail(`post-deploy-smoke: auth setup failed — ${e.message}`);
    process.exit(1);
  }

  // The shape supabase-js persists in localStorage. currentSession wrapper is
  // what gotrue reads back on boot.
  const storageKey = `sb-${ref}-auth-token`;
  const storageValue = JSON.stringify({
    access_token:  session.access_token,
    refresh_token: session.refresh_token,
    expires_at:    session.expires_at,
    expires_in:    session.expires_in,
    token_type:    'bearer',
    user:          session.user,
  });

  const browser = await chromium.launch();
  const ctx = await browser.newContext();

  // Plant the session before any app JS runs, for every page in this context.
  await ctx.addInitScript(([k, v]) => {
    try { window.localStorage.setItem(k, v); } catch { /* noop */ }
  }, [storageKey, storageValue]);

  const results = [];

  for (const list of LISTS) {
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => consoleErrors.push(String(e)));

    let rows = null;
    let status = 'FAIL';
    try {
      await page.goto(`${BASE_URL}${list.path}`, { waitUntil: 'networkidle', timeout: 30000 });
      // The toolbar renders "N records" once data resolves. Wait for it, then
      // read the count. We poll briefly because the count appears after the
      // async fetch settles.
      await page.waitForFunction(
        () => /\d[\d,]*\s+record/i.test(document.body.innerText),
        { timeout: 20000 }
      ).catch(() => {});
      const text = await page.evaluate(() => document.body.innerText);
      const m = text.match(/([\d,]+)\s+record/i);
      rows = m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
      if (rows != null && rows > 0 && consoleErrors.length === 0) status = 'PASS';
    } catch (e) {
      consoleErrors.push(`navigation: ${e.message}`);
    }

    results.push({ ...list, rows, status, consoleErrors });
    await page.close();
  }

  await browser.close();

  // Report
  console.log('\npost-deploy-smoke results:');
  let anyFail = false;
  for (const r of results) {
    const rowsStr = r.rows == null ? 'no count' : `${r.rows} rows`;
    if (r.status === 'PASS') {
      ok(`  PASS  ${r.label.padEnd(16)} ${rowsStr}`);
    } else {
      anyFail = true;
      fail(`  FAIL  ${r.label.padEnd(16)} ${rowsStr}`);
      for (const err of r.consoleErrors.slice(0, 3)) dim(`          ↳ ${err}`);
    }
  }

  if (anyFail) { fail('\npost-deploy-smoke FAILED'); process.exit(1); }
  ok('\npost-deploy-smoke passed');
}

run().catch(e => { fail(`post-deploy-smoke: unexpected error — ${e.message}`); process.exit(1); });
