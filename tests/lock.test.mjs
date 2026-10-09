import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { takeLock, releaseLock, lockHolder } from "../scripts/lib/lock.mjs";
import { LOCK_STALE_MS } from "../scripts/lib/updater.mjs";

const withDir = (fn) => { const d = mkdtempSync(join(tmpdir(), "wnc-lock-")); try { fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };
const old = (p) => { const t = (Date.now() - LOCK_STALE_MS - 60e3) / 1000; utimesSync(p, t, t); };

test("one holder at a time; release frees it", () => withDir((d) => {
  assert.equal(takeLock(d, "background update"), true);
  assert.equal(takeLock(d, "background update"), false, "same process asking twice still sees it held");
  assert.equal(lockHolder(d), "background update");
  releaseLock(d);
  assert.equal(existsSync(join(d, "update.lock")), false);
  assert.equal(takeLock(d, "/whats-new"), true);
}));

test("a half-written lock from another session counts as held while fresh", () => withDir((d) => {
  writeFileSync(join(d, "update.lock"), "");
  assert.equal(takeLock(d, "background update"), false);
  old(join(d, "update.lock"));
  assert.equal(takeLock(d, "background update"), true, "stale: taken over");
}));

test("a stale lock is taken over; a fresh one from another run is not", () => withDir((d) => {
  const p = join(d, "update.lock");
  writeFileSync(p, JSON.stringify({ at: new Date().toISOString(), pid: 999999, who: "background update" }));
  assert.equal(takeLock(d, "/whats-new"), false);
  writeFileSync(p, JSON.stringify({ at: new Date(Date.now() - LOCK_STALE_MS - 60e3).toISOString(), pid: 999999, who: "background update" }));
  assert.equal(takeLock(d, "/whats-new"), true);
  assert.equal(JSON.parse(readFileSync(p, "utf8")).who, "/whats-new");
}));

test("release never removes another background run's lock", () => withDir((d) => {
  const p = join(d, "update.lock");
  writeFileSync(p, JSON.stringify({ at: new Date().toISOString(), pid: 999999, who: "background update" }));
  releaseLock(d);
  assert.equal(existsSync(p), true);
}));

import { spawn } from "node:child_process";

test("a stale lock is taken over by exactly one of many processes starting together", async () => {
  const d = mkdtempSync(join(tmpdir(), "wnc-race-"));
  try {
    for (let trial = 0; trial < 3; trial++) {
      writeFileSync(join(d, "update.lock"), JSON.stringify({ at: new Date(Date.now() - LOCK_STALE_MS - 60e3).toISOString(), pid: 1, who: "background update" }));
      const lib = new URL("../scripts/lib/lock.mjs", import.meta.url).href;
      const code = `import { takeLock } from ${JSON.stringify(lib)}; process.stdout.write(takeLock(${JSON.stringify(d)}, "background update") ? "1" : "0");`;
      const outs = await Promise.all(Array.from({ length: 8 }, () => new Promise((res) => {
        const p = spawn(process.execPath, ["--input-type=module", "-e", code]);
        let o = ""; p.stdout.on("data", (x) => (o += x)); p.on("close", () => res(o));
      })));
      assert.equal(outs.filter((o) => o === "1").length, 1, `trial ${trial}: ${outs.join("")}`);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});
