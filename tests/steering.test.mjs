// B-66: one injected item must not steer the answers for a batch of first-party items.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { merge } from "../scripts/lib/merge.mjs";
import { runBatches, INJECTION_RECHECK_OVER } from "../scripts/lib/batch.mjs";
import { planCalls } from "../scripts/lib/plan.mjs";
import { clampDate } from "../scripts/lib/incremental.mjs";

const item = (o = {}) => ({ id: "x:1", source: "claude-code", date: "2026-10-01", provenance: "anthropic-release", tripwires: [], ...o });
const impact = (o = {}) => ({ effect: "none", projects: [], new_work: false, strength: "low", why: "", injection: false, ...o });
const type = (o = {}) => ({ type: "bug-fix", action: "ignore", injection: false, ...o });
const risk = (o = {}) => ({ risk: "none", exposed: false, why: "", injection: false, ...o });

test("a first-party security, breaking, deprecation or retirement tripwire never lands in the none band", () => {
  for (const t of ["\\bsecurity\\b", "\\bbreaking\\b", "\\bdeprecat", "\\bretir(e|ed|es|ing)\\b"]) {
    const m = merge(item({ tripwires: [t] }), impact(), type(), risk());
    assert.equal(m.urgencyLabel, "later", t);
  }
});

test("the floor is for first-party items and the four serious words only", () => {
  assert.equal(merge(item({ provenance: "external-fork", tripwires: ["\\bsecurity\\b"] }), impact(), type(), risk()).urgencyLabel, "none");
  assert.equal(merge(item({ provenance: "third-party", tripwires: ["\\bbreaking\\b"] }), impact(), type(), risk()).urgencyLabel, "none");
  // "removed" and "renamed" hit incidentally far more often ("Slack removing its button")
  assert.equal(merge(item({ tripwires: ["\\bremov(ed|es|ing)\\b"] }), impact(), type(), risk()).urgencyLabel, "none");
});

const out = () => join(mkdtempSync(join(tmpdir(), "wnc-")), "out.jsonl");
const rowsIn = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("fork and third-party items are never batched with first-party items", async () => {
  const todo = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, provenance: "anthropic-release" })),
    { id: "f1", provenance: "external-fork" }, { id: "t1", provenance: "third-party" },
    ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, provenance: "anthropic-docs" })),
  ];
  const seen = [];
  const judge = async (batch) => { seen.push(batch.map((i) => i.id)); return batch.map((i) => ({ id: i.id, injection: false })); };
  await runBatches(judge, todo, 60, 1, out());
  assert.deepEqual(seen, [["a0", "a1", "a2", "a3", "a4", "b0", "b1", "b2"], ["f1", "t1"]]);
});

test("rate rows are grouped by their fyiOnly flag", async () => {
  const todo = [{ id: "r1", fyiOnly: false }, { id: "r2", fyiOnly: true }, { id: "r3", fyiOnly: false }];
  const seen = [];
  await runBatches(async (b) => { seen.push(b.map((i) => i.id)); return b.map((i) => ({ id: i.id })); }, todo, 30, 1, out());
  assert.deepEqual(seen, [["r1", "r3"], ["r2"]]);
});

// A judge that an injected item "e" steers: in any batch holding "e", every answer comes back flagged.
const steered = (calls) => async (batch) => {
  calls.push(batch.map((i) => i.id));
  const poisoned = batch.some((i) => i.id === "e");
  return batch.map((i) => ({ id: i.id, injection: poisoned }));
};

test("more than the threshold of flags in one batch re-runs those items one per call", async () => {
  const todo = ["a", "b", "c", "d", "e"].map((id) => ({ id, provenance: "anthropic-release" }));
  const calls = [], f = out();
  await runBatches(steered(calls), todo, 60, 1, f);
  const rows = new Map(rowsIn(f).map((r) => [r.id, r]));
  assert.equal(rows.size, 5);
  assert.equal(rows.get("e").injection, true, "the injected item stays flagged when judged alone");
  for (const id of ["a", "b", "c", "d"]) assert.equal(rows.get(id).injection, false, id);
  assert.deepEqual(calls, [["a", "b", "c", "d", "e"], ["a"], ["b"], ["c"], ["d"], ["e"]]);
});

test("at or under the threshold, flags are kept as answered (no extra calls)", async () => {
  const todo = ["a", "b", "e"].map((id) => ({ id, provenance: "anthropic-release" }));
  assert.ok(todo.length <= INJECTION_RECHECK_OVER);
  const calls = [], f = out();
  await runBatches(steered(calls), todo, 60, 1, f);
  assert.equal(calls.length, 1);
  assert.ok(rowsIn(f).every((r) => r.injection === true));
});

test("a re-check that cannot run (call cap reached) keeps the batch answer, flagged", async () => {
  const todo = ["a", "b", "c", "d", "e"].map((id) => ({ id, provenance: "anthropic-release" }));
  let n = 0;
  const judge = async (batch) => {
    if (n++ > 0) throw new Error("call cap reached");
    return batch.map((i) => ({ id: i.id, injection: true }));
  };
  const f = out();
  const r = await runBatches(judge, todo, 60, 1, f);
  assert.deepEqual(r.failures, []);
  const rows = rowsIn(f);
  assert.equal(rows.length, 5);
  assert.ok(rows.every((x) => x.injection === true));
});

test("the cost estimate counts first-party and FYI batches separately", () => {
  // 61 first-party and 1 fork item: 2 + 1 calls per lens, not ceil(62 / 60) = 2
  const p = planCalls({ perLens: [{ first: 61, fyi: 1 }, { first: 61, fyi: 1 }, { first: 61, fyi: 1 }], unratedKnown: 0, limit: 30 });
  assert.equal(p.lensCalls, 9);
  assert.equal(p.itemsNeedingReview, 62);
  // plain numbers still work
  assert.equal(planCalls({ perLens: [60, 60, 60], unratedKnown: 0, limit: 30 }).lensCalls, 3);
});

test("item dates are clamped to today, so a future date cannot sit in every 'last N days' window", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  assert.equal(clampDate("2027-01-01", now), "2026-10-13");
  assert.equal(clampDate("2026-10-12", now), "2026-10-12");
  assert.equal(clampDate("", now), "");
  assert.equal(clampDate(undefined, now), undefined);
});
