// M3 ties made by code (B-48): a project whose used models fall inside an item's scope is tied to it
// even when the impact lens left it out. The end-to-end test runs the real verify.mjs and loadRows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { modelTies, sdkTies, API, RUNTIME } from "../scripts/lib/ties.mjs";
import { loadRows } from "../scripts/lib/rows.mjs";
import { readJsonl } from "../scripts/lib/store.mjs";

const inv = (ids, extra = {}) => ({ models: ids, used: ids.map((id, n) => ({ id, file: "src/a.ts", line: n + 1 })), aliases: [], mentioned: [], claudeCalls: [], ...extra });
const MODELS = {
  setup: inv(["claude-opus-5-5"]),
  app: inv(["claude-haiku-4-5"]),
  web: inv(["claude-opus-4-8"]),
  bot: inv(["claude-opus-4-8"], { claudeCalls: [{ file: "scripts/run.sh", line: 3 }] }),
  docs: inv([]),
};
const row = (over) => ({ source: "platform-release-notes", fyiOnly: false, type: "breaking-or-deprecation", risk: "breaking", title: "Claude Platform release notes", projects: [], ...over });
const tied = (r, models = MODELS) => modelTies(r, models).map((t) => `${t.project}:${t.ids.join(",")}`);

// NC 2, LNC 3: the breaking note the impact lens tied to nobody.
const HAIKU_BREAKS = "Code written for Claude Haiku 4.5 can break on Claude Haiku 5.5. Manual extended thinking (budget_tokens) returns a 400 error. See the migration guide.";

test("a platform note reaches every project whose used model is in its scope", () => {
  assert.deepEqual(tied(row({ text: HAIKU_BREAKS })), ["app:claude-haiku-4-5"]);
  const t = modelTies(row({ text: HAIKU_BREAKS }), MODELS)[0];
  assert.equal(t.tiedBy, "model");
});

test("a project the lens already tied is not tied again", () => {
  assert.deepEqual(tied(row({ text: HAIKU_BREAKS, projects: ["app"] })), []);
});

test("out and unknown never tie: a closed scope that leaves the model out, open wording, family names", () => {
  assert.deepEqual(tied(row({ text: "On Claude Opus 5.5, thinking can't be disabled. tool_choice also returns a 400 error, as on Claude Haiku 4.5." })), ["setup:claude-opus-5-5"]);
  assert.deepEqual(tied(row({ text: "Findings now also cover models without tuned settings, including Opus 4.8" })), ["web:claude-opus-4-8", "bot:claude-opus-4-8"]);
  assert.deepEqual(tied(row({ text: "Opus sessions now compact shortly before the limit" })), []);
  assert.deepEqual(tied(row({ text: "Fixed a crash when resuming a session" })), []);
});

// NC 3: a launch for a family in use reaches the project from the source whose lens left it out.
test("a launch ties projects that use the launched model or an older one of its family", () => {
  const launch = row({ type: "model", risk: "behavior-change", text: "We've launched Claude Haiku 5.5 (claude-haiku-5-5), now the default Haiku model." });
  assert.deepEqual(tied(launch), ["app:claude-haiku-4-5"]);
  assert.deepEqual(tied({ ...launch, text: "We've launched Claude Opus 5.5 (claude-opus-5-5)" }), ["setup:claude-opus-5-5", "web:claude-opus-4-8", "bot:claude-opus-4-8"]);
});

// P-10: an item the type lens calls "model" is a launch only with a launch verb; otherwise its scope decides.
test("'available for X' typed as a model item ties by scope, not as an upgrade for older models", () => {
  const avail = row({ type: "model", risk: "none", text: "Both toolsets are available for Claude Opus 5 and Claude Sonnet 5 on the Claude API." });
  assert.deepEqual(tied(avail, { a: inv(["claude-sonnet-4-6"]), b: inv(["claude-sonnet-5"]) }), ["b:claude-sonnet-5"]);
});

// P-1: the range texts are in scope for a project on a newer model.
test("ranges tie: 'Opus 4.8, Sonnet 5, ... and newer models'", () => {
  const t = "Todo/task-tracking tools are no longer available on Opus 4.8, Sonnet 5, Fable 5, Mythos 5, and newer models";
  assert.deepEqual(tied(row({ text: t, type: "breaking-or-deprecation" })), ["setup:claude-opus-5-5", "web:claude-opus-4-8", "bot:claude-opus-4-8"]);
});

test("a Claude Code item ties only the projects that run Claude Code: setup and those that script claude", () => {
  const t = "Changed Opus 4.7+ and Fable to use a 1M context window by default on Bedrock";
  assert.deepEqual(tied(row({ source: "claude-code", type: "behavior-change", risk: "behavior-change", text: t })), ["setup:claude-opus-5-5", "bot:claude-opus-4-8"]);
});

test("no model ties from skills, cookbooks or SDK items (B-40, B-58), nor for FYI-only items (P-29)", () => {
  for (const source of ["skills", "cookbooks", "agent-sdk-ts", "agent-sdk-py"]) assert.deepEqual(tied(row({ source, text: HAIKU_BREAKS })), [], source);
  assert.deepEqual(tied(row({ text: HAIKU_BREAKS, fyiOnly: true })), []);
  assert.deepEqual(modelTies(row({ text: HAIKU_BREAKS }), undefined), [], "no models.json: nothing to tie on");
});

// The tie rule names sources by id: an id fetch.mjs never writes would tie nothing, silently (a test
// fixture with a made-up "platform" id once passed while the real data tied nothing).
test("every source id the tie rule names is one fetch.mjs writes", () => {
  const fetch = readFileSync(join(import.meta.dirname, "..", "scripts", "fetch.mjs"), "utf8");
  const written = new Set([...fetch.matchAll(/source: "([\w-]+)"/g)].map((m) => m[1]));
  for (const m of fetch.matchAll(/^\s+"?([\w-]+)"?: \(s\) => github\w+\("[^"]+", "([\w-]+)"/gm)) written.add(m[2]);
  for (const section of fetch.match(/anthropic\\\.com\\\/\(([\w|]+)\)/)[1].split("|")) written.add(`anthropic-${section}`);
  assert.ok(written.has("claude-code") && written.has("platform-release-notes"), `parsed ${[...written]}`);
  for (const id of [...API, ...RUNTIME]) assert.ok(written.has(id), `${id} is not a source fetch.mjs writes`);
});

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

test("verify stores code ties in evidence.jsonl with tiedBy, and loadRows adds the project (P-25)", () => {
  const ws = mkdtempSync(join(tmpdir(), "wnc-ws-")), home = mkdtempSync(join(tmpdir(), "wnc-home-")), data = mkdtempSync(join(tmpdir(), "wnc-data-"));
  mkdirSync(join(ws, "app", "src"), { recursive: true });
  writeFileSync(join(ws, "app", "src", "llm.ts"), 'const MODEL = "claude-haiku-4-5-20251001";\n');
  mkdirSync(join(ws, "web", "src"), { recursive: true });
  writeFileSync(join(ws, "web", "src", "llm.ts"), 'const MODEL = "claude-opus-4-8";\n');
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(data, "config.json"), JSON.stringify({ workspaceRoot: ws, projects: [
    { id: "setup", description: "Claude Code setup", briefDir: "briefs/setup" },
    { id: "app", description: "An app", path: "app", briefDir: "app/docs" },
    { id: "web", description: "A site", path: "web", briefDir: "web/docs" },
  ] }));
  const items = [
    { id: "platform:2026-10-07:2", source: "platform-release-notes", date: "2026-10-07", title: "Claude Platform release notes", text: HAIKU_BREAKS, url: "https://platform.claude.com/docs/en/release-notes/overview", provenance: "anthropic-release", tripwires: ["\\bbreak"] },
    { id: "platform:2026-10-07:3", source: "platform-release-notes", date: "2026-10-07", title: "Claude Platform release notes", text: "Fixed a dashboard typo", url: "https://platform.claude.com/docs/en/release-notes/overview", provenance: "anthropic-release", tripwires: [] },
  ];
  writeFileSync(join(data, "items.jsonl"), jsonl(items));
  // The lens tied the breaking note to nobody and saw no effect: the filter at the term check must not hide it.
  writeFileSync(join(data, "lens-impact.jsonl"), jsonl(items.map((i) => ({ id: i.id, effect: "none", projects: [], new_work: false, strength: "low", why: "w", injection: false }))));
  writeFileSync(join(data, "lens-type.jsonl"), jsonl(items.map((i) => ({ id: i.id, type: "breaking-or-deprecation", action: "read", injection: false }))));
  writeFileSync(join(data, "lens-risk.jsonl"), jsonl(items.map((i) => ({ id: i.id, risk: "none", exposed: false, why: "rw", injection: false }))));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "..", "scripts", "verify.mjs"), "--data", data], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(r.status, 0, r.stderr);

  const ev = readJsonl(join(data, "evidence.jsonl")).filter((e) => e.id === "platform:2026-10-07:2");
  assert.deepEqual(ev.map((e) => [e.project, e.tiedBy, e.ties]), [["app", "model", ["claude-haiku-4-5"]]]);
  const { rows } = loadRows(data);
  assert.deepEqual(rows.find((x) => x.id === "platform:2026-10-07:2").projects, ["app"]);
  assert.deepEqual(rows.find((x) => x.id === "platform:2026-10-07:3").projects, []);
  assert.match(r.stdout, /ties: 1 added by model,/);
});

// B-58 (LNC 5): SDK items reach only projects that have that SDK, and every project that has it.
const profile = (packages) => ({ packages: packages.map((name) => ({ name, file: "package.json" })) });
const PROFILES = {
  setup: profile([]),
  app: profile(["@anthropic-ai/sdk"]), // the API SDK only
  agent: profile(["@anthropic-ai/claude-agent-sdk"]),
  pyagent: { packages: [{ name: "claude-agent-sdk", file: "pyproject.toml" }] },
  big: profile([]), // walk capped: its manifests may be unread
};
const sdk = (r, partial = new Set(["big"])) => {
  const { add, drop } = sdkTies(r, PROFILES, { partial });
  return { add: add.map((t) => `${t.project}:${t.tiedBy}:${t.ids.join(",")}`), drop: drop.map((d) => `${d.project}:${d.reason}`) };
};

test("an SDK item the lens tied to a project without that SDK is dropped, with the reason kept", () => {
  const r = row({ source: "agent-sdk-ts", type: "breaking-or-deprecation", text: "Changed `query()` to reject unknown options", projects: ["app", "setup", "big"] });
  const { drop } = sdkTies(r, PROFILES, { partial: new Set(["big"]) });
  assert.deepEqual(drop.map((d) => d.project), ["app", "setup"], "a capped walk is unknown: never dropped (P-2)");
  assert.equal(drop[0].reason, "no-sdk-package");
  assert.match(drop[0].why, /@anthropic-ai\/claude-agent-sdk/);
});

test("a project with the SDK gains that SDK's items; the other SDK's items stay with their own users", () => {
  const ts = row({ source: "agent-sdk-ts", type: "bug-fix", risk: "none", text: "Fixed `query()` hanging", projects: [] });
  assert.deepEqual(sdk(ts), { add: ["agent:sdk:@anthropic-ai/claude-agent-sdk"], drop: [] });
  const py = { ...ts, source: "agent-sdk-py" };
  assert.deepEqual(sdk(py), { add: ["pyagent:sdk:claude-agent-sdk"], drop: [] });
  assert.deepEqual(sdk({ ...ts, projects: ["agent", "pyagent"] }), { add: [], drop: ["pyagent:no-sdk-package"] });
});

test("the package gate is for SDK sources only, and FYI items gain no ties", () => {
  assert.deepEqual(sdk(row({ source: "claude-code", text: "Fixed a hang", projects: ["app"] })), { add: [], drop: [] });
  assert.deepEqual(sdk(row({ source: "agent-sdk-ts", fyiOnly: true, text: "Fixed a hang", projects: [] })), { add: [], drop: [] });
  assert.deepEqual(sdkTies(row({ source: "agent-sdk-ts", text: "x", projects: ["app"] }), undefined, { partial: new Set() }), { add: [], drop: [] }, "no profiles: nothing known");
});

test("verify keeps a dropped tie in evidence.jsonl; loadRows removes the project and lists it as dropped (P-19)", () => {
  const ws = mkdtempSync(join(tmpdir(), "wnc-ws-")), home = mkdtempSync(join(tmpdir(), "wnc-home-")), data = mkdtempSync(join(tmpdir(), "wnc-data-"));
  mkdirSync(join(ws, "app", "orchestrator"), { recursive: true });
  writeFileSync(join(ws, "app", "orchestrator", "package.json"), JSON.stringify({ dependencies: { "@anthropic-ai/sdk": "^1.0.0" } }));
  mkdirSync(join(ws, "agent"), { recursive: true });
  writeFileSync(join(ws, "agent", "package.json"), JSON.stringify({ dependencies: { "@anthropic-ai/claude-agent-sdk": "^0.3.0" } }));
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(data, "config.json"), JSON.stringify({ workspaceRoot: ws, projects: [
    { id: "app", description: "An app", path: "app", briefDir: "app/docs" },
    { id: "agent", description: "An agent", path: "agent", briefDir: "agent/docs" },
  ] }));
  const items = [{ id: "agent-sdk-ts:v0.3.280:1", source: "agent-sdk-ts", date: "2026-10-08", title: "v0.3.280", text: "Fixed `canUseTool` being skipped for subagents", url: "https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.280", provenance: "anthropic-release", tripwires: [] }];
  writeFileSync(join(data, "items.jsonl"), jsonl(items));
  writeFileSync(join(data, "lens-impact.jsonl"), jsonl(items.map((i) => ({ id: i.id, effect: "fixes", projects: ["app"], new_work: false, strength: "medium", why: "w", injection: false }))));
  writeFileSync(join(data, "lens-type.jsonl"), jsonl(items.map((i) => ({ id: i.id, type: "bug-fix", action: "read", injection: false }))));
  writeFileSync(join(data, "lens-risk.jsonl"), jsonl(items.map((i) => ({ id: i.id, risk: "none", exposed: false, why: "rw", injection: false }))));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "..", "scripts", "verify.mjs"), "--data", data], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(r.status, 0, r.stderr);

  const ev = readJsonl(join(data, "evidence.jsonl"));
  assert.deepEqual(ev.map((e) => [e.project, e.tiedBy, e.dropped ?? null]), [["app", "lens", "no-sdk-package"], ["agent", "sdk", null]]);
  const got = loadRows(data).rows[0];
  assert.deepEqual(got.projects, ["agent"]);
  assert.deepEqual(got.dropped.map((d) => [d.project, d.reason]), [["app", "no-sdk-package"]]);
  assert.equal(got.ratings.some((x) => x.project === "app"), false, "the rater never sees a dropped tie");
  assert.match(r.stdout, /1 by SDK package, 0 by tripwire term, 0 moved to setup; 1 dropped \(1 no-sdk-package\)/);
});
