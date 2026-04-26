"""
SF Layout XML → Anura page_layouts migration generator.

Usage: python sf_layout_translator.py <object_name>
where object_name is one of: accounts, contacts, properties, ...

For each SF layout file matching the object's SF SObjectType, generate INSERTs
for page_layouts + page_layout_sections + page_layout_widgets, with widget_config
fields list translated to Anura column names. Fields not present in the Anura
column list are logged and skipped (printed as a TODO list for the user).
"""

import sys
import os
import re
import xml.etree.ElementTree as ET
from pathlib import Path

# ─── SF SObjectType → Anura table mapping ────────────────────────────────
SF_TO_ANURA_TABLE = {
    'Account':                              'accounts',
    'Contact':                              'contacts',
    'Property__c':                          'properties',
    'Building__c':                          'buildings',
    'Project__c':                           'projects',
    'Opportunity':                          'opportunities',
    'Assessment__c':                        'assessments',
    'WorkOrder':                            'work_orders',
    'Equipment__c':                         'equipment',
    'Equipment_Activity__c':                'equipment_activities',
    'Mechanical_Equipment__c':              'mechanical_equipment',
    'Vehicle_Activity__c':                  'vehicle_activities',
    'Diagnostic_Test__c':                   'diagnostic_tests',
    'Incentive__c':                         'incentives',
    'Incentive_Application__c':             'incentive_applications',
    'Anura_Time_Sheet__c':                  'time_sheets',
    'Anura_Time_Sheet_Entry__c':            'time_sheet_entries',
    'Occurrence__c':                        'occurrences',
    'GPS_Point__c':                         'gps_points',
    'Electrification_Feasibility_Report__c':'efr_reports',
    'Product2':                             'products',
    'WorkStep':                             'work_steps',
}

ANURA_TO_SF_TABLE = {v: k for k, v in SF_TO_ANURA_TABLE.items()}

# Per-table column prefix (e.g. accounts → 'account_')
PREFIX = {
    'accounts':                'account_',
    'contacts':                'contact_',
    'properties':              'property_',
    'buildings':               'building_',
    'projects':                'project_',
    'opportunities':           'opportunity_',
    'assessments':             'assessment_',
    'work_orders':             'work_order_',
    'equipment':               'equipment_',
    'equipment_activities':    'ea_',
    'mechanical_equipment':    'me_',
    'vehicle_activities':      'va_',
    'diagnostic_tests':        'diagnostic_',
    'incentives':              'incentive_',
    'incentive_applications':  'ia_',
    'time_sheets':             'ts_',
    'time_sheet_entries':      'tse_',
    'occurrences':             'occurrence_',
    'gps_points':              'gps_',
    'efr_reports':             'efr_',
    'products':                'product_',
    'work_steps':              'work_step_',
}

# Hand-curated per-table SF→Anura field-name mappings.
# These cover Standard SF fields (no __c) plus any fields whose Anura name
# diverges from the simple `lower(strip __c)` rule.
FIELD_MAP = {
    'accounts': {
        # Standard SF
        'Name':           'account_name',
        'ParentId':       'parent_account_id',
        'Type':           'account_type',
        'Phone':          'account_phone',
        'Fax':            'account_fax',
        'Website':        'account_website',
        'Description':    'account_notes',
        'OwnerId':        'account_owner',
        'NumberOfEmployees': 'account_number_of_employees',
        'BillingStreet':  'billing_street',
        'BillingCity':    'billing_city',
        'BillingState':   'billing_state',
        'BillingPostalCode':'billing_zip',
        'BillingCountry': 'billing_country',
        'BillingAddress': None,  # SF compound — already covered by individual billing_* fields
        'ShippingStreet': 'mailing_street',
        'ShippingCity':   'mailing_city',
        'ShippingState':  'mailing_state',
        'ShippingPostalCode':'mailing_zip',
        'ShippingCountry':'mailing_country',
        'ShippingAddress': None,
        # System metadata → mapped to Anura audit columns
        'CreatedById':       'account_created_by',
        'LastModifiedById':  'account_updated_by',
        # SF Custom fields with Anura equivalents
        'Email__c':                                       'account_email',
        'Organization_Name__c':                           'account_organization_name',
        'Partner_Type__c':                                'account_partner_type',
        'Status__c':                                      'account_status',
        'RecordType':                                     'account_record_type',
        'RecordTypeId':                                   'account_record_type',
        # Custom business fields (newly added columns)
        'Hud_Participant_Id__c':                          'account_hud_participant_id',
        'Year_Company_was_Formed__c':                     'account_year_company_was_formed',
        'Company_Type__c':                                'account_company_type',
        'Company_Ownership__c':                           'account_company_ownership',
        'Account_Contact__c':                             'account_contact_id',
        'Subcontractor_Application_Status__c':            'account_subcontractor_application_status',
        'Health_and_Safety_Programs__c':                  'account_health_and_safety_programs',
        'COVID_19_Transmission_Prevention_Program__c':    'account_covid_19_transmission_prevention_program',
        'Geographic_Service_Area__c':                     'account_geographic_service_area',
        'List_of_Services_Provided__c':                   'account_list_of_services_provided',
        'Additional_Locations_and_Services__c':           'account_additional_locations_and_services',
        'Subcontractor_Requirements_from_Anura__c':       'account_subcontractor_requirements_from_anura',
        'CAA_People_Served__c':                           'account_caa_people_served',
        'CAA_No_Of_Volunteers__c':                        'account_caa_no_of_volunteers',
        'CAA_Programs__c':                                'account_caa_programs',
        'CAA_Counties__c':                                'account_caa_counties',
        'Inquiry_pp__c':                                  'account_inquiry_pp',
        'EE_Program__c':                                  'account_ee_program',
        'Technician_Start_Date__c':                       'account_technician_start_date',
        'Technician_End_Date__c':                         'account_technician_end_date',
        'Technician_length_of_Employment__c':             'account_technician_length_of_employment',
        # Rollup placeholders
        'Total_Number_of_Properties__c':                  'account_total_number_of_properties',
        'Total_Number_of_Buildings__c':                   'account_total_number_of_buildings',
        'Total_Number_of_Units__c':                       'account_total_number_of_units',
        'Number_of_Opportunities__c':                     'account_number_of_opportunities',
        'Number_of_Open_Opportunities__c':                'account_number_of_open_opportunities',
        'Number_of_Won_Opportunities__c':                 'account_number_of_won_opportunities',
        'Amount_of_Open_Opportunities__c':                'account_amount_of_open_opportunities',
        'Total_Attic_SqFt__c':                            'account_total_attic_sqft',
        'Total_Building_SqFt__c':                         'account_total_building_sqft',
    },
    'contacts': {
        # Standard SF
        'Name':              'contact_name',
        'FirstName':         'contact_first_name',
        'LastName':          'contact_last_name',
        'Title':             'contact_title',
        'Email':             'contact_email',
        'Phone':             'contact_phone',
        'MobilePhone':       'contact_mobile_phone',
        'Fax':               'contact_fax',
        'Department':        'contact_department',
        'ReportsToId':       'contact_reports_to_id',
        'AccountId':         'contact_account_id',
        'OwnerId':           'contact_owner',
        'MailingStreet':     'contact_mailing_street',
        'MailingCity':       'contact_mailing_city',
        'MailingState':      'contact_mailing_state',
        'MailingPostalCode': 'contact_mailing_zip',
        'MailingCountry':    'contact_mailing_country',
        'MailingAddress':    None,  # compound — covered by individuals
        'Description':       'contact_notes',
        'Birthdate':         'contact_birthdate',
        'LastCURequestDate': 'contact_last_cu_request_date',
        'LastCUUpdateDate':  'contact_last_cu_update_date',
        'RecordType':        'contact_record_type',
        'RecordTypeId':      'contact_record_type',
        'CreatedById':       'contact_created_by',
        'LastModifiedById':  'contact_updated_by',
        # Custom — communication
        'Mobile_Carrier__c':                  'contact_mobile_carrier',
        'LinkedIN__c':                        'contact_linkedin',
        'Microsoft_Account__c':               'contact_microsoft_account',
        # Custom — link to user
        'Salesforce_User__c':                 'contact_user_id',
        'Flow_Session__c':                    'contact_flow_session',
        # Custom — status & onboarding
        'Inactive__c':                        'contact_inactive',
        'Onboarding_Session__c':              'contact_onboarding_session',
        'Closing_Workflow__c':                'contact_closing_workflow',
        # Custom — driver
        'Approved_Driver__c':                 'contact_approved_driver',
        'Approved_Driver_Approved_Date__c':   'contact_approved_driver_approved_date',
        'Verified_Driver__c':                 'contact_verified_driver',
        'Date_Verified__c':                   'contact_date_verified',
        # Custom — employment (technician layout)
        'Employee_Number__c':                 'contact_employee_id',
        'Start_Date__c':                      'contact_start_date',
        'End_Date__c':                        'contact_end_date',
        'Length_of_Employment__c':            'contact_length_of_employment',
        'Length_of_Employment_Months__c':     'contact_length_of_employment_months',
        # Custom — personal
        'Past_Career_Notes__c':               'contact_past_career_notes',
        'Married__c':                         'contact_married',
        'Name_of_Spouse__c':                  'contact_name_of_spouse',
        'Children__c':                        'contact_children',
        'Special_Interests__c':               'contact_special_interests',
        # Custom — uniform
        'Trouser_Inseam_Length__c':           'contact_trouser_inseam_length',
        'Trouser_Waist_Length__c':            'contact_trouser_waist_length',
        'Blouse_Size__c':                     'contact_blouse_size',
        'Face_Size__c':                       'contact_face_size',
        'Hand_Size__c':                       'contact_hand_size',
        'Foot_Size__c':                       'contact_foot_size',
        # Custom — emergency contact
        'Emergency_Contact_Name__c':                  'contact_emergency_contact_name',
        'Emergency_Contact_Relation_to_Tech__c':      'contact_emergency_contact_relation',
        'Emergency_Contact_Mobile_Phone__c':          'contact_emergency_contact_mobile_phone',
        'Emergency_Contact_Home_Phone__c':            'contact_emergency_contact_home_phone',
    },
    'properties': {
        # Standard SF
        'Name':            'property_name',
        'OwnerId':         'property_owner',
        'RecordTypeId':    'property_record_type',
        'CreatedById':     'property_created_by',
        'LastModifiedById':'property_updated_by',
        # MasterDetail / Lookup → accounts
        'Account__c':                  'property_account_id',
        'Owner_Account__c':            'property_account_id',
        'Property_Account__c':         'property_account_id',
        'Property_Managing_Account__c':'property_managing_account_id',
        'Managing_Account__c':         'property_managing_account_id',
        'Property_Management_Company__c':'property_managing_account_id',  # SF lookup → unified accounts
        # Address — SF has duplicate Property_<City|State|Zip|County|Address> alongside the implied standard. Redirect to existing.
        'Property_Address__c':                  'property_street',
        'Property_City__c':                     'property_city',
        'Property_State__c':                    'property_state',
        'Property_Zip__c':                      'property_zip',
        'Property_County__c':                   'property_county',
        # Lookup / contact pointers
        'Property_Site_Contact_del__c':         'property_primary_contact_id',
        # Other redirects to existing columns
        'Property_aka__c':                      'property_aka_name',
        'Property_Website__c':                  'property_website',
        'Property_Class_Description_Tax_Assesso__c': 'property_class_description_tax_assesso',
        'Property_Class_Tax_Assessor__c':       'property_class_tax_assessor',
        'Property_Ownership_Company_Type__c':   'property_ownership_company_type',
        'Property_Ownership_Type__c':           'property_ownership_type',
        'Subsidized_Type__c':                   'property_subsidy_type',
        # New picklist field needs a new column
        'Property_Market_Type__c':              'property_market_type',
    },
    'buildings': {
        # Standard SF
        'Name':            'building_name',
        'OwnerId':         'building_owner',
        'RecordTypeId':    'building_record_type',
        'CreatedById':     'building_created_by',
        'LastModifiedById':'building_updated_by',
        # Master-Detail
        'Property__c':     'property_id',
        # Custom: SF prefixes "Building_" but Anura already prefixes "building_" — strip duplicate
        'Building_18_digit_ID__c':       'building_18_digit_id',
        'Building_Account_Number__c':    'building_account_number',
        'Building_Address__c':           'building_address',
        'Building_Area__c':              'building_area',
        'Building_City__c':              'building_city',
        'Building_Notes__c':             'building_notes',
        'Building_Number_or_Name__c':    'building_number_or_name',
        'Building_Premise_ID__c':        'building_premise_id',
        'Building_SqFt__c':              'building_sq_ft',
        'Building_State__c':             'building_state',
        'Building_Status__c':            'building_status',
        'Building_Zip__c':               'building_zip',
    },
    'opportunities': {
        # Standard SF
        'Name':                'opportunity_name',
        'OwnerId':             'opportunity_owner',
        'AccountId':           'opportunity_account_id',
        'StageName':           'opportunity_stage',
        'Stage__c':            'opportunity_stage',
        'CloseDate':           'opportunity_close_date',
        'Amount':              'opportunity_amount',
        'ExpectedRevenue':     'opportunity_expected_revenue',
        'Probability':         'opportunity_probability',
        'Description':         'opportunity_description',
        'NextStep':            'opportunity_next_step',
        'RecordTypeId':        'opportunity_record_type',
        'Pricebook2Id':        'price_book_id',
        'CreatedById':         'opportunity_created_by',
        'LastModifiedById':    'opportunity_updated_by',
        # Custom redirects
        'Property__c':                                  'property_id',
        'Building__c':                                  'opportunity_building',  # text per layout context
        'Status__c':                                    'opportunity_status',
        'Program__c':                                   'opportunity_program',
        'Program_Year__c':                              'opportunity_program_year',
        'State__c':                                     'opportunity_state',
        'Managing_Account__c':                          'opportunity_managing_account_id',
        'Account_Contact__c':                           'opportunity_account_contact',
        'Property_Site_Contact__c':                     'opportunity_property_site_contact',
        'Property_Management_Company__c':               'opportunity_property_management_company',
    },
    'projects': {
        'Name':            'project_name',
        'OwnerId':         'project_owner',
        'RecordTypeId':    'project_record_type',
        'Property__c':     'property_id',
        'Building__c':     'building_id',
        'Account__c':      'project_account_id',
        'Status__c':       'project_status',
        'Start_Date__c':   'project_start_date',
        'End_Date__c':     'project_end_date',
        'Description__c':  'project_notes',
    },
    'work_orders': {
        'Subject':           'work_order_name',
        'OwnerId':           'work_order_owner',
        'RecordTypeId':      'work_order_record_type',
        'Status':            'work_order_status',
        'Priority':          'work_order_priority',
        'StartDate':         'work_order_scheduled_start',
        'EndDate':           'work_order_scheduled_end',
        'Description':       'work_order_notes',
        'AccountId':         'work_order_account_id',
        'WorkTypeId':        'work_type_id',
        'CaseId':            None,  # Skip — no Anura equivalent
    },
    'assessments': {
        'Name':              'assessment_name',
        'OwnerId':           'assessment_owner',
        'RecordTypeId':      'assessment_record_type',
        'Property__c':       'property_id',
        'Building__c':       'building_id',
        'Status__c':         'assessment_status',
        'Assessment_Date__c':'assessment_date',
        'Description__c':    'assessment_notes',
    },
}

# Common SF fields that we always skip (system / metadata Anura doesn't surface)
ALWAYS_SKIP = {
    'CreatedDate', 'LastModifiedDate', 'SystemModstamp', 'IsDeleted', 'CurrencyIsoCode',
    # Standard SF account fields not relevant to Anura
    'AccountNumber', 'Industry', 'AnnualRevenue',
    'TickerSymbol', 'Ownership', 'Sic', 'Rating', 'AccountSource',
    'Site', 'Jigsaw', 'CleanStatus', 'DunsNumber', 'Tradestyle', 'NaicsCode',
    'NaicsDesc', 'YearStarted', 'SicDesc', 'DandbCompanyId', 'PhotoUrl',
    'IsCustomerPortal', 'IsPartner', 'IsPersonAccount',
    # Contact-specific
    'Salutation', 'Department', 'AssistantName', 'AssistantPhone',
    'OtherStreet', 'OtherCity', 'OtherState', 'OtherPostalCode',
    'OtherCountry', 'OtherPhone', 'HomePhone',
    'Birthdate', 'LeadSource', 'ReportsToId', 'IndividualId',
    'EmailBouncedDate', 'EmailBouncedReason',
    'IsEmailBounced', 'Languages__c',
}


def parse_layout_xml(xml_path):
    """Parse a SF layout XML and return list of sections.

    Returns: [{'label': str, 'columns': int, 'fields': [(field_name, behavior)]}]
    """
    ns = {'sf': 'http://soap.sforce.com/2006/04/metadata'}
    tree = ET.parse(xml_path)
    root = tree.getroot()
    sections = []
    for sec in root.findall('sf:layoutSections', ns):
        label_el = sec.find('sf:label', ns)
        label = label_el.text if label_el is not None else 'Untitled'
        style_el = sec.find('sf:style', ns)
        style = style_el.text if style_el is not None else 'TwoColumnsTopToBottom'
        cols = sec.findall('sf:layoutColumns', ns)
        fields = []
        for col in cols:
            for item in col.findall('sf:layoutItems', ns):
                f = item.find('sf:field', ns)
                b = item.find('sf:behavior', ns)
                if f is not None and f.text:
                    fields.append((f.text, b.text if b is not None else 'Edit'))
        sections.append({
            'label': label,
            'columns': len(cols) if 'TwoColumns' in style or 'Two' in style else 1,
            'fields': fields,
        })
    return sections


def translate_field(sf_field, anura_table, anura_columns):
    """Map an SF field name to an Anura column name.
    Returns the Anura column name, or None if no mapping (= skip).

    FIELD_MAP overrides ALWAYS_SKIP — explicit mapping always wins.
    """
    # Try explicit mapping first (highest priority)
    mapping = FIELD_MAP.get(anura_table, {})
    if sf_field in mapping:
        target = mapping[sf_field]
        if target is None:
            return None
        if target in anura_columns:
            return target
        return None  # mapped but column doesn't exist
    # Then check ALWAYS_SKIP
    if sf_field in ALWAYS_SKIP:
        return None
    # Heuristic: SF custom field Foo_Bar__c → anura snake_case with prefix
    if sf_field.endswith('__c'):
        base = sf_field[:-3]  # strip __c
        # Acronym-aware snake_case:
        #   "Active_PACE_Program"             → active_pace_program
        #   "Cooling_Equipment_Capacity_BTUs" → cooling_equipment_capacity_btus
        #   "HeatingFuelType"                 → heating_fuel_type
        # The {2,} on trailing lowercase preserves "BTUs"/"AMIs" as one word but
        # still splits "HTTPRequest" → "http_request".
        s = re.sub(r'([A-Z]+)([A-Z][a-z]{2,})', r'\1_\2', base)  # ABCdef → ABC_def
        s = re.sub(r'([a-z\d])([A-Z])', r'\1_\2', s)             # aB → a_B
        snake = s.lower().replace('__', '_').strip('_')
        candidates = [
            snake,
            f"{PREFIX[anura_table]}{snake}",
        ]
        for c in candidates:
            if c in anura_columns:
                return c
    return None


def behavior_to_required(behavior):
    return behavior == 'Required'


def section_to_columns(section_label):
    """Most Anura layouts use 2-column sections; preserve."""
    return 2


# ─── PostgreSQL escaping ─────────────────────────────────────────────────
def sql_escape(s):
    if s is None:
        return 'NULL'
    return "'" + s.replace("'", "''") + "'"


def jsonb_object(fields_array):
    """Build a jsonb_build_object('fields', jsonb_build_array(...)) call."""
    items = []
    for f in fields_array:
        # f = {'name': str, 'label': str, 'required': bool}
        parts = [
            f"'name', {sql_escape(f['name'])}",
            f"'label', {sql_escape(f['label'])}",
        ]
        if f.get('required'):
            parts.append("'required', true")
        items.append("jsonb_build_object(" + ", ".join(parts) + ")")
    return "jsonb_build_object('fields', jsonb_build_array(\n        " + ",\n        ".join(items) + "\n      ))"


# ─── Main translation logic ──────────────────────────────────────────────
def translate_object(anura_table, anura_columns, layouts_dir, sf_rt_label_to_picklist_value):
    """Translate all SF layouts for one Anura table.

    Returns: (sql_migration, skip_log)
    sf_rt_label_to_picklist_value: dict of SF layout name → Anura picklist_value
    """
    sf_obj = ANURA_TO_SF_TABLE[anura_table]
    layout_files = sorted(Path(layouts_dir).glob(f"{sf_obj}-*.layout"))

    sql = []
    skip_log = []

    sql.append(f"-- ─── {anura_table.upper()} layouts from SF ─────────────")
    sql.append(f"-- {len(layout_files)} SF layouts found for {sf_obj}")
    sql.append("")
    sql.append("DO $$")
    sql.append("DECLARE")
    sql.append("  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;")
    sql.append("  layout_id uuid;")
    sql.append("  sec_id uuid;")
    sql.append("  rt_id uuid;")
    sql.append("BEGIN")
    sql.append("")

    # Soft-delete the existing default layout for this object so the SF ones take over
    sql.append(f"-- Soft-delete the previous Standard {anura_table} layout, if any")
    sql.append(f"UPDATE public.page_layouts SET is_deleted = true, updated_at = now()")
    sql.append(f"WHERE page_layout_object = '{anura_table}' AND is_deleted = false;")
    sql.append("")

    for lf in layout_files:
        layout_label = lf.stem.split('-', 1)[1]  # everything after first dash
        sf_rt_value = sf_rt_label_to_picklist_value.get(layout_label, layout_label)
        if sf_rt_value == 'SKIP':
            skip_log.append(f"  [{layout_label}] (entire layout skipped — no matching SF RT)")
            continue

        sections = parse_layout_xml(lf)
        if not sections:
            continue

        # Build the sections + widgets
        rt_lookup = (
            f"  SELECT id INTO rt_id FROM public.picklist_values "
            f"WHERE picklist_object = '{anura_table}' AND picklist_field = 'record_type' "
            f"AND picklist_value = {sql_escape(sf_rt_value)} LIMIT 1;"
        ) if sf_rt_value else "  rt_id := NULL;"

        sql.append(f"-- Layout: {layout_label}  →  RT picklist_value = {sf_rt_value or '(default fallback)'}")
        sql.append(rt_lookup)
        sql.append("")
        sql.append(f"  INSERT INTO public.page_layouts (")
        sql.append(f"    page_layout_record_number, page_layout_name, page_layout_object,")
        sql.append(f"    page_layout_type, page_layout_is_default, page_layout_description,")
        sql.append(f"    record_type_id, page_layout_owner, page_layout_created_by, is_deleted")
        sql.append(f"  ) VALUES (")
        sql.append(f"    '', {sql_escape(layout_label)}, '{anura_table}',")
        sql.append(f"    'record_detail', true,")
        sql.append(f"    'Imported from SF Layout: {sf_obj}-{layout_label}',")
        sql.append(f"    rt_id, fb, fb, false")
        sql.append(f"  ) RETURNING id INTO layout_id;")
        sql.append("")

        rendered_sec_idx = 0  # only increment when a section has mappable fields
        for sec in sections:
            mapped_fields = []
            for sf_field, behavior in sec['fields']:
                anura_col = translate_field(sf_field, anura_table, anura_columns)
                if anura_col is None:
                    skip_log.append(f"  [{layout_label}] [{sec['label']}] {sf_field}")
                    continue
                # Generate label from anura_col (replace underscore w/ space, title case)
                # Preserve common acronyms in their proper casing.
                ACRONYMS = {'caa', 'hud', 'ee', 'covid', 'sf', 'mf', 'wi', 'nc',
                            'ira', 'foe', 'pace', 'ashrae', 'bpi', 'epa', 'nate',
                            'osha', 'gps', 'efr', 'hes', 'ptac', 'bdti', 'bdto',
                            'caz', 'caztl', 'cazto', 'pp', 'sqft', 'btus', 'btu',
                            'cfm', 'led', 'dhw', 'hh', 'hpwh', 'ahri'}
                ACRONYM_DISPLAY = {
                    'caa': 'CAA', 'hud': 'HUD', 'ee': 'EE', 'covid': 'COVID',
                    'sf': 'SF', 'mf': 'MF', 'wi': 'WI', 'nc': 'NC', 'ira': 'IRA',
                    'foe': 'FOE', 'pace': 'PACE', 'ashrae': 'ASHRAE', 'bpi': 'BPI',
                    'epa': 'EPA', 'nate': 'NATE', 'osha': 'OSHA', 'gps': 'GPS',
                    'efr': 'EFR', 'hes': 'HES', 'ptac': 'PTAC', 'bdti': 'BDTI',
                    'bdto': 'BDTO', 'caz': 'CAZ', 'pp': 'PP', 'sqft': 'SqFt',
                    'btus': 'BTUs', 'btu': 'BTU', 'cfm': 'CFM', 'led': 'LED',
                    'dhw': 'DHW', 'hh': 'HH', 'hpwh': 'HPWH', 'ahri': 'AHRI',
                    'id': 'ID',
                }
                label_parts = anura_col.replace(PREFIX[anura_table], '', 1).split('_')
                label = ' '.join(
                    ACRONYM_DISPLAY[p] if p in ACRONYM_DISPLAY else p.capitalize()
                    for p in label_parts
                )
                mapped_fields.append({
                    'name': anura_col,
                    'label': label,
                    'required': behavior == 'Required',
                })
            if not mapped_fields:
                continue
            rendered_sec_idx += 1
            collapsed = 'true' if rendered_sec_idx > 2 else 'false'
            sql.append(f"  INSERT INTO public.page_layout_sections (")
            sql.append(f"    page_layout_id, section_order, section_label, section_columns, section_tab,")
            sql.append(f"    section_is_collapsible, section_is_collapsed_by_default, is_deleted")
            sql.append(f"  ) VALUES (")
            sql.append(f"    layout_id, {rendered_sec_idx}, {sql_escape(sec['label'])}, 2, 'Details',")
            sql.append(f"    true, {collapsed}, false")
            sql.append(f"  ) RETURNING id INTO sec_id;")
            sql.append("")
            sql.append(f"  INSERT INTO public.page_layout_widgets (")
            sql.append(f"    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted")
            sql.append(f"  ) VALUES (")
            sql.append(f"    layout_id, sec_id, 'field_group', {sql_escape(sec['label'])}, 1, 1, 'medium',")
            sql.append(f"    {jsonb_object(mapped_fields)}, false")
            sql.append(f"  );")
            sql.append("")

    sql.append("END $$;")
    sql.append("")

    return "\n".join(sql), skip_log


def main():
    if len(sys.argv) < 2:
        print("Usage: python sf_layout_translator.py <anura_table>")
        sys.exit(1)
    anura_table = sys.argv[1]
    layouts_dir = '/home/claude/sf_metadata/layouts'

    # placeholder column list & RT mapping — caller fills in
    print(f"# Translator ready for {anura_table}")


if __name__ == '__main__':
    main()
