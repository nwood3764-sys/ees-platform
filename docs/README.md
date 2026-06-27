# Anura Project Instructions — Split Files

## What this is

Your original `ANURA — PROJECT INSTRUCTIONS` document was roughly 8,000 tokens and was being reprocessed on every message in your Anura project. This split turns it into:

1. **One lean instructions file** (~2,000 tokens) — behavioral guidance only, reprocessed every turn
2. **16 reference files** — loaded via RAG only when the topic comes up

Estimated context savings per turn: **~6,000 tokens**. Over a long coding session, this is the difference between hitting the length wall mid-debug and finishing the task.

---

## How to install

### 1. Replace your project instructions

Open your Anura Claude Project → **Instructions** → paste the contents of `ANURA-PROJECT-INSTRUCTIONS.md`.

This replaces the long version entirely.

### 2. Upload the rest as project knowledge files

In the same project, go to **Project knowledge** and upload all 16 of these files:

- `anura-property-hierarchy.md`
- `anura-roles-and-field-structure.md`
- `anura-programs.md`
- `anura-project-lifecycle.md`
- `anura-status-lifecycles.md`
- `anura-work-types.md`
- `anura-fleet.md`
- `anura-communications.md`
- `anura-admin-builders.md`
- `anura-portals.md`
- `anura-field-mobile.md`
- `anura-reports.md`
- `anura-data-standards.md`
- `anura-ai-spec.md`
- `anura-modules-and-build-order.md`
- `anura-schema-session.md`

---

## How this works day-to-day

The lean instructions file contains everything Claude needs every single turn: the business context, the core philosophy, the tech stack, the design system, the financial visibility tiers, and the standing rules for build sessions.

Everything else — program portfolios, status lifecycles, portal specs, mobile specs, the AI spec, etc. — sits in project knowledge. RAG pulls the relevant file(s) when a topic comes up. When you say "let's build the partner portal," Claude retrieves `anura-portals.md`. When you're defining a new status lifecycle, it retrieves `anura-status-lifecycles.md`. The rest stays out of context.

### If RAG misses

Occasionally the retrieval won't pull a file you expected. Two fixes:

1. **Name it explicitly.** "Reference the portal spec" or "check anura-portals.md" is enough.
2. **Paste the section in chat** for that one turn if it's critical.

This happens rarely in my experience — the file names are descriptive enough that RAG usually finds them.

### When you update a spec

Edit the specific file and re-upload it to project knowledge. You're only ever touching one topic at a time instead of scrolling through an 8,000-token megadoc.

---

## The reference file index (also in the instructions file itself)

| Topic | Knowledge file |
|---|---|
| Property hierarchy | anura-property-hierarchy.md |
| Roles, field operations, asset accountability | anura-roles-and-field-structure.md |
| Program portfolio (all five states) | anura-programs.md |
| 12-stage project lifecycle | anura-project-lifecycle.md |
| Status lifecycles per object | anura-status-lifecycles.md |
| Work types, work plans, materials & equipment | anura-work-types.md |
| Vehicles and fleet | anura-fleet.md |
| Communications and templates | anura-communications.md |
| Anura Admin Builders | anura-admin-builders.md |
| Portals (property owner and partner) | anura-portals.md |
| Anura Field Mobile | anura-field-mobile.md |
| Reports and dashboards | anura-reports.md |
| Data standards, validation, retention | anura-data-standards.md |
| Anura AI assistant | anura-ai-spec.md |
| Module list and build order | anura-modules-and-build-order.md |
| Schema session instructions | anura-schema-session.md |
