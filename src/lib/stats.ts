/**
 * Own statistics for catalogues hosted on Cloudflare Pages: a tiny collector
 * (Pages Function + D1 database) published with the site, the reader sends
 * anonymous events to it (no cookies, no IP addresses stored), and the app reads
 * the totals back with a private key.
 */

export const COLLECT_PATH = 'api/fs-collect'
export const STATS_PATH = 'api/fs-stats'

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function newStatsKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const SHARED = `const TABLE = "CREATE TABLE IF NOT EXISTS fs_stats (pub TEXT NOT NULL, day TEXT NOT NULL, metric TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (pub, day, metric, key))";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-FS-Key", "Access-Control-Max-Age": "86400" };
let ready = false;
async function prepare(db) { if (!ready) { await db.prepare(TABLE).run(); ready = true; } }
const json = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, CORS) });
`

/** Pages Function that stores reader events as daily counters in the D1 database bound as DB. */
export const COLLECT_FUNCTION = `// FlipStudio Pro statistics collector (generated, do not edit).
${SHARED}
const METRICS = new Set(["visit", "visitor", "page", "search", "click", "item", "share", "download", "video", "bookmark"]);
function device(ua) { return /iPad|Tablet|Nexus 7|Nexus 10|SM-T/i.test(ua) ? "tablet" : /Mobi|Android|iPhone/i.test(ua) ? "phone" : "desktop"; }
export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
export async function onRequestPost({ request, env }) {
  if (!env.DB) return new Response(null, { status: 204, headers: CORS });
  let body;
  try { body = JSON.parse(await request.text()); } catch (e) { return new Response(null, { status: 400, headers: CORS }); }
  const pub = String(body && body.p || "").slice(0, 80);
  const events = Array.isArray(body && body.e) ? body.e.slice(0, 40) : [];
  const day = new Date().toISOString().slice(0, 10);
  const rows = [];
  for (const event of events) {
    const metric = String(event && event[0] || "");
    if (!METRICS.has(metric)) continue;
    rows.push([metric, String(event[1] == null ? "" : event[1]).slice(0, 140)]);
    if (metric === "visit") {
      const cf = request.cf || {};
      rows.push(["country", String(cf.country || "??")]);
      rows.push(["device", device(request.headers.get("user-agent") || "")]);
      const ref = String(body.r || "");
      if (ref) rows.push(["referrer", ref.slice(0, 80)]);
    }
  }
  if (!rows.length) return new Response(null, { status: 204, headers: CORS });
  await prepare(env.DB);
  const insert = env.DB.prepare("INSERT INTO fs_stats (pub, day, metric, key, n) VALUES (?1, ?2, ?3, ?4, 1) ON CONFLICT (pub, day, metric, key) DO UPDATE SET n = n + 1");
  await env.DB.batch(rows.map((row) => insert.bind(pub, day, row[0], row[1])));
  return new Response(null, { status: 204, headers: CORS });
}
`

/** Pages Function the app calls to read the totals (only with the private key). */
export function statsFunction(keyHash: string): string {
  return `// FlipStudio Pro statistics reader (generated, do not edit).
${SHARED}
const KEY_HASH = "${keyHash}";
async function sha256(text) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join(""); }
export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
export async function onRequestGet({ request, env }) {
  const key = request.headers.get("x-fs-key") || "";
  if (!key || (await sha256(key)) !== KEY_HASH) return json({ error: "key" }, 403);
  if (!env.DB) return json({ setup: false, rows: [] });
  await prepare(env.DB);
  const url = new URL(request.url);
  const days = Math.max(1, Math.min(400, Number(url.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const pub = url.searchParams.get("pub") || "";
  const result = await env.DB.prepare("SELECT day, metric, key, n FROM fs_stats WHERE pub = ?1 AND day >= ?2 ORDER BY day").bind(pub, since).all();
  return json({ setup: true, since, rows: (result.results || []).map((r) => [r.day, r.metric, r.key, r.n]) });
}
`
}

export type StatRow = [day: string, metric: string, key: string, n: number]

export interface StatsSummary {
  days: Array<{ day: string; visits: number; pages: number }>
  totals: Record<string, number>
  top: Record<string, Array<{ key: string; n: number }>>
}

/** Daily series (every day in the range, zeros included) and ranked lists per metric. */
export function summarize(rows: StatRow[], days: number, today = new Date()): StatsSummary {
  const totals: Record<string, number> = {}
  const keyed: Record<string, Map<string, number>> = {}
  const perDay = new Map<string, { visits: number; pages: number }>()
  for (const [day, metric, key, n] of rows) {
    totals[metric] = (totals[metric] ?? 0) + n
    const map = keyed[metric] ?? (keyed[metric] = new Map())
    map.set(key, (map.get(key) ?? 0) + n)
    const entry = perDay.get(day) ?? { visits: 0, pages: 0 }
    if (metric === 'visit') entry.visits += n
    if (metric === 'page') entry.pages += n
    perDay.set(day, entry)
  }
  const series: StatsSummary['days'] = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10)
    series.push({ day, ...(perDay.get(day) ?? { visits: 0, pages: 0 }) })
  }
  const top: StatsSummary['top'] = {}
  for (const [metric, map] of Object.entries(keyed)) {
    top[metric] = [...map.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))
  }
  return { days: series, totals, top }
}

const asScope = (moduleCode: string) =>
  `(function () {\n  const exports = {};\n${moduleCode.replace(/export const (\w+)/g, 'const $1 = exports.$1').replace(/export async function (\w+)/g, 'exports.$1 = async function $1')}\n  return exports;\n})()`

/**
 * The same collector and reader as one Cloudflare Pages "advanced mode" worker
 * (_worker.js), used by direct uploads; every other request is served from the site files.
 */
export function statsWorker(keyHash: string): string {
  return `// FlipStudio Pro website worker (generated, do not edit).
const collect = ${asScope(COLLECT_FUNCTION)};
const read = ${asScope(statsFunction(keyHash))};
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const api = path === "/${COLLECT_PATH}" ? collect : path === "/${STATS_PATH}" ? read : null;
    if (api) {
      const handler = request.method === "OPTIONS" ? api.onRequestOptions : request.method === "POST" ? api.onRequestPost : request.method === "GET" ? api.onRequestGet : null;
      if (!handler) return new Response("Method not allowed", { status: 405 });
      return handler({ request, env });
    }
    return env.ASSETS.fetch(request);
  },
};
`
}
