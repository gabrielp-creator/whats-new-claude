// B-4: the free retirement check. The model status table on the deprecations page is parsed by code
// into a closed shape (ids by pattern, states from a closed set, dates parsed) and matched against the
// models each project pins, never its aliases (P-14). No Claude call. A page that does not parse whole
// is an error, never a quiet empty table (P-18), and the error carries code's words only. Fetched by
// fetch.mjs into <data>/deprecations.json; matched by verify.mjs. Tested in tests/deprecations.test.mjs.
import { join } from "node:path";
import { parseModel } from "./models.mjs";
import { readJson, writeJson } from "./store.mjs";
import { errLine } from "./net.mjs";

// The page's markdown form: one table, no scripts or layout to parse around.
export const DEPRECATIONS_SOURCE = "https://platform.claude.com/docs/en/about-claude/model-deprecations.md";
export const DEPRECATIONS_PAGE = "https://platform.claude.com/docs/en/about-claude/model-deprecations";

const STATES = new Set(["Active", "Legacy", "Deprecated", "Retired"]);
const HEADER = ["API model name", "Current state", "Deprecated", "Tentative retirement date"];
const ID = /^claude-[a-z0-9][a-z0-9.-]*$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DATE = new RegExp(`^(${MONTHS.join("|")}) (\\d{1,2}), (\\d{4})$`);

const fail = (why) => { throw new Error(`deprecations page: ${why}`); };
const pad = (n) => String(n).padStart(2, "0");
function day(s) {
  const m = String(s).match(DATE);
  return m ? `${m[3]}-${pad(MONTHS.indexOf(m[1]) + 1)}-${pad(m[2])}` : null;
}
const cells = (line) => line.split("|").slice(1, -1).map((c) => c.trim());

// [{id, state, deprecated, retires, notBefore, replacement}], dates as YYYY-MM-DD or null. Throws on
// anything short of a whole table.
export function parseDeprecations(md) {
  const text = String(md || "").replace(/\r\n/g, "\n");
  const start = text.search(/^## Model status[ \t]*$/m);
  if (start < 0) fail("no model status section");
  const section = text.slice(start).split(/\n## /)[0];
  const lines = section.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  if (!lines.length || cells(lines[0]).join("|") !== HEADER.join("|")) fail("model status table header changed");
  if (!/^\|[\s:|-]+\|$/.test(lines[1] || "")) fail("model status table has no separator row");
  const models = [];
  lines.slice(2).forEach((line, i) => {
    const n = i + 1, c = cells(line);
    if (c.length !== 4) fail(`row ${n} has ${c.length} cells`);
    const [id, state, dep, ret] = c;
    if (!ID.test(id)) fail(`row ${n} model id does not parse`);
    if (!STATES.has(state)) fail(`row ${n} state is not one of active, legacy, deprecated, retired`);
    const deprecated = dep === "N/A" ? null : day(dep);
    if (dep !== "N/A" && !deprecated) fail(`row ${n} deprecation date does not parse`);
    let retires = null, notBefore = null;
    if (ret.startsWith("Not sooner than ")) { notBefore = day(ret.slice(16)); if (!notBefore) fail(`row ${n} retirement date does not parse`); }
    else if (ret !== "To be announced") { retires = day(ret); if (!retires) fail(`row ${n} retirement date does not parse`); }
    if ((state === "Deprecated" || state === "Retired") && !deprecated) fail(`row ${n} is ${state.toLowerCase()} with no deprecation date`);
    if (state === "Retired" && !retires) fail(`row ${n} is retired with no retirement date`);
    models.push({ id, state, deprecated, retires, notBefore, replacement: null });
  });
  if (!models.length) fail("model status table is empty");
  // A table cut short still parses row by row; the page has always listed an active model of each.
  for (const f of ["opus", "sonnet", "haiku"]) if (!models.some((m) => m.state === "Active" && parseModel(m.id)?.family === f)) fail(`no active ${f} model listed`);
  // Recommended replacements, from the history tables: | date | `old id` | `replacement` |
  for (const m of text.matchAll(/^\|[^|\n]*\|\s*`(claude-[a-z0-9.-]+)`\s*\|\s*`(claude-[a-z0-9.-]+)`\s*\|\s*$/gm)) {
    const row = models.find((x) => x.id === m[1]);
    if (row) row.replacement = m[2];
  }
  return models;
}

// The models a project pins (models.json "used": [{id, file, line}]) that the page lists as
// deprecated or retired, matched by family and version both ways: the page lists dated snapshots,
// and a project may pin either form. A deprecated model past its retirement date counts as retired.
export function retirementsFor(used, table, today) {
  const out = [];
  for (const u of used || []) {
    const m = parseModel(u.id);
    const row = m && table.find((r) => (r.state === "Deprecated" || r.state === "Retired") && parseModel(r.id)?.id === m.id);
    if (!row) continue;
    const gone = row.state === "Retired" || Boolean(row.retires && row.retires <= today);
    out.push({ id: u.id, file: u.file, line: u.line, pageId: row.id, state: gone ? "retired" : "deprecated",
      deprecated: row.deprecated, retires: row.retires, replacement: row.replacement });
  }
  return out;
}

// fetch.mjs's step: <data>/deprecations.json = {fetched, models}. A failed fetch or parse is loud, and
// the last good snapshot stays, with the date it was fetched on (never replaced by an empty table).
// get: lib/net.mjs's get (injected for tests). Returns {ok, line, error}.
export async function refreshDeprecations(dir, get, now = Date.now()) {
  const path = join(dir, "deprecations.json");
  try {
    const models = parseDeprecations(await get(DEPRECATIONS_SOURCE));
    writeJson(path, { fetched: new Date(now).toISOString().slice(0, 10), models });
    const retiring = models.filter((m) => m.state === "Deprecated").length;
    return { ok: true, line: `deprecations: ${models.length} models listed, ${retiring} deprecated` };
  } catch (e) {
    const kept = readJson(path, null)?.fetched;
    return { ok: false, error: errLine(e), line: `deprecations: FAILED: ${errLine(e)}; ${kept ? `the retirement check uses the copy from ${kept}` : "no retirement check until it succeeds"}` };
  }
}

// The ruled shape (Gabriel, 2026-10-14): one code-made row per pinned model the page lists as
// deprecated or retired, with the projects that pin it (models.json "retiring", from verify.mjs). No
// lens or rater call: day-one value at no cost. Deprecated with a date: urgent, with the date and the
// replacement; with no date yet: soon; already retired: soon, asking to confirm nothing still sends
// it (a project may keep the id on purpose, in a migration map). The text is made from the parsed,
// validated fields only. Dated today, so it stays in every "last N days" list while the model is used.
export function retirementRows(models, today) {
  const by = new Map();
  for (const [project, inv] of Object.entries(models || {})) {
    for (const r of inv?.retiring || []) {
      if (!by.has(r.pageId)) by.set(r.pageId, { r, projects: [] });
      const e = by.get(r.pageId);
      if (!e.projects.includes(project)) e.projects.push(project);
    }
  }
  return [...by.values()].map(({ r, projects }) => {
    const retired = r.state === "retired", urgent = !retired && Boolean(r.retires);
    const text = retired ? `${r.pageId} was retired on ${r.retires}: requests to it fail.`
      : `${r.pageId} is deprecated and ${r.retires ? `retires on ${r.retires}` : "its retirement date is not announced yet"}.${r.replacement ? ` The recommended replacement is ${r.replacement}.` : ""}`;
    return {
      id: `deprecations:${r.pageId}`, source: "deprecations", provenance: "anthropic-docs", date: today, title: "Model deprecations", text, url: DEPRECATIONS_PAGE,
      section: "must-read", urgency: urgent ? 95 : 60, urgencyLabel: urgent ? "urgent" : "soon", action: retired ? "read" : "model-refresh",
      fyiOnly: false, flags: [], tripwires: [retired ? "retired" : "deprecation"], effect: retired ? "none" : "fixes", projects, newWork: false,
      strength: urgent ? "high" : "medium", why: retired ? "Your code still names a model that has been retired." : "Your code pins a model that is deprecated.",
      type: "breaking-or-deprecation", risk: "deprecation", riskExposed: true, riskWhy: "", dropped: [],
      codeMade: "retirement", retirement: { pageId: r.pageId, state: r.state, retires: r.retires, replacement: r.replacement },
    };
  });
}
