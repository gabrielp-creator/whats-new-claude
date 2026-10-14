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
// A line whose first characters open a comment; a trailing comment on a code line stays code. "--" counts only
// before a space, so a shell continuation line such as "  --model sonnet \" stays code.
const COMMENT = /^\s*(\/\/|#|\*|\/\*|--(\s|$)|<!--)/;

// file: the path relative to the project root, with forward slashes.
export function fileUse(file) {
  if (NOT_OWN.test(file)) return "mentioned";
  if (FRONT_MATTER.test(file)) return "frontmatter";
  return CONFIG.test(file) || CODE.test(file) ? "used" : "mentioned";
}

const lines = (text) => String(text).split(/\r?\n/).map((t, i) => ({ line: i + 1, text: t }));

// Splits a file into used and mentioned lines: [{line, text}], line numbers from 1.
export function splitUse(file, text) {
  const all = lines(text);
  const kind = fileUse(file);
  if (kind === "mentioned") return { used: [], mentioned: all };
  if (kind === "frontmatter") {
    const end = all[0]?.text.trim() === "---" ? all.findIndex((l, i) => i > 0 && l.text.trim() === "---") : -1;
    const used = end > 0 ? all.slice(1, end).filter((l) => /^model\s*:/.test(l.text)) : [];
    return { used, mentioned: all.filter((l) => !used.includes(l)) };
  }
  return { used: all.filter((l) => !COMMENT.test(l.text)), mentioned: all.filter((l) => COMMENT.test(l.text)) };
}

// A call to the claude CLI (B-61): a shell word before a flag ("claude -p ..."), a command setting
// (cmd: "claude"), or "claude" quoted on a line that starts a process. A quoted "claude" alone is
// usually a value (a provider id, a runtime name), not a call. Not ".claude", "claude-watch", "Claude".
const SHELL_CALL = /(?:^|[\s;&|("'`])claude(?:\.exe|\.cmd)?\s+-/;
const COMMAND_KEY = /\b(?:cmd|command|bin|binary|executable)["'`]?\s*[:=]\s*["'`]claude(?:\.exe|\.cmd)?["'`]/;
const QUOTED = /["'`]claude(?:\.exe|\.cmd)?["'`]/;
const SPAWN = /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|execa|execaSync|fork|Popen|run|call|check_call|check_output)\s*\(/;
const isCall = (t) => SHELL_CALL.test(t) || COMMAND_KEY.test(t) || (QUOTED.test(t) && SPAWN.test(t));
const FLAG = /(?<![\w-])--[A-Za-z][\w-]*/g;
// Short flags of the claude CLI that release notes name by their long form.
const SHORT = { "-p": "--print", "-c": "--continue", "-r": "--resume" };
const SHORT_FLAG = /(?<![\w-])-[pcr](?![\w-])/g;
// A long flag counts as a claude flag within this many lines of a call (DECIDED (unratified), Claude,
// P-26): an argument list is usually built a few lines from the spawn.
export const NEAR = 10;

// files: walk.mjs output. claudeRoot: the files are relative to a .claude folder (the setup project).
// archives: files that store release text (archive.mjs, B-62); every line of them is a mention.
// Returns token indexes of used and mentioned text (code files first, so "found in" names code before
// config), the long flags near a claude call, the calls ({file, line}), and the project's models.
export function useIndex(files, { claudeRoot = false, archives = new Set() } = {}) {
  const split = files.map((f) => {
    if (archives.has(f.file)) return { file: f.file, used: [], mentioned: lines(f.text) };
    return { file: f.file, ...splitUse(claudeRoot ? `.claude/${f.file}` : f.file, f.text) };
  });
  const codeFirst = [...split].sort((a, b) => CODE.test(b.file) - CODE.test(a.file));
  const text = (from, key) => from.map((s) => ({ file: s.file, text: s[key].map((l) => l.text).join("\n") }));
  const claudeCalls = split.flatMap((s) => s.used.filter((l) => isCall(l.text)).map((l) => ({ file: s.file, line: l.line })));
  const flags = new Map();
  for (const s of codeFirst) {
    const calls = claudeCalls.filter((c) => c.file === s.file).map((c) => c.line);
    for (const l of s.used) {
      if (!calls.some((c) => Math.abs(c - l.line) <= NEAR)) continue;
      const found = [...l.text.matchAll(FLAG)].map((m) => m[0]).concat([...l.text.matchAll(SHORT_FLAG)].map((m) => SHORT[m[0]]));
      for (const f of found) if (!flags.has(f)) flags.set(f, s.file);
    }
  }
  return { used: tokenIndex(text(codeFirst, "used")), mentioned: tokenIndex(text(split, "mentioned")), flags, claudeCalls, models: modelUse(split) };
}

// The item's terms found in used text, and those found only in mentions. A flag is found only near a
// claude call (B-61, P-26).
export function lookup(terms, ix) {
  const found = [], mentioned = [];
  for (const t of terms) {
    const hit = t.startsWith("-") ? ix.flags : ix.used;
    if (hit.has(t)) found.push({ term: t, file: hit.get(t) });
    else if (ix.mentioned.has(t)) mentioned.push({ term: t, file: ix.mentioned.get(t) });
  }
  return { found, mentioned };
}
