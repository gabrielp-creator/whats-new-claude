// The user's config: their workspace, their projects and where each project's briefs go.
// Written only by scripts/config.mjs after the user confirms a draft; validated on every load.
import { join, isAbsolute } from "node:path";
import { readJson } from "./store.mjs";
import { mergeOptions, FREQUENCY_HOURS } from "./options.mjs";

export const DEFAULT_BLOCKED = [".git", "node_modules", ".claude", "dotfiles"];
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function validateConfig(c) {
  const errors = [];
  if (!c || typeof c !== "object") return ["config must be a JSON object"];
  if (typeof c.workspaceRoot !== "string" || !isAbsolute(c.workspaceRoot)) errors.push("workspaceRoot must be an absolute folder path");
  if (!Array.isArray(c.projects) || !c.projects.length) errors.push("projects must be a non-empty list");
  const seen = new Set();
  for (const [n, p] of (Array.isArray(c.projects) ? c.projects : []).entries()) {
    if (!p || !ID.test(p.id || "")) { errors.push(`projects[${n}].id must be lower-case letters, digits and dashes`); continue; }
    if (seen.has(p.id)) errors.push(`duplicate project id ${p.id}`);
    seen.add(p.id);
    if (typeof p.description !== "string" || !p.description.trim()) errors.push(`${p.id}: description is required`);
    if (typeof p.briefDir !== "string" || !p.briefDir.trim() || isAbsolute(p.briefDir)) errors.push(`${p.id}: briefDir must be a folder relative to workspaceRoot`);
    if (p.path !== undefined && (typeof p.path !== "string" || !p.path.trim() || isAbsolute(p.path) || p.path.split(/[\\/]/).includes(".."))) errors.push(`${p.id}: path must be a folder inside workspaceRoot`);
  }
  if (c.blocked !== undefined && !(Array.isArray(c.blocked) && c.blocked.every((b) => typeof b === "string"))) errors.push("blocked must be a list of folder names");
  if (c.reminder !== undefined && typeof c.reminder !== "boolean") errors.push("reminder must be true or false");
  // model reaches a command line (through cmd.exe for an npm install on Windows): plain names only
  if (c.model !== undefined && !(typeof c.model === "string" && /^[a-z0-9][a-z0-9.\-\[\]]{0,80}$/i.test(c.model))) errors.push("model must be a model name such as sonnet or claude-sonnet-5-5");
  if (c.updateFrequency !== undefined && !Object.hasOwn(FREQUENCY_HOURS, c.updateFrequency)) errors.push("updateFrequency must be daily, every 3 days, weekly or manual");
  if (c.autoRateMaxCalls !== undefined && !(Number.isInteger(c.autoRateMaxCalls) && c.autoRateMaxCalls >= 0 && c.autoRateMaxCalls <= 200)) errors.push("autoRateMaxCalls must be a whole number from 0 to 200");
  if (c.maxCallsWithoutAsking !== undefined && !(Number.isInteger(c.maxCallsWithoutAsking) && c.maxCallsWithoutAsking >= 0)) errors.push("maxCallsWithoutAsking must be a whole number");
  if (c.minRating !== undefined && !(typeof c.minRating === "number" && c.minRating >= 0 && c.minRating <= 10)) errors.push("minRating must be a number from 0 to 10");
  return errors;
}

export function withDefaults(c) {
  return { model: "sonnet", maxCallsWithoutAsking: 30, minRating: 8, updateFrequency: "daily", autoRateMaxCalls: 0, notUsing: "", ...c, blocked: [...new Set([...DEFAULT_BLOCKED, ...(c.blocked || [])])] };
}

export function loadConfig(dir) {
  const c = readJson(join(dir, "config.json"), null);
  if (!c) throw new Error("No config yet. Run /whats-new setup first.");
  const errors = validateConfig(c);
  if (errors.length) throw new Error(`config.json is invalid:\n- ${errors.join("\n- ")}`);
  // Settings from /config (copied by the session-start hook, lib/options.mjs) win over config.json.
  return withDefaults(mergeOptions(c, readJson(join(dir, "options.json"), null)));
}

// The profile the lenses see: project ids are the only values allowed in their answers.
export function projectsProfile(c) {
  return [
    "# Existing work",
    "",
    "Project ids in [brackets] are the ONLY values allowed in a \"projects\" answer.",
    "",
    ...c.projects.map((p) => `- [${p.id}] ${p.description.replace(/\s+/g, " ").trim()}`),
    ...(c.notUsing ? ["", `Does not use: ${c.notUsing}`] : []),
    "",
  ].join("\n");
}
