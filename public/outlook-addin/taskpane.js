/* ───────────────────────────────────────────────────────────────────────────
   LEAP — Log Email (Outlook add-in task pane)

   Reads the currently open Outlook email via Office.js (subject, sender,
   recipients, body, attachments — all client-side), lets the signed-in LEAP
   user pick a record, and posts it to the `log-email-to-record` edge function
   which writes it onto that record's Conversations timeline.

   Nothing here depends on a server-side Outlook/Graph connection — it works on
   whatever email the user has open, in any mailbox they can read.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // Public config — same publishable values the LEAP web app ships (see
  // netlify.toml). The anon key is RLS-gated; it grants nothing without a
  // valid signed-in session.
  var SUPABASE_URL = 'https://flyjigrijjjtcsvpgzvk.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_qkmVXJMofrUrSoVA3bhZ2g_XNsdE9lq';

  var sb = null;
  var mailboxItem = null;
  var myAddress = '';
  var sharedMailboxAddress = ''; // SMTP of the shared mailbox when the open item
                                 // is in one (ees-nc.org / ees-wi.org boxes)
  var selected = null;      // { rec_object, rec_id, rec_label, rec_sublabel }
  var searchTimer = null;
  var participants = [];    // [{ email, name, role, contactId, contactName, accountId, accountName }]
  var linkContactId = null; // contact the email will also be logged against

  // ── DOM helpers ──────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function show(id) { $(id).hidden = false; }
  function hide(id) { $(id).hidden = true; }
  function setStatus(msg, kind) {
    var el = $('statusMsg');
    el.textContent = msg;
    el.className = 'lp-status ' + (kind || 'info');
    el.hidden = !msg;
  }

  // ── Office bootstrap ─────────────────────────────────────────────────────
  Office.onReady(function (info) {
    window.__leapOfficeReady = true;
    if (!info || info.host !== Office.HostType.Outlook) {
      hide('bootView'); show('unsupportedView');
      return;
    }
    try {
      sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'leap-outlook-addin-auth' }
      });
    } catch (e) {
      hide('bootView'); show('unsupportedView');
      return;
    }

    mailboxItem = Office.context.mailbox.item;
    myAddress = ((Office.context.mailbox.userProfile &&
                  Office.context.mailbox.userProfile.emailAddress) || '').toLowerCase();

    wireEvents();

    // When the pane is pinned open, Outlook fires ItemChanged as the user
    // clicks through emails — re-read the newly selected message so the pane
    // always reflects the email in view (Salesforce-style). Harmless when the
    // pane isn't pinned.
    try {
      Office.context.mailbox.addHandlerAsync(Office.EventType.ItemChanged, onItemChanged);
    } catch (e) { /* older hosts: no pinning, single-item mode */ }

    // Restore an existing session if the user logged in before.
    sb.auth.getSession().then(function (res) {
      hide('bootView');
      if (res && res.data && res.data.session) { enterMain(); }
      else { show('loginView'); }
    }).catch(function () {
      hide('bootView'); show('loginView');
    });
  });

  function wireEvents() {
    $('loginForm').addEventListener('submit', onLogin);
    $('signOutBtn').addEventListener('click', onSignOut);
    $('objectType').addEventListener('change', function () {
      clearSelection(); runSearch();
    });
    $('search').addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 250);
    });
    $('logBtn').addEventListener('click', onLog);
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  function onLogin(e) {
    e.preventDefault();
    hide('loginError');
    var btn = $('loginBtn');
    btn.disabled = true; btn.textContent = 'Signing in…';
    sb.auth.signInWithPassword({
      email: $('email').value.trim(),
      password: $('password').value
    }).then(function (res) {
      btn.disabled = false; btn.textContent = 'Sign in';
      if (res.error) {
        var el = $('loginError');
        el.textContent = res.error.message || 'Sign-in failed.';
        el.hidden = false;
        return;
      }
      hide('loginView'); enterMain();
    }).catch(function (err) {
      btn.disabled = false; btn.textContent = 'Sign in';
      var el = $('loginError');
      el.textContent = (err && err.message) || 'Sign-in failed.';
      el.hidden = false;
    });
  }

  function onSignOut() {
    sb.auth.signOut().finally(function () {
      hide('mainView'); hide('signOutBtn'); setStatus('', 'info');
      show('loginView');
    });
  }

  // Pinned pane: the selected email changed — refresh the summary, attachments,
  // and clear any prior status/selection so a log always targets the email now
  // in view.
  function onItemChanged() {
    mailboxItem = Office.context.mailbox.item;
    if (!mailboxItem) return;
    if (!$('mainView').hidden) {
      setStatus('', 'info');
      clearSelection();
      refreshSharedContext(function () {
        renderEmailSummary();
        setupAttachments();
        runSearch();
        refreshParticipants();
      });
    }
  }

  // ── People on the email → LEAP contacts ──────────────────────────────────
  function gatherParticipants() {
    // from + to + cc, minus the signed-in user's own address, de-duped by email.
    var rows = [];
    var f = fromAddress();
    if (f) rows.push({ email: f.email, name: f.name, role: 'from' });
    toList().forEach(function (r) { rows.push({ email: r.email, name: r.name, role: 'to' }); });
    ccList().forEach(function (r) { rows.push({ email: r.email, name: r.name, role: 'cc' }); });
    var seen = {}, out = [];
    rows.forEach(function (r) {
      if (!r.email) return;
      var key = r.email.toLowerCase();
      if (isOurAddress(key)) return;      // skip our own / the shared mailbox
      if (seen[key]) return;
      seen[key] = true;
      out.push(r);
    });
    return out;
  }

  // Which participant to link the email to by default: the external counterpart —
  // the sender for an inbound email, the first recipient for an outbound one.
  function primaryEmail() {
    var dir = detectDirection();
    if (dir === 'inbound') { var f = fromAddress(); return f ? f.email.toLowerCase() : null; }
    var t = toList().find(function (r) { return r.email && !isOurAddress(r.email); });
    return t ? t.email.toLowerCase() : null;
  }

  function refreshParticipants() {
    participants = []; linkContactId = null;
    var people = gatherParticipants();
    if (!people.length) { hide('peopleSection'); return; }
    var emails = people.map(function (p) { return p.email; });
    sb.rpc('lookup_email_participants', { p_emails: emails }).then(function (res) {
      var byEmail = {};
      if (!res.error && Array.isArray(res.data)) {
        res.data.forEach(function (row) { byEmail[(row.participant_email || '').toLowerCase()] = row; });
      }
      var primary = primaryEmail();
      participants = people.map(function (p) {
        var m = byEmail[p.email.toLowerCase()] || {};
        return {
          email: p.email, name: p.name, role: p.role,
          contactId: m.contact_id || null,
          contactName: m.contact_name || null,
          accountId: m.account_id || null,
          accountName: m.account_name || null
        };
      });
      // Default link = the primary external participant, if it's a known contact.
      var prim = participants.find(function (p) { return primary && p.email.toLowerCase() === primary; });
      if (prim && prim.contactId) linkContactId = prim.contactId;
      renderPeople();
    }).catch(function () { hide('peopleSection'); });
  }

  function renderPeople() {
    var ul = $('peopleList');
    ul.innerHTML = '';
    show('peopleSection');

    // "Don't link a contact" option.
    var noneLi = document.createElement('li');
    noneLi.className = 'lp-none-row';
    var noneRadio = document.createElement('input');
    noneRadio.type = 'radio'; noneRadio.name = 'lpLinkContact'; noneRadio.className = 'lp-person-radio';
    noneRadio.checked = !linkContactId;
    noneRadio.addEventListener('change', function () { linkContactId = null; });
    noneLi.appendChild(noneRadio);
    var noneLbl = document.createElement('span'); noneLbl.textContent = 'Don’t link to a contact';
    noneLi.appendChild(noneLbl);
    ul.appendChild(noneLi);

    participants.forEach(function (p, idx) {
      var li = document.createElement('li');
      li.className = 'lp-person';

      var top = document.createElement('div');
      top.className = 'lp-person-top';

      if (p.contactId) {
        var radio = document.createElement('input');
        radio.type = 'radio'; radio.name = 'lpLinkContact'; radio.className = 'lp-person-radio';
        radio.checked = (linkContactId === p.contactId);
        radio.addEventListener('change', function () { linkContactId = p.contactId; });
        top.appendChild(radio);
      } else {
        var spacer = document.createElement('span'); spacer.className = 'lp-person-radio'; spacer.style.visibility = 'hidden';
        top.appendChild(spacer);
      }

      var main = document.createElement('div');
      main.className = 'lp-person-main';
      var nameEl = document.createElement('div');
      nameEl.className = 'lp-person-name';
      nameEl.textContent = p.contactName || p.name || p.email;
      if (p.contactId) {
        var chip = document.createElement('span'); chip.className = 'lp-chip lp-chip-linked'; chip.textContent = 'contact';
        nameEl.appendChild(chip);
      } else {
        var chipN = document.createElement('span'); chipN.className = 'lp-chip lp-chip-new'; chipN.textContent = 'not in LEAP';
        nameEl.appendChild(chipN);
      }
      main.appendChild(nameEl);
      var emailEl = document.createElement('div'); emailEl.className = 'lp-person-email'; emailEl.textContent = p.email;
      main.appendChild(emailEl);
      if (p.accountName) {
        var meta = document.createElement('div'); meta.className = 'lp-person-meta'; meta.textContent = p.accountName;
        main.appendChild(meta);
      }
      top.appendChild(main);
      li.appendChild(top);

      if (!p.contactId) {
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'lp-person-btn'; btn.textContent = '+ Create contact';
        btn.addEventListener('click', function () { openCreateForm(li, idx); });
        li.appendChild(btn);
      }
      ul.appendChild(li);
    });
  }

  // Inline create-contact form for an unmatched participant.
  function openCreateForm(li, idx) {
    var p = participants[idx];
    if (li.querySelector('.lp-create')) return; // already open
    var nameParts = (p.name && p.name.indexOf('@') === -1 ? p.name : '').trim().split(/\s+/).filter(Boolean);
    var first = nameParts.length ? nameParts[0] : '';
    var last = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    var box = document.createElement('div');
    box.className = 'lp-create';
    box.innerHTML =
      '<div class="lp-row2">' +
        '<input class="lp-input" data-f="first" placeholder="First name">' +
        '<input class="lp-input" data-f="last" placeholder="Last name">' +
      '</div>' +
      '<input class="lp-input" data-f="email" placeholder="Email">' +
      '<input class="lp-input" data-f="acct" placeholder="Search for the company (account)…" autocomplete="off">' +
      '<ul class="lp-acct-results"></ul>' +
      '<div class="lp-acct-chosen" hidden></div>' +
      '<p class="lp-error" data-f="err" hidden></p>' +
      '<div class="lp-create-actions">' +
        '<button type="button" class="lp-btn-sm primary" data-f="save" disabled>Create contact</button>' +
        '<button type="button" class="lp-btn-sm ghost" data-f="cancel">Cancel</button>' +
      '</div>';
    li.appendChild(box);

    var q = function (s) { return box.querySelector(s); };
    q('[data-f="first"]').value = first;
    q('[data-f="last"]').value = last;
    q('[data-f="email"]').value = p.email;

    var chosenAccount = null;
    var acctInput = q('[data-f="acct"]');
    var acctResults = q('.lp-acct-results');
    var chosenEl = q('.lp-acct-chosen');
    var saveBtn = q('[data-f="save"]');
    var errEl = q('[data-f="err"]');
    var acctTimer = null;

    function updateSaveState() { saveBtn.disabled = !chosenAccount; }

    acctInput.addEventListener('input', function () {
      clearTimeout(acctTimer);
      chosenAccount = null; chosenEl.hidden = true; updateSaveState();
      var term = acctInput.value.trim();
      acctTimer = setTimeout(function () {
        sb.rpc('search_records_for_email_log', { p_object: 'accounts', p_query: term || null, p_limit: 8 })
          .then(function (r) {
            acctResults.innerHTML = '';
            if (r.error || !Array.isArray(r.data)) return;
            r.data.forEach(function (row) {
              var opt = document.createElement('li');
              opt.className = 'lp-acct-opt';
              opt.textContent = row.rec_label + (row.rec_sublabel ? ' · ' + row.rec_sublabel : '');
              opt.addEventListener('click', function () {
                chosenAccount = row;
                acctResults.innerHTML = '';
                acctInput.value = row.rec_label;
                chosenEl.textContent = 'Company: ' + row.rec_label;
                chosenEl.hidden = false;
                updateSaveState();
              });
              acctResults.appendChild(opt);
            });
          });
      }, 250);
    });

    q('[data-f="cancel"]').addEventListener('click', function () { box.remove(); });

    saveBtn.addEventListener('click', function () {
      errEl.hidden = true;
      if (!chosenAccount) return;
      saveBtn.disabled = true; saveBtn.textContent = 'Creating…';
      sb.rpc('create_contact_from_email', {
        p_first_name: q('[data-f="first"]').value.trim(),
        p_last_name:  q('[data-f="last"]').value.trim(),
        p_email:      q('[data-f="email"]').value.trim(),
        p_account_id: chosenAccount.rec_id
      }).then(function (r) {
        if (r.error || !Array.isArray(r.data) || !r.data.length) {
          errEl.textContent = (r.error && r.error.message) || 'Could not create the contact.';
          errEl.hidden = false; saveBtn.disabled = false; saveBtn.textContent = 'Create contact';
          return;
        }
        var made = r.data[0];
        participants[idx].contactId = made.contact_id;
        participants[idx].contactName = made.contact_name;
        participants[idx].accountId = made.account_id;
        participants[idx].accountName = made.account_name;
        linkContactId = made.contact_id;   // link the email to the just-created contact
        renderPeople();
      }).catch(function (e) {
        errEl.textContent = (e && e.message) || 'Could not create the contact.';
        errEl.hidden = false; saveBtn.disabled = false; saveBtn.textContent = 'Create contact';
      });
    });
  }

  // ── Main view ────────────────────────────────────────────────────────────
  function enterMain() {
    show('signOutBtn');
    show('mainView');
    // Resolve shared-mailbox context first, then render so direction/addresses
    // are correct for mail in ees-nc.org / ees-wi.org shared boxes.
    refreshSharedContext(function () {
      renderEmailSummary();
      setupAttachments();
      runSearch();          // seed with recent records for the default object
      refreshParticipants(); // match the people on the email to LEAP contacts
    });
  }

  function fromAddress() {
    // Read mode: item.from is an EmailAddressDetails for messages.
    var f = mailboxItem && mailboxItem.from;
    if (f && f.emailAddress) return { name: f.displayName || f.emailAddress, email: f.emailAddress };
    // Fallback for appointment-like items.
    var s = mailboxItem && mailboxItem.sender;
    if (s && s.emailAddress) return { name: s.displayName || s.emailAddress, email: s.emailAddress };
    return null;
  }

  function toList() {
    var arr = (mailboxItem && mailboxItem.to) || [];
    return arr.map(function (r) { return { name: r.displayName || r.emailAddress, email: r.emailAddress }; })
              .filter(function (r) { return r.email; });
  }

  function ccList() {
    var arr = (mailboxItem && mailboxItem.cc) || [];
    return arr.map(function (r) { return { name: r.displayName || r.emailAddress, email: r.emailAddress }; })
              .filter(function (r) { return r.email; });
  }

  // When the open email lives in a shared mailbox (e.g. ncira@ees-nc.org,
  // ira@ees-wi.org), Office.getSharedPropertiesAsync tells us the shared
  // mailbox's address. We treat that as "ours" alongside the signed-in user's
  // own address, so direction and the customer/our-address split are correct
  // for shared-mailbox mail — not attributed to the delegate reading it.
  function refreshSharedContext(done) {
    sharedMailboxAddress = '';
    try {
      var supported = Office.context.requirements.isSetSupported('Mailbox', '1.8');
      if (supported && mailboxItem && typeof mailboxItem.getSharedPropertiesAsync === 'function') {
        mailboxItem.getSharedPropertiesAsync(function (r) {
          if (r && r.status === Office.AsyncResultStatus.Succeeded && r.value) {
            sharedMailboxAddress = (r.value.targetMailbox || r.value.owner || '').toLowerCase();
          }
          if (done) done();
        });
        return;
      }
    } catch (e) { /* not a shared item / older host */ }
    if (done) done();
  }

  function isOurAddress(email) {
    if (!email) return false;
    var e = email.toLowerCase();
    return e === myAddress || (!!sharedMailboxAddress && e === sharedMailboxAddress);
  }

  function detectDirection() {
    var f = fromAddress();
    if (f && f.email && isOurAddress(f.email)) return 'outbound';
    return 'inbound';
  }

  function renderEmailSummary() {
    var f = fromAddress();
    $('emFrom').textContent = f ? (f.name + (f.name !== f.email ? ' <' + f.email + '>' : '')) : '(unknown sender)';
    $('emSubject').textContent = (mailboxItem && mailboxItem.subject) || '(no subject)';
    $('emDirection').textContent = detectDirection() === 'outbound' ? 'Outbound (sent by you)' : 'Inbound (received)';
  }

  // ── Attachments ──────────────────────────────────────────────────────────
  function attachmentsSupported() {
    try {
      return Office.context.requirements.isSetSupported('Mailbox', '1.8');
    } catch (e) { return false; }
  }

  function fileAttachments() {
    var arr = (mailboxItem && mailboxItem.attachments) || [];
    return arr.filter(function (a) {
      return a && !a.isInline &&
        (!Office.MailboxEnums || a.attachmentType === Office.MailboxEnums.AttachmentType.File);
    });
  }

  function setupAttachments() {
    var atts = fileAttachments();
    if (atts.length > 0 && attachmentsSupported()) {
      $('attachCount').textContent = String(atts.length);
      show('attachRow');
    } else {
      hide('attachRow');
    }
  }

  // ── Record search ────────────────────────────────────────────────────────
  function clearSelection() {
    selected = null;
    hide('selectedBar');
    $('logBtn').disabled = true;
    var nodes = document.querySelectorAll('.lp-result.sel');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('sel');
  }

  function runSearch() {
    if (!sb) return;
    var obj = $('objectType').value;
    var q = $('search').value.trim();
    sb.rpc('search_records_for_email_log', { p_object: obj, p_query: q || null, p_limit: 20 })
      .then(function (res) {
        if (res.error) { renderResults([], res.error.message); return; }
        renderResults(res.data || [], null);
      })
      .catch(function (err) { renderResults([], (err && err.message) || 'Search failed'); });
  }

  function renderResults(rows, errMsg) {
    var ul = $('results');
    ul.innerHTML = '';
    if (errMsg) {
      var li = document.createElement('li');
      li.className = 'lp-muted'; li.textContent = errMsg;
      ul.appendChild(li);
      return;
    }
    if (!rows.length) {
      var none = document.createElement('li');
      none.className = 'lp-muted'; none.textContent = 'No matching records.';
      ul.appendChild(none);
      return;
    }
    rows.forEach(function (row) {
      var li = document.createElement('li');
      li.className = 'lp-result';
      if (selected && selected.rec_id === row.rec_id) li.classList.add('sel');
      var name = document.createElement('div');
      name.className = 'lp-result-name'; name.textContent = row.rec_label || '(unnamed)';
      var sub = document.createElement('div');
      sub.className = 'lp-result-sub'; sub.textContent = row.rec_sublabel || '';
      li.appendChild(name); li.appendChild(sub);
      li.addEventListener('click', function () {
        selected = row;
        var nodes = ul.querySelectorAll('.lp-result');
        for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('sel');
        li.classList.add('sel');
        $('selectedName').textContent = (row.rec_label || '') + (row.rec_sublabel ? ' · ' + row.rec_sublabel : '');
        show('selectedBar');
        $('logBtn').disabled = false;
      });
      ul.appendChild(li);
    });
  }

  // ── Read body + attachments, then log ────────────────────────────────────
  function getBodyHtml() {
    return new Promise(function (resolve) {
      try {
        mailboxItem.body.getAsync(Office.CoercionType.Html, function (r) {
          resolve(r.status === Office.AsyncResultStatus.Succeeded ? (r.value || '') : '');
        });
      } catch (e) { resolve(''); }
    });
  }

  function getAttachmentContent(att) {
    return new Promise(function (resolve) {
      try {
        mailboxItem.getAttachmentContentAsync(att.id, function (r) {
          if (r.status !== Office.AsyncResultStatus.Succeeded || !r.value) { resolve(null); return; }
          // Only base64 file content is loggable; skip cloud/URL/eml formats.
          if (r.value.format !== Office.MailboxEnums.AttachmentContentFormat.Base64) { resolve(null); return; }
          resolve({
            file_name: att.name,
            mime_type: att.contentType || 'application/octet-stream',
            size_bytes: att.size || 0,
            content_base64: r.value.content
          });
        });
      } catch (e) { resolve(null); }
    });
  }

  function collectAttachments() {
    var wantAttachments = !$('attachRow').hidden && $('includeAttachments').checked;
    if (!wantAttachments) return Promise.resolve([]);
    var atts = fileAttachments();
    return Promise.all(atts.map(getAttachmentContent)).then(function (list) {
      return list.filter(function (x) { return x; });
    });
  }

  function onLog() {
    if (!selected) return;
    var btn = $('logBtn');
    btn.disabled = true; btn.textContent = 'Logging…';
    setStatus('Reading the email…', 'info');

    var f = fromAddress();
    if (!f || !f.email) {
      setStatus('Could not read the sender of this email.', 'err');
      btn.disabled = false; btn.textContent = 'Log Email';
      return;
    }

    Promise.all([getBodyHtml(), collectAttachments()]).then(function (parts) {
      var bodyHtml = parts[0];
      var attachments = parts[1];
      var dateIso = null;
      try { if (mailboxItem.dateTimeCreated) dateIso = new Date(mailboxItem.dateTimeCreated).toISOString(); } catch (e) {}

      var payload = {
        target_object: selected.rec_object,
        target_record_id: selected.rec_id,
        contact_id: linkContactId || null,
        email: {
          subject: mailboxItem.subject || '',
          from: f,
          to: toList(),
          cc: ccList(),
          date: dateIso,
          body_html: bodyHtml,
          direction: detectDirection(),
          internet_message_id: mailboxItem.internetMessageId || null
        },
        attachments: attachments
      };

      setStatus('Saving to LEAP…', 'info');
      return sb.functions.invoke('log-email-to-record', { body: payload });
    }).then(function (res) {
      btn.disabled = false; btn.textContent = 'Log Email';
      if (!res) return;
      if (res.error) {
        // Edge function returns JSON errors with a 4xx/5xx; surface its message.
        var detail = (res.data && res.data.error) || res.error.message || 'Failed to log the email.';
        setStatus(detail, 'err');
        return;
      }
      var data = res.data || {};
      if (data.status !== 'ok') {
        setStatus((data.error) || 'Failed to log the email.', 'err');
        return;
      }
      var skipped = (data.attachments_skipped || []).length;
      var loggedN = (data.attachments_logged || []).length;
      var msg = 'Logged to ' + selected.rec_label + ' (' + (data.msg_record_number || 'saved') + ').';
      if (linkContactId) {
        var lc = participants.find(function (p) { return p.contactId === linkContactId; });
        if (lc && (lc.contactName || lc.name)) msg += ' Linked to ' + (lc.contactName || lc.name) + '.';
      }
      if (loggedN) msg += ' ' + loggedN + ' attachment' + (loggedN === 1 ? '' : 's') + ' included.';
      if (skipped) msg += ' ' + skipped + ' attachment' + (skipped === 1 ? '' : 's') + ' skipped.';
      setStatus(msg, 'ok');
    }).catch(function (err) {
      btn.disabled = false; btn.textContent = 'Log Email';
      setStatus((err && err.message) || 'Failed to log the email.', 'err');
    });
  }
})();
