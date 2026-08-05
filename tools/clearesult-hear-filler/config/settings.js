// Central config for the ClearResult HEAR bulk filler.
// Everything site-specific that isn't a per-field mapping lives here.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export const settings = {
  // The portal.
  baseUrl: 'https://focus-ira.clearesult.com',

  // Where a logged-in reservation is STARTED. Update once you know the real path
  // (e.g. the "Create Reservation" / new-application URL after login).
  // The runner navigates here at the start of each project.
  reservationStartUrl: 'https://focus-ira.clearesult.com/hear-for-single-family-homes',

  // Persistent browser profile — you log in ONCE (npm run login) and the session
  // (cookies/localStorage) is reused by every subsequent `inspect`/`fill` run.
  // Delete this folder to force a fresh login.
  userDataDir: path.join(ROOT, '.browser-profile'),

  // Run with a visible browser window. Keep true — you want to watch the batch,
  // clear the occasional interstitial, and it makes the address typeahead reliable.
  headless: false,

  // Slow every action down by N ms. 0 for max speed once the map is proven;
  // 150–300 while you're validating so you can see what it's doing.
  slowMo: Number(process.env.SLOW_MO ?? 120),

  // Milliseconds to wait for a selector before treating a field as missing.
  fieldTimeout: 15000,

  // Data + output paths.
  inputCsv: path.join(ROOT, 'data', 'projects.csv'),
  resultsCsv: path.join(ROOT, 'data', 'results.csv'),
  screenshotDir: path.join(ROOT, 'data', 'screenshots'),
  fieldReport: path.join(ROOT, 'data', 'field-report.json'),

  // Safety: how many to process in one run (0 = all). Handy for a first batch of 5.
  limit: Number(process.env.LIMIT ?? 0),

  // If true, fill every field but DO NOT click the final submit. Screenshots still
  // captured. Always do a dry run of your first few before a real batch.
  dryRun: process.env.DRY_RUN === '1',
};
