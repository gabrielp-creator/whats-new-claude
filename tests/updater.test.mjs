import { test } from "node:test";
import assert from "node:assert/strict";
import { isDue, lockState, budgetDecision, LOCK_STALE_MS } from "../scripts/lib/updater.mjs";
import { callBudget } from "../scripts/lib/claude.mjs";

const H = 36e5, NOW = Date.parse("2026-10-08T12:00:00Z");
const at = (hoursAgo) => new Date(NOW - hoursAgo * H).toISOString();

test("isDue follows the frequency setting", () => {
  assert.equal(isDue({ lastAttempt: at(25) }, "daily", NOW), true);
  assert.equal(isDue({ lastAttempt: at(23) }, "daily", NOW), false);
  assert.equal(isDue({ lastAttempt: at(71) }, "every 3 days", NOW), false);
  assert.equal(isDue({ lastAttempt: at(73) }, "every 3 days", NOW), true);
  assert.equal(isDue({ lastAttempt: at(167) }, "weekly", NOW), false);
  assert.equal(isDue({ lastAttempt: at(169) }, "weekly", NOW), true);
});

test("manual never updates in the background; an unknown frequency falls back to daily", () => {
  assert.equal(isDue({ lastAttempt: at(10000) }, "manual", NOW), false);
  assert.equal(isDue(null, "manual", NOW), false);
  assert.equal(isDue({ lastAttempt: at(25) }, "hourly", NOW), true);
  assert.equal(isDue({ lastAttempt: at(23) }, "hourly", NOW), false);
});

test("never attempted means due (the first run itself is left to /whats-new by the caller)", () => {
  assert.equal(isDue(null, "daily", NOW), true);
  assert.equal(isDue({}, "weekly", NOW), true);
});

test("lockState: free, held by a live run, or stale after LOCK_STALE_MS", () => {
  assert.equal(lockState(null, NOW), "free");
  assert.equal(lockState({ at: new Date(NOW - 60e3).toISOString() }, NOW), "held");
  assert.equal(lockState({ at: new Date(NOW - LOCK_STALE_MS - 1).toISOString() }, NOW), "stale");
  assert.equal(lockState({ at: "garbage" }, NOW), "stale", "an unreadable lock must not block updates forever");
});

test("budgetDecision: runs only when the whole planned spend fits the budget", () => {
  assert.deepEqual(budgetDecision({ calls: 0 }, 0), { run: false, waiting: false });
  assert.deepEqual(budgetDecision({ calls: 4 }, 10), { run: true, waiting: false });
  assert.deepEqual(budgetDecision({ calls: 10 }, 10), { run: true, waiting: false });
  assert.deepEqual(budgetDecision({ calls: 11 }, 10), { run: false, waiting: true });
  assert.deepEqual(budgetDecision({ calls: 3 }, 0), { run: false, waiting: true }, "budget 0 never spends");
});

test("callBudget: a hard cap on real calls, so retries cannot overspend", () => {
  const b = callBudget("2");
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), false);
  assert.equal(b.used(), 2);
  assert.equal(callBudget(undefined).take(), false, "no cap given: no calls; /whats-new passes --max-calls");
  assert.equal(callBudget("0").take(), false);
  assert.equal(callBudget("junk").take(), false, "an unreadable cap means no calls, not unlimited");
});

import { parseResult } from "../scripts/lib/claude.mjs";

test("parseResult: takes the answer text and usage from claude -p's JSON result", () => {
  const raw = JSON.stringify({ type: "result", is_error: false, result: '[{"id":"a"}]', total_cost_usd: 0.0123,
    usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 50, cache_creation_input_tokens: 7000 }, duration_ms: 4000 });
  assert.deepEqual(parseResult(raw), { text: '[{"id":"a"}]', usage: { input: 1200, output: 300, cacheRead: 50, cacheWrite: 7000, costUsd: 0.0123, ms: 4000 } });
});

test("parseResult: an error result or unreadable output is an error, not an empty answer", () => {
  assert.throws(() => parseResult(JSON.stringify({ type: "result", is_error: true, result: "Overloaded" })), /Overloaded/);
  assert.throws(() => parseResult("not json"), /unreadable/);
});

import { stepOutcome, remainingBudget, stepEnv } from "../scripts/lib/updater.mjs";

test("stepOutcome: the error is the last real line, never the WNC_CALLS_USED report", () => {
  const o = stepOutcome({ status: 1, stdout: "lens impact: 60 items\n3 item answer(s) still failing\n", stderr: "warn x\nboom: bad row\n\nWNC_CALLS_USED=4\n" });
  assert.equal(o.ok, false);
  assert.equal(o.used, 4);
  assert.equal(o.error, "boom: bad row");
  const o2 = stepOutcome({ status: 1, stdout: "lens impact: 60 items\n3 item answer(s) still failing\n", stderr: "\nWNC_CALLS_USED=2\n" });
  assert.equal(o2.error, "3 item answer(s) still failing", "falls back to stdout");
});

test("stepOutcome: error text is one short clean line", () => {
  const o = stepOutcome({ status: 1, stdout: "", stderr: "x\u001b[31m" + "y".repeat(500) });
  assert.ok(o.error.length <= 200);
  assert.doesNotMatch(o.error, /\u001b/);
  assert.equal(stepOutcome({ status: null, error: { message: "spawnSync node ETIMEDOUT" }, stdout: "", stderr: "" }).error, "spawnSync node ETIMEDOUT");
});

test("remainingBudget: a step that died without reporting its calls is treated as having spent everything", () => {
  assert.equal(remainingBudget(10, { ok: true, used: 3 }), 7);
  assert.equal(remainingBudget(10, { ok: false, used: 3 }), 7);
  assert.equal(remainingBudget(10, { ok: false, used: null }), 0, "killed or crashed: no report, no more spending");
  assert.equal(remainingBudget(10, { ok: true, used: null }), 10, "a clean exit without calls made none");
  assert.equal(remainingBudget(2, { ok: true, used: 5 }), 0);
});

test("stepEnv: the GitHub token goes only to the steps that call GitHub", () => {
  const env = { PATH: "p", CLAUDE_PLUGIN_OPTION_GITHUB_TOKEN: "ghp_x", CLAUDE_PLUGIN_OPTION_MIN_RATING: "8" };
  for (const s of ["fetch.mjs", "enrich-commits.mjs"]) assert.equal(stepEnv(s, env).CLAUDE_PLUGIN_OPTION_GITHUB_TOKEN, "ghp_x", s);
  for (const s of ["lens-run.mjs", "rate-run.mjs", "verify.mjs", "plan.mjs", "build-page.mjs"]) {
    assert.equal(stepEnv(s, env).CLAUDE_PLUGIN_OPTION_GITHUB_TOKEN, undefined, s);
    assert.equal(stepEnv(s, env).PATH, "p");
  }
  assert.equal(stepEnv("lens-run.mjs", env, { WNC_MAX_CALLS: "3" }).WNC_MAX_CALLS, "3");
});

test("lockState: an unreadable lock is held while its file is fresh, stale once old", () => {
  assert.equal(lockState(null, NOW, NOW - 1000), "held", "a lock another session is still writing");
  assert.equal(lockState(null, NOW, NOW - LOCK_STALE_MS - 1), "stale");
  assert.ok(LOCK_STALE_MS >= 4 * H, "longer than a slow run; the run also refreshes the lock between steps");
});
