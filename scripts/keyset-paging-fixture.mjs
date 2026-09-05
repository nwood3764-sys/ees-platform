// Fixture: a full-table read pages by PRIMARY KEY, not by OFFSET.
//
// "Your grace period is over… I'm at 1% of usage" — Nicholas, 2026-09-05,
// looking at a Supabase banner while the Properties list threw errors. The
// banner was unrelated. What was failing was every full-table list read:
//
//   HEAD /properties?select=id&property_is_deleted=eq.false → 500
//   {"code":"57014","message":"canceling statement due to statement timeout"}
//
// The loaders paged with `.order('property_name').range(from, to)`. OFFSET
// cannot skip a row without first producing it, so page 17 of 17 made
// Postgres sort all 16,665 live properties and discard the first 16,000 —
// and so did every other page. Measured on production: 612 ms for one page in
// isolation, 4,096 ms mean under real concurrency, ~3 MB of temp file spilled
// per page, 13 GB written since Aug 29. The `authenticated` role carries an
// 8-second statement_timeout; 256 list loads failed on Sep 2 alone.
//
// The same page, keyset (`WHERE id > $last ORDER BY id LIMIT 1000`), measured
// 16 ms — an index range scan the LIMIT stops early.
//
// WHAT THIS PINS, and why each check is here rather than being obvious:
//
//   * The COST is quadratic, and that is the whole defect. The control below
//     replays the old OFFSET arithmetic over the real production row count and
//     requires it to produce ~9× the row-touches of keyset paging. If that
//     control ever comes back cheap, this fixture is testing nothing.
//   * OFFSET paging with no stable order can REPEAT or DROP a row at a page
//     boundary when the table changes mid-read. The generic object-list loader
//     had exactly that shape — .range() with no .order() at all. The control
//     reproduces the duplicate; keyset must not have it.
//   * Paging must advance by the LAST row's key, terminate on a short page,
//     and refuse to loop when the key column was not selected — the failure
//     that would otherwise hang a list forever on page one.
//   * Display order is restored by the SAME comparator ListView sorts with.
//     A list view with no saved sort renders the fetch order verbatim, so a
//     loader that hands back rows in key order and forgets to re-sort silently
//     reorders the page.
//
// Run with:  node scripts/keyset-paging-fixture.mjs

import { compareTextValues, sortRowsByTextKey, textSortValue } from '../src/lib/listOrder.js'

let failures = 0
let checks = 0

function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures += 1
    console.error(`✗ ${label}\n    expected: ${e}\n    actual:   ${a}`)
  }
}

function checkTrue(label, actual) { check(label, actual, true) }

// ─────────────────────────────────────────────────────────────────────────
// A minimal stand-in for a PostgREST query builder. Records what the helper
// asked for, so the fixture pins the REQUEST as well as the rows — the whole
// point is which SQL shape reaches the database.
// ─────────────────────────────────────────────────────────────────────────
function makeTable(rows, { onPage = null } = {}) {
  const calls = []
  function build() {
    const state = { gt: undefined, orderBy: undefined, ascending: undefined, limit: undefined }
    const q = {
      gt(col, val) { state.gt = { col, val }; return q },
      order(col, opts) { state.orderBy = col; state.ascending = opts?.ascending; return q },
      limit(n) { state.limit = n; return q },
      then(resolve) {
        calls.push({ ...state })
        if (onPage) onPage(calls.length)
        let out = rows.slice()
        out.sort((a, b) => (a[state.orderBy] < b[state.orderBy] ? -1 : a[state.orderBy] > b[state.orderBy] ? 1 : 0))
        if (state.gt !== undefined) out = out.filter(r => r[state.gt.col] > state.gt.val)
        out = out.slice(0, state.limit)
        return Promise.resolve(resolve({ data: out, error: null }))
      },
    }
    return q
  }
  build.calls = calls
  return build
}

// The helper under test, with the supabase client stubbed out. Importing
// src/lib/supabase.js directly would construct a real client and read Vite
// env vars, so the function is re-declared here from the same source file.
const { fetchAllKeyset } = await loadKeysetHelper()

async function loadKeysetHelper() {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/lib/supabase.js', import.meta.url), 'utf8')
  const start = src.indexOf('export async function fetchAllKeyset')
  if (start < 0) throw new Error('fetchAllKeyset not found in src/lib/supabase.js')
  const body = src.slice(start).replace('export async function', 'async function')
  const mod = await import(
    'data:text/javascript,' + encodeURIComponent(`${body}\nexport { fetchAllKeyset }`)
  )
  return mod
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Every row comes back, once, in key order.
// ─────────────────────────────────────────────────────────────────────────
const ROWS = Array.from({ length: 2350 }, (_, i) => ({
  id: `id-${String(i).padStart(5, '0')}`,
  property_name: `Property ${String((i * 7919) % 2350).padStart(5, '0')}`,
}))

{
  const table = makeTable(ROWS)
  const out = await fetchAllKeyset(() => table(), { pageSize: 1000 })
  check('every row is returned', out.length, ROWS.length)
  check('no row is repeated', new Set(out.map(r => r.id)).size, ROWS.length)
  check('rows arrive in key order', out[0].id < out[1].id && out[out.length - 1].id === 'id-02349', true)
  check('pages until a short page, then stops', table.calls.length, 3)
  check('first page carries no cursor', table.calls[0].gt, undefined)
  check('second page resumes after the first page last row', table.calls[1].gt, { col: 'id', val: 'id-00999' })
  check('third page resumes after the second', table.calls[2].gt, { col: 'id', val: 'id-01999' })
  check('every page is ordered by the key', table.calls.map(c => c.orderBy), ['id', 'id', 'id'])
  check('ascending, always', table.calls.map(c => c.ascending), [true, true, true])
  check('every page is limited', table.calls.map(c => c.limit), [1000, 1000, 1000])
}

// An exact multiple of the page size still terminates — it takes one extra,
// empty request to learn there is no more. Getting this wrong drops the tail.
{
  const exact = ROWS.slice(0, 2000)
  const table = makeTable(exact)
  const out = await fetchAllKeyset(() => table(), { pageSize: 1000 })
  check('an exact multiple of the page size returns every row', out.length, 2000)
  check('an exact multiple costs one extra empty page', table.calls.length, 3)
}

{
  const table = makeTable([])
  const out = await fetchAllKeyset(() => table(), { pageSize: 1000 })
  check('an empty set is one request and no rows', [out.length, table.calls.length], [0, 1])
}

// ─────────────────────────────────────────────────────────────────────────
// 2. THE COST CONTROL. Replay both paging strategies over the real
//    production row count and count the rows each makes the database touch.
//
//    OFFSET page n must produce (n+1) × pageSize rows to discard n × pageSize
//    of them. Keyset page n produces pageSize. This is the difference between
//    O(rows²/pageSize) and O(rows).
// ─────────────────────────────────────────────────────────────────────────
const LIVE_PROPERTIES = 16665   // production, 2026-09-05
const PAGE = 1000

function offsetRowsProduced(total, pageSize) {
  let produced = 0
  for (let from = 0; from < total; from += pageSize) produced += Math.min(from + pageSize, total)
  return produced
}
function keysetRowsProduced(total, pageSize) {
  let produced = 0
  for (let from = 0; from < total; from += pageSize) produced += Math.min(pageSize, total - from)
  return produced
}

{
  const offset = offsetRowsProduced(LIVE_PROPERTIES, PAGE)
  const keyset = keysetRowsProduced(LIVE_PROPERTIES, PAGE)
  check('keyset touches each row exactly once', keyset, LIVE_PROPERTIES)
  checkTrue('CONTROL: offset paging touches ~9× more rows than there are', offset > LIVE_PROPERTIES * 8)
  checkTrue('CONTROL: offset paging is quadratic, keyset is linear', offset / keyset > 8)
  // And it gets worse on its own: doubling the table more than doubles the gap.
  const ratioNow = offsetRowsProduced(LIVE_PROPERTIES, PAGE) / LIVE_PROPERTIES
  const ratioDoubled = offsetRowsProduced(LIVE_PROPERTIES * 2, PAGE) / (LIVE_PROPERTIES * 2)
  checkTrue('CONTROL: the offset penalty grows as rows are added', ratioDoubled > ratioNow * 1.8)
  check('keyset does not degrade as rows are added',
    keysetRowsProduced(LIVE_PROPERTIES * 2, PAGE) / (LIVE_PROPERTIES * 2), 1)
}

// ─────────────────────────────────────────────────────────────────────────
// 3. THE CORRECTNESS CONTROL. A row inserted between two page requests
//    shifts every later OFFSET by one, so a row is silently repeated (and,
//    on a delete, silently dropped). Keyset resumes from a value, not a
//    position, so it cannot.
// ─────────────────────────────────────────────────────────────────────────
{
  const live = ROWS.slice(0, 2000).map(r => ({ ...r }))
  // The old shape: sort, then skip `from` rows.
  function offsetPage(from, size) {
    const sorted = live.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return sorted.slice(from, from + size)
  }
  const collected = []
  for (let from = 0; from < 2000; from += PAGE) {
    collected.push(...offsetPage(from, PAGE))
    // Somebody creates a property while the list is loading.
    if (from === 0) live.unshift({ id: 'id-00000-new', property_name: 'Brand New Property' })
  }
  const seen = new Set(collected.map(r => r.id))
  checkTrue('CONTROL: an insert mid-read makes offset paging repeat a row', seen.size < collected.length)

  // The same interleaving, keyset.
  const live2 = ROWS.slice(0, 2000).map(r => ({ ...r }))
  const table = makeTable(live2, {
    onPage: n => { if (n === 1) live2.unshift({ id: 'id-00000-new', property_name: 'Brand New Property' }) },
  })
  const out = await fetchAllKeyset(() => table(), { pageSize: PAGE })
  check('keyset repeats no row when the table changes mid-read',
    new Set(out.map(r => r.id)).size, out.length)
}

// ─────────────────────────────────────────────────────────────────────────
// 4. The failures that would hang a list, and must throw by name instead.
// ─────────────────────────────────────────────────────────────────────────
async function throwsWith(fn, needle) {
  try { await fn(); return '(did not throw)' }
  catch (err) { return String(err.message).includes(needle) ? true : `(threw: ${err.message})` }
}

{
  // The key column left out of the SELECT: the cursor cannot advance, so the
  // helper would request page one forever.
  const noKey = Array.from({ length: 1500 }, (_, i) => ({ property_name: `P${i}` }))
  const table = makeTable(noKey)
  check('a full page with no key column throws by name',
    await throwsWith(() => fetchAllKeyset(() => table(), { pageSize: 1000 }),
      'paging cannot advance'), true)
}

{
  const table = makeTable(ROWS)
  check('the page ceiling throws by name',
    await throwsWith(() => fetchAllKeyset(() => table(), { pageSize: 10, maxPages: 3 }),
      'exceeded 3 pages'), true)
}

{
  check('a missing query builder throws by name',
    await throwsWith(() => fetchAllKeyset(null), 'requires a buildQuery function'), true)
}

{
  // A query error is surfaced, never swallowed into a short page — a swallowed
  // error reads as "there are no more records".
  const failing = () => ({
    gt() { return this }, order() { return this }, limit() { return this },
    then(resolve) { return Promise.resolve(resolve({ data: null, error: new Error('boom') })) },
  })
  check('a query error propagates', await throwsWith(() => fetchAllKeyset(failing), 'boom'), true)
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Display order. The loaders restore it with the comparator ListView
//    itself sorts by; a mismatch reorders every list carrying no saved sort.
// ─────────────────────────────────────────────────────────────────────────
{
  const rows = [
    { name: 'Zebra Apartments' },
    { name: 'apple Court' },
    { name: 'Änderung Place' },
    { name: '' },
    { name: 'Beta Homes' },
  ]
  const sorted = sortRowsByTextKey(rows.map(r => ({ ...r })), 'name').map(r => r.name)
  check('empty sorts first', sorted[0], '')
  check('case-insensitive, like the list itself', sorted.indexOf('apple Court') < sorted.indexOf('Beta Homes'), true)
  check('accents order naturally, not by code point', sorted.indexOf('Änderung Place') < sorted.indexOf('Beta Homes'), true)
  check('Z sorts last', sorted[sorted.length - 1], 'Zebra Apartments')

  // The comparator must agree with String.prototype.localeCompare, which is
  // what ListView used before this shared module existed. If Intl.Collator
  // ever disagreed, every saved sort would change meaning.
  const pairs = [['apple', 'Beta'], ['Zebra', 'apple'], ['a', 'a'], ['', 'a'], ['Änderung', 'Beta']]
  const agree = pairs.every(([a, b]) =>
    Math.sign(compareTextValues(a, b)) === Math.sign(String(a || '').localeCompare(String(b || ''))))
  checkTrue('the shared comparator agrees with localeCompare', agree)

  // Preserved deliberately: a falsy non-string sorts as empty, which is what
  // ListView has always done. Changing it would reorder numeric columns.
  check('a falsy value sorts as empty', [textSortValue(0), textSortValue(null), textSortValue(false)], ['', '', ''])

  // Ties keep the order they arrived in — i.e. key order, deterministic.
  const tied = sortRowsByTextKey(
    [{ name: 'Same', id: 'b' }, { name: 'Same', id: 'a' }], 'name').map(r => r.id)
  check('a tie is stable, not arbitrary', tied, ['b', 'a'])

  check('descending is the exact reverse', sortRowsByTextKey(rows.map(r => ({ ...r })), 'name',
    { descending: true }).map(r => r.name), sorted.slice().reverse())
}

// ─────────────────────────────────────────────────────────────────────────
// 6. The loaders that page by key must restore display order. A loader that
//    forgets is the silent reorder this fixture exists to prevent.
// ─────────────────────────────────────────────────────────────────────────
{
  const { readFileSync } = await import('node:fs')
  const sources = [
    ['src/data/outreachService.js', 2],        // fetchProperties, fetchAccounts
    ['src/data/outreachPropertiesService.js', 1],
  ]
  for (const [rel, expected] of sources) {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    const keysetCalls = (src.match(/fetchAllKeyset\(/g) || []).length
    const sortCalls = (src.match(/sortRowsByTextKey\(/g) || []).length
    check(`${rel} pages by key`, keysetCalls, expected)
    check(`${rel} restores display order for each keyset read`, sortCalls, expected)
  }
  // The generic object list is the deliberate exception: it never ordered its
  // read, so there is no display order to restore. Pinned so nobody "fixes"
  // the asymmetry by adding a sort the list does not want.
  const generic = readFileSync(new URL('../src/data/objectListService.js', import.meta.url), 'utf8')
  check('the generic object list pages by key', (generic.match(/fetchAllKeyset\(/g) || []).length, 1)
  check('the generic object list adds no display sort of its own',
    (generic.match(/sortRowsByTextKey\(/g) || []).length, 0)

  // And nothing may go back to parallel OFFSET paging: the helper is gone.
  const supa = readFileSync(new URL('../src/lib/supabase.js', import.meta.url), 'utf8')
  check('the parallel OFFSET helper is gone', supa.includes('export async function fetchAllPagedParallel'), false)
}

// ─────────────────────────────────────────────────────────────────────────
// 7. A non-unique key must be refused, not paged over.
//
//    outreach_properties_v LEFT JOINs property_source_data and
//    property_disaster_exposure. Both are 1:1 today (verified on production:
//    16,665 view rows, 16,665 distinct ids, 0 duplicates), so the view's id is
//    unique — but a second source-data row would fan it out, and keyset paging
//    over a duplicated key advances past the second copy and drops it. Silent
//    row loss is the one failure a list must never have.
// ─────────────────────────────────────────────────────────────────────────
{
  const dup = Array.from({ length: 1500 }, (_, i) => ({ id: `id-${String(i).padStart(5, '0')}` }))
  dup[400] = { id: dup[399].id }   // the fan-out: one row, emitted twice
  const table = makeTable(dup)
  check('a duplicated key is refused by name',
    await throwsWith(() => fetchAllKeyset(() => table(), { pageSize: 1000 }), 'is not unique'), true)
}

// ─────────────────────────────────────────────────────────────────────────
// 8. The client comparator must agree with the DATABASE's ordering, on the
//    names that actually make collators disagree.
//
//    This is what makes moving the sort out of Postgres safe. LEAP's database
//    uses the ICU provider with en_US (pg_database.datlocprovider = 'i'), and
//    Intl.Collator resolves the same CLDR data — but "should agree" is not
//    evidence. Below are real property names in the exact order production
//    returned them, chosen for the hard cases: a leading '(', '#', '/' and '-'
//    inside an address, a bare '.', digits against spaces, and lowercase
//    against uppercase. If the comparator is ever changed, this is the check
//    that says the Properties list just silently reordered.
// ─────────────────────────────────────────────────────────────────────────
{
  const productionOrder = [
    '(addresses Not Yet Provided) - Madison',
    '#1 Pelican Pointe Drive - Saint Marys',
    '0 Towbridge Street - Smithfield',
    '0.6 Miles West Of Intersection I-20/N Hays Road - Clyde',
    '04915 Cecilia Drive - South Haven',
    '1 A Street - Austin',
    '1 McIntyre Court - Brunswick',
    '1 West Mosher St Apt 111 - Mount Pleasant',
    '10 1st Street Northeast - Chisholm',
    '10 North 6th - Bayfield',
    '10 North 6th Street - Bayfield',
    '100 - 134 Breckenridge Path - Eagle Lake',
    '100 / 102 South Jackson Street - Albany',
    '100 102 Dent Lane - Louisburg',
    '100 10th Avenue Southeast - Fairfax',
    '100 1st Avenue Northeast - Clarks Grove',
    '100 Abington Road - Lenoir',
    '100 Brooks Hollow Drive - Jasper',
    '100 Brooks Hollow Drive Phys: 1600 East Church Street - Jasper',
    '100 Fox Ridge Circle. - Murfreesboro',
    '100 McDonald Dr Apt - Mount Olive',
    '100 NC Highway #341 - Roanoke Rapids',
    '100 NC Highway 125 #341 - Roanoke Rapids',
    '100 NC Hwy 125 - Roanoke Rapids',
    '100 Surry Manor Ln # 45 - Dobson',
    '100 West Turner St Unit H-1 - Metter',
    '1000 Wynnton Road Hsg Auth Of Columbus Georgia - Columbus',
    '1000-1014 Cumberland Trail - Oshkosh',
    '1000-A Pickerell Drive - Southport',
    '10000 Newton Avenue South - Bloomington',
    '1001 1014 Long Creek Court - Kittrell',
  ]
  const disagreements = []
  for (let i = 0; i + 1 < productionOrder.length; i++) {
    if (compareTextValues(productionOrder[i], productionOrder[i + 1]) > 0) {
      disagreements.push(productionOrder[i])
    }
  }
  check('the client comparator reproduces the database order exactly', disagreements, [])

  // Sorting the shuffled set must reproduce that same order end to end — the
  // adjacent-pair check alone would not catch a non-transitive comparator.
  const shuffled = productionOrder.map((name, i) => ({ name, i }))
    .sort((a, b) => ((a.i * 7919) % 31) - ((b.i * 7919) % 31))
  check('sorting production names reproduces the database order',
    sortRowsByTextKey(shuffled, 'name').map(r => r.name), productionOrder)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`)
  process.exit(1)
}
