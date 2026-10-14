// Who published a fetched item: first-party Anthropic or not. Third-party plugins and fork commits are
// FYI only (never "install" or "try"), so these rules decide what an item may ask the user to do.
// Tested in tests/provenance.test.mjs.
import { prNumber } from "./incremental.mjs";

// A marketplace entry's source (a string, or an object with url or repo).
export function pluginProvenance(source) {
  const src = typeof source === "string" ? source : source?.url || source?.repo || "";
  return src.startsWith("./") || /(^|github\.com\/)anthropics\//.test(src) ? "anthropic-published" : "third-party";
}

// A PR whose head branch lives in the anthropics repo was pushed by someone with write access; a PR
// from a fork is external; a direct commit also needs write access. get: lib/net.mjs get.
export async function commitProvenance(repo, { message }, get) {
  const merge = String(message).split("\n")[0].match(/^Merge pull request #(\d+)/);
  const pr = merge ? Number(merge[1]) : prNumber(message); // the last (#N): a title can name another PR earlier
  if (!pr) return "anthropic-write-access";
  const p = await get(`https://api.github.com/repos/${repo}/pulls/${pr}`, { json: true });
  return p.head?.repo?.full_name === repo ? "anthropic-write-access" : "external-fork";
}
