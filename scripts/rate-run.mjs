#!/usr/bin/env node
// The orchestrator: one TOOL-LESS `claude -p` call per batch gives each urgent or soon item an overall
// 0 to 10 rating per project, inside the range code allows (lib/rate.mjs). This script validates every
// answer and is the only writer of <data>/rate.jsonl. Resumable; failed batches split and retry.
// Run after lens-run.mjs and verify.mjs, so the lens answers and file evidence exist.
// Calls count against --max-calls or the background budget, as in lens-run.mjs.
// Usage: node rate-run.mjs --max-calls <n> [--data <dir>]
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, readJsonl, readJson, writeJson, PLUGIN_ROOT, PLUGIN_VERSION } from "./lib/store.mjs";
import { FAILING_FILE, GIVE_UP_RUNS, skippedIds, recordRun } from "./lib/failing.mjs";
import { loadConfig, projectsProfile } from "./lib/config.mjs";
import { runClaude, callsUsed, callLimit } from "./lib/claude.mjs";
import { loadRows } from "./lib/rows.mjs";
import { runBatches, jsonArray, safeJson } from "./lib/batch.mjs";
import { checkRateAnswer, ratePayload, seenFor, RATE_BATCH } from "./lib/rate.mjs";

const CONC = 4;
const DATA = dataDir();
const config = loadConfig(DATA);
const out = join(DATA, "rate.jsonl");
const evs = new Map();
for (const e of readJsonl(join(DATA, "evidence.jsonl"))) { if (!evs.has(e.id)) evs.set(e.id, []); evs.get(e.id).push(e); }
const models = readJson(join(DATA, "models.json"), undefined);

// Never rated, or rated under a range or file check that has since changed (lib/rows.mjs toRate),
// less those whose answer failed GIVE_UP_RUNS runs in a row (B-9, lib/failing.mjs).
const failing = readJson(join(DATA, FAILING_FILE), {});
const who = { version: PLUGIN_VERSION, model: config.model };
const skip = skippedIds(failing, "rate", who);
const open = loadRows(DATA).rows.filter((r) => r.toRate);
const todo = open.filter((r) => !skip.has(r.id));
const promptFile = join(DATA, ".lens-rate.md");
writeFileSync(promptFile, readFileSync(join(PLUGIN_ROOT, "lenses", "_shared.md"), "utf8") + "\n" + readFileSync(join(PLUGIN_ROOT, "lenses", "rate.md"), "utf8"));

async function judge(batch) {
  const payload = batch.map((r) => ratePayload(r, evs.get(r.id) || [], models));
  const raw = await runClaude(`<projects>\n${projectsProfile(config)}\n</projects>\n<items>\n${safeJson(payload)}\n</items>`,
    { model: config.model, promptFile, usageLog: join(DATA, "usage.jsonl"), label: "rate" });
  const byId = new Map(jsonArray(raw).map((a) => [a?.id, a]));
  return batch.map((r) => ({ ...checkRateAnswer(byId.get(r.id), r), model: config.model, version: PLUGIN_VERSION, seen: seenFor(r, evs.get(r.id) || [], models) }));
}

console.log(`rate: ${todo.length} items in ${Math.ceil(todo.length / RATE_BATCH)} batches${todo.length < open.length ? `; ${open.length - todo.length} skipped` : ""}`);
if (todo.length && !callLimit()) throw new Error("pass --max-calls <n>: the number of Claude calls the user approved");
const { failures } = await runBatches(judge, todo, RATE_BATCH, CONC, out);
writeJson(join(DATA, FAILING_FILE), recordRun(failing, "rate", { tried: todo.map((r) => r.id), failures, ...who }));
const skipped = open.length - todo.length;
if (failures.length) {
  appendFileSync(join(DATA, "failures.log"), failures.map((f) => `${new Date().toISOString()} rate ${f.id}: ${f.error}`).join("\n") + "\n");
  console.log(`\n${failures.length} item(s) still unrated (they show a provisional score; details in failures.log; rerun to retry).`);
  process.exitCode = 1;
} else if (!skipped) console.log("\nAll urgent and soon items are rated.");
if (skipped) console.log(`\n${skipped} item(s) skipped after failing ${GIVE_UP_RUNS} runs in a row; they show a provisional score, and a new plugin version or model tries them again (details in failures.log).`);
console.log(`Claude calls used: ${callsUsed()} of ${callLimit()} allowed.`);
