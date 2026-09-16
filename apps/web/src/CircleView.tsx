import { ArrowDown, ArrowLeft, ArrowUp, Layers3, LoaderCircle, Orbit, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, type CircleDetail, type CircleSummary, type MediaType, type SeriesSummary } from "./media";

interface CircleViewProps {
  series: SeriesSummary[];
  createRequested: number;
  mediaType?: MediaType;
  onOpenSeries: (id: number) => void;
}

type CircleType = MediaType | "mixed";
const circleSections: Array<{ type: CircleType; title: string }> = [
  { type: "video", title: "Video circles" }, { type: "comic", title: "Comic circles" },
  { type: "story", title: "Story circles" }, { type: "mixed", title: "Mixed circles" },
];

function circleType(circle: CircleSummary): CircleType {
  if (!circle.item_count) return circle.preferred_type;
  const types = [circle.video_count > 0, circle.comic_count > 0, circle.story_count > 0].filter(Boolean).length;
  if (types > 1) return "mixed";
  return circle.video_count ? "video" : circle.comic_count ? "comic" : "story";
}

export function CircleView({ series, createRequested, mediaType, onOpenSeries }: CircleViewProps) {
  const [circles, setCircles] = useState<CircleSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CircleDetail | null>(null);
  const [search, setSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadCircles = useCallback(async () => {
    try { setCircles(await api<CircleSummary[]>("/api/circles")); setError(""); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not load circles."); }
    finally { setLoading(false); }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const result = await api<CircleDetail>(`/api/circles/${id}`);
      setDetail(result); setTitle(result.title); setDescription(result.description); setError("");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not open this circle."); }
  }, []);

  useEffect(() => { void loadCircles(); }, [loadCircles]);
  useEffect(() => { if (selectedId !== null) void loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);
  useEffect(() => { if (createRequested > 0) { setTitle(""); setDescription(""); setShowCreate(true); } }, [createRequested]);

  const create = async (event: FormEvent) => {
    event.preventDefault(); if (!title.trim()) return;
    setBusy(true); setError("");
    try {
      const created = await api<CircleDetail>("/api/circles", { method: "POST", body: JSON.stringify({ title: title.trim(), description: description.trim(), preferredType: mediaType ?? "mixed" }) });
      await loadCircles(); setShowCreate(false); setSelectedId(created.id);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not create this circle."); }
    finally { setBusy(false); }
  };

  const updateDetails = async (event: FormEvent) => {
    event.preventDefault(); if (!detail || !title.trim()) return;
    setBusy(true); setError("");
    try {
      await api(`/api/circles/${detail.id}`, { method: "PATCH", body: JSON.stringify({ title: title.trim(), description: description.trim() }) });
      await Promise.all([loadDetail(detail.id), loadCircles()]); setEditing(false);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not update this circle."); }
    finally { setBusy(false); }
  };

  const updateSeries = async (seriesIds: number[]) => {
    if (!detail) return;
    setBusy(true); setError("");
    try {
      await api(`/api/circles/${detail.id}/series`, { method: "PUT", body: JSON.stringify({ seriesIds }) });
      await Promise.all([loadDetail(detail.id), loadCircles()]); setMemberSearch("");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not update the circle order."); }
    finally { setBusy(false); }
  };

  const removeCircle = async () => {
    if (!detail || !window.confirm(`Remove circle “${detail.title}”? Its sets and media will remain.`)) return;
    setBusy(true); setError("");
    try { await api(`/api/circles/${detail.id}`, { method: "DELETE" }); setSelectedId(null); await loadCircles(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not remove this circle."); }
    finally { setBusy(false); }
  };

  const members = useMemo(() => detail?.series_ids.map((id) => series.find((entry) => entry.id === id)).filter((entry): entry is SeriesSummary => Boolean(entry)) ?? [], [detail, series]);
  const candidates = series.filter((entry) => !detail?.series_ids.includes(entry.id) && (entry.title.toLocaleLowerCase().includes(memberSearch.toLocaleLowerCase()) || entry.description.toLocaleLowerCase().includes(memberSearch.toLocaleLowerCase())));
  const visible = circles.filter((circle) =>
    (circle.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()) || circle.description.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    && (!mediaType || (circle.item_count === 0 ? circle.preferred_type === mediaType
      : mediaType === "video" ? circle.video_count > 0 : mediaType === "comic" ? circle.comic_count > 0 : circle.story_count > 0)));
  const renderCards = (entries: CircleSummary[]) => <div className="circle-grid">{entries.map((circle) => <button className="circle-card" type="button" key={circle.id} onClick={() => setSelectedId(circle.id)}><span><Orbit size={28} /></span><div><h2>{circle.title}</h2><p>{circle.description || "A story circle"}</p><small>{circle.set_count} {circle.set_count === 1 ? "set" : "sets"} · {circle.item_count} items</small></div></button>)}</div>;

  if (selectedId !== null) return <section className="circle-view">
    <button className="series-back" type="button" onClick={() => { setSelectedId(null); setEditing(false); setMemberSearch(""); }}><ArrowLeft size={17} /> All circles</button>
    {error && <p className="page-error" role="alert">{error}</p>}
    {!detail || detail.id !== selectedId ? <div className="loading-state"><LoaderCircle className="spin" size={25} /> Loading circle…</div> : <>
      <div className="circle-hero"><div className="circle-symbol"><Orbit size={44} /></div><div>
        <p className="eyebrow">Story circle · {detail.set_count} {detail.set_count === 1 ? "set" : "sets"}</p>
        {editing ? <form className="series-edit" onSubmit={updateDetails}><input aria-label="Circle title" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} required /><textarea aria-label="Circle description" value={description} maxLength={3000} onChange={(event) => setDescription(event.target.value)} placeholder="Description" /><div><button className="primary-button" type="submit" disabled={busy}>Save</button><button className="secondary-button" type="button" onClick={() => setEditing(false)}>Cancel</button></div></form> : <><h1>{detail.title}</h1><p>{detail.description || "An ordered story made from several sets or episodes."}</p></>}
        <div className="series-actions"><button className="secondary-button" type="button" onClick={() => setEditing(true)} disabled={busy}><Pencil size={15} /> Edit details</button><button className="secondary-button series-danger" type="button" onClick={() => void removeCircle()} disabled={busy}><Trash2 size={15} /> Delete circle</button></div>
      </div></div>
      <div className="series-content-heading"><div><h2>Sets in this story</h2><p>Arrange collections in episode or reading order.</p></div></div>
      <div className="series-members">
        {!members.length && <p className="series-empty-members">No sets added yet. Search below to add the first episode.</p>}
        {members.map((entry, index) => <div className="series-member" key={entry.id}><span className="series-member-number">{index + 1}</span><div className="series-member-art"><Layers3 size={22} /></div><button className="series-member-title" type="button" onClick={() => onOpenSeries(entry.id)}><strong>{entry.title}</strong><span>{entry.item_count} items</span></button><div className="series-member-controls"><button type="button" aria-label={`Move ${entry.title} earlier`} disabled={busy || index === 0} onClick={() => { const ids = [...detail.series_ids]; [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; void updateSeries(ids); }}><ArrowUp size={16} /></button><button type="button" aria-label={`Move ${entry.title} later`} disabled={busy || index === members.length - 1} onClick={() => { const ids = [...detail.series_ids]; [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]]; void updateSeries(ids); }}><ArrowDown size={16} /></button><button type="button" aria-label={`Remove ${entry.title} from circle`} disabled={busy} onClick={() => void updateSeries(detail.series_ids.filter((id) => id !== entry.id))}><X size={16} /></button></div></div>)}
      </div>
      <div className="series-add"><h2>Add a set or episode</h2><p>Search any existing set in your library and add it in story order.</p><div className="series-search"><Search size={17} /><input aria-label="Search any set to add" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Search all series and sets" /></div>{memberSearch.trim() && <div className="series-candidates">{candidates.map((entry) => <button key={entry.id} type="button" disabled={busy} onClick={() => void updateSeries([...detail.series_ids, entry.id])}><Plus size={16} /><span>{entry.title}</span><small>{entry.item_count} items</small></button>)}{!candidates.length && <p>No matching sets available.</p>}</div>}</div>
    </>}
  </section>;

  return <section className="circle-view">
    <div className="series-search circle-search"><Search size={17} /><input aria-label="Search circles" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search circles" /></div>
    {error && <p className="page-error" role="alert">{error}</p>}
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={25} /> Loading circles…</div> : visible.length ? (mediaType ? renderCards(visible) : <>{circleSections.map((section) => { const entries = visible.filter((circle) => circleType(circle) === section.type); return entries.length ? <section className="series-type-section" key={section.type}><h2>{section.title} <span>{entries.length}</span></h2>{renderCards(entries)}</section> : null; })}</>) : <div className="gallery-empty"><Orbit size={38} /><h2>{circles.length ? "No matching circles" : "No circles yet"}</h2><p>Create a circle to arrange several sets as episodes of one story.</p></div>}
    {showCreate && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setShowCreate(false)}><section className="dialog" role="dialog" aria-modal="true" aria-label="Create circle" onMouseDown={(event) => event.stopPropagation()}><button className="icon-button dialog-close" type="button" onClick={() => setShowCreate(false)} aria-label="Close"><X size={19} /></button><div className="dialog-icon"><Orbit size={24} /></div><h2>New circle</h2><p className="dialog-intro">Group ordered sets or comic episodes into one complete story.</p><form onSubmit={create}><label htmlFor="circle-title">Title</label><input id="circle-title" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} autoFocus required /><label htmlFor="circle-description">Description</label><textarea id="circle-description" value={description} maxLength={3000} onChange={(event) => setDescription(event.target.value)} placeholder="Optional" />{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setShowCreate(false)}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>Create circle</button></div></form></section></div>}
  </section>;
}
