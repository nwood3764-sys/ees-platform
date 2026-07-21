-- =============================================================================
-- North Carolina Energy Savers — Site Visit invite email template
--
-- A reusable, manually-sent email template carrying the program's invite copy
-- plus a "Schedule Now" button that links to the public NC self-scheduling
-- page (/sa/nc-energy-savers-site-visit). Sent from the active NC mailbox
-- (ncira@ees-nc.org, OBM-00006) through the existing send-email-v1 composer,
-- which appends that mailbox's signature automatically.
--
-- The homeowner clicks Schedule Now, enters/confirms their address, and books
-- a slot from the drive-time-optimized availability. Purpose-built; not shared
-- with any other template.
-- =============================================================================

INSERT INTO public.email_templates (
  et_record_number, name, description, subject, body_html,
  state, related_object, status, is_manual, is_automated,
  owner_id, created_by, updated_by, created_at, updated_at,
  template_locked_regions, published_at, version,
  template_default_outbound_mailbox_id
)
SELECT
  '',
  'North Carolina Energy Savers — Site Visit Invite',
  'Invite a pre-qualified North Carolina Energy Saver homeowner to self-schedule their site visit. Manually sent from the homeowner''s record.',
  'Schedule your North Carolina Energy Saver site visit',
  $html$<div style="font-family:Inter,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a2e;">
<p>Hi there,</p>
<p>Thanks for reaching out, and congratulations on being pre-qualified for the North Carolina Energy Saver program. The next step is a site walk at your home.</p>
<p>We'll do an evaluation of your home, including insulation levels, HVAC systems, and other areas that impact energy usage. It will usually take 30 to 45 minutes to collect the information needed to finalize your project proposal.</p>
<p>Most projects under the program are fully covered, with no out-of-pocket cost to you. Whether that applies to your project depends on the final scope, which we'll walk through together.</p>
<p>If you've already received assessment information from your auditor, or have other helpful project details on hand, please forward that information to us ahead of time. Having information to review before we're on site would be extremely helpful.</p>
<p>We'd love to get you scheduled — just click the button below to pick a time that works for you, or give us a call at <a href="tel:+17049905614" style="color:#2aab72;text-decoration:none;">704-990-5614</a>. We're happy to help however's easiest.</p>
<p style="text-align:center;margin:28px 0;">
  <a href="https://ees-ops.netlify.app/sa/nc-energy-savers-site-visit"
     style="display:inline-block;background:#3ecf8e;color:#ffffff;font-weight:600;font-size:16px;text-decoration:none;padding:14px 32px;border-radius:8px;">
    Schedule Now
  </a>
</p>
<p style="font-size:13px;color:#8fa0b8;text-align:center;margin-top:8px;">
  Or copy this link into your browser:<br>
  <span style="font-family:'JetBrains Mono',monospace;color:#4a5e7a;">https://ees-ops.netlify.app/sa/nc-energy-savers-site-visit</span>
</p>
</div>$html$,
  'NC',
  'contacts',
  '9d8550f1-2f10-42b2-893a-6977edd41d1a',   -- email_templates status = Active
  true,   -- is_manual
  false,  -- is_automated
  'c5a01ec8-960f-42ab-8a9e-a49822de89af',
  'c5a01ec8-960f-42ab-8a9e-a49822de89af',
  'c5a01ec8-960f-42ab-8a9e-a49822de89af',
  now(), now(),
  '[]'::jsonb,
  now(),
  1,
  '279659e8-0837-4737-bc32-07f846b0bde0'    -- OBM-00006 NC IRA Outreach (ncira@ees-nc.org, active)
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates
  WHERE name = 'North Carolina Energy Savers — Site Visit Invite' AND is_deleted IS NOT TRUE
);
