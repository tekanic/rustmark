import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";

export async function openFile() {
  const path = await dialogOpen({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
  });
  if (!path) return null;
  const content = await invoke("read_file", { path });
  return { path, content };
}

export async function readFile(path) {
  return invoke("read_file", { path });
}

export async function saveFile(path, content) {
  await invoke("write_file", { path, content });
}

export async function saveFileAs(currentPath, content) {
  const suggestedName = currentPath ? currentPath.split("/").pop() : "untitled.md";
  const path = await dialogSave({
    defaultPath: suggestedName,
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
  });
  if (!path) return null;
  await invoke("write_file", { path, content });
  return path;
}

export async function renameFile(oldPath, newPath) {
  await invoke("rename_file", { oldPath, newPath });
}

export async function fileExists(path) {
  return invoke("file_exists", { path });
}

export function basename(path) {
  return path ? path.split("/").pop() : "untitled.md";
}

export function dirname(path) {
  if (!path) return null;
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : "/";
}

export function joinPath(dir, name) {
  return `${dir.replace(/\/$/, "")}/${name}`;
}
