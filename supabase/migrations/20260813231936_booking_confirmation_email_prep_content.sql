-- Customer booking-confirmation email (NT-00002): expand the customer-guidance
-- content so it tells the homeowner what the visit is, what to expect, and how
-- to prepare — not just the appointment details. Same layout/branding as the
-- shipped template; the middle content section is rebuilt. The {{...}} tokens
-- resolve against the fire-notification appointment context
-- (contact / appointment / property / auditor / company).

UPDATE notification_templates
SET nt_body = $html$<div style="margin:0;padding:0;background:#f0f3f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f3f8;padding:24px 0;font-family:Inter,Arial,Helvetica,sans-serif;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e4e9f2;border-radius:8px;overflow:hidden;">
<tr><td style="background:#07111f;padding:20px 32px;"><span style="color:#ffffff;font-size:16px;font-weight:600;letter-spacing:.01em;">{{company.name}}</span></td></tr>
<tr><td style="padding:32px 32px 8px;">
<h1 style="margin:0 0 8px;color:#0d1a2e;font-size:22px;font-weight:700;line-height:28px;">You're confirmed, {{contact.first_name}}.</h1>
<p style="margin:0 0 24px;color:#4a5e7a;font-size:15px;line-height:22px;">Thanks for scheduling your {{appointment.work_type_label}}. Here's everything you need to know before your visit.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border:1px solid #e4e9f2;border-radius:8px;"><tr><td style="padding:20px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:6px 0;color:#8fa0b8;font-size:11px;text-transform:uppercase;letter-spacing:.05em;width:88px;vertical-align:top;">When</td><td style="padding:6px 0;color:#0d1a2e;font-size:15px;font-weight:600;">{{appointment.start_date}}</td></tr>
<tr><td style="padding:6px 0;color:#8fa0b8;font-size:11px;text-transform:uppercase;letter-spacing:.05em;vertical-align:top;">Time</td><td style="padding:6px 0;color:#0d1a2e;font-size:15px;font-weight:600;">{{appointment.start_time}} to {{appointment.end_time}}</td></tr>
<tr><td style="padding:6px 0;color:#8fa0b8;font-size:11px;text-transform:uppercase;letter-spacing:.05em;vertical-align:top;">Where</td><td style="padding:6px 0;color:#0d1a2e;font-size:15px;font-weight:600;">{{property.street}}<br><span style="font-weight:400;color:#4a5e7a;">{{property.city_state_zip}}</span></td></tr>
<tr><td style="padding:6px 0;color:#8fa0b8;font-size:11px;text-transform:uppercase;letter-spacing:.05em;vertical-align:top;">Auditor</td><td style="padding:6px 0;color:#0d1a2e;font-size:15px;font-weight:600;">{{auditor.full_name}}</td></tr>
</table>
</td></tr></table>
<p style="margin:24px 0 8px;color:#0d1a2e;font-size:15px;font-weight:600;">What to expect</p>
<ul style="margin:0 0 20px;padding-left:20px;color:#4a5e7a;font-size:14px;line-height:22px;">
<li>Plan for about 30&ndash;45 minutes. It's a visual, non-invasive walk-through &mdash; nothing gets torn out or damaged.</li>
<li>Your auditor will look at insulation, air sealing, heating and cooling, water heating, and major appliances, and may take photos and quick measurements.</li>
<li>Some visits include a simple air-leakage (blower-door) test, where a fan is briefly placed in an exterior doorway.</li>
<li>Afterward you'll get a clear summary of findings and the upgrades and rebates you may qualify for.</li>
</ul>
<p style="margin:0 0 8px;color:#0d1a2e;font-size:15px;font-weight:600;">How to prepare</p>
<ul style="margin:0 0 20px;padding-left:20px;color:#4a5e7a;font-size:14px;line-height:22px;">
<li>Make sure we can reach your attic, basement or crawlspace, mechanical/utility room, and electrical panel &mdash; please clear about 3 feet of space around the furnace and water heater.</li>
<li>An adult (18 or older) needs to be home for the entire visit.</li>
<li>Secure any pets that may be anxious around visitors.</li>
<li>If you have a recent energy bill handy, it's helpful &mdash; but not required.</li>
<li>Jot down any comfort or efficiency issues you've noticed (drafty rooms, high bills, uneven temperatures) so you can mention them.</li>
</ul>
<p style="margin:0 0 24px;color:#4a5e7a;font-size:14px;line-height:22px;">On the day of your visit, {{auditor.full_name}} will send you a text when they're on the way.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#3ecf8e;"><a href="{{appointment.manage_url}}" style="display:inline-block;padding:13px 28px;color:#07111f;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">Reschedule or modify your appointment</a></td></tr></table>
</td></tr>
<tr><td style="background:#f7f9fc;border-top:1px solid #e4e9f2;padding:20px 32px;"><p style="margin:0;color:#8fa0b8;font-size:12px;line-height:18px;">Questions? Call us at {{company.phone}} or simply reply to this email.<br>{{company.name}}</p></td></tr>
</table></td></tr></table></div>$html$,
    nt_updated_at = now()
WHERE nt_record_number = 'NT-00002' AND nt_is_deleted IS NOT TRUE;
