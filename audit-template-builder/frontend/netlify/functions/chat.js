// Server-side proxy to the Anthropic API for the in-app energy-auditing
// assistant. The API key lives ONLY here (Netlify env var ANTHROPIC_API_KEY),
// never in the browser. Same-origin with the site, so no CORS needed.
//
// Request  (POST JSON): { messages: [{role, content}], context: {...} }
// Response (JSON):       { reply: "<assistant text>" }  or  { error: "..." }
//
// Uses global fetch (Netlify Functions run on Node 18+), no npm dependencies,
// so the site keeps its no-build static deploy.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 1500;

const SYSTEM_PROMPT = `You are the built-in expert assistant for the EES Audit Template Builder, a tool used by Energy Efficiency Services of Wisconsin (EES) to prepare DOE Audit Template (BuildingSync) and Portfolio Manager submissions for the IRA HOME Energy Rebates program (Section 50121, HOMES).

Your expertise, at a BPI-certified level:
- Home-performance and HVAC energy auditing.
- DOE Asset Score, OpenStudio/EnergyPlus energy modeling, and BuildingSync / DOE Audit Template.
- The HOMES (50121) program: modeled vs. measured pathways, and the whole-building savings tiers (20-34% and 35%+), including how site-energy savings percentage drives qualification.
- State-level program variations (this contractor operates in WI, NC, CO, MI, IN).

You are given, as context, the data the tool parsed for the CURRENT building: the Asset Score report fields, the OpenStudio energy results, the computed per-fuel EUIs, the whole-building savings %, and the qualification tier — plus the raw extracted text of the uploaded documents. Answer questions using this context first, and cite the specific numbers from it.

Rules:
- Be concise, concrete, and practical. Lead with the answer.
- When you use a number, say where it comes from (e.g. "Asset Score baseline EUI = 92").
- If the user asks about program eligibility, reason from the savings % and tier in the context, but ALWAYS note that 50121 rules are set per-state and change over time, and the user should confirm against their state's current official guidance before relying on it.
- If the context doesn't contain what's needed, say so plainly rather than guessing.
- You are advisory support, not the system of record.`;

function buildContextBlock(context) {
  if (!context || typeof context !== "object") return "No building has been loaded yet.";
  try {
    return "CURRENT BUILDING CONTEXT (JSON):\n" + JSON.stringify(context, null, 2).slice(0, 120000);
  } catch (_e) {
    return "Building context could not be serialized.";
  }
}

export default async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error:
          "The assistant isn't configured yet. Add an ANTHROPIC_API_KEY environment variable to this Netlify site.",
      }),
      { status: 503, headers: { "content-type": "application/json" } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (_e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const history = Array.isArray(body.messages) ? body.messages : [];
  // Keep only role/content and cap history length to protect token budget.
  const messages = history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return new Response(JSON.stringify({ error: "Expected a user message" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const system = SYSTEM_PROMPT + "\n\n" + buildContextBlock(body.context);

  let apiResp;
  try {
    apiResp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages }),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Could not reach the AI service: " + err.message }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  if (!apiResp.ok) {
    let detail = "";
    try {
      detail = (await apiResp.text()).slice(0, 500);
    } catch (_e) {}
    return new Response(
      JSON.stringify({ error: `AI service returned ${apiResp.status}`, detail }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  let data;
  try {
    data = await apiResp.json();
  } catch (_e) {
    return new Response(JSON.stringify({ error: "Malformed AI response" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  const reply = Array.isArray(data.content)
    ? data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim()
    : "";

  return new Response(JSON.stringify({ reply: reply || "(no response)" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
