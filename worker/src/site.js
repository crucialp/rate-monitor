// 사이트 제공: GitHub 저장소의 docs/ 파일을 받아 일반 웹사이트로 내보낸다.
// 방문자 브라우저는 Cloudflare 주소(pages.dev / workers.dev)에만 접속하므로 GitHub 가 막힌 망에서도 열린다.
// Worker(index.js)와 Pages(pages/_worker.js)가 같이 쓴다.

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

export async function serveSite(request, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const url = new URL(request.url);
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith("/")) path += "index.html";
  const ext = path.split(".").pop().toLowerCase();
  if (path.includes("..") || !TYPES[ext]) return new Response("Not Found", { status: 404 });

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
