// Fixture test for the LEAP assistant's working memory.
//
// Run with: node scripts/assistant-transcript-fixture.mjs
//
// Two rules are pinned here, both of them load-bearing:
//
//  1. The replayed transcript now carries REAL tool calls and their results —
//     what the assistant looked up, and what came back. Before 2026-08-26 the
//     client replayed text only, so every turn started blind and the assistant
//     re-derived (or simply lost) ids it had already resolved. That is the
//     "gets dumber the longer we work" complaint.
//  2. Because of (1), trimming is no longer a free slice. A window that opens
//     on tool_result blocks whose tool_use fell outside it is rejected by the
//     API outright — the assistant would stop answering at all. trimHistory
//     must never produce one.

import {
  trimHistory, compactTranscript, isToolResultTurn,
  relaxedSearchTerms, isModelUnavailable, HISTORY_CHAR_BUDGET,
  pricingFor, addUsage, costOf, totalInputTokens, emptySpend,
  deadlineState, DEADLINE_NOTE, SOFT_DEADLINE_MS, HARD_DEADLINE_MS,
  isTransientUpstream, upstreamRetryDelayMs, upstreamErrorMessage,
  MAX_UPSTREAM_RETRIES, RETRY_BACKOFF_MS, MAX_RETRY_WAIT_MS, RETRY_TIME_RESERVE_MS,
} from '../supabase/functions/ai-assistant/transcript.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures += 1
    console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`)
  }
}

const user = (text) => ({ role: 'user', content: text })
const assistantText = (text) => ({ role: 'assistant', content: text })
const assistantTool = (id, name, input) => ({
  role: 'assistant',
  content: [{ type: 'tool_use', id, name, input }],
})
const toolResult = (id, content) => ({
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content }],
})

// ── A well-formed exchange survives untouched ───────────────────────────────
{
  const t = [
    user('who owns 1837 Alden Rd?'),
    assistantTool('t1', 'global_search', { query: '1837 Alden Rd' }),
    toolResult('t1', '{"results":[{"id":"p1"}]}'),
    assistantText('Property Owner LLC.'),
  ]
  check('a short transcript is replayed whole', trimHistory(t).length, 4)
  check('…starting on the user turn', trimHistory(t)[0].role, 'user')
}

// ── The failure mode: a slice must never orphan a tool_result ───────────────
{
  const filler = 'x'.repeat(HISTORY_CHAR_BUDGET)
  const t = [
    user('first question'),
    assistantTool('t1', 'describe_object', { object: 'properties' }),
    toolResult('t1', filler),          // huge — forces the budget cut
    assistantText('here is what I found'),
    user('second question'),
    assistantTool('t2', 'query_records', { object: 'accounts' }),
    toolResult('t2', '{"rows":[]}'),
    assistantText('nothing there'),
  ]
  const kept = trimHistory(t)
  check('the window is cut', kept.length < t.length, true)
  check('the window NEVER opens on tool_result blocks', isToolResultTurn(kept[0]), false)
  check('the window opens on a real user turn', kept[0].role, 'user')
  check('the window opens on plain user text', typeof kept[0].content, 'string')
  // Every tool_result kept must have its tool_use kept too.
  const useIds = new Set()
  const orphans = []
  for (const m of kept) {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      m.content.forEach(b => { if (b.type === 'tool_use') useIds.add(b.id) })
    }
    if (Array.isArray(m.content)) {
      m.content.forEach(b => {
        if (b.type === 'tool_result' && !useIds.has(b.tool_use_id)) orphans.push(b.tool_use_id)
      })
    }
  }
  check('no tool_result is left without its tool_use', orphans, [])
}

// ── An assistant turn is never the opening move ─────────────────────────────
check('a transcript that starts on the assistant is corrected',
  trimHistory([assistantText('hi'), user('hello')])[0].role, 'user')
check('a transcript of nothing but tool results is dropped entirely',
  trimHistory([toolResult('t1', 'x')]).length, 0)
check('a non-array history is safe', trimHistory(null), [])

// ── Carrying results forward: keep the intent, bound the bulk ───────────────
{
  const big = JSON.stringify({ columns: Array.from({ length: 828 }, (_, i) => `column_${i}`) })
  const t = [
    user('describe properties'),
    assistantTool('t1', 'describe_object', { object: 'properties' }),
    toolResult('t1', big),
    assistantText('828 columns.'),
  ]
  const c = compactTranscript(t)
  const kept = c[2].content[0].content
  check('an oversized tool_result is truncated', kept.length < big.length, true)
  check('…and says so, rather than looking complete', kept.includes('truncated for replay'), true)
  check('…and tells the model how to get the rest', kept.includes('Re-run the tool'), true)
  check('the tool CALL is kept intact — what it asked is the memory',
    c[1].content[0].input, { object: 'properties' })
  check('a small result is left exactly as it was',
    compactTranscript([toolResult('t2', '{"rows":[]}')])[0].content[0].content, '{"rows":[]}')
  check('plain text turns are untouched', c[0].content, 'describe properties')
}

// ── Relaxed search terms: the exact miss that caused the bug ────────────────
check('a legal suffix is stripped',
  relaxedSearchTerms('Community Management Corporation'), ['Community Management'])
check('LLC too', relaxedSearchTerms('Envolve Community Management LLC'), ['Envolve Community Management', 'Envolve Community'])
check('stacked suffixes come off',
  relaxedSearchTerms('Fairway Management, Inc.'), ['Fairway Management'])
check('a long name also offers its distinctive head',
  relaxedSearchTerms('Atlantic Pacific Community Management LLC'),
  ['Atlantic Pacific Community Management', 'Atlantic Pacific'])
check('a name with no suffix and two words has nothing to relax',
  relaxedSearchTerms('Westminster Company'), ['Westminster'])
check('a single word offers nothing', relaxedSearchTerms('Westminster'), [])
check('empty input is safe', relaxedSearchTerms(''), [])
check('whitespace-only input is safe', relaxedSearchTerms('   '), [])
check('a suffix in the middle is NOT stripped — only a trailing one',
  relaxedSearchTerms('Corp Yard Holdings'), ['Corp Yard'])

// ── Model fallback fires only for a genuinely unavailable model ─────────────
check('a 404 naming the model falls back',
  isModelUnavailable(404, '{"error":{"type":"not_found_error","message":"model: claude-sonnet-5"}}'), true)
check('a 400 invalid-model falls back',
  isModelUnavailable(400, '{"error":{"message":"invalid model name"}}'), true)
check('a rate limit does NOT silently change model', isModelUnavailable(429, 'rate_limit_error'), false)
check('an overload does NOT silently change model', isModelUnavailable(529, 'overloaded_error'), false)
check('a 400 about something else does not change model',
  isModelUnavailable(400, '{"error":{"message":"messages: unexpected role"}}'), false)


// ── Pricing and cost ────────────────────────────────────────────────────────
// This section exists because the first cut of this file got all of it wrong:
// Opus 5 priced at 3x its real rate, Sonnet 5 at 1.5x, a Haiku key with a date
// suffix that could never match, and — worst — the three input buckets summed
// and billed at one rate, which makes the cost column RISE when prompt caching
// starts working. None of it was checked against the model reference before it
// shipped. It is checked here now.

check('Opus 5 is $5 / $25 per megatoken', pricingFor('claude-opus-5'), { input: 5.00, output: 25.00 })
check('Sonnet 5 is $2 / $10', pricingFor('claude-sonnet-5'), { input: 2.00, output: 10.00 })
check('Sonnet 4.6 is $3 / $15', pricingFor('claude-sonnet-4-6'), { input: 3.00, output: 15.00 })
check('Haiku 4.5 is keyed WITHOUT a date suffix', pricingFor('claude-haiku-4-5'), { input: 1.00, output: 5.00 })
check('a date-suffixed id is NOT a real key (it falls through)',
  pricingFor('claude-haiku-4-5-20251001'), pricingFor('some-model-that-does-not-exist'))
check('an unknown model is priced at the dearest known rate, never the cheapest',
  pricingFor('whatever-the-env-var-said'), { input: 5.00, output: 25.00 })

// ── Cache tokens do not bill at the input rate ──────────────────────────────
{
  const spend = emptySpend()
  addUsage(spend, { input_tokens: 1_000_000, output_tokens: 0 })
  check('1M uncached input on Opus 5 costs the input rate', costOf(spend, 'claude-opus-5'), 5.00)
}
{
  const spend = emptySpend()
  addUsage(spend, { cache_read_input_tokens: 1_000_000 })
  check('1M CACHE-READ input costs a tenth of it', costOf(spend, 'claude-opus-5'), 0.50)
}
{
  const spend = emptySpend()
  addUsage(spend, { cache_creation_input_tokens: 1_000_000 })
  check('1M CACHE-WRITE input costs 1.25x of it', costOf(spend, 'claude-opus-5'), 6.25)
}
{
  const spend = emptySpend()
  addUsage(spend, { output_tokens: 1_000_000 })
  check('1M output costs the output rate', costOf(spend, 'claude-opus-5'), 25.00)
}

// The regression this whole section is for: the SAME input tokens, once billed
// as uncached and once as a cache read, must not cost the same.
{
  const cold = emptySpend(); addUsage(cold, { input_tokens: 100_000, output_tokens: 500 })
  const warm = emptySpend(); addUsage(warm, { input_tokens: 5_000, cache_read_input_tokens: 95_000, output_tokens: 500 })
  check('cold and warm turns carry the same input-token count',
    totalInputTokens(cold), totalInputTokens(warm))
  check('…but the cached turn costs strictly less', costOf(warm, 'claude-opus-5') < costOf(cold, 'claude-opus-5'), true)
  // 100k cold = $0.50 + $0.0125 output. 95k cached = $0.025 + $0.0475 + $0.0125.
  check('cold 100k-input Opus 5 turn', Number(costOf(cold, 'claude-opus-5').toFixed(4)), 0.5125)
  check('warm 100k-input Opus 5 turn', Number(costOf(warm, 'claude-opus-5').toFixed(4)), 0.0850)
}

// ── Accumulation across the tool-use loop ───────────────────────────────────
{
  const spend = emptySpend()
  addUsage(spend, { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 })
  addUsage(spend, { input_tokens: 1, cache_read_input_tokens: 2, output_tokens: 3 })
  check('every bucket accumulates', spend, { uncached: 11, cacheWrite: 20, cacheRead: 32, output: 43 })
  check('the reported input-token count is all three input buckets', totalInputTokens(spend), 63)
  addUsage(spend, undefined)
  check('a missing usage object is a no-op, not a crash', totalInputTokens(spend), 63)
}
check('a fresh spend is zero', costOf(emptySpend(), 'claude-opus-5'), 0)


// ── Turn deadline ───────────────────────────────────────────────────────────
// Moving to a thinking model made each model call slower, and the assistant
// makes up to 8 of them in sequence inside an edge function that is killed on
// a ~150s idle timeout. Without a clock the user gets a hang instead of an
// answer — worse than the short answer the deadline produces.

check('a fresh turn continues', deadlineState(0), 'continue')
check('well inside the budget continues', deadlineState(30_000), 'continue')
check('one ms under the soft deadline still continues', deadlineState(SOFT_DEADLINE_MS - 1), 'continue')
check('at the soft deadline it stops calling tools', deadlineState(SOFT_DEADLINE_MS), 'close')
check('between the deadlines it still composes an answer', deadlineState(120_000), 'close')
check('at the hard deadline it does not even do that', deadlineState(HARD_DEADLINE_MS), 'abandon')
check('past the hard deadline stays abandoned', deadlineState(600_000), 'abandon')
check('the soft deadline leaves room for the closing call under a 150s timeout',
  HARD_DEADLINE_MS > SOFT_DEADLINE_MS && HARD_DEADLINE_MS < 150_000, true)
// A missing or nonsense clock must never strand a turn that could still answer.
check('a NaN elapsed does not abandon the turn', deadlineState(NaN), 'continue')
check('undefined elapsed does not abandon the turn', deadlineState(undefined), 'continue')
check('a negative elapsed does not abandon the turn', deadlineState(-5), 'continue')
// The note is what stops a cut-short turn being reported as a finished one.
check('the deadline note forbids further tool calls', /do NOT call any more tools/i.test(DEADLINE_NOTE), true)
check('…and forbids implying the job finished', /never imply you finished/i.test(DEADLINE_NOTE), true)


// ── Transient upstream failures ─────────────────────────────────────────────
// Nicholas asked the assistant for 25 dwelling units and got
// "Assistant call failed (529)." A 529 is Anthropic's overloaded_error: the API
// was momentarily at capacity, which says nothing about the request. Nothing
// retried it — isModelUnavailable covers only 404/400 model-not-found — so one
// blip killed the whole turn and discarded every action already proposed in it.
// A batch is the most exposed shape there is: one turn is up to MAX_TURNS
// sequential calls, so it gets that many chances to be told "busy".
check('a 529 overload is transient', isTransientUpstream(529, 'overloaded_error'), true)
check('a 429 rate limit is transient', isTransientUpstream(429, 'rate_limit_error'), true)
check('a 503 gateway failure is transient', isTransientUpstream(503, 'Service Unavailable'), true)
check('a 500 is transient', isTransientUpstream(500, 'internal server error'), true)
check('a 502 is transient', isTransientUpstream(502, 'bad gateway'), true)
check('a 504 is transient', isTransientUpstream(504, 'gateway timeout'), true)
// An overload body is authoritative even behind an odd status.
check('an overloaded body is transient whatever the status',
  isTransientUpstream(200, '{"type":"error","error":{"type":"overloaded_error"}}'), true)
// The permanent failures must NOT be retried: retrying a bad request just
// wastes the user's time and repeats the same rejection.
check('a 400 bad request is not retried', isTransientUpstream(400, 'messages: unexpected role'), false)
check('a 401 bad key is not retried', isTransientUpstream(401, 'authentication_error'), false)
check('a 403 is not retried', isTransientUpstream(403, 'permission_error'), false)
check('a 404 missing model is not retried', isTransientUpstream(404, 'not_found_error'), false)
check('a 413 oversized request is not retried', isTransientUpstream(413, 'request too large'), false)
check('a 501 not-implemented is a real answer, not congestion',
  isTransientUpstream(501, 'not implemented'), false)
// The two error families stay disjoint — a transient failure must never be
// mistaken for "this model does not exist" and silently change the model.
check('an overload is still not a model-availability failure',
  isModelUnavailable(529, 'overloaded_error'), false)

// The backoff ladder: bounded, and it must fit inside the turn.
check('the first retry waits the first rung', upstreamRetryDelayMs(0, null, 0), RETRY_BACKOFF_MS[0])
check('the second retry waits longer', upstreamRetryDelayMs(1, null, 0), RETRY_BACKOFF_MS[1])
check('the third retry waits longer still', upstreamRetryDelayMs(2, null, 0), RETRY_BACKOFF_MS[2])
check('retries are capped', upstreamRetryDelayMs(MAX_UPSTREAM_RETRIES, null, 0), null)
check('the whole ladder fits inside the soft deadline',
  RETRY_BACKOFF_MS.reduce((a, b) => a + b, 0) < SOFT_DEADLINE_MS, true)
// retry-after is honoured, but never past the cap — a 60s hold would eat the
// entire turn budget, and failing fast beats a silent two-minute hang.
check('a retry-after longer than the rung is honoured', upstreamRetryDelayMs(0, 5, 0), 5000)
check('a retry-after shorter than the rung does not shorten the wait',
  upstreamRetryDelayMs(1, 1, 0), RETRY_BACKOFF_MS[1])
check('a huge retry-after is capped', upstreamRetryDelayMs(0, 600, 0), MAX_RETRY_WAIT_MS)
check('a nonsense retry-after falls back to the ladder',
  upstreamRetryDelayMs(0, 'soon', 0), RETRY_BACKOFF_MS[0])
check('an absent retry-after falls back to the ladder',
  upstreamRetryDelayMs(0, null, 0), RETRY_BACKOFF_MS[0])
// The clock governs: a wait that outlasts the turn turns a retryable blip into
// a request that dies with no reply at all.
check('no retry when the wait would outlast the turn',
  upstreamRetryDelayMs(0, null, HARD_DEADLINE_MS - RETRY_TIME_RESERVE_MS), null)
check('a retry early in the turn is fine', upstreamRetryDelayMs(0, null, 5_000), RETRY_BACKOFF_MS[0])
check('reserve leaves room for the retried call itself',
  RETRY_TIME_RESERVE_MS > 0 && RETRY_TIME_RESERVE_MS < HARD_DEADLINE_MS, true)
check('a NaN clock does not block the retry', upstreamRetryDelayMs(0, null, NaN), RETRY_BACKOFF_MS[0])
check('a negative attempt is refused, not treated as zero', upstreamRetryDelayMs(-1, null, 0), null)

// What the user is told. "Assistant call failed (529)" reads as a LEAP defect;
// it is capacity upstream, and the useful instruction is to send it again.
check('an overload is named as upstream capacity',
  /overloaded/i.test(upstreamErrorMessage(529)), true)
check('…and says it was not the user\'s data or permissions',
  /not your data or your permissions/i.test(upstreamErrorMessage(529)), true)
check('…and tells the user to send it again',
  /send the message again/i.test(upstreamErrorMessage(529)), true)
check('…and reports the retries that were already spent',
  /retried 3 times/i.test(upstreamErrorMessage(529, 3)), true)
check('one retry reads as singular', /retried 1 time and/i.test(upstreamErrorMessage(529, 1)), true)
check('a permanent failure is NOT described as worth resending',
  /send the message again/i.test(upstreamErrorMessage(400)), false)
check('a permanent failure still names its status',
  upstreamErrorMessage(400), 'Assistant call failed (400).')

console.log(failures === 0
  ? `assistant-transcript fixture: ${checks} checks passed`
  : `assistant-transcript fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
