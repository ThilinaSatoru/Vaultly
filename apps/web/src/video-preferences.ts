export interface PlaybackTrack { index: number; language: string; title: string; default?: boolean }
export interface TrackPreference { language: string; variant: string; index: number }
const aliases: Record<string, string> = {
  eng: "en", english: "en", jpn: "ja", japanese: "ja", jap: "ja", spa: "es", spanish: "es", fra: "fr", fre: "fr", french: "fr",
  deu: "de", ger: "de", german: "de", zho: "zh", chi: "zh", chinese: "zh", kor: "ko", korean: "ko", ita: "it", italian: "it",
  por: "pt", portuguese: "pt", rus: "ru", russian: "ru", hin: "hi", hindi: "hi", tam: "ta", tamil: "ta", sin: "si", sinhala: "si",
  ara: "ar", arabic: "ar", dut: "nl", nld: "nl", ind: "id", tha: "th", vie: "vi", und: "und",
};
export function trackLanguage(value: string) {
  const lower = value.toLowerCase().replace(/_/g, "-");
  return aliases[lower] ?? (lower.match(/^[a-z]{2}(?:-[a-z]{2})?$/) ? lower.split("-")[0]! : "und");
}
export function subtitleLanguage(filename: string) {
  const words = filename.replace(/\.[^.]+$/, "").toLowerCase().split(/[ ._()[\]-]+/);
  // Prefer explicit language labels at the end of a sidecar filename.
  for (const word of words.reverse()) {
    if (aliases[word]) return aliases[word]!;
    if (["en", "ja", "es", "fr", "de", "zh", "ko", "it", "pt", "ru", "hi", "ta", "si", "ar", "nl", "id", "th", "vi"].includes(word)) return word;
  }
  return "und";
}
function variant(title: string) { return title.toLowerCase().match(/forced|sdh|commentary|signs|songs|dub|original/g)?.sort().join(" ") ?? ""; }
export function trackPreference(track: PlaybackTrack): TrackPreference {
  return { language: trackLanguage(track.language), variant: variant(track.title), index: track.index };
}
export function preferredTrack(tracks: PlaybackTrack[], stored: string | null, fallback: number) {
  if (stored === "off") return -1;
  try {
    const preference = JSON.parse(stored ?? "null") as TrackPreference | null;
    if (!preference || typeof preference.language !== "string") return fallback;
    const language = trackLanguage(preference.language);
    const matches = tracks.filter((track) => trackLanguage(track.language) === language);
    if (language === "und") return matches.find((track) => track.index === preference.index)?.index ?? fallback;
    return matches.find((track) => variant(track.title) === preference.variant)?.index ?? matches[0]?.index ?? fallback;
  } catch { return fallback; }
}

export function preferredSubtitle(tracks: PlaybackTrack[], stored: string | null) {
  const fallback = tracks.find((track) => track.default)?.index ?? tracks[0]?.index ?? -1;
  return preferredTrack(tracks, stored === "off" ? null : stored, fallback);
}

export function videoCardOrientation(item: { has_cover?: number; cover_width?: number | null; cover_height?: number | null; video_width?: number | null; video_height?: number | null }) {
  const width = item.has_cover && item.cover_width ? item.cover_width : item.video_width;
  const height = item.has_cover && item.cover_height ? item.cover_height : item.video_height;
  return width && height && height > width ? "portrait" : "landscape";
}
