// The settings profile (B-51): what a project's Claude Code settings switch on, made by code from a
// closed schema. Hooks are kept as {event, type, source, file}, permission rules as tool kinds, plus
// defaultMode, sandbox, inline shell in skills and commands, and Anthropic packages. Never command
// text, rule text, prompts, env values or MCP and plugin names: settings.local.json is parsed here, in
// process, and nothing else from it is kept. Item text is matched against the profile through a closed
// list of conditions (profileTerms). Tested in tests/profile.test.mjs.
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute, sep, basename } from "node:path";
import { homedir } from "node:os";

const HOOK_TYPES = new Set(["command", "prompt", "agent", "http"]);
const EVENTS = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "UserPromptSubmit", "Notification", "Stop", "SubagentStop", "SubagentStart", "SessionStart", "SessionEnd", "PreCompact", "PermissionRequest"];
const TOOLS = new Set(["Bash", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "Glob", "Grep", "Task", "Agent", "Skill", "TodoWrite", "LS"]);
const MODES = new Set(["default", "acceptEdits", "plan", "bypassPermissions", "auto", "dontAsk"]);
const LISTS = ["allow", "deny", "ask"];

// A rule's tool kind: a Claude Code tool name (one capitalized word), "mcp", or "other".
const ruleKind = (rule) => {
  if (/^mcp__/.test(rule)) return "mcp"; // MCP tool names are third-party text (P-7)
  const m = /^([A-Z][A-Za-z]{1,30})(\(|$)/.exec(rule);
  return m ? m[1] : "other";
};

// A hook's file: the first path-shaped word of its command that exists in the tree, else "inline".
// exists(candidate) returns true, a normalized relative path, or false.
function hookFile(command, exists) {
  for (const word of String(command).split(/\s+/)) {
    const c = word.replace(/^["']+|["']+$/g, "").replace(/\\/g, "/").replace(/^\$\{?CLAUDE_PROJECT_DIR\}?\//, "").replace(/^\.\//, "");
    if (!/\.(m?js|cjs|ts|py|sh|ps1|bat|cmd)$/i.test(c)) continue;
    const hit = exists(c);
    if (hit === true) return c;
    if (typeof hit === "string") return hit;
  }
  return "inline";
}

const empty = () => ({ hooks: [], rules: [], defaultMode: null, sandbox: null, plugins: [] });

// One settings file (or a plugin's hooks.json, source "plugin"), parsed to the closed schema.
export function parseSettings(text, source, { exists = () => false } = {}) {
  let s;
  try { s = JSON.parse(text); } catch { return { ok: false, ...empty() }; }
  if (!s || typeof s !== "object" || Array.isArray(s)) return { ok: false, ...empty() };
  const out = { ok: true, ...empty() };
  for (const [event, matchers] of Object.entries(s.hooks && typeof s.hooks === "object" ? s.hooks : {})) {
    for (const m of Array.isArray(matchers) ? matchers : []) {
      for (const h of Array.isArray(m?.hooks) ? m.hooks : []) {
        const type = HOOK_TYPES.has(h?.type) ? h.type : "other";
        const file = source !== "plugin" && type === "command" ? hookFile(h.command || "", exists) : "inline";
        out.hooks.push({ event: EVENTS.includes(event) ? event : "other", type, source, file });
      }
    }
  }
  const perms = s.permissions && typeof s.permissions === "object" ? s.permissions : {};
  const seen = new Set();
  for (const list of LISTS) {
    for (const rule of Array.isArray(perms[list]) ? perms[list] : []) {
      const kind = ruleKind(String(rule));
      if (seen.has(`${list}:${kind}`)) continue;
      seen.add(`${list}:${kind}`);
      out.rules.push({ list, kind, source });
    }
  }
  if (typeof perms.defaultMode === "string") out.defaultMode = { value: MODES.has(perms.defaultMode) ? perms.defaultMode : "other", source };
  if (s.sandbox && typeof s.sandbox.enabled === "boolean") out.sandbox = { enabled: s.sandbox.enabled, source };
  if (s.enabledPlugins && typeof s.enabledPlugins === "object") out.plugins = Object.keys(s.enabledPlugins).filter((k) => s.enabledPlugins[k] === true);
  return out;
}

const readText = (p) => { try { return statSync(p).isFile() ? readFileSync(p, "utf8") : null; } catch { return null; } };
const INLINE_SHELL = /(^|\s)!`[^`\n]+`/m;
const COMMAND_FILE = /(^|\/)\.claude\/(commands|skills)\/.+\.md$/i;
const PY_PACKAGE = /^\s*["']?(anthropic|claude-agent-sdk|claude_agent_sdk)\b/gm;

// root: the project folder, or ~/.claude itself for setup (claudeRoot). files: the walk's files
// (for inline shell and packages). Plugin hooks come from enabled plugins' hooks/hooks.json.
export function buildProfile(root, files, { home = homedir(), claudeRoot = false } = {}) {
  const exists = (c) => {
    const abs = c.startsWith("~/") ? join(home, c.slice(2)) : isAbsolute(c) ? c : join(root, c);
    const rel = relative(root, abs);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return false;
    try { return statSync(abs).isFile() ? rel.split(sep).join("/") : false; } catch { return false; }
  };
  const p = { sources: [], hooks: [], rules: [], defaultMode: null, sandbox: null, inlineShell: [], packages: [] };
  const plugins = new Set();
  const take = (parsed) => {
    p.hooks.push(...parsed.hooks);
    for (const r of parsed.rules) if (!p.rules.some((x) => x.list === r.list && x.kind === r.kind)) p.rules.push(r);
    if (parsed.defaultMode) p.defaultMode = parsed.defaultMode; // settings.local.json, read last, wins
    if (parsed.sandbox) p.sandbox = parsed.sandbox;
    parsed.plugins.forEach((n) => plugins.add(n));
  };
  for (const file of claudeRoot ? ["settings.json", "settings.local.json"] : [".claude/settings.json", ".claude/settings.local.json"]) {
    const text = readText(join(root, file));
    if (text === null) continue;
    const parsed = parseSettings(text, file, { exists });
    p.sources.push({ file, ok: parsed.ok });
    take(parsed);
  }
  const pluginDir = resolve(home, ".claude", "plugins");
  let installed = {};
  try { installed = JSON.parse(readFileSync(join(pluginDir, "installed_plugins.json"), "utf8")).plugins || {}; } catch {}
  for (const name of plugins) {
    const at = Array.isArray(installed[name]) ? installed[name][0]?.installPath : null;
    const rel = typeof at === "string" ? relative(pluginDir, resolve(at)) : "..";
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue; // only Claude Code's own plugin folder
    const text = readText(join(at, "hooks", "hooks.json"));
    if (text !== null) take({ ...parseSettings(text, "plugin"), rules: [], defaultMode: null, sandbox: null, plugins: [] });
  }
  p.plugins = plugins.size; // a count only: plugin names are third-party text
  p.mcpJson = !claudeRoot && existsSync(join(root, ".mcp.json")); // existence only, never opened
  for (const f of files) {
    const path = claudeRoot ? `.claude/${f.file}` : f.file;
    if (COMMAND_FILE.test(path) && INLINE_SHELL.test(f.text)) p.inlineShell.push(f.file);
    const add = (name) => { if (!p.packages.some((x) => x.name === name)) p.packages.push({ name, file: f.file }); };
    const base = basename(f.file);
    if (base === "package.json") {
      try {
        const j = JSON.parse(f.text);
        for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) for (const n of Object.keys(j?.[k] || {})) if (/^@anthropic-ai\/[a-z0-9-]+$/.test(n)) add(n);
      } catch {}
    } else if (base === "pyproject.toml" || /^requirements[\w.-]*\.txt$/.test(base)) {
      for (const m of f.text.matchAll(PY_PACKAGE)) add(m[1]);
    }
  }
  return p;
}

// Conditions an item's text names, from a closed list: hook types and events, permission rule tools
// and lists, the sandbox, inline shell, and permission modes. Each is answered by the profile.
// Hook types joined by commas, "and" or "or", the last one right before "hook(s)": "`prompt` and
// `agent` hooks", "command and HTTP hooks", not "a shell command or hook".
const TYPE = "`?(?:command|prompt|agent|http)`?";
const TYPE_LIST = new RegExp(`(?<![\\w.\`])((?:${TYPE}(?:\\s*,\\s*|\\s+(?:and|or)\\s+))*${TYPE})\\s+hooks?\\b`, "gi");
// A tool is a built-in name, or any capitalized name in backticks ("an `Artifact` allow rule").
const KNOWN = [...TOOLS].join("|");
const RULE_LIST = new RegExp(`(?<![\\w(])(?:(?:\`([A-Z][A-Za-z]+)\`|(${KNOWN}))\\s+)?((?:allow|deny|ask)(?:\\s*(?:,|\\/|or|and)\\s*(?:allow|deny|ask))*)\\s+rules?\\b`, "g");
const TOOL_RULE = new RegExp(`\`([A-Z][A-Za-z]+)\\([^)\`]*\\)\`|(?<![\\w\`])(${KNOWN})\\([^)\`]*\\)`, "g");
const MODE_WORDS = [[/\bauto mode\b/i, "auto"], [/\bplan mode\b/i, "plan"], [/\bacceptEdits\b|\baccept[- ]edits mode\b/i, "acceptEdits"], [/\bbypassPermissions\b|\bbypass[- ]permissions mode\b/i, "bypassPermissions"]];
const uniq = (a) => [...new Set(a)];

export function profileTerms(text) {
  const t = String(text || "");
  const out = [];
  if (/\bhooks?\b/i.test(t)) {
    const types = uniq([...t.matchAll(TYPE_LIST)].flatMap((m) => [...m[1].matchAll(/command|prompt|agent|http/gi)].map((x) => x[0].toLowerCase())));
    const events = EVENTS.map((e) => [e, t.search(new RegExp(`\\b${e}\\b`))]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([e]) => e);
    if (types.length || events.length) {
      const label = `${types.length ? `${types.map((x) => `\`${x}\``).join("/")} hooks` : "hooks"}${events.length ? ` on ${events.join("/")}` : ""}`;
      out.push({ field: "hooks", types, events, label });
    }
  }
  if (/\brules?\b/.test(t)) {
    const kinds = [], lists = [];
    for (const m of t.matchAll(RULE_LIST)) { if (m[1] || m[2]) kinds.push(m[1] || m[2]); lists.push(...m[3].match(/allow|deny|ask/g)); }
    for (const m of t.matchAll(TOOL_RULE)) kinds.push(m[1] || m[2]);
    if (kinds.length || lists.length) {
      const k = uniq(kinds), l = uniq(lists);
      out.push({ field: "rules", kinds: k, lists: l, label: [k.join("/"), l.join("/"), "rules"].filter(Boolean).join(" ") });
    }
  }
  if (/\bsandbox(ed|ing)?\b/i.test(t)) out.push({ field: "sandbox", label: "sandbox" });
  if (/\binline\s+`?!`?/i.test(t)) out.push({ field: "inlineShell", label: "inline `!` shell in skills or commands" });
  const modes = MODE_WORDS.filter(([re]) => re.test(t)).map(([, m]) => m);
  if (modes.length) out.push({ field: "defaultMode", modes, label: modes.map((m) => (m === "auto" || m === "plan" ? `${m} mode` : m)).join("/") });
  return out;
}

// Answers the conditions from one project's profile. All must hold for a confirmation (the item
// applies only where every setting it names is in play). A condition the profile can see and does not
// find makes the item "not found"; one it cannot see (no settings file, a file that did not parse, or a
// mode that can be switched in a session) leaves the item unknown: absence is not evidence (P-1 to P-3).
export function profileLookup(conds, profile) {
  if (!conds.length || !profile) return { found: [], checked: [] };
  const settingsKnown = profile.sources.length > 0 && profile.sources.every((s) => s.ok);
  const found = [];
  let absent = false, unknown = false;
  for (const c of conds) {
    let hits = [];
    if (c.field === "hooks") {
      hits = profile.hooks.filter((h) => (!c.types.length || c.types.includes(h.type)) && (!c.events.length || c.events.includes(h.event)))
        .map((h) => ({ term: `\`${h.type}\` hook on ${h.event}`, file: h.source }));
    } else if (c.field === "rules") {
      hits = profile.rules.filter((r) => (!c.kinds.length || c.kinds.includes(r.kind)) && (!c.lists.length || c.lists.includes(r.list)))
        .map((r) => ({ term: `${r.kind} in ${r.list} rules`, file: r.source }));
    } else if (c.field === "sandbox") {
      if (profile.sandbox?.enabled === true) hits = [{ term: "sandbox enabled", file: profile.sandbox.source }];
    } else if (c.field === "defaultMode") {
      if (c.modes.includes(profile.defaultMode?.value)) hits = [{ term: `defaultMode ${profile.defaultMode.value}`, file: profile.defaultMode.source }];
    } else if (c.field === "inlineShell") {
      hits = profile.inlineShell.slice(0, 1).map((file) => ({ term: "inline `!` shell", file }));
    }
    const terms = new Set();
    hits = hits.filter((h) => !terms.has(h.term) && terms.add(h.term)).slice(0, 3);
    if (hits.length) { found.push(...hits); continue; }
    const visible = c.field === "inlineShell" || (c.field !== "defaultMode" && settingsKnown);
    if (visible) absent = true; else unknown = true;
  }
  const checked = conds.map((c) => c.label);
  if (absent) return { found: [], checked };
  if (unknown) return { found: [], checked: [] };
  return { found, checked };
}
