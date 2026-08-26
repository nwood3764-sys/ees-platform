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
