// THE MAPPING — the one file we fill in once `npm run inspect` reveals the real
// selectors on the WI HEAR reservation pages.
//
// A reservation is a sequence of PAGES. Each page has:
//   name       - label for logs/screenshots
//   fields[]   - { selector, type, value }  (value can be a fn of the CSV row)
//   next       - selector for the button that advances to the next page
//   waitFor    - (optional) selector that must appear before we consider the
//                next page loaded
//
// field types: text | number | email | tel | select | checkbox | radio | typeahead
//
// `row` is one record from data/projects.csv (column headers -> keys).
//
// ▶ Everything below is a PLACEHOLDER modeled on the fields we CAN see (the signup
//   page) so the runner is exercisable end-to-end. Replace selectors/pages with the
//   real ones from field-report.json.

export const flow = {
  // Where each reservation begins (overrides settings.reservationStartUrl if set).
  startUrl: null,

  pages: [
    {
      name: 'Personal Information',
      fields: [
        { selector: '[name="firstname"]',       type: 'text',      value: (r) => r.owner_first_name },
        { selector: '[name="lastname"]',        type: 'text',      value: (r) => r.owner_last_name },
        { selector: '[name="email"]',           type: 'email',     value: (r) => r.owner_email },
        { selector: '[name="phone"]',           type: 'tel',       value: (r) => r.owner_phone },
        // Address is a Places-style typeahead — must type + pick from the dropdown.
        { selector: '[name="address"]',         type: 'typeahead', value: (r) => r.install_address,
          options: { matchText: null } },
        { selector: '[name="unit"]',            type: 'text',      value: (r) => r.unit_number },
        { selector: '[name="city"]',            type: 'text',      value: (r) => r.city },
        { selector: '[name="state"]',           type: 'select',    value: (r) => r.state },
        { selector: '[name="zip"]',             type: 'text',      value: (r) => r.zip },
      ],
      next: 'button:has-text("Continue"), button:has-text("Next")',
      waitFor: null,
    },
    // Add subsequent pages here (measures, equipment, income qualification, review…)
    // once captured. Each is the same shape.
  ],

  // The final submit on the last page (leave separate so dry-run can skip it).
  submit: 'button:has-text("Submit"), button:has-text("Accept & Continue")',

  // A selector that only appears on the SUCCESS/confirmation page — the runner
  // waits for this to confirm the reservation actually went through.
  successMarker: null, // e.g. 'text=Reservation submitted'
};
