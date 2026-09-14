import { ChevronLeft, ChevronRight, LoaderCircle, Minus, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type FitMode = "width" | "page" | "custom";

export function PdfReader({ itemId }: { itemId: number }) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [fitMode, setFitMode] = useState<FitMode>("page");
  const [zoomPercent, setZoomPercent] = useState(100);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [hasPage, setHasPage] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === "PageDown" || event.key === "ArrowRight") {
        event.preventDefault();
        setPageNumber((value) => Math.min(pdfDocument.numPages, value + 1));
      }
      if (event.key === "PageUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        setPageNumber((value) => Math.max(1, value - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pdfDocument]);

  const changeZoom = (delta: number) => {
    setZoomPercent((value) => Math.max(25, Math.min(400, value + delta)));
    setFitMode("custom");
  };

  return (
    <div className="pdf-reader">
      <div className="pdf-toolbar">
        <button type="button" onClick={() => setPageNumber((value) => Math.max(1, value - 1))} disabled={!pdfDocument || pageNumber <= 1} aria-label="Previous page"><ChevronLeft size={18} /></button>
        <label className="pdf-page-control">
          <span className="visually-hidden">Page number</span>
          <input type="number" min={1} max={pdfDocument?.numPages ?? 1} value={pageNumber} onChange={(event) => {
            if (!pdfDocument || !event.target.value) return;
            setPageNumber(Math.max(1, Math.min(pdfDocument.numPages, Number(event.target.value))));
          }} />
          <span>/ {pdfDocument?.numPages ?? "—"}</span>
        </label>
        <button type="button" onClick={() => setPageNumber((value) => Math.min(pdfDocument?.numPages ?? 1, value + 1))} disabled={!pdfDocument || pageNumber >= pdfDocument.numPages} aria-label="Next page"><ChevronRight size={18} /></button>
        <div className="pdf-toolbar-divider" />
        <select aria-label="Page fit" value={fitMode} onChange={(event) => setFitMode(event.target.value as FitMode)}>
          <option value="page">Fit page</option>
          <option value="width">Fit width</option>
          <option value="custom">{zoomPercent}%</option>
        </select>
        <button type="button" onClick={() => changeZoom(-25)} aria-label="Zoom out"><Minus size={17} /></button>
        <button type="button" onClick={() => changeZoom(25)} aria-label="Zoom in"><Plus size={17} /></button>
      </div>
      <div className={`pdf-scroll${fitMode === "page" ? " pdf-scroll-fit-page" : ""}`} ref={scrollRef}>
        {loading && <div className="pdf-status"><LoaderCircle className="spin" size={25} /> Opening PDF…</div>}
        {error && <div className="pdf-status pdf-error" role="alert">{error}</div>}
        <canvas ref={canvasRef} className={pdfDocument && hasPage ? "pdf-canvas" : "pdf-canvas hidden"} aria-label={`PDF page ${pageNumber}`} />
        {rendering && !error && <div className="pdf-rendering"><LoaderCircle className="spin" size={18} /> Rendering page…</div>}
      </div>
    </div>
  );
}
