import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTerms, tokenIndex, applyEvidence } from "../scripts/lib/probe.mjs";

test("pulls concrete names out of release text", () => {
  const t = extractTerms("Added `bashOutputMaxChars` and `taskOutputMaxChars` settings; set CLAUDE_CODE_MAX_OUTPUT to raise it. Run /memory. Moved to claude-opus-5-5 and @anthropic-ai/sdk.");
  for (const want of ["bashOutputMaxChars", "taskOutputMaxChars", "CLAUDE_CODE_MAX_OUTPUT", "claude-opus-5-5", "@anthropic-ai/sdk"]) assert.ok(t.includes(want), want);
  assert.ok(!t.includes("/memory"), "built-in slash commands are mentioned in passing too often to count");
});

test("ignores generic words and short or noisy spans", () => {
  const t = extractTerms("Fixed a bug in the `ui`. Improved JSON output and README. `a long phrase with spaces` and `true`.");
  assert.deepEqual(t, []);
});

test("token index finds identifiers with surrounding punctuation, by exact case", () => {
  const idx = tokenIndex([
    { file: "settings.json", text: '{ "bashOutputMaxChars": 128000, "model": "claude-opus-5-5" }' },
    { file: "CLAUDE.md", text: "Run /memory first. Uses claude-opus-5-5." },
  ]);
  assert.equal(idx.get("bashOutputMaxChars"), "settings.json");
  assert.equal(idx.get("claude-opus-5-5"), "settings.json");
  assert.equal(idx.get("/memory"), "CLAUDE.md");
  assert.equal(idx.get("bashoutputmaxchars"), undefined, "case-sensitive");
  assert.equal(idx.get("taskOutputMaxChars"), undefined);
});

const row = (o = {}) => ({ urgency: 60, urgencyLabel: "soon", projects: ["app"], ...o });

test("confirmed evidence keeps the tier and marks where it was found", () => {
  const r = applyEvidence(row(), [{ project: "app", checked: ["x"], found: [{ term: "x", file: "a.ts" }] }]);
  assert.equal(r.evidence, "confirmed");
  assert.equal(r.urgencyLabel, "soon");
  assert.deepEqual(r.confirmedIn, ["app"]);
  assert.ok(r.urgency >= 60);
});

test("not found is a note, never a downgrade: absence is unknown, not none", () => {
  for (const [u, label] of [[100, "urgent"], [60, "soon"], [35, "later"]]) {
    const r = applyEvidence(row({ urgency: u, urgencyLabel: label }), [{ project: "app", checked: ["x"], found: [] }]);
    assert.equal(r.urgencyLabel, label);
    assert.equal(r.urgency, u);
    assert.equal(r.evidence, "not-found");
  }
});

test("nothing to check, or a project left unchecked, is unchecked", () => {
  assert.equal(applyEvidence(row(), []).evidence, "unchecked");
  assert.equal(applyEvidence(row({ projects: ["app", "web"] }), [{ project: "app", checked: ["x"], found: [] }]).evidence, "unchecked");
});

test("plain words in code spans are not names; identifiers are", () => {
  const t = extractTerms("Added an `effort` parameter, `path` and `timeout` fields, `--plugin-dir`, `file_path`, `keybindings.json` and `opusplan`.");
  for (const bad of ["effort", "path", "timeout", "opusplan"]) assert.ok(!t.includes(bad), bad);
  for (const good of ["--plugin-dir", "file_path", "keybindings.json"]) assert.ok(t.includes(good), good);
});

test("generic config file names are not evidence of anything", () => {
  const t = extractTerms("Added `\"attribution\": false` in `settings.json` and `CLAUDE.md`; see `package.json` and `/hooks`.");
  for (const bad of ["settings.json", "CLAUDE.md", "package.json", "/hooks"]) assert.ok(!t.includes(bad), bad);
});

import { isSecretFile } from "../scripts/lib/probe.mjs";

test("the file check never reads credential files", () => {
  for (const f of [".env", ".env.local", "credentials.json", "secrets.yaml", "service-account.json", "serviceAccountKey.json",
    ".mcp.json", "settings.local.json", "id_rsa", "server.pem", "cert.key", "store.p12", ".npmrc", ".netrc", ".pypirc", "token.json"])
    assert.equal(isSecretFile(f), true, f);
  for (const f of ["settings.json", "package.json", "CLAUDE.md", "README.md", "index.ts", "keys.md"])
    assert.equal(isSecretFile(f), false, f);
});
