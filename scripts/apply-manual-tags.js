import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manualPath = path.join(rootDir, "server", "data", "manualMusicTags.json");
const libraryPath = path.join(rootDir, "server", "data", "musicLibrary.json");
const allowedLanguages = new Set(["zh", "ja", "en", "ko", "instrumental", "mixed", "unknown"]);

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\\/]+/g, "/")
    .trim();
}

function normalizeLooseKey(value) {
  return normalizeKey(value)
    .replace(/[~～〜]/g, "~")
    .replace(/[()（）]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || "").trim())
    .filter(Boolean))];
}

function candidates(song) {
  const title = String(song.title || "").trim();
  const artist = String(song.artist || "").trim();
  const filename = String(song.filename || "").trim();
  const ext = path.extname(filename);
  const base = artist && title ? `${artist} - ${title}` : "";
  return [
    song.relativePath,
    filename,
    title,
    base,
    base && ext ? `${base}${ext}` : "",
    base && ext ? `${base}${ext.toLowerCase()}` : "",
  ].filter(Boolean).map(normalizeKey);
}

const manualTags = JSON.parse(fs.readFileSync(manualPath, "utf8"));
const library = JSON.parse(fs.readFileSync(libraryPath, "utf8"));
const manualIndex = new Map();
for (const [key, value] of Object.entries(manualTags)) {
  manualIndex.set(normalizeKey(key), value);
  manualIndex.set(normalizeLooseKey(key), value);
}
let matched = 0;

library.songs = (library.songs || []).map((song) => {
  let manual = null;
  for (const candidate of candidates(song)) {
    const looseCandidate = normalizeLooseKey(candidate);
    if (manualIndex.has(candidate) || manualIndex.has(looseCandidate)) {
      manual = manualIndex.get(candidate) || manualIndex.get(looseCandidate);
      break;
    }
  }
  if (!manual) {
    return {
      ...song,
      tagSource: song.tagSource || (song.language && song.language !== "unknown" ? "auto" : "unknown"),
    };
  }
  const language = allowedLanguages.has(manual.language) ? manual.language : "unknown";
  matched += 1;
  return {
    ...song,
    language,
    languageTags: uniqueStrings(manual.languageTags),
    vocal: typeof manual.vocal === "boolean" ? manual.vocal : language !== "instrumental",
    tagSource: "manual",
  };
});

fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2), "utf8");

const languageCounts = { zh: 0, ja: 0, en: 0, ko: 0, instrumental: 0, mixed: 0, unknown: 0 };
for (const song of library.songs || []) {
  languageCounts[allowedLanguages.has(song.language) ? song.language : "unknown"] += 1;
}

console.log(JSON.stringify({
  manualKeys: Object.keys(manualTags).length,
  matched,
  languageCounts,
}, null, 2));
