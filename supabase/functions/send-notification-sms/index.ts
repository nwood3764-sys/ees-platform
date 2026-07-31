// ─── send-notification-sms ─────────────────────────────────────────────
// v7 — ALWAYS threads the outbound message into a conversation + messages
// row, even in pre-launch/mock mode and even when no Twilio from-number is
// configured yet. (v6 only threaded when a from-number was set, so a staff
// "New Text" send in pre-launch produced a 'sent' toast but NO record on
// the record's SMS panel.) When no real from-number exists we thread under
// a stable sentinel our-address so the conversation is visible; once
// TWILIO_FROM_NUMBER is set, new threads use the real number.
//
// Writes the outbound message into both `notification_logs` (legacy
// low-level per-attempt provider audit) AND `messages` (canonical
// conversation thread surfaced on Contact / Account / Project / Service
// Appointment panels).
//
// Customer-facing notification SMS sender. Wraps the Twilio Messages API
// (POST /Accounts/{SID}/Messages.json). Mirrors send-notification-email
// so a future notification orchestrator can dispatch by channel without
// branching at the call site.
//
// Auth model: server-to-server only. Public verify_jwt=false.
//
// Mock mode: until TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER
// are all set the function writes the notification_logs + messages rows with
// provider_message_id 'mock-<uuid>' but does NOT call Twilio. The response
// carries mode:'mock' plus which Twilio settings are still missing.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const TWILIO_MAX_BODY_CHARS = 1600
// Stable placeholder "our address" used to thread mock/pre-launch texts when
// no real Twilio from-number is configured yet, so the conversation is still
// visible on the record. Real sends always use the configured from-number.
const PENDING_FROM_ADDRESS = "sms:pending-config"

interface ReqBody {
  trigger_event:  string
  recipient_phone: string
  body_text:      string
  notification_template_id?: string
  service_appointment_id?:   string
  contact_id?:               string
  account_id?:               string
  project_id?:               string
  from_number?: string
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() as ReqBody }
  catch { return json({ error: "Invalid JSON body" }, 400) }

  const v = validate(body)
  if (v) return json({ error: v }, 400)

  const supabaseUrl   = Deno.env.get("SUPABASE_URL")
  const serviceKey    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const twilioSid     = Deno.env.get("TWILIO_ACCOUNT_SID")
  const twilioToken   = Deno.env.get("TWILIO_AUTH_TOKEN")
  const twilioFromDef = Deno.env.get("TWILIO_FROM_NUMBER")
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfiguration: Supabase keys missing" }, 500)

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // The real from-number if we have one (explicit override or env default);
  // empty string means Twilio is not yet configured with a sending number.
  const fromNumber = body.from_number || twilioFromDef || ""
  // What we thread the conversation under — always non-empty so the record
  // is created; falls back to the sentinel in pre-launch.
  const threadOurAddr = fromNumber || PENDING_FROM_ADDRESS
  const bodyTruncated = body.body_text.slice(0, TWILIO_MAX_BODY_CHARS)

  // Which Twilio settings are still missing (for a clear pre-launch response).
  const missing: string[] = []
  if (!twilioSid)     missing.push("TWILIO_ACCOUNT_SID")
  if (!twilioToken)   missing.push("TWILIO_AUTH_TOKEN")
  if (!twilioFromDef && !body.from_number) missing.push("TWILIO_FROM_NUMBER")

  // 1. notification_logs row in 'queued' (legacy low-level provider audit)
  const { data: logRow, error: insErr } = await supabase
    .from("notification_logs")
    .insert({
      nl_record_number:         "",
      notification_template_id: body.notification_template_id || null,
      service_appointment_id:   body.service_appointment_id   || null,
      contact_id:               body.contact_id               || null,
      nl_trigger_event:         body.trigger_event,
      nl_channel:               "sms",
      nl_recipient_address:     body.recipient_phone,
      nl_subject:               null,
      nl_body:                  bodyTruncated,
      nl_status:                "queued",
      nl_provider:              "twilio",
    })
    .select("id, nl_record_number")
    .single()
  if (insErr || !logRow) {
    console.error("send-notification-sms: notification_logs insert failed", insErr)
    return json({ status: "error", message: insErr?.message || "Could not log notification" }, 500)
  }

  // 2. find/create the conversation thread — ALWAYS, so there is a record on
  //    the SMS panel regardless of Twilio config state.
  let conversationId: string | null = null
  {
    const { data: convId, error: convErr } = await supabase.rpc("find_or_create_conversation", {
      p_channel:                "sms",
      p_our_address:            threadOurAddr,
      p_customer_address:       body.recipient_phone,
      p_contact_id:             body.contact_id              || null,
      p_account_id:             body.account_id              || null,
      p_project_id:             body.project_id              || null,
      p_service_appointment_id: body.service_appointment_id  || null,
      p_subject:                null,
    })
    if (convErr) {
      console.error("send-notification-sms: find_or_create_conversation failed", convErr)
    } else {
      conversationId = convId as string
    }
  }

  // 3. messages row in 'queued' for the threaded view
  let msgRowId: string | null = null
  if (conversationId) {
    const { data: msgRow, error: msgErr } = await supabase
      .from("messages")
      .insert({
        msg_record_number:        "",
        conversation_id:          conversationId,
        msg_direction:            "outbound",
        msg_channel:              "sms",
        msg_from_address:         threadOurAddr,
        msg_to_address:           body.recipient_phone,
        msg_subject:              null,
        msg_body:                 bodyTruncated,
        msg_provider:             "twilio",
        msg_status:               "queued",
        msg_status_updated_at:    new Date().toISOString(),
        notification_template_id: body.notification_template_id || null,
        service_appointment_id:   body.service_appointment_id   || null,
        contact_id:               body.contact_id               || null,
        notification_log_id:      logRow.id,
      })
      .select("id")
      .single()
    if (msgErr) {
      console.error("send-notification-sms: messages insert failed", msgErr)
    } else {
      msgRowId = msgRow.id
    }
  }

  // 4. Mock mode if Twilio not fully configured
  const mockMode = !twilioSid || !twilioToken || !fromNumber
  if (mockMode) {
    const mockId = `mock-${crypto.randomUUID()}`
    await supabase.from("notification_logs").update({
      nl_status:              "sent",
      nl_provider_message_id: mockId,
      nl_sent_at:             new Date().toISOString(),
      nl_updated_at:          new Date().toISOString(),
    }).eq("id", logRow.id)
    if (msgRowId) {
      await supabase.from("messages").update({
        msg_status:              "sent",
        msg_provider_message_id: mockId,
        msg_sent_at:             new Date().toISOString(),
        msg_status_updated_at:   new Date().toISOString(),
        msg_updated_at:          new Date().toISOString(),
      }).eq("id", msgRowId)
    }
    return json({
      status: "ok",
      notification_log_id: logRow.id,
      nl_record_number:    logRow.nl_record_number,
      message_id:          msgRowId,
      conversation_id:     conversationId,
      provider_message_id: mockId,
      mode: "mock",
      missing_config: missing,
      from_number: fromNumber || "(unset)",
    }, 200)
  }

  // 5. Real Twilio send
  try {
    const credentials = btoa(`${twilioSid}:${twilioToken}`)
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: fromNumber,
          To:   body.recipient_phone,
          Body: bodyTruncated,
        }).toString(),
      },
    )
    const twilioJson = await twilioRes.json().catch(() => null)

    if (twilioRes.ok && twilioJson?.sid) {
      const nowIso = new Date().toISOString()
      await supabase.from("notification_logs").update({
        nl_status:              "sent",
        nl_provider_message_id: twilioJson.sid,
        nl_sent_at:             nowIso,
        nl_updated_at:          nowIso,
      }).eq("id", logRow.id)
      if (msgRowId) {
        await supabase.from("messages").update({
          msg_status:              "sent",
          msg_provider_message_id: twilioJson.sid,
          msg_sent_at:             nowIso,
          msg_status_updated_at:   nowIso,
          msg_updated_at:          nowIso,
        }).eq("id", msgRowId)
      }
      return json({
        status: "ok",
        notification_log_id: logRow.id,
        nl_record_number:    logRow.nl_record_number,
        message_id:          msgRowId,
        conversation_id:     conversationId,
        provider_message_id: twilioJson.sid,
        mode: "real",
        from_number: fromNumber,
      }, 200)
    }

    const errMsg = twilioJson?.message || `Twilio HTTP ${twilioRes.status}`
    const errCode = twilioJson?.code ? String(twilioJson.code) : String(twilioRes.status)
    await markFailed(supabase, logRow.id, msgRowId, errMsg, errCode)
    return json({
      status: "failed",
      notification_log_id: logRow.id,
      nl_record_number:    logRow.nl_record_number,
      message_id:          msgRowId,
      conversation_id:     conversationId,
      failure_reason: errMsg,
      failure_code:   errCode,
    }, 200)
  } catch (e) {
    const reason = `Send threw: ${(e as Error).message}`.slice(0, 1500)
    await markFailed(supabase, logRow.id, msgRowId, reason, null)
    return json({
      status: "failed",
      notification_log_id: logRow.id,
      nl_record_number:    logRow.nl_record_number,
      message_id:          msgRowId,
      conversation_id:     conversationId,
      failure_reason: reason,
    }, 200)
  }
})

function validate(b: ReqBody): string | null {
  if (!b || typeof b !== "object") return "Body must be a JSON object"
  if (!b.trigger_event) return "trigger_event required"
  if (!b.recipient_phone) return "recipient_phone required"
  if (!/^\+[1-9]\d{6,14}$/.test(b.recipient_phone)) return "recipient_phone must be E.164 format (e.g. +14155551234)"
  if (!b.body_text) return "body_text required"
  if (typeof b.body_text !== "string") return "body_text must be a string"
  return null
}

async function markFailed(
  supabase: ReturnType<typeof createClient>,
  logId: string,
  msgId: string | null,
  reason: string,
  errorCode: string | null,
): Promise<void> {
  const nowIso = new Date().toISOString()
  await supabase.from("notification_logs").update({
    nl_status:                  "failed",
    nl_provider_error_message:  reason,
    nl_provider_error_code:     errorCode,
    nl_updated_at:              nowIso,
  }).eq("id", logId)
  if (msgId) {
    await supabase.from("messages").update({
      msg_status:                  "failed",
      msg_provider_error_message:  reason,
      msg_provider_error_code:     errorCode,
      msg_status_updated_at:       nowIso,
      msg_updated_at:              nowIso,
    }).eq("id", msgId)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
