const { findNakshatra, getNamingSyllable } = require("../data/nakshatra-table");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

// ─── Tool definitions (sent to Groq so it knows what's available) ────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_naming_reading",
      description:
        "Get the Moon Nakshatra, Pada, and traditional Vedic naming syllable (Naam Akshar) from the birth chart. Call this when the user asks what their name initial should be, what nakshatra they belong to, or wants a general naming reading.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "check_name_compatibility",
      description:
        "Check whether a specific name the user provides is compatible with their Moon Nakshatra and naming syllable. Call this when the user asks if their current name is correct, aligned, or suitable for their chart.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The exact name to check compatibility for.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_names",
      description:
        "Suggest real names that match the user's Moon Nakshatra naming syllable. Call this when the user asks for name suggestions or alternatives.",
      parameters: {
        type: "object",
        properties: {
          gender: {
            type: "string",
            description: "Gender preference for the names.",
            enum: ["Male", "Female", "Any"],
          },
        },
        required: [],
      },
    },
  },
];

// ─── Tool implementations (pure JS, deterministic, no LLM involved) ──────────

function getMoon(chart) {
  return (chart.planets || []).find(
    (p) => String(p?.name || "").toLowerCase() === "moon"
  ) || null;
}

function getNakshtraFacts(chart) {
  const moon = getMoon(chart);
  if (!moon) return { ok: false, error: "Moon not found in chart data." };

  const nakEntry = findNakshatra(moon.nakshatra);
  if (!nakEntry) {
    return {
      ok: false,
      error: `Moon Nakshatra "${moon.nakshatra}" was not recognized. This may be a spelling variant not yet in the lookup table.`,
    };
  }

  const syllable = getNamingSyllable(moon.nakshatra, moon.pada);

  return {
    ok: true,
    moonNakshatra: nakEntry.name,
    moonPada: Number(moon.pada),
    namingSyllable: syllable,
    allPadaSyllables: nakEntry.padas,
    moonSign: moon.sign || moon.rashi || null,
  };
}

function tool_get_naming_reading(chart) {
  return getNakshtraFacts(chart);
}

function tool_check_name_compatibility(chart, args) {
  const facts = getNakshtraFacts(chart);
  if (!facts.ok) return facts;

  const name = String(args.name || "").trim();
  if (!name) return { ok: false, error: "No name was provided to check." };

  const syllable = facts.namingSyllable || "";
  const isCompatible = syllable
    ? name.toLowerCase().startsWith(syllable.toLowerCase())
    : false;

  return {
    ok: true,
    name,
    isCompatible,
    namingSyllable: syllable,
    moonNakshatra: facts.moonNakshatra,
    moonPada: facts.moonPada,
    allPadaSyllables: facts.allPadaSyllables,
  };
}

function tool_suggest_names(chart, args, gender) {
  const facts = getNakshtraFacts(chart);
  if (!facts.ok) return facts;

  return {
    ok: true,
    namingSyllable: facts.namingSyllable,
    moonNakshatra: facts.moonNakshatra,
    moonPada: facts.moonPada,
    allPadaSyllables: facts.allPadaSyllables,
    gender: args.gender || gender || "Any",
  };
}

function runTool(toolName, args, chart, gender) {
  if (toolName === "get_naming_reading") return tool_get_naming_reading(chart);
  if (toolName === "check_name_compatibility") return tool_check_name_compatibility(chart, args);
  if (toolName === "suggest_names") return tool_suggest_names(chart, args, gender);
  return { error: `Unknown tool: ${toolName}` };
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert Vedic (Jyotish) astrologer. The user has submitted their birth details and a D1 birth chart has been cast for them.

You have three tools available. Use them whenever the user's question involves:
- Their Moon Nakshatra or naming initial (get_naming_reading)
- Whether a specific name suits them (check_name_compatibility)
- Name suggestions based on their chart (suggest_names)

Always call the relevant tool first. Never guess or state astrological data from your own training without calling a tool, the chart data must come from the tool result.

After getting tool results, explain them in plain, warm language. No jargon unless you explain it. No vague mysticism.

For name compatibility: be honest but sensitive. If the name does not match, explain what that means in Vedic tradition without being alarming. Many people go by names that differ from their Naam Akshar and that is fine to acknowledge.

For name suggestions: suggest 4 to 6 real names with one line on each name's meaning. Names must start with the syllable from the tool result.

If the user asks about something the tools do not cover (wealth, career, marriage, health), say clearly that those readings are not yet available in this version and you can only help with the Moon Nakshatra naming reading right now.`;

// ─── Handler ──────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is missing GROQ_API_KEY. Add it in Vercel environment variables." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ error: "Malformed request body." }); }
  }

  const { chart, messages, gender } = body || {};

  if (!chart) return res.status(400).json({ error: "Missing chart data." });
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Missing conversation messages." });
  }
  if (messages.length > 40) {
    return res.status(400).json({ error: "Conversation too long. Start a new reading." });
  }
  const tooLong = messages.some(
    (m) => typeof m?.content === "string" && m.content.length > 2000
  );
  if (tooLong) {
    return res.status(400).json({ error: "Message too long (max 2000 characters)." });
  }

  // Only allow user and assistant roles from the client.
  // Tool role messages are built server-side only.
  const chatMessages = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    // ── Round 1: send conversation to Groq with tools available ──────────────
    const round1 = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...chatMessages],
        tools: TOOLS,
        tool_choice: "auto",
      }),
    });

    const payload1 = await round1.json();

    if (!round1.ok) {
      return res.status(502).json({
        error: "The AI reasoning service returned an error.",
        details: payload1?.error?.message || payload1,
      });
    }

    const choice1 = payload1.choices?.[0];
    const message1 = choice1?.message;

    // ── No tool call: LLM replied directly, return it ────────────────────────
    if (!message1?.tool_calls || message1.tool_calls.length === 0) {
      return res.status(200).json({ reply: (message1?.content || "").trim() });
    }

    // ── Tool call: run it in our code, feed result back ───────────────────────
    const toolCall = message1.tool_calls[0];
    let toolArgs = {};
    try { toolArgs = JSON.parse(toolCall.function.arguments || "{}"); } catch { /* leave empty */ }

    const toolResult = runTool(toolCall.function.name, toolArgs, chart, gender);

    // ── Round 2: send tool result back, get final reply ───────────────────────
    const round2 = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...chatMessages,
          {
            role: "assistant",
            content: message1.content || null,
            tool_calls: message1.tool_calls,
          },
          {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          },
        ],
        tools: TOOLS,
        tool_choice: "auto",
      }),
    });

    const payload2 = await round2.json();

    if (!round2.ok) {
      return res.status(502).json({
        error: "The AI reasoning service returned an error.",
        details: payload2?.error?.message || payload2,
      });
    }

    const reply = (payload2.choices?.[0]?.message?.content || "").trim();
    return res.status(200).json({ reply });

  } catch (err) {
    return res.status(502).json({
      error: "Couldn't reach the AI reasoning service. Try again in a moment.",
      details: String(err?.message || err),
    });
  }
};