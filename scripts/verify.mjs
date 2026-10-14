#!/usr/bin/env node
// "Check before flagging": for every item the lenses tied to a project, look up the concrete names
// in it (settings keys, model ids, packages, env vars, slash commands) in that project's own files.
// Read-only and local: file contents never leave this process; <data>/evidence.jsonl keeps only the
// matched name and the relative file path. A name counts as found only in config or code; in docs,
// data, tests or comments it is only "mentioned" (lib/use.mjs, B-47). The "setup" project is looked
// up in ~/.claude (config files only, never transcripts). Settings an item names without a checkable
// word (hook types, permission rules, the sandbox, inline shell, modes) are answered by a profile made
// by code from each project's settings files, settings.local.json included, kept to a closed schema in
// <data>/profile.json (lib/profile.mjs, B-51). Regenerated in full on each run.
// Usage: node verify.mjs [--data <dir>]
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { dataDir, writeJsonl, writeJson } from "./lib/store.mjs";
import { loadConfig } from "./lib/config.mjs";
import { loadRows } from "./lib/rows.mjs";
import { extractTerms } from "./lib/probe.mjs";
import { safeBriefDir } from "./lib/paths.mjs";
import { collect as walk } from "./lib/walk.mjs";
import { useIndex, lookup } from "./lib/use.mjs";
import { releaseRuns, archiveFiles } from "./lib/archive.mjs";
import { buildProfile, profileTerms, profileLookup } from "./lib/profile.mjs";
import { cliProfile } from "./lib/cli.mjs";
import { readVersion, versionFor } from "./lib/version.mjs";
import { codeTies, cliTies, tripwireTies } from "./lib/ties.mjs";

const DATA = dataDir();
const config = loadConfig(DATA);
// Brief folders quote release text, so they would "confirm" every item.
const BRIEF_DIRS = new Set(config.projects.map((p) => resolve(config.workspaceRoot, p.briefDir).toLowerCase()));
const collect = (root, only) => walk(root, only, { blocked: config.blocked, briefDirs: BRIEF_DIRS });

// Returns {root, files} or null.
function projectFiles(p) {
  if (p.id === "setup" && !p.path) {
    // The user's own config only: not transcripts, caches, plugin copies, or the scripts and reference
    // docs bundled inside skills (those mention features without meaning the user relies on them).
    const home = join(homedir(), ".claude");
    let skillFiles = [];
    try { skillFiles = readdirSync(join(home, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `skills/${d.name}/SKILL.md`); } catch {}
    return { root: home, files: collect(home, ["settings.json", "CLAUDE.md", "keybindings.json", "rules", "agents", "commands", "lenses", "hooks", ...skillFiles]) };
  }
  if (!p.path) return null; // no folder configured: cannot check
  const root = safeBriefDir(config.workspaceRoot, p.path, config.blocked.filter((b) => b !== ".claude"), { write: false });
  return { root, files: collect(root) };
}

// A project that hits the file cap was only partly searched: it can confirm, never report "not found".
// models.json: the Claude models each project's config and code use (pinned ids and aliases, with file
// and line) and the ids only mentioned, for rating launches and model-scoped changes. archives: code
// and config files that store release text, read as mentions (B-62), logged here and in models.json.
const { items, rows } = loadRows(DATA, { evidence: false });
const runs = releaseRuns(items);
const indexes = new Map(), partial = new Set(), models = {}, profiles = {};
// The installed Claude Code version (B-52), local and free; none unless it parses.
const installed = readVersion();
console.log(installed.version ? `Claude Code ${installed.version} (${installed.how})` : `Claude Code version unknown (${installed.how})`);
for (const p of config.projects) {
  const found = projectFiles(p);
  const files = found?.files;
  const claudeRoot = p.id === "setup" && !p.path;
  if (found) {
    profiles[p.id] = buildProfile(found.root, files, { claudeRoot });
    const version = versionFor(profiles[p.id], installed);
    profiles[p.id].claudeCode = { version, how: version ? installed.how : installed.version ? "runs the CLI bundled with the Agent SDK" : installed.how };
  }
  const archives = files ? archiveFiles(files, runs, { claudeRoot }) : [];
  const ix = files && useIndex(files, { claudeRoot, archives: new Set(archives.map((a) => a.file)) });
  if (ix) indexes.set(p.id, ix);
  if (files?.capped) partial.add(p.id);
  if (ix) models[p.id] = { ...ix.models, claudeCalls: ix.claudeCalls, archives, partial: Boolean(files.capped) };
  // What the project's own scripted claude calls switch off (B-59); a capped walk may miss a call.
  if (ix) profiles[p.id].cli = files.capped ? { status: "unknown", calls: [], off: {} } : cliProfile(files, ix.claudeCalls, profiles[p.id]);
  const cli = profiles[p.id]?.cli;
  const off = cli?.status === "known" && Object.keys(cli.off).length ? `; scripted claude calls run with ${Object.keys(cli.off).join(", ")} off` : "";
  console.log(`${p.id}: ${files ? `${files.length} files indexed${partial.has(p.id) ? " (cap reached: only confirmations count)" : ""}${off}` : "no folder configured, not checked"}`);
  for (const a of archives) console.log(`  ${a.file}: quotes ${a.items} release items, read as mentions only`);
}

// Ties first (M3, P-25): code adds the projects whose own models the item is about (B-48) or that
// depend on the SDK it changes (B-58), drops lens ties the project's own manifests rule out, and moves
// a Claude Code item to setup from a project whose scripted claude calls switch its subject off
// (B-59; a tie the project's own code confirms stays). The lenses' "no effect" filter applies to the
// lenses' ties only. Each code-made tie, drop and hold gets an evidence row (tiedBy, dropped, held),
// so loadRows applies them without recomputing anything.
const out = [];
let confirmed = 0, mentioned = 0, notFound = 0, heldCount = 0;
const added = {}, droppedBy = {};
const blank = { checked: [], found: [], mentioned: [] };
for (const r of rows) {
  const change = codeTies(r, { models, profiles, partial });
  const ties = new Map(change.add.map((t) => [t.project, t]));
  const dropped = new Map(change.drop.map((d) => [d.project, d]));
  const current = { ...r, projects: [...r.projects.filter((p) => !dropped.has(p)), ...ties.keys()] };
  const terms = extractTerms(`${r.title || ""} ${r.text || ""}`);
  const conds = profileTerms(`${r.title || ""} ${r.text || ""}`);
  // The file check for one project, or null when there is nothing to check it with.
  const check = (proj) => {
    const ix = indexes.get(proj);
    if (!ix || (!terms.length && !conds.length)) return null;
    const { found: inFiles, mentioned: only } = lookup(terms, ix);
    // The profile reads settings files directly, so the file cap never hides its answer.
    const fromProfile = profileLookup(conds, profiles[proj]);
    return { checked: [...(inFiles.length || !partial.has(proj) ? terms : []), ...fromProfile.checked], found: [...inFiles, ...fromProfile.found], mentioned: only };
  };
  const first = cliTies(current, profiles);
  const lensChecked = r.effect === "none" && !r.riskExposed ? [] : current.projects.filter((p) => !ties.has(p));
  const results = new Map([...new Set([...lensChecked, ...ties.keys(), ...first.drop.map((d) => d.project), ...first.hold.map((d) => d.project), ...first.add.map((a) => a.project)])].map((p) => [p, check(p)]));
  const cli = cliTies(current, profiles, { confirmed: new Set([...results].filter(([, x]) => x?.found.length).map(([p]) => p)) });
  for (const a of cli.add) ties.set(a.project, a);
  const cliDrop = new Map(cli.drop.map((d) => [d.project, d])), held = new Map(cli.hold.map((d) => [d.project, d]));
  // A tripwire item still tied to nobody is checked against every project (B-66).
  const remaining = [...current.projects.filter((p) => !cliDrop.has(p)), ...cli.add.map((a) => a.project)];
  if (!remaining.length) {
    for (const p of indexes.keys()) if (!results.has(p)) results.set(p, check(p));
    for (const t of tripwireTies({ ...r, projects: remaining }, results, { dropped: new Set([...dropped.keys(), ...cliDrop.keys()]), profiles, partial })) ties.set(t.project, t);
  }
  for (const t of ties.values()) added[t.tiedBy] = (added[t.tiedBy] || 0) + 1;
  heldCount += held.size;
  for (const d of [...change.drop, ...cliDrop.values()]) droppedBy[d.reason] = (droppedBy[d.reason] || 0) + 1;
  for (const d of change.drop) out.push({ id: r.id, project: d.project, tiedBy: "lens", dropped: d.reason, why: d.why, ...blank });

  const tag = (proj) => (ties.has(proj) ? { tiedBy: ties.get(proj).tiedBy, ties: ties.get(proj).ids } : { tiedBy: "lens" });
  const kept = [];
  for (const proj of [...lensChecked, ...ties.keys(), ...cliDrop.keys()].filter((p, i, a) => a.indexOf(p) === i)) {
    const res = results.get(proj) ?? check(proj);
    const d = cliDrop.get(proj), h = held.get(proj);
    if (!res && !ties.has(proj) && !d && !h) continue;
    out.push({ id: r.id, project: proj, ...tag(proj), ...(d ? { dropped: d.reason, why: d.why } : {}), ...(h ? { held: h.why } : {}), ...(res || blank) });
    if (!d && res) kept.push([proj, res]);
  }
  if (!terms.length && !conds.length) continue;
  if (kept.some(([, x]) => x.found.length)) confirmed++;
  else if (kept.some(([, x]) => x.mentioned.length)) mentioned++;
  else if (kept.length) notFound++;
}
writeJsonl(join(DATA, "evidence.jsonl"), out);
writeJson(join(DATA, "models.json"), models);
writeJson(join(DATA, "profile.json"), profiles);
const drops = Object.values(droppedBy).reduce((a, b) => a + b, 0);
console.log(`ties: ${added.model || 0} added by model, ${added.sdk || 0} by SDK package, ${added.tripwire || 0} by tripwire term, ${added.setup || 0} moved to setup; ${drops} dropped${drops ? ` (${Object.entries(droppedBy).map(([k, n]) => `${n} ${k}`).join(", ")})` : ""}, kept for the "Not used here" list; ${heldCount} security, breaking or deprecation item(s) kept with a note`);
console.log(`evidence: ${confirmed} item(s) confirmed in your config or code, ${mentioned} only mentioned (docs, data, comments), ${notFound} checked and not found`);
