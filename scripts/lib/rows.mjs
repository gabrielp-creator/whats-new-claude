// Joins stored items with commit details, the three lens answers, the file evidence and the rating
// (lib/rate.mjs: code bounds plus the orchestrator's answer from rate.jsonl) into review rows. Shared by lens-run, plan, verify, build-page and write-briefs so they all see the same data.
import { join } from "node:path";
import { readJsonl, readJson } from "./store.mjs";
import { merge } from "./merge.mjs";
import { applyEvidence } from "./probe.mjs";
import { rateRow, staleRating, needsOrchestrator } from "./rate.mjs";

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

export function loadRows(dir, { evidence = true } = {}) {
  const items = lensItems(dir);
  const lenses = Object.fromEntries(["impact", "type", "risk"].map((l) => [l, byId(readJsonl(join(dir, `lens-${l}.jsonl`)))]));
  const ev = new Map();
  if (evidence) for (const e of readJsonl(join(dir, "evidence.jsonl"))) { if (!ev.has(e.id)) ev.set(e.id, []); ev.get(e.id).push(e); }
  const rated = byId(readJsonl(join(dir, "rate.jsonl")));
  const models = evidence ? readJson(join(dir, "models.json"), undefined) : undefined; // verify.mjs: model ids per project
  const covered = items.filter((i) => Object.values(lenses).every((l) => l.has(i.id)));
  const rows = covered.map((i) => {
    const row = {
      id: i.id, source: i.source, provenance: i.provenance, date: i.date, title: i.title, text: i.text, url: i.url,
      ...merge(i, lenses.impact.get(i.id), lenses.type.get(i.id), lenses.risk.get(i.id)),
    };
    const evs = ev.get(i.id) || [];
    // Ties code added or dropped after the lenses (verify.mjs, M3): stored, so every reader sees the
    // same rows. A dropped tie leaves projects (the rater never sees it) and is listed in dropped.
    const drops = evs.filter((e) => e.dropped);
    const gone = new Set(drops.map((e) => e.project));
    const tied = evs.filter((e) => e.tiedBy && e.tiedBy !== "lens" && !e.dropped && !row.projects.includes(e.project)).map((e) => e.project);
    if (tied.length || gone.size) row.projects = [...row.projects.filter((p) => !gone.has(p)), ...tied];
    row.dropped = drops.map((e) => ({ project: e.project, reason: e.dropped, why: e.why }));
    const withEvidence = { ...applyEvidence(row, evs, models), foundIn: evs.flatMap((e) => e.found.map((f) => ({ project: e.project, term: f.term, file: f.file }))) };
    const stored = rated.get(i.id) || null;
    // toRate: rate-run.mjs should (re)rate it: never rated, or rated under a range that has since changed.
    const toRate = needsOrchestrator(withEvidence) && withEvidence.projects.length > 0 && (!stored || staleRating(withEvidence, stored, evs, models));
    return { ...withEvidence, ...rateRow(withEvidence, evs, stored, models), toRate };
  });
  return { items, rows, missing: items.length - covered.length };
}
