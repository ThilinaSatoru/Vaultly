export interface FolderEntry { source_id: number; path: string; name: string; item_count: number }
export function browseFolders(rows: Array<{ source_id: number; source_name: string; relative_path: string }>, source?: number, folder = "") {
  const folders = new Map<string, FolderEntry>();
  for (const row of rows) {
    if (source !== undefined && row.source_id !== source) continue;
    const parts = row.relative_path.replace(/\\/g, "/").split("/");
    parts.pop();
    if (source === undefined) {
      const key = String(row.source_id);
      const entry = folders.get(key) ?? { source_id: row.source_id, path: "", name: row.source_name, item_count: 0 };
      entry.item_count++; folders.set(key, entry);
      continue;
    }
    const parent = folder ? folder.split("/") : [];
    if (!parent.every((part, index) => parts[index] === part) || parts.length <= parent.length) continue;
    const childPath = parts.slice(0, parent.length + 1).join("/");
    const entry = folders.get(childPath) ?? { source_id: row.source_id, path: childPath, name: parts[parent.length], item_count: 0 };
    entry.item_count++; folders.set(childPath, entry);
  }
  return [...folders.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
