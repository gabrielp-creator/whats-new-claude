// Puts tests/fixtures/fake-claude.mjs first on PATH as `claude`, for a child process's environment.
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readdirSync } from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";

const FAKE = join(import.meta.dirname, "fake-claude.mjs");

export function fakeClaude(mode) {
  const dir = mkdtempSync(join(tmpdir(), "wnc-fake-"));
  const bin = join(dir, "bin"), pids = join(dir, "pids");
  mkdirSync(bin);
  mkdirSync(pids);
  if (process.platform === "win32") writeFileSync(join(bin, "claude.cmd"), `@"${process.execPath}" "${FAKE}" %*\r\n`);
  else {
    writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
    chmodSync(join(bin, "claude"), 0o755);
  }
  // Windows names it Path; a second key spelled PATH would leave which one wins undefined.
  const key = Object.keys(process.env).find((k) => /^path$/i.test(k)) || "PATH";
  const env = { ...process.env, [key]: bin + delimiter + process.env[key], WNC_FAKE_PIDS: pids, WNC_FAKE_MODE: mode };
  return { dir, env, pids: () => readdirSync(pids).map(Number) };
}

export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

export async function waitFor(check, ms = 15e3) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return check();
}
