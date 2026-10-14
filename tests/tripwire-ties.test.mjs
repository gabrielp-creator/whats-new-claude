// B-66 (ties): a first-party security, breaking, deprecation or retirement item that no project is
// tied to is checked against every project, and tied where the project's own config or code uses its
// terms. The end-to-end test runs the real verify.mjs and loadRows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { tripwireTies } from "../scripts/lib/ties.mjs";
import { loadRows } from "../scripts/lib/rows.mjs";
import { readJsonl } from "../scripts/lib/store.mjs";

const results = new Map([
  ["app", { found: [{ term: "streamTimeoutMs", file: "src/llm.ts" }], mentioned: [] }],
  ["docs", { found: [], mentioned: [{ term: "streamTimeoutMs", file: "README.md" }] }],
  ["web", null],
]);
const row = (over) => ({ source: "agent-sdk-ts", fyiOnly: false, type: "security", risk: "security", tripwires: [], projects: [], ...over });
const tied = (r) => tripwireTies(r, results).map((t) => `${t.project}:${t.tiedBy}:${t.ids.join(",")}`);

test("an untied tripwire item is tied where the project's config or code uses its terms; a mention is not use", () => {
  assert.deepEqual(tied(row({})), ["app:tripwire:streamTimeoutMs"]);
  assert.deepEqual(tied(row({ type: "breaking-or-deprecation", risk: "breaking" })), ["app:tripwire:streamTimeoutMs"]);
  assert.deepEqual(tied(row({ type: "bug-fix", risk: "none", tripwires: ["deprecation"] })), ["app:tripwire:streamTimeoutMs"]);
});

test("a project dropped for the item (no SDK package) is not tied back by its terms", () => {
  assert.deepEqual(tripwireTies(row({}), results, { dropped: new Set(["app"]) }), []);
});

// Found in dogfood: generic words (`session_id`, `_meta`) tied SDK items to projects without the SDK.
test("an SDK item is tied by its terms only where the project has that SDK, or its manifests are unread", () => {
  const profiles = { app: { packages: [{ name: "@anthropic-ai/sdk", file: "package.json" }] } };
  assert.deepEqual(tripwireTies(row({}), results, { profiles }), [], "only the API SDK: B-58's gate holds");
  assert.equal(tripwireTies(row({}), results, { profiles, partial: new Set(["app"]) }).length, 1, "a capped walk may hide the package");
  const withSdk = { app: { packages: [{ name: "@anthropic-ai/claude-agent-sdk", file: "package.json" }] } };
  assert.equal(tripwireTies(row({}), results, { profiles: withSdk }).length, 1);
  assert.equal(tripwireTies(row({ source: "claude-code" }), results, { profiles }).length, 1, "the gate is for SDK items only");
});

test("only untied, first-party tripwire items", () => {
  assert.deepEqual(tied(row({ projects: ["web"] })), [], "already tied somewhere: the lens and code ties stand");
  assert.deepEqual(tied(row({ type: "bug-fix", risk: "none" })), [], "not a tripwire item");
  assert.deepEqual(tied(row({ fyiOnly: true })), [], "fork and third-party items stay FYI (P-29)");
});

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

test("verify ties an untied security item to the project whose code uses its option (P-27)", () => {
  const ws = mkdtempSync(join(tmpdir(), "wnc-ws-")), home = mkdtempSync(join(tmpdir(), "wnc-home-")), data = mkdtempSync(join(tmpdir(), "wnc-data-"));
  mkdirSync(join(ws, "app", "src"), { recursive: true });
  writeFileSync(join(ws, "app", "src", "agent.ts"), "const options = { streamTimeoutMs: 5000 };\n");
  mkdirSync(join(ws, "docs"), { recursive: true });
  writeFileSync(join(ws, "docs", "notes.md"), "We read about `streamTimeoutMs` once.\n");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(data, "config.json"), JSON.stringify({ workspaceRoot: ws, projects: [
    { id: "app", description: "An app", path: "app", briefDir: "app/briefs" },
    { id: "docs", description: "Notes", path: "docs", briefDir: "docs/briefs" },
  ] }));
  const item = (n, text) => ({ id: `platform:2026-10-10:${n}`, source: "platform-release-notes", date: "2026-10-10", title: "Claude Platform release notes", text, url: "https://platform.claude.com/docs/en/release-notes/overview", provenance: "anthropic-docs", tripwires: [] });
  const items = [item(0, "Fixed `streamTimeoutMs` being ignored, which let a stalled stream hold a connection open"), item(1, "Fixed `streamTimeoutMs` showing the wrong unit in the console")];
  writeFileSync(join(data, "items.jsonl"), jsonl(items));
  // A steered batch (P-27): the lens tied the security fix to nobody and saw no effect.
  writeFileSync(join(data, "lens-impact.jsonl"), jsonl(items.map((i) => ({ id: i.id, effect: "none", projects: [], new_work: false, strength: "low", why: "w", injection: false }))));
  writeFileSync(join(data, "lens-type.jsonl"), jsonl(items.map((i, n) => ({ id: i.id, type: n === 0 ? "security" : "bug-fix", action: "read", injection: false }))));
  writeFileSync(join(data, "lens-risk.jsonl"), jsonl(items.map((i, n) => ({ id: i.id, risk: n === 0 ? "security" : "none", exposed: false, why: "rw", injection: false }))));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "..", "scripts", "verify.mjs"), "--data", data], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(r.status, 0, r.stderr);

  const rows = new Map(loadRows(data).rows.map((x) => [x.id.split(":").pop(), x]));
  assert.deepEqual(rows.get("0").projects, ["app"]);
  assert.equal(rows.get("0").ratings[0].evidence, "confirmed");
  assert.deepEqual(rows.get("1").projects, [], "a bug fix is not checked against every project");
  const ev = readJsonl(join(data, "evidence.jsonl")).filter((e) => e.id.endsWith(":0"));
  assert.deepEqual(ev.map((e) => [e.project, e.tiedBy, e.ties]), [["app", "tripwire", ["streamTimeoutMs"]]]);
  assert.match(r.stdout, /1 by tripwire term/);
});
