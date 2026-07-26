-- Canvas dashboards save real 12-col geometry into dw_width/dw_height and new
-- registry-driven widget types into dw_widget_type, but the baseline
-- constraints still enforced the old form editor's world: width/height 1..4
-- and a hardcoded 9-type whitelist. Both reject legitimate canvas saves
-- (any widget wider than 4 columns; every future component type). Widen the
-- geometry bounds and replace the type whitelist with a shape check — the
-- component registry is the source of truth for valid types (nothing
-- hardcoded), and dw_widget_config already travels as free jsonb.
ALTER TABLE public.dashboard_widgets DROP CONSTRAINT dashboard_widgets_dw_width_check;
ALTER TABLE public.dashboard_widgets ADD CONSTRAINT dashboard_widgets_dw_width_check CHECK (dw_width >= 1 AND dw_width <= 12);

ALTER TABLE public.dashboard_widgets DROP CONSTRAINT dashboard_widgets_dw_height_check;
ALTER TABLE public.dashboard_widgets ADD CONSTRAINT dashboard_widgets_dw_height_check CHECK (dw_height >= 1 AND dw_height <= 24);

ALTER TABLE public.dashboard_widgets DROP CONSTRAINT dashboard_widgets_dw_widget_type_check;
ALTER TABLE public.dashboard_widgets ADD CONSTRAINT dashboard_widgets_dw_widget_type_check CHECK (dw_widget_type ~ '^[a-z0-9_]{1,60}$');
