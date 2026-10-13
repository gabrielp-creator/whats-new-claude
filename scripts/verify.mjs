#!/usr/bin/env node
// "Check before flagging": for every item the lenses tied to a project, look up the concrete names
// in it (settings keys, model ids, packages, env vars, slash commands) in that project's own files.
// Read-only and local: file contents never leave this process; <data>/evidence.jsonl keeps only the
// matched name and the relative file path. The "setup" project is looked up in ~/.claude (config
// files only, never transcripts). Regenerated in full on each run.
// Usage: node verify.mjs [--data <dir>]
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { dataDir, writeJsonl, writeJson } from "./lib/store.mjs";
import { loadConfig } from "./lib/config.mjs";
import { loadRows } from "./lib/rows.mjs";
import { extractTerms, tokenIndex } from "./lib/probe.mjs";
import { safeBriefDir } from "./lib/paths.mjs";
import { collect as walk } from "./lib/walk.mjs";
import { inventory } from "./lib/models.mjs";

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
    return collect(home, ["settings.json", "CLAUDE.md", "keybindings.json", "rules", "agents", "commands", "hooks", ...skillFiles]);
  }
  if (!p.path) return null; // no folder configured: cannot check
  return collect(safeBriefDir(config.workspaceRoot, p.path, config.blocked.filter((b) => b !== ".claude"), { write: false }));
}

// A project that hits the file cap was only partly searched: it can confirm, never report "not found".
// models.json: the Claude model ids each project's files use, for rating launches and model-scoped changes.
const indexes = new Map(), partial = new Set(), models = {};
for (const p of config.projects) {
  const files = projectFiles(p);
  if (files) indexes.set(p.id, tokenIndex(files));
  if (files?.capped) partial.add(p.id);
  if (files) models[p.id] = { models: inventory(files), partial: Boolean(files.capped) };
  console.log(`${p.id}: ${files ? `${files.length} files indexed${partial.has(p.id) ? " (cap reached: only confirmations count)" : ""}` : "no folder configured, not checked"}`);
}

const out = [];
let confirmed = 0, notFound = 0;
for (const r of loadRows(DATA, { evidence: false }).rows) {
  if (r.effect === "none" && !r.riskExposed) continue;
  const terms = extractTerms(`${r.title || ""} ${r.text || ""}`);
  if (!terms.length) continue;
  let any = false;
  for (const proj of r.projects) {
    const idx = indexes.get(proj);
    if (!idx) continue;
    const found = terms.filter((t) => idx.has(t)).map((t) => ({ term: t, file: idx.get(t) }));
    if (found.length) any = true;
    out.push({ id: r.id, project: proj, checked: found.length || !partial.has(proj) ? terms : [], found });
  }
  if (any) confirmed++; else if (r.projects.some((p) => indexes.has(p))) notFound++;
}
writeJsonl(join(DATA, "evidence.jsonl"), out);
writeJson(join(DATA, "models.json"), models);
console.log(`evidence: ${confirmed} item(s) confirmed in your files, ${notFound} checked and not found`);
