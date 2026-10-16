// The real fetch.mjs against a stubbed network (tests/fixtures/net-stub.mjs). B-68: commits resolved
// before GitHub's rate limit are kept and the next run goes on from there. B-69: no network reads as
// no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { readJsonl, readJson } from "../scripts/lib/store.mjs";

const ROOT = join(import.meta.dirname, "..");
const STUB = pathToFileURL(join(ROOT, "tests", "fixtures", "net-stub.mjs")).href;
const GH = "api.github.com/repos/anthropics";
const SHAS = ["6666666666666666666666666666666666666666", "7777777777777777777777777777777777777777", "8888888888888888888888888888888888888888"];
const commit = (sha) => ({ sha, html_url: `https://github.com/anthropics/skills/commit/${sha}`, commit: { message: `Update skill ${sha.slice(0, 3)}`, committer: { date: "2026-10-12T10:00:00Z" }, author: { date: "2026-10-12T10:00:00Z" } } });
const LIMIT = { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Date.UTC(2026, 9, 15, 14, 5) / 1000) }, body: { message: "API rate limit exceeded" } };

// Every source answers empty; the skills repo lists three commits.
const quiet = () => ({
  [`${GH}/claude-code/releases`]: { body: [] },
  [`${GH}/claude-agent-sdk-typescript/releases`]: { body: [] },
  [`${GH}/claude-agent-sdk-python/releases`]: { body: [] },
  "platform.claude.com/docs/en/release-notes/feed.xml": { body: "<rss></rss>" },
  "platform.claude.com/docs/en/about-claude/model-deprecations.md": { body: readFileSync(join(ROOT, "tests", "fixtures", "model-deprecations.md"), "utf8") },
  "www.anthropic.com/sitemap.xml": { body: "<urlset></urlset>" },
  [`${GH}/skills/commits`]: { body: SHAS.map(commit) },
  [`${GH}/claude-cookbooks/commits`]: { body: [] },
  [`${GH}/claude-plugins-official/commits`]: { body: [] },
  [`${GH}/claude-plugins-official/contents/.claude-plugin/marketplace.json`]: { body: { content: Buffer.from('{"plugins":[]}').toString("base64") } },
});
const pulls = (sha) => `${GH}/skills/commits/${sha}/pulls`;

function setUp() {
  const dir = mkdtempSync(join(tmpdir(), "wnc-fetch-"));
  const data = join(dir, "data"), home = join(dir, "home");
  mkdirSync(data); mkdirSync(home);
  return { dir, data, home };
}
function runFetch({ dir, data, home }, routes) {
  const routesFile = join(dir, "routes.json"), log = join(dir, `log-${Date.now()}.txt`);
  writeFileSync(routesFile, JSON.stringify(routes));
  writeFileSync(log, "");
  const env = { ...process.env, HOME: home, USERPROFILE: home, WNC_STUB_ROUTES: routesFile, WNC_STUB_LOG: log };
  delete env.CLAUDE_PLUGIN_OPTION_GITHUB_TOKEN;
  const r = spawnSync(process.execPath, ["--import", STUB, join(ROOT, "scripts", "fetch.mjs"), "--data", data], { encoding: "utf8", env });
  return { status: r.status, out: r.stdout, err: r.stderr, asked: readFileSync(log, "utf8").trim().split("\n") };
}

test("fetch: commits resolved before the rate limit are kept, and the next run looks up only the rest (B-68)", () => {
  const ctx = setUp();
  const first = runFetch(ctx, { ...quiet(), [pulls(SHAS[0])]: { body: [] }, [pulls(SHAS[1])]: { body: [] }, [pulls(SHAS[2])]: LIMIT });
  assert.equal(first.status, 1, first.err);
  assert.match(first.out, /^skills: FAILED: GitHub rate limit reached \(HTTP 403\), resets at 14:05 UTC; a GitHub token in \/config raises the limit; kept 2 new, the next run goes on from there$/m);
  assert.deepEqual(readJsonl(join(ctx.data, "items.jsonl")).map((i) => [i.id, i.provenance]), [["skills:6666666", "anthropic-write-access"], ["skills:7777777", "anthropic-write-access"]]);
  const skills = readJson(join(ctx.data, "state.json")).sources.skills;
  assert.equal(skills.lastSuccess, undefined, "the window is not advanced");
  assert.match(skills.lastError, /^GitHub rate limit reached/);

  const second = runFetch(ctx, { ...quiet(), [pulls(SHAS[2])]: { body: [] } });
  assert.equal(second.status, 0, second.out);
  assert.deepEqual(second.asked.filter((u) => u.includes("/pulls")), [`https://${pulls(SHAS[2])}`], "only the commit not stored yet is looked up");
  assert.match(second.out, /^skills: 1 new/m);
  assert.deepEqual(readJsonl(join(ctx.data, "items.jsonl")).map((i) => i.id), ["skills:6666666", "skills:7777777", "skills:8888888"]);
  assert.ok(readJson(join(ctx.data, "state.json")).sources.skills.lastSuccess);
});

test("fetch with no network: every source says network unreachable, with the code (B-69)", () => {
  const ctx = setUp();
  const r = runFetch(ctx, { "*": { offline: "ENOTFOUND" } });
  assert.equal(r.status, 1);
  const failed = r.out.split("\n").filter((l) => /: FAILED: /.test(l));
  assert.equal(failed.length, 9, r.out);
  for (const l of failed) assert.match(l, /: FAILED: network unreachable \(ENOTFOUND\)/);
  assert.doesNotMatch(r.out, /details not shown/);
});
