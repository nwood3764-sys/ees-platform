// Step 2 — CAPTURE THE FORM. The most important tool here.
// With your saved session, navigate to a reservation page and this dumps EVERY
// form control on it: label, name, id, type, and (for selects) the option list.
//
// Usage:
//   npm run inspect                 -> opens reservationStartUrl, waits for you to
//                                      navigate to the exact page, then Enter to dump
//   npm run inspect -- <url>        -> opens that URL directly
//
// Output: pretty console table + data/field-report.json (append-per-page).
// Send me field-report.json and I build the LEAP enrollment fields + the fieldmap.
import fs from 'node:fs';
import readline from 'node:readline';
import { launch } from './browser.js';
import { settings } from '../config/settings.js';

const urlArg = process.argv[2];
const { context, page } = await launch();
await page.goto(urlArg || settings.reservationStartUrl, { waitUntil: 'domcontentloaded' });

console.log('\n=== Field inspector ===');
console.log('Navigate to the exact reservation page you want to capture.');
console.log('When it is on screen, come back and press Enter.\n');

await new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Press Enter to capture the current page... ', () => { rl.close(); resolve(); });
});

const fields = await page.evaluate(() => {
  const labelFor = (el) => {
    // 1) <label for=id>
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && l.textContent.trim()) return l.textContent.trim();
    }
    // 2) wrapping <label>
    const wrap = el.closest('label');
    if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
    // 3) aria-label / aria-labelledby / placeholder / preceding label-ish text
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
      if (t) return t;
    }
    if (el.placeholder) return `(placeholder) ${el.placeholder.trim()}`;
    // 4) nearest preceding label/th/legend text within the same field group
    const grp = el.closest('.field, .form-group, .control-group, td, li, div');
    const lab = grp?.querySelector('label, .label, legend, th');
    if (lab && lab.textContent.trim()) return lab.textContent.trim();
    return '';
  };

  const controls = [...document.querySelectorAll('input, select, textarea')];
  return controls
    .filter((el) => !['hidden'].includes(el.type))
    .map((el, i) => {
      const rec = {
        index: i,
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        name: el.name || '',
        id: el.id || '',
        label: labelFor(el).replace(/\s+/g, ' ').slice(0, 120),
        required: el.required || el.getAttribute('aria-required') === 'true',
        placeholder: el.placeholder || '',
        cssSuggestion: el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : '',
      };
      if (el.tagName.toLowerCase() === 'select') {
        rec.options = [...el.options].map((o) => ({ value: o.value, text: o.text.trim() })).slice(0, 60);
      }
      return rec;
    });
});

// Console summary.
console.log(`\nCaptured ${fields.length} field(s) on ${page.url()}\n`);
for (const f of fields) {
  const req = f.required ? ' *' : '';
  console.log(`[${String(f.index).padStart(2)}] ${f.tag}/${f.type}${req}  ${f.cssSuggestion || '(no id/name)'}`);
  console.log(`      label: ${f.label || '(none found)'}`);
  if (f.options) console.log(`      options: ${f.options.map((o) => o.text).join(' | ')}`);
}

// Persist (append per page keyed by URL).
let report = {};
if (fs.existsSync(settings.fieldReport)) {
  try { report = JSON.parse(fs.readFileSync(settings.fieldReport, 'utf8')); } catch { report = {}; }
}
report[page.url()] = { capturedAt: new Date().toISOString(), fields };
fs.writeFileSync(settings.fieldReport, JSON.stringify(report, null, 2));
console.log(`\nSaved to ${settings.fieldReport}`);
console.log('Capture the next page (re-run inspect) or send me this file.');
await context.close();
process.exit(0);
