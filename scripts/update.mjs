#!/usr/bin/env node
// SessionStart hook, run in the background ("async": true in hooks/hooks.json): updates the user's
// results when their update frequency says it is due.
// - Free steps always: fetch, enrich, the local file check, and rebuilding the summary and local page.
// - Claude calls (lenses and rating) only when the whole plan fits the user's background budget
//   (auto_rate_max_calls in /config, default 0 = never), with a hard per-process cap (WNC_MAX_CALLS).
// - Never the first run (the user picks how far back), never publishing the page (needs Claude).
// - One run at a time across sessions and /whats-new (lib/lock.mjs); every outcome is recorded in
//   <data>/updater.json for the reminder, so a failure is never silent.
// The lens calls it starts run in --safe-mode, which loads no plugins or hooks, so they cannot
// start this hook again (observed 2026-10-08 with the plugin installed).
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, writeJson, dataDir } from "./lib/store.mjs";
import { loadConfig } from "./lib/config.mjs";
import { optionsFromEnv, mergeOptions } from "./lib/options.mjs";
import { isDue, budgetDecision, stepOutcome, remainingBudget, stepEnv, offlineRun } from "./lib/updater.mjs";
import { takeLock, refreshLock, releaseLock } from "./lib/lock.mjs";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const DATA = dataDir();
const STEP_TIMEOUT = 30 * 60e3;
// B-8: a step this timeout kills runs no exit code on Windows, so its claude calls would run on. A
// paid step gets a deadline 2 minutes earlier and ends its calls itself (lib/claude.mjs).
const DEADLINE_MARGIN = 2 * 60e3;

function input() {
  try { return JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { return {}; }
}

function step(script, extra = {}) {
  refreshLock(DATA);
  if (extra.WNC_MAX_CALLS !== undefined) extra = { ...extra, WNC_DEADLINE: String(Date.now() + STEP_TIMEOUT - DEADLINE_MARGIN) };
  return stepOutcome(spawnSync(process.execPath, [join(SCRIPTS, script), "--data", DATA],
    { encoding: "utf8", env: stepEnv(script, process.env, extra), timeout: STEP_TIMEOUT, windowsHide: true }));
}

function main() {
  const src = input().source;
  if (src && src !== "startup") return;
  if (!existsSync(join(DATA, "config.json")) || !existsSync(join(DATA, "state.json"))) return; // setup and first run are /whats-new's
  const config = mergeOptions(loadConfig(DATA), optionsFromEnv(process.env));
  if (!isDue(readJson(join(DATA, "updater.json"), null), config.updateFrequency)) return;
  if (!takeLock(DATA, "background update")) return;
  const record = { lastAttempt: new Date().toISOString(), finishedAt: null, running: true, failed: [], offline: false, waiting: null, incomplete: false, errors: [] };
  // Recorded before the first step: if this process is killed, the reminder can still tell (lib/reminder.mjs).
  writeJson(join(DATA, "updater.json"), record);
  const must = (name, r) => { if (!r.ok) { record.incomplete = true; record.errors.push(`${name}: ${r.error}`); } return r.ok; };
  try {
    const fetch = step("fetch.mjs");
    // A failed source exits 1 but saves the rest, and state.json names it. Anything else is a crash.
    const state = readJson(join(DATA, "state.json"), {});
    record.failed = Object.entries(state.sources || {}).filter(([, s]) => s.lastError).map(([k]) => k);
    // No network at all (B-69): nothing new to work on; the next session tries again (isDue).
    if (offlineRun(state, record.lastAttempt)) { record.offline = true; return; }
    if (!fetch.ok && !record.failed.length) must("fetch", fetch);
    if (!must("enrich-commits", step("enrich-commits.mjs"))) return;
    // The plan's rating figure reads the evidence, so the file check runs first (B-70).
    must("verify", step("verify.mjs"));
    const planStep = step("plan.mjs");
    if (!must("plan", planStep)) return;
    const plan = JSON.parse(planStep.out);
    const decision = budgetDecision(plan, config.autoRateMaxCalls);
    let left = config.autoRateMaxCalls;
    if (decision.run) {
      const lens = step("lens-run.mjs", { WNC_MAX_CALLS: String(left) });
      left = remainingBudget(left, lens);
      must("lens-run", lens);
      must("verify", step("verify.mjs")); // the items the lenses just tied
    }
    if (decision.run && left > 0) must("rate-run", step("rate-run.mjs", { WNC_MAX_CALLS: String(left) }));
    if (decision.waiting) record.waiting = { items: Math.max(plan.itemsNeedingReview || 0, plan.itemsToRate || 0), calls: plan.calls, redo: plan.itemsToRedo || 0 };
    must("build-page", step("build-page.mjs"));
  } catch (e) {
    record.incomplete = true;
    record.errors.push(String(e?.message || e).replace(/\s+/g, " ").slice(0, 200));
  } finally {
    record.finishedAt = new Date().toISOString();
    record.running = false;
    writeJson(join(DATA, "updater.json"), record);
    releaseLock(DATA);
  }
}

try { main(); } catch {}
