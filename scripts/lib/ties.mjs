// Ties made by code, after the lenses and before the file check (M3, P-25). The impact lens ties an
// item to projects from one description line, so it misses projects that run an affected model; code
// adds them from what their own config and code use (models.json). Code only adds here; nothing a
// fetched text says can tie a project that the predicate does not. Tested in tests/ties.test.mjs.
import { modelRefs, launchStatus, isLaunchText } from "./models.mjs";
import { modelScope, inScope } from "./scope.mjs";
import { isLaunch } from "./rate.mjs";

// Sources whose model changes reach a project's own API calls. Claude Code's reach only the projects
// that run Claude Code: setup, and projects whose code scripts `claude`. Skill and cookbook commits
// expose setup and alias users only (B-40); SDK items are tied by package (B-58), not by model.
// Source ids as fetch.mjs writes them (a test checks they exist there).
export const RUNTIME = new Set(["claude-code"]);
export const API = new Set(["platform-release-notes", "anthropic-news"]);

// B-48: [{project, tiedBy: "model", ids}] for projects the item does not already name. A launch ties
// projects that use the launched model or an older one of its family (adopted or upgrade); any other
// item ties projects with a used id inside its scope ("in" only: "unknown" never ties, P-13). A launch
// needs the type lens's "model" and a launch verb in the text (B-57's rule, used here first).
export function modelTies(row, models) {
  if (!models || row.fyiOnly || !(API.has(row.source) || RUNTIME.has(row.source))) return [];
  const have = new Set(row.projects || []);
  const launch = isLaunch(row) && isLaunchText(`${row.title || ""} ${row.text || ""}`);
  const refs = launch ? modelRefs(`${row.title || ""} ${row.text || ""}`) : null;
  const scope = launch ? null : modelScope(row.text, { title: row.title });
  const out = [];
  for (const [project, inv] of Object.entries(models)) {
    if (have.has(project)) continue;
    if (RUNTIME.has(row.source) && project !== "setup" && !inv.claudeCalls?.length) continue;
    const used = inv.models || [];
    let ids;
    if (launch) { const l = launchStatus(refs, used); ids = l.status === "adopted" || l.status === "upgrade" ? l.uses : []; }
    else ids = used.filter((id) => inScope(scope, id) === "in");
    if (ids.length) out.push({ project, tiedBy: "model", ids });
  }
  return out;
}
