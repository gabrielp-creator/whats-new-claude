import { test } from "node:test";
import assert from "node:assert/strict";
import { fileUse, splitUse, useIndex, lookup } from "../scripts/lib/use.mjs";

// B-47: a name counts as used only in config and code; docs, data records, tests and comments only
// mention it. Mentions are context for the rater, never a confirmation.

test("fileUse: a closed list of config files and code files are 'used'; everything else 'mentioned'", () => {
  for (const f of ["package.json", "app/package.json", ".claude/settings.json", "settings.json", "pyproject.toml", "deploy/wrangler.toml",
    ".github/workflows/ci.yml", ".github/workflows/release.yaml", "src/a.ts", "src/b.tsx", "scripts/x.mjs", "lib/c.cjs", "app/d.py", ".claude/hooks/h.sh", "tools/e.ps1", "web/f.jsx", "g.js"])
    assert.equal(fileUse(f), "used", f);
  for (const f of ["docs/x.md", "README.md", "CLAUDE.md", "review/round3/x.md", "index.html", "tsconfig.json", "package-lock.json",
    ".snapshots/a.json", "db/schema.sql", "notes.txt", "docker-compose.yml", ".github/dependabot.yml", "style.css",
    "tests/a.mjs", "test/b.py", "src/a.test.ts", "src/b.spec.js", "src/__tests__/c.ts", "fixtures/f.ts", "src/__fixtures__/g.ts",
    "proofs/p.mjs", "logs/run.mjs", "app/test_x.py", "app/x_test.py",
    "src/render_proof.ts", "src/proof.ts", "src/proof_sweep.ts", "src/step-proof-run.ts", "src/api_smoke.ts", "src/smoke.mjs"])
    assert.equal(fileUse(f), "mentioned", f);
  for (const f of ["src/waterproof.ts", "src/smokescreen.ts", "src/proofreader.py"]) assert.equal(fileUse(f), "used", `${f}: a word that only contains proof or smoke`);
  for (const f of [".claude/agents/a.md", ".claude/commands/c.md", ".claude/lenses/l.md", ".claude/skills/s/SKILL.md", ".claude/agents/sub/b.md"])
    assert.equal(fileUse(f), "frontmatter", f);
  assert.equal(fileUse("docs/agents/a.md"), "mentioned", "only .claude/ agent files have model front matter");
});

test("splitUse: full-line comments are mentions; a trailing comment does not make a line a mention (P-31)", () => {
  const text = [
    '// claude-opus-4-8 was the old pin',
    'const u = "https://x" // ... model: "claude-opus-4-8"',
    '# MODEL = "claude-sonnet-4-6"',
    '  * claude-haiku-4-5 in a doc block',
    '/* claude-opus-5 */',
    '-- claude-opus-4-7 in sql style',
    '<!-- claude-sonnet-5 -->',
    '  --model sonnet \\',
    'const m = "claude-opus-5-5";',
  ].join("\n");
  const s = splitUse("src/a.ts", text);
  assert.deepEqual(s.used.map((l) => l.line), [2, 8, 9]);
  assert.deepEqual(s.mentioned.map((l) => l.line), [1, 3, 4, 5, 6, 7]);
  assert.equal(s.used[0].text, 'const u = "https://x" // ... model: "claude-opus-4-8"');
});

test("splitUse: a mentioned file is all mention; only the model: line of .claude front matter is used", () => {
  assert.deepEqual(splitUse("docs/x.md", "a\nb").used, []);
  const agent = "---\nname: a\ndescription: uses claude-opus-4-8 for drafts\nmodel: sonnet\n---\nBody: claude-haiku-4-5\nmodel: opus";
  const s = splitUse(".claude/agents/a.md", agent);
  assert.deepEqual(s.used, [{ line: 4, text: "model: sonnet" }]);
  assert.ok(s.mentioned.some((l) => l.text.includes("claude-opus-4-8")));
  assert.ok(s.mentioned.some((l) => l.text === "model: opus"), "a model: line after the front matter is body text");
  assert.deepEqual(splitUse(".claude/agents/b.md", "model: opus\nno front matter").used, []);
});

test("the models a project's code uses, by first file and line, without duplicates (was inventory)", () => {
  const ix = useIndex([
    { file: "src/a.ts", text: 'model: "claude-opus-4-8", fallback: "claude-opus-4-8"' },
    { file: "src/b.py", text: "MODEL = 'claude-sonnet-4-5-20250929'  # anthropic.claude-opus-5-5-v1:0" },
  ]);
  assert.deepEqual(ix.models.models, ["claude-opus-4-8", "claude-sonnet-4-5", "claude-opus-5-5"]);
  assert.deepEqual(ix.models.used.map((u) => `${u.file}:${u.line}`), ["src/a.ts:1", "src/b.py:1", "src/b.py:1"]);
});

test("a record is not use (NC 1, LNC 2): ids in a review record are mentions, the code's id is used, with file and line", () => {
  const ix = useIndex([
    { file: "review/round1/notes.md", text: "model: claude-sonnet-4-6, date: 2026-06-10" },
    { file: "src/a.ts", text: "import x from 'y';\nconst M = 'claude-opus-4-8';" },
  ]);
  assert.deepEqual(ix.models.models, ["claude-opus-4-8"]);
  assert.deepEqual(ix.models.used, [{ id: "claude-opus-4-8", file: "src/a.ts", line: 2 }]);
  assert.deepEqual(ix.models.mentioned, ["claude-sonnet-4-6"]);
  assert.deepEqual(ix.models.aliases, []);
});

test("a doc mention is not use (SU 3): setup's skill prose names an id, settings.json uses another", () => {
  const ix = useIndex([
    { file: "skills/model-refresh/SKILL.md", text: "---\nname: model-refresh\n---\nCompare `claude-opus-4-8` with the new model." },
    { file: "settings.json", text: '{\n  "model": "claude-opus-5-5"\n}' },
  ], { claudeRoot: true });
  assert.deepEqual(ix.models.models, ["claude-opus-5-5"]);
  assert.deepEqual(ix.models.used, [{ id: "claude-opus-5-5", file: "settings.json", line: 2 }]);
  assert.deepEqual(ix.models.mentioned, ["claude-opus-4-8"]);
});

test("data records are mentions (P-9): a dataset snapshot holding an id does not make it used", () => {
  const ix = useIndex([{ file: ".snapshots/run-1.json", text: '{"provenance": {"model": "claude-opus-5"}}' }]);
  assert.deepEqual(ix.models.models, []);
  assert.deepEqual(ix.models.mentioned, ["claude-opus-5"]);
});

test("aliases are recorded with file and line, never resolved (B-39, AK 3, LCW 2)", () => {
  const ix = useIndex([
    { file: ".claude/lenses/skeptic.md", text: "---\nname: skeptic\nmodel: sonnet\n---\nRead it cold." },
    { file: ".claude/agents/helper.md", text: "---\nmodel: inherit\n---\n" },
    { file: "scripts/lens-run.mjs", text: 'const ROOT = ".";\nconst [LENS, IDS = "all", MODEL = "sonnet"] = process.argv.slice(2);\n\nconst args = ["-p", "--model", MODEL, "--tools", \'""\'];' },
    { file: "run.sh", text: "claude -p --model opus \"$PROMPT\"\nclaude -p --model=claude-haiku-4-5 x" },
    { file: ".claude/settings.json", text: '{\n  "env": { "ANTHROPIC_MODEL": "fable" }\n}' },
    { file: "src/llm.py", text: 'client.messages.create(model="claude-sonnet-4-latest")' },
  ]);
  assert.deepEqual(ix.models.aliases, [
    { alias: "sonnet", family: "sonnet", file: ".claude/lenses/skeptic.md", line: 3 },
    { alias: "inherit", family: null, file: ".claude/agents/helper.md", line: 2 },
    { alias: "sonnet", family: "sonnet", file: "scripts/lens-run.mjs", line: 2 },
    { alias: "opus", family: "opus", file: "run.sh", line: 1 },
    { alias: "fable", family: "fable", file: ".claude/settings.json", line: 2 },
    { alias: "claude-sonnet-4-latest", family: "sonnet", file: "src/llm.py", line: 1 },
  ]);
  assert.deepEqual(ix.models.models, ["claude-haiku-4-5"], "a -latest alias is not a pinned id");
});

test("aliases count only in used text, and only values that look like a model or alias", () => {
  const ix = useIndex([
    { file: "docs/how.md", text: "Run claude --model opus to try it." },
    { file: "src/a.ts", text: '// claude --model haiku\nconst ANTHROPIC_MODEL = process.env.X;\nspawn("claude", ["--model", pick]);\nconst cfg = { model: "gpt-5" };' },
  ]);
  assert.deepEqual(ix.models.aliases, []);
});

test("lookup: a term in used text is found; a term only in mentions is 'mentioned' (LNC 7, LCW 6)", () => {
  const ix = useIndex([
    { file: "docs/design.md", text: "Uses the claude-api skill and ClaudeSDKClient." },
    { file: "data/archive/list.html", text: "<td>claude-agent-sdk</td>" },
    { file: "src/a.ts", text: 'import Anthropic from "@anthropic-ai/sdk";\n// ClaudeSDKClient later' },
  ]);
  assert.deepEqual(lookup(["@anthropic-ai/sdk", "claude-api", "claude-agent-sdk", "ClaudeSDKClient", "nowhere"], ix), {
    found: [{ term: "@anthropic-ai/sdk", file: "src/a.ts" }],
    mentioned: [{ term: "claude-api", file: "docs/design.md" }, { term: "claude-agent-sdk", file: "data/archive/list.html" }, { term: "ClaudeSDKClient", file: "docs/design.md" }],
  });
});

// B-61: CLI flags are looked up with their dashes, and count only within 10 lines of a call to the
// claude CLI in config or code (P-26: another tool's --continue is not a claude flag).
const caller = {
  file: "scripts/run-lens.mjs",
  text: [
    'import { spawn } from "node:child_process";',
    "function run(input) {",
    '  const args = ["-p", "--model", MODEL, "--tools", \'""\', "--strict-mcp-config", "--safe-mode"];',
    "  // --bare would skip hooks",
    '  const p = spawn("claude", args, { shell: true });',
    "}",
  ].join("\n"),
};

test("a flag passed to claude in code is found, with its dashes (LCW 3)", () => {
  const ix = useIndex([caller]);
  assert.deepEqual(lookup(["--strict-mcp-config", "--safe-mode"], ix).found,
    [{ term: "--strict-mcp-config", file: "scripts/run-lens.mjs" }, { term: "--safe-mode", file: "scripts/run-lens.mjs" }]);
  assert.deepEqual(lookup(["--bare"], ix), { found: [], mentioned: [{ term: "--bare", file: "scripts/run-lens.mjs" }] }, "a flag in a comment is a mention");
  assert.deepEqual(ix.claudeCalls, [{ file: "scripts/run-lens.mjs", line: 5 }]);
});

test("a shell call on one line, and a call in package.json scripts, count", () => {
  const ix = useIndex([
    { file: "run.sh", text: 'claude -p --strict-mcp-config "$PROMPT"' },
    { file: "package.json", text: '{ "scripts": { "lens": "claude -p --no-session-persistence" } }' },
  ]);
  assert.equal(lookup(["--strict-mcp-config"], ix).found.length, 1);
  assert.equal(lookup(["--no-session-persistence"], ix).found.length, 1);
});

test("another tool's flag is not a claude flag (P-26)", () => {
  const far = { file: "scripts/far.mjs", text: ['spawn("claude", ["-p"]);', ...Array(11).fill("x();"), 'execFileSync("git", ["rebase", "--continue"]);'].join("\n") };
  const none = { file: "scripts/git.sh", text: "git rebase --continue" };
  assert.deepEqual(lookup(["--continue"], useIndex([far])), { found: [], mentioned: [] });
  assert.deepEqual(lookup(["--continue"], useIndex([none])), { found: [], mentioned: [] });
  assert.deepEqual(useIndex([none]).claudeCalls, []);
});

test("'claude' that is not a call does not count: paths, names, prose, comments", () => {
  const ix = useIndex([{ file: "src/a.ts", text: [
    'const dir = join(home, ".claude");',
    'const repo = "claude-watch";',
    'log("Claude said --verbose things");',
    '// spawn("claude", ["--verbose"])',
  ].join("\n") }]);
  assert.deepEqual(ix.claudeCalls, []);
  assert.deepEqual(lookup(["--verbose"], ix).found, []);
});

test("a doc mentioning a flag is a mention, with its dashes", () => {
  assert.deepEqual(lookup(["--strict-mcp-config"], useIndex([{ file: "docs/how.md", text: "Pass `--strict-mcp-config` to claude." }])),
    { found: [], mentioned: [{ term: "--strict-mcp-config", file: "docs/how.md" }] });
});

test("'found in' prefers a code file over a config file (B-61)", () => {
  const ix = useIndex([
    { file: "package.json", text: '{ "dependencies": { "@anthropic-ai/sdk": "^1.0.0" } }' },
    { file: "src/llm.ts", text: 'import Anthropic from "@anthropic-ai/sdk";' },
  ]);
  assert.deepEqual(lookup(["@anthropic-ai/sdk"], ix).found, [{ term: "@anthropic-ai/sdk", file: "src/llm.ts" }]);
});

test("'claude' as a value is not a call: ids, providers, defaults; a spawn, a command setting or Python's run are", () => {
  const values = useIndex([{ file: "src/runtime.ts", text: [
    'readonly id = "claude" as const;',
    "const cfg = { provider: 'claude', model: MODEL, temperature: 0.2 };",
    'const choice = (process.env.RUNTIME ?? "claude").toLowerCase();',
    "if (config?.provider === 'claude' && config.model) {",
    'const flags = ["--verbose"];',
  ].join("\n") }]);
  assert.deepEqual(values.claudeCalls, []);
  assert.deepEqual(lookup(["--verbose"], values).found, []);
  const calls = useIndex([
    { file: "lib/cli.mjs", text: 'if (!hit) return { cmd: "claude", shell: false };' },
    { file: "run.py", text: 'subprocess.run(["claude", "-p", "--bare", prompt])' },
    { file: "go.mjs", text: 'execFileSync("claude.exe", ["--version"])' },
  ]);
  assert.deepEqual(calls.claudeCalls.map((c) => c.file), ["lib/cli.mjs", "run.py", "go.mjs"]);
  assert.equal(lookup(["--bare"], calls).found.length, 1);
});

test("a short flag passed to claude counts as its long form (-p is --print)", () => {
  const ix = useIndex([caller]);
  assert.deepEqual(lookup(["--print"], ix).found, [{ term: "--print", file: "scripts/run-lens.mjs" }]);
  assert.deepEqual(lookup(["--print"], useIndex([{ file: "scripts/git.sh", text: "grep -p x" }])).found, [], "not near a claude call");
});
