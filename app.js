const RASHIS = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
];
const RASHI_ALIASES = {
  mesha: "Aries", vrishabha: "Taurus", mithuna: "Gemini", karka: "Cancer",
  kark: "Cancer", simha: "Leo", kanya: "Virgo", tula: "Libra",
  vrishchika: "Scorpio", vrischika: "Scorpio", dhanu: "Sagittarius",
  makara: "Capricorn", kumbha: "Aquarius", meena: "Pisces", mina: "Pisces",
};

function rashiNumber(rawName) {
  if (!rawName) return null;
  const key = String(rawName).toLowerCase().replace(/[^a-z]/g, "");
  const idx = RASHIS.findIndex((r) => r.toLowerCase() === key);
  if (idx >= 0) return idx + 1;
  for (const [alias, canon] of Object.entries(RASHI_ALIASES)) {
    if (key.includes(alias)) return RASHIS.indexOf(canon) + 1;
  }
  return null;
}

const PLANET_ABBR = {
  sun: "Su", moon: "Mo", mars: "Ma", mercury: "Me", jupiter: "Ju",
  venus: "Ve", saturn: "Sa", rahu: "Ra", ketu: "Ke", uranus: "Ur",
  neptune: "Ne", pluto: "Pl",
};

function abbrFor(planetName) {
  const key = String(planetName || "").toLowerCase();
  return PLANET_ABBR[key] || escapeHtml((planetName || "?").slice(0, 2));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CITY_PRESETS = {
  "New Delhi": { lat: 28.6139, lon: 77.209, tz: 5.5 },
  Mumbai: { lat: 19.076, lon: 72.8777, tz: 5.5 },
  Bengaluru: { lat: 12.9716, lon: 77.5946, tz: 5.5 },
  Kolkata: { lat: 22.5726, lon: 88.3639, tz: 5.5 },
  Chennai: { lat: 13.0827, lon: 80.2707, tz: 5.5 },
  Hyderabad: { lat: 17.385, lon: 78.4867, tz: 5.5 },
  Pune: { lat: 18.5204, lon: 73.8567, tz: 5.5 },
  Jaipur: { lat: 26.9124, lon: 75.7873, tz: 5.5 },
};



const HOUSES = [
  { points: "200,0 300,100 200,200 100,100", label: [200, 70] },   // 1
  { points: "0,0 200,0 100,100", label: [108, 38] },                // 2
  { points: "0,0 100,100 0,200", label: [38, 108] },                // 3
  { points: "0,200 100,100 200,200 100,300", label: [70, 200] },    // 4
  { points: "0,200 100,300 0,400", label: [38, 295] },              // 5
  { points: "0,400 100,300 200,400", label: [108, 362] },           // 6
  { points: "200,400 100,300 200,200 300,300", label: [200, 332] }, // 7
  { points: "400,400 200,400 300,300", label: [294, 362] },         // 8
  { points: "400,400 300,300 400,200", label: [362, 295] },         // 9
  { points: "400,200 300,300 200,200 300,100", label: [330, 200] }, // 10
  { points: "400,0 400,200 300,100", label: [362, 108] },           // 11
  { points: "400,0 300,100 200,0", label: [294, 38] },              // 12
];

const state = { chart: null, gender: "", messages: [] };

// Reads a fetch Response as JSON without throwing the cryptic
// "Unexpected end of JSON input" error when the server sends back an
// empty or non-JSON body (timeouts, cold-start hiccups, etc).
async function readJSON(res) {
  const raw = await res.text();
  if (!raw) {
    throw new Error(
      res.ok
        ? "The server sent back an empty response. Please try again."
        : `Server error (${res.status}). Please try again in a moment.`
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Server returned an unexpected response (${res.status}). Please try again.`);
  }
}

const form = document.getElementById("birth-form");
const cityPreset = document.getElementById("city-preset");
const castBtn = document.getElementById("cast-btn");
const intakeError = document.getElementById("intake-error");
const intakeSection = document.getElementById("intake");
const readingSection = document.getElementById("reading");
const chartSvg = document.getElementById("d1-chart");
const chartPane = document.querySelector(".chart-pane");
const chartNameEl = document.getElementById("reading-heading");
const chatThread = document.getElementById("chat-thread");
const chatPrompt = document.getElementById("chat-prompt");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const newChartBtn = document.getElementById("new-chart-btn");

Object.keys(CITY_PRESETS).forEach((city) => {
  const opt = document.createElement("option");
  opt.value = city;
  opt.textContent = city;
  cityPreset.insertBefore(opt, cityPreset.lastElementChild);
});

cityPreset.addEventListener("change", () => {
  const val = cityPreset.value;
  if (!val || val === "custom") return;
  const preset = CITY_PRESETS[val];
  form.place.value = val;
  form.latitude.value = preset.lat;
  form.longitude.value = preset.lon;
  form.timezone.value = preset.tz;
});



form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();

  const fd = new FormData(form);
  const dateVal = fd.get("date"); // YYYY-MM-DD
  const timeVal = fd.get("time"); // HH:MM
  if (!dateVal || !timeVal) return showError("Please fill in both date and time of birth.");

  const [year, month, day] = dateVal.split("-").map(Number);
  const timeParts = timeVal.split(":").map(Number);
  const [hour, minute, second] = [timeParts[0] || 0, timeParts[1] || 0, timeParts[2] || 0];

  const payload = {
    name: fd.get("name"),
    gender: fd.get("gender"),
    year, month, day, hour, minute, second,
    place: fd.get("place"),
    latitude: Number(fd.get("latitude")),
    longitude: Number(fd.get("longitude")),
    timezone: Number(fd.get("timezone")),
    chart: "D1",
  };

  setCasting(true);
  try {
    const res = await fetch("/api/chart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readJSON(res);
    if (!res.ok) throw new Error(data.error || "Couldn't cast the chart.");

    state.chart = data.chart;
    state.gender = payload.gender;
    state.messages = [];
    chatThread.innerHTML = "";

    intakeSection.classList.add("hidden");
    readingSection.classList.remove("hidden");
    chartPane.classList.add("hidden");
    readingSection.scrollIntoView({ behavior: "smooth", block: "start" });

    showChatPrompt();
  } catch (err) {
    showError(err.message || "Something went wrong casting the chart.");
  } finally {
    setCasting(false);
  }
});

function setCasting(isCasting) {
  castBtn.disabled = isCasting;
  castBtn.querySelector(".btn-label").textContent = isCasting ? "Casting the chart…" : "Cast the chart";
}
function showError(msg) {
  intakeError.textContent = msg;
  intakeError.classList.remove("hidden");
}
function hideError() {
  intakeError.classList.add("hidden");
}

newChartBtn.addEventListener("click", () => {
  readingSection.classList.add("hidden");
  intakeSection.classList.remove("hidden");
  state.chart = null;
  state.messages = [];
  hideChatPrompt();
  chartPane.classList.add("hidden");
});

function renderChart(chart) {
  chartNameEl.textContent = chart.name || "";

  const ascRashiNum = rashiNumber(chart.ascendant?.rashi || chart.ascendant?.sign);
  const rashiByHouse = [];
  for (let h = 1; h <= 12; h++) {
    rashiByHouse.push(ascRashiNum ? (((ascRashiNum - 1) + (h - 1)) % 12) + 1 : null);
  }

  const planetsByHouse = {};
  (chart.planets || []).forEach((p) => {
    const h = Number(p.houseNum);
    if (!h) return;
    (planetsByHouse[h] = planetsByHouse[h] || []).push(p);
  });

  const moonHouse = Number((chart.planets || []).find((p) => String(p.name).toLowerCase() === "moon")?.houseNum);

  let svg = "";
  HOUSES.forEach((h, idx) => {
    const houseNum = idx + 1;
    const isMoon = houseNum === moonHouse;
    const [lx, ly] = h.label;
    const planetsHere = planetsByHouse[houseNum] || [];
    const planetText = planetsHere.map((p) => abbrFor(p.name)).join(" ");
    const rashi = rashiByHouse[idx];

    svg += `<polygon class="house${isMoon ? " moon-house" : ""}" points="${h.points}" style="animation-delay:${idx * 55}ms"></polygon>`;
    if (rashi) svg += `<text class="house-rashi" x="${lx}" y="${ly - 14}">${rashi}</text>`;
    if (houseNum === 1) svg += `<text class="asc-tag" x="${lx}" y="${ly + 26}">ASC</text>`;
    if (planetText) {
      svg += `<text class="house-planets${isMoon ? " moon-glyph-line" : ""}" x="${lx}" y="${ly + (houseNum === 1 ? 0 : 12)}">${planetText}</text>`;
    }
  });

  chartSvg.innerHTML = svg;
}



function appendEntry({ role, text, who, loading, error, onRetry }) {
  const div = document.createElement("div");
  div.className = `entry ${role}${loading ? " loading" : ""}${error ? " error" : ""}`;
  const whoEl = document.createElement("p");
  whoEl.className = "who";
  whoEl.textContent = who;
  div.appendChild(whoEl);
  const p = document.createElement("p");
  p.textContent = text;
  div.appendChild(p);
  if (error && onRetry) {
    const btn = document.createElement("button");
    btn.textContent = "Try again";
    btn.addEventListener("click", onRetry);
    div.appendChild(btn);
  }
  chatThread.appendChild(div);
  chatThread.scrollTop = chatThread.scrollHeight;
  return div;
}

async function sendToAPI() {
  const loadingEntry = appendEntry({ role: "astrologer", who: "The reading", text: "Consulting the chart…", loading: true });

  try {
    const res = await fetch("/api/astrologer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chart: state.chart, messages: state.messages, gender: state.gender }),
    });
    const data = await readJSON(res);
    loadingEntry.remove();
    if (!res.ok) {
      const detail = data.details
        ? (typeof data.details === "string" ? data.details : JSON.stringify(data.details))
        : "";
      throw new Error([data.error, detail].filter(Boolean).join(" ") || "The reading didn't come through.");
    }

    state.messages.push({ role: "assistant", content: data.reply });
    appendEntry({ role: "astrologer", who: "The reading", text: data.reply });
  } catch (err) {
    loadingEntry.remove();
    appendEntry({
      role: "astrologer",
      who: "The reading",
      text: err.message || "The stars didn't come through clearly. Try again.",
      error: true,
      onRetry: () => sendToAPI(),
    });
  }
}

function ensureChartIsRendered() {
  if (!state.chart) return;
  if (chartPane.classList.contains("hidden")) {
    renderChart(state.chart);
    chartPane.classList.remove("hidden");
  }
}

function askAstrologer(userText) {
  if (userText) {
    hideChatPrompt();
    ensureChartIsRendered();
    state.messages.push({ role: "user", content: userText });
    appendEntry({ role: "user", who: "You", text: userText });
  }
  return sendToAPI();
}



function showChatPrompt() {
  chatPrompt.classList.remove("hidden");
}

function hideChatPrompt() {
  chatPrompt.classList.add("hidden");
}

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";
  askAstrologer(text);
});