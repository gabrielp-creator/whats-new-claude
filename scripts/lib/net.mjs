// The only way the plugin reads the network: https to three allowlisted hosts, redirects followed by
// hand so every hop is checked, and the optional GitHub token sent only to api.github.com.
// Used by fetch.mjs and enrich-commits.mjs. Tested in tests/net.test.mjs.
export const ALLOWED_HOSTS = new Set(["api.github.com", "platform.claude.com", "www.anthropic.com"]);

export async function get(url, { json = false } = {}) {
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.host)) throw new Error(`host not allowlisted: ${u.host}`);
    const token = process.env.CLAUDE_PLUGIN_OPTION_GITHUB_TOKEN;
    const headers = { "user-agent": "whats-new-claude" };
    if (u.host === "api.github.com" && token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location"), url).href; continue; }
    if (u.host === "api.github.com" && (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")))
      throw new Error(rateLimitLine(res.status, res.headers.get("x-ratelimit-reset"), Boolean(token)));
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${u.host}`);
    return json ? res.json() : res.text();
  }
  throw new Error("too many redirects");
}

// B-68: without a token GitHub allows 60 requests an hour, and the commit sources make one per commit.
// The reset header is a number of seconds; anything else is left out.
function rateLimitLine(status, reset, hasToken) {
  const at = /^\d{1,12}$/.test(String(reset ?? "")) ? new Date(Number(reset) * 1000).toISOString().slice(11, 16) : null;
  return `GitHub rate limit reached (HTTP ${status})${at ? `, resets at ${at} UTC` : ""}${hasToken ? "" : "; a GitHub token in /config raises the limit"}`;
}

// B-69: Node's fetch throws TypeError("fetch failed") when it never reached a server, with the reason
// in cause.code (or in the codes of an AggregateError's errors). Only codes on this list are shown.
const NETWORK_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);
function networkCode(e) {
  const c = e?.cause;
  const codes = [c?.code, ...(Array.isArray(c?.errors) ? c.errors.map((x) => x?.code) : [])];
  return codes.find((code) => NETWORK_CODES.has(code)) || null;
}

// Error text can carry fetched content (a JSON parse error quotes the response) and it is shown in
// the user's session, so only the errors get() writes itself are shown; anything else is its class.
// lib/deprecations.mjs's parse errors are code's words and numbers only.
const OWN_ERROR = /^(HTTP \d{3} from [a-z.]+|host not allowlisted: [a-z0-9.-]+|too many redirects|deprecations page: [a-z0-9 ,]+|GitHub rate limit reached \(HTTP \d{3}\)(, resets at \d{2}:\d{2} UTC)?(; a GitHub token in \/config raises the limit)?)$/;
export function errLine(e) {
  const code = networkCode(e);
  if (code) return `network unreachable (${code})`;
  const m = String(e?.message || e);
  return OWN_ERROR.test(m) ? m : `${e?.name || "Error"} (details not shown)`;
}
