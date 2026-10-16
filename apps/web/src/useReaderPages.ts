import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";

export function readerPageAt(elements: ArrayLike<Pick<HTMLElement, "getBoundingClientRect">>, top: number) {
  let low = 0, high = elements.length - 1, result = 0;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (elements[middle].getBoundingClientRect().top <= top) { result = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return result;
}

/** Scroll updates the counter; only explicit navigation moves the viewport. */
export function useReaderPages(scrollRef: RefObject<HTMLElement | null>, selector: string, continuous: boolean,
  page: number, count: number, setPage: (page: number) => void, contentKey: string | number) {
  const current = useRef(page); current.current = page;
  const navigate = useCallback((requested: number) => {
    const next = Math.max(0, Math.min(Math.max(0, count - 1), requested));
    current.current = next;
    setPage(next);
    const container = scrollRef.current;
    if (!container) return;
    container.dispatchEvent(new Event("reader-navigate"));
    const destination = continuous ? container.querySelectorAll<HTMLElement>(selector)[next] : null;
    container.scrollTo({ top: next > 0 && destination ? destination.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - container.clientTop : 0,
      left: 0, behavior: "instant" });
  }, [scrollRef, selector, continuous, count, setPage]);

  const navigateRef = useRef(navigate); navigateRef.current = navigate;
  useLayoutEffect(() => { navigateRef.current(current.current); }, [contentKey, continuous, count]);
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || !continuous || !count) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const elements = container.querySelectorAll<HTMLElement>(selector);
      if (!elements.length) return;
      const atEnd = container.scrollTop > 0 && container.scrollTop + container.clientHeight >= container.scrollHeight - 2;
      const next = atEnd ? elements.length - 1 : readerPageAt(elements,
        container.getBoundingClientRect().top + Math.min(120, container.clientHeight * .2));
      if (next !== current.current) { current.current = next; setPage(next); }
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    container.addEventListener("scroll", scroll, { passive: true });
    return () => { container.removeEventListener("scroll", scroll); cancelAnimationFrame(frame); };
  }, [scrollRef, selector, continuous, count, contentKey, setPage]);
  return navigate;
}
