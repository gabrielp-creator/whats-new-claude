// B-9: an item whose answer fails its checks every run would be retried every run, each time at a
// cost. lens-run.mjs and rate-run.mjs record, per lens ("rate" for the rater), how many runs in a row
// each item failed on its own; after GIVE_UP_RUNS under the same plugin version and model the item is
// skipped, plan.mjs stops counting its calls, and the run, the plan and the page say how many. A new
// plugin version or model tries it again. A call that failed as a call (cap, deadline, claude not
// starting) is never held against an item, and a run in which no item got an answer starts no count:
// that is the model or the service, not the item. Only those two scripts write <data>/failing.json.
// Tested in tests/failing.test.mjs.
export const GIVE_UP_RUNS = 3;
export const FAILING_FILE = "failing.json";
export const LENSES = ["impact", "type", "risk"];

const current = (e, { version, model }) => Boolean(e) && e.version === version && e.model === model;

// record: failing.json's content; who: {version, model} of this run.
export function skippedIds(record, lens, who) {
  return new Set(Object.entries(record?.[lens] || {}).filter(([, e]) => current(e, who) && e.runs >= GIVE_UP_RUNS).map(([id]) => id));
}

// The items left out for now, for plan.mjs and the page: unreviewed items a lens skips, and items to
// rate the rater skips. unreviewed: items missing a lens answer; toRate: rows with toRate set.
export function skippedItems(record, who, { unreviewed = [], toRate = [] }) {
  const lens = new Set(LENSES.flatMap((l) => [...skippedIds(record, l, who)]));
  const rate = skippedIds(record, "rate", who);
  return new Set([...unreviewed.filter((i) => lens.has(i.id)), ...toRate.filter((r) => rate.has(r.id))].map((x) => x.id));
}

// tried: the ids this run sent; failures: runBatches's [{id, error, call}]. Returns the new record.
export function recordRun(record, lens, { tried, failures, version, model, now = new Date().toISOString() }) {
  const entries = { ...(record?.[lens] || {}) };
  const failed = new Map(failures.map((f) => [f.id, f]));
  const answered = tried.filter((id) => !failed.has(id));
  for (const id of answered) delete entries[id];
  for (const f of failures) {
    if (f.call) continue;
    const before = current(entries[f.id], { version, model }) ? entries[f.id] : null;
    // A run that answered nothing starts no count, but an item that already failed beside answered
    // items keeps counting: once the rest is answered it is often the only one left (R-20).
    if (!answered.length && !before) continue;
    entries[f.id] = { runs: (before ? before.runs : 0) + 1, version, model, last: now };
  }
  return { ...record, [lens]: entries };
}
