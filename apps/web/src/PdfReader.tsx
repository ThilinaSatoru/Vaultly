import { ChevronLeft, ChevronRight, LoaderCircle, Minus, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { matchesShortcut, readBooleanPreference, readNumberPreference } from "./preferences";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type FitMode = "width" | "page" | "custom";

const storedFitMode = (): FitMode => {
  const value = window.localStorage.getItem("vaultly.pdf.fit");
  return value === "width" || value === "custom" ? value : "page";
};

const storedZoom = () => {
  const value = Number(window.localStorage.getItem("vaultly.pdf.zoom"));
  return Number.isFinite(value) ? Math.max(25, Math.min(400, value)) : 100;
};

export function PdfReader({ itemId, onPreviousItem, onNextItem }: { itemId: number; onPreviousItem?: () => void; onNextItem?: () => void }) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [fitMode, setFitMode] = useState<FitMode>(storedFitMode);
  const [zoomPercent, setZoomPercent] = useState(storedZoom);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [hasPage, setHasPage] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { window.localStorage.setItem("vaultly.pdf.fit", fitMode); }, [fitMode]);
  useEffect(() => { window.localStorage.setItem("vaultly.pdf.zoom", String(zoomPercent)); }, [zoomPercent]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      const bounds = container.getBoundingClientRect();
      const width = Math.floor(bounds.width);
      const height = Math.floor(bounds.height);
      setContainerSize((current) => current.width === width && current.height === height
        ? current
        : { width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setPdfDocument(null);
    setHasPage(false);
    setPageNumber(1);
    const task = getDocument({
      url: `/api/items/${itemId}/file`,
      rangeChunkSize: 64 * 1024,
      disableAutoFetch: true,
      disableStream: true,
    });
    task.promise.then((loadedDocument) => {
      if (!active) return;
      setPdfDocument(loadedDocument);
      setLoading(false);
    }).catch((loadError) => {
      if (!active) return;
      setLoading(false);
      setError(loadError instanceof Error ? loadError.message : "Could not open this PDF.");
    });
    return () => { active = false; void task.destroy(); };
  }, [itemId]);

  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
  }, [itemId, pageNumber, fitMode]);

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current || !containerSize.width || !containerSize.height) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    const visibleCanvas = canvasRef.current;
    setRendering(true);
    setError("");

    void (async () => {
      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled) return;
        const naturalViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(100, containerSize.width - 56);
        const availableHeight = Math.max(100, containerSize.height - 48);
        const scale = fitMode === "width"
          ? availableWidth / naturalViewport.width
          : fitMode === "page"
            ? Math.min(availableWidth / naturalViewport.width, availableHeight / naturalViewport.height)
            : zoomPercent / 100;
        const viewport = page.getViewport({ scale });
        const pixelRatio = Math.max(0.5, Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(12_000_000 / (viewport.width * viewport.height)),
        ));
        const renderViewport = page.getViewport({ scale: scale * pixelRatio });
        const renderCanvas = document.createElement("canvas");
        renderCanvas.width = Math.max(1, Math.floor(renderViewport.width));
        renderCanvas.height = Math.max(1, Math.floor(renderViewport.height));
        const context = renderCanvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas rendering is unavailable.");
        renderTask = page.render({ canvas: renderCanvas, canvasContext: context, viewport: renderViewport });
        await renderTask.promise;
        if (cancelled) return;
        visibleCanvas.width = renderCanvas.width;
        visibleCanvas.height = renderCanvas.height;
        visibleCanvas.style.width = `${viewport.width}px`;
        visibleCanvas.style.height = `${viewport.height}px`;
        const visibleContext = visibleCanvas.getContext("2d", { alpha: false });
        if (!visibleContext) throw new Error("Canvas display is unavailable.");
        visibleContext.drawImage(renderCanvas, 0, 0);
        setHasPage(true);
        setRendering(false);
      } catch (renderError) {
        if (cancelled || (renderError instanceof Error && renderError.name === "RenderingCancelledException")) return;
        setRendering(false);
        setError(renderError instanceof Error ? renderError.message : "Could not render this page.");
      }
    })();

    return () => { cancelled = true; renderTask?.cancel(); };
  }, [pdfDocument, pageNumber, fitMode, zoomPercent, containerSize.width, containerSize.height]);

  useEffect(() => {
    if (!pdfDocument) return;
    const onKey = (event: KeyboardEvent) => {
      const targetElement = event.target instanceof HTMLElement ? event.target : null;
      if (targetElement?.closest("input, textarea, select, [contenteditable]")) return;
      const activatingControl = Boolean(targetElement?.closest("button, a"));
      if (matchesShortcut(event, "reader.nextPage")) {
        event.preventDefault();
        if (pageNumber < pdfDocument.numPages) setPageNumber(pageNumber + 1);
        else if (onNextItem && readBooleanPreference("vaultly.reader.continuous", true)) onNextItem();
      }
      if (matchesShortcut(event, "reader.previousPage")) {
        event.preventDefault();
        if (pageNumber > 1) setPageNumber(pageNumber - 1);
        else if (onPreviousItem && readBooleanPreference("vaultly.reader.continuous", true)) onPreviousItem();
      }
      if (matchesShortcut(event, "reader.scrollUp")) {
        event.preventDefault();
        scrollRef.current?.scrollBy({ top: -readNumberPreference("vaultly.reader.scrollStep", 160, 40, 800), behavior: "smooth" });
      }
      if (matchesShortcut(event, "reader.scrollDown")) {
        event.preventDefault();
        scrollRef.current?.scrollBy({ top: readNumberPreference("vaultly.reader.scrollStep", 160, 40, 800), behavior: "smooth" });
      }
      if (matchesShortcut(event, "reader.zoomIn") && !activatingControl) {
        event.preventDefault();
        changeZoom(25);
      }
      if (matchesShortcut(event, "reader.resetFit")) {
        event.preventDefault();
        setZoomPercent(100);
        setFitMode("page");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pdfDocument, pageNumber, onPreviousItem, onNextItem]);

  const changeZoom = (delta: number) => {
    setZoomPercent((value) => Math.max(25, Math.min(400, value + delta)));
    setFitMode("custom");
  };

  return (
    <div className="pdf-reader">
      <div className="pdf-toolbar">
        <button type="button" onClick={() => pageNumber > 1 ? setPageNumber(pageNumber - 1) : onPreviousItem?.()} disabled={!pdfDocument || (pageNumber <= 1 && !onPreviousItem)} aria-label="Previous page"><ChevronLeft size={18} /></button>
        <label className="pdf-page-control">
          <span className="visually-hidden">Page number</span>
          <input type="number" min={1} max={pdfDocument?.numPages ?? 1} value={pageNumber} onChange={(event) => {
            if (!pdfDocument || !event.target.value) return;
            setPageNumber(Math.max(1, Math.min(pdfDocument.numPages, Number(event.target.value))));
          }} />
          <span>/ {pdfDocument?.numPages ?? "—"}</span>
        </label>
        <button type="button" onClick={() => pdfDocument && pageNumber < pdfDocument.numPages ? setPageNumber(pageNumber + 1) : onNextItem?.()} disabled={!pdfDocument || (pageNumber >= pdfDocument.numPages && !onNextItem)} aria-label="Next page"><ChevronRight size={18} /></button>
        <div className="pdf-toolbar-divider" />
        <select aria-label="Page fit" value={fitMode} onChange={(event) => { setFitMode(event.target.value as FitMode); window.requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true })); }}>
          <option value="page">Fit page</option>
          <option value="width">Fit width</option>
          <option value="custom">{zoomPercent}%</option>
        </select>
        <button type="button" onClick={() => changeZoom(-25)} aria-label="Zoom out"><Minus size={17} /></button>
        <button type="button" onClick={() => changeZoom(25)} aria-label="Zoom in"><Plus size={17} /></button>
      </div>
      <div
        className={`pdf-scroll${fitMode === "page" ? " pdf-scroll-fit-page" : ""}`}
        ref={scrollRef}
        tabIndex={-1}
        onPointerDown={() => scrollRef.current?.focus({ preventScroll: true })}
      >
        {loading && <div className="pdf-status"><LoaderCircle className="spin" size={25} /> Opening PDF…</div>}
        {error && <div className="pdf-status pdf-error" role="alert">{error}</div>}
        <canvas ref={canvasRef} className={pdfDocument && hasPage ? "pdf-canvas" : "pdf-canvas hidden"} aria-label={`PDF page ${pageNumber}`} />
        {rendering && !error && <div className="pdf-rendering"><LoaderCircle className="spin" size={18} /> Rendering page…</div>}
      </div>
    </div>
  );
}
