// 사이트 제공: GitHub 저장소의 docs/ 파일을 받아 일반 웹사이트로 내보낸다.
// 방문자 브라우저는 Cloudflare 주소(pages.dev / workers.dev)에만 접속하므로 GitHub 가 막힌 망에서도 열린다.
// Worker(index.js)와 Pages(pages/_worker.js)가 같이 쓴다.
// 페이지를 열 때마다 방문 기록(D1)을 남기고, /admin 은 관리자 화면(admin.js)으로 보낸다.
import { handleAdmin, isBot } from "./admin.js";

const ORIGIN = "https://raw.githubusercontent.com/crucialp/rate-monitor/main/docs";
const TYPES = {
  html: "text/html; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
};
const FRESH_SECONDS = 60; // 데이터 파일은 1분, 페이지는 5분 캐시
const PAGE_SECONDS = 300;
const STALE_SECONDS = 7 * 24 * 3600; // GitHub 가 응답하지 않을 때 내보낼 마지막 정상본 보관 기간

export async function serveSite(request, env, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const url = new URL(request.url);
  let path = decodeURIComponent(url.pathname);
  if (path === "/admin" || path.startsWith("/admin/")) return handleAdmin(request, env, path);
  if (path.endsWith("/")) path += "index.html";
  const ext = path.split(".").pop().toLowerCase();
  if (path.includes("..") || !TYPES[ext]) return new Response("Not Found", { status: 404 });
  if (path === "/index.html" && request.method === "GET" && env.DB) ctx.waitUntil(logVisit(request, env, url));

  const ttl = path.startsWith("/data/") ? FRESH_SECONDS : PAGE_SECONDS;
  const cache = caches.default;
  // 쿼리(?t=…, ?p=ALL)는 캐시 키에서 뺀다. 같은 파일은 하나로 캐시한다.
  const freshKey = new Request(`${url.origin}${path}`);
  const staleKey = new Request(`${url.origin}/__stale${path}`);

  const hit = await cache.match(freshKey);
  if (hit) return hit;

  let origin = null;
  try {
    origin = await fetch(ORIGIN + path, { cf: { cacheTtl: ttl, cacheEverything: true } });
  } catch {
    origin = null;
  }
  if (origin && origin.ok) {
    const body = await origin.arrayBuffer();
    const headers = { "content-type": TYPES[ext], "x-content-type-options": "nosniff" };
    const fresh = new Response(body, { headers: { ...headers, "cache-control": `public, max-age=${ttl}` } });
    const stale = new Response(body, { headers: { ...headers, "cache-control": `public, max-age=${STALE_SECONDS}` } });
    ctx.waitUntil(Promise.all([cache.put(freshKey, fresh.clone()), cache.put(staleKey, stale)]));
    return fresh;
  }
  const stale = await cache.match(staleKey);
  if (stale) return stale;
  return new Response("Not Found", { status: origin ? origin.status : 502 });
}

// 페이지 열람 1건 기록. 실패해도 페이지 응답에는 영향을 주지 않는다.
async function logVisit(request, env, url) {
  const ua = (request.headers.get("user-agent") || "").slice(0, 400);
  const cf = request.cf || {};
  try {
    await env.DB.prepare(
      "INSERT INTO visits (ts, ip, country, city, org, ua, bot, host, query, referer) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
    ).bind(
      Date.now(),
      request.headers.get("cf-connecting-ip") || "",
      cf.country || "",
      cf.city || "",
      cf.asOrganization || "",
      ua,
      isBot(ua) ? 1 : 0,
      url.host,
      url.search.slice(0, 200),
      (request.headers.get("referer") || "").slice(0, 300),
    ).run();
  } catch (e) {
    console.log("visit log failed", String(e));
  }
}
