import "katex/dist/katex.min.css";
import { EditorView } from "@codemirror/view";
import { createEditor, setEditorContent, getEditorContent, getCursorInfo,
         editorUndo, editorRedo, editorFind,
         wrapInline, toggleLinePrefix, setHeading,
         insertLink, insertCodeBlock, insertHR, alignSelection } from "./editor.js";
import { initSpellCheck } from "./spellcheck.js";
import { runInitialSpellCheck } from "./spellcheck-cm.js";
import { initTableCreator, openTableCreator, closeTableCreator } from "./table-creator.js";
import { initDocSettings, openDocSettings, closeDocSettings, syncDocSettingsFromDocument } from "./doc-settings.js";
import { exportPDF, exportDOCX, exportPDFPandoc, pandocAvailable, exportPDFChromium, chromeAvailable } from "./export.js";
import { scheduleRender, renderPreview } from "./preview.js";
import { lint } from "./linter.js";
import { openFile, saveFile, saveFileAs, renameFile, basename, dirname, joinPath } from "./fileops.js";

// ── State ─────────────────────────────────────────────────────────────────────

let currentPath = null;
let modified = false;
let previewVisible = true;
let syncScroll = true;
let lintDiags = [];

// ── DOM refs ──────────────────────────────────────────────────────────────────

const editorWrap    = document.getElementById("editor-wrap");
const previewPane   = document.getElementById("preview-pane");
const previewBody   = document.getElementById("preview-body");
const previewScroll = document.getElementById("preview-scroll");
const fileNameEl    = document.getElementById("file-name");
const modDot        = document.getElementById("modified-dot");
const stCursor      = document.getElementById("st-cursor");
const stWords       = document.getElementById("st-words");
const stLines       = document.getElementById("st-lines");
const stLint          = document.getElementById("st-lint");
const lintPanel       = document.getElementById("lint-panel");
const lintPanelList   = document.getElementById("lint-panel-list");
const lintDetail      = document.getElementById("lint-detail");
const lintDetailBadge = document.getElementById("lint-detail-badge");
const lintDetailLoc   = document.getElementById("lint-detail-loc");
const lintDetailMsg   = document.getElementById("lint-detail-msg");
const lintDetailCtx   = document.getElementById("lint-detail-ctx");
const lintDetailFix   = document.getElementById("lint-detail-fix");
const gutter        = document.getElementById("gutter");
const main          = document.getElementById("main");
const togglePreview = document.getElementById("toggle-preview");
const toggleSync    = document.getElementById("toggle-sync");
const mdRef         = document.getElementById("md-ref");
const gotoBar       = document.getElementById("goto-bar");
const gotoInput     = document.getElementById("goto-input");

// ── Editor ────────────────────────────────────────────────────────────────────

const editor = createEditor(editorWrap, "", onContentChange);

function onContentChange(text) {
  setModified(true);
  scheduleRender(text, previewBody);
  syncDocSettingsFromDocument();
  scheduleLint(text);
  updateStatusWords(text);
  updateStatusLines(text);
}

// ── Status bar ────────────────────────────────────────────────────────────────

editor.dom.addEventListener("keyup", updateCursor);
editor.dom.addEventListener("mouseup", updateCursor);
editor.dom.addEventListener("focus", updateCursor);

function updateCursor() {
  const { line, col } = getCursorInfo(editor);
  stCursor.textContent = `Ln ${line}, Col ${col}`;
}

function updateStatusWords(text) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  stWords.textContent = `${words} word${words !== 1 ? "s" : ""}`;
}

function updateStatusLines(text) {
  const lines = text.split("\n").length;
  stLines.textContent = `${lines} line${lines !== 1 ? "s" : ""}`;
}

// ── Lint ──────────────────────────────────────────────────────────────────────

let lintTimer = null;

function scheduleLint(text) {
  clearTimeout(lintTimer);
  lintTimer = setTimeout(() => runLint(text), 400);
}

function runLint(text) {
  lintDiags = lint(text);
  const errors   = lintDiags.filter(d => d.severity === "error").length;
  const warnings = lintDiags.filter(d => d.severity === "warning").length;
  const infos    = lintDiags.filter(d => d.severity === "info").length;

  if (lintDiags.length === 0) {
    stLint.textContent = "";
    stLint.className = "status-center";
  } else {
    const parts = [];
    if (errors)   parts.push(`${errors} error${errors   !== 1 ? "s" : ""}`);
    if (warnings) parts.push(`${warnings} warning${warnings !== 1 ? "s" : ""}`);
    if (infos)    parts.push(`${infos} info`);
    stLint.textContent = parts.join("  ");
    stLint.className = `status-center lint-${errors ? "error" : warnings ? "warning" : "info"}`;
  }

  if (!lintPanel.classList.contains("hidden")) renderLintPanel();
}

function renderLintPanel() {
  if (lintDiags.length === 0) {
    lintPanelList.innerHTML = "<div class='lint-empty'>No problems found.</div>";
    return;
  }
  lintPanelList.innerHTML = lintDiags.map((d, idx) =>
    `<div class="lint-item lint-item-${d.severity}" data-idx="${idx}">
      <span class="lint-sev">${severityIcon(d.severity)}</span>
      <span class="lint-loc">Ln ${d.line}, Col ${d.col}</span>
      <span class="lint-msg">${escHtml(d.msg)}</span>
      ${d.fix ? `<span class="lint-fix-hint">Fix available</span>` : ""}
    </div>`
  ).join("");

  lintPanelList.querySelectorAll(".lint-item").forEach(el => {
    el.addEventListener("click", () => showLintDetail(lintDiags[+el.dataset.idx]));
  });
}

function severityIcon(sev) {
  if (sev === "error")   return "✖";
  if (sev === "warning") return "⚠";
  return "ℹ";
}

// ── Lint detail popup ─────────────────────────────────────────────────────────

let activeDiag = null;

function showLintDetail(diag) {
  activeDiag = diag;

  lintDetailBadge.textContent = severityIcon(diag.severity);
  lintDetailBadge.className   = `lint-detail-badge lint-detail-badge-${diag.severity}`;
  lintDetailLoc.textContent   = `Line ${diag.line}, Col ${diag.col}`;
  lintDetailMsg.textContent   = diag.msg;

  // Show the offending line as context
  const text = getEditorContent(editor);
  const docLine = text.split("\n")[diag.lineIdx] ?? "";
  lintDetailCtx.textContent = docLine || "(blank line)";

  if (diag.fix) {
    lintDetailFix.textContent = diag.fix.label;
    lintDetailFix.classList.remove("hidden");
  } else {
    lintDetailFix.classList.add("hidden");
  }

  lintDetail.classList.remove("hidden");
}

function closeLintDetail() {
  lintDetail.classList.add("hidden");
  activeDiag = null;
}

document.getElementById("lint-detail-close").addEventListener("click", closeLintDetail);

lintDetailFix.addEventListener("click", () => {
  if (!activeDiag?.fix) return;
  const fixed = activeDiag.fix.apply(getEditorContent(editor));
  setEditorContent(editor, fixed);
  setModified(true);
  closeLintDetail();
  // Lint and preview update via onContentChange, but also trigger immediately
  renderPreview(fixed, previewBody);
  runLint(fixed);
});

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

stLint.addEventListener("click", () => {
  if (lintDiags.length === 0) return;
  lintPanel.classList.toggle("hidden");
  if (!lintPanel.classList.contains("hidden")) renderLintPanel();
});

document.getElementById("lint-panel-close").addEventListener("click", () => {
  lintPanel.classList.add("hidden");
});

// ── File title ────────────────────────────────────────────────────────────────

function setModified(val) {
  modified = val;
  modDot.classList.toggle("hidden", !val);
}

function setCurrentPath(path) {
  currentPath = path;
  fileNameEl.textContent = path ? basename(path) : "untitled.md";
  document.title = `${fileNameEl.textContent} — Rustmark`;
}

// ── File operations ───────────────────────────────────────────────────────────

async function cmdNew() {
  if (modified && !confirmDiscard()) return;
  setEditorContent(editor, "");
  setCurrentPath(null);
  setModified(false);
  renderPreview("", previewBody);
  updateStatusWords("");
  updateStatusLines("");
  runLint("");
  editor.focus();
}

async function cmdOpen() {
  if (modified && !confirmDiscard()) return;
  try {
    const result = await openFile();
    if (!result) return;
    setEditorContent(editor, result.content);
    setCurrentPath(result.path);
    setModified(false);
    renderPreview(result.content, previewBody);
    updateStatusWords(result.content);
    updateStatusLines(result.content);
    runLint(result.content);
    editor.focus();
  } catch (e) {
    alert(`Could not open file: ${e}`);
  }
}

async function cmdSave() {
  if (!currentPath) return cmdSaveAs();
  try {
    await saveFile(currentPath, getEditorContent(editor));
    setModified(false);
  } catch (e) {
    alert(`Could not save: ${e}`);
  }
}

async function cmdSaveAs() {
  try {
    const path = await saveFileAs(currentPath, getEditorContent(editor));
    if (!path) return;
    setCurrentPath(path);
    setModified(false);
  } catch (e) {
    alert(`Could not save: ${e}`);
  }
}

async function cmdRename() {
  if (!currentPath) { alert("Save the file first before renaming."); return; }
  const oldName = basename(currentPath);
  const newName = prompt("New filename:", oldName);
  if (!newName || newName === oldName) return;
  const newPath = joinPath(dirname(currentPath), newName);
  try {
    await saveFile(currentPath, getEditorContent(editor));
    await renameFile(currentPath, newPath);
    setCurrentPath(newPath);
    setModified(false);
  } catch (e) {
    alert(`Could not rename: ${e}`);
  }
}

function confirmDiscard() {
  return confirm("You have unsaved changes. Discard them?");
}

// ── Export modal ──────────────────────────────────────────────────────────────

const exportModal  = document.getElementById("export-modal");
const exportStatus = document.getElementById("export-status");
const pandocBadge  = document.getElementById("pandoc-badge");
const chromeBadge  = document.getElementById("chrome-badge");
const latexBadge   = document.getElementById("latex-badge");

function openExportModal() {
  exportModal.classList.remove("hidden");
  exportStatus.classList.add("hidden");
  exportStatus.textContent = "";

  pandocBadge.textContent = "Checking…";
  pandocBadge.className = "export-badge";
  import("@tauri-apps/api/core").then(({ invoke }) => invoke("pandoc_status")).then(status => {
    const label = status === "system" ? "System Pandoc"
                : status === "cached" ? "Pandoc ready"
                : "Auto-downloads";
    pandocBadge.textContent = label;
    pandocBadge.className = "export-badge export-badge-ok";
    document.getElementById("export-do-docx").disabled = false;
    document.getElementById("export-do-pdf-pandoc").disabled = false;
  });

  latexBadge.textContent = "Checking…";
  latexBadge.className = "export-badge";
  import("@tauri-apps/api/core").then(({ invoke }) => invoke("tectonic_status")).then(status => {
    const label = status === "system" ? "System LaTeX"
                : status === "cached" ? "Tectonic ready"
                : "Auto-downloads";
    latexBadge.textContent = label;
    latexBadge.className = "export-badge export-badge-ok";
  });

  chromeBadge.textContent = "Checking…";
  chromeBadge.className = "export-badge";
  import("@tauri-apps/api/core").then(({ invoke }) => invoke("chrome_status")).then(status => {
    const label = status === "system" ? "System Chrome" : "Auto-downloads";
    chromeBadge.textContent = label;
    chromeBadge.className = "export-badge export-badge-ok";
    document.getElementById("export-do-pdf-chromium").disabled = false;
  });
}

function closeExportModal() {
  exportModal.classList.add("hidden");
  editor.focus();
}

function showExportStatus(msg, isError) {
  exportStatus.textContent = msg;
  exportStatus.className = isError ? "error" : "ok";
  exportStatus.classList.remove("hidden");
}

document.getElementById("btn-doc-settings").addEventListener("click", openDocSettings);
document.getElementById("btn-export").addEventListener("click", openExportModal);
document.getElementById("export-modal-close").addEventListener("click", closeExportModal);
exportModal.addEventListener("click", e => { if (e.target === exportModal) closeExportModal(); });

document.getElementById("export-do-print").addEventListener("click", async () => {
  closeExportModal();
  // Small delay so the modal overlay is fully removed before the print sheet opens
  await new Promise(r => setTimeout(r, 80));
  exportPDF(getEditorContent(editor));
});

document.getElementById("export-do-docx").addEventListener("click", async () => {
  const result = await exportDOCX(getEditorContent(editor));
  if (result.cancelled) return;
  if (result.error) showExportStatus(`Export failed: ${result.error}`, true);
  else showExportStatus(`Saved to ${result.path}`, false);
});

document.getElementById("export-do-pdf-pandoc").addEventListener("click", async () => {
  const result = await exportPDFPandoc(getEditorContent(editor));
  if (result.cancelled) return;
  if (result.error) showExportStatus(`Export failed: ${result.error}`, true);
  else showExportStatus(`Saved to ${result.path}`, false);
});

document.getElementById("export-do-pdf-chromium").addEventListener("click", async () => {
  const previewEl = document.getElementById("preview-body");
  showExportStatus("Rendering via headless Chromium…", false);
  const result = await exportPDFChromium(previewEl);
  if (result.cancelled) { exportStatus.classList.add("hidden"); return; }
  if (result.error) showExportStatus(`Export failed: ${result.error}`, true);
  else showExportStatus(`Saved to ${result.path}`, false);
});

// ── Markdown Reference panel ──────────────────────────────────────────────────

function openRef() {
  mdRef.classList.remove("hidden");
  mdRef.focus();
}

function closeRef() {
  mdRef.classList.add("hidden");
  editor.focus();
}

document.getElementById("btn-ref").addEventListener("click", openRef);
document.getElementById("md-ref-close").addEventListener("click", closeRef);

// Close on backdrop click
mdRef.addEventListener("click", e => { if (e.target === mdRef) closeRef(); });

// Tab switching
document.querySelectorAll(".ref-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    document.querySelectorAll(".ref-tab").forEach(t => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".ref-panel").forEach(p => p.classList.toggle("active", p.dataset.panel === target));
  });
});

// ── Toolbar buttons ───────────────────────────────────────────────────────────

document.getElementById("fmt-table").addEventListener("click", openTableCreator);
document.getElementById("btn-new").addEventListener("click", cmdNew);
document.getElementById("btn-open").addEventListener("click", cmdOpen);
document.getElementById("btn-save").addEventListener("click", cmdSave);
document.getElementById("btn-save-as").addEventListener("click", cmdSaveAs);
document.getElementById("btn-rename").addEventListener("click", cmdRename);

document.getElementById("btn-undo").addEventListener("click", () => { editorUndo(editor); editor.focus(); });
document.getElementById("btn-redo").addEventListener("click", () => { editorRedo(editor); editor.focus(); });
document.getElementById("btn-find").addEventListener("click", () => { editorFind(editor); });
document.getElementById("btn-goto").addEventListener("click", toggleGotoBar);

// ── Formatting toolbar ────────────────────────────────────────────────────────

document.getElementById("fmt-bold").addEventListener("click",   () => wrapInline(editor, "**"));
document.getElementById("fmt-italic").addEventListener("click", () => wrapInline(editor, "_"));
document.getElementById("fmt-strike").addEventListener("click", () => wrapInline(editor, "~~"));
document.getElementById("fmt-code").addEventListener("click",   () => wrapInline(editor, "`"));
document.getElementById("fmt-link").addEventListener("click",   () => insertLink(editor));

document.getElementById("fmt-h1").addEventListener("click", () => setHeading(editor, 1));
document.getElementById("fmt-h2").addEventListener("click", () => setHeading(editor, 2));
document.getElementById("fmt-h3").addEventListener("click", () => setHeading(editor, 3));
document.getElementById("fmt-h4").addEventListener("click", () => setHeading(editor, 4));

document.getElementById("fmt-ul").addEventListener("click",        () => toggleLinePrefix(editor, "- "));
document.getElementById("fmt-ol").addEventListener("click",        () => toggleLinePrefix(editor, "1. "));
document.getElementById("fmt-quote").addEventListener("click",     () => toggleLinePrefix(editor, "> "));
document.getElementById("fmt-codeblock").addEventListener("click", () => insertCodeBlock(editor));
document.getElementById("fmt-hr").addEventListener("click",        () => insertHR(editor));

document.getElementById("fmt-align-left").addEventListener("click",   () => alignSelection(editor, "left"));
document.getElementById("fmt-align-center").addEventListener("click", () => alignSelection(editor, "center"));
document.getElementById("fmt-align-right").addEventListener("click",  () => alignSelection(editor, "right"));

function toggleGotoBar() {
  const open = !gotoBar.classList.contains("hidden");
  if (open) {
    closeGotoBar();
  } else {
    gotoBar.classList.remove("hidden");
    gotoInput.value = "";
    gotoInput.focus();
  }
}

function closeGotoBar() {
  gotoBar.classList.add("hidden");
  editor.focus();
}

function execGoto() {
  const n = parseInt(gotoInput.value, 10);
  if (!n || n < 1) return;
  const lineCount = editor.state.doc.lines;
  const line = editor.state.doc.line(Math.min(n, lineCount));
  editor.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: "center" }),
  });
  closeGotoBar();
}

gotoInput.addEventListener("keydown", e => {
  if (e.key === "Enter")  { e.preventDefault(); execGoto(); }
  if (e.key === "Escape") { e.preventDefault(); closeGotoBar(); }
});
document.getElementById("goto-submit").addEventListener("click", execGoto);
document.getElementById("goto-close").addEventListener("click", closeGotoBar);

// ── Toggles ───────────────────────────────────────────────────────────────────

togglePreview.addEventListener("change", () => {
  previewVisible = togglePreview.checked;
  previewPane.style.display = previewVisible ? "" : "none";
  gutter.style.display = previewVisible ? "" : "none";
});

toggleSync.addEventListener("change", () => { syncScroll = toggleSync.checked; });


// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener("keydown", e => {
  const ctrl = e.ctrlKey || e.metaKey;

  if (e.key === "F1") { e.preventDefault(); openRef(); return; }
  if (e.key === "F9") { e.preventDefault(); cmdRename(); return; }

  if (e.key === "Escape") {
    if (!document.getElementById("table-creator").classList.contains("hidden")) { closeTableCreator(); editor.focus(); return; }
    if (!document.getElementById("doc-settings").classList.contains("hidden")) { closeDocSettings(); return; }
    if (!exportModal.classList.contains("hidden")) { closeExportModal(); return; }
    if (!mdRef.classList.contains("hidden"))      { closeRef(); return; }
    if (!gotoBar.classList.contains("hidden"))    { closeGotoBar(); return; }
    if (!lintDetail.classList.contains("hidden")) { closeLintDetail(); return; }
    if (!lintPanel.classList.contains("hidden"))  { lintPanel.classList.add("hidden"); return; }
  }

  if (!ctrl) return;
  switch (e.key) {
    case "n": e.preventDefault(); cmdNew(); break;
    case "o": e.preventDefault(); cmdOpen(); break;
    case "s": e.preventDefault(); e.shiftKey ? cmdSaveAs() : cmdSave(); break;
    case "t": e.preventDefault(); openTableCreator(); break;
    case "E": e.preventDefault(); openExportModal(); break;
    case "D": e.preventDefault(); openDocSettings(); break;
    case "b": e.preventDefault(); wrapInline(editor, "**"); break;
    case "i": e.preventDefault(); wrapInline(editor, "_"); break;
    case "1": e.preventDefault(); setHeading(editor, 1); break;
    case "2": e.preventDefault(); setHeading(editor, 2); break;
    case "3": e.preventDefault(); setHeading(editor, 3); break;
    case "4": e.preventDefault(); setHeading(editor, 4); break;
    case "\\": e.preventDefault();
      togglePreview.checked = !togglePreview.checked;
      togglePreview.dispatchEvent(new Event("change"));
      break;
  }
});

// ── Draggable gutter ──────────────────────────────────────────────────────────

let dragging = false;

gutter.addEventListener("mousedown", e => {
  dragging = true;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
});

document.addEventListener("mousemove", e => {
  if (!dragging) return;
  const mainRect = main.getBoundingClientRect();
  const newLeft = Math.max(200, Math.min(e.clientX - mainRect.left, mainRect.width - 200 - 5));
  const pct = (newLeft / mainRect.width) * 100;
  document.getElementById("editor-pane").style.flex = `0 0 ${pct}%`;
  previewPane.style.flex = `0 0 ${100 - pct - (5 / mainRect.width * 100)}%`;
});

document.addEventListener("mouseup", () => {
  if (!dragging) return;
  dragging = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

// ── Sync scroll ───────────────────────────────────────────────────────────────
// Track which pane the user is actively scrolling so the programmatic update
// on the other pane doesn't fire a scroll event that syncs back.

let syncSource = null;
let syncReleaseTimer = null;

function releaseSyncSource() { syncSource = null; }

editor.scrollDOM.addEventListener("scroll", () => {
  if (!syncScroll || syncSource === "preview") return;
  syncSource = "editor";
  clearTimeout(syncReleaseTimer);
  const el = editor.scrollDOM;
  const ratio = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
  previewScroll.scrollTop = ratio * Math.max(1, previewScroll.scrollHeight - previewScroll.clientHeight);
  syncReleaseTimer = setTimeout(releaseSyncSource, 80);
});

previewScroll.addEventListener("scroll", () => {
  if (!syncScroll || syncSource === "editor") return;
  syncSource = "preview";
  clearTimeout(syncReleaseTimer);
  const ratio = previewScroll.scrollTop / Math.max(1, previewScroll.scrollHeight - previewScroll.clientHeight);
  editor.scrollDOM.scrollTop = ratio * Math.max(1, editor.scrollDOM.scrollHeight - editor.scrollDOM.clientHeight);
  syncReleaseTimer = setTimeout(releaseSyncSource, 80);
});

// ── Init ──────────────────────────────────────────────────────────────────────

setCurrentPath(null);
updateStatusWords("");
updateStatusLines("");
editor.focus();

initSpellCheck().then(() => runInitialSpellCheck(editor));

initDocSettings(
  () => getEditorContent(editor),
  newText => {
    setEditorContent(editor, newText);
    setModified(true);
    renderPreview(newText, previewBody);
    runLint(newText);
    updateStatusWords(newText);
    updateStatusLines(newText);
  }
);

initTableCreator(markdown => {
  const { from, to } = editor.state.selection.main;
  // Insert on its own line(s), with a blank line before if not at start
  const doc   = editor.state.doc;
  const atStart = from === 0;
  const insert  = (atStart ? "" : "\n") + markdown + "\n";
  editor.dispatch({ changes: { from, to, insert } });
  editor.focus();
});
