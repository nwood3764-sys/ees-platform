-- Pull the published equipment list into the staging table.
--
-- Paged, resumable and idempotent, because the source has 280,000+ certificate
-- rows and one long-running statement that fails at row 200,000 leaves nobody
-- any wiser. Each call fetches a bounded number of pages and reports what
-- landed, so progress is a number somebody can look at.
--
-- Ordered by the source's own row id so paging is stable -- an unordered page
-- boundary can legally repeat or drop a row, which is the silent kind of wrong.
--
-- Idempotent by (dataset, source id): re-running a page overwrites rather than
-- duplicates, so a timed-out call can simply be repeated. That matters here
-- because the tooling that calls this gives up at 60 seconds while the database
-- carries on and COMMITS.
--
-- ── What is deliberately never fetched ────────────────────────────────────
--
-- Nicholas, 2026-09-05: "we don't care about discontinued models. We don't care
-- about 410A refrigerant models ... we don't want any of that in our selection
-- database."
--
-- R-410A is refused AT THE SOURCE rather than filtered later, so it never
-- occupies a row: 50,594 of the 281,975 published rows. With the refrigerant
-- changeover, R-410A equipment is precisely the population that is no longer
-- built for new installations, which makes this the practical answer to
-- "discontinued" as well as its own instruction.
--
-- On discontinued, stated plainly because it would be easy to imply more than
-- is true: THE PUBLISHED LIST CARRIES NO DISCONTINUED FLAG. Its full column set
-- was read on 2026-09-05 and there is no model status, production-stopped or
-- decertified column. What the list does guarantee is that it holds only
-- CURRENTLY CERTIFIED equipment -- EPA drops a model when it is decertified --
-- so a model that goes away disappears on the next refresh and
-- reconcile_energy_star_equipment_catalogue retires the product. A model still
-- certified but no longer manufactured is not distinguishable here; that flag
-- lives only in AHRI's paid directory. Do not add a column pretending otherwise.
--
-- Cold-climate certification is deliberately NOT a filter (Nicholas, same day:
-- "it doesn't have to be cold climate alone ... You should show any Energy Star
-- equipment"). Whether a unit carries the load when it is cold is decided by
-- its own numbers at selection time, not by a badge at import time.

BEGIN;

CREATE OR REPLACE FUNCTION public.fetch_energy_star_equipment(
  p_dataset text,
  p_start_offset integer DEFAULT 0,
  p_pages integer DEFAULT 5,
  p_page_size integer DEFAULT 5000
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $$
DECLARE
  v_resource   text;
  v_filter     text;
  v_url        text;
  v_status     integer;
  v_content    text;
  v_rows       jsonb;
  v_page       integer := 0;
  v_offset     integer := p_start_offset;
  v_in_page    integer;
  v_total      integer := 0;
BEGIN
  IF p_dataset = 'heat_pumps' THEN
    v_resource := 'w7cv-9xjt';
    -- Refused at the source, never imported and then hidden.
    v_filter   := '&$where=' || extensions.urlencode($f$refrigerant_with_gwp not like 'R-410A%'$f$);
  ELSIF p_dataset = 'furnaces' THEN
    v_resource := 'i97v-e8au';
    v_filter   := '';   -- a furnace burns fuel; it carries no refrigerant
  ELSE
    RAISE EXCEPTION
      'Unknown equipment list "%". The two lists are heat_pumps and furnaces.', p_dataset;
  END IF;

  -- The default is five seconds and a page of five thousand takes longer than
  -- that. Must be set in the same session as the call.
  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT', '120');

  WHILE v_page < p_pages LOOP
    v_url := format(
      'https://data.energystar.gov/resource/%s.json?$limit=%s&$offset=%s&$order=pd_id%s',
      v_resource, p_page_size, v_offset, v_filter);

    SELECT status, content INTO v_status, v_content
      FROM extensions.http_get(v_url);

    IF v_status <> 200 THEN
      RAISE EXCEPTION 'ENERGY STAR answered % at offset % for the % list',
        v_status, v_offset, p_dataset;
    END IF;

    v_rows := v_content::jsonb;
    SELECT jsonb_array_length(v_rows) INTO v_in_page;
    EXIT WHEN v_in_page = 0;

    INSERT INTO public.energy_star_equipment_import_rows AS t
      (esr_dataset, esr_source_id, esr_certificate_number, esr_brand,
       esr_model_number, esr_payload)
    SELECT
      p_dataset,
      r->>'pd_id',
      r->>'ahri_reference_number',
      coalesce(r->>'outdoor_unit_brand_name', r->>'brand_name'),
      r->>'model_number',
      r
    FROM jsonb_array_elements(v_rows) AS r
    WHERE r->>'pd_id' IS NOT NULL
    ON CONFLICT (esr_dataset, esr_source_id) DO UPDATE
      SET esr_certificate_number = excluded.esr_certificate_number,
          esr_brand              = excluded.esr_brand,
          esr_model_number       = excluded.esr_model_number,
          esr_payload            = excluded.esr_payload,
          esr_fetched_at         = now();

    v_total  := v_total + v_in_page;
    v_offset := v_offset + v_in_page;
    v_page   := v_page + 1;

    EXIT WHEN v_in_page < p_page_size;   -- the source ran out
  END LOOP;

  RETURN jsonb_build_object(
    'dataset',      p_dataset,
    'rows_fetched', v_total,
    'next_offset',  v_offset,
    'exhausted',    (v_in_page IS NULL OR v_in_page < p_page_size),
    'rows_held',    (SELECT count(*) FROM public.energy_star_equipment_import_rows
                      WHERE esr_dataset = p_dataset));
END;
$$;

-- Runs as the owner because it writes to an admin-only table and reaches the
-- network. Nobody signed in calls it directly, so EXECUTE comes straight back
-- off -- a callable definer function is an advisor finding and, here, a way for
-- any signed-in user to make the database fetch a URL.
REVOKE ALL ON FUNCTION public.fetch_energy_star_equipment(text, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fetch_energy_star_equipment(text, integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.fetch_energy_star_equipment(text, integer, integer, integer) FROM authenticated;

COMMIT;
