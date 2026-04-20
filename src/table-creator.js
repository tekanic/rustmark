// ── State ─────────────────────────────────────────────────────────────────────

const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 3;

let state = {
  rows: DEFAULT_ROWS,
  cols: DEFAULT_COLS,
  headers:    Array(DEFAULT_COLS).fill(""),
  alignments: Array(DEFAULT_COLS).fill("left"),
  cells:      Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill("")),
};

// ── Markdown generation ───────────────────────────────────────────────────────

function sepStr(align, width) {
  if (align === "center") return ":" + "-".repeat(Math.max(width - 2, 1)) + ":";
  if (align === "right")  return "-".repeat(Math.max(width - 1, 1)) + ":";
  return ":" + "-".repeat(Math.max(width - 1, 1));
}

export function generateMarkdown() {
  const { headers, alignments, cells, cols } = state;

  const colWidths = Array.from({ length: cols }, (_, c) => {
    const vals = [headers[c] || "", ...cells.map(r => r[c] || "")];
    return Math.max(...vals.map(v => v.length), 3);
  });

  const pad = (s, w) => (s || "").padEnd(w);

  const header = "| " + headers.map((h, c) => pad(h, colWidths[c])).join(" | ") + " |";
  const sep    = "| " + alignments.map((a, c) => sepStr(a, colWidths[c])).join(" | ") + " |";
  const rows   = cells.map(row =>
    "| " + row.map((cell, c) => pad(cell, colWidths[c])).join(" | ") + " |"
  );

  return [header, sep, ...rows].join("\n");
}

// ── Grid rendering ────────────────────────────────────────────────────────────

function buildGrid(container, onUpdate) {
  container.innerHTML = "";
  const { rows, cols, headers, alignments, cells } = state;

  // CSS grid: one column per table column
  container.style.gridTemplateColumns = `repeat(${cols}, minmax(90px, 1fr))`;

  const allInputs = [];

  // ── Alignment buttons row ──────────────────────────────────────────────────
  for (let c = 0; c < cols; c++) {
    const grp = document.createElement("div");
    grp.className = "tc-align-group";
    grp.dataset.col = c;

    ["left", "center", "right"].forEach(align => {
      const btn = document.createElement("button");
      btn.className = "tc-align-btn" + (alignments[c] === align ? " active" : "");
      btn.title = align.charAt(0).toUpperCase() + align.slice(1);
      btn.textContent = align === "left" ? "⬅" : align === "center" ? "⬛" : "➡";
      btn.addEventListener("click", () => {
        state.alignments[c] = align;
        grp.querySelectorAll(".tc-align-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        onUpdate();
      });
      grp.appendChild(btn);
    });

    container.appendChild(grp);
  }

  // ── Header row ────────────────────────────────────────────────────────────
  for (let c = 0; c < cols; c++) {
    const inp = makeInput(headers[c], `Header ${c + 1}`, true);
    inp.addEventListener("input", () => { state.headers[c] = inp.value; onUpdate(); });
    allInputs.push(inp);
    container.appendChild(inp);
  }

  // ── Data rows ─────────────────────────────────────────────────────────────
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const inp = makeInput(cells[r][c], `Row ${r + 1}, Col ${c + 1}`, false);
      inp.addEventListener("input", () => { state.cells[r][c] = inp.value; onUpdate(); });
      allInputs.push(inp);
      container.appendChild(inp);
    }
  }

  // Tab / arrow navigation between cells
  allInputs.forEach((inp, idx) => {
    inp.addEventListener("keydown", e => {
      if (e.key === "Tab") {
        e.preventDefault();
        const next = allInputs[e.shiftKey ? idx - 1 : idx + 1];
        next?.focus();
      }
      if (e.key === "ArrowDown") {
        const next = allInputs[idx + cols];
        if (next) { e.preventDefault(); next.focus(); }
      }
      if (e.key === "ArrowUp") {
        const prev = allInputs[idx - cols];
        if (prev) { e.preventDefault(); prev.focus(); }
      }
    });
  });
}

function makeInput(value, placeholder, isHeader) {
  const inp = document.createElement("input");
  inp.type = "text";
  inp.value = value || "";
  inp.placeholder = placeholder;
  inp.className = "tc-cell" + (isHeader ? " tc-header" : "");
  return inp;
}

// ── Dimension changes ─────────────────────────────────────────────────────────

function resizeState(newRows, newCols) {
  const { rows, cols, headers, alignments, cells } = state;

  // Grow/shrink headers and alignments
  state.headers    = Array.from({ length: newCols }, (_, c) => headers[c]    ?? "");
  state.alignments = Array.from({ length: newCols }, (_, c) => alignments[c] ?? "left");

  // Grow/shrink cell matrix
  state.cells = Array.from({ length: newRows }, (_, r) =>
    Array.from({ length: newCols }, (_, c) => cells[r]?.[c] ?? "")
  );

  state.rows = newRows;
  state.cols = newCols;
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initTableCreator(insertCallback) {
  const modal      = document.getElementById("table-creator");
  const gridEl     = document.getElementById("tc-grid");
  const previewEl  = document.getElementById("tc-preview");
  const rowsInput  = document.getElementById("tc-rows");
  const colsInput  = document.getElementById("tc-cols");
  const insertBtn  = document.getElementById("tc-insert");
  const cancelBtn  = document.getElementById("tc-cancel");
  const closeBtn   = document.getElementById("table-creator-close");

  function refresh() {
    buildGrid(gridEl, refresh);
    previewEl.textContent = generateMarkdown();
  }

  rowsInput.addEventListener("change", () => {
    const n = Math.max(1, Math.min(20, +rowsInput.value || 1));
    rowsInput.value = n;
    resizeState(n, state.cols);
    refresh();
  });

  colsInput.addEventListener("change", () => {
    const n = Math.max(1, Math.min(10, +colsInput.value || 1));
    colsInput.value = n;
    resizeState(state.rows, n);
    refresh();
  });

  insertBtn.addEventListener("click", () => {
    insertCallback(generateMarkdown());
    closeTableCreator();
  });

  cancelBtn.addEventListener("click", closeTableCreator);
  closeBtn.addEventListener("click", closeTableCreator);
  modal.addEventListener("click", e => { if (e.target === modal) closeTableCreator(); });

  // Initial render
  refresh();
}

export function openTableCreator() {
  // Reset to defaults each open
  state = {
    rows: DEFAULT_ROWS,
    cols: DEFAULT_COLS,
    headers:    Array(DEFAULT_COLS).fill(""),
    alignments: Array(DEFAULT_COLS).fill("left"),
    cells:      Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill("")),
  };

  const rowsInput = document.getElementById("tc-rows");
  const colsInput = document.getElementById("tc-cols");
  rowsInput.value = DEFAULT_ROWS;
  colsInput.value = DEFAULT_COLS;

  const gridEl    = document.getElementById("tc-grid");
  const previewEl = document.getElementById("tc-preview");
  buildGrid(gridEl, () => { previewEl.textContent = generateMarkdown(); });
  previewEl.textContent = generateMarkdown();

  document.getElementById("table-creator").classList.remove("hidden");
  // Focus first header cell
  document.querySelector("#tc-grid .tc-header")?.focus();
}

export function closeTableCreator() {
  document.getElementById("table-creator").classList.add("hidden");
}
