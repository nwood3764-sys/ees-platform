// ── OUTREACH DATA ────────────────────────────────────────────────────────────
export const OPPORTUNITIES = [
  { id:'OPP-00001', name:'MF-HOMES-North Willow Apts-Building A',       property:'North Willow Apartments',  owner:'Marcus Reid',  stage:'Opportunity — Reservation Obtained',      program:'WI-IRA-MF-HOMES', amount:142000, closeDate:'2026-06-30', units:20, state:'WI' },
  { id:'OPP-00002', name:'MF-HEAR-Capitol View Townhomes-Bldg 1-6',      property:'Capitol View Townhomes',   owner:'Priya Nair',   stage:'Opportunity — Assessment Scheduled',       program:'WI-IRA-MF-HEAR',  amount:89000,  closeDate:'2026-08-15', units:24, state:'WI' },
  { id:'OPP-00003', name:'MF-HOMES-River Bluff Senior Living-Bldg 1',    property:'River Bluff Senior Living',owner:'Marcus Reid',  stage:'Opportunity — Application Submitted',      program:'WI-IRA-MF-HOMES', amount:210000, closeDate:'2026-05-01', units:42, state:'WI' },
  { id:'OPP-00004', name:'FOE-Eastside Commons-All Buildings',            property:'Eastside Commons',         owner:'Lisa Tanaka',  stage:'Opportunity — Decision Maker Identified',  program:'WI - FOE',        amount:55000,  closeDate:'2026-10-30', units:60, state:'WI' },
  { id:'OPP-00005', name:'Denver-Aspen Court Residences-All Buildings',   property:'Aspen Court Residences',   owner:'Priya Nair',   stage:'Opportunity — Project In Progress',        program:'CO - Denver',     amount:320000, closeDate:'2026-07-15', units:108,state:'CO' },
  { id:'OPP-00006', name:'NC-IRA-HOMES-Pinehurst Village-All',            property:'Pinehurst Village',        owner:'Lisa Tanaka',  stage:'Opportunity — Application Submitted',      program:'WI-IRA-SF-HOMES', amount:175000, closeDate:'2026-06-01', units:72, state:'NC' },
  { id:'OPP-00007', name:'MF-HOMES-Lakewood Terrace-Phase 1',             property:'Lakewood Terrace',         owner:'Marcus Reid',  stage:'Opportunity — Outreach Active',            program:'WI-IRA-MF-HOMES', amount:180000, closeDate:'2026-12-01', units:96, state:'WI' },
  { id:'OPP-00008', name:'MI-IRA-HOMES-Oak Park Apartments-All',          property:'Oak Park Apartments',      owner:'Priya Nair',   stage:'Opportunity — Enrollment In Progress',      program:'MI-IRA-MF-HOMES', amount:98000,  closeDate:'2026-09-01', units:55, state:'MI' },
  { id:'OPP-00009', name:'WI-IRA-HOMES-North Willow Apts-Building B',    property:'North Willow Apartments',  owner:'Marcus Reid',  stage:'Opportunity — Reservation Obtained',       program:'WI-IRA-MF-HOMES', amount:138000, closeDate:'2026-07-30', units:20, state:'WI' },
];

export const PROPERTIES = [
  { id:'PROP-00001', name:'North Willow Apartments',  owner:'CommonBond Communities',     address:'4202 N Willow Way, Madison, WI 53704',     units:120, buildings:6,  status:'Enrolled',       subsidy:'Section 8 / HUD', state:'WI' },
  { id:'PROP-00002', name:'Capitol View Townhomes',    owner:'Alexander Company',          address:'1822 Capitol Dr, Madison, WI 53704',        units:48,  buildings:12, status:'In Progress',    subsidy:'LIHTC',           state:'WI' },
  { id:'PROP-00003', name:'River Bluff Senior Living', owner:'Gorman & Company',           address:'890 River Bluff Rd, Green Bay, WI 54301',   units:84,  buildings:2,  status:'Enrolled',       subsidy:'Section 8 / HUD', state:'WI' },
  { id:'PROP-00004', name:'Eastside Commons',          owner:'CommonBond Communities',     address:'2211 E Washington Ave, Madison, WI 53704',  units:60,  buildings:4,  status:'Outreach Active',subsidy:'NOAH',            state:'WI' },
  { id:'PROP-00005', name:'Lakewood Terrace',          owner:'BRT Realty Trust',           address:'3344 Lakewood Dr, Racine, WI 53402',        units:96,  buildings:8,  status:'Outreach Active',subsidy:'LIHTC',           state:'WI' },
  { id:'PROP-00006', name:'Pinehurst Village',         owner:'Heartland Housing',          address:'1105 Pinehurst Ave, Charlotte, NC 28208',   units:72,  buildings:3,  status:'Enrolled',       subsidy:'DAC',             state:'NC' },
  { id:'PROP-00007', name:'Aspen Court Residences',    owner:'Mercy Housing',              address:'4500 Aspen St, Denver, CO 80211',           units:108, buildings:4,  status:'In Progress',    subsidy:'Section 8 / HUD', state:'CO' },
  { id:'PROP-00008', name:'Oak Park Apartments',       owner:'National Church Residences', address:'788 Oak Park Blvd, Grand Rapids, MI 49504', units:55,  buildings:3,  status:'In Progress',    subsidy:'NOAH',            state:'MI' },
];

export const BUILDINGS = [
  { id:'BLD-00001', name:'North Willow Apartments-Building A',property:'North Willow Apartments',  units:20, stories:3, type:'Apartment',  status:'Enrolled',       heating:'Boiler - Hydronic',       cooling:'CA - Central Air', yearBuilt:1978, state:'WI' },
  { id:'BLD-00002', name:'North Willow Apartments-Building B',property:'North Willow Apartments',  units:20, stories:3, type:'Apartment',  status:'Enrolled',       heating:'Boiler - Hydronic',       cooling:'CA - Central Air', yearBuilt:1978, state:'WI' },
  { id:'BLD-00003', name:'Capitol View Townhomes-Block 1',    property:'Capitol View Townhomes',   units:4,  stories:2, type:'Townhome',   status:'In Progress',    heating:'FAF - Forced Air Furnace', cooling:'CA - Central Air', yearBuilt:1992, state:'WI' },
  { id:'BLD-00004', name:'River Bluff Senior Living-Main',    property:'River Bluff Senior Living',units:60, stories:4, type:'High Rise',  status:'Enrolled',       heating:'Boiler - Steam',           cooling:'PTAC',             yearBuilt:1965, state:'WI' },
  { id:'BLD-00005', name:'Eastside Commons-Building 1',       property:'Eastside Commons',         units:15, stories:2, type:'Apartment',  status:'Outreach Active',heating:'FAF - Forced Air Furnace', cooling:'CA - Central Air', yearBuilt:1984, state:'WI' },
  { id:'BLD-00006', name:'Aspen Court Residences-Building A', property:'Aspen Court Residences',   units:27, stories:3, type:'Apartment',  status:'In Progress',    heating:'Heat Pump - Air to Air',  cooling:'CA - Central Air', yearBuilt:2001, state:'CO' },
  { id:'BLD-00007', name:'Pinehurst Village-Building 1',      property:'Pinehurst Village',        units:24, stories:2, type:'Apartment',  status:'Enrolled',       heating:'FAF - Forced Air Furnace', cooling:'CA - Central Air', yearBuilt:1988, state:'NC' },
  { id:'BLD-00008', name:'Oak Park Apartments-Main',          property:'Oak Park Apartments',      units:55, stories:3, type:'Apartment',  status:'In Progress',    heating:'Boiler - Hydronic',       cooling:'None',             yearBuilt:1972, state:'MI' },
];

export const CONTACTS = [
  { id:'CON-00001', name:'Sarah Jennings',  title:'VP of Asset Management',   org:'CommonBond Communities',      email:'sjennings@commonbond.org',   phone:'(608) 555-0142', role:'Executive Sponsor', status:'Active', primary:true,  state:'WI' },
  { id:'CON-00002', name:'Rachel Moore',    title:'Regional Property Manager', org:'CommonBond Management',       email:'rmoore@commonbond.org',      phone:'(608) 555-0143', role:'Property Manager',  status:'Active', primary:true,  state:'WI' },
  { id:'CON-00003', name:'Tom Alexander',   title:'President',                 org:'Alexander Company',           email:'talexander@alexanderco.com', phone:'(608) 555-7890', role:'Property Owner',    status:'Active', primary:true,  state:'WI' },
  { id:'CON-00004', name:'Ali Conklin',     title:'Director of Development',   org:'Gorman & Company',            email:'aconklin@gormanusa.com',     phone:'(608) 555-4321', role:'Executive Sponsor', status:'Active', primary:false, state:'WI' },
  { id:'CON-00005', name:'Beth Gorman',     title:'Property Manager',          org:'Gorman Property Management',  email:'bgorman@gormanmgmt.com',     phone:'(608) 555-9234', role:'Site Contact',      status:'Active', primary:true,  state:'WI' },
  { id:'CON-00006', name:'Mark Brody',      title:'Asset Manager',             org:'BRT Realty Trust',            email:'mbrody@brtrealty.com',       phone:'(212) 555-0987', role:'Finance Contact',   status:'Active', primary:true,  state:'WI' },
  { id:'CON-00007', name:'Diane Wu',        title:'Executive Director',        org:'Heartland Housing',           email:'dwu@heartlandhousing.org',   phone:'(919) 555-1234', role:'Executive Sponsor', status:'Active', primary:true,  state:'NC' },
  { id:'CON-00008', name:'Abdul Britton',   title:'Site Manager',              org:'CommonBond Management',       email:'abritton@commonbond.org',    phone:'(608) 555-0189', role:'Site Contact',      status:'Active', primary:false, state:'WI' },
  { id:'CON-00009', name:'James Liu',       title:'VP Acquisitions',           org:'Mercy Housing',               email:'jliu@mercyhousing.org',      phone:'(720) 555-8812', role:'Executive Sponsor', status:'Active', primary:true,  state:'CO' },
  { id:'CON-00010', name:'Carol Simmons',   title:'Regional Director',         org:'National Church Residences',  email:'csimmons@ncr.org',           phone:'(616) 555-4490', role:'Executive Sponsor', status:'Active', primary:true,  state:'MI' },
];

export const ENROLLMENTS = [
  { id:'ENR-00001', name:'North Willow Apartments — WI-IRA-MF-HOMES',   property:'North Willow Apartments',  program:'WI-IRA-MF-HOMES', status:'Enrollment — Complete',                   owner:'Marcus Reid',  units:120, subsidy:'Section 8 / HUD', hafAgreement:'Executed',    incomeQual:'Complete',   censusTract:'Verified', dacDesignation:'Yes',     rentRoll:'Received',     enrollDate:'2026-01-15', state:'WI' },
  { id:'ENR-00002', name:'Capitol View Townhomes — WI-IRA-MF-HEAR',      property:'Capitol View Townhomes',   program:'WI-IRA-MF-HEAR',  status:'Enrollment — Income Qualification In Progress', owner:'Priya Nair',  units:48,  subsidy:'LIHTC',           hafAgreement:'Executed',    incomeQual:'In Progress',censusTract:'Verified', dacDesignation:'No',      rentRoll:'Received',     enrollDate:'',           state:'WI' },
  { id:'ENR-00003', name:'River Bluff Senior Living — WI-IRA-MF-HOMES',  property:'River Bluff Senior Living',program:'WI-IRA-MF-HOMES', status:'Enrollment — Complete',                   owner:'Marcus Reid',  units:84,  subsidy:'Section 8 / HUD', hafAgreement:'Executed',    incomeQual:'Complete',   censusTract:'Verified', dacDesignation:'Yes',     rentRoll:'Received',     enrollDate:'2025-11-20', state:'WI' },
  { id:'ENR-00004', name:'Eastside Commons — WI - FOE',                  property:'Eastside Commons',         program:'WI - FOE',        status:'Enrollment — HAF Agreement Pending',          owner:'Lisa Tanaka',  units:60,  subsidy:'NOAH',            hafAgreement:'Pending',     incomeQual:'Not Started',censusTract:'Pending',  dacDesignation:'Unknown', rentRoll:'Not Received', enrollDate:'',           state:'WI' },
  { id:'ENR-00005', name:'Aspen Court Residences — CO - Denver',         property:'Aspen Court Residences',   program:'CO - Denver',     status:'Enrollment — Complete',                   owner:'Priya Nair',   units:108, subsidy:'Section 8 / HUD', hafAgreement:'Executed',    incomeQual:'Complete',   censusTract:'Verified', dacDesignation:'Yes',     rentRoll:'Received',     enrollDate:'2026-02-08', state:'CO' },
  { id:'ENR-00006', name:'Pinehurst Village — WI-IRA-SF-HOMES',          property:'Pinehurst Village',        program:'WI-IRA-SF-HOMES', status:'Enrollment — Complete',                   owner:'Lisa Tanaka',  units:72,  subsidy:'DAC',             hafAgreement:'Executed',    incomeQual:'Complete',   censusTract:'Verified', dacDesignation:'Yes',     rentRoll:'Received',     enrollDate:'2025-12-01', state:'NC' },
  { id:'ENR-00007', name:'Oak Park Apartments — MI-IRA-MF-HOMES',        property:'Oak Park Apartments',      program:'MI-IRA-MF-HOMES', status:'Enrollment — Income Qualification In Progress', owner:'Marcus Reid',  units:55,  subsidy:'NOAH',            hafAgreement:'Executed',    incomeQual:'In Progress',censusTract:'Verified', dacDesignation:'No',      rentRoll:'In Review',    enrollDate:'',           state:'MI' },
  { id:'ENR-00008', name:'Lakewood Terrace — WI-IRA-MF-HOMES',           property:'Lakewood Terrace',         program:'WI-IRA-MF-HOMES', status:'Enrollment — Outreach Active',             owner:'Marcus Reid',  units:96,  subsidy:'LIHTC',           hafAgreement:'Not Started', incomeQual:'Not Started',censusTract:'Pending',  dacDesignation:'Unknown', rentRoll:'Not Received', enrollDate:'',           state:'WI' },
];

// ── QUALIFICATION DATA ───────────────────────────────────────────────────────
export const ASSESSMENTS = [
  { id:'ASMT-00001', name:'ASHRAE L2 — North Willow Apartments',       property:'North Willow Apartments',  type:'ASHRAE Level 2',          assessor:'Priya Nair',   scheduledDate:'2026-01-15', completedDate:'2026-01-22', status:'Assessment Verified',                  modelingTool:'Snug Pro',    state:'WI', buildings:6,  units:120 },
  { id:'ASMT-00002', name:'ASHRAE L2 — Capitol View Townhomes',         property:'Capitol View Townhomes',   type:'ASHRAE Level 2',          assessor:'Priya Nair',   scheduledDate:'2026-02-10', completedDate:'2026-02-18', status:'Assessment Completed — To Be Reviewed', modelingTool:'Snug Pro',    state:'WI', buildings:12, units:48  },
  { id:'ASMT-00003', name:'ASHRAE L2 — River Bluff Senior Living',      property:'River Bluff Senior Living',type:'ASHRAE Level 2',          assessor:'Marcus Reid',  scheduledDate:'2026-02-28', completedDate:'2026-03-08', status:'Assessment Verified',                  modelingTool:'Asset Score', state:'WI', buildings:2,  units:84  },
  { id:'ASMT-00004', name:'ASHRAE L2 — Eastside Commons',               property:'Eastside Commons',         type:'ASHRAE Level 2',          assessor:'Priya Nair',   scheduledDate:'2026-04-18', completedDate:'',           status:'Assessment Scheduled',                 modelingTool:'Snug Pro',    state:'WI', buildings:4,  units:60  },
  { id:'ASMT-00005', name:'ASHRAE L2 — Aspen Court Residences',         property:'Aspen Court Residences',   type:'ASHRAE Level 2',          assessor:'Lisa Tanaka',  scheduledDate:'2026-03-05', completedDate:'2026-03-14', status:'Assessment Verified',                  modelingTool:'Asset Score', state:'CO', buildings:4,  units:108 },
  { id:'ASMT-00006', name:'ASHRAE L2 — Pinehurst Village',              property:'Pinehurst Village',        type:'ASHRAE Level 2',          assessor:'Marcus Reid',  scheduledDate:'2026-01-28', completedDate:'2026-02-04', status:'Assessment Verified',                  modelingTool:'Snug Pro',    state:'NC', buildings:3,  units:72  },
  { id:'ASMT-00007', name:'ASHRAE L2 — Oak Park Apartments',            property:'Oak Park Apartments',      type:'ASHRAE Level 2',          assessor:'Priya Nair',   scheduledDate:'2026-04-22', completedDate:'',           status:'Assessment To Be Scheduled',           modelingTool:'Asset Score', state:'MI', buildings:3,  units:55  },
  { id:'ASMT-00008', name:'Diagnostic — North Willow Bldg A',           property:'North Willow Apartments',  type:'Blower Door Diagnostic',  assessor:'Marcus Reid',  scheduledDate:'2026-01-22', completedDate:'2026-01-22', status:'Assessment Verified',                  modelingTool:'—',           state:'WI', buildings:1,  units:20  },
];

export const IA_DATA = [
  { id:'IA-00001', name:'WI-IRA-HOMES-North Willow Apts-Bldg A-FY2026',       property:'North Willow Apartments',  program:'WI-IRA-MF-HOMES', status:'Incentive Application Approved',                              owner:'Marcus Reid', amount:142000, submittedDate:'2026-02-14', programYear:'2026', units:20, state:'WI' },
  { id:'IA-00002', name:'WI-IRA-HEAR-Capitol View Townhomes-FY2026',            property:'Capitol View Townhomes',   program:'WI-IRA-MF-HEAR',  status:'Incentive Application Corrections Needed',                    owner:'Priya Nair',  amount:89000,  submittedDate:'2026-03-01', programYear:'2026', units:24, state:'WI' },
  { id:'IA-00003', name:'WI-IRA-HOMES-River Bluff Senior Living-Bldg 1-FY2026',property:'River Bluff Senior Living',program:'WI-IRA-MF-HOMES', status:'Incentive Application Submitted — Awaiting Program Response',  owner:'Marcus Reid', amount:210000, submittedDate:'2026-03-22', programYear:'2026', units:42, state:'WI' },
  { id:'IA-00004', name:'WI-FOE-Eastside Commons-Insulation-FY2026',            property:'Eastside Commons',         program:'WI - FOE',        status:'Incentive Application To Be Prepared',                        owner:'Lisa Tanaka', amount:55000,  submittedDate:'',           programYear:'2026', units:60, state:'WI' },
  { id:'IA-00005', name:'CO-Denver-Aspen Court-EFR-FY2026',                     property:'Aspen Court Residences',   program:'CO - Denver',     status:'Incentive Application Pre-Approved',                          owner:'Priya Nair',  amount:320000, submittedDate:'2026-03-10', programYear:'2026', units:108,state:'CO' },
  { id:'IA-00006', name:'NC-IRA-HOMES-Pinehurst Village-FY2026',                property:'Pinehurst Village',        program:'WI-IRA-SF-HOMES', status:'Incentive Application Approved',                              owner:'Lisa Tanaka', amount:175000, submittedDate:'2026-02-28', programYear:'2026', units:72, state:'NC' },
  { id:'IA-00007', name:'WI-IRA-HOMES-North Willow Apts-Bldg B-FY2026',        property:'North Willow Apartments',  program:'WI-IRA-MF-HOMES', status:'Incentive Application To Be Submitted',                        owner:'Marcus Reid', amount:138000, submittedDate:'',           programYear:'2026', units:20, state:'WI' },
  { id:'IA-00008', name:'MI-IRA-HOMES-Oak Park Apartments-FY2026',              property:'Oak Park Apartments',      program:'MI-IRA-MF-HOMES', status:'Incentive Application To Be Verified',                         owner:'Marcus Reid', amount:98000,  submittedDate:'',           programYear:'2026', units:55, state:'MI' },
];

export const EFR_DATA = [
  { id:'EFR-00001', name:'EFR — Aspen Court Residences', property:'Aspen Court Residences', assessor:'Lisa Tanaka', scheduledDate:'2026-02-20', completedDate:'2026-03-02', status:'EFR Verified',              reportType:'Electrification Feasibility', state:'CO', buildings:4, units:108, client:'City of Denver' },
  { id:'EFR-00002', name:'EFR — Eastside Commons',       property:'Eastside Commons',        assessor:'Priya Nair',  scheduledDate:'2026-04-25', completedDate:'',           status:'EFR To Be Scheduled',       reportType:'Electrification Feasibility', state:'WI', buildings:4, units:60,  client:'WI DOA'       },
  { id:'EFR-00003', name:'EFR — Oak Park Apartments',    property:'Oak Park Apartments',     assessor:'Lisa Tanaka', scheduledDate:'2026-04-28', completedDate:'',           status:'EFR In Progress',           reportType:'ASHRAE Level 2 + EFR Combo', state:'MI', buildings:3, units:55,  client:'MI EGLE'      },
];

// ── FIELD DATA ───────────────────────────────────────────────────────────────
export const PROJECTS = [
  { id:'PROJ-00001', name:'North Willow — Phase 1 Heat Pump Install', property:'North Willow Apartments',  program:'WI-IRA-MF-HOMES', status:'Project In Progress',      owner:'Marcus Reid',  pm:'Sarah Jennings', startDate:'2026-04-08', endDate:'2026-04-25', workOrders:6, state:'WI', units:20  },
  { id:'PROJ-00002', name:'Capitol View — HEAR Weatherization',        property:'Capitol View Townhomes',   program:'WI-IRA-MF-HEAR',  status:'Project To Be Scheduled', owner:'Priya Nair',   pm:'Rachel Moore',   startDate:'',           endDate:'',           workOrders:4, state:'WI', units:24  },
  { id:'PROJ-00003', name:'River Bluff — Boiler Replacement',          property:'River Bluff Senior Living',program:'WI-IRA-MF-HOMES', status:'Project Scheduled',        owner:'Marcus Reid',  pm:'Sarah Jennings', startDate:'2026-04-15', endDate:'2026-04-22', workOrders:3, state:'WI', units:42  },
  { id:'PROJ-00004', name:'Aspen Court — Electrification Package',     property:'Aspen Court Residences',   program:'CO - Denver',     status:'Project In Progress',      owner:'Priya Nair',   pm:'Lisa Tanaka',    startDate:'2026-04-10', endDate:'2026-04-30', workOrders:5, state:'CO', units:108 },
  { id:'PROJ-00005', name:'Pinehurst Village — HOMES Phase 1',         property:'Pinehurst Village',        program:'WI-IRA-SF-HOMES', status:'Project To Be Scheduled', owner:'Lisa Tanaka',  pm:'Rachel Moore',   startDate:'',           endDate:'',           workOrders:3, state:'NC', units:72  },
  { id:'PROJ-00006', name:'North Willow — Phase 2 Air Sealing',        property:'North Willow Apartments',  program:'WI-IRA-MF-HOMES', status:'Project To Be Scheduled', owner:'Marcus Reid',  pm:'Sarah Jennings', startDate:'',           endDate:'',           workOrders:4, state:'WI', units:20  },
];

export const WORK_ORDERS = [
  { id:'WO-00141', name:'Heat Pump Install — Unit 101',      project:'PROJ-00001', property:'North Willow Apartments',  building:'Building A', workType:'HP - Air to Air Install',   status:'Work Order Complete',            teamLead:'J. Martinez', scheduledDate:'2026-04-08', duration:'4h', state:'WI' },
  { id:'WO-00142', name:'Heat Pump Install — Unit 102',      project:'PROJ-00001', property:'North Willow Apartments',  building:'Building A', workType:'HP - Air to Air Install',   status:'Work Order To Be Verified',      teamLead:'J. Martinez', scheduledDate:'2026-04-10', duration:'4h', state:'WI' },
  { id:'WO-00143', name:'Heat Pump Install — Unit 103',      project:'PROJ-00001', property:'North Willow Apartments',  building:'Building A', workType:'HP - Air to Air Install',   status:'Work Order In Progress',         teamLead:'J. Martinez', scheduledDate:'2026-04-12', duration:'4h', state:'WI' },
  { id:'WO-00144', name:'Air Sealing — Building B',          project:'PROJ-00001', property:'North Willow Apartments',  building:'Building B', workType:'Air Sealing - Multifamily', status:'Work Order Scheduled',           teamLead:'K. Chen',     scheduledDate:'2026-04-14', duration:'6h', state:'WI' },
  { id:'WO-00145', name:'Attic Insulation — Building A',     project:'PROJ-00001', property:'North Willow Apartments',  building:'Building A', workType:'Insulation - Attic',        status:'Work Order To Be Scheduled',     teamLead:'',            scheduledDate:'',           duration:'5h', state:'WI' },
  { id:'WO-00146', name:'Boiler Replacement — Main Mech',    project:'PROJ-00003', property:'River Bluff Senior Living', building:'Main',       workType:'Boiler Replacement',        status:'Work Order Scheduled',           teamLead:'J. Martinez', scheduledDate:'2026-04-15', duration:'8h', state:'WI' },
  { id:'WO-00147', name:'PTAC Install — Unit 101',           project:'PROJ-00004', property:'Aspen Court Residences',   building:'Building A', workType:'PTAC Install',              status:'Work Order In Progress',         teamLead:'K. Chen',     scheduledDate:'2026-04-12', duration:'3h', state:'CO' },
  { id:'WO-00148', name:'PTAC Install — Unit 102',           project:'PROJ-00004', property:'Aspen Court Residences',   building:'Building A', workType:'PTAC Install',              status:'Work Order Scheduled',           teamLead:'K. Chen',     scheduledDate:'2026-04-13', duration:'3h', state:'CO' },
  { id:'WO-00149', name:'Weatherization — Block 1',          project:'PROJ-00002', property:'Capitol View Townhomes',   building:'Block 1',    workType:'Air Sealing - Multifamily', status:'Work Order To Be Scheduled',     teamLead:'',            scheduledDate:'',           duration:'6h', state:'WI' },
  { id:'WO-00150', name:'Blower Door Test — Building A',     project:'PROJ-00001', property:'North Willow Apartments',  building:'Building A', workType:'Blower Door Diagnostic',    status:'Work Order Corrections Needed',  teamLead:'J. Martinez', scheduledDate:'2026-04-12', duration:'2h', state:'WI' },
  { id:'WO-00151', name:'Shop Kit — Heat Pump Units (x4)',   project:'PROJ-00001', property:'Madison Shop',             building:'Shop',       workType:'Shop Kit - Equipment',      status:'Work Order Complete',            teamLead:'D. Okonkwo',  scheduledDate:'2026-04-08', duration:'2h', state:'WI' },
  { id:'WO-00152', name:'Drive to Site — Martinez Crew',     project:'PROJ-00001', property:'North Willow Apartments',  building:'—',          workType:'Travel - Drive to Site',    status:'Work Order In Progress',         teamLead:'J. Martinez', scheduledDate:'2026-04-12', duration:'1h', state:'WI' },
];

export const PROJECT_PAYMENT_REQUESTS = [
  { id:'PR-00001', name:'WI-IRA-HOMES-North Willow-Bldg A-FY2026',  project:'PROJ-00001', property:'North Willow Apartments',  program:'WI-IRA-MF-HOMES', status:'Payment Request Approved',                   owner:'Marcus Reid', amount:142000, submittedDate:'2026-04-01', paymentBody:'DOE-HOMES',      daysOpen:11, state:'WI' },
  { id:'PR-00002', name:'WI-IRA-HEAR-Capitol View-FY2026',            project:'PROJ-00002', property:'Capitol View Townhomes',   program:'WI-IRA-MF-HEAR',  status:'Payment Request To Be Prepared',             owner:'Priya Nair',  amount:89000,  submittedDate:'',           paymentBody:'DOE-HEAR',       daysOpen:3,  state:'WI' },
  { id:'PR-00003', name:'WI-IRA-HOMES-River Bluff-Bldg 1-FY2026',   project:'PROJ-00003', property:'River Bluff Senior Living',program:'WI-IRA-MF-HOMES', status:'Payment Request Submitted — Awaiting Review', owner:'Marcus Reid', amount:210000, submittedDate:'2026-03-28', paymentBody:'DOE-HOMES',      daysOpen:15, state:'WI' },
  { id:'PR-00004', name:'CO-Denver-Aspen Court-EFR-FY2026',          project:'PROJ-00004', property:'Aspen Court Residences',   program:'CO - Denver',     status:'Payment Request Payment Pending',             owner:'Priya Nair',  amount:320000, submittedDate:'2026-03-10', paymentBody:'Denver OEE',     daysOpen:33, state:'CO' },
  { id:'PR-00005', name:'NC-IRA-HOMES-Pinehurst Village-FY2026',     project:'PROJ-00005', property:'Pinehurst Village',        program:'WI-IRA-SF-HOMES', status:'Payment Request Payment Received',            owner:'Lisa Tanaka', amount:175000, submittedDate:'2026-02-15', paymentBody:'DOE-HOMES',      daysOpen:55, state:'NC' },
  { id:'PR-00006', name:'WI-FOE-Eastside Commons-Insulation-FY2026', project:'PROJ-00002', property:'Eastside Commons',         program:'WI - FOE',        status:'Payment Request To Be Verified',              owner:'Lisa Tanaka', amount:55000,  submittedDate:'',           paymentBody:'Focus on Energy', daysOpen:2,  state:'WI' },
  { id:'PR-00007', name:'WI-IRA-HOMES-North Willow-Bldg B-FY2026',  project:'PROJ-00001', property:'North Willow Apartments',  program:'WI-IRA-MF-HOMES', status:'Payment Request To Be Submitted',             owner:'Marcus Reid', amount:138000, submittedDate:'',           paymentBody:'DOE-HOMES',      daysOpen:1,  state:'WI' },
  { id:'PR-00008', name:'MI-IRA-HOMES-Oak Park-FY2026',              project:'PROJ-00006', property:'Oak Park Apartments',      program:'MI-IRA-MF-HOMES', status:'Payment Request Under Review',                owner:'Marcus Reid', amount:98000,  submittedDate:'2026-03-20', paymentBody:'DOE-HOMES',      daysOpen:23, state:'MI' },
];

export const PAYMENT_RECEIPTS = [
  { id:'PMT-00001', name:'NC-IRA-HOMES-Pinehurst Village-FY2026', property:'Pinehurst Village',        program:'WI-IRA-SF-HOMES', paymentBody:'DOE-HOMES',     amount:175000, receivedDate:'2026-04-02', paymentRef:'DOE-2026-NC-0441', state:'NC', checkNumber:'CHK-90021' },
  { id:'PMT-00002', name:'WI-IRA-HOMES-North Willow-FY2025',      property:'North Willow Apartments',  program:'WI-IRA-MF-HOMES', paymentBody:'DOE-HOMES',     amount:128000, receivedDate:'2026-01-15', paymentRef:'DOE-2025-WI-0382', state:'WI', checkNumber:'CHK-88741' },
  { id:'PMT-00003', name:'WI-FOE-River Bluff-FY2025',             property:'River Bluff Senior Living',program:'WI - FOE',        paymentBody:'Focus on Energy',amount:44000,  receivedDate:'2026-02-28', paymentRef:'FOE-2025-0219',    state:'WI', checkNumber:'ACH-220198' },
];

// ── SCHEDULE DATA ────────────────────────────────────────────────────────────
export const SCHEDULE_CREWS = [
  {
    id:'crew-1', name:'Martinez Crew', teamLead:'J. Martinez',
    members:['J. Martinez','A. Williams','T. Kim'], vehicle:'Box Truck 04',
    initials:'JM', color:'#3ecf8e',
    jobs:[
      { name:'Drive to Site',            property:'North Willow Apartments', workType:'Travel',              start:7.0,  duration:1.0, status:'Work Order In Progress',        color:'#8fa0b8' },
      { name:'HP Install — Unit 103',    property:'North Willow Apartments', workType:'HP Install',          start:8.0,  duration:4.0, status:'Work Order In Progress',        color:'#7eb3e8' },
      { name:'Blower Door Test — Bldg A',property:'North Willow Apartments', workType:'Blower Door',         start:13.0, duration:2.0, status:'Work Order Corrections Needed', color:'#e85c5c' },
    ]
  },
  {
    id:'crew-2', name:'Chen Crew', teamLead:'K. Chen',
    members:['K. Chen','M. Reyes','S. Park'], vehicle:'Box Truck 07',
    initials:'KC', color:'#7eb3e8',
    jobs:[
      { name:'Drive to Site',            property:'Aspen Court Residences',  workType:'Travel',              start:7.0,  duration:1.0, status:'Work Order In Progress',  color:'#8fa0b8' },
      { name:'PTAC Install — Unit 101',  property:'Aspen Court Residences',  workType:'PTAC Install',        start:8.0,  duration:3.0, status:'Work Order In Progress',  color:'#7eb3e8' },
      { name:'PTAC Install — Unit 102',  property:'Aspen Court Residences',  workType:'PTAC Install',        start:11.5, duration:3.0, status:'Work Order Scheduled',    color:'#e8a949' },
    ]
  },
  {
    id:'crew-3', name:'Williams Crew', teamLead:'A. Williams',
    members:['A. Williams','D. Okonkwo','P. Torres'], vehicle:'Box Truck 02',
    initials:'AW', color:'#a78bfa', jobs:[]
  },
];
