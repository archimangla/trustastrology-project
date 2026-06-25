const { findNakshatra, getNamingSyllable } = require("../data/nakshatra-table");
const { findRashi, rashiNumbersByHouse } = require("../data/rashi-table");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

// ─── Planet -> sign rulership ─────────────────────────────────────────────────
// Each planet rules specific rashi IDs (by number 1-12).
const SIGN_RULERS = {
  1:  "Mars",    // Aries
  2:  "Venus",   // Taurus
  3:  "Mercury", // Gemini
  4:  "Moon",    // Cancer
  5:  "Sun",     // Leo
  6:  "Mercury", // Virgo
  7:  "Venus",   // Libra
  8:  "Mars",    // Scorpio
  9:  "Jupiter", // Sagittarius
  10: "Saturn",  // Capricorn
  11: "Saturn",  // Aquarius
  12: "Jupiter", // Pisces
};

// Benefic/malefic classification for house analysis
const BENEFICS = ["Jupiter", "Venus", "Mercury", "Moon"];
const MALEFICS = ["Saturn", "Mars", "Sun", "Rahu", "Ketu"];

// ─── Tool definitions (sent to Groq) ─────────────────────────────────────────

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
            description: "The name to check. If the user does not specify a different name, leave this empty and the chart name will be used.",
          },
        },
        required: [],
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
  {
    type: "function",
    function: {
      name: "get_wealth_reading",
      description:
        "Analyze the birth chart for wealth potential using Vedic Jyotish rules. Examines the 2nd and 11th house lords, benefic placements, Dhana Yogas, and key wealth nakshatras. Call this when the user asks about money, finances, income, wealth, or prosperity.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_marriage_reading",
      description:
        "Analyze the birth chart for marriage indicators using Vedic Jyotish rules. Examines the 7th house lord, Venus/Jupiter placement, Manglik Dosha, and marital yogas. Call this when the user asks about marriage, spouse, relationship, love life, or life partner.",
      parameters: {
        type: "object",
        properties: {
          gender: {
            type: "string",
            description: "Gender of the person whose chart is being read. Determines whether Venus or Jupiter is the marriage karaka.",
            enum: ["Male", "Female", "Unknown"],
          },
        },
        required: [],
      },
    },
  },
];

// ─── Shared helpers ───────────────────────────────────────────────────────────

function getMoon(chart) {
  return (chart.planets || []).find(
    (p) => String(p?.name || "").toLowerCase() === "moon"
  ) || null;
}

function getPlanet(chart, name) {
  const n = name.toLowerCase();
  return (chart.planets || []).find(
    (p) => String(p?.name || "").toLowerCase() === n
  ) || null;
}

// Returns array of planets in a given house number
function planetsInHouse(chart, houseNum) {
  return (chart.planets || []).filter((p) => Number(p?.houseNum) === houseNum);
}

// Given ascendant rashi number and a house number (1-12), returns the rashi ID in that house
function rashiInHouse(ascendantRashiNum, houseNum) {
  return (((ascendantRashiNum - 1) + (houseNum - 1)) % 12) + 1;
}

// Returns the ruling planet name for a rashi ID
function lordOf(rashiId) {
  return SIGN_RULERS[rashiId] || null;
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

// ─── Tool implementations ─────────────────────────────────────────────────────

function tool_get_naming_reading(chart) {
  return getNakshtraFacts(chart);
}

function tool_check_name_compatibility(chart, args) {
  const facts = getNakshtraFacts(chart);
  if (!facts.ok) return facts;

  const name = String(args.name || chart.name || "").trim();
  if (!name) return { ok: false, error: "No name found to check. Please provide a name." };

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

function tool_get_wealth_reading(chart) {
  const ascendant = chart.ascendant;
  if (!ascendant) return { ok: false, error: "Ascendant data missing from chart." };

  const ascRashiNum = Number(ascendant.rashiNum || ascendant.houseNum || 1);

  // Houses that matter for wealth
  const house2RashiId  = rashiInHouse(ascRashiNum, 2);
  const house5RashiId  = rashiInHouse(ascRashiNum, 5);
  const house9RashiId  = rashiInHouse(ascRashiNum, 9);
  const house11RashiId = rashiInHouse(ascRashiNum, 11);

  const lord2  = lordOf(house2RashiId);
  const lord11 = lordOf(house11RashiId);

  const lord2Planet  = lord2  ? getPlanet(chart, lord2)  : null;
  const lord11Planet = lord11 ? getPlanet(chart, lord11) : null;

  // Planets sitting directly in the 2nd and 11th houses
  const occupants2  = planetsInHouse(chart, 2).map((p) => p.name);
  const occupants11 = planetsInHouse(chart, 11).map((p) => p.name);

  // Benefics in wealth houses
  const beneficsIn2  = occupants2.filter((n)  => BENEFICS.includes(n));
  const beneficsIn11 = occupants11.filter((n) => BENEFICS.includes(n));

  // Dhana Yoga check: 2nd lord and 11th lord in same house
  const dhanYoga =
    lord2Planet && lord11Planet &&
    lord2Planet.houseNum !== undefined &&
    lord11Planet.houseNum !== undefined &&
    Number(lord2Planet.houseNum) === Number(lord11Planet.houseNum);

  // Chandra-Mangala Yoga: Moon and Mars in same house
  const moon = getMoon(chart);
  const mars = getPlanet(chart, "Mars");
  const chandraMangala =
    moon && mars &&
    Number(moon.houseNum) === Number(mars.houseNum);

  // Jupiter condition: is Jupiter in 2nd or 11th house?
  const jupiter = getPlanet(chart, "Jupiter");
  const jupiterInWealthHouse =
    jupiter && (Number(jupiter.houseNum) === 2 || Number(jupiter.houseNum) === 11);

  // Affliction check: are wealth lords in dusthana (6, 8, 12)?
  const dusthana = [6, 8, 12];
  const lord2Afflicted  = lord2Planet  && dusthana.includes(Number(lord2Planet.houseNum));
  const lord11Afflicted = lord11Planet && dusthana.includes(Number(lord11Planet.houseNum));

  // Moon nakshatra for artha pada check
  const moonNakFacts = getNakshtraFacts(chart);
  const wealthNakshatras = ["Rohini", "Pushya", "Dhanishta"];
  const moonInWealthNak =
    moonNakFacts.ok &&
    wealthNakshatras.some((n) =>
      moonNakFacts.moonNakshatra.toLowerCase().includes(n.toLowerCase())
    );

  return {
    ok: true,
    ascendantSign: ascendant.sign || ascendant.rashi,
    house2: {
      rashiId: house2RashiId,
      lord: lord2,
      lordHouse: lord2Planet ? Number(lord2Planet.houseNum) : null,
      lordNakshatra: lord2Planet ? lord2Planet.nakshatra : null,
      occupants: occupants2,
      benefics: beneficsIn2,
      lordAfflicted: lord2Afflicted,
    },
    house11: {
      rashiId: house11RashiId,
      lord: lord11,
      lordHouse: lord11Planet ? Number(lord11Planet.houseNum) : null,
      lordNakshatra: lord11Planet ? lord11Planet.nakshatra : null,
      occupants: occupants11,
      benefics: beneficsIn11,
      lordAfflicted: lord11Afflicted,
    },
    jupiter: {
      house: jupiter ? Number(jupiter.houseNum) : null,
      nakshatra: jupiter ? jupiter.nakshatra : null,
      inWealthHouse: jupiterInWealthHouse,
    },
    yogas: {
      dhanaYoga: dhanYoga,
      chandraMangalaYoga: chandraMangala,
    },
    moonInWealthNakshatra: moonInWealthNak,
    moonNakshatra: moonNakFacts.ok ? moonNakFacts.moonNakshatra : null,
  };
}

function tool_get_marriage_reading(chart, args, gender) {
  const ascendant = chart.ascendant;
  if (!ascendant) return { ok: false, error: "Ascendant data missing from chart." };

  const ascRashiNum = Number(ascendant.rashiNum || ascendant.houseNum || 1);

  const house7RashiId = rashiInHouse(ascRashiNum, 7);
  const lord7 = lordOf(house7RashiId);
  const lord7Planet = lord7 ? getPlanet(chart, lord7) : null;

  const occupants7 = planetsInHouse(chart, 7).map((p) => p.name);
  const beneficsIn7 = occupants7.filter((n) => BENEFICS.includes(n));
  const maleficsIn7 = occupants7.filter((n) => MALEFICS.includes(n));

  // Karaka: Venus for male charts, Jupiter for female charts
  const resolvedGender = args.gender || gender || "Unknown";
  const karakaName = resolvedGender === "Female" ? "Jupiter" : "Venus";
  const karaka = getPlanet(chart, karakaName);

  // Saturn in 7th = delay
  const saturnIn7 = occupants7.includes("Saturn");
  const saturn = getPlanet(chart, "Saturn");
  // Saturn aspecting 7th (Saturn aspects 3rd, 7th, 10th from its position)
  const saturnAspects7 =
    saturn &&
    !saturnIn7 &&
    (
      Number(saturn.houseNum) === 1 ||  // 7th is 7 away from 1st
      Number(saturn.houseNum) === 4 ||  // 4 + 3 = 7
      Number(saturn.houseNum) === 10    // 10 - 3 = 7
    );

  // Manglik Dosha: Mars in 1st, 4th, 7th, 8th, or 12th
  const mars = getPlanet(chart, "Mars");
  const manglikHouses = [1, 4, 7, 8, 12];
  const isManglik = mars && manglikHouses.includes(Number(mars.houseNum));

  // Moon nakshatra for marriage nakshatras check
  const moonNakFacts = getNakshtraFacts(chart);
  const marriageNakshatras = ["Uttara Phalguni", "Anuradha", "Rohini"];
  const moonInMarriageNak =
    moonNakFacts.ok &&
    marriageNakshatras.some((n) =>
      moonNakFacts.moonNakshatra.toLowerCase().includes(n.toLowerCase().replace(" ", ""))
    );

  // Wealth through marriage: 7th lord in 2nd or 11th house
  const wealthThroughMarriage =
    lord7Planet &&
    (Number(lord7Planet.houseNum) === 2 || Number(lord7Planet.houseNum) === 11);

  // Venus in 7th also = wealth through marriage
  const venusIn7 = occupants7.includes("Venus");

  return {
    ok: true,
    gender: resolvedGender,
    ascendantSign: ascendant.sign || ascendant.rashi,
    house7: {
      rashiId: house7RashiId,
      lord: lord7,
      lordHouse: lord7Planet ? Number(lord7Planet.houseNum) : null,
      lordNakshatra: lord7Planet ? lord7Planet.nakshatra : null,
      occupants: occupants7,
      benefics: beneficsIn7,
      malefics: maleficsIn7,
    },
    karaka: {
      planet: karakaName,
      house: karaka ? Number(karaka.houseNum) : null,
      nakshatra: karaka ? karaka.nakshatra : null,
      sign: karaka ? (karaka.sign || karaka.rashi) : null,
    },
    doshas: {
      manglikDosha: isManglik,
      marsHouse: mars ? Number(mars.houseNum) : null,
      saturnDelaysMarriage: saturnIn7 || saturnAspects7,
      saturnHouse: saturn ? Number(saturn.houseNum) : null,
    },
    yogas: {
      beneficsIn7th: beneficsIn7.length > 0,
      wealthThroughMarriage: wealthThroughMarriage || venusIn7,
      lord7InFulfillmentHouse: lord7Planet && Number(lord7Planet.houseNum) === 11,
    },
    moonInMarriageNakshatra: moonInMarriageNak,
    moonNakshatra: moonNakFacts.ok ? moonNakFacts.moonNakshatra : null,
  };
}

function runTool(toolName, args, chart, gender) {
  if (toolName === "get_naming_reading")      return tool_get_naming_reading(chart);
  if (toolName === "check_name_compatibility") return tool_check_name_compatibility(chart, args);
  if (toolName === "suggest_names")           return tool_suggest_names(chart, args, gender);
  if (toolName === "get_wealth_reading")      return tool_get_wealth_reading(chart);
  if (toolName === "get_marriage_reading")    return tool_get_marriage_reading(chart, args, gender);
  return { error: `Unknown tool: ${toolName}` };
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert Vedic (Jyotish) astrologer. The user has submitted their birth details and a D1 birth chart has been cast for them. Their name as entered on the form is available in the chart data.

You have five tools available. Use them whenever the user's question involves:
- Their Moon Nakshatra or naming initial (get_naming_reading)
- Whether a specific name suits them (check_name_compatibility)
- Name suggestions based on their chart (suggest_names)
- Money, wealth, finances, income, or prosperity (get_wealth_reading)
- Marriage, spouse, life partner, or relationships (get_marriage_reading)

Always call the relevant tool first. Never guess or state astrological data from your own training without calling a tool.

Important: if the user asks whether their name aligns with their chart, or asks about name compatibility without specifying a different name, call check_name_compatibility without a name argument. The tool will automatically use the name they entered on the form. Do not ask them for their name again.

After getting tool results, explain them in plain, warm language. No jargon unless you explain it. No vague mysticism.

For name compatibility: be honest but sensitive. If the name does not match, explain what that means in Vedic tradition without being alarming.

For name suggestions: suggest 4 to 6 real names with one line on each name's meaning. Names must start with the syllable from the tool result.

For wealth readings: interpret the 2nd and 11th house lords, benefic placements, and any Dhana or Chandra-Mangala Yogas the tool found. If lords are in dusthana (6th, 8th, or 12th), mention that as a challenge but not a permanent barrier. Mention Jupiter's condition as the wealth karaka.

For marriage readings: interpret the 7th house condition, the karaka planet (Venus for male, Jupiter for female), any Manglik Dosha, and Saturn's influence. If Manglik Dosha is present, explain it calmly without alarming the user. If Saturn delays marriage, frame it as marrying after careful discernment, not as misfortune. Mention if the chart shows wealth through marriage.

Keep readings grounded. Do not make absolute predictions. Frame insights as tendencies and patterns in the chart.`;

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

    // ── No tool call: LLM replied directly ───────────────────────────────────
    if (!message1?.tool_calls || message1.tool_calls.length === 0) {
      return res.status(200).json({ reply: (message1?.content || "").trim() });
    }

    // ── Tool call: run it, feed result back ───────────────────────────────────
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