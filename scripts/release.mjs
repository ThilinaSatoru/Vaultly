import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const manifests = ["package.json", "apps/api/package.json", "apps/web/package.json", "apps/desktop/package.json"];
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const read = (cwd, file) => readFileSync(path.join(cwd, file), "utf8");

export function parseVersion(version) {
  const match = semver.exec(version);
  if (!match) throw new Error(`Invalid version: ${version}. Use MAJOR.MINOR.PATCH or a prerelease such as 0.2.0-beta.1.`);
  const parts = match.slice(1, 4).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) throw new Error("Version numbers must be safe integers.");
  const pre = match[4]?.split(".") ?? [];
  if (pre.some((part) => /^\d+$/.test(part) && part.length > 1 && part[0] === "0")) throw new Error("Prerelease numbers cannot have leading zeros.");
  return { parts, pre };
}

export function compareVersions(left, right) {
  const a = parseVersion(left); const b = parseVersion(right);
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return Math.sign(a.parts[i] - b.parts[i]);
  if (!a.pre.length || !b.pre.length) return Number(!a.pre.length) - Number(!b.pre.length);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined) return -1;
    if (b.pre[i] === undefined) return 1;
    if (a.pre[i] === b.pre[i]) continue;
    const an = /^\d+$/.test(a.pre[i]); const bn = /^\d+$/.test(b.pre[i]);
    if (an && bn) return BigInt(a.pre[i]) < BigInt(b.pre[i]) ? -1 : 1;
    if (an !== bn) return an ? -1 : 1;
    return a.pre[i] < b.pre[i] ? -1 : 1;
  }
  return 0;
}

export function nextVersion(current, requested) {
  const { parts, pre } = parseVersion(current);
  const index = ["major", "minor", "patch"].indexOf(requested);
  if (index < 0) { parseVersion(requested); return requested; }
  if (!pre.length || parts.slice(index + 1).some((part) => part !== 0)) parts[index]++;
  for (let i = index + 1; i < 3; i++) parts[i] = 0;
  const version = parts.join("."); parseVersion(version); return version;
}

export function checkRelease(tag, cwd = process.cwd()) {
  if (!tag?.startsWith("v")) throw new Error("Release tags must start with v.");
  const version = tag.slice(1); parseVersion(version);
  for (const file of manifests) {
    if (JSON.parse(read(cwd, file)).version !== version) throw new Error(`${file} must have version ${version}.`);
  }
  releaseNotes(tag, cwd);
  return version;
}

export function releaseNotes(tag, cwd = process.cwd()) {
  const version = tag?.startsWith("v") ? tag.slice(1) : tag;
  parseVersion(version);
  const lines = read(cwd, "CHANGELOG.md").split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}] - `));
  if (start < 0) throw new Error(`CHANGELOG.md needs a dated entry for ${version}.`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  const notes = lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
  if (!notes || !/^[-*] .+/m.test(notes)) throw new Error(`Release ${version} needs meaningful change notes.`);
  return notes;
}

function commitNotes(cwd) {
  const previous = git(cwd, "tag", "--merged", "HEAD").split("\n").filter((tag) => tag.startsWith("v") && semver.test(tag.slice(1)))
    .sort((a, b) => compareVersions(b.slice(1), a.slice(1)))[0];
  const range = previous ? `${previous}..HEAD` : "HEAD";
  const groups = new Map([["Breaking changes", []], ["Added", []], ["Fixed", []], ["Changed", []], ["Documentation", []]]);
  const rows = git(cwd, "log", "--no-merges", "--format=%h%x1f%s", range).split("\n").filter(Boolean);
  for (const row of rows) {
    const [hash, subject] = row.split("\x1f");
    if (/^chore\(release\):/i.test(subject)) continue;
    const conventional = /^(\w+)(?:\([^)]*\))?(!)?:\s*(.+)$/.exec(subject);
    const type = conventional?.[1];
    const group = conventional?.[2] ? "Breaking changes" : type === "feat" ? "Added" : type === "fix" ? "Fixed" : type === "docs" ? "Documentation" : "Changed";
    const text = (conventional?.[3] ?? subject).replace(/([\\`*_\[\]<>])/g, "\\$1");
    groups.get(group).push(`- ${text} (${hash})`);
  }
  return [...groups].filter(([, entries]) => entries.length).map(([name, entries]) => `### ${name}\n\n${entries.join("\n")}`).join("\n\n");
}

export function prepareRelease(requested, { cwd = process.cwd(), date = new Date().toISOString().slice(0, 10), extraNotes = "" } = {}) {
  if (git(cwd, "status", "--porcelain")) throw new Error("Commit or stash local changes before preparing a release.");
  const current = JSON.parse(read(cwd, "package.json")).version;
  parseVersion(current);
  const version = nextVersion(current, requested);
  const tag = `v${version}`;
  const existing = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`], { cwd }).status === 0;
  if (existing) {
    if (spawnSync("git", ["merge-base", "--is-ancestor", tag, "HEAD"], { cwd }).status !== 0) throw new Error(`${tag} is not in the default branch's history.`);
    return { version, tag, existing: true };
  }
  for (const file of manifests) if (JSON.parse(read(cwd, file)).version !== current) throw new Error("Workspace package versions must be synchronized before releasing.");
  if (compareVersions(version, current) < 0) throw new Error(`Version ${version} must not be lower than ${current}.`);
  if (version === current) { checkRelease(tag, cwd); return { version, tag, existing: false }; }
  const changelog = read(cwd, "CHANGELOG.md");
  if (changelog.includes(`## [${version}]`)) throw new Error(`Changelog version ${version} already exists without a tag.`);
  const unreleased = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m;
  const match = unreleased.exec(changelog);
  if (!match) throw new Error("CHANGELOG.md needs an Unreleased section.");
  const sections = [extraNotes.trim(), match[1].trim(), commitNotes(cwd)].filter(Boolean);
  if (!sections.length) throw new Error("There are no changes to release.");
  const replacement = `## [Unreleased]\n\n## [${version}] - ${date}\n\n${sections.join("\n\n")}\n\n`;
  const updated = changelog.replace(unreleased, replacement);
  const packages = manifests.map((file) => ({ file, value: { ...JSON.parse(read(cwd, file)), version } }));
  for (const { file, value } of packages) writeFileSync(path.join(cwd, file), `${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(path.join(cwd, "CHANGELOG.md"), updated);
  checkRelease(tag, cwd);
  return { version, tag, existing: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command, value] = process.argv.slice(2);
    if (command === "prepare") {
      const result = prepareRelease(value ?? "patch", { extraNotes: process.env.RELEASE_NOTES ?? "" });
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, item]) => `${key}=${item}\n`).join(""));
      console.log(`Prepared ${result.tag}${result.existing ? " (retry existing tag)" : ""}.`);
    } else if (command === "check") console.log(`Validated ${checkRelease(value)}.`);
    else if (command === "notes") console.log(releaseNotes(value));
    else throw new Error("Usage: node scripts/release.mjs prepare <patch|minor|major|version> | check <tag> | notes <tag>");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
