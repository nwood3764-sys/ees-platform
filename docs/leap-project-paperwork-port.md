# LEAP Project Paperwork — porting invoice generation from the Audit Template Builder

Handoff spec for building HOMES program paperwork generation (invoices, proposals,
workbook) INTO LEAP, lifted from the standalone Audit Template Builder. Written
2026-07-26. Source of truth for the ported logic is
`audit-template-builder/frontend/index.html` on `master` (build 61) — same repo,
so the building session can read every referenced function directly. The
LEAP-side facts below were verified against the live codebase on the same date.

> **STRUCTURAL CORRECTION (Nicholas, 2026-07-26) — "paperwork" is not a
> thing; SUBMITTALS are.** The first cut shipped a single generic "Generate
> Paperwork" action producing all six documents at once. That was wrong and
> has been replaced. The real model, confirmed by Nicholas and already
> documented in `docs/leap-project-lifecycle.md`:
>
> **Every program runs its own incentive application, and every incentive
> application has the same three stages, which can be months apart:**
>
> | # | Submittal | Lifecycle stage | Where it is generated |
> |---|---|---|---|
> | 1 | **Income Qualification Application** | Stage 3 — Enrollment & Income Qualification | **Already built** — `run_income_qualification` on the **enrollment** record produces the IRA Multifamily Application PDF + Tenant Data Sheet XLSX. Not duplicated by this port. |
> | 2 | **Project Reservation** | Stage 6 — Project Reservation | `generate_project_reservation_submittal` action on projects |
> | 3 | **Final Project Payment Request** | Stage 11 — Project Payment Request | `generate_final_payment_request_submittal` action on projects |
>
> It is a **matrix, not a list**: a property commonly runs several programs
> at once and each carries all three stages with its own dates, owner, and
> documents. That is exactly why `incentive_applications` has **WI-IRA-MF-HOMES
> and WI-IRA-MF-HOMES-AUDIT as separate record types**, and why the opportunity
> stage picklists come in parallel sets ("HOMES Phase 4: Project Reservation"
> vs "HOMES **Audit** Phase 4: Project Reservation"). **The audit is its own
> program, not a step inside HOMES** — so the Energy Audit Invoice is the
> AUDIT program's Final Project Payment Request document, not a HOMES
> document.
>
> The matrix lives in **`src/data/paperworkSubmittals.js`** — the single
> source of truth for which documents belong to which (program, stage) pair.
> Adding a program or document is a data edit there, never a UI change. All
> eight `incentive_applications` programs are declared; the six without built
> documents carry empty sets so the gap is visible rather than silently wrong.
>
> Current document coverage:
> - **WI-IRA-MF-HOMES-AUDIT → Final Project Payment Request**: Energy Audit Invoice
> - **WI-IRA-MF-HOMES → Project Reservation**: Project Reservation Proposal, Sealed Proposal, Paperwork Workbook
> - **WI-IRA-MF-HOMES → Final Project Payment Request**: Project Invoice, Sealed Invoice, Paperwork Workbook
>
> Still open from this correction (§9): `project_reservations` is an empty
> shell table (no statuses, no UI) while `project_payment_requests` has a full
> 9-status lifecycle — the two reservation/payment submittals are currently
> tracked only as flat date fields on the incentive application. Making each
> submittal a real record with its own status, owner, and due date is the
> natural Phase 2.
>
> **PHASE 1 SHIPPED (2026-07-26, same day).** The port is live:
> `src/data/paperworkModel.js` (pure math + document builders, node-tested),
> `src/data/paperworkService.js` (record context, Asset Score PDF parsing,
> workbook fetch), `src/components/ProjectPaperworkModal.jsx` (lazy), and the
> `generate_paperwork` record action on projects. All Phase-1 fixture checks
> passed (§7). Three spec corrections discovered during the build, now
> reflected below: (1) **accounts DO carry billing/mailing address columns**
> (`billing_street/city/state/zip`, `mailing_*`) — the §4 address gap is
> closed, BILL TO prefills from the account; (2) **the IQ number already
> exists** at `properties.property_ira_income_qualification_number` — no new
> project field needed for it; (3) the workbook template ships as an **app
> asset** (`public/paperwork/invoice_workbook.xlsx`, fetched same-origin)
> instead of the `templates` storage bucket — the build session had no
> service-role credentials to seed the bucket, and the app asset is versioned
> with the bundle and works on every environment with zero upload ops. pdf.js
> loads from the pinned CDN exactly like `SigningPortal.jsx` (prod-verified
> pattern) — no new npm dependency. Phases 2–3 remain open.

---

## 1. Vision / goal

LEAP generates the five HOMES paperwork documents — **Energy Audit Invoice**,
**Wisconsin IRA HOMES Program Project Proposal** (= project reservation),
**HOMES Project Invoice** (= final payment), **Sealed Proposal**, **Sealed
Invoice** — plus the **Paperwork Workbook (xlsx)** directly from LEAP records
(project → property → account → contact), replacing the standalone tool's
manual form. One click on a project record produces a print-ready PDF; the
numbers come from the same program rules the standalone tool encodes (HOMES
tier, Focus on Energy tier, breakout fractions), which Nicholas already
iterated to correctness through ~15 live review rounds.

The standalone tool at ees-audit-template-builder.netlify.app stays as-is for
energy modeling (Asset Score → DOE Audit Template XML) and keeps its own
paperwork tab. This port covers ONLY paperwork, into LEAP, as purpose-built new
artifacts (build discipline: never reuse across purposes; the standalone code
is a *source to copy from*, not a shared module).

## 2. What exists today (the source to port)

All in `audit-template-builder/frontend/index.html` (line refs @ build 61):

| Piece | Lines | What it is |
|---|---|---|
| `PJ_FIELDS` + `pjLoadAndPrefill` | 2661–2679 | The 16 manual form fields. In LEAP these resolve from records (§4). |
| `BANK` | 2682–2698 | Measure description bank — exact program wording with R-value substitution slots (`atticIns(baseR)(impR)`, `airSeal(baseR)`, fixed strings for the three low-flow lines). |
| `invoiceModel()` | 2701–2747 | **The business-rule core.** See §3 — port verbatim first. |
| xlsx cell surgery | 2750–2790 | `_xesc/_colOf/_colNum/xlsSet/xlsSetFormula/xlsSetCached` — rewrite cells inside the workbook zip preserving every style/merge/formula byte-for-byte. Needs JSZip. |
| `buildInvoiceWorkbook()` | 2791–2854 | Fills the three sheets of `templates/invoice_workbook.xlsx` (Energy Audit Invoice / HOMES Proposal-Contract / HOMES Project Invoice; HEAR sheet untouched). Cell map in the function: C4/G4 meta; C11–C16 + I11–I15 customer/property; C19/I19 dates; P17–P20 helper block; rows 22–29 measures (B/D/I/K/L/O/P); J40/D40/K40 FOE; J44/D44/K44 HOMES; cached totals L30/O30/P30/K31/K32/L33/L34. |
| `_pdfNew(margin)` | 2856–2874 | jsPDF letter-canvas helper (612×792pt, palette, `wrap`, `need()` page breaks). EES docs pass margin 34. |
| `buildEesPdfBlob(kind)` | 2876–3072 | The three EES documents (`'audit' | 'proposal' | 'invoice'`) as true vector PDFs. Encodes every approved layout decision (§5). |
| `buildSealedPdfBlob(kind)` | 3074–3187 | Sealed-style proposal/invoice (Sealed, Inc. = primary contractor; EES = line-item contractor; keeps Sealed's own look incl. red amounts). |
| `templates/invoice_workbook.xlsx` | binary | Styling source of truth (fixed shared formulas, `fullCalcOnLoad`, 428 merges, footers already cleaned). **Copy the file — never rebuild it.** |

The standalone tool vendors jsPDF 2.5.2; **LEAP already has `jspdf ^4.2.1` +
`jspdf-autotable ^5.0.7` in package.json** — use those (§6), do not vendor.

## 3. Program rules encoded in `invoiceModel()` (port verbatim, then re-verify)

- **Inputs**: dwelling `units`; baseline/improved Asset Score data — headline
  EUIs, `roofArea` (Total Gross Roof Area), roof R-values.
- `roofSqFt = Math.round(baseline.roofArea)` — Nicholas's explicit rule: attic
  quantity comes from the report's Total Gross Roof Area, **no manual inputs**.
- `iMin` = min improved roof R (default 49); `baseAtticR` = min baseline roof R
  below `iMin` (the attic actually being upgraded).
- `savings = (EUI_base − EUI_improved) / EUI_base × 100` — headline EUI delta,
  NOT the report's published savings %.
- **HOMES tier (WI)**: ≥35% → **$10,000/unit**; 20–34% → **$5,000/unit**; <20%
  → $0 (not eligible). Exact description/note strings in the code.
- **Focus on Energy** (only when an attic/roof/ceiling measure exists), rate
  from the **baseline** attic R: `<R-11 → $1.00/sqft`, `R-12–19 → $0.70`,
  `R-20–38 → $0.55`; `amt = roofSqFt × rate`.
- `total = HOMES + FOE`. **Measure line costs = breakout fractions × total**:
  attic insulation .44, attic air sealing .5483, bath aerators .0033, kitchen
  aerators .0035, showerheads .0049. Fractions renormalize when attic rows are
  absent; the largest row absorbs rounding drift so **Gross Total = Total
  Rebates exactly → TOTAL DUE $0.00**.

## 4. Data mapping — form fields → LEAP records

Relationship graph (verified): `projects.property_id` → properties;
`projects.project_account_id` / `properties.property_account_id` → accounts
(DB triggers keep opportunity account = property account);
`contacts.contact_account_id` → accounts.

| Standalone field | LEAP source (verified column names) |
|---|---|
| pjPropName / pjInstallAddr / pjCsz | `properties.property_name / property_street / property_city + property_state + property_zip`. The PDF already skips the name line when it repeats the street. |
| pjOwner | `accounts.account_name` (property's account). |
| pjOwnerAddr / pjOwnerCsz | **GAP — accounts carry no address columns** (only `account_phone/account_email/account_website`). See Decisions: add billing-address fields to accounts via LEAP Admin, with a manual override in the generation modal until populated. |
| pjContact / pjEmail / pjPhone | Primary contact on the account: `contacts.contact_full_name / contact_email / contact_phone`. |
| pjIQ (IQ Number `LEA-…`) | No field exists — add to projects (Decisions). |
| pjInvNo / pjProjInvNo | Add to projects (Decisions), editable in the modal. |
| pjInvDate / pjEstStart / pjEstEnd / pjStart / pjEnd | Project date fields — **verify actual column names via `describe_object_columns('projects')` before wiring** (per CLAUDE.md: never assume names). |
| units | `properties.property_total_units` (verified column), editable override in the modal. |
| roofSqFt, baseAtticR, iMin, EUIs (→ savings/tier/FOE) | Parsed from the two Asset Score report PDFs uploaded in the modal — port the standalone `parseAssetScore` regexes + pdf.js text extraction. Parsed values display for review before generating. |

## 5. Approved layout decisions (settled — do not re-litigate; each was a Nicholas review round)

- True **vector PDFs** (jsPDF text/vector calls) — never HTML capture or
  rasterization; never open tabs; **downloads only** (PDF or Excel).
- **Gridded tables**: bordered cells, column separators, light-gray shaded
  header rows; the header row **repeats** when a table continues onto a new
  page; measure rows never split across pages.
- **One money column**: every dollar figure (line items, credits in
  parentheses, Subtotal / Total Rebates / TOTAL DUE) shares one right edge.
- Rebates render as **credit lines feeding the totals**; no empty placeholder
  rebate rows; **no NOTES column** (rate notes fold into the description);
  **no Additional Notes**; **no REBATE ASSIGNMENT NOTICE** block.
- Header: company name left + INVOICE right (both 10.5pt); the proposal title
  sits on its own centered line: **"Wisconsin Inflation Reduction Act HOMES
  Program Project Proposal"**. Single hairline rule. No color bands, no emoji.
- Meta stacked top-right: Invoice No. / Invoice Date / Due Date (**audit
  invoice due date = N/A**; project invoice = Net 30; the proposal has **no
  number** — "we don't use those" — and no "Valid for" line).
- PROPERTY / INSTALLATION (left) and BILL TO (right) top-justified on the same
  line beside the meta stack; no "Registered Contractor" line on the audit
  invoice (proposal/project invoice carry contractor + est./actual dates).
- QTY / UNIT / AMOUNT (and rebate PROGRAM / AMOUNT) columns **size themselves
  to their widest contents**; descriptions are full-width single-column under
  the bold measure name; numeric cells vertically centered.
- **Hard-won jsPDF rule: always set the font BEFORE `splitTextToSize`** —
  measuring at the wrong size makes text overflow its cell.
- **Audit invoice always fits one page.** Footer pinned to the last page:
  company + address line, then `ira@ees-wi.org  |  608-460-7419` (no
  "Questions?" anywhere — also scrubbed from the workbook footers).
- Company header text: `ENERGY EFFICIENCY SERVICES of WISCONSIN` (single
  spaces). Type scale: titles 10.5, measure names 9, body 8, numerics 8.5,
  TOTAL DUE 9. Grid gray `[203,210,219]`, header fill `[240,243,247]`, navy
  company name; no red/orange in EES documents.

## 6. Target architecture in LEAP (verified against the live code)

- **Entry point — a record action on projects**, not a hardcoded button. The
  action system is a data-driven registry; follow the "Adding a new action"
  recipe in `src/data/recordActions.js`:
  1. add `generate_paperwork` to `ACTION_KEYS` + `ACTION_REGISTRY`
     (`applicableObjects: ['projects']`, own SVG icon, `defaultTier:'menu'`),
  2. add the handler to `topbarActionHandlers` in
     `src/components/RecordDetail.jsx` (~line 5869),
  3. it then auto-appears in LayoutEditor's Actions section
     (`page_layout_actions` overrides per layout).
  Model the UI on `ProjectReportModal.jsx` (lazy-loaded in RecordDetail.jsx:18)
  — a new lazy `src/components/ProjectPaperworkModal.jsx`: two Asset Score PDF
  inputs, record-driven fields shown as editable overrides, parsed-numbers
  review, six generate buttons (5 PDFs + workbook). `scripts/preflight.mjs`
  requires lazy targets to resolve and default-export.
- **Logic**: new `src/data/paperworkService.js` — ports `invoiceModel`, `BANK`,
  `parseAssetScore`, both PDF builders, and the workbook fill as pure functions
  over a `{property, account, contact, project, assetScoreBase, assetScoreImp,
  overrides}` context (no DOM reads).
- **Libraries — dynamic imports only** (established pattern, and the reason
  there are no manualChunks entries for them): jsPDF via
  `const { default: jsPDF } = await import('jspdf')` exactly like
  `src/modules/ReportRunner.jsx:754`; JSZip and `pdfjs-dist` the same way (add
  `jszip` and `pdfjs-dist` to package.json — jspdf is already there at ^4.2.1).
  **Note:** the standalone builders were written on jsPDF 2.5.2; the calls used
  (`setFont/setFontSize/text/splitTextToSize/getTextWidth/rect/line/addPage/
  output`) are stable in 4.x, but verify each document renders under 4.2.1
  during the port. Build with `npm run build:safe` (never bare `vite build`)
  and smoke-load.
- **Workbook template**: upload
  `audit-template-builder/frontend/templates/invoice_workbook.xlsx` to the
  **`templates` storage bucket** at `paperwork/invoice_workbook.xlsx` (same
  bucket as `fonts/watermark-font.ttf`; upload once via service-role script or
  dashboard — note `uploadDocumentTemplateAsset` is docx-only and is NOT the
  path for this file). Fetch at generation time via `signedUrl('templates',
  'paperwork/invoice_workbook.xlsx')` from `src/data/storageService.js`.
- **Persistence (Phase 2)**: attach generated files to the project with
  `uploadDocument` in `storageService.js` (`related_object:'projects'` →
  bucket `property-documents`, path `projects/{id}/{docId}__{name}`), so
  paperwork lives on the record with the documents related list, soft-delete,
  and signed-URL hydration for free.
- **Financial visibility**: invoice amounts are **Tier 2** data. The action's
  `isAvailable` should eventually gate on role; note it in the help article now
  and enforce when field permissions land (currently empty platform-wide).
- **Known adjacent bug (do not copy it)**: `generate-project-report/index.ts`
  reads `property_address_line_1/line_2/property_postal_code`, but the real
  columns are `property_street`/`property_zip` — its address lines likely
  render blank today. Use the verified column names; optionally fix that edge
  function as a drive-by only if Nicholas asks.

## 7. Phased build plan (each phase additive + shippable)

1. **Phase 1 — service + record action + modal**: everything in §6 through
   downloads-only generation. Verify: harness/headless check that all five PDFs
   + workbook generate with correct math for the Hampton fixture (8 units, 46%
   savings, R-2 attic → $87,150 / $7,150 / $80,000 / TOTAL DUE $0.00; audit
   invoice $2,000 and one page). `npm run build:safe`. Help article in the same
   session.
2. **Phase 2 — persist to the record**: new project fields (IQ number, invoice
   numbers, paperwork dates — via LEAP Admin, nothing hardcoded), auto-attach
   generated documents to the project, prefill from the last generation.
3. **Phase 3 — LEAP-native quantities** (confirm with Nicholas first): units
   from unit records, measures/quantities from LEAP objects. Run
   `describe_object_columns('opportunity_line_items')` first — its columns are
   unverified (only `oli_record_number`/`oli_is_deleted` appear in code).

## 7b. Signing route for generated PDFs (designed, NOT built)

Nicholas's rule: of the submittal documents, only the **Final Project Payment
Request invoice** needs to be sent for signature. It cannot be today, and the
reason is structural:

- `envelopes.document_template_id` is **NOT NULL**.
- `send-envelope/index.ts:75-96` refuses anything without an **Active**
  document template *and* a published `document_template_snapshots` row.
- The unsigned PDF is produced *inside* `send-envelope` by calling
  `render-document-template-pdf` with the snapshot id (`:178-188`), which is
  also what discovers the `\sig1\`-style anchor positions.

There is no code path that accepts a pre-generated PDF. The design:

1. **Migration.** Make `envelopes.document_template_id` nullable; add
   `env_source_document_id uuid REFERENCES documents(id)`; add a CHECK that
   exactly one of the two is set. Existing rows are unaffected.
2. **`send-envelope`.** Accept `source_document_id` as an alternative to
   `document_template_id`. When present: skip the template/snapshot lookup,
   skip the render call, and read the PDF bytes from the `documents` row's
   storage path instead. Everything downstream (upload to
   `envelopes/{id}/unsigned.pdf`, recipients, signing tokens, emails,
   `signing-portal-submit`) is unchanged. Keep the template branch untouched
   so existing signature sends cannot regress.
3. **Tabs.** A generated PDF has no discoverable anchors, so the caller passes
   explicit tab positions. `buildEesPdf` already draws the signature rule at a
   known point — return those coordinates alongside the blob and hand them to
   `send-envelope` as `tabs: [{ recipient_order, tab_type, page, x, y, width,
   height }]`.
4. **Client.** On the Final Project Payment Request submittal only, a
   "Send for Signature" action: generate the invoice, `uploadDocument` it to
   the project, then call `send-envelope` with `source_document_id` + tabs.

**Why this was not shipped in the 2026-07-27 session:** `send-envelope` is a
live legal e-signature pipeline with no automated test harness, and verifying
it end-to-end means sending a real email to a real signer. Deploying an
untested change there is precisely the failure mode of the
`20260713121244` incident (a live pipeline torn out on an untested
assumption). The change above is additive and low-risk in shape, but it needs
a controlled test send to an internal address before it goes to prod. Do that
first, then ship.

## 8. File + DB-table index (what the building session touches most)

| Thing | Where |
|---|---|
| Source logic to port | `audit-template-builder/frontend/index.html` (§2 line map) |
| Workbook binary | `audit-template-builder/frontend/templates/invoice_workbook.xlsx` → `templates` bucket `paperwork/` |
| Action registry | `src/data/recordActions.js` (recipe in header comment) |
| Action handlers + modal host | `src/components/RecordDetail.jsx` (`topbarActionHandlers` ~5869; lazy modal imports at top) |
| Modal to model on | `src/components/ProjectReportModal.jsx` |
| New files | `src/data/paperworkService.js`, `src/components/ProjectPaperworkModal.jsx` |
| Record/metadata fetch | `src/data/layoutService.js` (`fetchRecord`, `loadRecordDetailData`), RPC `describe_object_columns(p_table)` |
| Storage/documents | `src/data/storageService.js` (`uploadDocument`, `signedUrl`, bucket routing) |
| Dynamic-import pattern | `src/modules/ReportRunner.jsx:754` (jspdf), `src/data/incomeQualificationService.js:247` |
| Build | `npm run build:safe` (preflight + vite + runtime-smoke), `vite.config.js` manualChunks |
| Tables | `projects`, `properties`, `accounts`, `contacts`, `documents`, `page_layout_actions`; Phase 3: `opportunity_line_items`, `units` |

## 9. Decisions

- **DECIDED 2026-07-26 (Nicholas)**: port the invoice/paperwork generation into
  LEAP; standalone tool stays live for energy modeling.
- **DECIDED (carried from standalone iterations)**: every layout/content rule
  in §5 and every program rule in §3.
- **RESOLVED 2026-07-26 (build session)**: account billing address — the
  columns already exist (`billing_street/city/state/zip` + `mailing_*` on
  accounts); BILL TO prefills from them (billing preferred, mailing fallback)
  with manual override in the modal. IQ Number likewise already exists at
  `properties.property_ira_income_qualification_number` and prefills.
- **DECIDED 2026-07-26 (Nicholas)**: there is no such thing as generic
  "paperwork." Generation is organized by **program × incentive application
  stage** — Income Qualification Application / Project Reservation / Final
  Project Payment Request — with every program carrying all three stages.
  Each stage is its own explicitly-named action and its own document set.
- **DECIDED 2026-07-27 (Nicholas)**: build it out **record type by record
  type**, keyed on the **opportunity record type** (the complete, state-scoped
  program axis — 26 active values vs. `incentive_applications`' Wisconsin-only
  8). Document **wording** moves into the database so it is admin-editable and
  program-overridable; the **math and layout stay in code**. Investigated and
  rejected: rebuilding these as `document_templates`. That system is
  flat-merge only (`_shared/merge.ts:buildMergeDict` emits one parent row plus
  `today`/`template.name` — no arrays, no cross-object fields, no computed
  values), so the variable-length measure table is not expressible; and its
  render path (docx → mammoth → HTML → the simplified `_shared/htmlToPdf.ts`
  reflow engine) would degrade the gridded, content-sized, header-repeating
  layout that took ~15 review rounds. Document templates remain the right home
  for flat documents (agreements, the income qualification statement).
- **OPEN — recommendation first**: make each submittal a real record rather
  than date fields on the incentive application. `project_payment_requests`
  already has a full 9-status lifecycle (`Payment Request To Be Prepared` →
  … → `Payment Request Closed`); `project_reservations` exists but has no
  statuses and no UI. Recommend seeding a matching **Project Reservation**
  lifecycle and generating the submittal record when its documents are
  generated, so each filing has a status, an owner, and a due date. Confirm
  with Nicholas.
- **OPEN**: invoice-number fields on projects (audit + project invoice
  numbers; recommend plain project fields, admin-managed — Phase 2). Confirm
  naming with Nicholas.
- **OPEN**: the Paperwork Workbook is a single three-sheet file spanning two
  programs (audit invoice / proposal-contract / project invoice). It is
  offered on both HOMES submittals as a reference. Recommend splitting it
  per submittal once Nicholas confirms the program expects them separately.
- **OPEN**: persist parsed Asset Score numbers onto the project (recommend yes
  — makes paperwork reproducible without re-uploading reports).
- **OPEN (Phase 3)**: source of measures — opportunity line items vs work
  orders.

## 10. Kickoff instructions for the LEAP session (paste verbatim)

> Read `docs/leap-project-paperwork-port.md` and build **Phase 1**: port the
> Project Paperwork generation from `audit-template-builder/frontend/index.html`
> (function/line map in the doc §2) into a new `src/data/paperworkService.js`
> and a lazy `src/components/ProjectPaperworkModal.jsx`, wired as a
> `generate_paperwork` record action on projects per the recipe in
> `src/data/recordActions.js`. Use the existing dynamic-import pattern for
> jspdf (^4.2.1, already a dependency — verify the 2.5.2-era builders render
> under it), add `jszip` + `pdfjs-dist` as dynamic imports, and upload the
> workbook binary to the `templates` bucket at
> `paperwork/invoice_workbook.xlsx`. The layout and program rules in §3/§5 are
> settled — do not redesign them. Verify against the doc's §7 Phase-1 fixture
> numbers, run `npm run build:safe`, ship per the standard cycle (commit as
> Nicholas Wood, PR, merge), and write the help article in the same session.
