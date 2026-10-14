import { test } from "node:test";
import assert from "node:assert/strict";
import { pluginProvenance, commitProvenance } from "../scripts/lib/provenance.mjs";

test("pluginProvenance: only ./plugins and anthropics repos on github.com are Anthropic-published", () => {
  assert.equal(pluginProvenance("./plugins/code-review"), "anthropic-published");
  assert.equal(pluginProvenance("https://github.com/anthropics/some-plugin.git"), "anthropic-published");
  assert.equal(pluginProvenance({ source: "github", repo: "anthropics/some-plugin" }), "anthropic-published");
  assert.equal(pluginProvenance({ source: "url", url: "https://github.com/anthropics/some-plugin" }), "anthropic-published");
});

test("pluginProvenance: other local folders and look-alike URLs are third-party (B-67)", () => {
  // The official marketplace keeps outside plugins under ./external_plugins (14 of 315 on 2026-10-13).
  assert.equal(pluginProvenance("./external_plugins/someone-tool"), "third-party");
  assert.equal(pluginProvenance("./plugins/../external_plugins/someone-tool"), "third-party");
  assert.equal(pluginProvenance("https://evil.example/github.com/anthropics/x"), "third-party");
  assert.equal(pluginProvenance("https://github.com/anthropics-fan/x"), "third-party");
  assert.equal(pluginProvenance("https://github.com/someone/anthropics"), "third-party");
  assert.equal(pluginProvenance({ source: "github", repo: "someone/anthropics" }), "third-party");
  assert.equal(pluginProvenance(undefined), "third-party");
});

// A fake of lib/net.mjs get: answers by URL and records what was asked.
function fakeGet(routes) {
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    if (!(url in routes)) throw new Error(`HTTP 404 from api.github.com`);
    return routes[url];
  };
  return { get, calls };
}
const REPO = "anthropics/skills";
const pullsOf = (sha) => `https://api.github.com/repos/${REPO}/commits/${sha}/pulls`;
const pr = (n, head) => ({ number: n, merged_at: "2026-10-01T00:00:00Z", head: { repo: head ? { full_name: head } : null } });

test("commitProvenance: decided by the PRs GitHub links to the commit, not by the message (B-67)", async () => {
  const internal = fakeGet({ [pullsOf("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]: [pr(10, REPO)] });
  assert.equal(await commitProvenance(REPO, { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", message: "Update skill (#10)" }, internal.get), "anthropic-write-access");
  assert.deepEqual(internal.calls, [pullsOf("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]);

  const fork = fakeGet({ [pullsOf("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")]: [pr(11, "someone/skills")] });
  assert.equal(await commitProvenance(REPO, { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", message: "Fix typo (#11)" }, fork.get), "external-fork");
});

test("commitProvenance: a rebase-merged fork commit with no (#N) is external, not write access", async () => {
  const { get } = fakeGet({ [pullsOf("cccccccccccccccccccccccccccccccccccccccc")]: [pr(12, "someone/skills")] });
  assert.equal(await commitProvenance(REPO, { sha: "cccccccccccccccccccccccccccccccccccccccc", message: "Fix typo" }, get), "external-fork");
});

test("commitProvenance: a forged (#N) naming an internal PR does not make a fork commit first-party", async () => {
  const { get } = fakeGet({
    [pullsOf("dddddddddddddddddddddddddddddddddddddddd")]: [pr(13, "someone/skills")],
    [`https://api.github.com/repos/${REPO}/pulls/45`]: pr(45, REPO),
  });
  assert.equal(await commitProvenance(REPO, { sha: "dddddddddddddddddddddddddddddddddddddddd", message: "Tidy docs (#45)" }, get), "external-fork");
});

test("commitProvenance: a commit with no linked PR is a direct push, which needs write access", async () => {
  const { get } = fakeGet({ [pullsOf("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")]: [] });
  assert.equal(await commitProvenance(REPO, { sha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", message: "Release notes" }, get), "anthropic-write-access");
});

test("commitProvenance: any linked PR from elsewhere, or from a deleted fork, makes it external", async () => {
  const both = fakeGet({ [pullsOf("ffffffffffffffffffffffffffffffffffffffff")]: [pr(14, REPO), pr(15, "someone/skills")] });
  assert.equal(await commitProvenance(REPO, { sha: "ffffffffffffffffffffffffffffffffffffffff", message: "x" }, both.get), "external-fork");
  const gone = fakeGet({ [pullsOf("1111111111111111111111111111111111111111")]: [pr(16, null)] });
  assert.equal(await commitProvenance(REPO, { sha: "1111111111111111111111111111111111111111", message: "x" }, gone.get), "external-fork");
});

test("commitProvenance: a sha that is not a full hex id is refused before any request", async () => {
  const { get, calls } = fakeGet({});
  await assert.rejects(commitProvenance(REPO, { sha: "abc/../../x", message: "x" }, get), /full hex id/);
  assert.deepEqual(calls, []);
});

test("commitProvenance: a failed lookup fails loudly (the source is reported, never a quiet guess)", async () => {
  const { get } = fakeGet({});
  await assert.rejects(commitProvenance(REPO, { sha: "2222222222222222222222222222222222222222", message: "x (#9)" }, get), /HTTP 404/);
});
