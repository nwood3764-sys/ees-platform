// Related-list naming — pure-logic fixture.
//
// The defect this pins: an Account page carried TWO related lists both titled
// "Properties" — one listing the properties the account is the Property
// Account of, the other the properties it is the Property Management Company
// of. The title was auto-filled from the target TABLE alone, so every object
// that reaches its parent through more than one foreign key produced the same
// heading twice and named neither relationship.
//
// The rule: name the object when it is related one way; name the object AND
// the relationship when it is related more than once — with the lookup
// field's own label, never a paraphrase of it.

import {
  relatedListTitle,
  relationshipLabelFromFk,
} from '../src/lib/relatedListNaming.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures += 1
    console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

// ── The case that shipped wrong: accounts → properties, twice ──────────────
check('property owner list names the relationship',
  relatedListTitle('properties', 'property_account_id', { fkCount: 2 }),
  'Properties (Property Account)')
check('property management list says property management company',
  relatedListTitle('properties', 'property_management_company_id', { fkCount: 2 }),
  'Properties (Property Management Company)')
check('the two titles differ',
  relatedListTitle('properties', 'property_account_id', { fkCount: 2 })
    !== relatedListTitle('properties', 'property_management_company_id', { fkCount: 2 }),
  true)

// Same object, same defect: accounts → owner_research_requests, twice.
check('owner research requests by account',
  relatedListTitle('owner_research_requests', 'orq_account_id', { fkCount: 2 }),
  'Owner Research Requests (Account)')
check('owner research requests by approved account',
  relatedListTitle('owner_research_requests', 'orq_approved_account_id', { fkCount: 2 }),
  'Owner Research Requests (Approved Account)')

// ── One relationship: the object's name IS the name ────────────────────────
check('single-FK list stays the object name',
  relatedListTitle('contacts', 'contact_account_id', { fkCount: 1 }), 'Contacts')
check('single-FK list, count omitted',
  relatedListTitle('opportunities', 'opportunity_account_id'), 'Opportunities')
check('ambiguous flag instead of a count',
  relatedListTitle('properties', 'property_management_company_id', { ambiguous: true }),
  'Properties (Property Management Company)')
check('fkCount wins over the flag',
  relatedListTitle('properties', 'property_management_company_id', { ambiguous: true, fkCount: 1 }),
  'Properties')

// ── LEAP acronyms survive; the object label is the platform's own ──────────
check('acronym object label', relatedListTitle('efr_reports', 'efr_property_id', { fkCount: 1 }), 'EFR Reports')
check('gps points', relatedListTitle('gps_points', 'gps_work_order_id', { fkCount: 1 }), 'GPS Points')

// ── The relationship label matches the field's own label ───────────────────
// A leading segment that is the object's own name is part of the field's
// name and is KEPT — properties.property_management_company_id is labeled
// "Property Management Company" on the property page, not "Management
// Company", and the related list must agree with it.
check('object-word prefix kept',
  relationshipLabelFromFk('properties', 'property_management_company_id'),
  'Property Management Company')
check('object-word prefix kept (account)',
  relationshipLabelFromFk('properties', 'property_account_id'), 'Property Account')

// A short abbreviation of the table name is column plumbing and is dropped.
check('orq_ dropped', relationshipLabelFromFk('owner_research_requests', 'orq_approved_account_id'), 'Approved Account')
check('spa_ dropped', relationshipLabelFromFk('service_provider_applications', 'spa_account_id'), 'Account')
check('wo_ dropped', relationshipLabelFromFk('work_orders', 'wo_project_id'), 'Project')
check('ia_ dropped', relationshipLabelFromFk('incentive_applications', 'ia_opportunity_id'), 'Opportunity')

// A real modifier word is NOT a prefix, however short the table name is —
// this is what keeps "Parent Account" from collapsing to "Account".
check('parent_ is a word, not a prefix',
  relationshipLabelFromFk('accounts', 'parent_account_id'), 'Parent Account')
check('primary_ is a word, not a prefix',
  relationshipLabelFromFk('contacts', 'primary_account_id'), 'Primary Account')
check('a bare FK keeps its whole name',
  relationshipLabelFromFk('units', 'building_id'), 'Building')

// ── Degenerate input never produces a broken title ─────────────────────────
check('missing fk falls back to the object name',
  relatedListTitle('properties', '', { fkCount: 2 }), 'Properties')
check('null fk falls back to the object name',
  relatedListTitle('properties', null, { fkCount: 2 }), 'Properties')
check('relationship equal to the object is not repeated',
  relatedListTitle('units', 'unit_id', { fkCount: 2 }), 'Units')
check('empty table name', relatedListTitle('', 'property_account_id', { fkCount: 2 }), '')
check('label of an empty column', relationshipLabelFromFk('properties', ''), '')
check('bare id column', relationshipLabelFromFk('properties', 'id'), 'Id')

if (failures > 0) {
  console.error(`\nrelated-list-naming-fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`related-list-naming-fixture: ${checks} checks passed`)
