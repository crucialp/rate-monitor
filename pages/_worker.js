// Cloudflare Pages(rate-monitor.pages.dev) 진입점.
// 2026-10-26 환율 조회와 한 사이트로 통합: 이 주소는 https://fx-monitor.pages.dev/rates/ 로 넘긴다(쓰던 즐겨찾기·링크 유지,
// #news 같은 뒷부분은 브라우저가 그대로 붙여 감). /admin 은 통합 관리자 화면(fx-monitor.pages.dev/admin)으로.
// 사이트 본체 중계 코드(worker/src/site.js)는 예비 주소 rate-monitor.quotecheck-app.workers.dev 가 계속 쓴다.
// 배포: (저장소 루트에서) npx wrangler pages deploy --branch main  — 설정은 루트 wrangler.toml
const TARGET = "https://fx-monitor.pages.dev";

export default {
  fetch(request) {
    const u = new URL(request.url);
    const p = u.pathname;
    const to = p === "/admin" || p.startsWith("/admin/") ? `${TARGET}/admin` : `${TARGET}/rates${p}${u.search}`;
    return Response.redirect(to, 302); // 도메인을 정하기 전이라 임시(302). 도메인을 붙이면 그 주소로 바꾼다.
  },
};
