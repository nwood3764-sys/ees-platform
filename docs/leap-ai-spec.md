# LEAP — AI Assistant Spec

LEAP AI is the intelligent assistant layer built into every module of LEAP. It is powered by the Claude API connected to the LEAP database via Supabase MCP. It is not a bolt-on chatbot — it is a native assistant that understands the full LEAP data model, the business context, and can take real actions on behalf of the logged-in user.

LEAP AI lives as a persistent panel or assistant icon available on every screen in every module.

---

## What LEAP AI Can Do

**Record creation via conversation:**
User: "Create a work order for North Willow, assign it to Martinez, heat pump install in Building B"
LEAP AI creates the work order, assigns the technician, sets the work type, and asks for confirmation before saving.

**On-demand reporting:**
User: "Show me all incentive applications submitted in Wisconsin this month still awaiting a response"
LEAP AI queries the database, displays results inline, and offers to email it or save it as a named report.

**Workflow guidance:**
User: "What do I need to do to close out the North Willow project?"
LEAP AI checks the project record, lists outstanding tasks, flags overdue items, and shows the next required steps in sequence.

**Status updates:**
User: "Mark work order WO-2841 as verified"
LEAP AI checks that all verification requirements are met, confirms the action with the user, then updates the status and logs it as an activity.

**Field data entry from conversation:**
User: "I just got off the phone with Britton — he confirmed March 28 and said Abdul will be the site contact"
LEAP AI logs the call as an activity, updates the contact role for Abdul, and confirms what it recorded.

**Schedule and assignment:**
User: "Schedule the Martinez crew for the North Willow heat pump install on March 28"
LEAP AI creates the schedule record, assigns the team, generates the issuance checklist, and notifies the Director of Field Services.

**Data lookup:**
User: "What is the status of all payment requests submitted in the last 30 days?"
LEAP AI queries and displays the results with current status for each.

---

## LEAP AI Rules

**Permission-scoped** — LEAP AI cannot do anything the logged-in user cannot do themselves. It operates entirely within the user's role and field-level permissions. A technician's AI assistant cannot access financial fields.

**Confirmation required** — before any create, update, status change, or delete action, LEAP AI shows the user exactly what it is about to do and requires explicit confirmation. It never takes action silently.

**Full audit trail** — every action LEAP AI takes is logged as an activity on the relevant record. The log shows that the action was AI-assisted, who the logged-in user was, and what was changed. Indistinguishable in the audit log from a manual action except for the AI-assisted flag.

**Context-aware** — when a user is looking at a specific record, LEAP AI already has that record's context loaded. It knows what object the user is on, what related records exist, and what the current status and outstanding tasks are.

**Plain English only** — users never write queries or commands. All interaction is plain English conversation.

**Transparent** — LEAP AI always shows its work. It explains what it found, what it is going to do, and why, before acting.

---

## LEAP AI Architecture

- Claude API — claude-sonnet model via Anthropic API
- Connected to LEAP Supabase database via MCP
- Scoped to the logged-in user's row-level security and field permissions
- Conversation history maintained per session
- Every AI action logged to the audit log with an AI-assisted flag
- Available in all modules — context switches automatically based on current record or view
- Mobile-compatible — same assistant available in mobile views
