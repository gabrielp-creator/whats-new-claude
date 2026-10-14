// Which Claude models a release item is about, and which ones each project's own files use. Code only:
// ids are matched by pattern and reduced to family and version, so nothing fetched passes through as
// text. rate.mjs uses this to tell a launch the project already adopted from one it could upgrade to,
// and to cap a change scoped to models the project does not use. Tested in tests/models.test.mjs.

const FAMILIES = "opus|sonnet|haiku|fable|mythos";
// claude-opus-4-8, claude-opus-4-20250514 (an 8-digit date is not a version), anthropic.claude-opus-5-5-v1:0
const ID = new RegExp(`\\bclaude-(${FAMILIES})-(\\d{1,2})(?:-(\\d{1,2}))?(?!\\d)`, "gi");
// claude-3-5-sonnet-20241022, claude-3-opus-20240229
const OLD_ID = /\bclaude-(\d)(?:-(\d))?-(opus|sonnet|haiku)\b/gi;
// "Claude Opus 5.5", "Sonnet 4.5": capitalised, with a version, as release notes write them ("Opus 1M"
// is a context size)
const PROSE = /\b(?:Claude )?(Opus|Sonnet|Haiku|Fable|Mythos) (\d{1,2})(?:\.(\d{1,2}))?(?![.\d]*[\dA-Za-z])/g;

const model = (family, major, minor) => {
  const f = family.toLowerCase(), v = [Number(major), Number(minor || 0)];
  return { family: f, version: v, id: `claude-${f}-${v[0]}${v[1] ? `-${v[1]}` : ""}` };
};
const cmp = (a, b) => a.version[0] - b.version[0] || a.version[1] - b.version[1];
const same = (a, b) => a.family === b.family && cmp(a, b) === 0;

function matches(text, withProse) {
  const s = String(text || ""), out = [];
  for (const m of s.matchAll(ID)) out.push([m.index, model(m[1], m[2], m[3])]);
  for (const m of s.matchAll(OLD_ID)) out.push([m.index, model(m[3], m[1], m[2])]);
  if (withProse) for (const m of s.matchAll(PROSE)) out.push([m.index, model(m[1], m[2], m[3])]);
  return out.sort((a, b) => a[0] - b[0]).map(([, m]) => m);
}
const dedupe = (ms) => ms.filter((m, i) => ms.findIndex((x) => x.id === m.id) === i);

export function parseModel(id) {
  const [m] = matches(id, false);
  return m || null;
}

// The models a release item names, by id or by name, in the order they appear.
export const modelRefs = (text) => dedupe(matches(text, true));

// Aliases pick a model without pinning one (B-39). They are recorded, never resolved: which model an
// alias runs moves with releases, and only the user can say (Gabriel, 2026-10-13, P-14).
const ALIASES = new Set(["sonnet", "opus", "haiku", "fable", "inherit"]);
const LATEST = new RegExp(`\\bclaude-(?:\\d(?:-\\d)?-)?(?:${FAMILIES})(?:-\\d{1,2}){0,2}-latest\\b`, "gi");
const LATEST_ONE = new RegExp(`^claude-(?:\\d(?:-\\d)?-)?(${FAMILIES})(?:-\\d{1,2}){0,2}-latest$`, "i");
// model: sonnet, "model": "opus", MODEL = "haiku", ANTHROPIC_MODEL=fable, model="claude-sonnet-4-latest"
const MODEL_KEY = /(?:^|[^A-Za-z])model["'`]?\s*[:=]\s*["'`]?([\w.:-]+)/gi;
// --model sonnet, --model=opus, "--model", "haiku", "--model", MODEL (a variable: its default is read)
const MODEL_FLAG = /--model["'`]?(?:\s*,\s*|=|\s+)["'`]?([\w$.:-]+)/g;

function aliasOf(value) {
  const s = String(value).toLowerCase();
  if (ALIASES.has(s)) return { alias: s, family: s === "inherit" ? null : s };
  const m = s.match(LATEST_ONE);
  return m ? { alias: s, family: m[1].toLowerCase() } : null;
}

// The alias values assigned to a variable in the same file: MODEL = "sonnet", model="opus".
function defaults(lines, name) {
  const re = new RegExp(`(?:^|[^\\w$.])${name.replace(/\$/g, "\\$")}\\s*[:=]\\s*["'\`]([\\w.:-]+)["'\`]`);
  return lines.flatMap(({ line, text }) => { const a = aliasOf(text.match(re)?.[1] || ""); return a ? [{ a, line }] : []; });
}

// The models a project's files use, from use.mjs's split ([{file, used: [{line, text}], mentioned}]):
// pinned ids and aliases from used lines only, each with the file and line it was first seen at;
// ids seen only in mentions (docs, data, comments) are listed apart and never count as use (B-47).
// models: the pinned ids alone, the shape rate.mjs reads.
export function modelUse(files) {
  const used = [], aliases = [], mentioned = [], seen = new Set(), seenAlias = new Set();
  const ids = (text) => matches(text.replace(LATEST, (s) => " ".repeat(s.length)), false);
  for (const f of files) {
    const here = [];
    const add = (a, line) => { const k = `${a.alias}|${f.file}|${line}`; if (!seenAlias.has(k)) { seenAlias.add(k); here.push({ ...a, file: f.file, line }); } };
    for (const { line, text } of f.used) {
      for (const m of text.matchAll(LATEST)) add(aliasOf(m[0]), line);
      for (const m of text.matchAll(MODEL_KEY)) { const a = aliasOf(m[1]); if (a) add(a, line); }
      for (const m of text.matchAll(MODEL_FLAG)) {
        const a = aliasOf(m[1]);
        if (a) add(a, line);
        else if (/^[A-Za-z_$][\w$]*$/.test(m[1])) for (const d of defaults(f.used, m[1])) add(d.a, d.line);
      }
      for (const m of ids(text)) if (!seen.has(m.id)) { seen.add(m.id); used.push({ id: m.id, file: f.file, line }); }
    }
    aliases.push(...here.sort((a, b) => a.line - b.line));
  }
  for (const f of files) for (const { text } of f.mentioned) for (const m of ids(text)) if (!seen.has(m.id) && !mentioned.includes(m.id)) mentioned.push(m.id);
  return { models: used.map((u) => u.id), used, aliases, mentioned };
}

const parsed = (ids) => dedupe(ids.map(parseModel).filter(Boolean));

// A launch against what a project uses. adopted: it already uses a launched model (older ones of the
// same family still in use are listed); upgrade: it uses an older model of a launched family;
// other-models: only other families; unknown: no model on one side or the other.
export function launchStatus(refs, projectIds) {
  const proj = parsed(projectIds);
  if (!refs.length || !proj.length) return { status: "unknown", uses: [], older: [] };
  const newest = new Map();
  for (const r of refs) if (!newest.has(r.family) || cmp(r, newest.get(r.family)) > 0) newest.set(r.family, r);
  const older = proj.filter((p) => newest.has(p.family) && cmp(p, newest.get(p.family)) < 0).map((p) => p.id);
  const uses = proj.filter((p) => refs.some((r) => same(p, r))).map((p) => p.id);
  if (uses.length) return { status: "adopted", uses, older: older.filter((id) => !uses.includes(id)) };
  if (older.length) return { status: "upgrade", uses: older, older };
  return { status: "other-models", uses: [], older: [] };
}

// A launch is said with a launch verb right before the model's name, in one clause: "We've launched
// Claude X", "Added Claude X", "Introducing Claude X". "Available for X" is not a launch (B-57, P-10).
const LAUNCH = /\b(?:launch(?:ed|es|ing)?|[Aa]dd(?:ed|s|ing)|[Ii]ntroduc(?:ing|es|ed)|[Rr]eleas(?:ed|es|ing))\s+(?:the\s+new\s+|new\s+)?(?:Claude\s+)?(?:Opus|Sonnet|Haiku|Fable|Mythos)\s+\d/;
export const isLaunchText = (text) => LAUNCH.test(String(text || ""));

// The project's models that an item names (same family and version).
export const scopeOverlap = (refs, projectIds) => parsed(projectIds).filter((p) => refs.some((r) => same(p, r))).map((p) => p.id);
