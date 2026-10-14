// One line describing a project for the config draft (scan-projects.mjs): its own description and the
// notable packages in its manifests, at the root and up to two folders down (B-48: a workspace often
// keeps its code in orchestrator/ or packages/x/). Read-only. Tested in tests/describe.test.mjs.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SKIP_DIRS } from "./walk.mjs";

const NOTABLE = /^(next|react|vue|svelte|astro|vite|express|fastify|@supabase\/|@anthropic-ai\/|openai|@prisma\/|drizzle|tailwindcss|vitest|jest|@playwright\/|django|flask|fastapi)/;
const DEPTH = 2;

const firstLine = (md) => (md.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#") && !l.startsWith("@") && !l.startsWith(">")) || "").slice(0, 200);

// The folders to look in: the root first, then subfolders breadth-first, skipping dot folders and the
// walk's skip list (installed packages, build output).
function folders(root) {
  const out = [root];
  for (let i = 0, level = [root]; i < DEPTH; i++) {
    const next = [];
    for (const dir of level) {
      let entries = [];
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch {}
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) next.push(join(dir, e.name));
      }
    }
    out.push(...next);
    level = next;
  }
  return out;
}

// The project's own sentence (root package.json description; the first line of CLAUDE.md or README.md
// only when the root has no manifest, since that line is often boilerplate), then the notable
// packages from every manifest found.
export function describe(dir) {
  const deps = [];
  let own = "", python = false;
  for (const f of folders(dir)) {
    try {
      const p = JSON.parse(readFileSync(join(f, "package.json"), "utf8"));
      if (f === dir && p.description) own = p.description;
      for (const d of Object.keys({ ...p.dependencies, ...p.devDependencies })) if (NOTABLE.test(d) && !deps.includes(d)) deps.push(d);
    } catch {}
    if (existsSync(join(f, "pyproject.toml"))) python = true;
  }
  const rootManifest = ["package.json", "pyproject.toml"].some((m) => existsSync(join(dir, m)));
  if (!rootManifest) for (const doc of ["CLAUDE.md", "README.md"]) if (!own && existsSync(join(dir, doc))) own = firstLine(readFileSync(join(dir, doc), "utf8"));
  const bits = [own, deps.length && `Uses ${deps.slice(0, 10).join(", ")}.`, python && "Python project."].filter(Boolean);
  return bits.join(" ").replace(/\s+/g, " ").trim() || "TODO: describe this project in one line.";
}
