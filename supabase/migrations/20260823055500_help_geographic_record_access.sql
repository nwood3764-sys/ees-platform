-- Help article: restricting a user to one state's records.
INSERT INTO public.help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
  ha_category, ha_audience, ha_is_published
) VALUES (
  '', 'geographic-record-access',
  'Geographic Record Access: Restricting a User to One State',
  'Grant a user one or more states and they see only records that belong to those states — properties, accounts, contacts, work orders, photos, everything. A user with no grant is unrestricted.',
$md$
# Geographic Record Access

LEAP has always been able to say **whether** a role may open Properties at all. This says **which** properties — and which accounts, contacts, opportunities, projects, work orders, assessments, photos, documents and history under them.

Grant a user North Carolina and North Carolina is the whole platform as far as they are concerned. Everything else does not appear in a list, in a search, in a report, in a related list, or on a record page. It is not hidden in the interface — the database will not return it.

## Where to set it

**LEAP Admin → Users → Record Access → Manage.**

Each state shows the number of properties behind it, so you can see what a grant opens up before you make it. Click a state to grant it, click it again to take it away.

## No states granted means all states

This is the part worth reading twice.

| The Record Access column says | It means |
|---|---|
| **All states** | No restriction. This user sees every record their role allows, in every state. |
| **NC** (or any code) | Restricted. This user sees only records that belong to that state. |

Every user in LEAP reads **All states** until someone grants them a state. Adding this feature changed nobody's access — a user is restricted only once you deliberately restrict them.

## It restricts changes too, not just viewing

A restricted user cannot create or edit a record outside their states either. If someone scoped to North Carolina tries to create a Wisconsin property, or to move a North Carolina property to Wisconsin, the save is refused. There is no combination of screens, filters, exports or reports that gets them a record outside their states, because the restriction is enforced on the data itself rather than in the interface.

## How LEAP decides a record's state

A **property** carries its own state. Everything else inherits it by following the chain back to a property:

- a **building** through its property; a **unit** through its building
- an **opportunity**, **project**, **work order**, **enrollment**, **assessment** or **incentive application** through its property
- a **work plan**, **work step**, **time entry** or **service appointment** through its work order
- a **photo**, **document**, **task** or **field history** entry through whichever record it is attached to

An **account** works in the other direction: it is in scope when it owns or manages a property in the granted states. **Contacts** follow their account. So a property owner operating in several states is visible to a North Carolina user — but only their North Carolina properties are.

**If a record cannot be traced to a state, a restricted user does not see it.** That is deliberate. A work order with no property on it, an email that was never matched to a record, an import staging row that never linked up — none of these can be proved to belong to North Carolina, so none of them are shown.

Platform configuration is never restricted: picklists, page layouts, record types, work types, report and dashboard definitions, help articles and the rest are the same for everybody. Reports and dashboards need no separate setup — they run against the same data, so a restricted user's report simply returns their states.

## Checking what someone will see

**Record Access → Preview access** counts, object by object, how many records exist and how many that user can see. Use it before handing someone their login. It reports counts only — it never shows you the records themselves.

## Things worth knowing

- A user must be **Active** for their role to resolve. An inactive user has no role at all, which limits them for reasons that have nothing to do with geography.
- Granting a second state is additive: grant NC and WI and the user sees both.
- Administrators are never restricted.
- Which column on each object carries the state, and which parent each object follows to find one, is configuration rather than code — it lives in the **Record State Scope Sources** registry. If an object ever resolves the wrong way, that is where it is corrected.
$md$,
  'Permissions', 'admin', true
);
