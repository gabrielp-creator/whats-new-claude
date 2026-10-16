// B-9: an item that fails every run stops costing calls. lib/failing.mjs counts the runs in a row each
// item's answer failed its checks; after 3 under the same plugin version and model, lens-run, rate-run
// and plan skip it and say so. The end-to-end cases run the real lens-run.mjs, plan.mjs and
// build-page.mjs against a fake claude first on PATH (fixtures/fake-path.mjs) that never answers for
// ids containing "always-bad".
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { recordRun, skippedIds, GIVE_UP_RUNS } from "../scripts/lib/failing.mjs";
import { judgeWithSplit } from "../scripts/lib/batch.mjs";
import { fakeClaude } from "./fixtures/fake-path.mjs";

const WHO = { version: "1.0.0", model: "sonnet" };
const bad = (id) => ({ id, error: `missing row for ${id}`, call: false });
const run = (rec, failures, tried, who = WHO, lens = "impact") => recordRun(rec, lens, { tried, failures, ...who, now: "2026-10-16T00:00:00Z" });

test("an item whose answer fails 3 runs in a row is skipped (B-9)", () => {
  let rec = {};
  for (let i = 1; i < GIVE_UP_RUNS; i++) {
    rec = run(rec, [bad("x")], ["x", `ok${i}`]);
    assert.equal(skippedIds(rec, "impact", WHO).size, 0, `not skipped after ${i}`);
  }
  rec = run(rec, [bad("x")], ["x", "ok3"]);
  assert.deepEqual([...skippedIds(rec, "impact", WHO)], ["x"]);
  assert.equal(skippedIds(rec, "type", WHO).size, 0, "each lens counts its own failures");
  assert.equal(rec.impact.x.runs, 3);
  assert.equal(rec.impact.ok1, undefined, "answered items leave no entry");
});

test("an answer clears the count; a new plugin version or model tries the item again (B-9)", () => {
  let rec = {};
  for (let i = 0; i < GIVE_UP_RUNS; i++) rec = run(rec, [bad("x")], ["x", "ok"]);
  assert.equal(skippedIds(rec, "impact", { ...WHO, version: "1.0.1" }).size, 0);
  assert.equal(skippedIds(rec, "impact", { ...WHO, model: "opus" }).size, 0);
  const again = run(rec, [bad("x")], ["x", "ok"], { ...WHO, version: "1.0.1" });
  assert.equal(again.impact.x.runs, 1, "the count starts over under the new version");
  assert.equal(run(rec, [], ["x"]).impact.x, undefined);
});

test("call failures and runs where nothing was answered are never held against an item (B-9)", () => {
  let rec = run({}, [bad("x")], ["x", "ok"]);
  rec = run(rec, [{ id: "x", error: "call cap reached", call: true }], ["x", "ok"]);
  assert.equal(rec.impact.x.runs, 1, "a call failure leaves the count as it was");
  rec = run(rec, [bad("x"), bad("y")], ["x", "y"]);
  assert.equal(rec.impact.x.runs, 1, "no item answered: the model or the service, not the item");
  assert.equal(rec.impact.y, undefined);
});

test("judgeWithSplit says whether an item failed as a call or as an answer (B-9)", async () => {
  const out = join(fakeClaude("answer").dir, "out.jsonl");
  const asCall = await judgeWithSplit(async () => { throw Object.assign(new Error("call cap reached"), { call: true }); }, [{ id: "a" }], out);
  assert.deepEqual(asCall, [{ id: "a", error: "call cap reached", call: true }]);
  const asAnswer = await judgeWithSplit(async () => { throw new Error("missing row for a"); }, [{ id: "a" }], out);
  assert.deepEqual(asAnswer, [{ id: "a", error: "missing row for a", call: false }]);
});

// One data folder through four runs: each run brings a new item, as a daily update does.
test("lens-run, plan and the page: an item that always fails is skipped after 3 runs and said (B-9)", { timeout: 60e3 }, () => {
  const fake = fakeClaude("answer");
  const data = join(fake.dir, "data");
  mkdirSync(data);
  writeFileSync(join(data, "config.json"), JSON.stringify({ workspaceRoot: fake.dir, model: "sonnet", projects: [{ id: "app", description: "An app", briefDir: "docs" }] }));
  // The fields fetch.mjs writes for a Claude Code release line.
  const item = (id) => JSON.stringify({ id, source: "claude-code", date: "2026-10-16", title: "v9.9.9", text: "Fixed a fixture regression.",
    url: "https://github.com/anthropics/claude-code/releases/tag/v9.9.9", provenance: "anthropic-release", tripwires: [] }) + "\n";
  writeFileSync(join(data, "items.jsonl"), item("claude-code:always-bad"));
  const node = (script, ...args) => spawnSync(process.execPath, [join(import.meta.dirname, "..", "scripts", script), ...args, "--data", data], { env: fake.env, encoding: "utf8" });
  for (let i = 1; i <= GIVE_UP_RUNS; i++) {
    appendFileSync(join(data, "items.jsonl"), item(`claude-code:good-${i}`));
    const r = node("lens-run.mjs", "--max-calls", "30");
    assert.equal(r.status, 1, "the bad item still fails");
    assert.match(r.stdout, /still failing/);
  }
  const failing = JSON.parse(readFileSync(join(data, "failing.json"), "utf8"));
  for (const lens of ["impact", "type", "risk"]) assert.equal(failing[lens]["claude-code:always-bad"].runs, GIVE_UP_RUNS, lens);

  const planRun = node("plan.mjs");
  assert.equal(planRun.status, 0, planRun.stderr);
  const plan = JSON.parse(planRun.stdout);
  assert.equal(plan.itemsNeedingReview, 0);
  assert.equal(plan.lensCalls, 0, "no calls planned for a skipped item");
  assert.equal(plan.skippedFailing, 1);

  const calls = fake.pids().length;
  const fourth = node("lens-run.mjs", "--max-calls", "30");
  assert.equal(fourth.status, 0, fourth.stdout + fourth.stderr);
  assert.equal(fake.pids().length, calls, "the fourth run makes no call");
  assert.match(fourth.stdout, /1 item\(s\) skipped after failing 3 runs in a row/);

  const pageRun = node("build-page.mjs");
  assert.equal(pageRun.status, 0, pageRun.stderr);
  const page = JSON.parse(pageRun.stdout);
  assert.equal(page.notYetReviewed, 0, "a skipped item is not 'not reviewed yet'");
  assert.equal(page.skippedFailing, 1);
  const html = readFileSync(join(data, "results.html"), "utf8");
  assert.match(html, /1 item\(s\) failed 3 runs in a row/);
});
