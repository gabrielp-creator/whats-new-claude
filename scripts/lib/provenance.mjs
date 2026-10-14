// Who published a fetched item: first-party Anthropic or not. Third-party plugins and fork commits are
// FYI only (never "install" or "try"), so these rules decide what an item may ask the user to do.
// Tested in tests/provenance.test.mjs.

// A marketplace entry's source (a string, or an object with url or repo). Anthropic-published: the
// marketplace's own ./plugins folder, or a repo of the anthropics organisation on github.com. The
// marketplace keeps outside plugins in other folders (./external_plugins), so "./" alone proves
// nothing (B-67).
export function pluginProvenance(source) {
  const src = String((typeof source === "string" ? source : source?.url || source?.repo) || "");
  if (src.startsWith("./")) {
    const parts = src.slice(2).split(/[\\/]/);
    return parts[0] === "plugins" && !parts.includes("..") ? "anthropic-published" : "third-party";
  }
  if (/^anthropics\/[\w.-]+$/.test(src)) return "anthropic-published";
  try {
    const u = new URL(src);
    if (u.protocol === "https:" && u.host === "github.com" && u.pathname.split("/")[1] === "anthropics") return "anthropic-published";
  } catch {}
  return "third-party";
}

// A commit is first-party when every PR GitHub links to it has its head branch in the anthropics repo
// itself (pushed by someone with write access); none linked means a direct push, which also needs
// write access. The commit message is not used: a "(#N)" in it is text the author wrote, and a
// rebase-merged fork commit carries none (B-67). get: lib/net.mjs get. A failed lookup throws, so the
// source fails loudly instead of guessing.
export async function commitProvenance(repo, { sha }, get) {
  if (!/^[0-9a-f]{40}$/.test(String(sha))) throw new Error("commit sha is not a full hex id");
  const prs = await get(`https://api.github.com/repos/${repo}/commits/${sha}/pulls`, { json: true });
  if (!Array.isArray(prs)) throw new Error("unexpected answer for a commit's pull requests");
  return prs.every((p) => p?.head?.repo?.full_name === repo) ? "anthropic-write-access" : "external-fork";
}
