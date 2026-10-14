import { test } from "node:test";
import assert from "node:assert/strict";
import { modelScope, inScope } from "../scripts/lib/scope.mjs";

const at = (text, id) => inScope(modelScope(text), id);
const each = (text, want) => {
  const s = modelScope(text);
  for (const [id, state] of Object.entries(want)) assert.equal(inScope(s, id), state, `${id} in ${JSON.stringify(text.slice(0, 60))}`);
};

// P-1: the three range texts that read "other-models" in 0.3.0 (reproduced 2026-10-13).
const NEWER = "Todo/task-tracking tools (TaskCreate/Get/Update/List, TodoWrite) are no longer available on Opus 4.8, Sonnet 5, Fable 5, Mythos 5, and newer models; set `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` to bring them back";
const DASH = "Changed the task-tracking tools (TaskCreate/Get/Update/List, TodoWrite) to be offered only on Claude 3.x, Opus 4.0–4.7, Sonnet 4.0–4.6, Haiku 4.5; set `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` elsewhere";
const PLUS = "Changed Opus 4.7+ and Fable to use a 1M context window by default on Bedrock, Vertex, Foundry and the Claude apps gateway, with no `[1m]` suffix (`CLAUDE_CODE_DISABLE_1M_CONTEXT=1` keeps 200K)";

test("'X, Y, and newer models': each named family from its version up; other families unknown, not out", () => {
  each(NEWER, {
    "claude-opus-5-5": "in", "claude-opus-4-8": "in", "claude-sonnet-5-5": "in", "claude-fable-5-1": "in",
    "claude-opus-4-6": "out", "claude-sonnet-4-6": "out",
    "claude-haiku-4-5": "unknown", // "newer models" may take in a family it does not name
  });
});

test("'a–b' ranges and 'Claude 3.x' are ranges, not their first endpoint", () => {
  each(DASH, {
    "claude-opus-4-6": "in", "claude-opus-4-0": "in", "claude-opus-4-7": "in", "claude-sonnet-4-6": "in",
    "claude-haiku-4-5": "in", "claude-3-5-sonnet-20241022": "in", "claude-3-opus-20240229": "in",
    "claude-opus-4-8": "out", "claude-sonnet-5": "out", "claude-haiku-5-5": "out",
  });
});

test("'X+' is open upward in its family; a family with no version is unknown, never in or out", () => {
  each(PLUS, {
    "claude-opus-4-8": "in", "claude-opus-5-5": "in", "claude-opus-4-7": "in",
    "claude-fable-5-1": "unknown", "claude-fable-5": "unknown",
    "claude-opus-4-6": "out", "claude-sonnet-5": "out",
  });
  each("use the 1M context window of models that have one (Opus 4.7+, Sonnet 5+, Fable)", { "claude-sonnet-5-5": "in", "claude-sonnet-4-6": "unknown" });
  // Claude Code's own wording: a family name ties nothing (P-13), and with no version named it
  // rules nothing out either.
  each("Changed the default model on Pro and Team Standard plans from Sonnet to Opus", { "claude-opus-5-5": "unknown", "claude-sonnet-4-6": "unknown", "claude-haiku-4-5": "unknown" });
});

test("'Opus 1M' is a context size, not a model 'Opus 1'", () => {
  const s = modelScope("Fixed a \"switch to Opus 1M for 5x more context\" tip that appeared even when the current Opus model already has a 1M context window");
  assert.equal(s.clauses.some((c) => c.min?.[0] === 1), false);
  assert.equal(inScope(s, "claude-opus-5-5"), "unknown");
});

// RF 2: the change is on Sonnet 5.5; the advisor sentence names other models in passing.
const SONNET55 = "Code written for Claude Sonnet 5 can break on Claude Sonnet 5.5 in five ways. To turn off up-front thinking, send thinking: {\"type\": \"between_tools\"} instead of \"disabled\", at high effort or below. Forced tool use (tool_choice types any and tool) returns a 400 error. Thinking blocks are tied to the model and the conversation. On the Claude API and Google Cloud, the earlier computer_20251124 computer use tool isn't accepted. The advisor tool rejects Claude Opus 4.8, Claude Opus 4.7, and Claude Sonnet 5 as advisors. See What's new in Claude Sonnet 5.5 for each change and the migration guide for before-and-after requests.";

test("the subject: 'code written for X can break on Y' scopes to its first sentence; models named later in passing are not", () => {
  const s = modelScope(SONNET55);
  assert.equal(s.subject, true);
  assert.equal(inScope(s, "claude-sonnet-5-5"), "in");
  assert.equal(inScope(s, "claude-sonnet-5"), "in", "code written for Sonnet 5 is the code that breaks");
  assert.equal(inScope(s, "claude-opus-4-8"), "out", "the advisor sentence is not the scope (RF 2)");
  // NC 3 / LNC 3: the breaking note reaches a project that runs the older model.
  each("Code written for Claude Haiku 4.5 can break on Claude Haiku 5.5. Manual extended thinking (budget_tokens) returns a 400 error. See the migration guide.", {
    "claude-haiku-4-5": "in", "claude-haiku-5-5": "in", "claude-opus-4-8": "out",
  });
});

test("the subject: 'On X, ...' opening the text", () => {
  const t = "On Claude Opus 5.5, thinking can't be disabled: thinking: {\"type\": \"disabled\"} returns a 400 error. tool_choice types any and tool also return a 400 error, as on Claude Fable 5.1; use auto with strict tool use.";
  each(t, { "claude-opus-5-5": "in", "claude-fable-5-1": "out", "claude-opus-5": "out" });
});

test("examples and open classes leave every model not named unknown", () => {
  each("Changed `/code-review` at medium effort to also report findings on models without tuned review settings, including Opus 5.5 and Sonnet 5.5", {
    "claude-opus-5-5": "in", "claude-opus-5": "unknown", "claude-haiku-4-5": "unknown",
  });
  each("Thinking blocks produced by Claude Fable 5.1 and Claude Mythos 5.1 are preserved only for the model that produced them or a newer one: earlier models can't read them.", {
    "claude-fable-5-1": "in", "claude-opus-5": "unknown",
  });
});

test("'and earlier' bounds each named family from above", () => {
  each("Claude Fable 5.1 accepts thinking blocks from Claude Opus 5, Claude Fable 5, and earlier Claude models.", {
    "claude-fable-5-1": "in", "claude-opus-5": "in", "claude-opus-4-8": "in", "claude-fable-5": "in",
    "claude-opus-5-5": "out", "claude-haiku-4-5": "unknown",
  });
});

test("a closed list: models it does not name are out", () => {
  each("Both toolsets are available for Claude Fable 5, Claude Mythos 5, Claude Opus 5, Claude Sonnet 5, and Claude Opus 4.8 on the Claude API.", {
    "claude-opus-4-8": "in", "claude-sonnet-5": "in", "claude-opus-5-5": "out", "claude-haiku-4-5": "out",
  });
  const s = modelScope("Changed Opus 4.7, Opus 4.8 and Fable 5 to stop holding their launch-default effort");
  assert.equal(s.open, "none");
  assert.equal(s.clauses.length, 3);
});

test("a bare version after a named one keeps its family: 'Opus 4.7 and 4.8'", () => {
  each("Fixed `/advisor` pairing checks: Sonnet 5.5 can now advise Opus 4.7 and 4.8", { "claude-opus-4-8": "in", "claude-opus-4-7": "in", "claude-opus-5": "out" });
});

test("ids in the text, dated or old-style, count as exact models", () => {
  each("Requests to `claude-sonnet-4-5-20250929` now return a deprecation header", { "claude-sonnet-4-5": "in", "claude-sonnet-4-6": "out" });
  each("Fixed Claude 3 Opus and Claude 3.x Sonnet sessions being offered tool search", { "claude-3-opus-20240229": "in", "claude-3-5-sonnet-20241022": "in", "claude-opus-4": "out" });
});

test("nothing to go on is unknown: no model named, an unparsed project id, lowercase words", () => {
  const none = modelScope("Fixed a crash when resuming a session");
  assert.deepEqual(none.clauses, []);
  assert.equal(inScope(none, "claude-opus-5-5"), "unknown");
  assert.equal(at(PLUS, "sonnet"), "unknown", "an alias is not a model id");
  assert.deepEqual(modelScope("switch with `/model opusplan`, or an opus 5 poem").clauses, []);
});

test("'earlier models aren't affected' closes the scope instead of opening it", () => {
  const t = "Thinking blocks that Claude Sonnet 5.5 produces work only in the account that produced them. Blocks from earlier models aren't affected. See Preserved thinking.";
  each(t, { "claude-sonnet-5-5": "in", "claude-sonnet-4-6": "out", "claude-opus-5-5": "out" });
  each("Changed Claude Opus 5.5; other models are not affected", { "claude-opus-5": "out" });
  each("Changed Claude Opus 5.5 and earlier models", { "claude-opus-5": "in" }); // a range, not a closing remark
});
