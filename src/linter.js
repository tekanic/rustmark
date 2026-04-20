export function lint(text) {
  const lines = text.split("\n");
  const diags = [];

  function add(lineIdx, col, msg, severity = "warning", fix = null) {
    diags.push({ line: lineIdx + 1, col: col + 1, lineIdx, msg, severity, fix });
  }

  let inFence = false;
  let fenceStart = -1;
  let fenceLang = "";
  let blankRun = 0;
  let listMarker = null;
  let listStart = -1;
  const headingLevels = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimEnd();

    // ── Fenced code blocks ────────────────────────────────────────────────────
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})(.*)/);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceStart = i;
        fenceLang = fenceMatch[2].trim();
      } else {
        inFence = false;
        fenceStart = -1;
      }
      blankRun = 0;
      continue;
    }
    if (inFence) continue;

    // ── Blank line runs ───────────────────────────────────────────────────────
    if (trimmed === "") {
      blankRun++;
      if (blankRun >= 2) {
        add(i, 0, "Multiple consecutive blank lines", "info", {
          label: "Collapse to single blank line",
          apply: t => t.replace(/\n{3,}/g, "\n\n"),
        });
      }
    } else {
      blankRun = 0;
    }

    // ── Headings ──────────────────────────────────────────────────────────────
    const hMatch = trimmed.match(/^(#{1,6})(.*)/);
    if (hMatch) {
      const level = hMatch[1].length;
      if (hMatch[2].length > 0 && hMatch[2][0] !== " ") {
        const li = i;
        add(i, hMatch[1].length, "Missing space after heading marker", "warning", {
          label: "Add space",
          apply(t) {
            const ls = t.split("\n");
            ls[li] = ls[li].replace(/^(#{1,6})([^ #\n])/, "$1 $2");
            return ls.join("\n");
          },
        });
      }
      if (headingLevels.length > 0) {
        const prev = headingLevels[headingLevels.length - 1];
        if (level > prev + 1) {
          const li = i;
          const target = prev + 1;
          add(i, 0, `Heading level skipped (h${prev} → h${level})`, "warning", {
            label: `Change to h${target}`,
            apply(t) {
              const ls = t.split("\n");
              ls[li] = ls[li].replace(/^#{1,6}/, "#".repeat(target));
              return ls.join("\n");
            },
          });
        }
      }
      headingLevels.push(level);
    }

    // ── Long lines ────────────────────────────────────────────────────────────
    if (raw.length > 120) {
      add(i, 120, `Line too long (${raw.length} chars, limit 120)`, "info");
    }

    // ── Table column consistency ───────────────────────────────────────────────
    if (trimmed.startsWith("|") && trimmed.match(/^\|[-:| ]+\|$/)) {
      const sepCols = trimmed.split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).length;
      if (i > 0 && lines[i - 1].trimEnd().startsWith("|")) {
        const prevCols = lines[i - 1].trimEnd().split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).length;
        if (sepCols !== prevCols) {
          const li = i;
          const pc = prevCols;
          add(i, 0, `Table separator has ${sepCols} columns but header has ${prevCols}`, "warning", {
            label: `Fix separator to ${prevCols} columns`,
            apply(t) {
              const ls = t.split("\n");
              ls[li] = "| " + Array(pc).fill("---").join(" | ") + " |";
              return ls.join("\n");
            },
          });
        }
      }
    }

    // ── Images: missing alt text ──────────────────────────────────────────────
    const imgRe = /!\[([^\]]*)\]\([^)]+\)/g;
    let m;
    while ((m = imgRe.exec(raw)) !== null) {
      if (!m[1].trim()) {
        const li = i;
        add(i, m.index, "Image missing alt text", "warning", {
          label: 'Add "image" as alt text',
          apply(t) {
            const ls = t.split("\n");
            ls[li] = ls[li].replace(/!\[\](\([^)]+\))/g, "![image]$1");
            return ls.join("\n");
          },
        });
      }
    }

    // ── Empty links ───────────────────────────────────────────────────────────
    const linkRe = /\[([^\]]*)\]\(\s*\)/g;
    while ((m = linkRe.exec(raw)) !== null) {
      add(i, m.index, "Link has empty URL", "warning");
    }

    // ── Bare URLs ─────────────────────────────────────────────────────────────
    const bareRe = /(?<![(\[`<])https?:\/\/\S+/g;
    while ((m = bareRe.exec(raw)) !== null) {
      const li = i;
      add(i, m.index, "Bare URL — wrap in angle brackets or a link", "info", {
        label: "Wrap in angle brackets",
        apply(t) {
          const ls = t.split("\n");
          ls[li] = ls[li].replace(/(?<![(\[`<])(https?:\/\/\S+)/g, "<$1>");
          return ls.join("\n");
        },
      });
    }

    // ── Mixed list markers ────────────────────────────────────────────────────
    const listRe = /^(\s*)([-*+]|\d+\.)\s/;
    const listMatch = raw.match(listRe);
    if (listMatch) {
      const marker = listMatch[2].replace(/\d+/, "N");
      if (listMarker === null) {
        listMarker = marker;
        listStart = i;
      } else if (listMarker !== marker && !marker.match(/N\./)) {
        const li = i;
        const targetMarker = listMarker;
        add(i, listMatch[1].length, `Mixed list markers (started with '${listMarker}' at line ${listStart + 1})`, "warning", {
          label: `Change to '${targetMarker === "N." ? "1." : targetMarker}'`,
          apply(t) {
            const ls = t.split("\n");
            ls[li] = ls[li].replace(/^(\s*)([-*+])(\s)/, `$1${targetMarker}$3`);
            return ls.join("\n");
          },
        });
      }
    } else if (!trimmed.startsWith(" ") && !trimmed.startsWith("\t")) {
      listMarker = null;
    }
  }

  // ── Unclosed code fence ───────────────────────────────────────────────────
  if (inFence) {
    const fs = fenceStart;
    const fl = fenceLang;
    const fenceChar = lines[fenceStart].match(/^(`{3,}|~{3,})/)?.[1] ?? "```";
    add(fenceStart, 0, `Unclosed code fence${fl ? ` (${fl})` : ""}`, "error", {
      label: "Close the fence",
      apply: t => t.trimEnd() + "\n" + fenceChar + "\n",
    });
  }

  return diags;
}
