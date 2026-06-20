

const RASHIS = [
  { id: 1, name: "Aries", sanskrit: "Mesha", abbr: "Ar" },
  { id: 2, name: "Taurus", sanskrit: "Vrishabha", abbr: "Ta" },
  { id: 3, name: "Gemini", sanskrit: "Mithuna", abbr: "Ge" },
  { id: 4, name: "Cancer", sanskrit: "Karka", abbr: "Cn" },
  { id: 5, name: "Leo", sanskrit: "Simha", abbr: "Le" },
  { id: 6, name: "Virgo", sanskrit: "Kanya", abbr: "Vi" },
  { id: 7, name: "Libra", sanskrit: "Tula", abbr: "Li" },
  { id: 8, name: "Scorpio", sanskrit: "Vrishchika", abbr: "Sc" },
  { id: 9, name: "Sagittarius", sanskrit: "Dhanu", abbr: "Sg" },
  { id: 10, name: "Capricorn", sanskrit: "Makara", abbr: "Cp" },
  { id: 11, name: "Aquarius", sanskrit: "Kumbha", abbr: "Aq" },
  { id: 12, name: "Pisces", sanskrit: "Meena", abbr: "Pi" },
];

function normalize(str) {
  return String(str || "").toLowerCase().replace(/[^a-z]/g, "");
}

function findRashi(rawName) {
  const target = normalize(rawName);
  if (!target) return null;
  for (const r of RASHIS) {
    if (normalize(r.name) === target || normalize(r.sanskrit) === target) return r;
  }
  for (const r of RASHIS) {
    const a = normalize(r.name);
    const b = normalize(r.sanskrit);
    if (target.includes(a) || a.includes(target) || target.includes(b) || b.includes(target)) {
      return r;
    }
  }
  return null;
}


function rashiNumbersByHouse(ascendantRashiNum) {
  const out = [];
  for (let house = 1; house <= 12; house++) {
    out.push((((ascendantRashiNum - 1) + (house - 1)) % 12) + 1);
  }
  return out;
}

module.exports = { RASHIS, findRashi, rashiNumbersByHouse, normalize };
