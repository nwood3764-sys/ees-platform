// transcript — the pure rules behind the LEAP assistant's working memory.
//
// Kept out of index.ts (which imports Deno/JSR modules) so they can be run and
// pinned from Node: scripts/assistant-transcript-fixture.mjs. Nothing here
// touches the network, the database, or a Deno global.
//
// Plain JavaScript, deliberately. Deno reads it as happily as TypeScript, and
// Node imports it with no flag — which matters because the Netlify build runs
// `npm run fixtures` on NODE_VERSION 20, and Node 20 cannot import a .ts file
// at all. Authoring this as .ts passed locally on Node 22 (which strips types
// on import) and failed the deploy build outright. Types live in JSDoc.
//
// A message is { role: "user" | "assistant", content: unknown } — the
// Anthropic messages shape, with content either a string or a block array.

// Cap the replayed history sent to the model (chars). Conversation memory can
// balloon over a long session; that degrades the model and can starve the
// output budget. Keep the most recent slice.
export const HISTORY_CHAR_BUDGET = 140000
// Per-tool-result cap applied when a transcript is CARRIED FORWARD to the next
// user turn. describe_object on properties alone is 828 columns; replaying a
// handful of those verbatim would eat the whole budget. The head of a result is
// what the model reasons from, so keep that and say plainly what was cut.
const CARRIED_TOOL_RESULT_CHARS = 2500

/** @param {{role:string, content:unknown}} m */
export function isToolResultTurn(m) {
  return m?.role === "user" && Array.isArray(m.content) &&
    m.content.some(b => b?.type === "tool_result")
}

/**
 * Trim the replayed transcript to the most recent slice that fits the budget —
 * WITHOUT ever orphaning a tool_result from its tool_use.
 *
 * The old version sliced purely on a char budget. That was safe only because
 * the client used to send text-only turns. Now that the real transcript (tool
 * calls and their results — the assistant's working memory) is threaded back,
 * a naive slice can start the window on a user turn made of tool_result blocks
 * whose tool_use is gone; the API rejects that outright. So after the budget
 * cut, the start is advanced forward until the window opens on a genuine user
 * message.
 */
export function trimHistory(history) {
  if (!Array.isArray(history)) return []
  let total = 0
  let start = history.length
  for (let i = history.length - 1; i >= 0; i--) {
    const len = JSON.stringify(history[i] ?? "").length
    if (total + len > HISTORY_CHAR_BUDGET && start < history.length) break
    start = i; total += len
  }
  // A window may not open on tool_result blocks (their tool_use is outside it),
  // nor on an assistant turn (the API expects the exchange to start with user).
  while (start < history.length &&
         (isToolResultTurn(history[start]) || history[start]?.role === "assistant")) {
    start++
  }
  return history.slice(start)
}

/**
 * Shrink a finished transcript for hand-back to the client, so the NEXT user
 * turn still carries what this turn learned.
 *
 * Everything the model did stays visible — which tools it called, with what
 * input, and the head of each answer. Only the bulk of each tool_result is
 * dropped, and it says so where it was cut, so the model re-reads rather than
 * assuming.
 */
export function compactTranscript(messages) {
  return messages.map(m => {
    if (!Array.isArray(m.content)) return m
    const blocks = m.content.map(b => {
      if (b?.type !== "tool_result" || typeof b.content !== "string") return b
      if (b.content.length <= CARRIED_TOOL_RESULT_CHARS) return b
      return {
        ...b,
        content: b.content.slice(0, CARRIED_TOOL_RESULT_CHARS) +
          `\n…[truncated for replay — ${b.content.length} chars total. Re-run the tool if you need the rest.]`,
      }
    })
    return { ...m, content: blocks }
  })
}

// Legal-form suffixes that are routinely written one way and stored another —
// "Community Management Corporation" on screen, "Community Management Corp" in
// the record. An exact search that misses on the full name is not evidence the
// company is absent, so a miss is retried on the shortened form.
const ENTITY_SUFFIX_RE =
  /[\s,]+(?:incorporated|corporation|corp|company|co|inc|llc|l\.l\.c\.|l\.p\.|llp|lp|pllc|pc|ltd|limited|plc|gmbh|n\.a\.)\.?$/i

/**
 * Progressively looser forms of a search term, most specific first, excluding
 * the original. Bounded at two so a miss costs at most two extra queries.
 */
export function relaxedSearchTerms(term) {
  const base = String(term ?? "").trim().replace(/\s+/g, " ")
  if (!base) return []
  const out = []
  let stripped = base
  // Strip repeated suffixes ("Foo Holdings Co., Inc." -> "Foo Holdings").
  for (let i = 0; i < 3; i++) {
    const next = stripped.replace(ENTITY_SUFFIX_RE, "").trim().replace(/[.,]+$/, "").trim()
    if (next === stripped || !next) break
    stripped = next
  }
  if (stripped && stripped.toLowerCase() !== base.toLowerCase()) out.push(stripped)
  // Then the leading two words, which is what a distinctive company name
  // usually is once the descriptive tail is gone.
  const words = stripped.split(" ").filter(Boolean)
  if (words.length > 2) {
    const head = words.slice(0, 2).join(" ")
    if (!out.some(t => t.toLowerCase() === head.toLowerCase()) && head.toLowerCase() !== base.toLowerCase()) {
      out.push(head)
    }
  }
  return out
}

// Does this API error mean "that model is not available to this key"? Only then
// is the fallback correct — every other failure must surface, not be masked by
// silently answering on a different model.
export function isModelUnavailable(status, body) {
  if (status !== 404 && status !== 400) return false
  return /model/i.test(body) && /(not_found|not found|does not exist|unavailable|invalid)/i.test(body)
}

// ── Transient upstream failures ─────────────────────────────────────────────
// A 529 is Anthropic's overloaded_error: the API is momentarily at capacity.
// It says nothing about the request — the identical call a second later
// succeeds. Same for 429 (rate limited) and the 5xx gateway family.
//
// Before 2026-08-31 none of these were retried: isModelUnavailable covers only
// 404/400 "model not found", so a 529 fell straight through and killed the
// whole turn. Nicholas hit it asking for 25 dwelling units in one go — a batch
// like that is up to MAX_TURNS sequential calls, so it is the shape most
// exposed to a single blip, and every action already proposed in that request
// is discarded with it. Waiting a second is always better than losing the turn.
export function isTransientUpstream(status, body) {
  const s = Number(status)
  if (s === 429 || s === 529) return true
  // 5xx from the API or the gateway in front of it. 501 is excluded: "not
  // implemented" is a real, permanent answer, not congestion.
  if (s >= 500 && s <= 599 && s !== 501) return true
  // Some overload responses arrive with a non-standard status; the body is
  // authoritative about what happened.
  return /overloaded_error/i.test(String(body ?? ""))
}

export const MAX_UPSTREAM_RETRIES = 3
// Worst case 11s of waiting, which fits inside the soft deadline with room for
// the retried call itself. Deliberately not jittered: LEAP's assistant is one
// user at a time, so there is no herd to spread out, and a fixed ladder is
// testable.
export const RETRY_BACKOFF_MS = [1_000, 3_000, 7_000]
// A retry-after header is honoured, but never past this — a 60s hold would eat
// the whole turn budget, and failing fast is better than a silent two-minute
// hang.
export const MAX_RETRY_WAIT_MS = 20_000
// Headroom left for the retried call to actually complete before the edge
// function's own timeout. A wait that outlasts the turn turns a retryable blip
// into a request that dies with no reply at all.
export const RETRY_TIME_RESERVE_MS = 20_000

/**
 * How long to wait before retrying a transient upstream failure, or null when
 * it should not be retried — attempts exhausted, or no time left in the turn.
 *
 * @param attempt     0-based count of retries already made for this call.
 * @param retryAfter  the response's retry-after header, if any (seconds).
 * @param elapsedMs   how long this request has been running.
 */
export function upstreamRetryDelayMs(attempt, retryAfter, elapsedMs) {
  const n = Number(attempt)
  if (!Number.isFinite(n) || n < 0 || n >= MAX_UPSTREAM_RETRIES) return null
  const ladder = RETRY_BACKOFF_MS[Math.min(n, RETRY_BACKOFF_MS.length - 1)]
  const asked = Number(retryAfter)
  const wait = Number.isFinite(asked) && asked > 0
    ? Math.min(Math.max(asked * 1000, ladder), MAX_RETRY_WAIT_MS)
    : ladder
  const elapsed = Number(elapsedMs)
  const spent = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0
  if (spent + wait + RETRY_TIME_RESERVE_MS >= HARD_DEADLINE_MS) return null
  return wait
}

/**
 * What the user is told when a call fails. A transient failure is upstream
 * capacity and is worth sending again; anything else is not, and saying "try
 * again" about it would just waste the person's time.
 */
export function upstreamErrorMessage(status, retried = 0) {
  const s = Number(status)
  if (isTransientUpstream(s, "")) {
    const tried = retried > 0
      ? ` It was retried ${retried} time${retried === 1 ? "" : "s"} and stayed busy.`
      : ""
    return `The AI service is temporarily overloaded (${s}) — this is capacity on Anthropic's side, not your data or your permissions.${tried} Nothing was saved; send the message again.`
  }
  return `Assistant call failed (${s}).`
}

// Per-model list price ($ per megatoken), from the Anthropic model reference —
// NOT from memory. Getting these wrong is not a rounding error: the first cut
// of this file priced Opus 5 at $15/$75 (3x its real rate) and Sonnet 5 at
// $3/$15, which would have made the cost report fiction and, worse, drove the
// model choice itself.
//
// Model ids are complete as written. Never append a date suffix — a key like
// "claude-haiku-4-5-20251001" matches nothing and silently falls through to
// DEFAULT_PRICING.
const MODEL_PRICING = {
  "claude-opus-5":     { input: 5.00, output: 25.00 },
  "claude-sonnet-5":   { input: 2.00, output: 10.00 },
  "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
  "claude-haiku-4-5":  { input: 1.00, output:  5.00 },
}
// An unknown model is priced at the most expensive rate we know, so a bad
// ASSISTANT_MODEL overstates rather than understates what it is costing.
const DEFAULT_PRICING = { input: 5.00, output: 25.00 }
export const pricingFor = (model) => MODEL_PRICING[model] ?? DEFAULT_PRICING

// Cached input does not bill at the input rate. A cache WRITE costs ~1.25x the
// base rate and a cache READ ~0.1x, so summing the three input buckets and
// multiplying by one rate — which is what the first cut of this file did —
// makes the cost column RISE when caching starts working and hides the whole
// saving. Priced per bucket instead.
const CACHE_WRITE_MULTIPLIER = 1.25
const CACHE_READ_MULTIPLIER  = 0.10

/** One turn's token spend, split by how each bucket actually bills. */
export const emptySpend = () => ({ uncached: 0, cacheWrite: 0, cacheRead: 0, output: 0 })

// Every input token the turn consumed, cached or not — what the usage row's
// token count has always meant. Cost is computed per bucket (see costOf).
export const totalInputTokens = (s) => s.uncached + s.cacheWrite + s.cacheRead

export function addUsage(spend, usage) {
  spend.uncached   += usage?.input_tokens ?? 0
  spend.cacheWrite += usage?.cache_creation_input_tokens ?? 0
  spend.cacheRead  += usage?.cache_read_input_tokens ?? 0
  spend.output     += usage?.output_tokens ?? 0
}

export function costOf(spend, model) {
  const p = pricingFor(model)
  return (spend.uncached   / 1_000_000) * p.input
       + (spend.cacheWrite / 1_000_000) * p.input * CACHE_WRITE_MULTIPLIER
       + (spend.cacheRead  / 1_000_000) * p.input * CACHE_READ_MULTIPLIER
       + (spend.output     / 1_000_000) * p.output
}

// ── Turn deadline ──────────────────────────────────────────────────────────
// Supabase edge functions are killed on a ~150s request idle timeout and a
// ~400s worker wall clock (the lesson property-owner-research learned the hard
// way, which is why its research turns run as background tasks). The assistant
// runs up to MAX_TURNS sequential model calls, and moving to a thinking model
// made each one slower — so a complex turn can now run past that ceiling and
// the user gets a hang instead of an answer, which is strictly worse than a
// short answer.
//
// So the loop watches the clock. Past the soft deadline it stops issuing new
// tool rounds and goes straight to composing a reply from what it already has;
// past the hard deadline it does not even do that. Budgets are generous enough
// that a normal turn never notices.
export const SOFT_DEADLINE_MS = 100_000
export const HARD_DEADLINE_MS = 135_000

/**
 * What the loop should do next, given how long this request has been running.
 *
 *   "continue" — there is time for another tool round.
 *   "close"    — stop tool use; compose the final answer from what is held.
 *   "abandon"  — no time even for that; return the narration already produced.
 */
export function deadlineState(elapsedMs) {
  const ms = Number(elapsedMs)
  if (!Number.isFinite(ms) || ms < 0) return "continue"
  if (ms >= HARD_DEADLINE_MS) return "abandon"
  if (ms >= SOFT_DEADLINE_MS) return "close"
  return "continue"
}

// What the model is told when its tool budget was cut short by the clock. It
// must not silently pretend it finished the job.
export const DEADLINE_NOTE =
  "You are out of time for this turn. Do NOT call any more tools. " +
  "Answer now from what you have already gathered, and say plainly which part " +
  "you did not get to so the user can ask again — never imply you finished."
