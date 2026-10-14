// Release archives (B-62): a code or config file that holds prose runs from 3 or more distinct
// release items stores release text (a changelog copy, a quoted list) and is not evidence for any of
// them; its lines count as mentions. One copied snippet stays evidence. Shape DECIDED (unratified),
// Claude, 2026-10-13 (P-8). Docs and data are already mentions (use.mjs, B-47), so only used text is
// read. Tested in tests/archive.test.mjs.
import { splitUse } from "./use.mjs";

export const RUN = 8;        // words in a prose run
export const MIN_ITEMS = 3;  // distinct items that make a file an archive
const MAX_SHARE = 2;         // a run held by more items is boilerplate ("available on the Claude API")

// Words, lower case; identifiers (snake_case, kebab-case, dotted, paths) stay one word, so a long
// name never forms a run on its own.
const words = (s) => String(s || "").toLowerCase().match(/[a-z0-9](?:[a-z0-9_./-]*[a-z0-9])?/g) || [];

// items: [{id, title, text}]. Inline code is masked: a run never crosses a backtick span.
export function releaseRuns(items, { run = RUN } = {}) {
  const held = new Map();
  for (const it of items) for (const seg of `${it.title || ""}\n${it.text || ""}`.split(/`[^`]*`/)) {
    const w = words(seg);
    for (let i = 0; i + run <= w.length; i++) {
      const k = w.slice(i, i + run).join(" ");
      if (!held.has(k)) held.set(k, new Set());
      held.get(k).add(it.id);
    }
  }
  for (const [k, ids] of held) if (ids.size > MAX_SHARE) held.delete(k);
  return { run, held };
}

// files: walk.mjs output. Returns [{file, items}] for each archive, the exclusions to log.
export function archiveFiles(files, { run, held }, { claudeRoot = false, min = MIN_ITEMS } = {}) {
  const out = [];
  for (const f of files) {
    const used = splitUse(claudeRoot ? `.claude/${f.file}` : f.file, f.text).used;
    const w = words(used.map((l) => l.text).join("\n")), ids = new Set();
    for (let i = 0; i + run <= w.length; i++) for (const id of held.get(w.slice(i, i + run).join(" ")) || []) ids.add(id);
    if (ids.size >= min) out.push({ file: f.file, items: ids.size });
  }
  return out;
}
