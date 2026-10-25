# Vaultly project logic and rules

## 1. What the project does

- Vaultly is a local-first media library for organizing and browsing videos, comics, e-books, pictures, and music.
- The desktop app uses Electron, with a React web interface and a Fastify API backed by SQLite.
- Media stays in its original folders. Vaultly stores library records, preferences, thumbnails, and related app data locally.
- Searches and most library features work offline. YouTube metadata lookup and profile-image downloads are exceptions that use the internet.
- The project is structured as a pnpm workspace:
  - `apps/api`: database, scanners, search, media operations, and API routes.
  - `apps/web`: library views, readers, players, settings, and management UI.
  - `apps/desktop`: Electron startup, window behavior, IPC, and packaging.
  - `docs`: usage and implementation guidance.

## 2. Sources and media types

- A **source** is a folder registered with Vaultly. It has a media type, scan settings, status, and availability.
- Source types include movies, TV, anime, manga, e-books, pictures, music, and mixed sources.
- Scans recurse through subfolders and index only supported media for that source type.
- Video sources ignore unrelated images; movie sources also skip video filenames marked `sample`.
- E-book sources index supported book and document files. Manga sources index image-folder comics, comic archives, and PDFs. Picture sources index images individually.
- Music uses a separate source and data model, even though music folders are also accessible through Sources.
- Disabling a source hides it from library use and cancels its scan or conversion. Removing a source removes Vaultly’s records; it does not delete the files.
- Paths are normalized for duplicate detection. On Windows, path comparison is case-insensitive.
- An unavailable folder is reported as disconnected; it does not mean the source media was deleted.

**Implementation:** [source-media.ts](/D:/PartProjects/Vaultly/apps/api/src/source-media.ts), [server.ts](/D:/PartProjects/Vaultly/apps/api/src/server.ts), [music-scanner.ts](/D:/PartProjects/Vaultly/apps/api/src/music-scanner.ts)

## 3. Scanning and reconciliation

- Scans run in the background and report their phase, progress, current path, counts, and errors. A scan can be cancelled.
- Source scans are serialized. During a source scan, media subprocess concurrency is reduced to limit resource use.
- Existing sources are **not** automatically rescanned at app startup. Adding or relocating an enabled source starts a scan; later updates require a manual rescan.
- Rescans reconcile the index against files currently found. Unchanged items can retain their existing records and cached previews.
- When an item disappears from a completed scan, it is no longer available in the library. A cancelled scan preserves the prior index.
- Scans can group eligible media into automatic collections using folder structure and, if enabled, filename prefixes. TV/anime folder names and episode patterns help determine ordering; extras and specials are placed after regular episodes.
- Root-level movies remain individual items. Movies in dedicated subfolders can be grouped. Comic archives are not grouped by the directory-grouping rule.
- Successful rescans update automatic memberships and can remove obsolete automatic collections. Customized or manually reorganized collections are preserved as manual collections.
- Changing a scan rule affects later scans; existing assignments and filenames are not automatically reverted just because a rule is turned off.
- Each source has independent grouping, metadata-matching, and `#` favorite-marker settings.
- Leading `#` favorite-marker stripping (§4) is a separate per-source setting from filename refactoring; it renames files on disk even when refactoring is off.
- Filename refactoring is off by default. When enabled for a source, a confirmed scan can rename supported files using title words and matched metadata. Picture-folder items are excluded. These operations change files on disk.

**Implementation:** [scanner.ts](/D:/PartProjects/Vaultly/apps/api/src/scanner.ts), [source-media.ts](/D:/PartProjects/Vaultly/apps/api/src/source-media.ts)

## 4. Filenames, favorites, and metadata matching

- Leading `#` characters (and any whitespace after them) before the first letter or word of a filename mark an item as a favorite. Scanning trims the marker, renames the file on disk (numbered on collision), and sets the item as a favorite; hashes elsewhere in the name remain.
- A later scan does not keep overriding a favorite the user manually changed after the marker was removed.
- Tags and categories can match complete names or configured alternative patterns in filenames. Normal scans add matches without clearing manual assignments.
- Cast and artist matching is stricter: names or explicit aliases must match as complete phrases with word boundaries. Matching does not reorder a person’s name, combine separated name parts, or use partial first/last-name aliases.
- Ambiguous person aliases are ignored. A shorter person name inside another recognized full name does not create an additional credit.
- Matching normalizes accents and punctuation. Tags and categories use more flexible matching than people.
- Optional English-matching scans expand matching for existing tags and categories using English word forms and built-in synonyms. They do not broaden people matching. They exclude file extensions and parent directories.
- Comic folders can have `meta.json` sidecars. Valid, bounded sidecars can add tags and artists; tags must match existing names or patterns, while unmatched artists can be created. Missing, malformed, or oversized sidecars are skipped.
- Filename-derived credits are reconciled on rescans. Manual credits and explicit sidecar credits are retained separately.
- Existing libraries receive a one-time repair that removes legacy people credits that fail the stricter matching rules and adds valid matches.

**Implementation:** [filename-metadata.ts](/D:/PartProjects/Vaultly/apps/api/src/filename-metadata.ts), [people-matching.ts](/D:/PartProjects/Vaultly/apps/api/src/people-matching.ts), [comic-metadata.ts](/D:/PartProjects/Vaultly/apps/api/src/comic-metadata.ts), [startup-and-people-matching.md](/D:/PartProjects/Vaultly/docs/startup-and-people-matching.md)

## 5. Library records and organization

- The shared gallery stores media as videos, comics, or stories. Records include paths, titles, size, modified time, favorite state, and media-specific metadata.
- Tags, categories, and people can be assigned to individual items.
- People are shared across the library: video credits display as cast; comic and story credits display as artists.
- Series/sets can contain mixed media, have a chosen order, and carry descriptions, covers, favorites, tags, categories, and people.
- Story circles group series/sets into a larger ordered grouping.
- Set and circle cards can reflect attributes inherited from their members. Source-level tags and categories also apply to items from that source.
- Bulk actions add or remove selected attributes or collection membership without replacing unrelated metadata.
- Renaming an item changes its title and its underlying file or comic-folder name while preserving its record and assignments. Collisions use numbered names. Renames made outside Vaultly can be picked up on rescan.
- Cover artwork can come from recognized nearby cover files or a manual override. Manual covers survive rescans and are included in backups.

**Implementation:** [database.ts](/D:/PartProjects/Vaultly/apps/api/src/database.ts), [series-routes.ts](/D:/PartProjects/Vaultly/apps/api/src/series-routes.ts), [circle-routes.ts](/D:/PartProjects/Vaultly/apps/api/src/circle-routes.ts), [media-routes.ts](/D:/PartProjects/Vaultly/apps/api/src/media-routes.ts)

## 6. Search, filters, and sorting

- Gallery search stays within the selected library or current browsing scope.
- English mode is the default UI search style. It handles word forms, selected synonyms, and some British/American spelling variants; it is a lightweight offline matcher, not semantic or AI search.
- Quoted terms require literal phrases and suppress English expansion.
- Literal search supports phrase/substring matching across titles, paths, and assigned attributes.
- Typo-tolerant search expands eligible unquoted words using edit distance, including adjacent letter swaps. It allows up to eight alternatives per word. All query terms must match.
- The API retains literal mode when `searchMode` is omitted; English matching must be requested explicitly by API clients.
- Search can be combined with filters for media type, source, format, tags, categories, collection membership, people, size, and modified date.
- Folder sorting lets users browse the source directory hierarchy. Other sorts include title, filename, date, or size; relevance is used for automatic ordering in English and typo-tolerant modes.
- SQLite FTS indexes support search and are maintained as records change. Very short substring searches use a fallback.

**Implementation:** [advanced-search.ts](/D:/PartProjects/Vaultly/apps/api/src/advanced-search.ts), [gallery-search.ts](/D:/PartProjects/Vaultly/apps/api/src/gallery-search.ts), [search-index.ts](/D:/PartProjects/Vaultly/apps/api/src/search-index.ts), [english-search.ts](/D:/PartProjects/Vaultly/apps/api/src/english-search.ts)

## 7. Music rules

- Music is a distinct library with its own artists, albums, tracks, tags/categories, playlists, ratings, and scan process. It does not enter the shared gallery or shared people directory.
- Music scans recurse into folders and skip symlinks. They recognize supported audio formats and video files used as music videos.
- Embedded metadata and cover art are read when available. Untagged files fall back to filename and artist/album folder information.
- Genres become categories. Codec, lossless status, mood, and language can become tags.
- Matching music attribute names and patterns use offline English normalization and can be learned from embedded text and paths during scans.
- Manual attributes, ratings, playlists, and track IDs are intended to survive rescans at the same path. Scan-derived attributes are refreshed.
- Missing files disappear from browsing after a completed scan. A cancelled scan keeps the prior index.
- Unsupported audio may be converted into a local MP3 playback cache; originals and displayed technical properties are preserved.
- Playback queues the current result scope, including later pages. Music keeps playing while the user browses, until stopped, the vault reloads, or the app exits.
- Desktop tray settings can keep playback running when the window closes.

**Implementation:** [music-schema.ts](/D:/PartProjects/Vaultly/apps/api/src/music-schema.ts), [music-scanner.ts](/D:/PartProjects/Vaultly/apps/api/src/music-scanner.ts), [MusicWorkspace.tsx](/D:/PartProjects/Vaultly/apps/web/src/MusicWorkspace.tsx)

## 8. YouTube library

- The YouTube library saves links and metadata, not downloaded video files.
- Links must use supported YouTube or `youtu.be` hosts and valid video/playlist identifiers.
- Vaultly can look up a video’s title and channel through YouTube’s oEmbed endpoint; no YouTube account connection or API key is required.
- Saved videos can be organized into custom playlists and played in an embedded player.
- Removing a video from a playlist keeps it in the library. Removing it from the library also removes its playlist memberships.
- Saved YouTube data belongs to the active vault and is included in backups.

**Implementation:** [youtube-library.ts](/D:/PartProjects/Vaultly/apps/api/src/youtube-library.ts), [youtube-schema.ts](/D:/PartProjects/Vaultly/apps/api/src/youtube-schema.ts)

## 9. Playback and readers

- Browser-supported videos play in-app. Other codecs can be opened explicitly in the system’s default player.
- Video controls include seeking, speed, fit/fill, repeat, subtitles, alternate audio, and keyboard controls. Some preferences are saved per vault.
- Subtitle files beside videos can be offered as companion tracks. New videos enable an available subtitle by default, using the preferred language when possible.
- Alternate audio is cached locally as an audio-only track and synchronized with the original video.
- Video position resuming is optional and off by default. Completed videos restart at the beginning when resuming is enabled.
- PDFs, EPUB, text, FB2, and HTML have built-in readers. Image folders and CBZ/ZIP comics have built-in comic reading; some other document/archive types open in the desktop app.
- Continuous view and auto-scroll are available in supported readers. Auto-scroll stops on manual scrolling, focus loss, or reaching the end.
- Large PDFs and archives have bounded processing/caching behavior to limit resource use.

**Implementation:** [VideoPlayer.tsx](/D:/PartProjects/Vaultly/apps/web/src/VideoPlayer.tsx), [PdfReader.tsx](/D:/PartProjects/Vaultly/apps/web/src/PdfReader.tsx), [EbookReader.tsx](/D:/PartProjects/Vaultly/apps/web/src/EbookReader.tsx), [book-archive.ts](/D:/PartProjects/Vaultly/apps/api/src/book-archive.ts)

## 10. Vault profiles, preferences, and backups

- Each vault profile has its own library database, preferences, caches, and backups.
- The default profile keeps legacy data in its existing location; additional profiles use separate vault directories.
- The storage layer refuses to delete the active profile. The delete workflow (UI and `DELETE /api/vault-profiles/:id`) first switches to another profile, or creates a fresh empty vault if it was the last, then deletes; it is refused while background work or a viewer request is active. Profile deletion targets application-owned data, not source media.
- Backup archives can include library metadata, collections, profiles/images, music, YouTube entries, and preferences. They do not copy the source media files.
- Restore supports older backup formats with migrations/defaults for fields added later.
- Backups are size-limited and use compressed JSON archives.

**Implementation:** [vault-profiles.ts](/D:/PartProjects/Vaultly/apps/api/src/vault-profiles.ts), [backup-routes.ts](/D:/PartProjects/Vaultly/apps/api/src/backup-routes.ts), [vault-profile-routes.ts](/D:/PartProjects/Vaultly/apps/api/src/vault-profile-routes.ts)

## 11. Desktop lifecycle and resource limits

- The desktop starts the API as a child process so database setup and scanning do not block Electron’s UI thread.
- On shutdown, Vaultly asks scans, conversions, repair work, and tracked child processes to stop cleanly. A deadline handles a server that does not exit in time.
- SQLite uses WAL mode, foreign keys, a bounded page cache, disk-backed temporary tables, and disabled memory mapping.
- Scanners, converters, probes, and thumbnail workers share resource controls. Some image/PDF work runs in child processes to limit memory retained by the main process.
- Reported API memory usage is not total desktop memory; it excludes renderer, GPU, and child-process memory.

**Implementation:** [database.ts](/D:/PartProjects/Vaultly/apps/api/src/database.ts), [background-processes.ts](/D:/PartProjects/Vaultly/apps/api/src/background-processes.ts), [process-resources.ts](/D:/PartProjects/Vaultly/apps/api/src/process-resources.ts), [startup-and-people-matching.md](/D:/PartProjects/Vaultly/docs/startup-and-people-matching.md)

## 12. API and data-integrity conventions

- API inputs are generally validated with Zod schemas, and database relationships use foreign keys and uniqueness constraints.
- Invalid input produces a client error; missing directories and unavailable paths produce readable errors.
- Longer work such as scanning and conversion is asynchronous and has progress/cancellation endpoints.
- Operations that could conflict are guarded: for example, conversion requires an enabled, scanned source and blocks conflicting rescans or relocation.
- Database triggers and indexes keep search data synchronized with library edits.

**Implementation:** [server.ts](/D:/PartProjects/Vaultly/apps/api/src/server.ts), [database.ts](/D:/PartProjects/Vaultly/apps/api/src/database.ts)

## 13. Main documentation

- [README.md](/D:/PartProjects/Vaultly/README.md) — product overview, supported formats, and getting started.
- [guide.md](/D:/PartProjects/Vaultly/docs/guide.md) — detailed behavior and user workflows.
- [startup-and-people-matching.md](/D:/PartProjects/Vaultly/docs/startup-and-people-matching.md) — desktop lifecycle and strict people matching/repair rules.
- [memory-optimizations.md](/D:/PartProjects/Vaultly/docs/memory-optimizations.md) — memory and resource-management design.
- [attribute-performance.md](/D:/PartProjects/Vaultly/docs/attribute-performance.md) — attribute import performance measurements and limits.

This is a categorized summary of the implemented behavior documented in the repository; the route and UI files contain more detailed endpoint-level and interaction-specific rules.
