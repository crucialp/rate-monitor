# 금리 모니터

국고채·산금채·회사채·CD·기준금리 일별 추이(1페이지)와 금리 뉴스 인박스(2페이지)를 보여주는 정적 사이트입니다. GitHub Actions가 데이터를 모으고, Cloudflare Worker가 사이트를 내보내며 매시 수집을 깨웁니다.

- 공유 주소: **https://rate-monitor.pages.dev** (Cloudflare Pages)
- 같은 내용의 예비 주소: https://rate-monitor.quotecheck-app.workers.dev , https://crucialp.github.io/rate-monitor/

## 구성

| 경로 | 역할 |
|---|---|
| `scripts/fetch_rates.py` | 한국은행 ECOS 일별 시장금리(817Y002)와 기준금리(722Y001)를 `docs/data/rates.csv`에 누적 |
| `docs/index.html` | 사이트 전체(그래프, 표, 뉴스 인박스). 외부 라이브러리 없음 |
| `.github/workflows/update.yml` | 수집 → 커밋 → Pages 배포. Worker 신호로 실행되고, 예비로 매일 08:47 자체 실행 |
| `pages/_worker.js` | Cloudflare Pages(rate-monitor.pages.dev) 진입점. `worker/src/site.js`로 GitHub 파일을 중계 |
| `worker/` | Cloudflare Worker. 사이트 제공(GitHub 파일 중계) + 평일 07~22시 매시 5분·주말 10·18시 5분 수집 실행 신호 |

두 스크립트 모두 파이썬 표준 라이브러리만 씁니다.

## 처음 설정

1. 저장소 **Settings → Secrets and variables → Actions**에 `ECOS_API_KEY` 추가
2. **Settings → Pages → Build and deployment → Source**를 `GitHub Actions`로 변경
3. **Actions → update-data → Run workflow** 한 번 실행. `rates.csv`가 없으면 2000년부터 전부 받습니다(2~3분).

## Cloudflare Worker

```
npx wrangler pages deploy --branch main   # Pages(대표 주소) 배포. 설정은 루트 wrangler.toml
cd worker
npx wrangler deploy                 # Worker(예약 실행) 배포
npx wrangler secret put GH_TOKEN    # GitHub Actions 실행 권한이 있는 토큰
npx wrangler tail                   # 실행 로그 보기
```

## 방문 기록(관리자 전용)

- 주소: https://rate-monitor.pages.dev/admin (비밀번호는 로컬 `.env`의 `ADMIN_PASSWORD`, 아이디는 아무거나)
- 페이지를 처음 열 때마다 시각·IP·지역·통신사·기기를 D1 `rate-monitor-visits`에 남기고, 90일 지난 기록은 Worker 예약 실행이 지웁니다.
- 주소로 조건 지정: `/admin?days=30&bots=1&hideMe=1`
- 테이블 만들기: `npx wrangler d1 execute rate-monitor-visits --remote --file worker/schema.sql`
- 비밀번호 바꾸기: `npx wrangler pages secret put ADMIN_PASSWORD --project-name rate-monitor` 후 `npx wrangler pages deploy`, Worker 쪽은 `cd worker && npx wrangler secret put ADMIN_PASSWORD`

## 로컬 실행

```
# rate-monitor/.env 에 ECOS_API_KEY=... 한 줄
python scripts/fetch_rates.py          # 증분(최근 21일 다시 받기)
python scripts/fetch_rates.py --full   # 2000년부터 전체
python -m http.server -d docs 8000     # http://localhost:8000
```

## 손볼 곳

- 계열 추가: `fetch_rates.py`의 `SERIES`와 `index.html`의 `SERIES`에 같은 키로 추가. 항목코드는 ECOS `StatisticItemList/817Y002`로 확인.
- 뉴스: `scripts/fetch_news.py` 가 연합뉴스 RSS(경제·마켓+·전체)만 읽어 제목·링크·시각을 `docs/data/news.json` 에 10일치 보관(요약 저장 안 함). 연합뉴스는 비상업·개인 용도 RSS 이용을 허용(이 사이트는 광고 없는 비상업). 구글 뉴스·인포맥스·한경은 약관상 쓰지 않음. 아래 링크 모음은 `.newslinks`.
- 기사 본문은 저장하지 않습니다. 제목, RSS 요약 앞 160자, 원문 링크만 보관합니다.
