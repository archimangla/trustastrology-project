const { findNakshatra, getNamingSyllable } = require("../data/nakshatra-table");
const { findRashi, rashiNumbersByHouse } = require("../data/rashi-table");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

// ─── Static lookup tables ─────────────────────────────────────────────────────

const SIGN_RULERS = {
  1: "Mars", 2: "Venus", 3: "Mercury", 4: "Moon", 5: "Sun", 6: "Mercury",
  7: "Venus", 8: "Mars", 9: "Jupiter", 10: "Saturn", 11: "Saturn", 12: "Jupiter",
};

const NAKSHATRA_RULERS = {
  "Ashwini": "Ketu", "Bharani": "Venus", "Krittika": "Sun",
  "Rohini": "Moon", "Mrigashira": "Mars", "Ardra": "Rahu",
  "Punarvasu": "Jupiter", "Pushya": "Saturn", "Ashlesha": "Mercury",
  "Magha": "Ketu", "Purva Phalguni": "Venus", "Uttara Phalguni": "Sun",
  "Hasta": "Moon", "Chitra": "Mars", "Swati": "Rahu",
  "Vishakha": "Jupiter", "Anuradha": "Saturn", "Jyeshtha": "Mercury",
  "Mula": "Ketu", "Purva Ashadha": "Venus", "Uttara Ashadha": "Sun",
  "Shravana": "Moon", "Dhanishta": "Mars", "Shatabhisha": "Rahu",
  "Purva Bhadrapada": "Jupiter", "Uttara Bhadrapada": "Saturn", "Revati": "Mercury",
};

const DASHA_YEARS = {
  Ketu: 7, Venus: 20, Sun: 6, Moon: 10, Mars: 7,
  Rahu: 18, Jupiter: 16, Saturn: 19, Mercury: 17,
};

const BENEFICS = ["Jupiter", "Venus", "Mercury", "Moon"];
const MALEFICS = ["Saturn", "Mars", "Sun", "Rahu", "Ketu"];

// ─── Chart navigation helpers ─────────────────────────────────────────────────

function getPlanet(chart, name) {
  const n = name.toLowerCase();
  return (chart.planets || []).find((p) => String(p?.name || "").toLowerCase() === n) || null;
}

function getMoon(chart) { return getPlanet(chart, "Moon"); }

function planetsInHouse(chart, houseNum) {
  return (chart.planets || []).filter((p) => Number(p?.houseNum) === houseNum);
}

function rashiInHouse(ascRashiNum, houseNum) {
  return (((ascRashiNum - 1) + (houseNum - 1)) % 12) + 1;
}

function lordOf(rashiId) { return SIGN_RULERS[rashiId] || null; }

function getAscRashiNum(chart) {
  const asc = chart.ascendant;
  if (!asc) return null;
  if (asc.rashiNum) return Number(asc.rashiNum);
  const r = findRashi(asc.sign || asc.rashi);
  return r ? r.id : null;
}

function elementOf(rashiId) {
  if ([1, 5, 9].includes(rashiId))  return "Fire";
  if ([2, 6, 10].includes(rashiId)) return "Earth";
  if ([3, 7, 11].includes(rashiId)) return "Air";
  if ([4, 8, 12].includes(rashiId)) return "Water";
  return "Unknown";
}

function birthDashaRuler(chart) {
  const moon = getMoon(chart);
  if (!moon) return null;
  const nak = findNakshatra(moon.nakshatra);
  if (!nak) return null;
  return NAKSHATRA_RULERS[nak.name] || null;
}

function dashaSequence(startRuler) {
  const order = ["Ketu","Venus","Sun","Moon","Mars","Rahu","Jupiter","Saturn","Mercury"];
  const idx = order.indexOf(startRuler);
  if (idx === -1) return order;
  return [...order.slice(idx), ...order.slice(0, idx)];
}

// ─── Naming tools ─────────────────────────────────────────────────────────────

function getNakshtraFacts(chart) {
  const moon = getMoon(chart);
  if (!moon) return { ok: false, error: "Moon not found in chart data." };
  const nakEntry = findNakshatra(moon.nakshatra);
  if (!nakEntry) return { ok: false, error: `Moon Nakshatra "${moon.nakshatra}" not recognized.` };
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

function tool_get_naming_reading(chart) { return getNakshtraFacts(chart); }

function tool_check_name_compatibility(chart, args, userName) {
  const facts = getNakshtraFacts(chart);
  if (!facts.ok) return facts;
  const name = String(args.name || userName || "").trim();
  if (!name) return { ok: false, error: "No name found to check." };
  const syllable = facts.namingSyllable || "";
  return {
    ok: true, name,
    isCompatible: syllable ? name.toLowerCase().startsWith(syllable.toLowerCase()) : false,
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

// ─── Marriage tools ───────────────────────────────────────────────────────────

function tool_get_marriage_timing(chart, args, gender) {
  const ascRashiNum = getAscRashiNum(chart);
  if (!ascRashiNum) return { ok: false, error: "Ascendant data missing." };

  const house7RashiId = rashiInHouse(ascRashiNum, 7);
  const lord7 = lordOf(house7RashiId);
  const lord7Planet = lord7 ? getPlanet(chart, lord7) : null;
  const occupants7 = planetsInHouse(chart, 7).map((p) => p.name);

  const saturn = getPlanet(chart, "Saturn");
  const rahu   = getPlanet(chart, "Rahu");

  const saturnIn7 = occupants7.includes("Saturn");
  const rahuIn7   = occupants7.includes("Rahu");
  const lord7InDusthana = lord7Planet && [6, 8, 12].includes(Number(lord7Planet.houseNum));
  const saturnAspects7 = saturn && !saturnIn7 && [1, 4, 10].includes(Number(saturn.houseNum));

  const resolvedGender = args.gender || gender || "Unknown";
  const marriageActivators = [...new Set(["Venus", lord7, resolvedGender === "Female" ? "Jupiter" : null].filter(Boolean))];

  const startRuler = birthDashaRuler(chart);
  const sequence   = startRuler ? dashaSequence(startRuler) : [];
  const marriageDashas = sequence.filter((p) => marriageActivators.includes(p));

  const lateIndicators  = [];
  const earlyIndicators = [];
  if (saturnIn7 || saturnAspects7) lateIndicators.push("Saturn influences 7th -- marriage after age 28-30");
  if (rahuIn7) lateIndicators.push("Rahu in 7th -- unconventional or delayed union");
  if (lord7InDusthana) lateIndicators.push("7th lord in dusthana -- obstacles before settling");
  if (occupants7.includes("Jupiter")) earlyIndicators.push("Jupiter in 7th -- auspicious, timely marriage");
  if (occupants7.includes("Venus"))   earlyIndicators.push("Venus in 7th -- early and harmonious marriage");

  return {
    ok: true,
    house7Lord: lord7,
    house7LordPosition: lord7Planet ? Number(lord7Planet.houseNum) : null,
    occupantsIn7th: occupants7,
    delayIndicators: lateIndicators,
    favorsEarlyMarriage: earlyIndicators,
    marriageActivatingDashas: marriageDashas,
    dashaSequenceFromBirth: sequence.slice(0, 5),
    note: "Marriage typically triggers during Venus, 7th lord, or Jupiter dasha/antardasha.",
  };
}

function tool_get_spouse_traits(chart, args, gender) {
  const ascRashiNum = getAscRashiNum(chart);
  if (!ascRashiNum) return { ok: false, error: "Ascendant data missing." };

  const house7RashiId = rashiInHouse(ascRashiNum, 7);
  const house7Element = elementOf(house7RashiId);
  const lord7 = lordOf(house7RashiId);
  const lord7Planet = lord7 ? getPlanet(chart, lord7) : null;
  const lord7Nakshatra = lord7Planet ? findNakshatra(lord7Planet.nakshatra) : null;
  const lord7NakRuler  = lord7Nakshatra ? NAKSHATRA_RULERS[lord7Nakshatra.name] : null;

  const resolvedGender = args.gender || gender || "Unknown";
  const karakaName = resolvedGender === "Female" ? "Jupiter" : "Venus";
  const karaka = getPlanet(chart, karakaName);

  const spouseSignTraits = {
    Fire:  "energetic, ambitious, confident, quick-tempered, athletic build",
    Earth: "grounded, practical, loyal, patient, sturdy build",
    Air:   "intellectual, communicative, social, curious, slim build",
    Water: "emotional, intuitive, nurturing, artistic, soft features",
  };

  const meetingHouseClue = {
    1: "through personal circles or a chance encounter", 2: "through family or financial connection",
    3: "through siblings, neighbors, or short travel", 4: "through home or hometown circles",
    5: "through romance, creative pursuit, or college", 6: "through workplace or service setting",
    7: "partner may seek you out first", 8: "through sudden or unconventional circumstances",
    9: "through higher education, travel abroad, or spiritual setting",
    10: "through career or public life", 11: "through friends or social groups",
    12: "through foreign lands or spiritual retreat",
  };

  return {
    ok: true,
    spouseElement: house7Element,
    spouseTemperament: spouseSignTraits[house7Element] || "balanced nature",
    house7Lord: lord7,
    lord7House: lord7Planet ? Number(lord7Planet.houseNum) : null,
    lord7Nakshatra: lord7Nakshatra ? lord7Nakshatra.name : null,
    lord7NakshatraRuler: lord7NakRuler,
    marriageKaraka: { planet: karakaName, house: karaka ? Number(karaka.houseNum) : null, nakshatra: karaka ? karaka.nakshatra : null },
    howYouMeet: lord7Planet ? (meetingHouseClue[Number(lord7Planet.houseNum)] || "varied circumstances") : "unclear",
    occupantsIn7th: planetsInHouse(chart, 7).map((p) => p.name),
  };
}

function tool_check_manglik_dosha(chart) {
  const mars = getPlanet(chart, "Mars");
  if (!mars) return { ok: false, error: "Mars not found in chart." };

  const marsHouse = Number(mars.houseNum);
  const isManglik = [1, 4, 7, 8, 12].includes(marsHouse);

  const cancellations = [];
  const marsSignNum = Number(mars.rashiNum);
  if (marsSignNum === 1 || marsSignNum === 8) cancellations.push("Mars in own sign (Aries/Scorpio) -- dosha reduced");
  if (marsSignNum === 10) cancellations.push("Mars exalted in Capricorn -- dosha greatly reduced");

  const jupiter = getPlanet(chart, "Jupiter");
  if (jupiter) {
    const jh = Number(jupiter.houseNum);
    if ([(jh + 4) % 12 || 12, (jh + 6) % 12 || 12, (jh + 8) % 12 || 12].includes(marsHouse)) {
      cancellations.push("Jupiter aspects Mars -- dosha softened");
    }
  }

  let severity = "None";
  if (isManglik && cancellations.length === 0) severity = "High";
  else if (isManglik) severity = "Moderate (partial cancellation applies)";

  return {
    ok: true, isManglik, marsHouse,
    marsSign: mars.sign || mars.rashi || null,
    marsNakshatra: mars.nakshatra || null,
    severity, cancellations,
    partnerNote: isManglik
      ? "Vedic tradition recommends matching with a Manglik partner or performing Kuja Dosha shanti puja."
      : "No Manglik Dosha. Mars placement is compatible with most partners.",
  };
}

function tool_get_marriage_quality(chart) {
  const ascRashiNum = getAscRashiNum(chart);
  if (!ascRashiNum) return { ok: false, error: "Ascendant data missing." };

  const house7RashiId = rashiInHouse(ascRashiNum, 7);
  const lord7 = lordOf(house7RashiId);
  const lord7Planet = lord7 ? getPlanet(chart, lord7) : null;
  const occupants7 = planetsInHouse(chart, 7).map((p) => p.name);

  const house8RashiId = rashiInHouse(ascRashiNum, 8);
  const lord8 = lordOf(house8RashiId);
  const lord8Planet = lord8 ? getPlanet(chart, lord8) : null;
  const occupants8 = planetsInHouse(chart, 8).map((p) => p.name);

  const harmonyFactors  = [];
  const conflictFactors = [];
  const divorceRisk     = [];

  const beneficsIn7 = occupants7.filter((n) => BENEFICS.includes(n));
  const maleficsIn7 = occupants7.filter((n) => MALEFICS.includes(n));

  if (beneficsIn7.length > 0) harmonyFactors.push(`${beneficsIn7.join(", ")} in 7th -- warmth and happiness in marriage`);
  if (maleficsIn7.length > 0) conflictFactors.push(`${maleficsIn7.join(", ")} in 7th -- friction or power struggles`);
  if (lord7Planet && [2, 4, 11].includes(Number(lord7Planet.houseNum))) harmonyFactors.push(`7th lord in house ${lord7Planet.houseNum} -- stable, supportive marriage`);
  if (lord7Planet && [6, 8, 12].includes(Number(lord7Planet.houseNum))) conflictFactors.push(`7th lord in dusthana (house ${lord7Planet.houseNum}) -- struggles or separation risk`);

  if (occupants7.includes("Rahu")) divorceRisk.push("Rahu in 7th -- unconventional marriage, separation possible");
  if (maleficsIn7.length >= 2) divorceRisk.push("Multiple malefics in 7th -- significant marital stress");
  if (lord7Planet && Number(lord7Planet.houseNum) === 12) divorceRisk.push("7th lord in 12th -- emotional distance or separation");
  if (lord7Planet && Number(lord7Planet.houseNum) === 6)  divorceRisk.push("7th lord in 6th -- disputes and legal friction possible");

  const remarriagePossible = [3, 6, 9, 12].includes(house7RashiId);

  return {
    ok: true,
    house7Lord: lord7,
    lord7Position: lord7Planet ? Number(lord7Planet.houseNum) : null,
    occupantsIn7th: occupants7,
    harmonyFactors, conflictFactors, divorceRiskIndicators: divorceRisk,
    remarriagePossible,
    house8Lord: lord8, lord8Position: lord8Planet ? Number(lord8Planet.houseNum) : null, house8Occupants: occupants8,
    summary: divorceRisk.length === 0 ? "Chart supports a stable, long-lasting marriage." : "Some challenges in marital stability -- awareness and effort help greatly.",
  };
}

function tool_get_children_reading(chart, args, gender) {
  const ascRashiNum = getAscRashiNum(chart);
  if (!ascRashiNum) return { ok: false, error: "Ascendant data missing." };

  const house5RashiId = rashiInHouse(ascRashiNum, 5);
  const lord5 = lordOf(house5RashiId);
  const lord5Planet = lord5 ? getPlanet(chart, lord5) : null;
  const occupants5 = planetsInHouse(chart, 5).map((p) => p.name);

  const jupiter = getPlanet(chart, "Jupiter");
  const jupiterHouse = jupiter ? Number(jupiter.houseNum) : null;

  const favorableFactors = [];
  const obstacleFactors  = [];

  const beneficsIn5 = occupants5.filter((n) => BENEFICS.includes(n));
  const maleficsIn5 = occupants5.filter((n) => MALEFICS.includes(n));

  if (beneficsIn5.length > 0) favorableFactors.push(`${beneficsIn5.join(", ")} in 5th -- blessed with children`);
  if (maleficsIn5.includes("Saturn")) obstacleFactors.push("Saturn in 5th -- delayed parenthood, fewer children");
  if (maleficsIn5.includes("Ketu")) obstacleFactors.push("Ketu in 5th -- karmic lessons around children");
  if (maleficsIn5.includes("Rahu")) obstacleFactors.push("Rahu in 5th -- unconventional circumstances around children");
  if (lord5Planet && [2, 4, 11].includes(Number(lord5Planet.houseNum))) favorableFactors.push(`5th lord in house ${lord5Planet.houseNum} -- strong children prospects`);
  if (lord5Planet && [6, 8, 12].includes(Number(lord5Planet.houseNum))) obstacleFactors.push(`5th lord in dusthana (${lord5Planet.houseNum}) -- challenges in having children`);
  if (jupiterHouse && ![6, 8, 12].includes(jupiterHouse)) favorableFactors.push(`Jupiter in house ${jupiterHouse} -- blesses parenthood`);

  return {
    ok: true,
    house5Lord: lord5,
    lord5Position: lord5Planet ? Number(lord5Planet.houseNum) : null,
    occupantsIn5th: occupants5,
    favorableFactors, obstacleFactors,
    jupiterHouse,
    multipleChildrenPossible: [3, 6, 9, 12].includes(house5RashiId),
    note: "5th house governs children, creativity, and intelligence. Jupiter is the primary karaka for children.",
  };
}

// ─── Wealth tools ─────────────────────────────────────────────────────────────

function tool_get_wealth_potential(chart, d2) {
  const ascRashiNum = getAscRashiNum(chart);
  if (!ascRashiNum) return { ok: false, error: "Ascendant data missing." };

  const house2RashiId  = rashiInHouse(ascRashiNum, 2);
  const house11RashiId = rashiInHouse(ascRashiNum, 11);
  const lord2  = lordOf(house2RashiId);
  const lord11 = lordOf(house11RashiId);
  const lord2Planet  = lord2  ? getPlanet(chart, lord2)  : null;
  const lord11Planet = lord11 ? getPlanet(chart, lord11) : null;

  const occupants2  = planetsInHouse(chart, 2).map((p) => p.name);
  const occupants11 = planetsInHouse(chart, 11).map((p) => p.name);

  const jupiter = getPlanet(chart, "Jupiter");
  const venus   = getPlanet(chart, "Venus");
  const moon    = getMoon(chart);
  const mars    = getPlanet(chart, "Mars");

  const dhanYoga = lord2Planet && lord11Planet && Number(lord2Planet.houseNum) === Number(lord11Planet.houseNum);
  const chandraMangala = moon && mars && Number(moon.houseNum) === Number(mars.houseNum);
  const venusSignNum = venus ? Number(venus.rashiNum) : null;
  const lakshmiyoga = venusSignNum && [2, 7, 12].includes(venusSignNum);

  const moonNak = moon ? findNakshatra(moon.nakshatra) : null;
  const wealthNaks = ["Rohini", "Pushya", "Dhanishta"];
  const moonInWealthNak = moonNak && wealthNaks.some((w) => moonNak.name.includes(w));

  return {
    ok: true,
    house2: { lord: lord2, lordHouse: lord2Planet ? Number(lord2Planet.houseNum) : null, occupants: occupants2, benefics: occupants2.filter((n) => BENEFICS.includes(n)), lordAfflicted: lord2Planet && [6, 8, 12].includes(Number(lord2Planet.houseNum)) },
    house11: { lord: lord11, lordHouse: lord11Planet ? Number(lord11Planet.houseNum) : null, occupants: occupants11, benefics: occupants11.filter((n) => BENEFICS.includes(n)), lordAfflicted: lord11Planet && [6, 8, 12].includes(Number(lord11Planet.houseNum)) },
    yogas: { dhanaYoga: dhanYoga, chandraMangalaYoga: chandraMangala, lakshmiyoga },
    jupiter: { house: jupiter ? Number(jupiter.houseNum) : null, nakshatra: jupiter ? jupiter.nakshatra : null },
    venus: { house: venus ? Number(venus.houseNum) : null, sign: venus ? (venus.sign || venus.rashi) : null },
    moonInWealthNakshatra: moonInWealthNak, moonNakshatra: moonNak ? moonNak.name : null,
    d2Available: !!d2,
    d2AscendantSign: d2 ? (d2.ascendant?.sign || d2.ascendant?.rashi || null) : null,
    note: d2 ? "D2 (Hora chart) loaded -- ascendant sign confirms wealth accumulation tendency." : "D2 chart not yet loaded. Wealth read from D1 only.",
  };
}

function tool_get_wealth_timing(chart) {
  const ascRashiNum = getAscRashiNum(chart);
  if (!ascRashiNum) return { ok: false, error: "Ascendant data missing." };

  const house2RashiId  = rashiInHouse(ascRashiNum, 2);
  const house11RashiId = rashiInHouse(ascRashiNum, 11);
  const lord2  = lordOf(house2RashiId);
  const lord11 = lordOf(house11RashiId);

  const startRuler = birthDashaRuler(chart);
  const sequence   = startRuler ? dashaSequence(startRuler) : [];

  const wealthTriggers = [...new Set(["Jupiter", "Venus", lord2, lord11].filter(Boolean))];

  let cum = 0;
  const timeline = [];
  for (const planet of sequence) {
    const years = DASHA_YEARS[planet] || 0;
    timeline.push({ planet, fromAge: cum, toAge: cum + years, wealthActivating: wealthTriggers.includes(planet) });
    cum += years;
    if (cum > 120) break;
  }

  return {
    ok: true,
    wealthActivatingPlanets: wealthTriggers,
    dashaTimeline: timeline,
    peakWealthPeriods: timeline.filter((t) => t.wealthActivating),
    note: "Ages are from birth. Exact timing depends on partial dasha balance at birth (Moon longitude). Consult an astrologer for precise years.",
  };
}

function tool_get_income_sources(chart) {
  const ascRashiNum = getAscRashiNum(chart);
  if (!ascRashiNum) return { ok: false, error: "Ascendant data missing." };

  const house10RashiId = rashiInHouse(ascRashiNum, 10);
  const lord10 = lordOf(house10RashiId);
  const lord10Planet = lord10 ? getPlanet(chart, lord10) : null;
  const occupants10 = planetsInHouse(chart, 10).map((p) => p.name);
  const occupants11 = planetsInHouse(chart, 11).map((p) => p.name);

  const professionSignifiers = {
    Sun:     "government, politics, authority, medicine, administration",
    Moon:    "public dealings, hospitality, tourism, food, nursing, real estate",
    Mars:    "engineering, military, sports, real estate, surgery, police",
    Mercury: "business, communication, IT, writing, accounting, commerce",
    Jupiter: "teaching, law, finance, consulting, spirituality, medicine",
    Venus:   "arts, fashion, entertainment, luxury goods, beauty, hospitality",
    Saturn:  "industry, mining, agriculture, law enforcement, construction, research",
    Rahu:    "technology, foreign companies, unconventional or disruptive fields",
    Ketu:    "research, spirituality, alternative medicine, programming, occult",
  };

  const sun = getPlanet(chart, "Sun");
  const jupiter = getPlanet(chart, "Jupiter");
  const rahu = getPlanet(chart, "Rahu");
  const rahuHouse = rahu ? Number(rahu.houseNum) : null;

  return {
    ok: true,
    house10Lord: lord10,
    lord10House: lord10Planet ? Number(lord10Planet.houseNum) : null,
    occupantsIn10th: occupants10,
    professionsFromPlanetsIn10th: occupants10.map((p) => ({ planet: p, fields: professionSignifiers[p] || "varied" })),
    professionFrom10thLord: lord10 ? { planet: lord10, fields: professionSignifiers[lord10] || "varied" } : null,
    leadershipIndicator: (sun && [1, 10].includes(Number(sun.houseNum))) || (jupiter && [1, 10].includes(Number(jupiter.houseNum))),
    multipleIncomeStreams: occupants11.length >= 2 || occupants11.includes("Rahu"),
    foreignIncomeIndicator: rahuHouse && [9, 10, 11, 12].includes(rahuHouse),
    note: "10th house shows career type. 2nd house shows accumulated savings. 11th house shows gains and income streams.",
  };
}

function tool_get_financial_challenges(chart) {
  const ascRashiNum = getAscRashiNum(chart);
  if (!ascRashiNum) return { ok: false, error: "Ascendant data missing." };

  const house6RashiId  = rashiInHouse(ascRashiNum, 6);
  const house8RashiId  = rashiInHouse(ascRashiNum, 8);
  const house12RashiId = rashiInHouse(ascRashiNum, 12);
  const lord6  = lordOf(house6RashiId);
  const lord8  = lordOf(house8RashiId);
  const lord12 = lordOf(house12RashiId);
  const lord6Planet  = lord6  ? getPlanet(chart, lord6)  : null;
  const lord8Planet  = lord8  ? getPlanet(chart, lord8)  : null;
  const lord12Planet = lord12 ? getPlanet(chart, lord12) : null;

  const occupants6  = planetsInHouse(chart, 6).map((p) => p.name);
  const occupants8  = planetsInHouse(chart, 8).map((p) => p.name);
  const occupants12 = planetsInHouse(chart, 12).map((p) => p.name);

  const challenges  = [];
  const protections = [];

  if (occupants6.includes("Rahu")) challenges.push("Rahu in 6th -- chronic debts or hidden enemies affecting finances");
  if (lord6Planet && [2, 11].includes(Number(lord6Planet.houseNum))) challenges.push("6th lord in wealth house -- debts eat into income");
  if (occupants8.includes("Saturn")) challenges.push("Saturn in 8th -- slow grinding financial setbacks or delays in inheritance");
  if (occupants8.includes("Mars"))   challenges.push("Mars in 8th -- sudden expenses, accidents, or joint asset disputes");
  if (occupants12.includes("Saturn")) challenges.push("Saturn in 12th -- heavy expenses, foreign losses, isolation costs");
  if (occupants12.includes("Rahu"))   challenges.push("Rahu in 12th -- mysterious losses or uncontrolled foreign expenditure");

  const jupiter = getPlanet(chart, "Jupiter");
  const venus   = getPlanet(chart, "Venus");
  if (jupiter && [1, 2, 5, 9, 11].includes(Number(jupiter.houseNum))) protections.push(`Jupiter in house ${jupiter.houseNum} -- strong financial protection`);
  if (venus && [2, 11].includes(Number(venus.houseNum))) protections.push(`Venus in house ${venus.houseNum} -- wealth accumulation supported`);

  const inheritanceIndicator = occupants8.some((p) => BENEFICS.includes(p));
  if (inheritanceIndicator) protections.push("Benefic in 8th -- inheritance or unexpected gains possible");

  return {
    ok: true,
    challenges, protections,
    dusthanaOccupants: { house6: occupants6, house8: occupants8, house12: occupants12 },
    inheritancePossible: inheritanceIndicator,
    note: "6th = debts and enemies, 8th = sudden events and joint assets, 12th = losses and expenditure.",
  };
}

function tool_get_overall_prosperity(chart) {
  const ascRashiNum = getAscRashiNum(chart);
  if (!ascRashiNum) return { ok: false, error: "Ascendant data missing." };

  const jupiter = getPlanet(chart, "Jupiter");
  const saturn  = getPlanet(chart, "Saturn");
  const moon    = getMoon(chart);
  const ketu    = getPlanet(chart, "Ketu");

  const jupiterStrong = jupiter && [1, 2, 4, 5, 7, 9, 10, 11].includes(Number(jupiter.houseNum));
  const saturnHardWork = saturn && [3, 6, 11].includes(Number(saturn.houseNum));
  const moonStrong = moon && [1, 2, 4, 10, 11].includes(Number(moon.houseNum));
  const spiritualWealth = ketu && [1, 5, 9].includes(Number(ketu.houseNum));

  let score = 0;
  if (jupiterStrong) score += 3;
  if (saturnHardWork) score += 2;
  if (moonStrong) score += 1;
  if (spiritualWealth) score += 1;

  const tier = score >= 5 ? "Strong" : score >= 3 ? "Moderate" : "Needs remedies and focused effort";

  const house4Occupants = planetsInHouse(chart, 4).map((p) => p.name);
  const house11RashiId  = rashiInHouse(ascRashiNum, 11);
  const lord11 = lordOf(house11RashiId);
  const lord11Planet = lord11 ? getPlanet(chart, lord11) : null;

  return {
    ok: true,
    overallProsperityTier: tier,
    prosperityScore: score,
    factors: { jupiterStrong, saturnHardWork, moonStrong, spiritualWealth },
    propertyWealth: house4Occupants.some((p) => ["Jupiter", "Venus", "Moon"].includes(p)),
    retirementWealthStrong: lord11Planet && [1, 2, 5, 9, 10, 11].includes(Number(lord11Planet.houseNum)),
    note: "Prosperity builds in phases across dashas. Jupiter and Saturn dashas are the primary turning points for long-term accumulation.",
  };
}

// Career tools
const NAK_CAREER_FIELD = {
  "Ashwini":           { field: "Medicine, sports, athletics, rapid response roles", element: "Service & Healing" },
  "Bharani":           { field: "Law, finance, entertainment, bold creative work", element: "Creative & Business" },
  "Krittika":          { field: "Military, government, surgery, leadership roles", element: "Leadership & Admin" },
  "Rohini":            { field: "Arts, luxury goods, agriculture, real estate, hospitality", element: "Creative & Business" },
  "Mrigashira":        { field: "Research, writing, travel, sales, textiles", element: "Analytical & Technical" },
  "Ardra":             { field: "IT, research, data analysis, storm or crisis management", element: "Analytical & Technical" },
  "Punarvasu":         { field: "Teaching, publishing, counseling, architecture, restoration", element: "Service & Healing" },
  "Pushya":            { field: "Banking, administration, food, nursing, social work", element: "Leadership & Admin" },
  "Ashlesha":          { field: "Chemicals, medicine, intelligence services, psychology", element: "Analytical & Technical" },
  "Magha":             { field: "Politics, management, heritage, executive roles", element: "Leadership & Admin" },
  "Purva Phalguni":    { field: "Media, entertainment, luxury, beauty, music, diplomacy", element: "Creative & Business" },
  "Uttara Phalguni":   { field: "Social service, management, contracts, public relations", element: "Leadership & Admin" },
  "Hasta":             { field: "Healing, therapy, crafts, printing, precision work", element: "Service & Healing" },
  "Chitra":            { field: "Engineering, architecture, design, jewelry, film making", element: "Analytical & Technical" },
  "Swati":             { field: "Business, trading, sales, law, diplomacy, technology", element: "Creative & Business" },
  "Vishakha":          { field: "Research, politics, focused expertise, biochemistry, activism", element: "Leadership & Admin" },
  "Anuradha":          { field: "Foreign relations, organizational leadership, mass media", element: "Leadership & Admin" },
  "Jyeshtha":          { field: "Administration, intelligence, crisis management, seniority roles", element: "Leadership & Admin" },
  "Mula":              { field: "Research, medicine, philosophy, destruction and rebuilding", element: "Analytical & Technical" },
  "Purva Ashadha":     { field: "Water industries, shipping, media, motivation, teaching", element: "Creative & Business" },
  "Uttara Ashadha":    { field: "Military, government, administration, sports management", element: "Leadership & Admin" },
  "Shravana":          { field: "Media, counseling, teaching, hospitality, NGO, listening roles", element: "Service & Healing" },
  "Dhanishta":         { field: "Music, real estate, military, engineering, wealth management", element: "Creative & Business" },
  "Shatabhisha":       { field: "Medical research, technology, astrology, aviation, hidden sciences", element: "Analytical & Technical" },
  "Purva Bhadrapada":  { field: "Finance, occult, radical innovation, research", element: "Analytical & Technical" },
  "Uttara Bhadrapada": { field: "Social service, spirituality, writing, large institutions", element: "Service & Healing" },
  "Revati":            { field: "Counseling, travel, NGO work, marine industries, foreign trade", element: "Service & Healing" },
};

const PADA_ROLE = {
  1: { navamsa: "Aries (Dharma)", style: "Initiator and pioneer. Best as entrepreneur, founder, or leader.", ideal: "startup founder, commanding officer, director" },
  2: { navamsa: "Taurus (Artha)", style: "Executor and builder. Best in finance, production, and wealth-building roles.", ideal: "banker, real estate developer, CFO, production manager" },
  3: { navamsa: "Gemini (Kama)", style: "Communicator and strategist. Best in sales, IT, media, or consulting.", ideal: "sales lead, IT architect, consultant, journalist" },
  4: { navamsa: "Cancer (Moksha)", style: "Nurturer and healer. Best in teaching, medicine, social work, or service missions.", ideal: "teacher, doctor, NGO leader, spiritual guide" },
};

function tool_get_career_fields(d1Chart, d10Chart) {
  const chart = d10Chart || d1Chart;
  const ascRashiNum = getAscRashiNum(d1Chart);
  if (!ascRashiNum) return { ok: false, error: "Ascendant data missing." };

  const house10RashiId = rashiInHouse(ascRashiNum, 10);
  const lord10Name = lordOf(house10RashiId);
  const lord10Planet = lord10Name ? getPlanet(chart, lord10Name) : null;
  const lord10Nakshatra = lord10Planet ? findNakshatra(lord10Planet.nakshatra) : null;

  // Atmakaraka: planet with highest localDegree (excluding Rahu/Ketu)
  const eligible = (d1Chart.planets || []).filter((p) => !["Rahu","Ketu"].includes(p.name) && p.localDegree !== undefined);
  const atmakaraka = eligible.reduce((max, p) => Number(p.localDegree) > Number(max?.localDegree || 0) ? p : max, null);
  const atmakNakshatra = atmakaraka ? findNakshatra(atmakaraka.nakshatra) : null;

  const moon = getMoon(d1Chart);
  const moonNakshatra = moon ? findNakshatra(moon.nakshatra) : null;

  return {
    ok: true,
    usingD10: !!d10Chart,
    house10Lord: lord10Name,
    lord10House: lord10Planet ? Number(lord10Planet.houseNum) : null,
    lord10Nakshatra: lord10Nakshatra ? lord10Nakshatra.name : null,
    careerFieldFrom10thLord: lord10Nakshatra ? (NAK_CAREER_FIELD[lord10Nakshatra.name] || null) : null,
    moon: { nakshatra: moonNakshatra ? moonNakshatra.name : null, careerField: moonNakshatra ? (NAK_CAREER_FIELD[moonNakshatra.name] || null) : null },
    atmakaraka: { planet: atmakaraka ? atmakaraka.name : null, nakshatra: atmakNakshatra ? atmakNakshatra.name : null, careerField: atmakNakshatra ? (NAK_CAREER_FIELD[atmakNakshatra.name] || null) : null },
    occupantsIn10th: planetsInHouse(chart, 10).map((p) => ({ name: p.name, nakshatra: p.nakshatra })),
    note: d10Chart ? "Career fields from D10 (career divisional chart) -- more precise." : "D10 not yet loaded. Reading from D1 10th house. Results are approximate.",
  };
}

function tool_get_career_role(d1Chart, d10Chart) {
  const chart = d10Chart || d1Chart;
  const ascRashiNum = getAscRashiNum(d1Chart);
  if (!ascRashiNum) return { ok: false, error: "Ascendant data missing." };

  const house10RashiId = rashiInHouse(ascRashiNum, 10);
  const lord10Name = lordOf(house10RashiId);
  const lord10Planet = lord10Name ? getPlanet(chart, lord10Name) : null;
  if (!lord10Planet) return { ok: false, error: "10th house lord not found in chart." };

  const pada = Number(lord10Planet.pada);
  const nakEntry = findNakshatra(lord10Planet.nakshatra);

  // Amatyakaraka: 2nd highest localDegree planet (Jaimini career significator)
  const sorted = (d1Chart.planets || [])
    .filter((p) => !["Rahu","Ketu"].includes(p.name) && p.localDegree !== undefined)
    .sort((a, b) => Number(b.localDegree) - Number(a.localDegree));
  const amatyakaraka = sorted[1] || null;
  const amkNak = amatyakaraka ? findNakshatra(amatyakaraka.nakshatra) : null;

  return {
    ok: true,
    usingD10: !!d10Chart,
    lord10: lord10Name,
    lord10Nakshatra: nakEntry ? nakEntry.name : (lord10Planet.nakshatra || null),
    lord10Pada: pada,
    workingStyle: PADA_ROLE[pada] || null,
    amatyakaraka: { planet: amatyakaraka ? amatyakaraka.name : null, nakshatra: amkNak ? amkNak.name : null, careerField: amkNak ? (NAK_CAREER_FIELD[amkNak.name] || null) : null },
    note: "Pada (quarter) of 10th lord shows HOW you work. Nakshatra shows WHAT field you thrive in.",
  };
}


// ─── Tool registry ────────────────────────────────────────────────────────────

const TOOLS = [
  { type: "function", function: { name: "get_naming_reading", description: "Get Moon Nakshatra, Pada, and Vedic naming syllable. Use when user asks about their nakshatra, name initial, or naming reading.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "check_name_compatibility", description: "Check if a name matches the user's Moon nakshatra syllable. Use when user asks if their name suits their chart.", parameters: { type: "object", properties: { name: { type: "string", description: "Name to check. Leave empty to use the chart name." } }, required: [] } } },
  { type: "function", function: { name: "suggest_names", description: "Suggest names matching the user's naming syllable. Use when user asks for name recommendations.", parameters: { type: "object", properties: { gender: { type: "string", enum: ["Male", "Female", "Any"] } }, required: [] } } },
  { type: "function", function: { name: "get_marriage_timing", description: "Predict WHEN marriage is likely -- delay/early indicators and which dashas trigger it. Use when user asks at what age they will marry.", parameters: { type: "object", properties: { gender: { type: "string", enum: ["Male", "Female", "Unknown"] } }, required: [] } } },
  { type: "function", function: { name: "get_spouse_traits", description: "Describe the likely traits, nature, and background of the spouse, and HOW they will meet. Use when user asks what their future husband/wife will be like.", parameters: { type: "object", properties: { gender: { type: "string", enum: ["Male", "Female", "Unknown"] } }, required: [] } } },
  { type: "function", function: { name: "check_manglik_dosha", description: "Check for Manglik (Kuja) Dosha from Mars placement. Returns severity and cancellations. Use when user asks specifically about Manglik dosha.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "get_marriage_quality", description: "Analyze harmony, conflict, divorce risk, and stability of married life. Use when user asks how their marriage will be or whether divorce is possible.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "get_children_reading", description: "Analyze 5th house for children -- prospects, obstacles, and timing. Use when user asks about children or parenthood.", parameters: { type: "object", properties: { gender: { type: "string", enum: ["Male", "Female", "Unknown"] } }, required: [] } } },
  { type: "function", function: { name: "get_wealth_potential", description: "Analyze overall wealth potential -- Dhana Yogas, 2nd/11th lords, Jupiter/Venus. Use when user asks how wealthy they will be.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "get_wealth_timing", description: "Show at what ages wealth peaks based on dasha timeline. Use when user asks WHEN money will come or what age they get rich.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "get_income_sources", description: "Identify professions and income sources from the 10th house. Use when user asks about career, profession, or where their money comes from.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "get_financial_challenges", description: "Identify financial challenges, debt, and losses from 6th/8th/12th houses. Also shows protections. Use when user asks about financial problems or debt.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "get_overall_prosperity", description: "Lifetime prosperity arc -- how wealth builds over a lifetime, retirement and property wealth. Use when user asks about long-term financial future.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "get_career_fields", description: "Identify career fields and industries suited to the person based on 10th house lord and Moon nakshatra. Uses D10 chart if available. Use when user asks what career, profession, or industry suits them.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "get_career_role", description: "Identify the specific working style and role type from the 10th lord Pada and Amatyakaraka. Use when user asks what kind of work they do best, their working style, or specific job roles.", parameters: { type: "object", properties: {}, required: [] } } },
];

// ─── Tool runner ──────────────────────────────────────────────────────────────

function runTool(toolName, args, chart, gender, d2, d10, userName) {
  switch (toolName) {
    case "get_naming_reading":        return tool_get_naming_reading(chart);
    case "check_name_compatibility":  return tool_check_name_compatibility(chart, args, userName);
    case "suggest_names":             return tool_suggest_names(chart, args, gender);
    case "get_marriage_timing":       return tool_get_marriage_timing(chart, args, gender);
    case "get_spouse_traits":         return tool_get_spouse_traits(chart, args, gender);
    case "check_manglik_dosha":       return tool_check_manglik_dosha(chart);
    case "get_marriage_quality":      return tool_get_marriage_quality(chart);
    case "get_children_reading":      return tool_get_children_reading(chart, args, gender);
    case "get_wealth_potential":      return tool_get_wealth_potential(chart, d2);
    case "get_wealth_timing":         return tool_get_wealth_timing(chart);
    case "get_income_sources":        return tool_get_income_sources(chart, d10);
    case "get_financial_challenges":  return tool_get_financial_challenges(chart, d2);
    case "get_overall_prosperity":    return tool_get_overall_prosperity(chart, d2);
    case "get_career_fields":         return tool_get_career_fields(chart, d10);
    case "get_career_role":           return tool_get_career_role(chart, d10);
    default: return { error: `Unknown tool: ${toolName}` };
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert Vedic (Jyotish) astrologer. A D1 birth chart has been cast for the user.

You have 13 focused tools. Pick the ONE most specific tool for the question. Never answer astrological questions from memory -- always call a tool first.

TOOL SELECTION:
- "when will I marry / what age" -> get_marriage_timing
- "what will my spouse/partner be like" -> get_spouse_traits
- "am I Manglik / Kuja dosha" -> check_manglik_dosha
- "how will my marriage be / will I divorce" -> get_marriage_quality
- "children / kids / parenthood" -> get_children_reading
- "how wealthy / financial potential" -> get_wealth_potential
- "when will I get rich / financial turning point" -> get_wealth_timing
- "what career field suits me / what industry" -> get_career_fields
- "what kind of work do I do best / working style / job role" -> get_career_role
- "what profession / career / income source / where money comes from" -> get_income_sources
- "financial problems / debt / losses" -> get_financial_challenges
- "long-term wealth / retirement / overall prosperity" -> get_overall_prosperity
- "nakshatra / naming syllable" -> get_naming_reading
- "is my name compatible" -> check_name_compatibility
- "suggest names" -> suggest_names

RESPONSE FORMAT -- STRICT:
1. DIRECT ANSWER FIRST. One or two sentences. The actual answer to what they asked. No preamble.
2. Then ONE supporting reason from the tool result. One sentence only.
3. End with ONE short follow-up offer: "Want to know [related thing]?"
That is the entire response. No tables. No bullet lists. No headers. No mantras. No remedies unless the user asks.

EXAMPLES of correct length:
- "When will I marry?" -> "Your strongest marriage window is during your Mercury or Venus dasha, likely in your late 20s to early 30s. Mercury, your 7th house lord, sits in the 6th house which adds some delay before things settle. Want to know what your future partner will be like?"
- "How wealthy will I be?" -> "Your chart shows solid wealth potential through a Dhana Yoga between your 2nd and 11th lords. The peak earning period comes during your Jupiter dasha. Want to know at what age that period hits?"

RULES:
- No markdown tables ever.
- No bullet points unless the user explicitly asks for a breakdown.
- No unsolicited remedies or mantras.
- Warm plain language. Explain any Sanskrit term in 3 words inline, not in a separate section.
- Frame as tendencies, never absolute predictions.
- Saturn/Rahu delays: phrase as "a little later than average" not doom.
- Manglik dosha: calm, mention remedies exist, do not alarm.`;

// ─── Handler ──────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Server is missing GROQ_API_KEY." });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ error: "Malformed request body." }); }
  }

  const { chart, d2, d10, messages, gender, userName } = body || {};

  if (!chart) return res.status(400).json({ error: "Missing chart data." });
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: "Missing conversation messages." });
  if (messages.length > 40) return res.status(400).json({ error: "Conversation too long. Start a new reading." });
  if (messages.some((m) => typeof m?.content === "string" && m.content.length > 2000)) {
    return res.status(400).json({ error: "Message too long (max 2000 characters)." });
  }

  const chatMessages = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const round1 = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, messages: [{ role: "system", content: SYSTEM_PROMPT }, ...chatMessages], tools: TOOLS, tool_choice: "auto" }),
    });

    const payload1 = await round1.json();
    if (!round1.ok) return res.status(502).json({ error: "AI service error.", details: payload1?.error?.message || payload1 });

    const message1 = payload1.choices?.[0]?.message;
    if (!message1?.tool_calls || message1.tool_calls.length === 0) {
      return res.status(200).json({ reply: (message1?.content || "").trim() });
    }

    const toolCall = message1.tool_calls[0];
    let toolArgs = {};
    try { toolArgs = JSON.parse(toolCall.function.arguments || "{}"); } catch { /* leave empty */ }

    const toolResult = runTool(toolCall.function.name, toolArgs, chart, gender, d2 || null, d10 || null, userName || null);

    const round2 = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...chatMessages,
          { role: "assistant", content: message1.content || null, tool_calls: message1.tool_calls },
          { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(toolResult) },
        ],
        tools: TOOLS, tool_choice: "auto",
      }),
    });

    const payload2 = await round2.json();
    if (!round2.ok) return res.status(502).json({ error: "AI service error.", details: payload2?.error?.message || payload2 });

    return res.status(200).json({ reply: (payload2.choices?.[0]?.message?.content || "").trim() });

  } catch (err) {
    return res.status(502).json({ error: "Couldn't reach the AI reasoning service. Try again in a moment.", details: String(err?.message || err) });
  }
};