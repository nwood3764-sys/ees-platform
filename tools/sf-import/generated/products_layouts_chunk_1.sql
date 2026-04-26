-- --- PRODUCTS layouts from SF -------------
-- 4 SF layouts found for Product2

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard products layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'products' AND is_deleted = false;

-- Layout: HVAC-Equipment  →  RT picklist_value = HVAC_Equipment
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'products' AND picklist_field = 'record_type' AND picklist_value = 'HVAC_Equipment' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'HVAC-Equipment', 'products',
    'record_detail', true,
    'Imported from SF Layout: Product2-HVAC-Equipment',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Product Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Product Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'product_code', 'label', 'Code'),
        jsonb_build_object('name', 'product_family', 'label', 'Family'),
        jsonb_build_object('name', 'product_equipment_category', 'label', 'Equipment Category'),
        jsonb_build_object('name', 'product_sku', 'label', 'Sku'),
        jsonb_build_object('name', 'product_is_active', 'label', 'Is Active')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Equipment Specifications', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment Specifications', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_ahri_certificate', 'label', 'AHRI Certificate'),
        jsonb_build_object('name', 'product_ducting_configuration', 'label', 'Ducting Configuration'),
        jsonb_build_object('name', 'product_refrigerant_type', 'label', 'Refrigerant Type'),
        jsonb_build_object('name', 'product_eer2', 'label', 'Eer2'),
        jsonb_build_object('name', 'product_seer2', 'label', 'Seer2'),
        jsonb_build_object('name', 'product_hspf2_region_iv', 'label', 'Hspf2 Region Iv'),
        jsonb_build_object('name', 'product_hspf2_region_v', 'label', 'Hspf2 Region V'),
        jsonb_build_object('name', 'product_energy_star_v6_1', 'label', 'Energy Star V6 1'),
        jsonb_build_object('name', 'product_energy_star_v6_1_cold_climate', 'label', 'Energy Star V6 1 Cold Climate'),
        jsonb_build_object('name', 'product_federal_tax_credit_eligibility_north', 'label', 'Federal Tax Credit Eligibility North'),
        jsonb_build_object('name', 'product_cooling_capacity_95_f', 'label', 'Cooling Capacity 95 F'),
        jsonb_build_object('name', 'product_heating_capacity_47_f', 'label', 'Heating Capacity 47 F'),
        jsonb_build_object('name', 'product_heating_capacity_17_f', 'label', 'Heating Capacity 17 F'),
        jsonb_build_object('name', 'product_heating_capacity_5_f', 'label', 'Heating Capacity 5 F'),
        jsonb_build_object('name', 'product_heating_cop_5_f', 'label', 'Heating Cop 5 F'),
        jsonb_build_object('name', 'product_heating_capacity_13_f', 'label', 'Heating Capacity 13 F'),
        jsonb_build_object('name', 'product_capacity_maintenance_rated_17_f_rated_4', 'label', 'Capacity Maintenance Rated 17 F Rated 4'),
        jsonb_build_object('name', 'product_capacity_maintenance_rated_5_f_rated_47', 'label', 'Capacity Maintenance Rated 5 F Rated 47'),
        jsonb_build_object('name', 'product_capacity_maintenance_max_5_f_rated_47_f', 'label', 'Capacity Maintenance Max 5 F Rated 47 F'),
        jsonb_build_object('name', 'product_variable_capacity', 'label', 'Variable Capacity')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Manufacture Informatio', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Manufacture Informatio', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_manufacturer', 'label', 'Manufacturer'),
        jsonb_build_object('name', 'product_model_number', 'label', 'Model Number'),
        jsonb_build_object('name', 'product_series', 'label', 'Series'),
        jsonb_build_object('name', 'product_series_name', 'label', 'Series Name'),
        jsonb_build_object('name', 'product_description', 'label', 'Description'),
        jsonb_build_object('name', 'product_product_size', 'label', 'Product Size'),
        jsonb_build_object('name', 'product_product_size_unit_of_measure', 'label', 'Product Size Unit Of Measure'),
        jsonb_build_object('name', 'product_manufacture_specifications', 'label', 'Manufacture Specifications'),
        jsonb_build_object('name', 'product_manufacture_site', 'label', 'Manufacture Site'),
        jsonb_build_object('name', 'product_product_image_url', 'label', 'Product Image Url')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'References', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'References', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_ahri_link', 'label', 'AHRI Link'),
        jsonb_build_object('name', 'product_neep_link', 'label', 'Neep Link'),
        jsonb_build_object('name', 'product_submittal_sheet_url', 'label', 'Submittal Sheet Url'),
        jsonb_build_object('name', 'product_manufacture_engineering_manual', 'label', 'Manufacture Engineering Manual'),
        jsonb_build_object('name', 'product_manufacture_install_manual', 'label', 'Manufacture Install Manual'),
        jsonb_build_object('name', 'product_manufacture_service_manual', 'label', 'Manufacture Service Manual')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Product Restocking Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Product Restocking Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_primary_vendor', 'label', 'Primary Vendor'),
        jsonb_build_object('name', 'product_secondary_vendor', 'label', 'Secondary Vendor'),
        jsonb_build_object('name', 'product_method_of_restock', 'label', 'Method Of Restock'),
        jsonb_build_object('name', 'product_restock_quantity_minimum', 'label', 'Restock Quantity Minimum'),
        jsonb_build_object('name', 'product_quantity_unit_of_measure', 'label', 'Quantity Unit Of Measure')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'Work Order Details', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Work Order Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_work_type', 'label', 'Work Type'),
        jsonb_build_object('name', 'product_work_order_record_type_id', 'label', 'Work Order Record Type ID'),
        jsonb_build_object('name', 'product_create_retrofit_work_order', 'label', 'Create Retrofit Work Order')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Project Details', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_project_record_type_id', 'label', 'Project Record Type ID'),
        jsonb_build_object('name', 'product_product_image', 'label', 'Product Image')
      )), false
  );

-- Layout: HVAC-System  →  RT picklist_value = HVAC_System
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'products' AND picklist_field = 'record_type' AND picklist_value = 'HVAC_System' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'HVAC-System', 'products',
    'record_detail', true,
    'Imported from SF Layout: Product2-HVAC-System',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Product Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Product Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'product_code', 'label', 'Code'),
        jsonb_build_object('name', 'product_family', 'label', 'Family'),
        jsonb_build_object('name', 'product_is_active', 'label', 'Is Active'),
        jsonb_build_object('name', 'product_equipment_category', 'label', 'Equipment Category'),
        jsonb_build_object('name', 'product_series_name', 'label', 'Series Name'),
        jsonb_build_object('name', 'product_submittal_sheet_url', 'label', 'Submittal Sheet Url')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Equipment Ratings', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment Ratings', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_ahri_link', 'label', 'AHRI Link'),
        jsonb_build_object('name', 'product_ahri_certificate', 'label', 'AHRI Certificate'),
        jsonb_build_object('name', 'product_ducting_configuration', 'label', 'Ducting Configuration'),
        jsonb_build_object('name', 'product_eer2', 'label', 'Eer2'),
        jsonb_build_object('name', 'product_seer2', 'label', 'Seer2'),
        jsonb_build_object('name', 'product_hspf2_region_iv', 'label', 'Hspf2 Region Iv'),
        jsonb_build_object('name', 'product_hspf2_region_v', 'label', 'Hspf2 Region V'),
        jsonb_build_object('name', 'product_energy_star_v6_1', 'label', 'Energy Star V6 1'),
        jsonb_build_object('name', 'product_energy_star_v6_1_cold_climate', 'label', 'Energy Star V6 1 Cold Climate'),
        jsonb_build_object('name', 'product_federal_tax_credit_eligibility_north', 'label', 'Federal Tax Credit Eligibility North'),
        jsonb_build_object('name', 'product_capacity_maintenance_rated_17_f_rated_4', 'label', 'Capacity Maintenance Rated 17 F Rated 4'),
        jsonb_build_object('name', 'product_capacity_maintenance_rated_5_f_rated_47', 'label', 'Capacity Maintenance Rated 5 F Rated 47'),
        jsonb_build_object('name', 'product_capacity_maintenance_max_5_f_rated_47_f', 'label', 'Capacity Maintenance Max 5 F Rated 47 F'),
        jsonb_build_object('name', 'product_variable_capacity', 'label', 'Variable Capacity'),
        jsonb_build_object('name', 'product_refrigerant_type', 'label', 'Refrigerant Type'),
        jsonb_build_object('name', 'product_neep_link', 'label', 'Neep Link'),
        jsonb_build_object('name', 'product_cooling_capacity_95_f', 'label', 'Cooling Capacity 95 F'),
        jsonb_build_object('name', 'product_heating_capacity_47_f', 'label', 'Heating Capacity 47 F'),
        jsonb_build_object('name', 'product_heating_capacity_17_f', 'label', 'Heating Capacity 17 F'),
        jsonb_build_object('name', 'product_heating_capacity_5_f', 'label', 'Heating Capacity 5 F'),
        jsonb_build_object('name', 'product_heating_cop_5_f', 'label', 'Heating Cop 5 F'),
        jsonb_build_object('name', 'product_heating_capacity_13_f', 'label', 'Heating Capacity 13 F')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Heat Pump Manufacture Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Heat Pump Manufacture Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_manufacturer', 'label', 'Manufacturer'),
        jsonb_build_object('name', 'product_model_number', 'label', 'Model Number'),
        jsonb_build_object('name', 'product_series', 'label', 'Series'),
        jsonb_build_object('name', 'product_description', 'label', 'Description'),
        jsonb_build_object('name', 'product_product_size', 'label', 'Product Size'),
        jsonb_build_object('name', 'product_product_size_unit_of_measure', 'label', 'Product Size Unit Of Measure'),
        jsonb_build_object('name', 'product_manufacture_site', 'label', 'Manufacture Site'),
        jsonb_build_object('name', 'product_manufacture_specifications', 'label', 'Manufacture Specifications'),
        jsonb_build_object('name', 'product_manufacture_engineering_manual', 'label', 'Manufacture Engineering Manual'),
        jsonb_build_object('name', 'product_manufacture_install_manual', 'label', 'Manufacture Install Manual'),
        jsonb_build_object('name', 'product_manufacture_service_manual', 'label', 'Manufacture Service Manual'),
        jsonb_build_object('name', 'product_product_image_url', 'label', 'Product Image Url')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Product Restocking Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Product Restocking Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_primary_vendor', 'label', 'Primary Vendor'),
        jsonb_build_object('name', 'product_secondary_vendor', 'label', 'Secondary Vendor'),
        jsonb_build_object('name', 'product_method_of_restock', 'label', 'Method Of Restock'),
        jsonb_build_object('name', 'product_restock_quantity_minimum', 'label', 'Restock Quantity Minimum'),
        jsonb_build_object('name', 'product_quantity_unit_of_measure', 'label', 'Quantity Unit Of Measure')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Work Order Details', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Work Order Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_work_type', 'label', 'Work Type'),
        jsonb_build_object('name', 'product_work_order_record_type_id', 'label', 'Work Order Record Type ID'),
        jsonb_build_object('name', 'product_create_retrofit_work_order', 'label', 'Create Retrofit Work Order')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'Project Details', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_project_record_type_id', 'label', 'Project Record Type ID'),
        jsonb_build_object('name', 'product_product_image', 'label', 'Product Image')
      )), false
  );

-- Layout: Product Layout  →  RT picklist_value = Product
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'products' AND picklist_field = 'record_type' AND picklist_value = 'Product' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Product Layout', 'products',
    'record_detail', true,
    'Imported from SF Layout: Product2-Product Layout',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Product Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Product Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'product_code', 'label', 'Code'),
        jsonb_build_object('name', 'product_family', 'label', 'Family'),
        jsonb_build_object('name', 'product_equipment_category', 'label', 'Equipment Category'),
        jsonb_build_object('name', 'product_is_active', 'label', 'Is Active')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Product Details', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Product Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_manufacturer', 'label', 'Manufacturer'),
        jsonb_build_object('name', 'product_model_number', 'label', 'Model Number'),
        jsonb_build_object('name', 'product_series_name', 'label', 'Series Name'),
        jsonb_build_object('name', 'product_description', 'label', 'Description'),
        jsonb_build_object('name', 'product_product_size', 'label', 'Product Size'),
        jsonb_build_object('name', 'product_product_size_unit_of_measure', 'label', 'Product Size Unit Of Measure'),
        jsonb_build_object('name', 'product_product_image_url', 'label', 'Product Image Url'),
        jsonb_build_object('name', 'product_product_image', 'label', 'Product Image')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Specification Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Specification Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_ahri_certificate', 'label', 'AHRI Certificate'),
        jsonb_build_object('name', 'product_ahri_link', 'label', 'AHRI Link'),
        jsonb_build_object('name', 'product_submittal_sheet_url', 'label', 'Submittal Sheet Url')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Product Restocking Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Product Restocking Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_primary_vendor', 'label', 'Primary Vendor'),
        jsonb_build_object('name', 'product_secondary_vendor', 'label', 'Secondary Vendor'),
        jsonb_build_object('name', 'product_method_of_restock', 'label', 'Method Of Restock'),
        jsonb_build_object('name', 'product_restock_quantity_minimum', 'label', 'Restock Quantity Minimum'),
        jsonb_build_object('name', 'product_quantity_unit_of_measure', 'label', 'Quantity Unit Of Measure')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Application Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Application Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_application_name', 'label', 'Application Name'),
        jsonb_build_object('name', 'product_application_page', 'label', 'Application Page'),
        jsonb_build_object('name', 'product_application_field', 'label', 'Application Field')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'Work Order Details', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Work Order Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_work_type', 'label', 'Work Type'),
        jsonb_build_object('name', 'product_create_retrofit_work_order', 'label', 'Create Retrofit Work Order'),
        jsonb_build_object('name', 'product_work_order_record_type_id', 'label', 'Work Order Record Type ID')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Project Details', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'product_project_record_type_id', 'label', 'Project Record Type ID')
      )), false
  );


END $$;
