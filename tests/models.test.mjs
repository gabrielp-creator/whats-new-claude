import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModel, modelRefs, inventory, launchStatus, scopeOverlap } from "../scripts/lib/models.mjs";

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
});

test("inventory lists the model ids a project's files use, by first file, without duplicates", () => {
  const inv = inventory([
    { file: "src/a.ts", text: 'model: "claude-opus-4-8", fallback: "claude-opus-4-8"' },
    { file: "src/b.py", text: "MODEL = 'claude-sonnet-4-5-20250929'  # anthropic.claude-opus-5-5-v1:0" },
  ]);
  assert.deepEqual(inv, ["claude-opus-4-8", "claude-sonnet-4-5", "claude-opus-5-5"]);
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

test("scopeOverlap: which of the item's models the project uses (same family and version)", () => {
  const refs = modelRefs("Code written for Claude Sonnet 5 can break on Claude Sonnet 5.5. The advisor tool rejects Claude Opus 4.8.");
  assert.deepEqual(scopeOverlap(refs, ["claude-opus-4-8", "claude-opus-5-5"]), ["claude-opus-4-8"]);
  assert.deepEqual(scopeOverlap(refs, ["claude-sonnet-4-6"]), []);
  assert.deepEqual(scopeOverlap(refs, ["claude-sonnet-5"]), ["claude-sonnet-5"]);
  assert.deepEqual(scopeOverlap(refs, ["claude-sonnet-5-20260301"]), ["claude-sonnet-5"], "dated ids are read by family and version");
  assert.deepEqual(scopeOverlap(refs, ["claude-sonnet-5-5"]), ["claude-sonnet-5-5"]);
});
