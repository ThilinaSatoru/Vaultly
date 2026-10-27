import { ClearableInput } from "./ClearableField";
import { Select } from "./Select";
import { ActionMenu } from "./ActionMenu";
import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "./media";
import { getActiveProfile, removeVaultPreferences, type VaultProfile, type VaultProfiles as ProfileList } from "./vault-session";

export function VaultProfiles({ initial }: { initial: ProfileList }) {
  const [profiles, setProfiles] = useState(initial.profiles);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activate = async (id: string) => {
    setBusy(true); setError("");
    try {
      await api(`/api/vault-profiles/${id}/activate`, { method: "POST" });
      window.history.replaceState(null, "");
      window.location.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not switch profiles.");
      setBusy(false);
    }
  };
  const create = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const profile = await api<VaultProfile>("/api/vault-profiles", { method: "POST", body: JSON.stringify({ name }) });
      setProfiles((current) => [...current, profile]);
      setName(""); setCreating(false);
      await activate(profile.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not create the profile.");
      setBusy(false);
    }
  };
  const active = profiles.find((profile) => profile.id === (getActiveProfile()?.id ?? initial.activeId))!;
  const remove = async () => {
    setBusy(true); setError("");
    try {
      const remaining = await api<ProfileList & { cleanupWarning?: string }>(`/api/vault-profiles/${active.id}`, { method: "DELETE" });
      removeVaultPreferences(active.id);
      if (remaining.cleanupWarning) window.alert(remaining.cleanupWarning);
      window.history.replaceState(null, "");
      window.location.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not delete the profile."); setBusy(false);
    }
  };
  return <div className="vault-profiles">
    <div className="vault-profile-controls"><Select id="active-vault" aria-label="Active vault" value={getActiveProfile()?.id ?? initial.activeId} disabled={busy} onChange={(event) => void activate(event.target.value)}>
      {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
    </Select><ActionMenu label="Vault actions" actions={[
      { label: "New vault…", icon: <Plus size={16} />, disabled: busy, onSelect: () => { setCreating(true); setDeleting(false); setError(""); } },
      { label: `Delete ${active.name}…`, icon: <Trash2 size={16} />, disabled: busy, danger: true, onSelect: () => { setDeleting(true); setCreating(false); setError(""); } },
    ]} /></div>
    {(creating || deleting || busy || error) && <div className="vault-profile-popover">
      {creating && <form onSubmit={(event) => void create(event)}><ClearableInput autoFocus aria-label="New profile name" placeholder="Profile name" maxLength={80} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /><p>Starts with an empty vault and its own backups.</p><button className="primary-button" disabled={busy || !name.trim()} type="submit">Create vault</button></form>}
      {deleting && <div><strong>Delete {active.name}?</strong><p>This permanently deletes its database, covers and cache. Your source media stays in place. Another vault opens after deletion.</p><div className="vault-delete-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setDeleting(false)}>Cancel</button><button type="button" className="danger-button" disabled={busy} onClick={() => void remove()}>Delete profile and data</button></div></div>}
      {busy && <p role="status">Updating vault…</p>}
      {error && <p role="alert">{error}</p>}
    </div>}
  </div>;
}
