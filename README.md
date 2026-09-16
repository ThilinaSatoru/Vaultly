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
- Match existing category and tag names against complete words or phrases in filenames during every scan; rescan adds newly matching metadata without clearing manual assignments. Cast/artist names are matched only when their role is already established elsewhere.
- Browse all media or filter to Comics, Videos, and Stories.
- Search titles and paths, or filter specifically by filename. Combine media type, source, format, series membership, categories, tags, size, and modified-date filters; sort by title, filename, date, or size.
- Generate and cache video and PDF first-page thumbnails on demand; hover a video card for a muted preview.
- Play browser-supported video files without cropping, with range-based seeking and keyboard shortcuts.
- Read PDFs with a page-at-a-time viewer, fit-page/fit-width modes, zoom, and keyboard page navigation; page through image-folder comics.
- Create, rename, and delete categories; assign them to individual items.
- Create, rename, and delete tags; assign multiple tags through a searchable picker, browse them as badges, and filter by several tags at once.
- Create ordered series or sets containing any mix of comics, videos, and PDFs. Give each set its own title, description, tags, and optional PNG/JPEG/WebP cover (up to 5 MB); add or reorder entries without moving media files.
- Browse sets in separate video, comic, story, and mixed sections; move to the previous or next file while viewing an ordered set.
- Select media cards across pages and bulk add or remove tags, categories, series membership, cast, and artists without replacing unrelated metadata.
- Assign searchable multi-person cast and artist credits to any media type, and manage names from the People section.
- Edit an item title without losing it during a rescan.
- Keep a separate, local Chordify song library: create named playlists, add Chordify song links, reorder or remove songs, and open a song on Chordify when ready to play. Chordify playlists do not use Vaultly tags, categories, series, or media folders.

CBZ/ZIP archives are indexed but not yet readable in-browser. Video formats unsupported by the browser need a future compatibility transcoder. Live folder watching and a dedicated high-volume search index are also future work. Node's built-in SQLite API is currently experimental and may change in future Node releases; use the stated Node version for now.
