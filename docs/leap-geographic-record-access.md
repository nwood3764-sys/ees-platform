# LEAP — Geographic (State) Record Access

**Status:** Phase 1 shipped 2026-08-23. Live on production.
**Origin:** Nicholas, 2026-08-23 — "I need to set up a user for James… I only want him to access North Carolina properties and information. Is that set up currently, and can we do that? This goes from records to accounts to contacts, absolutely everything." Followed by, when asked whether he should be able to write inside NC: **"He cannot see anything outside North Carolina at all for any reason."**

---

## 1. Vision

A user is granted one or more **states**. They see only records that belong to those states — and they cannot create or edit anything outside them either. Everything else on the platform behaves exactly as it did.

This is the record-level half of security. LEAP already had the object-level half.

---

## 2. What was actually there before

The honest answer to "is that set up currently" was **no**.

- `app_user_can(object, action)` — the resolver behind every `app_select_*` policy — takes an **object** and an **action**. It has no record argument. A role that can read `properties` reads all 21,534 of them, in every state.
- `role_object_access` (961 rows) and `permission_sets` are object-level grants. `field_permissions` (12 rows) is field-level. Neither narrows *which rows*.
- **`app_user_in_scope(object, record_id)` existed and looked like the answer — it is not.** No policy anywhere referenced it (verified: zero), and its third statement is `IF NOT v_is_portal THEN RETURN true` — internal staff bypass it by construction. It scoped by explicit account/property lists, not geography, and `user_account_scopes` held **0 rows**. It has never restricted anybody.
- `service_territories` (9 rows, with a `service_territory_state`) is dispatch geography — which crew covers which ZIP codes. Nothing reads it for security.

So the platform had the vocabulary of record-level security and none of the enforcement.

---

## 3. What shipped

### 3.1 The three purpose-named artifacts

| Artifact | What it is |
|---|---|
| **`user_state_scopes`** (USS-) | The grants. One row per user per state. |
| **`record_state_scope_sources`** (RSSS-) | The registry: how each object resolves to a state. One row per resolution **path**; an object may declare several and is in scope if **any** resolves. |
| **`install_record_state_scoping(object)`** | Generates that object's enforcement from the registry. |

### 3.2 Enforcement shape

Each scoped object gets a **RESTRICTIVE** RLS policy, ANDed with whatever policies it already had:

```sql
CREATE POLICY state_scope_<object> ON public.<object> AS RESTRICTIVE FOR ALL TO public
  USING      ((SELECT public.app_user_state_scope()) IS NULL OR <predicate>)
  WITH CHECK ((SELECT public.app_user_state_scope()) IS NULL OR <predicate>);
```

Three deliberate properties:

1. **RESTRICTIVE means it can only ever take access away.** Installing it on 116 objects could not widen anyone's access by mistake.
2. **`app_user_state_scope()` returns NULL for anyone unrestricted** — an Admin, a portal user, or an internal user with no grants. NULL short-circuits the whole predicate, so every existing user's access is unchanged and costs one extra InitPlan evaluation per query.
3. **`FOR ALL` with `WITH CHECK`** means the same predicate governs INSERT and UPDATE. A scoped user cannot create or edit outside their states, not merely fail to see it.

### 3.3 Resolution kinds

| Kind | Meaning | Example |
|---|---|---|
| `own_state_column` | The object carries the state | `properties.property_state` |
| `parent_lookup` | Follow a foreign key | `buildings.property_id` |
| `child_reverse_lookup` | In scope when a child resolves | `accounts` ← `properties.property_account_id` |
| `polymorphic_lookup` | Object-name + record-id pair | `documents.related_object` / `related_id` |
| `platform_configuration` | Carries no customer data — never scoped | picklists, layouts, work types |
| `hidden_when_scoped` | Customer data with no state linkage — never shown to a scoped user | LIHTC staging |

**All 245 public base tables are classified. `record_state_scope_status()` reports zero unregistered.** 116 carry a live policy; 129 are platform configuration.

### 3.4 Fail closed

Per Nicholas's ruling, a record that cannot be **proved** to be in the user's states is not shown. A work order with a null `property_id`, an unmatched inbound email, an import staging row that never linked — all invisible to a scoped user. This is a decision, not an accident, and it is stated plainly in HA-00182.

---

## 4. Four things that went wrong, and why they matter next time

These cost most of the build and are the reason the shape is what it is.

**1. Inline joins in a policy recurse.** The first install put the join chain directly in each policy. Counting work orders then failed with `infinite recursion detected in policy for relation "work_orders"` — `work_orders.wo_select` reads `service_appointments`, and the new `service_appointments` policy read back into `work_orders`. **Any table reference inside a policy is subject to that table's own policies.** The chain has to be evaluated somewhere RLS does not apply.

**2. `plpgsql EXECUTE` re-plans per row.** Moving the chain into one generic SECURITY DEFINER function fixed the recursion and made the platform unusable: counting 7,536 accounts re-planned a nested EXISTS chain 7,536 times and hit the statement timeout. The fix is a **generated resolver per object with a static body** — `record_state_scope_<object>(id, states)`, `LANGUAGE sql`, so the plan is prepared once and cached.

**3. A STABLE function called bare in a policy is evaluated per row.** Even with static resolvers, queries still timed out, and the cancellation named the culprit: `app_current_role_name during startup / app_is_admin / app_user_state_scope`. Wrapping it as `(SELECT public.app_user_state_scope())` makes the planner hoist it into an InitPlan and evaluate it once. **LEAP's existing policies already do this** — `app_select_accounts` reads `( SELECT app_user_can('accounts','read') )`, not the bare call. Match that shape.

- Corollary: `x = ANY ((SELECT f()))` parses as the *subquery* form of ANY and fails with `operator does not exist: text = text[]`. It needs an explicit cast: `ANY ((SELECT f())::text[])`.

**4. Generating 110 granted functions is 110 advisor findings.** Granting each resolver to `authenticated` so policies could call them added ~105 `authenticated_security_definer_function_executable` lints and published 110 SECURITY DEFINER functions on the REST surface. Policies now go through the single entry point `record_in_state_scope(object, id)`, which is itself SECURITY DEFINER, so the nested resolver call runs as the owner and **EXECUTE stays revoked on every generated resolver**. One public entry point, not 110.

Also worth knowing: **`app_current_role_name()` requires `user_is_active = true`.** An inactive user has *no role at all*, so `app_is_office_side()` is false and work orders vanish — for reasons that have nothing to do with geography. James was created inactive at first and his previewed access looked far narrower than it is.

---

## 5. Proof

Verified by impersonating James in rolled-back transactions against real production data (`SET LOCAL ROLE authenticated` + a JWT claim), not by reading the code.

| Object | Total | James sees | Independently expected |
|---|---:|---:|---:|
| properties | 21,534 | **5,597** | 5,597 NC |
| properties outside NC | — | **0** | 0 |
| accounts | 7,536 | **1,816** | 1,816 with an NC property |
| contacts | 57 | **22** | 22 |
| buildings | 92 | **46** | 46 |
| units | 184 | **8** | 8 |
| opportunities | 97 | **54** | 54 |
| projects | 36 | **10** | 10 |
| work_orders | 112 | **22** | 22 |
| work_steps | 1,337 | **195** | — |
| photos | 697 | **100** | 100 (preview agrees) |
| field_history | 1,058 | **55** | 55 (preview agrees) |
| property_source_data | 5,347 | **3,710** | 3,710 |
| picklist_values (config) | 1,767 | **1,767** | unrestricted |
| page_layouts (config) | 232 | **232** | unrestricted |

Writes:

| Attempt | Result |
|---|---|
| Create a WI / TX / GA / MI property | **blocked** — `new row violates row-level security policy "state_scope_properties"` |
| Create an NC property | passes the scope layer (then hits ordinary NOT NULL / CHECK requirements) |
| Edit an NC property | **1 row updated** |
| Move an NC property to WI | **blocked** by the same policy |
| Blanket `UPDATE`/`DELETE` of every WI property | **0 rows** |

Existing users unchanged — Scott Huenefeld (Project Site Lead, no grants): 21,534 properties, 7,536 accounts, 112 work orders, 57 contacts, `scoped = false`.

Nothing was written: every check ran inside a transaction that was rolled back.

---

## 6. James

- **USR-00018 · James · Operations Manager · NC.**
- **Operations Manager** is a new role. Object and module access were **copied from Project Manager** (107 objects, 14 modules) — the widest operational non-Admin baseline — and the role was added to `app_is_office_side()`.
- **No auth link. He cannot sign in.** The invitation is deliberately not sent.
- **Outstanding:** his last name and work email. `users.user_last_name` is NOT NULL and currently empty, so the record reads "James". Both are needed before the invite goes out.

---

## 7. Admin surface

**LEAP Admin → Users** now carries a **Record Access** column: an emerald state badge when restricted, a neutral **All states** when not. **Manage** opens `UserStateAccessModal`:

- state chips with the property count behind each, click to grant or revoke;
- a banner that states plainly which of the two states the user is in — the "no grants means unrestricted" point is the one thing this screen must not get wrong;
- **Preview access** → `preview_user_state_scope_access(user_id)`, which counts rows object by object using the same generated predicate the policies use. It reports counts only and never returns records.

The state list comes from `list_state_scope_options()` — read from the properties that exist, never hardcoded.

---

## 8. Decisions

1. **Absolute, fail-closed. DECIDED 2026-08-23, Nicholas** — "He cannot see anything outside North Carolina at all for any reason." A record that cannot be resolved to a granted state is not shown.
2. **No grants means unrestricted. DECIDED 2026-08-23** — makes the change additive, so no existing user was affected. The alternative (an explicit per-user "is scoped" flag) has a silent failure mode: forget the flag and the restriction quietly does nothing.
3. **A multi-state account is visible; only its in-state properties are. DECIDED 2026-08-23** — follows the one-account-per-company rule. Contacts follow their account, so a contact at an NC-owning company is visible even if that person sits elsewhere.
4. **A contact is visible only through its account. DECIDED 2026-08-23** — falls out of fail-closed; 22 of 57 contacts resolve for NC. A contact with no account would be invisible (none exist today). If EES's own employee contacts need to stay visible to scoped users — they name crews in dispatch and scheduling — that is **one registry row**, not a code change.
5. **Join-based resolution, not a denormalised state stamp on every table. DECIDED 2026-08-23** — correct by construction with no drift and no cascade to maintain when a property changes state. The stamped-column optimisation stays available if profiling ever demands it (see §10).
6. **Operations Manager mirrors Project Manager. DECIDED 2026-08-23** — the widest operational baseline; narrow it deliberately if that turns out to be too much.

---

## 9. Open / next

- **James's last name and email**, then send the invite.
- **Confirm the fail-closed edges are what Nicholas wants** once he has previewed. The live data today: all 57 contacts do have an account, so the 35 he cannot see are people at companies with no NC property (including EES's own staff contacts, if EES's account holds no NC property — that is the one worth checking, since dispatch and scheduling name people); every work order has a property, so that edge does not currently bite; `unmatched_inbox` is 482 of 483 hidden, since only one inbound email has ever been linked to a conversation; and the six `hidden_when_scoped` staging tables are invisible by declaration.
- **`record_state_scope_sources` has no record page.** It is a real object with a record number and RLS, but adding or changing a resolution path today is a database change. Object Manager is schema administration only. Same gap as `record_audit_column_overrides` (2026-08-22).
- **`tasks` reads 5 in the preview but 0 to James** — the preview bypasses RLS to count, so the difference is `tasks`' own permissive policies, not this layer. Worth confirming that is intended.
- **`audit_log` is invisible to him at the object level** (Project Manager has no read on it), so its state scoping is untested against a real read. The polymorphic path is proven through `field_history` (55 of 1,058).
- **The old `app_user_in_scope` / `user_account_scopes` / `user_program_scopes` trio is still dead code.** Now that real record-level security exists, decide whether the account/property axis gets rebuilt on this engine or the tables are retired.
- **Second axis.** The same registry could carry a program or account axis. Do not build it until someone asks.

---

## 10. Performance notes

- An unrestricted user pays one InitPlan evaluation of `app_user_state_scope()` per query. Nothing else changes.
- A scoped user pays one function call per row on scoped objects, resolving through cached-plan resolvers — at most four primary-key lookups deep (photo → work step → work order → property).
- `properties` and the other own-state-column objects compare a column directly with no call at all, and `properties (upper(btrim(property_state)))` is indexed.
- Indexes added for the generated predicates: `properties` on the upper-trimmed state, `property_account_id`, `property_management_company_id`, `property_hud_property_id`; `(object, record_id)` pairs on `audit_log`, `field_history`, `documents`, `photos`, `tasks`, `activities`.
- **Known hot spot:** `audit_log` (742,982 rows) resolves per row through the polymorphic dispatcher. Filtered reads are fine; an unfiltered scan by a scoped user would not be. If that ever matters, the answer is a denormalised state column maintained by trigger — the same generated-trigger pattern as `install_record_audit_stamping`.

---

## 11. File and table index

| Path | Role |
|---|---|
| `supabase/migrations/20260823004619_record_state_scope_engine.sql` | Tables, resolvers, installer |
| `…010500_record_state_scope_registry_seed.sql` | All 245 tables classified |
| `…020400_record_state_scope_resolve_outside_rls.sql` | Recursion fix |
| `…023000_record_state_scope_static_resolvers.sql` | Per-object static resolvers |
| `…025200_record_state_scope_polymorphic_grant.sql` | Policy-level entry point |
| `…031000_record_state_scope_initplan_states.sql` | InitPlan states |
| `…043000_state_scope_preview_polymorphic_states.sql` | Preview correctness |
| `…053000_state_scope_single_public_entry_point.sql` | One granted function, search_path fixes |
| `…041500_preview_user_state_scope_access.sql` | Preview RPC |
| `…045000_list_state_scope_options.sql` | State options RPC |
| `…014200_operations_manager_role_and_james_nc_scope.sql` | Role + James + NC grant |
| `…034500_james_user_active_pending_invitation.sql` | Active, still uninvited |
| `…055500_help_geographic_record_access.sql` | HA-00182 |
| `src/lib/stateScope.js` | Pure rules (grants → display) |
| `src/data/stateScopeService.js` | Grants, options, preview |
| `src/modules/admin/UserStateAccessModal.jsx` | Record Access screen |
| `src/modules/admin/UsersPane.jsx` | Record Access column |
| `scripts/state-scope-fixture.mjs` | 26 checks, incl. empty-grants-means-unrestricted |

**Tables:** `user_state_scopes`, `record_state_scope_sources`.
**Functions:** `app_user_state_scope()`, `app_user_is_state_scoped()`, `record_in_state_scope(object,id[,states])`, `record_state_scope_<object>(id,states)` × 110, `build_record_state_scope_predicate()`, `install_record_state_scope_resolver()`, `install_record_state_scoping()`, `rebuild_record_state_scope_dispatcher()`, `record_state_scope_status()`, `preview_user_state_scope_access()`, `list_state_scope_options()`.
