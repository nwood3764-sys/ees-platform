# LEAP Project Instructions — Split Files

## What this is

The original `LEAP — PROJECT INSTRUCTIONS` document was roughly 8,000 tokens and was being reprocessed on every message. This split turns it into:

1. **One lean instructions file** (~2,000 tokens) — behavioral guidance only, reprocessed every turn
2. **Reference files** — loaded only when the topic comes up

Estimated context savings per turn: **~6,000 tokens**. Over a long coding session, this is the difference between hitting the length wall mid-debug and finishing the task.

---

## How it's wired in this repo

The lean standing instructions live at the repo root as `CLAUDE.md`. Claude Code reads it automatically at the start of every session. The reference files live here in `/docs/` and are pulled in on demand when a task touches the relevant topic — either because the model retrieves them or because you name one explicitly.

### The reference files

- `leap-property-hierarchy.md`
- `leap-roles-and-field-structure.md`
- `leap-programs.md`
- `leap-project-lifecycle.md`
- `leap-status-lifecycles.md`
- `leap-work-types.md`
- `leap-fleet.md`
- `leap-communications.md`
- `leap-admin-builders.md`
- `leap-portals.md`
- `leap-field-mobile.md`
- `leap-reports.md`
- `leap-data-standards.md`
- `leap-ai-spec.md`
- `leap-modules-and-build-order.md`
- `leap-schema-session.md`

---

## How this works day-to-day

The standing instructions file (`CLAUDE.md`) contains everything needed every single turn: the business context, the core philosophy, the tech stack, the design system, the financial visibility tiers, and the standing rules for build sessions.

Everything else — program portfolios, status lifecycles, portal specs, mobile specs, the AI spec, etc. — sits in `/docs/`. The relevant file(s) get pulled when a topic comes up. When you say "let's build the partner portal," the partner portal spec `leap-portals.md` is the reference. When you're defining a new status lifecycle, it's `leap-status-lifecycles.md`. The rest stays out of context.

### If a file isn't pulled automatically

Occasionally the relevant file won't be loaded when you expected it. Two fixes:

1. **Name it explicitly.** "Reference the portal spec" or "check `leap-portals.md`" is enough.
2. **Paste the section in chat** for that one turn if it's critical.

This happens rarely — the file names are descriptive enough that the right one is usually found.

### When you update a spec

Edit the specific file. You're only ever touching one topic at a time instead of scrolling through an 8,000-token megadoc.

---

## The reference file index (also in the instructions file itself)

| Topic | Knowledge file |
|---|---|
| Property hierarchy | leap-property-hierarchy.md |
| Roles, field operations, asset accountability | leap-roles-and-field-structure.md |
| Program portfolio (all five states) | leap-programs.md |
| 12-stage project lifecycle | leap-project-lifecycle.md |
| Status lifecycles per object | leap-status-lifecycles.md |
| Work types, work plans, materials & equipment | leap-work-types.md |
| Vehicles and fleet | leap-fleet.md |
| Communications and templates | leap-communications.md |
| LEAP Admin Builders | leap-admin-builders.md |
| Portals (property owner and partner) | leap-portals.md |
| LEAP Field Mobile | leap-field-mobile.md |
| Reports and dashboards | leap-reports.md |
| Data standards, validation, retention | leap-data-standards.md |
| LEAP AI assistant | leap-ai-spec.md |
| Module list and build order | leap-modules-and-build-order.md |
| Schema session instructions | leap-schema-session.md |
