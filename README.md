# 금리 모니터

국고채·산금채·회사채·CD·기준금리 일별 추이(1페이지)와 금리 뉴스 인박스(2페이지)를 보여주는 정적 사이트입니다. GitHub Actions가 데이터를 모으고 GitHub Pages로 배포합니다.

## 구성

| 경로 | 역할 |
|---|---|
| `scripts/fetch_rates.py` | 한국은행 ECOS 일별 시장금리(817Y002)와 기준금리(722Y001)를 `docs/data/rates.csv`에 누적 |
| `scripts/fetch_news.py` | 언론사 RSS와 Google 뉴스 검색에서 금리 기사를 골라 `docs/data/news.json`에 10일치 보관 |
| `docs/index.html` | 사이트 전체(그래프, 표, 뉴스 인박스). 외부 라이브러리 없음 |
| `.github/workflows/update.yml` | 평일 KST 07~22시 매시, 주말 10·18시 실행 → 수집 → 커밋 → Pages 배포 |

두 스크립트 모두 파이썬 표준 라이브러리만 씁니다.

## 처음 설정

1. 저장소 **Settings → Secrets and variables → Actions**에 `ECOS_API_KEY` 추가
2. **Settings → Pages → Build and deployment → Source**를 `GitHub Actions`로 변경
3. **Actions → update-data → Run workflow** 한 번 실행. `rates.csv`가 없으면 2000년부터 전부 받습니다(2~3분).

## 로컬 실행

```
# rate-monitor/.env 에 ECOS_API_KEY=... 한 줄
python scripts/fetch_rates.py          # 증분(최근 21일 다시 받기)
python scripts/fetch_rates.py --full   # 2000년부터 전체
python scripts/fetch_news.py
python -m http.server -d docs 8000     # http://localhost:8000
```

## 손볼 곳

- 계열 추가: `fetch_rates.py`의 `SERIES`와 `index.html`의 `SERIES`에 같은 키로 추가. 항목코드는 ECOS `StatisticItemList/817Y002`로 확인.
- 뉴스 출처·키워드: `fetch_news.py`의 `FEEDS`, `GOOGLE_QUERIES`, `RELEVANT`, `TAGS`.
- 기사 본문은 저장하지 않습니다. 제목, RSS 요약 앞 160자, 원문 링크만 보관합니다.
