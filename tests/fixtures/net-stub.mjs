// Loaded with `node --import` by tests/fetch-run.test.mjs: replaces fetch with answers from a routes
// file (WNC_STUB_ROUTES), keyed by host and path, and logs every URL asked (WNC_STUB_LOG).
// A route is {status, headers, body} or {offline: "<code>"}; "*" answers anything unlisted.
import { readFileSync, appendFileSync } from "node:fs";

const routes = JSON.parse(readFileSync(process.env.WNC_STUB_ROUTES, "utf8"));
globalThis.fetch = async (url) => {
  appendFileSync(process.env.WNC_STUB_LOG, `${url}\n`);
  const u = new URL(url);
  const r = routes[`${u.host}${u.pathname}`] || routes["*"] || { status: 404 };
  if (r.offline) throw new TypeError("fetch failed", { cause: Object.assign(new Error(`getaddrinfo ${r.offline} ${u.host}`), { code: r.offline }) });
  const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? null);
  return new Response(body, { status: r.status ?? 200, headers: r.headers || {} });
};
