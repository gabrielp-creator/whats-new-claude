#!/usr/bin/env node
// Builds the user's review page <data>/results.html from the stored items and lens answers, with
// lib/brief.mjs inlined so the page builds the same briefs as write-briefs.mjs. Items still missing
// a lens answer are left out, and the page says how many.
// Usage: node build-page.mjs [--data <dir>]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, PLUGIN_ROOT, writeJson } from "./lib/store.mjs";
import { STALE_DAYS } from "./lib/reminder.mjs";
import { loadConfig } from "./lib/config.mjs";
import { loadRows } from "./lib/rows.mjs";
import { topPicks } from "./lib/show.mjs";

const DATA = dataDir();
const config = loadConfig(DATA);
const { rows, missing } = loadRows(DATA);
const dates = rows.map((i) => i.date).filter(Boolean).sort();
const data = {
  total: rows.length, from: dates[0] || "", to: dates.at(-1) || "",
  projects: config.projects.map((p) => ({ id: p.id, briefDir: p.briefDir })), minRating: config.minRating,
  rootLabel: config.workspaceRoot,
  note: missing ? `${missing} newer item(s) are not reviewed yet; run /whats-new again to finish them.` : "",
  items: rows,
};
const json = JSON.stringify(data).replace(/</g, "\\u003c"); // keep fetched text from closing the script tag
const briefLib = readFileSync(join(PLUGIN_ROOT, "scripts/lib/brief.mjs"), "utf8").replace(/^export /gm, "");
const html = readFileSync(join(PLUGIN_ROOT, "templates/results-page.template.html"), "utf8")
  .replace("__BRIEF_LIB__", () => briefLib.replace(/<\/script/gi, "<\\/script"))
  .replace("__DATA__", () => json);
const out = join(DATA, "results.html");
writeFileSync(out, html);
const counts = {};
for (const r of rows) counts[r.urgencyLabel] = (counts[r.urgencyLabel] || 0) + 1;
// Numbers only, for the session-start reminder (lib/reminder.mjs): top picks per project, last 7 days.
const top = {};
for (const p of topPicks(rows, { min: config.minRating, days: STALE_DAYS })) for (const id of p.data.projects) top[id] = (top[id] || 0) + 1;
const topTotal = Object.values(top).reduce((s, n) => s + n, 0);
writeJson(join(DATA, "summary.json"), { builtAt: new Date().toISOString(), min: config.minRating, top, topTotal, total: counts });
console.log(JSON.stringify({ page: out, items: rows.length, notYetReviewed: missing, urgency: counts }, null, 2));
