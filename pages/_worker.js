// Cloudflare Pages(rate-monitor.pages.dev) 진입점. 사이트 중계는 Worker 와 같은 코드를 쓴다.
// 배포: (저장소 루트에서) npx wrangler pages deploy --branch main  — 설정은 루트 wrangler.toml
import { serveSite } from "../worker/src/site.js";

export default {
  fetch(request, env, ctx) {
    return serveSite(request, env, ctx);
  },
};
