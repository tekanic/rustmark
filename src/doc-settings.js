// ── YAML front matter helpers ─────────────────────────────────────────────────

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFrontMatter(text) {
  const m = text.match(FM_RE);
  if (!m) return { fields: {}, body: text };
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
    fields[key] = val;
  }
  return { fields, body: text.slice(m[0].length) };
}

function serializeFrontMatter(fields) {
  const lines = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === "" || v === false || v === null || v === undefined) continue;
    const needsQuotes = /[:#{}[\],&*?|<>=!%@`]/.test(String(v));
    lines.push(`${k}: ${needsQuotes ? `"${String(v).replace(/"/g, '\\"')}"` : v}`);
  }
  if (lines.length === 0) return "";
  return `---\n${lines.join("\n")}\n---\n`;
}

export function applyFrontMatter(text, newFields) {
  const { fields, body } = parseFrontMatter(text);
  const merged = { ...fields, ...newFields };
  // Remove keys explicitly set to empty
  for (const k of Object.keys(merged)) {
    if (merged[k] === "" || merged[k] === false) delete merged[k];
  }
  const fm = serializeFrontMatter(merged);
  return fm + body;
}

export function readFrontMatter(text) {
  return parseFrontMatter(text).fields;
}

// ── Panel UI ──────────────────────────────────────────────────────────────────

let _onApply = null;
let _getContent = null;

const panel      = () => document.getElementById("doc-settings");
const statusEl   = () => document.getElementById("doc-settings-status");

function field(id) { return document.getElementById(id); }

function loadFromDocument() {
  const text = _getContent();
  const fields = readFrontMatter(text);

  field("ds-title").value      = fields.title   ?? "";
  field("ds-author").value     = fields.author  ?? "";
  field("ds-date").value       = fields.date    ?? "";
  field("ds-header").value     = fields["header-includes"] ?? fields.header ?? "";
  field("ds-footer").value     = fields.footer  ?? "";
  field("ds-titlepage").checked  = fields.titlepage === "true";
  field("ds-toc").checked        = fields.toc === "true";
  field("ds-toc-depth").value    = fields["toc-depth"] ?? "2";
  field("ds-pagenumbers").checked = fields.pagenumbers === "true";
  field("ds-theme").value = ["classic","modern","academic","minimal"].includes(fields.theme)
    ? fields.theme : "classic";
}

function collectFields() {
  const toc = field("ds-toc").checked;
  return {
    title:        field("ds-title").value.trim(),
    author:       field("ds-author").value.trim(),
    date:         field("ds-date").value.trim(),
    header:       field("ds-header").value.trim(),
    footer:       field("ds-footer").value.trim(),
    titlepage:    field("ds-titlepage").checked ? "true" : "",
    toc:          toc ? "true" : "",
    "toc-depth":  toc ? field("ds-toc-depth").value : "",
    pagenumbers:  field("ds-pagenumbers").checked ? "true" : "",
    theme:        field("ds-theme").value === "classic" ? "" : field("ds-theme").value,
  };
}

export function openDocSettings() {
  loadFromDocument();
  const st = statusEl();
  st.textContent = "";
  st.className = "hidden";
  panel().classList.remove("hidden");
}

export function closeDocSettings() {
  panel().classList.add("hidden");
}

// Called from the editor change listener so the panel reflects manual
// front-matter edits while it's open. No-op when closed.
export function syncDocSettingsFromDocument() {
  if (!panel() || panel().classList.contains("hidden")) return;
  loadFromDocument();
}

export function initDocSettings(getContentFn, onApplyFn) {
  _getContent = getContentFn;
  _onApply    = onApplyFn;

  document.getElementById("doc-settings-close").addEventListener("click", closeDocSettings);
  panel().addEventListener("click", e => { if (e.target === panel()) closeDocSettings(); });

  document.getElementById("doc-settings-apply").addEventListener("click", () => {
    const newText = applyFrontMatter(_getContent(), collectFields());
    _onApply(newText);

    const st = statusEl();
    st.textContent = "Applied.";
    st.className = "ds-status-ok";
    st.classList.remove("hidden");
    setTimeout(() => st.classList.add("hidden"), 2000);
  });
}
