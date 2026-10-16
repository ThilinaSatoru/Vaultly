import { useEffect, useState } from "react";
import { Select } from "./Select";
import { vaultStorage } from "./vault-session";

export type PageAppearance = "original" | "dim" | "night";
const appearanceEvent = "vaultly-reader-appearance";
function readAppearance(): PageAppearance {
  const saved = vaultStorage.getItem("vaultly.reader.appearance");
  return saved === "original" || saved === "night" ? saved : "dim";
}
export function useReaderAppearance() {
  const [appearance, setAppearance] = useState<PageAppearance>(readAppearance);
  useEffect(() => {
    const update = () => setAppearance(readAppearance());
    window.addEventListener(appearanceEvent, update);
    return () => window.removeEventListener(appearanceEvent, update);
  }, []);
  const updateAppearance = (value: PageAppearance) => {
    vaultStorage.setItem("vaultly.reader.appearance", value);
    setAppearance(value);
    window.dispatchEvent(new Event(appearanceEvent));
  };
  return [appearance, updateAppearance] as const;
}
export function ReaderAppearance({ value, onChange }: { value: PageAppearance; onChange: (value: PageAppearance) => void }) {
  return <label className="reader-appearance"><span>Page tone</span><Select aria-label="Page appearance" title="Dim softens artwork; night darkens the reading background and preserves artwork colors" value={value} onChange={(event) => onChange(event.target.value as PageAppearance)}><option value="original">Original</option><option value="dim">Soft dim</option><option value="night">Night ink</option></Select></label>;
}
