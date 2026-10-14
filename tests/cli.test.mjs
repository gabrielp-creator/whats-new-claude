// B-59: the CLI profile. A feature is "off" for a project only on positive literals in every call to
// the claude CLI found in its code, all with literal arguments, when .claude/ does not switch it on;
// otherwise the profile is unknown (P-2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { callArgs, cliProfile } from "../scripts/lib/cli.mjs";
import { useIndex } from "../scripts/lib/use.mjs";

const NO_SETTINGS = { hooks: [], plugins: 0, mcpJson: false };
const run = (files, profile = NO_SETTINGS) => cliProfile(files, useIndex(files).claudeCalls, profile);

const spawnFile = (args, extra = "") => ({
  file: "scripts/run.mjs",
  text: [
    'import { spawn } from "node:child_process";',
    "function ask(input) {",
    `  const args = ${args};`,
    '  const p = spawn("claude", args, { shell: true });',
    "  p.stdin.end(input);",
    "}",
    extra,
  ].join("\n"),
});
const LITERAL = `["-p", "--model", MODEL, "--tools", '""', "--strict-mcp-config", "--safe-mode",
    "--no-session-persistence", "--system-prompt-file", \`"\${PROMPT}"\`]`;
const SPAWN_LINE = 5; // the array above spans two lines

test("callArgs reads an argument array defined above a spawn, values of value flags may be variables", () => {
  const f = spawnFile(LITERAL);
  assert.match(f.text.split("\n")[SPAWN_LINE - 1], /spawn\("claude"/);
  const a = callArgs(f, SPAWN_LINE);
  assert.equal(a.literal, true);
  assert.deepEqual(a.args.slice(0, 5), ["-p", "--model", null, "--tools", '""']);
});

test("literal arguments in every call: tools, hooks, skills, plugins and MCP are off, each with file:line", () => {
  const p = run([spawnFile(LITERAL)]);
  assert.equal(p.status, "known");
  assert.deepEqual(Object.keys(p.off).sort(), ["hooks", "mcp", "plugins", "skills", "tools"]);
  assert.deepEqual(p.off.tools, ["scripts/run.mjs:5"]);
});

test("a feature is off only when every call turns it off", () => {
  const other = { file: "scripts/other.mjs", text: 'execFileSync("claude", ["-p", "--strict-mcp-config", "hello"]);' };
  const p = run([spawnFile(LITERAL), other]);
  assert.equal(p.status, "known");
  assert.deepEqual(Object.keys(p.off), ["mcp"]);
  assert.deepEqual(p.off.mcp, ["scripts/run.mjs:5", "scripts/other.mjs:1"]);
});

test("P-2: a conditional, a spread or a variable flag makes the profile unknown, nothing off", () => {
  for (const args of [
    `["-p", "--tools", '""', ...(fast ? ["--safe-mode"] : [])]`,
    `["-p", "--tools", '""', extra, "--safe-mode"]`,
    `["-p", "--tools", '""', fast ? "--safe-mode" : "--verbose"]`,
  ]) {
    const p = run([spawnFile(args)]);
    assert.equal(p.status, "unknown", args);
    assert.deepEqual(p.off, {}, args);
  }
  const pushed = run([spawnFile(`["-p", "--safe-mode"]`, 'if (debug) args.push("--mcp-config", "m.json");')]);
  assert.equal(pushed.status, "unknown", "arguments added later");
  const passed = run([{ file: "scripts/run.mjs", text: "export const go = (args) => spawn(\"claude\", args);" }]);
  assert.equal(passed.status, "unknown", "arguments from a caller");
});

test("--strict-mcp-config with an --mcp-config is not MCP off", () => {
  const p = run([spawnFile(`["-p", "--strict-mcp-config", "--mcp-config", "servers.json"]`)]);
  assert.equal(p.status, "known");
  assert.deepEqual(p.off, {});
});

test("shell and Python calls", () => {
  const sh = { file: "bin/ask.sh", text: 'claude -p --safe-mode --tools "" \\\n  --model sonnet "summarize the log"\n' };
  assert.deepEqual(Object.keys(run([sh]).off).sort(), ["hooks", "mcp", "plugins", "skills", "tools"]);
  const shVar = { file: "bin/ask.sh", text: 'claude -p --safe-mode "$@"\n' };
  assert.equal(run([shVar]).status, "unknown", "\"$@\" passes any flag");
  const py = { file: "tools/ask.py", text: 'subprocess.run(["claude", "-p", "--strict-mcp-config", "--tools", ""], input=prompt)\n' };
  assert.deepEqual(Object.keys(run([py]).off).sort(), ["mcp", "tools"]);
  const tpl = { file: "scripts/t.mjs", text: "execSync(`claude -p --safe-mode ${flags}`);\n" };
  assert.equal(run([tpl]).status, "unknown");
});

// R-1 (release review): a command string that more text is joined to is not literal.
test("a command string built by +, an f-string, .format, % or a next-line string is unknown", () => {
  for (const [file, text] of [
    ["scripts/a.mjs", `execSync("claude -p --tools '' --strict-mcp-config " + extra);\n`],
    ["scripts/b.mjs", "execSync(`claude -p --safe-mode ` + extra);\n"],
    ["scripts/h.mjs", `execSync("cd app && claude -p --tools '' --safe-mode " + extra);\n`],
    ["tools/c.py", `subprocess.run(f"claude -p --tools '' --safe-mode {extra}", shell=True)\n`],
    ["tools/d.py", `subprocess.run("claude -p --tools '' --safe-mode {}".format(extra), shell=True)\n`],
    ["tools/e.py", `subprocess.run("claude -p --tools '' --safe-mode %s" % extra, shell=True)\n`],
    ["tools/f.py", `cmd = ("claude -p --tools '' --safe-mode "\n       "--mcp-config servers.json")\n`],
    ["bin/g.sh", "claude -p --safe-mode --tools '' --model $MODEL\n"],
  ]) {
    const p = run([{ file, text }]);
    assert.equal(p.status, "unknown", text);
    assert.deepEqual(p.off, {}, text);
  }
});

test("a whole command string with nothing joined to it stays literal", () => {
  const js = { file: "scripts/a.mjs", text: `execSync("claude -p --tools '' --strict-mcp-config", { stdio: "inherit" });\n` };
  assert.deepEqual(Object.keys(run([js]).off).sort(), ["mcp", "tools"]);
  const mid = { file: "scripts/m.mjs", text: `execSync("cd app && claude -p --tools '' --strict-mcp-config");\n` };
  assert.deepEqual(Object.keys(run([mid]).off).sort(), ["mcp", "tools"]);
  const py = { file: "tools/b.py", text: `subprocess.run("claude -p --safe-mode --tools ''", shell=True)\n` };
  assert.deepEqual(Object.keys(run([py]).off).sort(), ["hooks", "mcp", "plugins", "skills", "tools"]);
  const quotedVar = { file: "bin/c.sh", text: 'claude -p --safe-mode --model "$MODEL" "summarize"\n' };
  assert.equal(run([quotedVar]).status, "known", "a quoted variable after a value flag is only a value");
});

test("what .claude/ switches on is never off", () => {
  const files = [spawnFile(LITERAL), { file: ".claude/skills/s/SKILL.md", text: "a skill" }];
  const p = run(files, { hooks: [{ event: "Stop", type: "command", source: ".claude/settings.json", file: "inline" }], plugins: 1, mcpJson: true });
  assert.deepEqual(Object.keys(p.off), ["tools"]);
});

test("no call to the claude CLI: no CLI profile", () => {
  const p = run([{ file: "src/app.ts", text: "const x = 1;" }]);
  assert.equal(p.status, "none");
  assert.deepEqual(p.off, {});
});
