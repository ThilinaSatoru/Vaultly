import { type ReactNode, useLayoutEffect, useRef } from "react";

export function LogView({ children, revision, label = "Process log" }: { children: ReactNode; revision: unknown; label?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const scroll = () => {
    const element = container.current;
    if (element) element.scrollTop = element.scrollHeight;
  };
  useLayoutEffect(() => {
    scroll();
    if (typeof ResizeObserver === "undefined" || !container.current) return;
    const observer = new ResizeObserver(scroll);
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [revision]);
  return <div ref={container} className="process-log" role="log" aria-label={label} tabIndex={0} onFocus={scroll}>{children}</div>;
}
