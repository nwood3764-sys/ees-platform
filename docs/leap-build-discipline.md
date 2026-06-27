# LEAP — Build Discipline: No Workarounds, No Reuse Across Purposes

*(LEAP is the platform. Energy Efficiency Services / EES-WI is the company.)*

This file is the standing rule for how anything gets built in LEAP. It exists
because the same failure keeps recurring: solving a request by borrowing,
bending, or repurposing something that already exists for a *different*
purpose. That is a workaround. Workarounds are prohibited. Build the right
thing, for the specific purpose, the correct way.

---

## The core rule

**Every artifact is built for one purpose and named for that purpose.**

When a request calls for a report, a dashboard, a widget, an object, a view, a
column, a function, a layout — you create a *new* one that exists specifically
for that request. You do not reach for an existing artifact that happens to be
"close enough." Close enough is a workaround.

If the request is "build the Outreach Status Report dashboard," then:

- The **report** is named exactly for its purpose: **Outreach Status Report**.
- The **dashboard** is its own dashboard record (it may be named "Outreach
  Dashboard" or similar, but it is a distinct, new dashboard built for this).
- The **widgets** are authored on that dashboard, each backed by that report
  (or by additional purpose-built reports created for this dashboard), exactly
  the way Salesforce dashboards are backed by Salesforce reports.

Nothing is borrowed from another object, another report, another dashboard, or
anything previously created for a different purpose.

---

## What counts as a prohibited workaround

All of the following are workarounds and are not allowed:

1. **Reusing an existing report/dashboard/object built for a different
   purpose** because it is structurally similar. Similar is not the same.
   Author a new one for the current purpose.

2. **Switching an artifact's primary object, scope, or definition to dodge a
   harder-but-correct implementation.** If the correct report for "by county"
   groups opportunities through a related field, build that. Do not silently
   re-base it onto a different object because the direct-column path is easier.
   The right answer is defined by the purpose, not by what is convenient to
   author.

3. **Avoiding a code path because it is untested.** If the correct build
   requires a capability that exists but has never been exercised (e.g. a
   related-field grouping), the answer is to build it correctly and prove it
   works — not to route around it with an easier construction that changes what
   the artifact means.

4. **Lumping unrelated concerns together** to save an artifact. One report does
   one thing. One widget shows one rollup. Do not fold "by county" and "by
   organization" into one report because they share a primary object.

5. **Tidying / deleting adjacent things** as part of an unrelated task. If
   duplicate or stray records exist, that is a separate, explicitly-raised
   decision — never folded into the current build as cleanup.

6. **Band-aids** — patching a symptom instead of building the correct
   structure. If something is missing, build the missing thing properly.

---

## What "build it the right way" requires

- **Purpose-specific naming.** The artifact's name states what it is for. An
  Outreach Status Report is named "Outreach Status Report," not reused from
  "Opportunities by Stage."

- **Own definition.** New report = new `reports` row with its own
  `rpt_primary_object`, its own `rpt_selected_fields`, its own
  `report_groupings`, its own `report_filters`, its own chart config. New
  dashboard = new `dashboards` row. New widgets = new `dashboard_widgets` rows
  backed by the purpose-built report(s).

- **Salesforce model, faithfully.** Report defines the data + groupings +
  measures. Dashboard is a grid of widgets. Each widget renders one report's
  rollup. Same mental model, same structure, no shortcuts. If Salesforce would
  make a dedicated report for this dashboard, so do we.

- **Correct, not convenient.** When the convenient construction and the correct
  construction diverge, build the correct one. If that surfaces a gap (an
  untested engine path, a missing column), close the gap properly and verify it
  — that is the work, not an obstacle to route around.

- **Additive.** New objects/tables/reports/dashboards never break or repurpose
  existing ones. They stand on their own.

---

## The check before building anything

Before authoring, answer these. If any answer is "I'm reusing / bending
something that already exists for another purpose," stop and build new instead.

1. Is there a new, purpose-named artifact for exactly this request?
2. Does it have its own definition, not inherited from something built for a
   different purpose?
3. Am I changing its primary object/scope only because the correct path is
   harder? (If yes — build the correct path.)
4. Am I folding two distinct purposes into one artifact to save effort?
5. Am I deleting or modifying unrelated existing artifacts as part of this task?

A clean build answers: yes / yes / no / no / no.

---

## Naming, restated

- The platform is **LEAP**. The company is **Energy Efficiency Services**
  (EES / EES-WI). The word "Anura" is never used — see the naming standard file.
- Report names state their purpose explicitly and unambiguously, same standard
  as status names: descriptive, no abbreviations, no borrowing a name from an
  artifact built for something else.

---

## Why this exists

Workarounds accumulate as hidden coupling and redundant-but-not-quite-right
artifacts. Two reports that look alike but were built for different purposes
drift, and a change to one silently breaks a dashboard depending on the other.
The cost of building the right thing once is always lower than the cost of
untangling a borrowed thing later. Build for the purpose. Name for the purpose.
No workarounds.
