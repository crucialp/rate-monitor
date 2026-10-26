// 관리자 화면(/admin): 방문 수와 IP 를 보여준다. 비밀번호(ADMIN_PASSWORD) 로 잠근 HTTP Basic 인증.
// 방문 기록은 site.js 의 logVisit 이 D1(visits 테이블)에 남긴다.

const DAY = 86400000;
const KST = 9 * 3600000;
// 봇 판정. 규칙을 바꾸면 scripts/reclassify_visits.py 의 같은 규칙도 함께 바꾼다.
// 1) 기기 정보(UA)에 봇·스캐너 이름이 있거나 2) 형식이 위장된 UA 이거나
// 3) 데이터센터·클라우드 회선(AWS, Google Cloud 등)에서 온 접속. 사람은 보통 가정·회사·휴대폰 회선에서 들어온다.
const BOT_UA = /bot|crawl|spider|slurp|preview|scrap|facebookexternalhit|embedly|discord|slack|telegram|whatsapp|headless|curl|wget|python|go-http|java\/|okhttp|axios|node-fetch|monitor|uptime|measurement|checker|discovery|enricher|research|scanner|httpx|zgrab|masscan|nmap|nuclei/i;
const FAKE_UA = /^Mozilla\/5\.0 \([^)]*\) Chrome\/[\d.]+$/; // AppleWebKit 없이 Chrome 만 붙인 위장 UA
const DATACENTER = /amazon|google|microsoft|azure|ovh|hetzner|digitalocean|scaleway|linode|akamai|vultr|choopa|oracle|alibaba|tencent|huawei cloud|contabo|leaseweb|m247|driftnet|techoff|virtualine|egihosting|interserver|datacamp|cdn77|hostinger|ionos|netcup|colocrossing|psychz|quadranet|tc datacenter|techties|code200|cloudflare|fastly|wgix|ipxo|aeza|stark industries|zenlayer|gcore|g-core|constant company|data ?center|hosting|server|vps|cloud|naukowa|badawczy|research|^us isp$/i;

export function isBot(ua, org) {
  if (!ua || BOT_UA.test(ua) || FAKE_UA.test(ua)) return true;
  if (/\(compatible;/i.test(ua) && !/MSIE|Trident/.test(ua)) return true; // "(compatible; 무슨봇/1.0; +주소)" 형식
  return !!org && DATACENTER.test(org);
}

const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };

export async function handleAdmin(request, env, path) {
  if (!env.ADMIN_PASSWORD) return new Response("관리자 비밀번호가 설정되지 않았습니다.", { status: 503, headers: NO_STORE });
  if (!(await authorized(request, env.ADMIN_PASSWORD))) {
    return new Response("로그인이 필요합니다.", {
      status: 401,
      headers: { ...NO_STORE, "www-authenticate": 'Basic realm="rate-monitor admin", charset="UTF-8"' },
    });
  }
  if (path === "/admin/api/stats") return stats(request, env);
  if (path === "/admin" || path === "/admin/") {
    return new Response(PAGE, { headers: { ...NO_STORE, "content-type": "text/html; charset=utf-8" } });
  }
  return new Response("Not Found", { status: 404, headers: NO_STORE });
}

async function authorized(request, password) {
  const h = request.headers.get("authorization") || "";
  if (!h.startsWith("Basic ")) return false;
  let given = "";
  try {
    const raw = atob(h.slice(6));
    given = raw.slice(raw.indexOf(":") + 1); // 아이디는 아무거나, 비밀번호만 본다
  } catch {
    return false;
  }
  // 길이·내용이 달라도 비교 시간이 같도록 해시끼리 비교한다.
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(password)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function stats(request, env) {
  if (!env.DB) return Response.json({ error: "방문 기록 저장소(DB)가 연결되지 않았습니다." }, { status: 503, headers: NO_STORE });
  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get("days") || "7", 10) || 7));
  const withBots = url.searchParams.get("bots") === "1";
  const hideMe = url.searchParams.get("hideMe") === "1";
  const me = request.headers.get("cf-connecting-ip") || "";

  const now = Date.now();
  const todayStart = Math.floor((now + KST) / DAY) * DAY - KST; // 오늘 0시(KST)
  const since = todayStart - (days - 1) * DAY;
  let where = "ts >= ?1";
  if (!withBots) where += " AND bot = 0";
  if (hideMe) where += " AND ip != ?2";
  const bind = (stmt) => (hideMe ? stmt.bind(since, me) : stmt.bind(since));

  const [summary, today, daily, byIp, recent] = await env.DB.batch([
    bind(env.DB.prepare(`SELECT COUNT(*) AS views, COUNT(DISTINCT ip) AS ips FROM visits WHERE ${where}`)),
    hideMe
      ? env.DB.prepare(`SELECT COUNT(*) AS views, COUNT(DISTINCT ip) AS ips FROM visits WHERE ts >= ?1${withBots ? "" : " AND bot = 0"} AND ip != ?2`).bind(todayStart, me)
      : env.DB.prepare(`SELECT COUNT(*) AS views, COUNT(DISTINCT ip) AS ips FROM visits WHERE ts >= ?1${withBots ? "" : " AND bot = 0"}`).bind(todayStart),
    bind(env.DB.prepare(`SELECT (ts + ${KST}) / ${DAY} AS d, COUNT(*) AS views, COUNT(DISTINCT ip) AS ips FROM visits WHERE ${where} GROUP BY d ORDER BY d`)),
    bind(env.DB.prepare(`SELECT ip, COUNT(*) AS n, MIN(ts) AS first, MAX(ts) AS last, MAX(country) AS country, MAX(city) AS city, MAX(org) AS org, MAX(ua) AS ua, MAX(bot) AS bot FROM visits WHERE ${where} GROUP BY ip ORDER BY n DESC, last DESC LIMIT 300`)),
    bind(env.DB.prepare(`SELECT ts, ip, country, city, org, ua, bot, host, query, referer FROM visits WHERE ${where} ORDER BY ts DESC LIMIT 300`)),
  ]);
  return Response.json({
    me, days, since, todayStart, withBots, hideMe,
    summary: summary.results[0],
    today: today.results[0],
    daily: daily.results.map(r => ({ day: r.d * DAY - KST, views: r.views, ips: r.ips })),
    byIp: byIp.results,
    recent: recent.results,
  }, { headers: NO_STORE });
}

// 90일 지난 방문 기록 삭제(Worker 예약 실행에서 호출)
export async function pruneVisits(env) {
  if (!env.DB) return;
  await env.DB.prepare("DELETE FROM visits WHERE ts < ?1").bind(Date.now() - 90 * DAY).run();
}

// ---------------------------------------------------------------- 관리자 페이지
// 클라이언트 코드는 문자열 연결만 쓴다(이 파일의 템플릿 문자열과 섞이지 않게).
const PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>금리 모니터 방문 기록</title>
<style>
/* Layout: one column. Header + range controls, three KPI tiles, daily bars, IP table, recent visits table. */
:root {
  --bg: #f4f5f3; --surface: #fdfdfc; --ink: #121413; --ink-2: #4b4e4a; --muted: #767973;
  --grid: #e3e4df; --axis: #c2c4bd; --hair: rgba(18,20,19,.11); --wash: rgba(18,20,19,.05);
  --accent: #2a78d6; --me: rgba(42,120,214,.10);
  --f-body: "IBM Plex Sans KR", system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0e100f; --surface: #171918; --ink: #f2f3ef; --ink-2: #c2c4bc; --muted: #8d9089;
    --grid: #282a28; --axis: #3b3d3a; --hair: rgba(255,255,255,.10); --wash: rgba(255,255,255,.06);
    --accent: #3987e5; --me: rgba(57,135,229,.18); color-scheme: dark; }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--f-body); font-size: 14px; line-height: 1.5; }
main { max-width: 1180px; margin: 0 auto; padding: 24px 20px 48px; display: grid; grid-template-columns: minmax(0,1fr); gap: 18px; }
main > * { min-width: 0; }
header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; }
h1 { margin: 0; font-size: 22px; font-weight: 600; }
h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
.sub { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
.controls { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center; }
.seg { display: inline-flex; border: 1px solid var(--hair); border-radius: 8px; padding: 2px; background: var(--surface); }
.seg button { border: 0; background: transparent; color: var(--ink-2); padding: 5px 11px; border-radius: 6px; font: inherit; font-size: 13px; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--wash); color: var(--ink); font-weight: 600; }
label.check { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; color: var(--ink-2); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.tile { background: var(--surface); border: 1px solid var(--hair); border-radius: 10px; padding: 12px 14px; }
.tile .k { font-size: 12.5px; color: var(--muted); }
.tile .v { font-size: 26px; font-weight: 600; margin-top: 2px; }
.tile .d { font-size: 12.5px; color: var(--ink-2); }
.card { background: var(--surface); border: 1px solid var(--hair); border-radius: 10px; padding: 14px; min-width: 0; }
svg { display: block; width: 100%; }
.axis { font-size: 11px; fill: var(--muted); }
.scroll { overflow: auto; max-height: 520px; border: 1px solid var(--hair); border-radius: 10px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 12.5px; font-variant-numeric: tabular-nums; }
th, td { padding: 6px 10px; text-align: left; white-space: nowrap; border-bottom: 1px solid var(--grid); }
thead th { position: sticky; top: 0; background: var(--surface); color: var(--ink-2); font-weight: 500; border-bottom: 1px solid var(--axis); z-index: 1; }
td.num, th.num { text-align: right; }
tr.me td { background: var(--me); }
.pill { font-size: 11px; border: 1px solid var(--hair); border-radius: 999px; padding: 0 7px; color: var(--muted); margin-left: 4px; }
.note { margin: 0; font-size: 12.5px; color: var(--muted); }
.err { color: #d03b3b; }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>금리 모니터 방문 기록</h1>
      <p class="sub" id="meline">불러오는 중…</p>
    </div>
    <div class="controls">
      <div class="seg" id="range">
        <button type="button" data-d="1">오늘</button>
        <button type="button" data-d="7" aria-pressed="true">7일</button>
        <button type="button" data-d="30">30일</button>
        <button type="button" data-d="90">90일</button>
      </div>
      <label class="check"><input type="checkbox" id="hideMe"> 내 IP 제외</label>
      <label class="check"><input type="checkbox" id="bots"> 봇·미리보기 포함</label>
    </div>
  </header>
  <section class="tiles">
    <div class="tile"><div class="k">방문(페이지 열람)</div><div class="v" id="t-views">–</div><div class="d" id="t-views-d"></div></div>
    <div class="tile"><div class="k">고유 IP</div><div class="v" id="t-ips">–</div><div class="d" id="t-ips-d"></div></div>
    <div class="tile"><div class="k">오늘 방문</div><div class="v" id="t-today">–</div><div class="d" id="t-today-d"></div></div>
  </section>
  <section class="card"><h2>일별 방문</h2><div id="chart"></div></section>
  <section><h2>IP별</h2><div class="scroll"><table id="ips"></table></div></section>
  <section><h2>최근 방문 (최대 300건)</h2><div class="scroll"><table id="recent"></table></div></section>
  <p class="note">페이지를 새로 열 때 1건으로 셉니다. 탭 전환과 10분마다 하는 자동 확인은 세지 않습니다. 파란 줄은 지금 보고 있는 내 IP입니다. '봇'은 검색·보안 스캐너, 링크 미리보기, 데이터센터·클라우드 회선(AWS, Google Cloud 등)에서 온 접속이며 기본으로 빼고 셉니다. 90일이 지난 기록은 자동으로 지웁니다.</p>
</main>
<script>
"use strict";
var S = { days: 7, bots: false, hideMe: false, me: "" };
function $(id) { return document.getElementById(id); }
function pad(n) { return (n < 10 ? "0" : "") + n; }
function kst(ms) { var d = new Date(ms + 9 * 3600000); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); }
function kstDay(ms) { var d = new Date(ms + 9 * 3600000); return (d.getUTCMonth() + 1) + "/" + d.getUTCDate(); }
function device(ua) {
  ua = ua || "";
  var os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "기타";
  var br = /KAKAOTALK/i.test(ua) ? "카카오톡" : /NAVER\\(inapp/i.test(ua) ? "네이버앱" : /Whale/.test(ua) ? "웨일" : /Edg\\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "삼성인터넷" : /Firefox/.test(ua) ? "Firefox" : /Chrome\\//.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
  return br ? os + " · " + br : os;
}
function place(r) { return [r.city, r.country].filter(Boolean).join(", "); }
function view(q) {
  var p = new URLSearchParams(q || ""), parts = [];
  var names = { "1M": "1개월", "3M": "3개월", "6M": "6개월", "1Y": "1년", "3Y": "3년", "5Y": "5년", "10Y": "10년", ALL: "전체" };
  if (p.get("p")) parts.push(names[p.get("p")] || p.get("p"));
  if (p.get("u")) parts.push({ D: "일", M: "월", Y: "연", auto: "자동" }[p.get("u")] || p.get("u"));
  return parts.length ? parts.join(" · ") : "기본";
}
function cell(tr, text, cls) { var td = tr.insertCell(); td.textContent = text == null ? "" : String(text); if (cls) td.className = cls; return td; }
function head(t, cols) { var tr = t.createTHead().insertRow(); cols.forEach(function (c) { var th = document.createElement("th"); th.textContent = c[0]; if (c[1]) th.className = c[1]; tr.appendChild(th); }); }

function drawChart(rows, since, days) {
  var el = $("chart"); el.textContent = "";
  var map = {}; rows.forEach(function (r) { map[r.day] = r; });
  var list = []; for (var i = 0; i < days; i++) { var day = since + i * 86400000; list.push({ day: day, views: map[day] ? map[day].views : 0, ips: map[day] ? map[day].ips : 0 }); }
  var W = Math.max(el.clientWidth, 300), H = 180, m = { t: 12, r: 8, b: 24, l: 32 };
  var top = Math.max.apply(null, list.map(function (r) { return r.views; }));
  var max = top <= 2 ? 2 : top + (top % 2); // 짝수로 올려서 가운데 눈금도 정수가 되게

  var ns = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("height", H);
  function add(tag, a) { var e = document.createElementNS(ns, tag); for (var k in a) e.setAttribute(k, a[k]); svg.appendChild(e); return e; }
  var pw = W - m.l - m.r, ph = H - m.t - m.b, bw = pw / list.length;
  [0, 0.5, 1].forEach(function (f) { var y = m.t + ph - f * ph; add("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: f ? "var(--grid)" : "var(--axis)" }); var t = add("text", { x: m.l - 6, y: y + 4, "text-anchor": "end", "class": "axis" }); t.textContent = Math.round(max * f); });
  var every = Math.ceil(list.length / Math.max(1, Math.floor(pw / 44)));
  list.forEach(function (r, i) {
    var h = r.views / max * ph, x = m.l + i * bw + Math.min(2, bw * 0.15), w = Math.max(1, bw - Math.min(4, bw * 0.3));
    var b = add("rect", { x: x, y: m.t + ph - h, width: w, height: Math.max(h, r.views ? 1 : 0), rx: Math.min(3, w / 2), fill: "var(--accent)" });
    var tt = document.createElementNS(ns, "title"); tt.textContent = kstDay(r.day) + " 방문 " + r.views + "건 · IP " + r.ips + "개"; b.appendChild(tt);
    if (i % every === 0) { var t = add("text", { x: x + w / 2, y: H - 6, "text-anchor": "middle", "class": "axis" }); t.textContent = kstDay(r.day); }
  });
  el.appendChild(svg);
}

function render(d) {
  S.me = d.me;
  $("meline").textContent = "내 IP " + (d.me || "알 수 없음") + " · " + (d.days === 1 ? "오늘" : "최근 " + d.days + "일") + (d.withBots ? " · 봇 포함" : "") + (d.hideMe ? " · 내 IP 제외" : "");
  $("t-views").textContent = d.summary.views.toLocaleString("ko-KR");
  $("t-ips").textContent = d.summary.ips.toLocaleString("ko-KR");
  $("t-today").textContent = d.today.views.toLocaleString("ko-KR");
  $("t-today-d").textContent = "IP " + d.today.ips + "개";
  $("t-views-d").textContent = d.days === 1 ? "오늘 0시부터" : "최근 " + d.days + "일";
  $("t-ips-d").textContent = "1인당 평균 " + (d.summary.ips ? (d.summary.views / d.summary.ips).toFixed(1) : "0") + "회";
  drawChart(d.daily, d.since, d.days);

  var t = $("ips"); t.textContent = "";
  head(t, [["IP"], ["방문", "num"], ["처음"], ["마지막"], ["지역"], ["통신사·기관"], ["기기"]]);
  var tb = t.createTBody();
  d.byIp.forEach(function (r) {
    var tr = tb.insertRow(); if (r.ip === d.me) tr.className = "me";
    var c = cell(tr, r.ip); if (r.ip === d.me) { var s = document.createElement("span"); s.className = "pill"; s.textContent = "나"; c.appendChild(s); }
    if (r.bot) { var b = document.createElement("span"); b.className = "pill"; b.textContent = "봇"; c.appendChild(b); }
    cell(tr, r.n, "num"); cell(tr, kst(r.first)); cell(tr, kst(r.last)); cell(tr, place(r)); cell(tr, r.org); cell(tr, device(r.ua));
  });
  if (!d.byIp.length) { var e = tb.insertRow(); cell(e, "아직 기록이 없습니다."); }

  var t2 = $("recent"); t2.textContent = "";
  head(t2, [["시각(KST)"], ["IP"], ["지역"], ["통신사·기관"], ["화면"], ["기기"], ["주소"], ["유입"]]);
  var tb2 = t2.createTBody();
  d.recent.forEach(function (r) {
    var tr = tb2.insertRow(); if (r.ip === d.me) tr.className = "me";
    cell(tr, kst(r.ts)); var c = cell(tr, r.ip); if (r.bot) { var b = document.createElement("span"); b.className = "pill"; b.textContent = "봇"; c.appendChild(b); }
    cell(tr, place(r)); cell(tr, r.org); cell(tr, view(r.query)); cell(tr, device(r.ua)); cell(tr, r.host); cell(tr, r.referer || "직접");
  });
  if (!d.recent.length) { var e2 = tb2.insertRow(); cell(e2, "아직 기록이 없습니다."); }
}

function load() {
  var q = "?days=" + S.days + (S.bots ? "&bots=1" : "") + (S.hideMe ? "&hideMe=1" : "");
  // 주소창에 아이디:비밀번호@ 를 넣어 연 경우에도 되도록 origin(인증 정보 없음) 기준으로 부른다.
  fetch(location.origin + "/admin/api/stats" + q, { cache: "no-store", credentials: "same-origin" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(render)
    .catch(function (e) { $("meline").textContent = "불러오지 못했습니다(" + e.message + "). 새로고침해 주세요."; $("meline").className = "sub err"; });
}
Array.prototype.forEach.call(document.querySelectorAll("#range button"), function (b) {
  b.addEventListener("click", function () {
    S.days = +b.getAttribute("data-d");
    Array.prototype.forEach.call(document.querySelectorAll("#range button"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    load();
  });
});
$("bots").addEventListener("change", function (e) { S.bots = e.target.checked; load(); });
$("hideMe").addEventListener("change", function (e) { S.hideMe = e.target.checked; load(); });
// 주소로 조건 지정: /admin?days=30&bots=1&hideMe=1
(function () {
  var p = new URLSearchParams(location.search);
  if (["1", "7", "30", "90"].indexOf(p.get("days")) >= 0) {
    S.days = +p.get("days");
    Array.prototype.forEach.call(document.querySelectorAll("#range button"), function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-d") === p.get("days"))); });
  }
  if (p.get("bots") === "1") { S.bots = true; $("bots").checked = true; }
  if (p.get("hideMe") === "1") { S.hideMe = true; $("hideMe").checked = true; }
})();
load();
setInterval(load, 60000);
</script>
</body>
</html>`;
