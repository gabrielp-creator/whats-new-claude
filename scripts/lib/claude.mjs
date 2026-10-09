// Runs `claude -p` with NO tools, no MCP and safe mode: the lenses only read the text they are given
// and return JSON. Arguments are passed as an array (no shell string building) wherever possible.
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { PLUGIN_ROOT } from "./store.mjs";

// Windows looks in the current folder before PATH, so `where` and the calls run from the plugin's own
// folder: a claude.cmd planted in the user's project can never be picked up.
const CWD = PLUGIN_ROOT;

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
function resolveClaude() {
  if (resolved) return resolved;
  if (process.platform !== "win32") return (resolved = { cmd: "claude", shell: false });
  let out = "";
  try { out = execFileSync("where", ["claude"], { encoding: "utf8", cwd: CWD }); } catch {}
  return (resolved = pickClaude(out));
}

export function lensArgs(model, promptFile, shell) {
  const q = (s) => (shell ? `"${s}"` : s);
  // --tools "" disables built-in tools; --disallowedTools "*" is a second lock ("*" removes every tool,
  // code.claude.com/docs/en/cli-reference); --safe-mode loads no plugins, hooks or MCP servers.
  return ["-p", "--model", model, "--tools", shell ? '""' : "", "--disallowedTools", q("*"), "--strict-mcp-config", "--safe-mode",
    "--no-session-persistence", "--output-format", "json", "--system-prompt-file", q(promptFile)];
}

// Error text can carry model output; it ends up in the user's session, so keep it short and plain.
const clean = (s, n = 160) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

// `--output-format json` wraps the answer with its usage, so each run can say what it really cost.
export function parseResult(raw) {
  let r;
  try { r = JSON.parse(raw); } catch { throw new Error(`unreadable claude output (${String(raw).length} characters)`); }
  if (!r || typeof r !== "object") throw new Error("unreadable claude output");
  if (r.is_error) throw new Error(`claude error: ${clean(r.result || r.subtype || "unknown")}`);
  const u = r.usage || {};
  return { text: String(r.result ?? ""), usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, costUsd: r.total_cost_usd ?? null, ms: r.duration_ms ?? null } };
}

// A hard cap on real calls, so retries and splits can never spend past what was approved: the user's
// go-ahead for /whats-new (--max-calls) or the background budget (WNC_MAX_CALLS, from update.mjs).
// No cap given, or an unreadable one, allows nothing.
export function callBudget(raw) {
  const limit = /^\d+$/.test(String(raw ?? "")) ? Number(raw) : 0;
  let n = 0;
  return { take: () => (n < limit ? (n++, true) : false), used: () => n, limit };
}
export function capFrom(argv = process.argv, env = process.env) {
  const i = argv.indexOf("--max-calls");
  return i !== -1 ? argv[i + 1] : env.WNC_MAX_CALLS;
}
const budget = callBudget(capFrom());
// Report the calls actually made: update.mjs carries the rest of the budget on, /whats-new says it.
process.on("exit", () => process.stderr.write(`\nWNC_CALLS_USED=${budget.used()}\n`));
export const callsUsed = () => budget.used();
export const callLimit = () => budget.limit;

// Resolves with the answer text. usageLog: a .jsonl file to append this call's usage to.
export function runClaude(input, { model, promptFile, usageLog, label = "" }) {
  const { cmd, shell } = resolveClaude();
  const args = lensArgs(model, promptFile, shell);
  if (shell && !shellSafe([cmd, ...args])) return Promise.reject(new Error("a path contains % or a quote, which cmd.exe would change; move the plugin data folder"));
  if (!budget.take()) return Promise.reject(new Error(budget.limit ? "call cap reached" : "no call cap given (--max-calls)"));
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { shell, cwd: CWD });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => reject(new Error(`could not start claude: ${clean(e.message)}`)));
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${clean(err)}`));
      try {
        const { text, usage } = parseResult(out);
        if (usageLog) appendFileSync(usageLog, JSON.stringify({ at: new Date().toISOString(), label, model, ...usage }) + "\n");
        resolve(text);
      } catch (e) { reject(e); }
    });
    p.stdin.end(input);
  });
}
