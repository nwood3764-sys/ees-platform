# Project Payment Request record — handoff

Owner: Nicholas Wood. Last session: 2026-07-31. Read this top-to-bottom before touching the Project Payment Request.

---

## 1. Vision / goal

The **Final Project Payment Request** is its own incentive-application record — record type **`WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST`** on `incentive_applications`, one per opportunity (opportunities are per building). It is the same program as the reservation, at a later stage: the reservation (an **enrollment**) goes in up front and moves the opportunity forward; after the project is complete you file the payment request. They are linked through `opportunity_id`.

The record's page layout must be a **field-for-field, place-for-place mirror of the "IRA HOMES Multifamily Project Submittal Form" JotForm — the Final Installation Payment Request path**, and it must **inherit values the same way the enrollment reservation layout does** (from the building / property / opportunity / signer contact). Nicholas's rule this session: **"Match the PDF exactly"** for placement, and **"still inherit the values like the enrollment — they're just not in the same physical places."**

JotForm: <https://focusonenergy.jotform.com/250306438751960> (the live URL is blocked by this env's proxy — `curl` returns 403; get the PDF/HTML from Nicholas). Nicholas uploaded `Final_IRA_HOMES_Project_Submittal_Form.pdf` + the HTML export last session; **re-request them at the start of the next session** (the scratchpad renders are session-ephemeral).

---

## 2. What shipped this session (all live on prod + master)

- **Record type + picker** — `WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST` active in the New Application picker (migration `…project_payment_request_record_type`).
- **Schema + 20 picklists** — `ia_*` columns + fixed-option picklists carrying the JotForm's EXACT option strings (application type, building/project type, income level, heating, who-gets-paid, tax classification, SSN-used, the five H&S tests `Passed|Warning|Failed|N/A`, mold/roof/ASHRAE/drainage/disclosed, modeling software), plus the `ia_work_completed` multiselect (`…schema_and_picklists`).
- **Dedicated page layout PL-00382** (record-type default; falls back to the master `incentive_applications` layout only if deleted).
- **Auto-name + drop legacy required fields** — `ia_name` auto-composes via `trg_ia_autoname`; `ia_name`/`ia_program_name` made nullable so the create form stops demanding them (they're not on any intake form). Client exemption in `TRIGGER_DERIVED_REQUIRED`/`DERIVED_READONLY` in `RecordDetail.jsx` (PR #370).
- **Verify Fields action** — top-of-record action on `incentive_applications` that flags empty editable fields (`recordActions.js` + handler in `RecordDetail.jsx`, PR #366).
- **Reservation → payment-request pre-fill** — `build_ia_payment_request_prefill(opportunity)` + `picklist_value_translate` RPCs (translate picklists by value string); a reactive create-mode hook in `RecordDetail.jsx` fills blanks only, at init when created from the opportunity and when the opportunity is picked on the global form (PR #381). `search_path` pinned on all new functions.
- **Enrollment-matched sourcing** — `ia_signer_contact_id` (Contact/Email/Phone, backfilled from `opportunities.opportunity_authorized_signer_id`, auto-set on insert) + editable `ia_occupied_units`; Installation Building + Utility re-sourced to the building/property columns the enrollment uses (PR #389).

PRs #366, #370, #381, #389 all merged to master + deployed. **Every migration was applied to prod via the Supabase MCP `apply_migration`** (note: MCP stamps its own apply-time version, so the prod migration-registry version ≠ the repo filename — this is normal for this repo).

---

## 3. THE OPEN PROBLEM (do this first) — layout does not match the PDF

Nicholas's screenshots show the data now inherits correctly (Dennis Hanson pulls in, building fields populate) **but the physical layout is wrong**, and I had carried **reservation-only fields into the payment layout**.

> **Installation Building is DONE as the worked example** (migration `…installation_building_match_pdf`, live on prod): reservation-only fields removed, only the 6 payment-form fields kept, address rendered full-width via `column:2` **spacer** fields. The spacer approach passes the widget-config validator. **Use this section as the template** — apply the same method (remove non-PDF fields, `column`+`spacer` to reproduce each row's pairing / full-width) to every remaining section, verifying each against the PDF Nicholas provides.

### 3a. How the renderer lays out columns (critical)

`FieldGroupWidget` in `src/components/RecordDetail.jsx` (~lines 3548-3566):

```js
const useCols = fields.some(f => f.column)
const nCols   = useCols ? Math.max(1, ...fields.map(f => f.column || 1)) : 1
// renders ONE <div> per column; each div gets ALL fields whose column === c, in array order:
<div style={{display:'grid', gridTemplateColumns:`repeat(${nCols}, minmax(0,1fr))`, alignItems:'start'}}>
  {[1..nCols].map(c => <div>{fields.filter(f => (f.column||1)===c).map(renderField)}</div>)}
</div>
```

**It is a pure column-fill: the entire left column (all `column:1` fields) stacks first, then the entire right column (all `column:2`).** Fields do NOT pair by array adjacency — `left[i]` lines up with `right[i]`. That is why "Building Owner Name" (a `column:1` field) rendered next to "State" (the 3rd `column:2` field). There is **no colspan** — a field can only live in one column.

**The alignment tool is the `spacer` field type** (renderField handles it at ~line 3320: "so the paired field in the other column lines up, mirroring the source form"). A spacer is `{ "type": "spacer", "column": 2 }` — it occupies a slot in a column so the next real field drops to the correct row. To make a field look full-width, put it in `column:1` and put a `spacer` in `column:2` at the same index (right side blank).

So to mirror the PDF you compute, per section, the ordered `column:1` list and `column:2` list (inserting spacers) so that each PDF row's left/right fields share the same index.

### 3b. What the payment PDF's *Installation Building Information* actually contains (verified from pages 4-5)

Only these, in this order — then it goes straight to "What work was completed?":
1. Business Entity Name (L) │ Contact Name (R)
2. Email (L) │ Phone Number (R)
3. Building Owner Name — First Name (L) │ Last Name (R)
4. Installation Address — Street Address (**full-width**), City (**full-width**), State/Province (**full-width**), Postal/Zip Code (**full-width**)

**The units / occupied units / square footage / floors / year built / income level / confirmation code / total project cost fields are NOT on the payment form's Installation Building** — they're reservation-form fields. Per Nicholas ("Match the PDF exactly"), they must come out of that section. Keep the inheritance wiring for any field that IS on the payment PDF (possibly in a different section — "not in the same physical places"); drop the rest from the layout (the values still live on the building/property records).

### 3c. Payment-path section/field layout captured so far (VERIFY each against the PDF Nicholas provides)

- **Application** (top, no header on form): I'm Applying for a(n) (L) │ Building Type? (R); Building Project Type? (full radio).
- **Primary Contractor Information**: Business Name (L) │ Contact Name First+Last (R); Email (L) │ Phone (R); Address — Street/Line2/City/State/Zip (full-width stacked); "Will a Support Contractor…" (radio).
- **Support Contractor Information** (conditional): Business Name │ Contact Name; Full Address (full); Phone (L) │ Email (R); "+ Add Another Support Contractor" (repeatable).
- **Installation Building Information**: the 6 fields in §3b.
- **Building Improvements** ("What work was completed?" — no separate header): the 23-measure multiselect (rendered 3-across on the form); Final Modeled Savings (L) │ Final Total IRA HOMES Rebate Requested (R); Final Total IRA HOMES Cost; a Date (MM-DD-YYYY).
- **Payment Information**: Who gets paid? (radio); Tax Classification (radio) │ Tax Identification FEIN (R); Is a SSN used? (radio); Email for Tax Purposes; Upload W9 (file); Mailing Address (Street/Line2/City/State/Zip full-width).
- **Health & Safety Testing**: combustion appliances? (radio); venting (L) │ spilling (R); gas leak (L) │ undiluted CO (R); ambient CO; mold/moisture (radio); roof condition (radio); ASHRAE 62.2 (radio); drainage (radio); disclosed to homeowner (radio).
- **Supporting Documentation**: HPXMLv4 │ Audit Template Report; Customer Report │ HOMES Final Invoice; Customer Contract SOW; Low-Income Owner Ack; Project Summary/Offer Letter │ IRA Notification of Combustion Safety; IRA MF 5+ Combustion Safety │ QI Tool pdf; Modeling Software Used; "Who is submitting this form?".

**Confirm the exact 2-column pairing of every section against the PDF before building** — the pairing above is partial. Note the LEAP layout also carries a small non-JotForm top section ("Payment Request": status_path + Property/Opportunity/Building lookups) needed to link the record; Nicholas has accepted this pattern (mirrors the reservation's top section), keep it.

### 3d. Field → inheritance source map (mirror the enrollment; keep for every field that stays)

From the enrollment reservation layout (`page_layouts` for `enrollments` record type `WI-IRA-MF-HOMES-Project-Reservation`, layout id ~`94af9c5b-bd66-43e4-b348-f4781efce547`). Query it live before building and copy sources verbatim. Confirmed sources:

| Field | Source (dotted `related_field`, unless noted) |
|---|---|
| Business Entity Name | `property_id.property_hud_owner_org` |
| Contact Name | **lookup** `ia_signer_contact_id` (contacts, `contact_name`) |
| Email | `ia_signer_contact_id.contact_email` |
| Phone Number | `ia_signer_contact_id.contact_phone` |
| Building Owner Name | enrollment used `property_id.property_hud_owner_org`; payment PDF wants First│Last (a person) — DECIDE with Nicholas whether to inherit the org, the signer's name, or leave editable |
| Installation Address / City / State / Zip | `property_id.property_street` / `property_city` / `property_state` / `property_zip` |
| Total Number of Units | `building_id.building_total_units` |
| Total Number of Occupied Units | **editable** `ia_occupied_units` (`property_ph_total_occupied` is not populated) |
| Total Building Square Footage | `building_id.building_square_footage` |
| Total Floors in Building | `building_id.building_stories_of_building` |
| Year the Building was Built | `building_id.building_year_built` |
| Which income level | **picklist** `ia_income_level` |
| Income-Qualified Confirmation Code | `building_id.ira_confirmation_code_lea` |
| Electric Provider / Account # | `building_id.building_electric_utility` / `building_electric_account_number` |
| How is this building heated? | `building_id.building_heating_fuel_type` (uuid picklist → `column_type:"picklist"`) |
| Natural Gas Provider / Account # | `building_id.building_gas_utility` / `building_gas_account_number` |
| Other Heating Fuel Provider | `building_id.building_heating_fuel_provider` |
| `ia_signer_contact_id` | backfilled from `opportunities.opportunity_authorized_signer_id`; auto-set on insert by `trg_ia_autoname` |

For `related_field` where the parent column is itself a lookup (e.g. showing a signer's name via the opportunity), the renderer supports `related.lookup_table`/`related.lookup_field` (2-hop). Contractor phone comes from the **contact** (`contact_phone`), not the account (account phone is blank).

---

## 4. Second open workstream — the document-generation PACKAGE

The original goal after the record: **generate the actual document package from this record** — HOMES Project Invoice, Sealed Invoice, Paperwork Workbook, and the **Notification of Combustion Safety** — one set per building, and **drop the project-based launch point** (`generate_final_payment_request_submittal` is currently scoped to `projects` in `recordActions.js`). Nicholas: this record (the incentive application, one per opportunity/building) is where payment-request paperwork belongs, not the project. See `docs/leap-project-paperwork-port.md` for the existing generators (`paperworkModel.js`, `paperworkService.js`, `ProjectSubmittalDocumentsModal.jsx`, `buildSealedPdf`, the `send-envelope` signing route) and `CombustionSafetyNotificationModal.jsx`.

---

## 5. Decisions (DECIDED)

- **2026-07-30 — the payment request is its own `incentive_applications` record type, one per opportunity (opportunities are per building).** Not on the project. Not the `project_payment_requests` object.
- **2026-07-31 — match the payment JotForm PDF EXACTLY for field placement** (Nicholas). Remove reservation-only fields not on the payment form; use `spacer` fields to reproduce the PDF's paired-rows + full-width layout.
- **2026-07-31 — keep enrollment-style value inheritance** for every field that stays (Nicholas: "still inherit the values like the enrollment, just not in the same physical places"). Source map in §3d; copy the enrollment reservation layout's `related` configs verbatim.
- **Do NOT copy the enrollment's LAYOUT** (Nicholas: "do not match the enrollment layout — they are not exactly the same"). Enrollment = value-sourcing reference only; PDF = layout reference.

---

## 6. File + DB index (what the next session touches)

**DB (prod project `flyjigrijjjtcsvpgzvk`)**
- `picklist_values` — record type `WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST` (object `incentive_applications`, field `record_type`); the 20 payment picklists (fields like `venting_test`, `who_gets_paid`, prefix-stripped).
- `page_layouts` PL-00382 (record-type default) + its `page_layout_sections` / `page_layout_widgets`. Rebuild pattern = soft-delete existing sections+widgets, re-insert (see the trueup migration). `widget_title` is NOT NULL — pass `''`. `page_layout_widget_record_number` auto-fills — pass `''`. `trg_validate_page_layout_widget_config` validates every field's column/FK on insert.
- `incentive_applications` columns added this session: `ia_application_for, ia_building_type, ia_building_project_type, ia_income_level, ia_heating_type, ia_who_gets_paid, ia_tax_classification_type, ia_ssn_used, ia_has_combustion_appliances, ia_venting_test, ia_spilling_test, ia_gas_leak_test, ia_undiluted_co_test, ia_ambient_co_test, ia_mold_moisture, ia_roof_condition, ia_ashrae_62_2, ia_drainage_condition, ia_disclosed_to_homeowner, ia_modeling_software, ia_work_completed(jsonb), ia_contractor_account_id, ia_contractor_contact_id, ia_has_support_contractor, ia_support_contractor_account_id, ia_support_contractor_contact_id, ia_submitted_by, ia_signer_contact_id, ia_occupied_units, ia_installation_contact_name, ia_building_owner_name, ia_in_unit_owner_name, ia_email_for_tax_purposes, ia_payment_mailing_{street,line2,city,state,zip}, ia_final_modeled_savings, ia_final_total_ira_homes_rebate_requested, ia_final_total_ira_homes_cost, ia_project_completion_date`. (`ia_installation_contact_name`, `ia_building_owner_name`, `ia_in_unit_owner_name`, `ia_other_account_number` may now be unused after the true-up — check before dropping.)
- Functions: `build_ia_payment_request_prefill(uuid)`, `picklist_value_translate(uuid,text,text)`, `incentive_application_autoname()` (trigger `trg_ia_autoname` — also defaults `ia_signer_contact_id`). All `SET search_path=''`.
- Reference layout: `enrollments` reservation layout (value-sourcing source of truth).

**Code**
- `src/components/RecordDetail.jsx` — `FieldGroupWidget` (column-fill + `spacer` at ~3320, layout at ~3551); create-mode reservation-prefill hook (search "applyPaymentRequestPrefill"); `TRIGGER_DERIVED_REQUIRED`/`DERIVED_READONLY`; `TABLE_META.incentive_applications`; `handleVerifyFields`.
- `src/data/recordActions.js` — `VERIFY_FIELDS` action; `generate_final_payment_request_submittal` (still `projects`-scoped — move to `incentive_applications` in §4).
- `src/data/layoutService.js` — `fetchPageLayout` (record-type→layout resolution, null-record_type fallback); `TABLE_COLUMN_PREFIX` (`incentive_applications`→`ia`).
- `supabase/migrations/…` this session (chronological): `…project_payment_request_record_type`, `…schema_and_picklists`, `…layout`, `…autoname_and_optional_legacy_fields`, `…prefill_from_reservation`, `…functions_search_path_hardening`, `…layout_drop_program_fix_contractor_phone`, `…layout_trueup_to_jotform`, `…signer_contact_occupied_units_and_autoset`, `…installation_utility_enrollment_sourcing`.

**Layout-generation approach**: last session generated the layout SQL with a Python script (JSON via `json.dumps`, SQL-escape `'`→`''`) then applied a teardown+rebuild migration — reliable for large widget_configs. Reuse that. For small edits, targeted `UPDATE … widget_config = jsonb_set(...)` per widget.

---

## 7. Hazards / house rules

- Commit author MUST be `Nicholas Wood <nicholas.wood@ees-wi.org>` or Netlify blocks the build. `npm run build:safe` before relying on a build (code changes only — DB-only migrations don't need it). Migration filenames = actual UTC clock stamp; `ls supabase/migrations | cut -d_ -f1 | sort | uniq -d` must be empty.
- Layout changes are DB-driven → applying the migration to prod is live immediately (refresh); no code deploy needed. Verify deploys via the Netlify API (`ees-ops`, `netlify-project-services-reader` / `netlify-deploy-services-reader`), not `curl` (proxy blocks the site).
- Squash-merge divergence: the branch's commits aren't in master's linear history after each squash-merge. To open a follow-up PR, `git checkout -B <branch> origin/master && git cherry-pick <only-the-unmerged-commits>`, then force-with-lease + new PR.
- After DROP/CREATE function: keep `SET search_path=''`, re-issue REVOKE/GRANT, `NOTIFY pgrst,'reload schema'`. `get_advisors(security)` after DDL — baseline categories only (auth_security_definer, rls_disabled spatial_ref_sys, extension_in_public, leaked-password); `function_search_path_mutable` is fixable and was cleared this session.

---

## 8. First moves for the next session

1. Ask Nicholas for the payment JotForm PDF/HTML again (or the field list per section with exact 2-column pairing).
2. Query the enrollment reservation layout live for the `related` source of every field that stays.
3. Rebuild PL-00382 section-by-section to match the PDF exactly: remove reservation-only fields; use `column` + `spacer` fields to reproduce each row's pairing and the full-width fields; keep §3d inheritance. Generate via the Python-script + teardown/rebuild-migration approach; apply; verify on prod; commit as Nicholas; rebase-onto-master + PR + merge.
4. Then tackle §4 (document-generation package + move the Generate action off projects).
