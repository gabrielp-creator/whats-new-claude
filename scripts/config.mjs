#!/usr/bin/env node
// Reads or saves the user's config. `apply` validates a draft and saves it as config.json; it is run
// only after the user has confirmed the draft. `set-page` remembers the review page URL.
// Usage: node config.mjs show | apply <draft.json> | set-page <url> | get-page   [--data <dir>]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, positional, readJson, writeJson } from "./lib/store.mjs";
import { validateConfig } from "./lib/config.mjs";

const DATA = dataDir();
const [cmd, arg] = positional();
const path = join(DATA, "config.json");

if (cmd === "show") {
  console.log(JSON.stringify(readJson(path, null), null, 2));
} else if (cmd === "apply") {
  const draft = JSON.parse(readFileSync(arg, "utf8"));
  const errors = validateConfig(draft);
  if (errors.length) { console.error(`Not saved. Fix these first:\n- ${errors.join("\n- ")}`); process.exit(1); }
  const prev = readJson(path, {});
  writeJson(path, { ...draft, pageUrl: prev.pageUrl });
  console.log(`saved ${path} (${draft.projects.length} projects)`);
} else if (cmd === "set-page") {
  if (!/^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9-]+$/.test(arg || "")) { console.error("expected a claude.ai artifact URL"); process.exit(1); }
  const c = readJson(path, null);
  if (!c) { console.error("no config yet"); process.exit(1); }
  writeJson(path, { ...c, pageUrl: arg });
  console.log(`page: ${arg}`);
} else if (cmd === "get-page") {
  console.log(readJson(path, {}).pageUrl || "");
} else {
  console.error("usage: config.mjs show | apply <draft.json> | set-page <url> | get-page");
  process.exit(1);
}
