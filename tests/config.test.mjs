import { test } from "node:test";
import assert from "node:assert/strict";
import { validateConfig, withDefaults, projectsProfile } from "../scripts/lib/config.mjs";
import { safeBriefDir } from "../scripts/lib/paths.mjs";
import { resolve, join } from "node:path";

const ROOT = resolve("/work/space");
const good = () => ({ workspaceRoot: ROOT, projects: [{ id: "app", description: "A web app.", briefDir: "app/docs/briefs" }] });

test("a minimal config is valid", () => assert.deepEqual(validateConfig(good()), []));

test("bad configs are rejected with a reason each", () => {
  assert.ok(validateConfig({ ...good(), workspaceRoot: "relative/path" }).some((e) => /absolute/.test(e)));
  assert.ok(validateConfig({ ...good(), projects: [] }).some((e) => /non-empty/.test(e)));
  assert.ok(validateConfig({ ...good(), projects: [{ id: "Bad Id", description: "x", briefDir: "a" }] }).some((e) => /lower-case/.test(e)));
  assert.ok(validateConfig({ ...good(), projects: [{ id: "a", description: "", briefDir: "a" }] }).some((e) => /description/.test(e)));
  assert.ok(validateConfig({ ...good(), projects: [{ id: "a", description: "x", briefDir: ROOT }] }).some((e) => /relative/.test(e)));
  assert.ok(validateConfig({ ...good(), projects: [{ id: "a", description: "x", briefDir: "a", path: "../out" }] }).some((e) => /path must/.test(e)));
  assert.ok(validateConfig({ ...good(), projects: [{ id: "a", description: "x", briefDir: "a", path: ROOT }] }).some((e) => /path must/.test(e)));
  assert.deepEqual(validateConfig({ ...good(), projects: [{ id: "a", description: "x", briefDir: "a", path: "apps/a" }] }), []);
  const dup = good(); dup.projects.push({ ...dup.projects[0] });
  assert.ok(validateConfig(dup).some((e) => /duplicate/.test(e)));
});

test("defaults always block .git, node_modules, .claude and dotfiles", () => {
  const c = withDefaults({ ...good(), blocked: ["secret"] });
  for (const b of [".git", "node_modules", ".claude", "dotfiles", "secret"]) assert.ok(c.blocked.includes(b), b);
  assert.equal(c.model, "sonnet");
});

test("profile lists project ids in brackets for the lenses", () => {
  const p = projectsProfile(withDefaults({ ...good(), notUsing: "Windows" }));
  assert.match(p, /^- \[app\] A web app\.$/m);
  assert.match(p, /Does not use: Windows/);
});

test("brief folders stay inside the workspace and out of blocked folders", () => {
  const blocked = withDefaults(good()).blocked.concat("private");
  assert.equal(safeBriefDir(ROOT, "app/docs/briefs", blocked), join(ROOT, "app", "docs", "briefs"));
  assert.throws(() => safeBriefDir(ROOT, "../elsewhere", blocked), /outside/);
  assert.throws(() => safeBriefDir(ROOT, resolve("/etc"), blocked), /outside/);
  assert.throws(() => safeBriefDir(ROOT, "app/.git/x", blocked), /not allowed/);
  assert.throws(() => safeBriefDir(ROOT, "Private/notes", blocked), /not allowed/);
  assert.throws(() => safeBriefDir(ROOT, "", blocked), /empty/);
  assert.throws(() => safeBriefDir(ROOT, ".", blocked), /outside/);
});

test("minRating defaults to 8 and must be a number from 0 to 10", () => {
  const base = good();
  assert.equal(withDefaults(base).minRating, 8);
  assert.deepEqual(validateConfig({ ...base, minRating: 7.5 }), []);
  for (const bad of [11, -1, "8", NaN]) assert.match(validateConfig({ ...base, minRating: bad }).join(), /minRating/, String(bad));
});

import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

test("brief folders: Windows short names and trailing dots or spaces are refused", () => {
  const blocked = [".git", ".claude"];
  for (const d of ["Evan/CLAUDE~1/rules", "app/docs~/x", "app/docs./x", "app/docs /x"])
    assert.throws(() => safeBriefDir(ROOT, d, blocked), /not allowed|outside/, d);
});

test("brief folders: a link inside the workspace that leads into a blocked folder is refused", () => {
  const root = mkdtempSync(join(tmpdir(), "wnc-"));
  try {
    mkdirSync(join(root, "proj", ".claude", "rules"), { recursive: true });
    mkdirSync(join(root, "proj", "docs"), { recursive: true });
    symlinkSync(join(root, "proj", ".claude"), join(root, "proj", "docs", "sneaky"), "junction");
    assert.throws(() => safeBriefDir(root, "proj/docs/sneaky/rules", [".claude"]), /not allowed|outside/);
    // and one that leads out of the workspace
    const out = mkdtempSync(join(tmpdir(), "wnc-out-"));
    symlinkSync(out, join(root, "proj", "docs", "away"), "junction");
    assert.throws(() => safeBriefDir(root, "proj/docs/away/x", [".claude"]), /outside/);
    rmSync(out, { recursive: true, force: true });
    // an ordinary folder that does not exist yet is still fine
    assert.equal(safeBriefDir(root, "proj/docs/briefs", [".claude"]), join(root, "proj", "docs", "briefs"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("config.json values that reach spending or a command line are checked", () => {
  const base = good();
  assert.deepEqual(validateConfig({ ...base, updateFrequency: "weekly", autoRateMaxCalls: 10, model: "claude-sonnet-5-5" }), []);
  assert.match(validateConfig({ ...base, updateFrequency: "hourly" }).join(), /updateFrequency/);
  for (const bad of [-1, 201, 2.5, "10"]) assert.match(validateConfig({ ...base, autoRateMaxCalls: bad }).join(), /autoRateMaxCalls/, String(bad));
  for (const bad of ["sonnet & calc", "a b", "", "x;y"]) assert.match(validateConfig({ ...base, model: bad }).join(), /model/, bad);
});

import { inProjectScope } from "../scripts/lib/paths.mjs";

test("brief folders: NTFS stream aliases, device names and dot-folders are refused", () => {
  const blocked = [".git", ".claude"];
  for (const d of ["proj/.claude::$INDEX_ALLOCATION/rules", "proj/x:y", "proj/a$b", "proj/CON", "proj/docs/NUL", "proj/com1.txt", "proj/LPT9",
    "proj/.clinerules", "proj/.windsurf/rules", "other/.github/workflows", "proj/.cursor/rules"])
    assert.throws(() => safeBriefDir(ROOT, d, blocked), /not allowed|outside/, d);
});

test("brief folders: folders other tools load as commands, agents, skills, hooks or rules are refused", () => {
  for (const d of ["proj/commands", "proj/agents/x", "proj/skills", "proj/hooks", "proj/rules", "proj/.claude-plugin"])
    assert.throws(() => safeBriefDir(ROOT, d, [".git"]), /not allowed/, d);
  assert.equal(safeBriefDir(ROOT, "proj/docs/briefs", [".git"]), join(ROOT, "proj", "docs", "briefs"));
});

test("a folder set on the review page must stay inside that project's own folder", () => {
  const app = { id: "app", path: "app", briefDir: "app/docs/briefs" };
  const setup = { id: "setup", briefDir: "notes/setup" };
  assert.equal(inProjectScope(ROOT, app, join(ROOT, "app", "docs", "other")), true);
  assert.equal(inProjectScope(ROOT, app, join(ROOT, "site", "docs")), false, "another project's folder");
  assert.equal(inProjectScope(ROOT, app, join(ROOT, "apple", "docs")), false, "a sibling with the same prefix");
  assert.equal(inProjectScope(ROOT, setup, join(ROOT, "notes", "setup", "x")), true, "no path: inside its brief folder");
  assert.equal(inProjectScope(ROOT, setup, join(ROOT, "notes")), false);
});
