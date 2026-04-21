// Document outline panel: parses markdown headings and renders a clickable,
// side-dockable TOC that stays in sync with the editor cursor.

let onNavigate = null;
let headings = [];
let activeIdx = -1;
let outlineSide = "left";
let outlineVisible = false;

const outlinePane   = document.getElementById("outline-pane");
const outlineGutter = document.getElementById("outline-gutter");
const outlineList   = document.getElementById("outline-list");
const outlineSideBtn = document.getElementById("outline-side");
const main          = document.getElementById("main");

export function initOutline({ onNavigate: nav }) {
  onNavigate = nav;
  document.getElementById("outline-close").addEventListener("click", () => setOutlineVisible(false));
  outlineSideBtn.addEventListener("click", toggleOutlineSide);
  updateSideButtonTitle();
  setupDrag();
}

export function updateOutline(text) {
  headings = parseHeadings(text);
  renderOutline();
}

export function highlightCurrentHeading(cursorLine0) {
  let idx = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].line <= cursorLine0) idx = i;
    else break;
  }
  if (idx === activeIdx) return;
  activeIdx = idx;
  outlineList.querySelectorAll(".outline-item").forEach((el, i) => {
    el.classList.toggle("active", i === idx);
  });
  if (idx >= 0) {
    const active = outlineList.children[idx];
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest" });
    }
  }
}

export function setOutlineVisible(v) {
  outlineVisible = v;
  outlinePane.classList.toggle("hidden", !v);
  outlineGutter.classList.toggle("hidden", !v);
}

export function isOutlineVisible() { return outlineVisible; }

export function toggleOutline() { setOutlineVisible(!outlineVisible); }

function toggleOutlineSide() {
  outlineSide = outlineSide === "left" ? "right" : "left";
  main.classList.toggle("outline-right", outlineSide === "right");
  updateSideButtonTitle();
}

function updateSideButtonTitle() {
  outlineSideBtn.title = outlineSide === "left" ? "Move outline to right" : "Move outline to left";
}

function renderOutline() {
  if (headings.length === 0) {
    outlineList.innerHTML = "<div class='outline-empty'>No headings</div>";
    activeIdx = -1;
    return;
  }
  outlineList.innerHTML = headings.map((h, i) => {
    const indent = (h.level - 1) * 14 + 10;
    return `<div class="outline-item outline-level-${h.level}" data-idx="${i}" style="padding-left:${indent}px" title="${escAttr(h.text)}">` +
           `<span class="outline-marker">H${h.level}</span>` +
           `<span class="outline-text">${escHtml(h.text)}</span>` +
           `</div>`;
  }).join("");
  outlineList.querySelectorAll(".outline-item").forEach(el => {
    el.addEventListener("click", () => {
      const idx = +el.dataset.idx;
      if (onNavigate) onNavigate(headings[idx].line);
    });
  });
  activeIdx = -1;
}

function setupDrag() {
  let dragging = false;
  outlineGutter.addEventListener("mousedown", () => {
    dragging = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    const rect = main.getBoundingClientRect();
    let w = outlineSide === "left" ? e.clientX - rect.left : rect.right - e.clientX;
    w = Math.max(160, Math.min(w, 500));
    outlinePane.style.flex = `0 0 ${w}px`;
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
}

// ── Heading parser ────────────────────────────────────────────────────────────
// Handles ATX headings (# … ######) and Setext headings (text followed by === or ---).
// Skips fenced code blocks so headings inside code fences are ignored.

function parseHeadings(text) {
  const lines = text.split("\n");
  const out = [];
  let inFence = false;
  let fenceChar = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const ch = fenceMatch[1][0];
      if (!inFence) { inFence = true; fenceChar = ch; }
      else if (ch === fenceChar) { inFence = false; fenceChar = null; }
      continue;
    }
    if (inFence) continue;

    const atx = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (atx) {
      out.push({ level: atx[1].length, text: atx[2].trim(), line: i });
      continue;
    }

    const next = lines[i + 1];
    if (next && line.trim().length > 0) {
      if (/^=+\s*$/.test(next)) {
        out.push({ level: 1, text: line.trim(), line: i });
        i++;
      } else if (/^-+\s*$/.test(next) && !/^\s*-+\s*$/.test(line)) {
        out.push({ level: 2, text: line.trim(), line: i });
        i++;
      }
    }
  }
  return out;
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s) {
  return escHtml(s).replace(/"/g, "&quot;");
}
