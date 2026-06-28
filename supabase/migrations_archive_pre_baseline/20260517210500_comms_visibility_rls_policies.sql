-- ─── Visibility RLS policies ─────────────────────────────────────────
-- Replaces the existing SELECT policies on messages, conversations, and
-- message_ai_transcripts with versions that enforce the LEAP Communications
-- visibility model:
--
--   • Admin short-circuits true.
--   • Conversations + messages are visible if the caller is admin, a
--     recipient, on the anchor-opportunity contact roles (with comms flag),
--     the record owner anywhere in the chain, or holds communications:view-all.
--   • Message AI transcripts are stricter: admin, composing user (mat_owner),
--     record owner of the anchoring conversation, or communications:view-all.
--     No contact-role visibility — candid AI framing isn't for recipients.
--
-- The existing object-level role_object_access gate (app_user_can) remains
-- a precondition so locked-out roles (external portal users without
-- communications scope, for example) never reach this layer.
--
-- Service-role callers (edge functions) bypass RLS entirely, so this only
-- affects supabase-js calls from the authenticated browser session.

drop policy if exists app_select_conversations on public.conversations;
create policy app_select_conversations on public.conversations
  for select using (
    app_user_can('conversations', 'read')
    and (
      is_admin()
      or has_communications_view_all()
      or is_recipient(id)
      or is_on_anchor_opportunity_contact_roles(id)
      or is_record_owner_in_chain(id)
    )
  );

drop policy if exists app_select_messages on public.messages;
create policy app_select_messages on public.messages
  for select using (
    app_user_can('messages', 'read')
    and (
      is_admin()
      or has_communications_view_all()
      or msg_created_by = current_app_user_id()
      or is_recipient(conversation_id)
      or is_on_anchor_opportunity_contact_roles(conversation_id)
      or is_record_owner_in_chain(conversation_id)
    )
  );

drop policy if exists app_select_message_ai_transcripts on public.message_ai_transcripts;
create policy app_select_message_ai_transcripts on public.message_ai_transcripts
  for select using (
    app_user_can('message_ai_transcripts', 'read')
    and (
      is_admin()
      or has_communications_view_all()
      or mat_owner = current_app_user_id()
      or exists (
        select 1
        from public.messages m
        where m.id = mat_message_id
          and is_record_owner_in_chain(m.conversation_id)
      )
    )
  );
