// The session-start reminder text. Built only from numbers, dates, project and source ids and the page
// link, so no fetched release text can ever reach a session through it. Empty string = say nothing.
// Tested in tests/reminder.test.mjs.
import { LOCK_STALE_MS } from "./updater.mjs";

const DAY = 864e5;
export const STALE_DAYS = 7;
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// summary: <data>/summary.json from build-page; updater: <data>/updater.json from update.mjs;
// project: the configured project the session is in, if any.
export function reminderText({ summary, config, project, updater }, now = Date.now()) {
  if (!config || config.reminder === false) return "";
  if (!summary) return "What's New for Claude is set up but has not run yet. Run /whats-new to check Anthropic's latest releases against your projects.";
  const min = Number(summary.min ?? config.minRating ?? 8); // the threshold the counts were made with
  const top = summary.top || {};
  const total = Number(summary.topTotal) || 0;
  const mine = ID.test(project || "") ? Number(top[project]) || 0 : 0;
  const parts = [];
  if (mine) {
    parts.push(`${plural(mine, "top pick")} for ${project} (rated ${min}+, last ${STALE_DAYS} days).`);
    if (total - mine > 0) parts.push(`${total - mine} more across your other projects.`);
  } else if (total) parts.push(`${plural(total, "top pick")} across your projects (rated ${min}+, last ${STALE_DAYS} days).`);
  // A later /whats-new run rebuilt the results after this background update: its warnings are old.
  if (updater?.finishedAt && Date.parse(summary.builtAt) > Date.parse(updater.finishedAt)) updater = null;
  const failed = (updater?.failed || []).filter((s) => ID.test(s));
  if (failed.length) parts.push(`Background update: ${plural(failed.length, "source")} failed (${failed.join(", ")}).`);
  // A run that was killed never writes its finish; once it is older than any real run, say so.
  const dead = updater?.running && !updater.finishedAt && now - Date.parse(updater.lastAttempt) > LOCK_STALE_MS;
  if (updater?.incomplete || dead) parts.push("The last background update did not finish; run /whats-new to see why.");
  const w = updater?.waiting;
  if (w && Number(w.items) > 0) parts.push(`${Number(w.items)} new items are waiting for /whats-new (about ${Number(w.calls) || 0} Claude calls, over your background budget).`);
  const ageDays = Math.floor((now - Date.parse(summary.builtAt)) / DAY);
  if (ageDays >= STALE_DAYS) parts.push(`Last checked ${ageDays} days ago; run /whats-new to refresh.`);
  if (!parts.length) return "";
  if (mine) parts.push("/whats-new here lists them.");
  const link = /^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9-]+$/.test(config.pageUrl || "") ? ` Review: ${config.pageUrl}` : "";
  return `What's New for Claude: ${parts.join(" ")}${link}`;
}

// SessionStart sends plain stdout to Claude's context, not to the user; a JSON systemMessage is what
// the terminal shows (code.claude.com/docs/en/hooks). Empty text = print nothing.
export const hookOutput = (text) => (text ? JSON.stringify({ systemMessage: text }) : "");

// After compaction the session is already under way; a reminder then is noise.
export const shouldRemind = (input) => input?.source !== "compact";
