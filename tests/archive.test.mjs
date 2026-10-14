import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseRuns, archiveFiles } from "../scripts/lib/archive.mjs";
import { useIndex, lookup } from "../scripts/lib/use.mjs";

// B-62: a code or config file holding prose runs (8+ words, inline code masked) from 3 or more
// distinct release items is a release archive, not evidence for any of them.
const items = [
  { id: "a:1", title: "v1", text: "Fixed a crash when the status line script printed nothing at all to stdout. Set `STATUS_LINE_TIMEOUT_MS` to raise it." },
  { id: "a:2", title: "v2", text: "Added the `bashOutputMaxChars` setting so long tool output is trimmed before it reaches the model context window." },
  { id: "a:3", title: "v3", text: "Hooks now receive the session id on every event, including the ones fired after a compaction has finished running." },
  { id: "a:4", title: "v4", text: "Set CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS_FOR_ALL_PROJECT_USERS to turn the betas off." },
  { id: "a:5", title: "v5", text: "Deprecated CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS_FOR_ALL_PROJECT_USERS in favour of a setting." },
  { id: "a:6", title: "v6", text: "Renamed CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS_FOR_ALL_PROJECT_USERS for clarity." },
  // Boilerplate shared by many items is not a quote of any one of them.
  ...["b:1", "b:2", "b:3"].map((id) => ({ id, title: id, text: `It is available today on the Claude API and in all cloud platforms. Model ${id}.` })),
];
const runs = releaseRuns(items);

const archive = {
  file: "scripts/notes.mjs",
  text: [
    'export const NOTES = [',
    '  "Fixed a crash when the status line script printed nothing at all to stdout",',
    '  "Added the setting so long tool output is trimmed before it reaches the model context window",',
    '  "Hooks now receive the session id on every event, including the ones fired after a compaction",',
    '  "uses STATUS_LINE_TIMEOUT_MS and bashOutputMaxChars and claude-opus-4-8",',
    '];',
  ].join("\n"),
};

test("a code file quoting prose from 3 items is an archive; its names are mentions, never found (LCW 8)", () => {
  const ex = archiveFiles([archive], runs);
  assert.deepEqual(ex, [{ file: "scripts/notes.mjs", items: 3 }]);
  const ix = useIndex([archive], { archives: new Set(ex.map((e) => e.file)) });
  assert.deepEqual(lookup(["STATUS_LINE_TIMEOUT_MS", "bashOutputMaxChars"], ix), {
    found: [], mentioned: [{ term: "STATUS_LINE_TIMEOUT_MS", file: "scripts/notes.mjs" }, { term: "bashOutputMaxChars", file: "scripts/notes.mjs" }] });
  assert.deepEqual(ix.models.models, [], "an id inside an archive is not a model in use");
  assert.deepEqual(ix.models.mentioned, ["claude-opus-4-8"]);
  assert.deepEqual(lookup(["STATUS_LINE_TIMEOUT_MS"], useIndex([archive])).found.length, 1, "control: without the rule it confirms");
});

test("a code file copying one release snippet stays evidence (P-8)", () => {
  const f = { file: "src/statusline.ts", text: '// Fixed a crash when the status line script printed nothing at all to stdout\nconst t = process.env.STATUS_LINE_TIMEOUT_MS;' };
  assert.deepEqual(archiveFiles([f], runs), []);
});

test("a long identifier named by many items is one word, not a prose run (P-8: a 40+ character term stays confirmed)", () => {
  const f = { file: "settings.json", text: '{ "env": { "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS_FOR_ALL_PROJECT_USERS": "1" } }' };
  assert.deepEqual(archiveFiles([f], runs), []);
  assert.equal(lookup(["CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS_FOR_ALL_PROJECT_USERS"], useIndex([f])).found.length, 1);
});

test("boilerplate shared by more than two items counts for none of them", () => {
  const f = { file: "src/copy.ts", text: 'export const BLURB = "It is available today on the Claude API and in all cloud platforms.";' };
  assert.deepEqual(archiveFiles([f], runs), []);
});

test("only used text counts: docs are already mentions, and a 7-word run is not a run", () => {
  const doc = { file: "docs/notes.md", text: archive.text };
  assert.deepEqual(archiveFiles([doc], runs), []);
  const short = { file: "src/a.ts", text: '"Fixed a crash when the status line" "Added the setting so long tool output" "Hooks now receive the session id on"' };
  assert.deepEqual(archiveFiles([short], runs), []);
});

test("setup files are classified from inside .claude", () => {
  const lens = { file: "lenses/x.md", text: "---\nmodel: sonnet\n---\n" + archive.text };
  assert.deepEqual(archiveFiles([lens], runs, { claudeRoot: true }), [], "lens body is a mention, so it is never an archive");
  const hook = { file: "hooks/notes.mjs", text: archive.text };
  assert.deepEqual(archiveFiles([hook], runs, { claudeRoot: true }), [{ file: "hooks/notes.mjs", items: 3 }]);
});
