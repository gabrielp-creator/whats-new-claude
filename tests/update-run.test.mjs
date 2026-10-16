// The background update's step order, run for real (scripts/update.mjs) with every step it starts
// replaced by a stub that records its name. B-70: the file check runs before the cost plan, so the
// plan's rating figure is the one that runs. B-69: a run that found no network stops after fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dirname, "..");
const STEPS = ["fetch", "enrich-commits", "plan", "lens-run", "verify", "rate-run", "build-page"];

// Each stub logs its name; fetch writes the state.json the test gives it, plan prints the plan.
const STUB = `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
const data = process.argv[process.argv.indexOf("--data") + 1];
const name = basename(process.argv[1], ".mjs");
appendFileSync(join(data, "steps.log"), name + "\\n");
appendFileSync(join(data, "deadlines.log"), name + " " + (process.env.WNC_DEADLINE || "-") + "\\n");
const stub = JSON.parse(readFileSync(join(data, "stub.json"), "utf8"));
// stub.state is the body of a function of the current time, so "this run" can be said in it.
if (name === "fetch") { if (stub.state) writeFileSync(join(data, "state.json"), JSON.stringify(Function("now", stub.state)(new Date().toISOString()))); process.exitCode = stub.fetchExit; }
if (name === "plan") console.log(JSON.stringify(stub.plan));
if (name === "lens-run") console.error("WNC_CALLS_USED=" + stub.plan.lensCalls);
`;

function setUp({ plan, state, fetchExit = 0 }) {
  const dir = mkdtempSync(join(tmpdir(), "wnc-update-"));
  const scripts = join(dir, "scripts"), data = join(dir, "data");
  mkdirSync(data);
  cpSync(join(ROOT, "scripts", "lib"), join(scripts, "lib"), { recursive: true });
  cpSync(join(ROOT, "scripts", "update.mjs"), join(scripts, "update.mjs"));
  for (const s of STEPS) writeFileSync(join(scripts, `${s}.mjs`), STUB);
  writeFileSync(join(data, "config.json"), JSON.stringify({ workspaceRoot: dir, projects: [{ id: "app", description: "An app", briefDir: "docs" }] }));
  writeFileSync(join(data, "state.json"), JSON.stringify({ sources: {} }));
  writeFileSync(join(data, "stub.json"), JSON.stringify({ plan, state, fetchExit }));
  return { scripts, data };
}

function runUpdate({ scripts, data }, budget) {
  const r = spawnSync(process.execPath, [join(scripts, "update.mjs")], {
    input: JSON.stringify({ source: "startup" }), encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_DATA: data, CLAUDE_PLUGIN_OPTION_AUTO_RATE_MAX_CALLS: String(budget), CLAUDE_PLUGIN_OPTION_UPDATE_FREQUENCY: "daily" },
  });
  assert.equal(r.status, 0, r.stderr);
  return {
    steps: existsSync(join(data, "steps.log")) ? readFileSync(join(data, "steps.log"), "utf8").trim().split("\n") : [],
    record: JSON.parse(readFileSync(join(data, "updater.json"), "utf8")),
  };
}

const OK_STATE = "return { sources: { a: { lastSuccess: now, lastError: null } } }";
const plan = (lensCalls, rateCalls) => ({ itemsNeedingReview: 0, itemsToRate: 0, itemsToRedo: 0, lensCalls, rateCalls, calls: lensCalls + rateCalls, limit: 30, askFirst: false });

test("background update: the file check runs before the plan; no second check when no lens ran (B-70)", () => {
  const { steps, record } = runUpdate(setUp({ plan: plan(1, 1), state: OK_STATE }), 0);
  assert.deepEqual(steps, ["fetch", "enrich-commits", "verify", "plan", "build-page"]);
  assert.deepEqual(record.waiting, { items: 0, calls: 2, redo: 0 });
});

test("background update within budget: check, plan, lenses, check again for their new ties, then rate (B-70)", () => {
  const { steps, record } = runUpdate(setUp({ plan: plan(1, 1), state: OK_STATE }), 10);
  assert.deepEqual(steps, ["fetch", "enrich-commits", "verify", "plan", "lens-run", "verify", "rate-run", "build-page"]);
  assert.equal(record.incomplete, false);
});

// B-8: a step the 30-minute timeout kills on Windows runs no exit code, so its calls would run on;
// the paid steps get a deadline before it and end their calls themselves. The free steps get none.
test("background update: the paid steps get a deadline before the step timeout (B-8)", () => {
  const before = Date.now();
  const env = setUp({ plan: plan(1, 1), state: OK_STATE });
  runUpdate(env, 10);
  const lines = readFileSync(join(env.data, "deadlines.log"), "utf8").trim().split("\n").map((l) => l.split(" "));
  for (const [name, at] of lines) {
    if (name !== "lens-run" && name !== "rate-run") { assert.equal(at, "-", name); continue; }
    const ms = Number(at) - before;
    assert.ok(ms > 20 * 60e3 && ms < 30 * 60e3, `${name} deadline ${ms} ms after the start`);
  }
  assert.deepEqual(lines.filter(([n]) => n === "lens-run" || n === "rate-run").map(([n]) => n), ["lens-run", "rate-run"]);
});

test("background update with no network: stops after fetch and records offline, not an attempt (B-69)", () => {
  const state = "return { sources: { a: { lastSuccess: '2026-10-01T00:00:00Z', lastError: 'network unreachable (ENOTFOUND)' }, b: { lastError: 'network unreachable (ENOTFOUND)' } } }";
  const { steps, record } = runUpdate(setUp({ plan: plan(0, 0), state, fetchExit: 1 }), 10);
  assert.deepEqual(steps, ["fetch"]);
  assert.equal(record.offline, true);
  assert.deepEqual(record.failed, ["a", "b"]);
  assert.equal(record.incomplete, false, "no network is not a crash");
  assert.equal(record.running, false);
});

// R-23: a fetch that crashed before writing state.json leaves the last run's state; an offline one
// there must not hide the crash as "no network".
test("background update whose fetch never wrote state.json: a crash, not offline (R-23)", () => {
  const env = setUp({ plan: plan(0, 0), state: null, fetchExit: 1 });
  const old = { sources: { a: { lastSuccess: "2026-10-01T00:00:00Z", lastError: "network unreachable (ENOTFOUND)" } } };
  writeFileSync(join(env.data, "state.json"), JSON.stringify(old));
  const hourAgo = new Date(Date.now() - 36e5);
  utimesSync(join(env.data, "state.json"), hourAgo, hourAgo);
  const { steps, record } = runUpdate(env, 10);
  assert.deepEqual(steps, ["fetch"]);
  assert.equal(record.offline, false);
  assert.equal(record.incomplete, true);
  assert.match(record.errors[0], /^fetch: /);
});

// R-21: /whats-new does not write updater.json; a summary rebuilt after the offline attempt shows it
// fetched, so the next session follows the frequency instead of updating again at once.
test("background update after an offline attempt and a later /whats-new run: not due again (R-21)", () => {
  const env = setUp({ plan: plan(0, 0), state: OK_STATE });
  const t = (min) => new Date(Date.now() - min * 6e4).toISOString();
  writeFileSync(join(env.data, "updater.json"), JSON.stringify({ lastAttempt: t(30), finishedAt: t(30), offline: true }));
  writeFileSync(join(env.data, "summary.json"), JSON.stringify({ builtAt: t(10) }));
  const { steps } = runUpdate(env, 10);
  assert.deepEqual(steps, []);
});

test("background update where one source got through: not offline, every step runs", () => {
  const state = "return { sources: { a: { lastSuccess: now, lastError: null }, b: { lastError: 'network unreachable (ENOTFOUND)' } } }";
  const { steps, record } = runUpdate(setUp({ plan: plan(0, 0), state, fetchExit: 1 }), 10);
  assert.deepEqual(steps, ["fetch", "enrich-commits", "verify", "plan", "build-page"]);
  assert.equal(record.offline, false);
  assert.deepEqual(record.failed, ["b"]);
});

// The /whats-new skill runs the same steps by hand: its Update now list must keep the same order.
test("/whats-new Update now: the file check comes before the cost question, and again after the lenses (B-70)", () => {
  const skill = readFileSync(join(ROOT, "skills", "whats-new", "SKILL.md"), "utf8");
  const section = skill.split("## Update now")[1].split("\n## ")[0];
  const steps = section.split(/\n(?=\d+\. )/).filter((s) => /^\d+\. /.test(s));
  const first = (re, from = 0) => steps.findIndex((s, i) => i >= from && re.test(s));
  const verify = first(/^\d+\. `run verify`/), planAt = first(/^\d+\. `run plan`/), lens = first(/`run lens-run/), rate = first(/`run rate-run/);
  assert.ok(verify >= 0 && planAt >= 0 && lens >= 0 && rate >= 0, "each step is found");
  assert.ok(verify < planAt, "verify comes before plan");
  const again = first(/`run verify`/, lens + 1);
  assert.ok(again > lens && again < rate, "verify runs again between the lenses and the rating");
});
