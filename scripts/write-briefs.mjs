#!/usr/bin/env node
// Writes briefs into each project's brief folder, from either
//   top: every project rating at or above --min (default: the config's minRating) in the last 30
//        days, optionally only --project <id>. The terminal's "export top picks" button.
//   <export.json>: the selection saved on the review page, which Claude exports from its database:
//   { "picks": [{id, data: {projects}}], "folders": [{id: project, data: {dir}}], "plain": [{id, data: {text}}] }
// Briefs are regenerated from the stored rows with lib/brief.mjs, never copied from the page.
// Writes only inside the workspace root, never into blocked folders, never overwrites (adds -2, -3).
// Commits nothing.
// Usage: node write-briefs.mjs <top|export.json> [date=today] [--min N] [--project id] [--dry-run] [--data <dir>]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { dataDir } from "./lib/store.mjs";
import { loadConfig } from "./lib/config.mjs";
import { loadRows } from "./lib/rows.mjs";
import { buildBrief, briefFileName } from "./lib/brief.mjs";
import { safeBriefDir, inProjectScope, recheckCreated } from "./lib/paths.mjs";
import { topPicks } from "./lib/show.mjs";
import { parseCommand } from "./lib/args.mjs";

const DATA = dataDir();
// Split arguments: --data is store.mjs's; --min, --project and --dry-run are checked by the shared parser.
const pos = [], flags = [];
for (let i = 2, a = process.argv; i < a.length; i++) {
  if (a[i] === "--data") { i++; continue; }
  if (a[i] === "--min" || a[i] === "--project") { flags.push(a[i], a[++i] ?? ""); continue; }
  (a[i].startsWith("--") ? flags : pos).push(a[i]);
}
const OPTS = parseCommand(["export", ...flags]);
const DRY = Boolean(OPTS.dryRun);
const [FILE, DATE = new Date().toISOString().slice(0, 10)] = pos;
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) throw new Error(`date must look like 2026-10-08, not ${JSON.stringify(DATE)}`);
if (!FILE) throw new Error("usage: write-briefs.mjs <top|export.json> [date] [--min N] [--project id] [--dry-run]");
const config = loadConfig(DATA);
const projects = new Map(config.projects.map((p) => [p.id, p]));

const allRows = loadRows(DATA).rows;
const rows = new Map(allRows.map((r) => [r.id, r]));
let exp;
if (FILE === "top") {
  exp = { picks: topPicks(allRows, { min: OPTS.min ?? config.minRating, project: OPTS.project, days: 30 }) };
} else exp = JSON.parse(readFileSync(FILE, "utf8"));
// The page's plain-language rewrites are model output that page viewers can edit: never put in a brief.
const folders = new Map((exp.folders || []).map((f) => [f.id, f.data?.dir]));

const byProject = new Map();
for (const p of exp.picks || []) {
  const row = rows.get(p.id);
  if (!row) { console.error(`skipping unknown item ${p.id}`); continue; }
  for (const proj of Array.isArray(p.data?.projects) ? p.data.projects : []) {
    if (!projects.has(proj)) { console.error(`skipping unknown project ${JSON.stringify(proj)}`); continue; }
    if (!byProject.has(proj)) byProject.set(proj, []);
    // The orchestrator's per-project next step, when there is one, beats the type lens's general one.
    const act = row.ratings?.find((x) => x.project === proj)?.do;
    byProject.get(proj).push({ ...row, action: act || row.action });
  }
}
if (!byProject.size) throw new Error("no saved picks with a known project; nothing to write");

for (const [proj, items] of byProject) {
  const project = projects.get(proj);
  let dir = safeBriefDir(config.workspaceRoot, project.briefDir, config.blocked);
  const pageDir = folders.get(proj);
  if (typeof pageDir === "string" && pageDir.trim()) {
    // A folder chosen on the page (editable by other viewers) is used only inside the project's own folder.
    let chosen = null;
    try { chosen = safeBriefDir(config.workspaceRoot, pageDir, config.blocked); } catch (e) { console.error(`${proj}: page folder refused (${e.message}); using ${project.briefDir}`); }
    if (chosen && inProjectScope(config.workspaceRoot, project, chosen)) dir = chosen;
    else if (chosen) console.error(`${proj}: page folder ${JSON.stringify(pageDir)} is outside the project; using ${project.briefDir}`);
  }
  const md = buildBrief(proj, items, { date: DATE, dir: relative(config.workspaceRoot, dir).split(sep).join("/"), rootLabel: config.workspaceRoot });
  let file = join(dir, briefFileName(proj, DATE));
  for (let n = 2; existsSync(file); n++) file = join(dir, briefFileName(proj, DATE).replace(/\.md$/, `-${n}.md`));
  // "wx": never overwrite, and never write through a file or link that appeared after the check above.
  if (!DRY) {
    mkdirSync(dir, { recursive: true });
    recheckCreated(config.workspaceRoot, dir, config.blocked); // where the created folder really is
    writeFileSync(file, md, { flag: "wx" });
  }
  console.log(`${DRY ? "would write" : "wrote"} ${items.length} item(s) -> ${file}`);
}
