const ASTRO_ENDPOINT =
  "https://astro-engine-serverfull-stage-838275484303.asia-south1.run.app/graphql/divisional_chart";

const CHART_QUERY = `
  query GetChart(
    $year: Int!, $month: String!, $day: Int!,
    $longitude: Float!, $latitude: Float!, $timezone: Float!,
    $hour: Int!, $minute: Int!, $second: Int!,
    $chart: String!, $name: String!, $gender: String!, $place: String!
  ) {
    getChart(
      year: $year, month: $month, day: $day,
      longitude: $longitude, latitude: $latitude, timezone: $timezone,
      hour: $hour, minute: $minute, second: $second,
      chart: $chart, name: $name, gender: $gender, place: $place
    ) {
      name
      symbol
      planets {
        name
        sign
        rashi
        retro
        houseNum
        symbol
        localDegree
        rashiNum
        nakshatra
        pada
        nakRuler
      }
      ascendant {
        name
        sign
        rashi
        retro
        houseNum
        symbol
        localDegree
      }
    }
  }
`;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function asMonthName(month) {
  // Accept either "November" already, or a 1-12 number / numeric string.
  if (typeof month === "string" && Number.isNaN(Number(month))) return month;
  const n = Number(month);
  if (n >= 1 && n <= 12) return MONTH_NAMES[n - 1];
  return month;
}

function badRequest(res, message) {
  res.status(400).json({ error: message });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const accessKey = process.env.ASTRO_ACCESS_KEY;
  if (!accessKey) {
    return res.status(500).json({
      error: "Server is missing ASTRO_ACCESS_KEY. Add it in Vercel → Settings → Environment Variables.",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return badRequest(res, "Malformed request body.");
    }
  }

  const {
    name, gender, year, month, day,
    hour, minute, second,
    place, latitude, longitude, timezone,
    chart,
  } = body || {};

  const required = { name, gender, year, month, day, place, latitude, longitude, timezone };
  const missing = Object.entries(required)
    .filter(([, v]) => v === undefined || v === null || v === "")
    .map(([k]) => k);
  if (missing.length) {
    return badRequest(res, `Missing required field(s): ${missing.join(", ")}`);
  }
  if (String(name).length > 120 || String(place).length > 200) {
    return badRequest(res, "Name or place is too long.");
  }

  const variables = {
    name: String(name),
    gender: String(gender),
    year: Number(year),
    month: asMonthName(month),
    day: Number(day),
    hour: Number(hour ?? 0),
    minute: Number(minute ?? 0),
    second: Number(second ?? 0),
    place: String(place),
    latitude: Number(latitude),
    longitude: Number(longitude),
    timezone: Number(timezone),
    chart: chart || "D1",
  };

  try {
    const upstream = await fetch(ASTRO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ACCESS-KEY": accessKey,
        Accept: "application/json",
      },
      body: JSON.stringify({ query: CHART_QUERY, variables }),
    });

    const text = await upstream.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "The astrology data service returned a response we couldn't parse.",
        raw: text.slice(0, 500),
      });
    }

    if (!upstream.ok || payload.errors) {
      return res.status(502).json({
        error: "The astrology data service rejected the request.",
        details: payload.errors || payload,
      });
    }

    const data = payload?.data?.getChart;
    if (!data) {
      return res.status(502).json({ error: "No chart data returned for these birth details." });
    }

    return res.status(200).json({ chart: data });
  } catch (err) {
    return res.status(502).json({
      error: "Couldn't reach the astrology data service. Try again in a moment.",
      details: String(err?.message || err),
    });
  }
};