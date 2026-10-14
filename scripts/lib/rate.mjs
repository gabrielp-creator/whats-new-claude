// The 0 to 10 rating. Code sets the bounds from the urgency tier
// and the file evidence; a tool-less "orchestrator" call (lenses/rate.md) places the item inside them.
// Fetched text can move an item within its band, never out of it. Tested in tests/rate.test.mjs.

import { injectionFlag } from "./batch.mjs";
import { parseModel, modelRefs, launchStatus, isLaunchText } from "./models.mjs";
import { modelScope, inScope } from "./scope.mjs";

export const BANDS = { urgent: [7, 10], soon: [5, 8.4], later: [2, 5.9], none: [0, 1.9] };
export const FYI_CAP = 6.9;       // third-party plugins and external forks are FYI only
export const NOT_FOUND_CAP = 7.9; // keeps an item that names files we could not find out of the 8+ list
export const ADOPTED_CAP = 5;     // a launch the project already uses: still listed, never a top pick (Gabriel, 2026-10-09)
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
// would be written somewhere if the project used it. A project whose code calls the claude CLI writes
// its flags down, so there a flag is a file term (B-61).
export const termKind = (t, { callsClaude = false } = {}) => (t.startsWith("/") || (t.startsWith("-") && !callsClaude) ? "typed" : "file");

// A model launch, rather than a retirement or a breaking change: finding the new id means the project
// has already moved, so the file check reads the other way round (B-29). The type lens's "model" label
// covers prices, limits and availability too, so a launch also needs a launch template in the text
// (B-57, P-10: "available for X" is not one).
export const isLaunch = (row) => row.type === "model" && row.risk !== "deprecation" && row.risk !== "breaking"
  && isLaunchText(`${row.title || ""} ${row.text || ""}`);

// B-57: a "model" item that changes a price or a limit, not a launch: "price", "limit" or null. Skill and
// cookbook commits quote price tables in passing; B-40 decides them.
const PRICE = /\bpric(?:e|es|ed|ing)\b|\$\d|\bper million tokens\b|\bMTok\b/i;
const LIMIT = /\brate limits?\b|\bcontext window\b|\bmax(?:imum)? output\b|\boutput (?:token )?limits?\b|\btoken limits?\b/i;
const CACHE = /\bprompt cach|\bcache (?:reads?|writes?|hits?)\b/i;
export const priceChange = (row) => (row.type !== "model" || row.source === "skills" || row.source === "cookbooks"
  || isLaunch(row) || row.risk === "deprecation" || row.risk === "breaking" ? null
  : PRICE.test(row.text || "") ? "price" : LIMIT.test(row.text || "") ? "limit" : null);
// The extra name verify.mjs looks up for a price change: a caching price matters only to code that
// marks cache breakpoints.
export const priceTerms = (row) => (priceChange(row) === "price" && CACHE.test(row.text || "") ? ["cache_control"] : []);

// The panel's tripwire set (P-4, P-5): never dropped, never below soon.
const SERIOUS = /security|break|deprecat|retir/;
export const isTripwire = (row) => !row.fyiOnly && (["security", "breaking", "deprecation"].includes(row.risk)
  || ["security", "breaking-or-deprecation"].includes(row.type) || (row.tripwires || []).some((t) => SERIOUS.test(t)));

// B-40: a change to a Claude Code skill, a default or a model alias shapes code Claude writes from now
// on; it changes no call a project already makes. Skill commits, and Claude Code items naming the
// claude-api skill, a default model or an alias.
const DEFAULT_CHANGE = /\bclaude-api\b|\bdefault (?:\w+ )?model\b|\bnow the default\b|\bmodel alias(?:es)?\b/i;
export const isSkillOrDefault = (row) => row.source === "skills" || (row.source === "claude-code" && DEFAULT_CHANGE.test(`${row.title || ""} ${row.text || ""}`));
const list = (ids) => ids.slice(0, 3).join(", ") + (ids.length > 3 ? ` +${ids.length - 3}` : "");

// One scope clause as the note names it: an id for a single version, the item's words for a range.
const clauseName = (c) => (c.family && c.min && c.max && c.min.join() === c.max.join()
  ? `claude-${c.family}-${c.min[0]}${c.min[1] ? `-${c.min[1]}` : ""}` : c.text.trim());

// B-50: what a closed parse of the item's model scope (lib/scope.mjs, B-34) says about one project,
// when it leaves out every model the project pins. {state: "out", names}: no alias can reach it either.
// {state: "alias", alias}: the item names a family the project runs only by alias, which may run one
// of its models (P-14; a pinned id of the family decides before an alias, as in B-39). Null when
// anything is open: a launch (decided apart), a partial walk, open wording, a pinned model in scope,
// or nothing pinned and no alias of a named family. found: the names the file check found; a model id
// among them is use, whatever the inventory says.
export function scopeVerdict(row, inv, found = []) {
  if (isLaunch(row) || !inv || inv.partial) return null;
  const uses = [...new Set([...(inv.models || []), ...found.map((f) => f.term).filter((t) => parseModel(t))])];
  const scope = modelScope(row.text, { title: row.title });
  const closed = scope.clauses.filter((c) => !c.loose);
  if (!closed.length || scope.open === "all" || !uses.every((id) => inScope(scope, id) === "out")) return null;
  const pinned = new Set(uses.map(parseModel).filter(Boolean).map((m) => m.family));
  const named = (f) => closed.some((c) => c.family === null || c.family === f);
  const free = (inv.aliases || []).filter((a) => a.family && !pinned.has(a.family));
  // "and newer" leaves families it does not name open: an alias of one of them is not ruled out.
  if (scope.open === "others" && free.some((a) => !named(a.family))) return null;
  const reach = free.filter((a) => named(a.family));
  if (reach.length) return { state: "alias", alias: reach.find((a) => !/\.md$/i.test(a.file)) || reach[0] };
  return uses.length ? { state: "out", names: [...new Set(closed.map(clauseName))] } : null;
}

// evs: verify.mjs evidence rows for this item ({project, checked, found, mentioned}). checked is []
// when the project was only partly searched and nothing matched, so a partial search can never cap.
// mentioned: names seen only in docs, data or comments (B-47): context, never a confirmation.
// models: verify.mjs models.json ({[project]: {models: [ids], aliases: [{alias, family, file, line}],
// partial}}), or undefined before a run.
// note: one line of code-made text (model ids, aliases, file names) saying why the band is what it is.
export function bounds(row, project, evs, models) {
  let [lo, hi] = BANDS[row.urgencyLabel] || BANDS.none;
  const e = project ? evs.find((x) => x.project === project) : null;
  const inv = project ? models?.[project] : null;
  const uses = inv?.models || [];
  const refs = inv ? modelRefs(`${row.title || ""} ${row.text || ""}`) : [];
  const mentionedIn = e?.mentioned || [];
  let evidence = "unchecked", foundIn = [], note = "", verdict = null, kind = null, priceOnly = false;
  if (e?.found?.length) { evidence = "confirmed"; foundIn = e.found; }
  else if (mentionedIn.length) { evidence = "mentioned"; note = `named only in docs, data or comments: ${mentionedIn.slice(0, 2).map((f) => `${f.term} in ${f.file}`).join("; ")}`; }
  else if (e?.checked?.some((t) => termKind(t, { callsClaude: Boolean(inv?.claudeCalls?.length) }) === "file")) { evidence = "not-found"; hi = Math.min(hi, NOT_FOUND_CAP); }
  else if (inv?.partial) { evidence = "incomplete"; note = "file check incomplete: the project is larger than the search limit"; }

  // Aliases are never resolved (B-39, P-14): an alias in a family the item names, with no pinned id
  // of that family, may run any of its models, so the project is asked to confirm, at soon.
  const families = new Set(refs.map((r) => r.family));
  const pinned = new Set(uses.map(parseModel).filter(Boolean).map((m) => m.family));
  const aliases = (inv?.aliases || []).filter((a) => a.family);
  const inFamily = aliases.filter((a) => families.has(a.family) && !pinned.has(a.family));
  const exposed = inFamily.find((a) => !/\.md$/i.test(a.file)) || inFamily[0]; // cite code before front matter
  const asAlias = (a = exposed) => {
    [lo, hi] = BANDS.soon; evidence = "alias";
    note = `your \`${a.alias}\` alias may have moved: confirm which model it runs (${a.file}:${a.line})`;
  };
  const known = [...uses, ...new Set(aliases.map((a) => `the \`${a.alias}\` alias`))];

  if (isLaunch(row) && refs.length && inv) {
    const l = launchStatus(refs, uses);
    [lo, hi] = BANDS[row.urgencyLabel] || BANDS.none; // decided here, not by the generic check above
    if (l.status === "adopted") {
      evidence = "adopted"; hi = Math.min(hi, ADOPTED_CAP);
      note = `already uses ${list(l.uses)}${l.older.length ? ` (also ${list(l.older)})` : ""}: confirm settings and pricing`;
    } else if (l.status === "upgrade") {
      evidence = "upgrade"; note = `upgrade from ${list(l.uses)}`;
    } else if (exposed) {
      asAlias();
    } else if (inv.partial) {
      evidence = "incomplete"; note = "file check incomplete: the project is larger than the search limit";
    } else if (known.length) {
      evidence = "other-models"; hi = Math.min(hi, NOT_FOUND_CAP); note = `this project uses ${list(known)}`;
    } else {
      // No pinned id and no alias: which model it runs is unknown, never "other models" (B-39).
      evidence = "unknown"; note = "no model id or alias found in this project's code or config";
    }
  } else if ((kind = priceChange(row)) && inv) {
    // B-57: a price or limit change. On a model the project pins, inside the item's scope: soon, with
    // its file and line; a caching price also needs `cache_control` in a fully searched project.
    // Otherwise later, one line. Never a model-refresh.
    priceOnly = true;
    const lower = (band) => { if (BANDS[band][1] < hi) [lo, hi] = BANDS[band]; }; // never raises the lenses' band
    const scope = modelScope(row.text, { title: row.title });
    const inUse = (inv.used || uses.map((id) => ({ id }))).filter((u) => inScope(scope, u.id) === "in");
    const at = (u) => (u.file ? `${u.file}:${u.line}` : "");
    const named = inUse.map((u) => `${u.id}${u.file ? ` (${at(u)})` : ""}`);
    const what = kind === "price" ? "check your price table" : "check your limits";
    const noCache = e?.checked?.includes("cache_control") && !foundIn.some((f) => f.term === "cache_control");
    if (inUse.length && noCache) {
      lower("later"); evidence = "not-found";
      note = `uses ${list(named)} but sends no \`cache_control\`: the cache price does not apply yet`;
    } else if (inUse.length) {
      lower("soon"); evidence = "confirmed";
      foundIn = [...inUse.map((u) => ({ term: u.id, file: at(u) })), ...foundIn];
      note = `${what}: this project uses ${list(named)}`;
    } else if (inv.partial) {
      lower("soon"); evidence = "incomplete"; note = "file check incomplete: the project is larger than the search limit";
    } else {
      lower("later"); evidence = uses.length ? "other-models" : "unknown";
      const fams = new Set(scope.clauses.filter((c) => !c.loose).map((c) => c.family));
      const reach = aliases.filter((x) => !pinned.has(x.family) && fams.has(x.family));
      const a = reach.find((x) => !/\.md$/i.test(x.file)) || reach[0]; // cite code before front matter
      note = a ? `your \`${a.alias}\` alias may run it (${a.file}:${a.line}): ${what}`
        : uses.length ? `this project uses ${list(known)}` : "no model id or alias found in this project's code or config";
    }
  } else if ((row.risk === "deprecation" || row.risk === "breaking") && exposed && evidence !== "confirmed") {
    // A retirement or breaking change in an alias's family: the alias may run the affected model.
    asAlias();
  } else if ((verdict = scopeVerdict(row, inv, foundIn)) && (verdict.state === "out" ? evidence !== "not-found" : evidence === "confirmed" || evidence === "mentioned" || row.type === "model")) {
    // The scope decides before keyword evidence: a name found here is context, not use (B-50, SU 1).
    // A change scoped to models the project does not use matters when it moves to one of them (B-33);
    // "not-found" already says the project does not use it, under the same cap. When only an alias can
    // reach the named models, the project is asked which model it runs, at soon (P-14): for a keyword
    // hit, and for any item about a model (as launches are).
    const hits = foundIn.map((f) => `\`${f.term}\` in ${f.file}`);
    const context = hits.length ? `; ${list(hits)} is not about these models` : "";
    foundIn = [];
    if (verdict.state === "alias") { asAlias(verdict.alias); note += context; }
    else {
      evidence = "other-models"; hi = Math.min(hi, NOT_FOUND_CAP);
      note = `applies when you move to ${list(verdict.names)}; this project uses ${list(uses)}${context}`;
    }
  }
  // B-40 (AK 4): only setup and alias users run what a skill or default change touches; any other
  // project gets "read" at most, in the later band. A skill's default never moves an alias, so skill
  // commits cap alias users too (Gabriel, 2026-10-13). Tripwire items keep their band (P-4).
  let readOnly = false;
  if (project && project !== "setup" && (row.source === "skills" || !aliases.length) && isSkillOrDefault(row) && !isTripwire(row)) {
    readOnly = true; hi = Math.min(hi, BANDS.later[1]);
    const line = "a skill or default change: it shapes code Claude writes from now on, not your existing calls";
    note = note ? `${note}; ${line}` : line;
  }
  if (row.fyiOnly) hi = Math.min(hi, FYI_CAP);
  // A tripwire item the project's scripted calls may not reach stays in band with code's line (P-4).
  if (e?.held) note = note ? `${note}; ${e.held}` : e.held;
  return { lo: Math.min(lo, hi), hi, evidence, foundIn, mentionedIn, note, readOnly, priceOnly };
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
export function rateRow(row, evs, orch, models) {
  const injection = Boolean(orch?.injection) || row.flags.some((f) => /instructions aimed at an AI/.test(f));
  const answers = new Map((orch?.ratings || []).map((a) => [a.project, a]));
  const projects = row.projects.length ? row.projects : [null];
  const ratings = projects.map((project) => {
    const b = bounds(row, project, evs, models);
    const a = project ? answers.get(project) : null;
    const score = a ? clampScore(a.score, b) : null;
    let act = a && ACTIONS.has(a.do) ? a.do : "read";
    if (row.fyiOnly && act === "try-feature") act = "read";
    if (b.readOnly && act !== "ignore") act = "read";
    if (b.priceOnly && act === "model-refresh") act = "read"; // a price or limit change needs no model change (B-57)
    return {
      project, lo: b.lo, hi: b.hi, evidence: b.evidence, foundIn: b.foundIn, note: b.note,
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
export function ratePayload(row, evs, models) {
  return {
    id: row.id, source: row.source, provenance: row.provenance, title: row.title, text: row.text,
    lenses: { effect: row.effect, strength: row.strength, why: row.why, type: row.type, action: row.action,
      risk: row.risk, exposed: row.riskExposed, riskWhy: row.riskWhy },
    projects: row.projects.map((id) => {
      const b = bounds(row, id, evs, models);
      return { id, range: [b.lo, b.hi], evidence: b.evidence, note: b.note, found: b.foundIn.map((f) => `${f.term} in ${f.file}`),
        mentioned: b.mentionedIn.map((f) => `${f.term} in ${f.file}`) };
    }),
  };
}

// What the orchestrator saw per project: [lo, hi, evidence]. rate-run.mjs stores it with each answer.
export const seenFor = (row, evs, models) =>
  Object.fromEntries(row.projects.map((p) => { const b = bounds(row, p, evs, models); return [p, [b.lo, b.hi, b.evidence]]; }));

// An answer is stale when a project's range or evidence differs from what it was rated under, or a
// project has no answer. Answers from before 0.3.0 have no "seen": they were rated without the model
// check, so that is what they are compared with.
export function staleRating(row, stored, evs, models) {
  const answered = new Set((stored?.ratings || []).map((a) => a.project));
  const now = seenFor(row, evs, models), then = stored?.seen || seenFor(row, evs, undefined);
  return row.projects.some((p) => !answered.has(p) || !then[p] || then[p].join("|") !== now[p].join("|"));
}
