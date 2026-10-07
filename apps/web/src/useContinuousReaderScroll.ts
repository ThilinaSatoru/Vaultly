import { type RefObject, useLayoutEffect } from "react";
import { matchesShortcut, readNumberPreference } from "./preferences";

export function useContinuousReaderScroll(scrollRef: RefObject<HTMLElement | null>, enabled = true, pageKey?: string | number) {
  useLayoutEffect(() => {
    if (!enabled) return;

    let frame = 0;
    let direction = 0;
    let held = false;
    let activeCode = "";
    let target = 0;
    let lastFrame = 0;
    const keySensitivity = () => readNumberPreference("vaultly.reader.keySensitivity", 100, 25, 300) / 100;

    const cancel = () => {
      direction = 0;
      activeCode = "";
      held = false;
      window.cancelAnimationFrame(frame);
      frame = 0;
    };

    const animate = (now: number) => {
      const element = scrollRef.current;
      if (!direction || !element) return cancel();
      const elapsed = Math.min(32, Math.max(0, now - lastFrame));
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      target = Math.max(0, Math.min(maximum, target));
      const nextDistance = target - element.scrollTop;
      const smoothing = 1 - Math.exp(-12 * elapsed / 1000);
      // Held keys move at a steady two viewports per second, without the
      // slowing down and speeding up of repeated smooth-scroll destinations.
      const nextTop = held
        ? element.scrollTop + direction * element.clientHeight * 2 * keySensitivity() * elapsed / 1000
        : element.scrollTop + nextDistance * smoothing;
      element.scrollTo({ top: Math.max(0, Math.min(maximum, nextTop)), behavior: "instant" });
      lastFrame = now;
      if (!held && Math.abs(target - element.scrollTop) < 0.5) {
        element.scrollTo({ top: target, behavior: "instant" });
        cancel();
      } else if (held && (direction < 0 ? element.scrollTop <= 0 : element.scrollTop >= maximum)) {
        cancel();
      } else {
        frame = window.requestAnimationFrame(animate);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const eventTarget = event.target instanceof HTMLElement ? event.target : null;
      if (eventTarget?.closest("input, textarea, select, [contenteditable], .dialog-backdrop, .management-drawer, .management-dock")) return;
      const nextDirection = matchesShortcut(event, "reader.scrollUp") ? -1
        : matchesShortcut(event, "reader.scrollDown") ? 1 : 0;
      if (!nextDirection) return;
      event.preventDefault();
      if (direction === nextDirection) {
        activeCode = event.code;
        if (event.repeat) held = true;
        else {
          held = false;
          const element = scrollRef.current;
          if (element) target += direction * element.clientHeight / 2 * keySensitivity();
        }
        return;
      }
      cancel();
      const element = scrollRef.current;
      if (!element) return;
      direction = nextDirection;
      activeCode = event.code;
      held = event.repeat;
      const step = element.clientHeight / 2 * keySensitivity();
      target = element.scrollTop + direction * step;
      lastFrame = performance.now();
      frame = window.requestAnimationFrame(animate);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!direction) return;
      if (event.code !== activeCode) return;
      if (held) cancel();
    };

    const onWheel = (event: WheelEvent) => {
      const element = scrollRef.current;
      if (!element || !(event.target instanceof Node) || !element.contains(event.target) || event.ctrlKey || event.defaultPrevented) return;
      cancel();
      const sensitivity = readNumberPreference("vaultly.reader.scrollSensitivity", 100, 25, 300) / 100;
      // Preserve native wheel/trackpad behavior at the default sensitivity.
      if (sensitivity === 1) return;
      event.preventDefault();
      const verticalUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const horizontalUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1;
      element.scrollBy({
        top: event.deltaY * verticalUnit * sensitivity,
        left: event.deltaX * horizontalUnit * sensitivity,
        behavior: "instant",
      });
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", cancel);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancel();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("wheel", onWheel);
    };
  }, [enabled, scrollRef, pageKey]);
}
