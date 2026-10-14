// The CLI profile (B-59): what a project's own scripted calls to the claude CLI switch off. A feature
// is "off" only on positive literals (`--tools ""`, `--safe-mode`, `--strict-mcp-config` with no
// `--mcp-config`) in every call found in its code, every call with literal arguments, and only when
// the project's .claude/ does not switch the feature on. Anything else (arguments from a variable, a
// spread, a conditional, a "$@", arguments added later) makes the profile unknown (P-2): absence is
// never evidence. Code only, no per-language parser. Tested in tests/cli.test.mjs.
import { NEAR } from "./use.mjs";

// Flags whose next argument is a value, so a variable there is only a value, never a flag.
const VALUE = new Set(["--model", "--fallback-model", "--system-prompt", "--system-prompt-file", "--append-system-prompt",
  "--append-system-prompt-file", "--output-format", "--input-format", "--max-turns", "--mcp-config", "--allowedTools",
  "--allowed-tools", "--disallowedTools", "--disallowed-tools", "--tools", "--permission-mode", "--settings", "--add-dir",
  "--resume", "-r", "--session-id", "--agents", "--json-schema", "--effort", "--max-budget-usd", "--setting-sources"]);
const EMPTY = new Set(["", '""', "''"]);
// What each positive literal switches off.
const OFF = { "--safe-mode": ["hooks", "skills", "plugins", "mcp"] };

const unquote = (s) => {
  const m = /^(["'])(.*)\1$/s.exec(s) || /^`([^`$]*)`$/s.exec(s);
  return m ? (m.length === 3 ? m[2] : m[1]) : null;
};

// Splits an array literal's body at top-level commas.
function elements(body) {
  const out = [];
  let depth = 0, quote = null, cur = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { cur += c; if (c === "\\") cur += body[++i] ?? ""; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; cur += c; continue; }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// The array literal starting at text[start] ("["), up to its matching "]", or null.
function arrayAt(text, start) {
  let depth = 0, quote = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "[") depth++;
    if (c === "]" && --depth === 0) return text.slice(start + 1, i);
  }
  return null;
}

// Values in order (null where not a literal); literal is false when a non-literal could be a flag.
function check(values, hard = false) {
  let literal = !hard;
  values.forEach((v, i) => { if (v === null && !VALUE.has(values[i - 1])) literal = false; });
  return { literal, args: values };
}

function fromElements(els) {
  const hard = els.some((e) => e.startsWith("...") || /\?/.test(e.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")));
  return check(els.map(unquote), hard);
}

function fromShell(rest) {
  const values = [];
  let hard = false;
  for (const m of rest.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)) {
    if (m[3] === "\\") continue; // a line continuation
    if (m[2] !== undefined) values.push(m[2]);
    else if (m[1] !== undefined) values.push(m[1].includes("$") ? null : m[1]);
    // Unquoted, the shell splits an expansion into words, so even a value flag's value can add flags.
    else if (/[$`{}]/.test(m[3])) { values.push(null); hard = true; }
    else values.push(m[3]);
  }
  return check(values, hard);
}

// Where the string literal holding text[at] opens, or -1 when text[at] is outside every string.
function stringAround(text, at) {
  let q = null, start = -1;
  for (let i = 0; i < at; i++) {
    const c = text[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; start = i; }
  }
  return q ? start : -1;
}

// A call inside a string literal (JS, Python): only that string's text, or null when more text is
// joined to it (+, .format, %, an f-string's {}, a string continued on the next line, R-1).
function inString(lines, line, at, quoteAt) {
  const q = at[quoteAt];
  let end = -1;
  for (let i = quoteAt + 1; i < at.length; i++) {
    if (at[i] === "\\") { i++; continue; }
    if (at[i] === q) { end = i; break; }
  }
  if (end < 0) return null;
  const body = at.slice(quoteAt + 1, end), tail = at.slice(end + 1);
  if (!/^\s*(?:[),;\]}]|$)/.test(tail)) return null;
  if (!tail.trim() && /^(?:[+.%]|[rRbBuUfF]{0,2}["'`])/.test((lines[line] || "").trim())) return null;
  if (/(?:^|[^\w])(?:[fF][rRbB]?|[rRbB][fF])$/.test(at.slice(0, quoteAt)) && body.includes("{")) return null;
  return body;
}

// The arguments of the claude call on 1-based line `line` of file {file, text}.
export function callArgs({ text }, line) {
  const lines = String(text).split(/\r?\n/);
  const at = lines[line - 1] || "";
  const unknown = { literal: false, args: [] };
  // A list whose first element is "claude" (Python, execa-style arrays).
  const list = /\[\s*["']claude(?:\.exe|\.cmd)?["']\s*,?/.exec(at);
  if (list) {
    const body = arrayAt(at, list.index);
    return body === null ? unknown : fromElements(elements(body).slice(1));
  }
  // A call with the claude name quoted first: an inline array, or a name defined just above.
  const quoted = /["'`]claude(?:\.exe|\.cmd)?["'`]\s*,\s*(\[|[A-Za-z_$][\w$]*)/.exec(at);
  if (quoted) {
    if (quoted[1] === "[") {
      const body = arrayAt(at, quoted.index + quoted[0].length - 1);
      return body === null ? unknown : fromElements(elements(body));
    }
    const name = quoted[1];
    const all = lines.join("\n");
    for (let i = line - 1; i >= Math.max(0, line - 1 - NEAR); i--) {
      const def = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*\\[`).exec(lines[i]);
      if (!def) continue;
      const defStart = lines.slice(0, i).join("\n").length + (i ? 1 : 0) + def.index;
      const from = defStart + def[0].length - 1;
      const body = arrayAt(all, from);
      if (body === null) return unknown;
      // Arguments added or replaced anywhere else in the file are not literal.
      const rest = all.slice(0, defStart) + all.slice(from + body.length + 2);
      if (new RegExp(`\\b${name}\\s*(?:\\.\\s*(?:push|unshift|splice|concat)\\s*\\(|=(?![=>]))`).test(rest)) return unknown;
      return fromElements(elements(body));
    }
    return unknown; // arguments from a parameter or built elsewhere
  }
  // A shell call: "claude -p ...", with continuation lines, or inside a template string.
  const sh = /(^|[\s;&|("'`])claude(?:\.exe|\.cmd)?(?=\s+-)/.exec(at);
  if (!sh) return unknown;
  const name = sh.index + sh[1].length, open = stringAround(at, name);
  if (open >= 0) {
    const body = inString(lines, line, at, open);
    return body === null ? unknown : fromShell(body.slice(name + sh[0].length - sh[1].length - open - 1));
  }
  let rest = at.slice(sh.index + sh[0].length);
  for (let i = line; /\s\\$/.test(lines[i - 1] || "") && i < lines.length; i++) rest += ` ${lines[i]}`;
  return fromShell(rest);
}

// files: the walk's files; calls: useIndex's claudeCalls ({file, line}); profile: lib/profile.mjs.
// off: {feature: ["file:line" of every call]}.
export function cliProfile(files, calls, profile) {
  if (!calls.length) return { status: "none", calls: [], off: {} };
  const byFile = new Map(files.map((f) => [f.file, f]));
  const where = calls.map((c) => `${c.file}:${c.line}`);
  let offs = null;
  for (const c of calls) {
    const f = byFile.get(c.file);
    const a = f ? callArgs(f, c.line) : { literal: false, args: [] };
    if (!a.literal) return { status: "unknown", calls: where, off: {} };
    const these = new Set();
    const ti = a.args.indexOf("--tools");
    if (ti >= 0 && EMPTY.has(a.args[ti + 1])) these.add("tools");
    if (a.args.includes("--strict-mcp-config") && !a.args.includes("--mcp-config")) these.add("mcp");
    for (const [flag, features] of Object.entries(OFF)) if (a.args.includes(flag)) features.forEach((x) => these.add(x));
    offs = offs ? new Set([...offs].filter((x) => these.has(x))) : these;
  }
  const on = {
    hooks: (profile?.hooks || []).length > 0,
    skills: files.some((f) => f.file.startsWith(".claude/skills/")),
    plugins: (profile?.plugins || 0) > 0,
    mcp: Boolean(profile?.mcpJson),
  };
  const off = {};
  for (const x of offs) if (!on[x]) off[x] = where;
  return { status: "known", calls: where, off };
}
