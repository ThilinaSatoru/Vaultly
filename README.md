# Vaultly

A local-first media library for comics, videos, and PDF stories found in one or more source folders.

## Requirements

- Node.js 22.13 or newer
- pnpm 11

## Start

```powershell
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`. The API listens only on `127.0.0.1:4400` by default. Set `VAULTLY_API_PORT` before running `pnpm dev` to use another port; the API and Vite proxy will both use it. SQLite data is stored in `runtime/vaultly.db`, which is ignored by Git. The local source files are read, not moved or modified.

## Desktop app

Vaultly also runs as a native desktop app on Windows, macOS, and Linux. The Electron shell starts the local API on loopback, stores its database and thumbnail cache in the operating system's application-data directory, and uses native folder and file-reveal dialogs.

```powershell
pnpm desktop:dev
```

Build the app, or create an installer for the current operating system:

```powershell
pnpm desktop:build
pnpm desktop:dist
```

Installer targets are NSIS on Windows, DMG on macOS, and AppImage plus Debian package on Linux. Build each installer on its target operating system; macOS distribution also requires Apple signing/notarization credentials.

## Current scope

- Register multiple directory roots, including folders containing mixed media.
- Scan nested folders for videos, PDFs, CBZ/ZIP comics, and image-based comic folders.
- Persist source records and indexed item metadata in SQLite.
- Persist a compact SQLite FTS5 trigram index for fast substring searches across titles, filenames, and paths. Existing libraries are indexed once on upgrade; scans, edits, renames, deletions, and backup restores keep it synchronized automatically. One- and two-character searches retain a scan fallback.
- Scan directories and file metadata in bounded parallel batches, aggregate comic pages without keeping per-page metadata, and skip unchanged media-row writes on rescans.
- Start a fresh breadcrumb trail and discard carried-over gallery/viewer state when opening Home or a destination from the main menu; nested browsing still restores filters and scroll with Back.
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

CBZ/ZIP archives are indexed but not yet readable in-browser. Video formats unsupported by the browser need a future compatibility transcoder. Live folder watching and Windows NTFS MFT/USN journal integration (as used by Everything) are future work; initial scans still traverse source folders. Node's built-in SQLite API is currently experimental and may change in future Node releases; use the stated Node version for now.
