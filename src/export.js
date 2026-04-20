import { invoke } from "@tauri-apps/api/core";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";

// ── PDF via print dialog ──────────────────────────────────────────────────────
// Page numbers are handled by the paginated preview (see preview.js).
// When front matter has `pagenumbers: true`, the preview is rendered as real
// A4 pages with visible numbered footers, so printing reproduces them exactly.

export async function exportPDF() {
  return invoke("print_page");
}

// ── DOCX via Pandoc ───────────────────────────────────────────────────────────

export async function exportDOCX(markdown) {
  const path = await dialogSave({
    title: "Export as DOCX",
    defaultPath: "document.docx",
    filters: [{ name: "Word Document", extensions: ["docx"] }],
  });
  if (!path) return { cancelled: true };

  try {
    await invoke("export_docx", { content: markdown, outputPath: path });
    return { ok: true, path };
  } catch (err) {
    return { error: String(err) };
  }
}

// ── PDF via Pandoc (requires LaTeX) ──────────────────────────────────────────

export async function exportPDFPandoc(markdown) {
  const path = await dialogSave({
    title: "Export as PDF",
    defaultPath: "document.pdf",
    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
  });
  if (!path) return { cancelled: true };

  try {
    await invoke("export_pdf_pandoc", { content: markdown, outputPath: path });
    return { ok: true, path };
  } catch (err) {
    return { error: String(err) };
  }
}

export async function pandocAvailable() {
  return invoke("check_pandoc");
}

// ── PDF via headless Chromium ────────────────────────────────────────────────
// Produces a deterministic paginated PDF by loading the already-rendered
// preview in a headless Chrome instance and calling --print-to-pdf.

export async function chromeAvailable() {
  return invoke("check_chrome");
}

async function inlineAllStyles() {
  // Collect every stylesheet currently applied to the page so the headless
  // Chrome render is visually identical to the live preview. Prefer reading
  // cssRules (works for same-origin <style> and <link>); fall back to a
  // fetch() for cross-origin sheets that throw on direct rule access.
  const parts = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      parts.push(Array.from(rules).map(r => r.cssText).join("\n"));
    } catch {
      if (sheet.href) {
        try {
          const res = await fetch(sheet.href);
          parts.push(await res.text());
        } catch {}
      }
    }
  }
  return parts.join("\n");
}

function buildPrintDocument(previewHtml, css) {
  // Force the paged-preview CSS path so .pg rules apply without relying on
  // the live app's dark theme class list.
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
${css}
/* Headless Chrome prints in the "print" media by default when invoked with
   --print-to-pdf, so the @media print block already applies. We still reset
   body margins so nothing bleeds past the @page area. */
html, body { margin: 0; padding: 0; background: #fff; }
#preview-body.preview-paged { background: #fff; padding: 0; }
</style>
</head>
<body>
<div id="preview-body" class="preview-paged">
${previewHtml}
</div>
</body>
</html>`;
}

export async function exportPDFChromium(previewEl) {
  const path = await dialogSave({
    title: "Export as PDF (Chrome)",
    defaultPath: "document.pdf",
    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
  });
  if (!path) return { cancelled: true };

  try {
    const css = await inlineAllStyles();
    const html = buildPrintDocument(previewEl.innerHTML, css);
    await invoke("export_pdf_chromium", { html, outputPath: path });
    return { ok: true, path };
  } catch (err) {
    return { error: String(err) };
  }
}
