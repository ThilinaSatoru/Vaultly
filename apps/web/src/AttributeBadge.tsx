import { BookOpen, Clapperboard, Grid2X2, Image, X } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { MediaType } from "./media";
import { NavigationContext } from "./navigation";
import { attributeGalleryFields, mediaLabels, type AttributeMediaType, type BrowseAttribute } from "./attribute-navigation";

export const AttributeMediaContext = createContext<MediaType | undefined>(undefined);
export const AttributeBrowseContext = createContext<((attribute: BrowseAttribute, mediaType?: MediaType) => void) | null>(null);

export function AttributeBadge({ kind, id, name, mediaType, children, disabled = false, onBrowse }: BrowseAttribute & { mediaType?: MediaType; children?: ReactNode; disabled?: boolean; onBrowse?: () => void }) {
  const browse = useContext(AttributeBrowseContext);
  const scope = useContext(AttributeMediaContext);
  return <button className={`tag-badge attribute-badge attribute-badge-${kind}`} type="button" disabled={disabled}
    title={`Browse ${name}`} aria-label={`Browse ${kind === "artist" ? "artist" : kind} ${name}`}
    onClick={(event) => { event.stopPropagation(); onBrowse?.(); browse?.({ kind, id, name }, mediaType ?? scope); }}>
    {children ?? name}
  </button>;
}

function MediaChoiceDialog({ attribute, onChoose, onClose }: { attribute: BrowseAttribute; onChoose: (type: AttributeMediaType) => void; onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>(".attribute-media-choice")?.focus();
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="dialog-backdrop attribute-media-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="attribute-media-title" aria-describedby="attribute-media-description" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="Cancel media selection"><X size={20} /></button>
      <h2 id="attribute-media-title">Which media?</h2>
      <p className="dialog-intro" id="attribute-media-description">Choose a gallery to browse “{attribute.name}”.</p>
      <div className="attribute-media-choices">
        {([["video", Clapperboard], ["comic", Image], ["story", BookOpen], ["all", Grid2X2]] as const).map(([type, Icon]) =>
          <button className="secondary-button attribute-media-choice" type="button" key={type} onClick={() => onChoose(type)}><Icon size={20} />{mediaLabels[type]}</button>)}
      </div>
    </section>
  </div>;
}

export function AttributeBrowseProvider({ children, onNavigate }: { children: ReactNode; onNavigate?: () => void }) {
  const navigation = useContext(NavigationContext)!;
  const [pending, setPending] = useState<BrowseAttribute | null>(null);
  useEffect(() => { setPending(null); }, [navigation.entry.id]);
  const open = (attribute: BrowseAttribute, mediaType: AttributeMediaType) => {
    setPending(null);
    navigation.push(attributeGalleryFields(attribute, mediaType), `${mediaLabels[mediaType]} · ${attribute.name}`);
  };
  const browse = (attribute: BrowseAttribute, mediaType?: MediaType) => {
    // Close the manager before opening the media chooser so modal focus and
    // body-scroll cleanup finish before the next dialog takes ownership.
    onNavigate?.();
    const section = navigation.current.current.fields.section;
    const type = mediaType ?? (section === "video" || section === "comic" || section === "story" ? section : undefined);
    if (type) open(attribute, type);
    else setPending(attribute);
  };
  return <AttributeBrowseContext.Provider value={browse}>
    {children}
    {pending && <MediaChoiceDialog attribute={pending} onChoose={(type) => open(pending, type)} onClose={() => setPending(null)} />}
  </AttributeBrowseContext.Provider>;
}
