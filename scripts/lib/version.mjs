// The installed Claude Code version (B-52): `claude --version`, run locally from the plugin's own
// folder. It sends nothing, needs no call budget (it is not a model call) and fails closed: no
// version unless the output parses. Tested in tests/version.test.mjs.
import { execFileSync } from "node:child_process";
import { CWD, resolveClaude } from "./find-claude.mjs";

// "2.1.296 (Claude Code)" -> "2.1.296"; anything else -> null.
export function parseVersion(out) {
  const first = String(out ?? "").split(/\r?\n/)[0].trim();
  const m = /^(\d+\.\d+\.\d+)(?:\s|$)/.exec(first);
  return m ? m[1] : null;
}

export function readVersion({ exec = execFileSync, find = resolveClaude } = {}) {
  const { cmd, shell } = find();
  let out;
  try { out = exec(cmd, ["--version"], { encoding: "utf8", cwd: CWD, shell, timeout: 10000, stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return { version: null, how: "claude --version: could not run" }; }
  const version = parseVersion(out);
  return version ? { version, how: "claude --version" } : { version: null, how: "claude --version: output not a version" };
}

// A project that depends on the Agent SDK runs the CLI the SDK bundles, not the installed one (P-17).
const BUNDLES_CLI = new Set(["@anthropic-ai/claude-agent-sdk", "claude-agent-sdk", "claude_agent_sdk"]);
export function versionFor(profile, installed) {
  if ((profile?.packages || []).some((p) => BUNDLES_CLI.has(p.name))) return null;
  return installed?.version ?? null;
}
