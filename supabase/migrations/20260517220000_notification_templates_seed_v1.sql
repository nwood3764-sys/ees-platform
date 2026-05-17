-- ─── Notification templates seed ──────────────────────────────────────
-- One row per (trigger_event, channel) combination across the 10 trigger
-- events the platform supports. `nt_body` is the raw template with
-- {{merge_field}} tokens; the future notification orchestrator (not built
-- yet) resolves them at send time against the appointment context.
--
-- Merge-field vocabulary mirrors the PRG conventions (dotted paths). The
-- intended resolution context for a notification render is:
--   { appointment, contact, auditor, property, work_type, company }
-- with `appointment.manage_url` being the customer's single-use token
-- URL — the same value create-service-appointment v1 already returns in
-- its 200 response payload.
--
-- nt_send_offset_minutes encodes when the notification fires RELATIVE to
-- appointment.start_at:
--   -2880  =  48 hours before
--   -1440  =  24 hours before
--    NULL  =  fired by event (booking_confirmation, on_my_way, arrived,
--             completed, rescheduled, canceled) or computed by the
--             orchestrator (reminder_morning_of → 8:00 AM local day-of).
--
-- nt_channel uses one row per channel rather than 'both' so each channel
-- gets its own body wording — SMS short, email longer. The orchestrator
-- can pick which channel(s) to fire per customer preference + row existence.
--
-- work_type_id stays NULL for the global defaults. Per-work-type overrides
-- (e.g. a different Multifamily Energy Assessment confirmation) can be
-- added as additional rows alongside; the orchestrator should prefer a
-- matching work_type row when one exists, else the NULL global default.

insert into notification_templates (
  nt_record_number, nt_name, nt_trigger_event, nt_channel,
  nt_subject_line, nt_body, nt_send_offset_minutes, nt_is_active
) values

-- ─── booking_confirmation ─────────────────────────────────────────────
('', 'Booking Confirmation — SMS',
 'booking_confirmation', 'sms',
 null,
 'Hi {{contact.first_name}}, your {{appointment.work_type_name}} with EES-WI is confirmed for {{appointment.start_date}} between {{appointment.start_time}} and {{appointment.end_time}}. Manage or reschedule: {{appointment.manage_url}}',
 null, true),

('', 'Booking Confirmation — Email',
 'booking_confirmation', 'email',
 'Your {{appointment.work_type_name}} is confirmed for {{appointment.start_date}}',
 'Hi {{contact.first_name}},

Thanks for scheduling with Energy Efficiency Services of Wisconsin. Your {{appointment.work_type_name}} is confirmed for the following window:

  {{appointment.start_date}}
  {{appointment.start_time}} – {{appointment.end_time}}
  {{property.street}}
  {{property.city_state_zip}}

Your assigned auditor is {{auditor.full_name}}. They will reach out by text on the day of the appointment when they''re on the way.

Need to reschedule or cancel? Visit {{appointment.manage_url}} any time. The link is single-use to you — please don''t share it.

Questions? Reply to this email or call us at {{company.phone}}.

— The EES-WI team',
 null, true),

-- ─── reminder_48hr (email only — long-lead reminder is more email) ────
('', 'Reminder — 48 hours before — Email',
 'reminder_48hr', 'email',
 'Reminder: {{appointment.work_type_name}} in 2 days',
 'Hi {{contact.first_name}},

Just a heads up — your {{appointment.work_type_name}} with EES-WI is coming up in two days:

  {{appointment.start_date}}
  {{appointment.start_time}} – {{appointment.end_time}}
  {{property.street}}, {{property.city_state_zip}}

Your assigned auditor is {{auditor.full_name}}. They will text you on the day of the appointment when they''re on their way.

A few things that help us run on time:
  • Please make sure all rooms in the home are accessible.
  • Crate or secure pets if they''re anxious around new people.
  • The auditor will need access to the attic, basement, and utility room.

Need to reschedule? {{appointment.manage_url}}

— The EES-WI team',
 -2880, true),

-- ─── reminder_24hr (SMS only at this range) ───────────────────────────
('', 'Reminder — 24 hours before — SMS',
 'reminder_24hr', 'sms',
 null,
 'Hi {{contact.first_name}}, your {{appointment.work_type_name}} with EES-WI is tomorrow {{appointment.start_date}} at {{appointment.start_time}}. {{auditor.first_name}} will text when on the way. Reschedule: {{appointment.manage_url}}',
 -1440, true),

-- ─── reminder_morning_of ──────────────────────────────────────────────
('', 'Reminder — morning of — SMS',
 'reminder_morning_of', 'sms',
 null,
 'Good morning {{contact.first_name}}, your EES-WI appointment is today {{appointment.start_time}}–{{appointment.end_time}}. {{auditor.first_name}} will text when on the way. Reschedule (today still possible): {{appointment.manage_url}}',
 null, true),

-- ─── on_my_way ────────────────────────────────────────────────────────
('', 'On My Way — SMS',
 'on_my_way', 'sms',
 null,
 'Hi {{contact.first_name}}, this is {{auditor.first_name}} from EES-WI — on my way to {{property.street}} for your {{appointment.work_type_name}}. ETA about 30 minutes. Call/text {{auditor.phone}} if anything changes.',
 null, true),

-- ─── arrived ──────────────────────────────────────────────────────────
('', 'Arrived — SMS',
 'arrived', 'sms',
 null,
 'Hi {{contact.first_name}}, {{auditor.first_name}} from EES-WI has arrived at {{property.street}} for your {{appointment.work_type_name}}.',
 null, true),

-- ─── completed ────────────────────────────────────────────────────────
('', 'Completed — SMS',
 'completed', 'sms',
 null,
 'Thanks {{contact.first_name}}! Your {{appointment.work_type_name}} is complete. We''ll email a summary report within 3 business days. Questions? Reply or call {{company.phone}}.',
 null, true),

('', 'Completed — Email',
 'completed', 'email',
 'Your {{appointment.work_type_name}} is complete',
 'Hi {{contact.first_name}},

Thanks for letting EES-WI into your home today. {{auditor.full_name}} has completed the {{appointment.work_type_name}} and we''re working on your full report now.

What happens next:
  • Within 3 business days you''ll receive a detailed assessment report.
  • The report will include recommended improvements, estimated savings, and any incentive programs your home qualifies for.
  • Once you''ve reviewed it, your dedicated project coordinator will reach out to discuss next steps.

In the meantime, if you have any immediate questions, reply to this email or call us at {{company.phone}}.

— The EES-WI team',
 null, true),

-- ─── rescheduled ──────────────────────────────────────────────────────
('', 'Rescheduled — SMS',
 'rescheduled', 'sms',
 null,
 'Hi {{contact.first_name}}, your EES-WI {{appointment.work_type_name}} has been rescheduled to {{appointment.start_date}} between {{appointment.start_time}} and {{appointment.end_time}}. Manage: {{appointment.manage_url}}',
 null, true),

('', 'Rescheduled — Email',
 'rescheduled', 'email',
 'Your appointment has been rescheduled',
 'Hi {{contact.first_name}},

Your {{appointment.work_type_name}} with EES-WI has been rescheduled. The new appointment time is:

  {{appointment.start_date}}
  {{appointment.start_time}} – {{appointment.end_time}}
  {{property.street}}, {{property.city_state_zip}}

Your assigned auditor is {{auditor.full_name}}. They''ll text on the day of the appointment when they''re on the way.

Need a different time? {{appointment.manage_url}}

Questions? Reply to this email or call {{company.phone}}.

— The EES-WI team',
 null, true),

-- ─── canceled ─────────────────────────────────────────────────────────
('', 'Canceled — SMS',
 'canceled', 'sms',
 null,
 'Hi {{contact.first_name}}, your EES-WI {{appointment.work_type_name}} scheduled for {{appointment.start_date}} has been canceled. To rebook, visit ees-wi.org or call {{company.phone}}.',
 null, true),

('', 'Canceled — Email',
 'canceled', 'email',
 'Your appointment has been canceled',
 'Hi {{contact.first_name}},

Your {{appointment.work_type_name}} with EES-WI scheduled for {{appointment.start_date}} at {{appointment.start_time}} has been canceled.

We''re sorry we won''t see you this time. If you''d like to rebook for another date, please visit ees-wi.org or call us at {{company.phone}}.

— The EES-WI team',
 null, true),

-- ─── dispatcher_followup_required (internal — dispatcher email) ───────
('', 'Dispatcher Follow-up Required — Email',
 'dispatcher_followup_required', 'email',
 'Dispatcher action: {{contact.full_name}} at {{property.city_state_zip}} needs scheduling help',
 'A customer just submitted a scheduling request that couldn''t be auto-assigned. Manual dispatcher follow-up needed.

Customer
  Name:    {{contact.full_name}}
  Phone:   {{contact.phone}}
  Email:   {{contact.email}}

Property
  Address: {{property.street}}, {{property.city_state_zip}}

Request
  Work type:   {{appointment.work_type_name}}
  Preferred:   {{appointment.start_date}} {{appointment.start_time}} (if any)

This usually fires when the address is out of any active service territory polygon, no qualifying technicians have open capacity in the customer''s requested window, or the work_type is dispatcher-only (HVAC Quote, Customer Consultation).

Call or email the customer within one business day with next steps.

— LEAP',
 null, true);
