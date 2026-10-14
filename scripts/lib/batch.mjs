// Shared by lens-run.mjs and rate-run.mjs: run a batch through a tool-less judge, retry once, then
// split in half down to single items, so one odd item cannot block a run. Returns the ids that still
// failed; rows that succeed are appended to `out` as they arrive (runs are resumable).
import { appendFileSync } from "node:fs";
import { isFyi } from "./merge.mjs";

// One injected item can steer every answer in its batch (B-7, B-66). When a batch comes back with more
// than this many items flagged for injection, each flagged item is judged again on its own: the
// injected one stays flagged, the items it steered get clean answers. Each re-check is one more call
// against the same cap; one that cannot run keeps the batch's (flagged, fail-closed) answer.
export const INJECTION_RECHECK_OVER = 3;

async function recheckFlagged(judge, batch, rows) {
  const flagged = rows.filter((r) => r?.injection === true);
  if (batch.length < 2 || flagged.length <= INJECTION_RECHECK_OVER) return rows;
  const byId = new Map(batch.map((i) => [i.id, i]));
  const fresh = new Map();
  for (const r of flagged) {
    try {
      const [alone] = await judge([byId.get(r.id)]);
      if (alone?.id === r.id) fresh.set(r.id, alone);
    } catch {}
  }
  return rows.map((r) => fresh.get(r.id) || r);
}

export async function judgeWithSplit(judge, batch, out) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const rows = await recheckFlagged(judge, batch, await judge(batch));
      appendFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
      return [];
    } catch (e) {
      if (attempt === 2 && batch.length === 1) return [`${batch[0].id}: ${e.message}`];
    }
  }
  const mid = Math.ceil(batch.length / 2);
  return [...await judgeWithSplit(judge, batch.slice(0, mid), out), ...await judgeWithSplit(judge, batch.slice(mid), out)];
}

// Runs every batch with `conc` workers. Returns all failures. Fork and third-party items are batched
// apart from first-party ones, so their text never shares a call with an official item (B-66).
export async function runBatches(judge, todo, size, conc, out) {
  const batches = [];
  for (const group of [todo.filter((x) => !isFyi(x)), todo.filter(isFyi)]) {
    for (let k = 0; k < group.length; k += size) batches.push(group.slice(k, k + size));
  }
  const failures = [];
  let next = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < batches.length) failures.push(...await judgeWithSplit(judge, batches[next++], out));
  }));
  return { batches: batches.length, failures };
}

// The JSON array in a model reply (models sometimes wrap it in prose or a code fence).
export const jsonArray = (raw) => JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));

// JSON for a model payload with every "<" escaped, so fetched text cannot fake </items> or other tags.
export const safeJson = (v) => JSON.stringify(v).replace(/</g, String.fromCharCode(92) + "u003c");

// A model's "injection" answer, failing closed: true in any spelling counts as flagged.
export const injectionFlag = (v) => v === true || /^true$/i.test(String(v ?? "").trim());
