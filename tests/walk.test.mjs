import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collect } from "../scripts/lib/walk.mjs";

// A project shaped like the one that broke (B-28): a large output folder that sorts before src/.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "wnc-walk-"));
  for (const d of ["poc-outputs/transcripts", "data", "src/lib"]) mkdirSync(join(root, d), { recursive: true });
  for (let i = 0; i < 30; i++) writeFileSync(join(root, "poc-outputs/transcripts", `t${String(i).padStart(3, "0")}.json`), '{"x": 1}');
  for (let i = 0; i < 10; i++) writeFileSync(join(root, "data", `d${i}.md`), "row");
  writeFileSync(join(root, "src/lib/llm.ts"), 'export const MODEL = "claude-sonnet-4-6";');
  writeFileSync(join(root, "package.json"), '{"name": "app"}');
  return root;
}
const small = { files: 12, bytes: 1e6, total: 1e8, dirs: 100 };

test("source folders are read before output and data folders, so a cap spent on outputs still sees src", () => {
  const root = fixture();
  try {
    const files = collect(root, null, { limits: small });
    const names = files.map((f) => f.file);
    assert.ok(names.includes("src/lib/llm.ts"), `src was not reached: ${names.join(", ")}`);
    assert.ok(names.includes("package.json"));
    assert.equal(files.capped, true, "the cap was still hit, so the search is partial");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("deferred folders are still read when the cap allows", () => {
  const root = fixture();
  try {
    const files = collect(root, null, { limits: { ...small, files: 1000 } });
    assert.equal(files.length, 30 + 10 + 2);
    assert.equal(files.capped, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// A project with agent worktrees and a nested checkout (B-49): copies of the repo, possibly on other
// branches, are not the project's own files.
function worktreeFixture({ rootIsWorktree = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "wnc-walk-wt-"));
  for (const d of [".claude/agents", ".claude/worktrees/w/docs", ".claude/worktrees/pruned", "vendor/sub", "docs"]) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, ".claude/agents/a.md"), "---\nmodel: sonnet\n---\n");
  writeFileSync(join(root, ".claude/worktrees/w/.git"), "gitdir: ../../../.git/worktrees/w\n");
  writeFileSync(join(root, ".claude/worktrees/w/docs/d.md"), "Uses the claude-api skill.");
  writeFileSync(join(root, ".claude/worktrees/pruned/notes.md"), "claude-api");
  writeFileSync(join(root, "vendor/sub/.git"), "gitdir: ../../.git/modules/sub\n");
  writeFileSync(join(root, "vendor/sub/llm.ts"), 'export const MODEL = "claude-sonnet-4-6";');
  writeFileSync(join(root, "docs/notes.md"), "plain notes");
  if (rootIsWorktree) writeFileSync(join(root, ".git"), "gitdir: elsewhere\n");
  return root;
}

test("agent worktrees and folders holding a .git file are not walked (B-49)", () => {
  const root = worktreeFixture();
  try {
    const names = collect(root, null).map((f) => f.file).sort();
    assert.deepEqual(names, [".claude/agents/a.md", "docs/notes.md"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a term found only in a worktree copy is not found at all (B-49, fixture LNC 7)", () => {
  const root = worktreeFixture();
  try {
    assert.ok(collect(root, null).every((f) => !f.text.includes("claude-api")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a project root that is itself a worktree is still walked (B-49)", () => {
  const root = worktreeFixture({ rootIsWorktree: true });
  try {
    const names = collect(root, null).map((f) => f.file).sort();
    assert.deepEqual(names, [".claude/agents/a.md", "docs/notes.md"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("blocked folders are never entered", () => {
  const root = fixture();
  try {
    const files = collect(root, null, { blocked: ["poc-outputs"], limits: { ...small, files: 1000 } });
    assert.ok(files.every((f) => !f.file.startsWith("poc-outputs/")));
    assert.equal(files.capped, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
