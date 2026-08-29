-- A saved list view remembers its column widths.
--
-- Nicholas, 2026-08-29: "when we're saving a view, it should save the width as
-- well, because I have to keep re-expanding these columns left and right so I
-- can read them."
--
-- Widths lived only in the browser's localStorage, keyed per OBJECT — so every
-- saved view on opportunities shared one width map, a column not in that map
-- fell back to a fixed default (160px, too narrow for "Lutheran Social Services
-- of Wisconsin and Upper Michigan, Inc."), and nothing followed the user to
-- another browser or machine. A view is a saved layout; its column widths are
-- part of that layout, not a per-browser preference.
--
-- Shape: { "<field>": <px>, ... } — the same field keys as
-- list_view_visible_columns. NULL means "no widths saved", which is what every
-- existing view means, and those keep falling back to localStorage exactly as
-- before.

ALTER TABLE public.saved_list_views
  ADD COLUMN IF NOT EXISTS list_view_column_widths jsonb;

COMMENT ON COLUMN public.saved_list_views.list_view_column_widths IS
  'Per-column pixel widths for this view, keyed by the same field names as list_view_visible_columns, e.g. {"name": 320, "property_id__rel__property_name": 260}. NULL = none saved; the list falls back to the browser''s own remembered widths. Written when the view is saved, applied when it is opened.';
