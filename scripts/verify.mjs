#!/usr/bin/env node
// "Check before flagging": for every item the lenses tied to a project, look up the concrete names
// in it (settings keys, model ids, packages, env vars, slash commands) in that project's own files.
// Read-only and local: file contents never leave this process; <data>/evidence.jsonl keeps only the
// matched name and the relative file path. The "setup" project is looked up in ~/.claude (config
// files only, never transcripts). Regenerated in full on each run.
// Usage: node verify.mjs [--data <dir>]
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep, resolve, basename } from "node:path";
import { homedir } from "node:os";
import { dataDir, writeJsonl } from "./lib/store.mjs";
import { loadConfig } from "./lib/config.mjs";
import { loadRows } from "./lib/rows.mjs";
import { extractTerms, tokenIndex, isSecretFile } from "./lib/probe.mjs";
import { safeBriefDir } from "./lib/paths.mjs";

const DATA = dataDir();
const config = loadConfig(DATA);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage", ".venv", "venv", "__pycache__", "target", ".turbo", ".vercel"]);
const TEXT = /\.(md|mdx|json|jsonc|js|mjs|cjs|ts|tsx|jsx|py|toml|ya?ml|txt|sh|ps1|sql|html|css)$/i;
// Limits per project: files read, size of one file, total bytes held, and folders visited.
const MAX_FILES = 4000, MAX_BYTES = 512 * 1024, MAX_TOTAL = 64 * 1024 * 1024, MAX_DIRS = 20000;
// Brief folders and brief files quote release text, so they would "confirm" every item.
const BRIEF_DIRS = new Set(config.projects.map((p) => resolve(config.workspaceRoot, p.briefDir).toLowerCase()));
const BRIEF_FILE = /^(whats-new|claude-watch)-.+-\d{4}-\d{2}-\d{2}(-\d+)?\.md$/;

// Returns the files read; files.capped is true when a limit stopped the search early.
function collect(root, only) {
  const files = [];
  let bytes = 0, dirs = 0;
  const full = () => files.length >= MAX_FILES || bytes >= MAX_TOTAL || dirs >= MAX_DIRS;
  const read = (p, file) => {
    try {
      const size = statSync(p).size;
      if (size > MAX_BYTES || bytes + size > MAX_TOTAL) return;
      files.push({ file, text: readFileSync(p, "utf8") });
      bytes += size;
    } catch {}
  };
  const usable = (name) => TEXT.test(name) && !isSecretFile(name) && !BRIEF_FILE.test(name);
  const walk = (dir) => {
    if (full() || ++dirs > MAX_DIRS) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || BRIEF_DIRS.has(resolve(p).toLowerCase())) continue;
        if (!config.blocked.some((b) => b.toLowerCase() === e.name.toLowerCase() && b !== ".claude")) walk(p);
      } else if (e.isFile() && usable(e.name)) read(p, relative(root, p).split(sep).join("/"));
      if (full()) return;
    }
  };
  for (const sub of only || [""]) {
    const p = join(root, sub);
    if (!existsSync(p)) continue;
    if (statSync(p).isFile()) { if (usable(basename(p))) read(p, sub); } else walk(p);
  }
  files.capped = full();
  return files;
}

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
const indexes = new Map(), partial = new Set();
for (const p of config.projects) {
  const files = projectFiles(p);
  if (files) indexes.set(p.id, tokenIndex(files));
  if (files?.capped) partial.add(p.id);
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
console.log(`evidence: ${confirmed} item(s) confirmed in your files, ${notFound} checked and not found`);
