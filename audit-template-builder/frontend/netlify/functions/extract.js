// Intelligent extraction. Instead of brittle regex, Claude reads the raw Asset
// Score + OpenStudio report text and returns the structured field set that
// populates the 50121 BuildingSync file — including choosing the correct
// BuildingSync enum labels. This is what makes the tool smart rather than a
// one-for-one hardcoded mapper: it handles any building and any report wording.
//
// Request (POST JSON): { reports: { baseline, improved, openStudio } }
// Response (JSON):      { baseline: {...fields}, improved: {...fields}, notes: [] }

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 4000;

// The field set the XML builder consumes, with the allowed BuildingSync enum
// values for the enum fields so Claude maps to a value the importer accepts.
const SYSTEM_PROMPT = `You are the extraction engine for the EES Audit Template Builder (DOE Audit Template / BuildingSync 2.6.0, IRA HOMES 50121). You are given the raw text of a building's Asset Score report (authoritative) and OpenStudio results. Read them like an expert energy auditor and return the fields below as JSON. Use the ASSET SCORE report as the source of truth for building characteristics.

Return STRICT JSON, no prose:
{"baseline": <fields>, "improved": <fields>, "notes": ["anything ambiguous or missing"]}

Each <fields> object (extract for the baseline report and the improved report separately):
{
  "name": string, "street": string, "city": string, "state": 2-letter, "zip": string,
  "yearBuilt": number, "climateZone": string,
  "gfa": number,                          // page-1 gross floor area, ft2 (the laser value)
  "useMultifamilyArea": number, "useCommonArea": number,   // from "Building Use Types"
  "floorsAbove": number, "floorsBelow": number,
  "wwr": number,                          // window-to-wall ratio, 0-1
  "wallArea": number, "windowArea": number, "roofArea": number, "belowGradeWallArea": number,
  "wallR": number, "roofR": number,       // insulation R-values
  "infiltration": number,                 // CFM/ft2 @ 0.3 in wc
  "euiCurrent": number, "euiUpgraded": number,      // headline site EUI
  "gasEuiCur": number, "gasEuiUpg": number, "elecEuiCur": number, "elecEuiUpg": number,
  "savingsPct": number,                   // "estimated annual site energy savings"
  "boilerType": one of ["Hot water","Steam","Condensing","Other"],
  "boilerDraft": one of ["Natural","Mechanical","Induced","Forced","Other"],
  "boilerFuel": one of ["Natural gas","Electricity","Fuel oil","Propane","Other"],
  "boilerCapacity_kBtu_hr": number, "boilerEfficiency": number, "boilerYear": number, "boilerQuantity": number,
  "heatingSourceType": string,            // e.g. "Convective baseboard: hot water"
  "coolingType": one of ["DX","Chiller","No cooling","Other"],
  "coolingCOP": number, "coolingTons": number,
  "roofType": one of ["Shingles/shakes","Membrane","Metal","Built-up","Tile","Other"],
  "wallType": string,                     // e.g. "Brick/stone on wood frame"
  "windowFrame": one of ["Vinyl","Wood","Aluminum","Fiberglass","Wood/vinyl/fiberglass","Other"],
  "windowGlassLayers": one of ["Single pane","Double pane","Triple pane"],
  "waterHeaterFuel": one of ["Natural gas","Electricity","Fuel oil","Propane","Other"],
  "waterHeaterEt": number,
  "lightingType": string,                 // e.g. "LED"
  "measures": [ string ]                  // improved report's Selected Upgrade Opportunities; [] for baseline
}

Rules:
- Numbers only for numeric fields (no units, no commas). Omit a field (null) if genuinely not in the report and add a note.
- For enum fields, pick the closest allowed value; if none fits, use "Other" and add a note.
- gfa = the page-1 gross floor area, NOT a block-derived figure.
- The report echoes HVAC/water-heating per block; they are building-wide — do not sum across blocks.
- Do not invent values.`;

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "Extraction isn't configured — add ANTHROPIC_API_KEY to this Netlify site." }, 503);

  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }
  const reports = body.reports || {};
  const userMsg = "SOURCE REPORT TEXT:\n" + JSON.stringify(reports).slice(0, 180000);

  let resp;
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }] }),
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
  let parsed;
  try { const m = text.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : text); }
  catch (_e) { return json({ error: "Extraction returned unreadable JSON", raw: text.slice(0, 500) }, 200); }
  return json(parsed, 200);
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
