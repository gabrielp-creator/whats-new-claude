#!/usr/bin/env node
// Shows stored results in the session, free (no fetch, no Claude calls):
//   here: rated items for the project the working directory is in (or --project)
//   news: recent Anthropic models, features, deprecations and security changes, any project
// Output is guarded and labelled as untrusted data (lib/show.mjs).
// Usage: node show.mjs <here|news> [--min N] [--days N] [--project id] [--data <dir>]
import { join } from "node:path";
import { dataDir, readJson } from "./lib/store.mjs";
import { loadConfig } from "./lib/config.mjs";
import { loadRows } from "./lib/rows.mjs";
import { parseCommand } from "./lib/args.mjs";
import { projectForCwd, hereList, newsList, formatList, lastChecked } from "./lib/show.mjs";

const DATA = dataDir();
const argv = process.argv.slice(2);
const d = argv.indexOf("--data");
if (d !== -1) argv.splice(d, 2);
const opts = parseCommand(argv);
const config = loadConfig(DATA);
const { rows } = loadRows(DATA);
const checked = lastChecked(readJson(join(DATA, "state.json"), null));

if (opts.cmd === "here") {
  const project = opts.project || projectForCwd(config, process.cwd());
  if (!project) {
    console.log(`This folder is not one of your configured projects (${config.projects.map((p) => p.id).join(", ")}). Use --project <id>, or /whats-new setup to add it.`);
  } else if (!config.projects.some((p) => p.id === project)) {
    console.log(`Unknown project "${project}". Configured: ${config.projects.map((p) => p.id).join(", ")}.`);
  } else {
    const min = opts.min ?? config.minRating, days = opts.days ?? 30;
    console.log(formatList(hereList(rows, { project, min, days }), { heading: `${project}: items rated ${min}+ in the last ${days} days`, lastChecked: checked }));
  }
} else if (opts.cmd === "news") {
  const days = opts.days ?? 7;
  console.log(formatList(newsList(rows, { days }), { heading: `Anthropic news, last ${days} days (models, new features, deprecations, security)`, lastChecked: checked }));
} else {
  throw new Error(`show.mjs handles here and news, not ${opts.cmd}`);
}
