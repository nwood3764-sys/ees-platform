# Manus dashboard → LEAP Prospecting import

This directory contains the one-off transform script used to seed the LEAP
**Prospecting** module from the Manus-built "NC Property Outreach Priority
Dashboard" data file (`client/src/data/properties.json` in
`github.com/nwood3764-sys/nc-property-dashboard`).

## What was ingested

The Manus file bundles **6,781 properties** across three states with
HUD/LIHTC identifiers, contract numbers, lat/lng, DOE LEAD energy burden
scores, and (for NC properties only) per-hurricane disaster flags.

| State | Properties |
| --- | --- |
| NC | 3,711 |
| MI | 1,637 |
| WI | 1,433 |
| **Total** | **6,781** |

NC properties with at least one of `helene_affected`,
`florence_affected`, `matthew_affected`, or `dorian_affected` true (1,625
records) get a `property_disaster_exposure` row built from the
corresponding FEMA declarations (DR-4285-NC, DR-4393-NC, DR-4465-NC,
DR-4827-NC).

## How the import was run

1. `python3 transform_manus.py` reads
   `/tmp/nc-property-dashboard/client/src/data/properties.json`, maps each
   record into the shape the `import_property_batch(text, jsonb, uuid)`
   RPC expects, and writes 34 chunk files of ≤200 records each plus a
   combined `all.json` to `/tmp/leap-import-chunks/`.
2. Each chunk was POSTed to
   `/rest/v1/rpc/import_property_batch` with the publishable anon key as
   `Bearer` after a one-off `GRANT EXECUTE … TO anon` (revoked
   immediately after the seed).
3. Records with no `organization`/`organization_normalized` (2,449
   orphans, mostly WI and MI) were re-imported in a second pass under a
   per-state bucket Account: **Unknown Owner — NC / — WI / — MI**.

Final result: **all 6,781 records loaded**; 39 `property_import_batches`
rows; 6,781 `property_source_data` rows; 1,625
`property_disaster_exposure` rows.

## Reusing the script

The transform is data-source–specific. If a future Manus-style dump comes
in, point `SRC` in `transform_manus.py` at the new file and rerun. The
RPC's match-or-create logic handles re-imports idempotently:

- Properties match by `property_hud_property_id`, then
  `property_lihtc_project_id`. On match, `UPDATE` overlays only the
  non-null incoming fields — null fields never blow away existing data.
- Accounts match by `account_hud_participant_number` if present, else by
  case-insensitive `account_name`.
- `property_source_data` and `property_disaster_exposure` are UPSERTed.

The same path that runs from the UI (Edge Function
`import-prospecting-properties` calling the RPC) is the supported
production path. The direct-PostgREST approach used for this seed is a
one-off and should not be the basis for any recurring ingest.
