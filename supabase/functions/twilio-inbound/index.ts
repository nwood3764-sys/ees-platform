// ─── twilio-inbound ─────────────────────────────────────────────────────
// Twilio Programmable SMS webhook receiver. Configure as the "When a Message
// Comes In" URL on the Twilio phone number:
//   POST https://flyjigrijjjtcsvpgzvk.supabase.co/functions/v1/twilio-inbound
//
// PROVENANCE (2026-09-05): this file was captured VERBATIM from the deployed
// v12 on production and then changed in the three ways listed below. It had
// never been committed — the function ran in production with no source in the
// repository, so a branch replay or a redeploy from `master` would have lost
// it. Same class as the out-of-band functions logged as open since 2026-07-05.
//
// Twilio posts application/x-www-form-urlencoded with these fields:
//   From         — sender's E.164 phone number (the customer)
//   To           — receiving E.164 phone number (our Twilio number)
//   Body         — text content of the message
//   MessageSid   — Twilio's unique message ID
//   AccountSid   — Twilio account that received it
//   NumMedia     — count of attached media (MMS)
//
// On receipt the function:
//   1. Validates the Twilio request signature — prevents spoofed inbound that
//      would otherwise inject messages into customer threads.
//   2. Resolves contact / account / project / service appointment via
//      resolve_contact_from_phone(From) — best-effort, nulls if no match.
//   3. A KNOWN number joins its thread: find_or_create_conversation(sms, …)
//      returns the existing open thread when there is one, so a reply to a
//      text LEAP sent lands on the record that text was Related To.
//   4. An UNKNOWN number goes to the Unmatched Inbox for a person to file —
//      see the note on that below.
//   5. Returns TwiML <Response/> so Twilio knows the webhook succeeded.
//
// Twilio expects HTTP 200 with TwiML. Anything else is logged as a delivery
// failure on Twilio's side. We always return 200 to Twilio even on internal
// errors and log details to console — auto-retries from Twilio would only
// compound the problem.
//
// ── THREE CHANGES from the deployed v12, 2026-09-05 ─────────────────────
//
// (1) AN UNSIGNED REQUEST IS REFUSED, NOT TRUSTED.
//     v12 skipped signature validation entirely when TWILIO_AUTH_TOKEN was
//     unset, and merely warned. The sending path authenticates with either an
//     API key pair OR the auth token, so texts can send perfectly while that
//     token is absent — and Twilio signs webhooks with the ACCOUNT AUTH TOKEN
//     specifically, nothing else. An unauthenticated public endpoint that
//     writes into customer conversation threads is an injection vector the
//     moment the number is live. The failure direction is now REFUSE, matching
//     the platform's standing rule that the answer is never "send" (or here,
//     never "accept") when it cannot be verified.
//     If inbound texts do not arrive, TWILIO_AUTH_TOKEN is the secret to set.
//
// (2) AN UNKNOWN NUMBER LANDS IN THE UNMATCHED INBOX, NOT NOWHERE.
//     v12 called find_or_create_conversation for every inbound text. When the
//     sender matched no contact, that created a thread carrying no contact, no
//     account and no Related To — so it appeared on no record page anywhere
//     and could only be found by opening the conversations table directly.
//     `unmatched_inbox` already accepts ui_channel='sms' and
//     ui_provider='twilio' by check constraint: it was built for this and
//     never used (all 645 rows are email). A text from a number LEAP does not
//     recognise is now filed there for a person to place, which is the same
//     manual-triage path email uses (Nicholas, 2026-09-05: logging is manual,
//     not automatic).
//
// (3) RELATED TO IS STATED, NOT INFERRED.
//     A thread for a known contact passes p_anchor_object='contacts' so the
//     thread is explicitly Related To that contact. An existing thread keeps
//     the Related To it already has — find_or_create only fills a blank one —
//     so a reply to a text sent from a work order stays on the work order.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-twilio-signature",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return twimlEmpty()  // Twilio retries on non-200; always succeed

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const twilioToken  = Deno.env.get("TWILIO_AUTH_TOKEN")
  if (!supabaseUrl || !serviceKey) {
    console.error("twilio-inbound: Supabase service-role key missing — cannot persist")
    return twimlEmpty()
  }

  // Parse the form body
  let formText: string
  try { formText = await req.text() } catch { return twimlEmpty() }
  const params = new URLSearchParams(formText)

  // Signature validation — prevents spoofed inbound. Twilio computes the
  // signature as HMAC-SHA1(token, url + sorted_form_params_concatenated).
  // No token means no way to tell a real Twilio delivery from anyone on the
  // internet posting into a customer's thread, so nothing is accepted.
  if (!twilioToken) {
    console.error(
      "twilio-inbound: TWILIO_AUTH_TOKEN is not configured, so an inbound text cannot be " +
      "verified as coming from Twilio. Refusing every inbound message until it is set. " +
      "It is the ACCOUNT auth token — an API key secret does not sign webhooks.",
    )
    return twimlEmpty()
  }
  {
    const sigHeader = req.headers.get("x-twilio-signature") || ""
    const webhookUrl = req.url
    const valid = await verifyTwilioSignature(twilioToken, webhookUrl, params, sigHeader)
    if (!valid) {
      console.error("twilio-inbound: signature validation FAILED for sid", params.get("MessageSid"))
      return twimlEmpty()  // Silently drop spoofed requests
    }
  }

  const from        = params.get("From")        || ""
  const to          = params.get("To")          || ""
  const body        = params.get("Body")        || ""
  const messageSid  = params.get("MessageSid")  || ""
  const numMedia    = parseInt(params.get("NumMedia") || "0", 10)

  if (!from || !to || !messageSid) {
    console.error("twilio-inbound: missing required field(s)", { from, to, messageSid })
    return twimlEmpty()
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // v1 captures MMS as a body note. Storing the media itself requires
  // downloading from Twilio before its signed URLs expire — out of scope.
  let bodyText = body
  if (numMedia > 0) {
    const mediaSummary = `[${numMedia} attached image${numMedia > 1 ? "s" : ""}]`
    bodyText = bodyText ? `${bodyText}\n\n${mediaSummary}` : mediaSummary
  }

  try {
    // Idempotency — if Twilio retried, the same MessageSid would create a
    // duplicate. One check covers both destinations below.
    const { data: existingMsg } = await supabase
      .from("messages")
      .select("id")
      .eq("msg_provider_message_id", messageSid)
      .eq("msg_is_deleted", false)
      .maybeSingle()
    if (existingMsg) {
      console.log("twilio-inbound: duplicate MessageSid, skipping", messageSid)
      return twimlEmpty()
    }
    const { data: existingUnmatched } = await supabase
      .from("unmatched_inbox")
      .select("id")
      .eq("ui_provider_message_id", messageSid)
      .eq("ui_is_deleted", false)
      .maybeSingle()
    if (existingUnmatched) {
      console.log("twilio-inbound: duplicate MessageSid already in unmatched inbox", messageSid)
      return twimlEmpty()
    }

    // Resolve customer → contact / account / project / SA (best-effort)
    const { data: ctx } = await supabase.rpc("resolve_contact_from_phone", { p_phone_e164: from })
    const resolved = Array.isArray(ctx) && ctx.length > 0 ? ctx[0] : null
    const contactId = resolved?.contact_id || null
    const accountId = resolved?.account_id || null
    const projectId = resolved?.project_id || null
    const saId      = resolved?.service_appointment_id || null

    // An existing open thread is joined whether or not the number resolves —
    // a customer who texts back from the number LEAP texted belongs on that
    // thread, and its Related To is already correct.
    const { data: openThread } = await supabase
      .from("conversations")
      .select("id, conv_record_number")
      .eq("conv_channel", "sms")
      .eq("conv_our_address", to)
      .eq("conv_customer_address", from)
      .eq("conv_status", "open")
      .eq("conv_is_deleted", false)
      .maybeSingle()

    // A text from a number LEAP does not recognise, on no existing thread,
    // goes to the Unmatched Inbox to be filed by a person. Creating a thread
    // for it would put it on no record page at all.
    if (!openThread && !contactId) {
      const { error: uiErr } = await supabase.from("unmatched_inbox").insert({
        ui_record_number:        "",
        ui_channel:              "sms",
        ui_received_at:          new Date().toISOString(),
        ui_from_address:         from,
        ui_to_address:           to,
        ui_subject:              null,
        ui_body_preview:         bodyText.slice(0, 500),
        ui_provider:             "twilio",
        ui_provider_message_id:  messageSid,
        ui_raw_payload:          Object.fromEntries(params.entries()),
        ui_status:               "awaiting_triage",
      })
      if (uiErr && uiErr.code !== "23505") {
        console.error("twilio-inbound: unmatched_inbox insert failed", uiErr)
      }
      return twimlEmpty()
    }

    // Find or create the thread. The generic Related To pair states the
    // record for a new thread; an existing thread keeps the one it has.
    const { data: convId, error: convErr } = await supabase.rpc("find_or_create_conversation", {
      p_channel:                "sms",
      p_our_address:            to,
      p_customer_address:       from,
      p_contact_id:             contactId,
      p_account_id:             accountId,
      p_project_id:             projectId,
      p_service_appointment_id: saId,
      p_subject:                null,
      p_anchor_object:          contactId ? "contacts" : null,
      p_anchor_id:              contactId,
    })
    if (convErr || !convId) {
      console.error("twilio-inbound: find_or_create_conversation failed", convErr)
      return twimlEmpty()
    }

    // Insert the inbound message — rollup trigger updates the thread
    const { error: insErr } = await supabase.from("messages").insert({
      msg_record_number:       "",
      conversation_id:         convId,
      msg_direction:           "inbound",
      msg_channel:             "sms",
      msg_from_address:        from,
      msg_to_address:          to,
      msg_body:                bodyText || "(empty message)",
      msg_provider:            "twilio",
      msg_provider_message_id: messageSid,
      msg_status:              "received",
      msg_status_updated_at:   new Date().toISOString(),
      contact_id:              contactId,
      service_appointment_id:  saId,
    })
    if (insErr) {
      console.error("twilio-inbound: message insert failed", insErr)
      return twimlEmpty()
    }
  } catch (e) {
    console.error("twilio-inbound: unhandled exception", e)
    // Fall through to empty TwiML — never make Twilio retry
  }

  return twimlEmpty()
})

// Twilio uses HMAC-SHA1 over (url + sorted param key+value concatenation),
// base64-encoded. Spec: https://www.twilio.com/docs/usage/security
async function verifyTwilioSignature(
  token: string, url: string, params: URLSearchParams, expectedSig: string,
): Promise<boolean> {
  if (!expectedSig) return false
  // Sort params by key, concatenate key + value pairs onto the URL
  const sortedKeys = [...new Set([...params.keys()])].sort()
  let payload = url
  for (const k of sortedKeys) {
    // Multiple values for the same key (Twilio rarely does this for SMS,
    // but the spec says concatenate every value)
    for (const v of params.getAll(k)) payload += k + v
  }
  const keyData = new TextEncoder().encode(token)
  const msgData = new TextEncoder().encode(payload)
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  )
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, msgData)
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
  return sigBase64 === expectedSig
}

function twimlEmpty(): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response/>`, {
    status: 200,
    headers: { ...cors, "Content-Type": "application/xml" },
  })
}
