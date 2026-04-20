# Phase 2 — Todo

## 1. Table Creator ✅
Modal UI for building markdown tables visually.
- [x] Row / column count inputs
- [x] Editable cell grid with Tab navigation
- [x] Column alignment controls (left / center / right)
- [x] Live markdown preview inside the modal
- [x] Insert at cursor on confirm
- [x] Toolbar button + keyboard shortcut to open (Ctrl+T)

## 2. Export (PDF / DOCX) ✅
Pandoc sidecar in Tauri for high-quality export.
- [x] PDF via window.print() + @media print CSS (no dependencies)
- [x] Export to DOCX via Pandoc (Ctrl+Shift+E)
- [x] Export to PDF via Pandoc + LaTeX engine
- [x] Export dialog: choose format, output path via save dialog
- [x] Writes markdown to temp file, invokes Pandoc, cleans up
- [x] Pandoc availability check with badge (Installed / Not installed)
- [x] Success / error feedback in modal status area

## 3. Document Settings ✅
YAML front matter panel + Pandoc integration for document layout.
- [x] "Document Settings" side drawer (toggle from toolbar, Ctrl+Shift+D)
- [x] Fields: title, author, date
- [x] Header / footer text
- [x] Page numbering toggle
- [x] Title page toggle
- [x] Table of contents toggle + depth selector
- [x] Apply button writes/updates `---` YAML front matter block in document
- [x] Pandoc picks up front matter automatically on export
