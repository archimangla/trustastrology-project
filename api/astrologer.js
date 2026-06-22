const { findNakshatra, getNamingSyllable } = require("../data/nakshatra-table");
const { findRashi } = require("../data/rashi-table");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

const TOOL_DEFINITIONS = [
  {
    name: "check_name_correctness",
    description: "Check whether the entered birth name matches the Moon Nakshatra naming syllable and the initials computed from the chart.",
    parameters: {
      type: "object",
      properties: {
        enteredName: { type: "string", description: "The name entered by the user in the birth form." },
        enteredNameInitials: { type: "string", description: "Initials computed from the entered name." },
        chartNameInitials: { type: "string", description: "Initials computed from the chart name metadata." },
        namingSyllable: { type: "string", description: "The Moon Nakshatra naming syllable for the birth chart." },
      },
      required: ["enteredName", "enteredNameInitials", "chartNameInitials", "namingSyllable"],
    },
  },
  {
    name: "compute_initials",
    description: "Compute initials from a full name supplied by the user.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "A full name from which to compute initials." },
      },
      required: ["name"],
    },
  },
  {
    name: "suggest_names",
    description: "Suggest baby names beginning with the correct naming syllable and provide a brief meaning for each.",
    parameters: {
      type: "object",
      properties: {
        namingSyllable: { type: "string", description: "The Moon Nakshatra naming syllable to base name suggestions on." },
        gender: { type: "string", description: "The gender specified on the birth form, if any." },
      },
      required: ["namingSyllable"],
    },
  },
];

function findPlanet(chart, planetName) {
  const list = Array.isArray(chart?.planets) ? chart.planets : [];
  return list.find((p) => String(p?.name || "").toLowerCase() === planetName.toLowerCase()) || null;
}

function initialsFor(name) {
  if (!name || typeof name !== "string") return null;
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase())
    .join("");
}

function suggestNames(namingSyllable, gender) {
  const base = String(namingSyllable || "").trim();
  if (!base) return { suggestions: [] };

  const suffixes = gender && String(gender).toLowerCase() === "male"
    ? ["an", "it", "esh", "ar", "in"]
    : gender && String(gender).toLowerCase() === "female"
    ? ["a", "ya", "i", "ita", "ini"]
    : ["an", "a", "i", "ya", "ar"];

  return {
    suggestions: suffixes.slice(0, 5).map((suffix) => ({
      name: `${base}${suffix}`,
      meaning: `A name beginning with ${base}, suitable for ${gender || "any"} use.`,
    })),
  };
}

function checkNameCorrectness({ enteredName, enteredNameInitials, chartNameInitials, namingSyllable }) {
  const normalizedEntered = String(enteredName || "").trim();
  const initialsMatch = String(enteredNameInitials || "").toUpperCase() === String(chartNameInitials || "").toUpperCase();
  const syllableMatch = normalizedEntered
    ? normalizedEntered.charAt(0).toUpperCase() === String(namingSyllable || "").trim().charAt(0).toUpperCase()
    : false;

  return {
    enteredName: normalizedEntered,
    enteredNameInitials: String(enteredNameInitials || "").toUpperCase(),
    chartNameInitials: String(chartNameInitials || "").toUpperCase(),
    namingSyllable: String(namingSyllable || "").trim(),
    initialsMatch,
    syllableMatch,
    correctnessSummary: `The entered name ${normalizedEntered ? "starts" : "does not start"} with ${syllableMatch ? "the expected" : "a different"} syllable and its initials ${initialsMatch ? "match" : "do not match"} the chart initials.`,
  };
}

function executeTool(name, args) {
  switch (name) {
    case "check_name_correctness":
      return checkNameCorrectness(args);
    case "compute_initials":
      return { initials: initialsFor(args.name) };
    case "suggest_names":
      return suggestNames(args.namingSyllable, args.gender);
    default:
      throw new Error(`Tool not implemented: ${name}`);
  }
}

function buildGroundedFacts(chart, enteredName) {
  const moon = findPlanet(chart, "Moon");
  if (!moon) {
    return { ok: false, reason: "No Moon entry found in the chart data returned by the astrology service." };
  }

  const nakEntry = findNakshatra(moon.nakshatra);
  if (!nakEntry) {
    return {
      ok: false,
      reason: `The chart reports Moon Nakshatra as "${moon.nakshatra}", which doesn't match a known nakshatra name. The upstream API may use a different spelling than expected.`,
    };
  }

  const syllable = getNamingSyllable(moon.nakshatra, moon.pada);
  const ascRashi = chart?.ascendant ? findRashi(chart.ascendant.rashi || chart.ascendant.sign) : null;
  const chartNameInitials = initialsFor(chart?.name);
  const enteredNameInitials = initialsFor(enteredName);

  return {
    ok: true,
    facts: {
      childName: enteredName || chart?.name || null,
      chartNameInitials,
      enteredName: enteredName || null,
      enteredNameInitials,
      moonSign: moon.sign || moon.rashi || null,
      moonNakshatra: nakEntry.name,
      moonPada: moon.pada,
      namingSyllable: syllable,
      allPadaSyllablesForNakshatra: nakEntry.padas,
      ascendantSign: chart?.ascendant?.sign || chart?.ascendant?.rashi || null,
      ascendantRashiNum: ascRashi ? ascRashi.id : null,
    },
  };
}

function systemPromptFor(facts, gender) {
  const genderNote = gender ? `The baby's gender was given as "${gender}".` : "Gender was not specified.";
  return `You are an expert Vedic (Jyotish) astrologer speaking to a parent who wants baby-name guidance, inside the TrustAstrology AI chat app.

Ground truth for this reading (computed deterministically from the birth chart, NOT from your own knowledge: treat these as the only facts you know about the chart):
- Child's name on file: ${facts.childName || "not provided"}
- Entered birth name: ${facts.enteredName || "not provided"}
- Entered name initials: ${facts.enteredNameInitials || "not provided"}
- Chart-rendered name initials: ${facts.chartNameInitials || "not provided"}
- Moon Nakshatra: ${facts.moonNakshatra}
- Moon Pada (quarter): ${facts.moonPada}
- Naming syllable (Naam Akshar) for this exact nakshatra + pada: "${facts.namingSyllable}"
- All four pada syllables within ${facts.moonNakshatra} (for context only): ${facts.allPadaSyllablesForNakshatra.join(", ")}
- Moon sign (Rashi): ${facts.moonSign || "not provided"}
- Ascendant sign: ${facts.ascendantSign || "not provided"}
${genderNote}

You have access to three tools. Use them when the user's question requires them.

Tools:
- check_name_correctness: Compare the entered name, entered initials, chart name initials, and naming syllable.
- compute_initials: Compute initials from a full name string.
- suggest_names: Suggest baby names beginning with the naming syllable and provide a short meaning for each.

Rules:
1. Only state chart facts that appear above. Never invent planetary positions, dashas, doshas, or other chart details that weren't given to you.
2. The naming syllable above is the authoritative answer for "what should the name start with." Don't override it with a different syllable from general knowledge.
3. Explain Moon Nakshatra and Pada in simple, warm, accessible language. The parent is not an astrologer.
4. If the user asks about the correctiveness of their name, invoke check_name_correctness.
5. If the user asks about initials, invoke compute_initials.
6. If the user asks for name suggestions, invoke suggest_names.
7. Suggest 4-6 real baby name ideas (matching the stated gender if given, otherwise offer a mix) that genuinely start with the naming syllable above, with one line on each name's meaning.
8. Keep the tone like a knowledgeable, grounded astrologer, not a fortune-teller. No vague mysticism, no claims you can't support from the facts above.
9. If the parent asks about something not covered by the facts above (e.g. career, marriage timing, doshas), say plainly that this reading is focused on the Moon Nakshatra naming guidance and that you don't have that information from this chart.
10. Keep responses focused: a short explanation plus the name suggestions, not an essay.`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Server is missing GROQ_API_KEY. Add it in Vercel → Settings → Environment Variables.",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Malformed request body." });
    }
  }

  const { chart, messages, gender, enteredName } = body || {};
  if (!chart) return res.status(400).json({ error: "Missing chart data." });
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Missing conversation messages." });
  }
  if (messages.length > 40) {
    return res.status(400).json({ error: "Conversation is too long. Start a new chart." });
  }
  const tooLong = messages.some((m) => typeof m?.content === "string" && m.content.length > 2000);
  if (tooLong) {
    return res.status(400).json({ error: "Message is too long (max 2000 characters)." });
  }

  const grounded = buildGroundedFacts(chart, enteredName);
  if (!grounded.ok) {
    return res.status(422).json({ error: grounded.reason });
  }

  const system = systemPromptFor(grounded.facts, gender);
  const chatMessages = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const upstream = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        messages: [{ role: "system", content: system }, ...chatMessages],
        tools: TOOL_DEFINITIONS,
        function_call: "auto",
      }),
    });

    const payload = await upstream.json();

    if (!upstream.ok) {
      return res.status(502).json({
        error: "The AI reasoning service returned an error.",
        details: payload?.error?.message || payload,
      });
    }

    const firstMessage = payload.choices?.[0]?.message || {};
    if (firstMessage.function_call) {
      let toolResult;
      try {
        const args = JSON.parse(firstMessage.function_call.arguments || "{}");
        toolResult = executeTool(firstMessage.function_call.name, args);
      } catch (toolError) {
        return res.status(502).json({ error: `Tool execution failed: ${String(toolError.message)}` });
      }

      const followUp = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 700,
          messages: [
            { role: "system", content: system },
            ...chatMessages,
            { role: "assistant", content: "", function_call: firstMessage.function_call },
            { role: "function", name: firstMessage.function_call.name, content: JSON.stringify(toolResult) },
          ],
        }),
      });

      const followUpPayload = await followUp.json();
      if (!followUp.ok) {
        return res.status(502).json({
          error: "The AI reasoning service returned an error after tool execution.",
          details: followUpPayload?.error?.message || followUpPayload,
        });
      }

      const finalText = (followUpPayload.choices?.[0]?.message?.content || "").trim();
      return res.status(200).json({ reply: finalText, facts: grounded.facts, tool: { name: firstMessage.function_call.name, result: toolResult } });
    }

    const text = (firstMessage.content || "").trim();

    return res.status(200).json({ reply: text, facts: grounded.facts });
  } catch (err) {
    return res.status(502).json({
      error: "Couldn't reach the AI reasoning service. Try again in a moment.",
      details: String(err?.message || err),
    });
  }
};