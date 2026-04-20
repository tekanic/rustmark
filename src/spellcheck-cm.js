import { StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { correct, suggest, addToDictionary, ignoreWord, isReady } from "./spellcheck.js";

// ── State ─────────────────────────────────────────────────────────────────────

const setErrors = StateEffect.define();
let currentErrors = []; // [{from, to, word}]

const spellField = StateField.define({
  create: () => Decoration.none,
  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrors)) {
        currentErrors = e.value.errors;
        decos = e.value.decos;
      }
    }
    return decos;
  },
  provide: f => EditorView.decorations.from(f),
});

const errorMark = Decoration.mark({ class: "cm-spell-error" });

// ── Error building ────────────────────────────────────────────────────────────

// Matches words of 2+ letters, allowing internal apostrophes (don't, it's)
const WORD_RE = /[a-zA-Z][a-zA-Z']*[a-zA-Z]|[a-zA-Z]{2,}/g;

function collectCodeRanges(tree) {
  const ranges = [];
  tree.iterate({
    enter(node) {
      if (/Code|Fence|Math/.test(node.name)) ranges.push([node.from, node.to]);
    },
  });
  return ranges;
}

function inAny(ranges, from, to) {
  return ranges.some(([cf, ct]) => from >= cf && to <= ct);
}

function buildErrors(view) {
  const { state } = view;
  const tree = syntaxTree(state);
  const codeRanges = collectCodeRanges(tree);
  const builder = new RangeSetBuilder();
  const errors = [];

  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    // Skip blank lines and lines that are pure markdown syntax
    if (!line.text.trim()) continue;

    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(line.text)) !== null) {
      const from = line.from + m.index;
      const to = from + m[0].length;
      if (inAny(codeRanges, from, to)) continue;
      if (!correct(m[0])) {
        errors.push({ from, to, word: m[0] });
        builder.add(from, to, errorMark);
      }
    }
  }

  return { errors, decos: builder.finish() };
}

// ── Popup ─────────────────────────────────────────────────────────────────────

let popup = null;
let docListener = null;

function closePopup() {
  popup?.remove();
  popup = null;
  if (docListener) {
    document.removeEventListener("mousedown", docListener);
    docListener = null;
  }
}

function showPopup(view, { from, to, word }) {
  closePopup();

  const coords = view.coordsAtPos(from);
  if (!coords) return;

  popup = document.createElement("div");
  popup.className = "spell-popup";
  popup.style.left = `${coords.left}px`;
  popup.style.top  = `${coords.bottom + 6}px`;

  // Header
  const hdr = document.createElement("div");
  hdr.className = "spell-popup-header";
  hdr.textContent = `"${word}"`;
  popup.appendChild(hdr);

  // Suggestions
  const suggestions = suggest(word);
  if (suggestions.length) {
    const list = document.createElement("div");
    list.className = "spell-popup-list";
    suggestions.forEach(s => {
      const btn = document.createElement("button");
      btn.className = "spell-popup-suggestion";
      btn.textContent = s;
      btn.addEventListener("mousedown", e => {
        e.preventDefault();
        view.dispatch({ changes: { from, to, insert: s } });
        closePopup();
        view.focus();
      });
      list.appendChild(btn);
    });
    popup.appendChild(list);
  } else {
    const none = document.createElement("div");
    none.className = "spell-popup-none";
    none.textContent = "No suggestions";
    popup.appendChild(none);
  }

  // Divider + actions
  const divider = document.createElement("div");
  divider.className = "spell-popup-divider";
  popup.appendChild(divider);

  const actions = document.createElement("div");
  actions.className = "spell-popup-actions";

  const addBtn = document.createElement("button");
  addBtn.className = "spell-popup-action";
  addBtn.textContent = "Add to Dictionary";
  addBtn.addEventListener("mousedown", e => {
    e.preventDefault();
    addToDictionary(word);
    closePopup();
    runCheck(view);
    view.focus();
  });
  actions.appendChild(addBtn);

  const ignBtn = document.createElement("button");
  ignBtn.className = "spell-popup-action spell-popup-action-muted";
  ignBtn.textContent = "Ignore";
  ignBtn.addEventListener("mousedown", e => {
    e.preventDefault();
    ignoreWord(word);
    closePopup();
    runCheck(view);
    view.focus();
  });
  actions.appendChild(ignBtn);

  popup.appendChild(actions);
  document.body.appendChild(popup);

  // Keep inside viewport
  const r = popup.getBoundingClientRect();
  if (r.right  > window.innerWidth  - 8) popup.style.left = `${window.innerWidth  - r.width  - 8}px`;
  if (r.bottom > window.innerHeight - 8) popup.style.top  = `${coords.top - r.height - 6}px`;

  // Close on outside click — defer so this mousedown doesn't immediately close it
  setTimeout(() => {
    docListener = e => { if (!popup?.contains(e.target)) closePopup(); };
    document.addEventListener("mousedown", docListener);
  }, 0);
}

// ── Scheduling ────────────────────────────────────────────────────────────────

let checkTimer = null;

function runCheck(view) {
  if (!isReady()) return;
  const result = buildErrors(view);
  view.dispatch({ effects: setErrors.of(result) });
}

function scheduleCheck(view, delay = 600) {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => runCheck(view), delay);
}

// ── Extension ─────────────────────────────────────────────────────────────────

export function createSpellCheckExtension() {
  return [
    spellField,
    EditorView.updateListener.of(update => {
      if (update.docChanged) {
        closePopup();
        scheduleCheck(update.view);
      }
    }),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) { closePopup(); return false; }

        const error = currentErrors.find(e => pos >= e.from && pos <= e.to);
        if (!error) { closePopup(); return false; }

        showPopup(view, error);
        return false; // allow normal cursor placement
      },
    }),
  ];
}

export function runInitialSpellCheck(view) {
  scheduleCheck(view, 1000);
}
