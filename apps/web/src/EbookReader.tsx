import { useReaderPages } from "./useReaderPages";
import { ReaderFullscreen } from "./ReaderFullscreen";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, ChevronsLeft, ExternalLink, LoaderCircle } from "lucide-react";
import { api } from "./media";
import { vaultUrl } from "./vault-session";
import { ReaderAutoScroll } from "./ReaderAutoScroll";
import { useContinuousReaderScroll } from "./useContinuousReaderScroll";
import { ReaderAppearance, useReaderAppearance } from "./ReaderAppearance";
import { ShortcutHelp } from "./ShortcutHelp";
import { useUiState } from "./ui-state";

interface Chapter { html?: string; text?: string; base?: string }
function safeBlocks(chapter: Chapter, itemId: number) {
  if (chapter.text !== undefined) return <p>{chapter.text}</p>;
  const document = new DOMParser().parseFromString(chapter.html ?? "", "text/html");
  const blocks: Array<{ text?: string; heading?: boolean; image?: string }> = [];
  const walk = (node: Element) => {
    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "SVG", "FORM"].includes(node.tagName)) return;
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") ?? "";
      if (!src || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src)) return;
      const base = `https://book.invalid/${chapter.base ? `${chapter.base}/` : ""}`;
      try {
        const pathname = decodeURIComponent(new URL(src, base).pathname.slice(1));
        blocks.push({ image: vaultUrl(`/api/items/${itemId}/ebook-image?path=${encodeURIComponent(pathname)}`) });
      } catch { /* Ignore malformed image references and keep reading the chapter. */ }
    } else if (/^(?:P|H[1-6]|LI|PRE|BLOCKQUOTE)$/.test(node.tagName)) {
      const copy = node.cloneNode(true) as Element;
      copy.querySelectorAll("script, style, iframe, object, embed").forEach((child) => child.remove());
      blocks.push({ text: copy.textContent ?? "", heading: /^H[1-6]$/.test(node.tagName) });
      node.querySelectorAll("img").forEach(walk);
    } else if (node.children.length) Array.from(node.children).forEach(walk);
    else if (node.textContent?.trim()) blocks.push({ text: node.textContent });
  };
  walk(document.body);
  return blocks.map((block, index) => block.image ? <img key={index} src={block.image} loading="lazy" alt="Book illustration" /> : block.heading ? <h2 key={index}>{block.text}</h2> : <p key={index}>{block.text}</p>);
}

export function EbookReader({ itemId, extension }: { itemId: number; extension: string }) {
  const [appearance, setAppearance] = useReaderAppearance();
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [error, setError] = useState("");
  const [fontSize, setFontSize] = useUiState("vaultly.ebook.fontSize", 19);
  const scrollRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const [chapter, setChapter] = useState(0);
  const goToChapter = useReaderPages(scrollRef, ".ebook-chapter", true, chapter, chapters?.length ?? 0, setChapter, `${itemId}:${fontSize}`);
  useEffect(() => {
    const home = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Home" || event.altKey || event.shiftKey) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button, [contenteditable], [role=combobox], .dialog-backdrop")) return;
      const viewer = event.target instanceof HTMLElement ? event.target.closest(".viewer") : null;
      if (viewer && viewer !== readerRef.current?.closest(".viewer")) return;
      event.preventDefault(); goToChapter(0);
    };
    window.addEventListener("keydown", home);
    return () => window.removeEventListener("keydown", home);
  }, [goToChapter]);
  const content = useMemo(() => chapters?.map((chapter, index) => <article key={index} className="ebook-chapter">{safeBlocks(chapter, itemId)}</article>), [chapters, itemId]);
  useContinuousReaderScroll(scrollRef, Boolean(chapters), itemId);
  useEffect(() => {
    const controller = new AbortController();
    setChapters(null); setError("");
    if (!["epub", "txt", "fb2", "html", "htm"].includes(extension)) {
      setError(`Open this .${extension.toUpperCase()} book with your associated desktop reader.`);
      return () => controller.abort();
    }
    api<{ chapters: Chapter[] }>(`/api/items/${itemId}/ebook`, { signal: controller.signal }).then((book) => setChapters(book.chapters)).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not read this book."); });
    return () => controller.abort();
  }, [itemId, extension]);
  return <div ref={readerRef} className={`ebook-reader page-tone-${appearance}`}><div className="ebook-toolbar"><ShortcutHelp kind="ebook" /><ReaderFullscreen target={readerRef} /><button type="button" disabled={!chapters?.length} aria-label="First page / scroll to top" title="First page / scroll to top (Home)" onClick={() => goToChapter(0)}><ChevronsLeft size={17} /></button><button type="button" aria-label="Previous chapter" disabled={!chapter} onClick={() => goToChapter(chapter - 1)}><ChevronLeft size={17} /></button><label>Chapter <input type="number" aria-label="Chapter number" min={1} max={chapters?.length ?? 1} value={chapter + 1} onChange={(event) => { if (event.target.value) goToChapter(Number(event.target.value) - 1); }} /> / {chapters?.length ?? "—"}</label><button type="button" aria-label="Next chapter" disabled={!chapters || chapter >= chapters.length - 1} onClick={() => goToChapter(chapter + 1)}><ChevronRight size={17} /></button><ReaderAppearance value={appearance} onChange={setAppearance} /><ReaderAutoScroll scrollRef={scrollRef} enabled={Boolean(chapters)} contentKey={itemId} /><label>Text size <input type="range" aria-label="Book text size" min="14" max="36" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></label><button type="button" onClick={() => { void api(`/api/items/${itemId}/open-document`, { method: "POST" }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not open book.")); }}><ExternalLink size={16} /> Open in desktop reader</button></div><div className="ebook-scroll" ref={scrollRef} tabIndex={0} style={{ fontSize }}>{!chapters && !error && <p><LoaderCircle className="spin" size={22} /> Opening book…</p>}{error && <p role="alert"><BookOpen size={24} /> {error}</p>}{content}</div></div>;
}
