#!/usr/bin/env node
// Fetches Anthropic release items published since each source's last successful run (first run: a
// look-back window) and adds new ones to <data>/items.jsonl. Deterministic, no LLM, read-only HTTP
// to allowlisted hosts. A failed source is reported loudly and its state is not advanced.
// Usage: node fetch.mjs [firstRunDays=30] [--data <dir>]
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { dataDir, positional, readJsonl, readJson, writeJsonl, writeJson } from "./lib/store.mjs";
import { sinceFor, mergeItems, recordSource, heartbeatWarnings, prNumber } from "./lib/incremental.mjs";
import { safeUrl } from "./lib/brief.mjs";
import { get, errLine } from "./lib/net.mjs";

const TEXT_MAX = 4000; // a huge item would be billed in full on every lens call

const DATA = dataDir();
const [FIRST_DAYS = "30"] = positional();

const decode = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const stripTags = (s) => decode(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// ---- sources (each takes the date to fetch from) ----------------------------

async function githubReleases(repo, source, since) {
  const items = [];
  for (let page = 1; page <= 5; page++) {
    const rels = await get(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, { json: true });
    for (const r of rels) {
      if (new Date(r.published_at) < since) return items;
      const bullets = (r.body || "").split("\n").filter((l) => /^\s*[-*] /.test(l) && !/^\s{2,}/.test(l));
      bullets.forEach((b, i) => items.push({
        id: `${source}:${r.tag_name}:${i}`, source, date: r.published_at.slice(0, 10), title: r.tag_name,
        text: b.replace(/^\s*[-*] /, "").trim(), url: r.html_url, provenance: "anthropic-release",
      }));
    }
    if (rels.length < 100) break;
  }
  return items;
}

async function platformReleaseNotes(since) {
  const xml = await get("https://platform.claude.com/docs/en/release-notes/feed.xml");
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const pick = (tag) => (m[1].match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || "";
    const date = new Date(pick("pubDate"));
    if (date < since) continue;
    const html = decode(pick("description"));
    const lis = [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => stripTags(x[1]));
    (lis.length ? lis : [stripTags(html)]).forEach((t, i) => items.push({
      id: `platform:${date.toISOString().slice(0, 10)}:${i}`, source: "platform-release-notes",
      date: date.toISOString().slice(0, 10), title: stripTags(pick("title")), text: t, url: pick("link"), provenance: "anthropic-docs",
    }));
  }
  return items;
}

async function anthropicSite(since) {
  // Sitemap lastmod is NOT a publish date (pages get mass re-stamped). Use it only to pick
  // candidates, then read article:published_time from each page.
  const xml = await get("https://www.anthropic.com/sitemap.xml");
  const items = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = (m[1].match(/<loc>([^<]+)<\/loc>/) || [])[1] || "";
    const lastmod = (m[1].match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1];
    const section = (loc.match(/^https:\/\/www\.anthropic\.com\/(news|engineering|research)\//) || [])[1];
    if (!section || !lastmod || new Date(lastmod) < since) continue;
    const page = await get(loc);
    const published = (page.match(/article:published_time" content="([^"]+)"/) || [])[1];
    const title = (page.match(/<meta property="og:title" content="([^"]+)"/) || [])[1];
    const desc = (page.match(/<meta (?:name|property)="(?:og:)?description" content="([^"]+)"/) || [])[1];
    if (published && new Date(published) < since) continue; // old post, re-touched
    items.push({
      id: `anthropic-${section}:${loc.split("/").pop()}`, source: `anthropic-${section}`,
      date: (published || lastmod).slice(0, 10), title: decode(title || loc.split("/").pop().replace(/-/g, " ")),
      text: decode(desc || ""), url: loc, provenance: "anthropic-site",
    });
  }
  return items;
}

async function pluginMarketplace(since) {
  // Diff the official marketplace file: which plugins were added since the last run, and by whom.
  const repo = "anthropics/claude-plugins-official";
  const path = ".claude-plugin/marketplace.json";
  const [old] = await get(`https://api.github.com/repos/${repo}/commits?path=${path}&until=${since.toISOString()}&per_page=1`, { json: true });
  const load = async (ref) => {
    const f = await get(`https://api.github.com/repos/${repo}/contents/${path}${ref ? `?ref=${ref}` : ""}`, { json: true });
    return JSON.parse(Buffer.from(f.content, "base64").toString("utf8")).plugins;
  };
  const before = new Set((old ? await load(old.sha) : []).map((p) => p.name));
  const today = new Date().toISOString().slice(0, 10);
  return (await load()).filter((p) => !before.has(p.name)).map((p) => {
    const src = typeof p.source === "string" ? p.source : p.source?.url || p.source?.repo || "";
    const anthropic = src.startsWith("./") || /(^|github\.com\/)anthropics\//.test(src);
    return {
      id: `plugins:${p.name}`, source: "plugins", date: today, title: `New plugin: ${p.name}`,
      text: String(p.description || "").slice(0, 400), url: `https://github.com/${repo}`,
      provenance: anthropic ? "anthropic-published" : "third-party",
    };
  });
}

// Provenance: a PR whose head branch lives in the anthropics repo was pushed by someone with write
// access; a PR from a fork is external; a direct commit also needs write access.
async function commitProvenance(repo, message) {
  const merge = String(message).split("\n")[0].match(/^Merge pull request #(\d+)/);
  const pr = merge ? Number(merge[1]) : prNumber(message); // the last (#N): a title can name another PR earlier
  if (!pr) return "anthropic-write-access";
  const p = await get(`https://api.github.com/repos/${repo}/pulls/${pr}`, { json: true });
  return p.head?.repo?.full_name === repo ? "anthropic-write-access" : "external-fork";
}

async function githubCommits(repo, source, since) {
  const items = [];
  for (let page = 1; page <= 5; page++) {
    const commits = await get(`https://api.github.com/repos/${repo}/commits?per_page=100&page=${page}&since=${since.toISOString()}`, { json: true });
    for (const c of commits) items.push({
      id: `${source}:${c.sha.slice(0, 7)}`, source, date: c.commit.author.date.slice(0, 10),
      title: c.commit.message.split("\n")[0].slice(0, 200), text: "", url: c.html_url,
      provenance: await commitProvenance(repo, c.commit.message),
    });
    if (commits.length < 100) break;
  }
  return items;
}

// ---- tripwires: always surface, whatever the lenses later decide -------------

function setupTerms() {
  // Names from the user's own Claude Code setup (read-only): commands, skills, agents, hooks, settings keys.
  const terms = new Set();
  const claude = join(homedir(), ".claude");
  for (const dir of ["commands", "skills", "agents", "hooks"]) {
    const p = join(claude, dir);
    if (existsSync(p)) for (const f of readdirSync(p)) if (!f.startsWith("_") && !f.startsWith(".")) terms.add(f.replace(/\.(md|mjs|js|sh|py)$/, ""));
  }
  try {
    const s = JSON.parse(readFileSync(join(claude, "settings.json"), "utf8"));
    for (const k of Object.keys(s)) terms.add(k);
    for (const k of Object.keys(s.hooks || {})) terms.add(k);
  } catch {}
  return [...terms].filter((t) => t.length > 4); // short terms produce substring noise
}

const TRIPWIRES = [
  /\bbreaking\b/i, /\bdeprecat/i, /\bremov(ed|es|ing)\b/i, /\brenam(ed|es|ing)\b/i, /\bmigrat/i,
  /\bretir(e|ed|es|ing)\b/i, /\bclaude-(opus|sonnet|haiku|fable|mythos)/i,
  /\b(Opus|Sonnet|Haiku|Fable|Mythos) \d/i, /\bsecurity\b/i,
];
const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function tripwireHits(item, terms) {
  const hay = `${item.title} ${item.text}`;
  const hits = TRIPWIRES.filter((re) => re.test(hay)).map((re) => re.source);
  for (const t of terms) if (new RegExp(`\\b${escape(t)}\\b`, "i").test(hay)) hits.push(`setup:${t}`);
  return hits;
}

// ---- run ----------------------------------------------------------------------

const SOURCES = {
  "claude-code": (s) => githubReleases("anthropics/claude-code", "claude-code", s),
  "agent-sdk-ts": (s) => githubReleases("anthropics/claude-agent-sdk-typescript", "agent-sdk-ts", s),
  "agent-sdk-py": (s) => githubReleases("anthropics/claude-agent-sdk-python", "agent-sdk-py", s),
  "platform-release-notes": platformReleaseNotes,
  "anthropic-site": anthropicSite,
  skills: (s) => githubCommits("anthropics/skills", "skills", s),
  cookbooks: (s) => githubCommits("anthropics/claude-cookbooks", "cookbooks", s),
  plugins: pluginMarketplace,
};

const itemsPath = join(DATA, "items.jsonl");
const statePath = join(DATA, "state.json");
let state = readJson(statePath, { sources: {} });
let store = readJsonl(itemsPath);
const terms = setupTerms();
const lines = [];
let failed = 0, addedTotal = 0;
for (const [name, job] of Object.entries(SOURCES)) {
  const since = sinceFor(state, name, Number(FIRST_DAYS));
  try {
    const fresh = await job(since);
    for (const it of fresh) {
      it.url = safeUrl(it.url); // links are fetched data: https on the source hosts only
      it.text = String(it.text || "").slice(0, TEXT_MAX);
      it.tripwires = tripwireHits(it, terms);
    }
    const { items, added } = mergeItems(store, fresh);
    store = items; addedTotal += added.length;
    const newest = fresh.map((i) => i.date).filter(Boolean).sort().at(-1);
    state = recordSource(state, name, { ok: true, newestDate: newest });
    lines.push(`${name}: ${added.length} new (since ${since.toISOString().slice(0, 10)})`);
  } catch (e) {
    failed++;
    state = recordSource(state, name, { ok: false, error: errLine(e) });
    lines.push(`${name}: FAILED: ${errLine(e)}`);
  }
}
writeJsonl(itemsPath, store);
writeJson(statePath, state);
console.log(lines.join("\n"));
const warnings = heartbeatWarnings(state);
if (warnings.length) console.log(`\nWARNINGS:\n- ${warnings.join("\n- ")}`);
console.log(`\n${addedTotal} new items; ${store.length} stored. ${failed ? `${failed} source(s) FAILED and will be retried next run.` : "All sources ok."}`);
if (failed) process.exitCode = 1;
