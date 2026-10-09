// Settings the user changes in Claude Code's /config panel (userConfig in .claude-plugin/plugin.json).
// Claude Code exports them only to hook processes, as CLAUDE_PLUGIN_OPTION_<KEY>; the session-start
// hook copies the non-secret ones to <data>/options.json so every script sees them. The GitHub token
// is never copied: it stays in Claude Code's secure storage and only the updater hook reads it.
// Tested in tests/options.test.mjs.

export const FREQUENCY_HOURS = { daily: 24, "every 3 days": 72, weekly: 168, manual: Infinity };

const num = (min, max) => (v) => { const n = Number(v); return v !== "" && Number.isFinite(n) && n >= min && n <= max ? n : undefined; };
const int = (min, max) => (v) => { const n = num(min, max)(v); return Number.isInteger(n) ? n : undefined; };
const bool = (v) => (v === "true" ? true : v === "false" ? false : undefined);
const oneOf = (set) => (v) => (Object.hasOwn(set, v) ? v : undefined);

const KEYS = {
  UPDATE_FREQUENCY: ["updateFrequency", oneOf(FREQUENCY_HOURS)],
  MIN_RATING: ["minRating", num(0, 10)],
  AUTO_RATE_MAX_CALLS: ["autoRateMaxCalls", int(0, 200)],
  MAX_CALLS_WITHOUT_ASKING: ["maxCallsWithoutAsking", int(0, 1000)],
  REMINDER: ["reminder", bool],
};

export function optionsFromEnv(env) {
  const out = {};
  for (const [key, [name, parse]] of Object.entries(KEYS)) {
    const raw = env[`CLAUDE_PLUGIN_OPTION_${key}`];
    if (raw === undefined) continue;
    const v = parse(String(raw).trim());
    if (v !== undefined) out[name] = v;
  }
  return out;
}

// Only the known settings can be changed this way; projects, folders and the model never.
const NAMES = new Set(Object.values(KEYS).map(([name]) => name));
export function mergeOptions(config, options) {
  const out = { ...config };
  for (const [k, v] of Object.entries(options || {})) if (NAMES.has(k)) out[k] = v;
  return out;
}
