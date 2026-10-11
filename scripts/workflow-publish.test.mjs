import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const marker = "          script: |\n";
const script = workflow.slice(workflow.lastIndexOf(marker) + marker.length).replace(/^ {12}/gm, "");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const publish = new AsyncFunction("github", "context", "core", "require", script);
const require = createRequire(import.meta.url);

function fixture(t, { version = "0.2.0", existing, failUpload = false } = {}) {
  const prefix = path.join(tmpdir(), "vaultly-publish-");
  const cwd = mkdtempSync(prefix); const originalCwd = process.cwd();
  const keys = ["RELEASE_TAG", "RELEASE_VERSION", "RELEASE_SHA"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { RELEASE_TAG: `v${version}`, RELEASE_VERSION: version, RELEASE_SHA: "test-commit" });
  process.chdir(cwd);
  t.after(() => {
    process.chdir(originalCwd);
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    if (!path.resolve(cwd).startsWith(path.resolve(prefix))) throw new Error("Invalid fixture path");
    rmSync(cwd, { recursive: true, force: true });
  });
  mkdirSync("release-assets"); writeFileSync("release-notes.md", "### Added\n\n- Embedded search.\n");
  const files = [`Vaultly-${version}-win-x64.exe`, `Vaultly-${version}-mac-x64.dmg`, `Vaultly-${version}-mac-arm64.dmg`, `Vaultly-${version}-linux-x86_64.AppImage`, `Vaultly-${version}-linux-amd64.deb`];
  for (const name of files) writeFileSync(path.join("release-assets", name), "installer fixture");
  const calls = [];
  const repos = {
    getReleaseByTag: async (args) => { calls.push(["get", args]); if (existing) return { data: existing }; throw Object.assign(new Error("missing"), { status: 404 }); },
    createRelease: async (args) => { calls.push(["create", args]); return { data: { id: 1, assets: [] } }; },
    deleteReleaseAsset: async (args) => { calls.push(["delete", args]); },
    uploadReleaseAsset: async (args) => { calls.push(["upload", args]); if (failUpload) throw new Error("upload failed"); },
    updateRelease: async (args) => { calls.push(["update", args]); },
  };
  return { files, calls, run: () => publish({ rest: { repos } }, { repo: { owner: "owner", repo: "Vaultly" } }, { notice: () => {} }, require) };
}

test("manual workflow has no push or PR triggers and guards the default branch", () => {
  const triggers = workflow.slice(workflow.indexOf("on:\n"), workflow.indexOf("permissions:\n"));
  assert.match(triggers, /workflow_dispatch:/);
  assert.doesNotMatch(triggers, /\b(push|pull_request|release):/);
  assert.match(workflow, /test "\$GITHUB_REF_NAME" = "\$DEFAULT_BRANCH"/);
  assert.match(workflow, /git push --atomic/);
  assert.match(workflow, /npm_config_user_agent: pnpm/);
  assert.match(workflow, /node node_modules\/electron-builder\/cli\.js .*--publish never/);
  assert.match(workflow, /github-token: \$\{\{ secrets\.GH_TOKEN \}\}/);
});

test("publisher creates a draft, verifies all installers, uploads checksums, then publishes", async (t) => {
  const f = fixture(t); await f.run();
  const create = f.calls.find(([kind]) => kind === "create")[1];
  assert.equal(create.draft, true); assert.equal(create.prerelease, false);
  assert.match(create.body, /Embedded search/);
  const uploads = f.calls.filter(([kind]) => kind === "upload");
  assert.equal(uploads.length, 6);
  assert.equal(uploads.at(-1)[1].name, "SHA256SUMS.txt");
  const checksums = readFileSync("release-assets/SHA256SUMS.txt", "utf8");
  for (const file of f.files) assert.ok(checksums.includes(`  ${file}\n`));
  assert.match(checksums, /^[a-f0-9]{64}  Vaultly-/);
  assert.equal(f.calls.at(-1)[0], "update");
  assert.equal(f.calls.at(-1)[1].draft, false);
});

test("publisher refuses incomplete installers before touching GitHub", async (t) => {
  const f = fixture(t); rmSync(path.join("release-assets", f.files[0]));
  await assert.rejects(f.run(), /Incomplete release installers/); assert.equal(f.calls.length, 0);
});

test("publisher never overwrites a published release", async (t) => {
  const f = fixture(t, { existing: { id: 1, draft: false, assets: [] } });
  await assert.rejects(f.run(), /already published/);
  assert.deepEqual(f.calls.map(([kind]) => kind), ["get"]);
});

test("upload failures leave the release in draft for retry", async (t) => {
  const f = fixture(t, { failUpload: true });
  await assert.rejects(f.run(), /upload failed/);
  assert.equal(f.calls.find(([kind]) => kind === "create")[1].draft, true);
  assert.equal(f.calls.filter(([kind]) => kind === "update").length, 0);
});

test("prerelease retries replace draft assets and never become latest stable", async (t) => {
  const version = "0.2.0-beta.1";
  const f = fixture(t, { version, existing: { id: 1, draft: true, assets: [{ id: 7, name: `Vaultly-${version}-win-x64.exe` }] } });
  await f.run();
  assert.equal(f.calls.filter(([kind]) => kind === "create").length, 0);
  assert.equal(f.calls.find(([kind]) => kind === "delete")[1].asset_id, 7);
  const update = f.calls.at(-1)[1];
  assert.equal(update.prerelease, true); assert.equal(update.make_latest, "false");
});
