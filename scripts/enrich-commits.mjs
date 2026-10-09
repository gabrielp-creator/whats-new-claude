#!/usr/bin/env node
// Commit items (skills, cookbooks) carry only a title from the list API. This fetches each commit's
// full message and changed file names into <data>/commit-details.jsonl, which the lenses read as the
// item text. Deterministic, read-only HTTP to api.github.com only (lib/net.mjs). Resumable.
// Usage: node enrich-commits.mjs [--data <dir>]
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, readJsonl } from "./lib/store.mjs";
import { get, errLine } from "./lib/net.mjs";

const DATA = dataDir();
const OUT = join(DATA, "commit-details.jsonl");
const done = new Set(readJsonl(OUT).map((r) => r.id));
const todo = readJsonl(join(DATA, "items.jsonl")).filter((i) => (i.source === "skills" || i.source === "cookbooks") && !done.has(i.id));

let failed = 0;
for (const i of todo) {
  const m = i.url.match(/^https:\/\/github\.com\/(anthropics\/[^/]+)\/commit\/([0-9a-f]{40})$/);
  if (!m) { failed++; console.error(`unexpected url for ${i.id}`); continue; }
  let c;
  try { c = await get(`https://api.github.com/repos/${m[1]}/commits/${m[2]}`, { json: true }); }
  catch (e) { failed++; console.error(`${errLine(e)} for ${i.id}`); continue; }
  const body = c.commit.message.split("\n").slice(1).join(" ").replace(/\s+/g, " ").trim().slice(0, 800);
  const files = (c.files || []).slice(0, 15).map((f) => `${f.status} ${f.filename}`);
  const more = (c.files || []).length > 15 ? ` (+${c.files.length - 15} more)` : "";
  const text = [body, files.length ? `Files: ${files.join(", ")}${more}` : ""].filter(Boolean).join("\n");
  appendFileSync(OUT, JSON.stringify({ id: i.id, text }) + "\n");
}
console.log(`commit details: ${todo.length - failed} added, ${failed} failed`);
if (failed) process.exitCode = 1;
