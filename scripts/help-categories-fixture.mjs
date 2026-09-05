// Fixture — the help index has one heading per subject, on every surface.
//
// Nicholas, 2026-09-03: "Make sure you have the help index so users understand
// this and can search and learn how to use this."
//
// The help centre grouped articles by the RAW ha_category string while LEAP
// Pad's knowledge base normalised the casing. So `communications` (one
// article) and `Communications` (twenty) were one heading on a phone and two
// on a desktop — and a reader who opened Communications on the desktop saw
// twenty of the twenty-one articles, with no hint the twenty-first existed.
//
// The stored categories were merged in the same change; this pins the rule
// that stops the next stray splitting a heading again, and pins that the two
// surfaces answer identically.
//
// Run with:  node scripts/help-categories-fixture.mjs

import {
  normalizeHelpCategory,
  groupHelpArticlesByCategory,
  UNCATEGORISED_HELP_HEADING,
} from '../src/lib/helpCategories.js'

let checks = 0, failures = 0
const eq = (label, actual, expected) => {
  checks += 1
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) return
  failures += 1
  console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`)
}

// ─── The case that split the index ───────────────────────────────────────────

eq('a lowercase category is the same heading as its capitalised twin',
  normalizeHelpCategory('communications'), normalizeHelpCategory('Communications'))
eq('and reads capitalised', normalizeHelpCategory('communications'), 'Communications')
eq('admin and Admin are one heading',
  normalizeHelpCategory('admin'), normalizeHelpCategory('Admin'))

// Capitals inside a category are the author's, not ours to flatten.
eq('an acronym keeps its capitals', normalizeHelpCategory('AI Assistant'), 'AI Assistant')
eq('an ampersand heading is left alone',
  normalizeHelpCategory('Reports & Dashboards'), 'Reports & Dashboards')
eq('a multi-word heading keeps its own capitals',
  normalizeHelpCategory('Field Service'), 'Field Service')

// Blank is a heading too, and the same one on both surfaces — LEAP Pad used to
// call it "General" and the help centre "Other".
eq('a blank category has one name', normalizeHelpCategory(''), UNCATEGORISED_HELP_HEADING)
eq('null is the same', normalizeHelpCategory(null), UNCATEGORISED_HELP_HEADING)
eq('undefined is the same', normalizeHelpCategory(undefined), UNCATEGORISED_HELP_HEADING)
eq('whitespace is the same', normalizeHelpCategory('   '), UNCATEGORISED_HELP_HEADING)
eq('surrounding space never makes a second heading',
  normalizeHelpCategory('  Records '), 'Records')

// ─── Grouping, as the table of contents draws it ─────────────────────────────

const ARTICLES = [
  { ha_title: 'Logging an email from Outlook to a LEAP record', ha_category: 'Communications' },
  { ha_title: 'Communications card — which records carry it',   ha_category: 'communications' },
  { ha_title: 'Communications on enrollments and incentives',   ha_category: 'Communications' },
  { ha_title: 'What Each Role Can Do by Default',               ha_category: 'Permissions' },
  { ha_title: 'An article nobody filed',                        ha_category: null },
]

const grouped = groupHelpArticlesByCategory(ARTICLES)
eq('the index lists each heading once',
  grouped.map(([heading]) => heading), ['Communications', 'Other', 'Permissions'])
eq('the three Communications articles are under one heading',
  grouped.find(([h]) => h === 'Communications')[1].length, 3)
eq('articles are alphabetical within a heading',
  grouped.find(([h]) => h === 'Communications')[1].map(a => a.ha_title),
  [
    'Communications card — which records carry it',
    'Communications on enrollments and incentives',
    'Logging an email from Outlook to a LEAP record',
  ])

eq('an empty library groups to nothing', groupHelpArticlesByCategory([]), [])
eq('a missing library groups to nothing', groupHelpArticlesByCategory(null), [])

// CONTROL — the defect itself. Grouping by the raw string, which is what the
// help centre did, must produce the split heading this rule prevents.
const rawHeadings = [...new Set(ARTICLES.map(a => a.ha_category || 'Other'))].sort()
eq('grouping by the raw category still splits Communications in two',
  rawHeadings.filter(h => h.toLowerCase() === 'communications').length, 2)

console.log(failures === 0
  ? `help-categories fixture: ${checks} checks passed`
  : `help-categories fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
