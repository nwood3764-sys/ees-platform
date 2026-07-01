// Smart pre-export review. The deterministic parser does the mapping; THIS uses
// Claude (Anthropic key, server-side) to audit that mapping against the actual
// Asset Score / OpenStudio report text before the user exports the 50121 file.
// It flags missing fields, values that disagree with the report, and anything
// ambiguous it would ask a human about — so there are no silent assumptions.
//
// Request (POST JSON): { mapped: {field: value, ...}, reports: {baseline, improved, openStudio} }
// Response (JSON):      { findings: [{field, severity, message, suggested}], summary }
//   severity: "ok" | "gap" | "mismatch" | "question"

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 3000;

const SYSTEM_PROMPT = `You are the pre-export QA reviewer for the EES Audit Template Builder, which produces DOE Audit Template (BuildingSync) files for the IRA HOMES 50121 program.

You are given:
1. "mapped" — the field values the deterministic parser pulled from the reports and will write into the BuildingSync file.
2. "reports" — the raw extracted text of the source documents (Asset Score baseline + improved PDFs, and OpenStudio results).

Your job: audit the mapping the way a careful human reviewer would BEFORE the file is exported. For every field, check it against the report text and decide:
- "ok"       — present and consistent with the report.
- "gap"      — required but missing/blank, and NOT derivable from the reports (the user must supply it).
- "mismatch" — present but disagrees with what the report says (give the report's value in "suggested").
- "question" — ambiguous or needs a human judgment call; ask a clear, specific question.

Rules:
- Be specific and cite the report value when relevant. Short, plain messages.
- Do NOT invent requirements. Focus on fields that matter for a valid 50121 submission (identity, floor areas + use-type split, envelope R-values, HVAC incl. cooling COP/tons and boiler, water heater, EUIs, whole-building savings %, occupancy, measures).
- If everything checks out, return an empty findings array and a one-line positive summary.
- Occupancy is computed from user-entered dwelling units and bedrooms (2 in the master + 1 per additional bedroom); only flag it if those inputs look inconsistent with the report's building type/size.

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

  const mapped = body.mapped || {};
  const reports = body.reports || {};
  const userMsg =
    "MAPPED FIELDS (what the tool will write):\n" + JSON.stringify(mapped, null, 2) +
    "\n\nSOURCE REPORT TEXT:\n" + JSON.stringify(reports).slice(0, 160000);

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
