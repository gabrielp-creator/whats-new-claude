// Silent-failure counters (P-5): numbers only, in summary.json, and a jump shown by the reminder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { counters, jumps, COUNTERS } from "../scripts/lib/counters.mjs";
import { reminderText } from "../scripts/lib/reminder.mjs";

const r = (o) => ({ id: "x", source: "platform-release-notes", type: "behavior-change", risk: "none", urgencyBy: "effect", fyiOnly: false, tripwires: [], ratings: [], ...o });

test("counters: each failure mode is counted from rows, evidence, models and profiles", () => {
  const rows = [
    r({ id: "a", text: "Changed Claude Opus 4.7 and newer models to stop holding effort" }),
    r({ id: "b", text: "Changed several models, including Opus 4.7" }),
    r({ id: "c", text: "Changed Claude Opus 4.7 to stop holding effort" }),
    r({ id: "d", text: "Fixed a crash", type: "security", risk: "none", urgencyBy: "floor",
      ratings: [{ project: "app", lo: 5, hi: 6.9, raw: 3, disagrees: true, heldSoon: true }, { project: "web", lo: 7, hi: 10, raw: 8, disagrees: false }] }),
  ];
  const evidence = [
    { id: "a", project: "app", tiedBy: "model" }, { id: "a", project: "web", tiedBy: "tripwire" },
    { id: "b", project: "app", tiedBy: "lens", dropped: "no-sdk-package" }, { id: "b", project: "web", tiedBy: "lens", dropped: "cli-off" },
    { id: "c", project: "setup", tiedBy: "setup" }, { id: "c", project: "app", tiedBy: "lens", held: "why" },
  ];
  const models = { app: { archives: [{ file: "data/a.json", items: 40 }] }, web: { archives: [] } };
  const profiles = { app: { cli: { status: "unknown", calls: [{ file: "a.mjs", line: 3 }, { file: "b.mjs", line: 9 }] } }, web: { cli: { status: "known", calls: [] } } };
  const c = counters(rows, { evidence, models, profiles });
  assert.deepEqual(c, {
    scopeOpen: 2, clampedUp: 1, raterDisagrees: 1, archives: 1,
    tiesModel: 1, tiesSdk: 0, tiesTripwire: 1, tiesSetup: 1,
    dropNoSdk: 1, dropCliOff: 1, dropOther: 0, heldCli: 1,
    cliUnknown: 2, floorSplit: 1, tripwireHeld: 1,
  });
  for (const k of Object.keys(c)) assert.ok(COUNTERS[k], `${k} has a label`);
});

test("jumps: up by 5 or more and by half or more; new counters from zero need 5", () => {
  assert.deepEqual(jumps({ dropNoSdk: 12, clampedUp: 40, cliUnknown: 0 }, { dropNoSdk: 49, clampedUp: 44, cliUnknown: 5 }),
    [{ key: "dropNoSdk", before: 12, now: 49 }, { key: "cliUnknown", before: 0, now: 5 }]);
  assert.deepEqual(jumps(null, { dropNoSdk: 49 }), [], "no earlier run: nothing to compare");
  assert.deepEqual(jumps({ x: 1 }, { x: 99 }), [], "unknown keys are never reported");
});

test("the reminder names a jump with code's labels and numbers only", () => {
  const summary = { builtAt: new Date().toISOString(), min: 8, top: {}, topTotal: 0, counterJumps: [{ key: "dropNoSdk", before: 12, now: 49 }, { key: "<script>", before: 0, now: 9 }] };
  const text = reminderText({ summary, config: { projects: [] } });
  assert.match(text, /Check: ties dropped because the SDK package is missing rose from 12 to 49\./);
  assert.doesNotMatch(text, /script/);
});
