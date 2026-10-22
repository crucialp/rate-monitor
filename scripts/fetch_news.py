"""금리 관련 기사를 RSS로 모아 docs/data/news.json 에 누적한다.

- 언론사 RSS(연합인포맥스 채권/외환·정책/금융·전체, 연합뉴스 경제, 한국경제 금융)와
  Google 뉴스 검색 RSS를 읽어 금리 키워드가 있는 기사만 남긴다.
- 기사 본문은 저장하지 않는다. 제목, 링크, 매체, 시각, RSS가 제공하는 요약 앞부분만 쓴다.
- 같은 기사가 여러 피드에 나오면 제목을 정규화해 하나로 합친다(언론사 원문 링크 우선).
- KEEP_DAYS 가 지난 기사는 지운다. 표준 라이브러리만 사용.
"""
import email.utils
import hashlib
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "docs" / "data"
NEWS_PATH = DATA_DIR / "news.json"
META_PATH = DATA_DIR / "meta.json"
KST = ZoneInfo("Asia/Seoul")
KEEP_DAYS = 10
MAX_ITEMS = 2500
SUMMARY_LEN = 160
UA = "Mozilla/5.0 (rate-monitor; +https://github.com/crucialp/rate-monitor)"

FEEDS = [
    ("연합인포맥스", "https://news.einfomax.co.kr/rss/S1N16.xml"),  # 채권/외환
    ("연합인포맥스", "https://news.einfomax.co.kr/rss/S1N15.xml"),  # 정책/금융
    ("연합인포맥스", "https://news.einfomax.co.kr/rss/allArticle.xml"),
    ("연합뉴스", "https://www.yna.co.kr/rss/economy.xml"),
    ("한국경제", "https://www.hankyung.com/feed/finance"),
]
GOOGLE_QUERIES = ["국고채 금리", "채권 금리", "기준금리", "회사채 금리", "미국채 금리", "CD금리"]

FOREIGN = (r"미국|美|미 국채|미국채|연준|FOMC|파월|트레저리|일본|日|독일|獨|분트|유럽|유로존|ECB|"
           r"영국|英|길트|프랑스|佛|이탈리아|호주|RBA|중국|中|해외금리|글로벌 금리|BOJ")
TAGS = [
    ("통화정책", r"기준금리|금통위|한은|韓銀|한국은행|중앙은행|통화정책|금리\s?(인하|인상|동결|결정)|매파|비둘기|BIS"),
    ("국고채·시장", r"국고채|국고\s?\d+년|국채선물|KTB|\d+년물|장기물|단기물|국채|채권\s?시장|채권\s?(강세|약세|금리)|"
                 r"\[채권|채권-|IRS|BMSI|최종호가"),
    ("크레딧", r"회사채|크레딧|여전채|은행채|특수채|공사채|산금채|카드채|증권채|신용\s?스프레드|스프레드|전단채|\bCP\b|"
            r"수요예측|발행금리|신용등급|AA-?|채권\s?발행|녹색채권|조달"),
    ("단기금융", r"\bCD\b|CD금리|콜금리|통안|단기자금|MMF|\bRP\b|레포|머니마켓|KOFR|코리보"),
    ("해외금리", FOREIGN + r"|대외금리"),
    ("예금·대출", r"대출|예금|주담대|가산금리|우대금리|코픽스|COFIX|수신금리|여신금리"),
]
# 제목에 이 중 하나는 있어야 수집한다. 나라 이름만으로는 통과시키지 않는다.
RELEVANT = (r"금리|채권|국채|국고채|기준금리|금통위|회사채|크레딧|통안|산금채|CD금리|콜금리|커브|"
            r"수익률\s?곡선|최종호가|\d+년물|통화정책|금융정책|연준|FOMC|BOJ|ECB|스프레드|여전채|은행채|코리보|KOFR")
EXCLUDE = r"^\s*(<인사>|&lt;인사&gt;|\[부고\]|\[게시판\]|\[시사금융용어\]|\[포토\]|\[사진\])"
# 달러·환율이 주제인 외환 기사는 금리 뉴스에서 뺀다(인포맥스 채권/외환 섹션에 섞여 들어옴).
FX_PRIMARY = (r"^\s*\[외환\]|달러-원|원·달러|원/달러|원-달러|환율\s?(상승|하락|급등|급락|마감|전망)|NDF|"
              r"외환시장|FX\s?스와프|달러\s?(강세|약세)|\d,\d{3}원")
# 구글 뉴스에 섞여 들어오는 해외 번역 사이트 등
EXCLUDE_SOURCES = {"Vietnam.vn"}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read()


def clean(text: str | None) -> str:
    text = html.unescape(html.unescape(text or ""))  # 일부 피드는 두 번 이스케이프돼 있음
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_time(s: str | None) -> datetime | None:
    if not s:
        return None
    s = s.strip()
    try:
        dt = email.utils.parsedate_to_datetime(s)  # RFC 822
    except (TypeError, ValueError):
        try:
            dt = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")  # 인포맥스: KST, 시간대 표기 없음
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=KST)
    return dt.astimezone(KST)


def norm_title(t: str) -> str:
    t = re.sub(r"\((종합|상보|속보|\d보|재종합|종합\d보)\)|\[(속보|종합|단독)\]", "", t)
    return re.sub(r"[\W_]+", "", t).lower()


def tags_for(text: str) -> list[str]:
    tags = [name for name, pat in TAGS if re.search(pat, text)]
    # 해외 국채 기사는 국고채(국내) 태그를 붙이지 않는다.
    if "해외금리" in tags and "국고채·시장" in tags and not re.search(r"국고채|국고\s?\d+년|국채선물|KTB", text):
        tags.remove("국고채·시장")
    return tags


def make_item(source, title, link, published, summary, via):
    text = f"{title} {summary[:120]}"
    if (source in EXCLUDE_SOURCES or re.search(EXCLUDE, title) or re.search(FX_PRIMARY, title)
            or not re.search(RELEVANT, title)):
        return None
    return {
        "id": hashlib.sha1(norm_title(title).encode()).hexdigest()[:12],
        "t": title,
        "u": link,
        "s": source,
        "p": published.isoformat(timespec="minutes"),
        "d": summary[:SUMMARY_LEN] + ("…" if len(summary) > SUMMARY_LEN else ""),
        "g": tags_for(text) or ["기타"],
        "v": via,
    }


def read_feed(source: str, url: str, via: str) -> list[dict]:
    root = ET.fromstring(fetch(url))
    out = []
    for it in root.iter("item"):
        title = clean(it.findtext("title"))
        link = (it.findtext("link") or "").strip()
        published = parse_time(it.findtext("pubDate"))
        if not title or not link or not published:
            continue
        src = source
        summary = clean(it.findtext("description"))
        if via == "google":
            src_el = it.find("source")
            src = clean(src_el.text) if src_el is not None and src_el.text else "Google 뉴스"
            title = re.sub(r"\s+-\s+" + re.escape(src) + r"\s*$", "", title)
            # 매체명 표기가 source 와 다르게 붙는 경우(예: "- 조선비즈", 끝의 " |")
            title = re.sub(r"\s+(\||-\s+[^\s-]{2,12})\s*$", "", title)
            summary = ""  # 구글 뉴스 description 은 링크 HTML 뿐이라 쓰지 않음
        item = make_item(src, title, link, published, summary, via)
        if item:
            out.append(item)
    return out


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(KST)
    old = {}
    if NEWS_PATH.exists():
        for it in json.loads(NEWS_PATH.read_text(encoding="utf-8"))["items"]:
            old[it["id"]] = it

    sources = [(s, u, "rss") for s, u in FEEDS] + [
        ("Google 뉴스",
         "https://news.google.com/rss/search?q=" + urllib.parse.quote(q + " when:2d")
         + "&hl=ko&gl=KR&ceid=KR:ko", "google")
        for q in GOOGLE_QUERIES
    ]
    fresh, failures = [], 0
    for source, url, via in sources:
        try:
            got = read_feed(source, url, via)
            fresh += got
            print(f"{source} {via}: {len(got)}건", flush=True)
        except Exception as e:  # 피드 하나가 죽어도 나머지는 계속
            failures += 1
            print(f"실패 {url}: {e}", file=sys.stderr, flush=True)
    if failures == len(sources):
        sys.exit("모든 피드 수집 실패")

    merged = dict(old)
    added = 0
    for it in fresh:
        prev = merged.get(it["id"])
        if prev is None:
            it["f"] = now.isoformat(timespec="minutes")
            merged[it["id"]] = it
            added += 1
            continue
        # 같은 기사: 언론사 원문 링크를 구글 링크보다 우선하고, 태그는 합친다.
        keep = it if prev.get("v") == "google" and it["v"] != "google" else prev
        keep["f"] = prev.get("f", now.isoformat(timespec="minutes"))
        keep["g"] = sorted((set(prev["g"]) | set(it["g"])) - {"기타"}) or ["기타"]
        if not keep.get("d") and it.get("d"):
            keep["d"] = it["d"]
        merged[it["id"]] = keep

    cutoff = now - timedelta(days=KEEP_DAYS)
    # 필터를 바꾸면 이미 쌓인 기사에도 다시 적용한다.
    items = [i for i in merged.values()
             if datetime.fromisoformat(i["p"]) >= cutoff and not re.search(FX_PRIMARY, i["t"])]
    items.sort(key=lambda i: i["p"], reverse=True)
    items = items[:MAX_ITEMS]

    # 한 줄에 기사 하나: git diff 가 작게 유지된다.
    body = ",\n".join(json.dumps(i, ensure_ascii=False, separators=(",", ":")) for i in items)
    NEWS_PATH.write_text('{"items":[\n' + body + "\n]}\n", encoding="utf-8")

    meta = json.loads(META_PATH.read_text(encoding="utf-8")) if META_PATH.exists() else {}
    meta.update(news_updated=now.isoformat(timespec="minutes"), news_count=len(items))
    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"신규 {added}건, 보관 {len(items)}건")


if __name__ == "__main__":
    try:
        main()
    except SystemExit as e:
        if e.code not in (0, None) and os.environ.get("GITHUB_ACTIONS"):
            print(f"::error title=뉴스 수집 실패::{e.code}", flush=True)
        raise
    except Exception as e:
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::error title=뉴스 수집 실패::{type(e).__name__}: {e}", flush=True)
        raise
