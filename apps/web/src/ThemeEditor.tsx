import { useEffect, useState } from "react";
import { Palette, Plus, Save, Trash2, Upload, Download, X } from "lucide-react";
import { ClearableInput, ClearableTextarea } from "./ClearableField";
import { applyTheme, colorsForPalette, contrastRatio, darkColors, deleteCustomTheme, neonTheme, previewCustomTheme, readCustomThemes, readTheme, saveTheme, storeCustomTheme, themeColors, validateCustomTheme, type CustomTheme, type ThemeColors } from "./theme";

export function ThemeEditor() {
  const [themes, setThemes] = useState(readCustomThemes);
  const [draft, setDraft] = useState<CustomTheme | null>(null);
  const [json, setJson] = useState("");
  const [error, setError] = useState("");
  useEffect(() => () => applyTheme(), []);
  const edit = (theme: CustomTheme) => { setDraft(theme); setError(""); previewCustomTheme(theme); };
  const update = (value: Partial<CustomTheme>) => { if (draft) edit({ ...draft, ...value }); };
  const create = () => {
    const computed = getComputedStyle(document.documentElement);
    const colors = Object.fromEntries(Object.keys(themeColors).map((key) => {
      const color = computed.getPropertyValue(`--${key}`).trim(); return [key, /^#[a-f\d]{6}$/i.test(color) ? color : darkColors[key as keyof ThemeColors]];
    })) as ThemeColors;
    edit({ id: crypto.randomUUID(), name: "My theme", palette: document.documentElement.dataset.palette === "dark" ? "dark" : "light", colors, gradient: 0, glow: 0 });
  };
  const exportTheme = (theme: CustomTheme) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(theme, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${theme.name.replace(/[^\p{L}\p{N}_-]+/gu, "-")}.json`; link.click(); URL.revokeObjectURL(url);
  };
  return <section className="theme-editor"><header><h3><Palette size={17} /> Custom themes</h3><button type="button" className="secondary-button" onClick={create}><Plus size={15} /> Create theme</button><button type="button" className="secondary-button" onClick={() => edit({ ...neonTheme, id: crypto.randomUUID(), name: "My neon theme" })}>Neon template</button></header>
    <div className="custom-theme-list">{themes.map((theme) => <article key={theme.id}>
      <button type="button" aria-pressed={readTheme() === `custom:${theme.id}`} onClick={() => { setDraft(null); saveTheme(`custom:${theme.id}`); setThemes(readCustomThemes()); }}><i style={{ background: theme.colors.bg, color: theme.colors.acid, borderColor: theme.colors.border }}>Aa</i>{theme.name}</button>
      <button type="button" onClick={() => edit(theme)}>Edit</button><button type="button" aria-label={`Export ${theme.name}`} onClick={() => exportTheme(theme)}><Download size={15} /></button>
      <button type="button" className="danger-action" aria-label={`Delete theme ${theme.name}`} onClick={() => { deleteCustomTheme(theme.id); setThemes(readCustomThemes()); if (draft?.id === theme.id) { setDraft(null); applyTheme(); } }}><Trash2 size={15} /></button>
    </article>)}</div>
    {draft && <form onSubmit={(event) => { event.preventDefault(); try { storeCustomTheme(draft); setThemes(readCustomThemes()); setDraft(null); setError(""); } catch (reason) { setError(String(reason)); } }}>
      <label>Theme name<ClearableInput value={draft.name} maxLength={80} required onChange={(event) => update({ name: event.target.value })} /></label>
      <label>Editing palette<select value={draft.palette} onChange={(event) => { const palette = event.target.value as "dark" | "light"; const palettes = { ...draft.palettes, [draft.palette]: draft.colors }; update({ palette, palettes, colors: colorsForPalette({ ...draft, palettes }, palette) }); }}><option value="dark">Dark</option><option value="light">Light</option></select></label>
      <p className="theme-palette-note">Edit light and dark colors independently. Switching modes keeps this theme active.</p>
      <div className="theme-color-fields">{Object.entries(themeColors).map(([key, label]) => <label key={key}>{label}<span><input type="color" aria-label={`${label} color`} value={draft.colors[key as keyof ThemeColors]} onChange={(event) => update({ colors: { ...draft.colors, [key]: event.target.value } })} /><input aria-label={`${label} hex`} value={draft.colors[key as keyof ThemeColors]} maxLength={7} pattern="#[a-fA-F0-9]{6}" onChange={(event) => { const value = event.target.value; setDraft({ ...draft, colors: { ...draft.colors, [key]: value } }); if (/^#[a-f\d]{6}$/i.test(value)) previewCustomTheme({ ...draft, colors: { ...draft.colors, [key]: value } }); }} /></span></label>)}</div>
      <label>Soft gradient <output>{draft.gradient}%</output><input aria-label="Soft gradient" type="range" min={0} max={100} value={draft.gradient} onChange={(event) => update({ gradient: Number(event.target.value) })} /></label>
      <label>Neon glow <output>{draft.glow}%</output><input aria-label="Neon glow" type="range" min={0} max={100} value={draft.glow} onChange={(event) => update({ glow: Number(event.target.value) })} /></label>
      <p className={contrastRatio(draft.colors.text, draft.colors.panel) < 4.5 ? "form-error" : "theme-contrast"}>Text/container contrast: {contrastRatio(draft.colors.text, draft.colors.panel).toFixed(1)}:1 · Secondary text: {contrastRatio(draft.colors.muted, draft.colors.panel).toFixed(1)}:1</p>
      <footer><button type="submit" className="primary-button"><Save size={15} /> Save theme</button><button type="button" className="secondary-button" onClick={() => { setDraft(null); applyTheme(); }}><X size={15} /> Cancel preview</button></footer>
    </form>}
    <details><summary>Import theme JSON</summary><label>Theme JSON<ClearableTextarea value={json} onChange={(event) => setJson(event.target.value)} placeholder="Paste exported theme JSON" /></label><button type="button" className="secondary-button" disabled={!json.trim()} onClick={() => { try { edit(validateCustomTheme(JSON.parse(json))); setJson(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Invalid theme JSON."); } }}><Upload size={15} /> Preview import</button></details>
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
