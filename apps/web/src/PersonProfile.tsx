import { Users } from "lucide-react";
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatCount, type Person } from "./media";
import { vaultUrl } from "./vault-session";

export const PersonDirectoryContext = createContext<Person[]>([]);

export function PersonPhoto({ person }: { person: Person }) {
  const [failed, setFailed] = useState(false);
  const src = person.profile_image ? vaultUrl(`/api/people/${person.id}/image?v=${person.profile_image}`) : person.avatar_url;
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? <img src={src} alt={person.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <Users aria-label="No profile photo" size={40} />;
}

export function PersonBadge({ person, children, disabled, className, onClick }: { person: Person; children?: ReactNode; disabled?: boolean; className: string; onClick: () => void }) {
  const people = useContext(PersonDirectoryContext);
  const profile = people?.find((entry) => entry.id === person.id) ?? person;
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();
  const keepOpen = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  const closeSoon = () => { keepOpen(); closeTimer.current = setTimeout(() => setPosition(null), 120); };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const show = () => {
    keepOpen();
    if (disabled) return;
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds) return;
    setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - 288)), top: bounds.bottom + 8, above: window.innerHeight - bounds.bottom < 150 && bounds.top > 150 });
  };
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [position]);
  return <>
    <button ref={trigger} className={className} type="button" disabled={disabled} aria-label={`View profile for ${profile.name}`} aria-describedby={position ? tooltipId : undefined}
      onMouseEnter={show} onMouseLeave={closeSoon} onFocus={show} onBlur={closeSoon}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setPosition(null); } }}
      onClick={(event) => { event.stopPropagation(); setPosition(null); onClick(); }}>{children ?? profile.name}</button>
    {position && createPortal(<div id={tooltipId} role="tooltip" className="person-hover-card" onMouseEnter={keepOpen} onMouseLeave={closeSoon} style={{ left: position.left, top: position.above ? (trigger.current?.getBoundingClientRect().top ?? position.top) - 8 : position.top, transform: position.above ? "translateY(-100%)" : undefined }}>
      <div className="person-hover-photo"><PersonPhoto person={profile} /></div>
      <div><strong>{profile.name}</strong><p>{profile.gender || "Gender not specified"}</p><small>Click to view profile & media</small></div>
    </div>, document.body)}
  </>;
}

export function PersonProfileHeader({ person }: { person: Person }) {
  return <section className="person-detail-profile" aria-label={`${person.name} profile`}>
    <div className="person-detail-photo"><PersonPhoto person={person} /></div>
    <div><p className="eyebrow">Person profile</p><h1>{person.name}</h1>
      <dl className="person-detail-facts"><div><dt>Gender</dt><dd>{person.gender || "Not specified"}</dd></div><div><dt>Country</dt><dd>{person.country || person.country_code || "Not specified"}</dd></div></dl>
      <p className="person-detail-credits">{formatCount(person.cast_count ?? 0)} cast credits · {formatCount(person.artist_count ?? 0)} artist credits{person.set_count ? ` · ${formatCount(person.set_count)} set assignments` : ""}</p>
      {person.profile_url && <a href={person.profile_url} target="_blank" rel="noreferrer">Source profile</a>}
    </div>
  </section>;
}
