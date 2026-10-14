// B-51: the code-made settings profile (closed schema) and the item conditions it answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSettings, buildProfile, profileTerms, profileLookup } from "../scripts/lib/profile.mjs";

const SECRET_CMD = "echo s3cret-hook-text --token abc123";
const SECRET_RULE = "Bash(curl https://internal.example/s3cret-rule:*)";

const settings = (o) => JSON.stringify(o);
const noFiles = () => false;

test("parseSettings keeps a closed schema: hook event, type, source and file, never command text", () => {
  const text = settings({
    hooks: {
      Stop: [{ hooks: [{ type: "prompt", prompt: "s3cret prompt text" }] }],
      PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: SECRET_CMD }, { type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.mjs" --flag' }] }],
    },
    env: { ANTHROPIC_API_KEY: "sk-ant-test" },
  });
  const p = parseSettings(text, "settings.local.json", { exists: (rel) => rel === ".claude/hooks/guard.mjs" });
  assert.equal(p.ok, true);
  assert.deepEqual(p.hooks, [
    { event: "Stop", type: "prompt", source: "settings.local.json", file: "inline" },
    { event: "PostToolUse", type: "command", source: "settings.local.json", file: "inline" },
    { event: "PostToolUse", type: "command", source: "settings.local.json", file: ".claude/hooks/guard.mjs" },
  ]);
  const out = JSON.stringify(p);
  for (const s of ["s3cret", "abc123", "sk-ant-test", "--flag", "Write"]) assert.ok(!out.includes(s), s);
});

test("parseSettings: rule tool kinds only (MCP names are third-party text), closed defaultMode, sandbox", () => {
  const text = settings({
    permissions: { allow: [SECRET_RULE, "Write(src/**)", "mcp__acme__do_thing", "WebFetch(domain:x.example)"], deny: ["Read(./.env)"], ask: ["Weird tool"], defaultMode: "auto" },
    sandbox: { enabled: true },
  });
  const p = parseSettings(text, "settings.json", { exists: noFiles });
  assert.deepEqual(p.rules, [
    { list: "allow", kind: "Bash", source: "settings.json" },
    { list: "allow", kind: "Write", source: "settings.json" },
    { list: "allow", kind: "mcp", source: "settings.json" },
    { list: "allow", kind: "WebFetch", source: "settings.json" },
    { list: "deny", kind: "Read", source: "settings.json" },
    { list: "ask", kind: "other", source: "settings.json" },
  ]);
  assert.deepEqual(p.defaultMode, { value: "auto", source: "settings.json" });
  assert.deepEqual(p.sandbox, { enabled: true, source: "settings.json" });
  const out = JSON.stringify(p);
  for (const s of ["s3cret", "src/**", "acme", "x.example", ".env", "Weird"]) assert.ok(!out.includes(s), s);
  assert.equal(parseSettings(settings({ permissions: { defaultMode: "made-up" } }), "s.json", { exists: noFiles }).defaultMode.value, "other");
});

test("parseSettings: an unparsable file is reported, not guessed", () => {
  const p = parseSettings("{ not json", "settings.local.json", { exists: noFiles });
  assert.equal(p.ok, false);
  assert.deepEqual(p.hooks, []);
});

// Real Claude Code changelog lines (public release text).
const T = {
  promptAgent: "Fixed `prompt` and `agent` hooks written as instructions (such as \"Block commands that...\") allowing what they should block",
  stopPrompt: "Improved how `prompt` hooks on Stop and SubagentStop written as instructions (such as \"Carry on if the build is broken\") are judged, so Claude is less likely to stop early",
  commandHttp: "Added `onFailure: \"block\"` for command and HTTP hooks: a hook that can't start, times out, or exits with an unexpected code blocks the action instead of letting it through",
  submit: "Fixed Esc or an interrupt during a `UserPromptSubmit` hook or a mod's `prompt.submit` hook ending headless sessions, clearing the typed prompt, or letting the unchecked prompt through",
  readDeny: "Fixed Bash permission checks not applying Read deny rules or the outside-directory read block to a wildcard in some option values of read-only commands",
  denyAsk: "Fixed a deny or ask rule missing a command or path whose name came from a variable set as a prefix on `declare`, `typeset`, `export` or `readonly`",
  sandbox: "Fixed Bash deny and ask rules missing a command behind an environment variable prefix with an expanded value (e.g. `TZ=\"$HOME\" rm -rf build`) when the sandbox auto-allows commands",
  writePath: "Fixed `/update-config` writing `Write(path)` permission rules, which file permission checks don't match, instead of `Edit(path)` rules",
  autoInline: "Changed auto mode so that a skill's or slash command's inline `!` shell commands follow default-mode permission rules instead of the classifier; a command no rule decides runs as a reviewed tool call",
  plainBash: "Fixed Bash permission checks auto-approving some read-only commands (such as `rg` or `git grep`) whose arguments the shell would still expand as wildcards; these now prompt for approval",
};

test("profileTerms: hook types and events", () => {
  assert.deepEqual(profileTerms(T.promptAgent), [{ field: "hooks", types: ["prompt", "agent"], events: [], label: "`prompt`/`agent` hooks" }]);
  assert.deepEqual(profileTerms(T.stopPrompt), [{ field: "hooks", types: ["prompt"], events: ["Stop", "SubagentStop"], label: "`prompt` hooks on Stop/SubagentStop" }]);
  assert.deepEqual(profileTerms(T.commandHttp), [{ field: "hooks", types: ["command", "http"], events: [], label: "`command`/`http` hooks" }]);
  assert.deepEqual(profileTerms(T.submit), [{ field: "hooks", types: [], events: ["UserPromptSubmit"], label: "hooks on UserPromptSubmit" }], "prompt.submit is not a prompt hook");
  assert.deepEqual(profileTerms("Stop the session when the prompt is empty"), [], "no hook word: no hook condition");
});

test("profileTerms: permission rules, sandbox, inline shell, auto mode", () => {
  assert.deepEqual(profileTerms(T.readDeny), [{ field: "rules", kinds: ["Read"], lists: ["deny"], label: "Read deny rules" }]);
  assert.deepEqual(profileTerms(T.denyAsk), [{ field: "rules", kinds: [], lists: ["deny", "ask"], label: "deny/ask rules" }]);
  assert.deepEqual(profileTerms(T.sandbox), [
    { field: "rules", kinds: ["Bash"], lists: ["deny", "ask"], label: "Bash deny/ask rules" },
    { field: "sandbox", label: "sandbox" },
  ]);
  assert.deepEqual(profileTerms(T.writePath), [{ field: "rules", kinds: ["Write", "Edit"], lists: [], label: "Write/Edit rules" }]);
  assert.deepEqual(profileTerms(T.autoInline), [
    { field: "inlineShell", label: "inline `!` shell in skills or commands" },
    { field: "defaultMode", modes: ["auto"], label: "auto mode" },
  ]);
  assert.deepEqual(profileTerms(T.plainBash), [], "'permission checks' alone names no rule list");
});

test("profileTerms: misreadings found in the dogfood", () => {
  assert.deepEqual(profileTerms("Fixed a cancelled shell command or hook still starting, and running to its end"), [], "'command or hook' is not a command hook");
  assert.deepEqual(profileTerms("Changed whole-tool `Bash` allow rules and allowing hooks to prompt for shell writes"),
    [{ field: "rules", kinds: ["Bash"], lists: ["allow"], label: "Bash allow rules" }], "a backticked tool keeps its kind");
  assert.deepEqual(profileTerms("Fixed an `Artifact` allow rule (\"don't ask again\") letting the tool publish a file"),
    [{ field: "rules", kinds: ["Artifact"], lists: ["allow"], label: "Artifact allow rules" }], "a tool outside the built-in list is still a kind");
  assert.deepEqual(profileTerms("The deny rules now apply to pasted paths"), [{ field: "rules", kinds: [], lists: ["deny"], label: "deny rules" }], "a capitalized plain word is not a tool");
  assert.equal(parseSettings(JSON.stringify({ permissions: { allow: ["Artifact(./x)"] } }), "s.json").rules[0].kind, "Artifact");
});

const profile = (o = {}) => ({ sources: [{ file: "settings.json", ok: true }], hooks: [], rules: [], defaultMode: null, sandbox: null, inlineShell: [], ...o });

test("profileLookup: a hook type the project has none of is not found (SU 4)", () => {
  const p = profile({ hooks: [{ event: "Stop", type: "command", source: "settings.local.json", file: "inline" }] });
  const r = profileLookup(profileTerms(T.promptAgent), p);
  assert.deepEqual(r.found, []);
  assert.deepEqual(r.checked, ["`prompt`/`agent` hooks"]);
});

test("profileLookup: a matching hook confirms, naming event, type and file (SU 5)", () => {
  const p = profile({ hooks: [{ event: "Stop", type: "prompt", source: "settings.local.json", file: "inline" }] });
  const r = profileLookup(profileTerms(T.stopPrompt), p);
  assert.deepEqual(r.found, [{ term: "`prompt` hook on Stop", file: "settings.local.json" }]);
});

test("profileLookup: no sandbox key is not found, never unchecked (SU 9); AND across fields", () => {
  const bashDeny = [{ list: "deny", kind: "Bash", source: "settings.json" }];
  const r = profileLookup(profileTerms(T.sandbox), profile({ rules: bashDeny }));
  assert.deepEqual(r.found, [], "the item needs both rules and a sandbox");
  assert.deepEqual(r.checked, ["Bash deny/ask rules", "sandbox"]);
  const both = profileLookup(profileTerms(T.sandbox), profile({ rules: bashDeny, sandbox: { enabled: true, source: "settings.json" } }));
  assert.deepEqual(both.found.map((f) => f.term), ["Bash in deny rules", "sandbox enabled"]);
  const off = profileLookup(profileTerms(T.sandbox), profile({ rules: bashDeny, sandbox: { enabled: false, source: "settings.json" } }));
  assert.deepEqual(off.found, [], "sandbox switched off counts as absent");
});

test("profileLookup: a Write rule confirms with the tool name and file only (SU 10)", () => {
  const p = profile({ rules: [{ list: "allow", kind: "Write", source: "settings.local.json" }] });
  const r = profileLookup(profileTerms(T.writePath), p);
  assert.deepEqual(r.found, [{ term: "Write in allow rules", file: "settings.local.json" }]);
});

test("profileLookup: absence is unknown where the profile cannot see it", () => {
  // defaultMode can be switched in a session, so a missing one proves nothing
  const r = profileLookup(profileTerms(T.autoInline), profile({ inlineShell: [".claude/commands/c.md"] }));
  assert.deepEqual(r, { found: [], checked: [] });
  // no settings file at all, or one that did not parse: nothing is known
  assert.deepEqual(profileLookup(profileTerms(T.promptAgent), profile({ sources: [] })), { found: [], checked: [] });
  assert.deepEqual(profileLookup(profileTerms(T.promptAgent), profile({ sources: [{ file: "settings.local.json", ok: false }] })), { found: [], checked: [] });
  // but a missing inline shell is known from the files read
  assert.deepEqual(profileLookup(profileTerms(T.autoInline), profile({ defaultMode: { value: "auto", source: "settings.json" } })).checked, ["inline `!` shell in skills or commands", "auto mode"]);
});

function tree() {
  const root = mkdtempSync(join(tmpdir(), "wnc-profile-"));
  const home = mkdtempSync(join(tmpdir(), "wnc-home-"));
  mkdirSync(join(root, ".claude", "hooks"), { recursive: true });
  writeFileSync(join(root, ".claude", "hooks", "guard.mjs"), "// hook\n");
  writeFileSync(join(root, ".claude", "settings.json"), settings({ permissions: { deny: ["Read(./x)"] } }));
  writeFileSync(join(root, ".claude", "settings.local.json"), settings({
    permissions: { allow: [SECRET_RULE] },
    hooks: { Stop: [{ hooks: [{ type: "command", command: 'node ".claude/hooks/guard.mjs"' }, { type: "command", command: SECRET_CMD }] }] },
    enabledPlugins: { "tool@market": true, "off@market": false },
  }));
  const plugin = join(home, ".claude", "plugins", "cache", "market", "tool", "1.0.0");
  mkdirSync(join(plugin, "hooks"), { recursive: true });
  writeFileSync(join(plugin, "hooks", "hooks.json"), settings({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node ${CLAUDE_PLUGIN_ROOT}/s3cret.mjs" }] }] } }));
  writeFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), settings({ version: 2, plugins: { "tool@market": [{ scope: "user", installPath: plugin }] } }));
  return { root, home };
}

test("buildProfile reads settings.local.json in process, plugin hooks of enabled plugins, inline shell and packages", () => {
  const { root, home } = tree();
  const files = [
    { file: ".claude/commands/deploy.md", text: "Run this:\n!`git status`\n" },
    { file: ".claude/skills/s/SKILL.md", text: "No shell here, just `code`.\n" },
    { file: "docs/notes.md", text: "!`not a command file`\n" },
    { file: "app/package.json", text: settings({ dependencies: { "@anthropic-ai/sdk": "^1", "left-pad": "1" } }) },
    { file: "requirements.txt", text: "anthropic==0.40\nrequests\n" },
  ];
  const p = buildProfile(root, files, { home });
  assert.deepEqual(p.sources, [{ file: ".claude/settings.json", ok: true }, { file: ".claude/settings.local.json", ok: true }]);
  assert.deepEqual(p.hooks, [
    { event: "Stop", type: "command", source: ".claude/settings.local.json", file: ".claude/hooks/guard.mjs" },
    { event: "Stop", type: "command", source: ".claude/settings.local.json", file: "inline" },
    { event: "SessionStart", type: "command", source: "plugin", file: "inline" },
  ]);
  assert.deepEqual(p.rules.map((r) => `${r.list}:${r.kind}`), ["deny:Read", "allow:Bash"]);
  assert.deepEqual(p.inlineShell, [".claude/commands/deploy.md"]);
  assert.deepEqual(p.packages, [{ name: "@anthropic-ai/sdk", file: "app/package.json" }, { name: "anthropic", file: "requirements.txt" }]);
  assert.equal(p.plugins, 1, "enabled plugins are counted, never named");
  assert.equal(p.mcpJson, false);
  writeFileSync(join(root, ".mcp.json"), "{}");
  assert.equal(buildProfile(root, [], { home }).mcpJson, true, ".mcp.json is checked for existence, never opened");
  const out = JSON.stringify(p);
  for (const s of ["s3cret", "abc123", "internal.example", "tool@market", "market"]) assert.ok(!out.includes(s), s);
});

test("buildProfile reads plugin hooks only from Claude Code's own plugin folder", () => {
  const { root, home } = tree();
  const elsewhere = mkdtempSync(join(tmpdir(), "wnc-elsewhere-"));
  mkdirSync(join(elsewhere, "hooks"), { recursive: true });
  writeFileSync(join(elsewhere, "hooks", "hooks.json"), settings({ hooks: { Stop: [{ hooks: [{ type: "agent" }] }] } }));
  writeFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), settings({ plugins: { "tool@market": [{ installPath: elsewhere }] } }));
  assert.ok(!buildProfile(root, [], { home }).hooks.some((h) => h.source === "plugin"));
});

test("buildProfile for setup reads ~/.claude's own settings files", () => {
  const { home } = tree();
  writeFileSync(join(home, ".claude", "settings.json"), settings({ sandbox: { enabled: true } }));
  const p = buildProfile(join(home, ".claude"), [], { home, claudeRoot: true });
  assert.deepEqual(p.sources, [{ file: "settings.json", ok: true }]);
  assert.deepEqual(p.sandbox, { enabled: true, source: "settings.json" });
});
