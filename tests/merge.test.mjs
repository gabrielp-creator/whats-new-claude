// Unit tests for the deterministic lens merge. Run: node --test scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import { merge, tripwireLabel } from "../scripts/lib/merge.mjs";

const item = (o = {}) => ({ id: "x:1", source: "claude-code", date: "2026-10-01", provenance: "anthropic-release", tripwires: [], ...o });
const impact = (o = {}) => ({ effect: "none", projects: [], new_work: false, strength: "low", why: "", injection: false, ...o });
const type = (o = {}) => ({ type: "bug-fix", action: "ignore", injection: false, ...o });
const risk = (o = {}) => ({ risk: "none", exposed: false, why: "", injection: false, ...o });

test("exposed risk is must-read even when impact says none", () => {
  const m = merge(item(), impact(), type(), risk({ risk: "breaking", exposed: true }));
  assert.equal(m.section, "must-read");
  assert.ok(m.flags.some((f) => /risk lens/.test(f)));
});

test("unexposed risk alone does not make must-read", () => {
  assert.equal(merge(item(), impact(), type(), risk({ risk: "breaking", exposed: false })).section, "dropped");
});

test("model, security and breaking types with an effect are must-read", () => {
  for (const t of ["model", "security", "breaking-or-deprecation"]) {
    assert.equal(merge(item(), impact({ effect: "unlocks" }), type({ type: t }), risk()).section, "must-read", t);
  }
});

test("effect without risk goes to affects-work", () => {
  assert.equal(merge(item(), impact({ effect: "fixes" }), type(), risk()).section, "affects-work");
});

test("no effect but new_work goes to new-ideas", () => {
  assert.equal(merge(item(), impact({ new_work: true }), type(), risk()).section, "new-ideas");
});

test("a tripwire hit is never dropped", () => {
  const m = merge(item({ tripwires: ["\\bremov(ed|es|ing)\\b"] }), impact(), type(), risk());
  assert.equal(m.section, "keyword-only");
  assert.deepEqual(m.tripwires, ["removed"]);
});

test("nothing anywhere is dropped", () => {
  assert.equal(merge(item(), impact(), type(), risk()).section, "dropped");
});

test("third-party and fork items never get try-feature", () => {
  for (const provenance of ["third-party", "external-fork"]) {
    const m = merge(item({ provenance }), impact({ effect: "unlocks" }), type({ action: "try-feature" }), risk());
    assert.equal(m.action, "read", provenance);
    assert.equal(m.fyiOnly, true);
  }
  assert.equal(merge(item(), impact(), type({ action: "try-feature" }), risk()).action, "try-feature");
});

test("type says breaking but risk lens says none is flagged", () => {
  const m = merge(item(), impact({ effect: "improves" }), type({ type: "breaking-or-deprecation" }), risk());
  assert.ok(m.flags.some((f) => /type lens/.test(f)));
});

test("useful item with action ignore is flagged; low strength is not", () => {
  assert.ok(merge(item(), impact({ effect: "fixes", strength: "medium" }), type(), risk()).flags.length);
  assert.equal(merge(item(), impact({ effect: "fixes", strength: "low" }), type(), risk()).flags.length, 0);
});

test("any lens reporting injection is flagged", () => {
  assert.ok(merge(item(), impact(), type({ injection: true }), risk()).flags.some((f) => /instructions/.test(f)));
});

const urg = (im, ty, ri, it) => merge(item(it), impact(im), type(ty), risk(ri));

test("urgency: exposed breaking > exposed security > model with effect > exposed behavior change", () => {
  const breaking = urg({}, {}, { risk: "breaking", exposed: true });
  const security = urg({}, {}, { risk: "security", exposed: true });
  const model = urg({ effect: "unlocks" }, { type: "model" }, {});
  const behavior = urg({}, {}, { risk: "behavior-change", exposed: true });
  assert.ok(breaking.urgency > security.urgency && security.urgency > model.urgency && model.urgency > behavior.urgency);
  for (const m of [breaking, security, model]) assert.equal(m.urgencyLabel, "urgent");
  assert.equal(behavior.urgencyLabel, "soon");
});

test("urgency: unexposed risk does not count as urgent", () => {
  assert.notEqual(urg({}, {}, { risk: "breaking", exposed: false }).urgencyLabel, "urgent");
});

test("urgency: effect strength orders high > medium > low; dropped is lowest", () => {
  const h = urg({ effect: "fixes", strength: "high" }, {}, {}).urgency;
  const m = urg({ effect: "fixes", strength: "medium" }, {}, {}).urgency;
  const l = urg({ effect: "fixes", strength: "low" }, {}, {}).urgency;
  const d = urg({}, {}, {}).urgency;
  assert.ok(h > m && m > l && l > d);
  assert.equal(urg({ effect: "fixes", strength: "high" }, {}, {}).urgencyLabel, "soon");
  assert.equal(urg({}, {}, {}).urgencyLabel, "none");
});

test("urgency: a keyword hit outranks dropped", () => {
  assert.ok(urg({}, {}, {}, { tripwires: ["\\bbreaking\\b"] }).urgency > urg({}, {}, {}).urgency);
});

test("tripwire labels are readable", () => {
  assert.equal(tripwireLabel("\\b(Opus|Sonnet|Haiku|Fable|Mythos) \\d"), "model name");
  assert.equal(tripwireLabel("\\bclaude-(opus|sonnet|haiku|fable|mythos)"), "model name");
  assert.equal(tripwireLabel("\\bdeprecat"), "deprecation");
  assert.equal(tripwireLabel("\\bsecurity\\b"), "security");
  assert.equal(tripwireLabel("setup:hooks"), "your setup: hooks");
});

test("a confirmed item's +2 never moves it into another tier", async () => {
  const { labelFor } = await import("../scripts/lib/merge.mjs");
  const effects = ["fixes", "improves", "unlocks", "none"], strengths = ["high", "medium", "low"];
  const types = ["bug-fix", "model", "security", "breaking-or-deprecation", "research"];
  const risks = ["none", "breaking", "deprecation", "security", "behavior-change"];
  for (const e of effects) for (const s of strengths) for (const t of types) for (const r of risks) for (const exposed of [true, false]) for (const nw of [true, false]) {
    const m = merge(item({ tripwires: [] }), impact({ effect: e, strength: s, new_work: nw }), type({ type: t }), risk({ risk: r, exposed }));
    assert.equal(labelFor(m.urgency + 2), m.urgencyLabel, `${e}/${s}/${t}/${r}/${exposed}/${nw} urgency ${m.urgency}`);
  }
});
