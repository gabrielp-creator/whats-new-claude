import { test } from "node:test";
import assert from "node:assert/strict";
import { sinceFor, mergeItems, recordSource, heartbeatWarnings, OVERLAP_DAYS } from "../scripts/lib/incremental.mjs";
import { lensArgs } from "../scripts/lib/claude.mjs";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const DAY = 864e5;

test("first run looks back the requested number of days", () => {
  assert.equal(sinceFor({ sources: {} }, "claude-code", 30, NOW).getTime(), NOW - 30 * DAY);
});

test("later runs start a little before the last success", () => {
  const state = { sources: { "claude-code": { lastSuccess: "2026-10-01T00:00:00.000Z" } } };
  assert.equal(sinceFor(state, "claude-code", 30, NOW).getTime(), Date.parse("2026-10-01T00:00:00Z") - OVERLAP_DAYS * DAY);
});

test("merge keeps existing items and appends only new ids", () => {
  const { items, added } = mergeItems([{ id: "a", v: 1 }], [{ id: "a", v: 2 }, { id: "b" }, { id: "b" }]);
  assert.deepEqual(items.map((i) => i.id), ["a", "b"]);
  assert.equal(items[0].v, 1, "existing item is not replaced");
  assert.deepEqual(added.map((i) => i.id), ["b"]);
});

test("a failed source never advances lastSuccess and is reported", () => {
  let s = recordSource({ sources: {} }, "skills", { ok: true, newestDate: "2026-10-05" }, NOW);
  const okAt = s.sources.skills.lastSuccess;
  s = recordSource(s, "skills", { ok: false, error: "500" }, NOW + DAY);
  assert.equal(s.sources.skills.lastSuccess, okAt);
  assert.ok(heartbeatWarnings(s, NOW + DAY).some((w) => /skills failed: 500/.test(w)));
  s = recordSource(s, "skills", { ok: true }, NOW + 2 * DAY);
  assert.equal(heartbeatWarnings(s, NOW + 2 * DAY).length, 0, "success clears the error");
  assert.equal(s.sources.skills.newestItem, "2026-10-05", "newest item survives a quiet success");
});

test("a usually busy source that goes quiet is flagged", () => {
  const s = { sources: { "claude-code": { lastSuccess: "2026-10-07T00:00:00Z", newestItem: "2026-09-20" } } };
  assert.ok(heartbeatWarnings(s, NOW).some((w) => /claude-code has published nothing/.test(w)));
  const fresh = { sources: { "claude-code": { lastSuccess: "2026-10-07T00:00:00Z", newestItem: "2026-10-06" } } };
  assert.equal(heartbeatWarnings(fresh, NOW).length, 0);
});

test("lens calls get no tools, no MCP and safe mode, with and without a shell", () => {
  for (const shell of [false, true]) {
    const a = lensArgs("sonnet", "/tmp/p.md", shell);
    assert.equal(a[a.indexOf("--tools") + 1], shell ? '""' : "");
    for (const f of ["-p", "--strict-mcp-config", "--safe-mode", "--no-session-persistence"]) assert.ok(a.includes(f), f);
    // second lock: a deny rule for every tool, documented to remove all tools from Claude's context
    assert.equal(a[a.indexOf("--disallowedTools") + 1], shell ? '"*"' : "*");
  }
});

import { prNumber } from "../scripts/lib/incremental.mjs";
import { injectionFlag } from "../scripts/lib/batch.mjs";

test("commit provenance uses the merge's own PR number: the last (#N) in the title", () => {
  assert.equal(prNumber("Add skill (#12) (#987)"), 987, "a fork can put an internal PR number earlier in its title");
  assert.equal(prNumber("Fix typo (#45)\n\nBody mentions (#3)"), 45, "only the first line counts");
  assert.equal(prNumber("Direct commit"), null);
  assert.equal(injectionFlag("true"), true);
  assert.equal(injectionFlag(undefined), false);
});

import { pickClaude, shellSafe } from "../scripts/lib/claude.mjs";

test("Windows: an npm install's extensionless shim is skipped for the .cmd beside it", () => {
  // Forward slashes stand in for Windows paths: the choice depends only on the extension.
  const where = ["C:/npm/claude", "C:/npm/claude.cmd", "C:/npm/claude.ps1"].join("\r\n");
  assert.deepEqual(pickClaude(where), { cmd: '"C:/npm/claude.cmd"', shell: true });
  assert.deepEqual(pickClaude("C:/Program Files/Claude/claude.exe"), { cmd: "C:/Program Files/Claude/claude.exe", shell: false });
  assert.deepEqual(pickClaude(""), { cmd: "claude", shell: false });
});

test("Windows shell path: arguments with % or quotes are refused (cmd.exe expands %VAR% inside quotes)", () => {
  assert.equal(shellSafe(["-p", '"C:/data/p.md"', '""']), true);
  assert.equal(shellSafe(["-p", '"C:/d%PATH%x/p.md"']), false);
  assert.equal(shellSafe(['"a"b"']), false);
});
