// 금리 모니터 Cloudflare Worker
// 1) 사이트 제공(site.js). 대표 주소는 Pages(rate-monitor.pages.dev)이고, 이 Worker 주소도 같은 내용을 낸다.
// 2) 예약 실행: 매시 5분에 GitHub Actions(update.yml)를 실행시켜 금리·뉴스를 갱신한다.
//    GitHub 자체 예약 실행은 정각 혼잡 때 자주 건너뛰어서 여기서 확실하게 깨운다.
import { serveSite } from "./site.js";
import { pruneVisits } from "./admin.js";

const WORKFLOW = "https://api.github.com/repos/crucialp/rate-monitor/actions/workflows/update.yml/dispatches";

export default {
  fetch(request, env, ctx) {
    return serveSite(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(pruneVisits(env)); // 90일 지난 방문 기록 삭제
    if (!shouldRun(event.scheduledTime)) return;
    ctx.waitUntil(dispatch(env));
  },
};

// 평일 KST 07~22시, 주말 KST 10·18시에만 수집한다.
function shouldRun(ms) {
  const k = new Date(ms + 9 * 3600e3);
  const d = k.getUTCDay(), h = k.getUTCHours();
  return (d >= 1 && d <= 5 && h >= 7 && h <= 22) || ((d === 0 || d === 6) && (h === 10 || h === 18));
}

async function dispatch(env) {
  const res = await fetch(WORKFLOW, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GH_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "rate-monitor-worker",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (res.status !== 204) console.log("workflow dispatch failed", res.status, await res.text());
  else console.log("workflow dispatched");
}
