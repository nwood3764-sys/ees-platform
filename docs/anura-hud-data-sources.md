# HUD Property Data — Source of Truth

**Purpose:** Authoritative reference for how HUD program property data is acquired, keyed, matched, and loaded into LEAP. Read this before any property-data ingestion, refresh, or reconciliation session. It exists so the load state never has to be reverse-engineered from the database again.

**Last load:** 2026-06-25. **States loaded:** WI, NC, MI. (CO, IN deferred — same procedure when added.)

**Refresh cadence:** On-demand only. Nothing is scheduled. Target ~2×/year (HUD MF refreshes monthly, LIHTC/PH far less often; twice yearly is sufficient for outreach targeting). Keep manual so a refresh never overwrites data mid-campaign. Optional future automation: pg_cron on Jan 1 / Jul 1.

---

## 1. The three programs (different universes, no shared primary key)

A single physical property may participate in zero, one, two, or all three programs. They are distinct HUD systems:

- **Multifamily Assisted / Section 8 (privately-owned, project-based rental assistance).** Contract numbers, expirations, 202/811, PAC/PRAC, RAD. This is the program with contract-level detail.
- **Public Housing (Section 9, PHA-owned).** Keyed to a Public Housing Authority (PHA) and development code.
- **LIHTC (Low-Income Housing Tax Credit).** Tax-credit allocation, placed-in-service year, credit type. A different property universe; owner contact is **not** published in the public feed.

---

## 2. Sources — all pulled by API (no file upload required)

All three are HUD ArcGIS Feature Services on the same org (`services.arcgis.com/VTyQ9soqVukalItT`). The Postgres `http` extension (v1.6, installed) fetches them server-side — the database pulls its own data, paging the REST `query` endpoint at up to 2000 rows/page.

| Program | ArcGIS service | State field | Refresh |
|---|---|---|---|
| Multifamily Assisted | `MULTIFAMILY_PROPERTIES_ASSISTED` | `STD_ST` | ~monthly |
| Public Housing (Sec 9) | `Public_Housing_Developments` | `STD_ST` | ~monthly |
| LIHTC | `LIHTC` (alias: Low_Income_Housing_Tax_Credit_Properties) | `PROJ_ST` | periodic |

Query URL pattern:
```
https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/{SERVICE}/FeatureServer/0/query
  ?where={STATEFIELD}%20IN%20(%27WI%27,%27NC%27,%27MI%27)
  &outFields=*&returnGeometry=false&f=json
  &orderByFields=OBJECTID&resultOffset={n}&resultRecordCount=2000
```

**Known API limit:** the Multifamily layer flattens contracts to two per property (`CONTRACT1`/`CONTRACT2`). Properties with 3+ contracts are truncated. As of last load, **7 such properties** in WI/NC/MI. The full contract list for those requires the downloadable Multifamily Assistance & Section 8 Excel (`hud.gov/.../mfhdiscl`) — a file, not the API. Flagged but not yet topped up.

**LIHTC owner limit:** `COMPANY`/`CONTACT`/`CO_ADD` are suppressed (0% populated) in the public LIHTC layer. LIHTC carries no owner. This is why LIHTC matching cannot use owner confirmation.

---

## 3. The shared key and the matching ladder

There is **no single shared key** across programs. Matching is highest-confidence-first, per source:

1. **HUD-issued unique identifier (primary).** Verified unique, zero collisions:
   - MF → `PROPERTY_ID` (HUD property id) → LEAP `property_hud_property_id`; secondary `CONTRACT1`.
   - PH → `PARTICIPANT_CODE` + `DEVELOPMENT_CODE`.
   - LIHTC → `HUD_ID` → LEAP `property_lihtc_project_id`. (`STATE_ID` is **not** unique — repeats across project phases; do not key on it.)
2. **Owner + address together (fallback).** Requires both to agree. Owner available for MF (management/owner org) and PH (authority name); **not** for LIHTC.
3. **Coordinate-confirmed address (fallback).** Lat/long within ~0.0015° (~150m) as corroboration.
4. **Else → manual review table.** Never auto-merged.

**Address normalization:** `public.normalize_addr_key(addr, zip)` — uppercase, strip `.,#`, expand/standardize street-type and directional tokens (STREET→ST, NORTH→N, etc.), collapse whitespace, append 5-digit zip. **Owner normalization:** `public.normalize_owner_key(owner)` — uppercase, strip org suffixes (LLC, INC, LP, CORP, HOUSING AUTHORITY→HA). Both are `IMMUTABLE`, pinned search_path.

**Conservative rule (enforced):** auto-merge only on (exact identifier) OR (unambiguous one-to-one address match). An address key that maps to >1 existing property is **ambiguous → review**, never merged. Address-only matches with no owner to confirm (LIHTC) and any owner conflict → review. Unmatched → insert as new. Nothing is ever hard-deleted or mass soft-deleted.

---

## 4. Where the data lands (flat model + one child table)

**Decision (Nicholas, 2026-06-25):** flat — all program fields as columns directly on `properties`, prefixed by program. The **only** child table is contracts, because contracts are inherently one-to-many.

- `properties.property_in_program_mf_assisted | _public_housing | _lihtc` — presence flags.
- `properties.property_mf_*` — Multifamily program block (hub, category, REAC, program flags, FHA #, contract count, occupancy date).
- `properties.property_lihtc_*` — LIHTC block (hud_id, allocation, units, year PIS/alloc, credit type, targets).
- `properties.property_ph_*` — Public Housing block (participant/development code, authority name/phone/email, units, occupancy).
- Reused existing columns: `property_hud_property_id`, `property_total_units`, `property_assisted_units`, `property_is_202_811`, `property_hud_management_org/phone/email`, `property_latitude/longitude`, `property_lihtc_project_id`, `property_primary_contract_number/expiration`, `property_std_address`, `property_std_address_key`.
- **`property_hud_contract_lines`** (child, one row per contract, unlimited): `phcl_property_id`, `phcl_contract_number`, `phcl_program_type`, `phcl_assisted_units`, `phcl_expiration_date`, `phcl_rent_to_fmr_ratio`, `phcl_contract_sequence`.
- **`property_hud_match_review`** — ambiguous/unconfirmed matches awaiting manual resolution.
- **`stg_hud_mf | _ph | _lihtc`** — staging tables (service_role only). Re-truncated and re-filled each refresh.

New property inserts get the per-state placeholder account (`Unknown Owner — {STATE}`); owner = admin user id. Account-matching to real owner orgs is a future refinement.

`property_data_source` values: `HUD_MF_ASSISTED_ARCGIS`, `HUD_LIHTC_ARCGIS`, `HUD_PUBLIC_HOUSING_ARCGIS`, and `PRIOR_IMPORT_UNVERIFIED` (prior-Manus rows matching no current HUD source — labeled, retained, not deleted).

---

## 4a. RAD conversion & EPC traditional-pathway eligibility

**The mechanism:** When a public-housing (Section 9) development converts under RAD (Rental Assistance Demonstration), it **leaves the public-housing inventory and moves into the Section 8 multifamily inventory**. A converted development does NOT appear as a flagged Section 9 record — it disappears from Section 9 and reappears as a multifamily property with `IS_SEC8_RAD_DEMO_CONV_IND='Y'` → `property_mf_is_rad_conversion=true`.

**Eligibility consequence:** RAD-converted developments are **no longer EPC-eligible under the traditional public-housing pathway** (they now follow the Section 8 pathway). Unconverted Section 9 developments remain eligible.

**Derived field:** `property_epc_traditional_pathway_eligible` (boolean):
- `true` — `property_in_program_public_housing=true` AND not RAD-converted (traditional Section 9, eligible).
- `false` — `property_mf_is_rad_conversion=true` (RAD-converted, ineligible via traditional pathway).
- `null` — not a public-housing/RAD property (N/A).

As of last load (WI/NC/MI): **494 eligible** (traditional Section 9), **76 ineligible** (RAD-converted), rest N/A. Recompute this field after every refresh (same CASE logic).

---

## 5. Load state as of 2026-06-25 (post second-pass reconciliation)

Total WI/NC/MI properties: **11,089**.

| Program | Properties | Notes |
|---|---|---|
| Multifamily Assisted | 2,278 | Full source reconciled (1,563 updated by HUD id, 715 inserted) |
| LIHTC | 5,394 | Full source; ambiguous matches inserted standalone in 2nd pass |
| Public Housing (Sec 9) | 494 | Complete source |
| EPC traditional-pathway eligible | 494 | Unconverted Section 9 |
| RAD-converted (ineligible traditional) | 76 | Now Section 8 multifamily |
| Contract lines (child) | 2,225 | Across 2,201 properties; 7 properties API-truncated at 2 |
| `PRIOR_IMPORT_UNVERIFIED` | 2,975 | Retained, labeled |

**Match review queue: 0 open.** All 1,704 review rows (1,688 LIHTC + 16 PH, representing 796 distinct LIHTC + a few PH records) were resolved in a second pass. Coordinate proximity could not separate them (shared address = shared coordinates for multi-building complexes), so they were **inserted as standalone records** rather than force a false merge — status `Resolved — Inserted As Standalone Property`. Trade-off accepted: minor duplication (a property both Section 8 and LIHTC may exist as two rows) in exchange for zero false merges and an empty queue.

---

## 6. Refresh procedure (repeat per cycle)

1. `TRUNCATE stg_hud_*`; re-pull all three via `http_get` server-side (Section 2 URL pattern).
2. Verify staged counts vs. ArcGIS `returnCountOnly`.
3. Re-run matching ladder (Section 3): MF by `PROPERTY_ID`, LIHTC by `HUD_ID`, PH by participant+development; address fallbacks; ambiguous → review.
4. Update matched in place; insert new; route ambiguous to review.
5. Reload contracts child from `CONTRACT1/2`.
6. Re-flag any newly-orphaned rows `PRIOR_IMPORT_UNVERIFIED`.
7. Recompute `property_epc_traditional_pathway_eligible` (Section 4a CASE logic).
8. `get_advisors(security)` — baseline ~165 + RLS policies on any new tables.
9. Verify per-state counts (Section 5 query).

## 7. Open items
- 7 MF properties with 3+ contracts: top up from Multifamily Section 8 Excel (`hud.gov/.../mfhdiscl`).
- LIHTC owner backfill: not available from public ArcGIS; would need HUD User tabular LIHTC download.
- Account-matching new inserts to real owner-org accounts (currently per-state placeholder `Unknown Owner — {STATE}`).
- Standalone-insert duplication from 2nd pass: a property both Section 8 and LIHTC may exist as two rows. De-dupe later with stronger signals if it matters.
- Property detail card (Manus-style) surfacing all program blocks + contracts + eligibility — not yet built.
- CO, IN: same procedure when those states are added.
