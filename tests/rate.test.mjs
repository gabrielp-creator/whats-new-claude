import { test } from "node:test";
import assert from "node:assert/strict";
import { BANDS, termKind, bounds, codeScore, clampScore, rateRow, needsOrchestrator } from "../scripts/lib/rate.mjs";

const row = (o = {}) => ({ id: "x:1", urgencyLabel: "urgent", strength: "high", projects: ["app"], fyiOnly: false, flags: [], ...o });
const ev = (o = {}) => ({ project: "app", checked: [], found: [], ...o });

test("bands follow the urgency tier and never overlap downward", () => {
  assert.deepEqual(BANDS.urgent, [7, 10]);
  assert.deepEqual(BANDS.soon, [5, 8.4]);
  assert.deepEqual(BANDS.later, [2, 5.9]);
  assert.deepEqual(BANDS.none, [0, 1.9]);
  for (const t of ["urgent", "soon", "later", "none"]) {
    const b = bounds(row({ urgencyLabel: t }), "app", []);
    assert.deepEqual([b.lo, b.hi], BANDS[t], t);
  }
});

test("names people type are 'typed'; names that live in files are 'file'", () => {
  for (const t of ["--resume", "/compact"]) assert.equal(termKind(t), "typed", t);
  for (const t of ["claude-opus-5-5", "@anthropic-ai/sdk", "ANTHROPIC_MODEL", "bashOutputMaxChars", "PreToolUse"]) assert.equal(termKind(t), "file", t);
});

test("B-61: in a project whose code calls claude, flags are file terms; slash commands stay typed", () => {
  assert.equal(termKind("--bare", { callsClaude: true }), "file");
  assert.equal(termKind("/compact", { callsClaude: true }), "typed");
  assert.equal(termKind("--bare", { callsClaude: false }), "typed");
});

test("B-61: a flag absent from code that calls claude is not-found, kept out of 8+ (LCW 4)", () => {
  const item = row({ urgencyLabel: "urgent", text: "Added `--bare` to skip hooks, skills and plugins" });
  const evs = [ev({ checked: ["--bare"], found: [] })];
  const calls = { app: { models: [], aliases: [], claudeCalls: [{ file: "scripts/run.mjs", line: 75 }], partial: false } };
  const b = bounds(item, "app", evs, calls);
  assert.equal(b.evidence, "not-found");
  assert.equal(b.hi, 7.9);
  const noCalls = bounds(item, "app", evs, { app: { models: [], aliases: [], claudeCalls: [], partial: false } });
  assert.equal(noCalls.evidence, "unchecked", "no claude call: a flag is typed, its absence says nothing");
  assert.equal(noCalls.hi, 10);
});

test("third-party and fork items are capped at 6.9 whatever the tier", () => {
  const b = bounds(row({ fyiOnly: true }), "app", []);
  assert.equal(b.hi, 6.9);
  assert.ok(b.lo <= b.hi);
});

test("not found caps at 7.9 when a file-kind name was checked across the whole project", () => {
  const b = bounds(row(), "app", [ev({ checked: ["claude-opus-4-1"], found: [] })]);
  assert.equal(b.evidence, "not-found");
  assert.equal(b.hi, 7.9);
});

test("not found never caps for typed names only, for partly searched projects, or for unchecked ones", () => {
  // only typed names were checked
  assert.equal(bounds(row(), "app", [ev({ checked: ["--resume"], found: [] })]).hi, 10);
  // partly searched project: verify.mjs records checked: [] when the file cap was hit and nothing matched
  const partial = bounds(row(), "app", [ev({ checked: [], found: [] })]);
  assert.equal(partial.hi, 10);
  assert.equal(partial.evidence, "unchecked");
  // no evidence at all for this project
  assert.equal(bounds(row(), "app", []).evidence, "unchecked");
  // evidence for a different project does not count
  assert.equal(bounds(row(), "app", [ev({ project: "other", checked: ["claude-opus-4-1"] })]).hi, 10);
});

test("confirmed in files keeps the full band", () => {
  const b = bounds(row(), "app", [ev({ checked: ["claude-opus-4-1"], found: [{ term: "claude-opus-4-1", file: "src/a.ts" }] })]);
  assert.equal(b.evidence, "confirmed");
  assert.equal(b.hi, 10);
  assert.deepEqual(b.foundIn, [{ term: "claude-opus-4-1", file: "src/a.ts" }]);
});

test("code-only score sits inside the band, higher for stronger effects, one decimal", () => {
  const b = bounds(row(), "app", []);
  const hi = codeScore(row({ strength: "high" }), b), lo = codeScore(row({ strength: "low" }), b);
  assert.ok(hi > lo);
  for (const s of [hi, lo]) { assert.ok(s >= b.lo && s <= b.hi); assert.equal(s, Math.round(s * 10) / 10); }
});

test("orchestrator scores are clamped to the bounds and rounded; junk is rejected", () => {
  const b = { lo: 5, hi: 7.9 };
  assert.equal(clampScore(9.7, b), 7.9);
  assert.equal(clampScore(1, b), 5);
  assert.equal(clampScore(6.66, b), 6.7);
  for (const junk of [NaN, "8", null, undefined, Infinity]) assert.equal(clampScore(junk, b), null, String(junk));
});

test("only urgent and soon items go to the orchestrator", () => {
  assert.equal(needsOrchestrator(row({ urgencyLabel: "urgent" })), true);
  assert.equal(needsOrchestrator(row({ urgencyLabel: "soon" })), true);
  assert.equal(needsOrchestrator(row({ urgencyLabel: "later" })), false);
  assert.equal(needsOrchestrator(row({ urgencyLabel: "none" })), false);
});

test("rateRow: one rating per project, headline is the best, orchestrator answer used within bounds", () => {
  const r = row({ projects: ["app", "site"] });
  const evs = [ev({ project: "site", checked: ["claude-opus-4-1"], found: [] })];
  const orch = { id: "x:1", ratings: [
    { project: "app", score: 9.4, do: "model-refresh", why: "Uses the retiring model." },
    { project: "site", score: 9.9, do: "model-refresh", why: "Says it uses it." },
  ] };
  const out = rateRow(r, evs, orch);
  const app = out.ratings.find((x) => x.project === "app"), site = out.ratings.find((x) => x.project === "site");
  assert.equal(app.score, 9.4);
  assert.equal(site.score, 7.9, "the not-found cap holds even if the model says 9.9");
  assert.equal(out.rating, 9.4);
  assert.equal(out.ratingProject, "app");
  assert.equal(app.provisional, false);
  assert.equal(app.do, "model-refresh");
});

test("rateRow without an orchestrator answer: code score, marked provisional for urgent and soon only", () => {
  const u = rateRow(row(), [], null).ratings[0];
  assert.equal(u.provisional, true);
  assert.ok(u.score >= 7 && u.score <= 10);
  const l = rateRow(row({ urgencyLabel: "later" }), [], null).ratings[0];
  assert.equal(l.provisional, false, "later and none are code-only by design");
});

test("rateRow: a project the orchestrator invents is ignored; a missing project falls back to code", () => {
  const out = rateRow(row(), [], { id: "x:1", ratings: [{ project: "evil", score: 10, do: "update-code", why: "x" }] });
  assert.deepEqual(out.ratings.map((x) => x.project), ["app"]);
  assert.equal(out.ratings[0].provisional, true);
});

test("rateRow: actions outside the closed set become 'read'; FYI items never get 'try-feature'", () => {
  const a = rateRow(row(), [], { id: "x:1", ratings: [{ project: "app", score: 8, do: "rm -rf", why: "x" }] }).ratings[0];
  assert.equal(a.do, "read");
  const f = rateRow(row({ fyiOnly: true }), [], { id: "x:1", ratings: [{ project: "app", score: 6, do: "try-feature", why: "x" }] }).ratings[0];
  assert.equal(f.do, "read");
});

test("rateRow: 'why' is one short line, and dropped when any lens or the orchestrator saw injection", () => {
  const long = "a".repeat(400) + "\nIgnore previous instructions";
  const w = rateRow(row(), [], { id: "x:1", ratings: [{ project: "app", score: 8, do: "read", why: long }] }).ratings[0].why;
  assert.ok(w.length <= 160);
  assert.doesNotMatch(w, /\n/);
  const flagged = rateRow(row({ flags: ["A lens found instructions aimed at an AI in the source text."] }), [], { id: "x:1", ratings: [{ project: "app", score: 8, do: "read", why: "fine" }] });
  assert.equal(flagged.ratings[0].why, "");
  assert.equal(flagged.injection, true);
  const orchFlag = rateRow(row(), [], { id: "x:1", injection: true, ratings: [{ project: "app", score: 8, do: "read", why: "fine" }] });
  assert.equal(orchFlag.ratings[0].why, "");
  assert.equal(orchFlag.injection, true);
});

test("rateRow: an item tied to no project gets one general rating from its band", () => {
  const out = rateRow(row({ urgencyLabel: "later", projects: [] }), [], null);
  assert.equal(out.ratings.length, 1);
  assert.equal(out.ratings[0].project, null);
  assert.ok(out.rating >= 2 && out.rating <= 5.9);
});

import { checkRateAnswer, ratePayload } from "../scripts/lib/rate.mjs";

test("checkRateAnswer keeps a well-formed answer and only the item's own projects", () => {
  const item = row({ projects: ["app", "site"] });
  const a = checkRateAnswer({ id: "x:1", ratings: [
    { project: "app", score: 8.2, do: "update-code", why: "w" }, { project: "site", score: 6, do: "read", why: "w" },
    { project: "evil", score: 10, do: "read", why: "w" }], injection: false, extra: "dropped" }, item);
  assert.deepEqual(a.ratings.map((r) => r.project), ["app", "site"]);
  assert.equal(a.injection, false);
  assert.equal(a.extra, undefined);
});

test("checkRateAnswer rejects answers that miss a project or have a bad score, so the batch is retried", () => {
  const item = row({ projects: ["app", "site"] });
  assert.throws(() => checkRateAnswer({ id: "x:1", ratings: [{ project: "app", score: 8, do: "read", why: "" }] }, item), /site/);
  assert.throws(() => checkRateAnswer({ id: "x:1", ratings: [{ project: "app", score: "8", do: "read" }, { project: "site", score: 5, do: "read" }] }, item), /score/);
  assert.throws(() => checkRateAnswer({ id: "x:1", ratings: [{ project: "app", score: 11, do: "read" }, { project: "site", score: 5, do: "read" }] }, item), /score/);
  assert.throws(() => checkRateAnswer(undefined, item), /missing/);
});

test("ratePayload gives the orchestrator each project's range and evidence names, never file contents", () => {
  const r = row({ title: "T", text: "body", source: "claude-code", provenance: "anthropic-release", effect: "fixes", why: "w",
    type: "model", action: "model-refresh", risk: "deprecation", riskExposed: true, riskWhy: "rw" });
  const p = ratePayload(r, [ev({ checked: ["claude-opus-4-1"], found: [{ term: "claude-opus-4-1", file: "src/a.ts", text: "SECRET CONTENT" }] })]);
  assert.deepEqual(p.projects, [{ id: "app", range: [7, 10], evidence: "confirmed", note: "", found: ["claude-opus-4-1 in src/a.ts"], mentioned: [] }]);
  assert.equal(p.lenses.type, "model");
  assert.doesNotMatch(JSON.stringify(p), /SECRET CONTENT/);
});

test("ratePayload carries mentions as context, apart from what was found (B-47)", () => {
  const p = ratePayload(row({ urgencyLabel: "soon" }), [ev({ checked: ["claude-api"], found: [], mentioned: [{ term: "claude-api", file: "docs/d.md", text: "SECRET" }] })]);
  assert.deepEqual(p.projects[0].found, []);
  assert.deepEqual(p.projects[0].mentioned, ["claude-api in docs/d.md"]);
  assert.equal(p.projects[0].evidence, "mentioned");
  assert.doesNotMatch(JSON.stringify(p), /SECRET/);
});

test("an urgent item tied to no project is never 'provisional': no orchestrator call is planned for it", () => {
  const g = rateRow(row({ projects: [] }), [], null).ratings[0];
  assert.equal(g.project, null);
  assert.equal(g.provisional, false);
});

test("the injection flag fails closed: true in any spelling counts", () => {
  const item = row({ projects: ["app"] });
  const base = { id: "x:1", ratings: [{ project: "app", score: 8, do: "read", why: "w" }] };
  for (const v of [true, "true", "TRUE"]) assert.equal(checkRateAnswer({ ...base, injection: v }, item).injection, true, String(v));
  for (const v of [false, undefined, "false"]) assert.equal(checkRateAnswer({ ...base, injection: v }, item).injection, false, String(v));
});

// B-29 and B-33: polarity by item kind, using each project's model inventory (verify.mjs models.json).
import { ADOPTED_CAP } from "../scripts/lib/rate.mjs";
const inv = (models, partial = false) => ({ app: { models, partial } });
const launch = row({ type: "model", risk: "behavior-change", title: "v2.1.280", text: "Added Claude Opus 5.5 (`claude-opus-5-5`), now the default Opus model" });
const foundOpus = [ev({ checked: ["claude-opus-5-5"], found: [{ term: "claude-opus-5-5", file: "settings.json" }] })];
const missOpus = [ev({ checked: ["claude-opus-5-5"], found: [] })];

test("launch already adopted: capped near 5, older ids in use named", () => {
  assert.equal(ADOPTED_CAP, 5);
  const b = bounds(launch, "app", foundOpus, inv(["claude-opus-5-5"]));
  assert.equal(b.evidence, "adopted");
  assert.equal(b.hi, 5);
  assert.ok(b.lo <= b.hi);
  assert.match(b.note, /already uses claude-opus-5-5/);
  const mixed = bounds(launch, "app", foundOpus, inv(["claude-opus-4-8", "claude-opus-5", "claude-opus-5-5"]));
  assert.equal(mixed.evidence, "adopted", "mixed ids count as adopted (Gabriel, 2026-10-09)");
  assert.equal(mixed.hi, 5);
  assert.match(mixed.note, /claude-opus-4-8/);
  assert.match(mixed.note, /claude-opus-5\b/);
});

test("launch with an older model of the same family: upgrade candidate, band open even though the new id is not found", () => {
  const b = bounds(launch, "app", missOpus, inv(["claude-opus-4-8", "claude-haiku-4-5", "claude-sonnet-4-6"]));
  assert.equal(b.evidence, "upgrade");
  assert.equal(b.hi, 10);
  assert.match(b.note, /upgrade from claude-opus-4-8/);
});

test("launch for a project on another family only: capped at 7.9 (same family only, Gabriel 2026-10-09)", () => {
  const b = bounds(launch, "app", missOpus, inv(["claude-sonnet-4-6"]));
  assert.equal(b.evidence, "other-models");
  assert.equal(b.hi, 7.9);
  assert.match(b.note, /claude-sonnet-4-6/);
});

test("launch for a project with no model id and no alias: unknown, never capped (B-39: absence is unknown)", () => {
  const b = bounds(launch, "app", missOpus, inv([]));
  assert.equal(b.evidence, "unknown");
  assert.equal(b.hi, 10);
  assert.match(b.note, /no model id or alias found/);
});

test("partly searched project: a found model still counts, an absent one is 'file check incomplete', never capped", () => {
  assert.equal(bounds(launch, "app", foundOpus, inv(["claude-opus-5-5"], true)).evidence, "adopted");
  const b = bounds(launch, "app", [ev({ checked: [], found: [] })], inv(["claude-sonnet-4-6"], true));
  assert.equal(b.evidence, "incomplete");
  assert.equal(b.hi, 10);
  assert.match(b.note, /incomplete/);
});

test("retirements keep today's behaviour: found = confirmed (open), not found = 7.9", () => {
  const retire = row({ type: "breaking-or-deprecation", risk: "deprecation", text: "Claude Sonnet 4.5 (`claude-sonnet-4-5`) retires on 2026-11-01" });
  const hit = bounds(retire, "app", [ev({ checked: ["claude-sonnet-4-5"], found: [{ term: "claude-sonnet-4-5", file: "a.ts" }] })], inv(["claude-sonnet-4-5"]));
  assert.equal(hit.evidence, "confirmed");
  assert.equal(hit.hi, 10);
  const miss = bounds(retire, "app", [ev({ checked: ["claude-sonnet-4-5"], found: [] })], inv(["claude-opus-4-8"]));
  assert.equal(miss.evidence, "not-found");
  assert.equal(miss.hi, 7.9);
  // a model item whose risk is a deprecation is a retirement, not a launch
  const modelRetire = row({ ...retire, type: "model" });
  assert.equal(bounds(modelRetire, "app", [ev({ checked: ["claude-sonnet-4-5"], found: [{ term: "claude-sonnet-4-5", file: "a.ts" }] })], inv(["claude-sonnet-4-5"])).evidence, "confirmed");
});

const sonnetBreak = row({ type: "breaking-or-deprecation", risk: "breaking",
  text: "Code written for Claude Sonnet 5 can break on Claude Sonnet 5.5 in five ways. The advisor tool rejects Claude Opus 4.8, Claude Opus 4.7, and Claude Sonnet 5 as advisors." });

test("B-33: a change scoped to models the project does not use is capped at 7.9 and says when it applies", () => {
  const b = bounds(sonnetBreak, "app", [], inv(["claude-sonnet-4-6"]));
  assert.equal(b.evidence, "other-models");
  assert.equal(b.hi, 7.9);
  assert.match(b.note, /claude-sonnet-5-5/);
});

test("B-33: the band stays open when the project uses one of the named models, or its models are unknown", () => {
  assert.equal(bounds(sonnetBreak, "app", [], inv(["claude-opus-4-8", "claude-opus-5-5"])).hi, 10);
  assert.equal(bounds(sonnetBreak, "app", [], inv([])).hi, 10, "no model ids: cannot tell which model it runs");
  assert.equal(bounds(sonnetBreak, "app", [], inv(["claude-sonnet-4-6"], true)).hi, 10, "partly searched");
  assert.equal(bounds(sonnetBreak, "app", [], undefined).hi, 10, "no inventory at all (verify not run yet)");
  const confirmedOther = [ev({ checked: ["computer_20251124"], found: [{ term: "computer_20251124", file: "a.ts" }] })];
  assert.equal(bounds(sonnetBreak, "app", confirmedOther, inv(["claude-sonnet-4-6"])).evidence, "confirmed", "a confirmed name keeps the band open");
});

// B-39: aliases are recorded, never resolved (P-14). An alias user is exposed to launches and
// retirements in the alias's family, at soon, and is asked to confirm which model the alias runs.
const withAliases = (models, aliases) => ({ app: { models, aliases, partial: false } });
const sonnetAlias = { alias: "sonnet", family: "sonnet", file: "scripts/run.mjs", line: 14 };
const sonnetLaunch = row({ type: "model", risk: "behavior-change", urgencyLabel: "later", text: "Added Claude Sonnet 5.5 (`claude-sonnet-5-5`), now the default Sonnet model" });
const haikuLaunch = row({ type: "model", risk: "none", text: "We've launched Claude Haiku 5.5 (claude-haiku-5-5)" });

test("an alias user and a launch in the alias's family: soon band, 'confirm which model', with file:line (P-14, LCW 2)", () => {
  for (const label of ["urgent", "soon", "later", "none"]) {
    const b = bounds({ ...sonnetLaunch, urgencyLabel: label }, "app", [], withAliases([], [sonnetAlias]));
    assert.equal(b.evidence, "alias", label);
    assert.deepEqual([b.lo, b.hi], BANDS.soon, label);
    assert.match(b.note, /your `sonnet` alias may have moved: confirm which model it runs \(scripts\/run\.mjs:14\)/);
  }
  const lens = { alias: "sonnet", family: "sonnet", file: ".claude/lenses/l.md", line: 3 };
  assert.match(bounds(sonnetLaunch, "app", [], withAliases([], [lens, sonnetAlias])).note, /\(scripts\/run\.mjs:14\)/, "a code file is cited before front matter");
  assert.match(bounds(sonnetLaunch, "app", [], withAliases([], [lens])).note, /\(\.claude\/lenses\/l\.md:3\)/);
});

test("an alias of another family only: other-models, not upgrade and not unknown (LCW 1)", () => {
  const b = bounds(haikuLaunch, "app", [], withAliases([], [sonnetAlias]));
  assert.equal(b.evidence, "other-models");
  assert.match(b.note, /`sonnet` alias/);
});

test("a pinned id of the launched family decides before an alias does", () => {
  const b = bounds(sonnetLaunch, "app", [], withAliases(["claude-sonnet-4-6"], [sonnetAlias]));
  assert.equal(b.evidence, "upgrade");
  const inherit = bounds(sonnetLaunch, "app", [], withAliases([], [{ alias: "inherit", family: null, file: ".claude/agents/a.md", line: 2 }]));
  assert.equal(inherit.evidence, "unknown", "inherit names no family");
});

test("a retirement in an alias's family: alias, soon (P-14)", () => {
  const retire = row({ type: "breaking-or-deprecation", risk: "deprecation", text: "Claude Sonnet 4.5 (`claude-sonnet-4-5`) retires on 2026-11-01" });
  const b = bounds(retire, "app", [ev({ checked: ["claude-sonnet-4-5"], found: [] })], withAliases([], [sonnetAlias]));
  assert.equal(b.evidence, "alias");
  assert.deepEqual([b.lo, b.hi], BANDS.soon);
  const pinned = bounds(retire, "app", [ev({ checked: ["claude-sonnet-4-5"], found: [{ term: "claude-sonnet-4-5", file: "a.ts" }] })], withAliases(["claude-sonnet-4-5"], [sonnetAlias]));
  assert.equal(pinned.evidence, "confirmed", "a pinned retiring id is still confirmed");
});

test("B-33's other-models cap never applies when an alias of a named family is in use", () => {
  assert.equal(bounds(sonnetBreak, "app", [], withAliases(["claude-haiku-4-5"], [])).evidence, "other-models", "control: without the alias it is capped");
  const b = bounds(sonnetBreak, "app", [], withAliases(["claude-haiku-4-5"], [sonnetAlias]));
  assert.notEqual(b.evidence, "other-models");
});

test("a breaking change in an alias's family: alias, soon, never the open urgent band (M1 checkpoint)", () => {
  const b = bounds(sonnetBreak, "app", [], withAliases(["claude-haiku-4-5"], [sonnetAlias]));
  assert.equal(b.evidence, "alias");
  assert.deepEqual([b.lo, b.hi], BANDS.soon);
  assert.match(b.note, /your `sonnet` alias may have moved: confirm which model it runs \(scripts\/run\.mjs:14\)/);
  const mentioned = bounds(sonnetBreak, "app", [ev({ checked: ["claude-sonnet-5"], found: [], mentioned: [{ term: "claude-sonnet-5", file: "docs/d.md" }] })], withAliases([], [sonnetAlias]));
  assert.equal(mentioned.evidence, "alias", "a mention does not outrank the alias");
  const confirmed = bounds(sonnetBreak, "app", [ev({ checked: ["claude-sonnet-5"], found: [{ term: "claude-sonnet-5", file: "a.ts" }] })], withAliases([], [sonnetAlias]));
  assert.equal(confirmed.evidence, "confirmed", "a pinned id found in code still confirms");
  assert.equal(confirmed.hi, 10);
  const behavior = row({ ...sonnetBreak, risk: "behavior-change" });
  assert.notEqual(bounds(behavior, "app", [], withAliases([], [sonnetAlias])).evidence, "alias", "only breaking and deprecation risks take the alias state");
});

// B-47: a name found only in docs, data records, tests or comments is "mentioned": context, not a
// confirmation and not a "not found".
test("mentioned only: no confirmation, no not-found cap", () => {
  const b = bounds(row({ urgencyLabel: "soon" }), "app", [ev({ checked: ["claude-api"], found: [], mentioned: [{ term: "claude-api", file: "docs/d.md" }] })]);
  assert.equal(b.evidence, "mentioned");
  assert.deepEqual([b.lo, b.hi], BANDS.soon);
  assert.deepEqual(b.foundIn, []);
  assert.match(b.note, /named only in docs, data or comments: claude-api in docs\/d\.md/);
});

test("rateRow carries the note and the new caps through to each project's rating", () => {
  const r = { ...launch, projects: ["setup", "new-compass"] };
  const models = { setup: { models: ["claude-opus-5-5"], partial: false }, "new-compass": { models: ["claude-opus-4-8"], partial: false } };
  const evs = [{ project: "setup", ...foundOpus[0], project: "setup" }, { ...missOpus[0], project: "new-compass" }];
  const orch = { id: "x:1", ratings: [{ project: "setup", score: 9, do: "read", why: "w" }, { project: "new-compass", score: 9, do: "model-refresh", why: "w" }] };
  const out = rateRow(r, evs, orch, models);
  const s = out.ratings.find((x) => x.project === "setup"), n = out.ratings.find((x) => x.project === "new-compass");
  assert.equal(s.score, 5);
  assert.equal(s.evidence, "adopted");
  assert.match(s.note, /already uses/);
  assert.equal(n.score, 9);
  assert.equal(n.evidence, "upgrade");
  assert.equal(out.ratingProject, "new-compass", "the upgrade candidate now leads, not the project that already moved");
  const p = ratePayload(r, evs, models).projects.find((x) => x.id === "new-compass");
  assert.equal(p.evidence, "upgrade");
  assert.match(p.note, /claude-opus-4-8/);
});

// Stale ratings: an answer given under a range or file-check result that no longer holds is rated again.
import { seenFor, staleRating } from "../scripts/lib/rate.mjs";

test("seenFor records each project's range and evidence as the orchestrator saw them", () => {
  const r = { ...launch, projects: ["app"] };
  assert.deepEqual(seenFor(r, missOpus, inv(["claude-opus-4-8"])), { app: [7, 10, "upgrade"] });
});

test("staleRating: same range and evidence = fresh; a changed range or evidence = stale", () => {
  const r = { ...launch, projects: ["app"] };
  const stored = { id: "x:1", ratings: [{ project: "app", score: 8 }], seen: seenFor(r, missOpus, inv(["claude-opus-4-8"])) };
  assert.equal(staleRating(r, stored, missOpus, inv(["claude-opus-4-8"])), false);
  assert.equal(staleRating(r, stored, foundOpus, inv(["claude-opus-5-5"])), true, "the project moved to the new model");
  assert.equal(staleRating({ ...r, projects: ["app", "site"] }, stored, missOpus, inv(["claude-opus-4-8"])), true, "a project with no answer yet");
});

test("staleRating for answers stored before 0.3.0 (no seen): stale only where the model check changes the range or evidence", () => {
  const r = { ...launch, projects: ["app"] };
  const legacy = { id: "x:1", ratings: [{ project: "app", score: 9 }] };
  assert.equal(staleRating(r, legacy, foundOpus, inv(["claude-opus-5-5"])), true, "adopted: 7 to 10 became 5");
  assert.equal(staleRating(r, legacy, missOpus, inv([])), true, "no model id or alias: unknown, no longer the not-found cap (B-39)");
  const retire = { ...row({ type: "breaking-or-deprecation", risk: "deprecation", text: "`claude-sonnet-4-5` retires" }), projects: ["app"] };
  assert.equal(staleRating(retire, legacy, [ev({ checked: ["claude-sonnet-4-5"], found: [] })], inv(["claude-opus-4-8"])), false, "retirements are unchanged");
});

// B-40 (AK 4): a skill's new default, or a default-model change, shapes code Claude writes from now
// on and changes no existing call. A project other than setup with no model alias gets "read" at
// most, in the later band, with code's line; setup, alias users and tripwire items keep their band.
const skillDefault = row({ source: "skills", type: "model", risk: "behavior-change", text: "Update claude-api skill: Claude Opus 5.5 default. Make Claude Opus 5.5 (`claude-opus-5-5`) the default model" });
const appOnly = { app: { models: ["claude-sonnet-4-6"], aliases: [], partial: false }, setup: { models: [], aliases: [], partial: false } };

test("B-40: a skill or default change is 'read' at most, later band, for an app project with no alias (AK 4)", () => {
  const b = bounds(skillDefault, "app", [], appOnly);
  assert.ok(b.hi <= BANDS.later[1], `hi ${b.hi}`);
  assert.match(b.note, /code Claude writes from now on/);
  const r = rateRow({ ...skillDefault, projects: ["app"] }, [], { id: "x:1", ratings: [{ project: "app", score: 9, do: "model-refresh", why: "w" }] }, appOnly);
  assert.equal(r.ratings[0].do, "read");
  assert.ok(r.ratings[0].score <= BANDS.later[1]);
  for (const text of ["Changed the default model on Pro and Team Standard plans from Sonnet to Opus", "Fixed the `claude-api` skill suggesting an old SDK call"]) {
    assert.ok(bounds(row({ source: "claude-code", type: "behavior-change", risk: "behavior-change", text }), "app", [], appOnly).hi <= BANDS.later[1], text);
  }
});

// Gabriel, 2026-10-13: a skill's default never moves an alias, so skill commits cap alias users too
// (admitkit's lens front matter aliases had kept the claude-api skill item an 8.5 upgrade).
test("B-40: a skill commit caps alias users too; a Claude Code default-model change does not (LCW 2)", () => {
  const aliased = withAliases(["claude-sonnet-4-6"], [sonnetAlias]);
  assert.ok(bounds(skillDefault, "app", [], aliased).hi <= BANDS.later[1], "a skill commit");
  const ccDefault = row({ source: "claude-code", type: "behavior-change", risk: "behavior-change", text: "Changed the default model on Pro plans from Sonnet to Opus" });
  assert.ok(bounds(ccDefault, "app", [], aliased).hi > BANDS.later[1], "a default change can move what an alias runs");
});

test("B-40: setup, tripwire items and other Claude Code items keep their band", () => {
  assert.ok(bounds(skillDefault, "setup", [], appOnly).hi > BANDS.later[1], "setup");
  assert.ok(bounds({ ...skillDefault, type: "security", risk: "security" }, "app", [], appOnly).hi > BANDS.later[1], "a security item (P-4)");
  assert.ok(bounds(row({ source: "claude-code", type: "bug-fix", risk: "none", text: "Fixed a crash on startup" }), "app", [], appOnly).hi > BANDS.later[1]);
});
