use std::io::{Read, Write};
use std::path::PathBuf;

// ── File I/O commands ─────────────────────────────────────────────────────────

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

// ── Print ─────────────────────────────────────────────────────────────────────

#[tauri::command]
fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

// ── Chromium PDF export ───────────────────────────────────────────────────────
// Drives a headless Chromium via CDP to produce deterministic, spec-compliant
// paginated PDF output. This bypasses WKWebView's print quirks.
//
// Resolution order for the Chromium binary:
//   1. System-installed browser at a known macOS path — zero download.
//   2. `headless_chrome`'s bundled Fetcher — downloads a pinned Chromium build
//      into the user's cache dir on first use. Cached for subsequent exports.
//
// This keeps the fast/no-download path for most users while still working out
// of the box for open-source users who don't have Chrome installed.

use headless_chrome::{Browser, LaunchOptions};
use headless_chrome::types::PrintToPdfOptions;

fn find_system_chrome() -> Option<PathBuf> {
    const CANDIDATES: &[&str] = &[
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/Applications/Arc.app/Contents/MacOS/Arc",
        "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
    ];
    for c in CANDIDATES {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

#[tauri::command]
fn check_chrome() -> bool {
    // Always "available": if no system Chrome is present, the crate will
    // auto-fetch a Chromium build on first use. The UI reflects the nuance
    // by showing which path will be taken.
    true
}

#[tauri::command]
fn chrome_status() -> &'static str {
    if find_system_chrome().is_some() { "system" } else { "fetch" }
}

fn launch_browser() -> Result<Browser, String> {
    // Build launch options; explicit path wins over crate auto-fetch.
    let system = find_system_chrome();
    let mut builder = LaunchOptions::default_builder();
    builder.headless(true).sandbox(false);
    if let Some(ref path) = system {
        builder.path(Some(path.clone()));
    }
    let opts = builder.build().map_err(|e| format!("Launch options: {e}"))?;
    Browser::new(opts).map_err(|e| format!("Could not launch Chromium: {e}"))
}

#[tauri::command]
fn export_pdf_chromium(html: String, output_path: String) -> Result<(), String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_html = std::env::temp_dir().join(format!("rustmark_print_{stamp}.html"));
    std::fs::write(&temp_html, &html)
        .map_err(|e| format!("Could not write temp HTML: {e}"))?;
    let file_url = format!("file://{}", temp_html.to_string_lossy());

    let result = (|| -> Result<(), String> {
        let browser = launch_browser()?;
        let tab = browser.new_tab().map_err(|e| format!("new_tab: {e}"))?;
        tab.navigate_to(&file_url).map_err(|e| format!("navigate: {e}"))?;
        tab.wait_until_navigated().map_err(|e| format!("wait: {e}"))?;

        let pdf = tab
            .print_to_pdf(Some(PrintToPdfOptions {
                paper_width: Some(8.5),
                paper_height: Some(11.0),
                margin_top: Some(0.0),
                margin_bottom: Some(0.0),
                margin_left: Some(0.0),
                margin_right: Some(0.0),
                print_background: Some(true),
                // Honor CSS @page size/margin rules exactly — this is the
                // whole reason for going through Chromium.
                prefer_css_page_size: Some(true),
                display_header_footer: Some(false),
                ..Default::default()
            }))
            .map_err(|e| format!("print_to_pdf: {e}"))?;

        std::fs::write(&output_path, pdf)
            .map_err(|e| format!("Could not write PDF: {e}"))
    })();

    let _ = std::fs::remove_file(&temp_html);
    result
}

// ── Export helpers ────────────────────────────────────────────────────────────

fn yaml_bool(content: &str, key: &str) -> bool {
    yaml_str(content, key).map(|v| v == "true").unwrap_or(false)
}

fn yaml_str(content: &str, key: &str) -> Option<String> {
    let rest = content.strip_prefix("---")?;
    let fm_end = rest.find("\n---").map(|i| i + 3)?;
    let fm = &content[3..fm_end];
    for line in fm.lines() {
        let mut parts = line.splitn(2, ':');
        let k = parts.next().unwrap_or("").trim();
        let v = parts.next().unwrap_or("").trim().trim_matches('"').trim_matches('\'');
        if k == key {
            return Some(v.to_string());
        }
    }
    None
}

// ── Per-platform font stacks ──────────────────────────────────────────────────
// Every OS ships a different set of "always installed" fonts. We pick a
// theme-appropriate triple (serif / sans / mono) from each platform's
// native set plus a platform-native color emoji font. This keeps PDF
// output visually consistent with each OS's conventions and avoids hard
// dependencies on Apple-only fonts like Helvetica Neue / Apple Color Emoji.
//
// These choices target fonts that are "always present" on a default OS
// install — no extra install step for the user.
struct PlatformFonts {
    serif:    &'static str,  // e.g. Times New Roman / DejaVu Serif
    sans:     &'static str,  // e.g. Helvetica Neue / Segoe UI / DejaVu Sans
    mono:     &'static str,  // e.g. Menlo / Consolas / DejaVu Sans Mono
    mono_alt: &'static str,  // typewriter variant (Courier-family)
    serif_alt:&'static str,  // alternate serif (Georgia-family)
    emoji:    &'static str,  // color emoji font
}

fn platform_fonts() -> PlatformFonts {
    #[cfg(target_os = "macos")]
    { PlatformFonts {
        serif:     "Times New Roman",
        sans:      "Helvetica Neue",
        mono:      "Menlo",
        mono_alt:  "Courier New",
        serif_alt: "Georgia",
        emoji:     "Apple Color Emoji",
    } }
    #[cfg(target_os = "windows")]
    { PlatformFonts {
        serif:     "Times New Roman",
        sans:      "Segoe UI",
        mono:      "Consolas",
        mono_alt:  "Courier New",
        serif_alt: "Georgia",
        emoji:     "Segoe UI Emoji",
    } }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    { PlatformFonts {
        // DejaVu is the near-universal Linux fallback (bundled with most
        // distros and pulled in by Tectonic's own package set). Noto Color
        // Emoji is the standard open-source color emoji font.
        serif:     "DejaVu Serif",
        sans:      "DejaVu Sans",
        mono:      "DejaVu Sans Mono",
        mono_alt:  "DejaVu Sans Mono",
        serif_alt: "DejaVu Serif",
        emoji:     "Noto Color Emoji",
    } }
}

// Map a preview theme to Pandoc/LaTeX variables so the PDF output visually
// aligns with the selected in-app theme. Font families come from the
// per-platform stack above so the export works on macOS, Windows, and
// Linux without requiring users to install specific Apple fonts.
fn pandoc_theme_vars(theme: &str) -> Vec<(&'static str, &'static str)> {
    let f = platform_fonts();
    match theme {
        "modern" => vec![
            ("mainfont",   f.sans),
            ("sansfont",   f.sans),
            ("monofont",   f.mono),
            ("fontsize",   "11pt"),
            ("linestretch","1.4"),
            ("geometry",   "margin=1in"),
            ("colorlinks", "true"),
            ("linkcolor",  "NavyBlue"),
        ],
        "academic" => vec![
            ("mainfont",       f.serif),
            ("sansfont",       f.sans),
            ("monofont",       f.mono_alt),
            ("fontsize",       "12pt"),
            ("linestretch",    "1.5"),
            ("geometry",       "margin=1in"),
            ("documentclass",  "article"),
        ],
        "minimal" => vec![
            ("mainfont",   f.serif_alt),
            ("sansfont",   f.sans),
            ("monofont",   f.mono),
            ("fontsize",   "11pt"),
            ("linestretch","1.6"),
            ("geometry",   "margin=1.25in"),
        ],
        // classic (and unknown) — balanced system sans, mirrors the default
        // preview look.
        _ => vec![
            ("mainfont",   f.sans),
            ("sansfont",   f.sans),
            ("monofont",   f.mono),
            ("fontsize",   "11pt"),
            ("linestretch","1.4"),
            ("geometry",   "margin=1in"),
        ],
    }
}

// LaTeX header snippet to drop into `-V header-includes=...`. Intentionally
// does NOT attempt color-emoji fallback: Tectonic's XeTeX backend (and most
// XeLaTeX installs) can't load color bitmap fonts like Apple Color Emoji /
// Segoe UI Emoji, which aborts the compile with a fontspec error.
// Emoji-heavy documents should use the Chrome PDF export path, which
// renders emoji via the OS color emoji font natively.
fn pandoc_header_includes(_fontspec_capable: bool) -> String {
    // Prevent right-margin overflow:
    //   • fvextra + breaklines wraps long code lines in the Highlighting env.
    //   • emergencystretch + \sloppy loosens line breaking on paragraphs
    //     containing long unbreakable tokens (URLs, IDs, long words).
    String::from(
        "\\usepackage{fvextra}\
         \\DefineVerbatimEnvironment{Highlighting}{Verbatim}{breaklines,commandchars=\\\\\\{\\}}\
         \\setlength{\\emergencystretch}{3em}\
         \\sloppy"
    )
}

// Engines that accept fontspec-based font selection (system fonts by name,
// Unicode glyph coverage, color emoji via HarfBuzz renderer).
fn is_fontspec_engine(engine: &str) -> bool {
    let lower = engine.to_lowercase();
    lower.ends_with("xelatex")
        || lower.ends_with("lualatex")
        || lower.ends_with("tectonic")
}

// Produces a reference.docx with a centered page-number footer.
// Takes Pandoc's built-in reference.docx and injects footer XML into the ZIP.
fn make_paged_reference_docx() -> Result<PathBuf, String> {
    let pandoc = ensure_pandoc()?;
    let out = std::process::Command::new(&pandoc)
        .arg("--print-default-data-file")
        .arg("reference.docx")
        .output()
        .map_err(|e| format!("Could not run pandoc: {e}"))?;

    if !out.status.success() || out.stdout.is_empty() {
        return Err(format!(
            "Pandoc could not export reference.docx: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    let cursor = std::io::Cursor::new(out.stdout);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("Could not open reference.docx ZIP: {e}"))?;

    let dest = std::env::temp_dir().join("rustmark_ref_paged.docx");
    let dest_file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut writer = zip::ZipWriter::new(dest_file);

    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let footer_xml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
        <w:ftr xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"\
               xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\
          <w:p>\
            <w:pPr><w:jc w:val=\"center\"/></w:pPr>\
            <w:r><w:fldChar w:fldCharType=\"begin\"/></w:r>\
            <w:r><w:instrText xml:space=\"preserve\"> PAGE </w:instrText></w:r>\
            <w:r><w:fldChar w:fldCharType=\"end\"/></w:r>\
          </w:p>\
        </w:ftr>";

    let footer_rel  = "<Relationship Id=\"rIdFtr1\" \
        Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer\" \
        Target=\"footer1.xml\"/>";
    let footer_ct   = "<Override PartName=\"/word/footer1.xml\" \
        ContentType=\"application/vnd.openxmlformats-officedocument\
        .wordprocessingml.footer+xml\"/>";
    let footer_ref  = "<w:footerReference w:type=\"default\" r:id=\"rIdFtr1\"/>";

    let names: Vec<String> = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
        .collect();

    let mut found_doc_rels = false;

    for name in &names {
        let mut entry = archive.by_name(name).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;

        match name.as_str() {
            "[Content_Types].xml" => {
                let mut xml = String::from_utf8_lossy(&bytes).into_owned();
                if !xml.contains("footer1.xml") {
                    // Insert before the last </Types>
                    if let Some(pos) = xml.rfind("</Types>") {
                        xml.insert_str(pos, footer_ct);
                    }
                }
                writer.start_file(name, opts).map_err(|e| e.to_string())?;
                writer.write_all(xml.as_bytes()).map_err(|e| e.to_string())?;
            }
            "word/_rels/document.xml.rels" => {
                found_doc_rels = true;
                let mut xml = String::from_utf8_lossy(&bytes).into_owned();
                if !xml.contains("footer1.xml") {
                    if let Some(pos) = xml.rfind("</Relationships>") {
                        xml.insert_str(pos, footer_rel);
                    }
                }
                writer.start_file(name, opts).map_err(|e| e.to_string())?;
                writer.write_all(xml.as_bytes()).map_err(|e| e.to_string())?;
            }
            "word/document.xml" => {
                let mut xml = String::from_utf8_lossy(&bytes).into_owned();
                if !xml.contains("w:footerReference") {
                    // Pandoc's reference.docx uses self-closing <w:sectPr/> —
                    // expand it so we can insert the footerReference inside.
                    if xml.contains("<w:sectPr/>") {
                        xml = xml.replace(
                            "<w:sectPr/>",
                            &format!("<w:sectPr>{footer_ref}</w:sectPr>"),
                        );
                    } else if let Some(pos) = xml.rfind("</w:sectPr>") {
                        xml.insert_str(pos, footer_ref);
                    }
                    // If sectPr has attributes: <w:sectPr w:rsidR="..."/>
                    // handle that too
                    let xml2 = xml.clone();
                    if !xml2.contains("w:footerReference") {
                        // Try attribute form
                        if let Some(start) = xml2.rfind("<w:sectPr ") {
                            if let Some(end) = xml2[start..].find("/>") {
                                let abs_end = start + end;
                                xml = format!(
                                    "{}>{}{}</w:sectPr>{}",
                                    &xml2[..abs_end],
                                    footer_ref,
                                    "",
                                    &xml2[abs_end + 2..]
                                );
                            }
                        }
                    }
                }
                writer.start_file(name, opts).map_err(|e| e.to_string())?;
                writer.write_all(xml.as_bytes()).map_err(|e| e.to_string())?;
            }
            _ => {
                writer.start_file(name, opts).map_err(|e| e.to_string())?;
                writer.write_all(&bytes).map_err(|e| e.to_string())?;
            }
        }
    }

    // If the reference.docx had no document.xml.rels, create a minimal one
    if !found_doc_rels {
        let rels = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
             <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
             {footer_rel}</Relationships>"
        );
        writer.start_file("word/_rels/document.xml.rels", opts).map_err(|e| e.to_string())?;
        writer.write_all(rels.as_bytes()).map_err(|e| e.to_string())?;
    }

    writer.start_file("word/footer1.xml", opts).map_err(|e| e.to_string())?;
    writer.write_all(footer_xml.as_bytes()).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;

    Ok(dest)
}

// ── Pandoc (auto-fetched) ────────────────────────────────────────────────────
// Same fetch pattern as Tectonic: prefer a system install, otherwise download
// a pinned release binary into the user cache on first use.

const PANDOC_VERSION: &str = "3.5";

fn pandoc_path() -> PathBuf {
    cache_dir().join("pandoc").join(format!("pandoc-{PANDOC_VERSION}")).join("bin").join("pandoc")
}

fn pandoc_target() -> &'static str {
    #[cfg(target_arch = "aarch64")] { "arm64" }
    #[cfg(target_arch = "x86_64")]  { "x86_64" }
}

fn find_system_pandoc() -> Option<PathBuf> {
    std::process::Command::new("pandoc")
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|_| PathBuf::from("pandoc"))
}

fn ensure_pandoc() -> Result<PathBuf, String> {
    if let Some(p) = find_system_pandoc() {
        return Ok(p);
    }
    let dest = pandoc_path();
    if dest.exists() {
        return Ok(dest);
    }

    let target = pandoc_target();
    let url = format!(
        "https://github.com/jgm/pandoc/releases/download/{v}/pandoc-{v}-{t}-macOS.zip",
        v = PANDOC_VERSION,
        t = target,
    );

    let dir = cache_dir().join("pandoc");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir cache: {e}"))?;
    let zip_path = dir.join("pandoc.zip");

    let curl = std::process::Command::new("curl")
        .arg("-fsSL")
        .arg("-o").arg(&zip_path)
        .arg(&url)
        .status()
        .map_err(|e| format!("curl: {e}"))?;
    if !curl.success() {
        return Err(format!("Failed to download Pandoc from {url}"));
    }

    let unzip = std::process::Command::new("unzip")
        .arg("-q").arg("-o")
        .arg(&zip_path)
        .arg("-d").arg(&dir)
        .status()
        .map_err(|e| format!("unzip: {e}"))?;
    let _ = std::fs::remove_file(&zip_path);
    if !unzip.success() {
        return Err("Failed to extract Pandoc archive".into());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&dest) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&dest, perms);
        }
    }

    if !dest.exists() {
        return Err("Pandoc archive did not contain expected binary".into());
    }
    Ok(dest)
}

// ── Export commands ───────────────────────────────────────────────────────────

#[tauri::command]
fn check_pandoc() -> bool {
    // Always resolvable: system pandoc wins, otherwise auto-download on demand.
    true
}

#[tauri::command]
fn pandoc_status() -> &'static str {
    if find_system_pandoc().is_some() { "system" }
    else if pandoc_path().exists()    { "cached" }
    else                              { "fetch"  }
}

#[tauri::command]
fn export_docx(content: String, output_path: String) -> Result<(), String> {
    let temp = std::env::temp_dir().join("rustmark_export.md");
    std::fs::write(&temp, &content).map_err(|e| e.to_string())?;

    let want_pages = yaml_bool(&content, "pagenumbers");
    let pandoc = ensure_pandoc()?;

    let mut cmd = std::process::Command::new(&pandoc);
    cmd.arg(&temp)
        .arg("-o").arg(&output_path)
        .arg("--standalone");

    if want_pages {
        let ref_path = make_paged_reference_docx()?;
        cmd.arg("--reference-doc").arg(&ref_path);
    }

    let result = cmd.output();
    let _ = std::fs::remove_file(&temp);

    match result {
        Err(e) => Err(e.to_string()),
        Ok(out) if !out.status.success() => {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
        Ok(_) => Ok(()),
    }
}

// ── Tectonic (auto-fetched LaTeX engine) ──────────────────────────────────────
// Tectonic is a self-contained, modern LaTeX engine that pulls packages on
// demand from TeXLive. We download a pinned release binary into the user's
// cache dir on first use — so users don't need a full MacTeX/BasicTeX install.
//
// Mirrors the `headless_chrome` fetch pattern: preferred fast path is a system
// install (xelatex/tectonic on PATH); slow path is a one-time binary download.

const TECTONIC_VERSION: &str = "0.15.0";

fn cache_dir() -> PathBuf {
    if let Some(home) = std::env::var_os("HOME") {
        PathBuf::from(home).join("Library/Caches/rustmark")
    } else {
        std::env::temp_dir().join("rustmark-cache")
    }
}

fn tectonic_path() -> PathBuf {
    cache_dir().join("tectonic").join("tectonic")
}

fn tectonic_target() -> &'static str {
    // macOS-only distribution for now.
    #[cfg(target_arch = "aarch64")] { "aarch64-apple-darwin" }
    #[cfg(target_arch = "x86_64")]  { "x86_64-apple-darwin"  }
}

fn find_system_tectonic() -> Option<PathBuf> {
    std::process::Command::new("tectonic")
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|_| PathBuf::from("tectonic"))
}

fn ensure_tectonic() -> Result<PathBuf, String> {
    if let Some(p) = find_system_tectonic() {
        return Ok(p);
    }
    let dest = tectonic_path();
    if dest.exists() {
        return Ok(dest);
    }

    let target = tectonic_target();
    let url = format!(
        "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40{v}/tectonic-{v}-{t}.tar.gz",
        v = TECTONIC_VERSION,
        t = target,
    );

    let dir = dest.parent().unwrap().to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir cache: {e}"))?;
    let tar_path = dir.join("tectonic.tar.gz");

    // Use system curl — present on every macOS install, avoids pulling in an
    // HTTP crate just for a one-shot download.
    let curl = std::process::Command::new("curl")
        .arg("-fsSL")
        .arg("-o").arg(&tar_path)
        .arg(&url)
        .status()
        .map_err(|e| format!("curl: {e}"))?;
    if !curl.success() {
        return Err(format!("Failed to download Tectonic from {url}"));
    }

    let untar = std::process::Command::new("tar")
        .arg("-xzf").arg(&tar_path)
        .arg("-C").arg(&dir)
        .status()
        .map_err(|e| format!("tar: {e}"))?;
    let _ = std::fs::remove_file(&tar_path);
    if !untar.success() {
        return Err("Failed to extract Tectonic archive".into());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&dest) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&dest, perms);
        }
    }

    if !dest.exists() {
        return Err("Tectonic archive did not contain expected binary".into());
    }
    Ok(dest)
}

#[tauri::command]
fn tectonic_status() -> &'static str {
    if find_system_tectonic().is_some() { "system" }
    else if tectonic_path().exists()    { "cached" }
    else                                { "fetch"  }
}

#[tauri::command]
fn export_pdf_pandoc(content: String, output_path: String) -> Result<(), String> {
    let temp = std::env::temp_dir().join("rustmark_export.md");
    std::fs::write(&temp, &content).map_err(|e| e.to_string())?;

    let want_pages = yaml_bool(&content, "pagenumbers");

    // Resolution order for the LaTeX engine:
    //   1. System-installed engines (fastest — already on PATH).
    //   2. Auto-fetched Tectonic in the user's cache dir (downloaded once).
    // System engines first so users with MacTeX/BasicTeX aren't surprised by
    // a download; Tectonic is the fallback for a zero-setup experience.
    let pandoc = ensure_pandoc()?;
    // Prefer xelatex first: the theme vars below use fontspec (mainfont /
    // sansfont / monofont), which requires xelatex, lualatex, or tectonic.
    // pdflatex is kept as a last resort — it will silently ignore the font
    // vars but still produces a PDF.
    let mut engines: Vec<String> = vec![
        "xelatex".into(), "lualatex".into(),
    ];
    let tectonic_err = match ensure_tectonic() {
        Ok(path) => { engines.push(path.to_string_lossy().into_owned()); None }
        Err(e)   => Some(e),
    };
    engines.push("pdflatex".into());
    engines.push("wkhtmltopdf".into());

    let theme = yaml_str(&content, "theme").unwrap_or_else(|| "classic".into());
    let theme_vars = pandoc_theme_vars(&theme);
    let want_toc       = yaml_bool(&content, "toc");
    let want_titlepage = yaml_bool(&content, "titlepage");
    let toc_depth      = yaml_str(&content, "toc-depth").unwrap_or_else(|| "2".into());

    // Collect per-engine outcomes so we can surface the most useful error
    // instead of silently overwriting with whichever engine ran last.
    // (Previously wkhtmltopdf — always absent — was clobbering the real
    // error from tectonic/xelatex.)
    let mut failures: Vec<(String, String)> = Vec::new();

    for engine in &engines {
        let fontspec = is_fontspec_engine(engine);
        let mut cmd = std::process::Command::new(&pandoc);
        cmd.arg(&temp)
            .arg("-o").arg(&output_path)
            .arg("--standalone")
            .arg(format!("--pdf-engine={}", engine));

        // Font selection requires fontspec; pdflatex would choke on
        // `mainfont`/`sansfont`/`monofont` with "Unknown font family". Only
        // send the typography-related theme vars to fontspec-capable engines.
        for (k, v) in &theme_vars {
            let is_font_var = matches!(*k, "mainfont" | "sansfont" | "monofont");
            if is_font_var && !fontspec { continue; }
            cmd.arg("--variable").arg(format!("{k}={v}"));
        }

        cmd.arg("--variable").arg(format!("header-includes={}", pandoc_header_includes(fontspec)));
        cmd.arg("--variable").arg("hyperrefoptions=breaklinks");

        // Table of contents — pandoc generates it from headings and inserts
        // at the top of the body. `--toc-depth` controls heading depth.
        if want_toc {
            cmd.arg("--toc").arg(format!("--toc-depth={toc_depth}"));
        }

        // Title page — the LaTeX `article` class packs title+abstract onto
        // page 1 by default. The `titlepage` classoption moves the title
        // block to its own dedicated page, matching the preview layout.
        // `report` and `book` classes already do this, so only apply when
        // the class defaults to inline-title behavior.
        if want_titlepage {
            cmd.arg("--variable").arg("classoption=titlepage");
        }

        if !want_pages {
            cmd.arg("--variable").arg("pagestyle=empty");
        }

        let label = engine.rsplit('/').next().unwrap_or(engine).to_string();
        match cmd.output() {
            Ok(out) if out.status.success() => {
                let _ = std::fs::remove_file(&temp);
                return Ok(());
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                let msg = if stderr.is_empty() {
                    format!("exit code {}", out.status.code().unwrap_or(-1))
                } else {
                    stderr
                };
                failures.push((label, msg));
            }
            Err(e) => {
                failures.push((label, format!("could not execute: {e}")));
            }
        }
    }

    let _ = std::fs::remove_file(&temp);

    // Build a multi-engine failure report. Put the most informative error
    // (longest stderr, usually the actual LaTeX failure) first.
    failures.sort_by_key(|(_, msg)| std::cmp::Reverse(msg.len()));
    let details = failures
        .iter()
        .map(|(eng, msg)| format!("── {eng} ──\n{msg}"))
        .collect::<Vec<_>>()
        .join("\n\n");

    let tectonic_note = tectonic_err
        .map(|e| format!("\n\nTectonic auto-download failed — that's why tectonic isn't in the list above:\n{e}"))
        .unwrap_or_default();

    Err(format!(
        "All LaTeX engines failed. Install a system engine (xelatex, lualatex, pdflatex) \
         or check the Tectonic auto-download.\n\n{details}{tectonic_note}"
    ))
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            rename_file,
            file_exists,
            print_page,
            check_pandoc,
            export_docx,
            export_pdf_pandoc,
            check_chrome,
            chrome_status,
            export_pdf_chromium,
            tectonic_status,
            pandoc_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
