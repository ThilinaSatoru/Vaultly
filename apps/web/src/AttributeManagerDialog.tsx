import { Folder, Tag, Users } from "lucide-react";
import { useId } from "react";
import { AttributeEditorDialog } from "./AttributeEditorDialog";
import { CategoriesView } from "./CategoriesView";
import { TagsView } from "./TagsView";
import { PeopleView } from "./PeopleView";
import type { Category, Person, Tag as TagEntry } from "./media";
import type { AttributeManagerKind } from "./attribute-manager";

const tabs = [
  { kind: "tags", label: "Tags", Icon: Tag },
  { kind: "categories", label: "Categories", Icon: Folder },
  { kind: "people", label: "Cast & artists", Icon: Users },
] as const;

export function AttributeManagerDialog({ open, kind, onKindChange, onClose, tags, categories, people, onChanged }: {
  open: boolean;
  kind: AttributeManagerKind;
  onKindChange: (kind: AttributeManagerKind) => void;
  onClose: () => void;
  tags: TagEntry[];
  categories: Category[];
  people: Person[];
  onChanged: () => void;
}) {
  const id = useId();
  return <AttributeEditorDialog title="Manage attributes" open={open} onClose={onClose} className="attribute-manager-dialog" backdropClassName="attribute-manager-backdrop" focusSelector="[role='tabpanel']:not([hidden]) input:not(:disabled)">
    <p className="dialog-intro">Organize names and matching patterns, then return to your media.</p>
    <div className="attribute-manager-tabs" role="tablist" aria-label="Attribute managers">
      {tabs.map(({ kind: tabKind, label, Icon }, index) => <button key={tabKind} type="button" role="tab" id={`${id}-tab-${tabKind}`} aria-controls={`${id}-panel-${tabKind}`} aria-selected={kind === tabKind} tabIndex={kind === tabKind ? 0 : -1} onClick={() => onKindChange(tabKind)} onKeyDown={(event) => {
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        onKindChange(tabs[next].kind);
        document.getElementById(`${id}-tab-${tabs[next].kind}`)?.focus();
      }}><Icon size={17} />{label}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel-tags`} aria-labelledby={`${id}-tab-tags`} hidden={kind !== "tags"}>
      <TagsView tags={tags} onChanged={onChanged} />
    </div>
    <div role="tabpanel" id={`${id}-panel-categories`} aria-labelledby={`${id}-tab-categories`} hidden={kind !== "categories"}>
      <CategoriesView categories={categories} onChanged={onChanged} />
    </div>
    <div role="tabpanel" id={`${id}-panel-people`} aria-labelledby={`${id}-tab-people`} hidden={kind !== "people"}>
      <PeopleView people={people} onChanged={onChanged} />
    </div>
  </AttributeEditorDialog>;
}
