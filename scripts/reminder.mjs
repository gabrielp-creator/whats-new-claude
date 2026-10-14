#!/usr/bin/env node
// SessionStart hook: copies the /config settings to the data folder, then shows the user a one-line
// reminder (counts and the page link only) or nothing.
// Never fails a session: any error means silence.
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { readJson, writeJson } from "./lib/store.mjs";
import { optionsFromEnv, mergeOptions } from "./lib/options.mjs";
import { reminderText, hookOutput, shouldRemind } from "./lib/reminder.mjs";
import { projectForCwd } from "./lib/show.mjs";

try {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
  const dir = process.env.CLAUDE_PLUGIN_DATA || join(homedir(), ".whats-new-claude");
  // Copy this session's /config settings for the scripts (never the GitHub token).
  const options = optionsFromEnv(process.env);
  if (Object.keys(options).length) writeJson(join(dir, "options.json"), options);
  if (shouldRemind(input)) {
    const raw = readJson(join(dir, "config.json"), null);
    const config = raw && mergeOptions(raw, options);
    let project = null;
    try { project = config && projectForCwd(config, process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()); } catch {}
    const updater = readJson(join(dir, "updater.json"), null), notices = readJson(join(dir, "notices.json"), {});
    const out = hookOutput(reminderText({ summary: readJson(join(dir, "summary.json"), null), config, project, updater, options, notices }));
    if (out) process.stdout.write(out + "\n");
    // B-65: the redo explanation is shown once; later reminders give only the count.
    if (out && updater?.waiting?.redo > 0 && !notices.redoExplained) writeJson(join(dir, "notices.json"), { ...notices, redoExplained: true });
  }
} catch {}
