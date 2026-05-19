DO $$
DECLARE
  v_admin_id uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_ha_id    uuid;
BEGIN
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_category, ha_audience,
    ha_summary, ha_body_markdown, ha_is_published,
    ha_created_by, ha_updated_by
  ) VALUES (
    '', 'seed-data-and-the-purge',
    'Seed data and the purge — go-live cutover',
    'Administration', 'admin',
    'How LEAP separates seed data from production data so you can start using the platform for real work without losing freedom to keep building. Covers the is_seed_data flag, the seed_purge_tenant_data RPC, the two-phase confirmation flow, and what is and is not safe to do post-purge.',
$body$
# Seed data, production data, and the go-live cutover

LEAP's database is built additively, but during construction it's full of test rows — fake accounts, sample opportunities, hypothetical work orders. Once you start using LEAP for real EES-WI work, those test rows need to disappear cleanly without putting real records at risk.

The solution is a single boolean column: **`is_seed_data`**. Every tenant-data table has it. Every row stamped before go-live is `true`. Every row created through the live UI from go-live forward is `false`. When you're ready to start using LEAP for real, you run the purge — every `is_seed_data=true` row is permanently deleted, every production row is untouched.

## What's covered

Every customer-data table — accounts, contacts, opportunities, properties, buildings, units, projects, work orders, service appointments, assessments, incentive applications, conversations, messages, payment receipts, documents, photos, and 50+ others.

## What's NOT covered (deliberately)

**System configuration is excluded.** Picklists, roles, page layouts, email templates, document templates, programs, work types, work plans, lifecycle rules, automation rules, validation rules, service territories, skills, certifications, help articles, permission sets — none of these tables have the flag, and the purge never touches them. They're the platform itself, not customer data. Wiping them would break LEAP.

## Where it lives

**Setup → Data → Seed Data Purge.** The page loads with a dry-run that counts every flagged row across every tenant table. You see a per-table breakdown so the blast radius is visible before any destructive action.

## The two-phase confirmation flow

The purge requires two distinct confirmations:

1. **The phrase.** You type `PURGE ALL SEED DATA` exactly. Anything else and the button stays disabled.
2. **The RPC token.** The page calls `seed_purge_tenant_data('PURGE_ALL_SEED_DATA')` — a literal string that the RPC validates server-side. Calling the RPC with any other token (or no token) returns a dry-run count without deleting.

This stops a misclick, a curious tester, or a stray script from wiping anything. There is no way to purge with one click.

## Why deferred constraints

The tenant-data tables form a complex foreign-key graph — `messages` references `conversations` references `accounts`, `work_orders` references both `projects` and `properties` and `contacts`, etc. Deleting them in the wrong order would fail.

Inside the RPC's transaction we run `SET CONSTRAINTS ALL DEFERRED`. This tells Postgres to skip FK checks until COMMIT. We then delete every flagged row from every table in arbitrary order. At COMMIT, Postgres validates the entire FK graph in one shot. If any production row references a seed row (which shouldn't happen if the flag is being maintained correctly), the whole transaction rolls back — nothing is lost.

## What's safe to do post-purge

Everything additive: new tables, new columns (with defaults or NULLable), new modules, new edge functions, new RLS policies, new RPCs, new portals, new automation. None of this touches existing rows.

## What requires care post-purge

Destructive schema changes on tables with real data: renaming columns, retyping columns, dropping columns, splitting tables, tightening NOT NULL constraints. These can still be done — but only via data-preserving migration patterns (add new shape → backfill → cut over → drop old shape later). The codebase's reflex of `ALTER TABLE ... DROP COLUMN` on the fly stops the moment real data lands.

## Permission model

The RPC is `SECURITY DEFINER` and role-checked against `public.roles.role_name = 'Admin'`. Non-Admin users get an exception. The button is only visible in Setup, which is itself only reachable by Admin in production.

## What "real" means going forward

After the purge, every new row in every tenant-data table will have `is_seed_data=false` by default. If you later need to bulk-import historical data and want to keep the option of clearing it again, set `is_seed_data=true` on those imports explicitly — they'll then be eligible for the next purge. Otherwise, the flag is hands-off forever.
$body$,
    true,
    v_admin_id, v_admin_id
  )
  RETURNING id INTO v_ha_id;

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_route, haa_created_by) VALUES
    (v_ha_id, 'route', '/admin/seed_data_purge', v_admin_id);

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_created_by) VALUES
    (v_ha_id, 'concept', 'seed-data',              v_admin_id),
    (v_ha_id, 'concept', 'seed-purge',             v_admin_id),
    (v_ha_id, 'concept', 'is-seed-data-flag',      v_admin_id),
    (v_ha_id, 'concept', 'go-live-cutover',        v_admin_id),
    (v_ha_id, 'concept', 'production-data',        v_admin_id),
    (v_ha_id, 'concept', 'deferred-constraints',   v_admin_id),
    (v_ha_id, 'concept', 'tenant-data',            v_admin_id),
    (v_ha_id, 'concept', 'system-config',          v_admin_id);
END $$;
