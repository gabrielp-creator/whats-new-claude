// B-52 (version part): the installed Claude Code version, read through its own spawn path, which needs
// no call budget, sends nothing, and fails closed (P-17).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseVersion, readVersion, versionFor } from "../scripts/lib/version.mjs";
import { PLUGIN_ROOT } from "../scripts/lib/store.mjs";

test("parseVersion takes x.y.z from the first line only", () => {
  assert.equal(parseVersion("2.1.296 (Claude Code)\n"), "2.1.296");
  assert.equal(parseVersion("  2.1.300\r\n"), "2.1.300");
  for (const bad of ["", "Claude Code", "v2.1", "error: 2.1.296 not found", "2.1.296-beta.1x", null]) assert.equal(parseVersion(bad), null, String(bad));
});

test("readVersion runs `claude --version` from the plugin's folder and records how", () => {
  const calls = [];
  const r = readVersion({ exec: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return "2.1.296 (Claude Code)\n"; }, find: () => ({ cmd: "claude", shell: false }) });
  assert.deepEqual(r, { version: "2.1.296", how: "claude --version" });
  assert.deepEqual(calls[0].args, ["--version"]);
  assert.ok(calls[0].opts.timeout > 0 && calls[0].opts.timeout <= 15000);
  assert.equal(calls[0].opts.cwd, PLUGIN_ROOT, "never the user's folder (a planted claude.cmd)");
});

test("readVersion fails closed: no version when the output does not parse or claude does not start", () => {
  const find = () => ({ cmd: "claude", shell: false });
  assert.deepEqual(readVersion({ exec: () => "something else", find }), { version: null, how: "claude --version: output not a version" });
  assert.deepEqual(readVersion({ exec: () => { throw new Error("ENOENT"); }, find }), { version: null, how: "claude --version: could not run" });
});

test("the version module never loads the call budget (claude.mjs)", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "scripts", "lib", "version.mjs"), "utf8");
  assert.doesNotMatch(src, /from\s+["']\.\/claude\.mjs["']/);
});

test("versionFor: a project with the Agent SDK runs its bundled CLI, so its version is unknown (P-17)", () => {
  const installed = { version: "2.1.296", how: "claude --version" };
  assert.equal(versionFor({ packages: [] }, installed), "2.1.296");
  assert.equal(versionFor({ packages: [{ name: "@anthropic-ai/sdk", file: "package.json" }] }, installed), "2.1.296");
  assert.equal(versionFor({ packages: [{ name: "@anthropic-ai/claude-agent-sdk", file: "package.json" }] }, installed), null);
  assert.equal(versionFor({ packages: [{ name: "claude-agent-sdk", file: "pyproject.toml" }] }, installed), null);
  assert.equal(versionFor({ packages: [] }, { version: null, how: "x" }), null);
  assert.equal(versionFor(undefined, installed), "2.1.296");
});
