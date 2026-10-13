import { Library, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { readPaletteMode, savePaletteMode } from "./theme";

interface WindowBridge {
  platform: string;
  appearance(appearance: { color: string; symbolColor: string; title: string }): void;
}

function hexColor(color: string): string {
  const parts = color.match(/\d+/g)?.slice(0, 3) ?? [];
  return parts.length === 3 ? `#${parts.map((part) => Number(part).toString(16).padStart(2, "0")).join("")}` : "#111315";
}

export function DesktopTitleBar() {
  const bridge = (window as Window & { vaultlyWindow?: WindowBridge }).vaultlyWindow;
  const [title, setTitle] = useState(document.title || "Vaultly · A world within your vault");
  useEffect(() => {
    if (!bridge) return;
    document.documentElement.dataset.desktop = bridge.platform;
    const update = () => {
      const title = document.title || "Vaultly · A world within your vault";
      setTitle(title);
      const styles = getComputedStyle(document.documentElement);
      // Resolve theme variables to concrete colors for native window controls.
      const probe = document.createElement("span");
      probe.style.backgroundColor = styles.getPropertyValue("--sidebar");
      probe.style.color = styles.getPropertyValue("--text");
      document.body.append(probe);
      const resolved = getComputedStyle(probe);
      bridge.appearance({ color: hexColor(resolved.backgroundColor), symbolColor: hexColor(resolved.color), title });
      probe.remove();
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    update();
    return () => { observer.disconnect(); delete document.documentElement.dataset.desktop; };
  }, [bridge]);
  if (!bridge) return null;
  return <div className="desktop-titlebar"><Library size={16} aria-hidden="true" /><span>{title}</span><small>Your private media universe</small></div>;
}

export function ThemeToggle() {
  const [palette, setPalette] = useState(readPaletteMode);
  useEffect(() => {
    const observer = new MutationObserver(() => setPalette(readPaletteMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-palette"] });
    return () => observer.disconnect();
  }, []);
  const next = palette === "dark" ? "light" : "dark";
  return <button className="theme-toggle secondary-button" type="button" role="switch" aria-checked={palette === "dark"} aria-label="Dark mode" title={`Switch to ${next} mode`} onClick={() => { savePaletteMode(next); setPalette(next); }}>
    {palette === "dark" ? <Sun size={17} /> : <Moon size={17} />}<span>{palette === "dark" ? "Light" : "Dark"}</span>
  </button>;
}
