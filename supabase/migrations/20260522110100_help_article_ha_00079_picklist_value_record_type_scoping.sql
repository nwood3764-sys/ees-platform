DO $$
DECLARE v_article_id uuid; v_admin uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
BEGIN
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published, ha_created_by, ha_updated_by
  ) VALUES (
    '', 'picklist-value-record-type-scoping',
    'Scoping picklist values to specific record types',
    'Picklist values — including status values that drive the chevron strip on every record-detail page — can now be restricted to specific record types. Values without any scope assignments continue to apply everywhere, so the feature is non-destructive by default.',
    $body$
Some objects in LEAP use the same picklist field across many record types. The Project object is the clearest example: there are 36 active project_status values spanning 17 different project record types, from "Assessment" projects through "MF-INS-AIR" installs to "TruTeam Illinois INS". Showing all 36 statuses on every project record made the chevron strip at the top of every Project record cramped and largely irrelevant to the work actually being done on that specific record type.

You can now scope a picklist value to specific record types. A value with at least one scope assignment will only appear on records of those record types. A value with no scope assignments at all continues to appear on every record (the universal fallback).

## How this affects what you see today

**Today: nothing changes visibly.** No scope assignments exist yet, so every picklist value is universal — it appears on every record of its object. The chevron strip on every Project record is identical to what it was before. The feature ships dormant; activating it for any value is an explicit, deliberate action by an admin.

## What an admin needs to know

Scope assignments live in the `picklist_value_record_type_assignments` table — record number prefix PVRTA. Each row says "this picklist value applies to this record type". The first assignment on any value flips it from "universal" to "scoped", restricting it to the record types it's now explicitly assigned to.

The current authoring path is direct table edits via the Object Manager → picklist_value_record_type_assignments. A dedicated picklist scope UI inside the Picklist Builder is a forthcoming addition; for now, manual rows are the path.

When scoping the 36 project_status values across the 17 project record types, the recommended workflow is:

1. Pick one record type at a time (start with the one whose chevron strip you most want to clean up).
2. List the statuses that *do* belong on that record type's lifecycle (typically 6 to 12 of the 36).
3. Insert one PVRTA row per (status, record_type) pair you want to keep.
4. Open a record of that record type and confirm the chevron strip now shows only the scoped statuses.
5. Repeat for the next record type. Statuses already scoped to one record type can be scoped to others — the universal-fallback rule only triggers when there are *zero* scope rows for a value.

## What stays universal automatically

The recycle bin's "Deleted" status, off-path stages like "Walk-Away" or "Denied" — if you want these to appear on every record type, just don't assign any scope rows. The default is universal.

## Behavior on records with no record_type

If a record's record_type field is NULL (a legacy or partially-imported row), the chevron strip falls back to showing only universal values. Scoped values won't appear because there's nothing to match against.

## Where this applies

The widget that consumes the new scoping is the **StatusPathWidget** (the chevron strip near the top of every record-detail page). It's wired through the `picklist_values_for_record_type` Postgres RPC, which any future picklist consumer can call to get the same scope-aware result.
$body$,
    'admin',
    'all',
    true,
    v_admin,
    v_admin
  )
  RETURNING id INTO v_article_id;

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'object', 'picklist_value_record_type_assignments', 10, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'object', 'picklist_values', 20, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'object', 'projects',        30, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'concept', 'status-path',           40, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'concept', 'picklist-scoping',      50, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'concept', 'record-type',           60, v_admin);

  IF (SELECT COUNT(*) FROM public.help_article_anchors WHERE haa_article_id = v_article_id) <> 6 THEN
    RAISE EXCEPTION 'expected 6 anchors for HA-00079 picklist-value-record-type-scoping, got %', (SELECT COUNT(*) FROM public.help_article_anchors WHERE haa_article_id = v_article_id);
  END IF;
END $$;
