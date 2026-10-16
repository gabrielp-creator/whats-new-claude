// Runs `claude -p` with NO tools, no MCP and safe mode: the lenses only read the text they are given
// and return JSON. Arguments are passed as an array (no shell string building) wherever possible.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { CWD, pickClaude, shellSafe, resolveClaude } from "./find-claude.mjs";

// Kept here for existing importers; the lookup lives in find-claude.mjs (no side effects there).
export { pickClaude, shellSafe };

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

// B-8: no call outlives the run that started it. Windows does not end a process's children when it
// dies, and an npm install runs claude under cmd.exe, so a call is ended with its whole process tree.
const live = new Set();
let stopReason = "";
function endCalls(reason) {
  stopReason ||= reason;
  for (const p of live) {
    // A call that exited or was already ended is left alone: its pid may now be another process's (R-25).
    if (p.stopped || p.exitCode !== null || p.signalCode !== null) continue;
    p.stopped = true;
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else try { p.kill("SIGTERM"); } catch {}
  }
}
// The background update gives each paid step a deadline (WNC_DEADLINE, ms since 1970) before its own
// timeout, because a step that timeout kills on Windows runs no exit code and its calls would run on.
const DEADLINE = Number(process.env.WNC_DEADLINE) || 0;
const pastDeadline = () => DEADLINE > 0 && Date.now() >= DEADLINE;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const PARENT = process.ppid;
const WATCH_MS = 2000;
let watching = false;
function watch() {
  if (watching) return;
  watching = true;
  process.on("exit", () => endCalls("the run ended"));
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(sig, () => { endCalls("the run was stopped"); process.exit(130); });
  // The process that started this run is gone (a killed update or session): stop rather than run on.
  setInterval(() => {
    if (PARENT > 1 && !alive(PARENT)) { endCalls("the process that started this run ended"); process.exit(1); }
    if (pastDeadline() && live.size) endCalls("the step deadline passed");
  }, WATCH_MS).unref();
}
// A call that failed as a call, not an answer that failed its checks: lib/failing.mjs never holds
// these against the item (B-9).
const callError = (message) => Object.assign(new Error(message), { call: true });

// Resolves with the answer text. usageLog: a .jsonl file to append this call's usage to.
export function runClaude(input, { model, promptFile, usageLog, label = "" }) {
  const { cmd, shell } = resolveClaude();
  const args = lensArgs(model, promptFile, shell);
  if (shell && !shellSafe([cmd, ...args])) return Promise.reject(callError("a path contains % or a quote, which cmd.exe would change; move the plugin data folder"));
  if (pastDeadline()) return Promise.reject(callError("the step deadline passed"));
  if (!budget.take()) return Promise.reject(callError(budget.limit ? "call cap reached" : "no call cap given (--max-calls)"));
  watch();
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { shell, cwd: CWD, windowsHide: true });
    live.add(p);
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("exit", () => live.delete(p));
    p.on("error", (e) => { live.delete(p); reject(callError(`could not start claude: ${clean(e.message)}`)); });
    p.on("close", (code) => {
      live.delete(p);
      if (p.stopped) return reject(callError(`call stopped: ${stopReason}`));
      if (code !== 0) return reject(callError(`claude exited ${code}: ${clean(err)}`));
      try {
        const { text, usage } = parseResult(out);
        if (usageLog) appendFileSync(usageLog, JSON.stringify({ at: new Date().toISOString(), label, model, ...usage }) + "\n");
        resolve(text);
      } catch (e) { reject(Object.assign(e, { call: true })); }
    });
    p.stdin.end(input);
  });
}
