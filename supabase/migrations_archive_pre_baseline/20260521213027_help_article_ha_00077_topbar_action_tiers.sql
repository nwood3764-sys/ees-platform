-- HA-00077 — Topbar action tiers: promoting and demoting record actions per layout
DO $$
DECLARE v_article_id uuid; v_admin uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
BEGIN
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published, ha_created_by, ha_updated_by
  ) VALUES (
    '', 'topbar-action-tiers',
    'Topbar action tiers — promoting and demoting record actions per layout',
    'The RecordDetail topbar can show actions either as visible primary buttons or collapsed into an Actions overflow menu. Tiers come from the registry by default; the Layout Editor''s Actions section lets you override per layout.',
    $body$
Every record-detail page has a row of action buttons in the top right — Edit, Generate Report, Schedule Work Orders, Send for Signature, Publish, Delete, and so on. As more actions get added the row grows crowded, and what matters most to you on (say) a Project record is different from what matters on an Envelope or Email Template.

The topbar now uses a two-tier system to manage this:

**Primary actions** render as visible buttons in the topbar. Use these for the actions someone reaches for several times a day on this kind of record.

**Menu actions** collapse into an "Actions" overflow menu (the three-dots button). Use these for actions that are real but used less often — Clone, Delete, Reschedule Work Orders, Archive, Unpublish.

## Where defaults come from

Every action ships with a built-in default tier appropriate to its object. For example, on Project records, Generate Report and Schedule Work Orders default to Primary; Reschedule Work Orders, Clone, and Delete default to Menu. Edit and the lifecycle publish/restore buttons are Primary across the board.

You don't need to do anything to get the defaults — they apply to every layout automatically.

## Overriding per layout

Defaults aren't always right for everyone. If your team uses Reschedule Work Orders far more often than the default assumes, you can promote it to Primary on the layouts your team uses.

1. Open **Setup → Object Manager → (your object) → Page Layouts**, then click into the layout you want to customize.
2. Scroll past Sections to the **Actions** section.
3. For any action, change its **Tier** dropdown to Primary or Menu. The change saves immediately.
4. **Order** controls left-to-right placement within each tier (lower numbers come first).
5. Click **Reset** on any row to clear your override and revert to the registry default.

Rows with an active override get a yellow background and an "Override" badge so you can see at a glance which defaults you've changed.

## Per-record availability is automatic

Some actions only make sense in specific record states — Schedule a Work Order only appears when the work order is in "To Be Scheduled" status; Publish only appears when a template is in Draft; Reschedule Appointment only appears on service appointments. These availability rules are built into each action's definition and apply regardless of how you've configured its tier.

In other words: setting an action to Primary doesn't *force* it to show up. The action still needs to be applicable to the current record. What the tier controls is *where* the action appears (primary cluster vs Actions menu) when it would be shown in the first place.

## Why this matters

The old approach was a fan of conditional buttons hardcoded in one place. Every new action was a code change, and the same set displayed on every record of an object type whether your team needed it or not. With the action-tier system:

- Adding a new action is a registry entry — it appears on every applicable layout immediately, defaulted to a sensible tier.
- Per-team or per-record-type adjustments are layout-builder rows, not code.
- The topbar stays uncluttered: only the actions you actually reach for show as buttons; everything else is one click away in the menu.

## Limitations

- "Hidden" is not yet a supported tier value. To suppress an action on a particular layout, the only path today is to add a role-visibility filter (forthcoming) or remove the action from the registry. The dropdown will be expanded to include Hidden once the schema supports it.
- The Save and Cancel buttons that appear during edit mode are not in the registry — they're built into the edit-mode shell because they need direct access to editor state. They're always present when editing and not configurable.
$body$,
    'admin', 'internal', true, v_admin, v_admin
  ) RETURNING id INTO v_article_id;

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object,  haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'object', 'page_layout_actions', 10, v_admin);

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object,  haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'object', 'page_layouts',        20, v_admin);

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_route,   haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'route',  '/m/admin/objects',    30, v_admin);

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'concept', 'topbar-actions',     40, v_admin);

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'concept', 'action-tier',        50, v_admin);

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'concept', 'page-layout-actions',60, v_admin);

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'concept', 'record-actions',     70, v_admin);

  IF (SELECT COUNT(*) FROM public.help_article_anchors WHERE haa_article_id = v_article_id) <> 7 THEN
    RAISE EXCEPTION 'expected 7 anchors for HA-00077, got %', (SELECT COUNT(*) FROM public.help_article_anchors WHERE haa_article_id = v_article_id);
  END IF;
END $$;
