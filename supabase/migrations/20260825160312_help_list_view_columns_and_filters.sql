-- Help: list-view columns and filters, corrected in place.
--
-- Two promises in these articles are no longer true, and one of them described
-- a defect:
--   * HA-00094 said the record number and primary name "can't be hidden". They
--     are now ordinary columns — hideable, and draggable to any position.
--   * HA-00111 never said what happens when you filter on a field you are not
--     showing. It used to silently return nothing on a related field; it now
--     filters correctly whether or not the column is on screen, which is the
--     part a user needs told.
--
-- Corrected, not appended — a help article that still promises the old
-- behaviour is worse than no article.

update public.help_articles
set ha_summary = 'Show, hide, and reorder any column on a list — including the record number and the name — and save the arrangement as part of a view.',
    ha_body_markdown = $md$## Choosing columns

Each list opens with a default set of columns. To change which columns appear:

1. Click **Columns** in the list toolbar.
2. Check or uncheck columns. The table updates immediately.
3. Use the search box to find a column by name, including fields on related records (a property's City on an opportunity list, for example).

Every column can be removed, including **Record #** and **Name**. The only one you cannot uncheck is the last one left — a list with no columns has nothing to show. When the name column is hidden, double-click any row to open the record.

The Columns button shows a count of how many columns are on screen.

## Reordering columns

Drag a column header sideways and drop it where you want it. Nothing is pinned to the left: the record number and the name move like any other column, so you can put the field you care about first.

## Saving your column choice

Column visibility and column order are both part of a saved view. After arranging the columns, save or update a view (see *Saving and managing list views*) and the arrangement is stored with it. **Reset to default** returns the list to its standard column set.

## Column widths

Column widths are separate: drag the right edge of any column header to resize it, or double-click the edge to reset. Widths are remembered per list on your device.
$md$,
    ha_updated_at = now()
where ha_record_number = 'HA-00094' and ha_is_deleted is not true;

update public.help_articles
set ha_body_markdown = ha_body_markdown || $md$
## Filtering on a column you are not showing

A filter works on any field on the record, whether or not that field is displayed as a column. Removing a column never changes which rows match — the filter keeps running on the field behind it, and the rows you were looking at stay.

The same is true of sorting: a list can be sorted by a field it does not display.

Open **Filters** in the toolbar to filter on any field on the object, including fields on related records, without adding a column for it first.
$md$,
    ha_updated_at = now()
where ha_record_number = 'HA-00111'
  and ha_is_deleted is not true
  and ha_body_markdown not like '%Filtering on a column you are not showing%';

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.help_articles
   where ha_record_number in ('HA-00094','HA-00111')
     and ha_is_deleted is not true
     and ha_body_markdown like '%always shown%';
  if v_count > 0 then
    raise exception 'help article still promises un-hideable columns (% rows)', v_count;
  end if;
end $$;
