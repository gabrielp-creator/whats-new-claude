// Where the claude CLI is, for the lens calls (claude.mjs) and the version check (version.mjs). No
// side effects on import: the call budget lives in claude.mjs only.
import { execFileSync } from "node:child_process";
import { PLUGIN_ROOT } from "./store.mjs";

// Windows looks in the current folder before PATH, so `where` and the calls run from the plugin's own
// folder: a claude.cmd planted in the user's project can never be picked up.
export const CWD = PLUGIN_ROOT;

// Windows: a native install is claude.exe (spawnable directly); an npm install puts an extensionless
// shim, claude.cmd and claude.ps1 side by side, and `where` lists the shim first, so the first line
// with a runnable extension is used. A .cmd only runs through the shell.
export function pickClaude(whereOutput) {
  const hit = String(whereOutput || "").split(/\r?\n/).map((l) => l.trim()).find((l) => /\.(exe|cmd|bat)$/i.test(l));
  if (!hit) return { cmd: "claude", shell: false };
  return /\.exe$/i.test(hit) ? { cmd: hit, shell: false } : { cmd: `"${hit}"`, shell: true };
}

// cmd.exe expands %VAR% even inside double quotes, and a stray quote ends one: such arguments are
// refused on the shell path rather than escaped.
export const shellSafe = (args) => args.every((a) => !/[%"]/.test(String(a).replace(/^"(.*)"$/s, "$1")));

let resolved;
export function resolveClaude() {
  if (resolved) return resolved;
  if (process.platform !== "win32") return (resolved = { cmd: "claude", shell: false });
  let out = "";
  try { out = execFileSync("where", ["claude"], { encoding: "utf8", cwd: CWD }); } catch {}
  return (resolved = pickClaude(out));
}
