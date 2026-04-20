import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, highlightActiveLineGutter, dropCursor } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, historyKeymap, history, indentWithTab,
         undo, redo, toggleComment, moveLineUp, moveLineDown, copyLineDown,
         selectAll, deleteLine } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, openSearchPanel, gotoLine } from "@codemirror/search";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting, HighlightStyle, bracketMatching } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { createSpellCheckExtension } from "./spellcheck-cm.js";

// ── One Dark Pro theme ────────────────────────────────────────────────────────
// Palette: https://github.com/Binaryify/OneDark-Pro
const C = {
  bg:          "#282c34",
  bgActive:    "#2c313c",
  bgGutter:    "#21252b",
  selection:   "#3e4451",
  border:      "#3b4048",
  fg:          "#abb2bf",
  fgMuted:     "#636d83",
  cursor:      "#528bff",
  red:         "#e06c75",
  orange:      "#d19a66",
  yellow:      "#e5c07b",
  green:       "#98c379",
  teal:        "#56b6c2",
  blue:        "#61afef",
  purple:      "#c678dd",
  comment:     "#5c6370",
  searchMatch: "#e5c07b44",
  searchSel:   "#e5c07b88",
};

const themeCompartment = new Compartment();

const darkTheme = EditorView.theme({
  "&": {
    color: C.fg,
    backgroundColor: C.bg,
    height: "100%",
    fontSize: "14px",
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  },
  ".cm-content": { caretColor: C.cursor, padding: "12px 0" },
  ".cm-cursor": { borderLeftColor: C.cursor, borderLeftWidth: "2px" },
  ".cm-gutters": {
    backgroundColor: C.bgGutter,
    color: C.fgMuted,
    border: "none",
    borderRight: `1px solid ${C.border}`,
    minWidth: "48px",
  },
  ".cm-lineNumbers .cm-gutterElement": { paddingRight: "12px" },
  ".cm-activeLineGutter": { backgroundColor: C.bgActive, color: C.fg },
  ".cm-activeLine": { backgroundColor: C.bgActive },
  ".cm-selectionBackground, ::selection": { backgroundColor: `${C.selection} !important` },
  ".cm-focused .cm-selectionBackground": { backgroundColor: `${C.selection} !important` },
  ".cm-searchMatch": { backgroundColor: C.searchMatch, borderRadius: "2px" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: C.searchSel },
  ".cm-matchingBracket": { backgroundColor: C.selection, outline: `1px solid ${C.fgMuted}` },
  ".cm-tooltip": { backgroundColor: C.bgGutter, border: `1px solid ${C.border}` },
  ".cm-completionLabel": { color: C.fg },
  ".cm-completionMatchedText": { color: C.blue, fontWeight: "bold", textDecoration: "none" },
  // Search panel
  ".cm-panels": { backgroundColor: C.bgGutter, borderTop: `1px solid ${C.border}` },
  ".cm-panels-bottom": { borderTop: `1px solid ${C.border}`, borderBottom: "none" },
  ".cm-search": { padding: "6px 10px", display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" },
  ".cm-search label": { color: C.fgMuted, fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" },
  ".cm-textfield": {
    backgroundColor: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: "4px",
    color: C.fg,
    padding: "2px 8px",
    fontSize: "13px",
    outline: "none",
  },
  ".cm-textfield:focus": { borderColor: C.blue },
  ".cm-button": {
    backgroundColor: C.selection,
    border: `1px solid ${C.border}`,
    borderRadius: "4px",
    color: C.fg,
    padding: "2px 10px",
    fontSize: "12px",
    cursor: "pointer",
  },
  ".cm-button:hover": { backgroundColor: C.bgActive, borderColor: C.blue },
  ".cm-search .cm-button[name=close]": { marginLeft: "auto" },
  // Spell check underline
  ".cm-spell-error": { textDecoration: "underline wavy #e06c75" },
}, { dark: true });

// ── One Dark Pro syntax highlighting ──────────────────────────────────────────
const oneDarkHighlight = HighlightStyle.define([
  // ── Markdown structure ──────────────────────────────────────────────────
  { tag: tags.heading1, color: C.red,    fontWeight: "bold", fontSize: "1.35em" },
  { tag: tags.heading2, color: C.yellow, fontWeight: "bold", fontSize: "1.2em"  },
  { tag: tags.heading3, color: C.green,  fontWeight: "bold", fontSize: "1.1em"  },
  { tag: tags.heading4, color: C.teal,   fontWeight: "bold" },
  { tag: tags.heading5, color: C.blue,   fontWeight: "bold" },
  { tag: tags.heading6, color: C.purple, fontWeight: "bold" },

  { tag: tags.strong,        color: C.orange, fontWeight: "bold" },
  { tag: tags.emphasis,      color: C.purple, fontStyle: "italic" },
  { tag: tags.strikethrough, color: C.comment, textDecoration: "line-through" },

  { tag: tags.link,          color: C.blue,   textDecoration: "underline" },
  { tag: tags.url,           color: C.teal },
  { tag: tags.labelName,     color: C.blue },

  { tag: tags.quote,         color: C.comment, fontStyle: "italic" },

  // Inline code and code fence markers
  { tag: tags.monospace,     color: C.green },
  { tag: tags.processingInstruction, color: C.fgMuted },
  { tag: tags.contentSeparator,      color: C.fgMuted },

  // ── Generic code tokens (highlighted code blocks) ──────────────────────
  { tag: tags.comment,       color: C.comment, fontStyle: "italic" },
  { tag: tags.lineComment,   color: C.comment, fontStyle: "italic" },
  { tag: tags.blockComment,  color: C.comment, fontStyle: "italic" },
  { tag: tags.docComment,    color: C.comment, fontStyle: "italic" },

  { tag: tags.keyword,       color: C.purple, fontWeight: "bold" },
  { tag: tags.controlKeyword,color: C.purple, fontWeight: "bold" },
  { tag: tags.definitionKeyword, color: C.purple },
  { tag: tags.moduleKeyword, color: C.purple },
  { tag: tags.operatorKeyword, color: C.purple },

  { tag: tags.string,        color: C.green },
  { tag: tags.special(tags.string), color: C.green },
  { tag: tags.regexp,        color: C.green },
  { tag: tags.escape,        color: C.teal },

  { tag: tags.number,        color: C.orange },
  { tag: tags.integer,       color: C.orange },
  { tag: tags.float,         color: C.orange },
  { tag: tags.bool,          color: C.orange },
  { tag: tags.null,          color: C.orange },
  { tag: tags.atom,          color: C.orange },

  { tag: tags.variableName,  color: C.red },
  { tag: tags.definition(tags.variableName), color: C.red },
  { tag: tags.function(tags.variableName),   color: C.blue },
  { tag: tags.local(tags.variableName),      color: C.fg },

  { tag: tags.typeName,      color: C.yellow },
  { tag: tags.className,     color: C.yellow },
  { tag: tags.namespace,     color: C.yellow },
  { tag: tags.self,          color: C.red },

  { tag: tags.propertyName,  color: C.red },
  { tag: tags.function(tags.propertyName), color: C.blue },

  { tag: tags.operator,      color: C.teal },
  { tag: tags.punctuation,   color: C.fg },
  { tag: tags.bracket,       color: C.fg },
  { tag: tags.angleBracket,  color: C.fg },

  // HTML tags inside markdown
  { tag: tags.tagName,        color: C.red },
  { tag: tags.attributeName,  color: C.orange },
  { tag: tags.attributeValue, color: C.green },
  { tag: tags.documentMeta,   color: C.comment },

  { tag: tags.meta,           color: C.fgMuted },
  { tag: tags.invalid,        color: C.red, textDecoration: "underline" },
]);

const syntaxTheme = syntaxHighlighting(oneDarkHighlight, { fallback: true });

const extraKeymap = [
  { key: "Alt-ArrowUp",       run: moveLineUp },
  { key: "Alt-ArrowDown",     run: moveLineDown },
  { key: "Shift-Alt-ArrowDown", run: copyLineDown },
  { key: "Ctrl-/", mac: "Cmd-/", run: toggleComment },
  { key: "Ctrl-g", mac: "Cmd-g", run: gotoLine },
  { key: "Ctrl-Shift-k", mac: "Cmd-Shift-k", run: deleteLine },
];

export function createEditor(container, initialDoc, onChange) {
  const extensions = [
    history(),
    lineNumbers(),
    highlightActiveLineGutter(),
    drawSelection(),
    dropCursor(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    autocompletion(),
    ...createSpellCheckExtension(),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxTheme,
    themeCompartment.of(darkTheme),
    EditorView.lineWrapping,
    keymap.of([
      indentWithTab,
      ...extraKeymap,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
    ]),
    EditorView.updateListener.of(update => {
      if (update.docChanged) onChange(update.state.doc.toString());
    }),
  ];

  const state = EditorState.create({ doc: initialDoc, extensions });
  const view = new EditorView({ state, parent: container });
  return view;
}

export function setEditorContent(view, content) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  });
}

export function getEditorContent(view) {
  return view.state.doc.toString();
}

export function getCursorInfo(view) {
  const { head } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);
  return { line: line.number, col: head - line.from + 1 };
}

export const editorUndo  = view => undo(view);
export const editorRedo  = view => redo(view);
export const editorFind  = view => openSearchPanel(view);
export const editorGoto  = view => gotoLine(view);

// ── Formatting helpers ────────────────────────────────────────────────────────

// Wrap selection with inline markers (e.g. ** for bold). Toggles off if the
// selected text is already wrapped, or inserts empty markers at cursor.
export function wrapInline(view, before, after = before) {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);

  if (sel.startsWith(before) && sel.endsWith(after) && sel.length > before.length + after.length) {
    // Already wrapped — unwrap
    const inner = sel.slice(before.length, sel.length - after.length);
    view.dispatch({
      changes: { from, to, insert: inner },
      selection: { anchor: from, head: from + inner.length },
    });
  } else if (sel.length > 0) {
    view.dispatch({
      changes: { from, to, insert: before + sel + after },
      selection: { anchor: from, head: from + before.length + sel.length + after.length },
    });
  } else {
    // No selection — insert markers and park cursor inside
    view.dispatch({
      changes: { from, insert: before + after },
      selection: { anchor: from + before.length },
    });
  }
  view.focus();
}

// Toggle a line-level prefix on every selected line (e.g. "- " for UL).
export function toggleLinePrefix(view, prefix) {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const s = doc.lineAt(from).number;
  const e = doc.lineAt(to).number;
  const allHave = Array.from({ length: e - s + 1 }, (_, i) => doc.line(s + i))
    .every(l => l.text.startsWith(prefix));

  const changes = [];
  for (let n = s; n <= e; n++) {
    const line = doc.line(n);
    if (allHave) {
      changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
    } else if (!line.text.startsWith(prefix)) {
      changes.push({ from: line.from, insert: prefix });
    }
  }
  view.dispatch({ changes });
  view.focus();
}

// Set (or toggle off) a heading level on every selected line.
export function setHeading(view, level) {
  const prefix = "#".repeat(level) + " ";
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const s = doc.lineAt(from).number;
  const e = doc.lineAt(to).number;

  const changes = [];
  for (let n = s; n <= e; n++) {
    const line = doc.line(n);
    const m = line.text.match(/^(#{1,6}) /);
    const clean = m ? line.text.slice(m[0].length) : line.text;
    const already = m && m[1].length === level;
    changes.push({ from: line.from, to: line.to, insert: already ? clean : prefix + clean });
  }
  view.dispatch({ changes });
  view.focus();
}

// Insert a link around the selection.
export function insertLink(view) {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);
  const insert = `[${sel || "link text"}](url)`;
  const urlAt = from + insert.indexOf("url");
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: urlAt, head: urlAt + 3 },
  });
  view.focus();
}

// Insert a fenced code block around the selection.
export function insertCodeBlock(view) {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);
  const insert = "```\n" + sel + "\n```\n";
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + 4 },
  });
  view.focus();
}

// Insert a horizontal rule after the current line.
export function insertHR(view) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  view.dispatch({
    changes: { from: line.to, insert: "\n\n---\n" },
    selection: { anchor: line.to + 6 },
  });
  view.focus();
}

// Wrap selection in an HTML alignment block.
export function alignSelection(view, alignment) {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to) || "text";
  const insert = alignment === "left"
    ? sel
    : `<div style="text-align:${alignment}">\n\n${sel}\n\n</div>\n`;
  view.dispatch({ changes: { from, to, insert } });
  view.focus();
}
