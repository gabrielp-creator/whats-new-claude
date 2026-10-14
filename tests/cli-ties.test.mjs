// B-59 (ties): a Claude Code item leaves a project whose own scripted claude calls switch its subject
// feature off, and is tied to setup instead (P-4); tripwire items are held, never dropped. The
// end-to-end test runs the real verify.mjs and loadRows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { subjectFeatures, cliTies } from "../scripts/lib/ties.mjs";
import { loadRows } from "../scripts/lib/rows.mjs";
import { readJsonl } from "../scripts/lib/store.mjs";

test("subjectFeatures: a closed list of what an item is about", () => {
  const f = (t) => [...subjectFeatures(t)].sort().join(",");
  assert.equal(f("Fixed background commands being stopped after 30 idle minutes"), "tools");
  assert.equal(f("Changed Bash/PowerShell `timeout` to bound a `run_in_background` command"), "tools");
  assert.equal(f("Fixed `UserPromptSubmit` hooks not firing after /clear"), "hooks");
  assert.equal(f("Fixed MCP servers failing to reconnect"), "mcp");
  assert.equal(f("Fixed plugin agents not joining teams"), "plugins,tools");
  assert.equal(f("Fixed skills with a `!` command running twice"), "skills");
  assert.equal(f("Fixed WebFetch following a redirect to a blocked host"), "tools");
  assert.equal(f("Fixed a crash on startup when the terminal is narrow"), "");
  assert.equal(f("Updated the Agent SDK to accept a `tools` option"), "", "the Agent SDK is not an agent");
});

const OFF = ["scripts/run.sh:3", "scripts/batch.mjs:12"];
const PROFILES = {
  setup: { cli: { status: "none", calls: [], off: {} } },
  bot: { cli: { status: "known", calls: OFF, off: { tools: OFF, mcp: OFF, hooks: OFF } } },
  open: { cli: { status: "unknown", calls: ["run.sh:1"], off: {} } },
  app: { cli: { status: "none", calls: [], off: {} } },
};
const row = (over) => ({ source: "claude-code", fyiOnly: false, type: "bug-fix", risk: "none", tripwires: [], title: "v2", projects: ["bot", "open", "app"], ...over });
const ties = (r, confirmed) => {
  const t = cliTies(r, PROFILES, { confirmed });
  return { drop: t.drop.map((d) => d.project), hold: t.hold.map((d) => d.project), add: t.add.map((a) => `${a.project}:${a.tiedBy}`) };
};

test("dropped only where every feature the item names is off in every scripted call; tied to setup instead", () => {
  assert.deepEqual(ties(row({ text: "Fixed background commands being stopped after 30 idle minutes" })), { drop: ["bot"], hold: [], add: ["setup:setup"] });
  const d = cliTies(row({ text: "Fixed background commands being stopped" }), PROFILES).drop[0];
  assert.equal(d.reason, "cli-off");
  assert.match(d.why, /tools off.*scripts\/run\.sh:3.*scripts\/batch\.mjs:12/);
  // skills are not off for bot: one feature on keeps the tie
  assert.deepEqual(ties(row({ text: "Fixed hooks defined in skills running twice" })), { drop: [], hold: [], add: [] });
  assert.deepEqual(ties(row({ text: "Fixed a crash on startup" })), { drop: [], hold: [], add: [] }, "no subject named: nothing to go on");
});

// Found in dogfood: a feature named beside sessions in general is not the item's whole subject.
test("a feature joined with sessions, runs or turns ('sessions and subagents') keeps the tie", () => {
  for (const text of [
    "Fixed mid-response API timeouts failing the turn: non-interactive sessions and subagents now continue from the partial response",
    "Improved prompt-cache stability: subagents and sessions started with `--system-prompt` now record the system prompt",
  ]) assert.deepEqual(ties(row({ text })), { drop: [], hold: [], add: [] }, text);
  assert.deepEqual(ties(row({ text: "Fixed headless sessions with MCP servers stalling on the first message" })).drop, ["bot"], "'sessions with MCP' is about MCP");
});

test("a project whose calls are unknown or that scripts no calls keeps its ties (P-2)", () => {
  const t = cliTies(row({ text: "Fixed MCP servers failing to reconnect" }), PROFILES);
  assert.deepEqual(t.drop.map((d) => d.project), ["bot"]);
});

test("setup is not re-tied when it is already tied", () => {
  assert.deepEqual(ties(row({ text: "Fixed MCP servers failing to reconnect", projects: ["bot", "setup"] })).add, []);
});

test("tripwire items are held with a note, never dropped, and setup is tied too (P-4)", () => {
  const sec = row({ text: "Fixed WebFetch following a redirect to a blocked host", type: "security", risk: "security" });
  assert.deepEqual(ties(sec), { drop: [], hold: ["bot"], add: ["setup:setup"] });
  assert.match(cliTies(sec, PROFILES).hold[0].why, /^scripted claude calls run with tools off/);
  assert.deepEqual(ties(row({ text: "Fixed background commands", tripwires: ["\\bbreak"], type: "breaking-or-deprecation" })).hold, ["bot"]);
});

test("a tie whose terms the project's own code confirms is never dropped", () => {
  assert.deepEqual(ties(row({ text: "Fixed `--strict-mcp-config` loading MCP servers from settings" }), new Set(["bot"])), { drop: [], hold: [], add: [] });
});

test("only Claude Code items, and FYI items keep their ties untouched", () => {
  assert.deepEqual(ties(row({ source: "agent-sdk-ts", text: "Fixed MCP servers failing to reconnect" })), { drop: [], hold: [], add: [] });
});

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

test("verify drops, holds and re-ties to setup; loadRows shows the result (LCW 5, LCW 7, P-4)", () => {
  const ws = mkdtempSync(join(tmpdir(), "wnc-ws-")), home = mkdtempSync(join(tmpdir(), "wnc-home-")), data = mkdtempSync(join(tmpdir(), "wnc-data-"));
  mkdirSync(join(ws, "bot", "scripts"), { recursive: true });
  writeFileSync(join(ws, "bot", "scripts", "run.sh"), '#!/bin/sh\necho "$PROMPT" | claude -p --tools "" --strict-mcp-config --safe-mode --model sonnet\n');
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), "{}");
  writeFileSync(join(data, "config.json"), JSON.stringify({ workspaceRoot: ws, projects: [
    { id: "setup", description: "Claude Code setup", briefDir: "briefs/setup" },
    { id: "bot", description: "A script that calls claude", path: "bot", briefDir: "bot/docs" },
  ] }));
  const item = (n, text) => ({ id: `claude-code:v2.1.300:${n}`, source: "claude-code", date: "2026-10-10", title: "v2.1.300", text, url: "https://github.com/anthropics/claude-code/releases/tag/v2.1.300", provenance: "anthropic-release", tripwires: [] });
  const items = [
    item(0, "Fixed background commands being stopped after 30 idle minutes"),
    item(1, "Fixed `UserPromptSubmit` hooks not firing after /clear"),
    item(2, "Fixed WebFetch following a redirect to a blocked host"),
    item(3, "Fixed `--strict-mcp-config` loading MCP servers from settings"),
  ];
  writeFileSync(join(data, "items.jsonl"), jsonl(items));
  writeFileSync(join(data, "lens-impact.jsonl"), jsonl(items.map((i) => ({ id: i.id, effect: "fixes", projects: ["bot"], new_work: false, strength: "medium", why: "w", injection: false }))));
  writeFileSync(join(data, "lens-type.jsonl"), jsonl(items.map((i, n) => ({ id: i.id, type: n === 2 ? "security" : "bug-fix", action: "read", injection: false }))));
  writeFileSync(join(data, "lens-risk.jsonl"), jsonl(items.map((i, n) => ({ id: i.id, risk: n === 2 ? "security" : "none", exposed: n === 2, why: "rw", injection: false }))));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "..", "scripts", "verify.mjs"), "--data", data], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(r.status, 0, r.stderr);

  const rows = new Map(loadRows(data).rows.map((x) => [x.id.split(":").pop(), x]));
  assert.deepEqual(rows.get("0").projects, ["setup"]);
  assert.deepEqual(rows.get("0").dropped.map((d) => [d.project, d.reason]), [["bot", "cli-off"]]);
  assert.match(rows.get("0").dropped[0].why, /tools off \(scripts\/run\.sh:2\)/);
  assert.deepEqual(rows.get("1").projects, ["setup"], "hooks are off: --safe-mode");
  assert.deepEqual(rows.get("2").projects, ["bot", "setup"], "a security item stays and setup gets it too");
  assert.match(rows.get("2").ratings.find((x) => x.project === "bot").note, /scripted claude calls run with tools off/);
  assert.deepEqual(rows.get("3").projects, ["bot"], "the item's own flag is in the project's code");
  const ev = readJsonl(join(data, "evidence.jsonl"));
  assert.ok(ev.some((e) => e.id.endsWith(":2") && e.project === "bot" && /tools off/.test(e.held)));
  assert.match(r.stdout, /2 dropped \(2 cli-off\)/);
});
