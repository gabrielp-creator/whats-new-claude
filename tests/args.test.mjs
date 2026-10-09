import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseCommand } from "../scripts/lib/args.mjs";

// The skill runs every script, args.mjs included, with --data <folder> appended (SKILL.md "Run every
// script as"). Run it that way here: the path production uses, not parseCommand alone.
const ARGS = fileURLToPath(new URL("../scripts/args.mjs", import.meta.url));
const runArgs = (...words) => spawnSync(process.execPath, [ARGS, ...words, "--data", "C:/some data/folder"], { encoding: "utf8" });

test("args.mjs accepts the --data the skill appends, for every command", () => {
  for (const [words, want] of [
    [[], { cmd: "run" }],
    [["here"], { cmd: "here" }],
    [["news", "--days", "3"], { cmd: "news", days: 3 }],
    [["setup"], { cmd: "setup" }],
    [["here", "--project", "web-app"], { cmd: "here", project: "web-app" }],
  ]) {
    const r = runArgs(...words);
    assert.equal(r.status, 0, `${words.join(" ") || "(none)"}: ${r.stderr}`);
    assert.deepEqual(JSON.parse(r.stdout), want);
  }
});

test("args.mjs still rejects options the user typed that a command does not take", () => {
  const r = runArgs("here", "--frobnicate", "1");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--frobnicate is not an option for here/);
});

test("no arguments is a normal run (update now)", () => {
  assert.deepEqual(parseCommand([]), { cmd: "run" });
  assert.deepEqual(parseCommand([""]), { cmd: "run" });
});

test("here takes --min, --days and --project", () => {
  assert.deepEqual(parseCommand(["here", "--min", "8.5", "--days", "14"]), { cmd: "here", min: 8.5, days: 14 });
  assert.deepEqual(parseCommand(["here", "--project", "web-app"]), { cmd: "here", project: "web-app" });
  assert.deepEqual(parseCommand(["here"]), { cmd: "here" });
});

test("accepts --flag=value and is case-insensitive about the command word", () => {
  assert.deepEqual(parseCommand(["HERE", "--min=7"]), { cmd: "here", min: 7 });
});

test("news takes --days only; export takes --min, --project and --dry-run", () => {
  assert.deepEqual(parseCommand(["news", "--days", "3"]), { cmd: "news", days: 3 });
  assert.throws(() => parseCommand(["news", "--min", "8"]), /--min/);
  assert.deepEqual(parseCommand(["export", "--min", "9", "--project", "site", "--dry-run"]), { cmd: "export", min: 9, project: "site", dryRun: true });
});

test("setup, briefs and page take no options", () => {
  for (const c of ["setup", "briefs", "page"]) assert.deepEqual(parseCommand([c]), { cmd: c });
  assert.throws(() => parseCommand(["page", "--days", "3"]), /--days/);
});

test("rejects unknown commands, unknown flags, bad numbers and odd project ids", () => {
  assert.throws(() => parseCommand(["delete"]), /unknown command/);
  assert.throws(() => parseCommand(["here", "--force"]), /--force/);
  assert.throws(() => parseCommand(["here", "--min"]), /--min needs a value/);
  assert.throws(() => parseCommand(["here", "--min", "11"]), /0 to 10/);
  assert.throws(() => parseCommand(["here", "--min", "abc"]), /0 to 10/);
  assert.throws(() => parseCommand(["here", "--days", "0"]), /1 to 365/);
  assert.throws(() => parseCommand(["here", "--days", "2.5"]), /1 to 365/);
  assert.throws(() => parseCommand(["here", "--project", "../x"]), /project id/);
  assert.throws(() => parseCommand(["here", "extra"]), /unexpected/);
});
