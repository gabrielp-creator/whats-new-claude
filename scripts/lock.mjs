#!/usr/bin/env node
// Lets /whats-new share the background updater's lock, so the two never review the same items at
// once. Usage: node lock.mjs <acquire|release> [--data <dir>]. acquire exits 1 when another run holds it.
import { dataDir, positional } from "./lib/store.mjs";
import { takeLock, releaseLock, lockHolder } from "./lib/lock.mjs";

const DATA = dataDir();
const [cmd] = positional();
if (cmd === "acquire") {
  if (takeLock(DATA, "/whats-new")) console.log("ok");
  else { console.log(`busy: a ${lockHolder(DATA) || "another run"} is running; try again in a few minutes`); process.exitCode = 1; }
} else if (cmd === "release") {
  releaseLock(DATA);
  console.log("released");
} else throw new Error("usage: lock.mjs <acquire|release>");
