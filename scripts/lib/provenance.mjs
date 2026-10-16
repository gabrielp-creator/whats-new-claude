// Who published a fetched item: first-party Anthropic or not. Third-party plugins and fork commits are
// FYI only (never "install" or "try"), so these rules decide what an item may ask the user to do.
// Tested in tests/provenance.test.mjs.
import { createHash } from "node:crypto";

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

// The marketplace entries added since the last run (before: the names listed then), as items. A
// plugin's name is fetched text and the id is shown outside the quote in a brief (R-14), so only a
// plain short name becomes the id and title; any other gets a stable id from its hash and stays in
// the text, which is quoted.
const PLAIN_NAME = /^[A-Za-z0-9][\w.-]{0,63}$/;
export function pluginItems(plugins, before, { repo, today }) {
  return plugins.filter((p) => !before.has(p.name)).map((p) => {
    const name = String(p.name ?? ""), plain = PLAIN_NAME.test(name), desc = String(p.description || "").slice(0, 400);
    return {
      id: plain ? `plugins:${name}` : `plugins:unnamed-${createHash("sha256").update(name).digest("hex").slice(0, 8)}`,
      source: "plugins", date: today, title: plain ? `New plugin: ${name}` : "New plugin (its name is not a plain name; see the text)",
      text: plain ? desc : `Name: ${name.slice(0, 120)}. ${desc}`.trim(), url: `https://github.com/${repo}`,
      provenance: pluginProvenance(p.source),
    };
  });
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

// A repo's commits since a date as items, newest first, each with its provenance (one lookup per
// commit, B-68). known: the item ids already stored, which are skipped without a lookup (the store
// keeps the first copy anyway). A failure still fails the source, but carries the items resolved
// before it as e.partial, so they are kept and the next run goes on from there.
export async function commitItems(repo, source, since, { get, known = new Set() }) {
  const items = [];
  try {
    for (let page = 1; page <= 5; page++) {
      const commits = await get(`https://api.github.com/repos/${repo}/commits?per_page=100&page=${page}&since=${since.toISOString()}`, { json: true });
      for (const c of commits) {
        const id = `${source}:${c.sha.slice(0, 7)}`;
        if (known.has(id)) continue;
        items.push({
          // when it landed (committer), not the author's own date, which a rebase keeps and anyone can set
          id, source, date: (c.commit.committer?.date || c.commit.author.date).slice(0, 10),
          title: c.commit.message.split("\n")[0].slice(0, 200), text: "", url: c.html_url,
          provenance: await commitProvenance(repo, { sha: c.sha, message: c.commit.message }, get),
        });
      }
      if (commits.length < 100) break;
    }
  } catch (e) {
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), { partial: items });
  }
  return items;
}
