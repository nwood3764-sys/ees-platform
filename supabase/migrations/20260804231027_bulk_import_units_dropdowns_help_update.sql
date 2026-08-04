-- Keep HA-00062 accurate after the template got smarter: Units Property/Building
-- are now drop-downs sourced from the Data tab, and the Unit Notes column was removed.

UPDATE public.help_articles
SET ha_body_markdown = replace(
  ha_body_markdown,
  '- **Property Name** + **Building Name** (required) — must match the Data sheet exactly; this is how each unit finds its building.',
  '- **Property Name** + **Building Name** (required) — pick each from the drop-down; it lists exactly the properties and buildings you entered on the Data tab, so a unit can only point at a building you actually created.'
)
WHERE ha_record_number = 'HA-00062';

UPDATE public.help_articles
SET ha_body_markdown = replace(
  ha_body_markdown,
  '- **Bedrooms, Bathrooms, Square Footage, Floor, Unit Notes** — all optional.',
  '- **Bedrooms, Bathrooms, Square Footage, Floor** — all optional.'
)
WHERE ha_record_number = 'HA-00062';
