// Parses what the user typed after /whats-new. Skills receive raw text, so this is the one strict
// parser: known commands, known flags per command, bounded numbers. Tested in tests/args.test.mjs.

const FLAGS = {
  run: [], setup: [], briefs: [], page: [],
  here: ["min", "days", "project"],
  news: ["days"],
  export: ["min", "project", "dry-run"],
};
const BOOL = new Set(["dry-run"]);
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

function value(flag, raw) {
  if (flag === "min") {
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n) || n < 0 || n > 10) throw new Error("--min must be a number from 0 to 10");
    return n;
  }
  if (flag === "days") {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 365) throw new Error("--days must be a whole number from 1 to 365");
    return n;
  }
  if (flag === "project") {
    if (!PROJECT_ID.test(raw)) throw new Error("--project must be a project id (lower-case letters, digits and dashes)");
    return raw;
  }
  throw new Error(`unknown option --${flag}`);
}

const KEY = { "dry-run": "dryRun" };

export function parseCommand(tokens) {
  const words = tokens.map((t) => String(t).trim()).filter(Boolean);
  const cmd = (words[0] && !words[0].startsWith("--") ? words.shift() : "run").toLowerCase();
  if (!FLAGS[cmd]) throw new Error(`unknown command "${cmd}". Use: here, news, export, page, setup, briefs, or nothing to update now`);
  const out = { cmd };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w.startsWith("--")) throw new Error(`unexpected "${w}"`);
    let [flag, raw] = w.slice(2).split(/=(.*)/s);
    flag = flag.toLowerCase();
    if (!FLAGS[cmd].includes(flag)) throw new Error(`--${flag} is not an option for ${cmd}`);
    if (BOOL.has(flag)) { out[KEY[flag] || flag] = true; continue; }
    if (raw === undefined) {
      if (i + 1 >= words.length || words[i + 1].startsWith("--")) throw new Error(`--${flag} needs a value`);
      raw = words[++i];
    }
    out[KEY[flag] || flag] = value(flag, raw);
  }
  return out;
}
