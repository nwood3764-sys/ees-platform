# LEAP Assistant Reliability — making "it can't happen ever again" true

**Owner:** Nicholas Wood · **Author of this pass:** assistant session 2026-08-12
**Status:** spec / phased plan. Layer 1 is the guarantee and is buildable immediately.

---

## 1. Vision / goal

The LEAP Assistant must be safe for ordinary staff to use without the double- and
triple-checking Nicholas is doing today. The bar is not "the assistant is smart";
the bar is **the assistant cannot persist an invalid record — no matter what it
proposes.** Intelligence reduces friction; it never provides the guarantee. The
guarantee comes from the database.

Concretely, the failures observed on the 1226 W. Florence St exhaust-fan job must
become structurally impossible:
- exhaust-fan work orders stamped with an **air-sealing** work-order record type
  ("Advanced Infiltration Reduction"),
- an exhaust-fan project record type flipped onto an **ASHRAE Level 1 assessment**
  project (PROJ-00048),
- the assistant claiming success it never verified.

## 2. What just shipped this session (context)

Live on prod already (branch `claude/leap-assistant-verification-whmc55`, PRs #433/#434/#443, ai-assistant edge fn v33):
- **Date + caller identity injected every turn** — it no longer asks the date or "who is Logan"; it resolves coworkers itself. (`buildNowContext`, `fetchCallerProfile`.)
- **No premature "Done"** — the prompt bars claiming a verified outcome in the same turn it emits actions, and requires a re-query when challenged.
- **Bounded observe→verify→self-correct loop** (client) — after a batch or a failure, the real result is fed back and the assistant confirms or fixes. `AssistantPanel.jsx` `runAndRender`/`VERIFY_DIRECTIVE`/`warrantsVerify`, cap `MAX_AUTO_FOLLOWUPS=3`.
- **Record-type lookup + column-name discipline** — the prompt now resolves record types under `picklist_field='record_type'` (not the column name), and forbids prefix-guessing column names.

These fixed the *symptoms we saw*. They do **not** deliver the guarantee — a wrong-but-well-typed value (wrong record type, wrong parent) still commits. That is what this plan addresses.

## 3. Current-state architecture map (grounded)

**The assistant is three files + one RPC:**
- `supabase/functions/ai-assistant/index.ts` — the "brain": Anthropic tool-use loop.
- `src/components/AssistantPanel.jsx` — the client agentic loop + UI.
- `src/data/assistantService.js` — thin bridge.
- **`commit_screen_flow_run`** (current def: `supabase/migrations/20260803154108_activity_relations_sync_and_assistant_multirelate.sql:77`) — the **single write path** for both the assistant and the flow UI.

**Model:** one fixed constant `MODEL = "claude-sonnet-4-6"` (`index.ts:56`). No routing/tiering — a one-word lookup and a 17-record batch use the same model. Pricing constants are Sonnet-specific (`index.ts:57-58`).

**How writes are grounded today:**
- Mutating tool calls are **not executed or checked** in the edge function — they are lowered (`lowerToAction`, `index.ts:668`) and pushed to `proposedActions` verbatim (`index.ts:587-595`), returned to the client, and auto-committed (`AssistantPanel.jsx:419-424`) with no column/value check.
- The **only** structural backstop is inside `commit_screen_flow_run`: an **unknown-column guard** (`20260803154108_...sql:183-207`) that rejects keys that aren't real columns and returns the valid-column list. This is the template for where a validation hook goes.
- **Gap:** that guard checks column *existence* only. A syntactically valid column carrying a wrong value — wrong `record_type`, wrong parent id, a non-member picklist value — passes straight through `EXECUTE format('INSERT ...')` (`:363`). Value correctness has **zero** structural enforcement.
- `describe_object` returns column names/types but **no picklist/enum values** (`index.ts:744-751`), so the model must separately `fuzzy_resolve kind='picklist'` — and only its own discipline ties the two together.

**What validation infrastructure exists:**
- **`validation_rules` table** (`20260412000000_leap_baseline_schema.sql:5416`) — **dormant.** `condition_config` jsonb is never read anywhere; no engine, no trigger, no reader in the commit path. Admin CRUD + RLS exist; the runtime is absent.
- **`picklist_value_record_type_assignments` (PVRTA)** (`:3647`) — the existing record-type **scoping** mechanism (how opportunity stages are scoped per record type). Resolver `picklist_values_for_record_type(p_object,p_field,p_record_type)` (`:14794`) with the key semantics: **no edges ⇒ universal (available everywhere); edges present ⇒ only where an edge matches.** But it scopes *same-object field values*, not *cross-object parent→child record types*.
- **`default_record_type_for(p_obj)` + BEFORE INSERT triggers** (`20260727134718_enforce_record_type_on_all_typed_objects.sql`) — precedent for DB-layer record-type invariants enforced from *any* write path.
- **Verify loop** — exists (this session) but shallow: the `[system: Created …]` note carries only `table id (url)` (`AssistantPanel.jsx:400-403`), so it verifies *existence/count*, not *correctness*. `warrantsVerify` only fires on batch or failure.
- **No precedent/example retrieval** — nothing directs the model to fetch a known-good existing record to mirror before a create.
- **`search_knowledge`** (`index.ts:835-867`) — a real embedding-retrieval tool, today scoped to procedures/program subject-matter; could host structural "how to build records" rules but doesn't.

**Pain points, candidly:** the assistant guesses values and nothing stops it; the write path enforces columns but not meaning; the model tier is fixed at the cheaper option; verification is existence-only; there is no eligibility concept anywhere in the schema.

## 4. Target architecture + design principles

1. **The database is the guarantee.** Invalid combinations are rejected at the one choke-point (`commit_screen_flow_run`), so the assistant *and* the manual UI *and* imports are bound identically. No model, no user, can persist them.
2. **Additive, data-driven, no hardcoding.** New rules live in tables managed through LEAP Admin, mirroring the PVRTA "universal-unless-scoped" default so it feels native and starts permissive.
3. **Errors are teaching signals.** A rejection rides the existing error→`[system:…]`→verify→self-correct path, so the assistant fixes itself instead of dead-ending. Rejection messages must be descriptive (name the allowed values), exactly like the unknown-column guard.
4. **Intelligence reduces friction, not risk.** Better model, grounding, and verification make the assistant *hit* the guardrails rarely — but the guardrails, not the model, are why bad data can't land.

## 5. Phased build plan (each phase additive + independently shippable)

### Phase 1 — Record-type eligibility guardrail (THE GUARANTEE) — build first
Make "child record type X is not allowed under parent record type Y" a hard, data-driven constraint.
- **New edge table `record_type_eligibility`** (mirrors PVRTA): `rte_parent_object`, `rte_parent_record_type_id` (FK `picklist_values`), `rte_child_object`, `rte_child_record_type_id` (FK `picklist_values`), nullable `rte_work_type_id` (FK `work_types`), plus standard audit/soft-delete/`is_seed_data`. Semantics: **no edges for a (parent_object, child_object) pair ⇒ unconstrained; edges present ⇒ the child's record type must match one.** Starts permissive; you seed only the pairs you care about (exhaust-fan, assessment) first.
- **Resolver** `record_type_eligible(p_parent_object, p_parent_rid, p_child_object, p_child_record_type)` → boolean (STABLE, SECURITY DEFINER): read the parent's `_record_type`, check for a matching active edge.
- **Hook** in `commit_screen_flow_run`, alongside the unknown-column guard: in the `record_create` branch (after the permission/field checks) and `record_update` branch, when the target carries a `_record_type` and a parent FK, call the resolver and `RAISE EXCEPTION 'Record type % is not allowed on a % whose parent %/… — allowed: …'` on mismatch. The existing `BEGIN…EXCEPTION WHEN OTHERS` wrapper turns it into a clean per-action error automatically — **no other plumbing**, and it rides the self-correct loop for free.
- **Also cover work-type↔record-type**: reject a work order whose `work_type` is incompatible with its `work_order_record_type`/its project's record type (this is exactly the air-sealing-on-exhaust case). `work_types.work_type_default_*_record_type` already exists as the *default*; this makes the mismatch *impossible*.
- **Optional** later: invoke the same resolver from the `20260727134718` BEFORE INSERT triggers so non-flow paths (imports, direct RPCs) are covered too.
- **Admin UI**: manage edges under Setup → Object Manager → Record Types (extend the PVRTA editor pattern).

### Phase 2 — Ground the assistant's write *values* (fewer rejections)
- **`describe_object` returns picklist values** for picklist/record-type columns (it returns none today), so the model sees valid record types/statuses inline instead of guessing then resolving separately.
- **Deepen the verify note**: have `commit_screen_flow_run` return the persisted `record_type`/parent-fk of each created row (or a follow-up read), and echo them in the `[system: Created …]` note; broaden `warrantsVerify` so correctness-sensitive creates (typed records, children with parents) always verify, and strengthen `VERIFY_DIRECTIVE` to check those fields.
- **Precedent retrieval**: a tool/prompt step — before creating records of a kind, fetch a recent known-good example (e.g. "an existing exhaust-fan project under WI-IRA-MF-HOMES") and mirror its `record_type`/parentage. This is how the 1837 batch would have been the template for 1226.

### Phase 3 — Smarter engine (less friction on hard jobs)
- **Model tiering**: route multi-record/creation-heavy or planning-heavy requests to an Opus-tier model; keep Sonnet for cheap lookups. Requires making the cost computation (`index.ts:648-649`) model-aware. Single highest lever on raw "smartness."
- **(Deeper, optional)** server-side in-loop execution so the assistant observes write results *mid-task* rather than only after the turn — the fuller agentic rearchitecture.

### Phase 4 — Domain knowledge as data
- Seed structural "how to build records correctly in LEAP" rules (record-type semantics, precedent-mirroring, parent chains) into the Knowledge Base behind `search_knowledge`, and instruct the model to consult it before creates. Less critical once Phase 1 exists (guardrails catch violations regardless), but reduces attempts that hit the wall.

## 6. Technical recommendations & hazards

- **Reuse, don't reinvent:** the eligibility table copies PVRTA's shape and its "universal-unless-scoped" default; the hook copies the unknown-column guard's placement and error style; the error path is already built. This is a small, idiomatic build.
- **Start permissive:** ship Phase 1 with zero edges = zero behavior change, then seed the exhaust-fan/assessment pairs. No big-bang matrix.
- **Descriptive rejections:** the `RAISE EXCEPTION` message must list the allowed record types — the self-correct loop can only fix what the error tells it (proven by the column guard).
- **Don't wake `validation_rules` for this:** its generic `condition_config` engine is a larger, separate build; the targeted eligibility table is the right tool for record-type/parent rules. Revisit `validation_rules` only for free-form field validations later.
- **Migration hygiene:** stamp real UTC `YYYYMMDDHHMMSS`; run `get_advisors(security)` after the DDL; the new resolver carries the standard authenticated-executable lint like every SECURITY DEFINER RPC.

## 7. Decisions (recommendation-first; confirm to mark DECIDED)

- **D1 — Guarantee via DB guardrail, not model smarts.** *Recommend DECIDED.* Everything else is friction reduction.
- **D2 — New `record_type_eligibility` edge table over reviving `validation_rules`.** *Recommend yes* — targeted, mirrors PVRTA, minimal.
- **D3 — Enforce in `commit_screen_flow_run` first; triggers later.** *Recommend yes* — covers the assistant + UI immediately; imports later.
- **D4 — Model tiering (Opus for heavy jobs).** *Recommend yes*, Phase 3 — real cost/latency trade to confirm.
- **D5 — "Default/primary record type" is a convenience, not the guarantee.** Keep the default-stamping triggers for prefill, but only the eligibility rule makes wrong ones impossible.

## 8. File + DB-table index (what the build will touch)

- `supabase/functions/ai-assistant/index.ts` — `MODEL` (tiering), `runReadTool`/`describe_object` (picklist values), `search_knowledge`.
- `src/components/AssistantPanel.jsx` — `performCommit` (deeper note), `warrantsVerify`/`VERIFY_DIRECTIVE` (correctness verify).
- `supabase/migrations/20260803154108_...sql` → the live `commit_screen_flow_run` (add the eligibility hook in a NEW migration).
- New migration: `record_type_eligibility` table + `record_type_eligible()` resolver + hook.
- Reuse: `picklist_value_record_type_assignments` / `picklist_values_for_record_type` (pattern), `default_record_type_for` + `20260727134718` triggers (later coverage), `work_types.work_type_default_*_record_type` (defaults).
