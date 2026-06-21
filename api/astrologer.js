const { findNakshatra, getNamingSyllable } = require("../data/nakshatra-table");
const { findRashi } = require("../data/rashi-table");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

function findPlanet(chart, planetName) {
  const list = Array.isArray(chart?.planets) ? chart.planets : [];
  return list.find((p) => String(p?.name || "").toLowerCase() === planetName.toLowerCase()) || null;
}

function buildGroundedFacts(chart) {
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

  return {
    ok: true,
    facts: {
      childName: chart?.name || null,
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
- Moon Nakshatra: ${facts.moonNakshatra}
- Moon Pada (quarter): ${facts.moonPada}
- Naming syllable (Naam Akshar) for this exact nakshatra + pada: "${facts.namingSyllable}"
- All four pada syllables within ${facts.moonNakshatra} (for context only): ${facts.allPadaSyllablesForNakshatra.join(", ")}
- Moon sign (Rashi): ${facts.moonSign || "not provided"}
- Ascendant sign: ${facts.ascendantSign || "not provided"}
${genderNote}

Rules:
1. Only state chart facts that appear above. Never invent planetary positions, dashas, doshas, or other chart details that weren't given to you.
2. The naming syllable above is the authoritative answer for "what should the name start with." Don't override it with a different syllable from general knowledge.
3. Explain Moon Nakshatra and Pada in simple, warm, accessible language. The parent is not an astrologer.
4. Suggest 4-6 real baby name ideas (matching the stated gender if given, otherwise offer a mix) that genuinely start with the naming syllable above, with one line on each name's meaning.
5. Keep the tone like a knowledgeable, grounded astrologer, not a fortune-teller. No vague mysticism, no claims you can't support from the facts above.
6. If the parent asks about something not covered by the facts above (e.g. career, marriage timing, doshas), say plainly that this reading is focused on the Moon Nakshatra naming guidance and that you don't have that information from this chart.
7. Keep responses focused: a short explanation plus the name suggestions, not an essay.`;
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

  const { chart, messages, gender } = body || {};
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

  const grounded = buildGroundedFacts(chart);
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
      }),
    });

    const payload = await upstream.json();

    if (!upstream.ok) {
      return res.status(502).json({
        error: "The AI reasoning service returned an error.",
        details: payload?.error?.message || payload,
      });
    }

    const text = (payload.choices?.[0]?.message?.content || "").trim();

    return res.status(200).json({ reply: text, facts: grounded.facts });
  } catch (err) {
    return res.status(502).json({
      error: "Couldn't reach the AI reasoning service. Try again in a moment.",
      details: String(err?.message || err),
    });
  }
};