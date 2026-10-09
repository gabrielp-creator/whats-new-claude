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
import { needsOrchestrator } from "./lib/rate.mjs";

const DATA = dataDir();
const config = loadConfig(DATA);
const items = lensItems(DATA);
const perLens = ["impact", "type", "risk"].map((l) => {
  const done = new Set(readJsonl(join(DATA, `lens-${l}.jsonl`)).map((r) => r.id));
  return items.filter((i) => !done.has(i.id)).length;
});
const rated = new Set(readJsonl(join(DATA, "rate.jsonl")).map((r) => r.id));
const unratedKnown = loadRows(DATA).rows.filter((r) => needsOrchestrator(r) && r.projects.length && !rated.has(r.id)).length; // rate-run.mjs's own filter
console.log(JSON.stringify({ ...planCalls({ perLens, unratedKnown, limit: config.maxCallsWithoutAsking }), model: config.model }, null, 2));
