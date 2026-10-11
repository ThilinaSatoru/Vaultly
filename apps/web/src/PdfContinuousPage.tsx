import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

export function PdfContinuousPage({ document, number, width }: { document: PDFDocumentProxy; number: number; width: number }) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [ratio, setRatio] = useState(1.414);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!container.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root: container.current.closest(".pdf-scroll"), rootMargin: "1000px" });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !canvas.current || width <= 0) return;
    let active = true;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    document.getPage(number).then(async (page) => {
      if (!active || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
      const scale = width / base.width;
      const viewport = page.getViewport({ scale });
      const pixelRatio = Math.max(0.5, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(12_000_000 / (viewport.width * viewport.height))));
      const node = canvas.current;
      node.width = Math.ceil(viewport.width * pixelRatio); node.height = Math.ceil(viewport.height * pixelRatio);
      node.style.width = `${viewport.width}px`; node.style.height = `${viewport.height}px`;
      task = page.render({ canvas: node, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
      await task.promise;
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Could not render page."); });
    return () => { active = false; task?.cancel(); if (canvas.current) { canvas.current.width = 0; canvas.current.height = 0; } };
  }, [document, number, visible, width]);
  return <div ref={container} className="pdf-continuous-page" data-pdf-page={number} style={{ width, minHeight: width * ratio }}><canvas ref={canvas} aria-label={`PDF page ${number}`} />{error && <p role="alert">{error}</p>}</div>;
}
