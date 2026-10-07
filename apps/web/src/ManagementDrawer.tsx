import { ChevronDown, Folder, HardDrive, Maximize2, Minimize2, Minus, Settings, Tag, Users, Wrench, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ManagementPanelContext } from "./management-panel";

export type ManagementTab = "tags" | "categories" | "people" | "sources" | "settings";
export const managementTabs = [
  { kind: "tags", label: "Tags", Icon: Tag },
  { kind: "categories", label: "Categories", Icon: Folder },
  { kind: "people", label: "Cast & artists", Icon: Users },
  { kind: "sources", label: "Sources", Icon: HardDrive },
  { kind: "settings", label: "Settings", Icon: Settings },
] as const;

export function ManagementDrawer({ open, minimized, expanded, active, visited, onOpen, onClose, onMinimize, onExpand, panels }: {
  open: boolean; minimized: boolean; expanded: boolean; active: ManagementTab; visited: ManagementTab[];
  onOpen: (tab: ManagementTab) => void; onClose: () => void; onMinimize: () => void; onExpand: () => void;
  panels: Record<ManagementTab, ReactNode>;
}) {
  const id = useId();
  const drawer = useRef<HTMLElement>(null);
  const [dockExpanded, setDockExpanded] = useState(false);
  const select = (tab: ManagementTab) => {
    setDockExpanded(false);
    onOpen(tab);
    // Focus stays in management when using its tab controls, never on a data refresh.
    requestAnimationFrame(() => document.getElementById(`${id}-tab-${tab}`)?.focus({ preventScroll: true }));
  };
  return createPortal(<>
    <nav className={`management-dock${dockExpanded ? "" : " is-collapsed"}`} aria-label="Open management tools" hidden={open && !minimized}>
      <button className="management-dock-toggle" type="button" aria-label={minimized && open ? "Restore management drawer" : dockExpanded ? "Collapse management menu" : "Expand management menu"} title={minimized && open ? "Restore management drawer" : dockExpanded ? "Collapse management menu" : "Management tools"} aria-expanded={dockExpanded} aria-controls={`${id}-menu`} onClick={() => {
        if (open && minimized) select(active);
        else setDockExpanded((value) => !value);
      }}>{dockExpanded ? <ChevronDown size={19} /> : <Wrench size={19} />}</button>
      <div className="management-dock-tools" id={`${id}-menu`} hidden={!dockExpanded}>
        {managementTabs.map(({ kind, label, Icon }) => <button key={kind} type="button" onClick={() => select(kind)} aria-label={`Manage ${label}`} title={`Manage ${label}`}><Icon size={17} /><span>{label}</span></button>)}
      </div>
    </nav>
    <section ref={drawer} className={`attribute-manager-dialog management-drawer${minimized ? " is-minimized" : ""}${expanded ? " is-expanded" : ""}`} hidden={!open || minimized} inert={!open || minimized} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`}>
      <header className="management-drawer-heading">
        <button className="management-drawer-title" id={`${id}-title`} type="button" onClick={() => select(active)} aria-label={minimized ? "Restore management drawer" : "Management drawer"}>Manage <span>· {managementTabs.find((tab) => tab.kind === active)?.label}</span></button>
        <div className="management-drawer-actions">
          <button className="icon-button" type="button" onClick={() => { setDockExpanded(false); onMinimize(); }} aria-label={minimized ? "Restore management drawer" : "Minimize management drawer"}>{minimized ? <Maximize2 size={16} /> : <Minus size={16} />}</button>
          {!minimized && <button className="icon-button" type="button" onClick={onExpand} aria-label={expanded ? "Reduce management drawer" : "Expand management drawer"}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>}
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close management drawer"><X size={18} /></button>
        </div>
      </header>
      <div className="attribute-manager-tabs management-drawer-tabs" role="tablist" aria-label="Management pages" hidden={minimized}>
        {managementTabs.map(({ kind, label, Icon }, index) => <button key={kind} id={`${id}-tab-${kind}`} type="button" role="tab" aria-controls={`${id}-panel-${kind}`} aria-selected={active === kind} tabIndex={active === kind ? 0 : -1} onClick={() => select(kind)} onKeyDown={(event) => {
          const next = event.key === "ArrowRight" ? (index + 1) % managementTabs.length : event.key === "ArrowLeft" ? (index + managementTabs.length - 1) % managementTabs.length : event.key === "Home" ? 0 : event.key === "End" ? managementTabs.length - 1 : null;
          if (next === null) return;
          event.preventDefault(); select(managementTabs[next].kind);
        }}><Icon size={17} />{label}</button>)}
      </div>
      {managementTabs.map(({ kind }) => <ManagementPanelContext.Provider key={kind} value={{ visible: open && !minimized && active === kind }}>
        <div className="management-drawer-panel" role="tabpanel" id={`${id}-panel-${kind}`} aria-labelledby={`${id}-tab-${kind}`} hidden={!open || minimized || active !== kind} inert={!open || minimized || active !== kind}>
          {visited.includes(kind) && panels[kind]}
        </div>
      </ManagementPanelContext.Provider>)}
    </section>
  </>, document.body);
}
