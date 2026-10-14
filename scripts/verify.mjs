#!/usr/bin/env node
// "Check before flagging": for every item the lenses tied to a project, look up the concrete names
// in it (settings keys, model ids, packages, env vars, slash commands) in that project's own files.
// Read-only and local: file contents never leave this process; <data>/evidence.jsonl keeps only the
// matched name and the relative file path. A name counts as found only in config or code; in docs,
// data, tests or comments it is only "mentioned" (lib/use.mjs, B-47). The "setup" project is looked
// up in ~/.claude (config files only, never transcripts). Regenerated in full on each run.
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

const DATA = dataDir();
const config = loadConfig(DATA);
// Brief folders quote release text, so they would "confirm" every item.
const BRIEF_DIRS = new Set(config.projects.map((p) => resolve(config.workspaceRoot, p.briefDir).toLowerCase()));
const collect = (root, only) => walk(root, only, { blocked: config.blocked, briefDirs: BRIEF_DIRS });

function projectFiles(p) {
  if (p.id === "setup" && !p.path) {
    // The user's own config only: not transcripts, caches, plugin copies, or the scripts and reference
    // docs bundled inside skills (those mention features without meaning the user relies on them).
    const home = join(homedir(), ".claude");
    let skillFiles = [];
    try { skillFiles = readdirSync(join(home, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `skills/${d.name}/SKILL.md`); } catch {}
    return collect(home, ["settings.json", "CLAUDE.md", "keybindings.json", "rules", "agents", "commands", "lenses", "hooks", ...skillFiles]);
  }
  if (!p.path) return null; // no folder configured: cannot check
  return collect(safeBriefDir(config.workspaceRoot, p.path, config.blocked.filter((b) => b !== ".claude"), { write: false }));
}

// A project that hits the file cap was only partly searched: it can confirm, never report "not found".
// models.json: the Claude models each project's config and code use (pinned ids and aliases, with file
// and line) and the ids only mentioned, for rating launches and model-scoped changes. archives: code
// and config files that store release text, read as mentions (B-62), logged here and in models.json.
const { items, rows } = loadRows(DATA, { evidence: false });
const runs = releaseRuns(items);
const indexes = new Map(), partial = new Set(), models = {};
for (const p of config.projects) {
  const files = projectFiles(p);
  const claudeRoot = p.id === "setup" && !p.path;
  const archives = files ? archiveFiles(files, runs, { claudeRoot }) : [];
  const ix = files && useIndex(files, { claudeRoot, archives: new Set(archives.map((a) => a.file)) });
  if (ix) indexes.set(p.id, ix);
  if (files?.capped) partial.add(p.id);
  if (ix) models[p.id] = { ...ix.models, archives, partial: Boolean(files.capped) };
  console.log(`${p.id}: ${files ? `${files.length} files indexed${partial.has(p.id) ? " (cap reached: only confirmations count)" : ""}` : "no folder configured, not checked"}`);
  for (const a of archives) console.log(`  ${a.file}: quotes ${a.items} release items, read as mentions only`);
}

const out = [];
let confirmed = 0, mentioned = 0, notFound = 0;
for (const r of rows) {
  if (r.effect === "none" && !r.riskExposed) continue;
  const terms = extractTerms(`${r.title || ""} ${r.text || ""}`);
  if (!terms.length) continue;
  let any = false, named = false;
  for (const proj of r.projects) {
    const ix = indexes.get(proj);
    if (!ix) continue;
    const { found, mentioned: only } = lookup(terms, ix);
    if (found.length) any = true;
    if (only.length) named = true;
    out.push({ id: r.id, project: proj, checked: found.length || !partial.has(proj) ? terms : [], found, mentioned: only });
  }
  if (any) confirmed++; else if (named) mentioned++; else if (r.projects.some((p) => indexes.has(p))) notFound++;
}
writeJsonl(join(DATA, "evidence.jsonl"), out);
writeJson(join(DATA, "models.json"), models);
console.log(`evidence: ${confirmed} item(s) confirmed in your config or code, ${mentioned} only mentioned (docs, data, comments), ${notFound} checked and not found`);
