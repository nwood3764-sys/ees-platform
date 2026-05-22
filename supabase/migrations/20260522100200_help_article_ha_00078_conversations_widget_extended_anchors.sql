-- HA-00078 — Conversations panel now appears on six more record types
DO $$
DECLARE v_article_id uuid; v_admin uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
BEGIN
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published, ha_created_by, ha_updated_by
  ) VALUES (
    '', 'conversations-widget-extended-anchors',
    'Conversations panel — now on work orders, incentive applications, opportunities, assessments, buildings, and properties',
    'The Conversations panel — the Service Cloud-style split-pane view of all SMS and email threads anchored to a record — has been added to six more object layouts. Email replies on these threads route through the right state mailbox automatically.',
    $body$
The Conversations panel — the split-pane widget that shows every SMS and email thread anchored to the record you're looking at — used to appear on only four record types: Account, Contact, Project, and Service Appointment. It now also appears on:

- **Work Order**
- **Incentive Application**
- **Opportunity**
- **Assessment**
- **Building**
- **Property**

## Where to find it

On any record of one of these types, open the record's Details tab and scroll down. You'll see a collapsible **Conversations** section near the bottom of the page. Expand it to see the thread list on the left and the active thread + composer on the right (or single-column on mobile).

The panel works exactly the same way it does on Accounts, Contacts, Projects, and Service Appointments. New conversations anchored to this record show up here. Inbound replies thread back automatically. Reply right from the composer at the bottom of the active thread.

## How replies route to the right mailbox

When you reply to an email thread from one of these new record types, LEAP needs to know which state mailbox to send from (WI, NC, CO, MI, or IN). It walks the anchor record's parent chain to find a state:

- **Work Order** → property's state (or, if not set, the parent project's property)
- **Incentive Application** → installation address state, else linked property, else parent project's property
- **Opportunity** → opportunity's state, else linked property's state
- **Assessment** → linked property's state, else parent project, else linked building
- **Building** → building's state, else parent property
- **Property** → state directly

If the resolver can't find a state — for example a record with no property linked yet — the Compose button will tell you that, rather than guessing and sending from the wrong address.

## What stays the same

- Permission rules are unchanged. You see threads on this record if you're a sender, a recipient, on the anchoring opportunity's contact roles, the record's owner, or have Communications: View All.
- The thread itself is still threaded by Microsoft 365 conversation token plus Message-ID fallback. Threading does not depend on which anchor record you opened the panel from.
- Outlook is still the authoritative archive. Inbound mail still routes through the shared mailbox's existing delegate permissions.

## Why this matters

Customer correspondence is rarely about one record in isolation. A question that arrives anchored to a Project might actually concern the Incentive Application or the Assessment under it. With Conversations now visible on all six of those record types, you can land on whichever one the email is about and see — and reply to — the conversation right there, without hunting back up to the Account or Contact.
$body$,
    'communications',
    'all',
    true,
    v_admin,
    v_admin
  )
  RETURNING id INTO v_article_id;

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'object', 'work_orders',             10, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'object', 'incentive_applications',  20, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'object', 'opportunities',           30, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'object', 'assessments',             40, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'object', 'buildings',               50, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'object', 'properties',              60, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'object', 'conversations',           70, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'concept', 'conversation-panel',     80, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'concept', 'outbound-mailbox-routing', 90, v_admin);

  IF (SELECT COUNT(*) FROM public.help_article_anchors WHERE haa_article_id = v_article_id) <> 9 THEN
    RAISE EXCEPTION 'expected 9 anchors for HA-00078 conversations-widget-extended-anchors, got %', (SELECT COUNT(*) FROM public.help_article_anchors WHERE haa_article_id = v_article_id);
  END IF;
END $$;
