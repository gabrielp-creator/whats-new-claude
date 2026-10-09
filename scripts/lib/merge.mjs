// Deterministic merge of the three lens answers (impact, type, risk) into one decision per item.
// No LLM here: the sections, the FYI-only rule and the disagreement flags are code, so they can be
// tested and cannot be talked out of by fetched text.

const RISKY_TYPES = new Set(["model", "security", "breaking-or-deprecation"]);
const FYI_ONLY = new Set(["third-party", "external-fork"]);
const STRENGTH = { high: 3, medium: 2, low: 1 };
const WORDS = { remov: "removed", renam: "renamed", retir: "retired", deprecat: "deprecation", migrat: "migration" };

export function tripwireLabel(pattern) {
  if (pattern.startsWith("setup:")) return `your setup: ${pattern.slice(6)}`;
  if (/Opus\||claude-\(/.test(pattern)) return "model name";
  const word = pattern.replace(/\\b/g, "").replace(/\(.*?\)/g, "");
  return WORDS[word] || word;
}

// Urgency: how soon the user should look. Exposed breakage first, then security, model and
// deprecation events that touch their work, then behaviour changes and strong effects.
const EXPOSED = { breaking: 100, deprecation: 95, security: 90, "behavior-change": 60 };
function urgencyOf({ exposed, risk, type, hasEffect, strength, newWork, tripwire }) {
  let u = exposed ? EXPOSED[risk] : 0;
  if (hasEffect && type === "model") u = Math.max(u, 85);
  if (hasEffect && (type === "breaking-or-deprecation" || type === "security")) u = Math.max(u, 80);
  if (hasEffect) u = Math.max(u, { high: 55, medium: 35, low: 15 }[strength]);
  if (newWork) u = Math.max(u, 10);
  if (tripwire) u = Math.max(u, 5);
  return u + (hasEffect ? STRENGTH[strength] : 0); // strength breaks ties inside a tier
}

export const labelFor = (u) => (u >= 80 ? "urgent" : u >= 50 ? "soon" : u >= 10 ? "later" : "none");

export function merge(item, impact, type, risk) {
  const exposed = risk.risk !== "none" && risk.exposed;
  const hasEffect = impact.effect !== "none";
  const mustRead = exposed || (RISKY_TYPES.has(type.type) && hasEffect);
  const tripwires = [...new Set(item.tripwires.map(tripwireLabel))];

  const section = mustRead ? "must-read"
    : hasEffect ? "affects-work"
    : impact.new_work ? "new-ideas"
    : tripwires.length ? "keyword-only"
    : "dropped";

  const flags = [];
  if (exposed && !hasEffect) flags.push("The risk lens sees exposure, but the impact lens sees no effect on your work.");
  if (type.type === "breaking-or-deprecation" && risk.risk === "none") flags.push("The type lens calls it breaking or a deprecation; the risk lens sees no risk.");
  if (hasEffect && impact.strength !== "low" && type.action === "ignore") flags.push("The impact lens rates it useful, but the type lens suggests ignoring it.");
  if (impact.injection || type.injection || risk.injection) flags.push("A lens found instructions aimed at an AI in the source text.");

  const fyiOnly = FYI_ONLY.has(item.provenance);
  const action = fyiOnly && type.action === "try-feature" ? "read" : type.action;
  const urgency = urgencyOf({ exposed, risk: risk.risk, type: type.type, hasEffect, strength: impact.strength,
    newWork: impact.new_work, tripwire: tripwires.length > 0 });
  const urgencyLabel = labelFor(urgency);

  return {
    section, urgency, urgencyLabel, action, fyiOnly, flags, tripwires,
    effect: impact.effect, projects: impact.projects, newWork: impact.new_work, strength: impact.strength,
    why: impact.why, type: type.type, risk: risk.risk, riskExposed: risk.exposed, riskWhy: risk.why,
  };
}
