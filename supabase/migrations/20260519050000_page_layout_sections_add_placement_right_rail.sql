-- Right-rail support for record detail pages. Sections with placement='right'
-- render in a fixed-width right sidebar that stays visible regardless of which
-- main-content tab is active (Details/Related/Activity). Matches the
-- Salesforce Lightning utility-rail pattern. Existing sections all default to
-- 'main' so no behavior changes for current layouts.

ALTER TABLE public.page_layout_sections
  ADD COLUMN IF NOT EXISTS section_placement text NOT NULL DEFAULT 'main'
    CHECK (section_placement IN ('main', 'right'));

COMMENT ON COLUMN public.page_layout_sections.section_placement IS
  'Where the section renders on the record detail page. main = inside the active tab body. right = inside the persistent right sidebar (always visible). Default main keeps the previous behavior for every existing section.';
