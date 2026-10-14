// The file walk behind "check before flagging" (verify.mjs). Read-only and local. Tested in
// tests/walk.test.mjs.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep, resolve, basename } from "node:path";
import { isSecretFile } from "./probe.mjs";

export const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage", ".venv", "venv", "__pycache__", "target", ".turbo", ".vercel"]);
const TEXT = /\.(md|mdx|json|jsonc|js|mjs|cjs|ts|tsx|jsx|py|toml|ya?ml|txt|sh|ps1|sql|html|css)$/i;
// Limits per project: files read, size of one file, total bytes held, and folders visited.
export const LIMITS = { files: 4000, bytes: 512 * 1024, total: 64 * 1024 * 1024, dirs: 20000 };
// Folders that usually hold generated output or data rather than the project's own code and config.
const DEFER = /^(data|datasets?|outputs?|.+[-_]outputs?|logs?|fixtures|samples|tmp|temp|\.?cache|transcripts|generated|artifacts|snapshots|__snapshots__|results|reports|exports|dumps|backups?)$/i;
// Brief files quote release text, so they would "confirm" every item.
const BRIEF_FILE = /^(whats-new|claude-watch)-.+-\d{4}-\d{2}-\d{2}(-\d+)?\.md$/;

// Returns the files read; files.capped is true when a limit stopped the search early.
// opts: { blocked: folder names never entered, briefDirs: absolute folders skipped (lower case), limits }
export function collect(root, only, { blocked = [], briefDirs = new Set(), limits = LIMITS } = {}) {
  const files = [];
  let bytes = 0, dirs = 0;
  const full = () => files.length >= limits.files || bytes >= limits.total || dirs >= limits.dirs;
  const read = (p, file) => {
    try {
      const size = statSync(p).size;
      if (size > limits.bytes || bytes + size > limits.total) return;
      files.push({ file, text: readFileSync(p, "utf8") });
      bytes += size;
    } catch {}
  };
  const usable = (name) => TEXT.test(name) && !isSecretFile(name) && !BRIEF_FILE.test(name);
  const isBlocked = (name) => blocked.some((b) => b.toLowerCase() === name.toLowerCase() && b !== ".claude");
  // Each folder's files first, then its subfolders; output and data folders wait until everything
  // else has been read, so a large one cannot spend the cap before the source is reached (B-28).
  const later = [];
  const walk = (dir, nested = false) => {
    if (full() || ++dirs > limits.dirs) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    // A subfolder holding a .git file is a worktree or submodule: another checkout, maybe on another
    // branch, not the project's own files (B-49). The root may itself be a worktree.
    if (nested && entries.some((e) => e.name === ".git" && e.isFile())) return;
    for (const e of entries) {
      if (e.isFile() && usable(e.name)) read(join(dir, e.name), relative(root, join(dir, e.name)).split(sep).join("/"));
      if (full()) return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (!e.isDirectory() || SKIP_DIRS.has(e.name) || briefDirs.has(resolve(p).toLowerCase()) || isBlocked(e.name)) continue;
      // Claude Code's agent worktrees, skipped whole even when one has lost its .git file (B-49).
      if (e.name === "worktrees" && basename(dir) === ".claude") continue;
      if (DEFER.test(e.name)) later.push(p); else walk(p, true);
      if (full()) return;
    }
  };
  for (const sub of only || [""]) {
    const p = join(root, sub);
    if (!existsSync(p)) continue;
    if (statSync(p).isFile()) { if (usable(basename(p))) read(p, sub); } else walk(p);
  }
  while (later.length && !full()) walk(later.shift(), true);
  files.capped = full();
  return files;
}
