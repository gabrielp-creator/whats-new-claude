// Ties made by code, after the lenses and before the file check (M3, P-25). The impact lens ties an
// item to projects from one description line, so it misses projects that run an affected model; code
// adds them from what their own config and code use (models.json). Code only adds here; nothing a
// fetched text says can tie a project that the predicate does not. Tested in tests/ties.test.mjs.
import { modelRefs, launchStatus } from "./models.mjs";
import { modelScope, inScope } from "./scope.mjs";
import { isLaunch, isTripwire } from "./rate.mjs";

// Sources whose model changes reach a project's own API calls. Claude Code's reach only the projects
// that run Claude Code: setup, and projects whose code scripts `claude`. Skill and cookbook commits
// expose setup and alias users only (B-40); SDK items are tied by package (B-58), not by model.
// Source ids as fetch.mjs writes them (a test checks they exist there).
export const RUNTIME = new Set(["claude-code"]);
export const API = new Set(["platform-release-notes", "anthropic-news"]);

// B-48: [{project, tiedBy: "model", ids}] for projects the item does not already name. A launch ties
// projects that use the launched model or an older one of its family (adopted or upgrade); any other
// item ties projects with a used id inside its scope ("in" only: "unknown" never ties, P-13). A launch
// needs the type lens's "model" and a launch verb in the text (B-57, isLaunch).
export function modelTies(row, models) {
  if (!models || row.fyiOnly || !(API.has(row.source) || RUNTIME.has(row.source))) return [];
  const have = new Set(row.projects || []);
  const launch = isLaunch(row);
  const refs = launch ? modelRefs(`${row.title || ""} ${row.text || ""}`) : null;
  const scope = launch ? null : modelScope(row.text, { title: row.title });
  const out = [];
  for (const [project, inv] of Object.entries(models)) {
    if (have.has(project)) continue;
    if (RUNTIME.has(row.source) && project !== "setup" && !inv.claudeCalls?.length) continue;
    const used = inv.models || [];
    let ids;
    if (launch) { const l = launchStatus(refs, used); ids = l.status === "adopted" || l.status === "upgrade" ? l.uses : []; }
    else ids = used.filter((id) => inScope(scope, id) === "in");
    if (ids.length) out.push({ project, tiedBy: "model", ids });
  }
  return out;
}

// B-58: an SDK's release items concern the projects that depend on that SDK, and only those.
const SDK_PACKAGES = {
  "agent-sdk-ts": { names: ["@anthropic-ai/claude-agent-sdk"], where: "package.json" },
  "agent-sdk-py": { names: ["claude-agent-sdk", "claude_agent_sdk"], where: "pyproject.toml or requirements file" },
};

// profiles: profile.json (packages per project, lib/profile.mjs); partial: projects whose walk hit the
// file cap, so a manifest may be unread. {add: [{project, tiedBy: "sdk", ids}], drop: [{project,
// reason, why}]}: a lens tie to a project whose manifests were all read and hold no such package is
// dropped (the package is what the item changes, B-53); a project without a profile is unknown.
const sdkHas = (sdk, profile) => (profile?.packages || []).filter((p) => sdk.names.includes(p.name)).map((p) => p.name);
// False only when the item is an SDK's and the project's manifests were all read without that package.
const sdkAllows = (row, project, profiles, partial) => {
  const sdk = SDK_PACKAGES[row.source];
  return !sdk || !profiles?.[project] || partial.has(project) || sdkHas(sdk, profiles[project]).length > 0;
};

export function sdkTies(row, profiles, { partial = new Set() } = {}) {
  const sdk = SDK_PACKAGES[row.source];
  if (!sdk || !profiles) return { add: [], drop: [] };
  const has = (project) => sdkHas(sdk, profiles[project]);
  const lens = new Set(row.projects || []);
  const drop = [...lens].filter((p) => profiles[p] && !partial.has(p) && !has(p).length)
    .map((project) => ({ project, reason: "no-sdk-package", why: `no ${sdk.names[0]} in any ${sdk.where} of this project` }));
  const add = row.fyiOnly ? [] : Object.keys(profiles).filter((p) => !lens.has(p) && has(p).length).map((project) => ({ project, tiedBy: "sdk", ids: has(project) }));
  return { add, drop };
}

// B-59: what a Claude Code item is about, from a closed list of the features the CLI profile can
// switch off (lib/cli.mjs). "tools" covers the tools themselves and what runs on them: background
// commands, subagents and agent teams.
const FEATURES = {
  tools: /\b(?:background (?:commands?|tasks?|shells?|Bash)|run_in_background|Bash tool|PowerShell tool|WebFetch|WebSearch|web (?:fetch|search) tool|TodoWrite|Task(?:Create|Get|Update|List)\b|tool search|sub-?agents?|(?:plugin|custom) agents?|agent teams?|join(?:s|ing)? teams?|teammates?)/i,
  mcp: /\bMCP\b/,
  hooks: /\bhooks?\b|\b(?:PreToolUse|PostToolUse|UserPromptSubmit|SessionStart|SessionEnd|SubagentStop|PreCompact)\b/,
  skills: /\bskills?\b/i,
  plugins: /\bplugins?\b/i,
};
export const subjectFeatures = (text) => new Set(Object.keys(FEATURES).filter((f) => FEATURES[f].test(String(text || ""))));
// A feature joined by "and" or "or" with sessions, runs or turns in general ("non-interactive sessions
// and subagents now continue"): the item is about those sessions too, so no feature profile rules it out.
const SESSION = "(?:sessions?|runs?|turns?|calls?|requests?)";
const FEATURE_WORD = "(?:sub-?agents?|teammates?|background|hooks?|skills?|plugins?|MCP)";
const GENERAL = new RegExp(`\\b${SESSION}\\s*,?\\s+(?:and|or)\\s+(?:\\S+\\s+){0,2}${FEATURE_WORD}\\b|\\b${FEATURE_WORD}(?:\\s+servers?)?\\s*,?\\s+(?:and|or)\\s+(?:\\S+\\s+){0,2}${SESSION}\\b`, "i");

export { isTripwire }; // the panel's tripwire set (P-4, P-5), defined with the bands in rate.mjs

const cite = (where) => where.slice(0, 3).join(", ") + (where.length > 3 ? ` +${where.length - 3}` : "");

// profiles: profile.json (cli per project); confirmed: projects whose own config or code holds the
// item's terms (they keep the tie). {drop: [{project, reason: "cli-off", why}], hold: [{project,
// why}], add: [{project: "setup", tiedBy: "setup", ids: []}]}. A project is dropped only when every
// feature the item names is off in every scripted call (P-2); a tripwire item is held instead, with
// the same line as a note. Either way the item reaches setup, where interactive sessions run (P-4).
export function cliTies(row, profiles, { confirmed = new Set(), setup = "setup" } = {}) {
  const none = { drop: [], hold: [], add: [] };
  if (row.source !== "claude-code" || row.fyiOnly || !profiles) return none;
  const text = `${row.title || ""} ${row.text || ""}`;
  const feats = [...subjectFeatures(text)];
  if (!feats.length || GENERAL.test(text)) return none;
  const drop = [], hold = [];
  for (const project of row.projects || []) {
    const cli = profiles[project]?.cli;
    if (project === setup || cli?.status !== "known" || !feats.every((f) => cli.off[f]) || confirmed.has(project)) continue;
    const why = `scripted claude calls run with ${feats.join(", ")} off (${cite([...new Set(feats.flatMap((f) => cli.off[f]))])})`;
    (isTripwire(row) ? hold : drop).push({ project, reason: "cli-off", why });
  }
  const add = (drop.length || hold.length) && profiles[setup] && !(row.projects || []).includes(setup) ? [{ project: setup, tiedBy: "setup", ids: [] }] : [];
  return { drop, hold, add };
}

// B-66: a first-party security, breaking, deprecation or retirement item tied to no project, after
// every other tie change, is checked against every project. results: project -> verify.mjs's file
// check ({found, mentioned}, or null), where found is config or code only (B-47), never a mention.
// One steered lens batch can tie a real fix to nobody (P-27); its terms in a project's code tie it back.
// dropped: projects code dropped for this item, never tied back; an SDK item also needs the SDK
// (B-58's package check is decisive: a generic word like `session_id` is not the SDK).
export function tripwireTies(row, results, { dropped = new Set(), profiles, partial = new Set() } = {}) {
  if (!isTripwire(row) || (row.projects || []).length) return [];
  return [...results].filter(([p, x]) => x?.found.length && !dropped.has(p) && sdkAllows(row, p, profiles, partial))
    .map(([project, x]) => ({ project, tiedBy: "tripwire", ids: [...new Set(x.found.map((f) => f.term))] }));
}

// Every code-made tie change for one item, in the order verify.mjs applies them.
export function codeTies(row, { models, profiles, partial } = {}) {
  const sdk = sdkTies(row, profiles, { partial });
  return { add: [...modelTies(row, models), ...sdk.add], drop: sdk.drop };
}
