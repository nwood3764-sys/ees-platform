-- The payment request form names the property's OWNER ACCOUNT too -- and stops
-- printing our own contractor account as the customer's business entity.
--
-- Found while shipping 20260901221600 (Property Owner Name follows the owner
-- account). The same HUD-first rule had been written into
-- build_wi_ira_payment_request_form_prefill, where it was doing something worse
-- than going stale:
--
--   'business_entity_name' = COALESCE(pr.property_hud_owner_org, ca.account_name)
--
-- ca is the CONTRACTOR account. So on any property whose HUD owner org is blank
-- -- which is 7 of the 18 live applications -- the payment request printed the
-- contractor's name on the owner's line. Live before this migration:
--
--   IA-00030  business_entity_name = "Energy Efficiency Services of Wisconsin"
--   IA-00041  business_entity_name = "Energy Efficiency Services of Wisconsin"
--
-- ...on properties owned by Lutheran Social Services. That is EES's own name
-- going onto the customer's line of a program payment request. A contractor is
-- never a fallback for an owner: they are two different parties on the same
-- form, and the form has a contractor line already.
--
-- IA-00013 showed the milder half -- business_entity_name "LSS HOUSING, INC."
-- (the stale HUD import) sitting next to building_owner_name "Lutheran Social
-- Services of Wisconsin and Upper Michigan, Inc." (the owner account). Two
-- fields on one form disagreeing about who owns the building.
--
-- Both now resolve through resolve_property_owner_name(), the single definition
-- introduced by 20260901221600, so the record page, the application field and
-- the payment request can never give three answers.
--
-- WHY THE RESOLVER BECOMES SECURITY INVOKER. build_wi_ira_payment_request_form_prefill
-- is SECURITY INVOKER and granted to authenticated. A SECURITY DEFINER resolver
-- called from it would need EXECUTE granted to authenticated -- which is exactly
-- the grant `authenticated_security_definer_function_executable` tells the next
-- migration to revoke, and revoking it is what broke record writes on 2026-07-27
-- and again on 2026-08-29. So the resolver is INVOKER instead: called from the
-- SECURITY DEFINER trigger and cascade functions the current user IS the owner,
-- so it still resolves as owner there and the guarantee in 20260901221600 is
-- unchanged; called from the prefill it correctly answers with what the signed-in
-- user may see. An INVOKER function carries no advisor lint for being executable.

CREATE OR REPLACE FUNCTION public.resolve_property_owner_name(p_property_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT NULLIF(BTRIM(a.account_name), '')
    FROM public.properties p
    JOIN public.accounts a
      ON a.id = p.property_account_id
     AND a.account_is_deleted IS NOT TRUE
   WHERE p.id = p_property_id
     AND p.property_is_deleted IS NOT TRUE;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_property_owner_name(uuid) TO authenticated, anon, service_role;

-- The prefill is a 400-line mapping. Patching the two owner lines in the
-- DEPLOYED source is deliberate: retyping the whole body to change two lines is
-- how a mapping silently loses an unrelated field. Both replacements must land,
-- and no HUD owner reference may survive, or the migration fails.
DO $$
DECLARE
  v_src text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname = 'build_wi_ira_payment_request_form_prefill';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'build_wi_ira_payment_request_form_prefill not found';
  END IF;

  v_new := replace(v_src,
    $o$COALESCE(NULLIF(BTRIM(pr.property_hud_owner_org),''), ca.account_name)$o$,
    $n$public.resolve_property_owner_name(ia.property_id)$n$);
  IF v_new = v_src THEN
    RAISE EXCEPTION 'the business_entity_name mapping was not found';
  END IF;

  v_src := v_new;
  v_new := replace(v_src,
    $o$COALESCE(NULLIF(BTRIM(ia.ia_property_owner_name),''),
                                              NULLIF(BTRIM(pr.property_hud_owner_org),''))$o$,
    $n$COALESCE(NULLIF(BTRIM(ia.ia_property_owner_name),''), public.resolve_property_owner_name(ia.property_id))$n$);
  IF v_new = v_src THEN
    RAISE EXCEPTION 'the building_owner_name mapping was not found';
  END IF;

  IF position($c$property_hud_owner_org$c$ in v_new) > 0 THEN
    RAISE EXCEPTION 'a HUD owner mapping survived the patch';
  END IF;
  IF position($c$ca.account_name$c$ in v_new) = 0 THEN
    RAISE EXCEPTION 'the contractor business name mapping was lost';
  END IF;

  EXECUTE v_new;
END $$;

-- Nothing on a payment request may name anyone but the property's owner account.
DO $$
DECLARE v_wrong integer;
BEGIN
  SELECT count(*) INTO v_wrong
    FROM public.incentive_applications ia
    CROSS JOIN LATERAL (SELECT public.build_wi_ira_payment_request_form_prefill(ia.id) AS j) x
   WHERE ia.ia_is_deleted IS NOT TRUE
     AND x.j ? 'business_entity_name'
     AND x.j->>'business_entity_name' IS DISTINCT FROM public.resolve_property_owner_name(ia.property_id);

  IF v_wrong > 0 THEN
    RAISE EXCEPTION '% payment request(s) still name someone other than the owner account', v_wrong;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
