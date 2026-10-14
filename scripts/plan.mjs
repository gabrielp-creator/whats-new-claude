#!/usr/bin/env node
// Cost guard: says how many items still need lens answers or a rating and how many `claude -p` calls
// that is, and whether it is over the user's "ask me first" limit. Prints JSON; changes nothing.
// Rating calls for items the lenses have not seen yet are an estimate (RATED_SHARE of them).
// Usage: node plan.mjs [--data <dir>]
import { join } from "node:path";
import { dataDir, readJsonl } from "./lib/store.mjs";
import { loadConfig } from "./lib/config.mjs";
import { lensItems, loadRows } from "./lib/rows.mjs";
import { planCalls } from "./lib/plan.mjs";
import { isFyi } from "./lib/merge.mjs";

const DATA = dataDir();
const config = loadConfig(DATA);
const items = lensItems(DATA);
// First-party and FYI-only items are batched apart (lib/batch.mjs), so they are counted apart.
const split = (xs) => ({ first: xs.filter((x) => !isFyi(x)).length, fyi: xs.filter(isFyi).length });
const perLens = ["impact", "type", "risk"].map((l) => {
  const done = new Set(readJsonl(join(DATA, `lens-${l}.jsonl`)).map((r) => r.id));
  return split(items.filter((i) => !done.has(i.id)));
});
const todo = loadRows(DATA).rows.filter((r) => r.toRate); // rate-run.mjs's own filter: unrated or stale
const unratedKnown = split(todo);
const toRedo = todo.filter((r) => r.redo).length; // B-65: rated before, not new
console.log(JSON.stringify({ ...planCalls({ perLens, unratedKnown, toRedo, limit: config.maxCallsWithoutAsking }), model: config.model }, null, 2));
