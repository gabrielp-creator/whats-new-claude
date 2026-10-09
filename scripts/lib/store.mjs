// Where the plugin keeps each user's config, state and data, and small file helpers.
// The data folder comes from --data, else $CLAUDE_PLUGIN_DATA (set by Claude Code for plugins),
// else ~/.whats-new-claude. Nothing is ever written inside the plugin's own folder.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function dataDir(argv = process.argv) {
  const i = argv.indexOf("--data");
  const dir = (i !== -1 && argv[i + 1]) || process.env.CLAUDE_PLUGIN_DATA || join(homedir(), ".whats-new-claude");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Positional arguments, without --data/--max-calls and their values or other --flags.
const VALUE_FLAGS = new Set(["--data", "--max-calls"]);
export function positional(argv = process.argv) {
  const out = [];
  for (let i = 2; i < argv.length; i++) {
    if (VALUE_FLAGS.has(argv[i])) { i++; continue; }
    if (!argv[i].startsWith("--")) out.push(argv[i]);
  }
  return out;
}

export const readJsonl = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
export const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);

// Write via a temp file and rename, so a crash never leaves a half-written state file.
export function writeAtomic(p, text) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`; // per process: two hooks may write the same file at once
  writeFileSync(tmp, text);
  renameSync(tmp, p);
}
export const writeJson = (p, obj) => writeAtomic(p, JSON.stringify(obj, null, 2) + "\n");
export const writeJsonl = (p, rows) => writeAtomic(p, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
