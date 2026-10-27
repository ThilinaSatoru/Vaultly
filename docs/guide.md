# Vaultly usage and development guide

A local-first media library for movies, TV series, anime, manga, e-books, and pictures found in one or more source folders.

## Organize sources and folders

Choose a media type before adding a source: Movies, TV series, Anime, Manga / comics, E-books / documents, Pictures, or Music / music videos. Video sources index videos and leave subtitles, covers, and unrelated images out of the gallery. Movie sources also skip video filenames marked `sample` (for example, `sample.avi` or `Movie.sample.mkv`); rescanning removes existing sample clips from the available gallery. E-book sources index supported book/document files. Manga sources group image pages by folder and index comic archives and PDFs. Picture sources index each image individually. Scans descend through all subfolders, including seasons, extras, and custom directories.

Every source has independent **Automatic scan and grouping rules** in its expanded details, so two sources with the same media type can use different behavior. Defaults preserve existing behavior:

- **Directory grouping** groups eligible video/story items by their folders. For TV/anime it recognizes season and episode ordering; for movies it groups files in subfolders; for manga it uses chapter/folder structure where applicable. Comic archive items are not grouped by this rule.
- **Filename-prefix grouping** groups files left over after directory grouping, first by two shared leading words and then by one. Common generic one-word prefixes such as `A`, `new`, and `like` are ignored.
- **Filename metadata matching** assigns existing people, tags, and categories when their names or aliases match filename words. English word matching follows the scan mode. Embedded comic metadata is read independently of this option.
- **Leading `#` favorite markers** set the favorite flag and remove the leading marker from the filename during scanning. This can rename files on disk.
- **Filename refactoring** is off by default. When enabled, a confirmed **Scan + refactor filenames** run names supported files using the remaining title words, matched cast/people, and tags. It applies across media types; folder-based picture items are not renamed. Each run asks for confirmation.

Successful rescans replace automatic memberships and remove obsolete untouched sets; customized obsolete sets become manual collections. Manually renamed or reordered sets remain manual. Turning off a rule affects subsequent scans; existing metadata assignments and filenames are retained unless the scanner's normal reconciliation removes them.

Existing mixed sources keep their previous scan behavior. Expand a source in **Sources**, choose its media type, and let the rescan update the index. Source type is included in backups; older backups restore as mixed sources.

In a gallery, use **Text filter** and **Sort** as the main browsing controls. Text search stays inside the selected library. **Advanced filters** contains categories, tags, collection type, source, format, people, membership, size, date, and search mode; active filter counts remain visible while collapsed. Choose **Sort → Folders** to browse sources and their original folder hierarchy. The same controls work inside a selected category and in Favorites. Use **Up**, **All source folders**, or Back to navigate.

The top bar has a **Hide/Show navigation panel** control and a **Library mode** selector. The sidebar can be hidden without losing the current view, and its right edge resizes it. The search bar uses less space and stays at the top while scrolling; its player also switches to a compact layout. Music replaces the main navigation with its own directory and uses the remaining window directly for tracks and file information. **Media libraries** returns to the standard navigation.

## Floating playback and reading

Choose **Float** in the video player to keep it open while using Back, browsing another library, or opening a reader. Close it explicitly with the close button (or its close shortcut while focused). Use the header size slider or resize corner to change its size. The playlist button reveals Up next and Info. Seeking, volume, playback speed, fullscreen, and associated-player actions remain available. Matching SRT/VTT files beside the video appear in the subtitle selector; when a folder contains only one video, its companion subtitle files are offered as well.

PDF and comic readers offer **Continuous view**. EPUB follows the book's chapter order; TXT, FB2, and HTML text also use a continuous reader. **Auto-scroll** starts from its button or the Space shortcut, with a remembered speed from 1 to 100 pixels per second. Space toggles play/pause. Holding the mouse button in the reading area temporarily pauses movement; releasing it resumes without a jump. Manual scrolling, loss of focus, and the end of the content stop auto-scroll. PDF pages outside the viewport are unloaded to limit canvas memory. Scrolling updates the page or chapter counter. Use the first-page button (or Home while reading) to return to the beginning from every reader mode, and use fullscreen to fill the window. Night ink darkens the reading background while preserving image colors. Text/search fields and descriptions include clear buttons.

WPS, DOC/DOCX, ODT, RTF, MOBI, AZW/AZW3, DjVu, and CBR/CB7/CBT archives are indexed and opened by the associated desktop app. PDF, EPUB, image folders, and CBZ/ZIP have built-in readers. ZIP readers support archives up to 256 MB with bounded chapter/page sizes; encrypted or unsupported books use a desktop reader. EPUB text and raster illustrations are preserved with simplified styling.

## Requirements

- Node.js 22.13 or newer
- pnpm 11

## Start

```powershell
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`. The API listens only on `127.0.0.1:4400` by default. Set `VAULTLY_API_PORT` before running `pnpm dev` to use another port; the API and Vite proxy will both use it. SQLite data is stored in `runtime/vaultly.db`, which is ignored by Git. Adding a source indexes files in place. Scans remove leading `#` favourite markers from filenames; explicit rename and conversion actions also modify source files. See the library features below.

## Vault profiles

Use **Active vault** in the top bar to switch profiles, or the **+** button beside it to create one. A new profile opens a blank vault with no sources, media, attributes, collections, or inherited preferences. Your existing library becomes **Default** and stays at its original location. The selected profile is remembered when the app restarts. Use the trash button and **Delete profile and data** to delete that profile’s database, thumbnails, people images, audio cache, and preferences. Source media stays in place. Another profile opens afterward; deleting the last profile creates a fresh empty vault.

Each profile uses its own SQLite database, thumbnail cache, people images, scan report, and browser preferences. New vaults are stored in `vaults/<profile-id>/` under the runtime directory (the desktop app's user-data directory); Default retains `vaultly.db` at the runtime root. `vault-profiles.json` stores profile names and the active selection.

Switching returns to Home and closes viewers and management drafts. Finish or cancel background work before switching. An older browser window must reload after another window changes the active vault. Source media remains in its original folders; adding the same folder to two vaults indexes the same physical files.

Settings backups include only the active vault, and their filenames identify that profile. Restore replaces only the active vault's metadata and preferences, so create a blank profile first when importing a backup as a separate library. Older backups remain supported. A backup contains library data and people images, not the original media files or other profiles.

The API exposes `GET /api/vault-profiles`, `POST /api/vault-profiles` with `{ "name": "Comics" }`, `POST /api/vault-profiles/:id/activate`, and `DELETE /api/vault-profiles/:id`. Library requests can send `vaultProfile=<profile-id>` in the query string or `X-Vaultly-Profile` in a header to reject requests when the active profile has changed.

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

Installer targets are NSIS on Windows, DMG on macOS, and AppImage plus Debian package on Linux. Build each installer on its target operating system. The release workflow produces unsigned installers; signed and notarized macOS distribution requires Apple credentials.

Desktop builds generate the application PNG and Windows ICO from `apps/web/public/favicon.svg`, and include them in the app window, executable, and installer. Edit that SVG to update the branding; generated icons live in `apps/desktop/build/`.

## Manual GitHub releases

Releases run only when you start **Actions → Manual release → Run workflow**, selecting the repository's default branch. There are no automatic push/tag triggers and no release PRs. Set the repository Actions **secret** `GH_TOKEN` to a GitHub token with **Contents: read and write** access to this repository. It is used to push the release commit/tag and publish release assets; keep the token out of ordinary repository variables and source files.

Pick **bump**: `patch`, `minor`, `major`, or `custom` (then type an exact version such as `0.2.0-beta.1` in **version**). The last number is the running **build number**: every release, including minor and major ones, adds 1 to it (`0.5.7` → patch `0.5.8`, minor `0.6.8`, major `1.0.8`). Run `pnpm release:suggest` to see the next versions; the workflow run summary shows the same table. Versions follow SemVer and stay synchronized in the root, API, web and desktop manifests. `patch` makes backward-compatible fixes, `minor` adds backward-compatible features, and `major` marks breaking changes. A custom prerelease version publishes a GitHub prerelease without making it the latest stable release. The default is `patch`; use `custom` with `0.1.0` to publish the initial version.

Add user-facing notes under **Unreleased** in [CHANGELOG.md](../CHANGELOG.md) before running the workflow, or provide extra Markdown in its **notes** input. New releases move these notes into a dated version entry and append commit summaries since the previous reachable version tag. Conventional Commit subjects such as `feat:`, `fix:`, `docs:` and `feat!:` are grouped into change categories; other subjects appear under Changed. With no prior version tag, the first generated entry includes the repository's history. Existing-version retries keep the tagged notes unchanged.

The workflow validates versions/notes, runs release-tooling tests, production typechecks and application tests, then commits `chore(release): vX.Y.Z` directly to the default branch and pushes an annotated tag atomically. It never force-pushes. Native runners build Windows x64 NSIS, macOS Intel/Apple Silicon DMGs, and Linux x64 AppImage/Debian installers. All builds must succeed before publication. The release starts as a draft, receives all five installers plus `SHA256SUMS.txt`, and becomes public only after every upload succeeds. Artifact names include version, operating system and architecture. Installers are currently unsigned and macOS builds are not notarized.

If a build/upload fails after tagging, rerun **Manual release** with bump `custom` and the same exact version (for example `0.1.1`), rather than `patch`. It reuses the original tagged source, replaces matching draft assets and finishes publication. Published releases cannot be overwritten; use a new version for further changes. A concurrent default-branch change causes the atomic push to fail safely; rerun against the updated default branch.

The same version/changelog tools are available locally on a clean checkout:

```powershell
pnpm release:suggest
pnpm release:prepare minor
pnpm release:check v0.2.0
pnpm release:notes v0.2.0
```

Local preparation edits manifests/changelog only; it does not commit, tag, push or publish. Normally let the manual workflow prepare the release so the tagged commit and installers match.

## English search and attribute matching

The gallery defaults to **English forms & synonyms**, searching titles and filenames only. A bundled [winkNLP English lite model](https://winkjs.org/wink-nlp/language-models.html) handles word forms, irregular plurals/verb tenses and British/American spellings. A small built-in synonym dictionary adds equivalences such as `movie`/`film`, `holiday`/`vacation`, and `car`/`automobile`. For example, `child holiday` finds a title containing `Children on vacations`; `run film` finds `Running movies.pdf`. The filename filter uses the same matching but only checks filenames. This is a lightweight NLP model plus dictionary, rather than vector similarity or a generative LLM; synonym coverage is limited to the built-in groups and does not infer every possible meaning.

Everything runs offline after dependency installation. The model is included in the desktop bundle, requires no GPU, API key or Ollama installation, and downloads nothing at runtime. A versioned SQLite FTS5 index stores normalized title/filename tokens; startup backfills it once, dictionary version changes rebuild it, and scans, edits, renames, deletes and backup restores maintain it through triggers. A bounded in-memory cache reuses normalization. **Automatic** sorting uses title-weighted BM25 relevance in English/typo-tolerant mode, or title order in literal mode. Other gallery filters and sorts still apply.

Use quotes to require literal phrases and suppress English expansion, such as `"summer trip"`. **Literal / phrases** retains substring searching across titles, paths and assigned attributes. **Typo tolerant** retains edit-distance matching with adjacent transpositions, up to eight alternatives per word of 4–40 characters (one edit, or two for words of eight or more characters). All unquoted terms must match. Quoted terms are never typo-expanded. The API retains literal mode when `searchMode` is omitted; request `searchMode=english` to use the embedded matcher.

For attribute scans, use **Sources → English matching scan** for all sources, or a source's **Scan with English matching** menu action. This reuses English word forms and synonyms for existing tags/categories and their aliases. It adds assignments without clearing manual ones, requires complete words/phrases, excludes file extensions and parent directories, and skips inferred phrases that normalize to multiple different attributes. Exact names/aliases still match. Cast/artist names and explicit sidecar metadata remain exact. Ordinary **Scan again**, **Rescan all**, and initial scans retain their existing matching rules. The scan API accepts `{ "englishAttributes": true }` on `POST /api/sources/scan` or `POST /api/sources/:id/scan`; programmatic scans can pass the same option to `scanSource`.

To extend synonym coverage, update `englishSynonymGroups` in `apps/api/src/english-matching.ts`, increment `englishMatchingVersion`, and add representative positive and negative tests. For library-specific or ambiguous terminology, use explicit attribute patterns instead.

## Library features

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
- Background work monitors CPU, free RAM, and app memory. Source scans run one at a time; converters, probes, and thumbnail renderers share a two-process limit and wait under low-memory pressure. FFmpeg uses at most two codec threads. PDF thumbnails render in isolated child processes with a 256 MB JavaScript heap limit; files over 128 MB skip thumbnail rendering. Process logs use fixed-height containers and scroll to the newest entry. Desktop crash diagnostics are saved to `crash-error.log` in the app's user-data folder.
- After scanning, use **Sources → Convert unsupported videos** to run the supplied Python converter as a separate process. It remuxes compatible streams or encodes H.264/AAC MP4, verifies duration before replacing originals, and keeps existing media IDs and library details. Compatible MP4/M4V and WebM files and existing output filenames are skipped. Conversion has its own progress, errors, and cancellation; scans and source relocation/removal wait until it finishes. Requires Python, `ffmpeg`, and `ffprobe` on PATH (`VAULTLY_PYTHON` can select the Python executable).
- Show live scan stages, folder/file counts, comic-page and media counts, current path, elapsed time, and progress within categorization, collection grouping, and thumbnail preparation. Folder discovery shows counts until the total is known.
- Keep scanning responsive to progress and cancellation requests with short indexing transactions, normalize filenames once for metadata matching, and reuse unchanged PDF/video thumbnails during manual rescans.
- Rescan sources manually, cancel an individual scan or all active scans, or remove a source. Enabled sources are rescanned once in the background each time the app opens (never with filename refactoring); interrupted scans keep their index until you rescan. Adding or relocating a source starts its initial scan. Removing one only deletes its Vaultly records.
- Match existing category and tag names against complete words or phrases in filenames during every scan; rescan adds newly matching metadata without clearing manual assignments. People and their alternative patterns are matched as cast on videos and artists on comics and stories, including newly created people.
- During scans, only filenames beginning with `#` mark items as favourites. Remove those leading markers and preserve hashes elsewhere, including custom titles. Rename media files and comic folders while preserving item IDs, assignments, and nested indexed paths; use numbered suffixes when cleaned names collide. The source root itself stays in place. A later scan preserves any manual change to favourites after the markers have been removed.
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
- For bulk JSON uploads of people, tags, or categories, enable **Update existing names only** to update case-insensitive name matches and skip unfamiliar names. Supplied fields replace existing values; omitted fields are preserved. This mode also updates existing people's profiles and patterns, while the default people import continues to skip duplicates. The import API accepts `?existingOnly=true` with either supported JSON format.
- Rename an item through one title dialog: the title and actual file or comic folder name change together, preserving file extensions. External renames synchronize the title on rescan while keeping item IDs and assignments. Filename refactoring also refreshes the title, including stale titles when the filename is already correct. Folder renames also update indexed child paths. Library root folders are managed through Sources.

CBZ/ZIP archives are indexed but not yet readable in-browser. In-app video playback depends on the browser's codecs; use Open in default player for other formats and assign a compatible application to their extensions in system settings. Live folder watching and Windows NTFS MFT/USN journal integration (as used by Everything) are future work; initial scans still traverse source folders. Node's built-in SQLite API is currently experimental and may change in future Node releases; use the stated Node version for now.


Video covers and playback preferences
------------------------------------
Place `poster`, `cover`, `folder`, a matching video filename, or a matching `-poster` / `-cover` image beside a video. Scanning ignores unrelated artwork. JPEG, PNG, WebP and AVIF covers are accepted; covers must be smaller than 5 MB. All video cards use the same size. Artwork is fitted without cropping, including portrait covers for landscape movies. Video previews fit their own dimensions.

Open a video and select **Info → Choose cover** to override its folder artwork. **Use folder cover / video frame** removes the override. Covers are preserved through rescans and included in backups.

Audio and subtitle dropdowns sit directly beside the seek controls. Open **Player options** for speed, subtitle size (50–200%), fit/fill, repeat, and seek previews. These choices and volume/mute are remembered within the active vault. A preferred language follows newly opened videos even when track ordering changes. Each new video enables an available subtitle; if the preferred language is missing, a default or first available subtitle is used. You can turn subtitles off for the current video. Bitmap subtitles remain available through the default desktop player.

Alternate audio is prepared locally and cached as audio only; the original video remains the playback source. While a track is prepared, you can pause or resume the requested playback. Seeking and speed changes apply to both picture and audio.

Controls hide after 1.5 seconds of pointer or keyboard inactivity, including while fullscreen and immediately when the pointer exits the player. **Hide controls now** hides them immediately. Keyboard and wheel actions show small indicators. Tab from the player reveals its accessible controls. Preview thumbnails above the seek bar are optional, and turning them off stops loading the preview video.

Enable **Remember video playback position** in **Settings → Playback and reading** to resume every video in the active vault. The option is off by default. Positions are saved on pause, seeking, closing, and periodically during playback; completed videos start from the beginning. Video cards and video Info display the source alone instead of repeating the title folders and filename.

## Music library

Open **Music** in the main navigation and choose **Add music folder**, or open **Sources → Add source → Music / music videos**. Music folders and every music entity use separate database tables and never enter gallery results, shared people, categories, or tags. Subfolders are scanned recursively; symlinks and unrelated files are skipped. The app reads embedded metadata and cover art with the bundled FFmpeg. Artist and title are read from `Artist - Song.ext` file names first (a leading track number is ignored), then embedded tags, then folders. The music view lists Artists and Playlists in a dense foobar2000-style list; search matches artist and file name only, and the Info panel shows every embedded property.

Genres and codec still become read-only tags shown in Info. Playlist membership and track IDs survive rescans at the same path. Missing files disappear from browsing after a complete scan; cancelled scans preserve the previous index. Use **Sources** to browse, rescan, cancel, or remove music indexes alongside other source types without deleting source files. Videos in a music folder receive the Music video tag and play with a video preview when their codec is supported.

The main left panel searches artists, albums, playlists, and attributes. Select a scope to see its tracks in the center, or choose Browse albums for cover tiles. The top text field searches the entire music library by default; expand **Advanced filters** and uncheck **Search entire music library** to restrict results to the selected scope. The same section holds rating, codec, and source filters. List and card views display audio properties, file size, duration, artist, album, attributes, and editable stars. Select one or more tracks and choose a custom playlist to add them. Playlist order has up/down controls; the Sort selector also supports stars, title, artist, album/track, duration, bitrate, and size.

Drag a vertical divider, or focus it and use Left/Right arrows, to adjust the panels. **Layout** hides or restores the side panel, moves it left or right, and toggles its components. Collapse individual panels or use their arrows to reorder them; these preferences persist. The navigation groups also collapse independently. Each visualizer has a resize grip. The right panel displays a live spectrum and waveform for the playing track and detailed information for the selected track; selecting a different track does not interrupt playback. Visualizer animation stops when hidden. The top player provides a compact spectrum, seeking, volume, previous/next, shuffle, repeat-all, repeat-one, and Stop. Its playlist button opens the exact active queue even while browsing another scope. Playing a track or Play all queues the entire current result scope, including later pages. Navigation keeps music playing until Stop, profile reload, or app exit. System media keys are supported where available. Unsupported audio formats are converted into a local MP3 playback cache; originals and their displayed technical properties are preserved.

On desktop, **Close to system tray** keeps the window and playback alive when closing it. **Keep playing in tray** enables this and hides the window immediately. Click the tray icon to reopen Vaultly; its menu offers Play/Pause, Previous, Next, and **Quit Vaultly**. Quit still respects active-task exit confirmation. Disable Close to system tray to restore normal window-close behavior. Music browsing preferences, volume, repeat/shuffle, panel widths, ratings, playlists, and embedded covers are included in vault preferences or library backups. Restore requires a music rescan to verify source availability.


## YouTube library and master audio

Open **YouTube** from the navigation or Library mode selector. The video library shows saved links as thumbnail cards. **Add video** reads a link from your clipboard and opens a dialog to choose an existing playlist, create a new playlist, or save to the library only. Clipboard access is requested only when you click Add video; if unavailable, paste the URL into the dialog. Vaultly retrieves the video title and channel automatically from YouTube. Search by title or channel and filter by channel, then sort by title, date added, or playlist order. Open a card to play it in the embedded YouTube player. No video is downloaded and no account connection or API key is required.

Open **Playlists** to create or browse custom playlists. Select videos with their checkboxes to add them to a playlist. Each card's action menu includes rename, playlist ordering/removal, and removal from the library. Removing a video from a playlist or deleting a playlist keeps the video in the library. Removing a video from the library removes its playlist memberships. Existing saved YouTube playlist links remain available. All videos and playlists belong to the active vault and are included in backups; older playlist-only backups are migrated automatically.

Master volume, mute, audio output, and the vertical stereo VU meter live in the window title bar. The meter reads independent left/right channels after master gain. Local per-player volume is multiplied by the master level. **Audio output** lists devices exposed by your browser or desktop runtime. No microphone permission is requested. Device availability depends on runtime support and permissions. YouTube embeds use the system audio output and do not expose audio samples for VU metering.

## Custom themes

Open **Settings → Custom themes** to create a theme from the current colors, or start with **Neon template**. Choose background, navigation, container, raised-container, input, text, secondary-text, border, accent, secondary-accent, and danger colors. Adjust the gradient and neon glow while previewing the app live. Text/container contrast is displayed to help keep your colors readable. **Save theme** stores and activates it; **Cancel preview** restores the saved appearance. Export custom themes as JSON or paste exported JSON under **Import theme JSON** to preview and save it. Themes belong to the current vault and are included in preference backups. The Dark/Light toggle keeps the selected theme active. Use **Editing palette** to customize its light and dark colors separately; until edited, the companion mode is generated with readable neutral surfaces and adapted accent brightness. The original palette is restored exactly when you switch back. Glow applies to primary accent text and icons; backgrounds stay free of glow. Delete and remove actions use the current danger color.
