// Pure helpers for incremental runs: how far back to fetch each source, how to merge new items into
// the store, and which sources have gone suspiciously quiet. Tested in tests/incremental.test.mjs.

const DAY = 864e5;
export const OVERLAP_DAYS = 2; // re-read a little of the last window; ids dedupe the overlap

// Sources that publish often enough that silence means something broke (days of allowed silence).
export const HEARTBEAT_DAYS = { "claude-code": 7, "platform-release-notes": 30, "agent-sdk-ts": 21 };

export function sinceFor(state, source, firstRunDays, now = Date.now()) {
  const last = state?.sources?.[source]?.lastSuccess;
  return new Date(last ? Date.parse(last) - OVERLAP_DAYS * DAY : now - firstRunDays * DAY);
}

// Existing items keep their place (their lens answers are keyed by id); new ids are appended.
export function mergeItems(existing, fresh) {
  const known = new Set(existing.map((i) => i.id));
  const added = [];
  for (const it of fresh) if (!known.has(it.id)) { known.add(it.id); added.push(it); }
  return { items: [...existing, ...added], added };
}

// Record a source's outcome. A failure never advances lastSuccess, so the next run re-reads it.
export function recordSource(state, source, { ok, newestDate, error }, now = Date.now()) {
  const prev = state.sources?.[source] || {};
  const next = ok
    ? { ...prev, lastSuccess: new Date(now).toISOString(), lastError: null, newestItem: maxDate(prev.newestItem, newestDate) }
    : { ...prev, lastError: String(error || "failed") };
  return { ...state, sources: { ...state.sources, [source]: next } };
}

const maxDate = (a, b) => (!a ? b || null : !b ? a : a > b ? a : b);

// Warnings for sources that failed this run or have published nothing for too long.
export function heartbeatWarnings(state, now = Date.now()) {
  const out = [];
  for (const [source, s] of Object.entries(state.sources || {})) {
    if (s.lastError) out.push(`${source} failed: ${s.lastError}`);
    const limit = HEARTBEAT_DAYS[source];
    if (limit && s.newestItem && now - Date.parse(s.newestItem) > limit * DAY)
      out.push(`${source} has published nothing since ${s.newestItem} (more than ${limit} days); check the source.`);
  }
  return out;
}

// The PR a commit was merged from: the last "(#N)" on its first line, because a squash merge appends
// the merged PR's number after the author's own title (which could name another PR).
export function prNumber(message) {
  const all = [...String(message || "").split("\n")[0].matchAll(/\(#(\d+)\)/g)];
  return all.length ? Number(all.at(-1)[1]) : null;
}
