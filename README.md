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

Desktop builds generate the application PNG and Windows ICO from `apps/web/public/favicon.svg`, and include them in the app window, executable, and installer. Edit that SVG to update the branding; generated icons live in `apps/desktop/build/`.

## Current scope

- Set people's profile images by upload or image URL from Cast & artists. Images are resized to at most 512 pixels and stored in `profile-images` beside the database (the desktop app's user-data directory).
- For sites that require a referrer, enter the gallery or source page URL alongside the image URL. Desktop downloads use Chromium networking for system-proxy support; connection failures and HTTP refusals show recovery guidance.
- In the desktop app, use **Cast & artists → Scan all existing people** to find portraits in both performer directories using Chromium automation. It checks directory cards and targeted profile pages, matches exact names or explicitly listed aliases, keeps existing photos, and reports ambiguous, missing, or failed matches. Cancel from the same panel; the latest report is saved as `people-profile-scan.json` beside the database.
- To scan a specific local database without opening the main window, run `pnpm --filter @vaultly/desktop profiles:scan --data-dir "D:\path\to\Vaultly\user-data"`. This scans existing rows only and saves images in the same `profile-images` folder used by backups.
- Download compressed `.json.gz` backups from Settings, including metadata, collections, profile images, and preferences. Restore compressed archives or older `.json` backups.
- Click tags, categories, or people in Manage attributes to open a filtered gallery.

- Register multiple directory roots, including folders containing mixed media.
- Scan nested folders for videos (including `.ts` transport streams), PDFs, CBZ/ZIP comics, and image-based comic folders.
- Persist source records and indexed item metadata in SQLite.
- Persist a compact SQLite FTS5 trigram index for fast substring searches across titles, filenames, and paths. Existing libraries are indexed once on upgrade; scans, edits, renames, deletions, and backup restores keep it synchronized automatically. One- and two-character searches retain a scan fallback.
- Scan directories and file metadata in bounded parallel batches, aggregate comic pages without keeping per-page metadata, and skip unchanged media-row writes on rescans.
- Start a fresh breadcrumb trail and discard carried-over gallery/viewer state when opening Home or a destination from the main menu; nested browsing still restores filters and scroll with Back.
- Show per-source counts, scanning state, errors, and last scan time.
- Show live scan stages, folder/file counts, comic-page and media counts, current path, elapsed time, and progress within categorization, collection grouping, and thumbnail preparation. Folder discovery shows counts until the total is known.
- Keep scanning responsive to progress and cancellation requests with short indexing transactions, normalize filenames once for metadata matching, and reuse unchanged PDF/video thumbnails during manual rescans.
- Rescan sources manually, cancel an individual scan or all active scans, or remove a source. Existing sources are never rescanned on app startup; interrupted scans keep their index until you rescan. Adding or relocating a source starts its initial scan. Removing one only deletes its Vaultly records.
- Match existing category and tag names against complete words or phrases in filenames during every scan; rescan adds newly matching metadata without clearing manual assignments. People and their alternative patterns are matched as cast on videos and artists on comics and stories, including newly created people.
- During scans, remove every `#` from media titles and filenames and mark affected items as favourites. Rename media files and comic folders while preserving item IDs, assignments, and nested indexed paths; use numbered suffixes when cleaned names collide. The source root itself stays in place. A later scan preserves any manual change to favourites after the markers have been removed.
- Read optional `meta.json` files in image-folder comics, including a comic at the source root. Accept nested `metadata.tags`/`metadata.artists` named objects and top-level string arrays. Tags match existing whole names or patterns only; artists match names or patterns without case sensitivity and unmatched artists are created. External IDs and folder paths are ignored. Rescans reread metadata and add assignments while preserving manual edits; missing, malformed, or oversized sidecars (over 1 MB) are skipped.
- Browse all media or filter to Comics, Videos, and Stories.
- Search titles, paths, and assigned tag/category/cast/artist names and patterns, including inherited source attributes, or filter specifically by filename. Combine media type, source, format, series membership, categories, tags, size, and modified-date filters; sort by title, filename, date, or size.
- Generate and cache video and PDF first-page thumbnails on demand; hover a video card for a muted preview.
- Play browser-supported video files without cropping, with range-based seeking and keyboard shortcuts.
- Open original videos in the system's default player through an explicit player button. Videos that the browser cannot decode show this action immediately, including MP4 files whose audio plays without video. The desktop app uses the operating system's file associations; the browser version supports Windows. Playback never transcodes or creates additional video copies. On startup, remove cached copies named by the retired converter, leaving source media and thumbnails untouched.
- Read PDFs with a page-at-a-time viewer, fit-page/fit-width modes, zoom, and keyboard page navigation; page through image-folder comics.
- Create, rename, and delete categories; assign them to individual items.
- Open Tags, Categories, Cast & artists, Sources, and Settings from the bottom management dock in a separate tabbed drawer. Minimize, expand, close, and reopen it while preserving each opened tab's drafts, filters, and scroll position. Library navigation and background scans leave management mounted; modeless management editors keep the library usable and retain drafts when switching tabs. Pattern editors survive rows disappearing from refreshed or filtered lists. Attribute pickers and viewer controls open the same drawer; changes refresh metadata without reopening media.
- Create, rename, and delete tags; assign multiple tags through a searchable picker, browse them as badges, and filter by several tags at once. Search Tags, Categories, and Cast & artists by names or matching patterns; sort by name, usage, or pattern count and filter used, unused, or patterned attributes. Customize alternative filename-matching phrases from each row; rescan to apply them. Attribute pickers also find names by these patterns.
- Create ordered series or sets containing any mix of comics, videos, and PDFs. Give each set its own title, description, tags, and optional PNG/JPEG/WebP cover (up to 5 MB); add or reorder entries without moving media files.
- Browse sets in separate video, comic, story, and mixed sections; move to the previous or next file while viewing an ordered set.
- Select media cards across pages and bulk add or remove tags, categories, series membership, cast, and artists without replacing unrelated metadata.
- Manage one shared list of Cast & artists; video credits are Cast and comic/story credits are Artists. Existing credits use the correct label automatically. Bulk edits apply the appropriate role to each selected item.
- Rename an item through one title dialog: the title and actual file or comic folder name change together, preserving file extensions and custom titles during rescans. Folder renames also update indexed child paths. Library root folders are managed through Sources.

CBZ/ZIP archives are indexed but not yet readable in-browser. In-app video playback depends on the browser's codecs; use Open in default player for other formats and assign a compatible application to their extensions in system settings. Live folder watching and Windows NTFS MFT/USN journal integration (as used by Everything) are future work; initial scans still traverse source folders. Node's built-in SQLite API is currently experimental and may change in future Node releases; use the stated Node version for now.
