import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModel, modelRefs, launchStatus, isLaunchText } from "../scripts/lib/models.mjs";

// B-57 (P-10): a launch is said with a launch verb next to the model's name, in one clause.
test("isLaunchText: launch verbs next to a model name; 'available' and passing mentions are not launches", () => {
  for (const t of [
    "We've launched Claude Haiku 5.5 (claude-haiku-5-5), our most capable model tuned for high-volume work",
    "Added Claude Sonnet 5.5 (`claude-sonnet-5-5`), now the default Sonnet model on the Anthropic API",
    "Introducing Claude Opus 5.5",
  ]) assert.equal(isLaunchText(t), true, t);
  for (const t of [
    "Both toolsets are available for Claude Fable 5, Claude Mythos 5, Claude Opus 5, Claude Sonnet 5, and Claude Opus 4.8 on the Claude API.",
    "Thinking blocks that Claude Sonnet 5.5 produces work only in the account that produced them",
    "Fast mode (research preview) is available for Claude Opus 5.5 on the Claude API.",
    "Added a line field to the Models API. Claude Opus 4.5 and Claude Opus 4.6 both report opus",
    "Added `--model` support; we launched it. Claude Opus 5 is unchanged",
  ]) assert.equal(isLaunchText(t), false, t);
});

test("parseModel reads current, dated, cloud and old-style ids into family and version", () => {
  assert.deepEqual(parseModel("claude-opus-5-5"), { family: "opus", version: [5, 5], id: "claude-opus-5-5" });
  assert.deepEqual(parseModel("claude-opus-5"), { family: "opus", version: [5, 0], id: "claude-opus-5" });
  assert.deepEqual(parseModel("claude-sonnet-4-5-20250929").version, [4, 5]);
  assert.deepEqual(parseModel("claude-opus-4-20250514").version, [4, 0], "an 8-digit date is not a version");
  assert.deepEqual(parseModel("claude-3-5-sonnet-20241022"), { family: "sonnet", version: [3, 5], id: "claude-sonnet-3-5" });
  assert.deepEqual(parseModel("claude-3-opus-20240229"), { family: "opus", version: [3, 0], id: "claude-opus-3" });
  assert.equal(parseModel("claude-haiku-4-5").id, "claude-haiku-4-5");
  assert.equal(parseModel("claude-code"), null);
  assert.equal(parseModel("claude-agent-sdk"), null);
});

test("modelRefs finds ids and prose names in release text, deduplicated", () => {
  const t = "Code written for Claude Sonnet 5 can break on Claude Sonnet 5.5. The advisor tool rejects Claude Opus 4.8, Claude Opus 4.7, and Claude Sonnet 5 as advisors.";
  assert.deepEqual(modelRefs(t).map((m) => m.id), ["claude-sonnet-5", "claude-sonnet-5-5", "claude-opus-4-8", "claude-opus-4-7"]);
  assert.deepEqual(modelRefs("Added Claude Opus 5.5 (`claude-opus-5-5`), now the default").map((m) => m.id), ["claude-opus-5-5"]);
  assert.deepEqual(modelRefs("On Claude Fable 5.1 and Claude Mythos 5.1, tool_choice").map((m) => m.id), ["claude-fable-5-1", "claude-mythos-5-1"]);
  assert.deepEqual(modelRefs("Sonnet 4.5 retires on 2026-11-01").map((m) => m.id), ["claude-sonnet-4-5"]);
  assert.deepEqual(modelRefs("an opus 5 poem, Haiku about spring, version 2.1.280"), [], "lowercase words and bare family names are not model names");
  assert.deepEqual(modelRefs("a \"switch to Opus 1M for 5x more context\" tip; Sonnet/Opus 1M for subscribers"), [], "a context size is not a version");
  assert.deepEqual(modelRefs("Opus 4.8's effort, Sonnet 5.5."), modelRefs("claude-opus-4-8 claude-sonnet-5-5"));
});

const opus55 = modelRefs("Added Claude Opus 5.5 (`claude-opus-5-5`)");

test("launchStatus: the launched id in use = adopted, listing the older ids still in use", () => {
  assert.deepEqual(launchStatus(opus55, ["claude-opus-5-5"]), { status: "adopted", uses: ["claude-opus-5-5"], older: [] });
  assert.deepEqual(launchStatus(opus55, ["claude-opus-4-8", "claude-opus-5", "claude-opus-5-5"]),
    { status: "adopted", uses: ["claude-opus-5-5"], older: ["claude-opus-4-8", "claude-opus-5"] });
});

test("launchStatus: an older model of the same family = upgrade; another family only = other-models; nothing = unknown", () => {
  assert.deepEqual(launchStatus(opus55, ["claude-opus-4-8", "claude-haiku-4-5", "claude-sonnet-4-6"]),
    { status: "upgrade", uses: ["claude-opus-4-8"], older: ["claude-opus-4-8"] });
  assert.equal(launchStatus(opus55, ["claude-sonnet-4-6"]).status, "other-models");
  assert.equal(launchStatus(opus55, []).status, "unknown");
  assert.equal(launchStatus([], ["claude-opus-4-8"]).status, "unknown", "a launch that names no model cannot be placed");
  // a newer model of the same family is not an upgrade target
  assert.equal(launchStatus(modelRefs("Claude Opus 4.8"), ["claude-opus-5-5"]).status, "other-models");
});

test("launchStatus: a model listed as in use is never repeated as an older one", () => {
  const refs = modelRefs("Claude Opus 5.5 replaces Claude Opus 5 as the default");
  assert.deepEqual(launchStatus(refs, ["claude-opus-5", "claude-opus-5-5", "claude-opus-4-8"]),
    { status: "adopted", uses: ["claude-opus-5", "claude-opus-5-5"], older: ["claude-opus-4-8"] });
});
