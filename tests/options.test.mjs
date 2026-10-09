import { test } from "node:test";
import assert from "node:assert/strict";
import { optionsFromEnv, FREQUENCY_HOURS, mergeOptions } from "../scripts/lib/options.mjs";

const env = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`CLAUDE_PLUGIN_OPTION_${k}`, v]));

test("reads the /config values Claude Code exports to hooks, typed", () => {
  const o = optionsFromEnv(env({ UPDATE_FREQUENCY: "weekly", MIN_RATING: "8.5", AUTO_RATE_MAX_CALLS: "10", MAX_CALLS_WITHOUT_ASKING: "30", REMINDER: "false" }));
  assert.deepEqual(o, { updateFrequency: "weekly", minRating: 8.5, autoRateMaxCalls: 10, maxCallsWithoutAsking: 30, reminder: false });
});

test("never copies the GitHub token, or anything it does not know", () => {
  const o = optionsFromEnv(env({ GITHUB_TOKEN: "ghp_secret", SOMETHING: "x", MIN_RATING: "8" }));
  assert.deepEqual(o, { minRating: 8 });
  assert.doesNotMatch(JSON.stringify(o), /ghp_secret/);
});

test("drops values that are out of range or the wrong type instead of guessing", () => {
  const o = optionsFromEnv(env({ UPDATE_FREQUENCY: "hourly", MIN_RATING: "11", AUTO_RATE_MAX_CALLS: "-1", MAX_CALLS_WITHOUT_ASKING: "lots", REMINDER: "maybe" }));
  assert.deepEqual(o, {});
});

test("an empty environment (no plugin, or nothing set) gives no options", () => {
  assert.deepEqual(optionsFromEnv({}), {});
});

test("frequencies map to hours; manual never runs in the background", () => {
  assert.equal(FREQUENCY_HOURS.daily, 24);
  assert.equal(FREQUENCY_HOURS["every 3 days"], 72);
  assert.equal(FREQUENCY_HOURS.weekly, 168);
  assert.equal(FREQUENCY_HOURS.manual, Infinity);
});

test("options from /config win over the same keys in config.json; projects are untouched", () => {
  const c = mergeOptions({ projects: [{ id: "a" }], minRating: 7, reminder: true }, { minRating: 9, reminder: false });
  assert.equal(c.minRating, 9);
  assert.equal(c.reminder, false);
  assert.deepEqual(c.projects, [{ id: "a" }]);
  assert.deepEqual(mergeOptions({ minRating: 7 }, null), { minRating: 7 });
});

test("object prototype names are not accepted as a frequency", () => {
  assert.deepEqual(optionsFromEnv(env({ UPDATE_FREQUENCY: "constructor" })), {});
  assert.deepEqual(optionsFromEnv(env({ UPDATE_FREQUENCY: "__proto__" })), {});
});

test("options.json can only change the known settings, never projects, folders or the model", () => {
  const c = mergeOptions({ projects: [{ id: "a" }], workspaceRoot: "/w", model: "sonnet", blocked: [".git"] },
    { minRating: 9, projects: [], workspaceRoot: "/evil", model: "x & y", blocked: [], updateFrequency: "weekly" });
  assert.deepEqual(c.projects, [{ id: "a" }]);
  assert.equal(c.workspaceRoot, "/w");
  assert.equal(c.model, "sonnet");
  assert.deepEqual(c.blocked, [".git"]);
  assert.equal(c.minRating, 9);
  assert.equal(c.updateFrequency, "weekly");
});
