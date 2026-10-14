// Joins stored items with commit details, the three lens answers, the file evidence and the rating
// (lib/rate.mjs: code bounds plus the orchestrator's answer from rate.jsonl) into review rows. Shared by lens-run, plan, verify, build-page and write-briefs so they all see the same data.
import { join } from "node:path";
import { readJsonl, readJson } from "./store.mjs";
import { merge } from "./merge.mjs";
import { applyEvidence } from "./probe.mjs";
import { rateRow, staleRating, needsOrchestrator, launchedWith, eventKeys } from "./rate.mjs";
import { retirementRows } from "./deprecations.mjs";

const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
const COMMIT_SOURCES = new Set(["skills", "cookbooks"]);

// Items as the lenses see them: commit items get their text from enrich-commits.mjs.
export function lensItems(dir) {
  const details = byId(readJsonl(join(dir, "commit-details.jsonl")));
  return readJsonl(join(dir, "items.jsonl")).map((i) => {
    if (!COMMIT_SOURCES.has(i.source)) return i;
    const d = details.get(i.id);
    if (!d) throw new Error(`${i.id} has no commit details; run enrich-commits.mjs first`);
    return { ...i, text: d.text };
  });
}

export function loadRows(dir, { evidence = true, now = Date.now() } = {}) {
  const items = lensItems(dir);
  const lenses = Object.fromEntries(["impact", "type", "risk"].map((l) => [l, byId(readJsonl(join(dir, `lens-${l}.jsonl`)))]));
  const ev = new Map();
  if (evidence) for (const e of readJsonl(join(dir, "evidence.jsonl"))) { if (!ev.has(e.id)) ev.set(e.id, []); ev.get(e.id).push(e); }
  const rated = byId(readJsonl(join(dir, "rate.jsonl")));
  const models = evidence ? readJson(join(dir, "models.json"), undefined) : undefined; // verify.mjs: model ids per project
  const covered = items.filter((i) => Object.values(lenses).every((l) => l.has(i.id)));
  const merged = covered.map((i) => ({
    id: i.id, source: i.source, provenance: i.provenance, date: i.date, title: i.title, text: i.text, url: i.url,
    ...merge(i, lenses.impact.get(i.id), lenses.type.get(i.id), lenses.risk.get(i.id)),
  }));
  // B-45: the models first-party launches put out within 7 days of each item.
  const near = launchedWith(merged);
  // B-38: one event, one entry: launches of a model from several sources, and their breaking notes.
  const events = eventKeys(merged);
  const rows = merged.map((row) => {
    if (near.has(row.id)) row.withLaunch = near.get(row.id);
    if (events.has(row.id)) row.event = events.get(row.id);
    const evs = ev.get(row.id) || [];
    // Ties code added or dropped after the lenses (verify.mjs, M3): stored, so every reader sees the
    // same rows. A dropped tie leaves projects (the rater never sees it) and is listed in dropped.
    const drops = evs.filter((e) => e.dropped);
    const gone = new Set(drops.map((e) => e.project));
    const tied = evs.filter((e) => e.tiedBy && e.tiedBy !== "lens" && !e.dropped && !row.projects.includes(e.project)).map((e) => e.project);
    if (tied.length || gone.size) row.projects = [...row.projects.filter((p) => !gone.has(p)), ...tied];
    row.dropped = drops.map((e) => ({ project: e.project, reason: e.dropped, why: e.why }));
    const withEvidence = { ...applyEvidence(row, evs, models), foundIn: evs.flatMap((e) => e.found.map((f) => ({ project: e.project, term: f.term, file: f.file }))) };
    const stored = rated.get(row.id) || null;
    // toRate: rate-run.mjs should (re)rate it: never rated, or rated under a range that has since changed,
    // and some project still needs an answer (not one whose version already has it, B-52).
    const rating = rateRow(withEvidence, evs, stored, models);
    const open = rating.ratings.some((x) => x.project && !x.installed);
    const toRate = needsOrchestrator(withEvidence) && open && (!stored || staleRating(withEvidence, stored, evs, models));
    // redo: it has an answer, given under other bounds or an earlier version (B-65), not a new item.
    return { ...withEvidence, ...rating, toRate, redo: toRate && Boolean(stored) };
  });
  // B-4: code-made retirement rows (Gabriel, 2026-10-14), never sent to the rater.
  for (const row of retirementRows(models, new Date(now).toISOString().slice(0, 10))) {
    const foundIn = row.projects.flatMap((p) => models[p].retiring.filter((r) => r.pageId === row.retirement.pageId)
      .map((r) => ({ project: p, term: r.id, file: `${r.file}:${r.line}` })));
    const withEvidence = { ...row, evidence: "confirmed", confirmedIn: row.projects, foundIn };
    rows.push({ ...withEvidence, ...rateRow(withEvidence, [], null, models), toRate: false });
  }
  return { items, rows, missing: items.length - covered.length };
}
