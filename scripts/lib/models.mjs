// Which Claude models a release item is about, and which ones each project's own files use. Code only:
// ids are matched by pattern and reduced to family and version, so nothing fetched passes through as
// text. rate.mjs uses this to tell a launch the project already adopted from one it could upgrade to,
// and to cap a change scoped to models the project does not use. Tested in tests/models.test.mjs.

const FAMILIES = "opus|sonnet|haiku|fable|mythos";
// claude-opus-4-8, claude-opus-4-20250514 (an 8-digit date is not a version), anthropic.claude-opus-5-5-v1:0
const ID = new RegExp(`\\bclaude-(${FAMILIES})-(\\d{1,2})(?:-(\\d{1,2}))?(?!\\d)`, "gi");
// claude-3-5-sonnet-20241022, claude-3-opus-20240229
const OLD_ID = /\bclaude-(\d)(?:-(\d))?-(opus|sonnet|haiku)\b/gi;
// "Claude Opus 5.5", "Sonnet 4.5": capitalised, with a version, as release notes write them
const PROSE = /\b(?:Claude )?(Opus|Sonnet|Haiku|Fable|Mythos) (\d{1,2})(?:\.(\d{1,2}))?(?!\.?\d)/g;

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

// The model ids a project's files use (ids only: prose in a project's docs proves little).
export const inventory = (files) => dedupe(files.flatMap((f) => matches(f.text, false))).map((m) => m.id);

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

// The project's models that an item names (same family and version).
export const scopeOverlap = (refs, projectIds) => parsed(projectIds).filter((p) => refs.some((r) => same(p, r))).map((p) => p.id);
