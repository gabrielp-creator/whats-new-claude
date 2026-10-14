// B-51 privacy (P-7): settings.local.json is parsed in process for a closed schema, and nothing from a
// project's scripts or settings beyond names and paths reaches profile.json, the evidence, the rater's
// payload, a brief or the review page. Runs the real verify.mjs and build-page.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { loadRows } from "../scripts/lib/rows.mjs";
import { ratePayload } from "../scripts/lib/rate.mjs";
import { buildBrief } from "../scripts/lib/brief.mjs";
import { readJsonl, readJson } from "../scripts/lib/store.mjs";

const ROOT = join(import.meta.dirname, "..");
const SECRETS = ["sk-ant-test", "secret rule"];
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

function setUp() {
  const ws = mkdtempSync(join(tmpdir(), "wnc-ws-"));
  const home = mkdtempSync(join(tmpdir(), "wnc-home-"));
  const data = mkdtempSync(join(tmpdir(), "wnc-data-"));
  const localSettings = JSON.stringify({
    env: { ANTHROPIC_API_KEY: "sk-ant-test" },
    permissions: { allow: ["Bash(echo secret rule:*)"] },
    hooks: { Stop: [{ hooks: [{ type: "prompt", prompt: "secret rule text" }, { type: "command", command: "echo secret rule" }] }] },
  });
  mkdirSync(join(ws, "app", ".claude"), { recursive: true });
  mkdirSync(join(ws, "app", "scripts"), { recursive: true });
  writeFileSync(join(ws, "app", "scripts", "run.sh"), 'ANTHROPIC_API_KEY=sk-ant-test claude -p --append-system-prompt "secret rule" "$@"\n');
  writeFileSync(join(ws, "app", ".claude", "settings.local.json"), localSettings);
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.local.json"), localSettings);
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ permissions: { defaultMode: "auto" } }));

  writeFileSync(join(data, "config.json"), JSON.stringify({
    workspaceRoot: ws,
    projects: [
      { id: "setup", description: "Claude Code setup", briefDir: "briefs/setup" },
      { id: "app", description: "An app that scripts claude", path: "app", briefDir: "app/docs" },
    ],
  }));
  const items = [
    { id: "claude-code:v1:0", source: "claude-code", date: "2026-10-08", title: "v1", text: "Fixed `prompt` and `agent` hooks written as instructions allowing what they should block", url: "https://github.com/anthropics/claude-code/releases/tag/v1", provenance: "anthropic-release", tripwires: [] },
    { id: "claude-code:v1:1", source: "claude-code", date: "2026-10-08", title: "v1", text: "Fixed `--append-system-prompt` being ignored with `ANTHROPIC_API_KEY` set in print mode", url: "https://github.com/anthropics/claude-code/releases/tag/v1", provenance: "anthropic-release", tripwires: [] },
  ];
  writeFileSync(join(data, "items.jsonl"), jsonl(items));
  writeFileSync(join(data, "lens-impact.jsonl"), jsonl(items.map((i) => ({ id: i.id, effect: "fixes", projects: ["setup", "app"], new_work: false, strength: "high", why: "w", injection: false }))));
  writeFileSync(join(data, "lens-type.jsonl"), jsonl(items.map((i) => ({ id: i.id, type: "bug-fix", action: "update-harness", injection: false }))));
  writeFileSync(join(data, "lens-risk.jsonl"), jsonl(items.map((i) => ({ id: i.id, risk: "behavior-change", exposed: true, why: "rw", injection: false }))));
  return { ws, home, data };
}

const run = (script, data, home) => {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", script), "--data", data], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

test("rule text, hook commands, prompts and env values never leave the profile parser (P-7)", () => {
  const { home, data } = setUp();
  run("verify.mjs", data, home);
  run("build-page.mjs", data, home);

  // positive controls: settings.local.json was read, and the evidence uses it
  const profile = readJson(join(data, "profile.json"));
  assert.deepEqual(profile.app.hooks.map((h) => `${h.event}:${h.type}:${h.file}`), ["Stop:prompt:inline", "Stop:command:inline"]);
  assert.deepEqual(profile.setup.rules, [{ list: "allow", kind: "Bash", source: "settings.local.json" }]);
  const evidence = readJsonl(join(data, "evidence.jsonl"));
  assert.ok(evidence.some((e) => e.id === "claude-code:v1:0" && e.project === "setup" && e.found.some((f) => f.term === "`prompt` hook on Stop" && f.file === "settings.local.json")));
  assert.ok(evidence.some((e) => e.id === "claude-code:v1:1" && e.project === "app" && e.found.some((f) => f.term === "--append-system-prompt")));

  const { rows } = loadRows(data);
  const evs = (id) => evidence.filter((e) => e.id === id);
  const models = readJson(join(data, "models.json"));
  const outputs = {
    "profile.json": readFileSync(join(data, "profile.json"), "utf8"),
    "evidence.jsonl": readFileSync(join(data, "evidence.jsonl"), "utf8"),
    "models.json": readFileSync(join(data, "models.json"), "utf8"),
    "results.html": readFileSync(join(data, "results.html"), "utf8"),
    "rater payload": JSON.stringify(rows.map((r) => ratePayload(r, evs(r.id), models))),
    brief: ["setup", "app"].map((p) => buildBrief(p, rows, { date: "2026-10-13", dir: "docs" })).join("\n"),
  };
  for (const [name, text] of Object.entries(outputs)) for (const s of SECRETS) assert.ok(!text.includes(s), `${JSON.stringify(s)} in ${name}`);
});
