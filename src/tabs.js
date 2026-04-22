// Tabs: multi-document support. Each tab owns its own CodeMirror EditorState
// (document content + undo history + selection). A single EditorView is shared
// and swapped to the active tab's state on activation.

import { createEditorStateFor, swapEditorState, getEditorContent } from "./editor.js";
import { basename } from "./fileops.js";

let view = null;
let onActivate = null;          // (tab) => void — called after a tab becomes active
let onTabsChanged = null;       // () => void — called whenever the tab bar content changes
let nextId = 1;

const tabs = [];                // [{id, path, filename, state, modified}]
let activeId = null;

const tabBar      = document.getElementById("tab-bar");
const tabBarList  = document.getElementById("tab-bar-list");
const tabNewBtn   = document.getElementById("tab-new-btn");

export function initTabs({ editor, onActivate: onAct, onTabsChanged: onChg }) {
  view        = editor;
  onActivate  = onAct;
  onTabsChanged = onChg;
  tabNewBtn.addEventListener("click", () => openNewTab());
  renderTabBar();
}

// ── Tab operations ────────────────────────────────────────────────────────────

export function openNewTab({ path = null, content = "" } = {}) {
  const filename = path ? basename(path) : untitledName();
  const state = createEditorStateFor(view, content);
  const tab = { id: nextId++, path, filename, state, modified: false };
  tabs.push(tab);
  activateTab(tab.id);
  return tab;
}

export function openFileInTab(path, content) {
  const existing = tabs.find(t => t.path === path);
  if (existing) {
    activateTab(existing.id);
    return existing;
  }
  // If the current tab is a pristine untitled one, reuse it.
  const active = getActiveTab();
  if (active && !active.path && !active.modified && active.state.doc.length === 0) {
    active.path = path;
    active.filename = basename(path);
    active.state = createEditorStateFor(view, content);
    swapEditorState(view, active.state);
    notifyActivated(active);
    renderTabBar();
    return active;
  }
  return openNewTab({ path, content });
}

export function closeTab(id, { confirmIfModified = true } = {}) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx < 0) return false;
  const tab = tabs[idx];
  if (confirmIfModified && tab.modified) {
    const name = tab.filename || "untitled.md";
    if (!confirm(`${name} has unsaved changes. Close anyway?`)) return false;
  }
  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    openNewTab();
    return true;
  }
  if (activeId === id) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    activateTab(next.id);
  } else {
    renderTabBar();
  }
  return true;
}

export function activateTab(id) {
  const target = tabs.find(t => t.id === id);
  if (!target) return;
  // Save the active tab's current live state before switching.
  const current = getActiveTab();
  if (current && current.id !== id) current.state = view.state;
  activeId = id;
  swapEditorState(view, target.state);
  notifyActivated(target);
  renderTabBar();
}

export function activateNext(offset = 1) {
  if (tabs.length < 2) return;
  const idx = tabs.findIndex(t => t.id === activeId);
  const next = tabs[(idx + offset + tabs.length) % tabs.length];
  activateTab(next.id);
}

export function activateByIndex(i) {
  if (i < 0 || i >= tabs.length) return;
  activateTab(tabs[i].id);
}

export function closeActiveTab() {
  if (activeId != null) closeTab(activeId);
}

// ── Active-tab metadata accessors ─────────────────────────────────────────────

export function getActiveTab() {
  return tabs.find(t => t.id === activeId) || null;
}

export function setActiveModified(val) {
  const t = getActiveTab();
  if (!t || t.modified === val) return;
  t.modified = val;
  renderTabBar();
}

export function setActivePath(path) {
  const t = getActiveTab();
  if (!t) return;
  t.path = path;
  t.filename = path ? basename(path) : untitledName();
  renderTabBar();
}

export function getAllTabs() { return tabs.slice(); }
export function hasUnsavedTabs() { return tabs.some(t => t.modified); }

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderTabBar() {
  tabBarList.innerHTML = tabs.map(t => {
    const active = t.id === activeId ? " active" : "";
    const mod    = t.modified ? `<span class="tab-dot" title="Unsaved changes">●</span>` : "";
    return `<div class="tab${active}" data-id="${t.id}" title="${escAttr(t.path || t.filename)}">
      <span class="tab-name">${escHtml(t.filename)}</span>
      ${mod}
      <button class="tab-close" data-id="${t.id}" title="Close (Ctrl+W)">✕</button>
    </div>`;
  }).join("");
  tabBarList.querySelectorAll(".tab").forEach(el => {
    el.addEventListener("mousedown", e => {
      // Middle-click closes
      if (e.button === 1) { e.preventDefault(); closeTab(+el.dataset.id); return; }
      if (e.button === 0 && !e.target.classList.contains("tab-close")) {
        activateTab(+el.dataset.id);
      }
    });
  });
  tabBarList.querySelectorAll(".tab-close").forEach(el => {
    el.addEventListener("click", e => {
      e.stopPropagation();
      closeTab(+el.dataset.id);
    });
  });
  if (onTabsChanged) onTabsChanged();
}

function notifyActivated(tab) {
  if (onActivate) onActivate(tab, getEditorContent(view));
}

function untitledName() {
  const used = new Set(tabs.filter(t => !t.path).map(t => t.filename));
  if (!used.has("untitled.md")) return "untitled.md";
  let n = 2;
  while (used.has(`untitled-${n}.md`)) n++;
  return `untitled-${n}.md`;
}

function escHtml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escAttr(s) { return escHtml(s).replace(/"/g, "&quot;"); }
