-- Customer booking-confirmation email redesign, split single-family vs multifamily.
--
-- The approved design (celebration hero, centered details, add-to-calendar,
-- What-happens-next) is applied as two variants:
--   * SINGLE-FAMILY / homeowner  -> the global NT-00002 default (applies to all
--     work types without a specific override). Homeowner-facing wording
--     ("an adult should be home"); no tenant / common-area language.
--   * MULTIFAMILY / whole-building -> new rows scoped to the two multifamily
--     work types (energy + diagnostic). Owner/manager-facing wording.
--
-- Merge fields resolve against the fire-notification appointment context:
-- {{company.name}} (state-specific full legal name), {{company.program_phone}}
-- (state program phone), {{contact.first_name}}, {{property.*}},
-- {{appointment.start_date/start_time/end_time/manage_url/gcal_url/outlook_url}}.

-- ── Single-family (global default NT-00002) ─────────────────────────────────
UPDATE notification_templates
SET nt_name = 'Booking Confirmation — Email (Single-Family)',
    nt_subject_line = 'Your home energy assessment is scheduled',
    nt_body = $sf$<style>@media only screen and (max-width:480px){.px{padding-left:20px!important;padding-right:20px!important}.hero-h1{font-size:24px!important;line-height:30px!important}.body-tx{font-size:16px!important;line-height:24px!important}.cal-btn{display:block!important;margin:6px 0!important}}</style>
<div style="margin:0;padding:0;background:#eef1f6;font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:32px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(13,26,46,.10);">
<tr><td style="background:#07111f;padding:24px 32px;text-align:center;"><span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.01em;">{{company.name}}</span></td></tr>
<tr><td class="px" style="background:#e9faf1;padding:40px 32px 34px;text-align:center;">
<div style="display:inline-block;width:62px;height:62px;border-radius:50%;background:#ffffff;line-height:62px;font-size:30px;color:#1f9d67;box-shadow:0 2px 6px rgba(31,157,103,.20);margin-bottom:16px;">&#10003;</div>
<div style="color:#1f9d67;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px;">You&rsquo;re all set</div>
<h1 class="hero-h1" style="margin:0 0 10px;color:#0d1a2e;font-size:26px;font-weight:800;line-height:32px;">Your home energy assessment is scheduled</h1>
<p class="body-tx" style="margin:0;color:#2f4863;font-size:16px;line-height:24px;">You&rsquo;re one step closer to lower energy costs and a more comfortable home.</p>
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
<div style="margin-top:12px;color:#6b7d97;font-size:13px;">We&rsquo;ll email you a reminder before your visit.</div>
</td></tr>
<tr><td class="px" style="padding:22px 32px 0;"><div style="border-top:1px solid #e4e9f2;"></div></td></tr>
<tr><td class="px" style="padding:22px 32px 0;">
<div style="color:#0d1a2e;font-size:16px;font-weight:700;margin-bottom:10px;text-align:center;">About the assessment</div>
<p class="body-tx" style="margin:0;color:#33455f;font-size:15px;line-height:23px;">Our energy assessment team will conduct a home energy assessment at your home. This is the first step in a program to lower energy costs and improve comfort in your home.</p>
</td></tr>
<tr><td class="px" style="padding:20px 32px 8px;">
<div style="color:#0d1a2e;font-size:16px;font-weight:700;margin-bottom:10px;text-align:center;">Getting ready</div>
<p class="body-tx" style="margin:0 0 14px;color:#33455f;font-size:15px;line-height:23px;">Please make sure an adult (18 or older) is home for the visit, and that the team can reach these areas:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="padding:0 5px 10px 0;width:50%;vertical-align:top;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 14px;background:#f5f8fc;border:1px solid #e4e9f2;border-radius:9px;color:#0d1a2e;font-size:14px;font-weight:600;"><span style="color:#2aab72;font-weight:800;">&#10003;</span>&nbsp;&nbsp;The Attic</td></tr></table></td>
<td style="padding:0 0 10px 5px;width:50%;vertical-align:top;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 14px;background:#f5f8fc;border:1px solid #e4e9f2;border-radius:9px;color:#0d1a2e;font-size:14px;font-weight:600;"><span style="color:#2aab72;font-weight:800;">&#10003;</span>&nbsp;&nbsp;Basement or Crawlspace</td></tr></table></td>
</tr>
<tr>
<td style="padding:0 5px 0 0;width:50%;vertical-align:top;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 14px;background:#f5f8fc;border:1px solid #e4e9f2;border-radius:9px;color:#0d1a2e;font-size:14px;font-weight:600;"><span style="color:#2aab72;font-weight:800;">&#10003;</span>&nbsp;&nbsp;Utility Room</td></tr></table></td>
<td style="padding:0 0 0 5px;width:50%;vertical-align:top;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 14px;background:#f5f8fc;border:1px solid #e4e9f2;border-radius:9px;color:#0d1a2e;font-size:14px;font-weight:600;"><span style="color:#2aab72;font-weight:800;">&#10003;</span>&nbsp;&nbsp;Electrical Panel</td></tr></table></td>
</tr>
</table>
</td></tr>
<tr><td class="px" style="padding:24px 32px 0;">
<div style="border-top:1px solid #e4e9f2;padding-top:22px;">
<div style="color:#0d1a2e;font-size:16px;font-weight:700;margin-bottom:16px;text-align:center;">What happens next</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="width:33.33%;vertical-align:top;text-align:center;padding:0 6px;"><div style="width:36px;height:36px;border-radius:50%;background:#e9faf1;color:#1f9d67;font-weight:800;font-size:15px;line-height:36px;margin:0 auto 10px;">1</div><div style="color:#0d1a2e;font-size:13px;font-weight:700;">Assessment</div><div style="color:#6b7d97;font-size:12px;line-height:17px;margin-top:3px;">We evaluate your home</div></td>
<td style="width:33.33%;vertical-align:top;text-align:center;padding:0 6px;"><div style="width:36px;height:36px;border-radius:50%;background:#f2f5fa;color:#6b7d97;font-weight:800;font-size:15px;line-height:36px;margin:0 auto 10px;">2</div><div style="color:#0d1a2e;font-size:13px;font-weight:700;">Assessment Report</div><div style="color:#6b7d97;font-size:12px;line-height:17px;margin-top:3px;">You get findings &amp; savings opportunities</div></td>
<td style="width:33.33%;vertical-align:top;text-align:center;padding:0 6px;"><div style="width:36px;height:36px;border-radius:50%;background:#f2f5fa;color:#6b7d97;font-weight:800;font-size:15px;line-height:36px;margin:0 auto 10px;">3</div><div style="color:#0d1a2e;font-size:13px;font-weight:700;">Finalize Project Scope</div><div style="color:#6b7d97;font-size:12px;line-height:17px;margin-top:3px;">We define the upgrades &amp; next steps</div></td>
</tr></table>
</div>
</td></tr>
<tr><td class="px" style="padding:26px 32px 32px;text-align:center;"><div style="color:#6b7d97;font-size:13px;line-height:20px;">Questions? Reply to this email or call us at {{company.program_phone}}.<br>{{company.name}}</div></td></tr>
</table>
</td></tr></table>
</div>$sf$,
    nt_updated_at = now()
WHERE nt_record_number = 'NT-00002' AND nt_is_deleted IS NOT TRUE;

-- ── Multifamily (scoped to both multifamily work types) ─────────────────────
INSERT INTO notification_templates
  (nt_record_number, nt_name, nt_trigger_event, nt_channel, nt_subject_line, nt_body, work_type_id, nt_is_active, nt_is_deleted)
SELECT '', 'Booking Confirmation — Email (Multifamily)', 'booking_confirmation', 'email',
  'Your multifamily building assessment is scheduled',
  $mf$<style>@media only screen and (max-width:480px){.px{padding-left:20px!important;padding-right:20px!important}.hero-h1{font-size:24px!important;line-height:30px!important}.body-tx{font-size:16px!important;line-height:24px!important}.cal-btn{display:block!important;margin:6px 0!important}}</style>
<div style="margin:0;padding:0;background:#eef1f6;font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:32px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(13,26,46,.10);">
<tr><td style="background:#07111f;padding:24px 32px;text-align:center;"><span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.01em;">{{company.name}}</span></td></tr>
<tr><td class="px" style="background:#e9faf1;padding:40px 32px 34px;text-align:center;">
<div style="display:inline-block;width:62px;height:62px;border-radius:50%;background:#ffffff;line-height:62px;font-size:30px;color:#1f9d67;box-shadow:0 2px 6px rgba(31,157,103,.20);margin-bottom:16px;">&#10003;</div>
<div style="color:#1f9d67;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px;">You&rsquo;re all set</div>
<h1 class="hero-h1" style="margin:0 0 10px;color:#0d1a2e;font-size:26px;font-weight:800;line-height:32px;">Your multifamily building assessment is scheduled</h1>
<p class="body-tx" style="margin:0;color:#2f4863;font-size:16px;line-height:24px;">You&rsquo;re one step closer to lower energy costs and a more comfortable building for <strong style="color:#0d1a2e;">{{property.name}}</strong>.</p>
</td></tr>
<tr><td class="px" style="padding:28px 32px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe2ee;border-radius:12px;"><tr><td style="padding:24px 24px;text-align:center;">
<div style="color:#6b7d97;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">When</div>
<div style="color:#0d1a2e;font-size:16px;font-weight:700;">{{appointment.start_date}}</div>
<div style="color:#33455f;font-size:15px;margin-top:2px;">{{appointment.start_time}} &ndash; {{appointment.end_time}}</div>
<div style="border-top:1px solid #eef1f6;margin:18px 0;"></div>
<div style="color:#6b7d97;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Location</div>
<div style="color:#0d1a2e;font-size:16px;font-weight:700;">{{property.name}}</div>
<div style="color:#33455f;font-size:15px;margin-top:2px;">{{property.street}}, {{property.city_state_zip}}</div>
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
<div style="margin-top:12px;color:#6b7d97;font-size:13px;">We&rsquo;ll email you a reminder before your visit.</div>
</td></tr>
<tr><td class="px" style="padding:22px 32px 0;"><div style="border-top:1px solid #e4e9f2;"></div></td></tr>
<tr><td class="px" style="padding:22px 32px 0;">
<div style="color:#0d1a2e;font-size:16px;font-weight:700;margin-bottom:10px;text-align:center;">About the assessment</div>
<p class="body-tx" style="margin:0;color:#33455f;font-size:15px;line-height:23px;">Our energy assessment team will conduct a whole-building energy assessment at {{property.name}}. This is the first step in a program to lower energy costs and improve comfort throughout the building.</p>
</td></tr>
<tr><td class="px" style="padding:20px 32px 8px;">
<div style="color:#0d1a2e;font-size:16px;font-weight:700;margin-bottom:10px;text-align:center;">Access needed</div>
<p class="body-tx" style="margin:0 0 14px;color:#33455f;font-size:15px;line-height:23px;">Please make sure these areas are accessible for the energy assessment team:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="padding:0 5px 10px 0;width:50%;vertical-align:top;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 14px;background:#f5f8fc;border:1px solid #e4e9f2;border-radius:9px;color:#0d1a2e;font-size:14px;font-weight:600;"><span style="color:#2aab72;font-weight:800;">&#10003;</span>&nbsp;&nbsp;Common Areas</td></tr></table></td>
<td style="padding:0 0 10px 5px;width:50%;vertical-align:top;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 14px;background:#f5f8fc;border:1px solid #e4e9f2;border-radius:9px;color:#0d1a2e;font-size:14px;font-weight:600;"><span style="color:#2aab72;font-weight:800;">&#10003;</span>&nbsp;&nbsp;Mechanical Rooms</td></tr></table></td>
</tr>
<tr>
<td style="padding:0 5px 0 0;width:50%;vertical-align:top;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 14px;background:#f5f8fc;border:1px solid #e4e9f2;border-radius:9px;color:#0d1a2e;font-size:14px;font-weight:600;"><span style="color:#2aab72;font-weight:800;">&#10003;</span>&nbsp;&nbsp;The Attic</td></tr></table></td>
<td style="padding:0 0 0 5px;width:50%;vertical-align:top;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 14px;background:#f5f8fc;border:1px solid #e4e9f2;border-radius:9px;color:#0d1a2e;font-size:14px;font-weight:600;"><span style="color:#2aab72;font-weight:800;">&#10003;</span>&nbsp;&nbsp;Exterior Buildings</td></tr></table></td>
</tr>
</table>
</td></tr>
<tr><td class="px" style="padding:24px 32px 0;">
<div style="border-top:1px solid #e4e9f2;padding-top:22px;">
<div style="color:#0d1a2e;font-size:16px;font-weight:700;margin-bottom:16px;text-align:center;">What happens next</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="width:33.33%;vertical-align:top;text-align:center;padding:0 6px;"><div style="width:36px;height:36px;border-radius:50%;background:#e9faf1;color:#1f9d67;font-weight:800;font-size:15px;line-height:36px;margin:0 auto 10px;">1</div><div style="color:#0d1a2e;font-size:13px;font-weight:700;">Assessment</div><div style="color:#6b7d97;font-size:12px;line-height:17px;margin-top:3px;">We evaluate the whole building</div></td>
<td style="width:33.33%;vertical-align:top;text-align:center;padding:0 6px;"><div style="width:36px;height:36px;border-radius:50%;background:#f2f5fa;color:#6b7d97;font-weight:800;font-size:15px;line-height:36px;margin:0 auto 10px;">2</div><div style="color:#0d1a2e;font-size:13px;font-weight:700;">Assessment Report</div><div style="color:#6b7d97;font-size:12px;line-height:17px;margin-top:3px;">You get findings &amp; savings opportunities</div></td>
<td style="width:33.33%;vertical-align:top;text-align:center;padding:0 6px;"><div style="width:36px;height:36px;border-radius:50%;background:#f2f5fa;color:#6b7d97;font-weight:800;font-size:15px;line-height:36px;margin:0 auto 10px;">3</div><div style="color:#0d1a2e;font-size:13px;font-weight:700;">Finalize Project Scope</div><div style="color:#6b7d97;font-size:12px;line-height:17px;margin-top:3px;">We define the upgrades &amp; next steps</div></td>
</tr></table>
</div>
</td></tr>
<tr><td class="px" style="padding:26px 32px 32px;text-align:center;"><div style="color:#6b7d97;font-size:13px;line-height:20px;">Questions? Reply to this email or call us at {{company.program_phone}}.<br>{{company.name}}</div></td></tr>
</table>
</td></tr></table>
</div>$mf$,
  wt.id, true, false
FROM (VALUES
  ('e2c23552-e64f-4ab1-a0d4-026bb015fa2b'::uuid),
  ('6bdfd1e4-9615-4710-81e1-230314749604'::uuid)
) AS wt(id)
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt
  WHERE nt.nt_trigger_event = 'booking_confirmation'
    AND nt.nt_channel = 'email'
    AND nt.work_type_id = wt.id
    AND nt.nt_is_deleted IS NOT TRUE
);
