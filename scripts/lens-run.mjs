#!/usr/bin/env node
// Runs the three review lenses (impact, type, risk) over every stored item that lacks an answer.
// Each lens is a TOOL-LESS `claude -p` call; this script validates every answer and is the only
// writer of <data>/lens-<lens>.jsonl. Resumable. A batch whose answer leaves out an item is retried
// in smaller pieces down to single items, so one odd item cannot block the run. Every call counts
// against --max-calls (the number the user approved) or the background budget; with neither, it
// makes no calls. Failure details go to <data>/failures.log, not to the session.
// Usage: node lens-run.mjs [lens=all] --max-calls <n> [--data <dir>]
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, positional, readJsonl, readJson, writeJson, PLUGIN_ROOT, PLUGIN_VERSION } from "./lib/store.mjs";
import { FAILING_FILE, GIVE_UP_RUNS, skippedIds, recordRun } from "./lib/failing.mjs";
import { loadConfig, projectsProfile } from "./lib/config.mjs";
import { runClaude, callsUsed, callLimit } from "./lib/claude.mjs";
import { lensItems } from "./lib/rows.mjs";
import { runBatches, jsonArray, safeJson, injectionFlag } from "./lib/batch.mjs";

const DATA = dataDir();
const [WHICH = "all"] = positional();
const config = loadConfig(DATA);
const PROFILE = projectsProfile(config);
const PROJECT_IDS = new Set(config.projects.map((p) => p.id));
const BATCH = 60, CONC = 4;

const oneOf = (...v) => (x) => v.includes(x);
const bool = (x) => typeof x === "boolean";
const text = (n) => (x) => String(x ?? "").slice(0, n);
export const SCHEMAS = {
  impact: {
    check: { effect: oneOf("fixes", "improves", "unlocks", "none"), projects: (x) => Array.isArray(x) && x.every((p) => PROJECT_IDS.has(p)),
      new_work: bool, strength: oneOf("high", "medium", "low") },
    text: { why: text(200) },
  },
  type: {
    check: { type: oneOf("bug-fix", "new-capability", "improvement", "performance", "model", "breaking-or-deprecation", "security",
      "docs-or-example", "research", "internal"),
    action: oneOf("model-refresh", "claude-md-rule", "try-feature", "update-harness", "update-code", "read", "ignore") },
    text: {},
  },
  risk: {
    check: { risk: oneOf("breaking", "deprecation", "behavior-change", "security", "none"), exposed: bool },
    text: { why: text(160) },
  },
};

async function judge(lens, promptFile, batch) {
  const schema = SCHEMAS[lens];
  const payload = batch.map((i) => ({ id: i.id, source: i.source, title: i.title, text: i.text, provenance: i.provenance }));
  const raw = await runClaude(`<projects>\n${PROFILE}\n</projects>\n<items>\n${safeJson(payload)}\n</items>`,
    { model: config.model, promptFile, usageLog: join(DATA, "usage.jsonl"), label: lens });
  const arr = jsonArray(raw);
  const byId = new Map(arr.map((r) => [r.id, r]));
  return batch.map((i) => {
    const r = byId.get(i.id);
    if (!r) throw new Error(`missing row for ${i.id}`);
    for (const [k, ok] of Object.entries(schema.check)) if (!ok(r[k])) throw new Error(`${i.id}: bad ${k}: ${JSON.stringify(r[k])}`);
    const row = { id: i.id };
    for (const k of Object.keys(schema.check)) row[k] = r[k];
    for (const [k, norm] of Object.entries(schema.text)) row[k] = norm(r[k]);
    row.injection = injectionFlag(r.injection);
    row.model = config.model;
    return row;
  });
}

const items = lensItems(DATA);
const lenses = WHICH === "all" ? Object.keys(SCHEMAS) : [WHICH];
if (!callLimit()) throw new Error("pass --max-calls <n>: the number of Claude calls the user approved");
let failures = [];
// B-9: items whose answer failed GIVE_UP_RUNS runs in a row are skipped (lib/failing.mjs).
let failing = readJson(join(DATA, FAILING_FILE), {});
const who = { version: PLUGIN_VERSION, model: config.model };
const skipped = new Set();
const runs = [];
await Promise.all(lenses.map(async (lens) => {
  if (!SCHEMAS[lens]) throw new Error(`unknown lens ${lens}`);
  const promptFile = join(DATA, `.lens-${lens}.md`);
  writeFileSync(promptFile, readFileSync(join(PLUGIN_ROOT, "lenses", "_shared.md"), "utf8") + "\n" + readFileSync(join(PLUGIN_ROOT, "lenses", `${lens}.md`), "utf8"));
  const out = join(DATA, `lens-${lens}.jsonl`);
  const done = new Set(readJsonl(out).map((r) => r.id));
  const skip = skippedIds(failing, lens, who);
  const open = items.filter((i) => !done.has(i.id));
  const todo = open.filter((i) => !skip.has(i.id));
  for (const i of open) if (skip.has(i.id)) skipped.add(i.id);
  console.log(`lens ${lens}: ${todo.length} items in ${Math.ceil(todo.length / BATCH)} batches${todo.length < open.length ? `; ${open.length - todo.length} skipped` : ""}`);
  const r = await runBatches((batch) => judge(lens, promptFile, batch), todo, BATCH, CONC, out);
  runs.push({ lens, tried: todo.map((i) => i.id), failures: r.failures });
  failures.push(...r.failures.map((f) => `${lens} ${f.id}: ${f.error}`));
}));
for (const r of runs) failing = recordRun(failing, r.lens, { ...r, ...who });
writeJson(join(DATA, FAILING_FILE), failing);
if (failures.length) {
  appendFileSync(join(DATA, "failures.log"), failures.map((f) => `${new Date().toISOString()} ${f}`).join("\n") + "\n");
  console.log(`\n${failures.length} item answer(s) still failing (details in failures.log; rerun to retry).`);
  process.exitCode = 1;
} else if (!skipped.size) console.log("\nAll items have answers from every lens.");
if (skipped.size) console.log(`\n${skipped.size} item(s) skipped after failing ${GIVE_UP_RUNS} runs in a row; a new plugin version or model tries them again (details in failures.log).`);
console.log(`Claude calls used: ${callsUsed()} of ${callLimit()} allowed.`);
