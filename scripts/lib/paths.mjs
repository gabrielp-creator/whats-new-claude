// Where a brief may be written: only inside the configured workspace root, never inside a blocked
// folder (.git, node_modules, .claude, dotfiles, plus the user's own list). The folder can come from
// the review page's database, which viewers can edit, so the check also follows links on disk and
// refuses spellings Windows maps to other folders (8.3 short names such as CLAUDE~1, trailing dots
// or spaces). Tested in tests/config.test.mjs.
import { resolve, relative, isAbsolute, sep, dirname } from "node:path";
import { realpathSync, existsSync } from "node:fs";

// Spellings Windows maps to other folders or devices: 8.3 short names (CLAUDE~1), trailing dots or
// spaces, NTFS streams (.claude::$INDEX_ALLOCATION), and reserved device names (CON, NUL, COM1...).
const ODD_SEGMENT = /~|[. ]$|[:$]|^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
// Brief folders only: never a dot-folder (other tools auto-load .cursor/rules, .clinerules,
// .windsurf/rules, .github/workflows...) or a folder Claude Code or other agents load as commands,
// agents, skills, hooks or rules.
const LOADED = /^\.|^(commands|agents|skills|hooks|rules)$/i;

function check(root, abs, blocked, dir, write) {
  const rel = relative(root, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`folder outside the workspace (${root}): ${dir}`);
  const lower = new Set(blocked.map((b) => b.toLowerCase()));
  const bad = rel.split(sep).find((seg) => lower.has(seg.toLowerCase()) || ODD_SEGMENT.test(seg) || (write && LOADED.test(seg)));
  if (bad) throw new Error(`folder not allowed (${bad}): ${dir}`);
}

// A folder chosen on the review page (whose database other viewers can edit) must stay inside the
// project's own folder, or inside its configured brief folder when it has none.
export function inProjectScope(root, project, abs) {
  const scope = resolve(root, project.path || project.briefDir);
  const rel = relative(scope, abs);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

// The real location of the deepest part of p that exists, with the rest appended.
function realish(p) {
  let head = p;
  const tail = [];
  while (!existsSync(head)) {
    const up = dirname(head);
    if (up === head) return p;
    tail.unshift(relative(up, head));
    head = up;
  }
  return resolve(realpathSync.native(head), ...tail);
}

// write: false for folders that are only read (verify.mjs searching a project's own folder), where
// dot-folders and the loaded-folder names are fine.
export function safeBriefDir(root, dir, blocked, { write = true } = {}) {
  if (typeof dir !== "string" || !dir.trim()) throw new Error("empty folder");
  const absRoot = resolve(root);
  const abs = isAbsolute(dir) ? resolve(dir) : resolve(absRoot, dir);
  check(absRoot, abs, blocked, dir, write);
  const realRoot = existsSync(absRoot) ? realpathSync.native(absRoot) : absRoot;
  check(realRoot, realish(abs), blocked, dir, write);
  return abs;
}

// Called again after the folder is created and before writing, in case it resolved somewhere else.
export function recheckCreated(root, abs, blocked) {
  const realRoot = realpathSync.native(resolve(root));
  check(realRoot, realpathSync.native(abs), blocked, abs, true);
}
