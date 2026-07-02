// Smart pre-export review. The deterministic generator builds the 50121 files;
// THIS uses Claude (Anthropic key, server-side) to audit the ACTUAL generated
// XML — a digest of every building-describing value extracted from both files —
// against the raw report text, DOE Audit Template's accepted values, and the
// EES standing rules, before the user exports. The goal: catch anything DOE's
// import screens would show wrong while it can still be fixed here.
//
// Request (POST JSON): { xmlDigest: {baseline, improved}, mapped: {...},
//                        reports: {baseline, improved, openStudio} }
// Response (JSON):      { findings: [{field, severity, message, suggested}], summary }
//   severity: "ok" | "gap" | "mismatch" | "question"

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 4000;

const SYSTEM_PROMPT = `You are the pre-export QA auditor for the EES Audit Template Builder, which produces DOE Audit Template (BuildingSync 2.6.0) files for the IRA HOMES 50121 program.

You are given:
1. "xmlDigest" — every building-describing value extracted from the two ACTUAL generated XML files (baseline + improved). This is what DOE's import screens will display. It is the primary audit target. (If it carries a "skipped" or "error" note, say so and audit only "mapped".)
2. "mapped" — the deterministic parser's field summary (a cross-check, not the export).
3. "reports" — raw extracted text of the source documents (Asset Score baseline + improved PDFs, OpenStudio results).

Audit the digest the way a careful human reviewer stepping through every DOE screen would. Checks, in priority order:

A. REPORT FIDELITY — every value describing the building (name, address, year, areas, R-values, window/wall/roof/door characteristics, HVAC, water heater, lighting power densities, occupancy, measures) must trace to the reports. Flag any value that does NOT appear in or follow from the report text — it is likely a leftover from the reference building the file template was built from, which is the #1 historical defect of this tool.

B. DOE ACCEPTED VALUES (from the Audit Template rulebook) — flag any value outside these sets, which DOE renders as a blank "Please select":
- ExteriorWallFinish: Brick | Metal panel | Other
- ExteriorWallConstruction: Masonry | Steel frame | Wood frame
- FenestrationFrameMaterial: Aluminum no thermal break | Aluminum thermal break | Other | Vinyl
- ExteriorDoorType: Hollow wood | Insulated metal | Other | Solid wood | Uninsulated metal — and when it is "Other", the "Other Exterior Door Type" UDF must be non-empty or DOE import fails validation.
- All *Condition fields: Average | Excellent | Good | Poor
- Delivery equipment is derived from XML STRUCTURE: a through-the-wall/window-AC building must have its cooling Delivery's ZoneEquipment contain exactly one child element "Other" (see deliveryZoneEquipment) plus an "Other Distribution Equipment Type" UDF; a baseboard heating Delivery keeps FanBased+Convection.

C. EES STANDING RULES — flag any deviation:
- Electric resistance heating: AnnualHeatingEfficiencyValue is exactly "1.0" (decimal, 1.0 = 100%) with efficiency type "Thermal Efficiency"; never 100 or a COP.
- Heating/DHW/cooling Location = "Interior"; YearInstalled = the building's year built; Quantity/number of pieces = 1 (whole building).
- DX / unitized cooling: "Central Distribution Type" UDF = "None (unitized heating/cooling)".
- Window-to-wall ratio = the HIGHEST multifamily-unit block ratio from the report, never a building average.
- Whole-building savings % = (baseline report Current Site EUI − improved report Upgraded Site EUI) ÷ baseline Current Site EUI. The improved report's printed savings % is on a different basis (attic R-15 rule workaround) and must NOT be the reported value.
- Occupants = dwelling units × (bedrooms per unit + 1); dwelling units occupied = 100%.
- Energy values (meter readings, end uses, capacities) are WHOLE numbers; nothing anywhere carries more than 2 decimal places (DOE stores float32 — longer decimals display as garbage). Any entry in decimalViolations is automatically a "mismatch" finding.
- Any entry in duplicateIds is automatically a "mismatch" — duplicate xs:ID fails DOE import outright.

D. INTERNAL CONSISTENCY — per fuel, per file: meter monthly annualTotal ≈ the end-use rows' sum ≈ the "All end uses" row; baseline benchmark EUI ≈ the baseline report's Current Site EUI and improved target EUI ≈ the improved report's Upgraded Site EUI; monthlyCostTotal ≈ kWh×0.188 + therms×0.97 (WI rates); identity fields identical across the two files; the metered window is 12 consecutive months ending ~2 months back; the improved file's measures cover what the reports support (air sealing, attic/roof insulation when baseline roof R < improved roof R, low-flow fixtures) with no scrambled name/description pairings.

Severity meanings:
- "ok"       — consistent (omit unless there are no problems at all).
- "gap"      — required but missing/blank and not derivable from the reports.
- "mismatch" — disagrees with the report, a rule above, or itself (give the correct value in "suggested").
- "question" — genuinely ambiguous; ask one clear, specific question.

Rules of engagement: be specific, cite the report value and the file (baseline/improved) in "field" or "message". Do NOT invent requirements beyond the checks above. Do not flag structural BuildingSync scaffolding (element ordering, IDs, scenario plumbing) — only building data. If everything checks out, return an empty findings array and a one-line positive summary that states the key numbers you verified (EUIs, savings %, totals).

Return ONLY valid JSON, no prose outside it:
{"summary":"...","findings":[{"field":"...","severity":"ok|gap|mismatch|question","message":"...","suggested":"..."}]}
Include only findings that are gap/mismatch/question (skip "ok" ones) unless there are none.`;

export default async (request) => {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return json({ error: "Review isn't configured — add ANTHROPIC_API_KEY to this Netlify site." }, 503);

  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }

  const xmlDigest = body.xmlDigest || { skipped: "no digest supplied by the client" };
  const mapped = body.mapped || {};
  const reports = body.reports || {};
  const userMsg =
    "GENERATED XML DIGEST (the actual export — primary audit target):\n" +
    JSON.stringify(xmlDigest, null, 1).slice(0, 90000) +
    "\n\nPARSED FIELD SUMMARY (cross-check):\n" + JSON.stringify(mapped, null, 1) +
    "\n\nSOURCE REPORT TEXT:\n" + JSON.stringify(reports).slice(0, 140000);

  let resp;
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
  } catch (err) { return json({ error: "Could not reach the AI service: " + err.message }, 502); }

  if (!resp.ok) {
    let d = ""; try { d = (await resp.text()).slice(0, 400); } catch (_e) {}
    return json({ error: `AI service returned ${resp.status}`, detail: d }, 502);
  }

  let data;
  try { data = await resp.json(); } catch (_e) { return json({ error: "Malformed AI response" }, 502); }
  const text = Array.isArray(data.content)
    ? data.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim() : "";

  // The model returns JSON; extract the first {...} block defensively.
  let parsed;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : text);
  } catch (_e) {
    return json({ summary: "Review returned an unreadable response.", findings: [], raw: text.slice(0, 500) }, 200);
  }
  return json(parsed, 200);
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
