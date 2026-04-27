// =============================================================================
// _shared/merge.ts
//
// Helpers shared across the document/envelope edge functions:
//   - resolveRowForMerge: swap uuid columns to picklist labels / user names
//   - buildMergeDict: assemble the {{root.field}} dictionary used by both
//     the docx renderer (docxtemplater) and the html renderer
//   - singularize: parent_object → root key
// =============================================================================

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function singularize(plural: string): string {
  const map: Record<string, string> = {
    properties: "property",
    opportunities: "opportunity",
    accounts: "account",
    contacts: "contact",
    projects: "project",
    work_orders: "work_order",
    work_steps: "work_step",
    buildings: "building",
    units: "unit",
    incentive_applications: "incentive_application",
    payment_receipts: "payment_receipt",
    project_payment_requests: "project_payment_request",
    assessments: "assessment",
    programs: "program",
    work_types: "work_type",
  }
  if (plural in map) return map[plural]
  if (plural.endsWith("ies")) return plural.slice(0, -3) + "y"
  if (plural.endsWith("s"))   return plural.slice(0, -1)
  return plural
}

export async function resolveRowForMerge(
  supabase: SupabaseClient,
  row: Record<string, any>,
): Promise<Record<string, any>> {
  const out: Record<string, any> = { ...row }
  const uuidValues = new Set<string>()
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string" && UUID_RE.test(v) && k !== "id") uuidValues.add(v)
  }
  if (uuidValues.size === 0) return out

  const ids = Array.from(uuidValues)
  const [picklistRes, usersRes] = await Promise.all([
    supabase.from("picklist_values").select("id, picklist_label, picklist_value").in("id", ids),
    supabase.from("users").select("id, first_name, last_name").in("id", ids),
  ])
  const picklistMap = new Map<string, string>()
  for (const p of (picklistRes.data || [])) {
    picklistMap.set(p.id, p.picklist_label || p.picklist_value || "")
  }
  const userMap = new Map<string, string>()
  for (const u of (usersRes.data || [])) {
    const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim()
    if (full) userMap.set(u.id, full)
  }
  for (const [k, v] of Object.entries(row)) {
    if (typeof v !== "string" || !UUID_RE.test(v) || k === "id") continue
    if (picklistMap.has(v))      out[k] = picklistMap.get(v)
    else if (userMap.has(v))     out[k] = userMap.get(v)
  }
  return out
}

export async function buildMergeDict(
  supabase: SupabaseClient,
  parentObject: string,
  parentRecordId: string,
  templateName: string,
): Promise<Record<string, any>> {
  const dict: Record<string, any> = {}
  const { data: parentRow, error } = await supabase
    .from(parentObject).select("*").eq("id", parentRecordId).maybeSingle()
  if (error)      throw new Error(`Parent lookup failed: ${error.message}`)
  if (!parentRow) throw new Error("Parent record not found")
  const root = singularize(parentObject)
  dict[root] = await resolveRowForMerge(supabase, parentRow)

  const now = new Date()
  dict.today = {
    iso:   now.toISOString().slice(0, 10),
    short: now.toLocaleDateString("en-US"),
    long:  now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  }
  dict.template = { name: templateName }
  return dict
}
