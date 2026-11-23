"""미국채 금리(일별)를 미 재무부 'Daily Treasury Par Yield Curve Rates' CSV 에서 받아 docs/data/ust.csv 로 저장한다.

미국 연방정부 자료(공공영역), 키 없이 받는 공식 CSV. 뉴욕 장 마감 뒤 그날 값이 올라온다.
열: date(YYYYMMDD, 미국 날짜), ust3m, ust2, ust5, ust10, ust30 (%).
처음에는 2000년부터 전부 받고, 그다음부터는 올해(1월이면 작년도) 파일만 다시 받아 합친다.
받기에 실패하면 기존 파일을 그대로 둔다. 금리 추이 화면(1페이지)의 '미국' 줄이 이 파일을 쓴다.
"""
import csv
import datetime as dt
import io
import sys
import time
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "ust.csv"
COLS = [("ust3m", "3 Mo"), ("ust2", "2 Yr"), ("ust5", "5 Yr"), ("ust10", "10 Yr"), ("ust30", "30 Yr")]
URL = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/"
       "{y}/all?type=daily_treasury_yield_curve&field_tdr_date_value={y}&page&_format=csv")


def fetch_year(y):
    last = None
    for i in range(3):
        try:
            req = urllib.request.Request(URL.format(y=y), headers={"User-Agent": "Mozilla/5.0 (rate-monitor; +https://fx-monitor.pages.dev/rates/)"})
            with urllib.request.urlopen(req, timeout=60) as r:
                text = r.read().decode("utf-8-sig")
            rows = csv.DictReader(io.StringIO(text))
            out = {}
            for row in rows:
                m, d, yy = row["Date"].split("/")
                key = f"{yy}{m}{d}"
                out[key] = [row.get(src, "").strip() for _, src in COLS]
            if not out:
                raise ValueError("빈 파일")
            return out
        except Exception as e:  # 재무부 서버가 가끔 느림
            last = e
            time.sleep(2 + i * 3)
    raise RuntimeError(f"{y}년 받기 실패: {last}")


def main():
    data = {}
    if OUT.exists():
        with OUT.open(encoding="utf-8") as f:
            r = csv.reader(f)
            next(r)
            for row in r:
                data[row[0]] = row[1:]
    today = dt.date.today()
    years = list(range(2000, today.year + 1)) if not data else ([today.year - 1, today.year] if today.month == 1 else [today.year])
    try:
        for y in years:
            data.update(fetch_year(y))
    except Exception as e:
        print(f"미국채 금리 받기 실패, 기존 파일 유지: {e}", file=sys.stderr)
        if not data:
            sys.exit(1)
        return
    keys = sorted(data)
    tmp = OUT.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["date"] + [c for c, _ in COLS])
        for k in keys:
            w.writerow([k] + data[k])
    tmp.replace(OUT)
    print(f"저장 {OUT.name}: {len(keys)}일, 마지막 {keys[-1]} 10년 {data[keys[-1]][3]}%")


if __name__ == "__main__":
    main()
