import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe as describeProject } from "../scripts/lib/describe.mjs";

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "wnc-describe-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), typeof text === "string" ? text : JSON.stringify(text));
  }
  return root;
}

test("a manifest below the root is read: the SDK in orchestrator/package.json is named (B-48, NC 4)", () => {
  const root = tree({
    "CLAUDE.md": "# App\nA platform that moves ideas through stages.",
    "orchestrator/package.json": { dependencies: { "@anthropic-ai/sdk": "^1", "@supabase/supabase-js": "^2" } },
    "web/package.json": { dependencies: { react: "^19", vite: "^7" } },
  });
  try {
    const d = describeProject(root);
    for (const dep of ["@anthropic-ai/sdk", "@supabase/supabase-js", "react", "vite"]) assert.ok(d.includes(dep), `${dep}: ${d}`);
    assert.match(d, /^A platform that moves ideas through stages\. Uses /, "the project's own line is kept, packages added");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the root manifest comes first; installed packages, dot folders and deep folders are not read", () => {
  const root = tree({
    "package.json": { description: "A site.", dependencies: { next: "^16" } },
    "packages/api/package.json": { dependencies: { "@anthropic-ai/sdk": "^1" } },
    "node_modules/openai/package.json": { dependencies: { openai: "^1" } },
    ".claude/tools/package.json": { dependencies: { express: "^5" } },
    "a/b/c/package.json": { dependencies: { fastify: "^5" } },
  });
  try {
    const d = describeProject(root);
    assert.match(d, /^A site\. Uses next, @anthropic-ai\/sdk\.$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a Python project below the root is named; with no manifest the CLAUDE.md line is used", () => {
  const py = tree({ "service/pyproject.toml": "[project]\nname = 'x'\n" });
  const md = tree({ "CLAUDE.md": "# T\n> note\nNotes and scripts for a book." });
  try {
    assert.equal(describeProject(py), "Python project.");
    assert.equal(describeProject(md), "Notes and scripts for a book.");
  } finally { for (const r of [py, md]) rmSync(r, { recursive: true, force: true }); }
});

test("with a root manifest, the CLAUDE.md line is not used (it is usually boilerplate), as before", () => {
  const root = tree({
    "package.json": { dependencies: { next: "^16" } },
    "CLAUDE.md": "# CLAUDE.md\nThis file provides guidance to Claude Code when working in this repository.",
  });
  try { assert.equal(describeProject(root), "Uses next."); } finally { rmSync(root, { recursive: true, force: true }); }
});
