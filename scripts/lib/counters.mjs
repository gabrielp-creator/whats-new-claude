// Silent-failure counters (P-5, P-1, P-2, P-8, P-12): numbers that move when a rule starts failing
// quietly. build-page.mjs writes them to summary.json on every run with the previous run's values, and
// the session-start reminder names any that jumped. Keys and labels are code's own, so nothing fetched
// reaches a session through them. Tested in tests/counters.test.mjs.
import { modelRefs } from "./models.mjs";
import { modelScope } from "./scope.mjs";
import { isLaunch, lensesAgree } from "./rate.mjs";

export const COUNTERS = {
  scopeOpen: "items whose model scope is open-ended or unparsed",
  clampedUp: "rater scores raised to the band's floor",
  raterDisagrees: "rater answers that disagree with the band",
  archives: "files read as release-text archives",
  tiesModel: "ties added by model",
  tiesSdk: "ties added by SDK package",
  tiesTripwire: "ties added by tripwire term",
  tiesSetup: "items moved to setup",
  dropNoSdk: "ties dropped because the SDK package is missing",
  dropCliOff: "ties dropped because scripted calls switch the feature off",
  dropOther: "ties dropped for another reason",
  heldCli: "security or breaking items kept despite scripted calls",
  cliUnknown: "scripted claude calls the profile could not read",
  floorSplit: "urgent-floor items whose type and risk lenses disagree",
  tripwireHeld: "security or breaking pairs held at soon by the floor rule",
};

// rows: loadRows's rows; evidence: evidence.jsonl rows; models: models.json; profiles: profile.json.
export function counters(rows, { evidence = [], models = {}, profiles = {} } = {}) {
  const c = Object.fromEntries(Object.keys(COUNTERS).map((k) => [k, 0]));
  for (const row of rows) {
    if (!row.codeMade && !isLaunch(row) && modelRefs(`${row.title || ""} ${row.text || ""}`).length) {
      const s = modelScope(row.text, { title: row.title });
      if (s.open !== "none" || !s.clauses.some((x) => !x.loose)) c.scopeOpen++;
    }
    if ((row.urgencyBy === "floor" || row.urgencyBy === "exposed") && ["security", "breaking-or-deprecation"].includes(row.type) && !lensesAgree(row)) c.floorSplit++;
    for (const x of row.ratings || []) {
      if (typeof x.raw === "number" && x.raw < x.lo) c.clampedUp++;
      if (x.disagrees) c.raterDisagrees++;
      if (x.heldSoon) c.tripwireHeld++;
    }
  }
  const TIES = { model: "tiesModel", sdk: "tiesSdk", tripwire: "tiesTripwire", setup: "tiesSetup" };
  const DROPS = { "no-sdk-package": "dropNoSdk", "cli-off": "dropCliOff" };
  for (const e of evidence) {
    if (e.dropped) c[DROPS[e.dropped] || "dropOther"]++;
    else if (TIES[e.tiedBy]) c[TIES[e.tiedBy]]++;
    if (e.held) c.heldCli++;
  }
  for (const m of Object.values(models || {})) c.archives += (m?.archives || []).length;
  for (const p of Object.values(profiles || {})) if (p?.cli?.status === "unknown") c.cliUnknown += (p.cli.calls || []).length;
  return c;
}

// The counters that jumped since the last run: up by at least 5 and by at least half. Only known keys.
export function jumps(before, now) {
  if (!before) return [];
  return Object.keys(COUNTERS).filter((k) => Number.isFinite(now?.[k]))
    .map((k) => ({ key: k, before: Number(before[k]) || 0, now: now[k] }))
    .filter((j) => j.now - j.before >= 5 && j.now >= 1.5 * j.before);
}
