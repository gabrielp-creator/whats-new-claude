// Shared by lens-run.mjs and rate-run.mjs: run a batch through a tool-less judge, retry once, then
// split in half down to single items, so one odd item cannot block a run. Returns the ids that still
// failed; rows that succeed are appended to `out` as they arrive (runs are resumable).
import { appendFileSync } from "node:fs";

export async function judgeWithSplit(judge, batch, out) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const rows = await judge(batch);
      appendFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
      return [];
    } catch (e) {
      if (attempt === 2 && batch.length === 1) return [`${batch[0].id}: ${e.message}`];
    }
  }
  const mid = Math.ceil(batch.length / 2);
  return [...await judgeWithSplit(judge, batch.slice(0, mid), out), ...await judgeWithSplit(judge, batch.slice(mid), out)];
}

// Runs every batch with `conc` workers. Returns all failures.
export async function runBatches(judge, todo, size, conc, out) {
  const batches = [];
  for (let k = 0; k < todo.length; k += size) batches.push(todo.slice(k, k + size));
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
