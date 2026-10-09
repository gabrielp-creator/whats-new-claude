// The only way the plugin reads the network: https to three allowlisted hosts, redirects followed by
// hand so every hop is checked, and the optional GitHub token sent only to api.github.com.
// Used by fetch.mjs and enrich-commits.mjs.
export const ALLOWED_HOSTS = new Set(["api.github.com", "platform.claude.com", "www.anthropic.com"]);

export async function get(url, { json = false } = {}) {
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.host)) throw new Error(`host not allowlisted: ${u.host}`);
    const headers = { "user-agent": "whats-new-claude" };
    if (u.host === "api.github.com" && process.env.CLAUDE_PLUGIN_OPTION_GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.CLAUDE_PLUGIN_OPTION_GITHUB_TOKEN}`;
    const res = await fetch(url, { headers, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location"), url).href; continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${u.host}`);
    return json ? res.json() : res.text();
  }
  throw new Error("too many redirects");
}

// Error text can carry fetched content (a JSON parse error quotes the response) and it is shown in
// the user's session, so only the errors get() writes itself are shown; anything else is its class.
const OWN_ERROR = /^(HTTP \d{3} from [a-z.]+|host not allowlisted: [a-z0-9.-]+|too many redirects)$/;
export function errLine(e) {
  const m = String(e?.message || e);
  return OWN_ERROR.test(m) ? m : `${e?.name || "Error"} (details not shown)`;
}
