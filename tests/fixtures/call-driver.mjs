// Started by tests/calls.test.mjs: makes WNC_DRIVER_CALLS claude calls at once through lib/claude.mjs
// and prints how each ended, then one more call's outcome. With "exit" as its argument it calls
// process.exit as soon as the calls have started, while they still run.
import { writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runClaude } from "../../scripts/lib/claude.mjs";

const n = Number(process.env.WNC_DRIVER_CALLS || 1);
const pids = process.env.WNC_FAKE_PIDS;
const promptFile = join(pids, "..", "prompt.md");
writeFileSync(promptFile, "fixture prompt");
const call = () => runClaude("<items>\n[]\n</items>", { model: "sonnet", promptFile }).then(() => "ok", (e) => e.message);
const calls = Array.from({ length: n }, call);
if (process.argv[2] === "exit") {
  while (readdirSync(pids).length < n) await new Promise((r) => setTimeout(r, 100));
  process.exit(1);
}
const ended = await Promise.all(calls);
console.log(JSON.stringify({ ended, after: await call() }));
