<div align="center">

<img src="apps/web/public/favicon.svg" alt="Vaultly logo" width="88" height="88">

# Vaultly

### Your media. Your folders. One beautiful library.

A local-first desktop library for **videos, comics, and PDF stories**.
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
- **Narrow your gallery** by media type, source, format, tags, categories, collection membership, size, or modified date. Search filenames separately and sort results your way.

### Build a library that feels yours

- **Multiple source folders:** scan nested directories for videos, PDFs, CBZ/ZIP archives, and image-based comics.
- **Separate vault profiles:** create and switch vaults from the top bar. Each starts empty and keeps its own library, preferences, caches, and backups.
- **Tags, categories, and favourites:** describe individual items or select across pages for bulk edits.
- **Cast & artists:** manage names, aliases, credits, and profile images in one shared directory.
- **Series & sets:** arrange mixed media in a chosen order, with custom covers, descriptions, and tags. Move between entries from the viewer.
- **Story circles:** group related sets into a larger story.
- **Automatic metadata matching:** apply existing names and patterns during scans, optionally expand tag/category matching with English forms, and read comic `meta.json` sidecars.

### Watch and read in place

- **Video player:** play supported formats with seeking and keyboard shortcuts; launch original files in the system player for other codecs.
- **PDF reader:** page navigation, fit-page/fit-width modes, and zoom.
- **Comic reader:** browse pages from image-folder comics.
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
2. Open **Sources** and add a folder containing your media.
3. Follow the initial scan, then browse **Videos**, **Comics**, or **Stories**.
4. Add favourites, tags, and collections to make the library easier to explore.

**File behaviour:** media stays in its source folders. Scans remove `#` markers from filenames and mark those items as favourites. Renaming and conversion also change source files. Library backups contain library data, not copies of your media.

## Supported media

| Media | Library support | Viewing |
| --- | --- | --- |
| Videos, including `.ts` transport streams | Indexing, thumbnails, metadata, and collections | In-app playback depends on supported codecs; other formats open in your default player |
| PDF stories | Indexing and first-page thumbnails | Built-in PDF reader |
| Image-folder comics | Page indexing and optional `meta.json` metadata | Built-in comic reader |
| CBZ / ZIP comics | Archive indexing | In-app archive reading is not yet available |

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
