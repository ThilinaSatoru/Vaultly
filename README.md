<div align="center">

<img src="apps/web/public/favicon.svg" alt="Vaultly logo" width="88" height="88">

# Vaultly

### Your media. Your folders. One beautiful library.

A local-first desktop library for **movies, TV, anime, manga, e-books, and pictures**.
Turn scattered folders into a searchable collection, with readers, playback, and tools to make it your own.

![Platforms](https://img.shields.io/badge/Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-101218?style=for-the-badge)
![Local first](https://img.shields.io/badge/Local--first-9cff57?style=for-the-badge&labelColor=101218&color=9cff57)
![Offline search](https://img.shields.io/badge/Offline%20search-9cff57?style=for-the-badge&labelColor=101218&color=9cff57)

**[Download Vaultly](https://github.com/ThilinaSatoru/Vaultly/releases/latest)** · **[Explore features](#features)** · **[Get started](#get-started)** · **[Changelog](CHANGELOG.md)**

</div>

---

## A home for your collection

Browse your media in a thumbnail gallery, find a favourite with a few words, and open a video or reader without leaving your library. Bring together multiple folders, add your own tags and credits, and arrange related files into ordered sets and story circles.

Vaultly indexes your collection where it lives. Your library database and thumbnail cache stay on your computer, and English search runs offline without an API key or GPU.

| 🎬 Watch | 📚 Read | 🗂️ Organize |
| --- | --- | --- |
| Video thumbnails, muted hover previews, seeking, and keyboard controls. Open other formats in your default player. | Page through PDF stories and image-folder comics with zoom and keyboard navigation. | Combine sources, favourites, tags, categories, cast, artists, and ordered collections. |

## Features

### Find the file you had in mind

- **Offline English search** understands word forms, common synonyms, and British/American spellings. `child holiday` can find *Children on vacations*.
- **Choose your search style:** English forms & synonyms, literal phrases, or typo-tolerant matching.
- **Narrow your gallery** by collection type, source, format, tags, categories, collection membership, size, or modified date. Choose **Sort → Folders** to browse source folders and subfolders, including within a category.

### Build a library that feels yours

- **Sources by media type:** choose Movies, TV series, Anime, Manga, E-books, or Pictures. Scans preserve nested folders and skip unrelated media; existing mixed sources can be reclassified in Sources.
- **Separate vault profiles:** create and switch vaults from the top bar. Each starts empty and keeps its own library, preferences, caches, and backups. The trash button deletes a profile and its database/cache while preserving source media.
- **Tags, categories, and favourites:** describe individual items or select across pages for bulk edits.
- **Cast & artists:** manage names, aliases, credits, and profile images in one shared directory.
- **Series & sets:** arrange mixed media in a chosen order, with custom covers, descriptions, and tags. Move between entries from the viewer.
- **Story circles:** group related sets into a larger story.
- **Automatic metadata matching:** apply existing names and patterns during scans, optionally expand tag/category matching with English forms, and read comic `meta.json` sidecars.

### Watch and read in place

- **Video player:** play supported formats with seeking, playback speed, SRT/VTT companion subtitles, and keyboard shortcuts. Floating playback survives Back and library navigation until manually closed; adjust its size in the header and optionally show the playlist. Launch original files in the system player for other codecs.
- **Readers:** PDF page navigation, continuous PDF/comic views, EPUB chapters, text/FB2/HTML books, zoom, and adjustable slow auto-scroll (1–100 pixels/second). Auto-scroll starts on request; Space toggles play/pause. Hold the mouse button to pause reading movement and release to resume. Manual scrolling, loss of focus, and the end of the reading area stop it.
- **Comic reader:** browse image folders and CBZ/ZIP pages in natural order. Picture sources index each image separately.
- **Cached previews:** video and PDF thumbnails help you recognize items at a glance.
- **Management dock:** open tags, categories, people, sources, and settings in a tabbed drawer that keeps drafts while you browse.

### Keep control of your collection

- **Background scans** show progress, counts, the current path, and errors, with cancellation controls.
- **Manual rescans:** existing sources keep their index on startup; rescan when you want to update it.
- **Back up and restore** metadata, collections, profile images, and preferences with compressed archives.
- **Rename and relocate:** update file/folder names while preserving library details, or reconnect a source at a new location.
- **Video conversion:** choose quick remuxing, full encoding, or both to produce H.264/AAC MP4. Conversion checks duration before replacing originals and preserves IDs, favourites, and metadata.

## Download

Get the installers from **[GitHub Releases](https://github.com/ThilinaSatoru/Vaultly/releases)**.

| Platform | Installer |
| --- | --- |
| Windows x64 | `.exe` installer |
| macOS Intel | `mac-x64.dmg` |
| macOS Apple Silicon | `mac-arm64.dmg` |
| Linux x64 | `linux-x86_64.AppImage` or `linux-amd64.deb` |

Each published release includes `SHA256SUMS.txt` to verify downloads. Installers are currently unsigned, and macOS builds are not notarized.

## Get started

1. Install Vaultly for your operating system.
2. Open **Sources**, select a media type, and add its root folder.
3. Follow the initial scan, then browse **Videos**, **Comics & pictures**, or **E-books**. Collection-type buttons separate Movies, TV series, Anime, Manga, and Pictures; **Sort → Folders** preserves your shelves and seasons.
4. Add favourites, tags, and collections to make the library easier to explore.

**File behaviour:** media stays in its source folders. Scans remove leading `#` markers from filenames and mark those items as favourites. Renaming and conversion also change source files. Library backups contain library data, not copies of your media.

## Supported media

| Media | Library support | Viewing |
| --- | --- | --- |
| Videos, including `.ts` transport streams | Indexing, thumbnails, metadata, and collections | In-app playback depends on supported codecs; other formats open in your default player |
| PDF stories | Indexing and first-page thumbnails | Built-in PDF reader |
| Image-folder comics | Page indexing and optional `meta.json` metadata | Built-in comic reader |
| EPUB, TXT, FB2, HTML | E-book indexing | Built-in continuous reader; EPUB chapters follow the book spine |
| WPS, DOC/DOCX, ODT, RTF, MOBI, AZW/AZW3, DjVu | E-book/document indexing | Open in the associated desktop app |
| CBZ / ZIP comics | Archive indexing | Built-in page and continuous readers |
| CBR / CB7 / CBT comics | Archive indexing | Open in the associated desktop reader |
| Pictures, including BMP, TIFF, HEIC/HEIF | Individual image indexing in Picture sources | Browser-supported images display in-app; other formats use a desktop app |

The built-in ZIP readers accept archives up to 256 MB, with bounded chapter/page sizes. Encrypted, damaged, or unsupported archives can be opened in a desktop reader. EPUB reading preserves text, chapter order, and common raster illustrations; publisher-specific styling is simplified.

Video conversion requires **Python, FFmpeg, and ffprobe on PATH**. Online profile-image downloads and portrait discovery need internet access. Folder changes are picked up through rescans; live folder watching is not available yet.

## Run from source

Requires **Node.js 22.13+** and **pnpm 11**.

```sh
pnpm install
pnpm desktop:dev
```

For browser development, run `pnpm dev` and open `http://127.0.0.1:5173`.

```sh
pnpm desktop:build  # Build the desktop app and web assets
pnpm desktop:dist   # Create installers for the current operating system
```

Built with **Electron, React, TypeScript, Fastify, and SQLite**.

See the **[usage and development guide](docs/guide.md)** for local API settings, search behaviour, metadata matching, resource limits, and the manual GitHub release workflow.

## Feedback & contributions

Found a bug or have an idea? **[Open an issue](https://github.com/ThilinaSatoru/Vaultly/issues)** with what happened, your operating system, and steps to reproduce it. Contributions are welcome; include relevant checks and describe the behaviour your change improves.

Video cards use folder covers (`Video name.jpg`, `Video name-poster.png`, `poster`, `cover`, or `folder` with a supported image extension), or a cover selected under **Info → Choose cover**. Manual covers survive rescanning and backups. Video cards share a uniform size. Portrait covers and landscape thumbnails fit inside the same artwork frame without cropping; hover previews fit the video dimensions independently.

The player remembers speed, volume, mute, repeat, picture fit, floating size, subtitle size and audio/subtitle language choices per vault. It applies matching languages to newly opened files and falls back to original audio / an available subtitle when a match is unavailable. Each new video enables subtitles when available, even if subtitles were switched off for the previous video. Embedded text subtitles and matching SRT, VTT, ASS/SSA, SUB, SBV, SAMI, LRC, MPL and STL text files are supported. Bitmap subtitles use the default desktop player. Alternate audio is cached locally as an audio-only file and synchronized to the original video. Preparing a new track may briefly pause playback.

Secondary controls live in **Player options**. Controls hide after 1.5 seconds of inactivity, including fullscreen, and immediately on pointer exit or **Hide controls now**, with small seek/volume feedback for shortcuts. Use Tab inside the player to reach the controls. Timeline hover previews can be disabled in the player or **Settings → Playback and reading**.

Enable **Settings → Playback and reading → Remember video playback position** to resume all videos in the vault where you stopped. This is off by default, and completed videos restart from the beginning. Video cards and video Info show only the source rather than repeating the movie folders and filename. Movie sources skip clips with a separate `sample` filename marker.

Enable **Remember last played series or episode** in the same settings panel to show **Continue watching** and remember the last episode in each series. This is separate from timestamp resuming. The full-size video player’s **Hide panel / Show panel** button preserves its choice for the active profile. Browsing filters, pages and scroll, management layout and filters, source expansion, reader layout, and playlists also stay with the profile and travel with its preferences backup.

Video collections follow dedicated folders rather than filename prefixes; root-level movies stay separate. Rescanning removes obsolete, untouched automatic video collections while preserving manual and annotated collections. Collection cards combine their own attributes with their children’s tags, categories, and people, including source attributes. Set attributes apply to children, and circle cards combine their member collections’ attributes.
