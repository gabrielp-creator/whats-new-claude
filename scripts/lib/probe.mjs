// "Check before flagging", done by code, not by a model with tools: pull concrete names (settings
// keys, model ids, packages, environment variables, tool and hook names) out of a release item and
// look them up in a project's own files. A match confirms the item; no match is only a note.
// Tested in tests/probe.test.mjs.
import { labelFor } from "./merge.mjs";
import { scopeVerdict } from "./rate.mjs";

const STOP = new Set(["true", "false", "null", "undefined", "README", "CHANGELOG"]);
// Names too common to prove anything: generic config files, and slash commands, which release notes
// mention in passing ("after /clear") far more often than they are about them.
const GENERIC = /^(\/.*|settings(\.local)?\.json|CLAUDE\.md|AGENTS\.md|package(-lock)?\.json|README\.md|\.mcp\.json|tsconfig\.json)$/;
const CODE = /`([^`\s]{4,80})`/g;                                    // inline code
const MODEL = /\b(claude-(?:opus|sonnet|haiku|fable|mythos)(?:-[0-9a-z.]+)+)/gi;
const NPM = /(@anthropic-ai\/[a-z0-9-]+)/g;
const SDK = /\b(claude-agent-sdk|claude_agent_sdk)\b/g;
const ENV = /\b([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)\b/g;
const CAMEL = /\b([a-z]+(?:[A-Z][a-z0-9]+)+)\b/g;                   // camelCase settings keys
const PASCAL = /\b((?:WebFetch|WebSearch|PreToolUse|PostToolUse|UserPromptSubmit|SessionStart|SessionEnd|SubagentStop|PreCompact))\b/g; // tool and hook names

export function extractTerms(text) {
  const out = [];
  for (const re of [CODE, MODEL, NPM, SDK, ENV, CAMEL, PASCAL]) for (const m of String(text || "").matchAll(re)) {
    const t = m[1].replace(/[.,;:]+$/, "");
    if (t.length < 4 || STOP.has(t) || GENERIC.test(t) || /^\d/.test(t) || /^[a-z]+:\/\/$/i.test(t)) continue; // "http://" is not a name
    if (re === CODE && !/[-_./:@\d]|[a-z][A-Z]/.test(t)) continue; // a plain word in code formatting is not a name
    if (re === CAMEL && t.length < 8) continue; // short camelCase words are noise
    if (re === ENV && t.length < 6) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

// Map each identifier-like token in the files to the first file it appears in. Case-sensitive. A long
// flag is also kept with its dashes, the form extractTerms gives (B-61).
export function tokenIndex(files) {
  const idx = new Map();
  const add = (t, file) => { if (t && !idx.has(t)) idx.set(t, file); };
  for (const { file, text } of files) {
    for (const raw of String(text).match(/[@\w./:-]+/g) || []) {
      add(raw.replace(/^[.:,;-]+|[.:,;-]+$/g, ""), file);
      if (/^--[A-Za-z]/.test(raw)) add(raw.replace(/[.:,;-]+$/, ""), file);
    }
  }
  return idx;
}

// evs: [{project, checked: [terms], found: [{term, file}], mentioned: [{term, file}]}] for one item.
// found: in config or code; mentioned: only in docs, data or comments (use.mjs, B-47). A confirmed
// item sorts first within its tier (+2 never crosses a tier boundary: see the bases in merge.mjs). Not
// found is only a note: commands people type never appear in files, and absence of evidence is
// unknown, not none. A mention is context, neither a confirmation nor a "not found".
// models: verify.mjs models.json. A hit in a project the item's model scope rules out is context, not
// a confirmation, and one resting only on camelCase keys in settings files adds no +2 (B-50, SU 1):
// `effortLevel` anywhere in settings.json says nothing about which model it is set for.
const SETTINGS_FILE = /(?:^|[/\\])settings(?:\.local)?\.json$/i;
const genericKey = (f) => /^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(f.term) && SETTINGS_FILE.test(f.file);
export function applyEvidence(row, evs, models) {
  const found = evs.filter((e) => e.found.length && !scopeVerdict(row, models?.[e.project], e.found));
  if (found.length) {
    const urgency = row.urgency + (found.some((e) => e.found.some((f) => !genericKey(f))) ? 2 : 0);
    return { ...row, evidence: "confirmed", confirmedIn: found.map((e) => e.project), urgency, urgencyLabel: labelFor(urgency) };
  }
  if (evs.some((e) => e.mentioned?.length)) return { ...row, evidence: "mentioned", confirmedIn: [] };
  const checked = new Set(evs.filter((e) => e.checked.length).map((e) => e.project));
  const all = row.projects.length > 0 && row.projects.every((p) => checked.has(p));
  return { ...row, evidence: all ? "not-found" : "unchecked", confirmedIn: [] };
}

// Files the check must never open: environment files, credentials, keys and tool configs that hold
// tokens. Matched on the file name only.
const SECRET = /^\.env|credential|secret|service.?account|^\.mcp\.json$|^settings\.local\.json$|^id_(rsa|dsa|ecdsa|ed25519)|\.(pem|key|p12|pfx)$|^\.(npmrc|netrc|pypirc)$|^token\.json$/i;
export const isSecretFile = (name) => SECRET.test(String(name));
