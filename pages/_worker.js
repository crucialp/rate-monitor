// Cloudflare Pages(rate-monitor.pages.dev) 진입점. 사이트 중계는 Worker 와 같은 코드를 쓴다.
// 배포: npx wrangler pages deploy pages --project-name rate-monitor --branch main
import { serveSite } from "../worker/src/site.js";

export default {
  fetch(request, env, ctx) {
    return serveSite(request, ctx);
  },
};
