// ==UserScript==
// @name         ClearResult HEAR — Fill this page
// @namespace    ees-wi.org
// @version      0.1.0
// @description  Interactive per-page form filler for the Focus IRA (WI HEAR) portal. Paste a project's JSON, click Fill. Use this to validate the field mapping before the Playwright bulk run.
// @match        https://focus-ira.clearesult.com/*
// @grant        none
// ==/UserScript==
(function () {
  'use strict';

  // ---- field map: label-text (lowercased, partial) -> JSON key -----------------
  // Matches by the field's visible label so it survives id/name changes. Edit to
  // match the real reservation pages; add rows as you capture more fields.
  const MAP = [
    { label: 'first name',        key: 'owner_first_name' },
    { label: 'last name',         key: 'owner_last_name' },
    { label: 'account holder email', key: 'owner_email' },
    { label: 'email',             key: 'owner_email' },
    { label: 'phone',             key: 'owner_phone' },
    { label: 'installation address', key: 'install_address', typeahead: true },
    { label: 'unit number',       key: 'unit_number' },
    { label: 'city',              key: 'city' },
    { label: 'state',             key: 'state' },
    { label: 'zip',               key: 'zip' },
  ];

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function labelText(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.textContent;
    }
    const wrap = el.closest('label');
    if (wrap) return wrap.textContent;
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const grp = el.closest('.field, .form-group, .control-group, td, li, div');
    const lab = grp && grp.querySelector('label, .label, legend, th');
    return lab ? lab.textContent : el.placeholder || '';
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
      : el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function typeInto(el, value) {
    // Simulate real typing so autocomplete/validation fires.
    el.focus();
    setNativeValue(el, '');
    for (const ch of String(value)) {
      setNativeValue(el, el.value + ch);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
    }
  }

  function fill(data) {
    const controls = [...document.querySelectorAll('input, select, textarea')].filter((e) => e.type !== 'hidden');
    let filled = 0;
    for (const el of controls) {
      const lt = norm(labelText(el));
      const m = MAP.find((row) => lt.includes(row.label));
      if (!m || data[m.key] == null || data[m.key] === '') continue;
      const val = data[m.key];
      if (el.tagName === 'SELECT') {
        const opt = [...el.options].find((o) => norm(o.text) === norm(val) || norm(o.text).includes(norm(val)) || o.value === val);
        if (opt) { setNativeValue(el, opt.value); filled++; }
      } else if (m.typeahead) {
        typeInto(el, val); filled++;
      } else {
        setNativeValue(el, val); filled++;
      }
    }
    return filled;
  }

  // ---- floating panel ----------------------------------------------------------
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;width:320px;background:#07111f;color:#fff;font:12px/1.4 Inter,system-ui,sans-serif;border:1px solid #d0d8e8;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.3);padding:12px;';
  panel.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px;">HEAR — Fill this page</div>
    <textarea id="heart-json" placeholder='Paste one project JSON, e.g. {"owner_first_name":"Jane",...}' style="width:100%;height:120px;box-sizing:border-box;background:#0d1a2e;color:#fff;border:1px solid #4a5e7a;border-radius:6px;padding:6px;font:11px/1.4 JetBrains Mono,monospace;"></textarea>
    <div style="display:flex;gap:6px;margin-top:8px;">
      <button id="heart-fill" style="flex:1;background:#3ecf8e;color:#07111f;border:0;border-radius:6px;padding:8px;font-weight:600;cursor:pointer;">Fill this page</button>
      <button id="heart-hide" style="background:transparent;color:#8fa0b8;border:1px solid #4a5e7a;border-radius:6px;padding:8px;cursor:pointer;">Hide</button>
    </div>
    <div id="heart-msg" style="margin-top:6px;color:#7eb3e8;min-height:14px;"></div>`;
  document.body.appendChild(panel);

  const msg = panel.querySelector('#heart-msg');
  panel.querySelector('#heart-fill').onclick = () => {
    let data;
    try { data = JSON.parse(panel.querySelector('#heart-json').value); }
    catch (e) { msg.textContent = 'Invalid JSON: ' + e.message; return; }
    try {
      localStorage.setItem('heart_last', JSON.stringify(data));
      const n = fill(data);
      msg.textContent = `Filled ${n} field(s). Review, then continue.`;
    } catch (e) { msg.textContent = 'Error: ' + e.message; }
  };
  panel.querySelector('#heart-hide').onclick = () => { panel.style.display = 'none'; };

  // Restore last-used data across page navigations for convenience.
  const last = localStorage.getItem('heart_last');
  if (last) panel.querySelector('#heart-json').value = last;
})();
