#!/usr/bin/env node
// Drafts a config by looking (read-only) at the folders directly inside a workspace root: a folder
// counts as a project when it has a package.json, pyproject.toml, Cargo.toml, go.mod, CLAUDE.md or
// .git. Writes <data>/config.draft.json for the user to review; never writes config.json itself.
// Usage: node scan-projects.mjs <workspaceRoot> [--data <dir>]
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { dataDir, positional, writeJson } from "./lib/store.mjs";
import { DEFAULT_BLOCKED } from "./lib/config.mjs";

const DATA = dataDir();
const [ROOT_ARG] = positional();
if (!ROOT_ARG) throw new Error("usage: scan-projects.mjs <workspaceRoot>");
const ROOT = resolve(ROOT_ARG);
const MARKERS = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "CLAUDE.md", ".git"];
const NOTABLE = /^(next|react|vue|svelte|astro|vite|express|fastify|@supabase\/|@anthropic-ai\/|openai|@prisma\/|drizzle|tailwindcss|vitest|jest|@playwright\/|django|flask|fastapi)/;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";
const firstLine = (md) => (md.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#") && !l.startsWith("@") && !l.startsWith(">")) || "").slice(0, 200);

function describe(dir) {
  const bits = [];
  try {
    const p = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (p.description) bits.push(p.description);
    const deps = Object.keys({ ...p.dependencies, ...p.devDependencies }).filter((d) => NOTABLE.test(d));
    if (deps.length) bits.push(`Uses ${deps.slice(0, 10).join(", ")}.`);
  } catch {}
  if (existsSync(join(dir, "pyproject.toml"))) bits.push("Python project.");
  if (!bits.length && existsSync(join(dir, "CLAUDE.md"))) bits.push(firstLine(readFileSync(join(dir, "CLAUDE.md"), "utf8")));
  if (!bits.length && existsSync(join(dir, "README.md"))) bits.push(firstLine(readFileSync(join(dir, "README.md"), "utf8")));
  return bits.join(" ").replace(/\s+/g, " ").trim() || "TODO: describe this project in one line.";
}

const projects = [{
  id: "setup",
  description: "Your Claude Code setup in ~/.claude: CLAUDE.md files, rules, skills, commands, agents, hooks, settings, plugins and MCP servers.",
  briefDir: "whats-new-briefs/setup",
}];
const used = new Set(["setup"]);
for (const name of readdirSync(ROOT).sort()) {
  const dir = join(ROOT, name);
  if (name.startsWith(".") || DEFAULT_BLOCKED.includes(name.toLowerCase())) continue;
  try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
  if (!MARKERS.some((m) => existsSync(join(dir, m)))) continue;
  let id = slug(name);
  for (let n = 2; used.has(id); n++) id = `${slug(name)}-${n}`;
  used.add(id);
  projects.push({ id, path: name, description: describe(dir), briefDir: `${name}/${existsSync(join(dir, "docs")) ? "docs/briefs" : "briefs"}` });
}

const draft = { workspaceRoot: ROOT, projects, blocked: [], notUsing: "", model: "sonnet", maxCallsWithoutAsking: 30 };
const out = join(DATA, "config.draft.json");
writeJson(out, draft);
console.log(JSON.stringify({ draft: out, projects: projects.length }, null, 2));
console.log(JSON.stringify(draft, null, 2));
