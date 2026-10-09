import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Escapes written through shells and scripts can turn into raw control characters in source files
// (it happened on 2026-10-08). Only tab, LF and CR are allowed in text files.
const ROOT = join(import.meta.dirname, "..");
const SKIP = new Set([".git", "node_modules"]);
function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    if (SKIP.has(n)) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

test("no raw control characters in any source, test, template or doc file", () => {
  const bad = [];
  for (const f of files(ROOT).filter((f) => /\.(mjs|js|json|md|html|yml)$/.test(f))) {
    const b = readFileSync(f);
    const i = b.findIndex((c) => c < 32 && c !== 9 && c !== 10 && c !== 13);
    if (i !== -1) bad.push(`${relative(ROOT, f)} at byte ${i}`);
  }
  assert.deepEqual(bad, []);
});

// Tools can also decode escape text into raw invisible or direction-changing characters, which break
// regexes and hide text from reviewers (it happened on 2026-10-09). Built from code points on purpose.
const INVISIBLE = new Set([0x2028, 0x2029, 0xfeff, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f,
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);

test("no raw invisible or direction-changing characters in any source file", () => {
  const bad = [];
  for (const f of files(ROOT).filter((f) => /\.(mjs|js|json|md|html|yml)$/.test(f))) {
    let i = 0;
    for (const ch of readFileSync(f, "utf8")) {
      if (INVISIBLE.has(ch.codePointAt(0))) { bad.push(`${relative(ROOT, f)} at character ${i}`); break; }
      i++;
    }
  }
  assert.deepEqual(bad, []);
});
