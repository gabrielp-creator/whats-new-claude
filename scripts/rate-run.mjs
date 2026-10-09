#!/usr/bin/env node
// The orchestrator: one TOOL-LESS `claude -p` call per batch gives each urgent or soon item an overall
// 0 to 10 rating per project, inside the range code allows (lib/rate.mjs). This script validates every
// answer and is the only writer of <data>/rate.jsonl. Resumable; failed batches split and retry.
// Run after lens-run.mjs and verify.mjs, so the lens answers and file evidence exist.
// Calls count against --max-calls or the background budget, as in lens-run.mjs.
// Usage: node rate-run.mjs --max-calls <n> [--data <dir>]
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, readJsonl, PLUGIN_ROOT } from "./lib/store.mjs";
import { loadConfig, projectsProfile } from "./lib/config.mjs";
import { runClaude, callsUsed, callLimit } from "./lib/claude.mjs";
import { loadRows } from "./lib/rows.mjs";
import { runBatches, jsonArray, safeJson } from "./lib/batch.mjs";
import { needsOrchestrator, checkRateAnswer, ratePayload, RATE_BATCH } from "./lib/rate.mjs";

const CONC = 4;
const DATA = dataDir();
const config = loadConfig(DATA);
const out = join(DATA, "rate.jsonl");
const done = new Set(readJsonl(out).map((r) => r.id));
const evs = new Map();
for (const e of readJsonl(join(DATA, "evidence.jsonl"))) { if (!evs.has(e.id)) evs.set(e.id, []); evs.get(e.id).push(e); }

const todo = loadRows(DATA).rows.filter((r) => needsOrchestrator(r) && r.projects.length && !done.has(r.id));
const promptFile = join(DATA, ".lens-rate.md");
writeFileSync(promptFile, readFileSync(join(PLUGIN_ROOT, "lenses", "_shared.md"), "utf8") + "\n" + readFileSync(join(PLUGIN_ROOT, "lenses", "rate.md"), "utf8"));

async function judge(batch) {
  const payload = batch.map((r) => ratePayload(r, evs.get(r.id) || []));
  const raw = await runClaude(`<projects>\n${projectsProfile(config)}\n</projects>\n<items>\n${safeJson(payload)}\n</items>`,
    { model: config.model, promptFile, usageLog: join(DATA, "usage.jsonl"), label: "rate" });
  const byId = new Map(jsonArray(raw).map((a) => [a?.id, a]));
  return batch.map((r) => ({ ...checkRateAnswer(byId.get(r.id), r), model: config.model }));
}

console.log(`rate: ${todo.length} items in ${Math.ceil(todo.length / RATE_BATCH)} batches`);
if (todo.length && !callLimit()) throw new Error("pass --max-calls <n>: the number of Claude calls the user approved");
const { failures } = await runBatches(judge, todo, RATE_BATCH, CONC, out);
if (failures.length) {
  appendFileSync(join(DATA, "failures.log"), failures.map((f) => `${new Date().toISOString()} rate ${f}`).join("\n") + "\n");
  console.log(`\n${failures.length} item(s) still unrated (they show a provisional score; details in failures.log; rerun to retry).`);
  process.exitCode = 1;
} else console.log("\nAll urgent and soon items are rated.");
console.log(`Claude calls used: ${callsUsed()} of ${callLimit()} allowed.`);
