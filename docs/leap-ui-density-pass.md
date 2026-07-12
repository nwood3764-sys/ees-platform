# LEAP UI Density Pass — v1.1 Design System (Staging Workstream)

**Status:** Phase 0 + Phase 1 SHIPPED TO STAGING (2026-07-12) — soaking on
`ees-platform-staging.netlify.app`. Direction approved by Nicholas via the
interactive prototype (Current ↔ v1.1 toggle) on 2026-07-12. Phases 2–3 not
started. Nothing on `master`/production.
**Environment rule for this workstream:** everything ships to **staging only**
(`staging` branch → `ees-platform-staging.netlify.app` → staging DB
`xlieenkfhypqhevmwxzi`). Nothing goes to `master`/production until Nicholas has
soaked it on staging and explicitly promotes it.
**Source spec:** LEAP Design System v1.1 (Density Pass) — provided by Nicholas
2026-07-09. Enterprise-CRM density and crispness; reference points Salesforce
Lightning, Attio, Linear. Brand, palette, and layout shell unchanged.

---

## 1. Vision / goal

Tighten the whole platform to enterprise-CRM density without touching brand or
architecture. Three moves, in order:

1. **Token pass** — smaller type scale (13px base, nothing above 18px on
   record/list pages), squarer controls (4px buttons/inputs, 3px badges),
   borders instead of card shadows, a dedicated link blue.
2. **Record page template** — highlights panel in the header, 26px
   indicator-only path bar, related-list cards with count chips and
   "View all N", rail as a configurable block region.
3. **Per-object adoption** — objects pick up the template as screens are
   touched.

## 2. The v1.1 spec, condensed (authoritative values)

All v1.0 rules stay (palette verbatim, Inter/JetBrains Mono, 240px sidebar,
54px topbar, SVG-only icons, breakpoints, no red/orange). Changes:

**Type scale**

| Element | v1.1 value |
|---|---|
| Base body / field values | **13px**, line-height 1.45 |
| Record page title | **17px / 600** (list-view titles may be 18px) |
| Card / section headings | **12.5px / 600**, sentence case |
| Field labels | **11px / 400, sentence case**, `textMuted` — never all-caps |
| Table headers | **11px / 500**, `textMuted` |
| Table cells | **12.5px** |
| Badges, chips, metadata | **11px** |
| Buttons | **12px** (11px small variant) |
| Nav items | **12.5px** |

Nothing on a record or list page exceeds 18px. Approved fallback if too tight
in live use: 13.5–14px base with everything scaling proportionally — decided
once, globally, never per-page.

**Radius:** cards 8px (unchanged); buttons/inputs/controls **4px**; badges and
chips **3px** (no pills); path 4px outer, square inner segments.

**Surfaces:** cards are `1px solid border` only — **in-flow card shadows are
removed**. Shadows reserved for floating elements (dropdowns, popovers,
modals, mobile sidebar).

**Color usage:** emerald only in logo, sidebar active, active tab underline,
path completed/current, primary buttons, progress fills. **One emerald-filled
primary button per view max**; everything else outline style. New **link color
`#1d5a96`** so clickable ≠ brand on lookup-heavy pages. Status badges: tinted
bg + dark same-family text (green `#e6f7ef`/`#166b47`, amber
`#fdf3e3`/`#8a5f16`) — never white-on-bright.

**Components:** tables — 11px/500 muted headers, 12.5px cells, 7px 14px cell
padding, hairline separators, no zebra, hover `card2`, `table-layout: fixed`,
single-line ellipsis cells, first column is the record link. Buttons — white +
1px `borderDark`, 4px radius, 5px 12px padding; primary `emeraldMid` fill.
Progress — 6px flat track, no gradient. Path — 26px segmented bar, chevron-free,
11.5px/500, **status indicator not a control**, always renders an
"Auto-advances on qualifying events" hint. Motion: none on tables/field grids.

**Record page anatomy (§3 of spec):** breadcrumbs → header card (32px tinted
object icon, eyebrow `Object · RECORD-ID` in mono, 17px title, max 3 actions +
overflow, **highlights panel of 4–6 key fields chosen per record type**) →
path → Details|Related tabs → main column + persistent right rail of
configurable blocks. Grid `minmax(0,1.8fr) minmax(0,1fr)`, 14px gap, single
column ≤900px. No Activity tab — activity lives in the rail.

## 3. Current-state architecture (mapped from actual code, 2026-07-09)

The single most important finding: **the v1.1 rollout plan assumes a CSS
variable / Tailwind theme to edit. That layer does not exist.**

- **No Tailwind, no shadcn/ui** — documented in CLAUDE.md but absent from
  `package-lock.json`; no `tailwind.config.js`, no `:root` custom-property
  block anywhere in `src/`.
- **Styling is ~99.8% React inline styles** — ~4,853 `style={{…}}` across 140
  files vs ~10 `className=`. Font sizes, radii, paddings, and shadows are
  numeric literals typed at the point of use.
- **Colors ARE centralized:** `export const C` in `src/data/constants.js`
  (imported by ~50 files), plus `STATUS_CFG` (badge colors per status) and
  `CHART_COLORS`. But there are **two deliberate mirror copies** that must not
  drift: `src/serviceAppointments/styles.js` (also has `RADIUS = 8`,
  `FONT_UI`/`FONT_MONO` — the closest thing to real tokens today) and
  `src/fieldMobile/styles.js`. `src/data/recordActions.js` adds ad-hoc hexes
  (`#2563eb`, `#0369a1`, …) for action-button tints; `adminStyles.jsx` hardcodes
  its own sizes/radii (6px inputs, 12.5px buttons).
- **No type/radius/shadow/spacing tokens anywhere.** A density pass cannot be
  done "in one place" today — the token layer must be created first, then
  components refactored to consume it.
- **Key surfaces:**
  - `src/components/RecordDetail.jsx` (~6,400 lines) — the record page.
    Header at ~5989 (title 22px/700, mono record number 11px), two-column
    body at ~6087 (main + right utility rail via `section_placement='right'`,
    collapses ≤1024px), tabs from `buildOrderedTabs`, `Section`/
    `FieldGroupWidget` field grids (`minmax(280px,1fr)`),
    `RelatedListWidget` (max 7 rows, count already in header).
  - `src/components/ListView.jsx` — main tables. Headers 11px/600
    **UPPERCASE** letter-spaced (v1.1 forbids all-caps → 11px/500 sentence
    case), cells `11px 12px` padding.
  - `src/components/UI.jsx` — `Badge` (11px, radius 4, dot), `TableRow`
    (hover/selected states), `SectionTabs`, `Topbar`, `Sidebar`, `Icon`.
    No Button/Card/Input primitives exist — those are open-coded everywhere.
  - `src/components/StatusPathWidget.jsx` — current path: 36px Salesforce
    chevrons via `clip-path`; v1.1 wants 26px chevron-free segments + the
    auto-advance hint.
  - `src/components/StatusTransitionsBar.jsx` — explicit one-click status
    transition buttons (separate component from the path — see Decision D4).
  - `src/index.css` — fonts import, focus ring, scrollbars, keyframes,
    mobile overrides (16px inputs ≤768px anti-zoom — must survive the pass).
- **Out-of-system module:** `audit-template-builder/frontend/index.html` is a
  standalone single-file module on an entirely different palette (moss/gold,
  includes red — violates no-red rule). Treated as out of scope (D3).

**Staging plumbing (verified):** `staging` branch exists, currently **782
commits behind master** (and 45 ahead — its own merges + the staging
`netlify.toml` pointing at `xlieenkfhypqhevmwxzi`). First step of any staging
work is a fresh `master → staging` merge preserving that `netlify.toml`.
Data refresh via the **Refresh Staging Database** GitHub Action.

## 4. Target architecture + design principles

Extend the pattern that already works here — the shared `C` object — rather
than introducing Tailwind mid-flight:

- **`src/data/constants.js` grows sibling token objects** next to `C`:
  - `TYPE` — the full §2 scale (`base:13`, `titleRecord:17`, `sectionHead:12.5`,
    `label:11`, `tableHeader:11`, `tableCell:12.5`, `badge:11`, `button:12`,
    `buttonSm:11`, `nav:12.5`, `lineHeight:1.45`) plus `FONT_UI`/`FONT_MONO`.
  - `RADIUS` — `{card:8, control:4, badge:3}`.
  - `SHADOW` — `{card:'none', floating:'0 8px 24px rgba(13,26,46,0.12)'}`
    (only floating elements get a shadow).
  - `C.link = '#1d5a96'`; badge tint pairs added to `STATUS_CFG` conventions.
- **One escape hatch, decided once:** if 13px proves too tight on staging,
  `TYPE.base` moves to 13.5/14 and everything derived follows. That's the
  whole point of tokenizing before tuning.
- **Refactor order = leverage order.** `UI.jsx`, `ListView.jsx`,
  `RecordDetail.jsx`, `StatusPathWidget.jsx`, `adminStyles.jsx`, and the two
  mirror `styles.js` files carry the overwhelming majority of visible chrome.
  Long-tail files adopt tokens as touched (spec §5.3), which is safe because
  the palette doesn't change — an un-migrated page just stays at v1.0 density.
- **New primitives are additive, purpose-built:** `Button` (default/primary/sm)
  and card-head conventions get real shared components in `UI.jsx` so "one
  primary per view" is enforceable, but existing open-coded buttons keep
  working until migrated.
- **Structural template pieces (highlights panel, rail blocks) ride the
  existing DB-driven layout system** (`page_layouts` + sections +
  `LayoutCanvasEditor`, `section_placement='right'` rail already exists) —
  additive widget types, no re-platforming, consistent with the Phase-4
  DECLINED decision in the builder rearchitecture handoff.

## 5. Phased build plan (each phase additive + independently shippable to staging)

### Phase 0 — Staging runway (no UI change)
1. Merge current `master` into `staging` (preserve staging `netlify.toml` —
   ours-on-conflict for that one file), push, verify
   `ees-platform-staging.netlify.app` builds via `npm run build:safe` and loads
   against the staging DB.
2. Optionally trigger **Refresh Staging Database** so staging data is current.
3. All density work happens on `claude/ui-tweaks-staging-eorymd`, merged into
   `staging` to deploy for review. **No PR to `master` in this workstream.**

### Phase 1 — Token layer + global pass (the visible "density" ship)
1. Add `TYPE` / `RADIUS` / `SHADOW` / `C.link` to `src/data/constants.js`;
   mirror into `serviceAppointments/styles.js` and `fieldMobile/styles.js`
   (palette parity only — see D2 for sizing scope).
2. Convert the high-leverage shared components to tokens **and** v1.1 values:
   - `UI.jsx`: `Badge` → 3px radius / 11px / tinted bg + same-family dark text
     (extend `STATUS_CFG` mapping), `SectionTabs` → 500 weight + 2px emerald
     underline, `Topbar`/`Sidebar` nav 12.5px, new `Button` primitive.
   - `ListView.jsx`: headers 11px/500 sentence case (drop UPPERCASE +
     letter-spacing), cells 12.5px at 7px 14px, hairline rows, hover `card2`,
     `table-layout:fixed` + ellipsis, first column = record link, remove any
     row motion.
   - `RecordDetail.jsx`: title 22/700 → 17/600 single-line ellipsis; eyebrow
     `Object · RECORD-ID` (mono); section headings 12.5/600; field grid
     labels 11px sentence case over 13px values; card shadows off; inline-edit
     pencil on hover only; lookups render in `C.link`; mono for IDs/amounts.
   - `StatusPathWidget.jsx`: 36px chevrons → 26px flat segments, 11.5px/500,
     current stage 1.5px emerald border + wider flex, add the permanent
     "Auto-advances on qualifying events" hint (11px muted).
   - `adminStyles.jsx`: inputs/buttons to 4px radius + 12px type.
   - Buttons everywhere they're shared: white/`borderDark`/4px default,
     `emeraldMid` primary, audit for one-primary-per-view on the main screens.
   - Progress bars: 6px flat track, no gradient.
3. `npm run build:safe`, smoke-load, merge to `staging`, Nicholas soaks it.
   **Exit gate: the D1 base-size decision gets confirmed or the 13.5/14
   fallback is applied globally here, once.**

### Phase 2 — Record page template (structural; needs one schema decision)
1. **Highlights panel** — 4–6 key fields inline in the header card (11px label
   over 13px/500 value). Config per record type via the existing layout
   system: a new `highlights` widget/section handled by `LayoutCanvasEditor`,
   or a `plt_highlight_fields` config on `page_layouts`. Schema decision
   first, additive migration, staging DB first per the promotion standard.
2. **Rail as configurable block region** — formalize the existing right rail:
   rail blocks are cards with the standard head, assigned per object/record
   type through the layout editor (activity, qualification summary, etc.).
   Mostly already true via `section_placement='right'`; close the gaps rather
   than rebuild.
3. **Related list card v1.1** — count chip styling (mono 10.5px, `card2` bg,
   3px radius — count data already exists), "View all N" footer → object list
   view filtered to parent, 3–4 row default.
4. **32px tinted object icon + max-3-actions + overflow menu** in the header.

### Phase 3 — Per-object adoption + long tail
Sweep remaining screens (dashboards chrome, admin panes, portals, modals) to
tokens as touched; verify responsive behavior at 900/768/520; help article
for the refreshed record page once it's headed to production (article ships
with the eventual prod promotion, not the staging soak).

## 6. Technical recommendations & hazards

- **No new dependencies.** No Tailwind retrofit — 4,850 inline styles make the
  token-object approach strictly cheaper and less risky. Zero license impact.
- **Vite hazard applies as always:** `npm install` on fresh clone, never bare
  `npm run build`, always `npm run build:safe` + smoke-load before trusting a
  build.
- **Keep the iOS guards:** ≤768px inputs stay 16px (anti-zoom), mobile body
  15px — the 13px base is a desktop density; don't let the pass regress
  mobile ergonomics.
- **Palette-mirror drift:** any `C` change must land in all three copies
  (`constants.js`, `serviceAppointments/styles.js`, `fieldMobile/styles.js`) —
  the files say so in comments, and this pass adds `link` to all three.
- **`recordActions.js` off-palette hexes** should be reconciled to the
  tinted-badge formula while in there (same-family dark text on tint).
- **Focus ring in `index.css`** keeps 4px radius — now matching control radius.
- Phase 2's highlights/rail config is **schema (category 2)**: additive
  migration → staging DB → verify → (only at promotion time) production.

## 7. Decisions

Recommendation stated first; mark DECIDED with date + owner as confirmed.

- **D1 — Base scale: 13px as specced.** — **DECIDED 2026-07-12 (Nicholas,
  via prototype approval).** The approved fallback (13.5–14px global) remains
  a one-line `TYPE.base` change after the staging soak if needed.
- **D2 — Scope: desktop app only for density.** Record pages, list views,
  admin, dashboards, portals get the density pass. **Field Mobile PWA and the
  customer scheduling pages keep their current larger sizing** (glove/thumb
  ergonomics; customer-facing comfort) but pick up palette parity (link
  color). — **DECIDED 2026-07-12 (Nicholas, via prototype approval).**
- **D3 — `audit-template-builder` standalone HTML is out of scope** for this
  pass; its off-system palette (including red, which violates the no-red rule)
  is logged as a separate follow-up re-skin. — **DECIDED 2026-07-12
  (Nicholas, via prototype approval).**
- **D4 — Path vs. status transitions.** The live path widget was already
  display-only (a prior session removed stage clicking); v1.1 restyles it to
  26px flat segments and adds the permanent "Auto-advances on qualifying
  events" hint. The `StatusTransitionsBar` stays as the explicit transition
  mechanism — it is LEAP's "qualifying event" until event-driven auto-advance
  exists. The config-gated "Next:" transition guidance box under the path was
  kept (useful, spec-silent); the stage counter and big current-stage label
  were retired (screen-reader text preserved). Badge status dot also retired
  per the approved prototype; `STATUS_CFG` keeps `dot` values if it ever
  comes back. — **DECIDED 2026-07-12 (Nicholas, via prototype approval).**
- **D5 — Reference prototype.** Built in-session instead of importing one:
  interactive Current ↔ v1.1 record-page prototype (Claude artifact
  `4f4bd8c0-eaba-4a21-819f-5c558028e8d3`), "Current" values sourced from the
  live components. Ambiguity resolves against it, then Salesforce Lightning.
  — **DECIDED 2026-07-12.**

## 8. File + DB-table index (what this workstream touches most)

| Area | Path |
|---|---|
| Token home (palette + new TYPE/RADIUS/SHADOW) | `src/data/constants.js` |
| Palette mirrors | `src/serviceAppointments/styles.js`, `src/fieldMobile/styles.js` |
| Shared primitives (Badge, tabs, nav, new Button) | `src/components/UI.jsx` |
| Record page (header, tabs, grid, rail) | `src/components/RecordDetail.jsx` |
| Tables / list views | `src/components/ListView.jsx` |
| Path | `src/components/StatusPathWidget.jsx` |
| Status transitions | `src/components/StatusTransitionsBar.jsx` |
| Admin styles | `src/modules/admin/adminStyles.jsx` |
| Action button colors | `src/data/recordActions.js` |
| Global CSS (fonts, focus, mobile guards) | `src/index.css` |
| Layout system (Phase 2 highlights/rail config) | `src/components/LayoutCanvasEditor.jsx`, `page_layouts` + section/widget tables |
| Staging plumbing | `staging` branch `netlify.toml`, `.github/workflows/refresh-staging.yml` |

See also: `leap-staging-environment.md`, `leap-environment-promotion-standard.md`,
`leap-builder-rearchitecture.md`.
