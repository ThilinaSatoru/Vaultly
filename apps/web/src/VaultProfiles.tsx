import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { api } from "./media";
import { getActiveProfile, type VaultProfile, type VaultProfiles as ProfileList } from "./vault-session";

export function VaultProfiles({ initial }: { initial: ProfileList }) {
  const [profiles, setProfiles] = useState(initial.profiles);
  const [creating, setCreating] = useState(false);
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
  return <div className="vault-profiles">
    <label htmlFor="active-vault">Active vault</label>
    <div className="vault-profile-controls"><select id="active-vault" value={getActiveProfile()?.id ?? initial.activeId} disabled={busy} onChange={(event) => void activate(event.target.value)}>
      {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
    </select><button type="button" className="icon-button" disabled={busy} aria-label="Create new profile" title="Create new profile" onClick={() => { setCreating((value) => !value); setError(""); }}><Plus size={17} /></button></div>
    {(creating || busy || error) && <div className="vault-profile-popover">
      {creating && <form onSubmit={(event) => void create(event)}><input autoFocus aria-label="New profile name" placeholder="Profile name" maxLength={80} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /><p>Starts with an empty vault and its own backups.</p><button className="primary-button" disabled={busy || !name.trim()} type="submit">Create vault</button></form>}
      {busy && <p role="status">Opening vault…</p>}
      {error && <p role="alert">{error}</p>}
    </div>}
  </div>;
}
