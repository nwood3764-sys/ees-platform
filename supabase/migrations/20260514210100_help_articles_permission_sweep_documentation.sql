-- Help articles documenting the May 2026 permission sweep.
-- Three new articles + anchors so admins discover them in context:
--   HA-00006: changelog explaining what changed and when
--   HA-00007: per-role default access matrix as a reference
--   HA-00008: troubleshooting runbook when a user reports access issues

DO $$
DECLARE
  v_admin_id uuid;
  v_a6_id uuid;
  v_a7_id uuid;
  v_a8_id uuid;
BEGIN
  SELECT id INTO v_admin_id
  FROM public.users
  WHERE user_email = 'nicholas.wood@ees-wi.org'
  LIMIT 1;

  -- HA-00006: Permissions enforcement changelog
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published, ha_created_by, ha_updated_by
  ) VALUES (
    'HA-00006', 'permissions-enforcement-changelog',
    'Permissions Are Now Enforced (May 2026)',
    'What changed in the permission system in May 2026, why, and what admins need to know going forward.',
    '(See production help_articles table for full body markdown — version-controlled here as a placeholder.)',
    'Permissions', 'admin', TRUE, v_admin_id, v_admin_id
  ) ON CONFLICT (ha_record_number) DO NOTHING
  RETURNING id INTO v_a6_id;

  IF v_a6_id IS NOT NULL THEN
    INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_route, haa_sort_order, haa_created_by)
      VALUES (v_a6_id, 'route', '/admin/permissions', 0, v_admin_id);
    INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
      VALUES (v_a6_id, 'concept', 'role-based-access-control', 1, v_admin_id);
    INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order, haa_created_by)
      VALUES (v_a6_id, 'object', 'role_object_access', 2, v_admin_id);
  END IF;

  -- HA-00007: Default role access matrix
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published, ha_created_by, ha_updated_by
  ) VALUES (
    'HA-00007', 'default-role-access-matrix',
    'What Each Role Can Do by Default',
    'A reference of what each built-in role can read, create, update, and delete out of the box.',
    '(See production help_articles table for full body markdown — version-controlled here as a placeholder.)',
    'Permissions', 'admin', TRUE, v_admin_id, v_admin_id
  ) ON CONFLICT (ha_record_number) DO NOTHING
  RETURNING id INTO v_a7_id;

  IF v_a7_id IS NOT NULL THEN
    INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_route, haa_sort_order, haa_created_by)
      VALUES (v_a7_id, 'route', '/admin/permissions', 0, v_admin_id);
    INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
      VALUES (v_a7_id, 'concept', 'role-defaults', 1, v_admin_id);
    INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order, haa_created_by)
      VALUES (v_a7_id, 'object', 'roles', 2, v_admin_id);
  END IF;

  -- HA-00008: Access troubleshooting runbook
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published, ha_created_by, ha_updated_by
  ) VALUES (
    'HA-00008', 'troubleshooting-access-issues',
    'Troubleshooting: A User Cannot See or Edit Something',
    'Step-by-step runbook for when a user reports they cannot access a record they think they should.',
    '(See production help_articles table for full body markdown — version-controlled here as a placeholder.)',
    'Permissions', 'admin', TRUE, v_admin_id, v_admin_id
  ) ON CONFLICT (ha_record_number) DO NOTHING
  RETURNING id INTO v_a8_id;

  IF v_a8_id IS NOT NULL THEN
    INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_route, haa_sort_order, haa_created_by)
      VALUES (v_a8_id, 'route', '/admin/permissions', 0, v_admin_id);
    INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_route, haa_sort_order, haa_created_by)
      VALUES (v_a8_id, 'route', '/admin/users', 1, v_admin_id);
    INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
      VALUES (v_a8_id, 'concept', 'access-troubleshooting', 2, v_admin_id);
  END IF;
END $$;
