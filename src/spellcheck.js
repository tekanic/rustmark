import nspell from "nspell";

const STORAGE_KEY = "md-spell-custom";

let checker = null;
let ready = false;
const ignored = new Set();

// ── Persistence ───────────────────────────────────────────────────────────────

function storedWords() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function persist(words) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(words)]));
}

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initSpellCheck() {
  const [aff, dic] = await Promise.all([
    fetch("/dict/en.aff").then(r => r.text()),
    fetch("/dict/en.dic").then(r => r.text()),
  ]);
  checker = nspell({ aff, dic });
  storedWords().forEach(w => checker.add(w));
  ready = true;
}

export const isReady = () => ready;

// ── Check / suggest ───────────────────────────────────────────────────────────

export function correct(word) {
  if (!checker) return true;
  if (ignored.has(word.toLowerCase())) return true;
  return checker.correct(word);
}

export function suggest(word) {
  return checker ? checker.suggest(word).slice(0, 6) : [];
}

// ── Dictionary management ─────────────────────────────────────────────────────

export function addToDictionary(word) {
  const w = word.toLowerCase();
  checker?.add(w);
  const words = storedWords();
  if (!words.includes(w)) persist([...words, w]);
}

export function ignoreWord(word) {
  ignored.add(word.toLowerCase());
}

export function getCustomDictionary() {
  return storedWords();
}

export function removeFromDictionary(word) {
  const w = word.toLowerCase();
  checker?.remove(w);
  persist(storedWords().filter(x => x !== w));
}
