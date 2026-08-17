-- Apply the branded confirmation-email look to the remaining customer-facing
-- scheduler emails: reminder (48h), rescheduled, canceled, completed. Same shell
-- (state-aware {{company.name}} header, hero, centered details, footer) and merge
-- fields as the confirmation. Neutral "energy assessment" wording so a single
-- global template serves both single-family and multifamily. The internal
-- dispatcher-followup template (NT-00014) is left as-is.

-- ── Reminder (48h) — NT-00003 ───────────────────────────────────────────────
UPDATE notification_templates
SET nt_subject_line = 'Reminder: your energy assessment is coming up',
    nt_updated_at = now(),
    nt_body = $b$<style>@media only screen and (max-width:480px){.px{padding-left:20px!important;padding-right:20px!important}.h1{font-size:23px!important}.tx{font-size:16px!important}.cal-btn{display:block!important;margin:6px 0!important}}</style>
<div style="margin:0;padding:0;background:#eef1f6;font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:32px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(13,26,46,.10);">
<tr><td style="background:#07111f;padding:24px 32px;text-align:center;"><span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.01em;">{{company.name}}</span></td></tr>
<tr><td class="px" style="background:#e9faf1;padding:38px 32px 32px;text-align:center;">
<div style="display:inline-block;width:58px;height:58px;border-radius:50%;background:#ffffff;line-height:58px;font-size:26px;color:#1f9d67;box-shadow:0 2px 6px rgba(31,157,103,.20);margin-bottom:14px;">&#10003;</div>
<div style="color:#1f9d67;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px;">Coming up</div>
<h1 class="h1" style="margin:0 0 10px;color:#0d1a2e;font-size:25px;font-weight:800;line-height:31px;">Your energy assessment is almost here</h1>
<p class="tx" style="margin:0;color:#2f4863;font-size:16px;line-height:24px;">A quick reminder, {{contact.first_name}} &mdash; here are your details.</p>
</td></tr>
<tr><td class="px" style="padding:28px 32px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe2ee;border-radius:12px;"><tr><td style="padding:24px 24px;text-align:center;">
<div style="color:#6b7d97;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">When</div>
<div style="color:#0d1a2e;font-size:16px;font-weight:700;">{{appointment.start_date}}</div>
<div style="color:#33455f;font-size:15px;margin-top:2px;">{{appointment.start_time}} &ndash; {{appointment.end_time}}</div>
<div style="border-top:1px solid #eef1f6;margin:18px 0;"></div>
<div style="color:#6b7d97;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Location</div>
<div style="color:#0d1a2e;font-size:16px;font-weight:700;">{{property.street}}</div>
<div style="color:#33455f;font-size:15px;margin-top:2px;">{{property.city_state_zip}}</div>
<div style="margin-top:7px;"><a href="https://www.google.com/maps/search/?api=1&amp;query={{property.street}}, {{property.city_state_zip}}" style="color:#2aab72;font-size:13px;font-weight:700;text-decoration:none;">Get directions &rarr;</a></div>
<div style="border-top:1px solid #eef1f6;margin:18px 0;"></div>
<div style="color:#6b7d97;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Contact</div>
<div style="color:#0d1a2e;font-size:16px;font-weight:700;">{{company.name}}</div>
<div style="color:#33455f;font-size:15px;margin-top:2px;">{{company.program_phone}}</div>
</td></tr></table>
</td></tr>
<tr><td class="px" style="padding:16px 32px 4px;text-align:center;">
<div style="color:#6b7d97;font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Add to calendar</div>
<div style="margin-top:10px;">
<a class="cal-btn" href="{{appointment.gcal_url}}" style="display:inline-block;margin:0 4px;padding:10px 20px;border:1px solid #cbd5e6;border-radius:8px;color:#0d1a2e;font-size:14px;font-weight:600;text-decoration:none;">Google</a>
<a class="cal-btn" href="{{appointment.outlook_url}}" style="display:inline-block;margin:0 4px;padding:10px 20px;border:1px solid #cbd5e6;border-radius:8px;color:#0d1a2e;font-size:14px;font-weight:600;text-decoration:none;">Outlook</a>
</div>
</td></tr>
<tr><td class="px" style="padding:22px 32px 8px;text-align:center;">
<a href="{{appointment.manage_url}}" style="display:inline-block;padding:15px 44px;background:#3ecf8e;color:#07111f;font-size:16px;font-weight:700;text-decoration:none;border-radius:10px;">Manage appointment</a>
<div style="margin-top:12px;color:#6b7d97;font-size:13px;">Need to make a change? Use the button above.</div>
</td></tr>
<tr><td class="px" style="padding:26px 32px 32px;text-align:center;"><div style="color:#6b7d97;font-size:13px;line-height:20px;">Questions? Reply to this email or call us at {{company.program_phone}}.<br>{{company.name}}</div></td></tr>
</table>
</td></tr></table>
</div>$b$
WHERE nt_record_number = 'NT-00003' AND nt_is_deleted IS NOT TRUE;

-- ── Rescheduled — NT-00011 ──────────────────────────────────────────────────
UPDATE notification_templates
SET nt_subject_line = 'Updated: your energy assessment is now {{appointment.start_date}}',
    nt_updated_at = now(),
    nt_body = $b$<style>@media only screen and (max-width:480px){.px{padding-left:20px!important;padding-right:20px!important}.h1{font-size:23px!important}.tx{font-size:16px!important}.cal-btn{display:block!important;margin:6px 0!important}}</style>
<div style="margin:0;padding:0;background:#eef1f6;font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:32px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(13,26,46,.10);">
<tr><td style="background:#07111f;padding:24px 32px;text-align:center;"><span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.01em;">{{company.name}}</span></td></tr>
<tr><td class="px" style="background:#e9faf1;padding:38px 32px 32px;text-align:center;">
<div style="display:inline-block;width:58px;height:58px;border-radius:50%;background:#ffffff;line-height:58px;font-size:26px;color:#1f9d67;box-shadow:0 2px 6px rgba(31,157,103,.20);margin-bottom:14px;">&#10003;</div>
<div style="color:#1f9d67;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px;">Updated</div>
<h1 class="h1" style="margin:0 0 10px;color:#0d1a2e;font-size:25px;font-weight:800;line-height:31px;">Your assessment has been rescheduled</h1>
<p class="tx" style="margin:0;color:#2f4863;font-size:16px;line-height:24px;">You&rsquo;re all set for the new time, {{contact.first_name}}.</p>
</td></tr>
<tr><td class="px" style="padding:28px 32px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe2ee;border-radius:12px;"><tr><td style="padding:24px 24px;text-align:center;">
<div style="color:#6b7d97;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">New time</div>
<div style="color:#0d1a2e;font-size:16px;font-weight:700;">{{appointment.start_date}}</div>
<div style="color:#33455f;font-size:15px;margin-top:2px;">{{appointment.start_time}} &ndash; {{appointment.end_time}}</div>
<div style="border-top:1px solid #eef1f6;margin:18px 0;"></div>
<div style="color:#6b7d97;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Location</div>
<div style="color:#0d1a2e;font-size:16px;font-weight:700;">{{property.street}}</div>
<div style="color:#33455f;font-size:15px;margin-top:2px;">{{property.city_state_zip}}</div>
<div style="margin-top:7px;"><a href="https://www.google.com/maps/search/?api=1&amp;query={{property.street}}, {{property.city_state_zip}}" style="color:#2aab72;font-size:13px;font-weight:700;text-decoration:none;">Get directions &rarr;</a></div>
<div style="border-top:1px solid #eef1f6;margin:18px 0;"></div>
<div style="color:#6b7d97;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Contact</div>
<div style="color:#0d1a2e;font-size:16px;font-weight:700;">{{company.name}}</div>
<div style="color:#33455f;font-size:15px;margin-top:2px;">{{company.program_phone}}</div>
</td></tr></table>
</td></tr>
<tr><td class="px" style="padding:16px 32px 4px;text-align:center;">
<div style="color:#6b7d97;font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Add to calendar</div>
<div style="margin-top:10px;">
<a class="cal-btn" href="{{appointment.gcal_url}}" style="display:inline-block;margin:0 4px;padding:10px 20px;border:1px solid #cbd5e6;border-radius:8px;color:#0d1a2e;font-size:14px;font-weight:600;text-decoration:none;">Google</a>
<a class="cal-btn" href="{{appointment.outlook_url}}" style="display:inline-block;margin:0 4px;padding:10px 20px;border:1px solid #cbd5e6;border-radius:8px;color:#0d1a2e;font-size:14px;font-weight:600;text-decoration:none;">Outlook</a>
</div>
</td></tr>
<tr><td class="px" style="padding:22px 32px 8px;text-align:center;">
<a href="{{appointment.manage_url}}" style="display:inline-block;padding:15px 44px;background:#3ecf8e;color:#07111f;font-size:16px;font-weight:700;text-decoration:none;border-radius:10px;">Manage appointment</a>
</td></tr>
<tr><td class="px" style="padding:26px 32px 32px;text-align:center;"><div style="color:#6b7d97;font-size:13px;line-height:20px;">Questions? Reply to this email or call us at {{company.program_phone}}.<br>{{company.name}}</div></td></tr>
</table>
</td></tr></table>
</div>$b$
WHERE nt_record_number = 'NT-00011' AND nt_is_deleted IS NOT TRUE;

-- ── Canceled — NT-00013 (no red per design system; sky accent) ──────────────
UPDATE notification_templates
SET nt_subject_line = 'Your energy assessment has been canceled',
    nt_updated_at = now(),
    nt_body = $b$<style>@media only screen and (max-width:480px){.px{padding-left:20px!important;padding-right:20px!important}.h1{font-size:23px!important}.tx{font-size:16px!important}}</style>
<div style="margin:0;padding:0;background:#eef1f6;font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:32px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(13,26,46,.10);">
<tr><td style="background:#07111f;padding:24px 32px;text-align:center;"><span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.01em;">{{company.name}}</span></td></tr>
<tr><td class="px" style="background:#eef4fb;padding:38px 32px 32px;text-align:center;">
<div style="display:inline-block;width:58px;height:58px;border-radius:50%;background:#ffffff;line-height:58px;font-size:24px;color:#5f86b8;box-shadow:0 2px 6px rgba(95,134,184,.20);margin-bottom:14px;">&#10005;</div>
<div style="color:#5f86b8;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px;">Canceled</div>
<h1 class="h1" style="margin:0 0 10px;color:#0d1a2e;font-size:25px;font-weight:800;line-height:31px;">Your assessment has been canceled</h1>
<p class="tx" style="margin:0;color:#2f4863;font-size:16px;line-height:24px;">No problem, {{contact.first_name}}. Whenever you&rsquo;re ready, you can book a new time.</p>
</td></tr>
<tr><td class="px" style="padding:28px 32px 8px;text-align:center;">
<a href="https://leap.energyefficiencyservices.org/sa" style="display:inline-block;padding:15px 44px;background:#3ecf8e;color:#07111f;font-size:16px;font-weight:700;text-decoration:none;border-radius:10px;">Schedule again</a>
</td></tr>
<tr><td class="px" style="padding:22px 32px 32px;text-align:center;"><div style="color:#6b7d97;font-size:13px;line-height:20px;">Questions? Reply to this email or call us at {{company.program_phone}}.<br>{{company.name}}</div></td></tr>
</table>
</td></tr></table>
</div>$b$
WHERE nt_record_number = 'NT-00013' AND nt_is_deleted IS NOT TRUE;

-- ── Completed — NT-00009 ────────────────────────────────────────────────────
UPDATE notification_templates
SET nt_subject_line = 'Thank you — your energy assessment is complete',
    nt_updated_at = now(),
    nt_body = $b$<style>@media only screen and (max-width:480px){.px{padding-left:20px!important;padding-right:20px!important}.h1{font-size:23px!important}.tx{font-size:16px!important}}</style>
<div style="margin:0;padding:0;background:#eef1f6;font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:32px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(13,26,46,.10);">
<tr><td style="background:#07111f;padding:24px 32px;text-align:center;"><span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.01em;">{{company.name}}</span></td></tr>
<tr><td class="px" style="background:#e9faf1;padding:38px 32px 32px;text-align:center;">
<div style="display:inline-block;width:58px;height:58px;border-radius:50%;background:#ffffff;line-height:58px;font-size:26px;color:#1f9d67;box-shadow:0 2px 6px rgba(31,157,103,.20);margin-bottom:14px;">&#10003;</div>
<div style="color:#1f9d67;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px;">All done</div>
<h1 class="h1" style="margin:0 0 10px;color:#0d1a2e;font-size:25px;font-weight:800;line-height:31px;">Thanks &mdash; your assessment is complete</h1>
<p class="tx" style="margin:0;color:#2f4863;font-size:16px;line-height:24px;">Thanks for your time, {{contact.first_name}}. Here&rsquo;s what happens next.</p>
</td></tr>
<tr><td class="px" style="padding:28px 32px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="width:50%;vertical-align:top;text-align:center;padding:0 8px;"><div style="width:36px;height:36px;border-radius:50%;background:#e9faf1;color:#1f9d67;font-weight:800;font-size:15px;line-height:36px;margin:0 auto 10px;">1</div><div style="color:#0d1a2e;font-size:14px;font-weight:700;">Assessment Report</div><div style="color:#6b7d97;font-size:12px;line-height:17px;margin-top:3px;">We prepare your findings &amp; savings opportunities</div></td>
<td style="width:50%;vertical-align:top;text-align:center;padding:0 8px;"><div style="width:36px;height:36px;border-radius:50%;background:#f2f5fa;color:#6b7d97;font-weight:800;font-size:15px;line-height:36px;margin:0 auto 10px;">2</div><div style="color:#0d1a2e;font-size:14px;font-weight:700;">Finalize Project Scope</div><div style="color:#6b7d97;font-size:12px;line-height:17px;margin-top:3px;">We define the upgrades &amp; next steps with you</div></td>
</tr></table>
</td></tr>
<tr><td class="px" style="padding:28px 32px 32px;text-align:center;"><div style="color:#6b7d97;font-size:13px;line-height:20px;">Questions? Reply to this email or call us at {{company.program_phone}}.<br>{{company.name}}</div></td></tr>
</table>
</td></tr></table>
</div>$b$
WHERE nt_record_number = 'NT-00009' AND nt_is_deleted IS NOT TRUE;
