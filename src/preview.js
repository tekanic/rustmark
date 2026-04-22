import MarkdownIt from "markdown-it";
import markdownItFootnote from "markdown-it-footnote";
import markdownItTaskLists from "markdown-it-task-lists";
import markdownItMark from "markdown-it-mark";
import markdownItSub from "markdown-it-sub";
import markdownItSup from "markdown-it-sup";
import markdownItIns from "markdown-it-ins";
import { full as markdownItEmoji } from "markdown-it-emoji";
import markdownItContainer from "markdown-it-container";
import markdownItDeflist from "markdown-it-deflist";
import markdownItAnchor from "markdown-it-anchor";
import markdownItToc from "markdown-it-toc-done-right";
import markdownItTexmath from "markdown-it-texmath";
import katex from "katex";
import hljs from "highlight.js";

// Shared slugifier so anchor IDs and TOC hrefs stay in sync
const slugify = s =>
  s.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");

// Container types with icon + colour class
const CONTAINERS = {
  note:    { icon: "📝", label: "Note" },
  tip:     { icon: "💡", label: "Tip" },
  info:    { icon: "ℹ️",  label: "Info" },
  warning: { icon: "⚠️",  label: "Warning" },
  danger:  { icon: "🚨", label: "Danger" },
};

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch {}
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
  },
})
  .use(markdownItAnchor, { slugify })
  .use(markdownItToc, { slugify, containerClass: "toc", listType: "ul" })
  .use(markdownItFootnote)
  .use(markdownItTaskLists, { enabled: true, label: true })
  .use(markdownItMark)
  .use(markdownItSub)
  .use(markdownItSup)
  .use(markdownItIns)
  .use(markdownItEmoji)
  .use(markdownItDeflist)
  .use(markdownItTexmath, { engine: katex, delimiters: "dollars", katexOptions: { throwOnError: false } });

// Register all container types
Object.entries(CONTAINERS).forEach(([type, { icon, label }]) => {
  md.use(markdownItContainer, type, {
    render(tokens, idx) {
      if (tokens[idx].nesting === 1) {
        const customTitle = tokens[idx].info.trim().slice(type.length).trim();
        const title = customTitle || label;
        return `<div class="md-container md-container-${type}"><div class="md-container-title">${icon} ${title}</div>\n`;
      }
      return `</div>\n`;
    },
  });
});

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

function parseFrontMatter(text) {
  const m = text.match(FM_RE);
  if (!m) return { content: text, fields: {} };
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    fields[k] = v;
  }
  return { content: text.slice(m[0].length), fields };
}

// ── Page geometry (US Letter, 1" margins) ────────────────────────────────────
// CSS `in` unit is 96px at standard DPI — using px constants keeps measurement
// and layout in the same unit system.
const DPI            = 96;
const PAGE_W_PX      = 8.5 * DPI;   // 816
const PAGE_H_PX      = 11  * DPI;   // 1056
const MARGIN_PX      = 1   * DPI;   // 96
const CONTENT_W_PX   = PAGE_W_PX - 2 * MARGIN_PX; // 624
// Body slot is 9in (864px) visually, but packing to exactly 864 leaves no
// slack for sub-pixel rendering differences between the measurer and the real
// flex-constrained .pg-body — any drift spills a .pg into the next physical
// page during print, duplicating the footer and creating a blank sheet.
// Pack into a slightly smaller budget so we always fit with ~24px headroom.
const CONTENT_H_PX   = 840;

let debounceTimer = null;
let currentMarkdown = "";
let currentTargetEl = null;

export function renderPreview(markdown, targetEl, opts = {}) {
  currentMarkdown = markdown;
  currentTargetEl = targetEl;
  renderToken++;  // invalidates any pending image-load callbacks from earlier renders

  const { content, fields } = parseFrontMatter(markdown);
  const html = md.render(content);
  renderPaginated(html, targetEl, fields, opts);
}

function wireLinks(root) {
  root.querySelectorAll("a[href]").forEach(a => {
    const href = a.getAttribute("href");
    if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
      a.addEventListener("click", e => {
        e.preventDefault();
        import("@tauri-apps/plugin-shell").then(({ open }) => open(href)).catch(() => {});
      });
    }
  });
}

function renderPaginated(html, targetEl, fields, opts = {}) {
  // Preserve scroll position across re-renders so typing doesn't jump the view
  const scroller = targetEl.parentElement;
  const savedScroll = scroller ? scroller.scrollTop : 0;

  // ── 1. Offscreen measurement ──────────────────────────────────────────────
  // The measurer must render with identical typography and width to the
  // eventual .pg-body, otherwise line breaks and heights won't match.
  // Use the same class stack as .pg-body so font, line-height, and block
  // margins match the actual page layout exactly.
  const themeClass = {
    modern:   "pg-theme-modern",
    academic: "pg-theme-academic",
    minimal:  "pg-theme-minimal",
  }[fields.theme] || "pg-theme-classic";

  const measure = document.createElement("article");
  measure.className = `markdown-body pg-body pg-measure ${themeClass}`;
  // Don't force padding:0 here — themes (e.g. minimal) add horizontal padding
  // to .pg-body, and the measurer must match the real page body exactly or
  // wrapped-line heights will drift and pages will over/underfill.
  measure.style.cssText =
    `position:absolute;visibility:hidden;left:-99999px;top:0;` +
    `width:${CONTENT_W_PX}px;max-width:none;`;
  measure.innerHTML = html;
  document.body.appendChild(measure);

  // Split top-level children into pages by greedily packing them. Using
  // offsetTop in the measurer's coordinate space implicitly accounts for
  // margin-collapsing between siblings.
  const children = Array.from(measure.children);
  const measureTop = measure.getBoundingClientRect().top;
  const pageGroups = splitIntoPages(children, measureTop);

  // ── 2. Build page DOM ──────────────────────────────────────────────────────
  const hasTitlePage =
    fields.titlepage === "true" && (fields.title || fields.author || fields.date);
  const wantPageNumbers = fields.pagenumbers === "true";
  const wantToc = fields.toc === "true";
  const tocDepth = Math.max(1, Math.min(6, parseInt(fields["toc-depth"] || "2", 10) || 2));

  // Extract headings while the measurer is still attached — querySelector on
  // a live tree is the most reliable way to enumerate h1..hN.
  const headings = wantToc ? extractHeadings(measure, tocDepth) : [];

  // Annotate each heading with the displayed page number it lands on.
  // With a TOC page present, body[0] is content index 1 → displayed "2",
  // body[i] → displayed `i + 2`, matching the footer numbering.
  if (wantToc) {
    headings.forEach(h => {
      const gi = findGroupIndex(pageGroups, h.el);
      h.page = gi >= 0 ? gi + 2 : null;
    });
  }

  document.body.removeChild(measure);

  // Page numbering convention: the title page is unnumbered. The first
  // content page (TOC if present, else the first body page) is also
  // unnumbered. From the 2nd content page onward, each page shows its
  // actual 1-based position among content pages, so numbering begins at 2.
  const totalContent = pageGroups.length + (wantToc ? 1 : 0);

  targetEl.innerHTML = "";

  if (hasTitlePage) {
    const tp = buildTitlePage(fields, themeClass);
    appendFooter(tp, fields, null);  // title page is always unnumbered
    targetEl.appendChild(tp);
  }

  let contentIndex = 0;  // 0-based index across content pages (TOC + body)

  if (wantToc) {
    const tocPage = buildTocPage(headings, fields, themeClass);
    appendFooter(tocPage, fields, null);  // 1st content page is unnumbered
    targetEl.appendChild(tocPage);
    contentIndex++;
  }

  pageGroups.forEach(nodes => {
    const isFirstContent = contentIndex === 0;
    const info = wantPageNumbers && !isFirstContent
      ? { num: contentIndex + 1, total: totalContent }
      : null;
    const page = buildPage(nodes, fields, info, themeClass);
    targetEl.appendChild(page);
    contentIndex++;
  });

  // ── 3. Restore scroll + wire links ────────────────────────────────────────
  if (scroller) scroller.scrollTop = savedScroll;
  wireLinks(targetEl);

  // Late-loading images can change layout — re-paginate once they finish.
  // Skip when this render was itself triggered by an image-load callback,
  // otherwise slow/streaming images can drive an unbounded re-render loop.
  if (!opts.skipImageSchedule) schedulePaginationOnImageLoad(targetEl);
}

function splitIntoPages(children, measureTop) {
  // Greedy line-packing, respecting element boundaries. Returns array of
  // child-arrays, one per page. The first child of a new page defines that
  // page's vertical origin (so an oversized element doesn't retroactively
  // consume the next page's height budget).
  const groups = [[]];
  let pageStart = 0;

  for (const child of children) {
    const r = child.getBoundingClientRect();
    const top = r.top - measureTop;
    const bottom = r.bottom - measureTop;

    if (bottom - pageStart > CONTENT_H_PX && groups[groups.length - 1].length > 0) {
      groups.push([]);
      pageStart = top;
    }
    groups[groups.length - 1].push(child);
  }

  // If the source was empty, return a single empty page so the preview
  // still renders a blank sheet.
  if (groups.length === 1 && groups[0].length === 0) return [[]];
  return groups;
}

function buildPage(nodes, fields, pageInfo, themeClass = "pg-theme-classic") {
  const page = document.createElement("section");
  page.className = "pg";

  // Header zone — always present so body height stays consistent.
  const h = document.createElement("div");
  h.className = "pg-header";
  h.textContent = fields.header || "";
  page.appendChild(h);

  const body = document.createElement("article");
  body.className = `markdown-body pg-body ${themeClass}`;
  nodes.forEach(n => body.appendChild(n));
  page.appendChild(body);

  appendFooter(page, fields, pageInfo);
  return page;
}

function extractHeadings(root, maxDepth) {
  const selector = Array.from({ length: maxDepth }, (_, i) => `h${i + 1}`).join(",");
  return Array.from(root.querySelectorAll(selector)).map(hFromEl);
}

function findGroupIndex(pageGroups, el) {
  for (let gi = 0; gi < pageGroups.length; gi++) {
    for (const node of pageGroups[gi]) {
      if (node === el || (node.contains && node.contains(el))) return gi;
    }
  }
  return -1;
}

function hFromEl(h) {
  const text = h.textContent.replace(/¶/g, "").trim();
  return {
    level: parseInt(h.tagName.slice(1), 10),
    text,
    id: h.id || "",
    el: h,
  };
}

function buildTocPage(headings, fields, themeClass = "pg-theme-classic") {
  const page = document.createElement("section");
  page.className = "pg pg-toc";

  const h = document.createElement("div");
  h.className = "pg-header";
  h.textContent = fields.header || "";
  page.appendChild(h);

  const body = document.createElement("article");
  body.className = `markdown-body pg-body ${themeClass}`;
  const title = document.createElement("h1");
  title.textContent = "Table of Contents";
  body.appendChild(title);

  const list = document.createElement("ul");
  list.className = "pg-toc-list";
  headings.forEach(({ level, text, id, page }) => {
    const li = document.createElement("li");
    li.style.marginLeft = `${(level - 1) * 1.25}em`;

    const label = document.createElement("span");
    label.className = "pg-toc-label";
    if (id) {
      const a = document.createElement("a");
      a.href = `#${id}`;
      a.textContent = text;
      label.appendChild(a);
    } else {
      label.textContent = text;
    }

    const leader = document.createElement("span");
    leader.className = "pg-toc-leader";

    const num = document.createElement("span");
    num.className = "pg-toc-page";
    num.textContent = page != null ? String(page) : "";

    li.appendChild(label);
    li.appendChild(leader);
    li.appendChild(num);
    list.appendChild(li);
  });
  body.appendChild(list);
  page.appendChild(body);
  return page;
}

function buildTitlePage(fields, themeClass = "pg-theme-classic") {
  const page = document.createElement("section");
  page.className = `pg pg-title ${themeClass}`;

  // Keep the 3-zone skeleton so flex layout stays balanced.
  const h = document.createElement("div");
  h.className = "pg-header";
  page.appendChild(h);

  const body = document.createElement("div");
  body.className = "pg-title-body";
  if (fields.title)  body.insertAdjacentHTML("beforeend", `<h1 class="pg-title-h1">${escapeHtml(fields.title)}</h1>`);
  if (fields.author) body.insertAdjacentHTML("beforeend", `<div class="pg-title-author">${escapeHtml(fields.author)}</div>`);
  if (fields.date)   body.insertAdjacentHTML("beforeend", `<div class="pg-title-date">${escapeHtml(fields.date)}</div>`);
  page.appendChild(body);
  return page;
}

function appendFooter(page, fields, pageInfo) {
  const f = document.createElement("div");
  f.className = "pg-footer";
  const left   = "";
  const middle = fields.footer || "";
  const right  = pageInfo ? `${pageInfo.num} / ${pageInfo.total}` : "";
  f.innerHTML =
    `<span class="pg-f-left">${escapeHtml(left)}</span>` +
    `<span class="pg-f-mid">${escapeHtml(middle)}</span>` +
    `<span class="pg-f-right">${escapeHtml(right)}</span>`;
  page.appendChild(f);
}

// A monotonically-increasing render token. Listeners bound to a prior render
// check the token before acting; anything stale is a no-op. This prevents
// stuck state when the user opens a new document while images are in flight.
let renderToken = 0;

function schedulePaginationOnImageLoad(targetEl) {
  const imgs = targetEl.querySelectorAll("img");
  const pending = [];
  imgs.forEach(img => { if (!img.complete) pending.push(img); });
  if (pending.length === 0) return;

  const myToken = renderToken;
  let remaining = pending.length;
  const onDone = () => {
    remaining--;
    if (remaining > 0) return;
    if (myToken !== renderToken) return;          // superseded by a newer render
    if (currentTargetEl !== targetEl) return;     // preview element swapped
    if (currentMarkdown) renderPreview(currentMarkdown, targetEl, { skipImageSchedule: true });
  };
  pending.forEach(img => {
    img.addEventListener("load",  onDone, { once: true });
    img.addEventListener("error", onDone, { once: true });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

let _lastFmRaw = null;

function extractFmRaw(text) {
  if (!text) return "";
  const m = text.match(FM_RE);
  return m ? m[0] : "";
}

export function scheduleRender(markdown, targetEl, delay = 150) {
  clearTimeout(debounceTimer);
  // If the front-matter block changed, render immediately so structural
  // settings (theme, toc, titlepage, pagenumbers, header/footer) reflect
  // manual edits without waiting for the debounce.
  const fmRaw = extractFmRaw(markdown);
  if (fmRaw !== _lastFmRaw) {
    _lastFmRaw = fmRaw;
    renderPreview(markdown, targetEl);
    return;
  }
  debounceTimer = setTimeout(() => renderPreview(markdown, targetEl), delay);
}
