# TrustAstrology AI Implementation Overview

**Submitted by:** Archi Mangla  
**Project:** TrustAstrology: Vedic Astrology AI Chat Application  
**Stack:** Node.js 20, Vercel Serverless, Groq API (`openai/gpt-oss-120b`), astro-engine GraphQL
**URL:** trustastrologyproj.vercel.app

---

## What Was Built

A Vedic astrology web app where a user enters their birth details, a D1 (Rashi/Lagna) chart is cast via the astro-engine GraphQL API, and an AI astrologer answers questions about their chart through a chat interface.

The AI does not answer from general training knowledge. Every astrological fact comes from a tool that reads the actual chart data and applies classical Jyotish rules in JavaScript. The LLM's job is only to decide which tool to call and then narrate the result in plain language.

---

## Core Architecture: LLM Tool Calling

The central pattern is a **two-round Groq call** in `api/astrologer.js`.

### Round 1 — Tool Selection
The user's message and conversation history are sent to the LLM along with a list of 15 tool definitions. `tool_choice: "auto"` lets the LLM decide whether a tool is needed and which one fits the question.

```
User: "When will I get married?"
LLM decides → call get_marriage_timing
```

If no tool is needed (e.g. "what is a nakshatra?"), the LLM replies directly and we return that immediately.

### Round 2 — Result Narration
Once the LLM picks a tool, our JavaScript runs it against the chart data and produces a structured JSON result. That result is sent back to the LLM in a second call (as a `tool` role message). The LLM then writes a focused, plain-language reply based only on that data.

```
JS runs get_marriage_timing(chart) → returns { delayIndicators, marriageDashas, ... }
LLM narrates → "Your strongest window is during Mercury or Venus dasha..."
```

This keeps hallucination out entirely. The LLM never guesses planetary positions — it only reads what the tool returned.

### Why not if-else routing?
If-else would mean the developer decides which function runs based on keywords. Tool calling lets the LLM decide based on semantic understanding of the full question. This scales — the same pattern works for 15 tools or 500.

---

## Divisional Charts

Three charts are used:

| Chart | Purpose | When Fetched |
|-------|---------|--------------|
| D1 (Lagna) | Main birth chart — all readings base | On form submit |
| D2 (Hora) | Wealth accumulation tendency | Background fetch after D1 |
| D10 (Dasamsha) | Career and profession precision | Background fetch after D1 |

D2 and D10 are fetched in parallel in the background immediately after D1 loads. By the time the user types their first question, they are ready. Career and wealth tools automatically use D10/D2 if available, and fall back to D1 with a note if not.

---

## Tools Implemented (15 total)

### Naming (3 tools)

| Tool | What it does |
|------|-------------|
| `get_naming_reading` | Returns Moon nakshatra, pada, and the traditional Vedic naming syllable (Naam Akshar) |
| `check_name_compatibility` | Checks if the user's name starts with the correct syllable for their Moon nakshatra and pada |
| `suggest_names` | Suggests real names starting with the correct syllable, filtered by gender |

**Data source:** `data/nakshatra-table.js` — 27 nakshatras × 4 padas × naming syllable lookup

### Marriage (5 tools)

| Tool | What it does |
|------|-------------|
| `get_marriage_timing` | Reads 7th house lord placement, Saturn/Rahu delay indicators, and identifies which dashas (planetary periods) will trigger marriage |
| `get_spouse_traits` | Reads the element of the 7th house sign for temperament clues, 7th lord nakshatra for personality, and the house the lord sits in to predict how/where they meet |
| `check_manglik_dosha` | Checks if Mars is in 1st, 4th, 7th, 8th, or 12th house. Evaluates classical cancellation rules (Mars in own sign, Jupiter aspecting Mars). Returns severity |
| `get_marriage_quality` | Reads benefics vs malefics in the 7th house, 7th lord in dusthana (6/8/12), and flags divorce risk indicators and remarriage possibility |
| `get_children_reading` | Analyzes 5th house (children, intellect) — lord placement, occupants, Jupiter as Putrakaraka (children significator), obstacles from Saturn/Ketu/Rahu |

**Key rules applied:** 7th house = marriage, dusthana = 6th/8th/12th houses cause friction, Saturn delays, Jupiter blesses, Rahu brings unconventional outcomes.

### Wealth (5 tools)

| Tool | What it does |
|------|-------------|
| `get_wealth_potential` | Checks 2nd house (savings) and 11th house (gains) lords, identifies Dhana Yoga (both lords conjunct), Chandra-Mangala Yoga (Moon+Mars), Lakshmi Yoga (Venus in own/exalted sign). Uses D2 ascendant as secondary signal |
| `get_wealth_timing` | Builds a full dasha timeline from birth using Moon nakshatra ruler as the starting dasha. Highlights periods of Venus, Jupiter, 2nd lord, and 11th lord as peak wealth phases with approximate age ranges |
| `get_income_sources` | Reads 10th house (career) planets and lord, maps each planet to profession categories (e.g. Mercury = IT/communication, Jupiter = teaching/law, Mars = engineering/military). Flags foreign income (Rahu in 9/10/11/12) and multiple income streams |
| `get_financial_challenges` | Reads 6th house (debt), 8th house (sudden events/joint assets), 12th house (losses). Flags malefics in these houses and lords placed in wealth houses eating into income |
| `get_overall_prosperity` | Scores lifetime prosperity based on Jupiter strength, Saturn in hard-work houses (3/6/11), Moon strength, and Ketu in trikona (1/5/9). Returns a tier: Strong / Moderate / Needs remedies |

**Key rules applied:** 2nd + 11th = wealth axis, 5th + 9th = Lakshmi sthanas (luck/fortune), dusthana lords afflict whatever house they sit in, dasha sequence from Moon nakshatra ruler determines life timeline.

### Career (2 tools)

| Tool | What it does |
|------|-------------|
| `get_career_fields` | Maps the 10th house lord's nakshatra and Moon nakshatra to career industry categories across all 27 nakshatras. Also identifies Atmakaraka (planet with highest degree — soul significator in Jaimini astrology). Uses D10 if available |
| `get_career_role` | Reads the pada (quarter) of the 10th lord to determine working style: Pada 1 = pioneer/entrepreneur, Pada 2 = executor/finance, Pada 3 = communicator/analyst, Pada 4 = healer/teacher. Also reads Amatyakaraka (2nd highest degree planet — career significator) |

**Data source:** All 27 nakshatras mapped to industries. Pada mapped to Navamsa element (Fire/Earth/Air/Water) which determines role archetype.

### Education (1 tool)

| Tool | What it does |
|------|-------------|
| `get_education_reading` | Reads 4th house (foundational/school education), 5th house (intellect, college), and 9th house (higher education, philosophy, foreign study). Mercury = intelligence karaka, Jupiter = wisdom karaka. Moon nakshatra + pada gives learning style. 5th lord nakshatra gives field of study |

**Pada learning styles:** Pada 1 = hands-on/technical, Pada 2 = material/vocational, Pada 3 = intellectual/academic, Pada 4 = intuitive/spiritual/service

---

## System Prompt Design

The system prompt is built dynamically per request via `buildSystemPrompt(userName)` so the user's name (from the birth form) is always injected. The LLM is told:

- Which tool to pick for which type of question (explicit mapping)
- Never to answer astrological questions from its own training — always call a tool first
- To answer in 2-3 sentences max: direct answer first, one supporting reason, one follow-up offer
- Never to ask the user for their name — it is already in the tool result

---

## Other Technical Decisions

**`readJSON()` helper** — Replaced all `res.json()` calls. The astro-engine API occasionally returns an empty body which causes `.json()` to throw. `readJSON()` reads the raw text first and handles the empty case gracefully.

**`maxDuration: 30` in `vercel.json`** — Two sequential Groq calls plus a GraphQL fetch exceeded Vercel's default 10s timeout. Extended to 30s on both functions.

**Payload limits** — Max 40 messages per conversation, 2000 characters per message. Prevents token overflow crashing the Groq call.

**XSS prevention** — Planet names from the API are rendered into SVG via `innerHTML`. An `escapeHtml()` function sanitizes them before insertion.

**Nakshatra/Rashi aliases** — The astro-engine API returns non-standard spellings (`"anurada"` for Anuradha, `"vruschika"` for Scorpio). Alias maps in `nakshatra-table.js` and `rashi-table.js` handle these transparently.

---

## File Map

```
index.html             Form, chart display, chat UI, topic chip buttons
style.css              Pastel pink palette, chip styles
app.js                 Chart rendering (North Indian SVG), chat loop,
                       D2/D10 background fetch, state management
api/chart.js           POST /api/chart — proxies birth details to astro-engine GraphQL
api/astrologer.js      POST /api/astrologer — two-round Groq tool calling flow, all 15 tools
data/nakshatra-table.js  27 nakshatras, 4 padas each, naming syllables, alias map
data/rashi-table.js      12 signs, Sanskrit names, alias map
vercel.json            maxDuration: 30 on both functions
```