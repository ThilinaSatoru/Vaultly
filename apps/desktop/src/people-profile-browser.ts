import { BrowserWindow } from "electron";
import { peopleDirectories, type PeopleProfileBrowser, type ProfileCandidate } from "../../api/src/people-profile-scan.js";

// Only directory portraits and the main profile portrait are inspected.
export const directoryPortraitScript = `(() => [...document.querySelectorAll('[data-name]')].flatMap(card => {
  const link = card.querySelector('a[data-role="pornstar-link"]');
  const image = link?.querySelector('img');
  if (!link || !image) return [];
  return [{name:card.getAttribute('data-name'),aliases:[],profileUrl:link.href,imageUrl:image.currentSrc || image.src}];
}))()`;
export const mainPortraitScript = `(() => {
  const info = document.querySelector('[data-role="pornstar-info"]');
  const name = info?.querySelector('.landing-info__user-title')?.textContent?.trim();
  const portrait = info?.querySelector('.landing-info__logo-image');
  const background = portrait ? getComputedStyle(portrait).backgroundImage : '';
  const imageUrl = background.match(/^url\\(["']?(.*?)["']?\\)$/)?.[1];
  const aliases = [...(info?.querySelectorAll('.aliases[data-tooltip]') || [])].flatMap(e => (e.getAttribute('data-tooltip') || '').split(/[,;\\n]/).map(a=>a.trim()).filter(Boolean));
  return name && imageUrl ? [{name,aliases,profileUrl:location.href,imageUrl}] : [];
})()`;

export function validProfileCandidate(candidate: ProfileCandidate) {
  try {
    const profile = new URL(candidate.profileUrl), image = new URL(candidate.imageUrl);
    return profile.origin === "https://xhamster.com" && /^\/(?:shemale\/)?pornstars\/[^/]+$/.test(profile.pathname)
      && image.protocol === "https:" && (image.hostname === "xhcdn.com" || image.hostname.endsWith(".xhcdn.com")) && /\/avatar\d*\./.test(image.pathname);
  } catch { return false; }
}

export async function createPeopleProfileBrowser(): Promise<PeopleProfileBrowser> {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: "vaultly-profile-scraper" } });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // Do not load media or advertisement windows while inspecting profile metadata.
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.resourceType === "media" }));
  const seeds: ProfileCandidate[] = [];
  let initialized = false;
  const load = async (url: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!url.startsWith("https://xhamster.com/")) throw new Error("Unexpected profile destination.");
    let timer: ReturnType<typeof setTimeout>;
    const stopped = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { window.webContents.stop(); reject(new Error("Profile page timed out.")); }, 25_000);
    });
    const abort = () => window.webContents.stop();
    let responseCode = 200;
    const navigated = (_event: Electron.Event, _url: string, code: number) => { responseCode = code; };
    window.webContents.on("did-navigate", navigated);
    signal.addEventListener("abort", abort, { once: true });
    try {
      await Promise.race([window.loadURL(url), stopped]);
      signal.throwIfAborted();
      if (new URL(window.webContents.getURL()).origin !== "https://xhamster.com") throw new Error("The directory redirected to another site.");
      if (responseCode === 404) return false;
      if (responseCode >= 400) throw new Error(`The directory returned HTTP ${responseCode}. Try again later or set this person's image manually.`);
      return true;
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally { clearTimeout(timer!); signal.removeEventListener("abort", abort); window.webContents.removeListener("did-navigate", navigated); }
  };
  return {
    async findPerson(name, signal) {
      if (!initialized) {
        for (const directory of peopleDirectories) {
          await load(directory, signal);
          const cards = (await window.webContents.executeJavaScript(directoryPortraitScript)) as ProfileCandidate[];
          if (!cards.length) throw new Error("The directory did not expose profile cards. It may require browser verification; try again later.");
          seeds.push(...cards.filter(validProfileCandidate));
        }
        initialized = true;
      }
      const slug = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
      if (!slug) return [];
      const found = [...seeds];
      for (const directory of peopleDirectories) {
        if (!await load(`${directory}/${encodeURIComponent(slug)}`, signal)) continue;
        const candidates = (await window.webContents.executeJavaScript(mainPortraitScript)) as ProfileCandidate[];
        found.push(...candidates.filter(validProfileCandidate));
      }
      return found;
    },
    async close() { if (!window.isDestroyed()) window.destroy(); },
  };
}
