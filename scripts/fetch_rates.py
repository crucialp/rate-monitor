"""한국은행 ECOS 일별 시장금리를 받아 docs/data/rates.csv 에 누적한다.

- 처음 실행(파일 없음)이나 --full 이면 START_DATE 부터 연 단위로 나눠 전체를 다시 받는다.
- 그 외에는 마지막 날짜 기준 RECENT_DAYS 전부터만 받아 덮어쓴다(ECOS 사후 수정 반영).
- 키는 환경변수 ECOS_API_KEY. 로컬에서는 같은 폴더 상위의 .env 도 읽는다.
- 표준 라이브러리만 사용(Actions에서 pip 설치 없이 실행).
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "docs" / "data"
CSV_PATH = DATA_DIR / "rates.csv"
META_PATH = DATA_DIR / "meta.json"
KST = ZoneInfo("Asia/Seoul")

START_DATE = date(2000, 1, 1)
RECENT_DAYS = 21

# (csv 열 이름, 통계표, 항목코드, 표시 이름)
# 항목코드는 ECOS StatisticItemList 응답으로 확인(2026-10-21).
SERIES = [
    ("base", "722Y001", "0101000", "기준금리"),
    ("call", "817Y002", "010101000", "콜금리(1일)"),
    ("cd91", "817Y002", "010502000", "CD(91일)"),
    ("cp91", "817Y002", "010503000", "CP(91일)"),
    ("msb1", "817Y002", "010400001", "통안증권(1년)"),
    ("msb2", "817Y002", "010400002", "통안증권(2년)"),
    ("ktb1", "817Y002", "010190000", "국고채(1년)"),
    ("ktb2", "817Y002", "010195000", "국고채(2년)"),
    ("ktb3", "817Y002", "010200000", "국고채(3년)"),
    ("ktb5", "817Y002", "010200001", "국고채(5년)"),
    ("ktb10", "817Y002", "010210000", "국고채(10년)"),
    ("ktb20", "817Y002", "010220000", "국고채(20년)"),
    ("ktb30", "817Y002", "010230000", "국고채(30년)"),
    ("kdb1", "817Y002", "010260000", "산금채(1년)"),
    ("aa3", "817Y002", "010300000", "회사채(3년, AA-)"),
    ("aa3m", "817Y002", "010310000", "회사채(3년, AA-, 민평)"),
    ("bbb3", "817Y002", "010320000", "회사채(3년, BBB-)"),
]
COLS = [s[0] for s in SERIES]
# 기준금리는 달력일 기준으로 나와서, 시장금리가 하나라도 있는 영업일에만 앞값을 채워 넣는다.
MARKET_COLS = [c for c in COLS if c != "base"]


def load_key() -> str:
    key = os.environ.get("ECOS_API_KEY", "").strip()
    if not key:
        env = ROOT / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.strip().startswith("ECOS_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        sys.exit("ECOS_API_KEY 가 없습니다. 환경변수나 rate-monitor/.env 에 넣어주세요.")
    return key


def ecos(key: str, stat: str, item: str, start: str, end: str, rows: int) -> list[dict]:
    url = (f"https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/1/{rows}/"
           f"{stat}/D/{start}/{end}/{item}")
    last_err = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                body = json.load(r)
            if "StatisticSearch" in body:
                return body["StatisticSearch"]["row"]
            result = body.get("RESULT", {})
            if result.get("CODE") == "INFO-200":  # 해당 기간 데이터 없음
                return []
            last_err = RuntimeError(f"{result.get('CODE')} {result.get('MESSAGE')}")
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last_err = e
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"ECOS 호출 실패 {stat}/{item} {start}-{end}: {last_err}")


def read_csv() -> dict[str, dict[str, str]]:
    table: dict[str, dict[str, str]] = {}
    if not CSV_PATH.exists():
        return table
    with CSV_PATH.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            d = row.pop("date")
            table[d] = {k: v for k, v in row.items() if v}
    return table


def write_csv(table: dict[str, dict[str, str]]) -> str | None:
    # 시장금리가 하나도 없는 날(주말·휴일)은 빼고, 기준금리는 직전 값으로 채운다.
    base_by_day = {d: v["base"] for d, v in table.items() if "base" in v}
    last_base = ""
    out = []
    for d in sorted(set(table) | set(base_by_day)):
        last_base = base_by_day.get(d, last_base)
        row = table.get(d, {})
        if not any(row.get(c) for c in MARKET_COLS):
            continue
        out.append([d, last_base] + [row.get(c, "") for c in MARKET_COLS])
    tmp = CSV_PATH.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["date"] + COLS)
        w.writerows(out)
    tmp.replace(CSV_PATH)
    return out[-1][0] if out else None


def update_meta(**kw) -> None:
    meta = json.loads(META_PATH.read_text(encoding="utf-8")) if META_PATH.exists() else {}
    meta.update(kw)
    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="START_DATE 부터 전부 다시 받기")
    args = ap.parse_args()
    key = load_key()
    sample = key == "sample"  # 공개 테스트 키: 요청당 10행 제한이라 최근 값만 확인용
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    table = read_csv()
    today = datetime.now(KST).date()
    full = args.full or not table
    if full and sample:
        sys.exit("sample 키로는 전체 백필을 할 수 없습니다(요청당 10행 제한).")
    if full:
        table = {}
        windows = [(date(y, 1, 1), min(date(y, 12, 31), today))
                   for y in range(START_DATE.year, today.year + 1)]
    else:
        last = max(table)
        since = datetime.strptime(last, "%Y%m%d").date() - timedelta(days=RECENT_DAYS)
        windows = [(since, today)]

    fetched = 0
    for col, stat, item, name in SERIES:
        for a, b in windows:
            rows = ecos(key, stat, item, a.strftime("%Y%m%d"), b.strftime("%Y%m%d"),
                        10 if sample else 1000)
            for r in rows:
                v = (r.get("DATA_VALUE") or "").strip()
                if v in ("", "-"):
                    continue
                table.setdefault(r["TIME"], {})[col] = f"{float(v):g}"
                fetched += 1
            time.sleep(0.12)
        print(f"{name}: ok", flush=True)

    last_date = write_csv(table)
    update_meta(rates_updated=datetime.now(KST).isoformat(timespec="minutes"),
                rates_last_date=last_date,
                series={c: n for c, _, _, n in SERIES})
    print(f"{'전체' if full else '증분'} 수집 {fetched}건, 마지막 영업일 {last_date}")


def report(msg: str) -> None:
    # Actions 에서는 오류를 주석(annotation)으로 남겨 로그인 없이도 원인을 볼 수 있게 한다.
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::error title=금리 수집 실패::{msg}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except SystemExit as e:
        if e.code not in (0, None):
            report(str(e.code))
        raise
    except Exception as e:
        report(f"{type(e).__name__}: {e}")
        raise
