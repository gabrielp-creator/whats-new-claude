// One run at a time over the user's data: the background updater and /whats-new both take this lock
// (<data>/update.lock). Created exclusively ("wx"). A stale lock (lib/updater.mjs LOCK_STALE_MS) is
// replaced only by the one process that wins a second, short-lived takeover lock and finds the main
// lock still stale while holding it, so many sessions starting together cannot all take it over.
import { writeFileSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { lockState } from "./updater.mjs";

const file = (dir) => join(dir, "update.lock");
const body = (who) => JSON.stringify({ at: new Date().toISOString(), pid: process.pid, who });
const TAKEOVER_STALE_MS = 60e3;

function create(dir, who) {
  try { writeFileSync(file(dir), body(who), { flag: "wx" }); return true; } catch { return false; }
}

function current(dir) {
  try {
    const mtimeMs = statSync(file(dir)).mtimeMs;
    let lock = null;
    try { lock = JSON.parse(readFileSync(file(dir), "utf8")); } catch {}
    return lockState(lock, Date.now(), mtimeMs);
  } catch { return "free"; }
}

// Returns true when this process now holds the lock.
export function takeLock(dir, who) {
  if (create(dir, who)) return true;
  if (current(dir) === "held") return false;
  const t = `${file(dir)}.takeover`;
  try { writeFileSync(t, body(who), { flag: "wx" }); } catch {
    try { if (Date.now() - statSync(t).mtimeMs > TAKEOVER_STALE_MS) unlinkSync(t); } catch {}
    return false; // another process is taking over
  }
  try {
    if (current(dir) === "held") return false; // replaced while we waited
    try { unlinkSync(file(dir)); } catch {}
    return create(dir, who);
  } finally {
    try { unlinkSync(t); } catch {}
  }
}

// Who holds it, for a friendly message; null when free or stale.
export function lockHolder(dir) {
  try {
    const mtimeMs = statSync(file(dir)).mtimeMs;
    let lock = null;
    try { lock = JSON.parse(readFileSync(file(dir), "utf8")); } catch {}
    return lockState(lock, Date.now(), mtimeMs) === "held" ? (lock?.who || "another run") : null;
  } catch { return null; }
}

export function refreshLock(dir) {
  try {
    const lock = JSON.parse(readFileSync(file(dir), "utf8"));
    if (lock.pid === process.pid) writeFileSync(file(dir), JSON.stringify({ ...lock, at: new Date().toISOString() }));
  } catch {}
}

export function releaseLock(dir) {
  try {
    const lock = JSON.parse(readFileSync(file(dir), "utf8"));
    if (lock.pid !== process.pid && lock.who !== "/whats-new") return; // never remove another run's lock
  } catch {}
  try { unlinkSync(file(dir)); } catch {}
}
