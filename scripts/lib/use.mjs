// Used or mentioned (B-47): a name counts as used by a project only where the project runs it, in a
// closed list of config files and in code; docs, data records, tests, fixtures and full-line comments
// only mention it. Mentions reach the rater as context and never confirm an item. Code only, no
// per-language parsing. Tested in tests/use.test.mjs.
import { tokenIndex } from "./probe.mjs";
import { modelUse } from "./models.mjs";

const CODE = /\.(js|mjs|cjs|ts|tsx|jsx|py|sh|ps1)$/i;
const CONFIG = /(^|\/)(package\.json|settings(\.[\w-]+)?\.json)$|\.toml$|(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i;
// Agent, command, lens and skill files: only the model: line of their front matter is config.
const FRONT_MATTER = /(^|\/)\.claude\/(agents|commands|lenses|skills)\/.+\.md$/i;
// Tests, fixtures, proofs, smoke checks and logs assert or record names; they do not run them.
const NOT_OWN = /(^|\/)(tests?|__tests__|specs?|e2e|fixtures?|__fixtures__|__mocks__|testdata|proofs?|logs?)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$|_test\.py$|(^|\/|[._-])(proof|smoke)([._-][^/]*)?\.[a-z]+$/i;
// A line whose first characters open a comment (DECIDED (unratified), Claude, P-31). "--" counts only
// before a space, so a shell continuation line such as "  --model sonnet \" stays code.
const COMMENT = /^\s*(\/\/|#|\*|\/\*|--(\s|$)|<!--)/;

// file: the path relative to the project root, with forward slashes.
export function fileUse(file) {
  if (NOT_OWN.test(file)) return "mentioned";
  if (FRONT_MATTER.test(file)) return "frontmatter";
  return CONFIG.test(file) || CODE.test(file) ? "used" : "mentioned";
}

// Splits a file into used and mentioned lines: [{line, text}], line numbers from 1.
export function splitUse(file, text) {
  const lines = String(text).split(/\r?\n/).map((t, i) => ({ line: i + 1, text: t }));
  const kind = fileUse(file);
  if (kind === "mentioned") return { used: [], mentioned: lines };
  if (kind === "frontmatter") {
    const end = lines[0]?.text.trim() === "---" ? lines.findIndex((l, i) => i > 0 && l.text.trim() === "---") : -1;
    const used = end > 0 ? lines.slice(1, end).filter((l) => /^model\s*:/.test(l.text)) : [];
    return { used, mentioned: lines.filter((l) => !used.includes(l)) };
  }
  return { used: lines.filter((l) => !COMMENT.test(l.text)), mentioned: lines.filter((l) => COMMENT.test(l.text)) };
}

// files: walk.mjs output. claudeRoot: the files are relative to a .claude folder (the setup project).
// Returns token indexes of used and mentioned text, and the project's models (models.mjs modelUse).
export function useIndex(files, { claudeRoot = false } = {}) {
  const split = files.map((f) => ({ file: f.file, ...splitUse(claudeRoot ? `.claude/${f.file}` : f.file, f.text) }));
  const text = (key) => split.map((s) => ({ file: s.file, text: s[key].map((l) => l.text).join("\n") }));
  return { used: tokenIndex(text("used")), mentioned: tokenIndex(text("mentioned")), models: modelUse(split) };
}

// The item's terms found in used text, and those found only in mentions.
export function lookup(terms, ix) {
  const found = [], mentioned = [];
  for (const t of terms) {
    if (ix.used.has(t)) found.push({ term: t, file: ix.used.get(t) });
    else if (ix.mentioned.has(t)) mentioned.push({ term: t, file: ix.mentioned.get(t) });
  }
  return { found, mentioned };
}
