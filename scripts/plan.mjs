#!/usr/bin/env node
// Cost guard: says how many items still need lens answers or a rating and how many `claude -p` calls
// that is, and whether it is over the user's "ask me first" limit. Prints JSON; changes nothing.
// Rating calls for items the lenses have not seen yet are an estimate (RATED_SHARE of them).
// Usage: node plan.mjs [--data <dir>]
import { join } from "node:path";
import { dataDir, readJsonl, readJson, PLUGIN_VERSION } from "./lib/store.mjs";
import { FAILING_FILE, LENSES, skippedIds, skippedItems } from "./lib/failing.mjs";
import { loadConfig } from "./lib/config.mjs";
import { lensItems, loadRows } from "./lib/rows.mjs";
import { planCalls } from "./lib/plan.mjs";
import { isFyi } from "./lib/merge.mjs";

const DATA = dataDir();
const config = loadConfig(DATA);
const items = lensItems(DATA);
// B-9: items whose answer failed 3 runs in a row are skipped by lens-run and rate-run, so not counted.
const failing = readJson(join(DATA, FAILING_FILE), {});
const who = { version: PLUGIN_VERSION, model: config.model };
// First-party and FYI-only items are batched apart (lib/batch.mjs), so they are counted apart.
const split = (xs) => ({ first: xs.filter((x) => !isFyi(x)).length, fyi: xs.filter(isFyi).length });
const unreviewed = new Map();
const perLens = LENSES.map((l) => {
  const done = new Set(readJsonl(join(DATA, `lens-${l}.jsonl`)).map((r) => r.id));
  const skip = skippedIds(failing, l, who);
  const open = items.filter((i) => !done.has(i.id));
  for (const i of open) unreviewed.set(i.id, i);
  return split(open.filter((i) => !skip.has(i.id)));
});
const open = loadRows(DATA).rows.filter((r) => r.toRate); // rate-run.mjs's own filter: unrated or stale
const skipRate = skippedIds(failing, "rate", who);
const todo = open.filter((r) => !skipRate.has(r.id));
const unratedKnown = split(todo);
const toRedo = todo.filter((r) => r.redo).length; // B-65: rated before, not new
const skippedFailing = skippedItems(failing, who, { unreviewed: [...unreviewed.values()], toRate: open }).size;
console.log(JSON.stringify({ ...planCalls({ perLens, unratedKnown, toRedo, limit: config.maxCallsWithoutAsking }), skippedFailing, model: config.model }, null, 2));
