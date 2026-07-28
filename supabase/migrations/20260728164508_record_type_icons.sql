-- ---------------------------------------------------------------------------
-- Record type icons + colors
-- ---------------------------------------------------------------------------
-- Salesforce-parity: give each record type (and, where useful, any picklist
-- value) a small icon + color so users can tell at a glance which object and
-- record type a record is. Both columns are nullable — a record type with no
-- override falls back to its object's default icon in the client.
--
--   picklist_icon  — a key into the client-side ICON_CATALOG in
--                    src/lib/recordTypeIcons.jsx (e.g. 'home', 'wrench',
--                    'clipboard-check'). NOT a raw SVG path — keeping it a
--                    stable key means the glyph set is versioned in code while
--                    the assignment lives in the database and is editable
--                    through LEAP Admin.
--   picklist_color — a hex color (e.g. '#2aab72') from the curated
--                    RECORD_TYPE_COLORS palette. Stored as text so the palette
--                    can grow without a schema change. Design-system rule
--                    (no red/orange) is enforced in the client swatch list.
--
-- Nothing is hardcoded per record type: the 240+ record types across objects
-- are assigned icons/colors as data, managed in Object Manager > Record Types.
-- ---------------------------------------------------------------------------

ALTER TABLE public.picklist_values
  ADD COLUMN IF NOT EXISTS picklist_icon  text,
  ADD COLUMN IF NOT EXISTS picklist_color text;

COMMENT ON COLUMN public.picklist_values.picklist_icon IS
  'Icon key into the client ICON_CATALOG (src/lib/recordTypeIcons.jsx). Applies primarily to record_type rows. Null = fall back to the object default icon.';
COMMENT ON COLUMN public.picklist_values.picklist_color IS
  'Hex color from the RECORD_TYPE_COLORS palette used for the record-type icon badge. Null = fall back to the object default color.';

NOTIFY pgrst, 'reload schema';
