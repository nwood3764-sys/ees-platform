-- ─── Column additions across existing tables ──────────────────────────
-- Per LEAP Communications spec.

-- 1. email_templates: locked regions + AI-assist flag + default mailbox FK
alter table public.email_templates
  add column if not exists template_locked_regions jsonb not null default '[]'::jsonb,
  add column if not exists template_ai_assist_allowed boolean not null default true,
  add column if not exists template_default_outbound_mailbox_id uuid references public.outbound_mailboxes(id);

comment on column public.email_templates.template_locked_regions is
  'Array of region objects defining locked vs editable sections of the template body. Each region: {region_id, region_type (locked|editable), region_content (locked only), region_placeholder (editable only), region_order}. Locked regions cannot be modified by users or AI; the send pipeline validates the composed body against these before sending.';
comment on column public.email_templates.template_ai_assist_allowed is
  'When false, the AI-assist button is hidden in compose for this template. Set false for compliance-sensitive templates (HUD, HAF, legal).';
comment on column public.email_templates.template_default_outbound_mailbox_id is
  'Optional override of the auto-derived mailbox selection. When null, send-email-v1 picks the mailbox from the anchoring record program/state.';

-- 2. messages: AI-assist metadata. msg_provider_message_id already serves
--    the spec's message_external_message_id role for In-Reply-To matching;
--    no duplicate column needed.
alter table public.messages
  add column if not exists msg_ai_assisted boolean not null default false,
  add column if not exists msg_ai_iterations integer not null default 0;

comment on column public.messages.msg_ai_assisted is
  'True if any AI iteration was used in composition of this outbound message. Inbound messages always false. Surfaced in the audit log alongside msg_created_by.';
comment on column public.messages.msg_ai_iterations is
  'Count of AI iterations (user prompts to the AI assistant) used to compose this message. Zero for inbound or fully-manual outbound.';
comment on column public.messages.msg_provider_message_id is
  'External message id from the underlying transport: Twilio SID for SMS, Microsoft Graph internetMessageId for email. Used by the inbound webhook for In-Reply-To / References header matching to thread replies onto the originating conversation. Mock-mode IDs are prefixed mock-<uuid>.';

-- 3. opportunity_contact_roles: communications visibility flag.
alter table public.opportunity_contact_roles
  add column if not exists ocr_includes_communications boolean not null default true;

comment on column public.opportunity_contact_roles.ocr_includes_communications is
  'When true (default), this contact role confers visibility of messages/conversations anchored under this opportunity to the contact''s linked user. Set false for tracking-only roles that should not see correspondence.';

-- 4. users: voice profile fields, opt-in passive style profile for AI.
alter table public.users
  add column if not exists user_voice_profile_enabled boolean not null default false,
  add column if not exists user_voice_profile_style_signals jsonb not null default '{}'::jsonb;

comment on column public.users.user_voice_profile_enabled is
  'When true, the AI-compose assistant uses this user''s accumulated style signals as guidance. Passively built from sent emails; user can review and reset.';
comment on column public.users.user_voice_profile_style_signals is
  'Style-signal payload (sentence length distribution, formality markers, sign-off preferences, common phrasings). Populated by ai-compose-assist over time. Resettable via the user settings page.';
