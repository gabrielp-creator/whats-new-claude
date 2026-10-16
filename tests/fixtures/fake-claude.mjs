// Stands in for the claude CLI in tests (tests/calls.test.mjs, tests/failing.test.mjs): the tests put
// a claude.cmd (Windows) or claude script that runs this first on PATH, so lib/claude.mjs starts it the
// way it starts the real one. WNC_FAKE_PIDS: a folder where each run leaves a file named by its pid.
// WNC_FAKE_MODE "sleep": answers after two minutes. "answer": answers at once for every item except
// those whose id contains "always-bad", with fields every lens and the rater accept.
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

if (process.env.WNC_FAKE_PIDS) writeFileSync(join(process.env.WNC_FAKE_PIDS, String(process.pid)), "");
const input = readFileSync(0, "utf8");
const reply = (rows) => process.stdout.write(JSON.stringify({ result: JSON.stringify(rows), is_error: false, usage: { input_tokens: 1, output_tokens: 1 } }));

if (process.env.WNC_FAKE_MODE === "sleep") setTimeout(() => reply([]), 120e3);
else {
  const items = JSON.parse(input.slice(input.indexOf("<items>") + 7, input.indexOf("</items>")));
  reply(items.filter((i) => !String(i.id).includes("always-bad")).map((i) => ({
    id: i.id, effect: "none", projects: [], new_work: false, strength: "low", why: "",
    type: "internal", action: "ignore", risk: "none", exposed: false, injection: false,
  })));
}
