import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { manifests, parseVersion, compareVersions, nextVersion, suggestVersions, prepareRelease, checkRelease, releaseNotes } from "./release.mjs";

function fixture(t) {
  const prefix = path.join(tmpdir(), "vaultly-release-");
  const cwd = mkdtempSync(prefix);
  t.after(() => { if (!path.resolve(cwd).startsWith(path.resolve(prefix))) throw new Error("Invalid fixture path"); rmSync(cwd, { recursive: true, force: true }); });
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main"); git("config", "user.name", "Release test"); git("config", "user.email", "test@example.invalid");
  for (const file of manifests) {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), JSON.stringify({ name: file, version: "0.1.0" }));
  }
  writeFileSync(path.join(cwd, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Curated search notes.\n\n## [0.1.0] - 2026-10-11\n\n### Added\n\n- Initial library.\n");
  git("add", "."); git("commit", "-m", "chore: initial library");
  return { cwd, git, read: (file) => readFileSync(path.join(cwd, file), "utf8") };
}

test("SemVer ordering, prerelease validation and release increments", () => {
  const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0"];
  for (let i = 1; i < ordered.length; i++) assert.ok(compareVersions(ordered[i - 1], ordered[i]) < 0);
  for (const invalid of ["v1.0.0", "01.0.0", "1.0", "1.0.0-beta.01", "1.0.0-", "../../file", "1.0.0;echo bad"]) assert.throws(() => parseVersion(invalid));
  assert.equal(nextVersion("0.1.0", "patch"), "0.1.1");
  assert.equal(nextVersion("0.1.0", "minor"), "0.2.1");
  assert.equal(nextVersion("0.1.0", "major"), "1.0.1");
  assert.equal(nextVersion("0.2.0-beta.1", "patch"), "0.2.0");
  assert.equal(nextVersion("0.1.0", "0.2.0-beta.1"), "0.2.0-beta.1");
});

test("every bump increments the build number and suggestions list the results", () => {
  assert.equal(nextVersion("0.5.7", "patch"), "0.5.8");
  assert.equal(nextVersion("0.5.7", "minor"), "0.6.8");
  assert.equal(nextVersion("0.5.7", "major"), "1.0.8");
  assert.equal(nextVersion("0.6.8-beta.1", "minor"), "0.7.9");
  assert.deepEqual(suggestVersions("0.5.7"), { current: "0.5.7", build: 7, patch: "0.5.8", minor: "0.6.8", major: "1.0.8" });
});

test("release preparation synchronizes every package and preserves reviewed notes and history", (t) => {
  const f = fixture(t); f.git("tag", "v0.1.0");
  f.git("commit", "--allow-empty", "-m", "feat(search): add synonyms");
  f.git("commit", "--allow-empty", "-m", "fix: repair file rename");
  const result = prepareRelease("minor", { cwd: f.cwd, date: "2026-10-11", extraNotes: "### Highlights\n\n- Faster searching." });
  assert.deepEqual(result, { version: "0.2.1", tag: "v0.2.1", existing: false });
  for (const file of manifests) assert.equal(JSON.parse(f.read(file)).version, "0.2.1");
  assert.equal(checkRelease(result.tag, f.cwd), "0.2.1");
  const notes = releaseNotes(result.tag, f.cwd);
  assert.match(notes, /Curated search notes/); assert.match(notes, /Faster searching/);
  assert.match(notes, /add synonyms/); assert.match(notes, /### Fixed/);
  assert.doesNotMatch(notes, /initial library/);
  assert.equal(releaseNotes("v0.1.0", f.cwd), "### Added\n\n- Initial library.");
  assert.match(f.read("CHANGELOG.md"), /## \[Unreleased\]\n\n## \[0.2.1\]/);
});

test("release preparation refuses dirty trees, downgrade and version drift", (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.cwd, "untracked.txt"), "local work");
  assert.throws(() => prepareRelease("minor", { cwd: f.cwd }), /Commit or stash/);
  f.git("add", "."); f.git("commit", "-m", "docs: local work");
  assert.throws(() => prepareRelease("0.0.9", { cwd: f.cwd }), /must not be lower/);
  writeFileSync(path.join(f.cwd, manifests[1]), JSON.stringify({ version: "0.2.0" }));
  f.git("add", "."); f.git("commit", "-m", "chore: divergent version");
  assert.throws(() => prepareRelease("minor", { cwd: f.cwd }), /synchronized/);
});

test("retrying an existing tag preserves original source and does not bump again", (t) => {
  const f = fixture(t); f.git("tag", "v0.1.0");
  prepareRelease("minor", { cwd: f.cwd });
  f.git("add", "."); f.git("commit", "-m", "chore(release): v0.2.1"); f.git("tag", "v0.2.1");
  assert.deepEqual(prepareRelease("0.1.0", { cwd: f.cwd }), { version: "0.1.0", tag: "v0.1.0", existing: true });
  assert.equal(JSON.parse(f.read("package.json")).version, "0.2.1");
  assert.equal(f.git("status", "--porcelain"), "");
});

test("tag validation rejects wrong package versions, malformed tags and missing notes", (t) => {
  const f = fixture(t);
  assert.throws(() => checkRelease("0.1.0", f.cwd), /start with v/);
  assert.throws(() => checkRelease("v0.2.0", f.cwd), /must have version/);
  writeFileSync(path.join(f.cwd, "CHANGELOG.md"), "# Changelog\n\n## [0.1.0] - 2026-10-11\n");
  assert.throws(() => checkRelease("v0.1.0", f.cwd), /meaningful change notes/);
});
