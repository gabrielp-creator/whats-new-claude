// Pure decisions for the background updater (scripts/update.mjs):
// whether an update is due under the user's frequency, whether another session holds the lock,
// whether the planned Claude calls fit the user's background budget, what a step's outcome was, and
// which environment each step gets. Tested in tests/updater.test.mjs.
import { FREQUENCY_HOURS } from "./options.mjs";

// Longer than a slow run; update.mjs also refreshes the lock between steps. A crashed run's lock
// still expires, so it cannot block updates for good.
export const LOCK_STALE_MS = 4 * 36e5;

export function isDue(updater, frequency, now = Date.now()) {
  const hours = Object.hasOwn(FREQUENCY_HOURS, frequency) ? FREQUENCY_HOURS[frequency] : FREQUENCY_HOURS.daily;
  if (hours === Infinity) return false;
  const last = Date.parse(updater?.lastAttempt || "");
  return !Number.isFinite(last) || now - last >= hours * 36e5;
}

// lock: the parsed lock file, or null when there is none or it could not be read; mtimeMs: the lock
// file's modified time when it exists. An unreadable lock may be one another session is writing.
export function lockState(lock, now = Date.now(), mtimeMs) {
  if (!lock) {
    if (mtimeMs === undefined) return "free";
    return now - mtimeMs < LOCK_STALE_MS ? "held" : "stale";
  }
  const at = Date.parse(lock.at || "");
  return Number.isFinite(at) && now - at < LOCK_STALE_MS ? "held" : "stale";
}

// All or nothing: a partial review would leave items half-judged. Over budget, the items wait for
// /whats-new, which asks the user first.
export function budgetDecision(plan, budget) {
  if (!plan.calls) return { run: false, waiting: false };
  return plan.calls <= budget ? { run: true, waiting: false } : { run: false, waiting: true };
}

const USED = /WNC_CALLS_USED=(\d+)/;
const cleanLine = (s) => String(s || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
const lastLine = (s) => String(s || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !USED.test(l)).at(-1) || "";

// r: spawnSync's result. used is null when the step never reported its calls (killed, crashed).
export function stepOutcome(r) {
  const ok = r.status === 0;
  const m = String(r.stderr || "").match(USED);
  const error = r.error?.message || (ok ? "" : lastLine(r.stderr) || lastLine(r.stdout) || `exit ${r.status}`);
  return { ok, used: m ? Number(m[1]) : null, error: cleanLine(error), out: r.stdout || "" };
}

// A step that died without saying how many calls it made may have made all of them.
export function remainingBudget(left, outcome) {
  if (outcome.used === null) return outcome.ok ? left : 0;
  return Math.max(0, left - outcome.used);
}

const NEEDS_TOKEN = new Set(["fetch.mjs", "enrich-commits.mjs"]);
export function stepEnv(script, env, extra = {}) {
  const out = { ...env, ...extra };
  if (!NEEDS_TOKEN.has(script)) delete out.CLAUDE_PLUGIN_OPTION_GITHUB_TOKEN;
  return out;
}
