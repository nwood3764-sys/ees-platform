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
  var selected = null;      // { rec_object, rec_id, rec_label, rec_sublabel }
  var searchTimer = null;

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
      renderEmailSummary();
      setupAttachments();
      runSearch();
    }
  }

  // ── Main view ────────────────────────────────────────────────────────────
  function enterMain() {
    show('signOutBtn');
    renderEmailSummary();
    setupAttachments();
    show('mainView');
    runSearch();        // seed with recent records for the default object
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

  function detectDirection() {
    var f = fromAddress();
    if (f && myAddress && f.email && f.email.toLowerCase() === myAddress) return 'outbound';
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
      if (loggedN) msg += ' ' + loggedN + ' attachment' + (loggedN === 1 ? '' : 's') + ' included.';
      if (skipped) msg += ' ' + skipped + ' attachment' + (skipped === 1 ? '' : 's') + ' skipped.';
      setStatus(msg, 'ok');
    }).catch(function (err) {
      btn.disabled = false; btn.textContent = 'Log Email';
      setStatus((err && err.message) || 'Failed to log the email.', 'err');
    });
  }
})();
