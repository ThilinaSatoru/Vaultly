import { opendir, stat } from "node:fs/promises";
import path from "node:path";
import { database } from "./database.js";
import { readMusicMetadata } from "./music-metadata.js";
import { englishText } from "./english-matching.js";
import { withSourceScan } from "./process-resources.js";

export const musicExtensions = new Set([".mp3", ".flac", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".aiff", ".aif", ".wma", ".ape", ".wv", ".alac"]);
export const musicVideoExtensions = new Set([".mp4", ".m4v", ".mkv", ".webm", ".avi", ".mov", ".wmv", ".flv", ".mpeg", ".mpg", ".ts", ".mts", ".m2ts", ".vob", ".ogv", ".3gp", ".3g2", ".asf", ".mxf"]);
interface MusicScan { controller: AbortController; task: Promise<void>; processed: number; errors: number; current: string; name: string }
const scans = new Map<number, MusicScan>();
export function getMusicScanActivity() {
  return [...scans].map(([id, scan]) => ({ id: `music-${id}`, label: `Music · ${scan.name}`,
    detail: `${scan.processed} indexed · ${scan.errors} errors · ${scan.current || "Waiting for scan slot"}`,
    processed: scan.processed, total: null, target: "sources" as const }));
}
export function musicScanProgress(id: number) {
  const scan = scans.get(id);
  return scan ? { processed: scan.processed, errors: scan.errors, current: scan.current } : null;
}
export async function cancelMusicScan(id: number) {
  const scan = scans.get(id);
  scan?.controller.abort();
  await scan?.task;
  return Boolean(scan);
}
export async function cancelAllMusicScans() { await Promise.all([...scans.keys()].map(cancelMusicScan)); }

function ensureAttribute(kind: "tag" | "category", name: string) {
  database.prepare("INSERT OR IGNORE INTO music_attributes(kind, name) VALUES (?, ?)").run(kind, name);
  return (database.prepare("SELECT id FROM music_attributes WHERE kind = ? AND name = ? COLLATE NOCASE").get(kind, name) as { id: number }).id;
}
export function applyMusicAttributes(id: number, text: string, genres: string[], tags: string[]) {
  database.prepare("DELETE FROM music_track_attributes WHERE track_id = ? AND origin = 'scan'").run(id);
  const add = database.prepare("INSERT OR IGNORE INTO music_track_attributes(track_id, attribute_id, origin) VALUES (?, ?, 'scan')");
  for (const name of genres.filter(Boolean)) add.run(id, ensureAttribute("category", name));
  for (const name of tags.filter(Boolean)) add.run(id, ensureAttribute("tag", name));
  const normalized = ` ${englishText(text)} `;
  const attributes = database.prepare("SELECT * FROM music_attributes").all() as Array<{ id: number; name: string; patterns_json: string }>;
  for (const attribute of attributes) {
    const patterns = [attribute.name, ...JSON.parse(attribute.patterns_json) as string[]];
    if (patterns.some((pattern) => { const value = englishText(pattern); return value && normalized.includes(` ${value} `); })) add.run(id, attribute.id);
  }
}

async function* audioFiles(directory: string, signal: AbortSignal): AsyncGenerator<string> {
  const entries = await opendir(directory);
  for await (const entry of entries) {
    signal.throwIfAborted();
    // Never follow symlinks outside the chosen music root.
    if (entry.isSymbolicLink()) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* audioFiles(filename, signal);
    else if (entry.isFile() && (musicExtensions.has(path.extname(entry.name).toLowerCase()) || musicVideoExtensions.has(path.extname(entry.name).toLowerCase()))) yield filename;
  }
}

/** Reads the usual "Artist - Song.mp3" naming, ignoring a leading track number ("01 - Artist - Song"). */
export function parseMusicFilename(filename: string): { artist: string; title: string } | null {
  const base = path.basename(filename, path.extname(filename)).replace(/_/g, " ").trim();
  const split = (text: string) => { const match = /^(.+?)\s+[-–—]\s+(.+)$/.exec(text); return match ? { artist: match[1]!.trim(), title: match[2]!.trim() } : null; };
  const withoutNumber = base.replace(/^\d{1,3}\s*[-.)]\s*(?=.+\s[-–—]\s)/, "");
  const named = split(withoutNumber) ?? split(base);
  return named && !/^\d+$/.test(named.artist) ? named : null;
}
export function scanMusicSource(id: number): Promise<void> {
  if (scans.has(id)) return scans.get(id)!.task;
  const source = database.prepare("SELECT * FROM music_sources WHERE id = ?").get(id) as { root_path: string; name: string } | undefined;
  if (!source) return Promise.resolve();
  const scan: MusicScan = { controller: new AbortController(), task: Promise.resolve(), processed: 0, errors: 0, current: "", name: source.name };
  const signal = scan.controller.signal;
  scans.set(id, scan);
  database.prepare("UPDATE music_sources SET status = 'scanning', last_error = NULL WHERE id = ?").run(id);
  scan.task = withSourceScan(async () => {
    const seen = new Set<number>();
    let lastError = "";
    for await (const filename of audioFiles(source.root_path, signal)) {
      const relative = path.relative(source.root_path, filename).split(path.sep).join("/");
      scan.current = relative;
      const existing = database.prepare(`SELECT id, size_bytes, modified_at_ms, metadata_json, duration, bitrate, sample_rate,
        channels, bit_depth, codec, cover_data FROM music_tracks WHERE source_id = ? AND relative_path = ?`).get(id, relative) as {
          id: number; size_bytes: number; modified_at_ms: number; metadata_json: string;
          duration: number | null; bitrate: number | null; sample_rate: number | null; channels: string; bit_depth: number | null; codec: string; cover_data: Uint8Array | null;
        } | undefined;
      if (existing) seen.add(existing.id);
      try {
        const info = await stat(filename);
        // A rescan still applies newly created matching rules, without probing
        // or extracting embedded artwork again for unchanged audio files.
        const metadata = existing && existing.size_bytes === info.size && existing.modified_at_ms === info.mtimeMs
          ? { ...existing, tags: JSON.parse(existing.metadata_json) as Record<string, string>, cover: existing.cover_data }
          : await readMusicMetadata(filename, signal);
        signal.throwIfAborted();
        const t = metadata.tags;
        const folders = relative.split("/").slice(0, -1);
        const named = parseMusicFilename(path.basename(filename));
        const artist = named?.artist || t.artist || t.author || (folders.length >= 2 ? folders[folders.length - 2] : "Unknown artist")!;
        const albumArtist = t.album_artist || t.albumartist || artist;
        const album = t.album || folders.at(-1) || "Unknown album";
        const title = named?.title || t.title || path.basename(filename, path.extname(filename)).replace(/^\d+[ ._-]+/, "");
        const year = t.date || t.year || "";
        database.exec("BEGIN IMMEDIATE");
        try {
          database.prepare("INSERT INTO music_albums(title, artist, year) VALUES (?, ?, ?) ON CONFLICT(title, artist) DO UPDATE SET year = excluded.year").run(album, albumArtist, year);
          const albumId = (database.prepare("SELECT id FROM music_albums WHERE title = ? AND artist = ?").get(album, albumArtist) as { id: number }).id;
          const result = database.prepare(`INSERT INTO music_tracks(source_id, relative_path, filename, title, artist, album_id, album_artist, track_number, disc_number, year,
            duration, bitrate, sample_rate, channels, bit_depth, codec, size_bytes, modified_at_ms, metadata_json, cover_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_id, relative_path) DO UPDATE SET filename=excluded.filename, title=excluded.title, artist=excluded.artist,
            album_id=excluded.album_id, album_artist=excluded.album_artist, track_number=excluded.track_number, disc_number=excluded.disc_number,
            year=excluded.year, duration=excluded.duration, bitrate=excluded.bitrate, sample_rate=excluded.sample_rate, channels=excluded.channels,
            bit_depth=excluded.bit_depth, codec=excluded.codec, size_bytes=excluded.size_bytes, modified_at_ms=excluded.modified_at_ms,
            metadata_json=excluded.metadata_json, cover_data=excluded.cover_data, available=1 RETURNING id`)
            .get(id, relative, path.basename(filename), title, artist, albumId, albumArtist, parseInt(t.track || "0") || 0, parseInt(t.disc || "0") || 0, year,
              metadata.duration, metadata.bitrate, metadata.sample_rate, metadata.channels, metadata.bit_depth, metadata.codec, info.size, info.mtimeMs, JSON.stringify(t), metadata.cover) as { id: number };
          seen.add(result.id);
          database.prepare("DELETE FROM music_track_artists WHERE track_id = ?").run(result.id);
          for (const name of new Set([artist, albumArtist, ...artist.split(/\s*;\s*/)].filter(Boolean))) {
            database.prepare("INSERT OR IGNORE INTO music_artists(name) VALUES (?)").run(name);
            const artistId = (database.prepare("SELECT id FROM music_artists WHERE name = ?").get(name) as { id: number }).id;
            database.prepare("INSERT OR IGNORE INTO music_track_artists(track_id, artist_id) VALUES (?, ?)").run(result.id, artistId);
          }
          applyMusicAttributes(result.id, `${relative} ${Object.values(t).join(" ")}`, (t.genre || "").split(/\s*[;,]\s*/),
            [metadata.codec, musicVideoExtensions.has(path.extname(filename).toLowerCase()) ? "Music video" : "", /^(flac|alac|ape|wavpack|pcm_)/.test(metadata.codec) ? "Lossless" : "", t.mood || "", t.language || ""]);
          database.exec("COMMIT");
          scan.processed++;
        } catch (error) { database.exec("ROLLBACK"); throw error; }
      } catch (error) {
        signal.throwIfAborted();
        scan.errors++;
        lastError = `${relative}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    signal.throwIfAborted();
    // Reconcile only after a complete walk; cancellations/offline roots keep their index.
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("UPDATE music_tracks SET available = 0 WHERE source_id = ?").run(id);
      const mark = database.prepare("UPDATE music_tracks SET available = 1 WHERE id = ?");
      for (const trackId of seen) mark.run(trackId);
      database.prepare("UPDATE music_sources SET status = ?, last_error = ?, last_scanned_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(scan.errors ? "error" : "ready", scan.errors ? `${scan.errors} file(s) could not be read. ${lastError}` : null, id);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  }, signal).catch((error) => {
    database.prepare("UPDATE music_sources SET status = ?, last_error = ? WHERE id = ?")
      .run(signal.aborted ? "idle" : "error", signal.aborted ? "Scan cancelled. Previous index preserved." : String(error), id);
  }).finally(() => scans.delete(id));
  return scan.task;
}
