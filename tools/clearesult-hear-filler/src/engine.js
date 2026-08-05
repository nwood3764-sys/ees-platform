// Generic field-fill primitives. The fieldmap declares WHAT to fill; these
// functions know HOW to fill each control type reliably — including the
// Google-Places-style address typeahead, which a plain value-set won't trigger.
import { settings } from '../config/settings.js';

const T = settings.fieldTimeout;

async function loc(page, selector) {
  const l = page.locator(selector).first();
  await l.waitFor({ state: 'visible', timeout: T });
  return l;
}

export async function fillText(page, selector, value) {
  if (value == null || value === '') return;
  const l = await loc(page, selector);
  await l.click();
  await l.fill('');
  await l.type(String(value), { delay: 15 });
}

export async function selectOption(page, selector, value) {
  if (value == null || value === '') return;
  const l = await loc(page, selector);
  // Try by value, then by visible label, then by partial label match.
  try {
    await l.selectOption(String(value));
    return;
  } catch { /* fall through */ }
  try {
    await l.selectOption({ label: String(value) });
    return;
  } catch { /* fall through */ }
  const options = await l.locator('option').allTextContents();
  const match = options.find((o) => o.trim().toLowerCase() === String(value).trim().toLowerCase())
    || options.find((o) => o.trim().toLowerCase().includes(String(value).trim().toLowerCase()));
  if (!match) throw new Error(`No <option> matching "${value}" in ${selector}. Options: ${options.join(' | ')}`);
  await l.selectOption({ label: match });
}

export async function setCheckbox(page, selector, checked) {
  const l = await loc(page, selector);
  if (checked) await l.check(); else await l.uncheck();
}

export async function clickRadio(page, selector) {
  const l = await loc(page, selector);
  await l.check();
}

// Address autocomplete: type the address, wait for the suggestion dropdown, pick
// the first (or best-matching) option. `optionSelector` targets the dropdown items;
// override per-site in the fieldmap once inspect reveals the widget markup.
export async function fillTypeahead(page, selector, value, opts = {}) {
  if (value == null || value === '') return;
  const optionSelector = opts.optionSelector
    || '.pac-item, [role="option"], .autocomplete-suggestion, ul[role="listbox"] li';
  const l = await loc(page, selector);
  await l.click();
  await l.fill('');
  await l.type(String(value), { delay: 40 });
  const dropdown = page.locator(optionSelector);
  try {
    await dropdown.first().waitFor({ state: 'visible', timeout: opts.timeout ?? 6000 });
    if (opts.matchText) {
      const target = dropdown.filter({ hasText: opts.matchText }).first();
      if (await target.count()) { await target.click(); return; }
    }
    await dropdown.first().click();
  } catch {
    // No dropdown appeared — fall back to pressing ArrowDown+Enter, then leave as typed.
    await l.press('ArrowDown').catch(() => {});
    await l.press('Enter').catch(() => {});
  }
}

// Dispatch one fieldmap entry.
export async function applyField(page, entry, row) {
  const value = typeof entry.value === 'function' ? entry.value(row) : entry.value;
  switch (entry.type) {
    case 'text':
    case 'number':
    case 'email':
    case 'tel':
      return fillText(page, entry.selector, value);
    case 'select':
      return selectOption(page, entry.selector, value);
    case 'checkbox':
      return setCheckbox(page, entry.selector, entry.value ? Boolean(value) : true);
    case 'radio':
      return clickRadio(page, entry.selector);
    case 'typeahead':
      return fillTypeahead(page, entry.selector, value, entry.options || {});
    default:
      throw new Error(`Unknown field type "${entry.type}" for ${entry.selector}`);
  }
}
