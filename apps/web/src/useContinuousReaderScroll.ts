import { type RefObject, useEffect } from "react";
import { matchesShortcut, readNumberPreference } from "./preferences";

export function useContinuousReaderScroll(scrollRef: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    let frame = 0;
    let direction = 0;
    let held = false;
    let extended = false;
    let target = 0;
    let lastFrame = 0;

    const cancel = () => {
      direction = 0;
      held = false;
      extended = false;
      window.cancelAnimationFrame(frame);
      frame = 0;
    };

    const animate = (now: number) => {
      const element = scrollRef.current;
      if (!direction || !element) return cancel();
      const elapsed = Math.min(32, Math.max(0, now - lastFrame));
      const step = readNumberPreference("vaultly.reader.scrollStep", 320, 80, 1600);
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      target = Math.max(0, Math.min(maximum, target));
      const distance = target - element.scrollTop;

      // Keep one scroll-step ahead while held. Direct scrollTop updates avoid
      // repeatedly restarting the container's CSS smooth-scroll animation.
      if (held && direction * distance < step * 0.15) {
        target = Math.max(0, Math.min(maximum, target + direction * step));
        extended = true;
      }
      const nextDistance = target - element.scrollTop;
      const smoothing = 1 - Math.exp(-12 * elapsed / 1000);
      element.scrollTop += nextDistance * smoothing;
      lastFrame = now;
      if (!held && Math.abs(target - element.scrollTop) < 0.5) {
        element.scrollTop = target;
        cancel();
      } else if ((target === 0 || target === maximum) && Math.abs(target - element.scrollTop) < 0.5) {
        element.scrollTop = target;
        cancel();
      } else {
        frame = window.requestAnimationFrame(animate);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const eventTarget = event.target instanceof HTMLElement ? event.target : null;
      if (eventTarget?.closest("input, textarea, select, [contenteditable]")) return;
      const nextDirection = matchesShortcut(event, "reader.scrollUp") ? -1
        : matchesShortcut(event, "reader.scrollDown") ? 1 : 0;
      if (!nextDirection) return;
      event.preventDefault();
      if (direction === nextDirection) {
        held = true;
        return;
      }
      cancel();
      const element = scrollRef.current;
      if (!element) return;
      direction = nextDirection;
      held = true;
      extended = false;
      const step = readNumberPreference("vaultly.reader.scrollStep", 320, 80, 1600);
      target = element.scrollTop + direction * step;
      lastFrame = performance.now();
      frame = window.requestAnimationFrame(animate);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!direction) return;
      if (!matchesShortcut(event, direction < 0 ? "reader.scrollUp" : "reader.scrollDown")) return;
      held = false;
      if (extended && scrollRef.current) {
        const remaining = Math.abs(target - scrollRef.current.scrollTop);
        target = scrollRef.current.scrollTop + direction * Math.min(remaining, 48);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", cancel);
    };
  }, [enabled, scrollRef]);
}
