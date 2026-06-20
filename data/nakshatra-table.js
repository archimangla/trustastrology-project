const NAKSHATRAS = [
  { id: 1, name: "Ashwini", aliases: ["ashvini", "aswini"], padas: ["Chu", "Che", "Cho", "La"] },
  { id: 2, name: "Bharani", aliases: [], padas: ["Li", "Lu", "Le", "Lo"] },
  { id: 3, name: "Krittika", aliases: ["kartika", "kritika"], padas: ["A", "I", "U", "E"] },
  { id: 4, name: "Rohini", aliases: [], padas: ["O", "Va/Ba", "Vi/Bi", "Vu/Bu"] },
  { id: 5, name: "Mrigashira", aliases: ["mrigashirsha", "mrigasira", "mrigashirsa"], padas: ["Ve/Be", "Vo/Bo", "Ka", "Ki"] },
  { id: 6, name: "Ardra", aliases: ["aardra"], padas: ["Ku", "Gha", "Na/Nga", "Chha"] },
  { id: 7, name: "Punarvasu", aliases: [], padas: ["Ke", "Ko", "Ha", "Hi"] },
  { id: 8, name: "Pushya", aliases: ["pushyami", "tishya"], padas: ["Hu", "He", "Ho", "Da"] },
  { id: 9, name: "Ashlesha", aliases: ["aslesha"], padas: ["Di", "Du", "De", "Do"] },
  { id: 10, name: "Magha", aliases: [], padas: ["Ma", "Mi", "Mu", "Me"] },
  { id: 11, name: "Purva Phalguni", aliases: ["purvaphalguni", "poorva phalguni", "pubba"], padas: ["Mo", "Ta", "Ti", "Tu"] },
  { id: 12, name: "Uttara Phalguni", aliases: ["uttaraphalguni", "uttara falguni"], padas: ["Te", "To", "Pa", "Pi"] },
  { id: 13, name: "Hasta", aliases: [], padas: ["Pu", "Sha", "Na", "Tha"] },
  { id: 14, name: "Chitra", aliases: ["chitta"], padas: ["Pe", "Po", "Ra", "Ri"] },
  { id: 15, name: "Swati", aliases: ["svati"], padas: ["Ru", "Re", "Ro", "Ta"] },
  { id: 16, name: "Vishakha", aliases: ["visakha"], padas: ["Ti", "Tu", "Te", "To"] },
  { id: 17, name: "Anuradha", aliases: [], padas: ["Na", "Ni", "Nu", "Ne"] },
  { id: 18, name: "Jyeshtha", aliases: ["jyestha", "jyeshta"], padas: ["No", "Ya", "Yi", "Yu"] },
  { id: 19, name: "Mula", aliases: ["moola"], padas: ["Ye", "Yo", "Bha", "Bhi"] },
  { id: 20, name: "Purva Ashadha", aliases: ["purvashadha", "poorvashadha", "purvaashadha"], padas: ["Bhu", "Dha", "Bha/Pha", "Da"] },
  { id: 21, name: "Uttara Ashadha", aliases: ["uttarashadha", "uttaraashadha"], padas: ["Bhe", "Bho", "Ja", "Ji"] },
  { id: 22, name: "Shravana", aliases: ["sravana"], padas: ["Khi/Ju", "Khu/Je", "Khe/Jo", "Kho/Gha"] },
  { id: 23, name: "Dhanishta", aliases: ["shravishtha", "dhanishtha"], padas: ["Ga", "Gi", "Gu", "Ge"] },
  { id: 24, name: "Shatabhisha", aliases: ["shatataraka", "satabhisha"], padas: ["Go", "Sa", "Si", "Su"] },
  { id: 25, name: "Purva Bhadrapada", aliases: ["purvabhadrapada", "poorvabhadra"], padas: ["Se", "So", "Da", "Di"] },
  { id: 26, name: "Uttara Bhadrapada", aliases: ["uttarabhadrapada", "uttarabhadra"], padas: ["Du", "Tha", "Jha", "Nya"] },
  { id: 27, name: "Revati", aliases: [], padas: ["De", "Do", "Cha", "Chi"] },
];

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z]/g, ""); // strip spaces, punctuation, diacritics-as-typed
}

/**
 * Look up a nakshatra by whatever spelling the upstream API returns.
 * Returns the canonical table entry, or null if no confident match.
 */
function findNakshatra(rawName) {
  const target = normalize(rawName);
  if (!target) return null;
  for (const n of NAKSHATRAS) {
    if (normalize(n.name) === target) return n;
    if (n.aliases.some((a) => normalize(a) === target)) return n;
  }
  // Fallback: loose contains-match, in case the API appends extra words
  // (e.g. "Purva Ashadha Nakshatra")
  for (const n of NAKSHATRAS) {
    const canon = normalize(n.name);
    if (target.includes(canon) || canon.includes(target)) return n;
  }
  return null;
}

/**
 * Get the naming syllable for a specific nakshatra + pada (1-4).
 * Returns null if nakshatra unknown or pada out of range. Caller must
 * handle this explicitly rather than guessing, per "don't fabricate
 * missing data".
 */
function getNamingSyllable(rawNakshatraName, pada) {
  const entry = findNakshatra(rawNakshatraName);
  const padaIndex = Number(pada) - 1;
  if (!entry || padaIndex < 0 || padaIndex > 3 || Number.isNaN(padaIndex)) {
    return null;
  }
  return entry.padas[padaIndex];
}

module.exports = { NAKSHATRAS, findNakshatra, getNamingSyllable, normalize };