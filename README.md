# Vaultly

A local-first media library for comics, videos, and PDF stories found in one or more source folders.

## Requirements

- Windows for the native Browse dialog (manual path entry also works)
- Node.js 22.13 or newer
- pnpm 11

## Start

```powershell
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`. The API listens only on `127.0.0.1:4310`. SQLite data is stored in `runtime/vaultly.db`, which is ignored by Git. The local source files are read, not moved or modified.

## Current scope

- Register multiple directory roots, including folders containing mixed media.
- Scan nested folders for videos, PDFs, CBZ/ZIP comics, and image-based comic folders.
- Persist source records and indexed item metadata in SQLite.
- Show per-source counts, scanning state, errors, and last scan time.
- Rescan or remove a source. Removing one only deletes its Vaultly records.
- Browse all media or filter to Comics, Videos, and Stories.
- Search indexed titles and paths, filter by category, and sort by title, modified date, or size.
- Generate and cache video and PDF first-page thumbnails on demand; hover a video card for a muted preview.
- Play browser-supported video files without cropping, with range-based seeking and keyboard shortcuts.
- Read PDFs with a page-at-a-time viewer, fit-page/fit-width modes, zoom, and keyboard page navigation; page through image-folder comics.
- Create, rename, and delete categories; assign them to individual items.
- Edit an item title without losing it during a rescan.

CBZ/ZIP archives are indexed but not yet readable in-browser. Video formats unsupported by the browser need a future compatibility transcoder. Live folder watching and a dedicated high-volume search index are also future work. Node's built-in SQLite API is currently experimental and may change in future Node releases; use the stated Node version for now.
