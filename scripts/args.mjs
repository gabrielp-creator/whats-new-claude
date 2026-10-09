#!/usr/bin/env node
// Prints what the user typed after /whats-new as JSON ({cmd, ...options}), or an error and exit 1.
// Usage: node args.mjs <words...> [--data <dir>]
// --data is the option every script takes (the skill appends it); it is not one of the user's words.
import { parseCommand } from "./lib/args.mjs";

const words = process.argv.slice(2);
const i = words.indexOf("--data");
if (i !== -1) words.splice(i, 2);

try {
  console.log(JSON.stringify(parseCommand(words)));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
