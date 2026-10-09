#!/usr/bin/env node
// Prints what the user typed after /whats-new as JSON ({cmd, ...options}), or an error and exit 1.
// Usage: node args.mjs <words...>
import { parseCommand } from "./lib/args.mjs";

try {
  console.log(JSON.stringify(parseCommand(process.argv.slice(2))));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
