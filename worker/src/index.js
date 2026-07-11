/**
 * Diet AI — Claude API proxy (Cloudflare Worker)
 *
 * Keeps the Anthropic API key server-side and exposes two narrow endpoints
 * the static site calls for its AI features:
 *   POST /api/parse-food  { text, diet } -> { items: [{name, calories, protein}] }
 *   POST /api/insight     { goal, diet, target, protein, totalCal, totalProtein, itemsCount }
 *                         -> { tip: string }
 *
 * Required secret:  ANTHROPIC_API_KEY  (wrangler secret put ANTHROPIC_API_KEY)
 * Optional var:     ALLOWED_ORIGINS    comma-separated list, defaults below.
 */

const MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TEXT_LEN = 300;

const DEFAULT_ALLOWED_ORIGINS = [
  "https://dietai.in",
  "https://www.dietai.in",
];

function allowedOrigins(env) {
  if (env.ALLOWED_ORIGINS) {
    return env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = allowedOrigins(env);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function callClaude(env, body) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function clampInt(n, lo, hi) {
  n = Math.round(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

async function handleParseFood(request, env, cors) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const diet = ["veg", "egg", "nonveg"].includes(body?.diet) ? body.diet : "veg";
  if (!text) return json({ error: "Missing 'text'." }, 400, cors);
  if (text.length > MAX_TEXT_LEN) {
    return json({ error: `Description too long (max ${MAX_TEXT_LEN} chars).` }, 400, cors);
  }

  const dietNote = {
    veg: "The user is pure vegetarian — do not assume egg or meat unless they explicitly mention it.",
    egg: "The user eats vegetarian food plus eggs, but no meat or fish unless explicitly mentioned.",
    nonveg: "The user eats any food including meat, fish and eggs.",
  }[diet];

  const claudeBody = {
    model: MODEL,
    max_tokens: 1024,
    system:
      "You are a nutrition estimation assistant specialised in Indian home cooking and typical restaurant portions. " +
      "Given a free-text description of a meal or snack, split it into individual food items and estimate calories " +
      "and protein (grams) per the portion described, using standard Indian nutrition references. If a quantity " +
      "isn't given, assume one typical serving. Be decisive — always produce a best estimate, never ask a " +
      "clarifying question. " + dietNote,
    messages: [{ role: "user", content: text }],
    tools: [
      {
        name: "log_foods",
        description: "Record the parsed food items with estimated nutrition.",
        input_schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              minItems: 1,
              maxItems: 12,
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Short food name with quantity, e.g. '2 Roti'" },
                  calories: { type: "integer", description: "Estimated total calories for this item" },
                  protein: { type: "integer", description: "Estimated protein in grams for this item" },
                },
                required: ["name", "calories", "protein"],
              },
            },
          },
          required: ["items"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "log_foods" },
  };

  const result = await callClaude(env, claudeBody);
  const toolUse = result.content?.find((c) => c.type === "tool_use" && c.name === "log_foods");
  const rawItems = Array.isArray(toolUse?.input?.items) ? toolUse.input.items : [];

  const items = rawItems
    .filter((it) => it && typeof it.name === "string" && it.name.trim())
    .slice(0, 12)
    .map((it) => ({
      name: it.name.trim().slice(0, 60),
      calories: clampInt(it.calories, 0, 5000),
      protein: clampInt(it.protein, 0, 300),
    }));

  if (!items.length) return json({ error: "Could not parse any food items." }, 422, cors);
  return json({ items }, 200, cors);
}

async function handleInsight(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid request body." }, 400, cors);

  const goal = ["lose", "maintain", "gain"].includes(body.goal) ? body.goal : "maintain";
  const diet = ["veg", "egg", "nonveg"].includes(body.diet) ? body.diet : "veg";
  const target = clampInt(body.target, 0, 6000);
  const protein = clampInt(body.protein, 0, 400);
  const totalCal = clampInt(body.totalCal, 0, 10000);
  const totalProtein = clampInt(body.totalProtein, 0, 500);
  const itemsCount = clampInt(body.itemsCount, 0, 50);

  const claudeBody = {
    model: MODEL,
    max_tokens: 150,
    system:
      "You are a warm, encouraging Indian nutrition coach. Given a user's daily targets and what they've logged so " +
      "far today, give exactly ONE short, specific, actionable tip (max 2 sentences, no markdown, no medical claims, " +
      "no diagnosis). Reference their actual numbers where useful. If they're doing well, say so briefly and give a " +
      "small forward-looking suggestion instead of criticism.",
    messages: [
      {
        role: "user",
        content:
          `Goal: ${goal}. Diet: ${diet}. Daily target: ${target} kcal, ${protein}g protein. ` +
          `Logged so far today: ${totalCal} kcal, ${totalProtein}g protein across ${itemsCount} item(s).`,
      },
    ],
  };

  const result = await callClaude(env, claudeBody);
  const text = result.content?.find((c) => c.type === "text")?.text?.trim();
  if (!text) return json({ error: "No tip generated." }, 502, cors);
  return json({ tip: text.slice(0, 500) }, 200, cors);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const origin = request.headers.get("Origin") || "";
    if (!allowedOrigins(env).includes(origin)) {
      return json({ error: "Origin not allowed." }, 403, cors);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: "Server misconfigured: ANTHROPIC_API_KEY not set." }, 500, cors);
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405, cors);
    }

    try {
      if (url.pathname === "/api/parse-food") return await handleParseFood(request, env, cors);
      if (url.pathname === "/api/insight") return await handleInsight(request, env, cors);
      return json({ error: "Not found." }, 404, cors);
    } catch (err) {
      return json({ error: "AI request failed. Please try again." }, 502, cors);
    }
  },
};
