import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./polish.css";
import { setActiveProfile, type VaultProfiles } from "./vault-session";
import { applyTheme } from "./theme";

const root = createRoot(document.getElementById("root")!);
async function start() {
  root.render(<div className="boot-loading" role="status" aria-live="polite"><div className="boot-spinner" aria-hidden="true" /><h1>Vaultly</h1><p>Opening your library…</p></div>);
  try {
    const response = await fetch("/api/vault-profiles");
    if (!response.ok) throw new Error("Could not load vault profiles.");
    const profiles = await response.json() as VaultProfiles;
    setActiveProfile(profiles.profiles.find((profile) => profile.id === profiles.activeId)!);
    applyTheme();
    root.render(<StrictMode><App profiles={profiles} /></StrictMode>);
  } catch (error) {
    root.render(<div className="empty-state"><h1>Could not open your vault</h1><p role="alert">{error instanceof Error ? error.message : "Please try again."}</p><button className="primary-button" onClick={() => void start()}>Try again</button></div>);
  }
}
void start();
