import { BookOpen, Clapperboard, FolderOpen, Heart, Image, Keyboard, Settings2, Sparkles } from "lucide-react";
import { ShortcutList } from "./ShortcutHelp";
import { playerNames, type PlayerKind } from "./shortcut-help";

export function HelpView({ onOpenSources, onOpenSettings }: { onOpenSources: () => void; onOpenSettings: () => void }) {
  return <section className="help-view">
    <div className="page-heading"><div><p className="eyebrow">A little guidance</p><h1>Help & shortcuts</h1><p>Get comfortable with your library, players, and readers.</p></div><span className="help-hero-icon"><Sparkles size={30} aria-hidden="true" /></span></div>
    <div className="help-start-grid">
      <article className="help-card"><span className="help-card-icon"><FolderOpen size={24} aria-hidden="true" /></span><h2>1. Add your media</h2><p>Open Sources, choose a folder and its media type, then scan. Keep the drive connected so Vaultly can open your files.</p><button type="button" className="secondary-button" onClick={onOpenSources}>Open Sources</button></article>
      <article className="help-card"><span className="help-card-icon"><Heart size={24} aria-hidden="true" /></span><h2>2. Make it yours</h2><p>Use tags and categories to find things quickly. Save favorites, group files into series and sets, or browse related collections in circles.</p><p className="help-card-note">A media card’s ⋯ menu has more actions.</p></article>
      <article className="help-card"><span className="help-card-icon"><Keyboard size={24} aria-hidden="true" /></span><h2>3. Play & read</h2><p>Open a media card to start. The keyboard button in each player shows only the shortcuts that work there, including your custom keys.</p><p className="help-card-note">Click the media area to give the player keyboard focus.</p></article>
    </div>
    <section className="help-shortcuts"><div className="home-section-heading"><div><p className="eyebrow">At your fingertips</p><h2>Player key bindings</h2></div><button className="secondary-button" type="button" onClick={onOpenSettings}><Settings2 size={16} /> Customize in Settings</button></div><p className="help-intro">Read-only guides with your current bindings. “Not assigned” means no key is set for that action.</p>
      <div className="help-shortcut-grid">{(["video", "pdf", "comic", "ebook"] as PlayerKind[]).map((kind) => {
        const Icon = kind === "video" ? Clapperboard : kind === "comic" ? Image : BookOpen;
        return <details className="help-card help-shortcut-card" key={kind}><summary><Icon size={22} aria-hidden="true" /><span>{playerNames[kind]}</span><span className="help-expand-mark" aria-hidden="true">+</span></summary><ShortcutList kind={kind} /><p className="help-card-note">{kind === "ebook" ? "E-books use the scroll and auto-scroll bindings from PDF reader settings." : kind === "comic" ? "Page and scrolling keys are shared with the PDF reader." : "Collection navigation works when another item is available."}</p></details>;
      })}</div>
    </section>
    <section className="help-faq"><h2>Good to know</h2>
      <details className="help-card"><summary>How do cover images work?<span className="help-expand-mark" aria-hidden="true">+</span></summary><p>Place a PNG, JPEG, WebP or AVIF beside a media file, or inside a comic folder, then scan the source. Matching names such as Movie-poster.png or Book_cover.jpg take priority; cover, poster, folder, front, fanart, banner and thumbnail also work. Season files can inherit a poster from a parent folder within the source. Choose a cover in the media details or add one to a collection. Cards follow the image’s portrait or landscape shape.</p></details>
      <details className="help-card"><summary>My source or media is unavailable<span className="help-expand-mark" aria-hidden="true">+</span></summary><p>Connect the drive and check the folder still exists. If it moved, use Sources → ⋯ → Relocate source. Scan again to pick up added or changed files.</p></details>
      <details className="help-card"><summary>A video or book won’t open<span className="help-expand-mark" aria-hidden="true">+</span></summary><p>Some formats need your associated desktop player or reader. Use “Open in default player” for a video or “Open in desktop reader” for a book or archive. These actions open your original file.</p></details>
      <details className="help-card"><summary>My shortcuts aren’t responding<span className="help-expand-mark" aria-hidden="true">+</span></summary><p>Close any help popover or menu, then click the media area. Typing in a search box or editing a field keeps keys in that control. For a floating video, focus the floating player first. Check your current bindings with its keyboard button.</p></details>
      <details className="help-card"><summary>Appearance, backups & moving computers<span className="help-expand-mark" aria-hidden="true">+</span></summary><p>Settings → Appearance has the Dark palette switch, accent colors, and reader page tone. Each vault keeps its own preferences. Use Settings → Backup and migration to export or restore a backup, then relocate source folders if their paths changed.</p></details>
    </section>
  </section>;
}
