// Which models a release item applies to, as a predicate (B-34, P-1). Code only. A model is "in" when
// a clause of the text includes it, "out" only when the text names models in a closed form that
// leaves it out, and "unknown" otherwise: an open-ended phrase ("and newer models", "including"), a
// family the text does not name after "and newer", no model named, or a project id that does not
// parse. Absence is never a downgrade by itself, so callers downgrade on "out" alone and tie on "in"
// alone. Tested in tests/scope.test.mjs.
import { parseModel } from "./models.mjs";

const FAM = "Opus|Sonnet|Haiku|Fable|Mythos";
// A version, not the start of "1M" or "4.8x".
const V = "(\\d{1,2})(?:\\.(\\d{1,2}))?(?![.\\d]*[\\dA-Za-z])";
// One alternation, tried left to right at each position, longest forms first.
const TOKEN = new RegExp([
  `\\bclaude-(opus|sonnet|haiku|fable|mythos)-(\\d{1,2})(?:-(\\d{1,2}))?(?!\\d)`, // 1-3 claude-opus-4-8
  `\\bclaude-(\\d)(?:-(\\d))?-(opus|sonnet|haiku)\\b`, // 4-6 claude-3-5-sonnet
  `\\bClaude (\\d)(?:\\.(\\d|x))? (Opus|Sonnet|Haiku)\\b`, // 7-9 Claude 3 Opus, Claude 3.x Sonnet
  `\\b(?:Claude )?(${FAM}) ${V}\\s*[–-]\\s*${V}(?![\\d.]*\\d)`, // 10-14 Opus 4.0–4.7
  `\\b(?:Claude )?(${FAM}) (\\d{1,2})\\.x\\b`, // 15-16 Sonnet 4.x
  `\\b(?:Claude )?(${FAM}) (\\d{1,2})(?:\\.(\\d{1,2}))?\\+`, // 17-19 Opus 4.7+
  `\\b(?:Claude )?(${FAM}) ${V}`, // 20-22 Claude Opus 5.5
  `\\bClaude (\\d{1,2})(?:\\.(x|\\d{1,2}))?(?=\\s+models?\\b|[,;:)]|\\.(?!\\d)|\\s+and\\b|\\s+or\\b|$)`, // 23-24 Claude 3.x
  `\\b(${FAM})\\b(?! \\d)`, // 25 Fable, Opus: a family with no version
].join("|"), "g");
// A bare version continuing a named one: "Opus 4.7 and 4.8", "Sonnet 4.5, 4.6".
const MORE = /^(?:\s*,\s*|\s*,?\s+(?:and|or)\s+)(\d{1,2})\.(\d{1,2})(?![\d.]*\d)(?!\+)/;
// Between two models of one list.
const JOIN = /^(?:\s*,\s*|\s*,?\s+(?:and|or)\s+|\s+)(?:Claude\s+)?$/;
// "and newer models", ", or later", "and earlier Claude models" right after a list.
const AFTER = /^\s*,?\s+(?:and|or)\s+(?:a\s+)?(newer|later|above|higher|earlier|older)\b(?:\s+(?:Claude\s+)?(?:models?|ones?|versions?))?/;
// Phrases that leave the set open: examples, classes of models, "a newer one".
const OPEN = /\b(?:including|such as|e\.g\.|for example|models? that|models? with(?:out)?|(?:or|and) (?:a )?(?:newer|later|earlier|older) (?:one|model)s?|(?:newer|later|earlier|older|other|all|every|most|any|some|supported) (?:Claude )?models?)\b/i;
// "Earlier models aren't affected": a closing remark, not an open class of models.
const UNAFFECTED = /\b(?:earlier|older|other|previous) (?:Claude )?models? (?:(?:aren't|are not|isn't|is not) (?:affected|changed)|(?:are|remain) un(?:affected|changed))\b/gi;
// The first sentence says what the change is on: "Code written for X can break on Y", or the text
// opens with "On X,". Then that sentence is the scope, and models named later are in passing.
const SUBJECT = /\bbreaks? on\s+(?:Claude\s+)?(?:Opus|Sonnet|Haiku|Fable|Mythos|claude-)|^On\s+(?:Claude\s+)?(?:Opus|Sonnet|Haiku|Fable|Mythos|claude-)[^,]*,/;

const MAX = 99;
const v = (a, b) => [Number(a), b === undefined || b === "x" ? 0 : Number(b)];
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1];
const exact = (family, ver) => ({ family, min: ver, max: ver });

function clauseOf(m) {
  const g = (i) => m[i];
  if (g(1)) return exact(g(1), v(g(2), g(3)));
  if (g(6)) return exact(g(6), v(g(4), g(5)));
  if (g(9)) return g(8) === "x" ? { family: g(9).toLowerCase(), min: [Number(g(7)), 0], max: [Number(g(7)), MAX] } : exact(g(9).toLowerCase(), v(g(7), g(8)));
  if (g(10)) { const lo = v(g(11), g(12)), hi = v(g(13), g(14)); return cmp(lo, hi) <= 0 ? { family: g(10).toLowerCase(), min: lo, max: hi } : null; }
  if (g(15)) return { family: g(15).toLowerCase(), min: [Number(g(16)), 0], max: [Number(g(16)), MAX] };
  if (g(17)) return { family: g(17).toLowerCase(), min: v(g(18), g(19)), max: null };
  if (g(20)) return exact(g(20).toLowerCase(), v(g(21), g(22)));
  if (g(23)) return g(24) === undefined || g(24) === "x" ? { family: null, min: [Number(g(23)), 0], max: [Number(g(23)), MAX] } : { family: null, min: v(g(23), g(24)), max: v(g(23), g(24)) };
  // A family with no version is mostly Claude Code's own wording ("one Opus row", "the default from
  // Sonnet to Opus"), so it neither ties nor excludes that family's models: they are unknown.
  if (g(25)) return { family: g(25).toLowerCase(), min: null, max: null, loose: true };
  return null;
}

// The clauses of one stretch of text, grouped into lists, with what follows each list.
function lists(s) {
  const out = [];
  let cur = null, end = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index < end) continue; // inside a continuation already read
    const c = clauseOf(m);
    if (!c) continue;
    c.text = m[0];
    if (!cur || !JOIN.test(s.slice(end, m.index))) { cur = { start: m.index, clauses: [] }; out.push(cur); }
    cur.clauses.push(c);
    end = m.index + m[0].length;
    for (let n; c.family && c.min && (n = s.slice(end).match(MORE)); end += n[0].length) cur.clauses.push({ ...exact(c.family, v(n[1], n[2])), text: n[0].trim() });
    cur.end = end;
  }
  for (const l of out) l.after = s.slice(l.end).match(AFTER);
  return out;
}

// Versions carry no space after their dot ("5.5"), so a dot and a space end a sentence.
const firstSentence = (s) => s.split(/(?<=[.!?])\s+/)[0];

// text: an item's title and text. Returns {clauses: [{family, min, max, text}], open, subject}.
// open: "none" (closed), "others" (families the text does not name are unknown), "all" (every model
// not included is unknown). subject: the scope came from the model the change is on.
export function modelScope(text, { title = "" } = {}) {
  const body = String(text || "");
  const first = firstSentence(body);
  const subject = SUBJECT.test(first);
  const scoped = subject ? first : `${title} ${body}`;
  const from = lists(scoped);
  let open = "none", masked = scoped;
  const clauses = [];
  for (const l of [...from].reverse()) {
    if (l.after) {
      const up = /newer|later|above|higher/i.test(l.after[1]);
      for (const c of l.clauses) if (up) c.max = null; else c.min = null;
      open = "others";
      masked = masked.slice(0, l.end) + " " + masked.slice(l.end + l.after[0].length); // right to left keeps offsets
    }
    clauses.unshift(...l.clauses);
  }
  if (OPEN.test(masked.replace(UNAFFECTED, " "))) open = "all";
  return { clauses, open, subject };
}

const covers = (c, m) => (c.family === null || c.family === m.family)
  && (c.min === null || cmp(m.version, c.min) >= 0) && (c.max === null || cmp(m.version, c.max) <= 0);

// "in", "out" or "unknown" for one model id a project uses.
export function inScope(scope, id) {
  const m = parseModel(id);
  // Family names alone are too thin to rule a model out.
  if (!m || !scope.clauses.some((c) => !c.loose)) return "unknown";
  if (scope.clauses.some((c) => !c.loose && covers(c, m))) return "in";
  if (scope.open === "all" || scope.clauses.some((c) => c.loose && c.family === m.family)) return "unknown";
  if (scope.open === "others" && !scope.clauses.some((c) => c.family === m.family)) return "unknown";
  return "out";
}
