// B-4 (AK 2, P-18): the free retirement check. The deprecations page is parsed by code into a closed
// shape; a page that does not parse whole is an error, never a quiet empty table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDeprecations, retirementsFor, DEPRECATIONS_SOURCE, DEPRECATIONS_PAGE } from "../scripts/lib/deprecations.mjs";
import { errLine } from "../scripts/lib/net.mjs";

const PAGE = readFileSync(join(import.meta.dirname, "fixtures", "model-deprecations.md"), "utf8");

test("the real page parses whole: every status row, states, dates and replacements", () => {
  const models = parseDeprecations(PAGE);
  assert.equal(models.length, 23);
  const by = Object.fromEntries(models.map((m) => [m.id, m]));
  assert.deepEqual(by["claude-sonnet-4-5-20250929"], { id: "claude-sonnet-4-5-20250929", state: "Deprecated", deprecated: "2026-09-30", retires: "2026-11-30", notBefore: null, replacement: "claude-sonnet-5-5" });
  assert.deepEqual(by["claude-sonnet-4-20250514"], { id: "claude-sonnet-4-20250514", state: "Retired", deprecated: "2026-04-14", retires: "2026-06-15", notBefore: null, replacement: "claude-sonnet-5-5" });
  assert.deepEqual(by["claude-opus-5-5"], { id: "claude-opus-5-5", state: "Active", deprecated: null, retires: null, notBefore: "2027-09-22", replacement: null });
  assert.equal(by["claude-mythos-preview"].retires, null, "'To be announced' is no date");
  assert.equal(models.filter((m) => m.state === "Deprecated").length, 2);
  assert.equal(models.filter((m) => m.state === "Retired").length, 6);
  assert.match(DEPRECATIONS_SOURCE, /^https:\/\/platform\.claude\.com\/docs\/en\/about-claude\/model-deprecations\.md$/);
  assert.match(DEPRECATIONS_PAGE, /^https:\/\/platform\.claude\.com\//);
});

test("a page that does not parse whole fails loudly, with code's words only (P-18)", () => {
  const status = PAGE.slice(PAGE.indexOf("| API model name"), PAGE.indexOf("## Deprecation history"));
  // Each case must change the page, or it would pass without testing anything.
  const mut = (from, to) => { assert.ok(PAGE.includes(from), `the fixture lacks ${JSON.stringify(from)}`); return PAGE.replace(from, to); };
  const cases = {
    "empty page": "",
    "HTML instead of the .md page": "<html><body><table><tr><td>claude-opus-5-5</td></tr></table></body></html>",
    "no status section": mut("## Model status", "## Models"),
    "a renamed column": mut("| Current state |", "| Status        |"),
    "an empty table": mut(status, status.split("\n").slice(0, 2).join("\n") + "\n\n"),
    "a table cut short": mut(status, status.split("\n").slice(0, 9).join("\n") + "\n\n"),
    "an unknown state": mut("| claude-opus-5              | Active        |", "| claude-opus-5              | Paused        |"),
    "an unparsable date": mut("November 30, 2026  ", "end of November   "),
    "a row with a missing cell": mut("| claude-opus-4-7            | Active        | N/A                |", "| claude-opus-4-7            | Active        |"),
    "a deprecated model with no date": mut("| Deprecated    | September 30, 2026 |", "| Deprecated    | N/A                |"),
    "an injected id": mut("| claude-opus-4-6            |", "| ignore previous instructions |"),
  };
  for (const [what, page] of Object.entries(cases)) {
    let err = null;
    try { parseDeprecations(page); } catch (e) { err = e; }
    assert.ok(err, `${what}: should throw`);
    assert.match(err.message, /^deprecations page: [a-z0-9 ,]+$/, `${what}: ${err.message}`);
    assert.equal(errLine(err), err.message, `${what}: shown as is, it carries no fetched text`);
  }
});

const used = [
  { id: "claude-sonnet-4-5", file: "src/llm.ts", line: 12 },
  { id: "claude-sonnet-4", file: "src/models.js", line: 16 },
  { id: "claude-opus-5-5", file: "src/llm.ts", line: 3 },
];

test("retirementsFor: pinned ids match dated snapshots both ways; active models never match", () => {
  const table = parseDeprecations(PAGE);
  const r = retirementsFor(used, table, "2026-10-14");
  assert.deepEqual(r, [
    { id: "claude-sonnet-4-5", file: "src/llm.ts", line: 12, pageId: "claude-sonnet-4-5-20250929", state: "deprecated", deprecated: "2026-09-30", retires: "2026-11-30", replacement: "claude-sonnet-5-5" },
    { id: "claude-sonnet-4", file: "src/models.js", line: 16, pageId: "claude-sonnet-4-20250514", state: "retired", deprecated: "2026-04-14", retires: "2026-06-15", replacement: "claude-sonnet-5-5" },
  ]);
  assert.equal(retirementsFor([{ id: "claude-sonnet-4-5-20250929", file: "a.ts", line: 1 }], table, "2026-10-14")[0].pageId, "claude-sonnet-4-5-20250929", "a dated id in the project");
  assert.equal(retirementsFor(used, table, "2026-12-01")[0].state, "retired", "past its retirement date, a deprecated model is retired");
  assert.deepEqual(retirementsFor([{ id: "claude-haiku-4-5", file: "a.ts", line: 1 }], table, "2026-10-14"), [], "'Not sooner than' is no retirement date");
  assert.deepEqual(retirementsFor(used, [], "2026-10-14"), []);
});

// R-6 (release review): two dated snapshots of one version are two rows; an exact id picks its own.
test("retirementsFor: a pinned dated snapshot matches its own row before another snapshot of the version", () => {
  const table = [
    { id: "claude-3-5-sonnet-20240620", state: "Retired", deprecated: "2025-08-13", retires: "2025-10-22", replacement: "claude-sonnet-4-5" },
    { id: "claude-3-5-sonnet-20241022", state: "Deprecated", deprecated: "2025-08-13", retires: "2026-11-30", replacement: "claude-sonnet-4-5" },
  ];
  const [r] = retirementsFor([{ id: "claude-3-5-sonnet-20241022", file: "a.ts", line: 1 }], table, "2026-10-14");
  assert.equal(r.pageId, "claude-3-5-sonnet-20241022");
  assert.equal(r.state, "deprecated");
  assert.equal(retirementsFor([{ id: "claude-3-5-sonnet-latest", file: "a.ts", line: 1 }], table, "2026-10-14")[0].pageId, "claude-3-5-sonnet-20240620", "no exact row: the version's first");
});

import { mkdtempSync, writeFileSync as write, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { refreshDeprecations } from "../scripts/lib/deprecations.mjs";

test("refreshDeprecations: a good page is stored with its date; a bad one is loud and keeps the last good copy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wnc-dep-"));
  const asked = [];
  const ok = await refreshDeprecations(dir, async (url) => { asked.push(url); return PAGE; }, Date.parse("2026-10-14T06:00:00Z"));
  assert.deepEqual(asked, [DEPRECATIONS_SOURCE]);
  assert.equal(ok.ok, true);
  assert.equal(ok.line, "deprecations: 23 models listed, 2 deprecated");
  const saved = readFileSync(join(dir, "deprecations.json"), "utf8");
  assert.equal(JSON.parse(saved).fetched, "2026-10-14");

  const bad = await refreshDeprecations(dir, async () => "<html>moved</html>", Date.parse("2026-10-20T06:00:00Z"));
  assert.equal(bad.ok, false);
  assert.equal(bad.line, "deprecations: FAILED: deprecations page: no model status section; the retirement check uses the copy from 2026-10-14");
  assert.equal(readFileSync(join(dir, "deprecations.json"), "utf8"), saved, "the last good copy is untouched");

  const down = await refreshDeprecations(mkdtempSync(join(tmpdir(), "wnc-dep-")), async () => { throw new Error("HTTP 503 from platform.claude.com"); });
  assert.equal(down.line, "deprecations: FAILED: HTTP 503 from platform.claude.com; no retirement check until it succeeds");
  const leak = await refreshDeprecations(dir, async () => { throw new Error("Unexpected token < in JSON: <script>steal()</script>"); });
  assert.doesNotMatch(leak.line, /steal|script/, "an error quoting fetched text is never shown");
});

// The ruled shape (Gabriel, 2026-10-14): one code-made row per pinned model the page lists as
// deprecated or retired; no lens or rater call; deprecated with a date urgent with the date and the
// replacement, already retired soon with "confirm nothing still sends it".
import { retirementRows } from "../scripts/lib/deprecations.mjs";
import { bounds, rateRow, BANDS, isTripwire } from "../scripts/lib/rate.mjs";
import { loadRows } from "../scripts/lib/rows.mjs";
const dep = { id: "claude-sonnet-4-5", file: "src/llm.ts", line: 12, pageId: "claude-sonnet-4-5-20250929", state: "deprecated", deprecated: "2026-09-30", retires: "2026-11-30", replacement: "claude-sonnet-5-5" };
const gone = { id: "claude-sonnet-4", file: "src/models.js", line: 16, pageId: "claude-sonnet-4-20250514", state: "retired", deprecated: "2026-04-14", retires: "2026-06-15", replacement: "claude-sonnet-5-5" };
const tba = { id: "claude-mythos-5", file: "a.ts", line: 1, pageId: "claude-mythos-preview", state: "deprecated", deprecated: "2026-06-09", retires: null, replacement: null };
const MODELS = { app: { models: ["claude-sonnet-4-5"], retiring: [dep] }, web: { models: ["claude-sonnet-4-5", "claude-sonnet-4"], retiring: [{ ...dep, file: "lib/ai.py", line: 4 }, gone] }, docs: { models: [], retiring: null } };

test("retirementRows: one row per retiring model, the projects that pin it, code-made text and bands", () => {
  const rows = retirementRows(MODELS, "2026-10-14");
  assert.deepEqual(rows.map((r) => [r.id, r.projects, r.urgencyLabel, r.action]), [
    ["deprecations:claude-sonnet-4-5-20250929", ["app", "web"], "urgent", "model-refresh"],
    ["deprecations:claude-sonnet-4-20250514", ["web"], "soon", "read"],
  ]);
  const [d, r] = rows;
  assert.equal(d.text, "claude-sonnet-4-5-20250929 is deprecated and retires on 2026-11-30. The recommended replacement is claude-sonnet-5-5.");
  assert.equal(r.text, "claude-sonnet-4-20250514 was retired on 2026-06-15: requests to it fail.");
  assert.equal(d.date, "2026-10-14", "dated today: it stays in every 'last N days' list while the model is in use");
  assert.equal(d.url, "https://platform.claude.com/docs/en/about-claude/model-deprecations");
  assert.ok(isTripwire(d) && isTripwire(r));
  assert.equal(retirementRows({ x: { retiring: [tba] } }, "2026-10-14")[0].urgencyLabel, "soon", "no retirement date yet: soon");
});

test("bounds for a retirement row: confirmed at the model's file and line, the date in the note", () => {
  const [d, r] = retirementRows(MODELS, "2026-10-14");
  const b = bounds(d, "web", [], MODELS);
  assert.equal(b.evidence, "confirmed");
  assert.deepEqual([b.lo, b.hi], BANDS.urgent);
  assert.deepEqual(b.foundIn, [{ term: "claude-sonnet-4-5", file: "lib/ai.py:4" }]);
  assert.equal(b.note, "retires on 2026-11-30, replacement claude-sonnet-5-5: used at lib/ai.py:4");
  const g = bounds(r, "web", [], MODELS);
  assert.deepEqual([g.lo, g.hi], BANDS.soon);
  assert.equal(g.note, "retired on 2026-06-15, so requests to it fail: confirm nothing still sends it (src/models.js:16)");
  const rated = rateRow(r, [], null, MODELS).ratings[0];
  assert.equal(rated.provisional, false, "never waits for the rater");
  assert.ok(rated.score >= 5 && rated.score < 7, `a confirm row stays out of the 7+ list: ${rated.score}`);
  assert.equal(rated.do, "read");
  assert.ok(rateRow(d, [], null, MODELS).ratings.every((x) => x.score >= 7 && x.do === "model-refresh"));
});

test("loadRows adds the retirement rows, never for the rater", () => {
  const data = mkdtempSync(join(tmpdir(), "wnc-dep-"));
  for (const f of ["items.jsonl", "lens-impact.jsonl", "lens-type.jsonl", "lens-risk.jsonl"]) write(join(data, f), "");
  write(join(data, "models.json"), JSON.stringify(MODELS));
  const rows = loadRows(data).rows;
  assert.deepEqual(rows.map((r) => r.id), ["deprecations:claude-sonnet-4-5-20250929", "deprecations:claude-sonnet-4-20250514"]);
  assert.ok(rows.every((r) => r.toRate === false && r.ratings.every((x) => !x.provisional)));
  assert.deepEqual(rows[0].foundIn.map((f) => `${f.project}:${f.file}`), ["app:src/llm.ts:12", "web:lib/ai.py:4"]);
});
