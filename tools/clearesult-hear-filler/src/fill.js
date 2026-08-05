// Step 3 — THE BULK RUNNER. Reads data/projects.csv, and for each row walks the
// multi-page reservation flow defined in config/fieldmap.js, filling every field.
//
// - Uses your saved login (persistent profile). Log in first with `npm run login`.
// - Resumable: writes data/results.csv; rows already marked "done" are skipped.
// - Screenshots every page + the confirmation to data/screenshots/<key>/.
// - `npm run fill:dry` fills everything but never clicks the final submit.
//
// Env knobs: LIMIT=5 (first 5 only), SLOW_MO=250, DRY_RUN=1.
import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { launch } from './browser.js';
import { settings } from '../config/settings.js';
import { flow } from '../config/fieldmap.js';
import { applyField } from './engine.js';

function readCsv(file) {
  if (!fs.existsSync(file)) {
    console.error(`Missing input CSV: ${file}\nCreate it (see data/projects.sample.csv).`);
    process.exit(1);
  }
  return parse(fs.readFileSync(file, 'utf8'), { columns: true, skip_empty_lines: true, trim: true });
}

function loadResults() {
  if (!fs.existsSync(settings.resultsCsv)) return new Map();
  const rows = parse(fs.readFileSync(settings.resultsCsv, 'utf8'), { columns: true, skip_empty_lines: true });
  return new Map(rows.map((r) => [r.key, r]));
}

function saveResults(map) {
  const rows = [...map.values()];
  fs.writeFileSync(settings.resultsCsv, stringify(rows, { header: true }));
}

function rowKey(row, i) {
  return row.key || row.reservation_key || row.project_number || row.enrollment_number || `row-${i + 1}`;
}

async function shot(page, key, name) {
  const dir = `${settings.screenshotDir}/${key}`;
  fs.mkdirSync(dir, { recursive: true });
  const safe = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  await page.screenshot({ path: `${dir}/${safe}.png`, fullPage: true }).catch(() => {});
}

async function doReservation(page, row, key) {
  await page.goto(flow.startUrl || settings.reservationStartUrl, { waitUntil: 'domcontentloaded' });

  for (const [p, pageDef] of flow.pages.entries()) {
    for (const field of pageDef.fields) {
      try {
        await applyField(page, field, row);
      } catch (e) {
        throw new Error(`[${pageDef.name}] field ${field.selector}: ${e.message}`);
      }
    }
    await shot(page, key, `page-${p + 1}-${pageDef.name}`);

    const isLastPage = p === flow.pages.length - 1;
    if (isLastPage) {
      if (settings.dryRun) {
        console.log(`   DRY RUN — filled ${flow.pages.length} page(s), not submitting.`);
        return { status: 'dry-run-filled' };
      }
      if (flow.submit) await page.locator(flow.submit).first().click();
    } else if (pageDef.next) {
      await page.locator(pageDef.next).first().click();
      if (pageDef.waitFor) await page.locator(pageDef.waitFor).first().waitFor({ timeout: settings.fieldTimeout });
      else await page.waitForLoadState('domcontentloaded');
    }
  }

  if (flow.successMarker) {
    await page.locator(flow.successMarker).first().waitFor({ timeout: settings.fieldTimeout });
  }
  await shot(page, key, 'confirmation');
  return { status: 'done' };
}

// ---- main ----
const rows = readCsv(settings.inputCsv);
const results = loadResults();
const { context, page } = await launch();

console.log(`Loaded ${rows.length} row(s). Already done: ${[...results.values()].filter((r) => r.status === 'done').length}.`);
if (settings.dryRun) console.log('*** DRY RUN — final submit is disabled. ***');

let processed = 0;
for (const [i, row] of rows.entries()) {
  const key = rowKey(row, i);
  const prior = results.get(key);
  if (prior && prior.status === 'done') { continue; }
  if (settings.limit && processed >= settings.limit) { console.log(`Hit LIMIT=${settings.limit}, stopping.`); break; }

  processed++;
  console.log(`\n[${processed}] ${key} …`);
  try {
    const res = await doReservation(page, row, key);
    results.set(key, { key, status: res.status, error: '', at: new Date().toISOString() });
    console.log(`   ✓ ${res.status}`);
  } catch (e) {
    await shot(page, key, 'ERROR');
    results.set(key, { key, status: 'error', error: e.message.slice(0, 300), at: new Date().toISOString() });
    console.log(`   ✗ ${e.message}`);
  }
  saveResults(results);
}

console.log(`\nDone. Results -> ${settings.resultsCsv}`);
const done = [...results.values()].filter((r) => r.status === 'done').length;
const err = [...results.values()].filter((r) => r.status === 'error').length;
console.log(`Success: ${done}  Errors: ${err}`);
await context.close();
process.exit(0);
