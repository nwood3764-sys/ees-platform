-- =============================================================================
-- Dragging an email onto a record files it — and records who was involved.
--
-- Nicholas, 2026-08-25: "I need to be able to drag over an email and add it to
-- a contact record or an account in the Conversations tab, and it logs it
-- correctly by reading who's involved."
--
-- Before this, an email only entered LEAP two ways: LEAP sent it through
-- Microsoft Graph, or Graph delivered a reply that the reply-token matched to
-- an existing thread. An email that happened anywhere else — a message sent
-- from someone's own Outlook, a forward from a program administrator, a thread
-- that started before the account existed — had no route in at all.
--
-- Three purpose-named artifacts, none of them a widening of the send path:
--
--   resolve_email_participants(text[])       — who each address is
--   import_email_into_conversation(...)      — file one parsed email
--   message_participants (MPART-)            — the answer, kept
--
-- "Reading who's involved" is a FACT WE STORE, not a parse-time guess that
-- disappears once the message row is written. Every From/To/Cc address of an
-- imported email becomes a message_participants row carrying the address, the
-- display name as it appeared, and what it resolved to (a contact, an account,
-- an EES user, one of our own mailboxes, or nothing). An address that matched
-- nobody is recorded as unmatched rather than dropped, so the gap is visible
-- and can be closed by creating the contact later.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The messages table learns that an email can ARRIVE rather than be sent.
-- -----------------------------------------------------------------------------

-- msg_provider names how the message travelled. An imported email did not go
-- through Twilio or through our Graph client — it was handed to LEAP as a file.
-- Saying 'microsoft_graph' would be a lie about provenance on a message we
-- never sent or received programmatically.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_msg_provider_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_msg_provider_check
  CHECK (msg_provider = ANY (ARRAY['twilio'::text, 'microsoft_graph'::text, 'manual_import'::text]));

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS msg_cc_address        text,
  ADD COLUMN IF NOT EXISTS msg_import_source     text,
  ADD COLUMN IF NOT EXISTS msg_import_file_name  text,
  ADD COLUMN IF NOT EXISTS msg_imported_by       uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS msg_imported_at       timestamptz;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_msg_import_source_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_msg_import_source_check
  CHECK (msg_import_source IS NULL OR msg_import_source = ANY (ARRAY[
    'outlook_msg_file'::text,   -- .msg dragged from Outlook or the file system
    'eml_file'::text,           -- .eml / RFC-5322 source file
    'dragged_text'::text,       -- a drag that carried only text/html + text/plain
    'pasted_text'::text         -- headers + body pasted into the composer
  ]));

COMMENT ON COLUMN public.messages.msg_cc_address IS
  'Cc line of an imported email, addresses separated by "; ". Sent messages leave this null — LEAP''s own send path has no Cc field.';
COMMENT ON COLUMN public.messages.msg_import_source IS
  'How an imported email reached LEAP. Null on every message LEAP itself sent or received through a provider.';

-- Two imports of the same email must not produce two message rows. The
-- Internet Message-ID is the only identifier that survives a forward, a save
-- to .msg and a re-drop, so it is the dedupe key. Partial: only imported rows
-- carry one reliably, and Graph rows already use msg_external_message_id for
-- their own purposes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_imported_internet_id
  ON public.messages (msg_external_message_id)
  WHERE msg_import_source IS NOT NULL
    AND msg_external_message_id IS NOT NULL
    AND msg_is_deleted = false;

-- -----------------------------------------------------------------------------
-- 2. message_participants — who was on the email.
-- -----------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.seq_message_participants;

CREATE TABLE IF NOT EXISTS public.message_participants (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mpart_record_number    text NOT NULL,
  message_id             uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  mpart_role             text NOT NULL,
  mpart_address          text NOT NULL,
  mpart_display_name     text,
  mpart_matched_object   text,
  mpart_matched_id       uuid,
  mpart_match_basis      text NOT NULL DEFAULT 'unmatched',
  mpart_is_ees_side      boolean NOT NULL DEFAULT false,
  contact_id             uuid REFERENCES public.contacts(id),
  account_id             uuid REFERENCES public.accounts(id),
  mpart_created_at       timestamptz NOT NULL DEFAULT now(),
  mpart_created_by       uuid REFERENCES public.users(id),
  mpart_updated_at       timestamptz NOT NULL DEFAULT now(),
  mpart_updated_by       uuid REFERENCES public.users(id),
  mpart_is_deleted       boolean NOT NULL DEFAULT false,
  mpart_deleted_at       timestamptz,
  mpart_deleted_by       uuid REFERENCES public.users(id),
  mpart_deletion_reason  text,
  is_seed_data           boolean NOT NULL DEFAULT false,
  CONSTRAINT message_participants_role_check
    CHECK (mpart_role = ANY (ARRAY['from'::text, 'to'::text, 'cc'::text, 'bcc'::text])),
  CONSTRAINT message_participants_match_basis_check
    CHECK (mpart_match_basis = ANY (ARRAY[
      'outbound_mailbox'::text,        -- one of our own program mailboxes
      'user_email'::text,              -- an EES staff user
      'contact_email'::text,           -- a contact's own address
      'account_email'::text,           -- the company's general address
      'account_website_domain'::text,  -- the domain belongs to exactly one account
      'unmatched'::text                -- nobody in LEAP owns this address
    ])),
  CONSTRAINT message_participants_matched_pair_check
    CHECK ((mpart_matched_object IS NULL) = (mpart_matched_id IS NULL))
);

COMMENT ON TABLE public.message_participants IS
  'One row per From/To/Cc/Bcc address on an imported email, with what that address resolved to in LEAP. Written by import_email_into_conversation. An address that matched nobody is kept as unmatched rather than dropped, so the gap stays visible.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_mpart_message_role_address
  ON public.message_participants (message_id, mpart_role, lower(mpart_address))
  WHERE mpart_is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_mpart_message   ON public.message_participants (message_id);
CREATE INDEX IF NOT EXISTS idx_mpart_contact   ON public.message_participants (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mpart_account   ON public.message_participants (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mpart_address   ON public.message_participants (lower(mpart_address));

CREATE OR REPLACE FUNCTION public.set_message_participant_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.mpart_record_number IS NULL OR NEW.mpart_record_number = '' THEN
    NEW.mpart_record_number := public.generate_record_number('MPART-', 'seq_message_participants');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mpart_record_number ON public.message_participants;
CREATE TRIGGER trg_mpart_record_number
  BEFORE INSERT ON public.message_participants
  FOR EACH ROW EXECUTE FUNCTION public.set_message_participant_number();

DROP TRIGGER IF EXISTS trg_mpart_block_hard_delete ON public.message_participants;
CREATE TRIGGER trg_mpart_block_hard_delete
  BEFORE DELETE ON public.message_participants
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

ALTER TABLE public.message_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_select_message_participants ON public.message_participants;
CREATE POLICY app_select_message_participants ON public.message_participants
  FOR SELECT TO authenticated
  USING ((SELECT public.app_user_can('message_participants','read')));

DROP POLICY IF EXISTS app_insert_message_participants ON public.message_participants;
CREATE POLICY app_insert_message_participants ON public.message_participants
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.app_user_can('message_participants','create')));

DROP POLICY IF EXISTS app_update_message_participants ON public.message_participants;
CREATE POLICY app_update_message_participants ON public.message_participants
  FOR UPDATE TO authenticated
  USING ((SELECT public.app_user_can('message_participants','update')));

DROP POLICY IF EXISTS app_delete_message_participants ON public.message_participants;
CREATE POLICY app_delete_message_participants ON public.message_participants
  FOR DELETE TO authenticated
  USING ((SELECT public.app_user_can('message_participants','delete')));

-- Object access mirrors `messages` exactly: anyone who may read a message may
-- read who was on it, and nobody gains an object they did not already have.
INSERT INTO public.role_object_access (roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
SELECT roa_role_id, 'message_participants', roa_read, roa_create, roa_update, roa_delete
FROM public.role_object_access
WHERE roa_object_name = 'messages'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_object_access x
    WHERE x.roa_object_name = 'message_participants' AND x.roa_role_id = role_object_access.roa_role_id
  );

-- Geographic (state) record access: a participant row is in scope when its
-- message is. Registered so record_state_scope_status() keeps reporting the
-- object as classified rather than silently unscoped.
INSERT INTO public.record_state_scope_sources (
  rsss_record_number, rsss_object_name, rsss_resolution_kind,
  rsss_parent_object_name, rsss_parent_fk_column, rsss_path_order, rsss_notes
)
SELECT '', 'message_participants', 'parent_lookup', 'messages', 'message_id', 1,
       'A participant is in scope when the message it belongs to is.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.record_state_scope_sources
  WHERE rsss_object_name = 'message_participants' AND rsss_is_deleted = false
);

SELECT public.install_record_state_scoping('message_participants');

SELECT public.install_record_audit_stamping('message_participants');

NOTIFY pgrst, 'reload schema';
