// The 0 to 10 rating. Code sets the bounds from the urgency tier
// and the file evidence; a tool-less "orchestrator" call (lenses/rate.md) places the item inside them.
// Fetched text can move an item within its band, never out of it. Tested in tests/rate.test.mjs.

import { injectionFlag } from "./batch.mjs";

export const BANDS = { urgent: [7, 10], soon: [5, 8.4], later: [2, 5.9], none: [0, 1.9] };
export const FYI_CAP = 6.9;       // third-party plugins and external forks are FYI only
export const NOT_FOUND_CAP = 7.9; // keeps an item that names files we could not find out of the 8+ list
export const ACTIONS = new Set(["model-refresh", "claude-md-rule", "try-feature", "update-harness", "update-code", "read", "ignore"]);
const STRENGTH_AT = { high: 0.75, medium: 0.5, low: 0.25 };
const WHY_MAX = 160;
export const RATE_BATCH = 30; // items per orchestrator call
// Share of new items that reach urgent or soon, for cost estimates before the lenses have run
// (estimate: about 15% of items reached urgent or soon over two months of releases, rounded up).
export const RATED_SHARE = 0.2;

const round1 = (n) => Math.round(n * 10) / 10;

// Flags and slash commands are typed, so they never appear in a project's files; their absence there
// says nothing. Every other extracted name (model ids, packages, env vars, settings keys, hook names)
// would be written somewhere if the project used it.
export const termKind = (t) => (/^[-/]/.test(t) ? "typed" : "file");

// evs: verify.mjs evidence rows for this item ({project, checked, found}). checked is [] when the
// project was only partly searched and nothing matched, so a partial search can never cap.
export function bounds(row, project, evs) {
  let [lo, hi] = BANDS[row.urgencyLabel] || BANDS.none;
  const e = project ? evs.find((x) => x.project === project) : null;
  let evidence = "unchecked", foundIn = [];
  if (e?.found?.length) { evidence = "confirmed"; foundIn = e.found; }
  else if (e?.checked?.some((t) => termKind(t) === "file")) { evidence = "not-found"; hi = Math.min(hi, NOT_FOUND_CAP); }
  if (row.fyiOnly) hi = Math.min(hi, FYI_CAP);
  return { lo: Math.min(lo, hi), hi, evidence, foundIn };
}

export const codeScore = (row, b) => round1(b.lo + (b.hi - b.lo) * (STRENGTH_AT[row.strength] ?? 0.25));

export function clampScore(score, b) {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return round1(Math.min(b.hi, Math.max(b.lo, score)));
}

export const needsOrchestrator = (row) => row.urgencyLabel === "urgent" || row.urgencyLabel === "soon";

const oneLine = (s) => String(s || "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, WHY_MAX);

// orch: the orchestrator's answer for this item ({id, ratings: [{project, score, do, why}], injection})
// or null. Projects it names that the lenses did not tie to the item are ignored.
export function rateRow(row, evs, orch) {
  const injection = Boolean(orch?.injection) || row.flags.some((f) => /instructions aimed at an AI/.test(f));
  const answers = new Map((orch?.ratings || []).map((a) => [a.project, a]));
  const projects = row.projects.length ? row.projects : [null];
  const ratings = projects.map((project) => {
    const b = bounds(row, project, evs);
    const a = project ? answers.get(project) : null;
    const score = a ? clampScore(a.score, b) : null;
    let act = a && ACTIONS.has(a.do) ? a.do : "read";
    if (row.fyiOnly && act === "try-feature") act = "read";
    return {
      project, lo: b.lo, hi: b.hi, evidence: b.evidence, foundIn: b.foundIn,
      score: score ?? codeScore(row, b),
      provisional: score === null && project !== null && needsOrchestrator(row),
      do: a ? act : null,
      why: a && !injection ? oneLine(a.why) : "",
    };
  });
  const best = ratings.reduce((m, r) => (r.score > m.score ? r : m), ratings[0]);
  return { ratings, rating: best.score, ratingProject: best.project, injection };
}

// Validates one orchestrator answer. Throws (so lens-style retry splits the batch) when a project the
// item belongs to is missing or a score is not a number from 0 to 10. Projects the item does not
// belong to are dropped, not trusted.
export function checkRateAnswer(r, row) {
  if (!r || typeof r !== "object") throw new Error(`missing answer for ${row.id}`);
  const given = new Map((Array.isArray(r.ratings) ? r.ratings : []).map((a) => [a?.project, a]));
  const ratings = row.projects.map((project) => {
    const a = given.get(project);
    if (!a) throw new Error(`${row.id}: no rating for project ${project}`);
    if (typeof a.score !== "number" || !(a.score >= 0 && a.score <= 10)) throw new Error(`${row.id}: bad score ${JSON.stringify(a.score)}`);
    return { project, score: a.score, do: String(a.do ?? ""), why: oneLine(a.why) };
  });
  return { id: row.id, ratings, injection: injectionFlag(r.injection) };
}

// What the orchestrator sees for one item: its text (untrusted), the lens answers, and per project
// the allowed range and the names found or not found. Never file contents.
export function ratePayload(row, evs) {
  return {
    id: row.id, source: row.source, provenance: row.provenance, title: row.title, text: row.text,
    lenses: { effect: row.effect, strength: row.strength, why: row.why, type: row.type, action: row.action,
      risk: row.risk, exposed: row.riskExposed, riskWhy: row.riskWhy },
    projects: row.projects.map((id) => {
      const b = bounds(row, id, evs);
      return { id, range: [b.lo, b.hi], evidence: b.evidence, found: b.foundIn.map((f) => `${f.term} in ${f.file}`) };
    }),
  };
}
