// B-8: no claude call outlives the run that started it, whether the run exits, is killed with the
// process that started it, or reaches the deadline the background update gives it. The calls go to a
// fake claude first on PATH (fixtures/fake-path.mjs) that answers after two minutes; on Windows it is
// a .cmd, so lib/claude.mjs runs it under cmd.exe and each fake is a grandchild, as in a real install.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fakeClaude, alive, waitFor } from "./fixtures/fake-path.mjs";

const DRIVER = join(import.meta.dirname, "fixtures", "call-driver.mjs");
let started = [];
afterEach(() => { for (const pid of started) if (alive(pid)) process.kill(pid); started = []; });

async function callsRunning(fake, n) {
  assert.ok(await waitFor(() => fake.pids().length >= n), "the fake calls never started");
  started = fake.pids();
  return started;
}

test("a run that exits ends its live calls (B-8)", { timeout: 30e3 }, async () => {
  const fake = fakeClaude("sleep");
  const r = spawn(process.execPath, [DRIVER, "exit"], { env: { ...fake.env, WNC_MAX_CALLS: "2", WNC_DRIVER_CALLS: "2" } });
  const pids = await callsRunning(fake, 2);
  await new Promise((done) => r.on("close", done));
  assert.ok(await waitFor(() => pids.every((p) => !alive(p))), `calls still running: ${pids.filter(alive)}`);
});

// On Linux and macOS a run outlives a killed parent (the background update, or the session). Windows
// ends a killed process's direct children itself (Node puts them in a job object), so there the
// driver is started detached, outside that job, to test the same watch.
test("a run whose starting process is killed stops and ends its calls (B-8)", { timeout: 30e3 }, async () => {
  const fake = fakeClaude("sleep");
  const parent = spawn(process.execPath, ["-e", `const c = require("child_process").spawn(process.execPath, [${JSON.stringify(DRIVER)}], { stdio: "ignore", detached: true, windowsHide: true });
require("fs").writeFileSync(${JSON.stringify(join(fake.dir, "driver.pid"))}, String(c.pid)); setTimeout(() => {}, 60e3);`],
    { env: { ...fake.env, WNC_MAX_CALLS: "2", WNC_DRIVER_CALLS: "2" } });
  const pids = await callsRunning(fake, 2);
  const driver = Number(readFileSync(join(fake.dir, "driver.pid"), "utf8"));
  started.push(driver);
  parent.kill("SIGKILL");
  assert.ok(await waitFor(() => !alive(driver)), "the run kept going after its parent was killed");
  assert.ok(await waitFor(() => pids.every((p) => !alive(p))), `calls still running: ${pids.filter(alive)}`);
});

test("past the step deadline, live calls end and new ones are refused (B-8)", { timeout: 30e3 }, async () => {
  const fake = fakeClaude("sleep");
  const t0 = Date.now();
  const r = spawn(process.execPath, [DRIVER], { env: { ...fake.env, WNC_MAX_CALLS: "3", WNC_DRIVER_CALLS: "2", WNC_DEADLINE: String(Date.now() + 3000) } });
  let out = "";
  r.stdout.on("data", (d) => (out += d));
  const pids = await callsRunning(fake, 2);
  await new Promise((done) => r.on("close", done));
  assert.ok(Date.now() - t0 < 20e3);
  const { ended, after } = JSON.parse(out);
  assert.equal(ended.length, 2);
  for (const e of ended) assert.match(e, /deadline/);
  assert.match(after, /deadline/);
  assert.ok(await waitFor(() => pids.every((p) => !alive(p))), `calls still running: ${pids.filter(alive)}`);
});

test("a run that ends normally leaves the watch nothing to do", { timeout: 30e3 }, () => {
  const fake = fakeClaude("answer");
  const r = spawnSync(process.execPath, [DRIVER], { env: { ...fake.env, WNC_MAX_CALLS: "2", WNC_DRIVER_CALLS: "1" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { ended: ["ok"], after: "ok" });
});
